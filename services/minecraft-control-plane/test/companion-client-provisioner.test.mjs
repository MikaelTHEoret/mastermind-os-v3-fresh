import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FamilyClientProvisioner, __test } from '../src/companion/client-provisioner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const productionLock = path.join(repoRoot, 'minecraft', 'family-client-lock.v1.json');
const fixtureRoot = path.join(here, 'fixtures', 'family-client');

function digest(bytes, algorithm) {
  return crypto.createHash(algorithm).update(bytes).digest('hex');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const payload = Buffer.from(entry.data ?? '');
    const checksum = crc32(payload);
    const flags = 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = entry.symlink ? 0o120777 : (entry.name.endsWith('/') ? 0o040755 : 0o100644);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, payload);
    centralParts.push(central, name);
    offset += local.length + name.length + payload.length;
  }
  const centralBytes = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBytes, end]);
}

async function jsonFixture(name) {
  return JSON.parse(await fs.readFile(path.join(fixtureRoot, name), 'utf8'));
}

function sha1Descriptor(url, relativePath, bytes) {
  return { path: relativePath, url, size: bytes.length, sha1: digest(bytes, 'sha1') };
}

async function makeFixture(t, options = {}) {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-family-client-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const localRoot = path.join(managedRoot, 'trusted-build-inputs');
  const lock = JSON.parse(await fs.readFile(productionLock, 'utf8'));
  const responses = new Map();
  const responseHeaders = new Map();
  const calls = [];
  const put = (url, bytes) => responses.set(url, Buffer.from(bytes));

  const clientBytes = Buffer.from('verified-fixture-client');
  const loggingBytes = Buffer.from('<Configuration/>');
  const libraryBytes = Buffer.from('verified-library');
  const nativeBytes = zip(options.nativeEntries ?? [
    { name: 'good.dll', data: 'safe-native' },
    { name: 'META-INF/MANIFEST.MF', data: 'ignored' },
  ]);
  const armBytes = Buffer.from('arm-native-must-not-be-selected');
  const x86Bytes = Buffer.from('x86-native-must-not-be-selected');
  const linuxBytes = Buffer.from('linux-library-must-not-be-selected');
  const assetBytes = Buffer.from('verified-asset');
  const assetHash = digest(assetBytes, 'sha1');
  const assetUrl = `https://resources.download.minecraft.net/${assetHash.slice(0, 2)}/${assetHash}`;
  const assetIndex = await jsonFixture('asset-index.json');
  assetIndex.objects['minecraft/test.asset'] = { hash: assetHash, size: assetBytes.length };
  const assetIndexBytes = Buffer.from(JSON.stringify(assetIndex));

  lock.minecraft.client = { url: 'https://piston-data.mojang.com/v1/objects/fixture/client.jar', size: clientBytes.length, sha1: digest(clientBytes, 'sha1') };
  lock.minecraft.assetIndex = { id: '32', url: 'https://piston-meta.mojang.com/v1/packages/fixture/32.json', size: assetIndexBytes.length, totalSize: assetBytes.length, sha1: digest(assetIndexBytes, 'sha1') };
  lock.minecraft.logging = { id: 'client-fixture.xml', url: 'https://piston-data.mojang.com/v1/objects/fixture/client.xml', size: loggingBytes.length, sha1: digest(loggingBytes, 'sha1') };

  const version = await jsonFixture('version.json');
  version.downloads.client = { ...lock.minecraft.client };
  version.assetIndex = { ...lock.minecraft.assetIndex };
  version.logging.client.file = { ...lock.minecraft.logging };
  const libraryUrls = {
    regular: 'https://libraries.minecraft.net/example/client-library/1/client-library-1.jar',
    native: 'https://libraries.minecraft.net/example/native/1/native-1-natives-windows.jar',
    arm: 'https://libraries.minecraft.net/example/native/1/native-1-natives-windows-arm64.jar',
    x86: 'https://libraries.minecraft.net/example/native/1/native-1-natives-windows-x86.jar',
    linux: 'https://libraries.minecraft.net/example/linux-only/1/linux-only-1.jar',
  };
  version.libraries[0].downloads.artifact = sha1Descriptor(libraryUrls.regular, 'example/client-library/1/client-library-1.jar', libraryBytes);
  version.libraries[1].downloads.artifact = sha1Descriptor(libraryUrls.native, 'example/native/1/native-1-natives-windows.jar', nativeBytes);
  version.libraries[2].downloads.artifact = sha1Descriptor(libraryUrls.arm, 'example/native/1/native-1-natives-windows-arm64.jar', armBytes);
  version.libraries[3].downloads.artifact = sha1Descriptor(libraryUrls.x86, 'example/native/1/native-1-natives-windows-x86.jar', x86Bytes);
  version.libraries[4].downloads.artifact = sha1Descriptor(libraryUrls.linux, 'example/linux-only/1/linux-only-1.jar', linuxBytes);
  const versionBytes = Buffer.from(JSON.stringify(version));
  const versionUrl = lock.minecraft.versionManifest.entry.url;
  const versionSha1 = digest(versionBytes, 'sha1');
  lock.minecraft.versionJson = { url: versionUrl, size: versionBytes.length, sha1: versionSha1 };
  lock.minecraft.versionManifest.entry.sha1 = versionSha1;

  const profile = await jsonFixture('fabric-profile.json');
  const fabricBytes = new Map();
  lock.fabric.libraries.forEach((library, index) => {
    const bytes = Buffer.from(`fabric-library-${index}`);
    library.size = bytes.length;
    library.sha256 = digest(bytes, 'sha256');
    fabricBytes.set(library.url, bytes);
    profile.libraries.push(library.coordinate === 'net.fabricmc:fabric-loader:0.19.3'
      ? { name: library.coordinate, url: 'https://maven.fabricmc.net/' }
      : { name: library.coordinate, url: 'https://maven.fabricmc.net/', size: library.size, sha256: library.sha256 });
  });
  const profileBytes = Buffer.from(JSON.stringify(profile));
  lock.fabric.profile.size = profileBytes.length;
  lock.fabric.profile.sha256 = digest(profileBytes, 'sha256');

  const remoteModBytes = Buffer.from('verified-fabric-api');
  lock.mods.remote[0].size = remoteModBytes.length;
  lock.mods.remote[0].sha256 = digest(remoteModBytes, 'sha256');
  const localBytes = new Map();
  for (const entry of lock.mods.local) {
    const bytes = Buffer.from(`verified-local-${entry.id}`);
    entry.size = bytes.length;
    entry.sha256 = digest(bytes, 'sha256');
    localBytes.set(entry.source, bytes);
  }
  const bootstrapBytes = Buffer.from('verified-bootstrap');
  lock.bootstrap.size = bootstrapBytes.length;
  lock.bootstrap.sha256 = digest(bootstrapBytes, 'sha256');
  localBytes.set(lock.bootstrap.source, bootstrapBytes);
  for (const [relative, bytes] of localBytes) {
    const target = path.join(localRoot, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }

  const manifest = {
    latest: { release: options.latestRelease ?? '26.2' },
    versions: [{ ...lock.minecraft.versionManifest.entry }],
  };
  put(lock.minecraft.versionManifest.url, Buffer.from(JSON.stringify(manifest)));
  put(versionUrl, versionBytes);
  put(lock.fabric.profile.url, profileBytes);
  put(lock.minecraft.assetIndex.url, assetIndexBytes);
  put(lock.minecraft.client.url, clientBytes);
  put(lock.minecraft.logging.url, loggingBytes);
  put(libraryUrls.regular, libraryBytes);
  put(libraryUrls.native, nativeBytes);
  put(libraryUrls.arm, armBytes);
  put(libraryUrls.x86, x86Bytes);
  put(libraryUrls.linux, linuxBytes);
  put(assetUrl, assetBytes);
  for (const [url, bytes] of fabricBytes) put(url, bytes);
  put(lock.mods.remote[0].url, remoteModBytes);

  const lockFile = path.join(managedRoot, 'family-client-lock.fixture.json');
  await fs.writeFile(lockFile, JSON.stringify(lock));
  const fetcher = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const bytes = responses.get(url);
    if (!bytes) return new Response('not found', { status: 404 });
    return new Response(bytes, { headers: { 'content-length': String(bytes.length), ...(responseHeaders.get(url) ?? {}) } });
  };
  const runtimeCalls = [];
  const runtimeBytes = Buffer.from('verified-java-25');
  const runtimeManager = {
    async ensure(major, component) {
      runtimeCalls.push({ major, component });
      const executable = path.join(managedRoot, 'runtimes', component, '25.0.1', 'windows-x64', 'bin', 'java.exe');
      await fs.mkdir(path.dirname(executable), { recursive: true });
      await fs.writeFile(executable, runtimeBytes);
      return {
        executable,
        component, major, version: '25.0.1', vendor: 'Mojang launcher runtime', managed: true,
        source: 'piston-meta.mojang.com', platform: 'windows-x64', manifestSha1: 'a'.repeat(40),
        executableSha1: digest(runtimeBytes, 'sha1'), executableSize: runtimeBytes.length,
        inventorySha256: 'b'.repeat(64), files: [{ relativePath: 'bin/java.exe' }], installedAt: '2026-08-13T00:00:00.000Z',
      };
    },
  };
  const create = (extra = {}) => new FamilyClientProvisioner(managedRoot, {
    fetcher, lockFile, localArtifactRoot: localRoot, runtimeManager,
    now: () => new Date('2026-08-13T00:00:00.000Z'), ...extra,
  });
  return { managedRoot, localRoot, lock, lockFile, responses, responseHeaders, calls, fetcher, runtimeCalls, create, bytes: { clientBytes, nativeBytes }, urls: { ...libraryUrls, assetUrl } };
}

