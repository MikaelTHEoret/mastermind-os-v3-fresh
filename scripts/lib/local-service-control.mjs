import crypto from 'node:crypto';
import net from 'node:net';

const TOKEN = /^[a-f0-9]{64}$/;
const SUPERVISOR_ID = /^[a-f0-9]{32}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIGNAL = /^[A-Z][A-Z0-9]{0,31}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const ANSI_ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
const UNSAFE_TEXT = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

export const LOCAL_SERVICE_ROLES = Object.freeze([
  'supervisor',
  'minecraft-control-agent',
  'next-web',
  'mastermind-node-link',
]);
export const LOCAL_SERVICE_REQUEST_MAX_BYTES = 4 * 1024;
export const LOCAL_SERVICE_RESPONSE_MAX_BYTES = 128 * 1024;
export const LOCAL_SERVICE_LOG_LINE_MAX_BYTES = 2 * 1024;
export const LOCAL_NODE_LINK_RECOVERY_BASE_DELAY_MS = 1_000;
export const LOCAL_NODE_LINK_RECOVERY_MAX_DELAY_MS = 30_000;
export const LOCAL_NODE_LINK_RECOVERY_STABLE_AFTER_MS = 60_000;

const LOCAL_AGENT_HEALTH_URL = 'http://127.0.0.1:43100/healthz';
export const LOCAL_AGENT_STARTUP_HEALTH_TIMEOUT_MS = 600_000;
const LOCAL_AGENT_HEALTH_MAX_BYTES = 4 * 1024;

const ROLE_SET = new Set(LOCAL_SERVICE_ROLES);
const STREAM_SET = new Set(['stdout', 'stderr', 'system']);
const STATE_SET = new Set(['running', 'restarting', 'failed']);

export class LocalServiceControlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalServiceControlError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new LocalServiceControlError(code, message);
}

function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const observed = Object.keys(value).sort();
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && observed.every((key) => allowed.has(key));
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function safeGeneration(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function safeExit(value) {
  if (value === null) return null;
  if (!exactKeys(value, ['at', 'kind', 'code', 'signal'])
    || !canonicalTimestamp(value.at)
    || !['clean', 'unexpected'].includes(value.kind)
    || (value.code !== null && (!Number.isSafeInteger(value.code) || value.code < 0 || value.code > 0xffffffff))
    || (value.signal !== null && (typeof value.signal !== 'string' || !SIGNAL.test(value.signal)))) {
    throw new TypeError('Invalid bounded local-service exit record');
  }
  return Object.freeze({ ...value });
}

function serviceRecord(role, state, generation, port, lastExit = null) {
  if (!ROLE_SET.has(role) || !STATE_SET.has(state) || !safeGeneration(generation)
    || (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))) {
    throw new TypeError('Invalid local-service status record');
  }
  return { role, state, generation, port, lastExit: safeExit(lastExit) };
}

function copyOperation(operation) {
  return {
    requestId: operation.requestId,
    role: operation.role,
    state: operation.state,
    expectedGeneration: operation.expectedGeneration,
    generation: operation.generation,
    acceptedAt: operation.acceptedAt,
    finishedAt: operation.finishedAt,
    code: operation.code,
  };
}

function trimUtf8(value, maximumBytes) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maximumBytes) return value;
  return bytes.subarray(0, maximumBytes).toString('utf8').replace(/\uFFFD$/u, '');
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeLogText(value, redactions) {
  let line = String(value).replace(ANSI_ESCAPE, '').replace(UNSAFE_TEXT, ' ');
  for (const redaction of redactions) line = line.replace(redaction, '[REDACTED]');
  return line;
}

function sanitizeLogLine(value, redactions) {
  return trimUtf8(sanitizeLogText(value, redactions), LOCAL_SERVICE_LOG_LINE_MAX_BYTES);
}

async function readBoundedResponseBytes(response, maximumBytes) {
  const declared = Number(response.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error('oversized response');
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      do {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maximumBytes) throw new Error('oversized response');
        chunks.push(chunk);
      } while (true);
    } catch (error) {
      await reader.cancel?.().catch?.(() => undefined);
      throw error;
    }
    return Buffer.concat(chunks, total);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximumBytes) throw new Error('oversized response');
  return bytes;
}

