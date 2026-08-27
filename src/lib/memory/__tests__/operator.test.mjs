import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  MemoryOperatorSessionRegistry,
  MemoryOperatorUnlockCoordinator,
  MemoryOperatorUnlockLimiter,
  createMemoryOperatorPinVerifier,
} from '../operator-auth.ts';
import { handleMemoryOperatorPost } from '../operator.ts';

const PLAYER_ID = '11111111-1111-8111-8111-111111111111';
const PLAN_ID = '22222222-2222-8222-8222-222222222222';
const ACTION_ID = '33333333-3333-8333-8333-333333333333';
const SESSION_ID = '44444444-4444-8444-8444-444444444444';
const MEMORY_KEY = `companion-session/v1/family-local/${SESSION_ID}`;
const NOW = 1_800_000_000_000;

const fakeScrypt = async (password, salt) => crypto.createHash('sha256').update(salt).update(password).digest();

async function dependencies(sqlOverrides = {}) {
  const pinVerifier = await createMemoryOperatorPinVerifier('246810', {
    randomBytes: () => Buffer.alloc(16, 3),
    scrypt: fakeScrypt,
  });
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/verify_mastermind_memory_operator_v1/.test(text)) return Promise.resolve([{ allowed: true }]);
    if (/search_mastermind_operator_memories_v1/.test(text)) return Promise.resolve([{
      memoryKey: MEMORY_KEY,
      revision: '1',
      summary: 'Family Minecraft companion session: completed gather=1.',
      namespace: `session/${SESSION_ID}`,
      visibility: 'private',
      playerId: PLAYER_ID,
      worldRef: null,
      sessionId: SESSION_ID,
      occurredAt: '2027-01-15T08:00:00.000Z',
      state: 'active',
    }]);
    if (/create_mastermind_memory_forget_plan_v1/.test(text)) return Promise.resolve([{
      status: 'planned',
      planId: PLAN_ID,
      planDigest: values[1],
      memoryKey: MEMORY_KEY,
      expectedRevision: '1',
      notBefore: '2027-01-15T08:00:01.500Z',
      expiresAt: '2027-01-15T08:02:00.000Z',
    }]);
    if (/apply_mastermind_memory_forget_v1/.test(text)) return Promise.resolve([{
      status: 'applied', actionId: ACTION_ID, memoryKey: MEMORY_KEY, revision: '2', state: 'forgotten',
    }]);
    if (/apply_mastermind_memory_restore_v1/.test(text)) return Promise.resolve([{
      status: 'applied', actionId: ACTION_ID, memoryKey: MEMORY_KEY, revision: '3', state: 'active',
    }]);
    throw new Error('Unexpected SQL');
  };
  Object.assign(sql, sqlOverrides);
  return {
    value: {
      env: {
        MASTERMIND_LOCAL_CONTROL_ENABLED: 'true',
        MASTERMIND_CONTROL_TOKEN: 't'.repeat(48),
        MASTERMIND_LOCAL_SUPERVISOR_ID: 'a'.repeat(32),
        MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT: pinVerifier,
        MASTERMIND_MEMORY_OPERATOR_PLAYER_ID: PLAYER_ID,
      },
      getSql: () => sql,
      limiter: new MemoryOperatorUnlockLimiter(),
      sessions: new MemoryOperatorSessionRegistry(),
      unlocks: new MemoryOperatorUnlockCoordinator(),
      now: () => NOW,
      randomBytes: () => Buffer.alloc(16, 9),
      scrypt: fakeScrypt,
    },
    calls,
  };
}

function request(operation, body, cookie, overrides = {}) {
  const raw = JSON.stringify(body);
  const { headers = {}, ...requestOverrides } = overrides;
  return new Request(`http://127.0.0.1:3000/api/memory/operator/${operation}`, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: raw,
    ...requestOverrides,
  });
}

async function unlock(deps) {
  const response = await handleMemoryOperatorPost(request('unlock', { pin: '246810' }), 'unlock', deps);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  return setCookie.split(';')[0];
}

