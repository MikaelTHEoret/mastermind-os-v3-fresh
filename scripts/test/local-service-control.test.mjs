import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  LOCAL_AGENT_STARTUP_HEALTH_TIMEOUT_MS,
  LOCAL_SERVICE_REQUEST_MAX_BYTES,
  LocalServiceControlError,
  createMinecraftAgentRestarter,
  createLocalServiceControlServer,
  createLocalServiceLog,
  createLocalServiceRegistry,
  dispatchLocalServiceControlRequest,
  waitForLocalAgentHealth,
} from '../lib/local-service-control.mjs';

const SUPERVISOR_ID = 'a'.repeat(32);
const TOKEN = 'b'.repeat(64);
const NOW = '2026-08-15T04:05:06.000Z';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';

function sink() {
  let value = '';
  return { write(chunk) { value += chunk; }, value: () => value };
}

function fixture(overrides = {}) {
  const scheduled = [];
  const restarts = [];
  let tick = 0;
  const stdout = sink();
  const stderr = sink();
  const logs = createLocalServiceLog({
    now: () => new Date(Date.parse(NOW) + tick++).toISOString(),
    stdout,
    stderr,
    secrets: [TOKEN],
    maximumEntries: 20,
    maximumBytes: 32 * 1024,
  });
  const registry = createLocalServiceRegistry({
    supervisorId: SUPERVISOR_ID,
    mode: 'development',
    startedAt: NOW,
    now: () => new Date(Date.parse(NOW) + tick++).toISOString(),
    schedule: (callback) => scheduled.push(callback),
    restartAgent: overrides.restartAgent ?? (async (operation) => {
      restarts.push(operation);
      return { lastExit: { at: NOW, kind: 'clean', code: 0, signal: null } };
    }),
  });
  registry.markRunning('minecraft-control-agent', 1);
  registry.markRunning('next-web', 1);
  return { scheduled, restarts, stdout, stderr, logs, registry };
}

function request(action, fields = {}) {
  return { schemaVersion: 1, supervisorId: SUPERVISOR_ID, token: TOKEN, action, ...fields };
}

function options(value) {
  return { supervisorId: SUPERVISOR_ID, token: TOKEN, registry: value.registry, logs: value.logs };
}

test('status is fixed to four public roles and authentication precedes action dispatch', async () => {
  const value = fixture();
  const result = await dispatchLocalServiceControlRequest(request('status'), options(value));
  assert.deepEqual(result.response.services.map(({ role, port, generation }) => ({ role, port, generation })), [
    { role: 'supervisor', port: null, generation: 1 },
    { role: 'minecraft-control-agent', port: 43100, generation: 1 },
    { role: 'next-web', port: 3000, generation: 1 },
    { role: 'mastermind-node-link', port: null, generation: 1 },
  ]);
  await assert.rejects(
    dispatchLocalServiceControlRequest({ ...request('status'), token: 'c'.repeat(64) }, options(value)),
    (error) => error instanceof LocalServiceControlError && error.code === 'CONTROL_AUTH_FAILED',
  );
  await assert.rejects(
    dispatchLocalServiceControlRequest(request('restart', {
      role: 'next-web', requestId: REQUEST_ID, expectedGeneration: 1,
    }), options(value)),
    (error) => error.code === 'TARGET_NOT_ALLOWED',
  );
  await assert.rejects(
    dispatchLocalServiceControlRequest(request('restart', {
      role: 'mastermind-node-link', requestId: REQUEST_ID, expectedGeneration: 1,
    }), options(value)),
    (error) => error.code === 'TARGET_NOT_ALLOWED',
  );
  await assert.rejects(
    dispatchLocalServiceControlRequest({ ...request('status'), pid: 123 }, options(value)),
    (error) => error.code === 'INVALID_REQUEST',
  );
});

