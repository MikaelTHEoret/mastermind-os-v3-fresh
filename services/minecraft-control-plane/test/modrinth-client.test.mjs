import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  ModrinthClient, fabricVersionSatisfies, inspectFabricModJar, validateFabricCandidateGraph,
} from '../src/modrinth-client.mjs';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30 + nameBytes.length + bytes.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30); bytes.copy(local, 30 + nameBytes.length);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(name.endsWith('/') ? (0x41ed << 16) >>> 0 : (0x81a4 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42); nameBytes.copy(central, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

function descriptorZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const compressed = zlib.deflateRawSync(bytes);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30 + nameBytes.length + compressed.length + 16);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0808, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30); compressed.copy(local, 30 + nameBytes.length);
    const descriptor = 30 + nameBytes.length + compressed.length;
    local.writeUInt32LE(0x08074b50, descriptor); local.writeUInt32LE(crc, descriptor + 4);
    local.writeUInt32LE(compressed.length, descriptor + 8); local.writeUInt32LE(bytes.length, descriptor + 12);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0808, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(name.endsWith('/') ? (0x41ed << 16) >>> 0 : (0x81a4 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42); nameBytes.copy(central, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

function fabricJar(overrides = {}) {
  const metadata = {
    schemaVersion: 1, id: 'examplemod', version: '1.2.3', environment: 'server',
    depends: { fabricloader: '>=0.18.4', minecraft: '~26.2-' }, ...overrides,
  };
  return zip([['META-INF/', Buffer.alloc(0)], ['META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\n'], ['fabric.mod.json', JSON.stringify(metadata)]]);
}

async function temporaryJar(t, bytes) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-modrinth-client-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'artifact.jar');
  await fs.writeFile(file, bytes);
  return file;
}

test('inspects a realistic Fabric JAR with directory entries and evaluates exact candidate predicates', async (t) => {
  const metadata = await inspectFabricModJar(await temporaryJar(t, fabricJar()));
  assert.equal(metadata[0].id, 'examplemod');
  assert.deepEqual(metadata[0].depends.fabricloader, ['>=0.18.4']);
  assert.equal(fabricVersionSatisfies('26.2', metadata[0].depends.minecraft), true);
  const graph = validateFabricCandidateGraph({
    artifacts: [{ metadata }], coreMetadata: [], minecraftVersion: '26.2', loaderVersion: '0.19.3', javaMajor: 25,
  });
  assert.deepEqual(graph.identifiers, ['examplemod', 'fabricloader', 'java', 'minecraft']);
});

test('rejects client metadata, duplicate JSON keys, protected ids and unsafe archive names', async (t) => {
  const clientOnly = await temporaryJar(t, fabricJar({ environment: 'client' }));
  await assert.rejects(() => inspectFabricModJar(clientOnly), /client-only/i);
  const duplicate = zip([['fabric.mod.json', '{"schemaVersion":1,"id":"safe","id":"other","version":"1.0.0"}']]);
  const duplicateFile = await temporaryJar(t, duplicate);
  await assert.rejects(() => inspectFabricModJar(duplicateFile), /duplicate keys/i);
  const protectedFile = await temporaryJar(t, fabricJar({ id: 'geyser-fabric' }));
  await assert.rejects(() => inspectFabricModJar(protectedFile), /protected/i);
  const ads = zip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'safe', version: '1.0.0' })], ['nested/a:b.jar', 'x']]);
  const adsFile = await temporaryJar(t, ads);
  await assert.rejects(() => inspectFabricModJar(adsFile), /unsafe entry/i);
});