test('default trust paths resolve to this repository Minecraft tree', () => {
  assert.equal(path.resolve(__test.lockFile), path.resolve(productionLock));
  assert.equal(path.resolve(__test.minecraftRoot), path.join(repoRoot, 'minecraft'));
});

test('resolves the exact latest 26.2 lock and selects only Windows x64 libraries', async (t) => {
  const fixture = await makeFixture(t);
  const provisioner = fixture.create();
  const resolved = await provisioner.resolve();
  const plan = provisioner.plan(resolved);
  assert.equal(plan.projectId, 'family-ai-client');
  assert.equal(plan.minecraftVersion, '26.2');
  assert.equal(plan.loader.version, '0.19.3');
  assert.deepEqual(plan.counts, { libraries: 9, nativeJars: 1, assets: 1, mods: 4 });
  assert.equal(plan.launchesClient, false);
  assert.equal(plan.containsAuthentication, false);
  assert.equal(resolved.artifacts.some((value) => value.url === fixture.urls.arm), false);
  assert.equal(resolved.artifacts.some((value) => value.url === fixture.urls.x86), false);
  assert.equal(resolved.artifacts.some((value) => value.url === fixture.urls.linux), false);
  assert.ok(fixture.calls.every(({ init }) => init.redirect === 'error'));
  assert.ok(fixture.calls.every(({ init }) => init.headers['Accept-Encoding'] === 'identity'));
});

