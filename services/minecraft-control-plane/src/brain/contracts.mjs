import crypto from 'node:crypto';

export const BRAIN_ACTORS = Object.freeze(['COMPUTER', 'COMPANION']);
export const PLAYER_ROLES = Object.freeze(['parent', 'child', 'guest', 'service']);
export const BEHAVIOR_MODES = Object.freeze([
  'disabled', 'stay_alive', 'home_steward', 'assist', 'follow_adventure', 'independent', 'custom',
]);
export const FEATURE_STATES = Object.freeze(['planned', 'stubbed', 'implemented', 'live-verified']);
export const PROFILE_DEPTHS = Object.freeze(['none', 'companion', 'deep']);
export const PROFILE_CLAIM_STATUSES = Object.freeze(['observed', 'inferred', 'confirmed', 'disputed', 'forgotten']);
export const TASK_STATUSES = Object.freeze(['queued', 'planning', 'running', 'paused', 'blocked', 'done', 'failed', 'cancelled']);
export const SKILL_AVAILABILITY = Object.freeze(['planned', 'stubbed', 'implemented', 'live-verified', 'disabled']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,127})$/;
const SKILL_ID = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/;
const REGISTRY_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

export class BrainContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrainContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new BrainContractError(code, message);
}

function plainObject(value, label, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail('INVALID_CONTRACT', `${label} must be a plain object`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${label} contains unsupported field '${key}'`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail('MISSING_FIELD', `${label} omitted '${key}'`);
  return value;
}

function boundedString(value, label, { min = 1, max = 256, pattern, values, allowNull = false } = {}) {
  if (allowNull && value === null) return null;
  if (typeof value !== 'string' || value.length < min || value.length > max || UNSAFE_TEXT.test(value)) {
    fail('INVALID_CONTRACT', `${label} is invalid`);
  }
  if (pattern && !pattern.test(value)) fail('INVALID_CONTRACT', `${label} has an invalid format`);
  if (values && !values.includes(value)) fail('INVALID_CONTRACT', `${label} is unsupported`);
  return value;
}

function uuid(value, label, allowNull = false) {
  if (allowNull && value === null) return null;
  return boundedString(value, label, { min: 36, max: 36, pattern: UUID }).toLowerCase();
}

function timestamp(value, label) {
  boundedString(value, label, { min: 24, max: 24 });
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('INVALID_CONTRACT', `${label} must be a canonical millisecond UTC timestamp`);
  }
  return value;
}

function boundedNumber(value, label, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail('INVALID_CONTRACT', `${label} is outside its allowed range`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') fail('INVALID_CONTRACT', `${label} must be boolean`);
  return value;
}

function boundedArray(value, label, maximum, validator) {
  if (!Array.isArray(value) || value.length > maximum) fail('INVALID_CONTRACT', `${label} must be a bounded array`);
  return value.map((item, index) => validator(item, `${label}[${index}]`));
}

function jsonValue(value, label, depth = 0, budget = { count: 0 }) {
  budget.count += 1;
  if (budget.count > 512 || depth > 6) fail('INVALID_CONTRACT', `${label} is too complex`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return boundedString(value, label, { min: 0, max: 2_048 });
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_CONTRACT', `${label} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return boundedArray(value, label, 64, (item, itemLabel) => jsonValue(item, itemLabel, depth + 1, budget));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('INVALID_CONTRACT', `${label} contains a non-JSON value`);
  }
  const keys = Object.keys(value);
  if (keys.length > 64) fail('INVALID_CONTRACT', `${label} has too many fields`);
  const result = {};
  for (const key of keys) {
    boundedString(key, `${label} field`, { max: 64, pattern: /^[A-Za-z][A-Za-z0-9_]*$/ });
    result[key] = jsonValue(value[key], `${label}.${key}`, depth + 1, budget);
  }
  return result;
}

