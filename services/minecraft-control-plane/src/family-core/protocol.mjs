import crypto from 'node:crypto';

export const FAMILY_CORE_PROTOCOL = 'mastermind.family-core';
export const FAMILY_CORE_VERSION = 1;
export const FAMILY_CORE_SUBPROTOCOL = 'mastermind.family-core.v1';
export const FAMILY_CORE_MAX_PAYLOAD_BYTES = 64 * 1024;

export const FAMILY_CORE_SERVER_TYPES = Object.freeze([
  'server.hello',
  'server.heartbeat',
  'chat.received',
  'computer.requested',
  'player.joined',
  'player.left',
  'server.event',
  'admin.result',
]);

export const FAMILY_CORE_CONTROL_TYPES = Object.freeze([
  'computer.broadcast',
  'computer.private',
  'computer.requestStatus',
  'admin.execute',
  'server.shutdown',
]);

const SERVER_TYPES = new Set(FAMILY_CORE_SERVER_TYPES);
const CONTROL_TYPES = new Set(FAMILY_CORE_CONTROL_TYPES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,127})$/;
const REGISTRY_ID = /^(?!https?:|file:)[a-z0-9_.-]+:[a-z0-9_][a-z0-9_./-]*$/;
const VERSION_TEXT = /^[0-9A-Za-z](?:[0-9A-Za-z._+\-]{0,63})$/;
const CHAT_CHANNELS = new Set(['public', 'private']);
const PLAYER_ROLES = new Set(['parent', 'child', 'guest']);
const ADMIN_STATUSES = new Set(['succeeded', 'failed', 'rejected']);
const SERVER_EVENT_KINDS = new Set(['started', 'ready', 'stopping', 'stopped', 'warning', 'death', 'advancement']);
const ADMIN_OPERATIONS = new Set(['status.query', 'player.message', 'whitelist.add', 'whitelist.remove', 'save.flush']);
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

export class FamilyCoreProtocolError extends Error {
  constructor(code, message, closeCode = 4400) {
    super(message);
    this.name = 'FamilyCoreProtocolError';
    this.code = code;
    this.closeCode = closeCode;
  }
}

function fail(code, message, closeCode) {
  throw new FamilyCoreProtocolError(code, message, closeCode);
}

function exactObject(value, label, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail('INVALID_MESSAGE', `${label} must be a plain object`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${label} contains unsupported field '${key}'`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail('MISSING_FIELD', `${label} omitted required field '${key}'`);
  return value;
}

function stringValue(value, label, { min = 1, max = 256, pattern, values, allowNull = false } = {}) {
  if (allowNull && value === null) return null;
  if (typeof value !== 'string' || value.length < min || value.length > max || UNSAFE_TEXT.test(value)) {
    fail('INVALID_MESSAGE', `${label} is invalid`);
  }
  if (pattern && !pattern.test(value)) fail('INVALID_MESSAGE', `${label} has an invalid format`);
  if (values && !values.has(value)) fail('INVALID_MESSAGE', `${label} is unsupported`);
  return value;
}

function uuidValue(value, label, allowNull = false) {
  if (allowNull && value === null) return null;
  return stringValue(value, label, { min: 36, max: 36, pattern: UUID }).toLowerCase();
}

function timestampValue(value, label) {
  stringValue(value, label, { min: 24, max: 24 });
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('INVALID_MESSAGE', `${label} must be a canonical millisecond UTC timestamp`);
  }
  return value;
}

function integerValue(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_MESSAGE', `${label} is outside its allowed range`);
  return value;
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') fail('INVALID_MESSAGE', `${label} must be boolean`);
  return value;
}

function boundedJson(value, label, depth = 0, budget = { count: 0 }) {
  budget.count += 1;
  if (budget.count > 256 || depth > 5) fail('INVALID_MESSAGE', `${label} is too complex`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return stringValue(value, label, { min: 0, max: 2_048 });
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_MESSAGE', `${label} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 64) fail('INVALID_MESSAGE', `${label} is too large`);
    return value.map((item, index) => boundedJson(item, `${label}[${index}]`, depth + 1, budget));
  }
  const object = exactObject(value, label, [], Object.keys(value ?? {}));
  if (Object.keys(object).length > 32) fail('INVALID_MESSAGE', `${label} has too many fields`);
  const result = {};
  for (const [key, item] of Object.entries(object)) {
    stringValue(key, `${label} key`, { max: 64, pattern: /^[A-Za-z][A-Za-z0-9_]*$/ });
    result[key] = boundedJson(item, `${label}.${key}`, depth + 1, budget);
  }
  return result;
}

