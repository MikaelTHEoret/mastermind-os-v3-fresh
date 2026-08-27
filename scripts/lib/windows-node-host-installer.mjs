import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME,
  WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT,
  WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME,
  createWindowsAutostartEnrollment,
} from './windows-autostart-enrollment.mjs';
import {
  createWindowsAutostartNativeAdapter,
  inspectPortableExecutableSubsystem,
  readWindowsVolumeIdentitySha256,
} from './windows-autostart-native-adapter.mjs';
import {
  WINDOWS_NODE_HOST_CONFIG_NAME,
  WINDOWS_NODE_HOST_SUPERVISOR_RELATIVE_PATH,
  createWindowsNodeHostConfig,
  createWindowsNodePackageManifest,
  parseAndVerifyWindowsNodePackageManifest,
  parseWindowsNodeHostConfig,
  serializeWindowsNodeHostConfig,
  sha256Bytes,
} from './windows-node-host-contract.mjs';
import { computeWindowsNodePackageTree } from './windows-node-package-tree.mjs';

const execFileAsync = promisify(execFile);
const MAX_HOST_BYTES = 64 * 1024 * 1024;
const MAX_RUNTIME_BYTES = 256 * 1024 * 1024;

export class WindowsNodeHostInstallerError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'WindowsNodeHostInstallerError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new WindowsNodeHostInstallerError(code, message, cause ? { cause } : undefined);
}

async function defaultCommandRunner(executable, args, options = {}) {
  return execFileAsync(executable, args, {
    windowsHide: true,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15 * 60_000,
    ...options,
  });
}

async function readBounded(fsApi, file, maximum, code) {
  const stat = await fsApi.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size < 1 || stat.size > maximum) {
    fail(code, 'A required Windows node-host artifact is unavailable or outside its size limit.');
  }
  return fsApi.readFile(file);
}

