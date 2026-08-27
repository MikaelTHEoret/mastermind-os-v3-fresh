import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { LOCAL_FAMILY_OPERATOR_PROFILE } from '../../src/lib/memory/local-family-profile.mjs';

const PLAN_KIND = 'mastermind.family-identity-bootstrap.v1';
const PLAN_SCHEMA_VERSION = 1;
const MAX_PLAN_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IDENTITY_URL = 'http://127.0.0.1:3000/api/memory/identity';
const READINESS_URL = 'http://127.0.0.1:3000/api/health';
const BOOTSTRAP_FLAG = '--family-identity-bootstrap';
const SYNC_FLAG = '--memory-event-sync';
const SYNC_ENV = 'MASTERMIND_MEMORY_EVENT_SYNC_ENABLED';
const PLAYER_ENV = 'MASTERMIND_MEMORY_PLAYER_ID';

export class FamilyIdentityBootstrapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FamilyIdentityBootstrapError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new FamilyIdentityBootstrapError(code, message);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactObject(value, keys, code = 'BOOTSTRAP_PLAN_INVALID') {
  const message = code === 'BOOTSTRAP_RESPONSE_INVALID'
    ? 'The family identity service returned an invalid response.'
    : 'The family identity bootstrap plan is invalid.';
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, message);
  }
  if (Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    fail(code, message);
  }
  return value;
}

function canonicalUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    fail('BOOTSTRAP_PLAN_INVALID', 'The family identity bootstrap plan is invalid.');
  }
  return value;
}

function nextUuid(randomUUID) {
  if (typeof randomUUID !== 'function') throw new TypeError('A UUID generator is required.');
  return canonicalUuid(randomUUID());
}

function commandRecord(command) {
  return Object.freeze({
    commandId: command.commandId,
    body: canonicalJson(command),
  });
}

export function buildFamilyIdentityBootstrapPlan({ randomUUID = crypto.randomUUID } = {}) {
  const parentPlayerId = canonicalUuid(LOCAL_FAMILY_OPERATOR_PROFILE.parentPlayerId);
  const servicePlayerId = nextUuid(randomUUID);
  const commandIds = Array.from({ length: 4 }, () => nextUuid(randomUUID));
  const commands = [
    {
      commandId: commandIds[0],
      action: 'household.bootstrap',
      householdId: 'family-local',
      expectedRevision: 0,
      payload: {
        playerId: parentPlayerId,
        householdDisplayName: 'Family',
        playerDisplayName: 'Parent',
      },
    },
    {
      commandId: commandIds[1],
      action: 'player.register',
      householdId: 'family-local',
      actorPlayerId: parentPlayerId,
      expectedRevision: 0,
      payload: {
        playerId: servicePlayerId,
        displayName: 'Mastermind Companion',
        role: 'service',
      },
    },
    {
      commandId: commandIds[2],
      action: 'consent.set',
      householdId: 'family-local',
      actorPlayerId: parentPlayerId,
      expectedRevision: 1,
      payload: {
        playerId: servicePlayerId,
        purpose: 'capture',
        decision: 'allow',
      },
    },
    {
      commandId: commandIds[3],
      action: 'consent.set',
      householdId: 'family-local',
      actorPlayerId: parentPlayerId,
      expectedRevision: 2,
      payload: {
        playerId: servicePlayerId,
        purpose: 'session_summary',
        decision: 'allow',
      },
    },
  ].map(commandRecord);
  return Object.freeze({
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: PLAN_KIND,
    householdId: 'family-local',
    parentPlayerId,
    servicePlayerId,
    commands: Object.freeze(commands),
  });
}

function validateCommandRecord(record, expected) {
  exactObject(record, ['commandId', 'body']);
  const commandId = canonicalUuid(record.commandId);
  if (typeof record.body !== 'string' || Buffer.byteLength(record.body, 'utf8') > 16 * 1024) {
    fail('BOOTSTRAP_PLAN_INVALID', 'The family identity bootstrap plan is invalid.');
  }
  let body;
  try {
    body = JSON.parse(record.body);
  } catch {
    fail('BOOTSTRAP_PLAN_INVALID', 'The family identity bootstrap plan is invalid.');
  }
  if (record.body !== canonicalJson(body) || commandId !== body?.commandId) {
    fail('BOOTSTRAP_PLAN_INVALID', 'The family identity bootstrap plan is invalid.');
  }
  if (canonicalJson(body) !== canonicalJson(expected)) {
    fail('BOOTSTRAP_PLAN_SCOPE_VIOLATION', 'The plan contains a command outside the fixed family bootstrap scope.');
  }
  return Object.freeze({ commandId, body: record.body });
}

