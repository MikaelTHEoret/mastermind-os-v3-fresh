import crypto from 'node:crypto';

export const FAMILY_BRIDGE_PROTOCOL = 'mastermind.family-bridge';
export const FAMILY_BRIDGE_VERSION = 1;
export const FAMILY_BRIDGE_SUBPROTOCOL = 'mastermind.family.v1';
export const FAMILY_BRIDGE_MAX_PAYLOAD_BYTES = 64 * 1024;

export const FAMILY_BRIDGE_CAPABILITIES = Object.freeze([
  'state.snapshot',
  'action.cancel',
  'client.shutdown',
  'direct.say',
  'direct.respawn',
  'direct.lookAt',
  'direct.lookDelta',
  'direct.moveFor',
  'direct.jump',
  'direct.attack',
  'skill.navigateTo',
  'skill.followPlayer',
  'skill.gatherBlock',
  'skill.explore',
  'skill.escapeDanger',
  'skill.returnToKnownSafePoint',
]);

export const FAMILY_BRIDGE_ACTION_KINDS = Object.freeze(FAMILY_BRIDGE_CAPABILITIES.filter((value) => (
  value.startsWith('direct.') || value.startsWith('skill.')
)));

const CAPABILITY_SET = new Set(FAMILY_BRIDGE_CAPABILITIES);
const ACTION_KIND_SET = new Set(FAMILY_BRIDGE_ACTION_KINDS);
const CLIENT_TYPES = new Set(['bridge.hello', 'bridge.heartbeat', 'state.snapshot', 'action.status', 'client.shutdownAck']);
const CONTROL_TYPES = new Set(['control.hello', 'control.ready', 'action.execute', 'action.cancel', 'client.shutdown']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODE = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const REGISTRY_ID = /^(?!https?:|file:)[a-z0-9_.-]+:[a-z0-9_][a-z0-9_./-]*$/;
const VERSION_TEXT = /^[0-9A-Za-z](?:[0-9A-Za-z._+\-]{0,63})$/;
const CONTROL_CANCEL_REASONS = new Set(['operator', 'deadline', 'shutdown', 'superseded']);
const TERMINAL_CANCEL_REASONS = new Set([...CONTROL_CANCEL_REASONS, 'connection-lost', 'kill-switch', 'client-shutdown']);
const CLIENT_PHASES = new Set(['main-menu', 'connecting', 'in-world', 'disconnected']);
const BARITONE_STATES = new Set(['idle', 'planning', 'pathing', 'paused', 'failed']);
const ACTION_STATUSES = new Set(['started', 'progress', 'succeeded', 'failed', 'cancelled']);
const ACTIVE_ACTION_STATUSES = new Set(['started', 'progress']);
const WEATHER_STATES = new Set(['clear', 'rain', 'thunder']);

export class FamilyBridgeProtocolError extends Error {
  constructor(code, message, closeCode = 4400) {
    super(message);
    this.name = 'FamilyBridgeProtocolError';
    this.code = code;
    this.closeCode = closeCode;
  }
}

function fail(code, message, closeCode) {
  throw new FamilyBridgeProtocolError(code, message, closeCode);
}

function exactObject(value, label, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_MESSAGE', `${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${label} contains unsupported field '${key}'`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('MISSING_FIELD', `${label} omitted required field '${key}'`);
  }
  return value;
}

