export const LOCAL_SERVICE_SCHEMA_VERSION = 1;
export const LOCAL_SERVICE_REQUEST_BYTES = 4 * 1024;
export const LOCAL_SERVICE_RESPONSE_BYTES = 128 * 1024;
export const LOCAL_SERVICE_LOG_LINE_BYTES = 2 * 1024;
export const LOCAL_SERVICE_ROLES = Object.freeze([
  'supervisor',
  'minecraft-control-agent',
  'next-web',
  'mastermind-node-link',
]);
export const RESTARTABLE_LOCAL_SERVICE_ROLE = 'minecraft-control-agent';
export const LOCAL_SERVICE_RESTART_CONFIRMATION = 'RESTART MINECRAFT CONTROL AGENT';

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUPERVISOR_ID = /^[a-f0-9]{32}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const SIGNAL = /^[A-Z][A-Z0-9]{0,31}$/;
const UNSAFE_TEXT = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const UNSAFE_TEXT_GLOBAL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?)/gu;
const EXPECTED_PORT = Object.freeze({
  supervisor: null,
  'minecraft-control-agent': 43100,
  'next-web': 3000,
  'mastermind-node-link': null,
});
const SERVICE_STATES = new Set(['running', 'restarting', 'failed']);
const LOG_STREAMS = new Set(['stdout', 'stderr', 'system']);

export class LocalServiceProtocolError extends Error {
  constructor(message = 'The local service supervisor returned an invalid response.') {
    super(message);
    this.name = 'LocalServiceProtocolError';
  }
}

function fail(message) {
  throw new LocalServiceProtocolError(message);
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`Invalid ${label}.`);
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(`Invalid ${label}.`);
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`Invalid ${label}.`);
  return value;
}

function nonnegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`Invalid ${label}.`);
  return value;
}

function isoTimestamp(value, label) {
  if (
    typeof value !== 'string'
    || value.length !== 24
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) fail(`Invalid ${label}.`);
  return value;
}

function expectedSupervisor(value, expectedSupervisorId, label) {
  if (typeof value !== 'string' || !SUPERVISOR_ID.test(value) || value !== expectedSupervisorId) {
    fail(`Invalid ${label}.`);
  }
  return value;
}

function boundedUtf8(value, maximumBytes, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximumBytes) fail(`Invalid ${label}.`);
  return value;
}

function cleanLogLine(value) {
  const source = boundedUtf8(value, LOCAL_SERVICE_LOG_LINE_BYTES, 'log line');
  const safe = source.replace(ANSI_SEQUENCE, '').replace(UNSAFE_TEXT_GLOBAL, '\ufffd').replace(/\t/gu, ' ');
  if (safe.includes('\r') || safe.includes('\n') || Buffer.byteLength(safe, 'utf8') > LOCAL_SERVICE_LOG_LINE_BYTES) {
    fail('Invalid log line.');
  }
  return safe;
}

function publicLastExit(value, label) {
  if (value === null) return null;
  const source = record(value, label);
  exactKeys(source, ['at', 'kind', 'code', 'signal'], label);
  if (!['clean', 'unexpected'].includes(source.kind)) fail(`Invalid ${label}.`);
  if (
    source.code !== null
    && (!Number.isSafeInteger(source.code) || source.code < 0 || source.code > 0xffffffff)
  ) fail(`Invalid ${label}.`);
  if (source.signal !== null && (typeof source.signal !== 'string' || !SIGNAL.test(source.signal))) fail(`Invalid ${label}.`);
  return {
    at: isoTimestamp(source.at, `${label} timestamp`),
    kind: source.kind,
    code: source.code,
    signal: source.signal,
  };
}

function publicService(value) {
  const source = record(value, 'service record');
  exactKeys(source, ['role', 'state', 'generation', 'port', 'lastExit'], 'service record');
  if (typeof source.role !== 'string' || !LOCAL_SERVICE_ROLES.includes(source.role)) fail('Invalid service role.');
  if (typeof source.state !== 'string' || !SERVICE_STATES.has(source.state)) fail('Invalid service state.');
  if (source.port !== EXPECTED_PORT[source.role]) fail('Invalid service port.');
  return {
    role: source.role,
    state: source.state,
    generation: positiveSafeInteger(source.generation, 'service generation'),
    port: source.port,
    lastExit: publicLastExit(source.lastExit, 'last-exit record'),
  };
}

export function parseLocalServiceRole(value) {
  if (typeof value !== 'string' || !LOCAL_SERVICE_ROLES.includes(value)) {
    throw new LocalServiceProtocolError('The requested local service does not exist.');
  }
  return value;
}

export function parseLocalServiceLogQuery(searchParams) {
  const keys = [...searchParams.keys()];
  if (keys.some((key) => !['limit', 'after'].includes(key))) {
    throw new LocalServiceProtocolError('The log request contains an unsupported query field.');
  }
  if (searchParams.getAll('limit').length > 1 || searchParams.getAll('after').length > 1) {
    throw new LocalServiceProtocolError('The log request repeats a query field.');
  }
  const limitText = searchParams.get('limit');
  const limit = limitText === null ? 100 : /^[1-9]\d{0,2}$/.test(limitText) ? Number(limitText) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new LocalServiceProtocolError('The log limit must be an integer from 1 through 200.');
  }
  const afterText = searchParams.get('after');
  let after;
  if (afterText !== null) {
    after = /^(?:0|[1-9]\d{0,15})$/.test(afterText) ? Number(afterText) : NaN;
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new LocalServiceProtocolError('The log cursor must be a nonnegative safe integer.');
    }
  }
  return after === undefined ? { limit } : { limit, after };
}

