const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
const API_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const BASE64URL_256 = /^[A-Za-z0-9_-]{43}$/;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;

const NODE_STATES = new Set(['active', 'revoked']);
const CONNECTIVITY_STATES = new Set(['online', 'offline', 'never-seen']);
const CONTROL_AGENT_STATES = new Set(['online', 'unreachable']);
const RECOVERY_STATES = new Set(['clear', 'manual-repair-required', 'unknown']);
const FAMILY_SERVER_STATES = new Set(['unknown', 'missing', 'stopped', 'starting', 'running', 'stopping', 'failed']);
const COMPANION_STATES = new Set([
  'unknown', 'not-installed', 'sign-in-required', 'stopped', 'starting', 'running', 'stopping', 'failed', 'orphaned',
]);
const COMPANION_BRIDGE_STATES = new Set(['unknown', 'disconnected', 'handshaking', 'syncing', 'ready']);
const ATTENTION_CODES = new Set([
  'companion-failed',
  'companion-local-kill-switch',
  'companion-not-installed',
  'companion-orphaned',
  'companion-sign-in-required',
  'control-agent-unreachable',
  'family-server-failed',
  'family-server-not-provisioned',
  'local-response-invalid',
  'local-safe-stop-required',
  'minecraft-update-approval-required',
  'recovery-manual-repair',
]);
const JOB_STATES = new Set(['queued', 'leased', 'running', 'succeeded', 'failed', 'expired']);
const TERMINAL_JOB_STATES = new Set(['succeeded', 'failed', 'expired']);
const TERMINAL_CODES = new Set([
  'desired-state-reached',
  'companion-local-kill-switch',
  'companion-not-installed',
  'companion-orphaned',
  'companion-sign-in-required',
  'companion-start-failed',
  'control-agent-unreachable',
  'execution-timeout',
  'family-server-not-provisioned',
  'family-server-start-failed',
  'lease-lost',
  'local-response-invalid',
  'local-safe-stop-required',
  'minecraft-update-approval-required',
  'recovery-manual-repair',
]);
const ENQUEUE_STATES = new Set(['created', 'duplicate', 'coalesced']);

export const NODE_ENSURE_RUNNING_CAPABILITY = 'family-ecosystem.ensure-running';
export const NODE_CORE_STATUS_CAPABILITY = 'mastermind.core.status';
export const LOCAL_NODE_PAIRING_ORIGIN = 'http://127.0.0.1:3000';
export const LOCAL_NODE_PAIRING_PATH = '/node/pair';
export const NODE_CONTROL_TAB_HASH = '#nodes';
export const HOSTED_NODE_CONTROL_URL = `https://mastermind-core.com/${NODE_CONTROL_TAB_HASH}`;
export const MAX_PUBLIC_NODES = 64;

const LOCAL_NODE_CONTROL_ORIGINS = new Set([
  LOCAL_NODE_PAIRING_ORIGIN,
  'http://localhost:3000',
]);

export class NodeControlContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NodeControlContractError';
  }
}

function reject(message) {
  throw new NodeControlContractError(message);
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

function boundedText(value, label, maximum, pattern) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || UNSAFE_TEXT.test(value)
    || (pattern && !pattern.test(value))) {
    reject(`${label} is invalid`);
  }
  return value;
}

function uuid(value, label) {
  return boundedText(value, label, 36, UUID);
}

function timestamp(value, label) {
  if (typeof value !== 'string' || value.length !== 24 || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    reject(`${label} is invalid`);
  }
  return value;
}

function nullableTimestamp(value, label) {
  return value === null ? null : timestamp(value, label);
}

function enumValue(value, label, allowed) {
  if (typeof value !== 'string' || !allowed.has(value)) reject(`${label} is unsupported`);
  return value;
}

