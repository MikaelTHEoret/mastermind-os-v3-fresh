import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as FS_CONSTANTS } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MinecraftAccountRegistrationStore } from '../services/minecraft-control-plane/src/companion/account-registration.mjs';
import { encodeMinecraftCredentialFrame } from '../services/minecraft-control-plane/src/companion/credential-frame.mjs';
import { DpapiMinecraftAccountVault } from '../services/minecraft-control-plane/src/companion/dpapi-vault.mjs';
import { MicrosoftMinecraftAuth } from '../services/minecraft-control-plane/src/companion/microsoft-auth.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPANION_UUID = '996a56dd-fb3c-4f90-9158-1a608652ec77';
const PARENT_UUID = '1ace17da-0910-403b-9dd3-06fbb3baa249';
const SERVER_PORT = 25569;
const PROXY_PORT = 25568;
const HASHES = Object.freeze({
  fabricApi: 'A4510EB2E9D4057FF20F751E420D0618598813AB9695B6F793A53C2883808DAC',
  familyCore: '755B4E01F2C268C92F1BDC95FB8295602C0EB064EFC227A30D6264BE9E4870BE',
  zenith: '00C2AE1ED1D74C2B3AFF4E3872C69CA034D7FB3CB91032FC7E8A0C0ED5A050B5',
  plugin: 'FAFD35F0B28A7F1D520EC47DA44AB7706DAA13E6D17558A8EA0CAC8ED1CDD10A',
  bootstrap: '53D611DA8C8796184D05741DEE21160FBD4C23E0E35194502C8861DAF313F433',
});

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function sha256(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 128 * 1024 * 1024) fail('HANDBACK_ARTIFACT_INVALID');
  const bytes = await fs.readFile(file);
  try { return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(); }
  finally { bytes.fill(0); }
}

async function requireHash(file, expected) {
  if (await sha256(file) !== expected) fail('HANDBACK_ARTIFACT_MISMATCH');
}