test('uses decoded size and digest when a server reports compressed wire length', async (t) => {
  const fixture = await makeFixture(t);
  fixture.responseHeaders.set(fixture.lock.fabric.profile.url, { 'content-encoding': 'gzip', 'content-length': '17' });
  const resolved = await fixture.create().resolve();
  assert.equal(resolved.loaderVersion, '0.19.3');
});

test('provisions atomically under the fixed Family root without touching a 2b2t client', async (t) => {
  const fixture = await makeFixture(t);
  const twoB2t = path.join(fixture.managedRoot, 'clients', '2b2t-1.21.4', 'sentinel.txt');
  await fs.mkdir(path.dirname(twoB2t), { recursive: true });
  await fs.writeFile(twoB2t, 'untouched');
  const provisioner = fixture.create();
  const resolved = await provisioner.resolve();
  const status = await provisioner.provision(resolved);
  const clientRoot = path.join(fixture.managedRoot, 'clients', 'family-ai-client');
  assert.equal(status.state, 'installed');
  assert.equal(status.launchReady, false);
  assert.deepEqual(fixture.runtimeCalls, [{ major: 25, component: 'java-runtime-epsilon' }]);
  assert.deepEqual(await fs.readFile(path.join(clientRoot, 'versions', '26.2', '26.2.jar')), fixture.bytes.clientBytes);
  assert.equal(await fs.readFile(path.join(clientRoot, 'natives', 'good.dll'), 'utf8'), 'safe-native');
  await assert.rejects(() => fs.access(path.join(clientRoot, 'natives', 'META-INF')));
  await fs.access(path.join(clientRoot, 'mods', 'family-agent-bridge-0.1.0.jar'));
  await fs.access(path.join(clientRoot, 'bootstrap', 'family-client-bootstrap-0.1.0.jar'));
  assert.equal(await fs.readFile(twoB2t, 'utf8'), 'untouched');
  const privateManifest = JSON.parse(await fs.readFile(path.join(fixture.managedRoot, 'private', 'family-ai-client-install.json'), 'utf8'));
  assert.equal(privateManifest.clientDirectory, clientRoot);
  assert.equal(/access.?token|refresh.?token|bridge.?token/i.test(JSON.stringify(privateManifest)), false);
  const description = provisioner.internalProfileDescription(status);
  assert.equal(description.mainClass, 'com.mastermind.minecraft.familyclientbootstrap.FamilyClientBootstrap');
  assert.deepEqual(description.bootstrapClasspath, ['bootstrap/family-client-bootstrap-0.1.0.jar']);
  const launchProfile = await provisioner.internalLaunchProfile();
  assert.equal(launchProfile.javaExecutable.startsWith(path.join(fixture.managedRoot, 'runtimes')), true);
  assert.equal(launchProfile.classpath.some((value) => value.endsWith(path.join('bootstrap', 'family-client-bootstrap-0.1.0.jar'))), true);
  assert.equal(launchProfile.authentication, null);
  assert.equal(launchProfile.launchPrepared, true);
  assert.equal(launchProfile.mainClass, 'com.mastermind.minecraft.familyclientbootstrap.FamilyClientBootstrap');
  assert.equal(launchProfile.jvmArguments.includes('-DFabricMcEmu= net.minecraft.client.main.Main '), true);
  assert.equal(launchProfile.jvmArguments.some((value) => value.includes('accessToken')), false);
  assert.deepEqual(launchProfile.bootstrapArguments.slice(-2), ['--version-type', 'Mastermind']);
  assert.deepEqual(launchProfile.versionManifest, {
    clientId: 'family-ai-client', bridgeVersion: '0.1.0', minecraftVersion: '26.2',
    loaderVersion: '0.19.3', baritoneVersion: '1.18.0',
  });
  assert.equal(JSON.stringify(status).includes(fixture.managedRoot), false);
});

