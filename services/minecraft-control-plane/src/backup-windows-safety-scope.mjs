import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { borrowHeldWindowsDirectoryGuard } from './windows-filesystem-safety.mjs';

const DIRECTORY_HELPER = fileURLToPath(new URL('../../../scripts/guard-minecraft-world-directories-session.ps1', import.meta.url));
const FILE_HELPER = fileURLToPath(new URL('../../../scripts/guard-minecraft-world-files-session.ps1', import.meta.url));
const VERIFIER_HELPER = fileURLToPath(new URL('../../../scripts/inspect-minecraft-world-files-session.ps1', import.meta.url));

const HARD_MAX_HANDLES_PER_WORKER = 256;
const HARD_POOL_LIMITS = Object.freeze({ directory: 64, file: 2, verifier: 1 });
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_LINE_BYTES = 1_048_576;
const NATIVE_IDENTITY = /^[0-9a-f]{8}:[0-9a-f]{16}$/;
const CANONICAL_UINT64 = /^(?:0|[1-9][0-9]{0,19})$/;
const GENERATION = /^(?:[1-9][0-9]{0,18})$/;
const RESERVED_DEVICE_BASENAME = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i;
const INVALID_WINDOWS_COMPONENT = /[\x00-\x1f<>:"|?*]/;

let brokerSequence = 0;

function unsafeWorldFilesystem(cause) {
  const error = Object.assign(new Error('The managed world contains unsafe Windows filesystem metadata.'), {
    code: 'WORLD_INTEGRITY_FAILED',
    statusCode: 409,
  });
  if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause, configurable: true });
  return error;
}

function asUnsafe(error) {
  return error?.code === 'WORLD_INTEGRITY_FAILED' ? error : unsafeWorldFilesystem(error);
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw new TypeError(`Invalid ${label}`);
  }
  return selected;
}

function powershellExecutable(windowsRoot = process.env.SystemRoot ?? process.env.WINDIR) {
  if (typeof windowsRoot !== 'string' || !path.win32.isAbsolute(windowsRoot)) return 'powershell.exe';
  return path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function isDeviceNamespace(value) {
  const normalized = value.replaceAll('/', '\\');
  return /^(?:\\\\[.?]\\|\\\\\?\?\\|\\\?\?\\)/i.test(normalized);
}

function unsafeWindowsComponent(component) {
  if (!component || component === '.' || component === '..' || /[ .]$/.test(component)
    || INVALID_WINDOWS_COMPONENT.test(component)) return true;
  const basename = component.split('.', 1)[0].replace(/[ .:]+$/g, '');
  return RESERVED_DEVICE_BASENAME.test(basename);
}

function normalizeWindowsPath(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 30_000
    || !path.win32.isAbsolute(value) || isDeviceNamespace(value) || value.includes('\0')) {
    throw unsafeWorldFilesystem();
  }
  const separatorNormalized = value.replaceAll('/', '\\');
  const inputRoot = path.win32.parse(separatorNormalized).root;
  const fullyQualifiedDrive = /^[a-z]:\\$/i.test(inputRoot);
  const fullyQualifiedUnc = !inputRoot.includes(':') && /^\\\\[^\\]+\\[^\\]+\\$/.test(inputRoot);
  if (!fullyQualifiedDrive && !fullyQualifiedUnc) throw unsafeWorldFilesystem();
  const relative = separatorNormalized.slice(inputRoot.length);
  const components = relative.split('\\');
  if (relative.includes(':') || components.length < 1 || components.some(unsafeWindowsComponent)) {
    throw unsafeWorldFilesystem();
  }
  let resolved;
  try { resolved = path.win32.resolve(separatorNormalized); } catch { throw unsafeWorldFilesystem(); }
  const root = path.win32.parse(resolved).root;
  if (!root || resolved.length <= root.length || resolved.slice(root.length).includes(':')
    || resolved !== separatorNormalized) {
    throw unsafeWorldFilesystem();
  }
  return { requested: value, normalized: resolved.toLowerCase() };
}