export function validatePlayerPrincipal(value) {
  const principal = plainObject(value, 'player principal', [
    'playerId', 'minecraftUuid', 'displayName', 'role', 'profileDepth', 'captureEnabled', 'codexReuseEnabled',
  ]);
  return {
    playerId: uuid(principal.playerId, 'playerId', true),
    minecraftUuid: uuid(principal.minecraftUuid, 'minecraftUuid'),
    displayName: boundedString(principal.displayName, 'displayName', { min: 1, max: 64 }),
    role: boundedString(principal.role, 'role', { values: PLAYER_ROLES }),
    profileDepth: boundedString(principal.profileDepth, 'profileDepth', { values: PROFILE_DEPTHS }),
    captureEnabled: boolean(principal.captureEnabled, 'captureEnabled'),
    codexReuseEnabled: boolean(principal.codexReuseEnabled, 'codexReuseEnabled'),
  };
}

export function validateConversationInput(value) {
  const input = plainObject(value, 'conversation input', [
    'messageId', 'occurredAt', 'minecraftUuid', 'displayName', 'channel', 'text', 'directedAt',
  ], ['replyToMessageId']);
  const directedAt = input.directedAt === null
    ? null
    : boundedString(input.directedAt, 'directedAt', { values: BRAIN_ACTORS });
  return {
    messageId: uuid(input.messageId, 'messageId'),
    occurredAt: timestamp(input.occurredAt, 'occurredAt'),
    minecraftUuid: uuid(input.minecraftUuid, 'minecraftUuid'),
    displayName: boundedString(input.displayName, 'displayName', { min: 1, max: 64 }),
    channel: boundedString(input.channel, 'channel', { values: ['public', 'private', 'computer-command'] }),
    text: boundedString(input.text, 'text', { min: 1, max: 512 }),
    directedAt,
    ...(Object.hasOwn(input, 'replyToMessageId') ? { replyToMessageId: uuid(input.replyToMessageId, 'replyToMessageId') } : {}),
  };
}

export function validateConversationResponseMarker(value) {
  const marker = plainObject(value, 'conversation response marker', [
    'messageId', 'occurredAt', 'minecraftUuid', 'actor',
  ]);
  return {
    messageId: uuid(marker.messageId, 'messageId'),
    occurredAt: timestamp(marker.occurredAt, 'occurredAt'),
    minecraftUuid: uuid(marker.minecraftUuid, 'minecraftUuid'),
    actor: boundedString(marker.actor, 'actor', { values: BRAIN_ACTORS }),
  };
}

function validateTaskStep(value, label) {
  const step = plainObject(value, label, ['stepId', 'skill', 'arguments'], ['requiresApproval']);
  return {
    stepId: boundedString(step.stepId, `${label}.stepId`, { pattern: SAFE_ID }),
    skill: boundedString(step.skill, `${label}.skill`, { max: 64, pattern: SKILL_ID }),
    arguments: jsonValue(step.arguments, `${label}.arguments`),
    ...(Object.hasOwn(step, 'requiresApproval') ? { requiresApproval: boolean(step.requiresApproval, `${label}.requiresApproval`) } : {}),
  };
}

export function validateTaskPlan(value) {
  const plan = plainObject(value, 'task plan', ['planId', 'goal', 'steps', 'createdAt', 'expiresAt']);
  const createdAt = timestamp(plan.createdAt, 'createdAt');
  const expiresAt = timestamp(plan.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) fail('INVALID_CONTRACT', 'task plan expiry must follow creation');
  return {
    planId: uuid(plan.planId, 'planId'),
    goal: boundedString(plan.goal, 'goal', { min: 1, max: 512 }),
    steps: boundedArray(plan.steps, 'steps', 32, validateTaskStep),
    createdAt,
    expiresAt,
  };
}

export function validateBehaviorMode(value) {
  const mode = plainObject(value, 'behavior mode', [
    'mode', 'allowedSkills', 'homeZoneId', 'resourceBudget', 'combatPolicy', 'modelEscalationEnabled',
  ], ['todoListId']);
  return {
    mode: boundedString(mode.mode, 'mode', { values: BEHAVIOR_MODES }),
    allowedSkills: boundedArray(mode.allowedSkills, 'allowedSkills', 64, (item, label) => boundedString(item, label, { max: 64, pattern: SKILL_ID })),
    homeZoneId: boundedString(mode.homeZoneId, 'homeZoneId', { max: 128, pattern: SAFE_ID, allowNull: true }),
    resourceBudget: boundedNumber(mode.resourceBudget, 'resourceBudget', 0, 1_000_000, true),
    combatPolicy: boundedString(mode.combatPolicy, 'combatPolicy', { values: ['avoid', 'defend', 'protect', 'engage'] }),
    modelEscalationEnabled: boolean(mode.modelEscalationEnabled, 'modelEscalationEnabled'),
    ...(Object.hasOwn(mode, 'todoListId') ? { todoListId: uuid(mode.todoListId, 'todoListId', true) } : {}),
  };
}