function parseTerminalResult(value, label) {
  const result = objectOf(value, label);
  exactKeys(result, ['familyServer', 'companion', 'companionBridge'], label);
  return {
    familyServer: enumValue(result.familyServer, `${label} family server`, FAMILY_SERVER_STATES),
    companion: enumValue(result.companion, `${label} companion`, COMPANION_STATES),
    companionBridge: enumValue(result.companionBridge, `${label} companion bridge`, COMPANION_BRIDGE_STATES),
  };
}

function parseNodeStatus(value) {
  const status = objectOf(value, 'node status');
  exactKeys(status, [
    'observedAt', 'controlAgent', 'recovery', 'familyServer', 'companion', 'companionBridge',
    'localKillSwitch', 'attentionCodes',
  ], 'node status');
  if (status.localKillSwitch !== null && typeof status.localKillSwitch !== 'boolean') {
    reject('node local kill switch is invalid');
  }
  if (!Array.isArray(status.attentionCodes) || status.attentionCodes.length > 16) {
    reject('node attention codes are invalid');
  }
  const attentionCodes = status.attentionCodes.map((code) => enumValue(code, 'node attention code', ATTENTION_CODES));
  if (new Set(attentionCodes).size !== attentionCodes.length) reject('node attention codes contain a duplicate');
  return {
    observedAt: timestamp(status.observedAt, 'node observation time'),
    controlAgent: enumValue(status.controlAgent, 'node control agent', CONTROL_AGENT_STATES),
    recovery: enumValue(status.recovery, 'node recovery', RECOVERY_STATES),
    familyServer: enumValue(status.familyServer, 'node family server', FAMILY_SERVER_STATES),
    companion: enumValue(status.companion, 'node companion', COMPANION_STATES),
    companionBridge: enumValue(status.companionBridge, 'node companion bridge', COMPANION_BRIDGE_STATES),
    localKillSwitch: status.localKillSwitch,
    attentionCodes,
  };
}

function parseWorker(value) {
  if (value === null) return null;
  const worker = objectOf(value, 'worker advertisement');
  exactKeys(worker, ['protocolVersion', 'capabilities'], 'worker advertisement');
  if (worker.protocolVersion !== 2 || !Array.isArray(worker.capabilities)
    || worker.capabilities.length < 1 || worker.capabilities.length > 3) reject('worker advertisement is unsupported');
  const capabilities = worker.capabilities.map((item) => {
    objectOf(item, 'worker capability'); exactKeys(item, ['id', 'version'], 'worker capability');
    if (![NODE_ENSURE_RUNNING_CAPABILITY, NODE_CORE_STATUS_CAPABILITY, 'mastermind.native.reuse'].includes(item.id) || item.version !== 1) {
      reject('worker capability is unsupported');
    }
    return { id: item.id, version: item.version };
  });
  if (new Set(capabilities.map((item) => item.id)).size !== capabilities.length) reject('worker capabilities contain a duplicate');
  return { protocolVersion: 2, capabilities };
}

export function nodeSupportsFamily(node) {
  return Boolean(node?.state === 'active' && (node.worker == null
    || node.worker.capabilities.some((item) => item.id === NODE_ENSURE_RUNNING_CAPABILITY && item.version === 1)));
}

export function nodeSupportsCoreStatus(node) {
  return Boolean(node?.state === 'active' && node.worker?.protocolVersion === 2
    && node.worker.capabilities.some((item) => item.id === NODE_CORE_STATUS_CAPABILITY && item.version === 1));
}