function stringValue(value, label, { min = 1, max = 256, pattern, values, allowNull = false } = {}) {
  if (allowNull && value === null) return null;
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
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
    fail('INVALID_MESSAGE', `${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function numberValue(value, label, min, max, { integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail('INVALID_MESSAGE', `${label} is outside its allowed range`);
  }
  return value;
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') fail('INVALID_MESSAGE', `${label} must be boolean`);
  return value;
}

function validateVector(value, label, min, max) {
  exactObject(value, label, ['x', 'y', 'z']);
  numberValue(value.x, `${label}.x`, min, max);
  numberValue(value.y, `${label}.y`, min, max);
  numberValue(value.z, `${label}.z`, min, max);
  return value;
}

function validateActionArgs(action) {
  const { kind, args } = action;
  switch (kind) {
    case 'direct.say':
      exactObject(args, `${kind}.args`, ['text']);
      stringValue(args.text, `${kind}.args.text`, { min: 1, max: 256 });
      if (args.text.startsWith('/')) fail('UNSAFE_ACTION', 'direct.say cannot send a Minecraft command');
      break;
    case 'direct.lookAt':
      exactObject(args, `${kind}.args`, ['x', 'y', 'z', 'durationMs']);
      numberValue(args.x, `${kind}.args.x`, -30_000_000, 30_000_000);
      numberValue(args.y, `${kind}.args.y`, -2_048, 2_048);
      numberValue(args.z, `${kind}.args.z`, -30_000_000, 30_000_000);
      numberValue(args.durationMs, `${kind}.args.durationMs`, 50, 5_000, { integer: true });
      break;
    case 'direct.lookDelta':
      exactObject(args, `${kind}.args`, ['yawDelta', 'pitchDelta', 'durationMs']);
      numberValue(args.yawDelta, `${kind}.args.yawDelta`, -180, 180);
      numberValue(args.pitchDelta, `${kind}.args.pitchDelta`, -90, 90);
      numberValue(args.durationMs, `${kind}.args.durationMs`, 50, 5_000, { integer: true });
      break;
    case 'direct.moveFor':
      exactObject(args, `${kind}.args`, ['forward', 'strafe', 'durationMs', 'sprint', 'sneak']);
      numberValue(args.forward, `${kind}.args.forward`, -1, 1);
      numberValue(args.strafe, `${kind}.args.strafe`, -1, 1);
      numberValue(args.durationMs, `${kind}.args.durationMs`, 50, 5_000, { integer: true });
      booleanValue(args.sprint, `${kind}.args.sprint`);
      booleanValue(args.sneak, `${kind}.args.sneak`);
      if (args.sprint && args.sneak) fail('INVALID_ACTION', 'direct.moveFor cannot sprint and sneak together');
      break;
    case 'direct.jump':
    case 'direct.attack':
    case 'direct.respawn':
    case 'skill.escapeDanger':
      exactObject(args, `${kind}.args`, []);
      break;
    case 'skill.navigateTo':
      exactObject(args, `${kind}.args`, ['x', 'y', 'z', 'tolerance']);
      numberValue(args.x, `${kind}.args.x`, -30_000_000, 30_000_000, { integer: true });
      numberValue(args.y, `${kind}.args.y`, -2_048, 2_048, { integer: true });
      numberValue(args.z, `${kind}.args.z`, -30_000_000, 30_000_000, { integer: true });
      numberValue(args.tolerance, `${kind}.args.tolerance`, 1, 16, { integer: true });
      break;
    case 'skill.followPlayer':
      exactObject(args, `${kind}.args`, ['playerUuid', 'distance']);
      uuidValue(args.playerUuid, `${kind}.args.playerUuid`);
      numberValue(args.distance, `${kind}.args.distance`, 2, 16);
      break;
    case 'skill.gatherBlock':
      exactObject(args, `${kind}.args`, ['blockId', 'count', 'maxDistance']);
      stringValue(args.blockId, `${kind}.args.blockId`, { min: 3, max: 128, pattern: REGISTRY_ID });
      numberValue(args.count, `${kind}.args.count`, 1, 64, { integer: true });
      numberValue(args.maxDistance, `${kind}.args.maxDistance`, 1, 128, { integer: true });
      break;
    case 'skill.explore':
      exactObject(args, `${kind}.args`, ['radius']);
      numberValue(args.radius, `${kind}.args.radius`, 16, 1_024, { integer: true });
      break;
    case 'skill.returnToKnownSafePoint':
      exactObject(args, `${kind}.args`, ['safePointId']);
      stringValue(args.safePointId, `${kind}.args.safePointId`, { min: 1, max: 64, pattern: SAFE_CODE });
      break;
    default:
      fail('UNSUPPORTED_ACTION', `Action '${kind}' is not supported`);
  }
}

export function validateFamilyBridgeAction(value) {
  const action = exactObject(value, 'action', ['kind', 'args']);
  stringValue(action.kind, 'action.kind', { min: 1, max: 64, values: ACTION_KIND_SET });
  validateActionArgs(action);
  return action;
}

function validateCapabilities(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > FAMILY_BRIDGE_CAPABILITIES.length) {
    fail('INVALID_MESSAGE', `${label} must be a bounded capability list`);
  }
  const unique = new Set();
  for (const capability of value) {
    stringValue(capability, `${label} entry`, { min: 1, max: 64, values: CAPABILITY_SET });
    if (unique.has(capability)) fail('INVALID_MESSAGE', `${label} contains a duplicate capability`);
    unique.add(capability);
  }
  return value;
}

function validatePlayer(value) {
  if (value === null) return null;
  const player = exactObject(value, 'state.snapshot.payload.player', [
    'position', 'velocity', 'yaw', 'pitch', 'health', 'maxHealth', 'hunger', 'armor', 'dimension',
  ]);
  validateVector(player.position, 'player.position', -30_000_000, 30_000_000);
  validateVector(player.velocity, 'player.velocity', -1_024, 1_024);
  numberValue(player.yaw, 'player.yaw', -180, 180);
  numberValue(player.pitch, 'player.pitch', -90, 90);
  numberValue(player.health, 'player.health', 0, 2_048);
  numberValue(player.maxHealth, 'player.maxHealth', 1, 2_048);
  if (player.health > player.maxHealth) fail('INVALID_MESSAGE', 'player.health exceeds player.maxHealth');
  numberValue(player.hunger, 'player.hunger', 0, 20, { integer: true });
  numberValue(player.armor, 'player.armor', 0, 30, { integer: true });
  stringValue(player.dimension, 'player.dimension', { min: 3, max: 128, pattern: REGISTRY_ID });
  return player;
}

function validateWorld(value) {
  if (value === null) return null;
  const world = exactObject(value, 'state.snapshot.payload.world', ['timeOfDay', 'weather']);
  numberValue(world.timeOfDay, 'world.timeOfDay', 0, 23_999, { integer: true });
  stringValue(world.weather, 'world.weather', { min: 4, max: 7, values: WEATHER_STATES });
  return world;
}

function validateBaritoneGoal(value) {
  if (value === null) return null;
  const base = exactObject(value, 'baritone.goal', ['kind'], ['x', 'y', 'z', 'playerUuid', 'radius']);
  stringValue(base.kind, 'baritone.goal.kind', { min: 1, max: 32, values: new Set(['block', 'follow-player', 'explore']) });
  if (base.kind === 'block') {
    exactObject(value, 'baritone.goal', ['kind', 'x', 'y', 'z']);
    numberValue(value.x, 'baritone.goal.x', -30_000_000, 30_000_000, { integer: true });
    numberValue(value.y, 'baritone.goal.y', -2_048, 2_048, { integer: true });
    numberValue(value.z, 'baritone.goal.z', -30_000_000, 30_000_000, { integer: true });
  } else if (base.kind === 'follow-player') {
    exactObject(value, 'baritone.goal', ['kind', 'playerUuid']);
    uuidValue(value.playerUuid, 'baritone.goal.playerUuid');
  } else {
    exactObject(value, 'baritone.goal', ['kind', 'radius']);
    numberValue(value.radius, 'baritone.goal.radius', 16, 1_024, { integer: true });
  }
  return value;
}

function validateSnapshot(value) {
  const snapshot = exactObject(value, 'state.snapshot.payload', [
    'snapshotId', 'clientTick', 'phase', 'serverAlias', 'player', 'world', 'baritone', 'activeAction', 'safety',
  ]);
  uuidValue(snapshot.snapshotId, 'state.snapshot.payload.snapshotId');
  numberValue(snapshot.clientTick, 'state.snapshot.payload.clientTick', 0, Number.MAX_SAFE_INTEGER, { integer: true });
  stringValue(snapshot.phase, 'state.snapshot.payload.phase', { min: 8, max: 12, values: CLIENT_PHASES });
  if (snapshot.serverAlias !== null && snapshot.serverAlias !== 'family-server') {
    fail('INVALID_MESSAGE', 'state.snapshot.payload.serverAlias must be the managed Family Server alias');
  }
  validatePlayer(snapshot.player);
  validateWorld(snapshot.world);
  const baritone = exactObject(snapshot.baritone, 'state.snapshot.payload.baritone', ['state', 'activeSkill', 'goal']);
  stringValue(baritone.state, 'baritone.state', { min: 4, max: 8, values: BARITONE_STATES });
  if (baritone.activeSkill !== null) stringValue(baritone.activeSkill, 'baritone.activeSkill', { min: 1, max: 64, values: ACTION_KIND_SET });
  validateBaritoneGoal(baritone.goal);
  if (snapshot.activeAction !== null) {
    const active = exactObject(snapshot.activeAction, 'state.snapshot.payload.activeAction', ['actionId', 'kind', 'status']);
    uuidValue(active.actionId, 'activeAction.actionId');
    stringValue(active.kind, 'activeAction.kind', { min: 1, max: 64, values: ACTION_KIND_SET });
    stringValue(active.status, 'activeAction.status', { min: 7, max: 8, values: ACTIVE_ACTION_STATUSES });
  }
  const safety = exactObject(snapshot.safety, 'state.snapshot.payload.safety', ['killSwitch']);
  booleanValue(safety.killSwitch, 'state.snapshot.payload.safety.killSwitch');
  return snapshot;
}

function validateProgress(value) {
  const progress = exactObject(value, 'action.status.payload.progress', ['phase'], ['percent', 'detail']);
  stringValue(progress.phase, 'action.status.payload.progress.phase', { min: 1, max: 64, pattern: SAFE_CODE });
  if (Object.hasOwn(progress, 'percent')) numberValue(progress.percent, 'action.status.payload.progress.percent', 0, 100);
  if (Object.hasOwn(progress, 'detail')) stringValue(progress.detail, 'action.status.payload.progress.detail', { min: 1, max: 256 });
  return progress;
}

function validateActionStatus(value) {
  const status = exactObject(value, 'action.status.payload', ['actionId', 'status'], ['progress', 'result', 'error', 'cancellation']);
  uuidValue(status.actionId, 'action.status.payload.actionId');
  stringValue(status.status, 'action.status.payload.status', { min: 6, max: 9, values: ACTION_STATUSES });
  if (status.status === 'started') {
    exactObject(status, 'action.status.payload', ['actionId', 'status']);
  } else if (status.status === 'progress') {
    exactObject(status, 'action.status.payload', ['actionId', 'status', 'progress']);
    validateProgress(status.progress);
  } else if (status.status === 'succeeded') {
    exactObject(status, 'action.status.payload', ['actionId', 'status', 'result']);
    const result = exactObject(status.result, 'action.status.payload.result', ['code']);
    stringValue(result.code, 'action.status.payload.result.code', { min: 1, max: 64, pattern: SAFE_CODE });
  } else if (status.status === 'failed') {
    exactObject(status, 'action.status.payload', ['actionId', 'status', 'error']);
    const error = exactObject(status.error, 'action.status.payload.error', ['code', 'message']);
    stringValue(error.code, 'action.status.payload.error.code', { min: 1, max: 64, pattern: SAFE_CODE });
    stringValue(error.message, 'action.status.payload.error.message', { min: 1, max: 512 });
  } else {
    exactObject(status, 'action.status.payload', ['actionId', 'status', 'cancellation']);
    const cancellation = exactObject(status.cancellation, 'action.status.payload.cancellation', ['reason']);
    stringValue(cancellation.reason, 'action.status.payload.cancellation.reason', { min: 8, max: 15, values: TERMINAL_CANCEL_REASONS });
  }
  return status;
}

function validateClientPayload(type, payload) {
  switch (type) {
    case 'bridge.hello': {
      const hello = exactObject(payload, 'bridge.hello.payload', [
        'clientId', 'pid', 'bridgeVersion', 'minecraftVersion', 'loaderVersion', 'baritoneVersion', 'capabilities',
      ]);
      if (hello.clientId !== 'family-ai-client') fail('INVALID_CLIENT', 'bridge.hello clientId is not the Family AI client');
      numberValue(hello.pid, 'bridge.hello.payload.pid', 1, 0xffffffff, { integer: true });
      for (const field of ['bridgeVersion', 'minecraftVersion', 'loaderVersion', 'baritoneVersion']) {
        stringValue(hello[field], `bridge.hello.payload.${field}`, { min: 1, max: 64, pattern: VERSION_TEXT });
      }
      validateCapabilities(hello.capabilities, 'bridge.hello.payload.capabilities');
      return hello;
    }
    case 'bridge.heartbeat': {
      const heartbeat = exactObject(payload, 'bridge.heartbeat.payload', ['clientTick', 'phase', 'activeActionId', 'killSwitch']);
      numberValue(heartbeat.clientTick, 'bridge.heartbeat.payload.clientTick', 0, Number.MAX_SAFE_INTEGER, { integer: true });
      stringValue(heartbeat.phase, 'bridge.heartbeat.payload.phase', { min: 8, max: 12, values: CLIENT_PHASES });
      uuidValue(heartbeat.activeActionId, 'bridge.heartbeat.payload.activeActionId', true);
      booleanValue(heartbeat.killSwitch, 'bridge.heartbeat.payload.killSwitch');
      return heartbeat;
    }
    case 'state.snapshot':
      return validateSnapshot(payload);
    case 'action.status':
      return validateActionStatus(payload);
    case 'client.shutdownAck': {
      const ack = exactObject(payload, 'client.shutdownAck.payload', ['shutdownId', 'accepted']);
      uuidValue(ack.shutdownId, 'client.shutdownAck.payload.shutdownId');
      if (ack.accepted !== true) fail('INVALID_MESSAGE', 'client.shutdownAck.payload.accepted must be true');
      return ack;
    }
    default:
      fail('UNSUPPORTED_MESSAGE', `Client message '${type}' is not supported`);
  }
}

function validateControlPayload(type, payload) {
  switch (type) {
    case 'control.hello': {
      const hello = exactObject(payload, 'control.hello.payload', [
        'supportedVersions', 'helloTimeoutMs', 'heartbeatIntervalMs', 'heartbeatTimeoutMs', 'maxPayloadBytes',
      ]);
      if (!Array.isArray(hello.supportedVersions) || hello.supportedVersions.length !== 1 || hello.supportedVersions[0] !== 1) {
        fail('INVALID_MESSAGE', 'control.hello supportedVersions is invalid');
      }
      numberValue(hello.helloTimeoutMs, 'control.hello.payload.helloTimeoutMs', 1_000, 30_000, { integer: true });
      numberValue(hello.heartbeatIntervalMs, 'control.hello.payload.heartbeatIntervalMs', 250, 30_000, { integer: true });
      numberValue(hello.heartbeatTimeoutMs, 'control.hello.payload.heartbeatTimeoutMs', hello.heartbeatIntervalMs * 2, 120_000, { integer: true });
      if (hello.maxPayloadBytes !== FAMILY_BRIDGE_MAX_PAYLOAD_BYTES) fail('INVALID_MESSAGE', 'control.hello maxPayloadBytes is invalid');
      return hello;
    }
    case 'control.ready': {
      const ready = exactObject(payload, 'control.ready.payload', ['heartbeatIntervalMs', 'snapshotIntervalMs', 'acceptedCapabilities']);
      numberValue(ready.heartbeatIntervalMs, 'control.ready.payload.heartbeatIntervalMs', 250, 30_000, { integer: true });
      numberValue(ready.snapshotIntervalMs, 'control.ready.payload.snapshotIntervalMs', 250, 30_000, { integer: true });
      validateCapabilities(ready.acceptedCapabilities, 'control.ready.payload.acceptedCapabilities');
      return ready;
    }
    case 'action.execute': {
      const execute = exactObject(payload, 'action.execute.payload', ['actionId', 'deadlineAt', 'action']);
      uuidValue(execute.actionId, 'action.execute.payload.actionId');
      timestampValue(execute.deadlineAt, 'action.execute.payload.deadlineAt');
      validateFamilyBridgeAction(execute.action);
      return execute;
    }
    case 'action.cancel': {
      const cancel = exactObject(payload, 'action.cancel.payload', ['actionId', 'reason']);
      uuidValue(cancel.actionId, 'action.cancel.payload.actionId');
      stringValue(cancel.reason, 'action.cancel.payload.reason', { min: 8, max: 10, values: CONTROL_CANCEL_REASONS });
      return cancel;
    }
    case 'client.shutdown': {
      const shutdown = exactObject(payload, 'client.shutdown.payload', ['shutdownId', 'deadlineAt']);
      uuidValue(shutdown.shutdownId, 'client.shutdown.payload.shutdownId');
      timestampValue(shutdown.deadlineAt, 'client.shutdown.payload.deadlineAt');
      return shutdown;
    }
    default:
      fail('UNSUPPORTED_MESSAGE', `Control message '${type}' is not supported`);
  }
}

function validateEnvelope(value, direction, expectedSessionId) {
  const envelope = exactObject(value, 'envelope', [
    'protocol', 'version', 'messageId', 'sessionId', 'seq', 'sentAt', 'source', 'type', 'payload',
  ]);
  if (envelope.protocol !== FAMILY_BRIDGE_PROTOCOL || envelope.version !== FAMILY_BRIDGE_VERSION) {
    fail('UNSUPPORTED_VERSION', 'Family bridge protocol version is unsupported', 4406);
  }
  uuidValue(envelope.messageId, 'envelope.messageId');
  uuidValue(envelope.sessionId, 'envelope.sessionId');
  if (expectedSessionId && envelope.sessionId.toLowerCase() !== expectedSessionId.toLowerCase()) {
    fail('SESSION_MISMATCH', 'Message belongs to a different bridge session', 4409);
  }
  numberValue(envelope.seq, 'envelope.seq', 1, Number.MAX_SAFE_INTEGER, { integer: true });
  timestampValue(envelope.sentAt, 'envelope.sentAt');
  const expectedSource = direction === 'client' ? 'family-agent-bridge' : 'control-plane';
  if (envelope.source !== expectedSource) fail('INVALID_SOURCE', `Expected message source '${expectedSource}'`);
  const types = direction === 'client' ? CLIENT_TYPES : CONTROL_TYPES;
  stringValue(envelope.type, 'envelope.type', { min: 1, max: 64, values: types });
  if (direction === 'client') validateClientPayload(envelope.type, envelope.payload);
  else validateControlPayload(envelope.type, envelope.payload);
  return envelope;
}

function bytesFromWire(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  fail('INVALID_MESSAGE', 'WebSocket payload must be UTF-8 JSON text');
}

function parseStrictJson(text) {
  let offset = 0;
  const skipWhitespace = () => {
    while (offset < text.length && /[\x20\t\r\n]/.test(text[offset])) offset += 1;
  };
  const invalid = () => fail('INVALID_JSON', 'Family bridge payload is not valid strict JSON');
  const parseString = () => {
    const start = offset;
    if (text[offset] !== '"') invalid();
    offset += 1;
    while (offset < text.length) {
      const character = text[offset];
      if (character === '"') {
        offset += 1;
        try { return JSON.parse(text.slice(start, offset)); }
        catch { invalid(); }
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
      } else if (character.charCodeAt(0) < 0x20) {
        invalid();
      }
      offset += 1;
    }
    invalid();
  };
  const parseValue = (depth = 0) => {
    if (depth > 64) fail('INVALID_JSON', 'Family bridge payload is nested too deeply');
    skipWhitespace();
    if (text[offset] === '{') {
      offset += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[offset] === '}') { offset += 1; return; }
      while (offset < text.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) fail('DUPLICATE_FIELD', `Family bridge payload repeats object field '${key}'`);
        keys.add(key);
        skipWhitespace();
        if (text[offset] !== ':') invalid();
        offset += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (text[offset] === '}') { offset += 1; return; }
        if (text[offset] !== ',') invalid();
        offset += 1;
      }
      invalid();
    }
    if (text[offset] === '[') {
      offset += 1;
      skipWhitespace();
      if (text[offset] === ']') { offset += 1; return; }
      while (offset < text.length) {
        parseValue(depth + 1);
        skipWhitespace();
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
  parseValue();
  skipWhitespace();
  if (offset !== text.length) invalid();
  try { return JSON.parse(text); }
  catch { invalid(); }
}

export function parseFamilyBridgeMessage(value, { direction, expectedSessionId, maxBytes = FAMILY_BRIDGE_MAX_PAYLOAD_BYTES } = {}) {
  if (!['client', 'control'].includes(direction)) throw new TypeError('Protocol message direction must be client or control');
  const bytes = bytesFromWire(value);
  if (bytes.byteLength > maxBytes) fail('PAYLOAD_TOO_LARGE', 'Family bridge payload exceeds its size limit', 1009);
  const parsed = parseStrictJson(bytes.toString('utf8'));
  return validateEnvelope(parsed, direction, expectedSessionId);
}

export function validateFamilyBridgeMessage(value, { direction, expectedSessionId } = {}) {
  if (!['client', 'control'].includes(direction)) throw new TypeError('Protocol message direction must be client or control');
  return validateEnvelope(value, direction, expectedSessionId);
}

export function createFamilyBridgeMessage({ sessionId, seq, source, type, payload, messageId = crypto.randomUUID(), sentAt = new Date().toISOString() }) {
  const value = {
    protocol: FAMILY_BRIDGE_PROTOCOL,
    version: FAMILY_BRIDGE_VERSION,
    messageId,
    sessionId,
    seq,
    sentAt,
    source,
    type,
    payload,
  };
  return validateEnvelope(value, source === 'control-plane' ? 'control' : 'client', sessionId);
}

export function isTerminalActionStatus(status) {
  return ['succeeded', 'failed', 'cancelled'].includes(status);
}