test('accepts signed data descriptors and deflated empty directories but rejects descriptor or directory tampering', async (t) => {
  const metadata = JSON.stringify({ schemaVersion: 1, id: 'examplemod', version: '1.2.3', environment: 'server' });
  const valid = descriptorZip([['META-INF/', Buffer.alloc(0)], ['fabric.mod.json', metadata]]);
  assert.equal((await inspectFabricModJar(await temporaryJar(t, valid)))[0].id, 'examplemod');

  const badDescriptor = Buffer.from(valid);
  const descriptor = badDescriptor.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]));
  badDescriptor.writeUInt32LE(1, descriptor + 4);
  const badDescriptorFile = await temporaryJar(t, badDescriptor);
  await assert.rejects(() => inspectFabricModJar(badDescriptorFile), /descriptor/i);

  const badSignature = Buffer.from(valid);
  badSignature.writeUInt32LE(0, descriptor);
  const badSignatureFile = await temporaryJar(t, badSignature);
  await assert.rejects(() => inspectFabricModJar(badSignatureFile), /descriptor/i);

  const badDescriptorSize = Buffer.from(valid);
  badDescriptorSize.writeUInt32LE(1, descriptor + 8);
  const badDescriptorSizeFile = await temporaryJar(t, badDescriptorSize);
  await assert.rejects(() => inspectFabricModJar(badDescriptorSizeFile), /descriptor/i);

  const nonEmptyDirectory = descriptorZip([['META-INF/', 'x'], ['fabric.mod.json', metadata]]);
  const nonEmptyDirectoryFile = await temporaryJar(t, nonEmptyDirectory);
  await assert.rejects(() => inspectFabricModJar(nonEmptyDirectoryFile), /directory entry/i);

  const corruptDirectory = Buffer.from(valid);
  const directoryData = 30 + Buffer.byteLength('META-INF/');
  corruptDirectory[directoryData] ^= 0xff;
  const corruptDirectoryFile = await temporaryJar(t, corruptDirectory);
  await assert.rejects(() => inspectFabricModJar(corruptDirectoryFile), /directory entry/i);

  const legacyDirectoryAttributes = Buffer.from(valid);
  const legacyEocd = legacyDirectoryAttributes.length - 22;
  const firstCentral = legacyDirectoryAttributes.readUInt32LE(legacyEocd + 16);
  legacyDirectoryAttributes.writeUInt32LE(0xffff0000, firstCentral + 38);
  assert.equal((await inspectFabricModJar(await temporaryJar(t, legacyDirectoryAttributes)))[0].id, 'examplemod');

  const invalidFileAttributes = Buffer.from(valid);
  const secondCentral = firstCentral + 46 + Buffer.byteLength('META-INF/');
  invalidFileAttributes.writeUInt32LE(0xffff0000, secondCentral + 38);
  const invalidFileAttributesFile = await temporaryJar(t, invalidFileAttributes);
  await assert.rejects(() => inspectFabricModJar(invalidFileAttributesFile), /non-regular archive entry/i);

  const originalEocd = valid.length - 22;
  const originalCentralOffset = valid.readUInt32LE(originalEocd + 16);
  const hiddenGap = Buffer.concat([valid.subarray(0, originalCentralOffset), Buffer.from([0]), valid.subarray(originalCentralOffset)]);
  const shiftedEocd = hiddenGap.length - 22;
  hiddenGap.writeUInt32LE(originalCentralOffset + 1, shiftedEocd + 16);
  const hiddenGapFile = await temporaryJar(t, hiddenGap);
  await assert.rejects(() => inspectFabricModJar(hiddenGapFile), /unaccounted archive data/i);
});

