import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectManagedProcessState } from '../process-identity.mjs';

const TOKEN_ENVIRONMENT_KEY = 'MASTERMIND_COMPANION_BRIDGE_TOKEN';
const SESSION_ENVIRONMENT_KEY = 'MASTERMIND_FAMILY_BRIDGE_SESSION_ID';
const FAMILY_SERVER_PORT_ENVIRONMENT_KEY = 'MASTERMIND_FAMILY_SERVER_PORT';
const FAMILY_COMPANION_OWNER = 'mastermind-family-companion';
const MAX_CREDENTIAL_FRAME_BYTES = 4 + 32 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const VERSION_TEXT = /^[A-Za-z0-9][A-Za-z0-9._+\-]{0,63}$/u;
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const ACTIVE_STATES = new Set(['starting', 'running', 'stopping']);
const MANIFEST_KEYS = Object.freeze([
  'clientId',
  'bridgeVersion',
  'minecraftVersion',
  'loaderVersion',
  'baritoneVersion',
]);
const RESERVED_ENVIRONMENT_KEYS = new Set([
  TOKEN_ENVIRONMENT_KEY,
  SESSION_ENVIRONMENT_KEY,
  FAMILY_SERVER_PORT_ENVIRONMENT_KEY,
]);
const INHERITED_ENVIRONMENT_KEYS = new Set([
  'APPDATA', 'HOME', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR',
]);

export class CompanionLifecycleError extends Error {
  constructor(statusCode, code, message, options) {
    super(message, options);
    this.name = 'CompanionLifecycleError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function lifecycleError(statusCode, code, message, cause) {
  return new CompanionLifecycleError(statusCode, code, message, cause ? { cause } : undefined);
}

function validPid(value) {
  return Number.isInteger(value) && value > 0 && value <= 0xffffffff;
}

function validPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function isoTimestamp(value, label) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new TypeError(`${label} must be a valid timestamp`);
  return new Date(timestamp).toISOString();
}

function normalizedPath(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 32_768 || value.includes('\0') || !path.isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  const resolved = path.resolve(value.trim()).replaceAll('/', path.sep);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function safeProcessName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > 128 || /[\x00-\x1f\x7f\\/:<>"|]/u.test(name)) return null;
  return name;
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

function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('version manifest must be an object');
  const keys = Object.keys(value).sort();
  if (keys.length !== MANIFEST_KEYS.length || MANIFEST_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`version manifest must contain exactly: ${MANIFEST_KEYS.join(', ')}`);
  }
  if (value.clientId !== 'family-ai-client') throw new TypeError("version manifest clientId must be 'family-ai-client'");
  for (const key of MANIFEST_KEYS.slice(1)) {
    if (typeof value[key] !== 'string' || !VERSION_TEXT.test(value[key])) {
      throw new TypeError(`version manifest ${key} is invalid`);
    }
  }
  return Object.freeze(Object.fromEntries(MANIFEST_KEYS.map((key) => [key, value[key]])));
}

function validateCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('companion command must be an object');
  const executable = normalizedPath(value.executable, 'companion executable');
  const cwd = normalizedPath(value.cwd, 'companion working directory');
  if (!Array.isArray(value.args) || value.args.length > 256 || value.args.some((item) => (
    typeof item !== 'string' || item.length > 8_192 || item.includes('\0')
  ))) throw new TypeError('companion args must be a bounded string array');
  const commandLineCharacters = executable.length + value.args.reduce((total, item) => total + item.length + 3, 0);
  if (commandLineCharacters > 30_000) throw new TypeError('companion command exceeds the safe Win32 command-line budget');
  let jcmdExecutable = null;
  if (value.jcmdExecutable !== undefined && value.jcmdExecutable !== null) {
    jcmdExecutable = normalizedPath(value.jcmdExecutable, 'trusted jcmd executable');
    if (!/^jcmd(?:\.exe)?$/iu.test(path.basename(jcmdExecutable))) {
      throw new TypeError('trusted jcmd executable must name jcmd or jcmd.exe');
    }
  }
  const env = {};
  if (value.env !== undefined) {
    if (!value.env || typeof value.env !== 'object' || Array.isArray(value.env)) throw new TypeError('companion env must be an object');
    const entries = Object.entries(value.env);
    if (entries.length > 128) throw new TypeError('companion env has too many entries');
    for (const [key, item] of entries) {
      if (!ENVIRONMENT_KEY.test(key) || typeof item !== 'string' || item.length > 32_768 || item.includes('\0')) {
        throw new TypeError('companion env entries must be bounded strings with valid keys');
      }
      if (RESERVED_ENVIRONMENT_KEYS.has(key.toUpperCase())) {
        throw new TypeError(`companion env key '${key}' is reserved`);
      }
      env[key] = item;
    }
  }
  return {
    executable,
    args: [...value.args],
    cwd,
    env,
    jcmdExecutable,
  };
}

