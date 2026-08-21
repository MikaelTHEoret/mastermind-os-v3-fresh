import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createManagedClientLaunchFactory, __test } from '../src/companion/managed-client-launch.mjs';

const privateSession = Object.freeze({
  username: 'FamilyAgent', uuid: '00112233445566778899aabbccddeeff',
  accessToken: 'private-minecraft-access-token-1234567890', xuid: '281474976710655',
  clientId: '01234567-89ab-4def-8123-456789abcdef',
});

function profile(root) {
  const assetsDirectory = path.join(root, 'assets');
  const nativesDirectory = path.join(root, 'natives');
  const loggingConfiguration = path.join(root, 'assets', 'log_configs', 'client.xml');
  const runtimeNatives = {
    root: path.join(root, 'runtime-natives'), jna: path.join(root, 'runtime-natives', 'jna'),
    lwjgl: path.join(root, 'runtime-natives', 'lwjgl'), netty: path.join(root, 'runtime-natives', 'netty'),
  };
  const launchArgumentsDirectory = path.join(root, 'runtime-launch');
  const verifiedMetadata = { versionJsonSha1: 'a'.repeat(40), fabricProfileSha256: 'b'.repeat(64), bootstrapSha256: 'c'.repeat(64) };
  return {
    projectId: 'family-ai-client', serverProjectId: 'family-server', kind: 'client', platform: 'windows-x64',
    minecraftVersion: '26.2', loaderVersion: '0.19.3', javaMajor: 25,
    javaExecutable: path.join(root, 'runtime', 'bin', 'javaw.exe'), clientDirectory: root,
    assetsDirectory, nativesDirectory, loggingConfiguration, runtimeNatives, launchArgumentsDirectory,
    assetIndexId: '32', versionId: 'fabric-loader-0.19.3-26.2',
    mainClass: 'com.mastermind.minecraft.familyclientbootstrap.FamilyClientBootstrap',
    classpath: [path.join(root, 'bootstrap', 'bootstrap.jar'), path.join(root, 'versions', '26.2.jar')],
    jvmArguments: [
      '-Xms512m', '-Xmx2048m', '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump',
      '--sun-misc-unsafe-memory-access=allow', '--enable-native-access=ALL-UNNAMED',
      `-Djava.library.path=${nativesDirectory}`, `-Djna.tmpdir=${runtimeNatives.jna}`,
      `-Dorg.lwjgl.system.SharedLibraryExtractPath=${runtimeNatives.lwjgl}`, `-Dio.netty.native.workdir=${runtimeNatives.netty}`,
      `-Dlog4j.configurationFile=${loggingConfiguration}`, '-Dminecraft.launcher.brand=Mastermind', '-Dminecraft.launcher.version=0.1.0',
      `-Dmastermind.family.versionJson.sha1=${verifiedMetadata.versionJsonSha1}`,
      `-Dmastermind.family.fabricProfile.sha256=${verifiedMetadata.fabricProfileSha256}`,
      `-Dmastermind.family.bootstrap.sha256=${verifiedMetadata.bootstrapSha256}`,
      '-DFabricMcEmu= net.minecraft.client.main.Main ',
    ],
    bootstrapArguments: [
      '--game-dir', root, '--assets-dir', assetsDirectory, '--asset-index', '32',
      '--version', 'fabric-loader-0.19.3-26.2', '--version-type', 'Mastermind',
    ],
    versionManifest: {
      clientId: 'family-ai-client', bridgeVersion: '0.1.0', minecraftVersion: '26.2',
      loaderVersion: '0.19.3', baritoneVersion: '1.18.0',
    },
    verifiedMetadata,
    launchPrepared: true,
  };
}

async function profileFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-managed-launch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const value = profile(root);
  await fs.mkdir(value.launchArgumentsDirectory, { recursive: true });
  return value;
}

