import {NATIVE_REUSE_CAPABILITY, validateNativeCommandInput, validateNativeTaskResult} from './native-task.mjs';
import crypto from 'node:crypto';

import { MASTERMIND_NODE_CAPABILITY_REGISTRY } from './capabilities.v1.mjs';

export { MASTERMIND_NODE_CAPABILITY_REGISTRY };

export const MASTERMIND_NODE_SCHEMA_VERSION = 1;
export const MASTERMIND_NODE_EXCHANGE_MAX_BYTES = 64 * 1024;
export const MASTERMIND_NODE_STATUS_MAX_BYTES = 8 * 1024;
export const MASTERMIND_NODE_RECEIPT_MAX_BYTES = 2 * 1024;
export const MASTERMIND_NODE_RESPONSE_MAX_BYTES = 32 * 1024;
export const MASTERMIND_NODE_MAX_RECEIPTS = 32;
export const MASTERMIND_NODE_MAX_ATTENTION_CODES = 16;
export const MASTERMIND_NODE_CAPABILITY = 'family-ecosystem.ensure-running';
export const MASTERMIND_CORE_STATUS_CAPABILITY = 'mastermind.core.status';
export const MASTERMIND_NODE_POLICY_CLASS = 'routine';

export const MASTERMIND_NODE_STATUS_ENUMS = Object.freeze({
  controlAgent: Object.freeze(['online', 'unreachable']),
  recovery: Object.freeze(['clear', 'manual-repair-required', 'unknown']),
  familyServer: Object.freeze(['unknown', 'missing', 'stopped', 'starting', 'running', 'stopping', 'failed']),
  companion: Object.freeze([
    'unknown', 'not-installed', 'sign-in-required', 'stopped', 'starting', 'running', 'stopping', 'failed', 'orphaned',
  ]),
  companionBridge: Object.freeze(['unknown', 'disconnected', 'handshaking', 'syncing', 'ready']),
});