function windowsCommandLineToArgv(value) {
  const args = [];
  let index = 0;
  while (index < value.length) {
    while (/\s/u.test(value[index] ?? '')) index += 1;
    if (index >= value.length) break;
    let argument = '';
    let quoted = false;
    while (index < value.length) {
      if (!quoted && /\s/u.test(value[index])) break;
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

function processCommandMatches(processInfo, command) {
  if (!processInfo || !validPid(processInfo.pid)) return false;
  let observedExecutable;
  try { observedExecutable = normalizedPath(processInfo.executablePath, 'observed executable'); }
  catch { return false; }
  if (observedExecutable !== command.executable) return false;
  if (typeof processInfo.commandLine !== 'string' || !processInfo.commandLine.trim() || processInfo.commandLine.length > 65_536) return false;
  const observedArgs = process.platform === 'win32'
    ? windowsCommandLineToArgv(processInfo.commandLine.trim())
    : processInfo.commandLine.split('\0');
  if (observedArgs.length !== command.args.length + 1) return false;
  let argvExecutable;
  try { argvExecutable = normalizedPath(observedArgs[0], 'command-line executable'); }
  catch { return false; }
  return argvExecutable === command.executable && command.args.every((argument, index) => observedArgs[index + 1] === argument);
}

function createCompanionProcessIdentity(processInfo, command, launchId, capturedAt) {
  if (!processCommandMatches(processInfo, command)) {
    throw new Error('Observed process command did not exactly match the managed companion spawn');
  }
  const creationTime = isoTimestamp(processInfo.creationTime, 'observed process creationTime');
  const observedExecutable = normalizedPath(processInfo.executablePath, 'observed executable');
  // Win32_Process does not expose cwd. Without a separately hash-pinned jcmd,
  // bind cwd through the owned spawn specification and exact command line.
  const observedWorkingDirectory = processInfo.workingDirectory == null && process.platform === 'win32' && command.jcmdExecutable === null
    ? command.cwd
    : normalizedPath(processInfo.workingDirectory, 'observed working directory');
  const commandLine = processInfo.commandLine.trim();
  if (observedWorkingDirectory !== command.cwd) {
    throw new Error('Observed process working directory did not match the managed companion spawn');
  }
  return {
    schemaVersion: 1,
    owner: FAMILY_COMPANION_OWNER,
    launchId,
    pid: processInfo.pid,
    processName: safeProcessName(processInfo.processName),
    creationTime,
    executablePathSha256: fingerprint(observedExecutable),
    commandLineSha256: fingerprint(commandLine),
    workingDirectorySha256: fingerprint(command.cwd),
    spawnSpecSha256: fingerprint(canonicalJson({
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
    })),
    capturedAt,
  };
}

function companionProcessIdentityMatches(identity, processInfo, command) {
  if (
    !identity || identity.schemaVersion !== 1 || identity.owner !== FAMILY_COMPANION_OWNER
    || !UUID.test(identity.launchId ?? '') || !validPid(identity.pid)
    || !SHA256.test(identity.executablePathSha256 ?? '') || !SHA256.test(identity.commandLineSha256 ?? '')
    || !SHA256.test(identity.workingDirectorySha256 ?? '') || !SHA256.test(identity.spawnSpecSha256 ?? '')
    || !processInfo || processInfo.pid !== identity.pid || !processCommandMatches(processInfo, command)
  ) return false;
  let observedExecutable;
  let creationTime;
  try {
    observedExecutable = normalizedPath(processInfo.executablePath, 'observed executable');
    creationTime = isoTimestamp(processInfo.creationTime, 'observed process creationTime');
    const observedWorkingDirectory = processInfo.workingDirectory == null && process.platform === 'win32' && command.jcmdExecutable === null
      ? command.cwd
      : normalizedPath(processInfo.workingDirectory, 'observed working directory');
    if (observedWorkingDirectory !== command.cwd) return false;
  } catch { return false; }
  return creationTime === identity.creationTime
    && fingerprint(observedExecutable) === identity.executablePathSha256
    && fingerprint(processInfo.commandLine.trim()) === identity.commandLineSha256
    && fingerprint(command.cwd) === identity.workingDirectorySha256
    && fingerprint(canonicalJson({ executable: command.executable, args: command.args, cwd: command.cwd })) === identity.spawnSpecSha256;
}

function managedChildEnvironment(extraEnvironment, bridgeToken, sessionId, familyServerPort) {
  const result = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (INHERITED_ENVIRONMENT_KEYS.has(key.toUpperCase()) && typeof value === 'string') result[key] = value;
  }
  Object.assign(result, extraEnvironment);
  result[TOKEN_ENVIRONMENT_KEY] = bridgeToken;
  result[SESSION_ENVIRONMENT_KEY] = sessionId;
  result[FAMILY_SERVER_PORT_ENVIRONMENT_KEY] = String(familyServerPort);
  return result;
}

function defaultRecord(now) {
  return {
    schemaVersion: 1,
    owner: FAMILY_COMPANION_OWNER,
    state: 'stopped',
    launchId: null,
    sessionId: null,
    pid: null,
    bridgeTokenSha256: null,
    versionManifest: null,
    processIdentity: null,
    startedAt: null,
    stoppedAt: null,
    updatedAt: now,
    lastExit: null,
    lastError: null,
  };
}

function sanitizePersistedRecord(value, now) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultRecord(now);
  const record = defaultRecord(now);
  const allowedStates = new Set(['stopped', 'starting', 'running', 'stopping', 'failed', 'orphaned']);
  if (allowedStates.has(value.state)) record.state = value.state;
  if (UUID.test(value.launchId ?? '')) record.launchId = value.launchId;
  if (UUID.test(value.sessionId ?? '')) record.sessionId = value.sessionId;
  if (validPid(value.pid)) record.pid = value.pid;
  if (SHA256.test(value.bridgeTokenSha256 ?? '')) record.bridgeTokenSha256 = value.bridgeTokenSha256.toLowerCase();
  try { if (value.versionManifest) record.versionManifest = validateManifest(value.versionManifest); } catch { /* Invalid evidence is discarded. */ }
  const identity = value.processIdentity;
  if (
    identity && identity.schemaVersion === 1 && identity.owner === FAMILY_COMPANION_OWNER
    && UUID.test(identity.launchId ?? '') && validPid(identity.pid)
    && SHA256.test(identity.executablePathSha256 ?? '') && SHA256.test(identity.commandLineSha256 ?? '')
    && SHA256.test(identity.workingDirectorySha256 ?? '') && SHA256.test(identity.spawnSpecSha256 ?? '')
  ) record.processIdentity = clone(identity);
  for (const key of ['startedAt', 'stoppedAt', 'updatedAt']) {
    try { if (value[key]) record[key] = isoTimestamp(value[key], key); } catch { /* Invalid timestamps are discarded. */ }
  }
  if (value.lastExit && typeof value.lastExit === 'object' && !Array.isArray(value.lastExit)) {
    const code = value.lastExit.code === null || Number.isInteger(value.lastExit.code) ? value.lastExit.code : null;
    const signal = typeof value.lastExit.signal === 'string' && value.lastExit.signal.length <= 32 ? value.lastExit.signal : null;
    try {
      record.lastExit = { code, signal, at: isoTimestamp(value.lastExit.at, 'lastExit.at') };
    } catch { /* Invalid exit evidence is discarded. */ }
  }
  if (typeof value.lastError === 'string' && value.lastError.length <= 512 && !/[\x00-\x1f\x7f]/u.test(value.lastError)) {
    record.lastError = value.lastError;
  }
  return record;
}

function waitForExit(entry, timeoutMs) {
  if (entry.exitResult) return Promise.resolve(entry.exitResult);
  let timer;
  return Promise.race([
    entry.exitPromise,
    new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs, null); }),
  ]).finally(() => clearTimeout(timer));
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