test('accepts a bounded 5,294-entry shaded server JAR and rejects more than 8,192 entries', async (t) => {
  const metadata = JSON.stringify({ schemaVersion: 1, id: 'examplemod', version: '1.2.3', environment: 'server' });
  const entries = [['fabric.mod.json', metadata]];
  for (let index = 1; index < 5_294; index += 1) entries.push([`shaded/item-${index}.class`, Buffer.alloc(0)]);
  assert.equal((await inspectFabricModJar(await temporaryJar(t, zip(entries))))[0].id, 'examplemod');

  const excessive = [['fabric.mod.json', metadata]];
  for (let index = 1; index < 8_193; index += 1) excessive.push([`shaded/item-${index}.class`, Buffer.alloc(0)]);
  const excessiveFile = await temporaryJar(t, zip(excessive));
  await assert.rejects(() => inspectFabricModJar(excessiveFile), /central directory exceeded/i);

  const nestedMetadata = JSON.stringify({ schemaVersion: 1, id: 'nestedmod', version: '1.0.0' });
  const firstNested = [['fabric.mod.json', nestedMetadata]];
  const secondNested = [['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'othernested', version: '1.0.0' })]];
  for (let index = 1; index < 8_191; index += 1) {
    firstNested.push([`first/item-${index}.class`, Buffer.alloc(0)]);
    secondNested.push([`second/item-${index}.class`, Buffer.alloc(0)]);
  }
  const outerMetadata = JSON.stringify({ schemaVersion: 1, id: 'outermod', version: '1.0.0', environment: 'server',
    jars: [{ file: 'nested/first.jar' }, { file: 'nested/second.jar' }] });
  const aggregateExcess = zip([['fabric.mod.json', outerMetadata], ['nested/first.jar', zip(firstNested)], ['nested/second.jar', zip(secondNested)]]);
  const aggregateExcessFile = await temporaryJar(t, aggregateExcess);
  await assert.rejects(() => inspectFabricModJar(aggregateExcessFile), /too many entries/i);
});

test('normalizes Fabric two-component prereleases and omits nested client-only metadata from a server graph', async (t) => {
  const phantomDependency = fabricJar({ id: 'phantomdep', version: '1.0.0' });
  const clientNested = zip([
    ['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'clientnested', version: '1.1-SNAPSHOT', environment: 'client',
      jars: [{ file: 'nested/phantom.jar' }] })],
    ['nested/phantom.jar', phantomDependency],
  ]);
  const outerEntries = [['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'serverroot', version: '2.11-SNAPSHOT', environment: 'server',
    depends: { fabricloader: '>=0.18.4', minecraft: '>=1.16-rc.3', phantomdep: '*' }, jars: [{ file: 'nested/client.jar' }] })],
  ['nested/client.jar', clientNested]];
  const metadata = await inspectFabricModJar(await temporaryJar(t, zip(outerEntries)));
  assert.deepEqual(metadata.map((item) => item.id), ['serverroot']);
  assert.equal(metadata[0].version, '2.11.0-SNAPSHOT');
  assert.equal(fabricVersionSatisfies('26.2', metadata[0].depends.minecraft), true);
  assert.throws(() => validateFabricCandidateGraph({ artifacts: [{ metadata }], coreMetadata: [],
    minecraftVersion: '26.2', loaderVersion: '0.19.3', javaMajor: 25 }), /dependencies/i);

  assert.equal(fabricVersionSatisfies('v1.2.3', ['=1.2.3']), false);
  const prefixedVersion = await temporaryJar(t, fabricJar({ version: 'v1.2.3' }));
  await assert.rejects(() => inspectFabricModJar(prefixedVersion), /invalid or client-only Fabric metadata/i);
});

test('permits version sets only across trusted core artifacts and keeps every candidate collision fail-closed', () => {
  const core = (id, version, dependencies = {}) => ({ metadata: [{ id, version, environment: '*', ids: [id],
    depends: dependencies, breaks: {}, conflicts: {} }] });
  const sharedFirst = core('shared-core', '1.5.1');
  const sharedSecond = core('shared-core', '1.6.0');
  const requiring = core('core-consumer', '1.0.0', { 'shared-core': ['>=1.5.0'] });
  assert.doesNotThrow(() => validateFabricCandidateGraph({ artifacts: [], coreMetadata: [sharedFirst, sharedSecond, requiring],
    minecraftVersion: '26.2', loaderVersion: '0.19.3', javaMajor: 25 }));

  const tooNarrow = core('strict-consumer', '1.0.0', { 'shared-core': ['>=1.6.0'] });
  assert.throws(() => validateFabricCandidateGraph({ artifacts: [], coreMetadata: [sharedFirst, sharedSecond, tooNarrow],
    minecraftVersion: '26.2', loaderVersion: '0.19.3', javaMajor: 25 }), /dependencies/i);

  assert.throws(() => validateFabricCandidateGraph({ artifacts: [core('shared-core', '1.6.0')], coreMetadata: [sharedFirst],
    minecraftVersion: '26.2', loaderVersion: '0.19.3', javaMajor: 25 }), /duplicate Fabric identifiers/i);
});

test('candidate graph rejects unsatisfied requirements, incompatibilities and cross-artifact duplicate ids', async (t) => {
  const requiring = await inspectFabricModJar(await temporaryJar(t, fabricJar({ depends: { fabricloader: '>=99.0.0' } })));
  assert.throws(() => validateFabricCandidateGraph({
    artifacts: [{ metadata: requiring }], coreMetadata: [], minecraftVersion: '26.2', loaderVersion: '0.19.3', javaMajor: 25,
  }), /does not satisfy/i);
  const first = await inspectFabricModJar(await temporaryJar(t, fabricJar()));
  const second = await inspectFabricModJar(await temporaryJar(t, fabricJar({ version: '1.2.4' })));
  assert.throws(() => validateFabricCandidateGraph({
    artifacts: [{ metadata: first }, { metadata: second }], coreMetadata: [], minecraftVersion: '26.2', loaderVersion: '0.19.3', javaMajor: 25,
  }), /duplicate Fabric identifiers/i);
});