export function createLocalServiceLog(options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const maximumEntries = options.maximumEntries ?? 1_000;
  const maximumBytes = options.maximumBytes ?? 512 * 1024;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const secrets = options.secrets ?? [];
  if (typeof now !== 'function' || !Number.isInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 10_000
    || !Number.isInteger(maximumBytes) || maximumBytes < 4_096 || maximumBytes > 8 * 1024 * 1024
    || !stdout || typeof stdout.write !== 'function' || !stderr || typeof stderr.write !== 'function'
    || !Array.isArray(secrets) || secrets.length > 16
    || secrets.some((value) => typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > 4_096)) {
    throw new TypeError('Invalid bounded local-service log configuration');
  }
  const uniqueSecrets = [...new Set(secrets)].sort((left, right) => right.length - left.length);
  const redactions = uniqueSecrets.map((secret) => new RegExp(escapeRegularExpression(secret), 'gi'));
  const maximumSecretBytes = uniqueSecrets.reduce(
    (maximum, secret) => Math.max(maximum, Buffer.byteLength(secret, 'utf8')),
    0,
  );
  const entries = [];
  const partials = new Map();
  let totalBytes = 0;
  let sequence = 0;

  const emit = (role, stream, raw) => {
    if (!ROLE_SET.has(role) || !STREAM_SET.has(stream)) throw new TypeError('Invalid local-service log source');
    const line = sanitizeLogLine(raw, redactions);
    const at = now();
    if (!canonicalTimestamp(at)) throw new TypeError('Invalid local-service log timestamp');
    const entry = Object.freeze({ sequence: ++sequence, at, role, stream, line });
    const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
    entries.push({ entry, bytes });
    totalBytes += bytes;
    while (entries.length > maximumEntries || totalBytes > maximumBytes) {
      totalBytes -= entries.shift().bytes;
    }
    const sink = stream === 'stderr' ? stderr : stdout;
    sink.write(`[${role}] ${line}\n`);
    return entry;
  };

  const write = (role, stream, chunk) => {
    if (!ROLE_SET.has(role) || !['stdout', 'stderr'].includes(stream)
      || (!Buffer.isBuffer(chunk) && typeof chunk !== 'string')) {
      throw new TypeError('Invalid local-service output chunk');
    }
    const key = `${role}:${stream}`;
    let text = `${partials.get(key) ?? ''}${Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk}`;
    const lines = text.split(/\r\n?|\n/u);
    text = lines.pop() ?? '';
    for (const line of lines) emit(role, stream, line);
    while (Buffer.byteLength(text, 'utf8') > LOCAL_SERVICE_LOG_LINE_MAX_BYTES + maximumSecretBytes) {
      text = sanitizeLogText(text, redactions);
      const piece = trimUtf8(text, LOCAL_SERVICE_LOG_LINE_MAX_BYTES);
      emit(role, stream, piece);
      text = text.slice(piece.length);
    }
    partials.set(key, text);
  };

  const flush = (role, stream) => {
    const key = `${role}:${stream}`;
    const pending = partials.get(key) ?? '';
    partials.delete(key);
    if (pending) emit(role, stream, pending);
  };

  const appendSystem = (role, line) => emit(role, 'system', line);

  const tail = (role, limit, after = null) => {
    if (!ROLE_SET.has(role)) fail('TARGET_NOT_ALLOWED', 'The requested local-service role is not available');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200
      || (after !== null && (!Number.isSafeInteger(after) || after < 0))) {
      fail('INVALID_REQUEST', 'The local-service log cursor is invalid');
    }
    const matching = entries.filter(({ entry }) => entry.role === role && (after === null || entry.sequence > after));
    const selected = after === null ? matching.slice(-limit) : matching.slice(0, limit);
    const result = [];
    let responseBytes = 256;
    for (const { entry, bytes } of selected) {
      if (responseBytes + bytes > 120 * 1024) break;
      responseBytes += bytes;
      result.push(entry);
    }
    return { entries: result, nextSequence: sequence };
  };

  return Object.freeze({ write, flush, appendSystem, tail });
}

