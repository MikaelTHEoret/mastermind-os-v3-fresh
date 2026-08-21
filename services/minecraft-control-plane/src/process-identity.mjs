import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/i;
const INSPECTION_TIMEOUT_MS = 5_000;
const MAX_INSPECTION_BYTES = 128 * 1024;
const WINDOWS_ENVIRONMENT_KEYS = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'WINDIR']);

// The script is constant. Its two inputs are validated integers supplied only
// through private environment variables by the local service.
const WINDOWS_INSPECTION_COMMAND = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[int]$targetPid = 0
[int]$targetPort = 0
[void][int]::TryParse($env:MASTERMIND_INSPECT_PID, [ref]$targetPid)
[void][int]::TryParse($env:MASTERMIND_INSPECT_PORT, [ref]$targetPort)
$result = [ordered]@{
  processKnown = $false
  pid = $null
  processName = $null
  executablePath = $null
  commandLine = $null
  creationTime = $null
  tcpKnown = $false
  tcpOccupied = $false
  tcpOwnerPid = $null
  tcpOwnerName = $null
  udpKnown = $false
  udpOccupied = $false
  udpOwnerPid = $null
  udpOwnerName = $null
}

if ($targetPid -gt 0) {
  $process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $targetPid) -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -ne $process) {
    $result.processKnown = $true
    $result.pid = [int]$process.ProcessId
    $result.processName = [string]$process.Name
    $result.executablePath = [string]$process.ExecutablePath
    $result.commandLine = [string]$process.CommandLine
    try {
      $result.creationTime = ([datetime]$process.CreationDate).ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    } catch {
      $result.creationTime = $null
    }
  }
}

