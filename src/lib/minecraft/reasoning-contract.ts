const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOOL_ID = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/;
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
const KINDS = new Set(['classify', 'converse', 'plan', 'extract-profile', 'diagnose', 'inspect-image']);
const ACTORS = new Set(['COMPUTER', 'COMPANION']);

export const FAMILY_REASONING_MAX_BYTES = 64 * 1024;

export type FamilyReasoningRequest = Readonly<{
  requestId: string;
  kind: 'classify' | 'converse' | 'plan' | 'extract-profile' | 'diagnose' | 'inspect-image';
  actor: 'COMPUTER' | 'COMPANION';
  playerId: string | null;
  input: unknown;
  authorizedTools: readonly string[];
  deadlineAt: string;
}>;

export class FamilyReasoningContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FamilyReasoningContractError';
    this.code = code;
  }
}

function reject(code: string, message: string): never {
  throw new FamilyReasoningContractError(code, message);
}

function boundedJson(value: unknown, label: string, depth = 0, budget = { nodes: 0 }): unknown {
  budget.nodes += 1;
  if (budget.nodes > 512 || depth > 6) reject('REASONING_INPUT_TOO_COMPLEX', `${label} is too complex.`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject('REASONING_REQUEST_INVALID', `${label} contains an invalid number.`);
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 2_048 || UNSAFE_TEXT.test(value)) reject('REASONING_REQUEST_INVALID', `${label} contains invalid text.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 64) reject('REASONING_INPUT_TOO_COMPLEX', `${label} is too large.`);
    return value.map((item, index) => boundedJson(item, `${label}[${index}]`, depth + 1, budget));
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    reject('REASONING_REQUEST_INVALID', `${label} must contain JSON values only.`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 64) reject('REASONING_INPUT_TOO_COMPLEX', `${label} has too many fields.`);
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) reject('REASONING_REQUEST_INVALID', `${label} contains an invalid field name.`);
    result[key] = boundedJson(item, `${label}.${key}`, depth + 1, budget);
  }
  return result;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length !== 24 || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) reject('REASONING_REQUEST_INVALID', `${label} must be a canonical UTC timestamp.`);
  return value;
}

export function validateFamilyReasoningRequest(value: unknown): FamilyReasoningRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    reject('REASONING_REQUEST_INVALID', 'The reasoning request must be a JSON object.');
  }
  const record = value as Record<string, unknown>;
  const keys = ['requestId', 'kind', 'actor', 'playerId', 'input', 'authorizedTools', 'deadlineAt'];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) {
    reject('REASONING_REQUEST_INVALID', 'The reasoning request fields are invalid.');
  }
  const requestId = typeof record.requestId === 'string' && UUID.test(record.requestId) ? record.requestId : null;
  const kind = typeof record.kind === 'string' && KINDS.has(record.kind) ? record.kind : null;
  const actor = typeof record.actor === 'string' && ACTORS.has(record.actor) ? record.actor : null;
  const playerId = record.playerId === null
    ? null
    : typeof record.playerId === 'string' && UUID.test(record.playerId) ? record.playerId : undefined;
  if (!requestId || !kind || !actor || playerId === undefined) reject('REASONING_REQUEST_INVALID', 'The reasoning request identity or type is invalid.');
  if (!Array.isArray(record.authorizedTools) || record.authorizedTools.length > 32
    || record.authorizedTools.some((tool) => typeof tool !== 'string' || !TOOL_ID.test(tool))) {
    reject('REASONING_REQUEST_INVALID', 'The authorized tool list is invalid.');
  }
  const authorizedTools = record.authorizedTools as string[];
  if (new Set(authorizedTools).size !== authorizedTools.length) reject('REASONING_REQUEST_INVALID', 'The authorized tool list contains duplicates.');
  const deadlineAt = canonicalTimestamp(record.deadlineAt, 'deadlineAt');
  if (Date.parse(deadlineAt) <= Date.now() || Date.parse(deadlineAt) > Date.now() + 5 * 60_000) {
    reject('REASONING_DEADLINE_INVALID', 'The reasoning deadline must be within the next five minutes.');
  }
  return {
    requestId,
    kind: kind as FamilyReasoningRequest['kind'],
    actor: actor as FamilyReasoningRequest['actor'],
    playerId,
    input: boundedJson(record.input, 'input'),
    authorizedTools: [...authorizedTools],
    deadlineAt,
  };
}