function version(projectId, versionId, dependencies = [], overrides = {}) {
  return {
    id: versionId, project_id: projectId, status: 'listed', version_type: 'release', loaders: ['fabric'],
    game_versions: ['26.2'], environment: 'server_only', version_number: '1.0.0',
    date_published: '2026-08-01T00:00:00.000Z', dependencies,
    files: [{ primary: true, filename: 'display-only.jar', file_type: null, size: 4, hashes: { sha512: 'a'.repeat(128) },
      url: `https://cdn.modrinth.com/data/${projectId}/versions/${versionId}/display-only.jar` }],
    ...overrides,
  };
}

function project(id) { return { id, project_type: 'mod', status: 'approved', title: id, description: 'safe' }; }

test('required dependency cycles are rejected instead of silently selecting the first node', async () => {
  const a = 'AAAABBBB'; const b = 'CCCCDDDD'; const av = '11112222'; const bv = '33334444';
  const fetcher = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === `/v2/project/${a}`) return Response.json(project(a));
    if (pathname === `/v2/project/${b}`) return Response.json(project(b));
    if (pathname === `/v2/project/${a}/version`) return Response.json([version(a, av, [{ dependency_type: 'required', project_id: b, version_id: null }])]);
    if (pathname === `/v2/project/${b}/version`) return Response.json([version(b, bv, [{ dependency_type: 'required', project_id: a, version_id: null }])]);
    return new Response('', { status: 404 });
  };
  await assert.rejects(() => new ModrinthClient(fetcher).resolveGraph({ projectId: a, minecraftVersion: '26.2' }), /cycle/i);
});

test('search treats version environment arrays as provisional and does not trust contradictory legacy fields', async () => {
  let requested;
  const client = new ModrinthClient(async (url) => {
    requested = new URL(url);
    return Response.json({ total_hits: 2, hits: [
      { project_id: 'AAAABBBB', project_type: 'mod', title: 'Safe', description: 'x', author: 'a', downloads: 1,
        environment: ['server_only_client_optional'], server_side: 'unsupported', client_side: 'required' },
      { project_id: 'CCCCDDDD', project_type: 'mod', title: 'Unsafe', environment: ['client_only'], server_side: 'required' },
    ] });
  });
  const result = await client.search({ query: 'map', minecraftVersion: '26.2', offset: 0, limit: 20 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].serverSupport, 'required');
  assert.equal(result.items[0].clientSupport, 'optional');
  assert.match(requested.searchParams.get('facets'), /environment:server_only/);
});

test('download requires identity encoding and exact persisted SHA-512 bytes', async (t) => {
  const bytes = Buffer.from('safe');
  const node = { projectId: 'AAAABBBB', versionId: '11112222', file: {
    sourceUrl: 'https://cdn.modrinth.com/data/AAAABBBB/versions/11112222/safe.jar', size: bytes.length,
    sha512: crypto.createHash('sha512').update(bytes).digest('hex'),
  } };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-download-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'generated.jar');
  const client = new ModrinthClient(async () => new Response(bytes, { headers: { 'content-length': String(bytes.length), 'content-encoding': 'gzip' } }));
  await assert.rejects(() => client.download(node, destination), /transfer encoding/i);
});

test('rejects an ancestor junction before reading an outside artifact', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-anchor-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-victim-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const victim = path.join(outside, 'victim.jar'); const bytes = fabricJar(); await fs.writeFile(victim, bytes);
  const linked = path.join(root, 'stage');
  try { await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error?.code)) return t.skip('link creation is unavailable'); throw error; }
  await assert.rejects(() => inspectFabricModJar(path.join(linked, 'victim.jar'), { anchorRoot: linked, trustedRoot: root }), /link|boundary/i);
  assert.deepEqual(await fs.readFile(victim), bytes);
  assert.deepEqual((await fs.readdir(outside)).sort(), ['victim.jar']);
});
