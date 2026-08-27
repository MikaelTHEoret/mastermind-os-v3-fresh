import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('../../../scripts/inspect-minecraft-world-files.ps1', import.meta.url));
const GUARD_HELPER = fileURLToPath(new URL('../../../scripts/guard-minecraft-world-directory.ps1', import.meta.url));
const BATCH_GUARD_HELPER = fileURLToPath(new URL('../../../scripts/guard-minecraft-world-directories.ps1', import.meta.url));
const FILE_GUARD_HELPER = fileURLToPath(new URL('../../../scripts/guard-minecraft-world-file.ps1', import.meta.url));
const FILE_BATCH_GUARD_HELPER = fileURLToPath(new URL('../../../scripts/guard-minecraft-world-files.ps1', import.meta.url));
const MAX_OUTPUT_BYTES = 4096;
const TIMEOUT_MS = 120_000;
const MAX_BATCH_GUARDS = 256;
const MAX_BATCH_LINE_BYTES = 1_048_576;
const MAX_BATCH_OUTPUT_BYTES = 262_144;
const RESERVED_WINDOWS_DEVICE = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/i;
const INVALID_WINDOWS_COMPONENT = /[\x00-\x1f<>:"|?*]/;
const HELD_DIRECTORY_GUARDS = new AsyncLocalStorage();

function directoryGuardKey(directory) {
  return path.win32.resolve(directory).toLocaleLowerCase('en-US');
}

export function withHeldWindowsDirectoryGuards(entries, operation) {
  if (!Array.isArray(entries) || typeof operation !== 'function') {
    throw new TypeError('Invalid held Windows directory guard context');
  }
  const inherited = HELD_DIRECTORY_GUARDS.getStore() ?? new Map();
  const held = new Map(inherited);
  for (const entry of entries) {
    if (!entry || typeof entry.directory !== 'string' || typeof entry.guard?.assertHeld !== 'function') {
      throw new TypeError('Invalid held Windows directory guard');
    }
    entry.guard.assertHeld();
    held.set(directoryGuardKey(entry.directory), entry.guard);
  }
  return HELD_DIRECTORY_GUARDS.run(held, operation);
}

function borrowHeldDirectoryGuard(directory) {
  const held = HELD_DIRECTORY_GUARDS.getStore()?.get(directoryGuardKey(directory));
  if (!held) return null;
  held.assertHeld();
  let released = false;
  return {
    assertHeld() {
      if (released) throw unsafeWorldFilesystem();
      held.assertHeld();
    },
    async release() {
      if (released) return;
      held.assertHeld();
      released = true;
    },
    async delete() { throw unsafeWorldFilesystem(); },
    async rename() { throw unsafeWorldFilesystem(); },
  };
}

export function borrowHeldWindowsDirectoryGuard(directory) {
  if (!validWindowsBatchDirectoryPath(directory)) throw unsafeWorldFilesystem();
  return borrowHeldDirectoryGuard(directory);
}

function powershellExecutable(windowsRoot = process.env.SystemRoot ?? process.env.WINDIR) {
  if (typeof windowsRoot !== 'string' || !path.win32.isAbsolute(windowsRoot)) return 'powershell.exe';
  return path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function unsafeWorldFilesystem() {
  return Object.assign(new Error('The managed world contains unsafe Windows filesystem metadata.'), {
    code: 'WORLD_INTEGRITY_FAILED',
    statusCode: 409,
  });
}

function isWindowsDeviceNamespace(value) {
  const normalized = value.replaceAll('/', '\\');
  return /^(?:\\\\[.?]\\|\\\\\?\?\\|\\\?\?\\)/i.test(normalized);
}

function validWindowsPathComponent(component) {
  const normalizedComponent = component.replace(/[ .]+$/g, '');
  return normalizedComponent.length > 0 && normalizedComponent === component
    && component !== '.' && component !== '..'
    && !INVALID_WINDOWS_COMPONENT.test(component)
    && !RESERVED_WINDOWS_DEVICE.test(normalizedComponent);
}

function validWindowsGuardPath(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 30_000
    || !path.win32.isAbsolute(value) || isWindowsDeviceNamespace(value) || value.includes('\0')) {
    return false;
  }
  const normalized = value.replaceAll('/', '\\');
  const inputRoot = path.win32.parse(normalized).root;
  const fullyQualifiedDrive = /^[a-z]:\\$/i.test(inputRoot);
  const fullyQualifiedUnc = !inputRoot.includes(':') && /^\\\\[^\\]+\\[^\\]+\\$/.test(inputRoot);
  if (!fullyQualifiedDrive && !fullyQualifiedUnc) return false;
  const inputTail = normalized.slice(inputRoot.length);
  if (!inputTail || !inputTail.split('\\').every(validWindowsPathComponent)) return false;
  let resolved;
  try { resolved = path.win32.resolve(value); } catch { return false; }
  const root = path.win32.parse(resolved).root;
  if (!root || root === '\\' || resolved.length <= root.length || resolved.slice(root.length).includes(':')) {
    return false;
  }
  return resolved.slice(root.length).split('\\').filter(Boolean).every(validWindowsPathComponent);
}

export async function assertWindowsFilesystemTree(root, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return { ok: true, checked: false };
  if (!validWindowsGuardPath(root)) {
    throw unsafeWorldFilesystem();
  }
  const maxEntries = options.maxEntries ?? 500_000;
  const maxDepth = options.maxDepth ?? 64;
  const recursive = options.recursive ?? true;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 500_000
    || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 64 || typeof recursive !== 'boolean') {
    throw new TypeError('Invalid Windows filesystem verification limits');
  }

  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(powershellExecutable(options.windowsRoot), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER,
  ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });

  return new Promise((resolve, reject) => {
    let output = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(unsafeWorldFilesystem());
    }, options.timeoutMs ?? TIMEOUT_MS);
    child.once('error', () => finish(unsafeWorldFilesystem()));
    child.stdout.on('data', (chunk) => {
      output = Buffer.concat([output, Buffer.from(chunk)]);
      if (output.length > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(unsafeWorldFilesystem());
      }
    });
    child.once('close', (code) => {
      let result;
      try { result = JSON.parse(output.toString('utf8')); } catch { return finish(unsafeWorldFilesystem()); }
      if (code !== 0 || result?.ok !== true || !Number.isInteger(result.entries)
        || result.entries < 0 || result.entries > maxEntries) return finish(unsafeWorldFilesystem());
      return finish(null, { ok: true, checked: true, entries: result.entries });
    });
    child.stdin.once('error', () => finish(unsafeWorldFilesystem()));
    child.stdin.end(JSON.stringify({ root, maxEntries, maxDepth, recursive }));
  });
}