export function validateAuthorizationDecision(value) {
  const decision = plainObject(value, 'authorization decision', ['allowed', 'code', 'reason', 'requiresApproval']);
  return {
    allowed: boolean(decision.allowed, 'allowed'),
    code: boundedString(decision.code, 'code', { max: 64, pattern: /^[A-Z][A-Z0-9_]*$/ }),
    reason: boundedString(decision.reason, 'reason', { min: 1, max: 256 }),
    requiresApproval: boolean(decision.requiresApproval, 'requiresApproval'),
  };
}

export function validateSkillDefinition(value) {
  const skill = plainObject(value, 'skill definition', ['id', 'availability', 'cancellable', 'physical', 'roles']);
  return {
    id: boundedString(skill.id, 'skill id', { max: 64, pattern: SKILL_ID }),
    availability: boundedString(skill.availability, 'skill availability', { values: SKILL_AVAILABILITY }),
    cancellable: boolean(skill.cancellable, 'cancellable'),
    physical: boolean(skill.physical, 'physical'),
    roles: boundedArray(skill.roles, 'roles', PLAYER_ROLES.length, (item, label) => boundedString(item, label, { values: PLAYER_ROLES })),
  };
}

export function validateInteractionRecord(value) {
  const record = plainObject(value, 'interaction record', [
    'interactionId', 'occurredAt', 'playerId', 'actor', 'channel', 'direction', 'contentCiphertextRef', 'retention',
  ], ['taskId']);
  return {
    interactionId: uuid(record.interactionId, 'interactionId'),
    occurredAt: timestamp(record.occurredAt, 'occurredAt'),
    playerId: uuid(record.playerId, 'playerId'),
    actor: boundedString(record.actor, 'actor', { values: BRAIN_ACTORS }),
    channel: boundedString(record.channel, 'channel', { values: ['public', 'private', 'computer-command', 'system'] }),
    direction: boundedString(record.direction, 'direction', { values: ['inbound', 'outbound'] }),
    contentCiphertextRef: boundedString(record.contentCiphertextRef, 'contentCiphertextRef', { max: 180, pattern: SAFE_ID }),
    retention: boundedString(record.retention, 'retention', { values: ['until-deleted'] }),
    ...(Object.hasOwn(record, 'taskId') ? { taskId: uuid(record.taskId, 'taskId', true) } : {}),
  };
}

export function validateProfileClaim(value) {
  const claim = plainObject(value, 'profile claim', [
    'claimId', 'playerId', 'category', 'summary', 'status', 'confidence', 'evidenceInteractionIds', 'firstObservedAt', 'lastObservedAt',
  ], ['prediction']);
  const firstObservedAt = timestamp(claim.firstObservedAt, 'firstObservedAt');
  const lastObservedAt = timestamp(claim.lastObservedAt, 'lastObservedAt');
  if (Date.parse(lastObservedAt) < Date.parse(firstObservedAt)) fail('INVALID_CONTRACT', 'claim observation order is invalid');
  return {
    claimId: uuid(claim.claimId, 'claimId'),
    playerId: uuid(claim.playerId, 'playerId'),
    category: boundedString(claim.category, 'category', { max: 64, pattern: SAFE_ID }),
    summary: boundedString(claim.summary, 'summary', { min: 1, max: 1_024 }),
    status: boundedString(claim.status, 'status', { values: PROFILE_CLAIM_STATUSES }),
    confidence: boundedNumber(claim.confidence, 'confidence', 0, 1),
    evidenceInteractionIds: boundedArray(claim.evidenceInteractionIds, 'evidenceInteractionIds', 64, uuid),
    firstObservedAt,
    lastObservedAt,
    ...(Object.hasOwn(claim, 'prediction') ? { prediction: boolean(claim.prediction, 'prediction') } : {}),
  };
}