function playerIdentity(value, label = 'player') {
  const player = exactObject(value, label, ['minecraftUuid', 'displayName', 'role', 'identityBound']);
  return {
    minecraftUuid: uuidValue(player.minecraftUuid, `${label}.minecraftUuid`),
    displayName: stringValue(player.displayName, `${label}.displayName`, { max: 64 }),
    role: stringValue(player.role, `${label}.role`, { values: PLAYER_ROLES }),
    identityBound: booleanValue(player.identityBound, `${label}.identityBound`),
  };
}

function validateServerPayload(type, value) {
  switch (type) {
    case 'server.hello': {
      const payload = exactObject(value, `${type}.payload`, [
        'serverId', 'instanceId', 'modVersion', 'minecraftVersion', 'capabilities', 'commandEnabled',
      ]);
      if (!Array.isArray(payload.capabilities) || payload.capabilities.length > 32) fail('INVALID_MESSAGE', 'server.hello capabilities are invalid');
      const capabilities = payload.capabilities.map((item, index) => stringValue(item, `capabilities[${index}]`, { max: 64, pattern: SAFE_ID }));
      if (new Set(capabilities).size !== capabilities.length) fail('INVALID_MESSAGE', 'server.hello capabilities contain duplicates');
      return {
        serverId: stringValue(payload.serverId, 'serverId', { max: 128, pattern: SAFE_ID }),
        instanceId: uuidValue(payload.instanceId, 'instanceId'),
        modVersion: stringValue(payload.modVersion, 'modVersion', { max: 64, pattern: VERSION_TEXT }),
        minecraftVersion: stringValue(payload.minecraftVersion, 'minecraftVersion', { max: 64, pattern: VERSION_TEXT }),
        capabilities,
        commandEnabled: booleanValue(payload.commandEnabled, 'commandEnabled'),
      };
    }
    case 'server.heartbeat': {
      const payload = exactObject(value, `${type}.payload`, ['uptimeMs', 'playerCount', 'lastControlSeq']);
      return {
        uptimeMs: integerValue(payload.uptimeMs, 'uptimeMs', 0, Number.MAX_SAFE_INTEGER),
        playerCount: integerValue(payload.playerCount, 'playerCount', 0, 1_000),
        lastControlSeq: integerValue(payload.lastControlSeq, 'lastControlSeq', 0, Number.MAX_SAFE_INTEGER),
      };
    }
    case 'chat.received': {
      const payload = exactObject(value, `${type}.payload`, ['player', 'channel', 'text'], ['replyToMessageId']);
      return {
        player: playerIdentity(payload.player),
        channel: stringValue(payload.channel, 'channel', { values: CHAT_CHANNELS }),
        text: stringValue(payload.text, 'text', { max: 512 }),
        ...(Object.hasOwn(payload, 'replyToMessageId') ? { replyToMessageId: uuidValue(payload.replyToMessageId, 'replyToMessageId') } : {}),
      };
    }
    case 'computer.requested': {
      const payload = exactObject(value, `${type}.payload`, ['player', 'text']);
      return { player: playerIdentity(payload.player), text: stringValue(payload.text, 'text', { max: 512 }) };
    }
    case 'player.joined':
    case 'player.left': {
      const payload = exactObject(value, `${type}.payload`, ['player']);
      return { player: playerIdentity(payload.player) };
    }
    case 'server.event': {
      const payload = exactObject(value, `${type}.payload`, ['kind', 'message', 'data']);
      return {
        kind: stringValue(payload.kind, 'kind', { values: SERVER_EVENT_KINDS }),
        message: stringValue(payload.message, 'message', { max: 512 }),
        data: boundedJson(payload.data, 'data'),
      };
    }
    case 'admin.result': {
      const payload = exactObject(value, `${type}.payload`, ['operationId', 'status', 'code', 'message', 'data']);
      return {
        operationId: uuidValue(payload.operationId, 'operationId'),
        status: stringValue(payload.status, 'status', { values: ADMIN_STATUSES }),
        code: stringValue(payload.code, 'code', { max: 64, pattern: SAFE_ID }),
        message: stringValue(payload.message, 'message', { max: 512 }),
        data: boundedJson(payload.data, 'data'),
      };
    }
    default:
      fail('UNSUPPORTED_MESSAGE', `Server message '${type}' is unsupported`);
  }
}