export function assertWindowsFilesystemEntry(target, options = {}) {
  return assertWindowsFilesystemTree(target, { ...options, maxEntries: 1, maxDepth: 0, recursive: false });
}

export async function acquireWindowsDirectoryGuard(directory, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return {
      assertHeld() {}, async release() {},
      async delete() { await (options.rmdir ?? fs.rmdir)(directory); },
      async rename(destination) { await (options.rename ?? fs.rename)(directory, destination); },
    };
  }
  if (!validWindowsBatchDirectoryPath(directory)) {
    throw unsafeWorldFilesystem();
  }
  if (options.borrowHeld === true) {
    const borrowed = borrowHeldDirectoryGuard(directory);
    if (borrowed) return borrowed;
  }
  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(powershellExecutable(options.windowsRoot), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', GUARD_HELPER,
  ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let output = Buffer.alloc(0);
  let readyObserved = false;
  let exited = false;
  let exitCode = null;
  let processErrored = false;
  let terminalPromise = null;
  let resolveExit;
  const exitedPromise = new Promise((resolve) => { resolveExit = resolve; });
  const ready = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else { readyObserved = true; resolve(); }
    };
    const timer = setTimeout(() => { child.kill(); finish(unsafeWorldFilesystem()); }, options.timeoutMs ?? 15_000);
    child.once('error', () => {
      processErrored = true;
      resolveExit();
      finish(unsafeWorldFilesystem());
    });
    child.once('close', (code) => {
      exited = true;
      exitCode = code;
      resolveExit();
      if (!readyObserved) finish(unsafeWorldFilesystem());
    });
    child.stdout.on('data', (chunk) => {
      output = Buffer.concat([output, Buffer.from(chunk)]);
      if (output.length > MAX_OUTPUT_BYTES) { child.kill(); return finish(unsafeWorldFilesystem()); }
      const newline = output.indexOf(0x0a);
      if (newline < 0) return;
      let result;
      try { result = JSON.parse(output.subarray(0, newline).toString('utf8')); } catch { return finish(unsafeWorldFilesystem()); }
      const keys = result && typeof result === 'object' ? Object.keys(result) : [];
      return finish(result?.ok === true && keys.length === 1 ? null : unsafeWorldFilesystem());
    });
    child.stdin.once('error', () => finish(unsafeWorldFilesystem()));
    child.stdin.write(`${JSON.stringify({ path: directory })}\n`);
  });
  await ready;
  const complete = (command, expectedField) => {
    if (terminalPromise) return terminalPromise;
    terminalPromise = (async () => {
      if (exited || processErrored) throw unsafeWorldFilesystem();
      try {
        child.stdin.end(typeof command === 'string' ? `${command}\n` : `${JSON.stringify(command)}\n`);
      } catch { throw unsafeWorldFilesystem(); }
      let timeout;
      await Promise.race([
        exitedPromise,
        new Promise((_, reject) => {
          timeout = setTimeout(() => { child.kill(); reject(unsafeWorldFilesystem()); }, 5_000);
        }),
      ]).finally(() => clearTimeout(timeout));
      if (processErrored || exitCode !== 0) throw unsafeWorldFilesystem();
      const lines = output.toString('utf8').split(/\r?\n/).filter((line) => line.length > 0);
      if (lines.length !== 2) throw unsafeWorldFilesystem();
      let result;
      try { result = JSON.parse(lines[1]); } catch { throw unsafeWorldFilesystem(); }
      const keys = result && typeof result === 'object' ? Object.keys(result).sort() : [];
      if (result?.ok !== true || result?.[expectedField] !== true
        || keys.join(',') !== [expectedField, 'ok'].sort().join(',')) {
        throw unsafeWorldFilesystem();
      }
    })();
    return terminalPromise;
  };
  return {
    assertHeld() {
      if (exited || processErrored) throw unsafeWorldFilesystem();
    },
    release() { return complete('release', 'released'); },
    delete() { return complete('delete', 'deleted'); },
    rename(destination) {
      if (!validWindowsBatchDirectoryPath(destination)) {
        return Promise.reject(unsafeWorldFilesystem());
      }
      return complete({ command: 'rename', destination }, 'renamed');
    },
  };
}

