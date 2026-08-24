import { validateFamilyBridgeAction } from './protocol.mjs';

export const EMBODIMENT_KINDS = Object.freeze([
  'fabric-client',
  'mineflayer-via-zenith',
  'zenith-plugin',
  'fake',
]);

export const EFFECT_KINDS = Object.freeze([
  'inventory.atLeast',
  'inventory.delta',
  'position.within',
  'phase.equals',
  'container.open',
]);

const KIND_SET = new Set(EMBODIMENT_KINDS);
const EFFECT_SET = new Set(EFFECT_KINDS);
const SAFE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const REGISTRY_ID = /^(?!https?:|file:)[a-z0-9_.-]+:[a-z0-9_][a-z0-9_./-]*$/u;

export class EmbodimentContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EmbodimentContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new EmbodimentContractError(code, message);
}

function exactObject(value, label, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_EMBODIMENT_CONTRACT', `${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail('UNKNOWN_EMBODIMENT_FIELD', `${label} contains '${key}'`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail('MISSING_EMBODIMENT_FIELD', `${label} omitted '${key}'`);
  return value;
}

function boundedString(value, label, pattern, max = 128) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail('INVALID_EMBODIMENT_CONTRACT', `${label} is invalid`);
  }
  if (pattern && !pattern.test(value)) fail('INVALID_EMBODIMENT_CONTRACT', `${label} has an invalid format`);
  return value;
}

function boundedNumber(value, label, minimum, maximum, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum
    || (integer && !Number.isInteger(value))) fail('INVALID_EMBODIMENT_CONTRACT', `${label} is outside its range`);
  return value;
}

function inventoryCount(snapshot, itemId) {
  const items = snapshot?.inventory?.items;
  if (!Array.isArray(items)) return null;
  return items.reduce((total, item) => total + (item?.itemId === itemId && Number.isInteger(item?.count) ? item.count : 0), 0);
}

function position(snapshot) {
  const value = snapshot?.player?.position ?? snapshot?.position ?? null;
  return value && [value.x, value.y, value.z].every(Number.isFinite) ? value : null;
}

export function validateExpectedEffect(value) {
  exactObject(value, 'expected effect', ['kind'], ['itemId', 'count', 'x', 'y', 'z', 'tolerance', 'phase', 'containerType']);
  boundedString(value.kind, 'expected effect kind', null, 64);
  if (!EFFECT_SET.has(value.kind)) fail('UNSUPPORTED_EFFECT', `Expected effect '${value.kind}' is unsupported`);
  if (value.kind === 'inventory.atLeast' || value.kind === 'inventory.delta') {
    boundedString(value.itemId, 'expected effect itemId', REGISTRY_ID);
    boundedNumber(value.count, 'expected effect count', 1, 2304, true);
  } else if (value.kind === 'position.within') {
    boundedNumber(value.x, 'expected effect x', -30_000_000, 30_000_000);
    boundedNumber(value.y, 'expected effect y', -2048, 2048);
    boundedNumber(value.z, 'expected effect z', -30_000_000, 30_000_000);
    boundedNumber(value.tolerance, 'expected effect tolerance', 0, 64);
  } else if (value.kind === 'phase.equals') {
    boundedString(value.phase, 'expected effect phase', SAFE_ID, 32);
  } else if (value.kind === 'container.open') {
    boundedString(value.containerType, 'expected effect containerType', SAFE_ID, 64);
  }
  return value;
}