export async function waitForLocalAgentHealth(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const assertOwned = options.assertOwned;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutSignal = options.timeoutSignal ?? ((milliseconds) => AbortSignal.timeout(milliseconds));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 1_500;
  const retryMs = options.retryMs ?? 100;
  if (typeof fetchImpl !== 'function' || typeof assertOwned !== 'function' || typeof now !== 'function'
    || typeof sleep !== 'function' || typeof timeoutSignal !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > LOCAL_AGENT_STARTUP_HEALTH_TIMEOUT_MS
    || !Number.isInteger(attemptTimeoutMs) || attemptTimeoutMs < 50 || attemptTimeoutMs > 5_000
    || !Number.isInteger(retryMs) || retryMs < 1 || retryMs > 1_000) {
    throw new TypeError('Invalid bounded local-agent health configuration');
  }
  const deadline = now() + timeoutMs;
  do {
    await assertOwned();
    let healthy = false;
    try {
      const response = await fetchImpl(LOCAL_AGENT_HEALTH_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: timeoutSignal(attemptTimeoutMs),
      });
      const bytes = await readBoundedResponseBytes(response, LOCAL_AGENT_HEALTH_MAX_BYTES);
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      healthy = response.status === 200 && body?.ok === true
        && body.service === 'mastermind-minecraft-control' && body.version === 2;
    } catch {
      // Retry only while the exact spawned child remains owned and the
      // bounded startup deadline has not elapsed.
    }
    if (healthy) {
      await assertOwned();
      return { ok: true };
    }
    if (now() >= deadline) break;
    await sleep(Math.min(retryMs, Math.max(1, deadline - now())));
  } while (now() <= deadline);
  throw Object.assign(new Error('The exact Minecraft control agent did not become healthy before the startup deadline'), {
    code: 'AGENT_HEALTH_TIMEOUT',
  });
}

function restartFailure(message, serviceState, lastExit, cause) {
  return Object.assign(new Error(message), {
    cause,
    serviceState,
    ...(lastExit === undefined ? {} : { lastExit }),
  });
}

export function createMinecraftAgentRestarter(options = {}) {
  const required = [
    'getActive', 'getLastExit', 'drain', 'markIntentional', 'unmarkIntentional', 'signal',
    'waitForExit', 'waitForPortRelease', 'isExactAlive', 'removeAndPersist', 'recordCleanExit',
    'spawn', 'isActive', 'assertCanContinue',
  ];
  if (required.some((name) => typeof options[name] !== 'function')) {
    throw new TypeError('Invalid Minecraft agent restart lifecycle');
  }
  return async function restartMinecraftAgent({ generation }) {
    if (!safeGeneration(generation)) throw new TypeError('Invalid Minecraft agent restart generation');
    options.assertCanContinue();
    const existing = options.getActive() ?? null;
    let lastExit = existing ? null : options.getLastExit();
    if (existing) {
      try {
        await options.drain(existing);
      } catch (error) {
        throw restartFailure('The Minecraft control agent refused its safe restart drain', 'running', undefined, error);
      }
      options.assertCanContinue();
      options.markIntentional(existing);
      let signalled;
      try {
        signalled = options.signal(existing);
      } catch (error) {
        options.unmarkIntentional(existing);
        throw restartFailure('The exact Minecraft control agent could not be signalled after its drain', 'running', undefined, error);
      }
      if (!signalled) {
        let exactAlive = true;
        try { exactAlive = await options.isExactAlive(existing); } catch {}
        if (exactAlive) {
          options.unmarkIntentional(existing);
          throw restartFailure('The exact Minecraft control agent could not be signalled after its drain', 'running');
        }
      }
      try {
        await options.waitForExit(existing);
        await options.waitForPortRelease();
      } catch (error) {
        let exactAlive = true;
        try { exactAlive = await options.isExactAlive(existing); } catch {}
        if (exactAlive) {
          options.unmarkIntentional(existing);
          throw restartFailure('The exact Minecraft control agent did not finish its bounded restart shutdown', 'running', undefined, error);
        }
        lastExit = options.recordCleanExit(existing);
        try { await options.removeAndPersist(existing); } catch (persistError) {
          throw restartFailure('The stopped Minecraft control agent could not be removed from signed supervisor state', 'failed', lastExit, persistError);
        }
        throw restartFailure('The Minecraft control agent restart stopped before respawn', 'failed', lastExit, error);
      }
      options.assertCanContinue();
      lastExit = options.recordCleanExit(existing);
      try {
        await options.removeAndPersist(existing);
      } catch (error) {
        throw restartFailure('The stopped Minecraft control agent could not be removed from signed supervisor state', 'failed', lastExit, error);
      }
    } else {
      try {
        await options.waitForPortRelease();
      } catch (error) {
        throw restartFailure('The Minecraft control port is not available for a bounded restart', 'failed', lastExit, error);
      }
    }
    options.assertCanContinue();
    let spawned;
    try {
      spawned = await options.spawn(generation);
    } catch (error) {
      throw restartFailure('The Minecraft control agent did not restart from its exact entrypoint', 'failed', lastExit, error);
    }
    if (!options.isActive(spawned)) {
      throw restartFailure('The replacement Minecraft control agent exited before restart publication', 'failed', lastExit);
    }
    options.assertCanContinue();
    return { lastExit, confirmRunning: () => options.isActive(spawned) };
  };
}