function validateBatchDirectories(directories, platform) {
  if (!Array.isArray(directories) || directories.length < 1 || directories.length > MAX_BATCH_GUARDS) {
    throw new TypeError(`directories must contain between 1 and ${MAX_BATCH_GUARDS} paths`);
  }
  const seen = new Set();
  return directories.map((directory) => {
    if (typeof directory !== 'string' || directory.length < 1 || directory.length > 30_000) {
      throw unsafeWorldFilesystem();
    }
    if (platform === 'win32' && !validWindowsBatchDirectoryPath(directory)) throw unsafeWorldFilesystem();
    const key = platform === 'win32'
      ? path.win32.resolve(directory).toLowerCase()
      : directory;
    if (seen.has(key)) throw unsafeWorldFilesystem();
    seen.add(key);
    return directory;
  });
}

function validWindowsBatchDirectoryPath(directory) {
  return validWindowsGuardPath(directory);
}

function boundedBatchTimeout(value, fallback) {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 1 || selected > TIMEOUT_MS) {
    throw new TypeError('Invalid Windows directory guard timeout');
  }
  return selected;
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

/**
 * Acquire an ordered set of exact directory handles in one bounded helper.
 * The returned guards retain the single helper independently: completing one
 * guard never releases another, and completing the final guard waits for the
 * helper process to exit successfully.
 */
