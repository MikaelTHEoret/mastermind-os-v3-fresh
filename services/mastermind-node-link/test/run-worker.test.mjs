import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import test from 'node:test';

import {
  MASTERMIND_NODE_CHILD_ROLE,
  createMastermindNodeWorkerFromEnvironment,
  runMastermindNodeWorkerProcess,
} from '../src/run-worker.mjs';

const TOKEN = 'a'.repeat(64);

function environment(overrides = {}) {
  return {
    LOCALAPPDATA: 'C:\\Users\\Family\\AppData\\Local',
    MASTERMIND_MINECRAFT_DATA_DIR: 'E:\\MastermindPortable',
    MASTERMIND_LOCAL_CONTROL_ENABLED: 'true',
    MASTERMIND_LOCAL_CHILD_ROLE: MASTERMIND_NODE_CHILD_ROLE,
    MASTERMIND_CONTROL_URL: 'http://127.0.0.1:43100',
    MASTERMIND_CONTROL_TOKEN: TOKEN,
    ...overrides,
  };
}

test('production composition shares one host vault while keeping the journal in portable data', () => {
  const credentialStore = { async load() { return null; } };
  let vaultOptions;
  let transportOptions;
  let workerOptions;
  const worker = { start() {}, wait() {}, stop() {} };
  const result = createMastermindNodeWorkerFromEnvironment({
    environment: environment({ MASTERMIND_NODE_EXCHANGE_URL: 'https://attacker.invalid' }),
    credentialStoreFactory(options) { vaultOptions = options; return credentialStore; },
    transportFactory(options) { transportOptions = options; return { pair() {}, exchange() {} }; },
    workerFactory(options) { workerOptions = options; return worker; },
  });
  assert.equal(result, worker);
  assert.equal(
    vaultOptions.vaultFile,
    'C:\\Users\\Family\\AppData\\Local\\Mastermind\\node-link\\credential-v1.dpapi.json',
  );
  assert.equal(
    vaultOptions.dpapiScriptFile,
    path.join(process.cwd(), 'scripts', 'protect-minecraft-account.ps1'),
  );
  assert.equal(workerOptions.journalRoot, 'E:\\MastermindPortable\\state\\node-exchange\\v1');
  assert.equal(workerOptions.controlToken, TOKEN);
  assert.equal(workerOptions.credentialStore, credentialStore);
  assert.equal(transportOptions.credentialStore, credentialStore);
  assert.deepEqual(Object.keys(transportOptions), ['credentialStore']);
  assert.equal(Object.hasOwn(workerOptions, 'exchangeUrl'), false);
});

test('worker process accepts no arguments and stops exactly once on a managed signal', async () => {
  const processObject = new EventEmitter();
  processObject.argv = ['node', 'run-worker.mjs'];
  processObject.env = environment();
  processObject.stderr = { write() { throw new Error('not expected'); } };
  let stopCalls = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const worker = {
    async start() {},
    async wait() { await wait; },
    async stop() { stopCalls += 1; release(); },
  };
  const running = runMastermindNodeWorkerProcess({ processObject, worker });
  await new Promise((resolve) => setImmediate(resolve));
  processObject.emit('SIGTERM');
  processObject.emit('SIGTERM');
  assert.equal(await running, 0);
  assert.equal(stopCalls, 1);
  assert.equal(processObject.listenerCount('SIGINT'), 0);
  assert.equal(processObject.listenerCount('SIGTERM'), 0);
});

test('a signal received during initialization is latched and stops the worker after start completes', async () => {
  const processObject = new EventEmitter();
  processObject.argv = ['node', 'run-worker.mjs'];
  processObject.env = environment();
  processObject.stderr = { write() { throw new Error('not expected'); } };
  let releaseStart;
  let releaseWait;
  const startGate = new Promise((resolve) => { releaseStart = resolve; });
  const waitGate = new Promise((resolve) => { releaseWait = resolve; });
  let stopCalls = 0;
  const running = runMastermindNodeWorkerProcess({
    processObject,
    worker: {
      async start() { await startGate; },
      async wait() { await waitGate; },
      async stop() { stopCalls += 1; releaseWait(); },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  processObject.emit('SIGINT');
  assert.equal(stopCalls, 0);
  releaseStart();
  assert.equal(await running, 0);
  assert.equal(stopCalls, 1);
});

test('fatal worker output is reduced to a bounded safe code', async () => {
  const lines = [];
  const processObject = new EventEmitter();
  processObject.argv = ['node', 'run-worker.mjs'];
  processObject.env = environment();
  const secret = `mn1.11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`;
  const error = Object.assign(new Error(`remote leaked ${secret}`), { code: 'NODE_JOURNAL_RESTART_REQUIRED' });
  const exitCode = await runMastermindNodeWorkerProcess({
    processObject,
    writeDiagnostic(line) { lines.push(line); },
    worker: {
      async start() {},
      async wait() { throw error; },
      async stop() {},
    },
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(lines, ['Mastermind node-link stopped: NODE_JOURNAL_RESTART_REQUIRED']);
  assert.equal(lines.join('\n').includes(secret), false);

  const badArgs = await runMastermindNodeWorkerProcess({
    processObject,
    args: ['--url=https://attacker.invalid'],
    writeDiagnostic(line) { lines.push(line); },
  });
  assert.equal(badArgs, 1);
  assert.equal(lines.at(-1), 'Mastermind node-link stopped: NODE_WORKER_ARGUMENTS_INVALID');
});

test('production core negotiation is opt-in and malformed flags fail before any dependency is constructed', () => {
  for (const [flag, expected] of [[undefined, false], ['false', false], ['true', true]]) {
    let options;
    createMastermindNodeWorkerFromEnvironment({
      environment: environment({ MASTERMIND_CORE_STATUS_ENABLED: flag }),
      credentialStoreFactory() { return {}; }, transportFactory() { return {}; },
      workerFactory(value) { options = value; return {}; },
    });
    assert.equal(options.enableCoreStatus, expected);
  }
  assert.throws(() => createMastermindNodeWorkerFromEnvironment({
    environment: environment({ MASTERMIND_CORE_STATUS_ENABLED: 'yes' }),
    credentialStoreFactory() { throw new Error('must not construct'); },
  }), { code: 'NODE_WORKER_CONFIGURATION_INVALID' });
});
