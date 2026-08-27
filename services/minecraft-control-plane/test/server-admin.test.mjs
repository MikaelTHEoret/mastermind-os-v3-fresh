import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FamilyServerAdminManager, compileServerAdminCommand, validateServerAdminAction } from '../src/server-admin.mjs';

const requestId = '123e4567-e89b-42d3-a456-426614174000';
const generation = 'a'.repeat(64);

function baseInstance(status = 'running') {
  return { id: 'family-server', projectId: 'family-server', kind: 'server', status };
}

async function managerFixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-admin-'));
  await fs.mkdir(path.join(root, 'private'), { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let instance = baseInstance();
  const writes = [];
  const store = { async get() { return instance; } };
  const processes = {
    async withInstanceLock(_id, operation) { return operation(); },
    async inspectTypedAdminAvailabilityWithinInstanceLock() { return { running: true, reason: 'ready', launchGeneration: generation }; },
    async executeTypedAdminActionWithinInstanceLock(_id, action) { writes.push(action); return { acceptedAt: '2026-08-13T12:00:00.000Z' }; },
    ...overrides.processes,
  };
  const manager = new FamilyServerAdminManager(root, store, processes, { now: overrides.now ?? (() => '2026-08-13T12:00:00.000Z'), planTtlMs: 60_000 });
  await manager.initialize();
  return { manager, root, writes, setInstance(value) { instance = value; } };
}

test('validates and compiles every typed action to one fixed command', () => {
  const cases = [
    [{ requestId, kind: 'players.refresh' }, 'list'],
    [{ requestId, kind: 'whitelist.refresh' }, 'whitelist list'],
    [{ requestId, kind: 'broadcast', message: 'Hello family' }, 'say Hello family'],
    [{ requestId, kind: 'whitelist.set', enabled: true }, 'whitelist on'],
    [{ requestId, kind: 'whitelist.add', player: 'Java_User' }, 'whitelist add Java_User'],
    [{ requestId, kind: 'whitelist.remove', player: 'Java_User' }, 'whitelist remove Java_User'],
    [{ requestId, kind: 'player.kick', player: 'Java_User' }, 'kick Java_User Removed by a server operator'],
    [{ requestId, kind: 'player.ban', player: 'Java_User', reasonCode: 'rule-violation' }, 'ban Java_User Server rule violation'],
    [{ requestId, kind: 'player.pardon', player: 'Java_User' }, 'pardon Java_User'],
    [{ requestId, kind: 'player.op', player: 'Java_User' }, 'op Java_User'],
    [{ requestId, kind: 'player.deop', player: 'Java_User' }, 'deop Java_User'],
  ];
  for (const [input, command] of cases) assert.equal(compileServerAdminCommand(input).command, command);
});

test('rejects command injection, selectors, Unicode, controls, unknown fields, and raw commands', () => {
  for (const message of ['hello\nstop', 'hello\rstop', 'hello\0stop', 'héllo', '\u2028', ' trailing ']) {
    assert.throws(() => validateServerAdminAction({ requestId, kind: 'broadcast', message }));
  }
  for (const player of ['@a', '/stop', 'Two Words', 'éclair', 'ab', 'a'.repeat(17), 'x\nstop']) {
    assert.throws(() => validateServerAdminAction({ requestId, kind: 'player.op', player }));
  }
  assert.throws(() => validateServerAdminAction({ requestId, kind: 'raw', command: 'stop' }));
  assert.throws(() => validateServerAdminAction({ requestId, kind: 'players.refresh', extra: true }));
});

test('reports truthful unavailable status without inferred player data', async (t) => {
  const fixture = await managerFixture(t, {
    processes: { async inspectTypedAdminAvailabilityWithinInstanceLock() { return { running: true, reason: 'process-unavailable', launchGeneration: null }; } },
  });
  assert.deepEqual(await fixture.manager.status('family-server'), {
    available: false, reason: 'process-unavailable', running: true,
    playerVisibility: 'unavailable', onlinePlayers: null, whitelist: { enabled: null, players: null },
    checkedAt: '2026-08-13T12:00:00.000Z',
  });
});

test('broadcast is delivered once and exact replay returns its durable operation', async (t) => {
  const fixture = await managerFixture(t);
  const action = { requestId, kind: 'broadcast', message: 'Hello family' };
  const first = await fixture.manager.execute('family-server', action);
  const replay = await fixture.manager.execute('family-server', action);
  assert.equal(first.state, 'delivered-unconfirmed');
  assert.deepEqual(replay, first);
  assert.equal(fixture.writes.length, 1);
  fixture.setInstance(baseInstance('stopped'));
  assert.deepEqual(await fixture.manager.operation('family-server', requestId), first);
  await assert.rejects(() => fixture.manager.execute('family-server', { ...action, message: 'Different' }), (error) => error.code === 'ADMIN_REQUEST_ID_CONFLICT');
});

test('protected actions require an exact one-use generation-bound plan', async (t) => {
  const fixture = await managerFixture(t);
  const action = { kind: 'player.op', player: 'Java_User' };
  const plan = await fixture.manager.createPlan('family-server', { requestId, action });
  assert.equal(plan.confirmation, 'CONFIRM OPERATOR CHANGE');
  const operation = await fixture.manager.execute('family-server', {
    requestId, ...action, approval: { planId: plan.planId, confirmation: plan.confirmation },
  });
  assert.equal(operation.state, 'delivered-unconfirmed');
  assert.equal(fixture.writes.length, 1);
  await assert.rejects(() => fixture.manager.execute('family-server', {
    requestId: '223e4567-e89b-42d3-a456-426614174000', ...action,
    approval: { planId: plan.planId, confirmation: plan.confirmation },
  }), (error) => error.code === 'ADMIN_APPROVAL_INVALID');
});

test('plans expire, reject changed launch generations, and bind the exact action digest', async (t) => {
  let now = '2026-08-13T12:00:00.000Z';
  let liveGeneration = generation;
  const fixture = await managerFixture(t, {
    now: () => now,
    processes: { async inspectTypedAdminAvailabilityWithinInstanceLock() { return { running: true, reason: 'ready', launchGeneration: liveGeneration }; } },
  });
  const action = { kind: 'player.ban', player: 'Java_User', reasonCode: 'unsafe-behavior' };
  const plan = await fixture.manager.createPlan('family-server', { requestId, action });
  await assert.rejects(() => fixture.manager.execute('family-server', {
    requestId, kind: 'player.ban', player: 'Other_User', reasonCode: 'unsafe-behavior',
    approval: { planId: plan.planId, confirmation: plan.confirmation },
  }), (error) => error.code === 'ADMIN_APPROVAL_INVALID');
  liveGeneration = 'b'.repeat(64);
  await assert.rejects(() => fixture.manager.execute('family-server', {
    requestId, ...action, approval: { planId: plan.planId, confirmation: plan.confirmation },
  }), (error) => error.code === 'ADMIN_APPROVAL_INVALID');
  liveGeneration = generation;
  now = '2026-08-13T12:02:00.000Z';
  await assert.rejects(() => fixture.manager.execute('family-server', {
    requestId, ...action, approval: { planId: plan.planId, confirmation: plan.confirmation },
  }), (error) => error.code === 'ADMIN_APPROVAL_INVALID');
  assert.equal(fixture.writes.length, 0);
});

test('concurrent exact replays serialize to one command delivery', async (t) => {
  let calls = 0;
  const fixture = await managerFixture(t, {
    processes: { async executeTypedAdminActionWithinInstanceLock() { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { acceptedAt: '2026-08-13T12:00:00.000Z' }; } },
  });
  const action = { requestId, kind: 'broadcast', message: 'Only once' };
  const [first, second] = await Promise.all([
    fixture.manager.execute('family-server', action),
    fixture.manager.execute('family-server', action),
  ]);
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test('completion unknown creates a durable non-replayable tombstone', async (t) => {
  let calls = 0;
  const fixture = await managerFixture(t, {
    processes: { async executeTypedAdminActionWithinInstanceLock() { calls += 1; throw Object.assign(new Error('private C:\\secret'), { code: 'ADMIN_COMPLETION_UNKNOWN', statusCode: 409 }); } },
  });
  const action = { requestId, kind: 'broadcast', message: 'Hello' };
  assert.equal((await fixture.manager.execute('family-server', action)).state, 'delivery-unknown');
  assert.equal((await fixture.manager.operation('family-server', requestId)).state, 'delivery-unknown');
  const replay = await fixture.manager.execute('family-server', action);
  assert.equal(replay.state, 'delivery-unknown');
  assert.equal(calls, 1);
});

test('startup reconciles a pending crash tombstone to delivery unknown', async (t) => {
  const fixture = await managerFixture(t);
  const file = path.join(fixture.root, 'private', 'server-administration', 'ledger.json');
  const ledger = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{"schemaVersion":2,"operations":[],"plans":[]}'));
  ledger.operations.push({
    instanceId: 'family-server', requestId, actionDigest: 'b'.repeat(64), kind: 'broadcast', state: 'pending',
    createdAt: '2026-08-13T11:00:00.000Z', updatedAt: '2026-08-13T11:00:00.000Z', messageLength: 5,
  });
  await fs.writeFile(file, JSON.stringify(ledger));
  const restarted = new FamilyServerAdminManager(fixture.root, { async get() { return baseInstance(); } }, {
    async withInstanceLock(_id, operation) { return operation(); },
  }, { now: () => '2026-08-13T12:00:00.000Z' });
  await restarted.initialize();
  assert.equal((await restarted.operation('family-server', requestId)).state, 'delivery-unknown');
});

test('corrupt ledger content fails closed as private journal unavailable', async (t) => {
  const fixture = await managerFixture(t);
  const file = path.join(fixture.root, 'private', 'server-administration', 'ledger.json');
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 2, operations: [{
    instanceId: 'family-server', requestId: 'not-a-uuid', actionDigest: 'b'.repeat(64), kind: 'broadcast', state: 'pending',
    createdAt: '2026-08-13T11:00:00.000Z', updatedAt: '2026-08-13T11:00:00.000Z',
  }], plans: [] }));
  const restarted = new FamilyServerAdminManager(fixture.root, { async get() { return baseInstance(); } }, {});
  await assert.rejects(() => restarted.initialize(), (error) => error.code === 'ADMIN_JOURNAL_UNAVAILABLE' && error.statusCode === 503);
});