function decodeFrame(frame) {
  assert.equal(frame.readUInt32BE(0), frame.length - 4);
  assert.equal(frame.subarray(4, 8).toString('ascii'), 'MFC1');
  let offset = 8;
  const fields = [];
  for (let index = 0; index < 5; index += 1) {
    const size = frame.readUInt16BE(offset);
    offset += 2;
    fields.push(frame.subarray(offset, offset + size).toString('utf8'));
    offset += size;
  }
  assert.equal(offset, frame.length);
  return fields;
}

test('composes only a verified fixed bootstrap command and keeps every account field in MFC1 stdin', async (t) => {
  const expected = await profileFixture(t);
  const factory = createManagedClientLaunchFactory({
    provisioner: { async internalLaunchProfile() { return expected; } },
    getAuth: () => ({ minecraftSession() { return privateSession; }, async silentRefresh() { throw new Error('must not refresh'); } }),
  });
  const launch = await factory.create();
  assert.equal(launch.familyServerInstanceId, 'family-server');
  assert.equal(launch.command.executable, expected.javaExecutable);
  assert.equal(launch.command.cwd, expected.clientDirectory);
  const expandedArguments = [
    ...expected.jvmArguments, '-cp', expected.classpath.join(path.delimiter), expected.mainClass, ...expected.bootstrapArguments,
  ];
  assert.equal(launch.command.args.length, 1);
  assert.match(launch.command.args[0], /^@.+family-client-[a-f0-9]{64}\.args$/u);
  assert.equal(launch.command.args[0].length < 8_192, true);
  assert.equal(await fs.readFile(launch.command.args[0].slice(1), 'utf8'), __test.javaArgumentFileText(expandedArguments));
  assert.deepEqual(launch.command.env, { MASTERMIND_FAMILY_CLIENT_PROFILE: 'family-ai-client' });
  assert.deepEqual(launch.manifest, expected.versionManifest);
  const exposed = JSON.stringify({ command: launch.command, manifest: launch.manifest });
  for (const [key, value] of Object.entries(privateSession)) {
    assert.equal(exposed.includes(value), false, `${key} was exposed outside the private frame`);
  }
  assert.deepEqual(decodeFrame(launch.credentialFrame), Object.values(privateSession));
  launch.credentialFrame.fill(0);
});

test('performs one silent refresh for an expired session and uses only the refreshed Minecraft token', async (t) => {
  const events = [];
  let refreshed = false;
  const auth = {
    minecraftSession() {
      events.push('session');
      if (!refreshed) throw Object.assign(new Error('refresh required'), { code: 'MINECRAFT_SESSION_REFRESH_REQUIRED' });
      return privateSession;
    },
    async silentRefresh() { events.push('refresh'); refreshed = true; },
  };
  const factory = createManagedClientLaunchFactory({
    provisioner: { async internalLaunchProfile() { events.push('verify'); return profileValue; } },
    getAuth: () => auth,
  });
  const profileValue = await profileFixture(t);
  const launch = await factory.create();
  assert.deepEqual(events, ['verify', 'session', 'refresh', 'session']);
  assert.deepEqual(decodeFrame(launch.credentialFrame), Object.values(privateSession));
  launch.credentialFrame.fill(0);
});

test('refuses a tampered install before requesting or refreshing account material', async () => {
  let authRead = false;
  const factory = createManagedClientLaunchFactory({
    provisioner: { async internalLaunchProfile() { throw new Error('Installed client artifact failed integrity verification'); } },
    getAuth() { authRead = true; return null; },
  });
  await assert.rejects(() => factory.create(), /integrity verification/);
  assert.equal(authRead, false);
});

test('rejects an unverified profile and never places a token in the resulting fixed error', async (t) => {
  const bad = { ...await profileFixture(t), launchPrepared: false };
  const factory = createManagedClientLaunchFactory({
    provisioner: { async internalLaunchProfile() { return bad; } },
    getAuth: () => ({ minecraftSession() { return privateSession; }, async silentRefresh() {} }),
  });
  await assert.rejects(() => factory.create(), (error) => (
    /profile was invalid/u.test(error.message) && !error.message.includes(privateSession.accessToken)
  ));
});
