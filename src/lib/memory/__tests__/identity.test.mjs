import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeMastermindMemoryRead,
  commitMastermindIdentityCommand,
  handleMastermindIdentityPost,
  prepareMastermindIdentityCommand,
} from '../identity.ts';

const TOKEN = 't'.repeat(48);
const COMMAND_ID = '11111111-1111-8111-8111-111111111111';
const ACTOR_ID = '22222222-2222-8222-8222-222222222222';
const PLAYER_ID = '33333333-3333-8333-8333-333333333333';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function command(overrides = {}) {
  return {
    commandId: COMMAND_ID,
    action: 'consent.set',
    householdId: 'family-local',
    actorPlayerId: ACTOR_ID,
    expectedRevision: 4,
    payload: {
      playerId: PLAYER_ID,
      purpose: 'recall',
      decision: 'allow',
    },
    ...overrides,
  };
}

function fakeSql(rows) {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  sql.calls = calls;
  return sql;
}

function requestFor(value, overrides = {}) {
  const body = typeof value === 'string' ? value : canonical(value);
  const { headers = {}, ...requestOverrides } = overrides;
  return new Request('http://127.0.0.1:3000/api/memory/identity', {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3000',
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      ...headers,
    },
    body,
    ...requestOverrides,
  });
}

test('prepares canonical bootstrap, player, binding, consent, and archive commands', () => {
  const cases = [
    {
      value: {
        commandId: COMMAND_ID,
        action: 'household.bootstrap',
        householdId: 'family-local',
        expectedRevision: 0,
        payload: { playerId: PLAYER_ID, householdDisplayName: 'Our Family', playerDisplayName: 'Parent' },
      },
      expected: { actorPlayerId: null, subjectPlayerId: PLAYER_ID, role: 'parent', householdDisplayName: 'Our Family' },
    },
    {
      value: command({ action: 'player.register', expectedRevision: 0, payload: { playerId: PLAYER_ID, displayName: 'Kid', role: 'child' } }),
      expected: { subjectPlayerId: PLAYER_ID, role: 'child', playerDisplayName: 'Kid' },
    },
    {
      value: command({ action: 'identity.bind', payload: { playerId: PLAYER_ID, provider: 'minecraft-java', subject: 'a'.repeat(32), alias: 'Player_1' } }),
      expected: { subjectPlayerId: PLAYER_ID, provider: 'minecraft-java', providerSubject: 'a'.repeat(32), providerAlias: 'Player_1' },
    },
    {
      value: command(),
      expected: { subjectPlayerId: PLAYER_ID, purpose: 'recall', decision: 'allow' },
    },
    {
      value: command({ action: 'player.archive', payload: { playerId: PLAYER_ID, confirmation: 'ARCHIVE' } }),
      expected: { subjectPlayerId: PLAYER_ID },
    },
  ];

  for (const entry of cases) {
    const prepared = prepareMastermindIdentityCommand(canonical(entry.value));
    assert.equal(prepared.canonicalJson, canonical(entry.value));
    assert.match(prepared.digest, /^[a-f0-9]{64}$/);
    for (const [key, expected] of Object.entries(entry.expected)) {
      assert.equal(prepared.parameters[key], expected);
    }
  }
});

test('rejects noncanonical, unknown, malformed, and unconfirmed identity commands', () => {
  const valid = command();
  assert.throws(() => prepareMastermindIdentityCommand(JSON.stringify(valid)), { code: 'IDENTITY_COMMAND_NON_CANONICAL' });
  assert.throws(() => prepareMastermindIdentityCommand(canonical({ ...valid, extra: true })), { code: 'IDENTITY_COMMAND_INVALID' });
  assert.throws(() => prepareMastermindIdentityCommand(canonical(command({ expectedRevision: 0 }))), { code: 'IDENTITY_COMMAND_INVALID' });
  assert.throws(() => prepareMastermindIdentityCommand(canonical(command({
    action: 'identity.bind',
    payload: { playerId: PLAYER_ID, provider: 'minecraft-java', subject: 'not-a-profile' },
  }))), { code: 'IDENTITY_COMMAND_INVALID' });
  assert.throws(() => prepareMastermindIdentityCommand(canonical(command({
    action: 'player.archive',
    payload: { playerId: PLAYER_ID, confirmation: 'archive' },
  }))), { code: 'IDENTITY_CONFIRMATION_REQUIRED' });
});