function validateControlPayload(type, value) {
  switch (type) {
    case 'computer.broadcast': {
      const payload = exactObject(value, `${type}.payload`, ['text']);
      return { text: stringValue(payload.text, 'text', { max: 512 }) };
    }
    case 'computer.private': {
      const payload = exactObject(value, `${type}.payload`, ['minecraftUuid', 'text']);
      return { minecraftUuid: uuidValue(payload.minecraftUuid, 'minecraftUuid'), text: stringValue(payload.text, 'text', { max: 2_048 }) };
    }
    case 'computer.requestStatus': {
      const payload = exactObject(value, `${type}.payload`, ['requestId', 'status', 'message']);
      return {
        requestId: uuidValue(payload.requestId, 'requestId'),
        status: stringValue(payload.status, 'status', { values: new Set(['received', 'working', 'awaiting-approval', 'completed', 'rejected', 'failed']) }),
        message: stringValue(payload.message, 'message', { max: 512 }),
      };
    }
    case 'admin.execute': {
      const payload = exactObject(value, `${type}.payload`, ['operationId', 'operation', 'arguments', 'approvalDigest'], ['expiresAt']);
      return {
        operationId: uuidValue(payload.operationId, 'operationId'),
        operation: stringValue(payload.operation, 'operation', { values: ADMIN_OPERATIONS }),
        arguments: boundedJson(payload.arguments, 'arguments'),
        approvalDigest: stringValue(payload.approvalDigest, 'approvalDigest', { min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ }),
        ...(Object.hasOwn(payload, 'expiresAt') ? { expiresAt: timestampValue(payload.expiresAt, 'expiresAt') } : {}),
      };
    }
    case 'server.shutdown': {
      const payload = exactObject(value, `${type}.payload`, ['shutdownId', 'reason', 'delaySeconds']);
      return {
        shutdownId: uuidValue(payload.shutdownId, 'shutdownId'),
        reason: stringValue(payload.reason, 'reason', { max: 256 }),
        delaySeconds: integerValue(payload.delaySeconds, 'delaySeconds', 0, 300),
      };
    }
    default:
      fail('UNSUPPORTED_MESSAGE', `Control message '${type}' is unsupported`);
  }
}

function validateEnvelope(value, direction, expectedSessionId) {
  const envelope = exactObject(value, 'envelope', [
    'protocol', 'version', 'messageId', 'sessionId', 'seq', 'sentAt', 'source', 'type', 'correlationId', 'payload',
  ]);
  if (envelope.protocol !== FAMILY_CORE_PROTOCOL || envelope.version !== FAMILY_CORE_VERSION) {
    fail('UNSUPPORTED_VERSION', 'Family Core protocol version is unsupported', 4406);
  }
  const messageId = uuidValue(envelope.messageId, 'messageId');
  const sessionId = uuidValue(envelope.sessionId, 'sessionId');
  if (expectedSessionId && sessionId !== expectedSessionId.toLowerCase()) fail('SESSION_MISMATCH', 'Message belongs to a different authenticated session', 4409);
  const seq = integerValue(envelope.seq, 'seq', 1, Number.MAX_SAFE_INTEGER);
  const sentAt = timestampValue(envelope.sentAt, 'sentAt');
  const source = stringValue(envelope.source, 'source', { values: new Set(['family-core', 'control-plane']) });
  const expectedSource = direction === 'server' ? 'family-core' : 'control-plane';
  if (source !== expectedSource) fail('INVALID_SOURCE', `Expected message source '${expectedSource}'`);
  const typeSet = direction === 'server' ? SERVER_TYPES : CONTROL_TYPES;
  const type = stringValue(envelope.type, 'type', { max: 64, values: typeSet });
  const correlationId = uuidValue(envelope.correlationId, 'correlationId', true);
  const payload = direction === 'server' ? validateServerPayload(type, envelope.payload) : validateControlPayload(type, envelope.payload);
  return { protocol: FAMILY_CORE_PROTOCOL, version: FAMILY_CORE_VERSION, messageId, sessionId, seq, sentAt, source, type, correlationId, payload };
}

function bytesFromWire(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  fail('INVALID_MESSAGE', 'Family Core payload must be UTF-8 JSON text');
}

