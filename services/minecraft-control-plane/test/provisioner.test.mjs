import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InstanceStore } from '../src/store.mjs';
import { ServerProvisioner, resolveLatestCompatibleFamilyRelease } from '../src/provisioner.mjs';
import { FamilyServerUpdateManager } from '../src/update-manager.mjs';
import { minecraftServerJar } from './server-jar-fixture.mjs';

function modrinthVersion(name, bytes, versionNumber) {
  return [{
    id: `${name}-version`,
    version_number: versionNumber,
    version_type: name === 'geyser' ? 'beta' : 'release',
    files: [{
      primary: true,
      filename: `${name}.jar`,
      url: `https://cdn.modrinth.com/data/test/versions/${name}.jar`,
      size: bytes.length,
      hashes: { sha512: crypto.createHash('sha512').update(bytes).digest('hex') },
    }],
  }];
}

function maliciousModrinthVersion(name, bytes, versionNumber, overrides = {}) {
  const [version] = modrinthVersion(name, bytes, versionNumber);
  return [{ ...version, files: [{ ...version.files[0], ...overrides }] }];
}

function fakeRuntime(dataRoot, major = 25, component = 'java-runtime-epsilon') {
  const javaBytes = Buffer.from('fake-java-runtime');
  return {
    executable: path.join(dataRoot, 'runtimes', component, 'bin', 'java.exe'),
    component,
    major,
    version: '25.0.1',
    vendor: 'Mojang launcher runtime',
    managed: true,
    source: 'piston-meta.mojang.com',
    platform: 'windows-x64',
    manifestSha1: 'a'.repeat(40),
    executableRelativePath: 'bin/java.exe',
    executableSha1: crypto.createHash('sha1').update(javaBytes).digest('hex'),
    executableSize: javaBytes.length,
    sourceInventorySha256: 'b'.repeat(64),
    inventorySha256: 'c'.repeat(64),
    files: [{
      relativePath: 'bin/java.exe', type: 'file',
      sha1: crypto.createHash('sha1').update(javaBytes).digest('hex'),
      sha256: crypto.createHash('sha256').update(javaBytes).digest('hex'),
      size: javaBytes.length,
    }],
    directories: ['bin'],
    installedAt: '2026-08-12T00:00:00.000Z',
  };
}

function familyFetcher(options = {}) {
  const bytes = {
    fabricApi: Buffer.from('fabric-api-fixture'),
    geyser: Buffer.from('geyser-fixture'),
    floodgate: Buffer.from('floodgate-fixture'),
    server: Buffer.from('fabric-server-fixture'),
    fabricLoader: Buffer.from('fabric-loader-library-fixture'),
    officialServer: options.officialServer ?? minecraftServerJar({ worldDataVersion: options.worldDataVersion ?? 4903 }),
  };
  const calls = [];
  const fetcher = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('version_manifest_v2.json')) {
      const versions = options.versions ?? [{ id: '26.2', type: 'release' }];
      return Response.json({
        latest: { release: options.latest ?? '26.2' },
        versions: versions.map((entry) => ({
          ...entry,
          url: entry.url ?? `https://piston-meta.mojang.com/v1/packages/${entry.id}.json`,
        })),
      });
    }
    if (url.startsWith('https://piston-meta.mojang.com/v1/packages/') && url.endsWith('.json')) {
      const id = path.basename(new URL(url).pathname, '.json');
      return Response.json({
        id,
        downloads: {
          server: {
            url: `https://piston-data.mojang.com/v1/objects/${crypto.createHash('sha1').update(bytes.officialServer).digest('hex')}/server.jar`,
            sha1: crypto.createHash('sha1').update(bytes.officialServer).digest('hex'),
            size: bytes.officialServer.length,
          },
        },
        javaVersion: {
          component: options.javaRuntimeComponent ?? 'java-runtime-epsilon',
          majorVersion: options.requiredJavaMajor ?? 25,
        },
      });
    }
    if (url.endsWith('/server/json')) {
      const match = /\/versions\/loader\/([^/]+)\/([^/]+)\/server\/json$/u.exec(new URL(url).pathname);
      const minecraftVersion = decodeURIComponent(match[1]);
      const loaderVersion = decodeURIComponent(match[2]);
      return Response.json(options.fabricLaunchOverride ?? {
        id: `fabric-loader-${loaderVersion}-${minecraftVersion}`,
        inheritsFrom: minecraftVersion,
        mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotServer',
        libraries: [{
          name: 'net.fabricmc:fabric-loader:0.19.3',
          url: 'https://maven.fabricmc.net/',
          sha256: crypto.createHash('sha256').update(bytes.fabricLoader).digest('hex'),
          size: bytes.fabricLoader.length,
        }],
      });
    }
    if (url.includes('/versions/loader/') && !url.endsWith('/server/jar')) {
      return Response.json([{ loader: { version: '0.19.3', stable: true } }]);
    }
    if (url.endsWith('/versions/installer')) return Response.json([{ version: '1.1.2', stable: true }]);
    if (options.unsupportedLatest && url.includes('game_versions=%5B%2226.3%22%5D')) return Response.json([]);
    if (url.includes('/project/P7dR8mSH/version')) return Response.json(modrinthVersion('fabricApi', bytes.fabricApi, '0.157.0+26.2'));
    if (url.includes('/project/wKkoqHrH/version')) return Response.json(modrinthVersion('geyser', bytes.geyser, '2.11.1-b1219'));
    if (url.includes('/project/bWrNNfkb/version')) return Response.json(modrinthVersion('floodgate', bytes.floodgate, '2.2.6-b67'));
    if (url === 'https://cdn.modrinth.com/data/test/versions/fabricApi.jar') return new Response(bytes.fabricApi);
    if (url === 'https://cdn.modrinth.com/data/test/versions/geyser.jar') return new Response(bytes.geyser);
    if (url === 'https://cdn.modrinth.com/data/test/versions/floodgate.jar') return new Response(bytes.floodgate);
    if (url.endsWith('/server/jar')) return new Response(bytes.server);
    if (url === 'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.3/fabric-loader-0.19.3.jar') {
      return new Response(bytes.fabricLoader);
    }
    if (url.startsWith('https://piston-data.mojang.com/v1/objects/')) return new Response(bytes.officialServer);
    return new Response('not found', { status: 404 });
  };
  return { bytes, calls, fetcher };
}

