import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalMastermindDomainEvent } from '../../../../protocol/mastermind-domain-event/contract.mjs';
import {
  MemoryEventRequestError,
  commitMastermindDomainEvent,
  handleMastermindMemoryEventPost,
  prepareCanonicalMastermindDomainEvent,
} from '../domain-events.ts';

const TOKEN = 'local-memory-test-token-0123456789abcdef';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '11111111-1111-8111-8111-111111111111';
const BASE_ENV = Object.freeze({
  MASTERMIND_LOCAL_CONTROL_ENABLED: 'true',
  MASTERMIND_CONTROL_TOKEN: TOKEN,
});

function event(overrides = {}) {
  return {
    eventId: EVENT_ID,
    schemaVersion: 1,
    occurredAt: '2026-08-14T12:00:00.000Z',
    producer: 'minecraft-control-plane',
    domain: 'companion',
    kind: 'action.completed',
    namespace: `session/${SESSION_ID}`,
    householdId: 'family-local',
    sessionId: SESSION_ID,
    correlationId: ACTION_ID,
    visibility: 'private',
    payload: {
      actionId: ACTION_ID,
      actionKind: 'skill.navigateTo',
      status: 'succeeded',
      resultCode: 'arrived',
    },
    ...overrides,
  };
}

function canonical(value) {
  return canonicalMastermindDomainEvent(value);
}

function request(raw, overrides = {}) {
  const headers = new Headers({
    host: '127.0.0.1:3000',
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    ...overrides.headers,
  });
  return new Request(overrides.url ?? 'http://127.0.0.1:3000/api/memory/events', {
    method: overrides.method ?? 'POST',
    headers,
    body: raw,
  });
}

function fakeSql(rows, capture = () => undefined) {
  return async (strings, ...parameters) => {
    capture({ strings, parameters });
    return rows;
  };
}

async function json(response) {
  return JSON.parse(await response.text());
}

