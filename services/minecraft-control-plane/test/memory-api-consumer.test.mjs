import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config.mjs';
import {
  canonicalMastermindDomainEvent,
  createMastermindDomainEvent,
  deterministicMastermindEventId,
} from '../src/domain-events/contract.mjs';
import {
  MASTERMIND_MEMORY_EVENT_ENDPOINT,
  MastermindMemoryApiConsumer,
  MastermindMemoryApiError,
  MastermindMemoryEventSyncController,
} from '../src/domain-events/memory-api-consumer.mjs';

const TOKEN = 'test-control-token-0123456789-abcdef';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_ID = '33333333-3333-4333-8333-333333333333';
const PLAYER_ID = '44444444-4444-4444-8444-444444444444';

function event(index = 0) {
  return createMastermindDomainEvent({
    eventId: deterministicMastermindEventId(['memory-api-test', String(index)]),
    occurredAt: new Date(Date.parse('2026-08-14T12:00:00.000Z') + index).toISOString(),
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
      resultCode: `result${index}`,
    },
  });
}

function response(value, options = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  return new Response(body, {
    status: options.status ?? 200,
    headers: {
      'Content-Type': options.contentType ?? 'application/json; charset=utf-8',
      ...(options.contentLength === undefined ? {} : { 'Content-Length': String(options.contentLength) }),
    },
  });
}

function apiError(code) {
  return (error) => error instanceof MastermindMemoryApiError && error.code === code;
}

test('posts only canonical validated events to the fixed loopback endpoint and accepts exact receipts', async () => {
  const source = event(1);
  const calls = [];
  const consumer = new MastermindMemoryApiConsumer({
    token: TOKEN,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return response({ ok: true, status: calls.length === 1 ? 'applied' : 'duplicate', eventId: source.eventId });
    },
  });

  assert.deepEqual(await consumer.deliver(source), { ok: true, status: 'applied', eventId: source.eventId });
  assert.deepEqual(await consumer.deliver(structuredClone(source)), { ok: true, status: 'duplicate', eventId: source.eventId });
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(url, MASTERMIND_MEMORY_EVENT_ENDPOINT);
    assert.equal(url, 'http://127.0.0.1:3000/api/memory/events');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.headers['Content-Length'], String(Buffer.byteLength(init.body)));
    assert.equal(init.body, canonicalMastermindDomainEvent(source));
    assert.equal(init.signal instanceof AbortSignal, true);
  }

  let invalidCalled = false;
  const validating = new MastermindMemoryApiConsumer({
    token: TOKEN,
    fetcher: async () => { invalidCalled = true; return response({}); },
  });
  await assert.rejects(() => validating.deliver({ ...source, unexpected: true }), (error) => error?.code === 'EVENT_UNKNOWN_FIELD');
  assert.equal(invalidCalled, false);
});

test('rejects non-exact, oversized, refused, and timed-out API responses', async () => {
  const source = event(2);
  const cases = [
    [response({ ok: true, status: 'applied', eventId: source.eventId, extra: true }), 'MEMORY_API_INVALID_RESPONSE'],
    [response({ ok: true, status: 'applied', eventId: event(3).eventId }), 'MEMORY_API_INVALID_RESPONSE'],
    [response({ ok: false, code: 'EVENT_ID_CONFLICT' }, { status: 409 }), 'MEMORY_API_REJECTED'],
    [response('x'.repeat(129), { contentLength: 129 }), 'MEMORY_API_RESPONSE_TOO_LARGE'],
  ];
  for (const [reply, code] of cases) {
    const consumer = new MastermindMemoryApiConsumer({
      token: TOKEN,
      responseMaxBytes: 128,
      fetcher: async () => reply,
    });
    await assert.rejects(() => consumer.deliver(source), apiError(code));
  }

  let cleared = false;
  const timedOut = new MastermindMemoryApiConsumer({
    token: TOKEN,
    timeoutMs: 100,
    setTimeoutFn(callback, milliseconds) {
      assert.equal(milliseconds, 100);
      callback();
      return { unref() {} };
    },
    clearTimeoutFn() { cleared = true; },
    fetcher: async (_url, init) => {
      assert.equal(init.signal.aborted, true);
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
  });
  await assert.rejects(() => timedOut.deliver(source), apiError('MEMORY_API_TIMEOUT'));
  assert.equal(cleared, true);
});

test('a delivery rejection is observed and leaves the outbox event pending', async () => {
  const pending = [event(4)];
  const failures = [];
  const outbox = {
    async consume(handler) {
      const current = pending[0];
      await handler(structuredClone(current));
      pending.shift();
      return { delivered: 1, remaining: 0 };
    },
  };
  const controller = new MastermindMemoryEventSyncController({
    outbox,
    consumer: {
      async deliver() { throw new MastermindMemoryApiError('MEMORY_API_REJECTED', 'rejected'); },
    },
    onError(_error, context) { failures.push(context); },
  });
  assert.deepEqual(await controller.drain(), {
    ok: false,
    reason: 'manual',
    code: 'MEMORY_API_REJECTED',
  });
  assert.deepEqual(pending, [event(4)]);
  assert.deepEqual(failures, [{ reason: 'manual', code: 'MEMORY_API_REJECTED' }]);
});

test('the request deadline covers a stalled response body so final drain and close remain bounded', async () => {
  const source = event(5);
  let fireDeadline = null;
  let cleared = false;
  const consumer = new MastermindMemoryApiConsumer({
    token: TOKEN,
    timeoutMs: 100,
    setTimeoutFn(callback) {
      fireDeadline = callback;
      return { unref() {} };
    },
    clearTimeoutFn() { cleared = true; },
    fetcher: async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        init.signal.addEventListener('abort', () => {
          controller.error(Object.assign(new Error('body aborted'), { name: 'AbortError' }));
        });
      },
    }), { headers: { 'Content-Type': 'application/json' } }),
  });
  const pending = [source];
  const failures = [];
  const controller = new MastermindMemoryEventSyncController({
    outbox: {
      async consume(handler) {
        await handler(structuredClone(pending[0]));
        pending.shift();
        return { delivered: 1, remaining: 0 };
      },
    },
    consumer,
    onError(_error, context) { failures.push(context); },
  });

  const final = controller.finalDrain();
  for (let attempt = 0; attempt < 8 && fireDeadline === null; attempt += 1) await Promise.resolve();
  assert.equal(typeof fireDeadline, 'function');
  fireDeadline();
  assert.deepEqual(await final, { ok: false, reason: 'shutdown', code: 'MEMORY_API_TIMEOUT' });
  await controller.close();
  assert.equal(cleared, true);
  assert.deepEqual(pending, [source]);
  assert.deepEqual(failures, [{ reason: 'shutdown', code: 'MEMORY_API_TIMEOUT' }]);
});

