import crypto from 'node:crypto';

import {
  MemoryOperatorRequestError,
  MemoryOperatorSessionRegistry,
  MemoryOperatorUnlockCoordinator,
  MemoryOperatorUnlockLimiter,
  authorizeMemoryOperatorBrowserRequest,
  clearMemoryOperatorCookie,
  createMemoryOperatorSession,
  readMemoryOperatorSession,
  readMemoryOperatorSessionToken,
  verifyMemoryOperatorPin,
  type MemoryOperatorConfiguration,
  type MemoryOperatorEnvironment,
  type MemoryOperatorScrypt,
  type MemoryOperatorSession,
} from './operator-auth.ts';
import {
  LocalServiceRequestBodyError,
  readBoundedJsonRequestBody,
} from './local-service-auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MEMORY_KEY = /^companion-session\/v1\/[a-z0-9][a-z0-9._:-]{0,127}\/[0-9a-f-]{36}$/;
const SAFE_NAMESPACE = /^[a-z0-9][a-z0-9._:/-]{1,179}$/;
const WORLD_REF = /^world-[a-f0-9]{64}$/;
const MAX_UNLOCK_BYTES = 256;
const MAX_REQUEST_BYTES = 16 * 1024;
const OPERATIONS = new Set([
  'status', 'unlock', 'lock', 'search', 'forget-plans', 'forget-actions', 'restore-actions',
]);

type JsonObject = Record<string, unknown>;

export type MemoryOperatorSql = (
  strings: TemplateStringsArray,
  ...parameters: unknown[]
) => PromiseLike<unknown>;

export type MemoryOperatorOwnerCheck = () => Promise<Readonly<{
  ok: boolean;
  status?: number;
}>>;

export type MemoryOperatorDependencies = Readonly<{
  env: MemoryOperatorEnvironment;
  getSql: () => MemoryOperatorSql;
  limiter: MemoryOperatorUnlockLimiter;
  sessions: MemoryOperatorSessionRegistry;
  unlocks: MemoryOperatorUnlockCoordinator;
  requireOwner?: MemoryOperatorOwnerCheck;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  scrypt?: MemoryOperatorScrypt;
}>;

const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
});

function reject(status: number, code: string, message: string): never {
  throw new MemoryOperatorRequestError(status, code, message);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): JsonObject {
  if (!isObject(value)) reject(400, 'MEMORY_OPERATOR_REQUEST_INVALID', 'The memory operator request is invalid.');
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))) {
    reject(400, 'MEMORY_OPERATOR_REQUEST_INVALID', 'The memory operator request is invalid.');
  }
  return value;
}

function safeUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    reject(400, 'MEMORY_OPERATOR_REQUEST_INVALID', 'The memory operator request is invalid.');
  }
  return value;
}

function safeMemoryKey(value: unknown): string {
  if (typeof value !== 'string' || !MEMORY_KEY.test(value)) {
    reject(400, 'MEMORY_OPERATOR_REQUEST_INVALID', 'The memory operator request is invalid.');
  }
  return value;
}

function safeRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    reject(400, 'MEMORY_OPERATOR_REQUEST_INVALID', 'The memory operator request is invalid.');
  }
  return Number(value);
}