export async function acquireWindowsDirectoryGuardBatch(directories, options = {}) {
  const platform = options.platform ?? process.platform;
  const requested = validateBatchDirectories(directories, platform);
  if (platform !== 'win32') {
    return requested.map((directory, id) => ({
      id,
      identity: null,
      processId: null,
      assertHeld() {},
      async release() {},
      async delete() { await (options.rmdir ?? fs.rmdir)(directory); },
      async rename(destination) { await (options.rename ?? fs.rename)(directory, destination); },
    }));
  }

  const readyTimeoutMs = boundedBatchTimeout(options.timeoutMs, 15_000);
  const commandTimeoutMs = boundedBatchTimeout(options.commandTimeoutMs, 5_000);
  const initialLine = `${JSON.stringify({ command: 'acquire', paths: requested })}\n`;
  if (Buffer.byteLength(initialLine) > MAX_BATCH_LINE_BYTES) throw unsafeWorldFilesystem();

  const spawnProcess = options.spawnProcess ?? spawn;
  let child;
  try {
    child = spawnProcess(powershellExecutable(options.windowsRoot), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', BATCH_GUARD_HELPER,
    ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  } catch {
    throw unsafeWorldFilesystem();
  }
  if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function'
    || typeof child.stdout?.on !== 'function' || typeof child.stdin?.write !== 'function') {
    try { child?.kill?.(); } catch { /* malformed helpers are already untrusted */ }
    throw unsafeWorldFilesystem();
  }

  let outputBuffer = Buffer.alloc(0);
  let totalOutputBytes = 0;
  let readyObserved = false;
  let readySettled = false;
  let readyTimer;
  let responseWaiter = null;
  let exited = false;
  let exitCode = null;
  let fatalError = null;
  let activeCount = requested.length;
  let expectedExit = false;
  let resolveExit;
  let resolveReady;
  let rejectReady;
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const rejectReadiness = (error) => {
    if (readySettled) return;
    readySettled = true;
    clearTimeout(readyTimer);
    rejectReady(error);
  };
  const failProtocol = (kill = true) => {
    if (!fatalError) fatalError = unsafeWorldFilesystem();
    rejectReadiness(fatalError);
    if (responseWaiter) {
      const waiter = responseWaiter;
      responseWaiter = null;
      clearTimeout(waiter.timer);
      waiter.reject(fatalError);
    }
    if (kill && !exited) {
      try { child.kill(); } catch { /* process failure remains fail-closed */ }
    }
    return fatalError;
  };

  const consumeReady = (result) => {
    if (!exactKeys(result, ['ok', 'guards']) || result.ok !== true
      || !Array.isArray(result.guards) || result.guards.length !== requested.length) {
      throw unsafeWorldFilesystem();
    }
    const identities = new Set();
    const evidence = result.guards.map((guard, id) => {
      if (!exactKeys(guard, ['id', 'identity']) || guard.id !== id
        || !/^[0-9a-f]{8}:[0-9a-f]{16}$/.test(guard.identity ?? '')
        || identities.has(guard.identity)) {
        throw unsafeWorldFilesystem();
      }
      identities.add(guard.identity);
      return guard.identity;
    });
    readyObserved = true;
    readySettled = true;
    clearTimeout(readyTimer);
    resolveReady(evidence);
  };

  const consumeLine = (line) => {
    if (line.length < 2 || line !== line.trim()) return failProtocol();
    let result;
    try { result = JSON.parse(line); } catch { return failProtocol(); }
    if (!readyObserved) {
      try { consumeReady(result); } catch { failProtocol(); }
      return;
    }
    if (!responseWaiter) return failProtocol();
    const waiter = responseWaiter;
    responseWaiter = null;
    clearTimeout(waiter.timer);
    try {
      waiter.consume(result);
      waiter.resolve();
    } catch {
      waiter.reject(failProtocol());
    }
  };

  child.once('error', () => {
    exited = true;
    resolveExit();
    failProtocol(false);
  });
  child.once('close', (code) => {
    exited = true;
    exitCode = code;
    resolveExit();
    if (!readyObserved || code !== 0 || activeCount !== 0 || !expectedExit || outputBuffer.length !== 0) {
      failProtocol(false);
    }
  });
  child.stdout.on('data', (chunk) => {
    if (fatalError) return;
    const bytes = Buffer.from(chunk);
    totalOutputBytes += bytes.length;
    if (totalOutputBytes > MAX_BATCH_OUTPUT_BYTES) return failProtocol();
    outputBuffer = Buffer.concat([outputBuffer, bytes]);
    if (outputBuffer.length > MAX_BATCH_LINE_BYTES) return failProtocol();
    while (!fatalError) {
      const newline = outputBuffer.indexOf(0x0a);
      if (newline < 0) break;
      let line = outputBuffer.subarray(0, newline).toString('utf8');
      outputBuffer = outputBuffer.subarray(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      consumeLine(line);
    }
  });
  child.stdout.once('end', () => {
    if (outputBuffer.length !== 0 || activeCount !== 0 || !expectedExit) failProtocol();
  });
  child.stdin.once('error', () => {
    if (activeCount !== 0 || responseWaiter) failProtocol();
  });
  child.stdin.once('close', () => {
    if (activeCount !== 0 || !expectedExit) failProtocol();
  });

  readyTimer = setTimeout(() => failProtocol(), readyTimeoutMs);
  try {
    child.stdin.write(initialLine, (error) => { if (error) failProtocol(); });
  } catch {
    failProtocol();
  }
  const waitForFailureExit = async () => {
    if (exited) return;
    let timer;
    await Promise.race([
      exitPromise,
      new Promise((resolve) => { timer = setTimeout(resolve, commandTimeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    if (!exited) {
      try { child.kill(); } catch { /* the original protocol failure remains authoritative */ }
    }
  };
  let identities;
  try {
    identities = await readyPromise;
  } catch (error) {
    await waitForFailureExit();
    throw error;
  }
  if (fatalError || exited) {
    await waitForFailureExit();
    throw fatalError ?? unsafeWorldFilesystem();
  }

  const sendCommand = (request, consume) => {
    if (fatalError || exited || responseWaiter) return Promise.reject(fatalError ?? unsafeWorldFilesystem());
    const line = `${JSON.stringify(request)}\n`;
    if (Buffer.byteLength(line) > MAX_BATCH_LINE_BYTES) return Promise.reject(failProtocol());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (responseWaiter?.timer === timer) responseWaiter = null;
        reject(failProtocol());
      }, commandTimeoutMs);
      responseWaiter = { consume, reject, resolve, timer };
      try {
        child.stdin.write(line, (error) => { if (error) failProtocol(); });
      } catch {
        reject(failProtocol());
      }
    });
  };

  const waitForCleanExit = async () => {
    let timer;
    const exitedInTime = await Promise.race([
      exitPromise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), commandTimeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!exitedInTime) {
      failProtocol();
      await waitForFailureExit();
    }
    if (fatalError || exitCode !== 0 || outputBuffer.length !== 0) {
      throw fatalError ?? unsafeWorldFilesystem();
    }
  };

  let commandTail = Promise.resolve();
  const schedule = (operation) => {
    const result = commandTail.then(operation, operation);
    commandTail = result.catch(() => undefined);
    return result;
  };

  return identities.map((identity, id) => {
    let state = 'held';
    let terminalPromise = null;
    const complete = (command, expectedField, destination) => {
      if (terminalPromise) return terminalPromise;
      state = 'terminal-pending';
      terminalPromise = schedule(async () => {
        if (fatalError || exited) throw fatalError ?? unsafeWorldFilesystem();
        const request = destination === undefined ? { command, id } : { command, id, destination };
        try {
          await sendCommand(request, (result) => {
            if (!exactKeys(result, ['ok', 'id', expectedField]) || result.ok !== true
              || result.id !== id || result[expectedField] !== true) {
              throw unsafeWorldFilesystem();
            }
            state = 'closed';
            activeCount -= 1;
            if (activeCount === 0) expectedExit = true;
          });
        } catch (error) {
          await waitForFailureExit();
          throw error;
        }
        if (activeCount === 0) await waitForCleanExit();
      });
      return terminalPromise;
    };
    return {
      id,
      identity,
      processId: Number.isInteger(child.pid) ? child.pid : null,
      assertHeld() {
        if (state !== 'held' || fatalError || exited) throw fatalError ?? unsafeWorldFilesystem();
      },
      release() { return complete('release', 'released'); },
      delete() { return complete('delete', 'deleted'); },
      rename(destination) {
        if (!validWindowsBatchDirectoryPath(destination)) {
          return Promise.reject(unsafeWorldFilesystem());
        }
        return complete('rename', 'renamed', destination);
      },
    };
  });
}

// The property lets chain-oriented callers opt into batching while preserving
// the existing single-path dependency-injection contract.
acquireWindowsDirectoryGuard.batch = acquireWindowsDirectoryGuardBatch;

function validateBatchFiles(files, platform) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_BATCH_GUARDS) {
    throw new TypeError(`files must contain between 1 and ${MAX_BATCH_GUARDS} paths`);
  }
  const seen = new Set();
  return files.map((file) => {
    if (typeof file !== 'string' || file.length < 1 || file.length > 30_000) {
      throw unsafeWorldFilesystem();
    }
    if (platform === 'win32') {
      if (!validWindowsBatchFilePath(file)) throw unsafeWorldFilesystem();
      const resolved = path.win32.resolve(file);
      const key = resolved.toLowerCase();
      if (seen.has(key)) throw unsafeWorldFilesystem();
      seen.add(key);
    } else {
      if (seen.has(file)) throw unsafeWorldFilesystem();
      seen.add(file);
    }
    return file;
  });
}

