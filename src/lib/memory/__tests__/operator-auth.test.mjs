import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  MemoryOperatorSessionRegistry,
  MemoryOperatorUnlockLimiter,
  authorizeMemoryOperatorBrowserRequest,
  createMemoryOperatorPinVerifier,
  createMemoryOperatorSession,
  readMemoryOperatorConfiguration,
  readMemoryOperatorSession,
  verifyMemoryOperatorPin,
} from '../operator-auth.ts';

const PLAYER_ID = '11111111-1111-8111-8111-111111111111';
const fakeScrypt = async (password, salt, keyLength) => {
  assert.equal(keyLength, 32);
  return crypto.createHash('sha256').update(salt).update(password).digest();
};

async function fixtureEnv(overrides = {}) {
  const verifier = await createMemoryOperatorPinVerifier('246810', {
    randomBytes: () => Buffer.alloc(16, 7),
    scrypt: fakeScrypt,
  });
  return {
    MASTERMIND_LOCAL_CONTROL_ENABLED: 'true',
    MASTERMIND_CONTROL_TOKEN: 't'.repeat(48),
    MASTERMIND_LOCAL_SUPERVISOR_ID: 'a'.repeat(32),
    MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT: verifier,
    MASTERMIND_MEMORY_OPERATOR_PLAYER_ID: PLAYER_ID,
    ...overrides,
  };
}

function browserRequest(path = '/api/memory/operator/status', overrides = {}) {
  const { headers = {}, url = `http://127.0.0.1:3000${path}`, ...requestOverrides } = overrides;
  return new Request(url, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    body: '{}',
    ...requestOverrides,
  });
}

test('configuration is local, complete, canonical, and partial Clerk fails closed', async () => {
  const env = await fixtureEnv();
  assert.deepEqual(readMemoryOperatorConfiguration(env), {
    householdId: 'family-local',
    playerId: PLAYER_ID,
    pinVerifier: env.MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT,
    signingKey: env.MASTERMIND_CONTROL_TOKEN,
    supervisorId: env.MASTERMIND_LOCAL_SUPERVISOR_ID,
    clerkRequired: false,
  });
  assert.throws(() => readMemoryOperatorConfiguration({ ...env, VERCEL: '1' }), { code: 'MEMORY_OPERATOR_LOCAL_ONLY' });
  assert.throws(() => readMemoryOperatorConfiguration({ ...env, MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT: 'bad' }), {
    code: 'MEMORY_OPERATOR_CONFIGURATION_INVALID',
  });
  assert.throws(() => readMemoryOperatorConfiguration({ ...env, CLERK_SECRET_KEY: 'partial' }), {
    code: 'MEMORY_OPERATOR_CONFIGURATION_INVALID',
  });
  assert.equal(readMemoryOperatorConfiguration({
    ...env,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test',
    CLERK_SECRET_KEY: 'sk_test',
    OWNER_CLERK_USER_ID: 'user_owner',
  }).clerkRequired, true);
});

test('private-PC defaults supply the retained parent identity and baked PIN verifier', async () => {
  const env = await fixtureEnv({
    MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT: '',
    MASTERMIND_MEMORY_OPERATOR_PLAYER_ID: '',
    MASTERMIND_MEMORY_HOUSEHOLD_ID: '',
  });
  const config = readMemoryOperatorConfiguration(env);
  assert.equal(config.householdId, 'family-local');
  assert.equal(config.playerId, 'ba0e9c2a-2f83-4833-8047-2ef3371f4fbd');
  assert.equal(await verifyMemoryOperatorPin('795200', config), true);
  assert.equal(await verifyMemoryOperatorPin('795201', config), false);
});

test('browser authorization requires exact local host, path, origin, and fetch site', async () => {
  const env = await fixtureEnv();
  assert.equal(authorizeMemoryOperatorBrowserRequest(browserRequest(), '/api/memory/operator/status', env).playerId, PLAYER_ID);
  assert.equal(authorizeMemoryOperatorBrowserRequest(browserRequest('/api/memory/operator/status', {
    url: 'http://localhost:3000/api/memory/operator/status',
  }), '/api/memory/operator/status', env).playerId, PLAYER_ID);
  assert.equal(authorizeMemoryOperatorBrowserRequest(browserRequest('/api/memory/operator/status', {
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
  }), '/api/memory/operator/status', env).playerId, PLAYER_ID);
  for (const request of [
    browserRequest('/api/memory/operator/search'),
    browserRequest('/api/memory/operator/status', {
      url: 'http://localhost:3001/api/memory/operator/status',
    }),
    browserRequest('/api/memory/operator/status', {
      url: 'http://localhost:3000/api/memory/operator/status?extra=1',
    }),
    browserRequest('/api/memory/operator/status', { headers: { origin: 'http://localhost:3000' } }),
    browserRequest('/api/memory/operator/status', { headers: { 'sec-fetch-site': 'cross-site' } }),
    new Request('http://example.com/api/memory/operator/status', { method: 'POST' }),
  ]) {
    assert.throws(() => authorizeMemoryOperatorBrowserRequest(request, '/api/memory/operator/status', env));
  }
});

test('PIN verifier is slow-function injectable and rejects malformed candidates without skipping work', async () => {
  const config = readMemoryOperatorConfiguration(await fixtureEnv());
  let calls = 0;
  const observed = async (...args) => { calls += 1; return fakeScrypt(...args); };
  assert.equal(await verifyMemoryOperatorPin('246810', config, observed), true);
  assert.equal(await verifyMemoryOperatorPin('111111', config, observed), false);
  assert.equal(await verifyMemoryOperatorPin('not-a-pin', config, observed), false);
  assert.equal(calls, 3);
});

test('session is supervisor-bound, absolute, signed, and locally revocable', async () => {
  const config = readMemoryOperatorConfiguration(await fixtureEnv());
  const created = createMemoryOperatorSession(config, {
    now: 1_800_000_000_000,
    randomBytes: () => Buffer.alloc(16, 9),
  });
  assert.match(created.setCookie, /HttpOnly; SameSite=Strict; Path=\/api\/memory\/operator; Max-Age=600$/);
  const request = browserRequest('/api/memory/operator/status', {
    headers: { cookie: `mastermind_memory_operator_v1=${created.token}` },
  });
  assert.deepEqual(readMemoryOperatorSession(request, config, 1_800_000_100_000), created.session);
  assert.equal(readMemoryOperatorSession(request, config, 1_800_000_601_000), null);
  assert.equal(readMemoryOperatorSession(request, { ...config, supervisorId: 'b'.repeat(32) }, 1_800_000_100_000), null);

  const registry = new MemoryOperatorSessionRegistry();
  registry.activate(created.token);
  assert.equal(registry.isActive(created.token), true);
  registry.activate('replacement');
  assert.equal(registry.isActive(created.token), false);
  registry.clear();
  assert.equal(registry.isActive('replacement'), false);
});

test('global limiter blocks after bounded failures and success resets it', () => {
  const limiter = new MemoryOperatorUnlockLimiter(2, 1_000, 5_000);
  limiter.assertAllowed(10_000);
  limiter.recordFailure(10_000);
  limiter.recordFailure(10_100);
  assert.throws(() => limiter.assertAllowed(10_200), { code: 'MEMORY_OPERATOR_RATE_LIMITED' });
  limiter.assertAllowed(15_100);
  limiter.recordSuccess();
  limiter.assertAllowed(15_101);
});
