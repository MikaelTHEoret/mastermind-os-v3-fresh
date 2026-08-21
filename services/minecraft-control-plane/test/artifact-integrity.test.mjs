import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { __test, REQUIRED_FAMILY_ARTIFACTS, verifyFamilyServerInstall } from '../src/artifact-integrity.mjs';
import { minecraftServerJar, zipArchive } from './server-jar-fixture.mjs';

function digest(algorithm, bytes) {
  return crypto.createHash(algorithm).update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function geyserConfig({
  address = '0.0.0.0',
  bedrockPort = 19132,
  cloneRemotePort = false,
  authType = 'floodgate',
  broadcastPort = 0,
  validateBedrockLogin = true,
  directConnection,
  configVersion = 5,
  javaAddress,
  javaPort,
} = {}) {
  return Buffer.from([
    '# Managed by Mastermind for the isolated family server.',
    'bedrock:',
    `  address: ${address}`,
    `  port: ${bedrockPort}`,
    `  clone-remote-port: ${cloneRemotePort}`,
    'java:',
    ...(javaAddress === undefined ? [] : [`  address: ${javaAddress}`]),
    ...(javaPort === undefined ? [] : [`  port: ${javaPort}`]),
    `  auth-type: ${authType}`,
    'advanced:',
    ...(directConnection === undefined ? [] : ['  java:', `    use-direct-connection: ${directConnection}`]),
    '  bedrock:',
    `    broadcast-port: ${broadcastPort}`,
    `    validate-bedrock-login: ${validateBedrockLogin}`,
    `config-version: ${configVersion}`,
    '',
  ].join('\n'));
}

async function fixture(t) {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-integrity-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const id = 'family-server';
  const directory = path.join(managedRoot, 'servers', id);
  const runtimeDirectory = path.join(managedRoot, 'runtimes', 'java-runtime-epsilon', '25.0.1', 'windows-x64');
  const javaExecutable = path.join(runtimeDirectory, 'bin', 'java.exe');
  const artifactBytes = new Map(REQUIRED_FAMILY_ARTIFACTS.map((relativePath) => [
    relativePath,
    relativePath === 'config/Geyser-Fabric/config.yml'
      ? geyserConfig()
      : Buffer.from(`verified:${relativePath}`),
  ]));
  for (const [relativePath, bytes] of artifactBytes) {
    const target = path.join(directory, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  const javaBytes = Buffer.from('verified-managed-java-executable');
  await fs.mkdir(path.dirname(javaExecutable), { recursive: true });
  await fs.writeFile(javaExecutable, javaBytes);
  const runtimeMarker = {
    schemaVersion: 1,
    component: 'java-runtime-epsilon',
    major: 25,
    version: '25.0.1',
    vendor: 'Mojang launcher runtime',
    managed: true,
    source: 'piston-meta.mojang.com',
    platform: 'windows-x64',
    manifestSha1: 'a'.repeat(40),
    executableRelativePath: 'bin/java.exe',
    executableSha1: digest('sha1', javaBytes),
    executableSize: javaBytes.length,
    installedAt: '2026-08-12T00:00:00.000Z',
  };
  await fs.writeFile(path.join(runtimeDirectory, 'runtime.json'), JSON.stringify(runtimeMarker));
  const javaRuntime = {
    component: runtimeMarker.component,
    major: runtimeMarker.major,
    version: runtimeMarker.version,
    vendor: runtimeMarker.vendor,
    managed: true,
    source: runtimeMarker.source,
    platform: runtimeMarker.platform,
    manifestSha1: runtimeMarker.manifestSha1,
    binarySha1: runtimeMarker.executableSha1,
    binarySize: runtimeMarker.executableSize,
    installedAt: runtimeMarker.installedAt,
  };
  const manifest = {
    schemaVersion: 3,
    id,
    projectId: 'family-server',
    kind: 'server',
    minecraftVersion: '26.2',
    loader: 'fabric',
    loaderVersion: '0.19.3',
    javaExecutable,
    javaRuntime,
    artifacts: [...artifactBytes].map(([fileName, bytes]) => ({
      fileName,
      sha256: digest('sha256', bytes),
      size: bytes.length,
    })),
  };
  await fs.writeFile(path.join(directory, 'instance.json'), JSON.stringify(manifest));
  const instance = {
    id,
    projectId: 'family-server',
    kind: 'server',
    provisioningStatus: 'ready',
    directory,
    minecraftVersion: '26.2',
    loaderVersion: '0.19.3',
    javaPort: 25565,
    bedrockPort: 19132,
    javaExecutable,
    javaRuntime,
    artifacts: JSON.parse(JSON.stringify(manifest.artifacts)),
  };
  return { artifactBytes, directory, instance, javaExecutable, managedRoot, manifest };
}

async function installMinecraftServerArtifact(value, { worldDataVersion = 4903 } = {}) {
  const bytes = minecraftServerJar({ minecraftVersion: '26.2', worldDataVersion });
  const relativePath = 'versions/26.2/server-26.2.jar';
  const target = path.join(value.directory, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  const minecraftServerArtifact = { minecraftVersion: '26.2', relativePath, size: bytes.length,
    sha1: digest('sha1', bytes), sha256: digest('sha256', bytes), worldDataVersion };
  Object.assign(value.manifest, { worldDataVersion, minecraftServerArtifact });
  Object.assign(value.instance, { worldDataVersion, minecraftServerArtifact: structuredClone(minecraftServerArtifact) });
  await fs.writeFile(path.join(value.directory, 'instance.json'), JSON.stringify(value.manifest));
  return { bytes, relativePath, target };
}

function testJar(classPath = null) {
  const manifest = `Manifest-Version: 1.0\r\n${classPath === null ? '' : `Class-Path: ${classPath}\r\n`}\r\n`;
  return zipArchive([{ name: 'META-INF/MANIFEST.MF', bytes: Buffer.from(manifest) }]);
}

test('accepts Mojang-sized signed JAR manifests within the bounded launch limit', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-large-manifest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'server.jar');
  const header = Buffer.from('Manifest-Version: 1.0\r\nMain-Class: net.minecraft.server.Main\r\n\r\n');
  const body = Buffer.alloc((2.5 * 1024 * 1024) - header.length, 0x41);
  await fs.writeFile(target, zipArchive([{ name: 'META-INF/MANIFEST.MF', bytes: Buffer.concat([header, body]) }]));
  assert.deepEqual(await __test.manifestClassPath(target), []);
});

test('rejects launch JAR manifests above the bounded launch limit', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-oversized-manifest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'server.jar');
  await fs.writeFile(target, zipArchive([{
    name: 'META-INF/MANIFEST.MF',
    bytes: Buffer.alloc((4 * 1024 * 1024) + 1, 0x41),
  }]));
  await assert.rejects(() => __test.manifestClassPath(target), /manifest exceeded its safe limit/i);
});

