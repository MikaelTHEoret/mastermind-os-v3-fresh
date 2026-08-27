import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LEGACY_STATE_SCHEMA_VERSION = 1;
const STATE_SCHEMA_VERSION = 2;
const STATE_SCHEMA_VERSIONS = new Set([LEGACY_STATE_SCHEMA_VERSION, STATE_SCHEMA_VERSION]);
const MAX_STATE_BYTES = 64 * 1024;
const MAX_KEY_BYTES = 256;
const EXPECTED_PORTS = Object.freeze([3000, 43100]);
const ACTIVE_ROLES = new Set(['supervisor', 'minecraft-control-agent', 'next-web', 'mastermind-node-link']);
const WINDOWS_IDENTITY_PROBE = String.raw`
$source = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class MastermindLocalProcessIdentity {
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_BASIC_INFORMATION {
    public IntPtr Reserved1;
    public IntPtr PebBaseAddress;
    public IntPtr Reserved2_0;
    public IntPtr Reserved2_1;
    public IntPtr UniqueProcessId;
    public IntPtr InheritedFromUniqueProcessId;
  }
  [DllImport("ntdll.dll")]
  public static extern int NtQueryInformationProcess(
    IntPtr ProcessHandle,
    int ProcessInformationClass,
    ref PROCESS_BASIC_INFORMATION ProcessInformation,
    int ProcessInformationLength,
    out int ReturnLength);
  [StructLayout(LayoutKind.Sequential)]
  public struct UNICODE_STRING {
    public ushort Length;
    public ushort MaximumLength;
    public IntPtr Buffer;
  }
  [DllImport("ntdll.dll", EntryPoint = "NtQueryInformationProcess")]
  public static extern int NtQueryInformationProcessBuffer(
    IntPtr ProcessHandle,
    int ProcessInformationClass,
    IntPtr ProcessInformation,
    int ProcessInformationLength,
    out int ReturnLength);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(int DesiredAccess, bool InheritHandle, int ProcessId);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool ReadProcessMemory(
    IntPtr ProcessHandle, IntPtr BaseAddress, byte[] Buffer, int Size, out IntPtr BytesRead);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr Handle);
  [DllImport("kernel32.dll")]
  public static extern bool IsWow64Process(IntPtr ProcessHandle, out bool IsWow64);
  [DllImport("shell32.dll", SetLastError = true)]
  public static extern IntPtr CommandLineToArgvW(
    [MarshalAs(UnmanagedType.LPWStr)] string CommandLine, out int ArgumentCount);
  [DllImport("kernel32.dll")]
  public static extern IntPtr LocalFree(IntPtr Memory);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool QueryFullProcessImageName(
    IntPtr ProcessHandle, int Flags, System.Text.StringBuilder Text, ref int Size);
  public static string GetCommandLine(int processId) {
    const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
    if (process == IntPtr.Zero) throw new InvalidOperationException("Could not open the process identity");
    try {
      int requiredLength;
      NtQueryInformationProcessBuffer(process, 60, IntPtr.Zero, 0, out requiredLength);
      if (requiredLength <= 0 || requiredLength > 1048576) throw new InvalidOperationException("Invalid command-line size");
      IntPtr buffer = Marshal.AllocHGlobal(requiredLength);
      try {
        int actualLength;
        int status = NtQueryInformationProcessBuffer(process, 60, buffer, requiredLength, out actualLength);
        if (status != 0) throw new InvalidOperationException("Could not query the process command line");
        var value = (UNICODE_STRING)Marshal.PtrToStructure(buffer, typeof(UNICODE_STRING));
        return Marshal.PtrToStringUni(value.Buffer, value.Length / 2);
      } finally {
        Marshal.FreeHGlobal(buffer);
      }
    } finally {
      CloseHandle(process);
    }
  }
  public static int GetParentProcessId(int processId) {
    const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
    if (process == IntPtr.Zero) throw new InvalidOperationException("Could not open the process identity");
    try {
      var basic = new PROCESS_BASIC_INFORMATION();
      int returnLength;
      int status = NtQueryInformationProcess(process, 0, ref basic, Marshal.SizeOf(basic), out returnLength);
      if (status != 0) throw new InvalidOperationException("Could not inspect the native parent process");
      return (int)basic.InheritedFromUniqueProcessId.ToInt64();
    } finally {
      CloseHandle(process);
    }
  }
  public static string GetExecutablePath(int processId) {
    const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
    if (process == IntPtr.Zero) throw new InvalidOperationException("Could not open the process identity");
    try {
      int size = 32768;
      var text = new System.Text.StringBuilder(size);
      if (!QueryFullProcessImageName(process, 0, text, ref size)) {
        throw new InvalidOperationException("Could not inspect the process executable");
      }
      return text.ToString();
    } finally {
      CloseHandle(process);
    }
  }
  private static byte[] ReadRemote(IntPtr process, IntPtr address, int length) {
    var bytes = new byte[length];
    IntPtr bytesRead;
    if (!ReadProcessMemory(process, address, bytes, length, out bytesRead) || bytesRead.ToInt64() != length) {
      throw new InvalidOperationException("Could not read the process identity");
    }
    return bytes;
  }
  private static IntPtr ReadRemotePointer(IntPtr process, IntPtr address) {
    var bytes = ReadRemote(process, address, IntPtr.Size);
    return IntPtr.Size == 8
      ? new IntPtr(BitConverter.ToInt64(bytes, 0))
      : new IntPtr(BitConverter.ToInt32(bytes, 0));
  }
  private static string ReadRemoteUnicodeString(IntPtr process, IntPtr address) {
    var header = ReadRemote(process, address, IntPtr.Size == 8 ? 16 : 8);
    int length = BitConverter.ToUInt16(header, 0);
    if (length < 0 || length > 32768 || length % 2 != 0) throw new InvalidOperationException("Invalid process path length");
    long pointer = IntPtr.Size == 8 ? BitConverter.ToInt64(header, 8) : BitConverter.ToInt32(header, 4);
    return System.Text.Encoding.Unicode.GetString(ReadRemote(process, new IntPtr(pointer), length));
  }
  public static string GetCurrentDirectory(int processId) {
    const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const int PROCESS_VM_READ = 0x0010;
    IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, false, processId);
    if (process == IntPtr.Zero) throw new InvalidOperationException("Could not open the process identity");
    try {
      bool wow64;
      if (IntPtr.Size != 8 || (IsWow64Process(process, out wow64) && wow64)) {
        throw new InvalidOperationException("Cross-architecture process identity is unsupported");
      }
      var basic = new PROCESS_BASIC_INFORMATION();
      int returnLength;
      int status = NtQueryInformationProcess(process, 0, ref basic, Marshal.SizeOf(basic), out returnLength);
      if (status != 0) throw new InvalidOperationException("Could not query the process identity");
      IntPtr parameters = ReadRemotePointer(process, IntPtr.Add(basic.PebBaseAddress, 0x20));
      return ReadRemoteUnicodeString(process, IntPtr.Add(parameters, 0x38));
    } finally {
      CloseHandle(process);
    }
  }
  public static string[] SplitCommandLine(string commandLine) {
    int count;
    IntPtr values = CommandLineToArgvW(commandLine, out count);
    if (values == IntPtr.Zero || count < 1 || count > 256) throw new InvalidOperationException("Could not parse the command line");
    try {
      var result = new string[count];
      for (int index = 0; index < count; index++) {
        result[index] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(values, index * IntPtr.Size));
      }
      return result;
    } finally {
      LocalFree(values);
    }
  }
}
'@
Add-Type -TypeDefinition $source
function Get-MastermindParentProcessId($process) {
  return [MastermindLocalProcessIdentity]::GetParentProcessId([int]$process.Id)
}
function Get-MastermindCommandLine($process) {
  return [MastermindLocalProcessIdentity]::GetCommandLine([int]$process.Id)
}
function Get-MastermindExecutablePath($process) {
  return [MastermindLocalProcessIdentity]::GetExecutablePath([int]$process.Id)
}
function Get-MastermindWorkingDirectory($process) {
  return [MastermindLocalProcessIdentity]::GetCurrentDirectory([int]$process.Id)
}
`;

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function runPowerShell(script, timeout = 8_000) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)],
    { windowsHide: true, timeout, maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

function normalizedPath(value) {
  if (typeof value !== 'string' || !value) return null;
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizedResolvedPath(value) {
  try {
    return normalizedPath(realpathSync.native(value));
  } catch {
    return normalizedPath(value);
  }
}

function expectedPathMatches(value, expected) {
  const observed = normalizedPath(value);
  return observed === normalizedPath(expected) || observed === normalizedResolvedPath(expected);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function unsignedState(state) {
  const { signature: _signature, ...unsigned } = state;
  return unsigned;
}

function signState(state, key) {
  return crypto.createHmac('sha256', key).update(canonicalJson(unsignedState(state))).digest('hex');
}

function validateRecord(record, role) {
  if (
    !record || record.role !== role || !ACTIVE_ROLES.has(role)
    || !Number.isInteger(record.pid) || record.pid < 1
    || typeof record.startFileTime !== 'string' || !/^\d{12,20}$/.test(record.startFileTime)
    || typeof record.executablePath !== 'string' || !path.isAbsolute(record.executablePath)
    || typeof record.workingDirectory !== 'string' || !path.isAbsolute(record.workingDirectory)
    || typeof record.commandLineSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.commandLineSha256)
    || !Number.isInteger(record.parentPid) || record.parentPid < 1
    || typeof record.entrypoint !== 'string' || !path.isAbsolute(record.entrypoint)
  ) throw new Error(`The recorded ${role} identity is incomplete`);
}

function validateStateShape(state, expectedWorkspace) {
  const workspace = path.resolve(expectedWorkspace);
  const maximumChildren = state?.schemaVersion === LEGACY_STATE_SCHEMA_VERSION ? 2 : 3;
  if (
    !state || !STATE_SCHEMA_VERSIONS.has(state.schemaVersion)
    || typeof state.supervisorId !== 'string' || !/^[a-f0-9]{32}$/.test(state.supervisorId)
    || normalizedPath(state.workspace) !== normalizedPath(expectedWorkspace)
    || !Array.isArray(state.ports) || state.ports.length !== EXPECTED_PORTS.length
    || state.ports.some((port, index) => port !== EXPECTED_PORTS[index])
    || !Array.isArray(state.children) || state.children.length > maximumChildren
    || typeof state.createdAt !== 'string' || !Number.isFinite(Date.parse(state.createdAt))
    || !['development', 'production'].includes(state.mode)
    || typeof state.pipeName !== 'string' || state.pipeName.length < 8 || state.pipeName.length > 240
  ) throw new Error('The local-control ownership record does not belong to this workspace');
  validateRecord(state.supervisor, 'supervisor');
  if (
    normalizedPath(state.supervisor.entrypoint) !== normalizedPath(path.join(workspace, 'scripts', 'run-local-control.mjs'))
    || normalizedPath(state.supervisor.workingDirectory) !== normalizedPath(workspace)
  ) {
    throw new Error('The ownership record names an unexpected supervisor entrypoint');
  }
  const seenRoles = new Set();
  const expectedChildren = new Map([
    ['minecraft-control-agent', { port: 43100, entrypoint: path.join(workspace, 'services', 'minecraft-control-plane', 'src', 'agent.mjs') }],
    ['next-web', { port: 3000, entrypoint: path.join(workspace, 'node_modules', 'next', 'dist', 'bin', 'next') }],
    ...(state.schemaVersion === STATE_SCHEMA_VERSION ? [[
      'mastermind-node-link',
      {
        port: null,
        entrypoint: path.join(workspace, 'services', 'mastermind-node-link', 'src', 'run-worker.mjs'),
      },
    ]] : []),
  ]);
  for (const child of state.children) {
    validateRecord(child, child?.role);
    if (child.role === 'supervisor' || seenRoles.has(child.role)) throw new Error('The ownership record contains invalid child roles');
    const expected = expectedChildren.get(child.role);
    if (
      !expected || child.port !== expected.port
      || !expectedPathMatches(child.entrypoint, expected.entrypoint)
      || normalizedPath(child.workingDirectory) !== normalizedPath(workspace)
      || (child.parentPid != null && child.parentPid !== state.supervisor.pid)
    ) throw new Error('The ownership record contains an unexpected child identity');
    seenRoles.add(child.role);
  }
  return state;
}

async function readBoundedRegularFile(file, maximumBytes) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) {
    throw new Error(`${path.basename(file)} is not a safe managed file`);
  }
  return fs.readFile(file);
}

