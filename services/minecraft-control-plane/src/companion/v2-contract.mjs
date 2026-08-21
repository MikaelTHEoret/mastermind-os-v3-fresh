import { featureUnavailable } from '../brain/features.mjs';

export const FAMILY_BRIDGE_V2_VERSION = 2;

export const FAMILY_BRIDGE_V2_OBSERVATIONS = Object.freeze([
  'inventory.snapshot', 'heldItem.snapshot', 'effects.snapshot', 'damage.recent',
  'threats.nearby', 'players.visible', 'crosshair.target', 'container.state',
  'blocks.inspectLocal', 'safePoints.metadata', 'homeZones.metadata',
]);

export const FAMILY_BRIDGE_V2_ACTIONS = Object.freeze([
  'direct.use', 'direct.selectSlot', 'direct.dropItem',
  'inventory.inspect', 'inventory.equip', 'inventory.move', 'inventory.give',
  'craft.recipe', 'container.transfer', 'skill.sleep', 'skill.eat', 'skill.combat',
  'skill.tendCrops', 'skill.deliverItem', 'skill.buildBounded',
]);

const ALL_V2_CAPABILITIES = new Set([...FAMILY_BRIDGE_V2_OBSERVATIONS, ...FAMILY_BRIDGE_V2_ACTIONS]);

export class CompanionV2ContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CompanionV2ContractError';
    this.code = code;
  }
}

function reject(code, message) {
  throw new CompanionV2ContractError(code, message);
}

function exactObject(value, label, required) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== required.length
    || required.some((key) => !Object.hasOwn(value, key))) {
    reject('INVALID_V2_CONTRACT', `${label} has invalid fields`);
  }
  return value;
}

function safeText(value, label, maximum = 256) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    reject('INVALID_V2_CONTRACT', `${label} is invalid`);
  }
  return value;
}

function boundedJson(value, label, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > 512 || depth > 6) reject('INVALID_V2_CONTRACT', `${label} is too complex`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return safeText(value, label, 2_048);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject('INVALID_V2_CONTRACT', `${label} contains an invalid number`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) reject('INVALID_V2_CONTRACT', `${label} is too large`);
    return value.map((item, index) => boundedJson(item, `${label}[${index}]`, depth + 1, budget));
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    reject('INVALID_V2_CONTRACT', `${label} must contain JSON values only`);
  }
  if (Object.keys(value).length > 64) reject('INVALID_V2_CONTRACT', `${label} has too many fields`);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) reject('INVALID_V2_CONTRACT', `${label} contains an invalid field`);
    return [key, boundedJson(item, `${label}.${key}`, depth + 1, budget)];
  }));
}

export function validateCompanionV2Observation(value) {
  const observation = exactObject(value, 'v2 observation', ['kind', 'observedAt', 'data']);
  if (!FAMILY_BRIDGE_V2_OBSERVATIONS.includes(observation.kind)) reject('UNSUPPORTED_V2_OBSERVATION', 'The v2 observation kind is unsupported');
  safeText(observation.observedAt, 'observedAt', 24);
  if (!Number.isFinite(Date.parse(observation.observedAt)) || new Date(observation.observedAt).toISOString() !== observation.observedAt) {
    reject('INVALID_V2_CONTRACT', 'observedAt must be canonical UTC');
  }
  return { kind: observation.kind, observedAt: observation.observedAt, data: boundedJson(observation.data, 'data') };
}

export function executeCompanionV2Action(value) {
  const action = exactObject(value, 'v2 action', ['kind', 'arguments']);
  if (!FAMILY_BRIDGE_V2_ACTIONS.includes(action.kind)) reject('UNSUPPORTED_V2_ACTION', 'The v2 action kind is unsupported');
  boundedJson(action.arguments, 'arguments');
  return featureUnavailable(`companion-v2:${action.kind}`);
}

export function companionV2SkeletonManifest(v1Capabilities = []) {
  if (!Array.isArray(v1Capabilities) || v1Capabilities.some((item) => typeof item !== 'string')) {
    throw new TypeError('The v1 capability list is invalid');
  }
  if (v1Capabilities.some((item) => ALL_V2_CAPABILITIES.has(item))) {
    throw new TypeError('Stubbed v2 capabilities must not appear in the advertised v1 capability list');
  }
  return {
    supportedVersions: [1],
    negotiatedVersion: 1,
    advertisedCapabilities: [...v1Capabilities],
    unavailableV2Capabilities: [...ALL_V2_CAPABILITIES],
  };
}