function safeLimit(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 20) {
    reject(400, 'MEMORY_OPERATOR_REQUEST_INVALID', 'The memory operator request is invalid.');
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

function digest(value: JsonObject): string {
  return crypto.createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

async function readJson(request: Request, maximumBytes: number): Promise<unknown> {
  const raw = await readBoundedJsonRequestBody(request, { maxBytes: maximumBytes });
  try { return JSON.parse(raw); }
  catch { reject(400, 'MEMORY_OPERATOR_REQUEST_INVALID', 'The memory operator request is invalid.'); }
}

function responseHeaders(setCookie?: string, retryAfterSeconds?: number): Headers {
  const headers = new Headers(RESPONSE_HEADERS);
  if (setCookie) headers.set('Set-Cookie', setCookie);
  if (retryAfterSeconds) headers.set('Retry-After', String(retryAfterSeconds));
  return headers;
}

function okResponse(value: JsonObject, setCookie?: string): Response {
  return Response.json(value, { status: 200, headers: responseHeaders(setCookie) });
}

function errorResponse(error: MemoryOperatorRequestError | LocalServiceRequestBodyError): Response {
  const clearCookie = error.code === 'MEMORY_OPERATOR_LOCKED' ? clearMemoryOperatorCookie() : undefined;
  return Response.json({ ok: false, code: error.code, message: error.message }, {
    status: error.status,
    headers: responseHeaders(clearCookie, error instanceof MemoryOperatorRequestError ? error.retryAfterSeconds : undefined),
  });
}

async function assertClerkOwner(
  config: MemoryOperatorConfiguration,
  dependencies: MemoryOperatorDependencies,
): Promise<void> {
  if (!config.clerkRequired) return;
  if (!dependencies.requireOwner) {
    reject(503, 'MEMORY_OPERATOR_CONFIGURATION_INVALID', 'The memory operator configuration is incomplete.');
  }
  const result = await dependencies.requireOwner();
  if (!result || result.ok !== true) {
    reject(result?.status === 401 ? 401 : 403, 'MEMORY_OPERATOR_OWNER_REQUIRED', 'The configured owner must be signed in.');
  }
}

function exactBooleanRow(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1 || !isObject(value[0])
    || Object.keys(value[0]).length !== 1 || typeof value[0].allowed !== 'boolean') {
    throw new Error('The memory operator store returned an invalid authorization result.');
  }
  return value[0].allowed;
}

export async function verifyMastermindMemoryOperator(
  sql: MemoryOperatorSql,
  config: Pick<MemoryOperatorConfiguration, 'householdId' | 'playerId'>,
): Promise<boolean> {
  const rows = await sql`
    SELECT public.verify_mastermind_memory_operator_v1(
      ${config.householdId}::text,
      ${config.playerId}::uuid
    ) AS allowed
  `;
  return exactBooleanRow(rows);
}

async function authenticatedSession(
  request: Request,
  config: MemoryOperatorConfiguration,
  dependencies: MemoryOperatorDependencies,
): Promise<MemoryOperatorSession> {
  const token = readMemoryOperatorSessionToken(request);
  const session = readMemoryOperatorSession(request, config, (dependencies.now ?? Date.now)());
  if (!session || !dependencies.sessions.isActive(token)) {
    reject(401, 'MEMORY_OPERATOR_LOCKED', 'Unlock the memory operator before continuing.');
  }
  await assertClerkOwner(config, dependencies);
  if (!await verifyMastermindMemoryOperator(dependencies.getSql(), config)) {
    dependencies.sessions.clear();
    reject(403, 'MEMORY_OPERATOR_PARENT_REQUIRED', 'The configured memory operator is not an active parent.');
  }
  return session;
}

function exactEmptyBody(value: unknown): void {
  exactObject(value, []);
}

function databaseCode(error: unknown): string | null {
  return isObject(error) && typeof error.code === 'string' ? error.code : null;
}

function mapDatabaseError(error: unknown): MemoryOperatorRequestError {
  const code = databaseCode(error);
  if (code === '42P01' || code === '42883') {
    return new MemoryOperatorRequestError(503, 'MEMORY_SETUP_REQUIRED', 'Apply the Mastermind memory migrations before using the operator.');
  }
  if (code === 'MM001') return new MemoryOperatorRequestError(409, 'MEMORY_FORGET_NOT_READY', 'Hold the confirmation control a little longer.');
  if (code === 'MM002') return new MemoryOperatorRequestError(409, 'MEMORY_FORGET_PLAN_EXPIRED', 'The forget plan expired; create a new one.');
  if (code === 'MM003' || code === '40001') return new MemoryOperatorRequestError(409, 'MEMORY_STATE_CHANGED', 'The memory state changed; refresh before retrying.');
  if (code === 'MM004' || code === '42501') return new MemoryOperatorRequestError(403, 'MEMORY_OPERATOR_PARENT_REQUIRED', 'The configured memory operator is not an active parent.');
  if (code === 'MM005' || code === '22023') return new MemoryOperatorRequestError(400, 'MEMORY_OPERATOR_REQUEST_INVALID', 'The memory operator request is invalid.');
  return new MemoryOperatorRequestError(503, 'MEMORY_STORE_UNAVAILABLE', 'The memory store is unavailable.');
}

function storeObject(value: unknown): JsonObject {
  if (!isObject(value)) throw new Error('The memory operator store returned an invalid result.');
  return value;
}

function storeString(value: unknown, pattern: RegExp, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || !pattern.test(value)) {
    throw new Error('The memory operator store returned an invalid result.');
  }
  return value;
}