async function atomicWriteJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export class SupervisorStateStore {
  constructor(dataRoot) {
    this.controlRoot = path.join(path.resolve(dataRoot), 'control');
    this.stateFile = path.join(this.controlRoot, 'local-control-supervisor.json');
    this.keyFile = path.join(this.controlRoot, 'local-control-supervisor.key');
  }

  async initialize() {
    await fs.mkdir(this.controlRoot, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.controlRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The local-control state directory is unsafe');
  }

  async #readKey({ create = false } = {}) {
    try {
      const raw = await readBoundedRegularFile(this.keyFile, MAX_KEY_BYTES);
      const text = raw.toString('utf8').trim();
      if (!/^[a-f0-9]{64}$/.test(text)) throw new Error('The local-control signing key is invalid');
      return Buffer.from(text, 'hex');
    } catch (error) {
      if (error?.code !== 'ENOENT' || !create) throw error;
      const key = crypto.randomBytes(32);
      try {
        await fs.writeFile(this.keyFile, `${key.toString('hex')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        return key;
      } catch (writeError) {
        if (writeError?.code !== 'EEXIST') throw writeError;
        return this.#readKey();
      }
    }
  }

  async read(expectedWorkspace) {
    let raw;
    try {
      raw = await readBoundedRegularFile(this.stateFile, MAX_STATE_BYTES);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    let state;
    try {
      state = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new Error('The local-control ownership record is not valid JSON');
    }
    const key = await this.#readKey();
    if (typeof state.signature !== 'string' || !/^[a-f0-9]{64}$/.test(state.signature)) {
      throw new Error('The local-control ownership record has no valid signature');
    }
    const expectedSignature = signState(state, key);
    const actual = Buffer.from(state.signature, 'hex');
    const expected = Buffer.from(expectedSignature, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw new Error('The local-control ownership record failed authentication');
    }
    return validateStateShape(state, expectedWorkspace);
  }

  async write(state, expectedWorkspace) {
    validateStateShape({ ...state, signature: '0'.repeat(64) }, expectedWorkspace);
    const key = await this.#readKey({ create: true });
    const signed = { ...unsignedState(state) };
    signed.signature = signState(signed, key);
    await atomicWriteJson(this.stateFile, signed);
    return signed;
  }

  async removeIfOwned(supervisorId, expectedWorkspace) {
    let state;
    try {
      state = await this.read(expectedWorkspace);
    } catch {
      return false;
    }
    if (!state || state.supervisorId !== supervisorId) return false;
    await fs.rm(this.stateFile, { force: true });
    return true;
  }

  async removeStale() {
    await fs.rm(this.stateFile, { force: true });
  }
}

export async function inspectProcess(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 0);
      const executablePath = await fs.readlink(`/proc/${pid}/exe`);
      const stat = await fs.stat(`/proc/${pid}`);
      const commandLine = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean).join(' ');
      return {
        pid,
        startFileTime: String(Math.trunc(stat.birthtimeMs * 10_000 + 116444736000000000)),
        executablePath,
        commandLine,
        parentPid: null,
      };
    } catch {
      return null;
    }
  }
  const script = `
$ErrorActionPreference = 'Stop'
${WINDOWS_IDENTITY_PROBE}
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($null -eq $p) { @{ exists = $false } | ConvertTo-Json -Compress; exit 0 }
$commandLine = $null
$parentPid = $null
$workingDirectory = $null
$executablePath = $p.Path
$processArguments = $null
try {
  $cim = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop
  if ($null -ne $cim) { $commandLine = $cim.CommandLine; $parentPid = [int]$cim.ParentProcessId }
} catch {}
if ($null -eq $commandLine) {
  try { $commandLine = Get-MastermindCommandLine $p } catch {}
}
if ($null -eq $parentPid) {
  try { $parentPid = Get-MastermindParentProcessId $p } catch {}
}
try { $workingDirectory = Get-MastermindWorkingDirectory $p } catch {}
if ($null -eq $executablePath) {
  try { $executablePath = Get-MastermindExecutablePath $p } catch {}
}
if ($null -ne $commandLine) {
  try { $processArguments = [MastermindLocalProcessIdentity]::SplitCommandLine([string]$commandLine) } catch {}
}
@{
  exists = $true
  pid = [int]$p.Id
  startFileTime = $p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
  executablePath = $executablePath
  commandLine = $commandLine
  arguments = $processArguments
  parentPid = $parentPid
  workingDirectory = $workingDirectory
} | ConvertTo-Json -Compress
`;
  const output = await runPowerShell(script);
  const result = JSON.parse(output);
  return result.exists ? result : null;
}

export function processIdentity(role, entrypoint, snapshot) {
  if (
    !snapshot || typeof snapshot.executablePath !== 'string' || !path.isAbsolute(snapshot.executablePath)
    || typeof snapshot.workingDirectory !== 'string' || !path.isAbsolute(snapshot.workingDirectory)
    || typeof snapshot.commandLine !== 'string' || !snapshot.commandLine
    || !Number.isInteger(snapshot.parentPid) || snapshot.parentPid < 1
  ) throw new Error(`Could not capture the complete process identity for ${role}`);
  return {
    role,
    pid: snapshot.pid,
    parentPid: snapshot.parentPid,
    startFileTime: snapshot.startFileTime,
    executablePath: path.resolve(snapshot.executablePath),
    workingDirectory: path.resolve(snapshot.workingDirectory),
    commandLineSha256: sha256(snapshot.commandLine),
    entrypoint: path.resolve(entrypoint),
  };
}

export function identityMatches(record, snapshot) {
  if (!snapshot || record.pid !== snapshot.pid) return false;
  if (record.startFileTime !== snapshot.startFileTime) return false;
  if (normalizedPath(record.executablePath) !== normalizedPath(snapshot.executablePath)) return false;
  if (normalizedPath(record.workingDirectory) !== normalizedPath(snapshot.workingDirectory)) return false;
  if (typeof snapshot.commandLine !== 'string' || !snapshot.commandLine || sha256(snapshot.commandLine) !== record.commandLineSha256) return false;
  if (!Number.isInteger(snapshot.parentPid) || record.parentPid !== snapshot.parentPid) return false;
  return true;
}

export async function isTcpPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') resolve(false);
      else reject(error);
    });
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

export async function takeOverLegacyLocalControl(options) {
  const {
    checkPort = isTcpPortFree,
  } = options;
  const availability = await Promise.all(EXPECTED_PORTS.map(async (port) => [port, await checkPort(port)]));
  if (availability.every(([, free]) => free)) return { action: 'none' };
  const busy = availability.filter(([, free]) => !free).map(([port]) => port);
  throw Object.assign(new Error(
    `An unsupervised local command center or another process still owns port${busy.length === 1 ? '' : 's'} ${busy.join(', ')}. Stop the Family Server in the old UI, close its command-center terminal, then start Mastermind again. Nothing was terminated automatically because that older generation cannot atomically block a concurrent Start.`
  ), { code: 'LEGACY_MANUAL_SHUTDOWN_REQUIRED' });
}

async function waitForPortsFree(checkPort, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const availability = await Promise.all(EXPECTED_PORTS.map(async (port) => [port, await checkPort(port)]));
    if (availability.every(([, free]) => free)) return;
    if (Date.now() >= deadline) {
      const busy = availability.filter(([, free]) => !free).map(([port]) => port);
      throw new Error(`Local-control port${busy.length === 1 ? '' : 's'} ${busy.join(', ')} remain occupied by an unverified process. No unrelated process was terminated.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (true);
}

async function waitForExactProcessExit(record, inspect, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const current = await inspect(record.pid);
    if (!current || !identityMatches(record, current)) return;
    if (Date.now() >= deadline) {
      throw new Error(`The prior ${record.role} confirmed its drain but did not exit. The replacement generation was not started.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
}

export async function stopPreviousSupervisor(options) {
  const {
    store,
    workspace,
    inspect = inspectProcess,
    checkPort = isTcpPortFree,
    requestGracefulTakeover = async () => false,
  } = options;
  let state;
  try {
    state = await store.read(workspace);
  } catch (error) {
    const portsFree = (await Promise.all(EXPECTED_PORTS.map(checkPort))).every(Boolean);
    if (portsFree) {
      await store.removeStale();
      return { action: 'cleaned-invalid-state', warning: error.message };
    }
    throw new Error(`${error.message}. Refusing to terminate any process from an unauthenticated record.`);
  }
  if (!state) {
    return takeOverLegacyLocalControl({ checkPort });
  }

  const records = [...state.children, state.supervisor];
  const snapshots = new Map();
  for (const record of records) snapshots.set(record.pid, await inspect(record.pid));
  const exact = records.filter((record) => identityMatches(record, snapshots.get(record.pid)));
  const mismatchedLive = records.filter((record) => snapshots.get(record.pid) && !identityMatches(record, snapshots.get(record.pid)));

  if (mismatchedLive.length > 0) {
    const portsFree = (await Promise.all(EXPECTED_PORTS.map(checkPort))).every(Boolean);
    if (portsFree && exact.length === 0) {
      await store.removeStale();
      return { action: 'cleaned-reused-pids' };
    }
    throw new Error('A recorded PID now belongs to a different process. PID reuse protection refused the takeover; no unrelated process was terminated.');
  }

  if (exact.length === 0) {
    await store.removeStale();
    const legacy = await takeOverLegacyLocalControl({ checkPort });
    return legacy.action === 'none' ? { action: 'cleaned-stale' } : legacy;
  }

  const graceful = await requestGracefulTakeover(state).catch(() => false);
  if (!graceful) {
    const expectedChildCount = state.schemaVersion === LEGACY_STATE_SCHEMA_VERSION ? 2 : 3;
    if (state.children.length !== expectedChildCount) {
      throw new Error('The prior signed Mastermind supervisor has an incomplete starting inventory. It was left running because an unrecorded local-control child may still exist.');
    }
    const liveManagedChild = state.children.some((record) => (
      ['minecraft-control-agent', 'next-web'].includes(record.role)
      && identityMatches(record, snapshots.get(record.pid))
    ));
    if (liveManagedChild) {
      throw new Error('The prior signed Mastermind supervisor did not confirm a safe Minecraft drain. Its agent and UI were left running; no process was terminated.');
    }
    throw new Error('The prior signed Mastermind supervisor did not confirm a safe drain. It was left running; no process was terminated.');
  } else {
    await waitForPortsFree(checkPort);
    await waitForExactProcessExit(state.supervisor, inspect);
  }
  await store.removeStale();
  return { action: graceful ? 'graceful-takeover' : 'exact-takeover' };
}

export function createInitialState({ workspace, mode, supervisor, pipeName }) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    supervisorId: crypto.randomBytes(16).toString('hex'),
    workspace: path.resolve(workspace),
    mode,
    ports: [...EXPECTED_PORTS],
    pipeName,
    createdAt: new Date().toISOString(),
    supervisor,
    children: [],
  };
}

export const LOCAL_CONTROL_PORTS = EXPECTED_PORTS;
export const LOCAL_CONTROL_STATE_SCHEMA_VERSION = STATE_SCHEMA_VERSION;
export const LEGACY_LOCAL_CONTROL_STATE_SCHEMA_VERSION = LEGACY_STATE_SCHEMA_VERSION;
