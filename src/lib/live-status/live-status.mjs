const INSTANCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const INSTANCE_STATES = new Set(['stopped', 'starting', 'running', 'stopping', 'failed']);

export const LIVE_STATUS_VISIBLE_POLL_MS = 5_000;
export const LIVE_STATUS_TRANSITION_POLL_MS = 2_000;
export const LIVE_STATUS_HIDDEN_POLL_MS = 30_000;
export const LIVE_STATUS_VISIBLE_STALE_MS = 15_000;
export const LIVE_STATUS_HIDDEN_STALE_MS = 75_000;

function reject(message) {
  throw new Error(message);
}

function objectOf(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(`${label} must be an object`);
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    reject(`${label} has an unsupported or missing field`);
  }
}

export function parseMinecraftInstanceSummary(value) {
  const envelope = objectOf(value, 'Minecraft instance inventory');
  exactKeys(envelope, ['ok', 'instances'], 'Minecraft instance inventory');
  if (envelope.ok !== true || !Array.isArray(envelope.instances) || envelope.instances.length > 128) {
    reject('Minecraft instance inventory is invalid');
  }

  const instances = envelope.instances.map((raw) => {
    const instance = objectOf(raw, 'Minecraft instance');
    if (typeof instance.id !== 'string' || !INSTANCE_ID.test(instance.id)
      || typeof instance.displayName !== 'string' || instance.displayName.length < 1 || instance.displayName.length > 64
      || typeof instance.status !== 'string' || !INSTANCE_STATES.has(instance.status)) {
      reject('Minecraft instance summary is invalid');
    }
    return Object.freeze({ id: instance.id, displayName: instance.displayName, status: instance.status });
  });
  if (new Set(instances.map((instance) => instance.id)).size !== instances.length) {
    reject('Minecraft instance inventory contains a duplicate identity');
  }
  return Object.freeze({ ok: true, instances: Object.freeze(instances) });
}

export function emptyLiveResource() {
  return Object.freeze({
    value: null,
    lastGoodAt: null,
    lastAttemptAt: null,
    error: null,
    errorCount: 0,
  });
}

export function liveResourceSucceeded(previous, value, at) {
  if (!Number.isFinite(at) || at < 0) reject('Live status success time is invalid');
  return Object.freeze({
    value,
    lastGoodAt: at,
    lastAttemptAt: at,
    error: null,
    errorCount: 0,
  });
}

export function liveResourceFailed(previous, message, at) {
  if (!Number.isFinite(at) || at < 0 || typeof message !== 'string' || message.length < 1 || message.length > 160) {
    reject('Live status failure metadata is invalid');
  }
  return Object.freeze({
    value: previous.value,
    lastGoodAt: previous.lastGoodAt,
    lastAttemptAt: at,
    error: message,
    errorCount: Math.min(previous.errorCount + 1, 999),
  });
}

export function liveResourcePresentation(resource, now, visibilityState) {
  const staleAfter = visibilityState === 'hidden'
    ? LIVE_STATUS_HIDDEN_STALE_MS
    : LIVE_STATUS_VISIBLE_STALE_MS;
  const stale = resource.lastGoodAt !== null && now - resource.lastGoodAt >= staleAfter;
  return Object.freeze({
    hasValue: resource.value !== null,
    stale,
    failed: resource.error !== null,
    errorCount: resource.errorCount,
  });
}

export function liveStatusPollDelay(visibilityState, transitioning = false) {
  if (visibilityState === 'hidden') return LIVE_STATUS_HIDDEN_POLL_MS;
  return transitioning ? LIVE_STATUS_TRANSITION_POLL_MS : LIVE_STATUS_VISIBLE_POLL_MS;
}

/**
 * A single-flight scheduler for the app heartbeat. Refreshes received during a
 * request coalesce into one immediate follow-up instead of overlapping it.
 */
export function createLiveStatusPoller({
  run,
  getDelay,
  onError = () => undefined,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
}) {
  if (typeof run !== 'function' || typeof getDelay !== 'function' || typeof onError !== 'function') {
    reject('Live status poller configuration is invalid');
  }
  let activeController = null;
  let disposed = false;
  let inFlight = false;
  let refreshPending = false;
  let timer = null;

  const clearScheduled = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const schedule = (delay) => {
    clearScheduled();
    if (disposed) return;
    timer = setTimer(() => {
      timer = null;
      void execute();
    }, delay);
  };

  const execute = async () => {
    if (disposed) return;
    if (inFlight) {
      refreshPending = true;
      return;
    }
    clearScheduled();
    inFlight = true;
    activeController = new AbortController();
    try {
      await run(activeController.signal);
    } catch (error) {
      if (!activeController.signal.aborted) onError(error);
    } finally {
      activeController = null;
      inFlight = false;
      if (!disposed) {
        if (refreshPending) {
          refreshPending = false;
          schedule(0);
        } else {
          schedule(getDelay());
        }
      }
    }
  };

  return Object.freeze({
    start() {
      if (!disposed && !inFlight && timer === null) void execute();
    },
    refresh() {
      if (disposed) return;
      if (inFlight) {
        refreshPending = true;
        return;
      }
      schedule(0);
    },
    stop() {
      disposed = true;
      refreshPending = false;
      clearScheduled();
      activeController?.abort();
    },
  });
}
