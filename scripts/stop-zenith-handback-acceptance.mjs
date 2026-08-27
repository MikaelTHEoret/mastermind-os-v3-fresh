import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

function fail(code) {
  throw Object.assign(new Error(code), { code });
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

async function processSnapshot(pid, powershell) {
  const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($null -eq $p){exit 3}; [pscustomobject]@{ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine}|ConvertTo-Json -Compress`;
  try {
    const { stdout } = await executeFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 });
    return JSON.parse(stdout);
  } catch (error) {
    if (error?.code === 3) return null;
    fail('HANDBACK_PROCESS_INSPECTION_FAILED');
  }
}

async function main() {
  if (process.argv.length !== 2 || process.platform !== 'win32') fail('HANDBACK_STOP_FORBIDDEN');
  const localAppData = process.env.LOCALAPPDATA;
  const systemRoot = process.env.SYSTEMROOT;
  if (typeof localAppData !== 'string' || !path.win32.isAbsolute(localAppData)
    || typeof systemRoot !== 'string' || !path.win32.isAbsolute(systemRoot)) fail('HANDBACK_ROOT_INVALID');
  const parent = path.resolve(localAppData, 'Mastermind', 'staging', 'minecraft', 'zenith', 'handback-acceptance');
  const activeFile = path.join(parent, 'active.v1.json');
  const stat = await fs.lstat(activeFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024) fail('HANDBACK_STATE_INVALID');
  const state = JSON.parse(await fs.readFile(activeFile, 'utf8'));
  if (state?.schemaVersion !== 1 || !Number.isInteger(state.serverPid) || !Number.isInteger(state.zenithPid)
    || state.serverPort !== 25569 || state.proxyPort !== 25568 || typeof state.runRoot !== 'string'
    || !path.resolve(state.runRoot).startsWith(`${parent}${path.sep}`)) fail('HANDBACK_STATE_INVALID');
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  for (const [pid, marker] of [[state.zenithPid, state.runRoot], [state.serverPid, state.runRoot]]) {
    const observed = await processSnapshot(pid, powershell);
    if (observed === null) continue;
    const commandLine = observed.CommandLine ?? observed.commandLine;
    if (typeof commandLine !== 'string' || !commandLine.toLowerCase().includes(marker.toLowerCase())) {
      fail('HANDBACK_PROCESS_MISMATCH');
    }
    process.kill(pid);
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!await portOpen(state.proxyPort) && !await portOpen(state.serverPort)) {
      await fs.rm(activeFile, { force: true });
      process.stdout.write(`${JSON.stringify({ ok: true, state: 'stopped', runRoot: state.runRoot })}\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('HANDBACK_STOP_TIMEOUT');
}

main().catch((error) => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/u.test(error.code) ? error.code : 'HANDBACK_STOP_FAILED';
  process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
  process.exitCode = 1;
});
