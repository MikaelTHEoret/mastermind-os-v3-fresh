import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME,
  WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT,
  WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME,
  WINDOWS_AUTOSTART_TASK_FOLDER,
  WINDOWS_AUTOSTART_TASK_NAME,
} from '../lib/windows-autostart-enrollment.mjs';
import { installWindowsNodeHost } from '../lib/windows-node-host-installer.mjs';
import {
  WINDOWS_NODE_HOST_CONFIG_NAME,
  parseWindowsNodeHostConfig,
  sha256Bytes,
} from '../lib/windows-node-host-contract.mjs';

function guiExecutable() {
  const executable = Buffer.alloc(512, 0);
  executable.writeUInt16LE(0x5a4d, 0);
  executable.writeUInt32LE(128, 0x3c);
  executable.writeUInt32LE(0x00004550, 128);
  executable.writeUInt16LE(0x20b, 128 + 24);
  executable.writeUInt16LE(2, 128 + 24 + 68);
  return executable;
}

test('install builds once, reuses an attested launcher, and refuses a changed fixed launcher', async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-host-installer-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const workspaceInput = path.join(fixture, 'bundle');
  const localAppData = path.join(fixture, 'local-app-data');
  const runtimeSource = path.join(fixture, 'node.exe');
  await fs.mkdir(path.join(workspaceInput, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(workspaceInput, '.next'), { recursive: true });
  await fs.mkdir(localAppData, { recursive: true });
  const workspace = await fs.realpath(workspaceInput);
  await fs.writeFile(path.join(workspace, 'scripts', 'run-local-control.mjs'), 'export const supervisor = true;\n');
  await fs.writeFile(path.join(workspace, '.next', 'BUILD_ID'), 'production-build-1234\n');
  await fs.writeFile(runtimeSource, Buffer.alloc(1024, 0x5a));

  const calls = [];
  const commandRunner = async (executable, args, options = {}) => {
    calls.push({ executable, args: [...args], options: { ...options } });
    if (executable === 'dotnet.exe') {
      const output = args[args.indexOf('--output') + 1];
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(path.join(output, WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME), guiExecutable());
      return { stdout: '', stderr: '' };
    }
    if (executable === 'mountvol.exe' && args.at(-1) === '/L') {
      return { stdout: '\\\\?\\Volume{123e4567-e89b-42d3-a456-426614174000}\\\r\n', stderr: '' };
    }
    throw new Error(`unexpected test command: ${executable}`);
  };

  let adapterOptions;
  let enrollmentCount = 0;
  const adapterFactory = (options) => {
    adapterOptions = options;
    return Object.freeze({ kind: 'fake-native-adapter' });
  };
  const enrollmentFactory = () => ({
    enable: async () => {
      enrollmentCount += 1;
      const hostRoot = path.join(localAppData, WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT);
      const config = parseWindowsNodeHostConfig(await fs.readFile(path.join(hostRoot, WINDOWS_NODE_HOST_CONFIG_NAME)));
      return {
        state: 'enabled', changed: true, hostId: config.hostId, packageId: config.package.packageId,
        task: { folder: WINDOWS_AUTOSTART_TASK_FOLDER, name: WINDOWS_AUTOSTART_TASK_NAME },
      };
    },
  });
  const uuids = [
    '123e4567-e89b-42d3-a456-426614174010',
    '123e4567-e89b-42d3-a456-426614174000',
  ];
  let packageTreeIdentity = {
    packageProfile: 'mastermind-source-runtime-v1',
    packageDigestSha256: '9'.repeat(64),
    packageBytes: 4096,
    packageFileCount: 8,
  };

  const result = await installWindowsNodeHost({
    workspace,
    environment: { LOCALAPPDATA: localAppData },
    processExecutable: runtimeSource,
    platform: 'win32',
    commandRunner,
    randomUuid: () => uuids.shift(),
    adapterFactory,
    enrollmentFactory,
    lockFactory: async () => ({ release: async () => undefined }),
    packageTreeFactory: async () => packageTreeIdentity,
  });
  assert.equal(result.state, 'enabled');
  assert.equal(result.hostId, '123e4567-e89b-42d3-a456-426614174010');
  assert.equal(result.packageId, '123e4567-e89b-42d3-a456-426614174000');
  assert.deepEqual(calls.map(({ executable }) => executable), ['dotnet.exe', 'mountvol.exe']);
  assert.equal(calls.some(({ executable }) => /powershell|cmd\.exe/iu.test(executable)), false);
  assert.equal(adapterOptions.platform, 'win32');

  const hostRoot = path.join(localAppData, WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT);
  const [launcher, config, manifest] = await Promise.all([
    fs.readFile(path.join(hostRoot, WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME)),
    fs.readFile(path.join(hostRoot, WINDOWS_NODE_HOST_CONFIG_NAME)),
    fs.readFile(path.join(workspace, WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME)),
  ]);
  const parsed = parseWindowsNodeHostConfig(config);
  const runtime = await fs.readFile(path.join(hostRoot, parsed.launch.runtimeRelativePath));
  assert.deepEqual(launcher, guiExecutable());
  assert.equal(runtime.length, 1024);
  assert.equal(parsed.package.bundleRootHint, workspace);
  assert.equal(parsed.launch.runtimeSha256, sha256Bytes(runtime));
  assert.match(parsed.launch.runtimeRelativePath, /^runtime-v1\\[a-f0-9]{64}\\node\.exe$/u);
  assert.equal(parsed.package.manifestSha256, sha256Bytes(manifest));
  assert.equal(JSON.stringify(result.task).includes(workspace), false);
  assert.equal(enrollmentCount, 1);

  packageTreeIdentity = {
    packageProfile: 'mastermind-source-runtime-v1',
    packageDigestSha256: '8'.repeat(64),
    packageBytes: 8192,
    packageFileCount: 9,
  };
  await fs.writeFile(runtimeSource, Buffer.alloc(1536, 0x6b));
  const dotnetCallsBeforeReuse = calls.filter(({ executable }) => executable === 'dotnet.exe').length;

  const updated = await installWindowsNodeHost({
    workspace,
    environment: { LOCALAPPDATA: localAppData },
    processExecutable: runtimeSource,
    platform: 'win32',
    commandRunner,
    randomUuid: () => { throw new Error('an update must preserve existing identities'); },
    adapterFactory,
    enrollmentFactory,
    lockFactory: async () => ({ release: async () => undefined }),
    packageTreeFactory: async () => packageTreeIdentity,
  });
  assert.equal(updated.hostId, result.hostId);
  assert.equal(updated.packageId, result.packageId);
  assert.equal(calls.filter(({ executable }) => executable === 'dotnet.exe').length,
    dotnetCallsBeforeReuse);
  assert.equal(enrollmentCount, 2);

  const updatedManifest = await fs.readFile(
    path.join(workspace, WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME),
  );
  const updatedConfigBytes = await fs.readFile(path.join(hostRoot, WINDOWS_NODE_HOST_CONFIG_NAME));
  const updatedConfig = parseWindowsNodeHostConfig(updatedConfigBytes);
  const updatedRuntime = await fs.readFile(path.join(hostRoot, updatedConfig.launch.runtimeRelativePath));
  assert.notDeepEqual(updatedManifest, manifest);
  assert.equal(updatedConfig.package.packageDigestSha256, '8'.repeat(64));
  assert.equal(updatedConfig.package.packageBytes, 8192);
  assert.equal(updatedConfig.launch.runtimeBytes, 1536);
  assert.equal(updatedConfig.launch.runtimeSha256, sha256Bytes(updatedRuntime));
  assert.equal(updatedConfig.package.manifestSha256, sha256Bytes(updatedManifest));
  assert.deepEqual(await fs.readFile(path.join(hostRoot, WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME)), launcher);

  const changedLauncher = Buffer.from(launcher);
  changedLauncher[300] ^= 0xff;
  await fs.writeFile(path.join(hostRoot, WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME), changedLauncher);
  const configBeforeRefusal = await fs.readFile(path.join(hostRoot, WINDOWS_NODE_HOST_CONFIG_NAME));
  const manifestBeforeRefusal = await fs.readFile(
    path.join(workspace, WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME),
  );
  const dotnetCallsBeforeRefusal = calls.filter(
    ({ executable }) => executable === 'dotnet.exe',
  ).length;

  await assert.rejects(installWindowsNodeHost({
    workspace,
    environment: { LOCALAPPDATA: localAppData },
    processExecutable: runtimeSource,
    platform: 'win32',
    commandRunner,
    randomUuid: () => { throw new Error('a refusal must preserve existing identities'); },
    keyPairFactory: () => { throw new Error('a refusal must not replace manifest identity'); },
    adapterFactory,
    enrollmentFactory,
    lockFactory: async () => ({ release: async () => undefined }),
    packageTreeFactory: async () => packageTreeIdentity,
  }), (error) => error?.code === 'HOST_EXISTING_LAUNCHER_FOREIGN');
  assert.equal(calls.filter(({ executable }) => executable === 'dotnet.exe').length,
    dotnetCallsBeforeRefusal + 1);
  assert.equal(enrollmentCount, 2);
  assert.deepEqual(await fs.readFile(path.join(hostRoot, WINDOWS_NODE_HOST_CONFIG_NAME)),
    configBeforeRefusal);
  assert.deepEqual(await fs.readFile(path.join(workspace, WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME)),
    manifestBeforeRefusal);
});
