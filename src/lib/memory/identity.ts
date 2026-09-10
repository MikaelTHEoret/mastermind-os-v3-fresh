import crypto from 'node:crypto';

import {
  LocalServiceRequestAuthError,
  LocalServiceRequestBodyError,
  authorizeLocalServiceRequest,
  readBoundedJsonRequestBody,
  type LocalServiceAuthEnvironment,
} from './local-service-auth.ts';

const IDENTITY_PATH = '/api/memory/identity';
const MAX_COMMAND_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_LOCAL_SUBJECT = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const CLERK_SUBJECT = /^user_[A-Za-z0-9_-]{1,123}$/;
const MINECRAFT_PROFILE = /^[0-9a-f]{32}$/;
const MINECRAFT_NAME = /^[A-Za-z0-9_]{1,16}$/;
const WORLD_REF = /^world-[a-f0-9]{64}$/;
const ROLES = new Set(['parent', 'child', 'guest', 'service']);
const PURPOSES = new Set([
  'capture',
  'recall',
  'session_summary',
  'preference_learning',
  'family_share',
  'obsidian_export',
]);

type JsonObject = Record<string, unknown>;

export type MastermindIdentityAction =
  | 'household.bootstrap'
  | 'player.register'
  | 'identity.bind'
  | 'consent.set'
  | 'player.archive';

export type MastermindIdentityCommand = Readonly<{
  commandId: string;
  action: MastermindIdentityAction;
  householdId: string;
  actorPlayerId?: string;
  expectedRevision: number;
  payload: Readonly<JsonObject>;
}>;

export type PreparedMastermindIdentityCommand = Readonly<{
  command: MastermindIdentityCommand;
  canonicalJson: string;
  digest: string;
  parameters: Readonly<{
    actorPlayerId: string | null;
    subjectPlayerId: string;
    expectedRevision: number;
    householdDisplayName: string | null;
    playerDisplayName: string | null;
    role: string | null;
    provider: string | null;
    providerSubject: string | null;
    providerAlias: string | null;
    purpose: string | null;
    decision: string | null;
  }>;
}>;

export type MastermindIdentitySql = (
  strings: TemplateStringsArray,
  ...parameters: unknown[]
) => PromiseLike<unknown>;

export type MastermindIdentityCommitResult = Readonly<{
  status: 'applied' | 'duplicate' | 'conflict';
  commandId: string;
  householdRevision: number | null;
  playerRevision: number | null;
  playerId: string | null;
}>;

export class MastermindIdentityRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MastermindIdentityRequestError';
    this.status = status;
    this.code = code;
  }
}

function reject(status: number, code: string, message: string): never {
  throw new MastermindIdentityRequestError(status, code, message);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): JsonObject {
  if (!isObject(value)) reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))
  ) reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
  return value;
}

function requiredString(value: unknown, pattern: RegExp, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || !pattern.test(value)
    || /[\u0000-\u001f\u007f]/.test(value)
  ) reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
  return value;
}

function displayName(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 64
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
  return value;
}