function provisionerOptions(runtimeManager, extra = {}) {
  return { runtimeManager, integrityKeyOptions: { platform: 'linux' }, ...extra };
}

async function writeEmptyFiles(directory, prefix, count) {
  for (let offset = 0; offset < count; offset += 64) {
    await Promise.all(Array.from({ length: Math.min(64, count - offset) }, (_, index) => (
      fs.writeFile(path.join(directory, `${prefix}-${String(offset + index).padStart(4, '0')}.jar`), '')
    )));
  }
}

test('provisions a verified latest-compatible family stack with Geyser and Floodgate', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-provision-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new InstanceStore(dataRoot);
  await store.initialize();
  const { bytes, calls, fetcher } = familyFetcher();
  const runtimeCalls = [];
  const runtimeManager = {
    async ensure(major, component) {
      runtimeCalls.push({ major, component });
      return fakeRuntime(dataRoot, major, component);
    },
  };

  const provisioner = new ServerProvisioner(dataRoot, store, fetcher, provisionerOptions(runtimeManager));
  const catalog = await provisioner.catalog();
  assert.equal(catalog.updateChannel, 'latest-compatible');
  assert.equal(catalog.requiredJavaMajor, 25);
  assert.equal(catalog.javaRuntimeComponent, 'java-runtime-epsilon');
  assert.equal(catalog.components.geyser.versionType, 'beta');
  assert.equal(catalog.components.fabricApi.versionType, 'release');
  const instance = await provisioner.provision({
    kind: 'family-server', projectId: 'family-server', instanceId: 'family-server', displayName: 'Family Server', memoryMb: 4096, eulaAccepted: true,
  });
  const root = path.join(dataRoot, 'servers', 'family-server');
  assert.equal(instance.status, 'stopped');
  assert.equal(instance.projectId, 'family-server');
  assert.equal(instance.javaPort, 25565);
  assert.equal(instance.bedrockPort, 19132);
  assert.equal(instance.minecraftVersion, '26.2');
  assert.equal(instance.worldDataVersion, 4903);
  assert.equal(instance.minecraftServerArtifact.minecraftVersion, '26.2');
  assert.equal(instance.minecraftServerArtifact.sha1, crypto.createHash('sha1').update(bytes.officialServer).digest('hex'));
  assert.equal(instance.updateChannel, 'latest-compatible');
  assert.equal(instance.requiredJavaMajor, 25);
  assert.equal(instance.javaRuntimeComponent, 'java-runtime-epsilon');
  assert.equal(instance.javaRuntime.version, '25.0.1');
  assert.match(instance.javaRuntime.launchInventoryDigest, /^[a-f0-9]{64}$/);
  assert.match(instance.javaRuntime.launchAssetDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(instance.javaRuntime, 'executable'), false);
  assert.equal(Object.hasOwn(instance.javaRuntime, 'executableRelativePath'), false);
  assert.deepEqual(runtimeCalls, [{ major: 25, component: 'java-runtime-epsilon' }]);
  assert.equal(await fs.readFile(path.join(root, 'eula.txt'), 'utf8'), 'eula=true\n');
  assert.match(await fs.readFile(path.join(root, 'server.properties'), 'utf8'), /server-port=25565/);
  const geyserConfig = await fs.readFile(path.join(root, 'config', 'Geyser-Fabric', 'config.yml'), 'utf8');
  assert.match(geyserConfig, /address: 0\.0\.0\.0/);
  assert.match(geyserConfig, /port: 19132/);
  assert.match(geyserConfig, /auth-type: floodgate/);
  assert.deepEqual(await fs.readFile(path.join(root, 'mods', 'fabric-api.jar')), bytes.fabricApi);
  assert.deepEqual(await fs.readFile(path.join(root, 'mods', 'geyser-fabric.jar')), bytes.geyser);
  assert.deepEqual(await fs.readFile(path.join(root, 'mods', 'floodgate-fabric.jar')), bytes.floodgate);
  assert.deepEqual(await fs.readFile(path.join(root, 'versions', '26.2', 'server-26.2.jar')), bytes.officialServer);
  const launchWrapper = JSON.parse(await fs.readFile(path.join(
    dataRoot, 'state', 'launch-inventories', `${instance.javaRuntime.launchInventoryDigest}.json`,
  ), 'utf8'));
  assert.equal(launchWrapper.inventory.instanceId, instance.id);
  assert.equal(launchWrapper.inventory.stack.minecraftVersion, instance.minecraftVersion);
  assert.equal(launchWrapper.inventory.stack.loaderVersion, instance.loaderVersion);
  assert.equal(launchWrapper.inventory.stack.launchAssetDigest, instance.javaRuntime.launchAssetDigest);
  assert.notEqual(path.resolve(root, 'versions', '26.2', 'server-26.2.jar'), path.resolve(
    dataRoot, ...launchWrapper.inventory.launchAssets.relativeRoot.split('/'),
    ...launchWrapper.inventory.launchAssets.gameJar.split('/'),
  ));
  const privateManifest = JSON.parse(await fs.readFile(path.join(root, 'instance.json'), 'utf8'));
  assert.equal(privateManifest.javaExecutable, path.join(dataRoot, 'runtimes', 'java-runtime-epsilon', 'bin', 'java.exe'));
  assert.equal(privateManifest.components.geyser.versionType, 'beta');
  assert.equal(privateManifest.components.fabricApi.versionType, 'release');
  assert.equal(privateManifest.worldDataVersion, 4903);
  assert.deepEqual(privateManifest.minecraftServerArtifact, instance.minecraftServerArtifact);
  assert.equal((await provisioner.updateStatus(instance)).state, 'current');
  const legacyStatusRecord = structuredClone(instance);
  delete legacyStatusRecord.worldDataVersion;
  delete legacyStatusRecord.minecraftServerArtifact;
  assert.equal((await provisioner.updateStatus(legacyStatusRecord)).state, 'component-update-available');
  assert.ok(calls.every(({ init }) => String(init.headers['User-Agent']).startsWith('Mastermind-Minecraft-Control/')));
});

