import crypto from 'node:crypto';

export const MASTERMIND_DOMAIN_EVENT_SCHEMA_VERSION = 1;
export const MASTERMIND_DOMAIN_EVENT_MAX_BYTES = 64 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const PRODUCER = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const KIND = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const WORLD_REF = /^world-[a-f0-9]{64}$/;
const DOMAINS = new Set(['world', 'backup', 'mod', 'companion', 'player', 'workshop', 'system']);
const VISIBILITIES = new Set(['private', 'family', 'system']);
const REQUIRED_KEYS = Object.freeze([
  'eventId', 'schemaVersion', 'occurredAt', 'producer', 'domain', 'kind', 'namespace',
  'householdId', 'visibility', 'payload',
]);
const OPTIONAL_KEYS = Object.freeze(['playerId', 'worldRef', 'sessionId', 'correlationId']);
const PAYLOAD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SENSITIVE_KEYS = new Set([
  'accesstoken', 'apikey', 'authorization', 'bridgecredential', 'clientsecret', 'credential',
  'devicecode', 'password', 'privatekey', 'refreshtoken', 'secret', 'sessioncookie', 'token',
]);
const MAX_PAYLOAD_DEPTH = 8;
const MAX_PAYLOAD_NODES = 1_024;
const MAX_COLLECTION_SIZE = 128;
const MAX_PAYLOAD_STRING = 4_096;

export class MastermindDomainEventError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MastermindDomainEventError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MastermindDomainEventError(code, message);
}

