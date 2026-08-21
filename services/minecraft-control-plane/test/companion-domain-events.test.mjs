import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { attachCompanionDomainEventProducer } from '../src/domain-events/companion-producer.mjs';

const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_ID = '33333333-3333-4333-8333-333333333333';
const PLAYER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

class CompanionFixture extends EventEmitter {
  status() { return { sessionId: SESSION_ID }; }
}

test('projects only bounded session boundaries and terminal action summaries', async () => {
  const sessions = new CompanionFixture();
  const events = [];
  const producer = attachCompanionDomainEventProducer(sessions, {
    async enqueue(event) { events.push(event); },
  }, { playerId: PLAYER_ID, now: () => Date.parse('2026-08-14T12:00:05.000Z') });

  sessions.emit('ready', { sessionId: SESSION_ID, connectedAt: '2026-08-14T12:00:00.000Z', client: { accessToken: 'not-copied' } });
  sessions.emit('snapshot', { player: { position: { x: 1, y: 64, z: 2 } }, rawChat: 'not-copied' });
  sessions.emit('actionDispatched', {
    actionId: ACTION_ID, kind: 'skill.navigateTo', status: 'dispatched',
    dispatchedAt: '2026-08-14T12:00:01.000Z', deadlineAt: '2026-08-14T12:05:01.000Z',
    action: { args: { x: 1, y: 64, z: 2 } },
  });
  sessions.emit('actionStatus', { actionId: ACTION_ID, status: 'progress', progress: { detail: 'not-copied' } }, {
    actionId: ACTION_ID, kind: 'skill.navigateTo', status: 'progress',
  });
  sessions.emit('actionStatus', {
    actionId: ACTION_ID, status: 'succeeded', result: { code: 'arrived', detail: 'not-copied' },
  }, { actionId: ACTION_ID, kind: 'skill.navigateTo', status: 'succeeded' });
  sessions.emit('disconnect', { at: '2026-08-14T12:00:04.000Z', code: 1001, reason: 'companion-stopped' }, { sessionId: SESSION_ID });
  await producer.flush();

  assert.deepEqual(events.map((event) => event.kind), [
    'session.started', 'action.requested', 'action.completed', 'session.ended',
  ]);
  assert.deepEqual(events.map((event) => event.namespace), Array(4).fill(`session/${SESSION_ID}`));
  assert.equal(events.every((event) => event.visibility === 'private' && event.householdId === 'family-local'), true);
  assert.deepEqual(events.map((event) => event.playerId), Array(4).fill(PLAYER_ID));
  assert.deepEqual(events[2].payload, {
    actionId: ACTION_ID, actionKind: 'skill.navigateTo', status: 'succeeded', resultCode: 'arrived',
  });
  const encoded = JSON.stringify(events);
  assert.doesNotMatch(encoded, /accessToken|position|rawChat|detail|not-copied/);
  assert.equal(new Set(events.map((event) => event.eventId)).size, events.length);
});

test('rejects a non-canonical configured player identity', () => {
  const sessions = new CompanionFixture();
  const outbox = { async enqueue() {} };
  assert.throws(
    () => attachCompanionDomainEventProducer(sessions, outbox),
    /canonical lowercase UUID/,
  );
  assert.throws(
    () => attachCompanionDomainEventProducer(sessions, outbox, { playerId: PLAYER_ID.toUpperCase() }),
    /canonical lowercase UUID/,
  );
  assert.throws(
    () => attachCompanionDomainEventProducer(sessions, outbox, { playerId: 'not-a-player-id' }),
    /canonical lowercase UUID/,
  );
});