test('falls back only when the newest stable release has no complete cross-play stack', async () => {
  const { fetcher } = familyFetcher({
    latest: '26.3',
    versions: [{ id: '26.3', type: 'release' }, { id: '26.2', type: 'release' }],
    unsupportedLatest: true,
  });
  const resolved = await resolveLatestCompatibleFamilyRelease(fetcher);
  assert.equal(resolved.latestMinecraftVersion, '26.3');
  assert.equal(resolved.minecraftVersion, '26.2');
  assert.equal(resolved.isLatestRelease, false);
  assert.equal(resolved.updateChannel, 'latest-compatible');
  assert.equal(resolved.requiredJavaMajor, 25);
  assert.equal(resolved.javaRuntimeComponent, 'java-runtime-epsilon');
  assert.equal(resolved.components.geyser.versionType, 'beta');
});

test('does not silently downgrade after an upstream failure', async () => {
  const { fetcher: baseFetcher } = familyFetcher({
    latest: '26.3',
    versions: [{ id: '26.3', type: 'release' }, { id: '26.2', type: 'release' }],
  });
  const fetcher = async (input, init) => {
    if (String(input).includes('/project/wKkoqHrH/version') && String(input).includes('26.3')) {
      return new Response('upstream failure', { status: 503 });
    }
    return baseFetcher(input, init);
  };
  await assert.rejects(() => resolveLatestCompatibleFamilyRelease(fetcher), /Download request failed \(503\)/);
});

