const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVERS = new Set(['DISABLED', 'RECOVERY_HOLD', 'ZENITH_FALLBACK', 'MASTERMIND_CONTROLLER', 'HUMAN_PARENT']);
const BARITONE_STATES = new Set(['idle', 'pathing', 'cancelling', 'failed']);
const ACTION_STATES = new Set(['none', 'queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled']);

export class HybridObservationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HybridObservationError';
    this.code = code;
  }
}

function reject(code, message) {
  throw new HybridObservationError(code, message);
}

function exactObject(value, label, required) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== required.length
    || required.some((key) => !Object.hasOwn(value, key))) {
    reject('INVALID_OBSERVATION', `${label} has invalid fields`);
  }
  return value;
}

function uuid(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) reject('INVALID_OBSERVATION', `${label} must be a UUID`);
  return value.toLowerCase();
}

function timestamp(value, label) {
  if (typeof value !== 'string' || value.length !== 24
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    reject('INVALID_OBSERVATION', `${label} must be canonical UTC`);
  }
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) reject('INVALID_OBSERVATION', `${label} must be a safe integer`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') reject('INVALID_OBSERVATION', `${label} must be boolean`);
  return value;
}

function enumeration(value, label, values) {
  if (typeof value !== 'string' || !values.has(value)) reject('INVALID_OBSERVATION', `${label} is unsupported`);
  return value;
}

export function validateZenithBodyObservation(value) {
  const observation = exactObject(value, 'Zenith observation', [
    'companionUuid', 'bodySessionId', 'seq', 'observedAt', 'driver', 'upstreamConnected',
    'controllerSocketPresent', 'controllerUuid', 'botTicksActive', 'baritone', 'action',
  ]);
  const baritone = exactObject(observation.baritone, 'baritone', ['state', 'goalId']);
  const action = exactObject(observation.action, 'action', ['actionId', 'state']);
  const result = {
    companionUuid: uuid(observation.companionUuid, 'companionUuid'),
    bodySessionId: uuid(observation.bodySessionId, 'bodySessionId'),
    seq: integer(observation.seq, 'seq', 1),
    observedAt: timestamp(observation.observedAt, 'observedAt'),
    driver: enumeration(observation.driver, 'driver', DRIVERS),
    upstreamConnected: boolean(observation.upstreamConnected, 'upstreamConnected'),
    controllerSocketPresent: boolean(observation.controllerSocketPresent, 'controllerSocketPresent'),
    controllerUuid: uuid(observation.controllerUuid, 'controllerUuid', true),
    botTicksActive: boolean(observation.botTicksActive, 'botTicksActive'),
    baritone: {
      state: enumeration(baritone.state, 'baritone.state', BARITONE_STATES),
      goalId: uuid(baritone.goalId, 'baritone.goalId', true),
    },
    action: {
      actionId: uuid(action.actionId, 'action.actionId', true),
      state: enumeration(action.state, 'action.state', ACTION_STATES),
    },
  };
  const controllerDriver = result.driver === 'HUMAN_PARENT' || result.driver === 'MASTERMIND_CONTROLLER';
  if (controllerDriver && (!result.controllerSocketPresent || result.controllerUuid === null)) {
    reject('INCONSISTENT_DRIVER', 'Controller driver and controller presence disagree');
  }
  if ((result.driver === 'ZENITH_FALLBACK' || result.driver === 'DISABLED')
    && (result.controllerSocketPresent || result.controllerUuid !== null)) {
    reject('INCONSISTENT_DRIVER', 'A non-controller driver cannot report controller presence');
  }
  if (controllerDriver && result.botTicksActive) {
    reject('CONCURRENT_INPUT', 'Native bot ticks cannot run while a controller owns the body');
  }
  return result;
}

export class HybridObservationReconciler {
  constructor({ maximumAgeMs = 3_000, maximumSkewMs = 1_000 } = {}) {
    if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 100 || maximumAgeMs > 60_000) {
      throw new TypeError('maximumAgeMs is invalid');
    }
    if (!Number.isSafeInteger(maximumSkewMs) || maximumSkewMs < 0 || maximumSkewMs > maximumAgeMs) {
      throw new TypeError('maximumSkewMs is invalid');
    }
    this.maximumAgeMs = maximumAgeMs;
    this.maximumSkewMs = maximumSkewMs;
    this.server = null;
    this.zenith = null;
  }

  acceptServer(message) {
    if (!message || message.type !== 'companion.telemetry' || !message.payload) {
      reject('INVALID_SERVER_OBSERVATION', 'Expected a validated companion.telemetry message');
    }
    const next = message.payload;
    if (this.server && next.observationSessionId === this.server.observationSessionId && next.serverTick <= this.server.serverTick) {
      reject('REPLAY_OR_REORDER', 'Server telemetry tick did not increase');
    }
    this.server = next;
    return next;
  }

  acceptZenith(value) {
    const next = validateZenithBodyObservation(value);
    if (this.zenith && next.bodySessionId === this.zenith.bodySessionId && next.seq <= this.zenith.seq) {
      reject('REPLAY_OR_REORDER', 'Zenith observation sequence did not increase');
    }
    this.zenith = next;
    return next;
  }

  reconcile(now = new Date()) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('now must be a valid Date');
    if (!this.server || !this.zenith) reject('OBSERVATION_INCOMPLETE', 'Both server and Zenith observations are required');
    if (this.server.companionUuid !== this.zenith.companionUuid) {
      reject('IDENTITY_MISMATCH', 'Server and Zenith observations describe different companions');
    }
    const serverTime = Date.parse(this.server.observedAt);
    const zenithTime = Date.parse(this.zenith.observedAt);
    const nowTime = now.getTime();
    if (nowTime - serverTime > this.maximumAgeMs || nowTime - zenithTime > this.maximumAgeMs
      || serverTime - nowTime > this.maximumSkewMs || zenithTime - nowTime > this.maximumSkewMs) {
      reject('OBSERVATION_STALE', 'An observation is stale or implausibly future-dated');
    }
    if (Math.abs(serverTime - zenithTime) > this.maximumSkewMs) {
      reject('SOURCE_SKEW', 'Server and Zenith observations are not sufficiently correlated');
    }
    const physicalActionsAllowed = this.zenith.driver === 'MASTERMIND_CONTROLLER'
      && this.zenith.upstreamConnected
      && this.server.vitals.alive;
    return {
      companionUuid: this.server.companionUuid,
      observedAt: new Date(Math.max(serverTime, zenithTime)).toISOString(),
      authoritative: {
        dimension: this.server.dimension,
        position: this.server.position,
        vitals: this.server.vitals,
        nearbyThreats: this.server.nearbyThreats,
        homeZone: this.server.homeZone,
      },
      execution: {
        driver: this.zenith.driver,
        upstreamConnected: this.zenith.upstreamConnected,
        controllerUuid: this.zenith.controllerUuid,
        botTicksActive: this.zenith.botTicksActive,
        baritone: this.zenith.baritone,
        action: this.zenith.action,
      },
      manualTakeoverActive: this.zenith.driver === 'HUMAN_PARENT',
      physicalActionsAllowed,
    };
  }
}