export function validateEmbodimentStep(value) {
  exactObject(value, 'embodiment step', [
    'stepId', 'action', 'expectedEffects', 'timeoutMs', 'failurePolicy',
  ]);
  boundedString(value.stepId, 'embodiment step id', SAFE_ID, 64);
  validateFamilyBridgeAction(value.action);
  if (!Array.isArray(value.expectedEffects) || value.expectedEffects.length < 1 || value.expectedEffects.length > 8) {
    fail('INVALID_EMBODIMENT_CONTRACT', 'embodiment step requires one to eight expected effects');
  }
  value.expectedEffects.forEach(validateExpectedEffect);
  boundedNumber(value.timeoutMs, 'embodiment step timeout', 100, 30 * 60_000, true);
  if (!['retry', 'replan', 'abort'].includes(value.failurePolicy)) {
    fail('INVALID_EMBODIMENT_CONTRACT', 'embodiment step failure policy is invalid');
  }
  return value;
}

export function verifyExpectedEffects(effects, before, after) {
  if (!Array.isArray(effects) || effects.length < 1 || effects.length > 8) {
    fail('INVALID_EMBODIMENT_CONTRACT', 'expected effects must contain one to eight entries');
  }
  const results = effects.map((effect) => {
    validateExpectedEffect(effect);
    let observed = null;
    let verified = false;
    if (effect.kind === 'inventory.atLeast') {
      observed = inventoryCount(after, effect.itemId);
      verified = observed !== null && observed >= effect.count;
    } else if (effect.kind === 'inventory.delta') {
      const initial = inventoryCount(before, effect.itemId);
      const final = inventoryCount(after, effect.itemId);
      observed = initial === null || final === null ? null : final - initial;
      verified = observed !== null && observed >= effect.count;
    } else if (effect.kind === 'position.within') {
      const current = position(after);
      observed = current === null ? null : Math.hypot(current.x - effect.x, current.y - effect.y, current.z - effect.z);
      verified = observed !== null && observed <= effect.tolerance;
    } else if (effect.kind === 'phase.equals') {
      observed = after?.phase ?? null;
      verified = observed === effect.phase;
    } else if (effect.kind === 'container.open') {
      observed = after?.container?.type ?? null;
      verified = after?.container?.open === true && observed === effect.containerType;
    }
    return Object.freeze({ kind: effect.kind, verified, observed });
  });
  return Object.freeze({
    verified: results.every((result) => result.verified),
    results: Object.freeze(results),
  });
}

export class SessionEmbodimentAdapter {
  constructor(sessionManager, options = {}) {
    if (!sessionManager || !['status', 'dispatchAction', 'cancelAction', 'waitForActionActivation']
      .every((method) => typeof sessionManager[method] === 'function')) {
      throw new TypeError('A compatible companion session manager is required');
    }
    const kind = options.kind ?? 'fabric-client';
    if (!KIND_SET.has(kind)) throw new TypeError('The embodiment kind is invalid');
    this.sessionManager = sessionManager;
    this.kind = kind;
  }

  status() {
    const status = this.sessionManager.status();
    return Object.freeze({
      kind: this.kind,
      state: status.state,
      capabilities: Object.freeze([...(status.client?.capabilities ?? [])]),
      activeAction: status.activeAction,
      lastAction: status.lastAction,
      latestObservation: status.latestSnapshot,
      killSwitch: status.killSwitch === true,
    });
  }

  dispatch(action, options) {
    return this.sessionManager.dispatchAction(action, options);
  }

  cancel(actionId, reason) {
    return this.sessionManager.cancelAction(actionId, reason);
  }

  waitForActivation(actionId, options) {
    return this.sessionManager.waitForActionActivation(actionId, options);
  }

  brainBindings() {
    return Object.freeze({
      canSendChat: () => {
        const status = this.status();
        return status.state === 'ready' && !status.killSwitch && status.capabilities.includes('direct.say');
      },
      sendChat: (text) => this.dispatch({ kind: 'direct.say', args: { text } }, { timeoutMs: 15_000 }),
      dispatchAction: (action, options) => this.dispatch(action, options),
      cancelAction: (actionId, reason) => this.cancel(actionId, reason),
      waitForActionActivation: (actionId, options) => this.waitForActivation(actionId, options),
      sessionStatus: () => this.sessionManager.status(),
    });
  }
}