test('locked status, unlock, authenticated status, and explicit lock use only the signed cookie', async () => {
  const { value: deps, calls } = await dependencies();
  const locked = await handleMemoryOperatorPost(request('status', {}), 'status', deps);
  assert.deepEqual(await locked.json(), { ok: true, unlocked: false, expiresAt: null });
  assert.equal(calls.length, 0);

  const cookie = await unlock(deps);
  assert.equal(calls.filter((call) => /verify_mastermind/.test(call.text)).length, 1);
  const status = await handleMemoryOperatorPost(request('status', {}, cookie), 'status', deps);
  assert.deepEqual(await status.json(), {
    ok: true, unlocked: true, expiresAt: '2027-01-15T08:10:00.000Z',
  });

  const lock = await handleMemoryOperatorPost(request('lock', {}, cookie), 'lock', deps);
  assert.deepEqual(await lock.json(), { ok: true, unlocked: false, expiresAt: null });
  assert.match(lock.headers.get('set-cookie'), /Max-Age=0/);
  const relocked = await handleMemoryOperatorPost(request('search', { query: '', mode: 'active', limit: 10 }, cookie), 'search', deps);
  assert.equal(relocked.status, 401);
  assert.equal((await relocked.json()).code, 'MEMORY_OPERATOR_LOCKED');
});

test('a later explicit lock wins over an unlock already performing its PIN check', async () => {
  const { value: deps } = await dependencies();
  let signalPinCheck;
  let releasePinCheck;
  const pinCheckStarted = new Promise((resolve) => { signalPinCheck = resolve; });
  const pinCheckRelease = new Promise((resolve) => { releasePinCheck = resolve; });
  deps.scrypt = async (...arguments_) => {
    signalPinCheck();
    await pinCheckRelease;
    return fakeScrypt(...arguments_);
  };

  const pendingUnlock = handleMemoryOperatorPost(
    request('unlock', { pin: '246810' }),
    'unlock',
    deps,
  );
  await pinCheckStarted;
  const pendingLock = handleMemoryOperatorPost(request('lock', {}), 'lock', deps);
  releasePinCheck();

  const unlockResponse = await pendingUnlock;
  const cookie = unlockResponse.headers.get('set-cookie').split(';')[0];
  const lockResponse = await pendingLock;
  assert.deepEqual(await lockResponse.json(), { ok: true, unlocked: false, expiresAt: null });
  assert.match(lockResponse.headers.get('set-cookie'), /Max-Age=0/);

  const status = await handleMemoryOperatorPost(request('status', {}, cookie), 'status', deps);
  assert.deepEqual(await status.json(), { ok: true, unlocked: false, expiresAt: null });
});

test('a later explicit lock also wins while an earlier unlock awaits the optional owner gate', async () => {
  const { value: deps } = await dependencies();
  Object.assign(deps.env, {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_configured',
    CLERK_SECRET_KEY: 'sk_test_configured',
    OWNER_CLERK_USER_ID: 'owner_test_configured',
  });
  let signalOwnerCheck;
  let releaseOwnerCheck;
  const ownerCheckStarted = new Promise((resolve) => { signalOwnerCheck = resolve; });
  const ownerCheckRelease = new Promise((resolve) => { releaseOwnerCheck = resolve; });
  deps.requireOwner = async () => {
    signalOwnerCheck();
    await ownerCheckRelease;
    return { ok: true };
  };

  const pendingUnlock = handleMemoryOperatorPost(
    request('unlock', { pin: '246810' }),
    'unlock',
    deps,
  );
  await ownerCheckStarted;
  const pendingLock = handleMemoryOperatorPost(request('lock', {}), 'lock', deps);
  releaseOwnerCheck();

  const unlockResponse = await pendingUnlock;
  const cookie = unlockResponse.headers.get('set-cookie').split(';')[0];
  await pendingLock;
  const status = await handleMemoryOperatorPost(request('status', {}, cookie), 'status', deps);
  assert.deepEqual(await status.json(), { ok: true, unlocked: false, expiresAt: null });
});

