import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  resolveMastermindNodeCredentialVaultFile,
  resolveMastermindNodeStateRoot,
} from '../src/state-paths.mjs';
import { createMastermindNodeWorker } from '../src/worker.mjs';
import { BOOT_ID } from './fixtures.mjs';

test('canonical host vault path is independent from the explicit portable journal root', () => {
  const stateRoot = resolveMastermindNodeStateRoot({ LOCALAPPDATA: 'C:\\Users\\Family\\AppData\\Local' });
  assert.equal(stateRoot, 'C:\\Users\\Family\\AppData\\Local\\Mastermind\\node-link');
  assert.equal(
    resolveMastermindNodeCredentialVaultFile(stateRoot),
    'C:\\Users\\Family\\AppData\\Local\\Mastermind\\node-link\\credential-v1.dpapi.json',
  );
  assert.throws(() => resolveMastermindNodeStateRoot({ LOCALAPPDATA: 'relative' }), /absolute path/);
});

test('worker factory requires portable journalRoot and exposes a nonblocking supervisor lifecycle', async () => {
  const pairingCalls = [];
  const credentialStore = {
    async load() { return null; },
    async beginPairing(token, name) { pairingCalls.push([token, name]); return { state: 'pending' }; },
  };
  const journal = {
    async initialize() { return { effects: 0, pendingReceipts: 0 }; },
    async selectNode(nodeId) { return { selectedNodeId: nodeId }; },
    async acquireExecution() { return async () => undefined; },
    async begin() { throw new Error('not expected'); },
    async appendReceipt() { throw new Error('not expected'); },
    async listPendingReceipts() { return []; },
    async acknowledgeReceiptIds() { return { removed: 0, remaining: 0 }; },
    async replayTerminal() { return null; },
  };
  const dependencies = {
    exchangeTransport: { async pair() {}, async exchange() {} },
    credentialStore,
    journal,
    localAgent: {
      async observeStatus() { throw new Error('not expected'); },
      async ensureFamilyServerRunning() { throw new Error('not expected'); },
      async startCompanion() { throw new Error('not expected'); },
    },
    executor: { async execute() { throw new Error('not expected'); } },
    bootId: BOOT_ID,
  };
  assert.throws(() => createMastermindNodeWorker(dependencies), /journalRoot/);
  const worker = createMastermindNodeWorker({
    ...dependencies,
    journalRoot: path.resolve('portable-state', 'node-exchange', 'v1'),
    monotonicNow: () => 1_000,
  });
  assert.deepEqual(worker.health(), {
    state: 'stopped', paired: false, lastExchangeAt: null, lastErrorCode: null, attentionCode: null,
  });
  await worker.beginPairing('synthetic-token', 'Family Laptop');
  assert.deepEqual(pairingCalls, [['synthetic-token', 'Family Laptop']]);
  const once = await worker.runOnce();
  assert.equal(once.phase, 'unpaired');
  assert.equal(worker.health().state, 'unpaired');
  await worker.stop();
  assert.equal(worker.health().state, 'stopped');
});