function revision(value: unknown, minimum: 0 | 1): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
  }
  return Number(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function commonCommand(parsed: unknown): {
  command: JsonObject;
  action: MastermindIdentityAction;
  commandId: string;
  householdId: string;
} {
  const command = exactObject(
    parsed,
    ['commandId', 'action', 'householdId', 'expectedRevision', 'payload'],
    ['actorPlayerId'],
  );
  const commandId = requiredString(command.commandId, UUID, 36);
  const householdId = requiredString(command.householdId, SAFE_ID, 128);
  const actions = new Set<MastermindIdentityAction>([
    'household.bootstrap', 'player.register', 'identity.bind', 'consent.set', 'player.archive',
  ]);
  if (typeof command.action !== 'string' || !actions.has(command.action as MastermindIdentityAction)) {
    reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
  }
  return { command, action: command.action as MastermindIdentityAction, commandId, householdId };
}

export function prepareMastermindIdentityCommand(rawJson: string): PreparedMastermindIdentityCommand {
  if (typeof rawJson !== 'string' || Buffer.byteLength(rawJson, 'utf8') > MAX_COMMAND_BYTES) {
    reject(413, 'IDENTITY_COMMAND_TOO_LARGE', 'The identity command exceeds the 16 KiB limit.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(rawJson); }
  catch { reject(400, 'IDENTITY_COMMAND_INVALID_JSON', 'The identity command is not valid JSON.'); }

  const { command, action, commandId, householdId } = commonCommand(parsed);
  const isBootstrap = action === 'household.bootstrap';
  if (isBootstrap !== !Object.prototype.hasOwnProperty.call(command, 'actorPlayerId')) {
    reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
  }
  const actorPlayerId = isBootstrap ? null : requiredString(command.actorPlayerId, UUID, 36);
  const expectedRevision = revision(command.expectedRevision, isBootstrap || action === 'player.register' ? 0 : 1);
  if ((isBootstrap || action === 'player.register') && expectedRevision !== 0) {
    reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
  }

  let subjectPlayerId: string;
  let householdDisplayName: string | null = null;
  let playerDisplayName: string | null = null;
  let role: string | null = null;
  let provider: string | null = null;
  let providerSubject: string | null = null;
  let providerAlias: string | null = null;
  let purpose: string | null = null;
  let decision: string | null = null;

  if (action === 'household.bootstrap') {
    const payload = exactObject(command.payload, ['playerId', 'householdDisplayName', 'playerDisplayName']);
    subjectPlayerId = requiredString(payload.playerId, UUID, 36);
    householdDisplayName = displayName(payload.householdDisplayName);
    playerDisplayName = displayName(payload.playerDisplayName);
    role = 'parent';
  } else if (action === 'player.register') {
    const payload = exactObject(command.payload, ['playerId', 'displayName', 'role']);
    subjectPlayerId = requiredString(payload.playerId, UUID, 36);
    playerDisplayName = displayName(payload.displayName);
    if (typeof payload.role !== 'string' || !ROLES.has(payload.role)) {
      reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
    }
    role = payload.role;
  } else if (action === 'identity.bind') {
    const payload = exactObject(command.payload, ['playerId', 'provider', 'subject'], ['alias']);
    subjectPlayerId = requiredString(payload.playerId, UUID, 36);
    if (!['minecraft-java', 'clerk', 'local'].includes(String(payload.provider))) {
      reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
    }
    provider = String(payload.provider);
    providerSubject = provider === 'minecraft-java'
      ? requiredString(payload.subject, MINECRAFT_PROFILE, 32)
      : provider === 'clerk'
        ? requiredString(payload.subject, CLERK_SUBJECT, 128)
        : requiredString(payload.subject, SAFE_LOCAL_SUBJECT, 128);
    if (Object.prototype.hasOwnProperty.call(payload, 'alias')) {
      providerAlias = provider === 'minecraft-java'
        ? requiredString(payload.alias, MINECRAFT_NAME, 16)
        : displayName(payload.alias);
    }
  } else if (action === 'consent.set') {
    const payload = exactObject(command.payload, ['playerId', 'purpose', 'decision']);
    subjectPlayerId = requiredString(payload.playerId, UUID, 36);
    if (typeof payload.purpose !== 'string' || !PURPOSES.has(payload.purpose)) {
      reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
    }
    if (payload.decision !== 'allow' && payload.decision !== 'deny') {
      reject(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
    }
    purpose = payload.purpose;
    decision = payload.decision;
  } else {
    const payload = exactObject(command.payload, ['playerId', 'confirmation']);
    subjectPlayerId = requiredString(payload.playerId, UUID, 36);
    if (payload.confirmation !== 'ARCHIVE') {
      reject(400, 'IDENTITY_CONFIRMATION_REQUIRED', 'Archiving a player requires exact confirmation.');
    }
  }

  const normalized = Object.freeze({
    commandId,
    action,
    householdId,
    ...(actorPlayerId === null ? {} : { actorPlayerId }),
    expectedRevision,
    payload: Object.freeze(structuredClone(command.payload) as JsonObject),
  }) as MastermindIdentityCommand;
  const canonicalJson = canonical(normalized);
  if (rawJson !== canonicalJson) {
    reject(400, 'IDENTITY_COMMAND_NON_CANONICAL', 'The request body must use canonical identity-command JSON.');
  }
  const digest = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  return Object.freeze({
    command: normalized,
    canonicalJson,
    digest,
    parameters: Object.freeze({
      actorPlayerId,
      subjectPlayerId,
      expectedRevision,
      householdDisplayName,
      playerDisplayName,
      role,
      provider,
      providerSubject,
      providerAlias,
      purpose,
      decision,
    }),
  });
}

function safeRevision(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error('The identity store returned an invalid result.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('The identity store returned an invalid result.');
  return parsed;
}

function memoryNamespace(value: unknown): string {
  const namespace = requiredString(value, /^[a-z0-9][a-z0-9._:/-]{1,179}$/, 180);
  if (namespace === 'family/shared' || namespace === 'companion/self' || namespace === 'system/technical') {
    return namespace;
  }
  const player = /^player\/([0-9a-f-]{36})\/(private|shared)$/.exec(namespace);
  if (player && UUID.test(player[1])) return namespace;
  const session = /^session\/([0-9a-f-]{36})$/.exec(namespace);
  if (session && UUID.test(session[1])) return namespace;
  const world = /^world\/(world-[a-f0-9]{64})$/.exec(namespace);
  if (world && WORLD_REF.test(world[1])) return namespace;
  const project = /^project\/([a-z0-9][a-z0-9._:-]{0,127})$/.exec(namespace);
  if (project) return namespace;
  reject(400, 'IDENTITY_SCOPE_INVALID', 'The memory authorization scope is invalid.');
}

function exactCommitRow(value: unknown, expectedCommandId: string): MastermindIdentityCommitResult {
  const row = exactObjectForStore(value);
  const keys = Object.keys(row).sort().join('\0');
  if (keys !== 'commandId\0householdRevision\0playerId\0playerRevision\0status') {
    throw new Error('The identity store returned an invalid result.');
  }
  if (!['applied', 'duplicate', 'conflict'].includes(String(row.status)) || row.commandId !== expectedCommandId) {
    throw new Error('The identity store returned an invalid result.');
  }
  if (row.status === 'conflict') {
    if (row.householdRevision !== null || row.playerRevision !== null || row.playerId !== null) {
      throw new Error('The identity store returned an invalid result.');
    }
    return Object.freeze({ status: 'conflict', commandId: expectedCommandId, householdRevision: null, playerRevision: null, playerId: null });
  }
  const playerId = requiredStoreUuid(row.playerId);
  const householdRevision = safeRevision(row.householdRevision);
  const playerRevision = safeRevision(row.playerRevision);
  if (householdRevision === null || playerRevision === null) {
    throw new Error('The identity store returned an invalid result.');
  }
  return Object.freeze({
    status: row.status as 'applied' | 'duplicate',
    commandId: expectedCommandId,
    householdRevision,
    playerRevision,
    playerId,
  });
}

function exactObjectForStore(value: unknown): JsonObject {
  if (!isObject(value)) throw new Error('The identity store returned an invalid result.');
  return value;
}

function requiredStoreUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('The identity store returned an invalid result.');
  return value;
}

export async function commitMastermindIdentityCommand(
  sql: MastermindIdentitySql,
  prepared: PreparedMastermindIdentityCommand,
): Promise<MastermindIdentityCommitResult> {
  if (typeof sql !== 'function') throw new TypeError('A memory database query function is required.');
  const { command, digest, parameters } = prepared;
  const rows = await sql`
    SELECT status,
           command_id::text AS "commandId",
           household_revision::text AS "householdRevision",
           player_revision::text AS "playerRevision",
           subject_player_id::text AS "playerId"
    FROM public.apply_mastermind_identity_command_v1(
      ${command.commandId}::uuid,
      ${digest}::text,
      ${command.action}::text,
      ${command.householdId}::text,
      ${parameters.actorPlayerId}::uuid,
      ${parameters.subjectPlayerId}::uuid,
      ${parameters.expectedRevision}::bigint,
      ${parameters.householdDisplayName}::text,
      ${parameters.playerDisplayName}::text,
      ${parameters.role}::text,
      ${parameters.provider}::text,
      ${parameters.providerSubject}::text,
      ${parameters.providerAlias}::text,
      ${parameters.purpose}::text,
      ${parameters.decision}::text
    )
  `;
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('The identity store returned an invalid result.');
  return exactCommitRow(rows[0], command.commandId);
}

export type MastermindMemoryReadScope = Readonly<{
  householdId: string;
  actorPlayerId: string;
  namespace: string;
  visibility: 'private' | 'family' | 'system';
  candidatePlayerId: string | null;
}>;

export async function authorizeMastermindMemoryRead(
  sql: MastermindIdentitySql,
  scope: MastermindMemoryReadScope,
): Promise<boolean> {
  if (typeof sql !== 'function') throw new TypeError('A memory database query function is required.');
  requiredString(scope?.householdId, SAFE_ID, 128);
  requiredString(scope?.actorPlayerId, UUID, 36);
  memoryNamespace(scope?.namespace);
  if (!['private', 'family', 'system'].includes(scope?.visibility)) {
    reject(400, 'IDENTITY_SCOPE_INVALID', 'The memory authorization scope is invalid.');
  }
  if (scope.candidatePlayerId !== null) requiredString(scope.candidatePlayerId, UUID, 36);
  const rows = await sql`
    SELECT public.mastermind_can_read_memory_v1(
      ${scope.householdId}::text,
      ${scope.actorPlayerId}::uuid,
      ${scope.namespace}::text,
      ${scope.visibility}::text,
      ${scope.candidatePlayerId}::uuid
    ) AS allowed
  `;
  if (!Array.isArray(rows) || rows.length !== 1 || !isObject(rows[0])
    || Object.keys(rows[0]).length !== 1 || typeof rows[0].allowed !== 'boolean') {
    throw new Error('The identity store returned an invalid authorization result.');
  }
  return rows[0].allowed;
}

export type MastermindIdentityRouteDependencies = Readonly<{
  env: LocalServiceAuthEnvironment;
  getSql: () => MastermindIdentitySql;
}>;

const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
});

function errorResponse(status: number, code: string, message: string): Response {
  const headers = new Headers(RESPONSE_HEADERS);
  if (status === 401) headers.set('WWW-Authenticate', 'Bearer');
  return Response.json({ ok: false, code, message }, { status, headers });
}

export async function handleMastermindIdentityPost(
  request: Request,
  dependencies: MastermindIdentityRouteDependencies,
): Promise<Response> {
  try {
    authorizeLocalServiceRequest(request, dependencies.env, {
      method: 'POST',
      path: IDENTITY_PATH,
      messages: {
        disabled: 'The local family identity service is disabled.',
        loopbackRequired: 'The family identity service accepts only direct loopback requests.',
        unauthorized: 'A valid local control bearer token is required.',
      },
    });
    const rawJson = await readBoundedJsonRequestBody(request, { maxBytes: MAX_COMMAND_BYTES });
    const prepared = prepareMastermindIdentityCommand(rawJson);
    const result = await commitMastermindIdentityCommand(dependencies.getSql(), prepared);
    if (result.status === 'conflict') {
      return errorResponse(409, 'IDENTITY_COMMAND_CONFLICT', 'The command ID is already committed with different content.');
    }
    return Response.json({
      ok: true,
      status: result.status,
      commandId: result.commandId,
      householdRevision: result.householdRevision,
      playerRevision: result.playerRevision,
      playerId: result.playerId,
    }, { status: 200, headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof MastermindIdentityRequestError
      || error instanceof LocalServiceRequestAuthError
      || error instanceof LocalServiceRequestBodyError) {
      return errorResponse(error.status, error.code, error.message);
    }
    const storeCode = isObject(error) && typeof error.code === 'string' ? error.code : null;
    if (storeCode === '40001') {
      return errorResponse(409, 'IDENTITY_REVISION_CONFLICT', 'The family identity state changed; refresh it before retrying.');
    }
    if (storeCode === '42501') {
      return errorResponse(403, 'IDENTITY_COMMAND_NOT_AUTHORIZED', 'The family identity command is not authorized.');
    }
    if (storeCode === '22023') {
      return errorResponse(400, 'IDENTITY_COMMAND_INVALID', 'The identity command is invalid.');
    }
    if (storeCode === '23505') {
      return errorResponse(409, 'IDENTITY_BINDING_CONFLICT', 'That external identity is already bound.');
    }
    return errorResponse(503, 'IDENTITY_STORE_UNAVAILABLE', 'The family identity store is unavailable.');
  }
}

export const MASTERMIND_IDENTITY_POLICY = Object.freeze({
  path: IDENTITY_PATH,
  maxCommandBytes: MAX_COMMAND_BYTES,
  roles: Object.freeze([...ROLES]),
  purposes: Object.freeze([...PURPOSES]),
});