test('search returns only bounded sanitized rows and reports honest ranking mode', async () => {
  const { value: deps } = await dependencies();
  const cookie = await unlock(deps);
  const response = await handleMemoryOperatorPost(request('search', {
    query: 'gather', mode: 'active', limit: 10,
  }, cookie), 'search', deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    mode: 'active',
    ranking: 'text',
    results: [{
      memoryKey: MEMORY_KEY,
      revision: 1,
      summary: 'Family Minecraft companion session: completed gather=1.',
      namespace: `session/${SESSION_ID}`,
      visibility: 'private',
      playerId: PLAYER_ID,
      worldRef: null,
      sessionId: SESSION_ID,
      occurredAt: '2027-01-15T08:00:00.000Z',
      state: 'active',
    }],
  });
});

test('forget planning, timed action, and restore are exact idempotent database commands', async () => {
  const { value: deps, calls } = await dependencies();
  const cookie = await unlock(deps);
  const planned = await handleMemoryOperatorPost(request('forget-plans', {
    planId: PLAN_ID, memoryKey: MEMORY_KEY, expectedRevision: 1,
  }, cookie), 'forget-plans', deps);
  const plannedBody = await planned.json();
  assert.match(plannedBody.planDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(plannedBody, {
    ok: true,
    status: 'planned',
    planId: PLAN_ID,
    planDigest: plannedBody.planDigest,
    memoryKey: MEMORY_KEY,
    expectedRevision: 1,
    notBefore: '2027-01-15T08:00:01.500Z',
    expiresAt: '2027-01-15T08:02:00.000Z',
  });

  const forgotten = await handleMemoryOperatorPost(request('forget-actions', {
    actionId: ACTION_ID, planId: PLAN_ID, planDigest: plannedBody.planDigest,
  }, cookie), 'forget-actions', deps);
  assert.deepEqual(await forgotten.json(), {
    ok: true, status: 'applied', actionId: ACTION_ID, memoryKey: MEMORY_KEY, revision: 2, state: 'forgotten',
  });

  const restored = await handleMemoryOperatorPost(request('restore-actions', {
    actionId: ACTION_ID, memoryKey: MEMORY_KEY, expectedRevision: 2,
  }, cookie), 'restore-actions', deps);
  assert.deepEqual(await restored.json(), {
    ok: true, status: 'applied', actionId: ACTION_ID, memoryKey: MEMORY_KEY, revision: 3, state: 'active',
  });
  assert.match(calls.find((call) => /create_mastermind/.test(call.text)).values[1], /^[a-f0-9]{64}$/);
  assert.match(calls.find((call) => /apply_mastermind_memory_forget/.test(call.text)).values[1], /^[a-f0-9]{64}$/);
});

test('browser cannot supply a principal, malformed requests are fixed, and locked requests never open the database', async () => {
  const { value: deps, calls } = await dependencies();
  const locked = await handleMemoryOperatorPost(request('search', {
    query: '', mode: 'active', limit: 10, householdId: 'other',
  }), 'search', deps);
  assert.equal(locked.status, 401);
  assert.equal(calls.length, 0);

  const cookie = await unlock(deps);
  const malformed = await handleMemoryOperatorPost(request('search', {
    query: '', mode: 'active', limit: 10, householdId: 'other',
  }, cookie), 'search', deps);
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    ok: false, code: 'MEMORY_OPERATOR_REQUEST_INVALID', message: 'The memory operator request is invalid.',
  });
});

test('missing migrations and private database text map to one safe setup error', async () => {
  const { value: deps } = await dependencies();
  const failingSql = () => Promise.reject(Object.assign(new Error('private C:\\database\\path'), { code: '42883' }));
  deps.getSql = () => failingSql;
  const response = await handleMemoryOperatorPost(request('unlock', { pin: '246810' }), 'unlock', deps);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'MEMORY_SETUP_REQUIRED');
  assert.doesNotMatch(JSON.stringify(body), /private|database\\path/);
});
