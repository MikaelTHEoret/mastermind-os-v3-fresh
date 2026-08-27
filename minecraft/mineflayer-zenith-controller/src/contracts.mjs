const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/u;
const REGISTRY_ID = /^(?!https?:|file:)[a-z0-9_.-]+:[a-z0-9_][a-z0-9_./-]*$/u;
const SUPPORTED_VERSIONS = new Set(['1.21.11']);
const ACTION_KINDS = new Set([
  'observe.snapshot', 'direct.say', 'direct.lookAt', 'direct.moveFor', 'direct.jump',
  'direct.selectSlot', 'direct.selectItem', 'direct.use', 'direct.interactBlock',
  'direct.placeBlock', 'direct.placeNearbyBlock', 'direct.dropItem', 'direct.dropItemById',
  'direct.swingHand', 'direct.transferContainer', 'skill.navigateTo', 'container.open',
  'inventory.transfer', 'container.close', 'action.cancel', 'controller.stop',
]);

export class ControllerContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ControllerContractError';
    this.code = code;
  }
}

function fail(code) {
  throw new ControllerContractError(code);
}

function exactObject(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT');
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail('UNKNOWN_FIELD');
  if (required.some((key) => !Object.hasOwn(value, key))) fail('MISSING_FIELD');
  return value;
}

function string(value, pattern, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
    || (pattern && !pattern.test(value))) fail('INVALID_STRING');
  return value;
}

function number(value, minimum, maximum, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum
    || (integer && !Number.isInteger(value))) fail('INVALID_NUMBER');
  return value;
}

export function parseLaunchEnvelope(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > 16 * 1024) fail('INVALID_LAUNCH_ENVELOPE');
  let value;
  try { value = JSON.parse(line); } catch { fail('INVALID_LAUNCH_ENVELOPE'); }
  exactObject(value, ['schemaVersion', 'host', 'port', 'protocolVersion', 'profile', 'accessToken', 'holdMillis']);
  if (value.schemaVersion !== 1 || value.host !== '127.0.0.1') fail('INVALID_LAUNCH_ENVELOPE');
  number(value.port, 1024, 65535, true);
  string(value.protocolVersion, null, 1, 32);
  if (!SUPPORTED_VERSIONS.has(value.protocolVersion)) fail('UNSUPPORTED_PROTOCOL_VERSION');
  exactObject(value.profile, ['name', 'uuid']);
  string(value.profile.name, PLAYER_NAME, 3, 16);
  string(value.profile.uuid, UUID, 36, 36);
  string(value.accessToken, null, 16, 8192);
  number(value.holdMillis, 1000, 86_400_000, true);
  return value;
}

function validateCoordinates(args) {
  number(args.x, -30_000_000, 30_000_000);
  number(args.y, -2048, 2048);
  number(args.z, -30_000_000, 30_000_000);
}

