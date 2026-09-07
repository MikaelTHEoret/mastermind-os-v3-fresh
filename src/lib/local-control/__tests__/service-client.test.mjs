import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import nodePath from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as protocol from '../protocol.mjs';
import {
  LOCAL_SERVICE_RESTART_CONFIRMATION,
  LocalServiceProtocolError,
  parseLocalServiceLogQuery,
  parseLocalServiceRestartBody,
  parseSupervisorError,
  publicLocalServiceInventory,
  publicLocalServiceLogs,
  publicLocalServiceRestart,
} from '../protocol.mjs';

const supervisorId = 'a'.repeat(32);
const now = '2026-08-15T12:00:00.000Z';
const controlToken = 'c'.repeat(64);
const pipeName = String.raw`\\.\pipe\mastermind-local-control-${'b'.repeat(32)}`;

const clientSource = fs.readFileSync(new URL('../service-client.ts', import.meta.url), 'utf8');
const compiledClient = ts.transpileModule(clientSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'service-client.ts',
}).outputText;

function loadClient(responseFor, environment = {}, behavior = {}) {
  const frames = [];
  const pipes = [];
  class FakeSocket extends EventEmitter {
    setTimeout() {}

    write(frame, callback) {
      const request = JSON.parse(frame.toString('utf8').trim());
      frames.push(request);
      callback?.();
      queueMicrotask(() => {
        if (behavior.timeout) {
          this.emit('timeout');
          return;
        }
        if (behavior.oversize) {
          this.emit('data', Buffer.alloc(128 * 1024 + 1, 0x78));
          return;
        }
        const response = responseFor(request);
        this.emit('data', Buffer.from(`${JSON.stringify(response)}\n`, 'utf8'));
        this.emit('end');
      });
    }

    destroy() {}
  }
  const net = {
    createConnection(target) {
      pipes.push(target);
      const socket = new FakeSocket();
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    },
  };
  const commonJsModule = { exports: {} };
  const sandbox = {
    Buffer,
    Error,
    Promise,
    TextDecoder,
    clearTimeout,
    exports: commonJsModule.exports,
    module: commonJsModule,
    process: {
      platform: 'win32',
      env: {
        MASTERMIND_CONTROL_TOKEN: controlToken,
        MASTERMIND_LOCAL_CHILD_ROLE: 'next-web',
        MASTERMIND_LOCAL_SERVICE_PIPE: pipeName,
        MASTERMIND_LOCAL_SUPERVISOR_ID: supervisorId,
        ...environment,
      },
    },
    require(identifier) {
      if (identifier === 'server-only') return {};
      if (identifier === 'node:net') return net;
      if (identifier === 'node:path') return nodePath;
      if (identifier === './protocol.mjs') return protocol;
      throw new Error(`Unexpected test import: ${identifier}`);
    },
    setTimeout,
  };
  vm.runInNewContext(compiledClient, sandbox, { filename: 'service-client.cjs' });
  return { client: commonJsModule.exports, frames, pipes };
}

function service(role, state, generation, port, lastExit = null) {
  return { role, state, generation, port, lastExit };
}

function inventory() {
  return {
    ok: true,
    supervisorId,
    supervisor: { mode: 'development', startedAt: now },
    services: [
      service('next-web', 'running', 1, 3000),
      service('supervisor', 'running', 1, null),
      service('minecraft-control-agent', 'failed', 2, 43100, {
        at: now,
        kind: 'unexpected',
        code: 1,
        signal: null,
      }),
      service('mastermind-node-link', 'failed', 1, null),
    ],
  };
}

test('service inventory is exact, ordered, and strips the private supervisor id', () => {
  const result = publicLocalServiceInventory(inventory(), supervisorId);
  assert.deepEqual(result, {
    ok: true,
    supervisor: { mode: 'development', startedAt: now },
    services: [
      service('supervisor', 'running', 1, null),
      service('minecraft-control-agent', 'failed', 2, 43100, {
        at: now,
        kind: 'unexpected',
        code: 1,
        signal: null,
      }),
      service('next-web', 'running', 1, 3000),
      service('mastermind-node-link', 'failed', 1, null),
    ],
  });
  assert.equal(JSON.stringify(result).includes(supervisorId), false);
});