async function atomicReplace(fsApi, target, bytes) {
  const temporary = `${target}.${crypto.randomBytes(8).toString('hex')}.new`;
  await fsApi.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  try { await fsApi.rename(temporary, target); }
  catch (error) {
    await fsApi.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeContentAddressed(fsApi, target, bytes, expectedSha256) {
  const existing = await fsApi.readFile(target).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing !== null) {
    if (sha256Bytes(existing) !== expectedSha256) {
      fail('HOST_CONTENT_ADDRESS_COLLISION', 'A versioned host artifact has unexpected content.');
    }
    return false;
  }
  await atomicReplace(fsApi, target, bytes);
  return true;
}

export async function acquireWindowsNodeHostInstallMutex({
  localAppData,
  timeoutMs = 60_000,
  netApi = net,
} = {}) {
  const suffix = sha256Bytes(Buffer.from(localAppData.toLocaleLowerCase('en-US'), 'utf8'));
  const pipeName = `\\\\.\\pipe\\mastermind-node-host-install-${suffix}`;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const server = netApi.createServer((socket) => socket.destroy());
    const acquired = await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening);
        if (error?.code === 'EADDRINUSE') resolve(false);
        else reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(true);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(pipeName);
    });
    if (acquired) {
      server.on('error', (error) => { throw error; });
      return Object.freeze({
        pipeName,
        release: () => new Promise((resolve, reject) => server.close((error) => (
          error ? reject(error) : resolve()
        ))),
      });
    }
    server.close();
    if (Date.now() >= deadline) fail('HOST_INSTALL_BUSY', 'Another node-host installation is still active.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function existingIdentity(fsApi, configPath) {
  try {
    const config = parseWindowsNodeHostConfig(await fsApi.readFile(configPath));
    return {
      hostId: config.hostId,
      packageId: config.package.packageId,
      hostLauncherSha256: config.hostLauncherSha256,
      hostLauncherBytes: config.hostLauncherBytes,
      packageDigestSha256: config.package.packageDigestSha256,
      packageBytes: config.package.packageBytes,
      volumeIdentitySha256: config.package.volumeIdentitySha256,
      manifestSha256: config.package.manifestSha256,
      manifestPublicKeySha256: config.package.manifestPublicKeySha256,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('HOST_EXISTING_CONFIG_INVALID',
      'The existing fixed host configuration is invalid; it was left unchanged.', error);
  }
}

function reusableHostLauncher(existingLauncher, prior) {
  if (existingLauncher === null || prior === null
    || existingLauncher.length !== prior.hostLauncherBytes
    || sha256Bytes(existingLauncher) !== prior.hostLauncherSha256) return null;
  try {
    return inspectPortableExecutableSubsystem(existingLauncher) === 2 ? existingLauncher : null;
  } catch {
    return null;
  }
}

async function reusablePackageManifest(fsApi, manifestPath, prior, expected) {
  if (prior === null) return null;
  try {
    const manifestBytes = await fsApi.readFile(manifestPath);
    const verified = parseAndVerifyWindowsNodePackageManifest(manifestBytes, {
      expectedManifestSha256: prior.manifestSha256,
      expectedPublicKeySha256: prior.manifestPublicKeySha256,
    });
    const payload = verified.payload;
    if (payload.packageId !== prior.packageId
      || payload.packageDigestSha256 !== expected.packageDigestSha256
      || payload.packageBytes !== expected.packageBytes
      || payload.packageFileCount !== expected.packageFileCount
      || payload.volumeIdentitySha256 !== expected.volumeIdentitySha256
      || payload.supervisorSha256 !== expected.supervisorSha256
      || payload.supervisorBytes !== expected.supervisorBytes) return null;
    return Object.freeze({
      manifest: verified.manifest,
      payload,
      manifestBytes,
      publicKeySha256: verified.publicKeySha256,
    });
  } catch {
    return null;
  }
}

function validateWorkspace(workspace) {
  if (typeof workspace !== 'string' || !path.win32.isAbsolute(workspace)
    || path.win32.resolve(workspace) !== workspace || workspace.includes('/')) {
    fail('HOST_INSTALL_INPUT_INVALID', 'The node-host installer workspace is invalid.');
  }
}

/**
 * One-shot source-build and current-user enrollment. This function is inert
 * until called. All child tools are executed directly with windowsHide; it
 * never invokes cmd.exe, PowerShell, or a caller-supplied command/path.
 */
export async function installWindowsNodeHost({
  workspace,
  environment = process.env,
  processExecutable = process.execPath,
  platform = process.platform,
  fsApi = fs,
  commandRunner = defaultCommandRunner,
  randomUuid = crypto.randomUUID,
  keyPairFactory = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  adapterFactory = createWindowsAutostartNativeAdapter,
  enrollmentFactory = createWindowsAutostartEnrollment,
  lockFactory = acquireWindowsNodeHostInstallMutex,
  packageTreeFactory = computeWindowsNodePackageTree,
} = {}) {
  if (platform !== 'win32') fail('HOST_PLATFORM_UNSUPPORTED', 'The fixed node host can be installed only on Windows.');
  validateWorkspace(workspace);
  const canonicalWorkspace = await fsApi.realpath(workspace);
  if (canonicalWorkspace.toLocaleLowerCase('en-US') !== workspace.toLocaleLowerCase('en-US')) {
    fail('HOST_INSTALL_INPUT_INVALID', 'The installer requires the canonical package root.');
  }
  const localAppDataInput = String(environment.LOCALAPPDATA ?? '');
  const localAppData = path.win32.resolve(localAppDataInput);
  if (!path.win32.isAbsolute(localAppDataInput) || !/^[A-Za-z]:\\/u.test(localAppData)
    || localAppDataInput.includes('/')) {
    fail('HOST_LOCAL_APP_DATA_UNAVAILABLE', 'LocalAppData is unavailable.');
  }
  const hostRoot = path.win32.join(localAppData, WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT);
  const runtimeRoot = path.win32.join(hostRoot, 'runtime-v1');
  const configPath = path.win32.join(hostRoot, WINDOWS_NODE_HOST_CONFIG_NAME);
  const launcherPath = path.win32.join(hostRoot, WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME);
  const manifestPath = path.win32.join(workspace, WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME);
  const supervisorPath = path.win32.join(workspace, WINDOWS_NODE_HOST_SUPERVISOR_RELATIVE_PATH);
  const productionBuildIdPath = path.win32.join(workspace, '.next', 'BUILD_ID');
  const nativeProject = path.win32.join(
    workspace, 'native', 'windows', 'MastermindNodeHost', 'MastermindNodeHost.csproj',
  );
  const installRoot = path.win32.join(hostRoot, `install-${crypto.randomBytes(8).toString('hex')}`);
  const publishRoot = path.win32.join(installRoot, 'publish');
  const publishedLauncher = path.win32.join(publishRoot, WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME);
  const installLock = await lockFactory({ localAppData });

  try {
    const productionBuildId = await readBounded(
      fsApi, productionBuildIdPath, 1024, 'HOST_PRODUCTION_BUILD_REQUIRED',
    );
    if (!/^[A-Za-z0-9_-]{4,256}\r?\n?$/u.test(productionBuildId.toString('utf8'))) {
      fail('HOST_PRODUCTION_BUILD_REQUIRED',
        'A verified Next production build is required before node-host enrollment.');
    }

    let prior = null;
    let priorError = null;
    try {
      prior = await existingIdentity(fsApi, configPath);
    } catch (error) {
      priorError = error;
    }
    const existingLauncher = await fsApi.readFile(launcherPath).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    let hostBytes = reusableHostLauncher(existingLauncher, prior);
    if (hostBytes === null) {
      await fsApi.mkdir(publishRoot, { recursive: true });
      await commandRunner('dotnet.exe', [
        'publish', nativeProject, '--configuration', 'Release', '--runtime', 'win-x64',
        '--self-contained', 'true', '--output', publishRoot, '--nologo',
      ], { cwd: workspace });
      hostBytes = await readBounded(
        fsApi, publishedLauncher, MAX_HOST_BYTES, 'HOST_BINARY_INVALID',
      );
      if (inspectPortableExecutableSubsystem(hostBytes) !== 2) {
        fail('HOST_BINARY_INVALID', 'The node host was not built as a Windows GUI-subsystem executable.');
      }
    }
    if (priorError !== null) throw priorError;

    const [
      runtimeBytes, supervisorBytes, volumeIdentitySha256, packageTree,
    ] = await Promise.all([
      readBounded(fsApi, processExecutable, MAX_RUNTIME_BYTES, 'HOST_RUNTIME_INVALID'),
      readBounded(fsApi, supervisorPath, 16 * 1024 * 1024, 'HOST_SUPERVISOR_INVALID'),
      readWindowsVolumeIdentitySha256(commandRunner, workspace),
      packageTreeFactory({ workspace, fsApi }),
    ]);
    const hostId = prior?.hostId ?? randomUuid();
    const packageId = prior?.packageId ?? randomUuid();
    const manifestIdentity = {
      packageDigestSha256: packageTree.packageDigestSha256,
      packageBytes: packageTree.packageBytes,
      packageFileCount: packageTree.packageFileCount,
      volumeIdentitySha256,
      supervisorSha256: sha256Bytes(supervisorBytes),
      supervisorBytes: supervisorBytes.length,
    };
    let createdManifest = await reusablePackageManifest(
      fsApi, manifestPath, prior, manifestIdentity,
    );
    if (createdManifest === null) {
      const keyPair = keyPairFactory();
      createdManifest = createWindowsNodePackageManifest({
        packageId,
        ...manifestIdentity,
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
      });
    }
    const manifestSha256 = sha256Bytes(createdManifest.manifestBytes);
    const runtimeSha256 = sha256Bytes(runtimeBytes);
    const runtimeGenerationRoot = path.win32.join(runtimeRoot, runtimeSha256);
    const runtimePath = path.win32.join(runtimeGenerationRoot, 'node.exe');
    let installedHostBytes = hostBytes;
    if (existingLauncher !== null) {
      if (inspectPortableExecutableSubsystem(existingLauncher) !== 2 || prior === null
        || existingLauncher.length !== prior.hostLauncherBytes
        || sha256Bytes(existingLauncher) !== prior.hostLauncherSha256) {
        fail('HOST_EXISTING_LAUNCHER_FOREIGN',
          'An existing fixed node-host launcher could not be claimed or replaced.');
      }
      installedHostBytes = existingLauncher;
    } else {
      await atomicReplace(fsApi, launcherPath, hostBytes);
    }
    const config = createWindowsNodeHostConfig({
      hostId,
      hostLauncherSha256: sha256Bytes(installedHostBytes),
      hostLauncherBytes: installedHostBytes.length,
      packageManifest: {
        ...createdManifest,
        manifestSha256,
      },
      bundleRootHint: workspace,
      runtimeSha256,
      runtimeBytes: runtimeBytes.length,
    });
    await fsApi.mkdir(runtimeGenerationRoot, { recursive: true });
    await writeContentAddressed(fsApi, runtimePath, runtimeBytes, runtimeSha256);
    await atomicReplace(fsApi, manifestPath, createdManifest.manifestBytes);
    await atomicReplace(fsApi, configPath, serializeWindowsNodeHostConfig(config));

    const adapter = adapterFactory({ environment, fsApi, commandRunner, platform });
    const enrollment = enrollmentFactory({ nativeAdapter: adapter });
    const result = await enrollment.enable();
    return Object.freeze({
      ok: true,
      state: result.state,
      changed: result.changed,
      hostId: result.hostId,
      packageId: result.packageId,
      task: result.task,
      hostLauncherSha256: sha256Bytes(installedHostBytes),
      runtimeSha256: config.launch.runtimeSha256,
      manifestSha256,
    });
  } catch (error) {
    if (error instanceof WindowsNodeHostInstallerError) throw error;
    fail('HOST_INSTALL_FAILED', 'The fixed Windows node host could not be installed safely.', error);
  } finally {
    await fsApi.rm(installRoot, { recursive: true, force: true }).catch(() => undefined);
    await installLock.release().catch(() => undefined);
  }
}

export const __test = Object.freeze({
  atomicReplace, existingIdentity, reusableHostLauncher, reusablePackageManifest,
  validateWorkspace, writeContentAddressed,
});