function parseStrictJson(text) {
  let offset = 0;
  const skipWhitespace = () => { while (offset < text.length && /[\x20\t\r\n]/.test(text[offset])) offset += 1; };
  const invalid = () => fail('INVALID_JSON', 'Family Core payload is not valid strict JSON');
  const parseString = () => {
    const start = offset;
    if (text[offset] !== '"') invalid();
    offset += 1;
    while (offset < text.length) {
      const character = text[offset];
      if (character === '"') {
        offset += 1;
        try { return JSON.parse(text.slice(start, offset)); } catch { invalid(); }
      }
      if (character === '\\') {
        offset += 1;
        if (offset >= text.length) invalid();
        if (text[offset] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(offset + 1, offset + 5))) invalid();
          offset += 5;
          continue;
        }
        if (!/["\\/bfnrt]/.test(text[offset])) invalid();
      } else if (character.charCodeAt(0) < 0x20) invalid();
      offset += 1;
    }
    invalid();
  };
  const parseValue = (depth = 0) => {
    if (depth > 48) fail('INVALID_JSON', 'Family Core payload is nested too deeply');
    skipWhitespace();
    if (text[offset] === '{') {
      offset += 1; skipWhitespace();
      const keys = new Set();
      if (text[offset] === '}') { offset += 1; return; }
      while (offset < text.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) fail('DUPLICATE_FIELD', `Family Core payload repeats object field '${key}'`);
        keys.add(key); skipWhitespace();
        if (text[offset] !== ':') invalid();
        offset += 1; parseValue(depth + 1); skipWhitespace();
        if (text[offset] === '}') { offset += 1; return; }
        if (text[offset] !== ',') invalid();
        offset += 1;
      }
      invalid();
    }
    if (text[offset] === '[') {
      offset += 1; skipWhitespace();
      if (text[offset] === ']') { offset += 1; return; }
      while (offset < text.length) {
        parseValue(depth + 1); skipWhitespace();
        if (text[offset] === ']') { offset += 1; return; }
        if (text[offset] !== ',') invalid();
        offset += 1;
      }
      invalid();
    }
    if (text[offset] === '"') { parseString(); return; }
    const start = offset;
    while (offset < text.length && !/[\x20\t\r\n,\]}]/.test(text[offset])) offset += 1;
    if (offset === start) invalid();
  };
  parseValue(); skipWhitespace();
  if (offset !== text.length) invalid();
  try { return JSON.parse(text); } catch { invalid(); }
}

export function parseFamilyCoreMessage(value, options = {}) {
  const { direction, expectedSessionId, maxBytes = FAMILY_CORE_MAX_PAYLOAD_BYTES } = options;
  if (!['server', 'control'].includes(direction)) throw new TypeError('Family Core direction must be server or control');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > FAMILY_CORE_MAX_PAYLOAD_BYTES) throw new TypeError('Family Core maximum payload size is invalid');
  const bytes = bytesFromWire(value);
  if (bytes.byteLength > maxBytes) fail('PAYLOAD_TOO_LARGE', 'Family Core payload exceeds its size limit', 1009);
  return validateEnvelope(parseStrictJson(bytes.toString('utf8')), direction, expectedSessionId);
}

export function validateFamilyCoreMessage(value, options = {}) {
  const { direction, expectedSessionId } = options;
  if (!['server', 'control'].includes(direction)) throw new TypeError('Family Core direction must be server or control');
  return validateEnvelope(value, direction, expectedSessionId);
}

export function createFamilyCoreMessage({
  sessionId,
  seq,
  source,
  type,
  payload,
  correlationId = null,
  messageId = crypto.randomUUID(),
  sentAt = new Date().toISOString(),
}) {
  return validateEnvelope({
    protocol: FAMILY_CORE_PROTOCOL,
    version: FAMILY_CORE_VERSION,
    messageId,
    sessionId,
    seq,
    sentAt,
    source,
    type,
    correlationId,
    payload,
  }, source === 'family-core' ? 'server' : 'control', sessionId);
}

export class FamilyCoreSequenceGuard {
  constructor(initialSequence = 0) {
    if (!Number.isSafeInteger(initialSequence) || initialSequence < 0) throw new TypeError('Initial sequence must be a non-negative safe integer');
    this.lastSequence = initialSequence;
  }

  accept(message) {
    if (!message || !Number.isSafeInteger(message.seq) || message.seq <= this.lastSequence) {
      fail('REPLAY_OR_REORDER', 'Family Core message sequence is not strictly increasing', 4409);
    }
    this.lastSequence = message.seq;
    return message;
  }
}