test('service inventory rejects extra identity fields, missing roles, and unsafe exit data', () => {
  const withPid = inventory();
  withPid.services[0].pid = 1234;
  assert.throws(() => publicLocalServiceInventory(withPid, supervisorId), LocalServiceProtocolError);

  const duplicated = inventory();
  duplicated.services[2] = service('next-web', 'running', 2, 3000);
  assert.throws(() => publicLocalServiceInventory(duplicated, supervisorId), LocalServiceProtocolError);

  const unsafeExit = inventory();
  unsafeExit.services[2].lastExit.code = -1;
  assert.throws(() => publicLocalServiceInventory(unsafeExit, supervisorId), LocalServiceProtocolError);
});

test('log query accepts one bounded limit and optional nonnegative cursor', () => {
  assert.deepEqual(parseLocalServiceLogQuery(new URLSearchParams()), { limit: 100 });
  assert.deepEqual(parseLocalServiceLogQuery(new URLSearchParams('limit=200&after=0')), { limit: 200, after: 0 });
  for (const query of ['limit=0', 'limit=201', 'limit=01', 'after=-1', 'after=01', 'limit=1&limit=2', 'path=x']) {
    assert.throws(() => parseLocalServiceLogQuery(new URLSearchParams(query)), LocalServiceProtocolError);
  }
});

test('logs are role-pinned, cursor-ordered, bounded, sanitized, and omit internal cursor state', () => {
  const response = {
    ok: true,
    supervisorId,
    role: 'minecraft-control-agent',
    entries: [{
      sequence: 7,
      at: now,
      role: 'minecraft-control-agent',
      stream: 'stderr',
      line: 'ready\u001b[31m!\u001b[0m\u202e',
    }],
    nextSequence: 7,
  };
  const result = publicLocalServiceLogs(
    response,
    supervisorId,
    'minecraft-control-agent',
    { limit: 10, after: 6 },
  );
  assert.deepEqual(result, {
    ok: true,
    role: 'minecraft-control-agent',
    entries: [{
      sequence: 7,
      at: now,
      role: 'minecraft-control-agent',
      stream: 'stderr',
      line: 'ready!\ufffd',
    }],
  });
  assert.equal(Object.hasOwn(result, 'nextSequence'), false);

  assert.throws(
    () => publicLocalServiceLogs(response, supervisorId, 'minecraft-control-agent', { limit: 10, after: 7 }),
    LocalServiceProtocolError,
  );
  response.entries[0].line = 'x'.repeat(2049);
  assert.throws(
    () => publicLocalServiceLogs(response, supervisorId, 'minecraft-control-agent', { limit: 10, after: 6 }),
    LocalServiceProtocolError,
  );
});

test('blank child-output lines remain valid bounded public log entries', () => {
  const result = publicLocalServiceLogs({
    ok: true,
    supervisorId,
    role: 'next-web',
    entries: [{ sequence: 1, at: now, role: 'next-web', stream: 'stdout', line: '' }],
    nextSequence: 1,
  }, supervisorId, 'next-web', { limit: 10 });
  assert.deepEqual(result, {
    ok: true,
    role: 'next-web',
    entries: [{ sequence: 1, at: now, role: 'next-web', stream: 'stdout', line: '' }],
  });
});

test('portless node-link logs remain role-pinned and bounded', () => {
  const result = publicLocalServiceLogs({
    ok: true,
    supervisorId,
    role: 'mastermind-node-link',
    entries: [{ sequence: 2, at: now, role: 'mastermind-node-link', stream: 'system', line: 'degraded' }],
    nextSequence: 2,
  }, supervisorId, 'mastermind-node-link', { limit: 10 });
  assert.deepEqual(result, {
    ok: true,
    role: 'mastermind-node-link',
    entries: [{ sequence: 2, at: now, role: 'mastermind-node-link', stream: 'system', line: 'degraded' }],
  });
});

test('restart input requires the exact three fields, lowercase UUID, positive generation, and fixed phrase', () => {
  const valid = {
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    expectedGeneration: 2,
    confirmation: LOCAL_SERVICE_RESTART_CONFIRMATION,
  };
  assert.deepEqual(parseLocalServiceRestartBody(valid), valid);
  for (const invalid of [
    { ...valid, requestId: valid.requestId.toUpperCase() },
    { ...valid, expectedGeneration: 0 },
    { ...valid, expectedGeneration: '2' },
    { ...valid, confirmation: 'restart' },
    { ...valid, extra: true },
  ]) assert.throws(() => parseLocalServiceRestartBody(invalid), LocalServiceProtocolError);
});

