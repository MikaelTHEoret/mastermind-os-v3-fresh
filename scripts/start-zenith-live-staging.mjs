import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { MinecraftAccountRegistrationStore } from '../services/minecraft-control-plane/src/companion/account-registration.mjs';
import { encodeMinecraftCredentialFrame } from '../services/minecraft-control-plane/src/companion/credential-frame.mjs';
import { DpapiMinecraftAccountVault } from '../services/minecraft-control-plane/src/companion/dpapi-vault.mjs';
import { MicrosoftMinecraftAuth } from '../services/minecraft-control-plane/src/companion/microsoft-auth.mjs';

const ZENITH_SHA256 = 'C11FF1A6B69DF5AD99C95203605AB5389D21BE8CCB919130CF8AC279A3F20A17';
const BOOTSTRAP_SHA256 = '53D611DA8C8796184D05741DEE21160FBD4C23E0E35194502C8861DAF313F433';
const PLUGIN_SHA256 = 'C7FD53C476C6BC11C39D959A6D633518F800C60C18080FEC5A2BCC0DC309F561';
const COMPANION_UUID = '996a56dd-fb3c-4f90-9158-1a608652ec77';
const PARENT_UUID = '1ace17da-0910-403b-9dd3-06fbb3baa249';
const LIVE_PORT = 25568;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function regularFile(file, maximumBytes) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) fail('LIVE_STAGING_INPUT_INVALID');
  return stat;
}

async function sha256(file) {
  const bytes = await fs.readFile(file);
  try { return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(); }
  finally { bytes.fill(0); }
}

async function assertHash(file, expected) {
  await regularFile(file, 128 * 1024 * 1024);
  if (await sha256(file) !== expected) fail('LIVE_STAGING_ARTIFACT_MISMATCH');
}

async function jsonFile(file, maximumBytes = 256 * 1024) {
  await regularFile(file, maximumBytes);
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fail('LIVE_STAGING_CONFIG_INVALID'); }
}

function assertConfig(config, plugin, launchConfig) {
  if (
    config?.server?.bind?.address !== '127.0.0.1' || config.server.bind.port !== LIVE_PORT
    || config.server.enabled !== true || config.server.upnp !== false || config.server.verifyUsers !== true
    || config?.client?.server?.address !== '127.0.0.1' || config.client.server.port !== 25565
    || config.client.autoConnect !== true || config.client.bindAddress !== '127.0.0.1'
    || config?.authentication?.authTokenRefresh !== false || config?.authentication?.openBrowserOnLogin !== false
    || config?.discord?.enable !== false || config?.database?.enabled !== false
    || config?.client?.extra?.autoRespawn?.enabled !== false || config.client.extra.autoEat?.enabled !== false
    || config.client.extra.autoTotem?.enabled !== false || config.client.extra.antiLeak?.enabled !== false
    || config.client.extra.chat?.enabled !== false || config.client.extra.visualRange?.enabled !== false
    || config.client.extra.queueWarning?.enabled !== false || config.client.extra.click?.enabled !== false
    || config.client.extra.sessionTimeLimit?.enabled !== false || config.client.extra.tasks?.enabled !== false
    || plugin?.enabled !== true || plugin.nativeFallbackEnabled !== true
    || plugin.enhancedControllerEnabled !== true || plugin.parentTakeoverEnabled !== true
    || plugin.expectedBindAddress !== '127.0.0.1'
    || plugin.serviceControllerUuid?.toLowerCase() !== COMPANION_UUID
    || !Array.isArray(plugin.parentControllerUuids) || plugin.parentControllerUuids.length !== 1
    || plugin.parentControllerUuids[0]?.toLowerCase() !== PARENT_UUID
    || launchConfig?.auto_update !== false || launchConfig.auto_update_launcher !== false
  ) fail('LIVE_STAGING_CONFIG_INVALID');
}