function parseCoreStatus(value) {
  const core = objectOf(value, 'core observation');
  exactKeys(core, ['kind', 'observedAt', 'services', 'capabilities', 'activeTurns', 'complete'], 'core observation');
  if (core.kind !== NODE_CORE_STATUS_CAPABILITY) reject('core observation kind is invalid');
  const services = objectOf(core.services, 'core services');
  exactKeys(services, ['mcpHost', 'memory', 'modules'], 'core services');
  const allowed = new Set(['online', 'degraded', 'unreachable', 'invalid']);
  for (const [name, state] of Object.entries(services)) enumValue(state, name, allowed);
  const capabilities = objectOf(core.capabilities, 'core catalog');
  exactKeys(capabilities, ['count', 'sha256'], 'core catalog');
  if (capabilities.count !== null && (!Number.isSafeInteger(capabilities.count) || capabilities.count < 0 || capabilities.count > 512)) reject('core catalog count is invalid');
  if (capabilities.sha256 !== null && (typeof capabilities.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(capabilities.sha256))) reject('core catalog digest is invalid');
  if ((capabilities.count === null) !== (capabilities.sha256 === null)) reject('core catalog evidence is incomplete');
  if (core.activeTurns !== null && (!Number.isSafeInteger(core.activeTurns) || core.activeTurns < 0 || core.activeTurns > 65535)) reject('core active turn count is invalid');
  const complete = Object.values(services).every((state) => state === 'online') && capabilities.count !== null && core.activeTurns !== null;
  if (core.complete !== complete) reject('core completeness disagrees with its evidence');
  return { kind: core.kind, observedAt: timestamp(core.observedAt, 'core observation time'),
    services: { ...services }, capabilities: { ...capabilities }, activeTurns: core.activeTurns, complete };
}

function parseNode(value) {
  const node = objectOf(value, 'node');
  exactKeys(node, [
    'nodeId', 'displayName', 'state', 'connectivity', 'agentVersion', 'pairedAt',
    'lastExchangeAt', 'lastJobReceiptAt', 'status', ...(Object.hasOwn(node, 'worker') ? ['worker'] : []),
  ], 'node');
  const connectivity = enumValue(node.connectivity, 'node connectivity', CONNECTIVITY_STATES);
  const lastExchangeAt = nullableTimestamp(node.lastExchangeAt, 'node last exchange time');
  if ((connectivity === 'never-seen') !== (lastExchangeAt === null)) {
    reject('node connectivity and last exchange time disagree');
  }
  if (node.status !== null && connectivity === 'never-seen') reject('a never-seen node cannot report status');
  if (node.worker != null && connectivity === 'never-seen') reject('a never-seen node cannot advertise a worker');
  return {
    nodeId: uuid(node.nodeId, 'node ID'),
    displayName: boundedText(node.displayName, 'node display name', 64),
    state: enumValue(node.state, 'node state', NODE_STATES),
    connectivity,
    agentVersion: boundedText(node.agentVersion, 'node agent version', 32, VERSION),
    pairedAt: timestamp(node.pairedAt, 'node pairing time'),
    lastExchangeAt,
    lastJobReceiptAt: nullableTimestamp(node.lastJobReceiptAt, 'node last receipt time'),
    status: node.status === null ? null : parseNodeStatus(node.status),
    ...(Object.hasOwn(node, 'worker') ? { worker: parseWorker(node.worker) } : {}),
  };
}

export function parseNodeInventory(value) {
  const envelope = objectOf(value, 'node inventory');
  exactKeys(envelope, ['ok', 'nodes'], 'node inventory');
  if (envelope.ok !== true || !Array.isArray(envelope.nodes) || envelope.nodes.length > MAX_PUBLIC_NODES) {
    reject('node inventory is invalid');
  }
  const nodes = envelope.nodes.map(parseNode);
  if (new Set(nodes.map((node) => node.nodeId)).size !== nodes.length) reject('node inventory contains a duplicate node');
  return { ok: true, nodes };
}

function parseLease(value) {
  const lease = objectOf(value, 'job lease');
  exactKeys(lease, ['leaseId', 'leasedAt', 'leaseExpiresAt'], 'job lease');
  const leasedAt = timestamp(lease.leasedAt, 'job leased time');
  const leaseExpiresAt = timestamp(lease.leaseExpiresAt, 'job lease expiry');
  if (Date.parse(leaseExpiresAt) <= Date.parse(leasedAt)) reject('job lease timing is invalid');
  return { leaseId: uuid(lease.leaseId, 'job lease ID'), leasedAt, leaseExpiresAt };
}