/**
 * Supervisor-internal recovery for the portless node-link child. This is not
 * exposed through the browser control protocol: the dashboard may observe the
 * infrastructure role, while only the signed supervisor can replace it.
 */
export function createMastermindNodeLinkRecoveryController(options = {}) {
  const required = [
    'isClosing', 'isPresent', 'getGeneration', 'spawn', 'isActive', 'markRunning',
  ];
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearSchedule = options.clearSchedule ?? ((handle) => clearTimeout(handle));
  const reportFailure = options.reportFailure ?? (() => {});
  const baseDelayMs = options.baseDelayMs ?? LOCAL_NODE_LINK_RECOVERY_BASE_DELAY_MS;
  const maximumDelayMs = options.maximumDelayMs ?? LOCAL_NODE_LINK_RECOVERY_MAX_DELAY_MS;
  const stableAfterMs = options.stableAfterMs ?? LOCAL_NODE_LINK_RECOVERY_STABLE_AFTER_MS;
  if (required.some((name) => typeof options[name] !== 'function')
    || typeof schedule !== 'function' || typeof clearSchedule !== 'function'
    || typeof reportFailure !== 'function'
    || !Number.isSafeInteger(baseDelayMs) || baseDelayMs < 1 || baseDelayMs > 60_000
    || !Number.isSafeInteger(maximumDelayMs) || maximumDelayMs < baseDelayMs || maximumDelayMs > 300_000
    || !Number.isSafeInteger(stableAfterMs) || stableAfterMs < 1_000 || stableAfterMs > 600_000) {
    throw new TypeError('Invalid Mastermind node-link recovery lifecycle');
  }

  let retryTimer = null;
  let stableTimer = null;
  let stableRecord = null;
  let inFlight = null;
  let inFlightGeneration = null;
  let exitObservedDuringAttempt = false;
  let immediateAfterFlight = false;
  let failureCount = 0;
  let suspended = false;
  let epoch = 0;

  const canRecover = () => !suspended && !options.isClosing();
  const unref = (handle) => handle?.unref?.();
  const retryDelay = () => Math.min(
    maximumDelayMs,
    baseDelayMs * (2 ** Math.min(Math.max(failureCount - 1, 0), 30)),
  );

  const cancelRetry = () => {
    if (retryTimer === null) return;
    clearSchedule(retryTimer);
    retryTimer = null;
  };

  const clearStability = ({ preserveRecord = false } = {}) => {
    if (stableTimer !== null) clearSchedule(stableTimer);
    stableTimer = null;
    if (!preserveRecord) stableRecord = null;
  };

  const armStability = (record) => {
    clearStability();
    stableRecord = record;
    stableTimer = schedule(() => {
      stableTimer = null;
      const expected = stableRecord;
      stableRecord = null;
      if (canRecover() && expected === record && options.isActive(record)) failureCount = 0;
    }, stableAfterMs);
    unref(stableTimer);
  };

  const recordFailure = (error = null) => {
    failureCount = Math.min(failureCount + 1, 31);
    if (error !== null) {
      try { reportFailure(error); } catch { /* Recovery must not depend on diagnostic publication. */ }
    }
  };

  let ensureRunning;
  const runAttempt = () => {
    if (inFlight !== null || !canRecover() || options.isPresent()) return false;
    const currentGeneration = options.getGeneration();
    const generation = currentGeneration + 1;
    if (!safeGeneration(currentGeneration) || !safeGeneration(generation)) {
      const error = new TypeError('The Mastermind node-link generation cannot advance');
      recordFailure(error);
      ensureRunning();
      return false;
    }

    const attemptEpoch = epoch;
    inFlightGeneration = generation;
    exitObservedDuringAttempt = false;
    let spawned = null;
    let retryAfterFailure = false;
    const operation = Object.freeze({ generation, epoch: attemptEpoch });
    inFlight = operation;
    void (async () => {
      try {
        spawned = await options.spawn(generation);
        if (!spawned || spawned.generation !== generation || !options.isActive(spawned)) {
          throw new Error('The exact replacement Mastermind node-link generation exited before publication');
        }
        if (!canRecover() || attemptEpoch !== epoch) return false;
        options.markRunning(generation);
        armStability(spawned);
        return true;
      } catch (error) {
        if (canRecover() && attemptEpoch === epoch) {
          recordFailure(error);
          retryAfterFailure = true;
        }
        return false;
      } finally {
        if (inFlight === operation) {
          inFlight = null;
          inFlightGeneration = null;
        }
        const retryImmediately = immediateAfterFlight;
        immediateAfterFlight = false;
        if (!canRecover()) return;

        if (spawned && spawned.generation === generation && options.isActive(spawned)) {
          if (attemptEpoch !== epoch && retryImmediately) {
            options.markRunning(generation);
            armStability(spawned);
          }
          return;
        }
        if (exitObservedDuringAttempt && attemptEpoch === epoch && !retryAfterFailure) {
          recordFailure();
          retryAfterFailure = true;
        }
        if (retryImmediately) ensureRunning({ immediate: true });
        else if (retryAfterFailure) ensureRunning();
      }
    })();
    return true;
  };

  ensureRunning = (request = {}) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new TypeError('Invalid Mastermind node-link recovery request');
    }
    const keys = Object.keys(request);
    if (keys.some((key) => key !== 'immediate')
      || (Object.hasOwn(request, 'immediate') && typeof request.immediate !== 'boolean')) {
      throw new TypeError('Invalid Mastermind node-link recovery request');
    }
    if (!canRecover()) return false;
    if (inFlight !== null) {
      if (request.immediate === true) immediateAfterFlight = true;
      return false;
    }
    if (options.isPresent()) return false;
    if (request.immediate === true) {
      cancelRetry();
      return runAttempt();
    }
    if (retryTimer !== null) return false;
    const delayMs = retryDelay();
    retryTimer = schedule(() => {
      retryTimer = null;
      void runAttempt();
    }, delayMs);
    unref(retryTimer);
    return true;
  };

  const noteExit = (record = null) => {
    if (!canRecover()) return false;
    if (record === null && retryTimer !== null) return false;
    if (record !== null && record.generation === inFlightGeneration) {
      exitObservedDuringAttempt = true;
      if (stableRecord === record) clearStability();
      return false;
    }
    if (stableRecord !== null && (record === null || record === stableRecord)) clearStability();
    recordFailure();
    return ensureRunning();
  };

  const suspend = () => {
    if (suspended) return false;
    suspended = true;
    epoch += 1;
    immediateAfterFlight = false;
    cancelRetry();
    clearStability({ preserveRecord: true });
    return true;
  };

  const resume = () => {
    if (!suspended) return false;
    suspended = false;
    epoch += 1;
    if (stableRecord !== null) {
      if (options.isActive(stableRecord)) armStability(stableRecord);
      else stableRecord = null;
    }
    return true;
  };

  const snapshot = () => Object.freeze({
    suspended,
    inFlight: inFlight !== null,
    retryScheduled: retryTimer !== null,
    stableScheduled: stableTimer !== null,
    failureCount,
  });

  return Object.freeze({ ensureRunning, noteExit, suspend, resume, snapshot });
}