async function existingLiveProcess(stateFile) {
  try {
    const state = await jsonFile(stateFile, 16 * 1024);
    if (Number.isInteger(state?.pid) && state.pid > 0) {
      try { process.kill(state.pid, 0); return true; }
      catch (error) { if (error?.code !== 'ESRCH') throw error; }
    }
    return false;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function main() {
  if (process.argv.length !== 2 || process.platform !== 'win32') fail('LIVE_STAGING_LAUNCH_FORBIDDEN');
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData !== 'string' || !path.win32.isAbsolute(localAppData) || localAppData.includes('\0')) {
    fail('LIVE_STAGING_ROOT_INVALID');
  }

  const familyRoot = path.resolve(localAppData, 'Mastermind', 'minecraft', 'projects', 'family-server');
  const stagingRoot = path.resolve(localAppData, 'Mastermind', 'staging', 'minecraft', 'zenith', '3.5.8+26.2.0-mastermind-secure.1');
  const expectedStagingParent = path.resolve(localAppData, 'Mastermind', 'staging', 'minecraft', 'zenith');
  if (!contained(expectedStagingParent, stagingRoot)) fail('LIVE_STAGING_ROOT_INVALID');

  const java = path.join(familyRoot, 'runtimes', 'java-runtime-epsilon', '25.0.1', 'windows-x64', 'bin', 'java.exe');
  const zenithJar = path.join(stagingRoot, 'runtime', 'ZenithProxy.jar');
  const bootstrapJar = path.join(stagingRoot, 'runtime', 'mastermind-zenith-secure-bootstrap-0.1.0.jar');
  const pluginJar = path.join(stagingRoot, 'plugins', 'mastermind-zenith-companion-0.1.0.jar');
  const configFile = path.join(stagingRoot, 'config.json');
  const launchConfigFile = path.join(stagingRoot, 'launch_config.json');
  const pluginConfigFile = path.join(stagingRoot, 'plugins', 'config', 'mastermind-companion.json');
  const stateFile = path.join(stagingRoot, 'live-process.v1.json');
  const authCache = path.join(stagingRoot, 'mc_auth_cache.json');

  await regularFile(java, 16 * 1024 * 1024);
  await Promise.all([
    assertHash(zenithJar, ZENITH_SHA256),
    assertHash(bootstrapJar, BOOTSTRAP_SHA256),
    assertHash(pluginJar, PLUGIN_SHA256),
  ]);
  assertConfig(await jsonFile(configFile), await jsonFile(pluginConfigFile), await jsonFile(launchConfigFile));
  try { await fs.lstat(authCache); fail('PLAINTEXT_AUTH_CACHE_FORBIDDEN'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (await existingLiveProcess(stateFile)) fail('LIVE_STAGING_ALREADY_ACTIVE');

  const privateRoot = path.join(familyRoot, 'private');
  const registration = await new MinecraftAccountRegistrationStore(
    path.join(privateRoot, 'minecraft-account-registration.json'),
  ).load();
  const vault = new DpapiMinecraftAccountVault({
    vaultFile: path.join(privateRoot, 'minecraft-account.dpapi.json'),
  });
  const auth = new MicrosoftMinecraftAuth({ config: registration, vault });
  await auth.initialize();
  await auth.silentRefresh();
  const session = auth.minecraftSession();
  if (session.username !== 'The_AlChemist___' || session.uuid.toLowerCase() !== COMPANION_UUID.replaceAll('-', '')) {
    fail('LIVE_STAGING_ACCOUNT_MISMATCH');
  }

  const credentialFrame = encodeMinecraftCredentialFrame(session);
  const stdout = await fs.open(path.join(stagingRoot, 'live-proxy.out.log'), 'a', 0o600);
  const stderr = await fs.open(path.join(stagingRoot, 'live-proxy.err.log'), 'a', 0o600);
  let child;
  try {
    child = spawn(java, [
      '-Xms64M', '-Xmx512M',
      '-cp', `${bootstrapJar}${path.delimiter}${zenithJar}`,
      'com.mastermind.minecraft.zenith.bootstrap.SecureZenithBootstrapMain',
    ], {
      cwd: stagingRoot,
      windowsHide: true,
      detached: true,
      stdio: ['pipe', stdout.fd, stderr.fd],
      env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => (
        ['LOCALAPPDATA', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'WINDIR'].includes(key.toUpperCase())
        && typeof value === 'string'
      ))),
    });
    child.stdin.on('error', () => {});
    child.stdin.end(credentialFrame);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 2_000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(Object.assign(new Error('LIVE_STAGING_EARLY_EXIT'), { code: `EXIT_${code}` })); });
    });
    const state = {
      schemaVersion: 1,
      pid: child.pid,
      port: LIVE_PORT,
      startedAt: new Date().toISOString(),
      zenithSha256: ZENITH_SHA256,
      bootstrapSha256: BOOTSTRAP_SHA256,
      pluginSha256: PLUGIN_SHA256,
    };
    await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, { flag: 'w', mode: 0o600 });
    await fs.chmod(stateFile, 0o600);
    child.unref();
    process.stdout.write(`${JSON.stringify({ ok: true, pid: child.pid, port: LIVE_PORT })}\n`);
  } finally {
    credentialFrame.fill(0);
    await Promise.allSettled([stdout.close(), stderr.close()]);
  }
}

main().catch((error) => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/u.test(error.code)
    ? error.code
    : 'LIVE_STAGING_START_FAILED';
  process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
  process.exitCode = 1;
});