export function parseControllerCommand(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > 16 * 1024) fail('INVALID_CONTROLLER_COMMAND');
  let value;
  try { value = JSON.parse(line); } catch { fail('INVALID_CONTROLLER_COMMAND'); }
  exactObject(value, ['schemaVersion', 'commandId', 'kind', 'args']);
  if (value.schemaVersion !== 1) fail('INVALID_CONTROLLER_COMMAND');
  string(value.commandId, UUID, 36, 36);
  string(value.kind, null, 3, 64);
  if (!ACTION_KINDS.has(value.kind)) fail('UNSUPPORTED_CONTROLLER_COMMAND');
  if (value.kind === 'observe.snapshot' || value.kind === 'container.close' || value.kind === 'controller.stop') {
    exactObject(value.args, []);
  } else if (value.kind === 'direct.say') {
    exactObject(value.args, ['text']);
    string(value.args.text, null, 1, 220);
    if (value.args.text.startsWith('/')) fail('UNSAFE_CHAT');
  } else if (value.kind === 'direct.lookAt') {
    exactObject(value.args, ['x', 'y', 'z', 'durationMs']);
    validateCoordinates(value.args);
    number(value.args.durationMs, 50, 5_000, true);
  } else if (value.kind === 'direct.moveFor') {
    exactObject(value.args, ['forward', 'strafe', 'durationMs', 'sprint', 'sneak']);
    number(value.args.forward, -1, 1);
    number(value.args.strafe, -1, 1);
    number(value.args.durationMs, 50, 5_000, true);
    if (typeof value.args.sprint !== 'boolean' || typeof value.args.sneak !== 'boolean'
      || (value.args.sprint && value.args.sneak)) fail('INVALID_MOVEMENT');
  } else if (value.kind === 'direct.jump') {
    exactObject(value.args, []);
  } else if (value.kind === 'direct.selectSlot') {
    exactObject(value.args, ['slot']);
    number(value.args.slot, 0, 8, true);
  } else if (value.kind === 'direct.selectItem') {
    exactObject(value.args, ['itemId']);
    string(value.args.itemId, REGISTRY_ID, 3, 128);
  } else if (value.kind === 'direct.use') {
    exactObject(value.args, ['hand']);
    if (!['main', 'off'].includes(value.args.hand)) fail('INVALID_HAND');
  } else if (value.kind === 'direct.interactBlock') {
    exactObject(value.args, ['blockId', 'x', 'y', 'z', 'hand']);
    string(value.args.blockId, REGISTRY_ID, 3, 128);
    validateCoordinates(value.args);
    if (!['main', 'off'].includes(value.args.hand)) fail('INVALID_HAND');
  } else if (value.kind === 'direct.placeBlock') {
    exactObject(value.args, ['blockId', 'x', 'y', 'z']);
    string(value.args.blockId, REGISTRY_ID, 3, 128);
    validateCoordinates(value.args);
  } else if (value.kind === 'direct.placeNearbyBlock') {
    exactObject(value.args, ['blockId']);
    string(value.args.blockId, REGISTRY_ID, 3, 128);
  } else if (value.kind === 'direct.dropItem') {
    exactObject(value.args, ['all']);
    if (typeof value.args.all !== 'boolean') fail('INVALID_BOOLEAN');
  } else if (value.kind === 'direct.dropItemById') {
    exactObject(value.args, ['itemId', 'all']);
    string(value.args.itemId, REGISTRY_ID, 3, 128);
    if (typeof value.args.all !== 'boolean') fail('INVALID_BOOLEAN');
  } else if (value.kind === 'direct.swingHand') {
    exactObject(value.args, ['hand']);
    if (!['main', 'off'].includes(value.args.hand)) fail('INVALID_HAND');
  } else if (value.kind === 'direct.transferContainer') {
    exactObject(value.args, ['blockId', 'x', 'y', 'z', 'direction', 'slotRole', 'itemId', 'count']);
    string(value.args.blockId, REGISTRY_ID, 3, 128);
    validateCoordinates(value.args);
    if (!['player-to-container', 'container-to-player'].includes(value.args.direction)) fail('INVALID_TRANSFER_DIRECTION');
    if (!['storage', 'input', 'fuel', 'output'].includes(value.args.slotRole)) fail('INVALID_SLOT_ROLE');
    string(value.args.itemId, REGISTRY_ID, 3, 128);
    number(value.args.count, 1, 64, true);
  } else if (value.kind === 'skill.navigateTo') {
    exactObject(value.args, ['x', 'y', 'z', 'tolerance']);
    validateCoordinates(value.args);
    number(value.args.tolerance, 0.5, 16);
  } else if (value.kind === 'container.open') {
    exactObject(value.args, ['x', 'y', 'z'], ['expectedBlockId']);
    validateCoordinates(value.args);
    if (Object.hasOwn(value.args, 'expectedBlockId')) string(value.args.expectedBlockId, REGISTRY_ID, 3, 128);
  } else if (value.kind === 'inventory.transfer') {
    exactObject(value.args, ['direction', 'slotRole', 'itemId', 'count']);
    if (!['player-to-container', 'container-to-player'].includes(value.args.direction)) fail('INVALID_TRANSFER_DIRECTION');
    if (!['storage', 'input', 'fuel', 'output'].includes(value.args.slotRole)) fail('INVALID_SLOT_ROLE');
    string(value.args.itemId, REGISTRY_ID, 3, 128);
    number(value.args.count, 1, 2304, true);
  } else if (value.kind === 'action.cancel') {
    exactObject(value.args, ['actionId']);
    string(value.args.actionId, UUID, 36, 36);
  }
  return value;
}

export async function readBoundedLines(stream, onLine, options = {}) {
  const maximum = options.maximum ?? 16 * 1024;
  let buffered = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) {
    buffered += chunk;
    if (Buffer.byteLength(buffered, 'utf8') > maximum) fail('INPUT_LIMIT_EXCEEDED');
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line) await onLine(line);
    }
  }
  if (buffered.trim()) await onLine(buffered.trim());
}

export const __test = Object.freeze({ ACTION_KINDS });