function parseJob(value) {
  const job = objectOf(value, 'node job');
  exactKeys(job, [
    'jobId', 'nodeId', 'capability', 'capabilityVersion', 'policyClass', 'state',
    'createdAt', 'expiresAt', 'lease', 'terminal',
  ], 'node job');
  const state = enumValue(job.state, 'node job state', JOB_STATES);
  const createdAt = timestamp(job.createdAt, 'job creation time');
  const expiresAt = timestamp(job.expiresAt, 'job expiry');
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) reject('job lifetime is invalid');
  if (![NODE_ENSURE_RUNNING_CAPABILITY, NODE_CORE_STATUS_CAPABILITY].includes(job.capability) || job.capabilityVersion !== 1 || job.policyClass !== 'routine') {
    reject('node job capability is unsupported');
  }
  const lease = job.lease === null ? null : parseLease(job.lease);
  if ((state === 'leased' || state === 'running') !== (lease !== null)
    && (state === 'queued' || state === 'leased' || state === 'running' || state === 'expired')) {
    reject('node job state and lease disagree');
  }
  if (lease !== null && (Date.parse(lease.leasedAt) < Date.parse(createdAt)
    || Date.parse(lease.leaseExpiresAt) > Date.parse(expiresAt))) {
    reject('node job lease is outside its job lifetime');
  }
  let terminal = null;
  if (job.terminal !== null) {
    const value = objectOf(job.terminal, 'job terminal result');
    exactKeys(value, ['code', 'result', 'finishedAt'], 'job terminal result');
    terminal = {
      code: enumValue(value.code, 'job terminal code', TERMINAL_CODES),
      result: value.result === null ? null : job.capability === NODE_CORE_STATUS_CAPABILITY
        ? parseCoreStatus(value.result) : parseTerminalResult(value.result, 'job terminal state'),
      finishedAt: timestamp(value.finishedAt, 'job finished time'),
    };
    if (Date.parse(terminal.finishedAt) < Date.parse(createdAt)) reject('node job finished before it was created');
  }
  if ((state === 'succeeded' || state === 'failed') !== (terminal !== null)) {
    reject('node job state and terminal result disagree');
  }
  if (state === 'succeeded' && (terminal.code !== 'desired-state-reached' || terminal.result === null
    || (job.capability === NODE_ENSURE_RUNNING_CAPABILITY && (terminal.result.familyServer !== 'running'
      || terminal.result.companion !== 'running' || terminal.result.companionBridge !== 'ready')))) {
    reject('successful node job did not reach the desired state');
  }
  if (state === 'failed' && job.capability === NODE_CORE_STATUS_CAPABILITY && terminal.result !== null) reject('failed core job cannot carry a result');
  if (state === 'failed' && terminal.code === 'desired-state-reached') reject('failed node job has a success code');
  return {
    jobId: uuid(job.jobId, 'job ID'),
    nodeId: uuid(job.nodeId, 'job node ID'),
    capability: job.capability,
    capabilityVersion: 1,
    policyClass: 'routine',
    state,
    createdAt,
    expiresAt,
    lease,
    terminal,
  };
}

export function parseNodeJob(value, expectedNodeId, expectedJobId, expectedCapability = NODE_ENSURE_RUNNING_CAPABILITY) {
  const envelope = objectOf(value, 'node job response');
  exactKeys(envelope, ['ok', 'job'], 'node job response');
  if (envelope.ok !== true) reject('node job response is invalid');
  const job = parseJob(envelope.job);
  if (job.capability !== expectedCapability) reject('node job response belongs to another capability');
  if (expectedNodeId !== undefined && job.nodeId !== expectedNodeId) reject('node job response belongs to another node');
  if (expectedJobId !== undefined && job.jobId !== expectedJobId) reject('node job response belongs to another job');
  return { ok: true, job };
}