export function createLocalServiceRegistry(options = {}) {
  const supervisorId = options.supervisorId;
  const mode = options.mode;
  const startedAt = options.startedAt;
  const now = options.now ?? (() => new Date().toISOString());
  const restartAgent = options.restartAgent;
  const schedule = options.schedule ?? ((callback) => setImmediate(callback));
  if (typeof supervisorId !== 'string' || !SUPERVISOR_ID.test(supervisorId)
    || !['development', 'production'].includes(mode) || !canonicalTimestamp(startedAt)
    || typeof now !== 'function' || typeof restartAgent !== 'function' || typeof schedule !== 'function') {
    throw new TypeError('Invalid local-service registry configuration');
  }
  const services = new Map([
    ['supervisor', serviceRecord('supervisor', 'running', 1, null)],
    ['minecraft-control-agent', serviceRecord('minecraft-control-agent', 'failed', 1, 43100)],
    ['next-web', serviceRecord('next-web', 'failed', 1, 3000)],
    ['mastermind-node-link', serviceRecord('mastermind-node-link', 'failed', 1, null)],
  ]);
  const operations = new Map();
  const operationPromises = new Map();
  let activeRequestId = null;

  const snapshot = () => ({
    ok: true,
    supervisorId,
    supervisor: { mode, startedAt },
    services: LOCAL_SERVICE_ROLES.map((role) => ({ ...services.get(role) })),
  });

  const markRunning = (role, generation = services.get(role)?.generation ?? 1, lastExit = undefined) => {
    if (!ROLE_SET.has(role) || !safeGeneration(generation)) throw new TypeError('Invalid running local-service generation');
    const previous = services.get(role);
    services.set(role, serviceRecord(role, 'running', generation, previous.port,
      lastExit === undefined ? previous.lastExit : lastExit));
  };

  const markFailed = (role, lastExit) => {
    if (!ROLE_SET.has(role) || role === 'supervisor') throw new TypeError('Invalid failed local-service role');
    const previous = services.get(role);
    services.set(role, serviceRecord(role, 'failed', previous.generation, previous.port, lastExit));
  };

  const pruneOperations = () => {
    if (operations.size <= 64) return;
    for (const [requestId, operation] of operations) {
      if (operations.size <= 64) break;
      if (!['accepted', 'running'].includes(operation.state)) {
        operations.delete(requestId);
        operationPromises.delete(requestId);
      }
    }
  };

  const acceptRestart = ({ role, requestId, expectedGeneration }) => {
    if (role !== 'minecraft-control-agent') fail('TARGET_NOT_ALLOWED', 'Only the Minecraft control agent may be restarted');
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) fail('INVALID_REQUEST_ID', 'The restart request id is invalid');
    if (!safeGeneration(expectedGeneration) || !safeGeneration(expectedGeneration + 1)) {
      fail('INVALID_GENERATION', 'The expected service generation is invalid');
    }
    const existing = operations.get(requestId);
    if (existing) {
      if (existing.role !== role || existing.expectedGeneration !== expectedGeneration) {
        fail('REQUEST_ID_CONFLICT', 'The restart request id is already bound to another operation');
      }
      return { accepted: true, newlyAccepted: false, operation: { ...existing.acceptanceReceipt } };
    }
    const service = services.get(role);
    if (service.generation !== expectedGeneration) fail('STALE_GENERATION', 'The service generation changed before restart');
    if (activeRequestId !== null || service.state === 'restarting') fail('SERVICE_BUSY', 'Another service restart is already active');
    const acceptedAt = now();
    if (!canonicalTimestamp(acceptedAt)) throw new TypeError('Invalid restart acceptance timestamp');
    const operation = {
      requestId,
      role,
      state: 'accepted',
      expectedGeneration,
      generation: expectedGeneration + 1,
      acceptedAt,
      finishedAt: null,
      code: null,
    };
    operation.acceptanceReceipt = Object.freeze(copyOperation(operation));
    operations.set(requestId, operation);
    activeRequestId = requestId;
    services.set(role, serviceRecord(role, 'restarting', service.generation, service.port, service.lastExit));
    pruneOperations();
    return { accepted: true, newlyAccepted: true, operation: { ...operation.acceptanceReceipt } };
  };

  const startAcceptedRestart = (requestId) => {
    const operation = operations.get(requestId);
    if (!operation || operation.state !== 'accepted') return false;
    let resolveOperation;
    const completion = new Promise((resolve) => { resolveOperation = resolve; });
    operationPromises.set(requestId, completion);
    schedule(() => {
      void (async () => {
        operation.state = 'running';
        try {
          const result = await restartAgent({
            requestId,
            expectedGeneration: operation.expectedGeneration,
            generation: operation.generation,
          });
          if (typeof result?.confirmRunning === 'function' && result.confirmRunning() !== true) {
            throw Object.assign(new Error('The replacement service exited before restart publication'), {
              serviceState: 'failed',
              lastExit: result?.lastExit,
            });
          }
          markRunning(operation.role, operation.generation, result?.lastExit ?? services.get(operation.role).lastExit);
          operation.state = 'succeeded';
        } catch (error) {
          const previous = services.get(operation.role);
          const serviceState = error?.serviceState === 'running' ? 'running' : 'failed';
          services.set(operation.role, serviceRecord(
            operation.role,
            serviceState,
            previous.generation,
            previous.port,
            error?.lastExit ?? previous.lastExit,
          ));
          operation.state = 'failed';
          operation.code = 'RESTART_FAILED';
        } finally {
          const finishedAt = now();
          operation.finishedAt = canonicalTimestamp(finishedAt) ? finishedAt : operation.acceptedAt;
          activeRequestId = null;
          resolveOperation(copyOperation(operation));
          pruneOperations();
        }
      })();
    });
    return true;
  };

  const waitForOperation = async (requestId) => {
    const operation = operations.get(requestId);
    if (!operation) return null;
    const pending = operationPromises.get(requestId);
    if (pending) await pending;
    return copyOperation(operations.get(requestId));
  };

  return Object.freeze({ snapshot, markRunning, markFailed, acceptRestart, startAcceptedRestart, waitForOperation });
}