test('failed and cancelled actions become blocked summaries without raw messages', async () => {
  const sessions = new CompanionFixture();
  const events = [];
  const producer = attachCompanionDomainEventProducer(
    sessions,
    { async enqueue(event) { events.push(event); } },
    { playerId: PLAYER_ID },
  );
  sessions.emit('actionStatus', {
    actionId: ACTION_ID, status: 'failed', error: { code: 'path-unavailable', message: 'private raw failure' },
  }, { actionId: ACTION_ID, kind: 'skill.navigateTo' });
  sessions.emit('actionStatus', {
    actionId: '44444444-4444-4444-8444-444444444444', status: 'cancelled', cancellation: { reason: 'operator' },
  }, { actionId: '44444444-4444-4444-8444-444444444444', kind: 'skill.explore' });
  await producer.flush();
  assert.deepEqual(events.map((event) => event.kind), ['action.blocked', 'action.blocked']);
  assert.equal(events[0].payload.errorCode, 'path-unavailable');
  assert.equal(events[1].payload.cancellationReason, 'operator');
  assert.doesNotMatch(JSON.stringify(events), /private raw failure|message/);
});

test('reconnects under one lifecycle session receive distinct occurrence ids', async () => {
  const sessions = new CompanionFixture();
  const events = [];
  const producer = attachCompanionDomainEventProducer(
    sessions,
    { async enqueue(event) { events.push(event); } },
    { playerId: PLAYER_ID },
  );
  for (const startedAt of ['2026-08-14T12:00:00.000Z', '2026-08-14T12:01:00.000Z']) {
    sessions.emit('ready', { sessionId: SESSION_ID, connectedAt: startedAt });
    sessions.emit('disconnect', { at: new Date(Date.parse(startedAt) + 30_000).toISOString(), code: 1001, reason: 'reconnect' }, { sessionId: SESSION_ID });
  }
  await producer.flush();
  assert.deepEqual(events.map((event) => event.kind), ['session.started', 'session.ended', 'session.started', 'session.ended']);
  assert.equal(new Set(events.map((event) => event.eventId)).size, 4);
});

test('outbox failures are caught, reported, and never propagate through EventEmitter', async () => {
  const sessions = new CompanionFixture();
  const errors = [];
  let attempts = 0;
  const producer = attachCompanionDomainEventProducer(sessions, {
    async enqueue() { attempts += 1; if (attempts === 1) throw Object.assign(new Error('disk unavailable'), { code: 'EVENT_OUTBOX_WRITE_FAILED' }); },
  }, { playerId: PLAYER_ID, onError(error) { errors.push(error.code); throw new Error('observer failure'); } });
  assert.doesNotThrow(() => sessions.emit('ready', { sessionId: SESSION_ID, connectedAt: '2026-08-14T12:00:00.000Z' }));
  assert.doesNotThrow(() => sessions.emit('disconnect', { at: '2026-08-14T12:00:01.000Z', code: 1001, reason: 'closed' }, { sessionId: SESSION_ID }));
  assert.deepEqual(await producer.flush(), { enabled: true, accepted: 1, failed: 1, lastErrorCode: 'EVENT_OUTBOX_WRITE_FAILED' });
  assert.deepEqual(errors, ['EVENT_OUTBOX_WRITE_FAILED']);
});

test('close removes listeners, drains accepted writes, and unsupported mock sources stay disabled', async () => {
  const sessions = new CompanionFixture();
  const events = [];
  const producer = attachCompanionDomainEventProducer(
    sessions,
    { async enqueue(event) { events.push(event); } },
    { playerId: PLAYER_ID },
  );
  sessions.emit('ready', { sessionId: SESSION_ID, connectedAt: '2026-08-14T12:00:00.000Z' });
  assert.deepEqual(await producer.close(), { enabled: false, accepted: 1, failed: 0, lastErrorCode: null });
  sessions.emit('disconnect', { at: '2026-08-14T12:00:01.000Z', code: 1001, reason: 'closed' }, { sessionId: SESSION_ID });
  assert.equal(events.length, 1);

  const disabled = attachCompanionDomainEventProducer(
    {},
    { async enqueue() { throw new Error('must not run'); } },
    { playerId: PLAYER_ID },
  );
  assert.deepEqual(await disabled.close(), { enabled: false, accepted: 0, failed: 0, lastErrorCode: null });
});
