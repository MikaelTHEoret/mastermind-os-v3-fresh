import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import {
  digestMastermindNodeCredential,
  parseMastermindNodePairingCredential,
} from '../../../protocol/mastermind-node-exchange/contract.mjs';
import {
  MastermindNodeCredentialStoreError,
  validateMastermindNodeCredentialRecord,
} from './credential-store.mjs';

const MAX_RECORD_BYTES = 4 * 1024;
const MAX_PROTECTED_BYTES = 16 * 1024;
const MAX_VAULT_BYTES = 32 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IN_PROCESS_MUTEXES = new Map();

async function acquireInProcessMutex(key) {
  const previous = IN_PROCESS_MUTEXES.get(key) ?? Promise.resolve();
  let releaseGate;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  IN_PROCESS_MUTEXES.set(key, tail);
  await previous.catch(() => undefined);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    releaseGate();
    if (IN_PROCESS_MUTEXES.get(key) === tail) {
      await tail;
      if (IN_PROCESS_MUTEXES.get(key) === tail) IN_PROCESS_MUTEXES.delete(key);
    }
  };
}

export async function acquireMastermindNodeCredentialPipeMutex(
  pipeName,
  timeoutMs,
  createServer = (connectionListener) => net.createServer(connectionListener),
) {
  if (typeof pipeName !== 'string'
    || !/^\\\\\.\\pipe\\mastermind-node-credential-[0-9a-f]{64}$/u.test(pipeName)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000
    || typeof createServer !== 'function') {
    throw new TypeError('Invalid node credential pipe mutex options');
  }
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const server = createServer((socket) => socket.destroy());
    const result = await new Promise((resolve) => {
      const onError = (error) => resolve({ error });
      server.once('error', onError);
      server.listen(pipeName, () => {
        server.off('error', onError);
        resolve({ listening: true });
      });
    });
    if (result.listening) {
      // The lock is owned by this Node process. If the process dies, Windows
      // closes the named pipe atomically, so no helper can lose authority
      // while JavaScript continues mutating the vault.
      let released = false;
      let releaseRequested = false;
      let heldError = null;
      const onHeldError = (error) => {
        heldError ??= storeError(
          'NODE_CREDENTIAL_WRITE_FAILED',
          'The node credential mutex reported an error while held.',
          error,
        );
      };
      const onHeldClose = () => {
        if (!releaseRequested) {
          // An unexpected close releases cross-process exclusion. Fail-stop
          // synchronously so no queued JavaScript mutation can continue under
          // the false assumption that this process still owns the vault.
          throw storeError(
            'NODE_CREDENTIAL_WRITE_FAILED',
            'The node credential mutex closed unexpectedly.',
          );
        }
      };
      server.on('error', onHeldError);
      server.on('close', onHeldClose);
      return async () => {
        if (released) return;
        released = true;
        releaseRequested = true;
        try {
          await new Promise((resolve, reject) => {
            server.close((error) => {
              if (error) reject(error); else resolve();
            });
          });
        } finally {
          server.off('error', onHeldError);
          server.off('close', onHeldClose);
        }
        if (heldError) throw heldError;
      };
    }
    try { server.close(); } catch { /* A failed listen has no open handle. */ }
    if (result.error?.code !== 'EADDRINUSE') {
      throw storeError('NODE_CREDENTIAL_WRITE_FAILED', 'The node credential mutex could not be acquired.', result.error);
    }
    if (performance.now() >= deadline) {
      throw storeError('NODE_CREDENTIAL_WRITE_FAILED', 'The node credential mutex timed out.');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function validateRetirementScope(scope) {
  const actualKeys = scope && typeof scope === 'object' && !Array.isArray(scope)
    ? Object.keys(scope).sort()
    : [];
  if (actualKeys.join('\0') !== 'expectedCredentialSha256\0expectedNodeId\0expectedPairingId'
    || !UUID.test(scope.expectedNodeId) || !UUID.test(scope.expectedPairingId)
    || !SHA256.test(scope.expectedCredentialSha256)) {
    throw storeError('NODE_PAIRING_SCOPE_MISMATCH', 'The expired pairing scope is invalid.');
  }
  return Object.freeze({
    expectedNodeId: scope.expectedNodeId,
    expectedPairingId: scope.expectedPairingId,
    expectedCredentialSha256: scope.expectedCredentialSha256,
  });
}

function retirementMatches(left, right) {
  return left.expectedNodeId === right.expectedNodeId
    && left.expectedPairingId === right.expectedPairingId
    && left.expectedCredentialSha256 === right.expectedCredentialSha256;
}

function storeError(code, message, cause) {
  return new MastermindNodeCredentialStoreError(code, message, cause ? { cause } : undefined);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw storeError('NODE_CREDENTIAL_VAULT_INVALID', `${label} is invalid.`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw storeError('NODE_CREDENTIAL_VAULT_INVALID', `${label} is invalid.`);
  }
  return value;
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && value.length === 24
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function timestamp(now) {
  const value = new Date(now()).toISOString();
  if (!canonicalTimestamp(value)) throw storeError('NODE_CREDENTIAL_CLOCK_INVALID', 'The node credential clock is invalid.');
  return value;
}

function canonicalBase64(value, maximumBytes, label) {
  if (typeof value !== 'string' || value.length < 4
    || value.length > Math.ceil(maximumBytes / 3) * 4 || !BASE64.test(value)) {
    throw storeError('NODE_CREDENTIAL_VAULT_INVALID', `${label} is invalid.`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 1 || bytes.length > maximumBytes || bytes.toString('base64') !== value) {
    bytes.fill(0);
    throw storeError('NODE_CREDENTIAL_VAULT_INVALID', `${label} is invalid.`);
  }
  return bytes;
}

function powershellExecutable(windowsRoot = process.env.SystemRoot ?? process.env.WINDIR) {
  if (typeof windowsRoot !== 'string' || !path.win32.isAbsolute(windowsRoot) || windowsRoot.includes('\0')) {
    throw storeError('NODE_DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection is unavailable.');
  }
  return path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function redacted(record) {
  if (!record) return { state: 'unpaired', nodeId: null, pairingId: null };
  return { state: record.state, nodeId: record.nodeId, pairingId: record.pairingId };
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not consistently supported by Windows. The encrypted
    // file itself is still flushed before its atomic publication.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Host-bound node enrollment vault. All enrollment state, including an exact
 * pending claim, is encrypted with Windows CurrentUser DPAPI and atomically
 * published before any caller can send it to the hosted pair endpoint.
 */
export class WindowsDpapiMastermindNodeCredentialStore {
  #queue = Promise.resolve();

  constructor(options = {}) {
    if (typeof options.vaultFile !== 'string' || !path.isAbsolute(options.vaultFile) || options.vaultFile.includes('\0')) {
      throw new TypeError('An absolute node credential vaultFile is required');
    }
    this.vaultFile = path.resolve(options.vaultFile);
    this.retirementIntentFile = `${this.vaultFile}.retire-intent.json`;
    this.retirementCandidateFile = `${this.vaultFile}.retiring`;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.platform = options.platform ?? process.platform;
    this.windowsRoot = options.windowsRoot ?? process.env.SystemRoot ?? process.env.WINDIR;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.mutexTimeoutMs = options.mutexTimeoutMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
    this.randomBytes = options.randomBytes ?? crypto.randomBytes;
    this.transform = options.transform ?? null;
    this.acquireMutex = options.acquireMutex ?? null;
    this.dpapiScriptFile = options.dpapiScriptFile ?? null;
    if (typeof this.spawnProcess !== 'function' || typeof this.now !== 'function'
      || typeof this.randomUUID !== 'function' || typeof this.randomBytes !== 'function'
      || (this.transform !== null && typeof this.transform !== 'function')
      || (this.acquireMutex !== null && typeof this.acquireMutex !== 'function')) {
      throw new TypeError('Node credential vault runtime dependencies are invalid');
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 30_000) {
      throw new TypeError('timeoutMs must be an integer between 1000 and 30000');
    }
    if (!Number.isSafeInteger(this.mutexTimeoutMs)
      || this.mutexTimeoutMs < 1_000 || this.mutexTimeoutMs > 120_000) {
      throw new TypeError('mutexTimeoutMs must be an integer between 1000 and 120000');
    }
    if (this.transform === null && (
      typeof this.dpapiScriptFile !== 'string'
      || (!path.isAbsolute(this.dpapiScriptFile) && !path.win32.isAbsolute(this.dpapiScriptFile))
      || this.dpapiScriptFile.includes('\0')
    )) {
      throw new TypeError('An absolute DPAPI script file is required');
    }
    if (this.dpapiScriptFile !== null) {
      const pathApi = path.win32.isAbsolute(this.dpapiScriptFile) ? path.win32 : path;
      this.dpapiScriptFile = pathApi.resolve(this.dpapiScriptFile);
    }
  }

  load() {
    return this.#serialized(() => this.#loadWithinQueue());
  }

  beginPairing(pairingCredential, displayName) {
    let pairing;
    try { pairing = parseMastermindNodePairingCredential(pairingCredential); }
    catch (error) { throw storeError('NODE_PAIRING_CREDENTIAL_INVALID', 'The one-time node pairing credential is invalid.', error); }
    return this.#serialized(async () => {
      const existing = await this.#loadWithinQueue();
      if (existing) {
        if (existing.state === 'pending' && existing.pairingCredential === pairingCredential
          && existing.displayName === displayName) return redacted(existing);
        throw storeError('NODE_PAIRING_STATE_CONFLICT', 'A different node enrollment is already protected on this host.');
      }
      const nodeId = this.randomUUID();
      if (!UUID.test(nodeId)) throw new TypeError('randomUUID must return a lowercase UUID');
      const secretBytes = this.randomBytes(32);
      if (!(secretBytes instanceof Uint8Array) || secretBytes.byteLength !== 32) {
        throw new TypeError('randomBytes must return exactly 32 bytes');
      }
      let nodeCredential;
      try { nodeCredential = `mn1.${nodeId}.${Buffer.from(secretBytes).toString('base64url')}`; }
      finally { secretBytes.fill(0); }
      const record = validateMastermindNodeCredentialRecord({
        schemaVersion: 1,
        state: 'pending',
        nodeId,
        nodeCredential,
        pairingId: pairing.pairingId,
        pairingCredential,
        displayName,
        createdAt: timestamp(this.now),
        pairedAt: null,
      });
      try {
        await this.#saveWithinQueue(record, { createOnly: true });
        return redacted(record);
      } catch (error) {
        if (error?.code !== 'NODE_CREDENTIAL_ALREADY_EXISTS') throw error;
        // Another local process won the first-publication race. The hard-link
        // publication guarantees its complete encrypted bytes are visible now.
        const winner = await this.#loadWithinQueue();
        if (winner?.state === 'pending' && winner.pairingCredential === pairingCredential
          && winner.displayName === displayName) return redacted(winner);
        throw storeError('NODE_PAIRING_STATE_CONFLICT', 'A different node enrollment is already protected on this host.');
      }
    });
  }

  markPaired(scope = {}) {
    return this.#serialized(async () => {
      const record = await this.#loadWithinQueue();
      if (!record) throw storeError('NODE_PAIRING_STATE_CONFLICT', 'No pending node enrollment exists on this host.');
      if (record.nodeId !== scope.expectedNodeId || record.pairingId !== scope.expectedPairingId) {
        throw storeError('NODE_PAIRING_SCOPE_MISMATCH', 'The pair response does not match the protected pending enrollment.');
      }
      if (!canonicalTimestamp(scope.pairedAt)) {
        throw storeError('NODE_PAIRING_SCOPE_MISMATCH', 'The pair response timestamp is invalid.');
      }
      if (record.state === 'paired') return redacted(record);
      const paired = validateMastermindNodeCredentialRecord({
        ...record,
        state: 'paired',
        pairingCredential: null,
        pairedAt: scope.pairedAt,
      });
      await this.#saveWithinQueue(paired);
      return redacted(paired);
    });
  }

  retirePendingPairing(scope = {}) {
    const validatedScope = validateRetirementScope(scope);
    return this.#serialized(async () => {
      await this.#publishRetirementIntentWithinQueue(validatedScope);
      const retired = await this.#finishRetirementWithinQueue(validatedScope);
      const current = await this.#loadWithinQueue();
      return { retired, ...redacted(current) };
    });
  }

  clear() {
    return this.#serialized(async () => {
      await this.#recoverRetirementWithinQueue();
      try {
        const stat = await fs.lstat(this.vaultFile);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The encrypted node credential vault is unsafe.');
        }
        await fs.unlink(this.vaultFile);
        return { removed: true };
      } catch (error) {
        if (error?.code === 'ENOENT') return { removed: false };
        if (error instanceof MastermindNodeCredentialStoreError) throw error;
        throw storeError('NODE_CREDENTIAL_WRITE_FAILED', 'The encrypted node credential vault could not be removed.', error);
      }
    });
  }

  async #readRetirementIntentWithinQueue() {
    let text;
    try {
      const stat = await fs.lstat(this.retirementIntentFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 3 || stat.size > 1024) {
        throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The node retirement intent is unsafe.');
      }
      text = await fs.readFile(this.retirementIntentFile, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error instanceof MastermindNodeCredentialStoreError) throw error;
      throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The node retirement intent could not be read.', error);
    }
    let value;
    try { value = JSON.parse(text); }
    catch (error) { throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The node retirement intent is invalid.', error); }
    exactKeys(value, [
      'schemaVersion', 'expectedNodeId', 'expectedPairingId', 'expectedCredentialSha256',
    ], 'The node retirement intent');
    if (value.schemaVersion !== 1) {
      throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The node retirement intent is invalid.');
    }
    return validateRetirementScope({
      expectedNodeId: value.expectedNodeId,
      expectedPairingId: value.expectedPairingId,
      expectedCredentialSha256: value.expectedCredentialSha256,
    });
  }

  async #publishRetirementIntentWithinQueue(scope) {
    const existing = await this.#readRetirementIntentWithinQueue();
    if (existing) {
      if (!retirementMatches(existing, scope)) {
        throw storeError('NODE_PAIRING_STATE_CONFLICT', 'A different node retirement is already in progress.');
      }
      return;
    }
    await fs.mkdir(path.dirname(this.vaultFile), { recursive: true, mode: 0o700 });
    const body = `${JSON.stringify({ schemaVersion: 1, ...scope })}\n`;
    const temporary = `${this.retirementIntentFile}.${process.pid}.${this.randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(body, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.link(temporary, this.retirementIntentFile);
      await fs.unlink(temporary);
      await syncDirectory(path.dirname(this.vaultFile));
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temporary).catch(() => undefined);
      if (error?.code === 'EEXIST') {
        const winner = await this.#readRetirementIntentWithinQueue();
        if (winner && retirementMatches(winner, scope)) return;
        throw storeError('NODE_PAIRING_STATE_CONFLICT', 'A different node retirement is already in progress.', error);
      }
      throw storeError('NODE_CREDENTIAL_WRITE_FAILED', 'The expired node retirement could not be prepared.', error);
    }
  }

  async #restoreRetirementCandidateWithinQueue() {
    try {
      await fs.link(this.retirementCandidateFile, this.vaultFile);
      await fs.unlink(this.retirementCandidateFile);
      await fs.unlink(this.retirementIntentFile).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      await syncDirectory(path.dirname(this.vaultFile));
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') {
        try {
          const [candidate, canonical] = await Promise.all([
            fs.lstat(this.retirementCandidateFile),
            fs.lstat(this.vaultFile),
          ]);
          const sameFile = candidate.isFile() && !candidate.isSymbolicLink()
            && canonical.isFile() && !canonical.isSymbolicLink()
            && candidate.dev === canonical.dev && candidate.ino === canonical.ino
            && candidate.size === canonical.size;
          if (!sameFile) return false;
          await fs.unlink(this.retirementCandidateFile);
          await fs.unlink(this.retirementIntentFile).catch((unlinkError) => {
            if (unlinkError?.code !== 'ENOENT') throw unlinkError;
          });
          await syncDirectory(path.dirname(this.vaultFile));
          return true;
        } catch (recoveryError) {
          if (recoveryError instanceof MastermindNodeCredentialStoreError) throw recoveryError;
          throw storeError('NODE_CREDENTIAL_WRITE_FAILED', 'The protected node identity recovery could not finish.', recoveryError);
        }
      }
      throw storeError('NODE_CREDENTIAL_WRITE_FAILED', 'The protected node identity could not be restored.', error);
    }
  }

  async #finishRetirementWithinQueue(scope) {
    const intent = await this.#readRetirementIntentWithinQueue();
    if (!intent || !retirementMatches(intent, scope)) {
      throw storeError('NODE_PAIRING_STATE_CONFLICT', 'The node retirement intent changed unexpectedly.');
    }
    try {
      const stat = await fs.lstat(this.retirementCandidateFile);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The retiring node credential is unsafe.');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        if (error instanceof MastermindNodeCredentialStoreError) throw error;
        throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The retiring node credential could not be inspected.', error);
      }
      let canonicalRecord = null;
      try { canonicalRecord = await this.#loadFileWithinQueue(this.vaultFile); }
      catch (canonicalError) {
        if (canonicalError?.cause?.code !== 'ENOENT' && canonicalError?.code !== 'ENOENT') {
          // #loadFileWithinQueue maps an absent path to null; every other
          // failure is an unsafe vault state that must remain fenced.
          if (canonicalError instanceof MastermindNodeCredentialStoreError) throw canonicalError;
          throw canonicalError;
        }
      }
      if (canonicalRecord) {
        const canonicalIsExactPending = canonicalRecord.state === 'pending'
          && canonicalRecord.nodeId === scope.expectedNodeId
          && canonicalRecord.pairingId === scope.expectedPairingId
          && digestMastermindNodeCredential(canonicalRecord.nodeCredential) === scope.expectedCredentialSha256;
        if (!canonicalIsExactPending) {
          await fs.unlink(this.retirementIntentFile).catch((unlinkError) => {
            if (unlinkError?.code !== 'ENOENT') throw unlinkError;
          });
          await syncDirectory(path.dirname(this.vaultFile));
          if (canonicalRecord.state === 'paired') return false;
          throw storeError('NODE_PAIRING_SCOPE_MISMATCH', 'The expired pairing does not match the protected pending enrollment.');
        }
      }
      try {
        await fs.rename(this.vaultFile, this.retirementCandidateFile);
      } catch (renameError) {
        if (renameError?.code !== 'ENOENT') {
          throw storeError('NODE_CREDENTIAL_WRITE_FAILED', 'The expired node enrollment could not be isolated.', renameError);
        }
        try {
          await fs.lstat(this.retirementCandidateFile);
        } catch (candidateError) {
          if (candidateError?.code !== 'ENOENT') throw candidateError;
          await fs.unlink(this.retirementIntentFile).catch((unlinkError) => {
            if (unlinkError?.code !== 'ENOENT') throw unlinkError;
          });
          await syncDirectory(path.dirname(this.vaultFile));
          return false;
        }
      }
    }

    const record = await this.#loadFileWithinQueue(this.retirementCandidateFile);
    const exactPending = record?.state === 'pending'
      && record.nodeId === scope.expectedNodeId
      && record.pairingId === scope.expectedPairingId
      && digestMastermindNodeCredential(record.nodeCredential) === scope.expectedCredentialSha256;
    if (!exactPending) {
      const restored = await this.#restoreRetirementCandidateWithinQueue();
      if (!restored) {
        throw storeError('NODE_PAIRING_STATE_CONFLICT', 'A changed node identity was preserved during retirement.');
      }
      if (record?.state === 'paired') {
        return false;
      }
      throw storeError('NODE_PAIRING_SCOPE_MISMATCH', 'The expired pairing does not match the protected pending enrollment.');
    }
    await fs.unlink(this.retirementCandidateFile).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await fs.unlink(this.retirementIntentFile).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await syncDirectory(path.dirname(this.vaultFile));
    return true;
  }

  async #recoverRetirementWithinQueue() {
    const intent = await this.#readRetirementIntentWithinQueue();
    if (!intent) {
      try {
        await fs.lstat(this.retirementCandidateFile);
      } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
      }
      throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'An unauthenticated node retirement candidate was preserved.');
    }
    await this.#finishRetirementWithinQueue(intent);
  }

  async #loadWithinQueue() {
    await this.#recoverRetirementWithinQueue();
    return this.#loadFileWithinQueue(this.vaultFile);
  }

  async #loadFileWithinQueue(file) {
    let text;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 3 || stat.size > MAX_VAULT_BYTES) {
        throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The encrypted node credential vault is unsafe.');
      }
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error instanceof MastermindNodeCredentialStoreError) throw error;
      throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The encrypted node credential vault could not be read.', error);
    }
    let envelope;
    try { envelope = JSON.parse(text); }
    catch (error) { throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The encrypted node credential vault is invalid.', error); }
    exactKeys(envelope, ['schemaVersion', 'provider', 'protection', 'protectedPayload', 'updatedAt'], 'The node credential vault');
    if (envelope.schemaVersion !== 1 || envelope.provider !== 'mastermind-node-exchange'
      || envelope.protection !== 'windows-dpapi-current-user' || !canonicalTimestamp(envelope.updatedAt)) {
      throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The encrypted node credential vault is invalid.');
    }
    const protectedBytes = canonicalBase64(envelope.protectedPayload, MAX_PROTECTED_BYTES, 'The protected node credential payload');
    let plaintext;
    try {
      plaintext = await this.#transform('Unprotect', protectedBytes);
      if (plaintext.length < 3 || plaintext.length > MAX_RECORD_BYTES) throw new Error('Credential record exceeded its size limit');
      return validateMastermindNodeCredentialRecord(JSON.parse(plaintext.toString('utf8')));
    } catch (error) {
      if (error instanceof MastermindNodeCredentialStoreError) throw error;
      throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The encrypted node credential vault could not be decrypted.', error);
    } finally {
      protectedBytes.fill(0);
      plaintext?.fill(0);
    }
  }

  async #saveWithinQueue(record, options = {}) {
    const validated = validateMastermindNodeCredentialRecord(record);
    const plaintext = Buffer.from(JSON.stringify(validated), 'utf8');
    if (plaintext.length < 3 || plaintext.length > MAX_RECORD_BYTES) {
      plaintext.fill(0);
      throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The protected node credential record exceeded its size limit.');
    }
    let protectedBytes;
    try {
      protectedBytes = await this.#transform('Protect', plaintext);
      const envelope = {
        schemaVersion: 1,
        provider: 'mastermind-node-exchange',
        protection: 'windows-dpapi-current-user',
        protectedPayload: protectedBytes.toString('base64'),
        updatedAt: timestamp(this.now),
      };
      const body = `${JSON.stringify(envelope, null, 2)}\n`;
      if (Buffer.byteLength(body, 'utf8') > MAX_VAULT_BYTES) {
        throw storeError('NODE_CREDENTIAL_VAULT_INVALID', 'The encrypted node credential vault exceeded its size limit.');
      }
      await fs.mkdir(path.dirname(this.vaultFile), { recursive: true, mode: 0o700 });
      const temporary = `${this.vaultFile}.${process.pid}.${this.randomUUID()}.tmp`;
      let handle;
      try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(body, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.chmod(temporary, 0o600);
        if (options.createOnly === true) {
          // link() is an atomic create-if-absent publication on the local NTFS
          // volume; unlike rename-overwrite it cannot replace another process's
          // freshly enrolled identity.
          await fs.link(temporary, this.vaultFile);
          await fs.unlink(temporary);
        } else {
          await fs.rename(temporary, this.vaultFile);
        }
        await fs.chmod(this.vaultFile, 0o600);
        await syncDirectory(path.dirname(this.vaultFile));
      } catch (error) {
        await handle?.close().catch(() => undefined);
        await fs.unlink(temporary).catch(() => undefined);
        if (options.createOnly === true && error?.code === 'EEXIST') {
          throw storeError('NODE_CREDENTIAL_ALREADY_EXISTS', 'A node credential was concurrently published.', error);
        }
        throw storeError('NODE_CREDENTIAL_WRITE_FAILED', 'The encrypted node credential vault could not be saved.', error);
      }
      return { saved: true, updatedAt: envelope.updatedAt };
    } finally {
      plaintext.fill(0);
      protectedBytes?.fill(0);
    }
  }

  async #transform(action, bytes) {
    if (!['Protect', 'Unprotect'].includes(action)) throw new TypeError('Unsupported DPAPI action');
    if (this.transform) {
      const input = Buffer.from(bytes);
      try {
        const result = await this.transform(action, input);
        if (!(result instanceof Uint8Array) || result.byteLength < 1
          || result.byteLength > (action === 'Protect' ? MAX_PROTECTED_BYTES : MAX_RECORD_BYTES)) {
          throw storeError('NODE_DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection returned invalid data.');
        }
        return Buffer.from(result);
      } finally {
        input.fill(0);
      }
    }
    if (this.platform !== 'win32') {
      throw storeError('NODE_DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection is unavailable.');
    }
    const input = Buffer.from(JSON.stringify({ schemaVersion: 1, payloadBase64: bytes.toString('base64') }), 'utf8');
    let child;
    try {
      child = this.spawnProcess(powershellExecutable(this.windowsRoot), [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', this.dpapiScriptFile, '-Action', action,
      ], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => (
          ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR'].includes(key.toUpperCase()) && typeof value === 'string'
        ))),
      });
    } catch (error) {
      input.fill(0);
      throw storeError('NODE_DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection could not be started.', error);
    }
    if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function' || !child.stdin || !child.stdout) {
      input.fill(0);
      throw new TypeError('spawnProcess must return a piped ChildProcess-compatible handle');
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = Buffer.alloc(0);
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.fill(0);
        stdout.fill(0);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* The helper may already have exited. */ }
        finish(storeError('NODE_DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection timed out.'));
      }, this.timeoutMs);
      timer.unref?.();
      child.once('error', (error) => finish(storeError('NODE_DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection failed.', error)));
      child.stdout.on('data', (chunk) => {
        if (settled) return;
        const next = Buffer.concat([stdout, Buffer.from(chunk)]);
        stdout.fill(0);
        stdout = next;
        if (stdout.length > MAX_PROCESS_OUTPUT_BYTES) {
          try { child.kill('SIGTERM'); } catch { /* The helper may already have exited. */ }
          finish(storeError('NODE_DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection returned too much data.'));
        }
      });
      child.once('exit', (code) => {
        if (code !== 0) return finish(storeError('NODE_DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection failed.'));
        try {
          const output = JSON.parse(stdout.toString('utf8'));
          exactKeys(output, ['schemaVersion', 'payloadBase64'], 'The DPAPI response');
          if (output.schemaVersion !== 1) throw new Error('Unsupported DPAPI response');
          finish(null, canonicalBase64(
            output.payloadBase64,
            action === 'Protect' ? MAX_PROTECTED_BYTES : MAX_RECORD_BYTES,
            'The DPAPI response payload',
          ));
        } catch (error) {
          finish(error instanceof MastermindNodeCredentialStoreError
            ? error : storeError('NODE_DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection returned invalid data.', error));
        }
      });
      child.stdin.once?.('error', (error) => finish(storeError('NODE_DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection input failed.', error)));
      child.stdin.end(input);
    });
  }

  async #acquireCrossProcessMutex() {
    if (this.acquireMutex) return this.acquireMutex(this.vaultFile);
    if (this.transform) return acquireInProcessMutex(this.vaultFile.toLowerCase());
    if (this.platform !== 'win32') {
      throw storeError('NODE_CREDENTIAL_WRITE_FAILED', 'The node credential mutex is unavailable.');
    }
    const pipeName = String.raw`\\.\pipe\mastermind-node-credential-${crypto.createHash('sha256')
      .update(this.vaultFile.toLowerCase(), 'utf8').digest('hex')}`;
    return acquireMastermindNodeCredentialPipeMutex(pipeName, this.mutexTimeoutMs);
  }

  #serialized(operation) {
    const run = this.#queue.catch(() => undefined).then(async () => {
      const release = await this.#acquireCrossProcessMutex();
      try { return await operation(); }
      finally { await release(); }
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }
}