export const MASTERMIND_NODE_ATTENTION_CODES = Object.freeze([
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

export const MASTERMIND_NODE_RECEIPT_STAGES = Object.freeze([
  'journaled',
  'checking-local-state',
  'starting-family-server',
  'waiting-family-server',
  'starting-companion',
  'waiting-companion',
  'desired-state-reached',
  'terminal',
]);

export const MASTERMIND_NODE_FAILURE_CODES = Object.freeze([
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
const BASE64URL_256 = /^[A-Za-z0-9_-]{43}$/;
const DISPLAY_NAME_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const ATTENTION_CODES = new Set(MASTERMIND_NODE_ATTENTION_CODES);
const FAILURE_CODES = new Set(MASTERMIND_NODE_FAILURE_CODES);
const RECEIPT_STAGES = new Set(MASTERMIND_NODE_RECEIPT_STAGES);
const CONTROL_AGENT_STATES = new Set(MASTERMIND_NODE_STATUS_ENUMS.controlAgent);
const RECOVERY_STATES = new Set(MASTERMIND_NODE_STATUS_ENUMS.recovery);
const FAMILY_SERVER_STATES = new Set(MASTERMIND_NODE_STATUS_ENUMS.familyServer);
const COMPANION_STATES = new Set(MASTERMIND_NODE_STATUS_ENUMS.companion);
const COMPANION_BRIDGE_STATES = new Set(MASTERMIND_NODE_STATUS_ENUMS.companionBridge);
const RECEIPT_STATES = new Set(['accepted', 'running', 'succeeded', 'failed']);
const RUNNING_STAGES = new Set([
  'checking-local-state',
  'starting-family-server',
  'waiting-family-server',
  'starting-companion',
  'waiting-companion',
]);

export class MastermindNodeContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MastermindNodeContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MastermindNodeContractError(code, message);
}

function exactObject(value, label, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('NODE_INVALID', `${label} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('NODE_UNKNOWN_FIELD', `${label} contains unsupported field '${key}'`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('NODE_MISSING_FIELD', `${label} omitted required field '${key}'`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  return exactObject(value, label, expected);
}

function boundedString(value, label, { min = 1, max = 128, pattern, controls = true } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail('NODE_INVALID', `${label} is invalid`);
  }
  if (controls && DISPLAY_NAME_CONTROL.test(value)) fail('NODE_INVALID', `${label} contains unsupported characters`);
  if (pattern && !pattern.test(value)) fail('NODE_INVALID', `${label} has an invalid format`);
  return value;
}

function uuid(value, label) {
  return boundedString(value, label, { min: 36, max: 36, pattern: UUID });
}

function sha256(value, label) {
  return boundedString(value, label, { min: 64, max: 64, pattern: SHA256 });
}

function canonicalTimestamp(value, label) {
  boundedString(value, label, { min: 24, max: 24 });
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('NODE_INVALID', `${label} must be a canonical millisecond UTC timestamp`);
  }
  return value;
}

function safeInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('NODE_INVALID', `${label} is outside its allowed range`);
  }
  return value;
}

function enumValue(value, label, allowed) {
  if (typeof value !== 'string' || !allowed.has(value)) fail('NODE_INVALID', `${label} is unsupported`);
  return value;
}

function emptyInput(value, label = 'command input') {
  exactKeys(value, [], label);
  return {};
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function boundedCanonical(value, maximum, label) {
  let encoded;
  try { encoded = canonical(value); }
  catch { fail('NODE_INVALID', `${label} cannot be serialized`); }
  if (Buffer.byteLength(encoded, 'utf8') > maximum) fail('NODE_TOO_LARGE', `${label} exceeds its encoded size limit`);
  return encoded;
}

function uniqueStrings(values, label, maximum, validator) {
  if (!Array.isArray(values) || values.length > maximum) fail('NODE_INVALID', `${label} is invalid`);
  const seen = new Set();
  return values.map((value, index) => {
    validator(value, `${label}[${index}]`);
    if (seen.has(value)) fail('NODE_INVALID', `${label} contains a duplicate value`);
    seen.add(value);
    return value;
  });
}

export function validateMastermindNodeCapabilityRegistry(value) {
  exactKeys(value, ['schemaVersion', 'registryId', 'capabilities'], 'capability registry');
  if (value.schemaVersion !== 1 || value.registryId !== 'mastermind.node' || !Array.isArray(value.capabilities)
    || value.capabilities.length !== 2) {
    fail('NODE_INVALID', 'capability registry identity is invalid');
  }
  const expected = MASTERMIND_NODE_CAPABILITY_REGISTRY.capabilities;
  for (let index = 0; index < expected.length; index += 1) {
    const capability = value.capabilities[index];
    exactKeys(capability, ['id', 'version', 'kind', 'policyClass', 'hardGate', 'inputSchema'], `capabilities[${index}]`);
    const expectedCapability = expected[index];
    if (capability.id !== expectedCapability.id || capability.version !== 1 || capability.kind !== expectedCapability.kind
      || capability.policyClass !== 'routine' || capability.hardGate !== false) {
      fail('NODE_INVALID', `capabilities[${index}] does not match the frozen v1 registry`);
    }
    exactKeys(capability.inputSchema, ['type', 'additionalProperties', 'maxProperties'], `capabilities[${index}].inputSchema`);
    if (capability.inputSchema.type !== 'object' || capability.inputSchema.additionalProperties !== false
      || capability.inputSchema.maxProperties !== 0) {
      fail('NODE_INVALID', `capabilities[${index}] input schema must accept only an empty object`);
    }
  }
  return structuredClone(value);
}

export function validateMastermindNodeCommand(value, options = {}) {
  exactKeys(value, ['jobId', 'nodeId', 'capability', 'capabilityVersion', 'policyClass', 'input'], 'node command');
  uuid(value.jobId, 'jobId');
  uuid(value.nodeId, 'nodeId');
  if ((value.capability !== MASTERMIND_NODE_CAPABILITY
      && !(options.core === true && [MASTERMIND_CORE_STATUS_CAPABILITY, NATIVE_REUSE_CAPABILITY].includes(value.capability))) || value.capabilityVersion !== 1
    || value.policyClass !== MASTERMIND_NODE_POLICY_CLASS) {
    fail('NODE_UNSUPPORTED_CAPABILITY', 'node command capability is unsupported');
  }
  if (value.capability === NATIVE_REUSE_CAPABILITY) {
    try { validateNativeCommandInput(value.input); } catch { fail('NODE_INVALID','native request is invalid'); }
    if(value.input.operationId !== value.jobId) fail('NODE_SCOPE_MISMATCH','native operation must match its job');
  } else emptyInput(value.input);
  return structuredClone(value);
}

export function canonicalMastermindNodeCommand(value, options = {}) {
  return canonical(validateMastermindNodeCommand(value, options));
}

export function digestMastermindNodeCommand(value, options = {}) {
  return crypto.createHash('sha256').update(canonicalMastermindNodeCommand(value, options), 'utf8').digest('hex');
}

export function validateMastermindCoreStatus(value) {
  exactKeys(value, ['kind', 'observedAt', 'services', 'capabilities', 'activeTurns', 'complete'], 'core status');
  if (value.kind !== MASTERMIND_CORE_STATUS_CAPABILITY) fail('NODE_INVALID', 'core status kind is invalid');
  canonicalTimestamp(value.observedAt, 'core observedAt');
  exactKeys(value.services, ['mcpHost', 'memory', 'modules'], 'core services');
  const states = new Set(['online', 'degraded', 'unreachable', 'invalid']);
  for (const [key, state] of Object.entries(value.services)) enumValue(state, key, states);
  exactKeys(value.capabilities, ['count', 'sha256'], 'core capabilities');
  if (value.capabilities.count !== null) safeInteger(value.capabilities.count, 'capability count', 0, 512);
  if (value.capabilities.sha256 !== null) sha256(value.capabilities.sha256, 'capability digest');
  if ((value.capabilities.count === null) !== (value.capabilities.sha256 === null)) fail('NODE_INVALID', 'capability evidence is incomplete');
  if (value.activeTurns !== null) safeInteger(value.activeTurns, 'active turns', 0, 65535);
  const complete = Object.values(value.services).every((state) => state === 'online')
    && value.capabilities.count !== null && value.activeTurns !== null;
  if (value.complete !== complete) fail('NODE_INVALID', 'core completeness disagrees with observed evidence');
  boundedCanonical(value, 1024, 'core status');
  return structuredClone(value);
}

export function validateMastermindNodeWorker(value) {
  exactKeys(value, ['protocolVersion', 'capabilities'], 'worker negotiation');
  if (value.protocolVersion !== 2 || !Array.isArray(value.capabilities)
    || value.capabilities.length < 1 || value.capabilities.length > 3) fail('NODE_UNSUPPORTED_VERSION', 'worker negotiation is unsupported');
  const seen = new Set();
  for (const item of value.capabilities) {
    exactKeys(item, ['id', 'version'], 'worker capability');
    if (![MASTERMIND_NODE_CAPABILITY, MASTERMIND_CORE_STATUS_CAPABILITY, NATIVE_REUSE_CAPABILITY].includes(item.id)
      || item.version !== 1 || seen.has(item.id)) fail('NODE_UNSUPPORTED_CAPABILITY', 'worker capability/version is unsupported');
    seen.add(item.id);
  }
  return { protocolVersion: 2, capabilities: structuredClone(value.capabilities).sort((a, b) => a.id.localeCompare(b.id)) };
}

function validateTerminalResult(value, label = 'terminal result') {
  exactKeys(value, ['familyServer', 'companion', 'companionBridge'], label);
  enumValue(value.familyServer, `${label}.familyServer`, FAMILY_SERVER_STATES);
  enumValue(value.companion, `${label}.companion`, COMPANION_STATES);
  enumValue(value.companionBridge, `${label}.companionBridge`, COMPANION_BRIDGE_STATES);
  return structuredClone(value);
}

export function validateMastermindNodeStatus(value) {
  exactKeys(value, [
    'observedAt', 'controlAgent', 'recovery', 'familyServer', 'companion', 'companionBridge',
    'localKillSwitch', 'attentionCodes',
  ], 'node status');
  canonicalTimestamp(value.observedAt, 'status observedAt');
  enumValue(value.controlAgent, 'controlAgent', CONTROL_AGENT_STATES);
  enumValue(value.recovery, 'recovery', RECOVERY_STATES);
  enumValue(value.familyServer, 'familyServer', FAMILY_SERVER_STATES);
  enumValue(value.companion, 'companion', COMPANION_STATES);
  enumValue(value.companionBridge, 'companionBridge', COMPANION_BRIDGE_STATES);
  if (value.localKillSwitch !== null && typeof value.localKillSwitch !== 'boolean') {
    fail('NODE_INVALID', 'localKillSwitch must be a boolean or null');
  }
  uniqueStrings(value.attentionCodes, 'attentionCodes', MASTERMIND_NODE_MAX_ATTENTION_CODES, (item, label) => {
    if (typeof item !== 'string' || !ATTENTION_CODES.has(item)) fail('NODE_INVALID', `${label} is unsupported`);
  });
  const copy = structuredClone(value);
  boundedCanonical(copy, MASTERMIND_NODE_STATUS_MAX_BYTES, 'node status');
  return copy;
}

export function validateMastermindNodeReceipt(value, options = {}) {
  exactKeys(value, [
    'receiptId', 'jobId', 'leaseId', 'bootId', 'commandDigest', 'sequence', 'state', 'stage',
    'observedAt', 'code', 'retryable', 'result',
  ], 'job receipt');
  uuid(value.receiptId, 'receiptId');
  uuid(value.jobId, 'jobId');
  uuid(value.leaseId, 'leaseId');
  uuid(value.bootId, 'bootId');
  sha256(value.commandDigest, 'commandDigest');
  safeInteger(value.sequence, 'sequence', 1, 65_535);
  enumValue(value.state, 'receipt state', RECEIPT_STATES);
  enumValue(value.stage, 'receipt stage', RECEIPT_STAGES);
  canonicalTimestamp(value.observedAt, 'receipt observedAt');
  if (typeof value.retryable !== 'boolean') fail('NODE_INVALID', 'receipt retryable must be a boolean');

  if (value.state === 'accepted') {
    if (value.stage !== 'journaled' || value.code !== 'accepted' || value.retryable !== false || value.result !== null) {
      fail('NODE_INVALID', 'accepted receipt fields are inconsistent');
    }
  } else if (value.state === 'running') {
    if (!RUNNING_STAGES.has(value.stage) || value.code !== 'in-progress' || value.retryable !== false || value.result !== null) {
      fail('NODE_INVALID', 'running receipt fields are inconsistent');
    }
  } else if (value.state === 'succeeded') {
    if (value.stage !== 'desired-state-reached' || value.code !== 'desired-state-reached'
      || value.retryable !== false || value.result === null) {
      fail('NODE_INVALID', 'succeeded receipt fields are inconsistent');
    }
    if (options.core === true && value.result.kind === MASTERMIND_CORE_STATUS_CAPABILITY) {
      validateMastermindCoreStatus(value.result);
    } else if (options.core === true && value.result.kind === NATIVE_REUSE_CAPABILITY) {
      try { validateNativeTaskResult(value.result); } catch { fail('NODE_INVALID','native result is invalid'); }
      if(value.result.operationId !== value.jobId) fail('NODE_SCOPE_MISMATCH','native result must match its job');
    } else {
    validateTerminalResult(value.result);
    if (value.result.familyServer !== 'running' || value.result.companion !== 'running'
      || value.result.companionBridge !== 'ready') {
      fail('NODE_INVALID', 'successful ensure-running result did not reach its desired state');
    }
    }
  } else {
    if (value.stage !== 'terminal' || typeof value.code !== 'string' || !FAILURE_CODES.has(value.code)) {
      fail('NODE_INVALID', 'failed receipt fields are inconsistent');
    }
    if (value.result !== null) validateTerminalResult(value.result);
  }

  const copy = structuredClone(value);
  boundedCanonical(copy, MASTERMIND_NODE_RECEIPT_MAX_BYTES, 'job receipt');
  return copy;
}

export function canonicalMastermindNodeReceipt(value, options = {}) {
  return canonical(validateMastermindNodeReceipt(value, options));
}

export function digestMastermindNodeReceipt(value, options = {}) {
  return crypto.createHash('sha256').update(canonicalMastermindNodeReceipt(value, options), 'utf8').digest('hex');
}

export function validateMastermindNodeLease(value, options = {}) {
  exactKeys(value, [
    'jobId', 'nodeId', 'commandDigest', 'capability', 'capabilityVersion', 'policyClass', 'input',
    'createdAt', 'expiresAt', 'leaseId', 'leasedAt', 'leaseExpiresAt',
  ], 'job lease');
  const command = validateMastermindNodeCommand({
    jobId: value.jobId,
    nodeId: value.nodeId,
    capability: value.capability,
    capabilityVersion: value.capabilityVersion,
    policyClass: value.policyClass,
    input: value.input,
  }, options);
  sha256(value.commandDigest, 'commandDigest');
  if (digestMastermindNodeCommand(command, options) !== value.commandDigest) {
    fail('NODE_DIGEST_MISMATCH', 'job lease commandDigest does not match its command');
  }
  uuid(value.leaseId, 'leaseId');
  canonicalTimestamp(value.createdAt, 'createdAt');
  canonicalTimestamp(value.expiresAt, 'expiresAt');
  canonicalTimestamp(value.leasedAt, 'leasedAt');
  canonicalTimestamp(value.leaseExpiresAt, 'leaseExpiresAt');
  const createdAt = Date.parse(value.createdAt);
  const expiresAt = Date.parse(value.expiresAt);
  const leasedAt = Date.parse(value.leasedAt);
  const leaseExpiresAt = Date.parse(value.leaseExpiresAt);
  if (expiresAt <= createdAt || leasedAt < createdAt || leasedAt >= expiresAt
    || leaseExpiresAt <= leasedAt || leaseExpiresAt > expiresAt) {
    fail('NODE_INVALID', 'job lease timestamps are inconsistent');
  }
  return structuredClone(value);
}

export function validateMastermindNodeExchangeRequest(value, options = {}) {
  exactKeys(value, [
    'schemaVersion', 'exchangeId', 'nodeId', 'bootId', 'sentAt', 'agentVersion', 'status', 'receipts', ...(options.core === true ? ['worker'] : []),
  ], 'node exchange request');
  if (value.schemaVersion !== (options.core === true ? 2 : 1)) fail('NODE_UNSUPPORTED_VERSION', 'schemaVersion is unsupported');
  if (options.core === true) validateMastermindNodeWorker(value.worker);
  uuid(value.exchangeId, 'exchangeId');
  uuid(value.nodeId, 'nodeId');
  uuid(value.bootId, 'bootId');
  canonicalTimestamp(value.sentAt, 'sentAt');
  boundedString(value.agentVersion, 'agentVersion', { min: 1, max: 32, pattern: VERSION });
  validateMastermindNodeStatus(value.status);
  if (!Array.isArray(value.receipts) || value.receipts.length > MASTERMIND_NODE_MAX_RECEIPTS) {
    fail('NODE_INVALID', 'receipts must be a bounded array');
  }
  const receiptIds = new Set();
  const lastSequenceByJob = new Map();
  for (const receipt of value.receipts) {
    validateMastermindNodeReceipt(receipt, options);
    if (receipt.result?.kind === MASTERMIND_CORE_STATUS_CAPABILITY
      && !value.worker?.capabilities.some((item) => item.id === MASTERMIND_CORE_STATUS_CAPABILITY && item.version === 1)) {
      fail('NODE_UNSUPPORTED_CAPABILITY', 'core receipt requires the worker capability declaration');
    }
    if(receipt.result?.kind === NATIVE_REUSE_CAPABILITY && !value.worker?.capabilities.some(item=>item.id===NATIVE_REUSE_CAPABILITY&&item.version===1)) fail('NODE_UNSUPPORTED_CAPABILITY','native result requires negotiation');
    if (receiptIds.has(receipt.receiptId)) fail('NODE_INVALID', 'exchange contains a duplicate receiptId');
    receiptIds.add(receipt.receiptId);
    const priorSequence = lastSequenceByJob.get(receipt.jobId);
    if (priorSequence !== undefined && receipt.sequence <= priorSequence) {
      fail('NODE_INVALID', 'job receipt sequences must increase strictly within the exchange');
    }
    lastSequenceByJob.set(receipt.jobId, receipt.sequence);
  }
  const copy = structuredClone(value);
  boundedCanonical(copy, MASTERMIND_NODE_EXCHANGE_MAX_BYTES, 'node exchange request');
  return copy;
}

export function canonicalMastermindNodeExchangeRequest(value, options = {}) {
  return canonical(validateMastermindNodeExchangeRequest(value, options));
}

export function validateMastermindNodeExchangeResponse(value, options = {}) {
  exactKeys(value, [
    'schemaVersion', 'exchangeId', 'serverTime', 'nextPollAfterMs', 'acknowledgedReceiptIds', 'lease', ...(options.core === true ? ['acceptedWorker'] : []),
  ], 'node exchange response');
  if (value.schemaVersion !== (options.core === true ? 2 : 1)) fail('NODE_UNSUPPORTED_VERSION', 'schemaVersion is unsupported');
  if (options.core === true) {
    const accepted = validateMastermindNodeWorker(value.acceptedWorker);
    const expected = validateMastermindNodeWorker(options.expectedWorker);
    if (canonical(accepted) !== canonical(expected)) fail('NODE_SCOPE_MISMATCH', 'server negotiation differs from the worker declaration');
  }
  uuid(value.exchangeId, 'exchangeId');
  if (options.expectedExchangeId !== undefined && value.exchangeId !== options.expectedExchangeId) {
    fail('NODE_SCOPE_MISMATCH', 'exchange response ID does not match its request');
  }
  canonicalTimestamp(value.serverTime, 'serverTime');
  safeInteger(value.nextPollAfterMs, 'nextPollAfterMs', 1_000, 30_000);
  const acknowledgedReceiptIds = uniqueStrings(
    value.acknowledgedReceiptIds,
    'acknowledgedReceiptIds',
    MASTERMIND_NODE_MAX_RECEIPTS,
    uuid,
  );
  let expectedReceiptIds = null;
  if (options.expectedReceiptIds !== undefined) {
    expectedReceiptIds = new Set(uniqueStrings(
      options.expectedReceiptIds,
      'expectedReceiptIds',
      MASTERMIND_NODE_MAX_RECEIPTS,
      uuid,
    ));
  } else if (acknowledgedReceiptIds.length > 0) {
    fail('NODE_EXPECTATION_REQUIRED', 'submitted receipt IDs are required to validate acknowledgements');
  }
  if (expectedReceiptIds && acknowledgedReceiptIds.some((receiptId) => !expectedReceiptIds.has(receiptId))) {
    fail('NODE_SCOPE_MISMATCH', 'exchange response acknowledged a receipt that was not submitted');
  }
  if (value.lease !== null) {
    validateMastermindNodeLease(value.lease, options);
    if (options.core === true && !value.acceptedWorker.capabilities.some((item) => item.id === value.lease.capability
      && item.version === value.lease.capabilityVersion)) fail('NODE_UNSUPPORTED_CAPABILITY', 'lease was not negotiated for this worker');
    if (options.expectedNodeId !== undefined && value.lease.nodeId !== options.expectedNodeId) {
      fail('NODE_SCOPE_MISMATCH', 'leased job belongs to another node');
    }
    if (Date.parse(value.lease.leaseExpiresAt) <= Date.parse(value.serverTime)) {
      fail('NODE_INVALID', 'exchange response contains an already-expired lease');
    }
  }
  const copy = structuredClone(value);
  boundedCanonical(copy, MASTERMIND_NODE_RESPONSE_MAX_BYTES, 'node exchange response');
  return copy;
}

export function canonicalMastermindNodeExchangeResponse(value, options = {}) {
  return canonical(validateMastermindNodeExchangeResponse(value, options));
}

export function validateMastermindNodePairRequest(value) {
  exactKeys(value, ['schemaVersion', 'pairingId', 'node'], 'node pair request');
  if (value.schemaVersion !== MASTERMIND_NODE_SCHEMA_VERSION) fail('NODE_UNSUPPORTED_VERSION', 'schemaVersion is unsupported');
  uuid(value.pairingId, 'pairingId');
  exactKeys(value.node, ['nodeId', 'credentialSha256', 'displayName', 'agentVersion'], 'pairing node');
  uuid(value.node.nodeId, 'pairing nodeId');
  sha256(value.node.credentialSha256, 'pairing credentialSha256');
  boundedString(value.node.displayName, 'displayName', { min: 1, max: 64 });
  if (value.node.displayName.trim() !== value.node.displayName) fail('NODE_INVALID', 'displayName must not have outer whitespace');
  boundedString(value.node.agentVersion, 'agentVersion', { min: 1, max: 32, pattern: VERSION });
  return structuredClone(value);
}

export function canonicalMastermindNodePairRequest(value) {
  return canonical(validateMastermindNodePairRequest(value));
}

export function validateMastermindNodePairResponse(value, options = {}) {
  exactKeys(value, ['schemaVersion', 'nodeId', 'pairedAt', 'nextPollAfterMs'], 'node pair response');
  if (value.schemaVersion !== MASTERMIND_NODE_SCHEMA_VERSION) fail('NODE_UNSUPPORTED_VERSION', 'schemaVersion is unsupported');
  uuid(value.nodeId, 'nodeId');
  if (options.expectedNodeId !== undefined && value.nodeId !== options.expectedNodeId) {
    fail('NODE_SCOPE_MISMATCH', 'pair response belongs to another node');
  }
  canonicalTimestamp(value.pairedAt, 'pairedAt');
  safeInteger(value.nextPollAfterMs, 'nextPollAfterMs', 1_000, 30_000);
  return structuredClone(value);
}

export function canonicalMastermindNodePairResponse(value, options = {}) {
  return canonical(validateMastermindNodePairResponse(value, options));
}

function parseCredential(value, prefix, label) {
  boundedString(value, label, { min: 1, max: 128, controls: false });
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== prefix || !UUID.test(parts[1]) || !BASE64URL_256.test(parts[2])) {
    fail('NODE_INVALID_CREDENTIAL', `${label} is invalid`);
  }
  return { nodeId: parts[1], secret: parts[2] };
}

export function parseMastermindNodeCredential(value) {
  return parseCredential(value, 'mn1', 'node credential');
}

export function digestMastermindNodeCredential(value) {
  parseMastermindNodeCredential(value);
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function parseMastermindNodePairingCredential(value) {
  const parsed = parseCredential(value, 'mnp1', 'pairing credential');
  return { pairingId: parsed.nodeId, secret: parsed.secret };
}