function storeNullableString(value: unknown, pattern: RegExp, maximum: number): string | null {
  return value === null ? null : storeString(value, pattern, maximum);
}

function storeRevision(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error('The memory operator store returned an invalid result.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('The memory operator store returned an invalid result.');
  return parsed;
}

function storeTime(value: unknown): string {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new Error('The memory operator store returned an invalid result.');
  return date.toISOString();
}

export async function searchMastermindOperatorMemories(
  sql: MemoryOperatorSql,
  config: Pick<MemoryOperatorConfiguration, 'householdId' | 'playerId'>,
  input: Readonly<{ query: string; mode: 'active' | 'forgotten'; limit: number }>,
): Promise<readonly JsonObject[]> {
  const rows = await sql`
    SELECT memory_key AS "memoryKey",
           revision::text AS revision,
           summary,
           namespace,
           visibility,
           player_id::text AS "playerId",
           world_ref AS "worldRef",
           session_id::text AS "sessionId",
           occurred_at AS "occurredAt",
           lifecycle_state AS state
    FROM public.search_mastermind_operator_memories_v1(
      ${config.householdId}::text,
      ${config.playerId}::uuid,
      ${input.query}::text,
      ${input.mode}::text,
      ${input.limit}::integer
    )
  `;
  if (!Array.isArray(rows) || rows.length > input.limit) throw new Error('The memory operator store returned an invalid search result.');
  return Object.freeze(rows.map((entry) => {
    const row = storeObject(entry);
    if (Object.keys(row).sort().join('\0') !== 'memoryKey\0namespace\0occurredAt\0playerId\0revision\0sessionId\0state\0summary\0visibility\0worldRef') {
      throw new Error('The memory operator store returned an invalid search result.');
    }
    const state = row.state;
    const visibility = row.visibility;
    if (!['active', 'forgotten'].includes(String(state)) || !['private', 'family', 'system'].includes(String(visibility))) {
      throw new Error('The memory operator store returned an invalid search result.');
    }
    return Object.freeze({
      memoryKey: storeString(row.memoryKey, MEMORY_KEY, 256),
      revision: storeRevision(row.revision),
      summary: storeString(row.summary, /^[^\u0000-\u001f\u007f]+$/, 2048),
      namespace: storeString(row.namespace, SAFE_NAMESPACE, 180),
      visibility,
      playerId: storeNullableString(row.playerId, UUID, 36),
      worldRef: storeNullableString(row.worldRef, WORLD_REF, 70),
      sessionId: storeString(row.sessionId, UUID, 36),
      occurredAt: storeTime(row.occurredAt),
      state,
    });
  }));
}

type PlanReceipt = Readonly<{
  status: 'planned' | 'duplicate';
  planId: string;
  planDigest: string;
  memoryKey: string;
  expectedRevision: number;
  notBefore: string;
  expiresAt: string;
}>;

function exactPlanReceipt(rows: unknown, planId: string, memoryKey: string, planDigest: string): PlanReceipt {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('The memory operator store returned an invalid plan.');
  const row = storeObject(rows[0]);
  if (Object.keys(row).sort().join('\0') !== 'expectedRevision\0expiresAt\0memoryKey\0notBefore\0planDigest\0planId\0status'
    || !['planned', 'duplicate'].includes(String(row.status))
    || row.planId !== planId
    || row.planDigest !== planDigest
    || row.memoryKey !== memoryKey) {
    throw new Error('The memory operator store returned an invalid plan.');
  }
  return Object.freeze({
    status: row.status as 'planned' | 'duplicate',
    planId,
    planDigest,
    memoryKey,
    expectedRevision: storeRevision(row.expectedRevision),
    notBefore: storeTime(row.notBefore),
    expiresAt: storeTime(row.expiresAt),
  });
}

async function createForgetPlan(
  sql: MemoryOperatorSql,
  config: MemoryOperatorConfiguration,
  input: Readonly<{ planId: string; memoryKey: string; expectedRevision: number }>,
): Promise<PlanReceipt> {
  const requestDigest = digest({
    planId: input.planId,
    householdId: config.householdId,
    actorPlayerId: config.playerId,
    memoryKey: input.memoryKey,
    expectedRevision: input.expectedRevision,
  });
  const rows = await sql`
    SELECT status,
           plan_id::text AS "planId",
           plan_digest AS "planDigest",
           memory_key AS "memoryKey",
           expected_revision::text AS "expectedRevision",
           not_before AS "notBefore",
           expires_at AS "expiresAt"
    FROM public.create_mastermind_memory_forget_plan_v1(
      ${input.planId}::uuid,
      ${requestDigest}::text,
      ${config.householdId}::text,
      ${config.playerId}::uuid,
      ${input.memoryKey}::text,
      ${input.expectedRevision}::bigint
    )
  `;
  return exactPlanReceipt(rows, input.planId, input.memoryKey, requestDigest);
}

type ActionReceipt = Readonly<{
  status: 'applied' | 'duplicate';
  actionId: string;
  memoryKey: string;
  revision: number;
  state: 'active' | 'forgotten';
}>;

function exactActionReceipt(rows: unknown, actionId: string): ActionReceipt {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('The memory operator store returned an invalid action receipt.');
  const row = storeObject(rows[0]);
  if (Object.keys(row).sort().join('\0') !== 'actionId\0memoryKey\0revision\0state\0status'
    || !['applied', 'duplicate'].includes(String(row.status))
    || row.actionId !== actionId
    || !['active', 'forgotten'].includes(String(row.state))) {
    throw new Error('The memory operator store returned an invalid action receipt.');
  }
  return Object.freeze({
    status: row.status as 'applied' | 'duplicate',
    actionId,
    memoryKey: storeString(row.memoryKey, MEMORY_KEY, 256),
    revision: storeRevision(row.revision),
    state: row.state as 'active' | 'forgotten',
  });
}

async function applyForget(
  sql: MemoryOperatorSql,
  config: MemoryOperatorConfiguration,
  input: Readonly<{ actionId: string; planId: string; planDigest: string }>,
): Promise<ActionReceipt> {
  const requestDigest = digest({
    actionId: input.actionId,
    householdId: config.householdId,
    actorPlayerId: config.playerId,
    planId: input.planId,
    planDigest: input.planDigest,
  });
  const rows = await sql`
    SELECT status,
           action_id::text AS "actionId",
           memory_key AS "memoryKey",
           revision::text AS revision,
           lifecycle_state AS state
    FROM public.apply_mastermind_memory_forget_v1(
      ${input.actionId}::uuid,
      ${requestDigest}::text,
      ${config.householdId}::text,
      ${config.playerId}::uuid,
      ${input.planId}::uuid,
      ${input.planDigest}::text
    )
  `;
  return exactActionReceipt(rows, input.actionId);
}

async function applyRestore(
  sql: MemoryOperatorSql,
  config: MemoryOperatorConfiguration,
  input: Readonly<{ actionId: string; memoryKey: string; expectedRevision: number }>,
): Promise<ActionReceipt> {
  const requestDigest = digest({
    actionId: input.actionId,
    householdId: config.householdId,
    actorPlayerId: config.playerId,
    memoryKey: input.memoryKey,
    expectedRevision: input.expectedRevision,
  });
  const rows = await sql`
    SELECT status,
           action_id::text AS "actionId",
           memory_key AS "memoryKey",
           revision::text AS revision,
           lifecycle_state AS state
    FROM public.apply_mastermind_memory_restore_v1(
      ${input.actionId}::uuid,
      ${requestDigest}::text,
      ${config.householdId}::text,
      ${config.playerId}::uuid,
      ${input.memoryKey}::text,
      ${input.expectedRevision}::bigint
    )
  `;
  return exactActionReceipt(rows, input.actionId);
}

async function handleStatus(
  request: Request,
  config: MemoryOperatorConfiguration,
  dependencies: MemoryOperatorDependencies,
): Promise<Response> {
  exactEmptyBody(await readJson(request, MAX_UNLOCK_BYTES));
  const token = readMemoryOperatorSessionToken(request);
  const session = readMemoryOperatorSession(request, config, (dependencies.now ?? Date.now)());
  if (!session || !dependencies.sessions.isActive(token)) {
    return okResponse({ ok: true, unlocked: false, expiresAt: null }, token ? clearMemoryOperatorCookie() : undefined);
  }
  await assertClerkOwner(config, dependencies);
  if (!await verifyMastermindMemoryOperator(dependencies.getSql(), config)) {
    dependencies.sessions.clear();
    return okResponse({ ok: true, unlocked: false, expiresAt: null }, clearMemoryOperatorCookie());
  }
  return okResponse({ ok: true, unlocked: true, expiresAt: new Date(session.expiresAt * 1000).toISOString() });
}

async function handleUnlock(
  request: Request,
  config: MemoryOperatorConfiguration,
  dependencies: MemoryOperatorDependencies,
): Promise<Response> {
  return dependencies.unlocks.run(async () => {
    await assertClerkOwner(config, dependencies);
    const now = (dependencies.now ?? Date.now)();
    dependencies.limiter.assertAllowed(now);
    let valid: boolean;
    try {
      const value = await readJson(request, MAX_UNLOCK_BYTES);
      const body = exactObject(value, ['pin']);
      valid = await verifyMemoryOperatorPin(body.pin, config, dependencies.scrypt);
    } catch (error) {
      dependencies.limiter.recordFailure(now);
      throw error;
    }
    if (!valid) {
      dependencies.limiter.recordFailure(now);
      reject(401, 'MEMORY_OPERATOR_UNLOCK_FAILED', 'The memory operator could not be unlocked.');
    }
    if (!await verifyMastermindMemoryOperator(dependencies.getSql(), config)) {
      reject(403, 'MEMORY_OPERATOR_PARENT_REQUIRED', 'The configured memory operator is not an active parent.');
    }
    dependencies.limiter.recordSuccess();
    const created = createMemoryOperatorSession(config, { now, randomBytes: dependencies.randomBytes });
    dependencies.sessions.activate(created.token);
    return okResponse({
      ok: true,
      unlocked: true,
      expiresAt: new Date(created.session.expiresAt * 1000).toISOString(),
    }, created.setCookie);
  });
}

async function handleLockedOperation(
  request: Request,
  operation: string,
  config: MemoryOperatorConfiguration,
  dependencies: MemoryOperatorDependencies,
): Promise<Response> {
  await authenticatedSession(request, config, dependencies);
  const sql = dependencies.getSql();
  if (operation === 'search') {
    const body = exactObject(await readJson(request, MAX_REQUEST_BYTES), ['query', 'mode', 'limit']);
    if (typeof body.query !== 'string' || body.query.length > 512 || body.query.trim() !== body.query
      || !['active', 'forgotten'].includes(String(body.mode))) {
      reject(400, 'MEMORY_OPERATOR_REQUEST_INVALID', 'The memory operator request is invalid.');
    }
    const mode = body.mode as 'active' | 'forgotten';
    const limit = safeLimit(body.limit);
    const results = await searchMastermindOperatorMemories(sql, config, { query: body.query, mode, limit });
    return okResponse({
      ok: true,
      mode,
      ranking: body.query ? 'text' : 'recent',
      results,
    });
  }
  if (operation === 'forget-plans') {
    const body = exactObject(await readJson(request, MAX_REQUEST_BYTES), ['planId', 'memoryKey', 'expectedRevision']);
    const receipt = await createForgetPlan(sql, config, {
      planId: safeUuid(body.planId),
      memoryKey: safeMemoryKey(body.memoryKey),
      expectedRevision: safeRevision(body.expectedRevision),
    });
    return okResponse({ ok: true, ...receipt });
  }
  if (operation === 'forget-actions') {
    const body = exactObject(await readJson(request, MAX_REQUEST_BYTES), ['actionId', 'planId', 'planDigest']);
    if (typeof body.planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.planDigest)) {
      reject(400, 'MEMORY_OPERATOR_REQUEST_INVALID', 'The memory operator request is invalid.');
    }
    const receipt = await applyForget(sql, config, {
      actionId: safeUuid(body.actionId),
      planId: safeUuid(body.planId),
      planDigest: body.planDigest,
    });
    return okResponse({ ok: true, ...receipt });
  }
  if (operation === 'restore-actions') {
    const body = exactObject(await readJson(request, MAX_REQUEST_BYTES), ['actionId', 'memoryKey', 'expectedRevision']);
    const receipt = await applyRestore(sql, config, {
      actionId: safeUuid(body.actionId),
      memoryKey: safeMemoryKey(body.memoryKey),
      expectedRevision: safeRevision(body.expectedRevision),
    });
    return okResponse({ ok: true, ...receipt });
  }
  reject(404, 'MEMORY_OPERATOR_ACTION_UNKNOWN', 'The memory operator action does not exist.');
}