if ($targetPort -ge 1 -and $targetPort -le 65535 -and $null -ne (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
  $result.tcpKnown = $true
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $targetPort -ErrorAction SilentlyContinue)
  $owners = @($listeners | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
  $result.tcpOccupied = $owners.Count -gt 0
  if ($owners.Count -eq 1) {
    $result.tcpOwnerPid = [int]$owners[0]
    $owner = Get-Process -Id $owners[0] -ErrorAction SilentlyContinue
    if ($null -ne $owner) { $result.tcpOwnerName = [string]$owner.ProcessName }
  }
}

[int]$targetUdpPort = 0
[void][int]::TryParse($env:MASTERMIND_INSPECT_UDP_PORT, [ref]$targetUdpPort)
if ($targetUdpPort -ge 1 -and $targetUdpPort -le 65535 -and $null -ne (Get-Command Get-NetUDPEndpoint -ErrorAction SilentlyContinue)) {
  $result.udpKnown = $true
  $endpoints = @(Get-NetUDPEndpoint -LocalPort $targetUdpPort -ErrorAction SilentlyContinue)
  $owners = @($endpoints | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
  $result.udpOccupied = $owners.Count -gt 0
  if ($owners.Count -eq 1) {
    $result.udpOwnerPid = [int]$owners[0]
    $owner = Get-Process -Id $owners[0] -ErrorAction SilentlyContinue
    if ($null -ne $owner) { $result.udpOwnerName = [string]$owner.ProcessName }
  }
}

$result | ConvertTo-Json -Compress
`;

function validPid(value) {
  return Number.isInteger(value) && value > 0 && value <= 0xffffffff;
}

function validPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function safeProcessName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > 128 || /[\x00-\x1f\x7f\\/:<>"|]/.test(name)) return null;
  return name;
}

function normalizedExecutable(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 32_768 || !path.isAbsolute(value)) return null;
  const resolved = path.resolve(value.trim()).replaceAll('/', path.sep);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizedWorkingDirectory(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 32_768 || !path.isAbsolute(value)) return null;
  const resolved = path.resolve(value.trim()).replaceAll('/', path.sep);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizedCommandLine(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 65_536 || value.includes('\0')) return null;
  return value.trim();
}

function normalizedCreationTime(value) {
  if (typeof value !== 'string' || !value || value.length > 128) return null;
  if (/^linux-start-ticks:\d{1,32}$/.test(value)) return value;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function windowsChildEnvironment(pid, port, udpPort) {
  const environment = {
    MASTERMIND_INSPECT_PID: String(pid ?? 0),
    MASTERMIND_INSPECT_PORT: String(port ?? 0),
    MASTERMIND_INSPECT_UDP_PORT: String(udpPort ?? 0),
  };
  for (const [key, value] of Object.entries(process.env)) {
    const canonical = key.toUpperCase();
    if (WINDOWS_ENVIRONMENT_KEYS.has(canonical) && typeof value === 'string') environment[canonical] = value;
  }
  return environment;
}

function normalizeWindowsResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let processInfo = null;
  if (value.processKnown === true && validPid(value.pid)) {
    const executablePath = normalizedExecutable(value.executablePath);
    const commandLine = normalizedCommandLine(value.commandLine);
    const creationTime = normalizedCreationTime(value.creationTime);
    if (executablePath && commandLine && creationTime) {
      processInfo = {
        pid: value.pid,
        processName: safeProcessName(value.processName),
        executablePath,
        commandLine,
        creationTime,
      };
    }
  }
  const tcpKnown = value.tcpKnown === true;
  const tcpOccupied = tcpKnown && value.tcpOccupied === true;
  const ownerPid = validPid(value.tcpOwnerPid) ? value.tcpOwnerPid : null;
  const ownerName = safeProcessName(value.tcpOwnerName);
  const udpKnown = value.udpKnown === true;
  const udpOccupied = udpKnown && value.udpOccupied === true;
  const udpOwnerPid = validPid(value.udpOwnerPid) ? value.udpOwnerPid : null;
  const udpOwnerName = safeProcessName(value.udpOwnerName);
  return {
    process: processInfo,
    tcp: {
      known: tcpKnown,
      occupied: tcpOccupied,
      owner: tcpOccupied && (ownerPid || ownerName)
        ? { ...(ownerPid ? { pid: ownerPid } : {}), ...(ownerName ? { processName: ownerName } : {}) }
        : null,
    },
    udp: {
      known: udpKnown,
      occupied: udpOccupied,
      owner: udpOccupied && (udpOwnerPid || udpOwnerName)
        ? { ...(udpOwnerPid ? { pid: udpOwnerPid } : {}), ...(udpOwnerName ? { processName: udpOwnerName } : {}) }
        : null,
    },
  };
}

async function inspectWindows(pid, port, udpPort) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let outputBytes = 0;
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_INSPECTION_COMMAND], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: windowsChildEnvironment(pid, port, udpPort),
    });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, INSPECTION_TIMEOUT_MS);
    timer.unref?.();
    child.once('error', () => finish(null));
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_INSPECTION_BYTES) {
        child.kill();
        finish(null);
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      if (code !== 0) return finish(null);
      try { finish(normalizeWindowsResult(JSON.parse(stdout.trim()))); }
      catch { finish(null); }
    });
  });
}

function decodeJavaProperty(value) {
  return value
    .replace(/\\u([a-f0-9]{4})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\([\\:= ])/g, '$1');
}

async function inspectJavaWorkingDirectory(jcmdExecutable, pid) {
  if (
    !validPid(pid) || typeof jcmdExecutable !== 'string' || !path.isAbsolute(jcmdExecutable)
    || !/^jcmd(?:\.exe)?$/i.test(path.basename(jcmdExecutable))
  ) return null;
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let outputBytes = 0;
    const child = spawn(jcmdExecutable, [String(pid), 'VM.system_properties'], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: windowsChildEnvironment(0, 0, 0),
    });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(null); }, INSPECTION_TIMEOUT_MS);
    timer.unref?.();
    child.once('error', () => finish(null));
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_INSPECTION_BYTES) { child.kill(); finish(null); return; }
      stdout += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      if (code !== 0) return finish(null);
      const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('user.dir='));
      finish(line ? normalizedWorkingDirectory(decodeJavaProperty(line.slice('user.dir='.length))) : null);
    });
  });
}

async function inspectLinuxProcess(pid) {
  if (!validPid(pid)) return null;
  try {
    const [executable, commandBytes, statText, workingDirectoryValue] = await Promise.all([
      fs.readlink(`/proc/${pid}/exe`),
      fs.readFile(`/proc/${pid}/cmdline`),
      fs.readFile(`/proc/${pid}/stat`, 'utf8'),
      fs.readlink(`/proc/${pid}/cwd`),
    ]);
    const close = statText.lastIndexOf(')');
    const fields = close >= 0 ? statText.slice(close + 2).trim().split(/\s+/) : [];
    const executablePath = normalizedExecutable(executable);
    const commandLine = normalizedCommandLine(commandBytes.toString('utf8').replace(/\0+$/, '').replaceAll('\0', '\u0000'));
    const creationTime = /^\d+$/.test(fields[19] ?? '') ? `linux-start-ticks:${fields[19]}` : null;
    const workingDirectory = normalizedWorkingDirectory(workingDirectoryValue);
    if (!executablePath || !commandLine || !creationTime || !workingDirectory) return null;
    return { pid, processName: safeProcessName(path.basename(executablePath)), executablePath, commandLine, creationTime, workingDirectory };
  } catch {
    return null;
  }
}

async function inspectLinuxTcp(port, preferredPid) {
  if (!validPort(port)) return { known: false, occupied: false, owner: null };
  const inodes = new Set();
  let known = false;
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      const text = await fs.readFile(table, 'utf8');
      known = true;
      for (const line of text.split(/\r?\n/).slice(1)) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 10 || fields[3] !== '0A') continue;
        if (Number.parseInt(fields[1]?.split(':').at(-1) ?? '', 16) === port && /^\d+$/.test(fields[9])) inodes.add(fields[9]);
      }
    } catch { /* This TCP table is unavailable. */ }
  }
  if (!known) return { known: false, occupied: false, owner: null };
  if (inodes.size === 0) return { known: true, occupied: false, owner: null };
  const candidates = validPid(preferredPid) ? [String(preferredPid)] : [];
  try {
    for (const entry of await fs.readdir('/proc', { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+$/.test(entry.name) && !candidates.includes(entry.name)) candidates.push(entry.name);
    }
  } catch { /* Ownership will remain unknown. */ }
  for (const candidate of candidates) {
    try {
      const descriptors = await fs.readdir(`/proc/${candidate}/fd`);
      let ownsSocket = false;
      for (const descriptor of descriptors) {
        try {
          const link = await fs.readlink(`/proc/${candidate}/fd/${descriptor}`);
          const match = link.match(/^socket:\[(\d+)]$/);
          if (match && inodes.has(match[1])) { ownsSocket = true; break; }
        } catch { /* Descriptors can disappear while inspected. */ }
      }
      if (!ownsSocket) continue;
      const pid = Number(candidate);
      const info = await inspectLinuxProcess(pid);
      return { known: true, occupied: true, owner: { pid, ...(info?.processName ? { processName: info.processName } : {}) } };
    } catch { /* The process exited or was not inspectable. */ }
  }
  return { known: true, occupied: true, owner: null };
}

async function inspectLinuxUdp(port, preferredPid) {
  if (!validPort(port)) return { known: false, occupied: false, owner: null };
  const inodes = new Set();
  let known = false;
  for (const table of ['/proc/net/udp', '/proc/net/udp6']) {
    try {
      const text = await fs.readFile(table, 'utf8');
      known = true;
      for (const line of text.split(/\r?\n/).slice(1)) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 10) continue;
        if (Number.parseInt(fields[1]?.split(':').at(-1) ?? '', 16) === port && /^\d+$/.test(fields[9])) inodes.add(fields[9]);
      }
    } catch { /* This UDP table is unavailable. */ }
  }
  if (!known) return { known: false, occupied: false, owner: null };
  if (inodes.size === 0) return { known: true, occupied: false, owner: null };
  const candidates = validPid(preferredPid) ? [String(preferredPid)] : [];
  try {
    for (const entry of await fs.readdir('/proc', { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+$/.test(entry.name) && !candidates.includes(entry.name)) candidates.push(entry.name);
    }
  } catch { /* Ownership will remain unknown. */ }
  for (const candidate of candidates) {
    try {
      for (const descriptor of await fs.readdir(`/proc/${candidate}/fd`)) {
        try {
          const link = await fs.readlink(`/proc/${candidate}/fd/${descriptor}`);
          const match = link.match(/^socket:\[(\d+)]$/);
          if (!match || !inodes.has(match[1])) continue;
          const pid = Number(candidate);
          const info = await inspectLinuxProcess(pid);
          return { known: true, occupied: true, owner: { pid, ...(info?.processName ? { processName: info.processName } : {}) } };
        } catch { /* Descriptors can disappear while inspected. */ }
      }
    } catch { /* The process exited or was not inspectable. */ }
  }
  return { known: true, occupied: true, owner: null };
}

export async function inspectManagedProcessState({ pid = null, port = null, udpPort = null, jcmdExecutable = null } = {}) {
  if (pid !== null && !validPid(pid)) throw new TypeError('Invalid process identity PID');
  if (port !== null && !validPort(port)) throw new TypeError('Invalid managed TCP port');
  if (udpPort !== null && !validPort(udpPort)) throw new TypeError('Invalid managed UDP port');
  if (jcmdExecutable !== null && (typeof jcmdExecutable !== 'string' || !path.isAbsolute(jcmdExecutable))) {
    throw new TypeError('Invalid trusted jcmd executable');
  }
  if (process.platform === 'win32') {
    const state = await inspectWindows(pid, port, udpPort);
    if (state?.process && jcmdExecutable) {
      state.process.workingDirectory = await inspectJavaWorkingDirectory(jcmdExecutable, pid);
    }
    return state;
  }
  if (process.platform === 'linux') {
    const [processInfo, tcp, udp] = await Promise.all([
      inspectLinuxProcess(pid), inspectLinuxTcp(port, pid), inspectLinuxUdp(udpPort, pid),
    ]);
    return { process: processInfo, tcp, udp };
  }
  return null;
}

export function createManagedProcessIdentity(processInfo, { instanceId, executable, args, cwd, capturedAt = new Date().toISOString() }) {
  if (!processInfo || !validPid(processInfo.pid)) throw new Error('Spawned process identity could not be inspected');
  const observedExecutable = normalizedExecutable(processInfo.executablePath);
  const expectedExecutable = normalizedExecutable(executable);
  const commandLine = normalizedCommandLine(processInfo.commandLine);
  const creationTime = normalizedCreationTime(processInfo.creationTime);
  if (
    typeof instanceId !== 'string' || !instanceId || !observedExecutable || !expectedExecutable
    || observedExecutable !== expectedExecutable || !commandLine || !creationTime
  ) throw new Error('Spawned process identity did not match the exact managed executable');
  if (!Array.isArray(args) || args.some((item) => typeof item !== 'string') || typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
    throw new TypeError('Managed spawn specification is invalid');
  }
  return {
    schemaVersion: 1,
    owner: 'mastermind-family-server',
    instanceId,
    pid: processInfo.pid,
    processName: safeProcessName(processInfo.processName),
    creationTime,
    executablePathSha256: fingerprint(observedExecutable),
    commandLineSha256: fingerprint(commandLine),
    workingDirectorySha256: fingerprint(normalizedWorkingDirectory(cwd)),
    spawnSpecSha256: fingerprint(canonicalJson({ executable: expectedExecutable, args, cwd: path.resolve(cwd) })),
    capturedAt: normalizedCreationTime(capturedAt) ?? new Date().toISOString(),
  };
}

export function managedProcessIdentityMatches(identity, processInfo) {
  if (
    !identity || identity.schemaVersion !== 1 || identity.owner !== 'mastermind-family-server'
    || typeof identity.instanceId !== 'string' || !identity.instanceId || !validPid(identity.pid)
    || !SHA256.test(identity.executablePathSha256 ?? '') || !SHA256.test(identity.commandLineSha256 ?? '')
    || !SHA256.test(identity.spawnSpecSha256 ?? '') || !SHA256.test(identity.workingDirectorySha256 ?? '')
    || !normalizedCreationTime(identity.creationTime)
    || !processInfo || processInfo.pid !== identity.pid
  ) return false;
  const executable = normalizedExecutable(processInfo.executablePath);
  const commandLine = normalizedCommandLine(processInfo.commandLine);
  const creationTime = normalizedCreationTime(processInfo.creationTime);
  const workingDirectory = normalizedWorkingDirectory(processInfo.workingDirectory);
  return Boolean(
    executable && commandLine && workingDirectory && creationTime === normalizedCreationTime(identity.creationTime)
    && fingerprint(executable) === identity.executablePathSha256.toLowerCase()
    && fingerprint(commandLine) === identity.commandLineSha256.toLowerCase()
    && fingerprint(workingDirectory) === identity.workingDirectorySha256.toLowerCase()
  );
}

function windowsCommandLineToArgv(value) {
  const args = [];
  let index = 0;
  while (index < value.length) {
    while (/\s/.test(value[index] ?? '')) index += 1;
    if (index >= value.length) break;
    let argument = '';
    let quoted = false;
    while (index < value.length) {
      if (!quoted && /\s/.test(value[index])) break;
      let slashes = 0;
      while (value[index] === '\\') { slashes += 1; index += 1; }
      if (value[index] === '"') {
        argument += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2 === 1) argument += '"';
        else quoted = !quoted;
        index += 1;
        continue;
      }
      argument += '\\'.repeat(slashes);
      if (index < value.length) { argument += value[index]; index += 1; }
    }
    args.push(argument);
  }
  return args;
}

export function processMatchesExpectedSpawn(processInfo, { executable, args, cwd }) {
  const commandLine = normalizedCommandLine(processInfo?.commandLine);
  const expectedExecutable = normalizedExecutable(executable);
  const observedExecutable = normalizedExecutable(processInfo?.executablePath);
  const expectedDirectory = normalizedWorkingDirectory(cwd);
  const observedDirectory = normalizedWorkingDirectory(processInfo?.workingDirectory);
  if (
    !commandLine || !expectedExecutable || observedExecutable !== expectedExecutable
    || !expectedDirectory || observedDirectory !== expectedDirectory
    || !Array.isArray(args) || args.some((item) => typeof item !== 'string')
  ) return false;
  const observedArgs = process.platform === 'win32'
    ? windowsCommandLineToArgv(commandLine)
    : commandLine.split('\\u0000');
  if (observedArgs.length !== args.length + 1 || normalizedExecutable(observedArgs[0]) !== expectedExecutable) return false;
  return args.every((argument, index) => observedArgs[index + 1] === argument);
}

export function sanitizedTcpOwner(value) {
  const pid = validPid(value?.pid) ? value.pid : null;
  const processName = safeProcessName(value?.processName);
  return pid || processName ? { ...(pid ? { pid } : {}), ...(processName ? { processName } : {}) } : null;
}