test('never selects alpha or otherwise unapproved Modrinth release channels', async () => {
  const { fetcher: baseFetcher, bytes } = familyFetcher();
  const fetcher = async (input, init) => {
    const url = String(input);
    if (url.includes('/project/P7dR8mSH/version')) {
      return Response.json(modrinthVersion('fabricApi', bytes.fabricApi, 'alpha-api').map((value) => ({ ...value, version_type: 'alpha' })));
    }
    if (url.includes('/project/wKkoqHrH/version')) {
      return Response.json(modrinthVersion('geyser', bytes.geyser, 'alpha-geyser').map((value) => ({ ...value, version_type: 'alpha' })));
    }
    if (url.includes('/project/bWrNNfkb/version')) {
      return Response.json(modrinthVersion('floodgate', bytes.floodgate, 'alpha-floodgate').map((value) => ({ ...value, version_type: 'alpha' })));
    }
    return baseFetcher(input, init);
  };
  await assert.rejects(
    () => resolveLatestCompatibleFamilyRelease(fetcher),
    /No complete Fabric\/Geyser\/Floodgate stack/,
  );
});

test('requires Mojang hash-and-size metadata for the official server artifact', async () => {
  const { fetcher: baseFetcher } = familyFetcher();
  const fetcher = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://piston-meta.mojang.com/v1/packages/') && url.endsWith('.json')) {
      return Response.json({ id: '26.2', javaVersion: { component: 'java-runtime-epsilon', majorVersion: 25 } });
    }
    return baseFetcher(input, init);
  };
  await assert.rejects(() => resolveLatestCompatibleFamilyRelease(fetcher), /trusted server artifact metadata/);
});

test('rejects unsafe or noncanonical Fabric launch library metadata', async () => {
  for (const library of [
    { name: 'net.fabricmc:../escape:1.0', url: 'https://maven.fabricmc.net/' },
    { name: 'net.fabricmc:fabric-loader:0.19.3', url: 'https://maven.fabricmc.net/untrusted-prefix/' },
  ]) {
    const { fetcher } = familyFetcher({
      fabricLaunchOverride: {
        id: 'fabric-loader-0.19.3-26.2', inheritsFrom: '26.2',
        mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotServer', libraries: [library],
      },
    });
    await assert.rejects(() => resolveLatestCompatibleFamilyRelease(fetcher), /Maven coordinate|base URL is not canonical/);
  }
});

test('fails provisioning when a Fabric classpath library does not match pinned launch metadata', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-provision-fabric-hash-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new InstanceStore(dataRoot); await store.initialize();
  const { fetcher, bytes } = familyFetcher({
    fabricLaunchOverride: {
      id: 'fabric-loader-0.19.3-26.2', inheritsFrom: '26.2',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotServer',
      libraries: [{ name: 'net.fabricmc:fabric-loader:0.19.3', url: 'https://maven.fabricmc.net/',
        sha256: '0'.repeat(64), size: Buffer.from('fabric-loader-library-fixture').length }],
    },
  });
  assert.ok(bytes.fabricLoader.length > 0);
  const provisioner = new ServerProvisioner(dataRoot, store, fetcher, provisionerOptions(
    { async ensure(major, component) { return fakeRuntime(dataRoot, major, component); } },
  ));
  await assert.rejects(() => provisioner.provision({
    kind: 'family-server', projectId: 'family-server', instanceId: 'family-server', displayName: 'Family Server',
    memoryMb: 4096, eulaAccepted: true,
  }), /Integrity check failed.*fabric-loader/i);
});