test('keeps runtime-extracted natives outside immutable verification and clears only their trusted subdirectories before launch', async (t) => {
  const fixture = await makeFixture(t);
  const provisioner = fixture.create();
  await provisioner.provision(await provisioner.resolve());
  const first = await provisioner.internalLaunchProfile();
  for (const directory of [first.runtimeNatives.jna, first.runtimeNatives.lwjgl, first.runtimeNatives.netty]) {
    await fs.writeFile(path.join(directory, 'first-run.dll'), 'runtime-generated');
  }
  assert.equal((await provisioner.verifyInstalled()).status.integrity, 'verified');
  const second = await provisioner.internalLaunchProfile();
  for (const directory of [second.runtimeNatives.jna, second.runtimeNatives.lwjgl, second.runtimeNatives.netty]) {
    assert.deepEqual(await fs.readdir(directory), []);
  }
  assert.equal((await provisioner.verifyInstalled()).status.integrity, 'verified');
});

test('accepts only Minecraft-shaped hashed runtime skin cache files outside the immutable manifest', async (t) => {
  const fixture = await makeFixture(t);
  const provisioner = fixture.create();
  await provisioner.provision(await provisioner.resolve());
  const clientRoot = path.join(fixture.managedRoot, 'clients', 'family-ai-client');
  const hash = '50' + '7b50422e89806f31cb18fd433294b3c8e52223';
  const skin = path.join(clientRoot, 'assets', 'skins', hash.slice(0, 2), hash);
  await fs.mkdir(path.dirname(skin), { recursive: true });
  await fs.writeFile(skin, 'runtime-skin-cache');
  assert.equal((await provisioner.verifyInstalled()).status.integrity, 'verified');

  await fs.writeFile(path.join(path.dirname(skin), 'not-a-content-hash.exe'), 'untrusted');
  await assert.rejects(() => provisioner.verifyInstalled(), /untrusted executable or asset files/);
});