export function parseLatestCoreStatusJob(value, expectedNodeId) {
  const envelope = objectOf(value, 'saved core status response');
  exactKeys(envelope, ['ok', 'job'], 'saved core status response');
  if (envelope.ok !== true) reject('saved core status response is invalid');
  if (envelope.job === null) return { ok: true, job: null };
  return parseNodeJob(envelope, expectedNodeId, undefined, NODE_CORE_STATUS_CAPABILITY);
}

export function parseNodeJobEnqueue(value, expectedNodeId, expectedRequestId, expectedCapability = NODE_ENSURE_RUNNING_CAPABILITY) {
  const envelope = objectOf(value, 'node job enqueue response');
  exactKeys(envelope, ['ok', 'status', 'job'], 'node job enqueue response');
  if (envelope.ok !== true) reject('node job enqueue response is invalid');
  const status = enumValue(envelope.status, 'node job enqueue status', ENQUEUE_STATES);
  const job = parseJob(envelope.job);
  if (job.capability !== expectedCapability) reject('node job response belongs to another capability');
  if (job.nodeId !== expectedNodeId) reject('node job enqueue response belongs to another node');
  if (status !== 'coalesced' && job.jobId !== expectedRequestId) {
    reject('node job enqueue response does not match its request');
  }
  if (status === 'coalesced' && job.jobId === expectedRequestId) {
    reject('coalesced node job response did not identify the active job');
  }
  return { ok: true, status, job };
}

export function parseNodePairing(value) {
  const envelope = objectOf(value, 'node pairing response');
  exactKeys(envelope, ['ok', 'pairingId', 'pairingCredential', 'expiresAt'], 'node pairing response');
  if (envelope.ok !== true) reject('node pairing response is invalid');
  const pairingId = uuid(envelope.pairingId, 'pairing ID');
  const credential = boundedText(envelope.pairingCredential, 'pairing credential', 128);
  const match = /^mnp1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(credential);
  if (!match || !UUID.test(match[1]) || !BASE64URL_256.test(match[2]) || match[1] !== pairingId) {
    reject('pairing credential is invalid or does not match its response');
  }
  return { ok: true, pairingId, pairingCredential: credential, expiresAt: timestamp(envelope.expiresAt, 'pairing expiry') };
}

export function parseNodeApiError(value) {
  const envelope = objectOf(value, 'node error response');
  exactKeys(envelope, ['ok', 'error'], 'node error response');
  const error = objectOf(envelope.error, 'node error');
  exactKeys(error, ['code', 'message'], 'node error');
  if (envelope.ok !== false) reject('node error response is invalid');
  return {
    ok: false,
    error: {
      code: boundedText(error.code, 'node error code', 64, API_CODE),
      message: boundedText(error.message, 'node error message', 256),
    },
  };
}

export function isTerminalNodeJob(job) {
  return !!job && TERMINAL_JOB_STATES.has(job.state);
}

export function isLocalNodeControlOrigin(origin) {
  return typeof origin === 'string' && LOCAL_NODE_CONTROL_ORIGINS.has(origin);
}

export function buildLocalNodePairingHandoffUrl(pairingCredential) {
  const parsed = parseNodePairing({
    ok: true,
    pairingId: /^mnp1\.([0-9a-f-]{36})\./.exec(pairingCredential)?.[1],
    pairingCredential,
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
  const url = new URL(LOCAL_NODE_PAIRING_PATH, LOCAL_NODE_PAIRING_ORIGIN);
  url.hash = `pairing=${encodeURIComponent(parsed.pairingCredential)}`;
  if (url.search || url.username || url.password || url.origin !== LOCAL_NODE_PAIRING_ORIGIN
    || url.pathname !== LOCAL_NODE_PAIRING_PATH) {
    reject('local pairing handoff URL is invalid');
  }
  return url.toString();
}