test('commits only through the typed idempotent identity function', async () => {
  const prepared = prepareMastermindIdentityCommand(canonical(command()));
  const sql = fakeSql([{
    status: 'applied',
    commandId: COMMAND_ID,
    householdRevision: '3',
    playerRevision: '5',
    playerId: PLAYER_ID,
  }]);
  const result = await commitMastermindIdentityCommand(sql, prepared);
  assert.deepEqual(result, {
    status: 'applied', commandId: COMMAND_ID, householdRevision: 3, playerRevision: 5, playerId: PLAYER_ID,
  });
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /apply_mastermind_identity_command_v1/);
  assert.deepEqual(sql.calls[0].values, [
    COMMAND_ID, prepared.digest, 'consent.set', 'family-local', ACTOR_ID, PLAYER_ID, 4,
    null, null, null, null, null, null, 'recall', 'allow',
  ]);
});

test('rejects malformed database results and represents digest conflicts without state', async () => {
  const prepared = prepareMastermindIdentityCommand(canonical(command()));
  const conflict = fakeSql([{
    status: 'conflict', commandId: COMMAND_ID, householdRevision: null, playerRevision: null, playerId: null,
  }]);
  assert.deepEqual(await commitMastermindIdentityCommand(conflict, prepared), {
    status: 'conflict', commandId: COMMAND_ID, householdRevision: null, playerRevision: null, playerId: null,
  });
  await assert.rejects(
    commitMastermindIdentityCommand(fakeSql([{ status: 'applied', commandId: COMMAND_ID }]), prepared),
    /invalid result/,
  );
});

test('identity route is service-only and does not open the database on rejection', async () => {
  let opened = 0;
  const response = await handleMastermindIdentityPost(requestFor(command(), {
    headers: { authorization: `Bearer ${'x'.repeat(48)}` },
  }), {
    env: { MASTERMIND_LOCAL_CONTROL_ENABLED: 'true', MASTERMIND_CONTROL_TOKEN: TOKEN },
    getSql() { opened += 1; return fakeSql([]); },
  });
  assert.equal(response.status, 401);
  assert.equal(opened, 0);
  assert.deepEqual(await response.json(), {
    ok: false, code: 'UNAUTHORIZED', message: 'A valid local control bearer token is required.',
  });
});

test('identity route returns only exact applied or duplicate receipts', async () => {
  for (const status of ['applied', 'duplicate']) {
    const sql = fakeSql([{
      status, commandId: COMMAND_ID, householdRevision: '3', playerRevision: '5', playerId: PLAYER_ID,
    }]);
    const response = await handleMastermindIdentityPost(requestFor(command()), {
      env: { MASTERMIND_LOCAL_CONTROL_ENABLED: 'true', MASTERMIND_CONTROL_TOKEN: TOKEN },
      getSql: () => sql,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true, status, commandId: COMMAND_ID, householdRevision: 3, playerRevision: 5, playerId: PLAYER_ID,
    });
  }
});

test('identity route turns command-id collisions into a fixed 409', async () => {
  const sql = fakeSql([{
    status: 'conflict', commandId: COMMAND_ID, householdRevision: null, playerRevision: null, playerId: null,
  }]);
  const response = await handleMastermindIdentityPost(requestFor(command()), {
    env: { MASTERMIND_LOCAL_CONTROL_ENABLED: 'true', MASTERMIND_CONTROL_TOKEN: TOKEN },
    getSql: () => sql,
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'IDENTITY_COMMAND_CONFLICT',
    message: 'The command ID is already committed with different content.',
  });
});

test('identity route maps revision and authorization failures without exposing database text', async () => {
  for (const [databaseCode, status, code] of [
    ['40001', 409, 'IDENTITY_REVISION_CONFLICT'],
    ['42501', 403, 'IDENTITY_COMMAND_NOT_AUTHORIZED'],
    ['23505', 409, 'IDENTITY_BINDING_CONFLICT'],
  ]) {
    const sql = () => Promise.reject(Object.assign(new Error('private database path C:\\secret'), { code: databaseCode }));
    const response = await handleMastermindIdentityPost(requestFor(command()), {
      env: { MASTERMIND_LOCAL_CONTROL_ENABLED: 'true', MASTERMIND_CONTROL_TOKEN: TOKEN },
      getSql: () => sql,
    });
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.doesNotMatch(JSON.stringify(body), /private database|C:\\\\secret/);
  }
});

test('retrieval authorization is delegated to one default-deny database predicate', async () => {
  for (const allowed of [false, true]) {
    const sql = fakeSql([{ allowed }]);
    assert.equal(await authorizeMastermindMemoryRead(sql, {
      householdId: 'family-local',
      actorPlayerId: ACTOR_ID,
      namespace: `player/${ACTOR_ID}/private`,
      visibility: 'private',
      candidatePlayerId: ACTOR_ID,
    }), allowed);
    assert.equal(sql.calls.length, 1);
    assert.match(sql.calls[0].text, /mastermind_can_read_memory_v1/);
    assert.deepEqual(sql.calls[0].values, ['family-local', ACTOR_ID, `player/${ACTOR_ID}/private`, 'private', ACTOR_ID]);
  }
});