test('known companion events are canonicalized, hashed, and mapped through an exact payload allowlist', () => {
  const raw = canonical(event());
  const prepared = prepareCanonicalMastermindDomainEvent(raw);
  assert.equal(prepared.canonicalJson, raw);
  assert.match(prepared.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(prepared.sanitizedPayload, {
    actionId: ACTION_ID,
    actionKind: 'skill.navigateTo',
    status: 'succeeded',
    resultCode: 'arrived',
  });
  assert.equal(prepared.event.visibility, 'private');
  assert.equal(prepared.event.namespace, `session/${SESSION_ID}`);
});

test('unknown valid kinds retain no payload in the database command', async () => {
  const unknown = event({
    domain: 'system',
    kind: 'diagnostic.observed',
    namespace: 'system/technical',
    visibility: 'system',
    sessionId: undefined,
    correlationId: undefined,
    payload: { arbitraryFutureField: 'not persisted' },
  });
  delete unknown.sessionId;
  delete unknown.correlationId;
  const prepared = prepareCanonicalMastermindDomainEvent(canonical(unknown));
  assert.equal(prepared.sanitizedPayload, null);

  let captured;
  const result = await commitMastermindDomainEvent(
    fakeSql([{ status: 'applied', eventId: EVENT_ID }], (call) => { captured = call; }),
    prepared,
  );
  assert.deepEqual(result, { status: 'applied', eventId: EVENT_ID });
  assert.equal(captured.parameters.length, 15);
  assert.equal(captured.parameters[14], null);
  assert.equal(captured.parameters.includes('not persisted'), false);
});

test('blocked-action mapping rejects result data and status-mismatched failure fields', () => {
  const base = {
    actionId: ACTION_ID,
    actionKind: 'skill.navigateTo',
    status: 'failed',
  };
  const blocked = (payload) => canonical(event({ kind: 'action.blocked', payload }));

  assert.deepEqual(
    prepareCanonicalMastermindDomainEvent(blocked({ ...base, errorCode: 'path-blocked' })).sanitizedPayload,
    { ...base, errorCode: 'path-blocked' },
  );
  assert.throws(
    () => prepareCanonicalMastermindDomainEvent(blocked({ ...base, resultCode: 'partial' })),
    (error) => error instanceof MemoryEventRequestError && error.code === 'EVENT_KIND_PAYLOAD_INVALID',
  );
  assert.throws(
    () => prepareCanonicalMastermindDomainEvent(blocked({ ...base, cancellationReason: 'user-stop' })),
    (error) => error instanceof MemoryEventRequestError && error.code === 'EVENT_KIND_PAYLOAD_INVALID',
  );
  assert.throws(
    () => prepareCanonicalMastermindDomainEvent(blocked({ ...base, status: 'cancelled', errorCode: 'path-blocked' })),
    (error) => error instanceof MemoryEventRequestError && error.code === 'EVENT_KIND_PAYLOAD_INVALID',
  );
});

test('non-canonical JSON and extra known-kind payload fields fail before database access', async () => {
  const valid = event();
  assert.throws(
    () => prepareCanonicalMastermindDomainEvent(JSON.stringify(valid, null, 2)),
    (error) => error instanceof MemoryEventRequestError && error.code === 'EVENT_NON_CANONICAL',
  );
  assert.throws(
    () => prepareCanonicalMastermindDomainEvent(canonical(event({
      payload: { ...valid.payload, rawChat: 'should never pass' },
    }))),
    (error) => error instanceof MemoryEventRequestError && error.code === 'EVENT_KIND_PAYLOAD_INVALID',
  );

  let databaseOpened = false;
  const response = await handleMastermindMemoryEventPost(
    request(JSON.stringify(valid, null, 2)),
    { env: BASE_ENV, getSql: () => { databaseOpened = true; return fakeSql([]); } },
  );
  assert.equal(response.status, 400);
  assert.equal((await json(response)).code, 'EVENT_NON_CANONICAL');
  assert.equal(databaseOpened, false);
});

test('commit accepts only one exact receipt row and surfaces all three database outcomes', async () => {
  const prepared = prepareCanonicalMastermindDomainEvent(canonical(event()));
  for (const status of ['applied', 'duplicate', 'conflict']) {
    assert.deepEqual(
      await commitMastermindDomainEvent(fakeSql([{ status, eventId: EVENT_ID }]), prepared),
      { status, eventId: EVENT_ID },
    );
  }
  await assert.rejects(
    commitMastermindDomainEvent(fakeSql([{ status: 'applied', eventId: EVENT_ID, extra: true }]), prepared),
    /invalid receipt result/,
  );
  await assert.rejects(
    commitMastermindDomainEvent(fakeSql([{ status: 'applied', eventId: ACTION_ID }]), prepared),
    /invalid receipt result/,
  );
});

test('POST handler is exact-loopback, originless, exact-bearer authenticated, and does not open the DB on rejection', async () => {
  const raw = canonical(event());
  const rejected = [
    { req: request(raw, { headers: { authorization: `bearer ${TOKEN}` } }), env: BASE_ENV, code: 'UNAUTHORIZED' },
    { req: request(raw, { headers: { authorization: `Bearer  ${TOKEN}` } }), env: BASE_ENV, code: 'UNAUTHORIZED' },
    { req: request(raw, { url: 'http://localhost:3000/api/memory/events', headers: { host: 'localhost:3000' } }), env: BASE_ENV, code: 'LOOPBACK_REQUEST_REQUIRED' },
    { req: request(raw, { headers: { origin: 'http://127.0.0.1:3000' } }), env: BASE_ENV, code: 'LOOPBACK_REQUEST_REQUIRED' },
    { req: request(raw), env: { ...BASE_ENV, MASTERMIND_LOCAL_CONTROL_ENABLED: 'false' }, code: 'LOCAL_CONTROL_DISABLED' },
    { req: request(raw), env: { ...BASE_ENV, VERCEL: '1' }, code: 'LOCAL_CONTROL_DISABLED' },
  ];
  for (const entry of rejected) {
    let databaseOpened = false;
    const response = await handleMastermindMemoryEventPost(entry.req, {
      env: entry.env,
      getSql: () => { databaseOpened = true; return fakeSql([]); },
    });
    assert.equal((await json(response)).code, entry.code);
    assert.equal(databaseOpened, false);
  }
});

test('non-POST requests are rejected before database access', async () => {
  let databaseOpened = false;
  const nonPost = new Request('http://127.0.0.1:3000/api/memory/events', {
    method: 'PUT',
    headers: {
      host: '127.0.0.1:3000',
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: canonical(event()),
  });
  const response = await handleMastermindMemoryEventPost(nonPost, {
    env: BASE_ENV,
    getSql: () => { databaseOpened = true; return fakeSql([]); },
  });
  assert.equal(response.status, 405);
  assert.equal((await json(response)).code, 'METHOD_NOT_ALLOWED');
  assert.equal(databaseOpened, false);
});

test('POST handler returns an exact success envelope for applied and duplicate receipts', async () => {
  const raw = canonical(event());
  for (const status of ['applied', 'duplicate']) {
    let calls = 0;
    const response = await handleMastermindMemoryEventPost(request(raw), {
      env: BASE_ENV,
      getSql: () => fakeSql([{ status, eventId: EVENT_ID }], () => { calls += 1; }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    const body = await json(response);
    assert.deepEqual(body, { ok: true, status, eventId: EVENT_ID });
    assert.deepEqual(Object.keys(body), ['ok', 'status', 'eventId']);
    assert.equal(calls, 1);
  }
});

test('digest conflict is a 409 with no success-shaped response', async () => {
  const response = await handleMastermindMemoryEventPost(request(canonical(event())), {
    env: BASE_ENV,
    getSql: () => fakeSql([{ status: 'conflict', eventId: EVENT_ID }]),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await json(response), {
    ok: false,
    code: 'EVENT_ID_CONFLICT',
    message: 'The event ID is already committed with different content.',
  });
});

test('declared oversized bodies and invalid UTF-8 fail before database access', async () => {
  let databaseOpened = false;
  const oversized = request('{}', { headers: { 'content-length': String(64 * 1024 + 1) } });
  const oversizedResponse = await handleMastermindMemoryEventPost(oversized, {
    env: BASE_ENV,
    getSql: () => { databaseOpened = true; return fakeSql([]); },
  });
  assert.equal(oversizedResponse.status, 413);
  assert.equal((await json(oversizedResponse)).code, 'EVENT_TOO_LARGE');
  assert.equal(databaseOpened, false);

  const invalidUtf8 = new Request('http://127.0.0.1:3000/api/memory/events', {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3000',
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: new Uint8Array([0xc3, 0x28]),
  });
  const utf8Response = await handleMastermindMemoryEventPost(invalidUtf8, {
    env: BASE_ENV,
    getSql: () => { databaseOpened = true; return fakeSql([]); },
  });
  assert.equal(utf8Response.status, 400);
  assert.equal((await json(utf8Response)).code, 'EVENT_INVALID_UTF8');
  assert.equal(databaseOpened, false);
});

test('migration defines effect-once receipts, scoped state, and only session-rollup vector jobs', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationPath = path.resolve(here, '../../../../memory-system/migrations/001_mastermind_domain_events_v1.sql');
  const sql = await fs.readFile(migrationPath, 'utf8');
  assert.match(sql, /mastermind_domain_event_receipts_v1/);
  assert.match(sql, /PRIMARY KEY \(household_id, session_id, action_id\)/);
  assert.match(sql, /embedding vector\(768\) NULL/);
  assert.match(sql, /projection_kind = 'companion\.session\.rollup'/);
  assert.match(sql, /memory_key text PRIMARY KEY/);
  assert.match(sql, /companion-session\/v1\/%s\/%s/);
  assert.match(sql, /IF v_actions > 0 THEN/);
  assert.match(sql, /ORDER BY summary\.action_kind, summary\.status/);
  assert.match(sql, /ON CONFLICT \(memory_key\) DO UPDATE/);
  assert.match(sql, /ON CONFLICT ON CONSTRAINT mastermind_domain_event_receipts_v1_pkey DO NOTHING/);
  assert.doesNotMatch(sql, /ON CONFLICT \(event_id\)/);
  assert.doesNotMatch(sql, /FILTER \(WHERE status\b/);
  assert.match(sql, /FILTER \(WHERE action\.status = 'succeeded'\)/);
  assert.match(sql, /SELECT action\.action_kind, action\.status, count\(\*\)::integer AS action_count/);
  assert.match(sql, /GROUP BY action\.action_kind, action\.status/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_event_id::text, 0\)\)/);
  assert.match(sql, /hashtextextended\(p_household_id \|\| chr\(31\) \|\| p_session_id::text, 1\)/);
  const actionMutation = sql.indexOf('INSERT INTO public.mastermind_companion_actions_v1');
  const convergentRefresh = sql.indexOf('-- A disconnect can record session.ended');
  assert.ok(actionMutation >= 0 && convergentRefresh > actionMutation);
  assert.match(
    sql.slice(convergentRefresh),
    /IF p_kind = 'session\.ended' OR p_kind IN \('action\.requested', 'action\.completed', 'action\.blocked'\) THEN/,
  );
  assert.match(sql.slice(convergentRefresh), /v_end_event_id IS NOT NULL AND v_ended_at IS NOT NULL/);
  assert.match(sql, /started_at = GREATEST\(COALESCE\(started_at, '-infinity'::timestamptz\), p_occurred_at\)/);
  assert.match(sql, /ended_at = GREATEST\(COALESCE\(ended_at, '-infinity'::timestamptz\), p_occurred_at\)/);
  assert.match(sql, /p_occurred_at = started_at[\s\S]*p_event_id::text >= COALESCE\(start_event_id::text, ''\)/);
  assert.match(sql, /p_occurred_at = ended_at[\s\S]*p_event_id::text >= COALESCE\(end_event_id::text, ''\)/);
  assert.match(
    sql,
    /WHEN ended_at IS NOT NULL AND \(started_at IS NULL OR ended_at >= started_at\) THEN 'ended'[\s\S]*WHEN started_at IS NOT NULL THEN 'active'/,
  );
  assert.match(sql.slice(convergentRefresh), /v_session_state = 'ended'/);
  assert.match(sql.slice(convergentRefresh), /SELECT action\.request_event_id, action\.requested_at/);
  assert.match(sql.slice(convergentRefresh), /SELECT action\.terminal_event_id, action\.terminal_at/);
  assert.match(sql.slice(convergentRefresh), /ORDER BY contributor\.occurred_at DESC, contributor\.event_id::text DESC/);
  assert.match(sql, /v_existing_player_id IS DISTINCT FROM p_player_id/);
  assert.match(sql, /v_existing_world_ref IS DISTINCT FROM p_world_ref/);
  assert.match(sql, /IF p_kind = 'session\.started'/);
  assert.match(sql, /ELSIF p_kind = 'session\.ended'/);
  assert.equal((sql.match(/INSERT INTO public\.mastermind_memory_projection_jobs_v1/g) ?? []).length, 1);
  const contentTemplate = sql.match(/'Minecraft companion session actions:[\s\S]*?v_cancelled\n\s*\)/)?.[0] ?? '';
  assert.doesNotMatch(contentTemplate, /v_close_(?:code|reason)/);
  assert.doesNotMatch(sql, /harmonic_memories/i);
});