export function validateFamilyIdentityBootstrapPlan(value) {
  const plan = exactObject(value, [
    'schemaVersion', 'kind', 'householdId', 'parentPlayerId', 'servicePlayerId', 'commands',
  ]);
  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION || plan.kind !== PLAN_KIND || plan.householdId !== 'family-local') {
    fail('BOOTSTRAP_PLAN_INVALID', 'The family identity bootstrap plan is invalid.');
  }
  const parentPlayerId = canonicalUuid(plan.parentPlayerId);
  const servicePlayerId = canonicalUuid(plan.servicePlayerId);
  if (parentPlayerId === servicePlayerId || !Array.isArray(plan.commands) || plan.commands.length !== 4) {
    fail('BOOTSTRAP_PLAN_INVALID', 'The family identity bootstrap plan is invalid.');
  }
  const expected = [
    {
      commandId: plan.commands[0]?.commandId,
      action: 'household.bootstrap',
      householdId: 'family-local',
      expectedRevision: 0,
      payload: { playerId: parentPlayerId, householdDisplayName: 'Family', playerDisplayName: 'Parent' },
    },
    {
      commandId: plan.commands[1]?.commandId,
      action: 'player.register',
      householdId: 'family-local',
      actorPlayerId: parentPlayerId,
      expectedRevision: 0,
      payload: { playerId: servicePlayerId, displayName: 'Mastermind Companion', role: 'service' },
    },
    {
      commandId: plan.commands[2]?.commandId,
      action: 'consent.set',
      householdId: 'family-local',
      actorPlayerId: parentPlayerId,
      expectedRevision: 1,
      payload: { playerId: servicePlayerId, purpose: 'capture', decision: 'allow' },
    },
    {
      commandId: plan.commands[3]?.commandId,
      action: 'consent.set',
      householdId: 'family-local',
      actorPlayerId: parentPlayerId,
      expectedRevision: 2,
      payload: { playerId: servicePlayerId, purpose: 'session_summary', decision: 'allow' },
    },
  ];
  const commands = plan.commands.map((record, index) => validateCommandRecord(record, expected[index]));
  if (new Set(commands.map(({ commandId }) => commandId)).size !== commands.length) {
    fail('BOOTSTRAP_PLAN_INVALID', 'The family identity bootstrap plan is invalid.');
  }
  return Object.freeze({
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: PLAN_KIND,
    householdId: 'family-local',
    parentPlayerId,
    servicePlayerId,
    commands: Object.freeze(commands),
  });
}

