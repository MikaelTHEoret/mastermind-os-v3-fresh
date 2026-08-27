import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const ZENITH_SHA256 = 'C11FF1A6B69DF5AD99C95203605AB5389D21BE8CCB919130CF8AC279A3F20A17';
const BOOTSTRAP_SHA256 = '53D611DA8C8796184D05741DEE21160FBD4C23E0E35194502C8861DAF313F433';
const PLUGIN_SHA256 = 'C7FD53C476C6BC11C39D959A6D633518F800C60C18080FEC5A2BCC0DC309F561';
const LIVE_PORT = 25568;
const MAIN_CLASS = 'com.mastermind.minecraft.zenith.bootstrap.SecureZenithBootstrapMain';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

async function jsonFile(file, maximumBytes = 16 * 1024) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) {
    fail('LIVE_STAGING_STATE_INVALID');
  }
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fail('LIVE_STAGING_STATE_INVALID'); }
}

function validState(state) {
  const keys = state && typeof state === 'object' && !Array.isArray(state) ? Object.keys(state).sort() : [];
  return JSON.stringify(keys) === JSON.stringify([
    'bootstrapSha256', 'pid', 'pluginSha256', 'port', 'schemaVersion', 'startedAt', 'zenithSha256',
  ])
    && state.schemaVersion === 1
    && Number.isInteger(state.pid) && state.pid > 0 && state.pid <= 0xffffffff
    && state.port === LIVE_PORT
    && typeof state.startedAt === 'string' && !Number.isNaN(Date.parse(state.startedAt))
    && state.zenithSha256 === ZENITH_SHA256
    && state.bootstrapSha256 === BOOTSTRAP_SHA256
    && state.pluginSha256 === PLUGIN_SHA256;
}

async function processSnapshot(pid, powershell) {
  const script = [
    `$value = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'`,
    'if ($null -eq $value) { exit 3 }',
    '[pscustomobject]@{ processId = $value.ProcessId; executablePath = $value.ExecutablePath; commandLine = $value.CommandLine } | ConvertTo-Json -Compress',
  ].join('; ');
  try {
    const { stdout } = await executeFile(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
    ], { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    if (error?.code === 3) return null;
    fail('LIVE_STAGING_PROCESS_INSPECTION_FAILED');
  }
}

function exactProcess(snapshot, expectedJava, stagingRoot) {
  if (!snapshot || snapshot.processId <= 0 || typeof snapshot.executablePath !== 'string'
    || typeof snapshot.commandLine !== 'string') return false;
  const executableMatches = path.resolve(snapshot.executablePath).toLowerCase() === path.resolve(expectedJava).toLowerCase();
  const command = snapshot.commandLine.toLowerCase();
  return executableMatches
    && command.includes(path.resolve(stagingRoot).toLowerCase())
    && command.includes(MAIN_CLASS.toLowerCase());
}

function tcpOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: LIVE_PORT });
    const finish = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(300, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function main() {
  if (process.argv.length !== 2 || process.platform !== 'win32') fail('LIVE_STAGING_STOP_FORBIDDEN');
  const localAppData = process.env.LOCALAPPDATA;
  const systemRoot = process.env.SYSTEMROOT;
  if (typeof localAppData !== 'string' || !path.win32.isAbsolute(localAppData)
    || typeof systemRoot !== 'string' || !path.win32.isAbsolute(systemRoot)) {
    fail('LIVE_STAGING_ROOT_INVALID');
  }

  const familyRoot = path.resolve(localAppData, 'Mastermind', 'minecraft', 'projects', 'family-server');
  const stagingRoot = path.resolve(localAppData, 'Mastermind', 'staging', 'minecraft', 'zenith', '3.5.8+26.2.0-mastermind-secure.1');
  const expectedJava = path.join(familyRoot, 'runtimes', 'java-runtime-epsilon', '25.0.1', 'windows-x64', 'bin', 'java.exe');
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const stateFile = path.join(stagingRoot, 'live-process.v1.json');
  const state = await jsonFile(stateFile);
  if (!validState(state)) fail('LIVE_STAGING_STATE_INVALID');

  const observed = await processSnapshot(state.pid, powershell);
  if (observed === null) {
    await fs.rm(stateFile, { force: true });
    process.stdout.write(`${JSON.stringify({ ok: true, state: 'already-stopped', port: LIVE_PORT })}\n`);
    return;
  }
  if (!exactProcess(observed, expectedJava, stagingRoot)) fail('LIVE_STAGING_PROCESS_MISMATCH');

  process.kill(state.pid);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await processSnapshot(state.pid, powershell) === null && !await tcpOpen()) {
      await fs.rm(stateFile, { force: true });
      process.stdout.write(`${JSON.stringify({ ok: true, state: 'stopped', pid: state.pid, port: LIVE_PORT })}\n`);
      return;
    }
  }
  fail('LIVE_STAGING_STOP_TIMEOUT');
}

main().catch((error) => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/u.test(error.code)
    ? error.code
    : 'LIVE_STAGING_STOP_FAILED';
  process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
  process.exitCode = 1;
});