async function testModLaunchBinding(value, managedMods) {
  const scan = async () => {
    const names = (await fs.readdir(path.join(value.directory, 'mods'))).sort((left, right) => left.localeCompare(right));
    const entries = [];
    for (const name of names) {
      const bytes = await fs.readFile(path.join(value.directory, 'mods', name));
      entries.push({ name, size: bytes.length, sha512: digest('sha512', bytes) });
    }
    return entries;
  };
  const entries = await scan();
  const binding = {
    schemaVersion: 1,
    instanceId: value.instance.id,
    generation: managedMods.length ? 'f'.repeat(64) : digest('sha256', Buffer.from(`empty:${value.instance.id}`)),
    inventoryDigest: digest('sha256', Buffer.from(canonicalJson(entries))),
    mods: structuredClone(managedMods),
  };
  let released = false;
  return {
    binding,
    async assertHeld() {
      if (released || digest('sha256', Buffer.from(canonicalJson(await scan()))) !== binding.inventoryDigest) {
        throw new Error('Injected mod launch binding changed');
      }
      return true;
    },
    async release() { released = true; },
  };
}

async function launchFixture(t, options = {}) {
  const value = await fixture(t);
  const managedMods = [];
  for (const relativePath of REQUIRED_FAMILY_ARTIFACTS.filter((entry) => entry.endsWith('.jar'))) {
    const bytes = testJar(relativePath === 'fabric-server-launch.jar' ? options.bootstrapClassPath ?? null : null);
    await fs.writeFile(path.join(value.directory, ...relativePath.split('/')), bytes);
    value.artifactBytes.set(relativePath, bytes);
    const privateEntry = value.manifest.artifacts.find((entry) => entry.fileName === relativePath);
    const publicEntry = value.instance.artifacts.find((entry) => entry.fileName === relativePath);
    Object.assign(privateEntry, { sha256: digest('sha256', bytes), size: bytes.length });
    Object.assign(publicEntry, { sha256: digest('sha256', bytes), size: bytes.length });
  }
  await installMinecraftServerArtifact(value);
  if (options.managedUserMod) {
    const bytes = testJar();
    const fileName = `mastermind-${'a'.repeat(48)}.jar`;
    await fs.writeFile(path.join(value.directory, 'mods', fileName), bytes);
    managedMods.push({ fileName, sha512: digest('sha512', bytes), size: bytes.length });
  }
  const runtimeDirectory = path.dirname(path.dirname(value.javaExecutable));
  const javaBytes = await fs.readFile(value.javaExecutable);
  const runtimeFiles = [{
    relativePath: 'bin/java.exe', type: 'file', sha1: digest('sha1', javaBytes),
    sha256: digest('sha256', javaBytes), size: javaBytes.length,
  }];
  const runtimeDirectories = ['bin'];
  const runtimeInventorySha256 = digest('sha256', Buffer.from(canonicalJson({ directories: runtimeDirectories, files: runtimeFiles })));
  const marker = {
    schemaVersion: 2,
    component: 'java-runtime-epsilon', major: 25, version: '25.0.1', vendor: 'Mojang launcher runtime',
    managed: true, source: 'piston-meta.mojang.com', platform: 'windows-x64', manifestSha1: 'a'.repeat(40),
    executableRelativePath: 'bin/java.exe', executableSha1: digest('sha1', javaBytes), executableSize: javaBytes.length,
    sourceInventorySha256: 'b'.repeat(64), inventorySha256: runtimeInventorySha256,
    files: runtimeFiles, directories: runtimeDirectories, installedAt: '2026-08-12T00:00:00.000Z',
  };
  await fs.writeFile(path.join(runtimeDirectory, 'runtime.json'), JSON.stringify(marker));
  const javaRuntime = {
    component: marker.component, major: marker.major, version: marker.version, vendor: marker.vendor, managed: true,
    source: marker.source, platform: marker.platform, manifestSha1: marker.manifestSha1,
    binarySha1: marker.executableSha1, binarySize: marker.executableSize,
    inventorySha256: marker.inventorySha256, inventoryFileCount: marker.files.length, installedAt: marker.installedAt,
  };
  const assetBytes = new Map([
    ['fabric/libraries/loader.jar', testJar(options.fabricClassPath ?? null)],
    ['mojang/versions/server.jar', minecraftServerJar()],
    ['mojang/libraries/game-lib.jar', testJar()],
  ]);
  const assetFiles = [...assetBytes].map(([relativePath, bytes]) => ({
    relativePath, sha256: digest('sha256', bytes), size: bytes.length,
    ...(relativePath.startsWith('fabric/') ? { coordinate: 'net.fabricmc:fabric-loader:0.19.3' } : {}),
    ...(relativePath.includes('/versions/') ? { role: 'minecraft-game-jar' } : {}),
    ...(relativePath.includes('/libraries/') && !relativePath.startsWith('fabric/')
      ? { coordinate: 'com.mojang:game-lib:1', role: 'minecraft-library' } : {}),
  })).sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en-US'));
  const fabricMetadataSha256 = 'e'.repeat(64);
  const launchAssetIdentity = {
    schemaVersion: 1,
    minecraftVersion: '26.2',
    loaderVersion: '0.19.3',
    fabricMetadataSha256,
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotServer',
    outerServerSha256: value.instance.minecraftServerArtifact.sha256,
    files: assetFiles,
  };
  const assetDigest = digest('sha256', Buffer.from(canonicalJson(launchAssetIdentity)));
  const assetRoot = path.join(value.managedRoot, 'state', 'launch-artifacts', assetDigest);
  for (const [relativePath, bytes] of assetBytes) {
    const target = path.join(assetRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  const components = {
    fabricApi: { versionId: 'fabric-api-version', versionNumber: '1', versionType: 'release', sourceHash: { algorithm: 'sha512', value: '1'.repeat(128) } },
    geyser: { versionId: 'geyser-version', versionNumber: '1', versionType: 'beta', sourceHash: { algorithm: 'sha512', value: '2'.repeat(128) } },
    floodgate: { versionId: 'floodgate-version', versionNumber: '1', versionType: 'release', sourceHash: { algorithm: 'sha512', value: '3'.repeat(128) } },
  };
  Object.assign(value.instance, { installerVersion: '1.1.2', components, javaRuntime });
  Object.assign(value.manifest, { installerVersion: '1.1.2', components, javaRuntime });
  const launchAssets = {
    schemaVersion: 1,
    digest: assetDigest,
    relativeRoot: `state/launch-artifacts/${assetDigest}`,
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotServer',
    fabricClasspath: ['fabric/libraries/loader.jar'],
    gameJar: 'mojang/versions/server.jar',
    gameLibraries: ['mojang/libraries/game-lib.jar'],
    files: assetFiles,
    fabricMetadataSha256,
    outerServerSha256: value.instance.minecraftServerArtifact.sha256,
  };
  const instanceFiles = value.instance.artifacts
    .filter((entry) => entry.fileName !== 'config/Geyser-Fabric/config.yml')
    .map((entry) => ({ relativePath: entry.fileName, sha256: entry.sha256, size: entry.size }));
  instanceFiles.push({
    relativePath: value.instance.minecraftServerArtifact.relativePath,
    sha256: value.instance.minecraftServerArtifact.sha256,
    size: value.instance.minecraftServerArtifact.size,
  });
  instanceFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en-US'));
  const inventory = {
    schemaVersion: 1,
    instanceId: value.instance.id,
    stack: {
      projectId: 'family-server', kind: 'server', minecraftVersion: '26.2', loaderVersion: '0.19.3', installerVersion: '1.1.2',
      minecraftServerArtifact: value.instance.minecraftServerArtifact, components,
      runtime: { component: marker.component, major: marker.major, version: marker.version, platform: marker.platform,
        manifestSha1: marker.manifestSha1, inventorySha256: marker.inventorySha256 },
      launchAssetDigest: assetDigest,
    },
    runtime: {
      relativeRoot: path.relative(value.managedRoot, runtimeDirectory).split(path.sep).join('/'),
      executableRelativePath: 'bin/java.exe', inventorySha256: marker.inventorySha256,
      files: runtimeFiles.map(({ type, ...entry }) => entry), directories: runtimeDirectories,
    },
    launchAssets,
    instanceFiles,
    exactMutableTrees: { mods: 'authenticated-family-mod-manifest-plus-core-only', libraries: 'absent', fabric: 'absent',
      versions: [value.instance.minecraftServerArtifact.relativePath] },
  };
  const inventoryDigest = digest('sha256', Buffer.from(canonicalJson(inventory)));
  const key = Buffer.alloc(32, 0x42);
  const inventoryRoot = path.join(value.managedRoot, 'state', 'launch-inventories');
  await fs.mkdir(inventoryRoot, { recursive: true });
  await fs.writeFile(path.join(value.managedRoot, 'state', 'launch-integrity.hmac.key'), key);
  await fs.writeFile(path.join(inventoryRoot, `${inventoryDigest}.json`), JSON.stringify({
    schemaVersion: 1,
    inventory,
    mac: crypto.createHmac('sha256', key).update(canonicalJson(inventory)).digest('hex'),
  }));
  value.instance.javaRuntime = { ...javaRuntime, launchAssetDigest: assetDigest, launchInventoryDigest: inventoryDigest };
  value.manifest.javaRuntime = structuredClone(value.instance.javaRuntime);
  await fs.writeFile(path.join(value.directory, 'instance.json'), JSON.stringify(value.manifest));
  return {
    ...value, assetRoot, inventory, inventoryDigest,
    modLaunchBinding: await testModLaunchBinding(value, managedMods),
  };
}

function isUnsafeArtifactPath(error) {
  return error?.code === 'WORLD_INTEGRITY_FAILED'
    || /unsafe|regular managed directory|changed during verification|trusted regular file/i.test(error?.message ?? '');
}

test('verifies the complete pinned Family Server stack before execution', async (t) => {
  const value = await fixture(t);
  const result = await verifyFamilyServerInstall(value.instance);
  assert.equal(result.ok, true);
  assert.equal(result.artifactCount, REQUIRED_FAMILY_ARTIFACTS.length);
  assert.equal(result.runtime.major, 25);
  assert.equal(JSON.stringify(result).includes(value.managedRoot), false);
});

test('verifies the Mojang server artifact that anchors the trusted world DataVersion ceiling', async (t) => {
  const value = await fixture(t);
  const { target } = await installMinecraftServerArtifact(value);
  const result = await verifyFamilyServerInstall(value.instance);
  assert.equal(result.worldDataVersion, 4903);
  assert.equal(result.artifactCount, REQUIRED_FAMILY_ARTIFACTS.length + 1);
  await fs.writeFile(target, minecraftServerJar({ minecraftVersion: '26.2', worldDataVersion: 4904 }));
  await assert.rejects(() => verifyFamilyServerInstall(value.instance), /artifact failed trusted digest verification/);
});

test('rejects an ancestor versions junction to an outside matching server JAR', async (t) => {
  const value = await fixture(t);
  const { bytes } = await installMinecraftServerArtifact(value);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-integrity-victim-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const outsideVersion = path.join(outside, '26.2');
  await fs.mkdir(outsideVersion, { recursive: true });
  await fs.writeFile(path.join(outsideVersion, 'server-26.2.jar'), bytes);
  const versions = path.join(value.directory, 'versions');
  await fs.rm(versions, { recursive: true });
  try {
    await fs.symlink(outside, versions, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOTSUP'].includes(error?.code)) return t.skip(`directory links unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(() => verifyFamilyServerInstall(value.instance), isUnsafeArtifactPath);
});

test('rejects a hard-linked trusted server JAR', async (t) => {
  const value = await fixture(t);
  const { target } = await installMinecraftServerArtifact(value);
  try {
    await fs.link(target, path.join(path.dirname(target), 'server-hardlink.jar'));
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOTSUP'].includes(error?.code)) return t.skip(`hard links unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(() => verifyFamilyServerInstall(value.instance), isUnsafeArtifactPath);
});

test('rejects alternate data streams on the trusted server JAR when supported', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows alternate data streams are not available');
  const value = await fixture(t);
  const { target } = await installMinecraftServerArtifact(value);
  const stream = `${target}:mastermind-integrity-test`;
  try {
    await fs.writeFile(stream, 'untrusted stream');
    assert.equal(await fs.readFile(stream, 'utf8'), 'untrusted stream');
  } catch (error) {
    if (['EACCES', 'EINVAL', 'ENOENT', 'ENOTSUP', 'EPERM'].includes(error?.code)) {
      return t.skip(`alternate data streams unavailable: ${error.code}`);
    }
    throw error;
  }
  await assert.rejects(() => verifyFamilyServerInstall(value.instance), isUnsafeArtifactPath);
});

test('rejects a replaced immutable managed jar', async (t) => {
  const value = await fixture(t);
  await fs.writeFile(path.join(value.directory, 'mods', 'geyser-fabric.jar'), 'tampered-geyser');
  await assert.rejects(() => verifyFamilyServerInstall(value.instance), /Geyser|geyser-fabric\.jar failed integrity/i);
});

test('accepts a policy-preserving Geyser-expanded runtime configuration', async (t) => {
  const value = await fixture(t);
  const expanded = Buffer.concat([
    Buffer.from('# Geyser Configuration File\n# Runtime comments and generated defaults are intentionally mutable.\n'),
    geyserConfig({ directConnection: true, configVersion: 7 }),
    Buffer.from('enable-metrics: true\ndebug-mode: false\n'),
  ]);
  assert.notEqual(expanded.length, value.artifactBytes.get('config/Geyser-Fabric/config.yml').length);
  await fs.writeFile(path.join(value.directory, 'config', 'Geyser-Fabric', 'config.yml'), expanded);
  const result = await verifyFamilyServerInstall(value.instance);
  assert.equal(result.ok, true);
  assert.equal(result.artifactCount, REQUIRED_FAMILY_ARTIFACTS.length);
});

test('rejects unsafe mutations of the Geyser Family Server policy', async (t) => {
  const cases = [
    ['Bedrock bind address', { address: '127.0.0.1', directConnection: true }, /bedrock\.address/],
    ['Bedrock listener port', { bedrockPort: 19133, directConnection: true }, /bedrock\.port/],
    ['remote-port cloning', { cloneRemotePort: true, directConnection: true }, /clone-remote-port/],
    ['Floodgate authentication', { authType: 'online', directConnection: true }, /java\.auth-type/],
    ['direct Java connection', { directConnection: false }, /use-direct-connection/],
    ['Bedrock broadcast port', { broadcastPort: 19133, directConnection: true }, /broadcast-port/],
    ['Bedrock login validation', { validateBedrockLogin: false, directConnection: true }, /validate-bedrock-login/],
    ['configuration schema', { configVersion: 0, directConnection: true }, /config-version/],
  ];
  for (const [name, config, message] of cases) {
    await t.test(name, async (subtest) => {
      const value = await fixture(subtest);
      await fs.writeFile(
        path.join(value.directory, 'config', 'Geyser-Fabric', 'config.yml'),
        geyserConfig({ ...config, configVersion: config.configVersion ?? 7 }),
      );
      await assert.rejects(() => verifyFamilyServerInstall(value.instance), message);
    });
  }
});

test('validates an explicit Java endpoint when direct connection is unavailable', async (t) => {
  const accepted = await fixture(t);
  await fs.writeFile(
    path.join(accepted.directory, 'config', 'Geyser-Fabric', 'config.yml'),
    geyserConfig({ javaAddress: '127.0.0.1', javaPort: 25565, configVersion: 7 }),
  );
  assert.equal((await verifyFamilyServerInstall(accepted.instance)).ok, true);

  const rejected = await fixture(t);
  await fs.writeFile(
    path.join(rejected.directory, 'config', 'Geyser-Fabric', 'config.yml'),
    geyserConfig({ javaAddress: '192.0.2.10', javaPort: 25565, configVersion: 7 }),
  );
  await assert.rejects(() => verifyFamilyServerInstall(rejected.instance), /local Java server/);
});

test('rejects an ambiguous or non-regular Geyser runtime configuration', async (t) => {
  const duplicate = await fixture(t);
  await fs.writeFile(
    path.join(duplicate.directory, 'config', 'Geyser-Fabric', 'config.yml'),
    Buffer.concat([geyserConfig({ directConnection: true, configVersion: 7 }), Buffer.from('bedrock:\n  port: 19132\n')]),
  );
  await assert.rejects(() => verifyFamilyServerInstall(duplicate.instance), /duplicate mapping 'bedrock'/);

  const nonRegular = await fixture(t);
  const configPath = path.join(nonRegular.directory, 'config', 'Geyser-Fabric', 'config.yml');
  await fs.rm(configPath);
  await fs.mkdir(configPath);
  await assert.rejects(() => verifyFamilyServerInstall(nonRegular.instance), /not a regular managed configuration file/);
});

test('rejects coordinated artifact and private-manifest tampering against managed inventory', async (t) => {
  const value = await fixture(t);
  const bytes = Buffer.from('coordinated-tampering');
  await fs.writeFile(path.join(value.directory, 'mods', 'geyser-fabric.jar'), bytes);
  const artifact = value.manifest.artifacts.find((item) => item.fileName === 'mods/geyser-fabric.jar');
  artifact.sha256 = digest('sha256', bytes);
  artifact.size = bytes.length;
  await fs.writeFile(path.join(value.directory, 'instance.json'), JSON.stringify(value.manifest));
  await assert.rejects(() => verifyFamilyServerInstall(value.instance), /disagrees with managed inventory.*geyser-fabric/i);
});

test('rejects a replaced managed Java executable', async (t) => {
  const value = await fixture(t);
  await fs.writeFile(value.javaExecutable, Buffer.alloc(value.manifest.artifacts[0].size, 0x41));
  await assert.rejects(() => verifyFamilyServerInstall(value.instance), /Java executable (?:size does not match|failed integrity)/);
});

test('rejects coordinated Java executable and runtime-marker tampering against managed inventory', async (t) => {
  const value = await fixture(t);
  const bytes = Buffer.from('coordinated-java-tampering');
  await fs.writeFile(value.javaExecutable, bytes);
  const markerPath = path.join(path.dirname(path.dirname(value.javaExecutable)), 'runtime.json');
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  marker.executableSha1 = digest('sha1', bytes);
  marker.executableSize = bytes.length;
  await fs.writeFile(markerPath, JSON.stringify(marker));
  await assert.rejects(() => verifyFamilyServerInstall(value.instance), /runtime marker does not match/i);
});

test('rejects incomplete, duplicate, or path-like artifact manifests', async (t) => {
  const missing = await fixture(t);
  missing.manifest.artifacts.pop();
  await fs.writeFile(path.join(missing.directory, 'instance.json'), JSON.stringify(missing.manifest));
  await assert.rejects(() => verifyFamilyServerInstall(missing.instance), /complete managed artifact set/);

  const pathLike = await fixture(t);
  pathLike.manifest.artifacts[0].fileName = '../fabric-server-launch.jar';
  await fs.writeFile(path.join(pathLike.directory, 'instance.json'), JSON.stringify(pathLike.manifest));
  await assert.rejects(() => verifyFamilyServerInstall(pathLike.instance), /unknown managed artifact/);
});

test('builds a one-shot direct Fabric command from the authenticated complete inventory', async (t) => {
  const value = await launchFixture(t);
  const capability = await verifyFamilyServerInstall(value.instance, {
    requireLaunchCapability: true,
    platform: 'linux',
    nativeFilesystemGuards: false,
    allowUnconstrainedModDiscoveryForTests: true,
    modLaunchBinding: value.modLaunchBinding,
  });
  t.after(() => capability.lease.release());
  assert.equal(capability.launchInventoryDigest, value.inventoryDigest);
  assert.match(capability.effectiveLaunchInventoryDigest, /^[a-f0-9]{64}$/);
  assert.equal(capability.command.executable, value.javaExecutable);
  assert.equal(capability.command.cwd, value.directory);
  assert.equal(capability.command.args.includes('-jar'), false);
  assert.ok(capability.command.args.some((entry) => entry.startsWith('-Dfabric.gameJarPath=')));
  const modsArgument = capability.command.args.find((entry) => entry.startsWith('-Dfabric.modsFolder='));
  assert.ok(modsArgument);
  assert.notEqual(path.resolve(modsArgument.slice(modsArgument.indexOf('=') + 1)), path.join(value.directory, 'mods'));

  await fs.writeFile(path.join(value.directory, 'mods', 'injected-after-verification.jar'), testJar());
  await capability.lease.assertHeld();
  const snapshotDirectory = modsArgument.slice(modsArgument.indexOf('=') + 1);
  const snapshotted = await fs.readdir(snapshotDirectory);
  assert.deepEqual(snapshotted.sort(), ['fabric-api.jar', 'floodgate-fabric.jar', 'geyser-fabric.jar']);
  await fs.writeFile(path.join(snapshotDirectory, 'injected-after-seal.jar'), testJar());
  await assert.rejects(() => capability.lease.assertHeld(), /launch mod snapshot/i);
  await capability.lease.release();
});

test('rejects authenticated-inventory tampering and unlisted launch libraries', async (t) => {
  const tampered = await launchFixture(t);
  const inventoryFile = path.join(tampered.managedRoot, 'state', 'launch-inventories', `${tampered.inventoryDigest}.json`);
  const wrapper = JSON.parse(await fs.readFile(inventoryFile, 'utf8'));
  wrapper.inventory.instanceId = 'other-family-server';
  await fs.writeFile(inventoryFile, JSON.stringify(wrapper));
  await assert.rejects(() => verifyFamilyServerInstall(tampered.instance, {
    platform: 'linux', nativeFilesystemGuards: false,
  }), /digest|authentication|replayed/i);

  const unlisted = await launchFixture(t);
  await fs.writeFile(path.join(unlisted.assetRoot, 'fabric', 'libraries', 'injected.jar'), testJar());
  await assert.rejects(() => verifyFamilyServerInstall(unlisted.instance, {
    platform: 'linux', nativeFilesystemGuards: false,
  }), /unlisted|exact inventory/i);
});

test('same-process launch-key continuity rejects coordinated key, inventory, and record replacement', async (t) => {
  const value = await launchFixture(t);
  await verifyFamilyServerInstall(value.instance, { platform: 'linux', nativeFilesystemGuards: false });
  const newKey = Buffer.alloc(32, 0x7a);
  await fs.writeFile(path.join(value.managedRoot, 'state', 'launch-integrity.hmac.key'), newKey);
  const replacement = structuredClone(value.inventory);
  replacement.launchAssets.mainClass = 'attacker.ReplacedMain';
  const replacementDigest = digest('sha256', Buffer.from(canonicalJson(replacement)));
  await fs.writeFile(path.join(value.managedRoot, 'state', 'launch-inventories', `${replacementDigest}.json`), JSON.stringify({
    schemaVersion: 1,
    inventory: replacement,
    mac: crypto.createHmac('sha256', newKey).update(canonicalJson(replacement)).digest('hex'),
  }));
  value.instance.javaRuntime.launchInventoryDigest = replacementDigest;
  value.manifest.javaRuntime = structuredClone(value.instance.javaRuntime);
  await fs.writeFile(path.join(value.directory, 'instance.json'), JSON.stringify(value.manifest));
  await assert.rejects(() => verifyFamilyServerInstall(value.instance, {
    platform: 'linux', nativeFilesystemGuards: false,
  }), (error) => error.code === 'LAUNCH_INTEGRITY_UNAVAILABLE');
});

test('rejects extra nested launch inventory fields and private runtime drift', async (t) => {
  const nested = await launchFixture(t);
  const inventoryFile = path.join(nested.managedRoot, 'state', 'launch-inventories', `${nested.inventoryDigest}.json`);
  const wrapper = JSON.parse(await fs.readFile(inventoryFile, 'utf8'));
  wrapper.inventory.exactMutableTrees.unexpected = 'executable-namespace';
  await fs.writeFile(inventoryFile, JSON.stringify(wrapper));
  await assert.rejects(() => verifyFamilyServerInstall(nested.instance, {
    platform: 'linux', nativeFilesystemGuards: false,
  }), /unexpected schema field/i);

  const runtime = await launchFixture(t);
  runtime.manifest.javaRuntime.untrustedField = 'drift';
  await fs.writeFile(path.join(runtime.directory, 'instance.json'), JSON.stringify(runtime.manifest));
  await assert.rejects(() => verifyFamilyServerInstall(runtime.instance, {
    platform: 'linux', nativeFilesystemGuards: false,
  }), /private instance manifest does not match/i);
});

test('binds Fabric metadata and the frozen outer server digest into launch-asset identity', async (t) => {
  for (const [field, replacementHash] of [
    ['fabricMetadataSha256', '9'.repeat(64)],
    ['outerServerSha256', '8'.repeat(64)],
  ]) {
    await t.test(field, async (subtest) => {
      const value = await launchFixture(subtest);
      const inventory = structuredClone(value.inventory);
      inventory.launchAssets[field] = replacementHash;
      const encoded = canonicalJson(inventory);
      const inventoryDigest = digest('sha256', Buffer.from(encoded));
      const key = await fs.readFile(path.join(value.managedRoot, 'state', 'launch-integrity.hmac.key'));
      await fs.writeFile(path.join(value.managedRoot, 'state', 'launch-inventories', `${inventoryDigest}.json`), JSON.stringify({
        schemaVersion: 1, inventory, mac: crypto.createHmac('sha256', key).update(encoded).digest('hex'),
      }));
      value.instance.javaRuntime.launchInventoryDigest = inventoryDigest;
      value.manifest.javaRuntime = structuredClone(value.instance.javaRuntime);
      await fs.writeFile(path.join(value.directory, 'instance.json'), JSON.stringify(value.manifest));
      await assert.rejects(() => verifyFamilyServerInstall(value.instance, {
        platform: 'linux', nativeFilesystemGuards: false,
      }), /launch asset (?:identity|inventory) is invalid/i);
    });
  }
});

test('Linux launch fails closed without the in-process FamilyModManager binding', async (t) => {
  const value = await launchFixture(t);
  await assert.rejects(() => verifyFamilyServerInstall(value.instance, {
    requireLaunchCapability: true,
    platform: 'linux', nativeFilesystemGuards: false,
    allowUnconstrainedModDiscoveryForTests: true,
  }), (error) => error.code === 'LAUNCH_TRUST_UNAVAILABLE');
});

test('rejects manifest Class-Path traversal before returning a launch capability', async (t) => {
  const value = await launchFixture(t, { fabricClassPath: '../../outside.jar' });
  await assert.rejects(() => verifyFamilyServerInstall(value.instance, {
    requireLaunchCapability: true,
    platform: 'linux',
    nativeFilesystemGuards: false,
    allowUnconstrainedModDiscoveryForTests: true,
    modLaunchBinding: value.modLaunchBinding,
  }), /traversing manifest Class-Path/i);
});

test('launch lease detects deterministic pre-spawn classpath substitution', async (t) => {
  const value = await launchFixture(t);
  const capability = await verifyFamilyServerInstall(value.instance, {
    requireLaunchCapability: true,
    platform: 'linux',
    nativeFilesystemGuards: false,
    allowUnconstrainedModDiscoveryForTests: true,
    modLaunchBinding: value.modLaunchBinding,
  });
  t.after(() => capability.lease.release());
  const classpathIndex = capability.command.args.indexOf('-cp');
  const loaderJar = capability.command.args[classpathIndex + 1].split(path.delimiter)[0];
  const original = await fs.readFile(loaderJar);
  await fs.writeFile(loaderJar, Buffer.alloc(original.length, 0x58));
  await assert.rejects(() => capability.lease.assertHeld(), /leased launch input changed before spawn/);
  await capability.lease.release();
});

test('authenticates and seals managed user mods into the effective launch inventory', async (t) => {
  const value = await launchFixture(t, { managedUserMod: true });
  const capability = await verifyFamilyServerInstall(value.instance, {
    requireLaunchCapability: true,
    platform: 'linux',
    nativeFilesystemGuards: false,
    allowUnconstrainedModDiscoveryForTests: true,
    modLaunchBinding: value.modLaunchBinding,
  });
  t.after(() => capability.lease.release());
  assert.equal(capability.modSnapshot.count, 4);
  assert.match(capability.effectiveLaunchInventoryDigest, /^[a-f0-9]{64}$/);
  const managed = value.modLaunchBinding.binding.mods[0];
  await fs.writeFile(path.join(value.directory, 'mods', managed.fileName), testJar('unexpected.jar'));
  const forgedRoot = path.join(value.managedRoot, 'state', 'family-mods');
  await fs.mkdir(path.join(forgedRoot, 'manifests'), { recursive: true });
  await fs.writeFile(path.join(forgedRoot, 'hmac.key'), Buffer.alloc(32, 0x55));
  await fs.writeFile(path.join(forgedRoot, 'manifests', `${value.instance.id}.json`), JSON.stringify({ forged: true }));
  await capability.lease.assertHeld();
  await capability.lease.release();
});

test('does not reopen the mutable mod source after the launch snapshot is sealed', async (t) => {
  const value = await launchFixture(t, { managedUserMod: true });
  const source = value.modLaunchBinding;
  let assertions = 0;
  const binding = {
    binding: source.binding,
    async assertHeld() {
      assertions += 1;
      if (assertions > 2) throw Object.assign(new Error('Native source reopen would self-lock.'), { code: 'WORLD_INTEGRITY_FAILED' });
      return source.assertHeld();
    },
    release: () => source.release(),
  };
  const capability = await verifyFamilyServerInstall(value.instance, {
    requireLaunchCapability: true,
    platform: 'linux',
    nativeFilesystemGuards: false,
    allowUnconstrainedModDiscoveryForTests: true,
    modLaunchBinding: binding,
  });
  t.after(() => capability.lease.release());
  assert.equal(assertions, 2);
  await capability.lease.assertHeld();
  assert.equal(assertions, 2);
});

test('fails Windows launch closed while Fabric modsFolder remains same-user creatable', async (t) => {
  const value = await launchFixture(t);
  await assert.rejects(() => verifyFamilyServerInstall(value.instance, {
    requireLaunchCapability: true,
    platform: 'win32',
    nativeFilesystemGuards: false,
    modLaunchBinding: value.modLaunchBinding,
  }), (error) => {
    assert.equal(error.code, 'LAUNCH_TRUST_UNAVAILABLE');
    assert.equal(error.launchVerificationStage, 'windows-policy');
    assert.match(error.message, /same-user child creation.*fail-closed/i);
    return true;
  });
});

test('permits the explicit authenticated local-home Windows mod-discovery policy', async (t) => {
  const value = await launchFixture(t);
  const capability = await verifyFamilyServerInstall(value.instance, {
    requireLaunchCapability: true,
    platform: 'win32',
    nativeFilesystemGuards: false,
    windowsModDiscoveryPolicy: 'authenticated-local-home',
    modLaunchBinding: value.modLaunchBinding,
  });
  t.after(() => capability.lease.release());
  assert.equal(capability.command.cwd, value.directory);
  assert.ok(capability.command.args.some((entry) => entry.startsWith('-Dfabric.modsFolder=')));
});