for (const [label, officialServer] of [
  ['mismatched embedded release', minecraftServerJar({ minecraftVersion: '26.3', worldDataVersion: 5000 })],
  ['duplicate version metadata', minecraftServerJar({ entries: [
    { name: 'version.json', bytes: Buffer.from('{"id":"26.2","world_version":4903}') },
    { name: 'version.json', bytes: Buffer.from('{"id":"26.2","world_version":4903}') },
  ] })],
  ['duplicate world-version JSON key', minecraftServerJar({ entries: [{
    name: 'version.json', bytes: Buffer.from('{"id":"26.2","world_version":4903,"world_version":4904}') },
  ] })],
  ['non-JSON whitespace', minecraftServerJar({ entries: [{
    name: 'version.json', bytes: Buffer.from('{"id"\u00a0:"26.2","world_version":4903}') },
  ] })],
]) {
  test(`rejects an official server JAR with ${label}`, async (t) => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-provision-server-metadata-'));
    t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
    const store = new InstanceStore(dataRoot); await store.initialize();
    const { fetcher } = familyFetcher({ officialServer });
    const runtimeManager = { async ensure(major, component) {
      return fakeRuntime(dataRoot, major, component);
    } };
    const provisioner = new ServerProvisioner(dataRoot, store, fetcher, provisionerOptions(runtimeManager));
    await assert.rejects(() => provisioner.provision({
      kind: 'family-server', projectId: 'family-server', instanceId: 'family-server', displayName: 'Family Server', memoryMb: 4096, eulaAccepted: true,
    }), /Minecraft server (?:version metadata|JAR)/);
  });
}

test('rejects a Modrinth artifact URL outside the pinned CDN', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-provision-host-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new InstanceStore(dataRoot);
  await store.initialize();
  const { fetcher: baseFetcher, bytes } = familyFetcher();
  const fetcher = async (input, init) => {
    if (String(input).includes('/project/P7dR8mSH/version')) {
      return Response.json(maliciousModrinthVersion('fabricApi', bytes.fabricApi, 'bad', { url: 'https://evil.invalid/fabric-api.jar' }));
    }
    return baseFetcher(input, init);
  };
  const runtimeManager = { async ensure() { return { executable: path.join(dataRoot, 'java.exe'), component: 'java-runtime-epsilon', major: 25, managed: true }; } };
  const provisioner = new ServerProvisioner(dataRoot, store, fetcher, provisionerOptions(runtimeManager));
  await assert.rejects(() => provisioner.provision({ instanceId: 'bad-host', displayName: 'Bad Host', memoryMb: 1024 }), /is not allowed/);
  assert.equal(await fs.stat(path.join(dataRoot, 'servers')).then(() => true, () => false), true);
  assert.deepEqual((await fs.readdir(path.join(dataRoot, 'servers'))).filter((name) => !name.startsWith('.')), []);
});

test('rolls back the published directory when the state commit fails', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-provision-commit-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const realStore = new InstanceStore(dataRoot);
  await realStore.initialize();
  const store = { list: () => realStore.list(), async create() { throw new Error('injected state failure'); } };
  const { fetcher } = familyFetcher();
  const runtimeManager = {
    async ensure(major, component) {
      return fakeRuntime(dataRoot, major, component);
    },
  };
  const provisioner = new ServerProvisioner(dataRoot, store, fetcher, provisionerOptions(runtimeManager));
  await assert.rejects(() => provisioner.provision({ instanceId: 'commit-fails', displayName: 'Commit Fails', memoryMb: 1024 }), /injected state failure/);
  assert.equal(await fs.stat(path.join(dataRoot, 'servers', 'commit-fails')).then(() => true, () => false), false);
});

test('update preparation rejects a limit-plus-one inherited mod namespace before removing files', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-update-mod-cap-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new InstanceStore(dataRoot);
  await store.initialize();
  const { fetcher } = familyFetcher();
  const runtimeManager = { async ensure(major, component) { return fakeRuntime(dataRoot, major, component); } };
  const provisioner = new ServerProvisioner(dataRoot, store, fetcher, provisionerOptions(runtimeManager));
  const instance = {
    id: 'family-server', projectId: 'family-server', kind: 'server', minecraftVersion: '1.21.4',
  };
  const target = await provisioner.resolveUpdateTarget(instance);
  const candidateDirectory = path.join(
    dataRoot, 'servers', '.family-server-candidate-11111111-1111-4111-8111-111111111111',
  );
  const modsDirectory = path.join(candidateDirectory, 'mods');
  await fs.mkdir(modsDirectory, { recursive: true });
  const legacyFile = path.join(modsDirectory, 'fabric-api-legacy.jar');
  await fs.writeFile(legacyFile, 'must-remain');
  await writeEmptyFiles(modsDirectory, 'attacker', 500);
  await assert.rejects(() => provisioner.prepareUpdateCandidate({
    instance,
    target,
    candidateDirectory,
    transactionId: '22222222-2222-4222-8222-222222222222',
  }), /safe entry bound/i);
  assert.equal(await fs.readFile(legacyFile, 'utf8'), 'must-remain');
});