test('refuses runtime cleanup through a substituted Family client symlink or junction root', async (t) => {
  const fixture = await makeFixture(t);
  const provisioner = fixture.create();
  await provisioner.provision(await provisioner.resolve());
  const clientRoot = path.join(fixture.managedRoot, 'clients', 'family-ai-client');
  const displacedRoot = path.join(fixture.managedRoot, 'displaced-family-ai-client');
  await fs.rename(clientRoot, displacedRoot);
  await fs.symlink(displacedRoot, clientRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const victim = path.join(displacedRoot, 'runtime-natives', 'jna', 'must-not-delete.dll');
  await fs.mkdir(path.dirname(victim), { recursive: true });
  await fs.writeFile(victim, 'operator-owned');

  await assert.rejects(() => provisioner.internalLaunchProfile(), /trusted non-link directory/);
  assert.equal(await fs.readFile(victim, 'utf8'), 'operator-owned');
});

test('rejects any Fabric launch argument drift even when profile bytes are re-pinned', async (t) => {
  const fixture = await makeFixture(t);
  const profile = JSON.parse(fixture.responses.get(fixture.lock.fabric.profile.url).toString('utf8'));
  profile.arguments.jvm = ['-Dattacker.argument=true'];
  const bytes = Buffer.from(JSON.stringify(profile));
  fixture.responses.set(fixture.lock.fabric.profile.url, bytes);
  fixture.lock.fabric.profile.size = bytes.length;
  fixture.lock.fabric.profile.sha256 = digest(bytes, 'sha256');
  await fs.writeFile(fixture.lockFile, JSON.stringify(fixture.lock));
  await assert.rejects(() => fixture.create().resolve(), /launch arguments drifted/);
});

test('status and the internal launch profile fail closed after executable tampering', async (t) => {
  const fixture = await makeFixture(t);
  const provisioner = fixture.create();
  const resolved = await provisioner.resolve();
  await provisioner.provision(resolved);
  const bootstrap = path.join(fixture.managedRoot, 'clients', 'family-ai-client', 'bootstrap', 'family-client-bootstrap-0.1.0.jar');
  const bytes = await fs.readFile(bootstrap);
  await fs.writeFile(bootstrap, Buffer.alloc(bytes.length, 0x5a));
  const status = await provisioner.status();
  assert.equal(status.state, 'invalid');
  assert.equal(status.integrity, 'failed');
  assert.equal(status.launchReady, false);
  await assert.rejects(() => provisioner.internalLaunchProfile(), /integrity verification/);
});

test('rehashes content-addressed cache entries and repairs a same-size replacement', async (t) => {
  const fixture = await makeFixture(t);
  const provisioner = fixture.create();
  const resolved = await provisioner.resolve();
  await provisioner.provision(resolved);
  const cacheFile = path.join(fixture.managedRoot, 'cache', 'family-ai-client', 'objects', `sha1-${fixture.lock.minecraft.client.sha1}`);
  await fs.writeFile(cacheFile, Buffer.alloc(fixture.bytes.clientBytes.length, 0x58));
  await fs.rm(path.join(fixture.managedRoot, 'clients', 'family-ai-client'), { recursive: true, force: true });
  await fs.rm(path.join(fixture.managedRoot, 'private', 'family-ai-client-install.json'), { force: true });
  fixture.calls.length = 0;
  await provisioner.provision(resolved);
  assert.deepEqual(await fs.readFile(cacheFile), fixture.bytes.clientBytes);
  assert.deepEqual(fixture.calls.map((value) => value.url), [fixture.lock.minecraft.client.url]);
});

test('uses an optional read-only seed only after hashing it', async (t) => {
  const fixture = await makeFixture(t);
  const seed = path.join(fixture.managedRoot, 'read-only-seed');
  const seedClient = path.join(seed, 'versions', '26.2', '26.2.jar');
  await fs.mkdir(path.dirname(seedClient), { recursive: true });
  await fs.writeFile(seedClient, fixture.bytes.clientBytes);
  const provisioner = fixture.create({ seedCacheRoots: [seed] });
  const resolved = await provisioner.resolve();
  fixture.calls.length = 0;
  fixture.responses.delete(fixture.lock.minecraft.client.url);
  await provisioner.provision(resolved);
  assert.equal(fixture.calls.some((value) => value.url === fixture.lock.minecraft.client.url), false);
  assert.deepEqual(await fs.readFile(seedClient), fixture.bytes.clientBytes);
});

test('rejects hostile URLs and stale latest-release metadata before provisioning', async (t) => {
  const badUrl = await makeFixture(t);
  badUrl.lock.mods.remote[0].url = 'https://evil.invalid/fabric-api.jar';
  await fs.writeFile(badUrl.lockFile, JSON.stringify(badUrl.lock));
  await assert.rejects(() => badUrl.create().resolve(), /unexpected download URL/);

  const stale = await makeFixture(t, { latestRelease: '26.3' });
  await assert.rejects(() => stale.create().resolve(), /no longer Mojang's latest release/);
});

test('rejects size, hash, and local-build integrity failures', async (t) => {
  const corrupt = await makeFixture(t);
  const original = corrupt.responses.get(corrupt.lock.minecraft.versionJson.url);
  corrupt.responses.set(corrupt.lock.minecraft.versionJson.url, Buffer.concat([original.subarray(0, -1), Buffer.from('X')]));
  await assert.rejects(() => corrupt.create().resolve(), /SHA1 verification/);

  const local = await makeFixture(t);
  const provisioner = local.create();
  const resolved = await provisioner.resolve();
  const source = path.join(local.localRoot, ...local.lock.mods.local[0].source.split('/'));
  const existing = await fs.readFile(source);
  await fs.writeFile(source, Buffer.alloc(existing.length, 0x59));
  await assert.rejects(() => provisioner.provision(resolved), /Could not prepare verified client artifact mod/);
  assert.equal(await fs.stat(path.join(local.managedRoot, 'clients', 'family-ai-client')).then(() => true, () => false), false);
});

test('native extraction rejects traversal, absolute paths, drives, symlinks, and duplicates', () => {
  for (const entries of [
    [{ name: '../escape.dll', data: 'x' }],
    [{ name: '/absolute.dll', data: 'x' }],
    [{ name: 'C:/drive.dll', data: 'x' }],
    [{ name: 'link.dll', data: 'target', symlink: true }],
    [{ name: 'Same.dll', data: 'x' }, { name: 'same.dll', data: 'y' }],
  ]) assert.throws(() => __test.zipEntries(zip(entries)), /unsafe path|symbolic link|duplicate paths/);
});

test('native extraction omits META-INF and rolls back a hostile provisioning transaction', async (t) => {
  const archiveRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-native-test-'));
  t.after(() => fs.rm(archiveRoot, { recursive: true, force: true }));
  const archive = path.join(archiveRoot, 'native.jar');
  const output = path.join(archiveRoot, 'out');
  await fs.writeFile(archive, zip([{ name: 'META-INF/MANIFEST.MF', data: 'ignored' }, { name: 'safe.dll', data: 'ok' }]));
  assert.equal(await __test.extractNativeJar(archive, output), 1);
  assert.equal(await fs.readFile(path.join(output, 'safe.dll'), 'utf8'), 'ok');
  await assert.rejects(() => fs.access(path.join(output, 'META-INF')));

  const hostile = await makeFixture(t, { nativeEntries: [{ name: '../outside.dll', data: 'owned' }] });
  const provisioner = hostile.create();
  const resolved = await provisioner.resolve();
  await assert.rejects(() => provisioner.provision(resolved), /unsafe path/);
  assert.equal(await fs.stat(path.join(hostile.managedRoot, 'clients', 'family-ai-client')).then(() => true, () => false), false);
  assert.equal(await fs.stat(path.join(hostile.managedRoot, 'clients', 'outside.dll')).then(() => true, () => false), false);
  assert.deepEqual((await fs.readdir(path.join(hostile.managedRoot, 'clients'))).filter((name) => name.startsWith('.family-ai-client-staging-')), []);
});

test('refuses to overwrite orphaned private state', async (t) => {
  const fixture = await makeFixture(t);
  const provisioner = fixture.create();
  const resolved = await provisioner.resolve();
  const privateFile = path.join(fixture.managedRoot, 'private', 'family-ai-client-install.json');
  await fs.mkdir(path.dirname(privateFile), { recursive: true });
  await fs.writeFile(privateFile, 'operator-owned-state');
  const staleStatus = await provisioner.status();
  assert.equal(staleStatus.state, 'invalid');
  assert.equal(staleStatus.integrity, 'failed');
  await assert.rejects(() => provisioner.provision(resolved), /operator repair is required/);
  assert.equal(await fs.stat(path.join(fixture.managedRoot, 'clients', 'family-ai-client')).then(() => true, () => false), false);
});