test('initialization rejects a planted private junction before touching its outside target', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-admin-root-'));
  const victim = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-admin-victim-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(victim, { recursive: true, force: true }));
  await fs.symlink(victim, path.join(root, 'private'), process.platform === 'win32' ? 'junction' : 'dir');
  const manager = new FamilyServerAdminManager(root, { async get() { return baseInstance(); } }, {});
  await assert.rejects(() => manager.initialize(), (error) => error.code === 'ADMIN_JOURNAL_UNAVAILABLE');
  assert.deepEqual(await fs.readdir(victim), []);
});

test('audit failure before stdin fails closed with zero command writes', async (t) => {
  const fixture = await managerFixture(t);
  const audit = path.join(fixture.root, 'private', 'server-administration', 'audit');
  await fs.mkdir(path.join(audit, 'audit.jsonl'));
  await assert.rejects(() => fixture.manager.execute('family-server', {
    requestId, kind: 'broadcast', message: 'Never delivered',
  }), (error) => error.code === 'ADMIN_AUDIT_UNAVAILABLE');
  assert.equal(fixture.writes.length, 0);
  assert.equal((await fixture.manager.operation('family-server', requestId)).state, 'rejected-before-delivery');
});

test('rolling audit stores no raw player, message, command, or path', async (t) => {
  const fixture = await managerFixture(t);
  await fixture.manager.execute('family-server', { requestId, kind: 'broadcast', message: 'Top Secret Message' });
  const secondId = '223e4567-e89b-42d3-a456-426614174000';
  const plan = await fixture.manager.createPlan('family-server', { requestId: secondId, action: { kind: 'player.op', player: 'Java_User' } });
  await fixture.manager.execute('family-server', {
    requestId: secondId, kind: 'player.op', player: 'Java_User',
    approval: { planId: plan.planId, confirmation: plan.confirmation },
  });
  const text = await fs.readFile(path.join(fixture.root, 'private', 'server-administration', 'audit', 'audit.jsonl'), 'utf8');
  assert.equal(text.includes('Top Secret Message'), false);
  assert.equal(text.includes('Java_User'), false);
  assert.equal(text.includes('say '), false);
});