test('real provisioner migrates a legacy world to the resolved stack while retaining a full backup', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-real-update-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const store = new InstanceStore(managedRoot);
  await store.initialize();
  const instanceDirectory = path.join(managedRoot, 'servers', 'family-server');
  await fs.mkdir(path.join(instanceDirectory, 'world'), { recursive: true });
  await fs.mkdir(path.join(instanceDirectory, 'mods'), { recursive: true });
  await fs.writeFile(path.join(instanceDirectory, 'world', 'level.dat'), 'played-world');
  await fs.writeFile(path.join(instanceDirectory, 'server.properties'), 'level-name=world\nserver-port=25565\nonline-mode=true\n');
  await fs.writeFile(path.join(instanceDirectory, 'fabric-server-launch.jar'), 'old-server');
  await fs.writeFile(path.join(instanceDirectory, 'mods', 'fabric-api-legacy.jar'), 'old-fabric-api');
  await fs.writeFile(path.join(instanceDirectory, 'mods', 'custom-family-mod.jar'), 'custom-preserved');
  await fs.writeFile(path.join(instanceDirectory, 'instance.json'), JSON.stringify({
    artifacts: [{ fileName: 'fabric-api-legacy.jar' }],
  }));
  const now = new Date().toISOString();
  await store.create({
    id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server',
    minecraftVersion: '1.21.4', loader: 'fabric', loaderVersion: '0.16.10', memoryMb: 4096,
    javaPort: 25565, serverPort: 25565, bedrockPort: 19132, directory: instanceDirectory,
    provisioningStatus: 'legacy-update-required', updateState: 'minecraft-update-approval-required',
    status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  const { bytes, fetcher } = familyFetcher({
    versions: [
      { id: '26.2', type: 'release', releaseTime: '2026-08-01T00:00:00Z' },
      { id: '1.21.4', type: 'release', releaseTime: '2024-12-03T00:00:00Z' },
    ],
  });
  const runtimeManager = {
    async ensure(major, component) {
      return fakeRuntime(managedRoot, major, component);
    },
  };
  const provisioner = new ServerProvisioner(managedRoot, store, fetcher, provisionerOptions(runtimeManager));
  const updater = new FamilyServerUpdateManager(managedRoot, store, {
    resolveTarget: (instance) => provisioner.resolveUpdateTarget(instance),
    prepareCandidate: (input) => provisioner.prepareUpdateCandidate(input),
    isInstanceActive: async () => false,
    assertQuiescentWithinInstanceLock: async () => true,
    withInstanceLock: async (_id, operation) => operation(),
    assertStackUpdateAllowedWithinInstanceLock: async () => true,
    nativeFilesystemGuards: false,
    markerAuthenticationKey: Buffer.alloc(32, 0x42),
  });
  const plan = await updater.check({ instanceId: 'family-server' });
  assert.equal(plan.state, 'minecraft-update-approval-required');
  const result = await updater.update({
    instanceId: 'family-server',
    approval: { planId: plan.planId, minecraftVersionChange: true },
  });
  assert.equal(result.action, 'updated');
  assert.equal(result.instance.minecraftVersion, '26.2');
  assert.equal(result.instance.provisioningStatus, 'ready');
  assert.equal(result.readiness, 'pending-unverified');
  assert.equal(await fs.readFile(path.join(instanceDirectory, 'world', 'level.dat'), 'utf8'), 'played-world');
  assert.equal(await fs.readFile(path.join(instanceDirectory, 'mods', 'custom-family-mod.jar'), 'utf8'), 'custom-preserved');
  assert.deepEqual(await fs.readFile(path.join(instanceDirectory, 'mods', 'fabric-api.jar')), bytes.fabricApi);
  assert.equal(await fs.stat(path.join(instanceDirectory, 'mods', 'fabric-api-legacy.jar')).then(() => true, () => false), false);
  assert.match(await fs.readFile(path.join(instanceDirectory, 'config', 'Geyser-Fabric', 'config.yml'), 'utf8'), /port: 19132/);
  const backup = path.join(managedRoot, 'backups', 'family-server', result.transaction.transactionId, 'instance');
  assert.equal(await fs.readFile(path.join(backup, 'world', 'level.dat'), 'utf8'), 'played-world');
  assert.equal(await fs.readFile(path.join(backup, 'mods', 'fabric-api-legacy.jar'), 'utf8'), 'old-fabric-api');
});