async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(300, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function waitForPort(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail('HANDBACK_PROCESS_EARLY_EXIT');
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('HANDBACK_PORT_TIMEOUT');
}

function propertiesPath(value) {
  return value.replaceAll('\\', '/');
}

async function configureServer(source, serverRoot, privateRoot, familyCoreJar, fabricApiJar) {
  await fs.cp(source, serverRoot, { recursive: true, errorOnExist: true, force: false });
  const serverProperties = path.join(serverRoot, 'server.properties');
  let properties = await fs.readFile(serverProperties, 'utf8');
  properties = properties
    .replace(/^server-port=.*$/mu, `server-port=${SERVER_PORT}`)
    .replace(/^server-ip=.*$/mu, 'server-ip=127.0.0.1')
    .replace(/^enable-rcon=.*$/mu, 'enable-rcon=false')
    .replace(/^enable-query=.*$/mu, 'enable-query=false');
  await fs.writeFile(serverProperties, properties, { flag: 'w' });

  const modsRoot = path.join(serverRoot, 'mastermind-acceptance-mods');
  await fs.mkdir(modsRoot, { mode: 0o700 });
  const stagedFabric = path.join(modsRoot, 'fabric-api.jar');
  const stagedCore = path.join(modsRoot, 'family-core-0.2.0.jar');
  await fs.copyFile(fabricApiJar, stagedFabric, FS_CONSTANTS.COPYFILE_EXCL);
  await fs.copyFile(familyCoreJar, stagedCore, FS_CONSTANTS.COPYFILE_EXCL);
  const modsList = path.join(serverRoot, 'mastermind-acceptance-mods.list');
  await fs.writeFile(modsList, `${stagedFabric}\n${stagedCore}\n`, { flag: 'wx', mode: 0o600 });

  const keyFile = path.join(privateRoot, 'handback.key');
  const attestationFile = path.join(privateRoot, 'handback.attestation');
  const killSwitchFile = path.join(privateRoot, 'handback.kill');
  const key = crypto.randomBytes(32);
  try { await fs.writeFile(keyFile, key, { flag: 'wx', mode: 0o600 }); }
  finally { key.fill(0); }
  const config = [
    'companionTelemetry.enabled=true',
    `companionTelemetry.companionUuid=${COMPANION_UUID}`,
    `companionTelemetry.attestationFile=${propertiesPath(attestationFile)}`,
    `companionTelemetry.keyFile=${propertiesPath(keyFile)}`,
    'companionTelemetry.intervalTicks=5',
    '',
  ].join('\n');
  await fs.writeFile(path.join(serverRoot, 'config', 'mastermind-family-core.properties'), config, { flag: 'wx', mode: 0o600 });
  return { modsRoot, modsList, keyFile, attestationFile, killSwitchFile };
}

async function configureZenith(templateRoot, zenithRoot, serverFiles, artifacts) {
  await fs.mkdir(path.join(zenithRoot, 'runtime'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(zenithRoot, 'plugins', 'config'), { recursive: true, mode: 0o700 });
  await fs.copyFile(path.join(templateRoot, 'runtime', 'mastermind-zenith-secure-bootstrap-0.1.0.jar'), path.join(zenithRoot, 'runtime', 'mastermind-zenith-secure-bootstrap-0.1.0.jar'), FS_CONSTANTS.COPYFILE_EXCL);
  await fs.copyFile(artifacts.zenith, path.join(zenithRoot, 'runtime', 'ZenithProxy.jar'), FS_CONSTANTS.COPYFILE_EXCL);
  await fs.copyFile(artifacts.plugin, path.join(zenithRoot, 'plugins', 'mastermind-zenith-companion-0.2.0.jar'), FS_CONSTANTS.COPYFILE_EXCL);
  const config = JSON.parse(await fs.readFile(path.join(templateRoot, 'config.json'), 'utf8'));
  config.client.server.address = '127.0.0.1';
  config.client.server.port = SERVER_PORT;
  config.server.bind.address = '127.0.0.1';
  config.server.bind.port = PROXY_PORT;
  await fs.writeFile(path.join(zenithRoot, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await fs.copyFile(path.join(templateRoot, 'launch_config.json'), path.join(zenithRoot, 'launch_config.json'), fs.constants.COPYFILE_EXCL);
  const plugin = {
    enabled: true,
    nativeFallbackEnabled: true,
    enhancedControllerEnabled: true,
    parentTakeoverEnabled: true,
    expectedBindAddress: '127.0.0.1',
    handbackStableMilliseconds: 2_000,
    pairedHandbackEnabled: true,
    handbackPollMilliseconds: 250,
    handbackMaximumAgeMilliseconds: 1_500,
    handbackMaximumPositionDelta: 1.5,
    handbackAttestationFile: serverFiles.attestationFile,
    handbackKeyFile: serverFiles.keyFile,
    handbackKillSwitchFile: serverFiles.killSwitchFile,
    serviceControllerUuid: COMPANION_UUID,
    parentControllerUuids: [PARENT_UUID],
  };
  await fs.writeFile(path.join(zenithRoot, 'plugins', 'config', 'mastermind-companion.json'), `${JSON.stringify(plugin, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

async function minecraftSession(familyRoot) {
  const privateRoot = path.join(familyRoot, 'private');
  const registration = await new MinecraftAccountRegistrationStore(path.join(privateRoot, 'minecraft-account-registration.json')).load();
  const vault = new DpapiMinecraftAccountVault({ vaultFile: path.join(privateRoot, 'minecraft-account.dpapi.json') });
  const auth = new MicrosoftMinecraftAuth({ config: registration, vault });
  await auth.initialize();
  await auth.silentRefresh();
  const session = auth.minecraftSession();
  if (session.username !== 'The_AlChemist___' || session.uuid.toLowerCase() !== COMPANION_UUID.replaceAll('-', '')) {
    fail('HANDBACK_ACCOUNT_MISMATCH');
  }
  return session;
}

async function main() {
  if (process.argv.length !== 2 || process.platform !== 'win32') fail('HANDBACK_START_FORBIDDEN');
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData !== 'string' || !path.win32.isAbsolute(localAppData)) fail('HANDBACK_ROOT_INVALID');
  if (await portOpen(PROXY_PORT) || await portOpen(SERVER_PORT)) fail('HANDBACK_PORT_OCCUPIED');

  const familyRoot = path.resolve(localAppData, 'Mastermind', 'minecraft', 'projects', 'family-server');
  const stagingParent = path.resolve(localAppData, 'Mastermind', 'staging', 'minecraft', 'zenith', 'handback-acceptance');
  const runId = `run-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${crypto.randomUUID()}`;
  const runRoot = path.join(stagingParent, runId);
  if (!contained(stagingParent, runRoot)) fail('HANDBACK_ROOT_INVALID');
  const activeFile = path.join(stagingParent, 'active.v1.json');
  try { await fs.lstat(activeFile); fail('HANDBACK_ALREADY_ACTIVE'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.join(runRoot, 'private'), { recursive: true, mode: 0o700 });

  const snapshot = path.resolve(localAppData, 'Mastermind', 'staging', 'minecraft', 'zenith', 'pre-live-snapshots', '2026-08-21T1645Z-family-server');
  const templateZenith = path.resolve(localAppData, 'Mastermind', 'staging', 'minecraft', 'zenith', '3.5.8+26.2.0-mastermind-secure.1');
  const artifacts = {
    fabricApi: path.join(familyRoot, 'servers', 'family-server', 'mods', 'fabric-api.jar'),
    familyCore: path.join(REPO_ROOT, 'minecraft', 'family-core', 'build', 'libs', 'family-core-0.2.0.jar'),
    zenith: path.resolve(localAppData, 'Temp', 'mastermind-zenithproxy-3.5.8-java-26.2.0-source', 'build', 'libs', 'ZenithProxy.jar'),
    plugin: path.join(REPO_ROOT, 'minecraft', 'zenith-companion-plugin', 'build', 'libs', 'mastermind-zenith-companion-0.2.0.jar'),
    bootstrap: path.join(templateZenith, 'runtime', 'mastermind-zenith-secure-bootstrap-0.1.0.jar'),
  };
  await Promise.all(Object.entries(artifacts).map(([name, file]) => requireHash(file, HASHES[name])));

  let serverProcess;
  let zenithProcess;
  const serverRoot = path.join(runRoot, 'server');
  const zenithRoot = path.join(runRoot, 'zenith');
  const privateRoot = path.join(runRoot, 'private');
  try {
    const serverFiles = await configureServer(snapshot, serverRoot, privateRoot, artifacts.familyCore, artifacts.fabricApi);
    await configureZenith(templateZenith, zenithRoot, serverFiles, artifacts);
    const java = path.join(familyRoot, 'runtimes', 'java-runtime-epsilon', '25.0.1', 'windows-x64', 'bin', 'java.exe');
    const assetRoot = path.join(familyRoot, 'state', 'launch-artifacts', 'b6db3a61b365e3933ad21da3440f436cad9201f63918004865e4508c0206e53f');
    const gameLibraries = path.join(familyRoot, 'state', 'launch-sessions', 'family-server-742e64c0-72aa-4ba3-91fd-b696032233d5', 'game-libraries.list');
    const fabricLibraries = [
      ['org', 'ow2', 'asm', 'asm', '9.10.1', 'asm-9.10.1.jar'],
      ['org', 'ow2', 'asm', 'asm-analysis', '9.10.1', 'asm-analysis-9.10.1.jar'],
      ['org', 'ow2', 'asm', 'asm-commons', '9.10.1', 'asm-commons-9.10.1.jar'],
      ['org', 'ow2', 'asm', 'asm-tree', '9.10.1', 'asm-tree-9.10.1.jar'],
      ['org', 'ow2', 'asm', 'asm-util', '9.10.1', 'asm-util-9.10.1.jar'],
      ['net', 'fabricmc', 'sponge-mixin', '0.17.3+mixin.0.8.7', 'sponge-mixin-0.17.3+mixin.0.8.7.jar'],
      ['net', 'fabricmc', 'fabric-loader', '0.19.3', 'fabric-loader-0.19.3.jar'],
    ].map((parts) => path.join(assetRoot, 'fabric', 'libraries', ...parts));
    const serverOut = await fs.open(path.join(runRoot, 'server.out.log'), 'a', 0o600);
    const serverErr = await fs.open(path.join(runRoot, 'server.err.log'), 'a', 0o600);
    serverProcess = spawn(java, [
      '-Xms256M', '-Xmx1024M',
      `-Dfabric.gameJarPath=${path.join(assetRoot, 'mojang', 'versions', '26.2', 'server-26.2.jar')}`,
      '-Dfabric.gameVersion=26.2',
      `-Dfabric.modsFolder=${serverFiles.modsRoot}`,
      `-Dfabric.addMods=@${serverFiles.modsList}`,
      `-Dfabric.gameLibraries=@${gameLibraries}`,
      '-cp', fabricLibraries.join(path.delimiter), 'net.fabricmc.loader.impl.launch.knot.KnotServer', 'nogui',
    ], { cwd: serverRoot, windowsHide: true, detached: true, stdio: ['ignore', serverOut.fd, serverErr.fd] });
    await Promise.allSettled([serverOut.close(), serverErr.close()]);
    await waitForPort(SERVER_PORT, serverProcess, 30_000);

    const session = await minecraftSession(familyRoot);
    const credentialFrame = encodeMinecraftCredentialFrame(session);
    const zenithOut = await fs.open(path.join(runRoot, 'zenith.out.log'), 'a', 0o600);
    const zenithErr = await fs.open(path.join(runRoot, 'zenith.err.log'), 'a', 0o600);
    try {
      zenithProcess = spawn(java, [
        '-Xms64M', '-Xmx512M', '-cp',
        `${path.join(zenithRoot, 'runtime', 'mastermind-zenith-secure-bootstrap-0.1.0.jar')}${path.delimiter}${path.join(zenithRoot, 'runtime', 'ZenithProxy.jar')}`,
        'com.mastermind.minecraft.zenith.bootstrap.SecureZenithBootstrapMain',
      ], { cwd: zenithRoot, windowsHide: true, detached: true, stdio: ['pipe', zenithOut.fd, zenithErr.fd] });
      zenithProcess.stdin.on('error', () => {});
      zenithProcess.stdin.end(credentialFrame);
      await waitForPort(PROXY_PORT, zenithProcess, 20_000);
    } finally {
      credentialFrame.fill(0);
      await Promise.allSettled([zenithOut.close(), zenithErr.close()]);
    }

    const state = {
      schemaVersion: 1, runRoot, serverPid: serverProcess.pid, zenithPid: zenithProcess.pid,
      serverPort: SERVER_PORT, proxyPort: PROXY_PORT, startedAt: new Date().toISOString(), hashes: HASHES,
    };
    await fs.writeFile(activeFile, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    serverProcess.unref();
    zenithProcess.unref();
    process.stdout.write(`${JSON.stringify({ ok: true, serverPid: serverProcess.pid, zenithPid: zenithProcess.pid, proxyPort: PROXY_PORT })}\n`);
  } catch (error) {
    if (zenithProcess?.pid) { try { process.kill(zenithProcess.pid); } catch {} }
    if (serverProcess?.pid) { try { process.kill(serverProcess.pid); } catch {} }
    throw error;
  }
}

main().catch((error) => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/u.test(error.code) ? error.code : 'HANDBACK_START_FAILED';
  process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
  process.exitCode = 1;
});