function validateRequestedPaths(values, platform, label) {
  if (!Array.isArray(values) || values.length < 1 || values.length > HARD_MAX_HANDLES_PER_WORKER) {
    throw new TypeError(`${label} must contain between 1 and ${HARD_MAX_HANDLES_PER_WORKER} paths`);
  }
  const seen = new Set();
  return values.map((value) => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 30_000) {
      throw unsafeWorldFilesystem();
    }
    const entry = platform === 'win32'
      ? normalizeWindowsPath(value)
      : { requested: value, normalized: path.resolve(value) };
    if (seen.has(entry.normalized)) throw unsafeWorldFilesystem();
    seen.add(entry.normalized);
    return entry;
  });
}

function validateVerifierRequest(root, options, platform) {
  if (platform !== 'win32') return null;
  const normalized = normalizeWindowsPath(root);
  const maxEntries = options.maxEntries ?? 500_000;
  const maxDepth = options.maxDepth ?? 64;
  const recursive = options.recursive ?? true;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 500_000
    || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 64 || typeof recursive !== 'boolean') {
    throw new TypeError('Invalid Windows filesystem verification limits');
  }
  return { root: normalized.requested, maxEntries, maxDepth, recursive };
}

class PersistentWorker {
  constructor(scope, kind, helper, capacity) {
    this.scope = scope;
    this.kind = kind;
    this.capacity = capacity;
    this.activeCount = 0;
    this.reservedCount = 0;
    this.activeSlots = new Map();
    this.lastSlotGeneration = new Map();
    this.outputBuffer = Buffer.alloc(0);
    this.responseWaiter = null;
    this.commandTail = Promise.resolve();
    this.expectedClose = false;
    this.closeAcknowledged = false;
    this.stdoutEnded = false;
    this.exited = false;
    this.exitCode = null;
    this.fatalError = null;
    this.resolveExit = null;
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve; });

    let child;
    try {
      child = scope.spawnProcess(powershellExecutable(scope.windowsRoot), [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
      ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch (error) {
      throw asUnsafe(error);
    }
    if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function'
      || typeof child.stdout?.on !== 'function' || typeof child.stdout?.once !== 'function'
      || typeof child.stdin?.write !== 'function' || typeof child.stdin?.once !== 'function') {
      try { child?.kill?.(); } catch { /* the malformed helper is already untrusted */ }
      throw unsafeWorldFilesystem();
    }
    this.child = child;
    this.processId = Number.isInteger(child.pid) ? child.pid : null;
    try { this.#wireProcess(); } catch (error) {
      try { child.kill(); } catch { /* listener setup already failed closed */ }
      throw asUnsafe(error);
    }
  }

  #wireProcess() {
    this.child.once('error', (error) => this.#fail(error, false));
    this.child.once('close', (code) => {
      this.exited = true;
      this.exitCode = code;
      this.resolveExit();
      if (!this.fatalError && (!this.expectedClose || !this.closeAcknowledged
        || code !== 0 || !this.stdoutEnded || this.outputBuffer.length !== 0)) {
        this.#fail(undefined, false);
      }
    });
    this.child.stdout.on('data', (chunk) => this.#consumeBytes(chunk));
    this.child.stdout.once('end', () => {
      this.stdoutEnded = true;
      if (!this.fatalError && (!this.expectedClose || !this.closeAcknowledged || this.outputBuffer.length !== 0)) {
        this.#fail();
      }
    });
    this.child.stdin.once('error', (error) => {
      if (!this.fatalError && (!this.expectedClose || this.responseWaiter)) this.#fail(error);
    });
    this.child.stdin.once('close', () => {
      if (!this.fatalError && !this.expectedClose) this.#fail();
    });
  }

  #consumeBytes(chunk) {
    if (this.fatalError) return;
    const bytes = Buffer.from(chunk);
    if (bytes.length === 0 || this.outputBuffer.length + bytes.length > MAX_LINE_BYTES) {
      this.#fail();
      return;
    }
    this.outputBuffer = Buffer.concat([this.outputBuffer, bytes]);
    while (!this.fatalError) {
      const newline = this.outputBuffer.indexOf(0x0a);
      if (newline < 0) break;
      let line = this.outputBuffer.subarray(0, newline).toString('utf8');
      this.outputBuffer = this.outputBuffer.subarray(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length < 2 || line !== line.trim() || !this.responseWaiter) {
        this.#fail();
        return;
      }
      let response;
      try { response = JSON.parse(line); } catch {
        this.#fail();
        return;
      }
      const waiter = this.responseWaiter;
      this.responseWaiter = null;
      clearTimeout(waiter.timer);
      try {
        waiter.resolve(waiter.consume(response));
      } catch (error) {
        const fatal = this.#fail(error);
        waiter.reject(fatal);
      }
    }
  }

  #fail(error, kill = true) {
    if (!this.fatalError) this.fatalError = this.scope.poison(asUnsafe(error), this);
    if (this.responseWaiter) {
      const waiter = this.responseWaiter;
      this.responseWaiter = null;
      clearTimeout(waiter.timer);
      waiter.reject(this.fatalError);
    }
    if (kill && !this.exited) {
      try { this.child.kill(); } catch { /* the scope remains poisoned */ }
    }
    return this.fatalError;
  }

  abort(error) {
    this.fatalError ??= error;
    if (this.responseWaiter) {
      const waiter = this.responseWaiter;
      this.responseWaiter = null;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    if (!this.exited) {
      try { this.child.kill(); } catch { /* the scope remains poisoned */ }
    }
  }

  canReserve(count) {
    return !this.fatalError && !this.exited && !this.expectedClose
      && this.activeCount + this.reservedCount + count <= this.capacity;
  }

  reserve(count) {
    if (!this.canReserve(count)) throw unsafeWorldFilesystem();
    this.reservedCount += count;
  }

  cancelReservation(count) {
    this.reservedCount = Math.max(0, this.reservedCount - count);
  }

  request(payload, consume, { allowClosing = false, timeoutMs = this.scope.requestTimeoutMs } = {}) {
    const execute = async () => {
      if (this.fatalError || this.exited || (!allowClosing && this.expectedClose)) {
        throw this.fatalError ?? unsafeWorldFilesystem();
      }
      if (this.responseWaiter) throw this.#fail();
      const line = `${JSON.stringify(payload)}\n`;
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw this.#fail();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.responseWaiter?.timer === timer) this.responseWaiter = null;
          reject(this.#fail());
        }, timeoutMs);
        this.responseWaiter = { consume, reject, resolve, timer };
        try {
          this.child.stdin.write(line, (error) => { if (error) this.#fail(error); });
        } catch (error) {
          reject(this.#fail(error));
        }
      });
    };
    const result = this.commandTail.then(execute);
    this.commandTail = result.catch(() => undefined);
    return result;
  }

  async acquire(paths, requestId, cohortId) {
    const response = await this.request({ command: 'acquire', requestId, cohortId, paths }, (value) => {
      if (!exactKeys(value, ['ok', 'command', 'requestId', 'cohortId', 'guards']) || value.ok !== true
        || value.command !== 'acquire' || value.requestId !== requestId || value.cohortId !== cohortId
        || !Array.isArray(value.guards) || value.guards.length !== paths.length) {
        throw unsafeWorldFilesystem();
      }
      const slots = new Set();
      const identities = new Set();
      return value.guards.map((guard) => {
        const expected = this.kind === 'file'
          ? ['slot', 'generation', 'identity', 'size']
          : ['slot', 'generation', 'identity'];
        if (!exactKeys(guard, expected) || !Number.isInteger(guard.slot)
          || guard.slot < 0 || guard.slot >= this.capacity || slots.has(guard.slot)
          || !GENERATION.test(guard.generation ?? '') || !NATIVE_IDENTITY.test(guard.identity ?? '')
          || identities.has(guard.identity) || this.activeSlots.has(guard.slot)) {
          throw unsafeWorldFilesystem();
        }
        if (this.kind === 'file' && (!CANONICAL_UINT64.test(guard.size ?? '')
          || BigInt(guard.size) > 0xffff_ffff_ffff_ffffn)) {
          throw unsafeWorldFilesystem();
        }
        const previous = this.lastSlotGeneration.get(guard.slot);
        if (previous !== undefined && BigInt(guard.generation) <= BigInt(previous)) {
          throw unsafeWorldFilesystem();
        }
        slots.add(guard.slot);
        identities.add(guard.identity);
        return guard;
      });
    });
    this.reservedCount -= paths.length;
    this.activeCount += response.length;
    for (const guard of response) {
      this.activeSlots.set(guard.slot, guard.generation);
      this.lastSlotGeneration.set(guard.slot, guard.generation);
    }
    return response;
  }

  async terminal(capability, command, destination, requestId) {
    const request = {
      command,
      requestId,
      cohortId: capability.cohortId,
      slot: capability.slot,
      generation: capability.generation,
      ...(destination === undefined ? {} : { destination }),
    };
    await this.request(request, (value) => {
      if (!exactKeys(value, ['ok', 'command', 'requestId', 'cohortId', 'slot', 'generation'])
        || value.ok !== true || value.command !== command || value.requestId !== requestId
        || value.cohortId !== capability.cohortId || value.slot !== capability.slot
        || value.generation !== capability.generation) {
        throw unsafeWorldFilesystem();
      }
    });
    if (this.activeSlots.get(capability.slot) !== capability.generation || this.activeCount < 1) {
      throw this.#fail();
    }
    this.activeSlots.delete(capability.slot);
    this.activeCount -= 1;
  }

  async verify(request, requestId, cohortId, generation) {
    return this.request({ command: 'verify', requestId, cohortId, generation, ...request }, (value) => {
      if (!exactKeys(value, ['ok', 'command', 'requestId', 'cohortId', 'generation', 'entries'])
        || value.ok !== true || value.command !== 'verify' || value.requestId !== requestId
        || value.cohortId !== cohortId || value.generation !== generation
        || !Number.isInteger(value.entries) || value.entries < 0 || value.entries > request.maxEntries) {
        throw unsafeWorldFilesystem();
      }
      return value.entries;
    }, { timeoutMs: this.scope.verificationTimeoutMs });
  }

  async closeExact(requestId, cohortId) {
    if (this.activeCount !== 0 || this.reservedCount !== 0 || this.activeSlots.size !== 0
      || this.responseWaiter || this.fatalError || this.exited) {
      throw this.#fail();
    }
    this.expectedClose = true;
    await this.request({ command: 'close', requestId, cohortId }, (value) => {
      if (!exactKeys(value, ['ok', 'command', 'requestId', 'cohortId']) || value.ok !== true
        || value.command !== 'close' || value.requestId !== requestId || value.cohortId !== cohortId) {
        throw unsafeWorldFilesystem();
      }
      this.closeAcknowledged = true;
    }, { allowClosing: true });

    let timer;
    const exitedInTime = await Promise.race([
      this.exitPromise.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), this.scope.requestTimeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    if (!exitedInTime) throw this.#fail();
    if (this.fatalError || this.exitCode !== 0 || !this.stdoutEnded || this.outputBuffer.length !== 0) {
      throw this.fatalError ?? this.#fail();
    }
  }

  async awaitFailureExit() {
    if (this.exited) return;
    try { this.child.kill(); } catch { /* exact failure completion still waits for observed exit */ }
    await this.exitPromise;
  }
}

class SafetyScope {
  constructor(configuration, scopeId) {
    Object.assign(this, configuration);
    this.scopeId = scopeId;
    this.state = 'active';
    this.poisonError = null;
    this.requestSequence = 0;
    this.cohortSequence = 0;
    this.verifierGeneration = 0;
    this.pendingCount = 0;
    this.capabilities = new Set();
    this.pathOwners = new Map();
    this.identityOwners = new Map();
    this.workers = new Set();
    this.pools = { directory: [], file: [], verifier: [] };
  }

  protocolId(kind, sequence) {
    return `${this.scopeId}-${kind}${sequence}`;
  }

  nextRequestId() {
    this.requestSequence += 1;
    return this.protocolId('r', this.requestSequence);
  }

  nextCohortId() {
    this.cohortSequence += 1;
    return this.protocolId('c', this.cohortSequence);
  }

  assertActive() {
    if (this.poisonError) throw this.poisonError;
    if (this.state !== 'active') throw unsafeWorldFilesystem();
  }

  poison(error, sourceWorker = null) {
    this.poisonError ??= asUnsafe(error);
    this.state = 'poisoned';
    for (const worker of this.workers) {
      if (worker !== sourceWorker) worker.abort(this.poisonError);
    }
    if (sourceWorker) sourceWorker.abort(this.poisonError);
    return this.poisonError;
  }

  track(promise) {
    this.pendingCount += 1;
    return Promise.resolve(promise).finally(() => { this.pendingCount -= 1; });
  }

  helperFor(kind) {
    if (kind === 'directory') return this.helpers.directory;
    if (kind === 'file') return this.helpers.file;
    return this.helpers.verifier;
  }

  workerFor(kind, count = 0) {
    this.assertActive();
    if (kind !== 'verifier' && count > this.workerCapacity) throw unsafeWorldFilesystem();
    const pool = this.pools[kind];
    if (kind === 'verifier' && pool.length > 0) return pool[0];
    if (kind !== 'verifier') {
      const available = pool.find((worker) => worker.canReserve(count));
      if (available) {
        available.reserve(count);
        return available;
      }
    }
    if (pool.length >= this.poolLimits[kind]) throw unsafeWorldFilesystem();
    let worker;
    try {
      worker = new PersistentWorker(this, kind, this.helperFor(kind), this.workerCapacity);
    } catch (error) {
      throw this.poison(error);
    }
    pool.push(worker);
    this.workers.add(worker);
    if (kind !== 'verifier') worker.reserve(count);
    return worker;
  }

  reservePaths(entries) {
    const reservation = Symbol('path reservation');
    for (const entry of entries) {
      if (this.pathOwners.has(entry.normalized)) throw unsafeWorldFilesystem();
    }
    for (const entry of entries) this.pathOwners.set(entry.normalized, reservation);
    return reservation;
  }

  clearPathReservations(entries, reservation) {
    for (const entry of entries) {
      if (this.pathOwners.get(entry.normalized) === reservation) this.pathOwners.delete(entry.normalized);
    }
  }

  acquire(kind, values) {
    this.assertActive();
    const entries = validateRequestedPaths(values, this.platform, kind === 'file' ? 'files' : 'directories');
    const reservation = this.reservePaths(entries);
    let worker;
    try { worker = this.platform === 'win32' ? this.workerFor(kind, entries.length) : null; } catch (error) {
      this.clearPathReservations(entries, reservation);
      throw error;
    }
    const requestId = this.nextRequestId();
    const cohortId = this.nextCohortId();
    return this.track((async () => {
      if (this.platform !== 'win32') {
        return entries.map((entry, index) => this.makePortableCapability(kind, entry, index, cohortId, reservation));
      }
      let evidence;
      try {
        evidence = await worker.acquire(entries.map((entry) => entry.requested), requestId, cohortId);
      } catch (error) {
        worker.cancelReservation(entries.length);
        this.clearPathReservations(entries, reservation);
        throw this.poison(error, worker);
      }
      this.assertActive();
      const cohortIdentities = new Set();
      for (const item of evidence) {
        if (cohortIdentities.has(item.identity) || this.identityOwners.has(item.identity)) {
          this.clearPathReservations(entries, reservation);
          throw this.poison(unsafeWorldFilesystem());
        }
        cohortIdentities.add(item.identity);
      }
      const capabilities = evidence.map((item, index) => this.makeNativeCapability(
        kind, entries[index], item, index, cohortId, worker,
      ));
      for (const capability of capabilities) {
        this.capabilities.add(capability);
        this.pathOwners.set(capability.normalizedPath, capability);
        this.identityOwners.set(capability.identity, capability);
      }
      return capabilities.map((capability) => capability.publicGuard);
    })());
  }

  makeNativeCapability(kind, entry, evidence, index, cohortId, worker) {
    const capability = {
      kind,
      index,
      cohortId,
      slot: evidence.slot,
      generation: evidence.generation,
      identity: evidence.identity,
      size: evidence.size,
      normalizedPath: entry.normalized,
      path: entry.requested,
      worker,
      state: 'held',
      terminalCommand: null,
      terminalPromise: null,
      publicGuard: null,
    };
    capability.publicGuard = this.publicGuard(capability, worker.processId);
    return capability;
  }

  makePortableCapability(kind, entry, index, cohortId) {
    const capability = {
      kind,
      index,
      cohortId,
      slot: index,
      generation: '1',
      identity: null,
      size: null,
      normalizedPath: entry.normalized,
      path: entry.requested,
      worker: null,
      state: 'held',
      terminalCommand: null,
      terminalPromise: null,
      publicGuard: null,
    };
    capability.publicGuard = this.publicGuard(capability, null);
    this.capabilities.add(capability);
    this.pathOwners.set(capability.normalizedPath, capability);
    return capability.publicGuard;
  }

  publicGuard(capability, processId) {
    const guard = {
      id: capability.index,
      slot: capability.slot,
      cohortId: capability.cohortId,
      generation: capability.generation,
      identity: capability.identity,
      processId,
      assertHeld: () => {
        this.assertActive();
        if (capability.state !== 'held' || capability.worker?.fatalError || capability.worker?.exited) {
          throw this.poison(unsafeWorldFilesystem());
        }
      },
      release: () => this.completeCapability(capability, 'release'),
      delete: () => this.completeCapability(capability, 'delete'),
      rename: (destination) => this.completeCapability(capability, 'rename', destination),
    };
    if (capability.kind === 'file') {
      guard.size = capability.size;
      guard.replace = (destination) => this.completeCapability(capability, 'replace', destination);
    }
    return guard;
  }

  completeCapability(capability, command, destination) {
    if (capability.terminalPromise) {
      return capability.terminalCommand === command
        ? capability.terminalPromise
        : Promise.reject(unsafeWorldFilesystem());
    }
    try {
      this.assertActive();
      if (capability.state !== 'held') throw unsafeWorldFilesystem();
      if ((command === 'rename' || command === 'replace') && capability.kind === 'directory' && command === 'replace') {
        throw unsafeWorldFilesystem();
      }
    } catch (error) {
      return Promise.reject(error);
    }

    let destinationEntry = null;
    let destinationReservation = null;
    if (destination !== undefined) {
      try {
        [destinationEntry] = validateRequestedPaths([destination], this.platform, 'destinations');
        if (destinationEntry.normalized !== capability.normalizedPath) {
          destinationReservation = this.reservePaths([destinationEntry]);
        }
      } catch (error) {
        return Promise.reject(error);
      }
    }

    capability.state = 'terminal-pending';
    capability.terminalCommand = command;
    const requestId = this.nextRequestId();
    capability.terminalPromise = this.track((async () => {
      try {
        if (this.platform === 'win32') {
          await capability.worker.terminal(capability, command, destinationEntry?.requested, requestId);
        } else if (command === 'delete') {
          await (capability.kind === 'directory' ? this.rmdir : this.unlink)(capability.path);
        } else if (command === 'rename' || command === 'replace') {
          await this.rename(capability.path, destinationEntry.requested);
        }
        this.assertActive();
        capability.state = 'closed';
        this.capabilities.delete(capability);
        if (this.pathOwners.get(capability.normalizedPath) === capability) {
          this.pathOwners.delete(capability.normalizedPath);
        }
        if (capability.identity && this.identityOwners.get(capability.identity) === capability) {
          this.identityOwners.delete(capability.identity);
        }
        if (destinationReservation) this.clearPathReservations([destinationEntry], destinationReservation);
      } catch (error) {
        if (destinationReservation) this.clearPathReservations([destinationEntry], destinationReservation);
        capability.state = 'failed';
        if (this.platform === 'win32') throw this.poison(error, capability.worker);
        throw error;
      }
    })());
    return capability.terminalPromise;
  }

  verify(root, options = {}) {
    this.assertActive();
    const request = validateVerifierRequest(root, options, this.platform);
    if (this.platform !== 'win32') return Promise.resolve({ ok: true, checked: false });
    const worker = this.workerFor('verifier');
    const requestId = this.nextRequestId();
    const cohortId = this.nextCohortId();
    this.verifierGeneration += 1;
    const generation = String(this.verifierGeneration);
    return this.track((async () => {
      try {
        const entries = await worker.verify(request, requestId, cohortId, generation);
        this.assertActive();
        return { ok: true, checked: true, entries };
      } catch (error) {
        throw this.poison(error, worker);
      }
    })());
  }

  async closeExact() {
    if (this.state === 'closed') return;
    if (this.poisonError) {
      await Promise.allSettled([...this.workers].map((worker) => worker.awaitFailureExit()));
      throw this.poisonError;
    }
    if (this.state !== 'active' || this.pendingCount !== 0 || this.capabilities.size !== 0
      || this.pathOwners.size !== 0 || this.identityOwners.size !== 0) {
      const error = this.poison(unsafeWorldFilesystem());
      await Promise.allSettled([...this.workers].map((worker) => worker.awaitFailureExit()));
      throw error;
    }
    this.state = 'closing';
    const closes = [...this.workers].map((worker) => worker.closeExact(this.nextRequestId(), this.nextCohortId()));
    const settled = await Promise.allSettled(closes);
    const failed = settled.find((result) => result.status === 'rejected');
    if (failed) {
      const error = this.poison(failed.reason);
      await Promise.allSettled([...this.workers].map((worker) => worker.awaitFailureExit()));
      throw error;
    }
    if ([...this.workers].some((worker) => !worker.closeAcknowledged || !worker.exited || worker.exitCode !== 0)) {
      throw this.poison(unsafeWorldFilesystem());
    }
    this.state = 'closed';
  }
}

function configuration(options) {
  const platform = options.platform ?? process.platform;
  if (typeof platform !== 'string') throw new TypeError('Invalid platform');
  const spawnProcess = options.spawnProcess ?? spawn;
  if (typeof spawnProcess !== 'function') throw new TypeError('spawnProcess must be a function');
  const workerCapacity = boundedInteger(
    options.workerCapacity, HARD_MAX_HANDLES_PER_WORKER, 1, HARD_MAX_HANDLES_PER_WORKER,
    'Windows safety worker capacity',
  );
  const poolLimits = {
    directory: boundedInteger(options.maxDirectoryWorkers, HARD_POOL_LIMITS.directory, 1, HARD_POOL_LIMITS.directory, 'directory worker limit'),
    file: boundedInteger(options.maxFileWorkers, HARD_POOL_LIMITS.file, 1, HARD_POOL_LIMITS.file, 'file worker limit'),
    verifier: boundedInteger(options.maxVerifierWorkers, HARD_POOL_LIMITS.verifier, 1, HARD_POOL_LIMITS.verifier, 'verifier worker limit'),
  };
  const helpers = {
    directory: options.directoryHelper ?? DIRECTORY_HELPER,
    file: options.fileHelper ?? FILE_HELPER,
    verifier: options.verifierHelper ?? VERIFIER_HELPER,
  };
  if (Object.values(helpers).some((helper) => typeof helper !== 'string' || helper.length < 1)) {
    throw new TypeError('Invalid Windows safety helper path');
  }
  return {
    platform,
    spawnProcess,
    workerCapacity,
    poolLimits,
    helpers,
    windowsRoot: options.windowsRoot,
    requestTimeoutMs: boundedInteger(options.requestTimeoutMs, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, 'Windows safety request timeout'),
    verificationTimeoutMs: boundedInteger(
      options.verificationTimeoutMs, DEFAULT_VERIFICATION_TIMEOUT_MS, 1, MAX_TIMEOUT_MS,
      'Windows safety verification timeout',
    ),
    rmdir: options.rmdir ?? fs.rmdir,
    unlink: options.unlink ?? fs.unlink,
    rename: options.rename ?? fs.rename,
  };
}

/**
 * Create an operation-scoped filesystem-safety broker. Every guard/verifier
 * proxy must be called from runOperation(); nested calls reuse the same
 * AsyncLocalStorage scope and the outermost call performs the exact close
 * handshake.
 */
export function createWindowsFilesystemSafetyBroker(options = {}) {
  const configured = configuration(options);
  const storage = new AsyncLocalStorage();
  const brokerId = ++brokerSequence;
  let scopeSequence = 0;
  const marker = Symbol(`backup-windows-safety-broker-${brokerId}`);
  let broker;

  const currentScope = () => {
    const record = storage.getStore();
    if (!record || record.marker !== marker) throw unsafeWorldFilesystem();
    record.scope.assertActive();
    return record.scope;
  };
  const directoryGuard = async (directory) => {
    const scope = currentScope();
    const [entry] = validateRequestedPaths([directory], configured.platform, 'directories');
    const borrowed = configured.platform === 'win32'
      ? borrowHeldWindowsDirectoryGuard(entry.requested)
      : null;
    return borrowed ?? scope.acquire('directory', [entry.requested]).then(([guard]) => guard);
  };
  directoryGuard.batch = async (directories) => {
    const scope = currentScope();
    const entries = validateRequestedPaths(directories, configured.platform, 'directories');
    if (configured.platform !== 'win32') {
      return scope.acquire('directory', entries.map((entry) => entry.requested));
    }
    const guards = new Array(entries.length);
    const missing = [];
    for (let index = 0; index < entries.length; index += 1) {
      const borrowed = borrowHeldWindowsDirectoryGuard(entries[index].requested);
      if (borrowed) guards[index] = borrowed;
      else missing.push({ index, requested: entries[index].requested });
    }
    if (missing.length > 0) {
      const acquired = await scope.acquire('directory', missing.map((entry) => entry.requested));
      for (let index = 0; index < missing.length; index += 1) guards[missing[index].index] = acquired[index];
    }
    return guards;
  };
  const fileGuard = async (file) => currentScope().acquire('file', [file]).then(([guard]) => guard);
  fileGuard.batch = async (files) => currentScope().acquire('file', files);
  const filesystemTreeVerifier = async (root, verifierOptions = {}) => currentScope().verify(root, verifierOptions);

  const runOperation = async (operation) => {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    const current = storage.getStore();
    if (current?.marker === marker) {
      current.scope.assertActive();
      return operation(broker);
    }
    scopeSequence += 1;
    const scope = new SafetyScope(configured, `b${brokerId}-s${scopeSequence}`);
    return storage.run({ marker, scope }, async () => {
      let value;
      let operationError = null;
      try { value = await operation(broker); } catch (error) { operationError = error; }
      let closeError = null;
      try { await scope.closeExact(); } catch (error) { closeError = error; }
      if (closeError) {
        if (operationError && closeError.cause === undefined) {
          Object.defineProperty(closeError, 'operationError', { value: operationError, configurable: true });
        }
        throw closeError;
      }
      if (operationError) throw operationError;
      return value;
    });
  };

  broker = Object.freeze({ runOperation, directoryGuard, fileGuard, filesystemTreeVerifier });
  return broker;
}

// Backup keeps the initially requested public naming while updater and other
// serialized lifecycle owners can use the neutral factory name.
export const createBackupWindowsSafetyBroker = createWindowsFilesystemSafetyBroker;
export const backupWindowsSafetyBroker = createWindowsFilesystemSafetyBroker();