test('logs are sanitized, secret-redacted, sequenced, and bounded to 2048 UTF-8 bytes', () => {
  const value = fixture();
  value.logs.write('minecraft-control-agent', 'stdout', `\u001b[31msecret=${TOKEN}\u001b[0m\0\n`);
  value.logs.write('minecraft-control-agent', 'stdout', `upper=${TOKEN.toUpperCase()}\n`);
  value.logs.write('minecraft-control-agent', 'stderr', `${'x'.repeat(3_000)}\runsafe\u200btext\r`);
  const result = value.logs.tail('minecraft-control-agent', 200);
  assert.equal(result.entries.length, 4);
  assert.equal(result.entries[0].sequence < result.entries[1].sequence, true);
  assert.doesNotMatch(result.entries[0].line, new RegExp(TOKEN));
  assert.doesNotMatch(result.entries[0].line, /\x1b|\0/u);
  assert.doesNotMatch(result.entries[1].line, new RegExp(TOKEN, 'i'));
  assert.equal(Buffer.byteLength(result.entries[2].line, 'utf8'), 2_048);
  assert.equal(result.entries[3].line, 'unsafe text');
  assert.doesNotMatch(value.stdout.value(), new RegExp(TOKEN));
  assert.equal(value.stderr.value().includes('x'.repeat(2_048)), true);
});

test('node-link logs are exposed only through the bounded read-only log action', async () => {
  const value = fixture();
  value.logs.write('mastermind-node-link', 'stderr', `credential=${TOKEN}\n`);
  const result = await dispatchLocalServiceControlRequest(request('logs', {
    role: 'mastermind-node-link',
    limit: 10,
  }), options(value));
  assert.equal(result.response.role, 'mastermind-node-link');
  assert.equal(result.response.entries.length, 1);
  assert.equal(result.response.entries[0].line, 'credential=[REDACTED]');
});