export async function handleMemoryOperatorPost(
  request: Request,
  operation: string,
  dependencies: MemoryOperatorDependencies,
): Promise<Response> {
  try {
    if (!OPERATIONS.has(operation)) {
      reject(404, 'MEMORY_OPERATOR_ACTION_UNKNOWN', 'The memory operator action does not exist.');
    }
    const path = `/api/memory/operator/${operation}`;
    const config = authorizeMemoryOperatorBrowserRequest(request, path, dependencies.env);
    if (operation === 'status') return await handleStatus(request, config, dependencies);
    if (operation === 'unlock') return await handleUnlock(request, config, dependencies);
    if (operation === 'lock') {
      exactEmptyBody(await readJson(request, MAX_UNLOCK_BYTES));
      return dependencies.unlocks.run(async () => {
        dependencies.sessions.clear();
        return okResponse({ ok: true, unlocked: false, expiresAt: null }, clearMemoryOperatorCookie());
      });
    }
    return await handleLockedOperation(request, operation, config, dependencies);
  } catch (error) {
    if (error instanceof MemoryOperatorRequestError || error instanceof LocalServiceRequestBodyError) {
      return errorResponse(error);
    }
    return errorResponse(mapDatabaseError(error));
  }
}

export const MEMORY_OPERATOR_POLICY = Object.freeze({
  operations: Object.freeze([...OPERATIONS]),
  maxUnlockBytes: MAX_UNLOCK_BYTES,
  maxRequestBytes: MAX_REQUEST_BYTES,
  searchLimit: 20,
});
