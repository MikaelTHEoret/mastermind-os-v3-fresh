import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMastermindDomainEvent, deterministicMastermindEventId } from '../src/domain-events/contract.mjs';
import { FileMastermindEventOutbox, MastermindEventOutboxError } from '../src/domain-events/outbox.mjs';

const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_ID = '33333333-3333-4333-8333-333333333333';
const PLAYER_ID = '44444444-4444-4444-8444-444444444444';

function domainEvent(index = 0, overrides = {}) {
  return createMastermindDomainEvent({
    eventId: deterministicMastermindEventId(['test', String(index)]),
    occurredAt: new Date(Date.parse('2026-08-14T12:00:00.000Z') + index).toISOString(),
    producer: 'minecraft-control-plane', domain: 'companion', kind: 'action.completed',
    namespace: `session/${SESSION_ID}`, householdId: 'family-local', sessionId: SESSION_ID,
    correlationId: ACTION_ID, visibility: 'private',
    payload: { actionId: ACTION_ID, actionKind: 'skill.navigateTo', status: 'succeeded', resultCode: `result${index}` },
    ...overrides,
  });
}

async function outboxFixture(t, options = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-event-outbox-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'private', 'shared-memory', 'outbox', 'v1');
  const outbox = new FileMastermindEventOutbox(root, options);
  await outbox.initialize();
  return { outbox, root };
}

function outboxError(code) {
  return (error) => error instanceof MastermindEventOutboxError && error.code === code;
}

test('publishes immutable event files and treats identical retries as idempotent', async (t) => {
  const { outbox, root } = await outboxFixture(t);
  const event = domainEvent();
  assert.equal((await outbox.enqueue(event)).inserted, true);
  assert.equal((await outbox.enqueue(structuredClone(event))).inserted, false);
  assert.deepEqual(await outbox.listPending(), [event]);
  assert.deepEqual(await outbox.stats(), {
    count: 1,
    bytes: Buffer.byteLength(`${JSON.stringify(event)}\n`),
  });
  const names = await fs.readdir(path.join(root, 'pending'));
  assert.deepEqual(names, [`${event.eventId}.json`]);
});

test('same event id with different content fails closed', async (t) => {
  const { outbox } = await outboxFixture(t);
  const event = domainEvent();
  await outbox.enqueue(event);
  await assert.rejects(() => outbox.enqueue({
    ...event, payload: { ...event.payload, resultCode: 'different' },
  }), outboxError('EVENT_ID_CONFLICT'));
  assert.deepEqual(await outbox.listPending(), [event]);
});

test('pending events survive restart and successful consumption acknowledges only after commit', async (t) => {
  const { outbox, root } = await outboxFixture(t);
  const first = domainEvent(1);
  const second = domainEvent(2);
  await outbox.enqueue(second);
  await outbox.enqueue(first);
  const restarted = new FileMastermindEventOutbox(root);
  assert.deepEqual(await restarted.initialize(), await outbox.stats());
  assert.deepEqual(await restarted.listPending(), [first, second]);
  const committed = [];
  assert.deepEqual(await restarted.consume(async (event) => { committed.push(event.eventId); }), { delivered: 2, remaining: 0 });
  assert.deepEqual(committed, [first.eventId, second.eventId]);
  assert.deepEqual(await restarted.listPending(), []);
});

test('consumer failure leaves the current event pending for at-least-once replay', async (t) => {
  const { outbox } = await outboxFixture(t);
  const event = domainEvent(3);
  await outbox.enqueue(event);
  await assert.rejects(() => outbox.consume(async () => { throw new Error('downstream unavailable'); }), /downstream unavailable/);
  assert.deepEqual(await outbox.listPending(), [event]);
  assert.equal(await outbox.acknowledge('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false);
});

test('identity preflight fences legacy playerless companion events without removing them', async (t) => {
  const { outbox } = await outboxFixture(t);
  const legacy = domainEvent(40);
  await outbox.enqueue(legacy);
  await assert.rejects(
    () => outbox.assertNoUnboundCompanionEvents(),
    outboxError('EVENT_OUTBOX_IDENTITY_MIGRATION_REQUIRED'),
  );
  assert.deepEqual(await outbox.listPending(), [legacy]);

  assert.equal(await outbox.acknowledge(legacy), true);
  await outbox.enqueue(domainEvent(41, { playerId: PLAYER_ID }));
  assert.deepEqual(await outbox.assertNoUnboundCompanionEvents(), { companionEvents: 1 });
});

test('initialization removes only owned unfinished temp files and rejects corrupt committed entries', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-event-outbox-init-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'outbox', 'v1');
  const pending = path.join(root, 'pending');
  await fs.mkdir(pending, { recursive: true });
  const tempName = '11111111-1111-8111-8111-111111111111.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.tmp';
  await fs.writeFile(path.join(pending, tempName), '{');
  const outbox = new FileMastermindEventOutbox(root);
  assert.deepEqual(await outbox.initialize(), { count: 0, bytes: 0 });
  assert.deepEqual(await fs.readdir(pending), []);
  await fs.writeFile(path.join(pending, '11111111-1111-8111-8111-111111111111.json'), '{}\n');
  const corrupt = new FileMastermindEventOutbox(root);
  await assert.rejects(() => corrupt.initialize(), outboxError('EVENT_OUTBOX_INVALID'));
});

test('pending count quota is enforced before publication', async (t) => {
  const { outbox } = await outboxFixture(t, { maxPending: 1 });
  await outbox.enqueue(domainEvent(4));
  await assert.rejects(() => outbox.enqueue(domainEvent(5)), outboxError('EVENT_OUTBOX_QUOTA_EXCEEDED'));
  assert.equal((await outbox.stats()).count, 1);
});

test('concurrent producers serialize without losing or duplicating events', async (t) => {
  const { outbox } = await outboxFixture(t);
  const events = Array.from({ length: 32 }, (_, index) => domainEvent(index + 10));
  const results = await Promise.all(events.map((event) => outbox.enqueue(event)));
  assert.equal(results.every((result) => result.inserted), true);
  assert.equal((await outbox.listPending({ limit: 100 })).length, events.length);
  assert.equal((await outbox.stats()).count, events.length);
});