function assertNoDuplicateJsonKeys(text) {
  let index = 0;
  const skip = () => { while (/\s/u.test(text[index] ?? '')) index += 1; };
  const string = () => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === '\\') { index += 2; continue; }
      if (text[index++] === '"') return JSON.parse(text.slice(start, index));
    }
    throw new Error('unterminated string');
  };
  const value = (depth = 0) => {
    if (depth > 32) throw new Error('too deep');
    skip();
    if (text[index] === '{') {
      index += 1; skip(); const keys = new Set();
      if (text[index] === '}') { index += 1; return; }
      while (index < text.length) {
        skip(); if (text[index] !== '"') throw new Error('key');
        const key = string(); if (keys.has(key)) throw new Error('duplicate key'); keys.add(key);
        skip(); if (text[index++] !== ':') throw new Error('colon'); value(depth + 1); skip();
        if (text[index] === '}') { index += 1; return; }
        if (text[index++] !== ',') throw new Error('comma');
      }
      throw new Error('object');
    }
    if (text[index] === '[') {
      index += 1; skip(); if (text[index] === ']') { index += 1; return; }
      while (index < text.length) {
        value(depth + 1); skip(); if (text[index] === ']') { index += 1; return; }
        if (text[index++] !== ',') throw new Error('comma');
      }
      throw new Error('array');
    }
    if (text[index] === '"') { string(); return; }
    const start = index;
    while (index < text.length && !/[\s,}\]]/u.test(text[index])) index += 1;
    if (start === index) throw new Error('value');
  };
  value(); skip(); if (index !== text.length) throw new Error('trailing JSON');
}

