import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCAL_AGENT_DRAIN_TIMEOUT_MS,
  requestSupervisorManagedDrain,
} from '../lib/local-control-drain.mjs';

function response(value, status = 200) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
  });
}

test('signed supervisor drain sends only the in-memory bearer and exact supervisor identity', async () => {
  assert.equal(LOCAL_AGENT_DRAIN_TIMEOUT_MS, 70_000);
  const token = 'f'.repeat(64);
  const supervisorId = 'a'.repeat(32);
  let captured;
  const result = await requestSupervisorManagedDrain({
    token,
    supervisorId,
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return response({ ok: true, prepared: true, draining: true });
    },
  });
  assert.deepEqual(result, { prepared: true });
  assert.equal(captured.url, 'http://127.0.0.1:43100/v1/control/prepare-shutdown');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.body, undefined);
  assert.equal(captured.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(captured.options.headers['X-Mastermind-Supervisor-Id'], supervisorId);
});

test('signed supervisor drain rejects malformed identities before making a request', async () => {
  let calls = 0;
  await assert.rejects(requestSupervisorManagedDrain({
    token: 'short',
    supervisorId: 'not-valid',
    fetchImpl: async () => { calls += 1; return response({}); },
  }), /identity is invalid/);
  assert.equal(calls, 0);
});