test('the log ring redacts every supervisor capability and managed-root value', () => {
  const stdout = sink();
  const secrets = [
    TOKEN,
    SUPERVISOR_ID,
    String.raw`\\.\pipe\mastermind-local-control-0123456789abcdef0123456789abcdef`,
    String.raw`C:\managed\mastermind-command-center`,
    String.raw`C:\managed\mastermind-data-root`,
  ];
  const logs = createLocalServiceLog({ now: () => NOW, stdout, stderr: sink(), secrets });
  logs.write('supervisor', 'stdout', `${secrets.join(' ')}\n`);
  const [entry] = logs.tail('supervisor', 1).entries;
  for (const secret of secrets) {
    assert.doesNotMatch(entry.line, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(stdout.value(), new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('agent health publication requires the exact child before and after a bounded 200 response', async () => {
  assert.equal(LOCAL_AGENT_STARTUP_HEALTH_TIMEOUT_MS, 600_000);
  let ownershipChecks = 0;
  const body = Buffer.from(JSON.stringify({ ok: true, service: 'mastermind-minecraft-control', version: 2 }));
  const result = await waitForLocalAgentHealth({
    assertOwned: async () => { ownershipChecks += 1; },
    fetchImpl: async () => ({
      status: 200,
      headers: { get: () => String(body.length) },
      arrayBuffer: async () => body,
    }),
    timeoutSignal: () => undefined,
    timeoutMs: 100,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(ownershipChecks, 2);
});

test('agent health publication times out without accepting a wrong response body', async () => {
  let clock = 0;
  await assert.rejects(waitForLocalAgentHealth({
    assertOwned: async () => {},
    fetchImpl: async () => ({
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from('{"ok":true,"service":"other","version":2}'),
    }),
    timeoutSignal: () => undefined,
    timeoutMs: 100,
    attemptTimeoutMs: 50,
    retryMs: 25,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
  }), (error) => error?.code === 'AGENT_HEALTH_TIMEOUT');
});

function restartLifecycle(overrides = {}) {
  const events = [];
  const existing = overrides.existing === undefined ? { child: {}, identity: { pid: 10 } } : overrides.existing;
  const replacement = { child: {}, identity: { pid: 11 } };
  const restart = createMinecraftAgentRestarter({
    getActive: () => existing,
    getLastExit: () => null,
    drain: async () => { events.push('drain'); },
    markIntentional: () => { events.push('intentional'); },
    unmarkIntentional: () => { events.push('unmark'); },
    signal: () => { events.push('signal'); return true; },
    waitForExit: async () => { events.push('exit'); },
    waitForPortRelease: async () => { events.push('port'); },
    isExactAlive: async () => false,
    removeAndPersist: async () => { events.push('persist'); },
    recordCleanExit: () => ({ at: NOW, kind: 'clean', code: 0, signal: null }),
    spawn: async () => { events.push('spawn'); return replacement; },
    isActive: (record) => record === replacement,
    assertCanContinue: () => {},
    ...overrides,
  });
  return { events, restart };
}

test('an exit timeout never leaves a missing intentional agent reported as running', async () => {
  const value = restartLifecycle({
    waitForExit: async () => { throw new Error('timeout'); },
    isExactAlive: async () => false,
  });
  await assert.rejects(value.restart({ generation: 2 }), (error) => (
    error?.serviceState === 'failed' && error?.lastExit?.kind === 'clean'
  ));
  assert.deepEqual(value.events, ['drain', 'intentional', 'signal', 'persist']);
});

test('a still-live exact agent is unmarked after an exit timeout so a late exit becomes unexpected', async () => {
  const value = restartLifecycle({
    waitForExit: async () => { throw new Error('timeout'); },
    isExactAlive: async () => true,
  });
  await assert.rejects(value.restart({ generation: 2 }), (error) => error?.serviceState === 'running');
  assert.deepEqual(value.events, ['drain', 'intentional', 'signal', 'unmark']);
});

test('signed-state persistence failure after exact exit is failed, never running or respawned', async () => {
  const value = restartLifecycle({
    removeAndPersist: async () => { throw new Error('store unavailable'); },
  });
  await assert.rejects(value.restart({ generation: 2 }), (error) => (
    error?.serviceState === 'failed' && error?.lastExit?.kind === 'clean'
  ));
  assert.deepEqual(value.events, ['drain', 'intentional', 'signal', 'exit', 'port']);
});

test('restart is serialized and duplicates preserve the immutable accepted receipt after completion', async () => {
  const value = fixture();
  const frame = request('restart', {
    role: 'minecraft-control-agent', requestId: REQUEST_ID, expectedGeneration: 1,
  });
  const first = await dispatchLocalServiceControlRequest(frame, options(value));
  assert.deepEqual(first.response.operation, {
    requestId: REQUEST_ID,
    role: 'minecraft-control-agent',
    state: 'accepted',
    expectedGeneration: 1,
    generation: 2,
    acceptedAt: first.response.operation.acceptedAt,
    finishedAt: null,
    code: null,
  });
  await assert.rejects(
    dispatchLocalServiceControlRequest(request('restart', {
      role: 'minecraft-control-agent',
      requestId: '123e4567-e89b-42d3-a456-426614174001',
      expectedGeneration: 1,
    }), options(value)),
    (error) => error.code === 'SERVICE_BUSY',
  );
  first.afterResponse();
  assert.equal(value.scheduled.length, 1);
  value.scheduled.shift()();
  const completed = await value.registry.waitForOperation(REQUEST_ID);
  assert.equal(completed.state, 'succeeded');
  assert.equal(value.restarts.length, 1);
  assert.equal(value.registry.snapshot().services[1].generation, 2);

  const duplicate = await dispatchLocalServiceControlRequest(frame, options(value));
  assert.equal(duplicate.response.operation.state, 'accepted');
  assert.equal(duplicate.response.operation.finishedAt, null);
  assert.equal(duplicate.response.operation.code, null);
  assert.equal(duplicate.afterResponse, null);
  assert.equal(value.restarts.length, 1);
  await assert.rejects(
    dispatchLocalServiceControlRequest({ ...frame, expectedGeneration: 2 }, options(value)),
    (error) => error.code === 'REQUEST_ID_CONFLICT',
  );
  await assert.rejects(
    dispatchLocalServiceControlRequest(request('restart', {
      role: 'minecraft-control-agent',
      requestId: '123e4567-e89b-42d3-a456-426614174002',
      expectedGeneration: 1,
    }), options(value)),
    (error) => error.code === 'STALE_GENERATION',
  );
});

test('restart rejects a generation whose successor would exceed the safe integer bound', async () => {
  const value = fixture();
  await assert.rejects(
    dispatchLocalServiceControlRequest(request('restart', {
      role: 'minecraft-control-agent', requestId: REQUEST_ID, expectedGeneration: Number.MAX_SAFE_INTEGER,
    }), options(value)),
    (error) => error.code === 'INVALID_GENERATION',
  );
});

test('a failed asynchronous restart records a bounded failed state without changing generation', async () => {
  const value = fixture({
    restartAgent: async () => {
      throw Object.assign(new Error('private failure'), {
        serviceState: 'failed',
        lastExit: { at: NOW, kind: 'unexpected', code: 1, signal: null },
      });
    },
  });
  const result = await dispatchLocalServiceControlRequest(request('restart', {
    role: 'minecraft-control-agent', requestId: REQUEST_ID, expectedGeneration: 1,
  }), options(value));
  result.afterResponse(); value.scheduled.shift()();
  const operation = await value.registry.waitForOperation(REQUEST_ID);
  assert.equal(operation.state, 'failed');
  assert.equal(operation.code, 'RESTART_FAILED');
  assert.deepEqual(value.registry.snapshot().services[1], {
    role: 'minecraft-control-agent', state: 'failed', generation: 1, port: 43100,
    lastExit: { at: NOW, kind: 'unexpected', code: 1, signal: null },
  });
});

class FakeSocket extends EventEmitter {
  setTimeout(_timeout, callback) { this.timeoutCallback = callback; }
  end(bytes, callback) { this.response = Buffer.from(bytes); callback?.(); }
  destroy() { this.destroyed = true; }
}

class FakeServer extends EventEmitter {
  constructor(connection) { super(); this.connection = connection; }
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('the channel rejects duplicate keys, trailing frames, and oversized input without a live socket', async () => {
  const value = fixture();
  let fakeServer;
  createLocalServiceControlServer({
    ...options(value),
    createServer(connection) { fakeServer = new FakeServer(connection); return fakeServer; },
  });

  const valid = new FakeSocket(); fakeServer.connection(valid);
  valid.emit('data', Buffer.from(`${JSON.stringify(request('status'))}\n`));
  await settle();
  assert.equal(JSON.parse(valid.response).ok, true);

  const duplicate = new FakeSocket(); fakeServer.connection(duplicate);
  duplicate.emit('data', Buffer.from(`{"schemaVersion":1,"schemaVersion":1,"supervisorId":"${SUPERVISOR_ID}","token":"${TOKEN}","action":"status"}\n`));
  await settle();
  assert.equal(JSON.parse(duplicate.response).code, 'INVALID_REQUEST');

  const trailing = new FakeSocket(); fakeServer.connection(trailing);
  trailing.emit('data', Buffer.from(`${JSON.stringify(request('status'))}\n{}\n`));
  await settle();
  assert.equal(JSON.parse(trailing.response).code, 'INVALID_REQUEST');

  const oversized = new FakeSocket(); fakeServer.connection(oversized);
  oversized.emit('data', Buffer.alloc(LOCAL_SERVICE_REQUEST_MAX_BYTES + 1, 0x61));
  assert.equal(oversized.destroyed, true);
});

test('the takeover channel preserves accepted response and runs shutdown only after response publication', async () => {
  const value = fixture();
  let fakeServer;
  let shutdowns = 0;
  createLocalServiceControlServer({
    ...options(value),
    handleTakeover: async () => ({ accepted: true, afterResponse: () => { shutdowns += 1; } }),
    createServer(connection) { fakeServer = new FakeServer(connection); return fakeServer; },
  });
  const socket = new FakeSocket(); fakeServer.connection(socket);
  socket.emit('data', Buffer.from(`${JSON.stringify({ action: 'takeover', supervisorId: SUPERVISOR_ID })}\n`));
  await settle();
  assert.deepEqual(JSON.parse(socket.response), { accepted: true, supervisorId: SUPERVISOR_ID });
  assert.equal(shutdowns, 1);
});

test('launcher keeps Next and the supervisor available when the initial backend cannot start', async () => {
  const source = await fs.readFile(new URL('../run-local-control.mjs', import.meta.url), 'utf8');
  const recoveryStart = source.indexOf('let initialAgentFailure = null;');
  const nextStart = source.indexOf("await spawnManaged('next-web'", recoveryStart);
  const outerClose = source.indexOf('\n} catch (error) {\n  console.error(error.message);\n  await close(1);', nextStart);
  assert.notEqual(recoveryStart, -1);
  assert.notEqual(nextStart, -1);
  assert.ok(nextStart > recoveryStart, 'Next must start after the agent failure is converted to recoverable status');
  assert.ok(outerClose > nextStart, 'only Next/supervisor startup failure may reach the stack-closing catch');
  assert.match(source.slice(recoveryStart, nextStart), /dashboard remains available for recovery/);
  assert.match(source, /timeoutMs: LOCAL_AGENT_STARTUP_HEALTH_TIMEOUT_MS/);
  assert.match(source, /process\.on\('SIGINT', \(\) => void close\(0\)\)/);
  assert.match(source, /process\.on\('SIGTERM', \(\) => void close\(0\)\)/);
  assert.doesNotMatch(source, /process\.once\('SIG(?:INT|TERM)'/);
});
