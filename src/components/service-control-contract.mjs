const SERVICE_ROLES = Object.freeze([
  'supervisor',
  'minecraft-control-agent',
  'next-web',
  'mastermind-node-link',
]);
const SERVICE_STATES = new Set(['running', 'restarting', 'failed']);
const LOG_STREAMS = new Set(['stdout', 'stderr', 'system']);
const LAST_EXIT_KINDS = new Set(['clean', 'unexpected']);
const SUPERVISOR_MODES = new Set(['development', 'production']);
const PORT_BY_ROLE = Object.freeze({
  supervisor: null,
  'minecraft-control-agent': 43100,
  'next-web': 3000,
  'mastermind-node-link': null,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SIGNAL = /^[A-Z][A-Z0-9_]{0,31}$/;
const MAX_LOG_ENTRIES = 200;
const MAX_LOG_LINE_BYTES = 2_048;

export const MINECRAFT_CONTROL_AGENT_ROLE = 'minecraft-control-agent';
export const SERVICE_RESTART_CONFIRMATION = 'RESTART MINECRAFT CONTROL AGENT';

export class ServiceControlContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServiceControlContractError';
  }
}

function reject(message) {
  throw new ServiceControlContractError(message);
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

function validTimestamp(value) {
  return typeof value === 'string'
    && value.length <= 32
    && ISO_TIMESTAMP.test(value)
    && Number.isFinite(Date.parse(value));
}

function validGeneration(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function parseLastExit(value) {
  if (value === null) return null;
  const record = objectOf(value, 'service last exit');
  exactKeys(record, ['at', 'kind', 'code', 'signal'], 'service last exit');
  if (!validTimestamp(record.at)
    || !LAST_EXIT_KINDS.has(record.kind)
    || (record.code !== null && !Number.isSafeInteger(record.code))
    || (record.signal !== null && (typeof record.signal !== 'string' || !SIGNAL.test(record.signal)))) {
    reject('service last exit is invalid');
  }
  return {
    at: record.at,
    kind: record.kind,
    code: record.code,
    signal: record.signal,
  };
}

function parseService(value) {
  const service = objectOf(value, 'service');
  exactKeys(service, ['role', 'state', 'generation', 'port', 'lastExit'], 'service');
  if (!SERVICE_ROLES.includes(service.role)
    || !SERVICE_STATES.has(service.state)
    || !validGeneration(service.generation)
    || service.port !== PORT_BY_ROLE[service.role]) {
    reject('service identity or state is invalid');
  }
  return {
    role: service.role,
    state: service.state,
    generation: service.generation,
    port: service.port,
    lastExit: parseLastExit(service.lastExit),
  };
}

export function parseServiceInventory(value) {
  const envelope = objectOf(value, 'service inventory');
  exactKeys(envelope, ['ok', 'supervisor', 'services'], 'service inventory');
  const supervisor = objectOf(envelope.supervisor, 'supervisor summary');
  exactKeys(supervisor, ['mode', 'startedAt'], 'supervisor summary');
  if (envelope.ok !== true
    || !SUPERVISOR_MODES.has(supervisor.mode)
    || !validTimestamp(supervisor.startedAt)
    || !Array.isArray(envelope.services)
    || envelope.services.length !== SERVICE_ROLES.length) {
    reject('service inventory is invalid');
  }
  const services = envelope.services.map(parseService);
  const byRole = new Map(services.map((service) => [service.role, service]));
  if (byRole.size !== SERVICE_ROLES.length || SERVICE_ROLES.some((role) => !byRole.has(role))) {
    reject('service inventory must contain each fixed role exactly once');
  }
  return {
    ok: true,
    supervisor: { mode: supervisor.mode, startedAt: supervisor.startedAt },
    services: SERVICE_ROLES.map((role) => byRole.get(role)),
  };
}

function validLogLine(value) {
  return typeof value === 'string'
    && value.length <= MAX_LOG_LINE_BYTES
    && new TextEncoder().encode(value).byteLength <= MAX_LOG_LINE_BYTES;
}

function parseLogEntry(value) {
  const entry = objectOf(value, 'service log entry');
  exactKeys(entry, ['sequence', 'at', 'role', 'stream', 'line'], 'service log entry');
  if (!Number.isSafeInteger(entry.sequence) || entry.sequence < 1
    || !validTimestamp(entry.at)
    || !SERVICE_ROLES.includes(entry.role)
    || !LOG_STREAMS.has(entry.stream)
    || !validLogLine(entry.line)) {
    reject('service log entry is invalid');
  }
  return {
    sequence: entry.sequence,
    at: entry.at,
    role: entry.role,
    stream: entry.stream,
    line: entry.line,
  };
}

export function parseServiceLogs(value) {
  const envelope = objectOf(value, 'service logs');
  exactKeys(envelope, ['ok', 'role', 'entries'], 'service logs');
  if (envelope.ok !== true
    || envelope.role !== MINECRAFT_CONTROL_AGENT_ROLE
    || !Array.isArray(envelope.entries)
    || envelope.entries.length > MAX_LOG_ENTRIES) {
    reject('service logs are invalid');
  }
  const entries = envelope.entries.map(parseLogEntry);
  let previousSequence = 0;
  for (const entry of entries) {
    if (entry.role !== MINECRAFT_CONTROL_AGENT_ROLE || entry.sequence <= previousSequence) {
      reject('service log entries must match the requested role and increase in sequence');
    }
    previousSequence = entry.sequence;
  }
  return { ok: true, role: MINECRAFT_CONTROL_AGENT_ROLE, entries };
}

export function parseRestartReceipt(value, expectedRequestId) {
  const envelope = objectOf(value, 'service restart receipt');
  exactKeys(envelope, ['ok', 'accepted', 'requestId', 'generation', 'operation'], 'service restart receipt');
  const operation = objectOf(envelope.operation, 'service restart operation');
  exactKeys(operation, ['state'], 'service restart operation');
  if (envelope.ok !== true
    || envelope.accepted !== true
    || typeof envelope.requestId !== 'string'
    || !UUID.test(envelope.requestId)
    || envelope.requestId !== expectedRequestId
    || !validGeneration(envelope.generation)
    || operation.state !== 'accepted') {
    reject('service restart receipt is invalid');
  }
  return {
    ok: true,
    accepted: true,
    requestId: envelope.requestId,
    generation: envelope.generation,
    operation: { state: 'accepted' },
  };
}