test('startup, interval, and manual drains never overlap; final drain precedes consumer close', async () => {
  const trace = [];
  let intervalCallback;
  let releaseFirst;
  let active = 0;
  let maximumActive = 0;
  let consumeCalls = 0;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const timer = { unref() { trace.push('timer-unref'); } };
  const outbox = {
    async consume(handler, options) {
      consumeCalls += 1;
      const call = consumeCalls;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      trace.push(`consume-${call}`);
      assert.deepEqual(options, { limit: 7 });
      if (call === 1) await firstGate;
      await handler(event(call));
      active -= 1;
      return { delivered: 1, remaining: 0 };
    },
  };
  const controller = new MastermindMemoryEventSyncController({
    outbox,
    consumer: {
      async deliver(value) { trace.push(`deliver-${value.payload.resultCode}`); },
      async close() { trace.push('consumer-close'); },
    },
    intervalMs: 250,
    batchLimit: 7,
    setIntervalFn(callback, milliseconds) {
      assert.equal(milliseconds, 250);
      intervalCallback = callback;
      trace.push('timer-start');
      return timer;
    },
    clearIntervalFn(value) {
      assert.equal(value, timer);
      trace.push('timer-clear');
    },
  });

  const startup = controller.start();
  await Promise.resolve();
  const manual = controller.drain();
  intervalCallback();
  assert.equal(manual, startup);
  assert.equal(consumeCalls, 1);
  releaseFirst();
  assert.equal((await startup).ok, true);
  assert.equal((await controller.finalDrain()).ok, true);
  await controller.close();

  assert.equal(maximumActive, 1);
  assert.equal(consumeCalls, 2);
  assert.deepEqual(trace, [
    'timer-start',
    'timer-unref',
    'consume-1',
    'deliver-result1',
    'timer-clear',
    'consume-2',
    'deliver-result2',
    'consumer-close',
  ]);
});

test('memory event synchronization is disabled unless the environment value is exactly true', () => {
  const base = { MASTERMIND_CONTROL_TOKEN: TOKEN, LOCALAPPDATA: 'C:\\MastermindTest' };
  assert.equal(readConfig(base).memoryEventSyncEnabled, false);
  assert.equal(readConfig({ ...base, MASTERMIND_MEMORY_EVENT_SYNC_ENABLED: 'false' }).memoryEventSyncEnabled, false);
  assert.equal(readConfig({ ...base, MASTERMIND_MEMORY_EVENT_SYNC_ENABLED: 'TRUE' }).memoryEventSyncEnabled, false);
  assert.throws(
    () => readConfig({ ...base, MASTERMIND_MEMORY_EVENT_SYNC_ENABLED: 'true' }),
    { code: 'MEMORY_IDENTITY_REQUIRED' },
  );
  const enabled = readConfig({
    ...base,
    MASTERMIND_MEMORY_EVENT_SYNC_ENABLED: 'true',
    MASTERMIND_MEMORY_PLAYER_ID: PLAYER_ID,
  });
  assert.equal(enabled.memoryEventSyncEnabled, true);
  assert.equal(enabled.memoryEventPlayerId, PLAYER_ID);
});