function secretsEqual(left, right, pattern) {
  if (typeof left !== 'string' || typeof right !== 'string' || !pattern.test(left) || !pattern.test(right)) return false;
  const a = Buffer.from(left, 'utf8'); const b = Buffer.from(right, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authenticatedRequest(message, supervisorId, token) {
  if (!secretsEqual(message?.supervisorId, supervisorId, SUPERVISOR_ID)
    || !secretsEqual(message?.token, token, TOKEN)) {
    fail('CONTROL_AUTH_FAILED', 'The local-service control identity was rejected');
  }
}

export async function dispatchLocalServiceControlRequest(message, options) {
  const { supervisorId, token, registry, logs, handleTakeover } = options;
  if (message?.action === 'takeover') {
    if (!exactKeys(message, ['action', 'supervisorId']) || message.supervisorId !== supervisorId
      || typeof handleTakeover !== 'function') {
      return { response: { accepted: false } };
    }
    const result = await handleTakeover();
    const accepted = result === true || result?.accepted === true;
    return {
      response: { accepted, supervisorId },
      afterResponse: accepted && typeof result?.afterResponse === 'function' ? result.afterResponse : null,
    };
  }
  authenticatedRequest(message, supervisorId, token);
  if (message.schemaVersion !== 1 || typeof message.action !== 'string') fail('INVALID_REQUEST', 'The local-service request is invalid');
  if (message.action === 'status') {
    if (!exactKeys(message, ['schemaVersion', 'supervisorId', 'token', 'action'])) fail('INVALID_REQUEST', 'The status request is invalid');
    return { response: registry.snapshot() };
  }
  if (message.action === 'logs') {
    if (!exactKeys(message, ['schemaVersion', 'supervisorId', 'token', 'action', 'role', 'limit'], ['after'])) {
      fail('INVALID_REQUEST', 'The log request is invalid');
    }
    if (!ROLE_SET.has(message.role)) fail('TARGET_NOT_ALLOWED', 'The requested local-service role is not available');
    const result = logs.tail(message.role, message.limit, message.after ?? null);
    return { response: { ok: true, supervisorId, role: message.role, ...result } };
  }
  if (message.action === 'restart') {
    if (!exactKeys(message, [
      'schemaVersion', 'supervisorId', 'token', 'action', 'role', 'requestId', 'expectedGeneration',
    ])) fail('INVALID_REQUEST', 'The restart request is invalid');
    const accepted = registry.acceptRestart(message);
    return {
      response: { ok: true, supervisorId, accepted: true, operation: accepted.operation },
      afterResponse: accepted.newlyAccepted ? () => registry.startAcceptedRestart(message.requestId) : null,
    };
  }
  fail('ACTION_NOT_ALLOWED', 'The local-service action is not allowed');
}

function boundedError(error) {
  if (error instanceof LocalServiceControlError && ERROR_CODE.test(error.code)) {
    return { ok: false, code: error.code, message: trimUtf8(error.message, 256) };
  }
  return { ok: false, code: 'INVALID_REQUEST', message: 'The local-service request was rejected' };
}

function encodeResponse(response) {
  const bytes = Buffer.from(`${JSON.stringify(response)}\n`, 'utf8');
  if (bytes.length <= LOCAL_SERVICE_RESPONSE_MAX_BYTES) return bytes;
  return Buffer.from(`${JSON.stringify({
    ok: false,
    code: 'RESPONSE_TOO_LARGE',
    message: 'The local-service response exceeded its safe bound',
  })}\n`, 'utf8');
}

export function createLocalServiceControlServer(options = {}) {
  const { supervisorId, token, registry, logs } = options;
  if (typeof supervisorId !== 'string' || !SUPERVISOR_ID.test(supervisorId)
    || typeof token !== 'string' || !TOKEN.test(token)
    || !registry || typeof registry.snapshot !== 'function' || !logs || typeof logs.tail !== 'function') {
    throw new TypeError('Invalid local-service control server configuration');
  }
  const createServer = options.createServer ?? net.createServer;
  const server = createServer((socket) => {
    let bytes = Buffer.alloc(0);
    let handled = false;
    socket.setTimeout?.(5_000, () => socket.destroy());
    socket.on('data', (chunk) => {
      if (handled) return socket.destroy();
      bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
      if (bytes.length > LOCAL_SERVICE_REQUEST_MAX_BYTES) return socket.destroy();
      const newline = bytes.indexOf(0x0a);
      if (newline < 0) return;
      handled = true;
      if (newline !== bytes.length - 1) return socket.end(encodeResponse(boundedError(new Error('multiple frames'))));
      void (async () => {
        let dispatched;
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, newline));
          assertNoDuplicateJsonKeys(text);
          const message = JSON.parse(text);
          dispatched = await dispatchLocalServiceControlRequest(message, options);
        } catch (error) {
          dispatched = { response: boundedError(error) };
        }
        const responseBytes = encodeResponse(dispatched.response);
        socket.end(responseBytes, () => {
          if (typeof dispatched.afterResponse === 'function') setImmediate(dispatched.afterResponse);
        });
      })();
    });
  });
  server.on('error', (error) => options.onFatal?.(error));
  return server;
}