test('restart acceptance is request-pinned and strips internal fields', () => {
  const request = { requestId: '123e4567-e89b-42d3-a456-426614174000', expectedGeneration: 2 };
  const response = {
    ok: true,
    supervisorId,
    accepted: true,
    operation: {
      requestId: request.requestId,
      role: 'minecraft-control-agent',
      state: 'accepted',
      expectedGeneration: 2,
      generation: 3,
      acceptedAt: now,
      finishedAt: null,
      code: null,
    },
  };
  assert.deepEqual(publicLocalServiceRestart(response, supervisorId, request), {
    ok: true,
    accepted: true,
    requestId: request.requestId,
    generation: 3,
    operation: { state: 'accepted' },
  });
  response.operation.expectedGeneration = 3;
  assert.throws(() => publicLocalServiceRestart(response, supervisorId, request), LocalServiceProtocolError);
});

test('supervisor errors expose only a bounded code to the client mapper', () => {
  assert.deepEqual(parseSupervisorError({ ok: false, code: 'STALE_GENERATION', message: 'stale' }), {
    code: 'STALE_GENERATION',
  });
  assert.throws(
    () => parseSupervisorError({ ok: false, code: 'STALE_GENERATION', message: 'bad\nmessage' }),
    LocalServiceProtocolError,
  );
  assert.throws(
    () => parseSupervisorError({ ok: false, code: 'STALE_GENERATION', message: 'stale', path: 'C:\\private' }),
    LocalServiceProtocolError,
  );
});

test('service client sends authenticated exact frames and never returns transport credentials', async () => {
  const requestId = '123e4567-e89b-42d3-a456-426614174000';
  const { client, frames, pipes } = loadClient((request) => {
    if (request.action === 'status') return inventory();
    if (request.action === 'logs') {
      return {
        ok: true,
        supervisorId,
        role: request.role,
        entries: [],
        nextSequence: 0,
      };
    }
    return {
      ok: true,
      supervisorId,
      accepted: true,
      operation: {
        requestId,
        role: 'minecraft-control-agent',
        state: 'accepted',
        expectedGeneration: 2,
        generation: 3,
        acceptedAt: now,
        finishedAt: null,
        code: null,
      },
    };
  });

  const status = await client.getLocalServiceInventory();
  const logs = await client.getLocalServiceLogs('next-web', { limit: 5, after: 0 });
  const restart = await client.restartMinecraftControlAgent({ requestId, expectedGeneration: 2 });

  assert.deepEqual(frames, [
    { schemaVersion: 1, supervisorId, token: controlToken, action: 'status' },
    { schemaVersion: 1, supervisorId, token: controlToken, action: 'logs', role: 'next-web', limit: 5, after: 0 },
    {
      schemaVersion: 1,
      supervisorId,
      token: controlToken,
      action: 'restart',
      role: 'minecraft-control-agent',
      requestId,
      expectedGeneration: 2,
    },
  ]);
  assert.deepEqual(pipes, [pipeName, pipeName, pipeName]);
  for (const value of [status, logs, restart]) {
    const publicJson = JSON.stringify(value);
    assert.equal(publicJson.includes(supervisorId), false);
    assert.equal(publicJson.includes(controlToken), false);
    assert.equal(publicJson.includes(pipeName), false);
  }
});

test('service client fails closed when it is not the supervised Next child', async () => {
  const { client } = loadClient(
    () => inventory(),
    { MASTERMIND_LOCAL_CHILD_ROLE: 'minecraft-control-agent' },
  );
  await assert.rejects(
    client.getLocalServiceInventory(),
    (error) => error?.code === 'SERVICE_CONTROL_UNAVAILABLE',
  );
});

test('service client bounds oversized responses and treats a dispatched restart timeout as ambiguous', async () => {
  const oversized = loadClient(() => inventory(), {}, { oversize: true });
  await assert.rejects(
    oversized.client.getLocalServiceInventory(),
    (error) => error?.status === 502 && error?.code === 'INVALID_SERVICE_CONTROL_RESPONSE',
  );

  const timedOut = loadClient(() => inventory(), {}, { timeout: true });
  await assert.rejects(
    timedOut.client.restartMinecraftControlAgent({
      requestId: '123e4567-e89b-42d3-a456-426614174000',
      expectedGeneration: 2,
    }),
    (error) => error?.status === 504 && error?.code === 'SERVICE_RESTART_COMPLETION_UNKNOWN',
  );
  assert.equal(timedOut.frames.length, 1);
  assert.equal(timedOut.frames[0].action, 'restart');
});