export class CompanionLifecycleManager {
  #operationQueue = Promise.resolve();

  constructor(options = {}) {
    if (typeof options.stateFile !== 'string' || !path.isAbsolute(options.stateFile)) {
      throw new TypeError('An absolute companion lifecycle stateFile is required');
    }
    this.stateFile = path.resolve(options.stateFile);
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.inspectProcessState = options.inspectProcessState ?? inspectManagedProcessState;
    this.persistRecord = options.persistRecord ?? null;
    this.bridgeControl = options.bridgeControl ?? null;
    this.now = options.now ?? (() => new Date());
    this.randomBytes = options.randomBytes ?? crypto.randomBytes;
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
    this.captureTimeoutMs = options.captureTimeoutMs ?? 5_000;
    this.inspectPollMs = options.inspectPollMs ?? 50;
    if (
      typeof this.spawnProcess !== 'function' || typeof this.inspectProcessState !== 'function'
      || (this.persistRecord !== null && typeof this.persistRecord !== 'function')
    ) {
      throw new TypeError('Companion lifecycle process hooks must be functions');
    }
    if (!Number.isInteger(this.captureTimeoutMs) || this.captureTimeoutMs < 10 || this.captureTimeoutMs > 30_000) {
      throw new TypeError('captureTimeoutMs must be an integer between 10 and 30000');
    }
    if (!Number.isInteger(this.inspectPollMs) || this.inspectPollMs < 1 || this.inspectPollMs > 1_000) {
      throw new TypeError('inspectPollMs must be an integer between 1 and 1000');
    }
    this.initialized = false;
    this.record = defaultRecord(this.#now());
    this.childEntry = null;
    this.activeCommand = null;
  }

  async initialize() {
    if (this.initialized) return this.status();
    try {
      const parsed = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (parsed?.schemaVersion !== 1) throw new Error('Unsupported companion lifecycle state schema');
      this.record = sanitizePersistedRecord(parsed.companion, this.#now());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.record = defaultRecord(this.#now());
    }
    if (ACTIVE_STATES.has(this.record.state)) {
      this.record = {
        ...this.record,
        state: 'orphaned',
        updatedAt: this.#now(),
        lastError: 'The control plane restarted without the exact spawned child handle; bridge authentication and PID termination are disabled.',
      };
      await this.#persist();
    }
    this.initialized = true;
    return this.status();
  }

  status() {
    return this.publicStatus();
  }

  isActive() {
    return this.childEntry !== null || ACTIVE_STATES.has(this.record.state) || this.record.state === 'orphaned';
  }

  publicStatus() {
    const {
      bridgeTokenSha256: _bridgeTokenSha256,
      processIdentity: _processIdentity,
      ...safe
    } = this.record;
    return clone(safe);
  }

  launch(specification) {
    return this.#serialize(async () => {
      try { return await this.#launch(specification); }
      finally { if (Buffer.isBuffer(specification?.credentialFrame)) specification.credentialFrame.fill(0); }
    });
  }

  async #launch(specification) {
    this.#assertInitialized();
    if (this.childEntry || ACTIVE_STATES.has(this.record.state) || this.record.state === 'orphaned') {
      throw lifecycleError(409, 'COMPANION_ALREADY_ACTIVE', 'A managed Family AI companion launch is already active or orphaned.');
    }
    if (!specification || typeof specification !== 'object' || Array.isArray(specification)) {
      throw new TypeError('companion launch specification must be an object');
    }
    const launchKeys = ['command', 'manifest', 'familyServerPort', 'credentialFrame'];
    if (Object.keys(specification).length !== launchKeys.length || launchKeys.some((key) => !Object.hasOwn(specification, key))) {
      throw new TypeError('companion launch specification must contain exactly the trusted launch fields');
    }
    const command = validateCommand(specification.command);
    const versionManifest = validateManifest(specification.manifest);
    if (!validPort(specification.familyServerPort)) {
      throw new TypeError('familyServerPort must be an internally derived integer from 1 through 65535');
    }
    if (!Buffer.isBuffer(specification.credentialFrame) || specification.credentialFrame.length < 18 || specification.credentialFrame.length > MAX_CREDENTIAL_FRAME_BYTES) {
      throw new TypeError('credentialFrame must be a bounded private Buffer');
    }
    const launchId = this.randomUUID();
    const sessionId = this.randomUUID();
    if (!UUID.test(launchId) || !UUID.test(sessionId)) throw new Error('Secure UUID generation failed');
    const bridgeToken = Buffer.from(this.randomBytes(32)).toString('base64url');
    if (!/^[A-Za-z0-9_-]{43}$/u.test(bridgeToken)) throw new Error('Secure bridge token generation failed');
    const credentialFrame = Buffer.from(specification.credentialFrame);
    specification.credentialFrame.fill(0);
    const bridgeTokenSha256 = fingerprint(bridgeToken);
    const startedAt = this.#now();
    this.record = {
      schemaVersion: 1,
      owner: FAMILY_COMPANION_OWNER,
      state: 'starting',
      launchId,
      sessionId,
      pid: null,
      bridgeTokenSha256,
      versionManifest,
      processIdentity: null,
      startedAt,
      stoppedAt: null,
      updatedAt: startedAt,
      lastExit: null,
      lastError: null,
    };
    try { await this.#persist(); }
    catch (error) {
      credentialFrame.fill(0);
      throw error;
    }

    let child;
    try {
      child = this.spawnProcess(command.executable, command.args, {
        cwd: command.cwd,
        env: managedChildEnvironment(command.env, bridgeToken, sessionId, specification.familyServerPort),
        shell: false,
        windowsHide: true,
        detached: false,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    } catch (error) {
      credentialFrame.fill(0);
      await this.#failLaunch('The managed companion process could not be spawned.', error);
      throw lifecycleError(500, 'COMPANION_SPAWN_FAILED', 'The managed companion process could not be spawned.', error);
    }
    let entry;
    try { entry = this.#trackChild(child, launchId); }
    catch (error) {
      credentialFrame.fill(0);
      try { child?.kill?.('SIGTERM'); } catch { /* The invalid handle cannot be trusted further. */ }
      await this.#failLaunch('The managed companion process returned an invalid child handle.');
      throw lifecycleError(500, 'COMPANION_SPAWN_FAILED', 'The managed companion process returned an invalid child handle.', error);
    }
    this.childEntry = entry;
    this.activeCommand = command;
    const spawned = await entry.spawnPromise;
    if (!spawned.ok || !validPid(child.pid)) {
      credentialFrame.fill(0);
      if (this.childEntry === entry) this.childEntry = null;
      this.activeCommand = null;
      await this.#failLaunch('The managed companion process did not expose a valid spawned child.', spawned.error);
      throw lifecycleError(500, 'COMPANION_SPAWN_FAILED', 'The managed companion process did not expose a valid spawned child.', spawned.error);
    }
    try {
      await this.#writeCredentialFrame(entry, credentialFrame);
    } catch (error) {
      let persistenceError = null;
      try { await this.#failLaunch('The managed companion credential channel failed.'); }
      catch (failure) { persistenceError = failure; }
      try { await this.#terminateEntry(entry, 1_000); } catch { /* The fixed pipe failure remains authoritative. */ }
      if (this.childEntry !== entry) this.activeCommand = null;
      if (persistenceError) {
        throw lifecycleError(500, 'COMPANION_STATE_PERSIST_FAILED', 'The managed companion launch was aborted because lifecycle state could not be committed.', persistenceError);
      }
      throw lifecycleError(500, 'COMPANION_CREDENTIAL_PIPE_FAILED', 'The managed companion credential channel failed.', error);
    } finally {
      credentialFrame.fill(0);
    }
    this.record = { ...this.record, pid: child.pid, updatedAt: this.#now() };
    try { await this.#persist(); }
    catch (error) { await this.#abortTrackedLaunchAfterPersistenceFailure(entry, error); }

    let processIdentity;
    try {
      processIdentity = await this.#captureIdentity(entry, command);
    } catch (error) {
      this.record = {
        ...this.record,
        state: 'failed',
        updatedAt: this.#now(),
        lastError: 'Spawned companion identity did not match the exact managed launch.',
      };
      try { await this.#persist(); }
      catch (persistenceError) { await this.#abortTrackedLaunchAfterPersistenceFailure(entry, persistenceError); }
      await this.#terminateEntry(entry, 1_000);
      this.activeCommand = null;
      throw lifecycleError(409, 'COMPANION_IDENTITY_UNVERIFIED', 'Spawned companion identity did not match the exact managed launch.', error);
    }
    if (entry.exitResult || this.childEntry !== entry) {
      this.activeCommand = null;
      throw lifecycleError(409, 'COMPANION_EXITED_DURING_START', 'The managed companion exited before launch identity verification completed.');
    }
    this.record = {
      ...this.record,
      state: 'running',
      processIdentity,
      updatedAt: this.#now(),
      lastError: null,
    };
    try { await this.#persist(); }
    catch (error) { await this.#abortTrackedLaunchAfterPersistenceFailure(entry, error); }
    return this.status();
  }

  async authenticateBridgeToken({ token: value } = {}) {
    const expected = SHA256.test(this.record.bridgeTokenSha256 ?? '')
      ? Buffer.from(this.record.bridgeTokenSha256, 'hex')
      : Buffer.alloc(32);
    const validToken = typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
    const candidate = crypto.createHash('sha256').update(typeof value === 'string' ? value : '', 'utf8').digest();
    const matches = crypto.timingSafeEqual(expected, candidate);
    if (
      !validToken || !matches || this.record.state !== 'running' || !this.childEntry
      || !validPid(this.record.pid) || this.childEntry.child.pid !== this.record.pid
    ) return null;
    return { sessionId: this.record.sessionId, expectedPid: this.record.pid };
  }

  async verifyHello(payload, context) {
    if (
      this.record.state !== 'running' || !this.childEntry || !this.activeCommand
      || !payload || typeof payload !== 'object' || Array.isArray(payload)
      || !context || context.sessionId !== this.record.sessionId || context.expectedPid !== this.record.pid
      || payload.pid !== this.record.pid || payload.clientId !== this.record.versionManifest?.clientId
    ) return false;
    for (const key of MANIFEST_KEYS.slice(1)) {
      if (payload[key] !== this.record.versionManifest[key]) return false;
    }
    let state;
    try {
      state = await this.inspectProcessState({
        pid: this.record.pid,
        port: null,
        udpPort: null,
        jcmdExecutable: this.activeCommand.jcmdExecutable,
      });
    } catch { return false; }
    return companionProcessIdentityMatches(this.record.processIdentity, state?.process, this.activeCommand);
  }

  stop(options = {}) {
    return this.#serialize(() => this.#stop(options));
  }

  async #stop(options) {
    this.#assertInitialized();
    const gracefulTimeoutMs = options.gracefulTimeoutMs ?? 15_000;
    const terminationTimeoutMs = options.terminationTimeoutMs ?? 5_000;
    for (const [label, value] of [['gracefulTimeoutMs', gracefulTimeoutMs], ['terminationTimeoutMs', terminationTimeoutMs]]) {
      if (!Number.isInteger(value) || value < 1 || value > 120_000) throw new TypeError(`${label} must be an integer between 1 and 120000`);
    }
    const entry = this.childEntry;
    if (!entry) {
      if (this.record.state === 'orphaned') {
        throw lifecycleError(409, 'COMPANION_CHILD_HANDLE_UNAVAILABLE', 'The prior companion PID is recorded but its exact spawned child handle is unavailable; no PID termination was attempted.');
      }
      return this.status();
    }
    this.record = { ...this.record, state: 'stopping', updatedAt: this.#now(), lastError: null };
    await this.#persist();
    if (this.bridgeControl && typeof this.bridgeControl.requestShutdown === 'function') {
      try {
        // The session manager may expose either a synchronous result or an
        // asynchronous adapter. Observe rejection without replacing the
        // authoritative wait for the exact spawned child to exit.
        Promise.resolve(this.bridgeControl.requestShutdown(gracefulTimeoutMs)).catch(() => undefined);
      }
      catch { /* A disconnected bridge falls through to exact child-handle termination. */ }
    }
    if (!await waitForExit(entry, gracefulTimeoutMs)) {
      await this.#terminateEntry(entry, terminationTimeoutMs);
    }
    if (entry.exitCommitPromise) await entry.exitCommitPromise;
    if (this.childEntry === entry) {
      throw lifecycleError(409, 'COMPANION_TERMINATION_FAILED', 'The exact managed companion child did not exit after termination fallback.');
    }
    return this.status();
  }

  async #captureIdentity(entry, command) {
    const deadline = Date.now() + this.captureTimeoutMs;
    let cause = null;
    do {
      if (entry.exitResult || this.childEntry !== entry) throw new Error('Companion exited during process identity capture');
      try {
        const state = await this.inspectProcessState({
          pid: entry.child.pid,
          port: null,
          udpPort: null,
          jcmdExecutable: command.jcmdExecutable,
        });
        if (state?.process) return createCompanionProcessIdentity(state.process, command, entry.launchId, this.#now());
      } catch (error) { cause = error; }
      await delay(this.inspectPollMs);
    } while (Date.now() < deadline);
    throw cause ?? new Error('Spawned companion process identity was not inspectable');
  }

  async #writeCredentialFrame(entry, credentialFrame) {
    const input = entry?.child?.stdin;
    if (!input || typeof input.once !== 'function' || typeof input.end !== 'function' || input.destroyed === true) {
      throw new Error('Managed companion stdin was unavailable');
    }
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      const onError = (error) => finish(error ?? new Error('Managed companion stdin failed'));
      input.once('error', onError);
      try { input.end(credentialFrame, (error) => finish(error)); }
      catch (error) { finish(error); }
    });
  }

  #trackChild(child, launchId) {
    if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function') {
      throw new TypeError('spawnProcess must return a ChildProcess-compatible handle');
    }
    let resolveExit;
    const entry = {
      child,
      launchId,
      exitResult: null,
      exitCommitPromise: null,
      exitPromise: new Promise((resolve) => { resolveExit = resolve; }),
      spawnPromise: null,
    };
    entry.spawnPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        child.off?.('spawn', onSpawn);
        child.off?.('error', onError);
        resolve(result);
      };
      const onSpawn = () => finish({ ok: true });
      const onError = (error) => finish({ ok: false, error });
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
    child.once('exit', (code, signal) => {
      entry.exitResult = { code: Number.isInteger(code) ? code : null, signal: typeof signal === 'string' ? signal : null };
      entry.exitCommitPromise = this.#commitExit(entry, entry.exitResult);
      resolveExit(entry.exitResult);
    });
    return entry;
  }

  async #commitExit(entry, result) {
    if (this.childEntry !== entry || this.record.launchId !== entry.launchId) return;
    const failed = this.record.state === 'failed' || (this.record.state !== 'stopping' && result.code !== 0 && result.signal === null);
    this.childEntry = null;
    this.activeCommand = null;
    const at = this.#now();
    this.record = {
      ...this.record,
      state: failed ? 'failed' : 'stopped',
      pid: null,
      stoppedAt: at,
      updatedAt: at,
      lastExit: { ...result, at },
      lastError: failed ? (this.record.lastError ?? `Companion exited with code ${result.code ?? 'unknown'}.`) : null,
    };
    await this.#persist();
  }

  async #terminateEntry(entry, timeoutMs) {
    if (entry.exitResult || this.childEntry !== entry) return;
    let signalled = false;
    try { signalled = entry.child.kill('SIGTERM') !== false; } catch { signalled = false; }
    if (!signalled && !entry.exitResult) {
      throw lifecycleError(409, 'COMPANION_TERMINATION_FAILED', 'The exact managed companion child rejected termination.');
    }
    if (await waitForExit(entry, timeoutMs)) {
      if (entry.exitCommitPromise) await entry.exitCommitPromise;
      return;
    }
    try { signalled = entry.child.kill('SIGKILL') !== false; } catch { signalled = false; }
    if (!signalled || !await waitForExit(entry, timeoutMs)) {
      throw lifecycleError(409, 'COMPANION_TERMINATION_FAILED', 'The exact managed companion child did not exit after termination.');
    }
    if (entry.exitCommitPromise) await entry.exitCommitPromise;
  }

  async #abortTrackedLaunchAfterPersistenceFailure(entry, cause) {
    this.record = {
      ...this.record,
      state: 'failed',
      updatedAt: this.#now(),
      lastError: 'The managed companion launch was aborted because lifecycle state could not be committed.',
    };
    // The exact spawned child handle is the only termination authority here.
    // If it rejects termination, retain both the handle and active command so
    // status remains active and a later explicit stop can retry safely.
    try { await this.#terminateEntry(entry, 1_000); }
    catch { /* The fixed persistence failure remains authoritative. */ }
    if (this.childEntry !== entry) this.activeCommand = null;
    throw lifecycleError(500, 'COMPANION_STATE_PERSIST_FAILED', 'The managed companion launch was aborted because lifecycle state could not be committed.', cause);
  }

  async #failLaunch(message) {
    this.record = {
      ...this.record,
      state: 'failed',
      pid: null,
      updatedAt: this.#now(),
      lastError: message,
    };
    await this.#persist();
  }

  async #persist() {
    if (this.persistRecord) {
      await this.persistRecord(clone(this.record));
      return;
    }
    const temporary = `${this.stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, companion: this.record }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.stateFile);
  }

  #serialize(operation) {
    const current = this.#operationQueue.catch(() => undefined).then(operation);
    this.#operationQueue = current;
    return current;
  }

  #assertInitialized() {
    if (!this.initialized) throw new Error('CompanionLifecycleManager.initialize() must complete first');
  }

  #now() {
    return isoTimestamp(this.now(), 'now');
  }
}

export const COMPANION_BRIDGE_TOKEN_ENV = TOKEN_ENVIRONMENT_KEY;
export const COMPANION_BRIDGE_SESSION_ENV = SESSION_ENVIRONMENT_KEY;
export const COMPANION_FAMILY_SERVER_PORT_ENV = FAMILY_SERVER_PORT_ENVIRONMENT_KEY;