export function parseLocalServiceRestartBody(value) {
  const source = record(value, 'restart request');
  exactKeys(source, ['requestId', 'expectedGeneration', 'confirmation'], 'restart request');
  if (typeof source.requestId !== 'string' || !LOWERCASE_UUID.test(source.requestId)) {
    throw new LocalServiceProtocolError('The restart request ID must be a lowercase UUID.');
  }
  const expectedGeneration = positiveSafeInteger(source.expectedGeneration, 'expected generation');
  if (source.confirmation !== LOCAL_SERVICE_RESTART_CONFIRMATION) {
    throw new LocalServiceProtocolError('The restart confirmation is invalid.');
  }
  return {
    requestId: source.requestId,
    expectedGeneration,
    confirmation: LOCAL_SERVICE_RESTART_CONFIRMATION,
  };
}

export function parseSupervisorError(value) {
  const source = record(value, 'supervisor error');
  exactKeys(source, ['ok', 'code', 'message'], 'supervisor error');
  if (
    source.ok !== false
    || typeof source.code !== 'string'
    || !ERROR_CODE.test(source.code)
    || typeof source.message !== 'string'
    || source.message.length < 1
    || Buffer.byteLength(source.message, 'utf8') > 512
    || UNSAFE_TEXT.test(source.message)
  ) fail('Invalid supervisor error.');
  return { code: source.code };
}

export function publicLocalServiceInventory(value, expectedSupervisorId) {
  const source = record(value, 'service inventory');
  exactKeys(source, ['ok', 'supervisorId', 'supervisor', 'services'], 'service inventory');
  if (source.ok !== true) fail('Invalid service inventory.');
  expectedSupervisor(source.supervisorId, expectedSupervisorId, 'service inventory owner');
  const supervisor = record(source.supervisor, 'supervisor summary');
  exactKeys(supervisor, ['mode', 'startedAt'], 'supervisor summary');
  if (!['development', 'production'].includes(supervisor.mode)) fail('Invalid supervisor mode.');
  if (!Array.isArray(source.services) || source.services.length !== LOCAL_SERVICE_ROLES.length) fail('Invalid service inventory.');
  const byRole = new Map(source.services.map((service) => {
    const sanitized = publicService(service);
    return [sanitized.role, sanitized];
  }));
  if (byRole.size !== LOCAL_SERVICE_ROLES.length || LOCAL_SERVICE_ROLES.some((role) => !byRole.has(role))) {
    fail('Invalid service inventory.');
  }
  return {
    ok: true,
    supervisor: {
      mode: supervisor.mode,
      startedAt: isoTimestamp(supervisor.startedAt, 'supervisor start timestamp'),
    },
    services: LOCAL_SERVICE_ROLES.map((role) => byRole.get(role)),
  };
}

export function publicLocalServiceLogs(value, expectedSupervisorId, requestedRole, query) {
  const source = record(value, 'service logs');
  exactKeys(source, ['ok', 'supervisorId', 'role', 'entries', 'nextSequence'], 'service logs');
  if (source.ok !== true || source.role !== requestedRole) fail('Invalid service logs.');
  expectedSupervisor(source.supervisorId, expectedSupervisorId, 'service log owner');
  const nextSequence = nonnegativeSafeInteger(source.nextSequence, 'next log sequence');
  if (!Array.isArray(source.entries) || source.entries.length > query.limit) fail('Invalid service logs.');
  let previous = query.after ?? -1;
  const entries = source.entries.map((entry) => {
    const item = record(entry, 'log entry');
    exactKeys(item, ['sequence', 'at', 'role', 'stream', 'line'], 'log entry');
    const sequence = positiveSafeInteger(item.sequence, 'log sequence');
    if (sequence <= previous || item.role !== requestedRole || typeof item.stream !== 'string' || !LOG_STREAMS.has(item.stream)) {
      fail('Invalid log entry.');
    }
    previous = sequence;
    return {
      sequence,
      at: isoTimestamp(item.at, 'log timestamp'),
      role: item.role,
      stream: item.stream,
      line: cleanLogLine(item.line),
    };
  });
  if (entries.length > 0 && nextSequence < previous) fail('Invalid next log sequence.');
  const result = { ok: true, role: requestedRole, entries };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > LOCAL_SERVICE_RESPONSE_BYTES) fail('Invalid service logs.');
  return result;
}

export function publicLocalServiceRestart(value, expectedSupervisorId, request) {
  const source = record(value, 'restart acceptance');
  exactKeys(source, ['ok', 'supervisorId', 'accepted', 'operation'], 'restart acceptance');
  if (source.ok !== true || source.accepted !== true) fail('Invalid restart acceptance.');
  expectedSupervisor(source.supervisorId, expectedSupervisorId, 'restart owner');
  const operation = record(source.operation, 'restart operation');
  exactKeys(
    operation,
    ['requestId', 'role', 'state', 'expectedGeneration', 'generation', 'acceptedAt', 'finishedAt', 'code'],
    'restart operation',
  );
  if (
    operation.requestId !== request.requestId
    || operation.role !== RESTARTABLE_LOCAL_SERVICE_ROLE
    || operation.state !== 'accepted'
    || operation.expectedGeneration !== request.expectedGeneration
    || operation.finishedAt !== null
    || operation.code !== null
  ) fail('Invalid restart operation.');
  isoTimestamp(operation.acceptedAt, 'restart acceptance timestamp');
  return {
    ok: true,
    accepted: true,
    requestId: operation.requestId,
    generation: positiveSafeInteger(operation.generation, 'restart generation'),
    operation: { state: 'accepted' },
  };
}