function exactObject(value, label, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('EVENT_INVALID', `${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('EVENT_UNKNOWN_FIELD', `${label} contains unsupported field '${key}'`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('EVENT_MISSING_FIELD', `${label} omitted required field '${key}'`);
  }
  return value;
}

function boundedString(value, label, { min = 1, max = 128, pattern } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('EVENT_INVALID', `${label} is invalid`);
  }
  if (pattern && !pattern.test(value)) fail('EVENT_INVALID', `${label} has an invalid format`);
  return value;
}

function uuid(value, label) {
  return boundedString(value, label, { min: 36, max: 36, pattern: UUID });
}

function canonicalTimestamp(value, label) {
  boundedString(value, label, { min: 24, max: 24 });
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('EVENT_INVALID', `${label} must be a canonical millisecond UTC timestamp`);
  }
  return value;
}

function validateNamespace(value) {
  boundedString(value, 'namespace', { min: 3, max: 180 });
  if (value === 'family/shared' || value === 'companion/self' || value === 'system/technical') {
    return { kind: value, id: null, scope: null };
  }
  const match = /^(player|world|session|project)\/([a-z0-9][a-z0-9._:-]{0,127})(?:\/(private|shared))?$/.exec(value);
  if (!match) fail('EVENT_INVALID', 'namespace is unsupported');
  if (match[1] === 'player' && !match[3]) fail('EVENT_INVALID', 'player namespaces require private or shared scope');
  if (match[1] !== 'player' && match[3]) fail('EVENT_INVALID', 'only player namespaces accept private or shared scope');
  return { kind: match[1], id: match[2], scope: match[3] ?? null };
}

function normalizeSensitiveKey(value) {
  return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function validateJsonValue(value, label, depth, budget, seen) {
  budget.count += 1;
  if (budget.count > MAX_PAYLOAD_NODES) fail('EVENT_PAYLOAD_TOO_LARGE', 'payload contains too many values');
  if (depth > MAX_PAYLOAD_DEPTH) fail('EVENT_PAYLOAD_TOO_DEEP', 'payload is nested too deeply');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('EVENT_INVALID', `${label} must contain only finite numbers`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_PAYLOAD_STRING || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      fail('EVENT_INVALID', `${label} contains an invalid string`);
    }
    return;
  }
  if (typeof value !== 'object') fail('EVENT_INVALID', `${label} contains a non-JSON value`);
  if (seen.has(value)) fail('EVENT_INVALID', `${label} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_COLLECTION_SIZE) fail('EVENT_PAYLOAD_TOO_LARGE', `${label} contains too many items`);
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail('EVENT_INVALID', `${label} contains a sparse array`);
        validateJsonValue(value[index], `${label}[${index}]`, depth + 1, budget, seen);
      }
      return;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      fail('EVENT_INVALID', `${label} must contain only plain objects`);
    }
    const keys = Object.keys(value);
    if (keys.length > MAX_COLLECTION_SIZE) fail('EVENT_PAYLOAD_TOO_LARGE', `${label} contains too many fields`);
    for (const key of keys) {
      if (!PAYLOAD_KEY.test(key)) fail('EVENT_INVALID', `${label} contains invalid field '${key}'`);
      if (SENSITIVE_KEYS.has(normalizeSensitiveKey(key))) {
        fail('EVENT_SENSITIVE_FIELD', `${label} contains prohibited sensitive field '${key}'`);
      }
      validateJsonValue(value[key], `${label}.${key}`, depth + 1, budget, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateMastermindDomainEvent(value) {
  const event = exactObject(value, 'event', REQUIRED_KEYS, OPTIONAL_KEYS);
  uuid(event.eventId, 'eventId');
  if (event.schemaVersion !== MASTERMIND_DOMAIN_EVENT_SCHEMA_VERSION) fail('EVENT_UNSUPPORTED_VERSION', 'schemaVersion is unsupported');
  canonicalTimestamp(event.occurredAt, 'occurredAt');
  boundedString(event.producer, 'producer', { min: 1, max: 64, pattern: PRODUCER });
  if (!DOMAINS.has(event.domain)) fail('EVENT_INVALID', 'domain is unsupported');
  boundedString(event.kind, 'kind', { min: 3, max: 96, pattern: KIND });
  const namespace = validateNamespace(event.namespace);
  boundedString(event.householdId, 'householdId', { min: 1, max: 128, pattern: SAFE_ID });
  if (!VISIBILITIES.has(event.visibility)) fail('EVENT_INVALID', 'visibility is unsupported');
  if (Object.hasOwn(event, 'playerId')) boundedString(event.playerId, 'playerId', { min: 1, max: 128, pattern: SAFE_ID });
  if (Object.hasOwn(event, 'worldRef')) boundedString(event.worldRef, 'worldRef', { min: 70, max: 70, pattern: WORLD_REF });
  if (Object.hasOwn(event, 'sessionId')) uuid(event.sessionId, 'sessionId');
  if (Object.hasOwn(event, 'correlationId')) uuid(event.correlationId, 'correlationId');
  if (namespace.kind === 'player' && (!Object.hasOwn(event, 'playerId') || event.playerId !== namespace.id)) {
    fail('EVENT_SCOPE_MISMATCH', 'player namespace must match playerId');
  }
  if (namespace.kind === 'session' && (!Object.hasOwn(event, 'sessionId') || event.sessionId !== namespace.id)) {
    fail('EVENT_SCOPE_MISMATCH', 'session namespace must match sessionId');
  }
  if (namespace.kind === 'world' && (!Object.hasOwn(event, 'worldRef') || event.worldRef !== namespace.id)) {
    fail('EVENT_SCOPE_MISMATCH', 'world namespace must match worldRef');
  }
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) fail('EVENT_INVALID', 'payload must be an object');
  validateJsonValue(event.payload, 'payload', 0, { count: 0 }, new Set());
  let bytes;
  try { bytes = Buffer.byteLength(canonical(event)); }
  catch { fail('EVENT_INVALID', 'event cannot be serialized'); }
  if (bytes > MASTERMIND_DOMAIN_EVENT_MAX_BYTES) fail('EVENT_TOO_LARGE', 'event exceeds the maximum encoded size');
  return structuredClone(event);
}

export function canonicalMastermindDomainEvent(value) {
  return canonical(validateMastermindDomainEvent(value));
}

export function createMastermindDomainEvent(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('EVENT_INVALID', 'event input must be an object');
  if (Object.hasOwn(input, 'schemaVersion') && input.schemaVersion !== MASTERMIND_DOMAIN_EVENT_SCHEMA_VERSION) {
    fail('EVENT_UNSUPPORTED_VERSION', 'schemaVersion is unsupported');
  }
  const now = options.now ?? (() => Date.now());
  const randomUUID = options.randomUUID ?? crypto.randomUUID;
  return validateMastermindDomainEvent({
    ...input,
    eventId: input.eventId ?? randomUUID(),
    schemaVersion: MASTERMIND_DOMAIN_EVENT_SCHEMA_VERSION,
    occurredAt: input.occurredAt ?? new Date(now()).toISOString(),
  });
}

export function deterministicMastermindEventId(parts) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 16) fail('EVENT_INVALID', 'deterministic event key is invalid');
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    boundedString(part, 'deterministic event key part', { min: 1, max: 256 });
    const bytes = Buffer.from(part, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length).update(bytes);
  }
  const value = hash.digest().subarray(0, 16);
  value[6] = (value[6] & 0x0f) | 0x80;
  value[8] = (value[8] & 0x3f) | 0x80;
  const hex = value.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