export async function createFamilyIdentityBootstrapPlanFile(file, options = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    throw new TypeError('An explicit absolute bootstrap plan path is required.');
  }
  const plan = buildFamilyIdentityBootstrapPlan(options);
  const serialized = `${canonicalJson(plan)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PLAN_BYTES) {
    fail('BOOTSTRAP_PLAN_TOO_LARGE', 'The family identity bootstrap plan exceeds its size limit.');
  }
  let handle;
  try {
    handle = await fs.open(file, 'wx', 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail('BOOTSTRAP_PLAN_EXISTS', 'The bootstrap plan path already exists; it was not overwritten.');
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return plan;
}

export async function readFamilyIdentityBootstrapPlanFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    throw new TypeError('An explicit absolute bootstrap plan path is required.');
  }
  const entry = await fs.lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > MAX_PLAN_BYTES) {
    fail('BOOTSTRAP_PLAN_BOUNDS', 'The family identity bootstrap plan is not a bounded regular file.');
  }
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_PLAN_BYTES) {
      fail('BOOTSTRAP_PLAN_BOUNDS', 'The family identity bootstrap plan is not a bounded regular file.');
    }
    const raw = await handle.readFile('utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_PLAN_BYTES) {
      fail('BOOTSTRAP_PLAN_BOUNDS', 'The family identity bootstrap plan is not a bounded regular file.');
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail('BOOTSTRAP_PLAN_INVALID', 'The family identity bootstrap plan is invalid.');
    }
    const plan = validateFamilyIdentityBootstrapPlan(parsed);
    if (raw !== `${canonicalJson(plan)}\n`) {
      fail('BOOTSTRAP_PLAN_NON_CANONICAL', 'The family identity bootstrap plan file must remain canonical.');
    }
    return plan;
  } finally {
    await handle.close();
  }
}

function environmentValue(environment, expectedKey) {
  const entries = Object.entries(environment ?? {}).filter(([key]) => key.toUpperCase() === expectedKey);
  return entries.length === 0 ? undefined : entries.at(-1)[1];
}

export function parseFamilyIdentityBootstrapLaunch({ args = [], environment = {} } = {}) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    throw new TypeError('The local-control arguments must be strings.');
  }
  const indexes = args.flatMap((argument, index) => argument === BOOTSTRAP_FLAG ? [index] : []);
  if (indexes.length === 0) return null;
  if (indexes.length !== 1 || indexes[0] + 1 >= args.length || args[indexes[0] + 1].startsWith('--')) {
    fail('BOOTSTRAP_ARGUMENT_INVALID', `${BOOTSTRAP_FLAG} requires one explicit plan path.`);
  }
  const bootstrapPath = path.resolve(args[indexes[0] + 1]);
  if (args.includes(SYNC_FLAG) || environmentValue(environment, SYNC_ENV) === 'true') {
    fail('BOOTSTRAP_SYNC_CONFLICT', 'Family identity bootstrap and memory event synchronization cannot run together.');
  }
  if (environmentValue(environment, PLAYER_ENV) !== undefined) {
    fail('BOOTSTRAP_PLAYER_CONFLICT', 'Remove the memory player binding while applying a family identity bootstrap plan.');
  }
  const consumed = new Set([indexes[0], indexes[0] + 1]);
  const productionFlags = args.filter((argument, index) => !consumed.has(index) && argument === '--production');
  const unknown = args.filter((argument, index) => !consumed.has(index) && argument !== '--production');
  if (productionFlags.length > 1 || unknown.length > 0) {
    fail('BOOTSTRAP_ARGUMENT_INVALID', 'Bootstrap mode accepts only one explicit plan path and an optional --production flag.');
  }
  return Object.freeze({ planFile: bootstrapPath });
}

async function readBoundedJsonResponse(response) {
  const declaredHeader = response?.headers?.get?.('content-length');
  if (declaredHeader !== null && declaredHeader !== undefined && !/^\d+$/.test(declaredHeader)) {
    fail('BOOTSTRAP_RESPONSE_INVALID', 'The family identity service returned an invalid response.');
  }
  const declared = declaredHeader == null ? 0 : Number(declaredHeader);
  if (!Number.isSafeInteger(declared) || declared > MAX_RESPONSE_BYTES) {
    fail('BOOTSTRAP_RESPONSE_TOO_LARGE', 'The family identity service returned an oversized response.');
  }
  const reader = response?.body?.getReader?.();
  if (!reader) fail('BOOTSTRAP_RESPONSE_INVALID', 'The family identity service returned an invalid response.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let received = 0;
  let raw = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES || (declaredHeader != null && received > declared)) {
        await reader.cancel('Family identity response byte limit exceeded').catch(() => undefined);
        fail('BOOTSTRAP_RESPONSE_TOO_LARGE', 'The family identity service returned an oversized response.');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    if (error instanceof FamilyIdentityBootstrapError) throw error;
    if (error instanceof TypeError && /encoded data/i.test(error.message)) {
      fail('BOOTSTRAP_RESPONSE_INVALID', 'The family identity service returned an invalid response.');
    }
    fail('BOOTSTRAP_TRANSPORT_AMBIGUOUS', 'Family identity bootstrap stopped after an ambiguous loopback transport failure; retry the unchanged plan.');
  } finally {
    try { reader.releaseLock(); } catch { /* the response stream already failed safely */ }
  }
  if (declaredHeader != null && received !== declared) {
    fail('BOOTSTRAP_RESPONSE_INVALID', 'The family identity service returned an invalid response.');
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail('BOOTSTRAP_RESPONSE_INVALID', 'The family identity service returned an invalid response.');
  }
}

function exactReceipt(value, commandId, expectedPlayerId) {
  const receipt = exactObject(value, [
    'ok', 'status', 'commandId', 'householdRevision', 'playerRevision', 'playerId',
  ], 'BOOTSTRAP_RESPONSE_INVALID');
  if (
    receipt.ok !== true
    || !['applied', 'duplicate'].includes(receipt.status)
    || receipt.commandId !== commandId
    || receipt.playerId !== expectedPlayerId
    || !Number.isSafeInteger(receipt.householdRevision)
    || receipt.householdRevision < 1
    || !Number.isSafeInteger(receipt.playerRevision)
    || receipt.playerRevision < 1
  ) fail('BOOTSTRAP_RESPONSE_INVALID', 'The family identity service returned an invalid receipt.');
  return Object.freeze({
    status: receipt.status,
    commandId,
    householdRevision: receipt.householdRevision,
    playerRevision: receipt.playerRevision,
    playerId: receipt.playerId,
  });
}

export async function waitForFamilyIdentityService({ fetchImpl = fetch, timeoutMs = 45_000, now = Date.now } = {}) {
  const deadline = now() + timeoutMs;
  do {
    try {
      const response = await fetchImpl(READINESS_URL, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(2_000),
      });
      if (response?.ok === true) {
        response.body?.cancel?.().catch?.(() => {});
        return;
      }
      response?.body?.cancel?.().catch?.(() => {});
    } catch {
      // Next may not have opened its loopback listener yet.
    }
    if (now() >= deadline) fail('BOOTSTRAP_NEXT_NOT_READY', 'The local Mastermind API did not become ready for family identity bootstrap.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
}

export async function applyFamilyIdentityBootstrapPlan(
  plan,
  { token, fetchImpl = fetch, requestTimeoutMs = 10_000 } = {},
) {
  const validated = validateFamilyIdentityBootstrapPlan(plan);
  if (typeof token !== 'string' || token.length < 32 || token.length > 512) {
    throw new TypeError('A valid in-memory local-control bearer is required.');
  }
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60_000) {
    throw new TypeError('The family identity request timeout is invalid.');
  }
  const receipts = [];
  for (const record of validated.commands) {
    let response;
    try {
      response = await fetchImpl(IDENTITY_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: record.body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      fail('BOOTSTRAP_TRANSPORT_AMBIGUOUS', 'Family identity bootstrap stopped after an ambiguous loopback transport failure; retry the unchanged plan.');
    }
    const body = await readBoundedJsonResponse(response);
    if (!response.ok) {
      const serviceCode = typeof body?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(body.code)
        ? body.code
        : 'UNKNOWN';
      fail('BOOTSTRAP_COMMAND_REJECTED', `Family identity bootstrap stopped because the service rejected a command (${serviceCode}); retry only after correcting the local store state.`);
    }
    const expectedPlayerId = JSON.parse(record.body).payload.playerId;
    receipts.push(exactReceipt(body, record.commandId, expectedPlayerId));
  }
  return Object.freeze({
    householdId: validated.householdId,
    parentPlayerId: validated.parentPlayerId,
    servicePlayerId: validated.servicePlayerId,
    receipts: Object.freeze(receipts),
  });
}

export async function applyFamilyIdentityBootstrapPlanFile(file, options = {}) {
  const plan = await readFamilyIdentityBootstrapPlanFile(file);
  return applyFamilyIdentityBootstrapPlan(plan, options);
}

export const FAMILY_IDENTITY_BOOTSTRAP_POLICY = Object.freeze({
  kind: PLAN_KIND,
  schemaVersion: PLAN_SCHEMA_VERSION,
  maxPlanBytes: MAX_PLAN_BYTES,
  bootstrapFlag: BOOTSTRAP_FLAG,
  syncFlag: SYNC_FLAG,
  identityUrl: IDENTITY_URL,
  readinessUrl: READINESS_URL,
});