export function validateReasoningRequest(value) {
  const request = plainObject(value, 'reasoning request', [
    'requestId', 'kind', 'actor', 'playerId', 'input', 'authorizedTools', 'deadlineAt',
  ]);
  return {
    requestId: uuid(request.requestId, 'requestId'),
    kind: boundedString(request.kind, 'kind', { values: ['classify', 'converse', 'plan', 'extract-profile', 'diagnose', 'inspect-image'] }),
    actor: boundedString(request.actor, 'actor', { values: BRAIN_ACTORS }),
    playerId: uuid(request.playerId, 'playerId', true),
    input: jsonValue(request.input, 'input'),
    authorizedTools: boundedArray(request.authorizedTools, 'authorizedTools', 32, (item, label) => boundedString(item, label, { max: 64, pattern: SKILL_ID })),
    deadlineAt: timestamp(request.deadlineAt, 'deadlineAt'),
  };
}

export function validateReasoningResult(value) {
  const result = plainObject(value, 'reasoning result', ['requestId', 'status', 'output', 'model', 'completedAt']);
  return {
    requestId: uuid(result.requestId, 'requestId'),
    status: boundedString(result.status, 'status', { values: ['succeeded', 'failed', 'cancelled'] }),
    output: jsonValue(result.output, 'output'),
    model: boundedString(result.model, 'model', { min: 1, max: 128 }),
    completedAt: timestamp(result.completedAt, 'completedAt'),
  };
}

export function validateComputerRequest(value) {
  const request = plainObject(value, 'computer request', [
    'requestId', 'playerId', 'kind', 'text', 'createdAt', 'status',
  ]);
  return {
    requestId: uuid(request.requestId, 'requestId'),
    playerId: uuid(request.playerId, 'playerId'),
    kind: boundedString(request.kind, 'kind', { values: ['help', 'status', 'server', 'world', 'mod', 'profile', 'approval'] }),
    text: boundedString(request.text, 'text', { min: 1, max: 512 }),
    createdAt: timestamp(request.createdAt, 'createdAt'),
    status: boundedString(request.status, 'status', { values: ['received', 'planned', 'awaiting-approval', 'executing', 'completed', 'rejected', 'failed'] }),
  };
}

export function validateApprovalPlan(value) {
  const plan = plainObject(value, 'approval plan', [
    'planId', 'requestId', 'digest', 'operation', 'createdAt', 'expiresAt', 'approvedByPlayerId',
  ]);
  const createdAt = timestamp(plan.createdAt, 'createdAt');
  const expiresAt = timestamp(plan.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) fail('INVALID_CONTRACT', 'approval expiry must follow creation');
  return {
    planId: uuid(plan.planId, 'planId'),
    requestId: uuid(plan.requestId, 'requestId'),
    digest: boundedString(plan.digest, 'digest', { min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ }),
    operation: boundedString(plan.operation, 'operation', { max: 64, pattern: SKILL_ID }),
    createdAt,
    expiresAt,
    approvedByPlayerId: uuid(plan.approvedByPlayerId, 'approvedByPlayerId', true),
  };
}

export function createDigestBoundApproval(input, options = {}) {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const expiresAt = options.expiresAt ?? new Date(Date.parse(createdAt) + 5 * 60_000).toISOString();
  const requestId = uuid(input.requestId, 'requestId');
  const operation = boundedString(input.operation, 'operation', { max: 64, pattern: SKILL_ID });
  const argumentsValue = jsonValue(input.arguments ?? {}, 'arguments');
  const canonical = JSON.stringify({ arguments: argumentsValue, operation, requestId });
  return validateApprovalPlan({
    planId: options.planId ?? crypto.randomUUID(),
    requestId,
    digest: crypto.createHash('sha256').update(canonical).digest('hex'),
    operation,
    createdAt,
    expiresAt,
    approvedByPlayerId: null,
  });
}

export function validateRegistryId(value, label = 'registry id') {
  return boundedString(value, label, { min: 3, max: 128, pattern: REGISTRY_ID });
}