function validWindowsBatchFilePath(file) {
  return validWindowsGuardPath(file);
}

function canonicalUint64(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(value)) return false;
  try { return BigInt(value) <= 0xffff_ffff_ffff_ffffn; } catch { return false; }
}

function boundedFileBatchTimeout(value, fallback) {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 1 || selected > TIMEOUT_MS) {
    throw new TypeError('Invalid Windows file guard timeout');
  }
  return selected;
}

/**
 * Acquire an ordered set of exact ordinary-file handles in one bounded helper.
 * Each guard carries immutable native identity and size evidence. Completing a
 * guard never releases a peer, and the final completion waits for clean helper
 * exit before it resolves.
 */
export async function acquireWindowsFileGuardBatch(files, options = {}) {
  const platform = options.platform ?? process.platform;
  const requested = validateBatchFiles(files, platform);
  if (options.readCompatible !== undefined && typeof options.readCompatible !== 'boolean') {
    throw new TypeError('readCompatible must be a boolean');
  }
  const readCompatible = options.readCompatible === true;
  if (platform !== 'win32') {
    return requested.map((file, id) => ({
      id,
      identity: null,
      size: null,
      processId: null,
      assertHeld() {},
      async release() {},
      async delete() { if (readCompatible) throw unsafeWorldFilesystem(); await (options.unlink ?? fs.unlink)(file); },
      async rename(destination) { if (readCompatible) throw unsafeWorldFilesystem(); await (options.rename ?? fs.rename)(file, destination); },
      async replace(destination) { if (readCompatible) throw unsafeWorldFilesystem(); await (options.rename ?? fs.rename)(file, destination); },
    }));
  }

  const readyTimeoutMs = boundedFileBatchTimeout(options.timeoutMs, 15_000);
  const commandTimeoutMs = boundedFileBatchTimeout(options.commandTimeoutMs, 5_000);
  const initialLine = `${JSON.stringify({ command: 'acquire', paths: requested,
    ...(readCompatible ? { readCompatible: true } : {}) })}\n`;
  if (Buffer.byteLength(initialLine) > MAX_BATCH_LINE_BYTES) throw unsafeWorldFilesystem();

  const spawnProcess = options.spawnProcess ?? spawn;
  let child;
  try {
    child = spawnProcess(powershellExecutable(options.windowsRoot), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', FILE_BATCH_GUARD_HELPER,
    ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  } catch {
    throw unsafeWorldFilesystem();
  }
  if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function'
    || typeof child.stdout?.on !== 'function' || typeof child.stdin?.write !== 'function') {
    try { child?.kill?.(); } catch { /* malformed helpers are already untrusted */ }
    throw unsafeWorldFilesystem();
  }

  let outputBuffer = Buffer.alloc(0);
  let totalOutputBytes = 0;
  let readyObserved = false;
  let readySettled = false;
  let readyTimer;
  let responseWaiter = null;
  let exited = false;
  let exitCode = null;
  let fatalError = null;
  let activeCount = requested.length;
  let expectedExit = false;
  let resolveExit;
  let resolveReady;
  let rejectReady;
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const rejectReadiness = (error) => {
    if (readySettled) return;
    readySettled = true;
    clearTimeout(readyTimer);
    rejectReady(error);
  };
  const failProtocol = (kill = true) => {
    if (!fatalError) fatalError = unsafeWorldFilesystem();
    rejectReadiness(fatalError);
    if (responseWaiter) {
      const waiter = responseWaiter;
      responseWaiter = null;
      clearTimeout(waiter.timer);
      waiter.reject(fatalError);
    }
    if (kill && !exited) {
      try { child.kill(); } catch { /* process failure remains fail-closed */ }
    }
    return fatalError;
  };

  const consumeReady = (result) => {
    if (!exactKeys(result, ['ok', 'guards']) || result.ok !== true
      || !Array.isArray(result.guards) || result.guards.length !== requested.length) {
      throw unsafeWorldFilesystem();
    }
    const identities = new Set();
    const evidence = result.guards.map((guard, id) => {
      if (!exactKeys(guard, ['id', 'identity', 'size']) || guard.id !== id
        || !/^[0-9a-f]{8}:[0-9a-f]{16}$/.test(guard.identity ?? '')
        || !canonicalUint64(guard.size) || identities.has(guard.identity)) {
        throw unsafeWorldFilesystem();
      }
      identities.add(guard.identity);
      return { identity: guard.identity, size: guard.size };
    });
    readyObserved = true;
    readySettled = true;
    clearTimeout(readyTimer);
    resolveReady(evidence);
  };

  const consumeLine = (line) => {
    if (line.length < 2 || line !== line.trim()) return failProtocol();
    let result;
    try { result = JSON.parse(line); } catch { return failProtocol(); }
    if (!readyObserved) {
      try { consumeReady(result); } catch { failProtocol(); }
      return;
    }
    if (!responseWaiter) return failProtocol();
    const waiter = responseWaiter;
    responseWaiter = null;
    clearTimeout(waiter.timer);
    try {
      waiter.consume(result);
      waiter.resolve();
    } catch {
      waiter.reject(failProtocol());
    }
  };

  child.once('error', () => {
    exited = true;
    resolveExit();
    failProtocol(false);
  });
  child.once('close', (code) => {
    exited = true;
    exitCode = code;
    resolveExit();
    if (!readyObserved || code !== 0 || activeCount !== 0 || !expectedExit || outputBuffer.length !== 0) {
      failProtocol(false);
    }
  });
  child.stdout.on('data', (chunk) => {
    if (fatalError) return;
    const bytes = Buffer.from(chunk);
    totalOutputBytes += bytes.length;
    if (totalOutputBytes > MAX_BATCH_OUTPUT_BYTES) return failProtocol();
    outputBuffer = Buffer.concat([outputBuffer, bytes]);
    if (outputBuffer.length > MAX_BATCH_LINE_BYTES) return failProtocol();
    while (!fatalError) {
      const newline = outputBuffer.indexOf(0x0a);
      if (newline < 0) break;
      let line = outputBuffer.subarray(0, newline).toString('utf8');
      outputBuffer = outputBuffer.subarray(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      consumeLine(line);
    }
  });
  child.stdout.once('end', () => {
    if (outputBuffer.length !== 0 || activeCount !== 0 || !expectedExit) failProtocol();
  });
  child.stdin.once('error', () => {
    if (activeCount !== 0 || responseWaiter) failProtocol();
  });
  child.stdin.once('close', () => {
    if (activeCount !== 0 || !expectedExit) failProtocol();
  });

  readyTimer = setTimeout(() => failProtocol(), readyTimeoutMs);
  try {
    child.stdin.write(initialLine, (error) => { if (error) failProtocol(); });
  } catch {
    failProtocol();
  }
  const waitForFailureExit = async () => {
    if (exited) return;
    let timer;
    await Promise.race([
      exitPromise,
      new Promise((resolve) => { timer = setTimeout(resolve, commandTimeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    if (!exited) {
      try { child.kill(); } catch { /* the original protocol failure remains authoritative */ }
    }
  };
  let evidence;
  try {
    evidence = await readyPromise;
  } catch (error) {
    await waitForFailureExit();
    throw error;
  }
  if (fatalError || exited) {
    await waitForFailureExit();
    throw fatalError ?? unsafeWorldFilesystem();
  }

  const sendCommand = (request, consume) => {
    if (fatalError || exited || responseWaiter) return Promise.reject(fatalError ?? unsafeWorldFilesystem());
    const line = `${JSON.stringify(request)}\n`;
    if (Buffer.byteLength(line) > MAX_BATCH_LINE_BYTES) return Promise.reject(failProtocol());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (responseWaiter?.timer === timer) responseWaiter = null;
        reject(failProtocol());
      }, commandTimeoutMs);
      responseWaiter = { consume, reject, resolve, timer };
      try {
        child.stdin.write(line, (error) => { if (error) failProtocol(); });
      } catch {
        reject(failProtocol());
      }
    });
  };

  const waitForCleanExit = async () => {
    let timer;
    const exitedInTime = await Promise.race([
      exitPromise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), commandTimeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!exitedInTime) {
      failProtocol();
      await waitForFailureExit();
    }
    if (fatalError || exitCode !== 0 || outputBuffer.length !== 0) {
      throw fatalError ?? unsafeWorldFilesystem();
    }
  };

  let commandTail = Promise.resolve();
  const schedule = (operation) => {
    const result = commandTail.then(operation, operation);
    commandTail = result.catch(() => undefined);
    return result;
  };

  return evidence.map(({ identity, size }, id) => {
    let state = 'held';
    let terminalPromise = null;
    const complete = (command, expectedField, destination) => {
      if (terminalPromise) return terminalPromise;
      state = 'terminal-pending';
      terminalPromise = schedule(async () => {
        if (fatalError || exited) throw fatalError ?? unsafeWorldFilesystem();
        const request = destination === undefined ? { command, id } : { command, id, destination };
        try {
          await sendCommand(request, (result) => {
            if (!exactKeys(result, ['ok', 'id', expectedField]) || result.ok !== true
              || result.id !== id || result[expectedField] !== true) {
              throw unsafeWorldFilesystem();
            }
            state = 'closed';
            activeCount -= 1;
            if (activeCount === 0) expectedExit = true;
          });
        } catch (error) {
          await waitForFailureExit();
          throw error;
        }
        if (activeCount === 0) await waitForCleanExit();
      });
      return terminalPromise;
    };
    return {
      id,
      identity,
      size,
      processId: Number.isInteger(child.pid) ? child.pid : null,
      assertHeld() {
        if (state !== 'held' || fatalError || exited) throw fatalError ?? unsafeWorldFilesystem();
      },
      release() { return complete('release', 'released'); },
      delete() { return readCompatible ? Promise.reject(unsafeWorldFilesystem()) : complete('delete', 'deleted'); },
      rename(destination) {
        if (readCompatible) return Promise.reject(unsafeWorldFilesystem());
        if (!validWindowsBatchFilePath(destination)) {
          return Promise.reject(unsafeWorldFilesystem());
        }
        return complete('rename', 'renamed', destination);
      },
      replace(destination) {
        if (readCompatible) return Promise.reject(unsafeWorldFilesystem());
        if (!validWindowsBatchFilePath(destination)) {
          return Promise.reject(unsafeWorldFilesystem());
        }
        return complete('replace', 'replaced', destination);
      },
    };
  });
}

export async function acquireWindowsFileGuard(file, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return {
      assertHeld() {}, async release() {}, async delete() { await (options.unlink ?? fs.unlink)(file); },
      async rename(destination) { await (options.rename ?? fs.rename)(file, destination); },
      async replace(destination) { await (options.rename ?? fs.rename)(file, destination); },
    };
  }
  if (!validWindowsBatchFilePath(file)) throw unsafeWorldFilesystem();
  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(powershellExecutable(options.windowsRoot), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', FILE_GUARD_HELPER,
  ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let output = Buffer.alloc(0);
  let readyObserved = false;
  let exited = false;
  let exitCode = null;
  let processErrored = false;
  let terminalPromise = null;
  let resolveExit;
  const exitedPromise = new Promise((resolve) => { resolveExit = resolve; });
  const ready = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else { readyObserved = true; resolve(); }
    };
    const timer = setTimeout(() => { child.kill(); finish(unsafeWorldFilesystem()); }, options.timeoutMs ?? 15_000);
    child.once('error', () => { processErrored = true; resolveExit(); finish(unsafeWorldFilesystem()); });
    child.once('close', (code) => {
      exited = true; exitCode = code; resolveExit();
      if (!readyObserved) finish(unsafeWorldFilesystem());
    });
    child.stdout.on('data', (chunk) => {
      output = Buffer.concat([output, Buffer.from(chunk)]);
      if (output.length > MAX_OUTPUT_BYTES) { child.kill(); return finish(unsafeWorldFilesystem()); }
      const newline = output.indexOf(0x0a);
      if (newline < 0) return;
      let result;
      try { result = JSON.parse(output.subarray(0, newline).toString('utf8')); } catch { return finish(unsafeWorldFilesystem()); }
      const keys = result && typeof result === 'object' ? Object.keys(result).sort() : [];
      return finish(result?.ok === true && /^[0-9a-f]{8}:[0-9a-f]{16}$/.test(result.identity ?? '')
        && /^(?:0|[1-9][0-9]{0,19})$/.test(result.size ?? '') && keys.join(',') === 'identity,ok,size'
        ? null : unsafeWorldFilesystem());
    });
    child.stdin.once('error', () => finish(unsafeWorldFilesystem()));
    child.stdin.write(`${JSON.stringify({ path: file })}\n`);
  });
  await ready;
  const complete = (command, expectedField) => {
    if (terminalPromise) return terminalPromise;
    terminalPromise = (async () => {
      if (exited || processErrored) throw unsafeWorldFilesystem();
      try {
        child.stdin.end(typeof command === 'string' ? `${command}\n` : `${JSON.stringify(command)}\n`);
      } catch { throw unsafeWorldFilesystem(); }
      let timeout;
      await Promise.race([
        exitedPromise,
        new Promise((_, reject) => {
          timeout = setTimeout(() => { child.kill(); reject(unsafeWorldFilesystem()); }, 5_000);
        }),
      ]).finally(() => clearTimeout(timeout));
      if (processErrored || exitCode !== 0) throw unsafeWorldFilesystem();
      const lines = output.toString('utf8').split(/\r?\n/).filter(Boolean);
      if (lines.length !== 2) throw unsafeWorldFilesystem();
      let result;
      try { result = JSON.parse(lines[1]); } catch { throw unsafeWorldFilesystem(); }
      const keys = result && typeof result === 'object' ? Object.keys(result).sort() : [];
      if (result?.ok !== true || result?.[expectedField] !== true
        || keys.join(',') !== [expectedField, 'ok'].sort().join(',')) {
        throw unsafeWorldFilesystem();
      }
    })();
    return terminalPromise;
  };
  return {
    assertHeld() { if (exited || processErrored) throw unsafeWorldFilesystem(); },
    release() { return complete('release', 'released'); },
    delete() { return complete('delete', 'deleted'); },
    rename(destination) {
      if (!validWindowsBatchFilePath(destination)) {
        return Promise.reject(unsafeWorldFilesystem());
      }
      return complete({ command: 'rename', destination }, 'renamed');
    },
    replace(destination) {
      if (!validWindowsBatchFilePath(destination)) {
        return Promise.reject(unsafeWorldFilesystem());
      }
      return complete({ command: 'replace', destination }, 'replaced');
    },
  };
}

// File-oriented callers can opt into the single-helper exact-file protocol
// without changing the existing one-path dependency-injection contract.
acquireWindowsFileGuard.batch = acquireWindowsFileGuardBatch;
