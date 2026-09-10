import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { digestMastermindNodeCredential } from '../../../protocol/mastermind-node-exchange/contract.mjs';
import { FileMastermindNodeEffectJournal } from '../src/effect-journal.mjs';
import { MastermindNodeHttpsTransportError } from '../src/fixed-https-transport.mjs';
import { MastermindNodeLink } from '../src/node-link.mjs';
import {
  BOOT_ID,
  EXCHANGE_ID,
  NODE_CREDENTIAL,
  NODE_ID,
  PAIRING_CREDENTIAL,
  PAIRING_ID,
  lease,
  status,
  uuidSequence,
} from './fixtures.mjs';

function credentialRecord(state = 'paired') {
  return {
    schemaVersion: 1,
    state,
    nodeId: NODE_ID,
    nodeCredential: NODE_CREDENTIAL,
    pairingId: PAIRING_ID,
    pairingCredential: state === 'pending' ? PAIRING_CREDENTIAL : null,
    displayName: 'Family Laptop',
    createdAt: '2026-08-15T04:00:00.000Z',
    pairedAt: state === 'paired' ? '2026-08-15T04:00:01.000Z' : null,
  };
}

function pairedRecordFor(nodeId, secret = 'Z') {
  return {
    ...credentialRecord('paired'),
    nodeId,
    nodeCredential: `mn1.${nodeId}.${secret.repeat(43)}`,
  };
}

function fakeJournal(receipts = []) {
  return {
    beginCalls: 0,
    acknowledged: [],
    selectedNodeIds: [],
    async initialize() { return { effects: 0, pendingReceipts: receipts.length }; },
    async selectNode(nodeId) { this.selectedNodeIds.push(nodeId); return { selectedNodeId: nodeId }; },
    async acquireExecution() { return async () => undefined; },
    async begin() { this.beginCalls += 1; return { created: true, effect: { lastSequence: 0, terminal: null } }; },
    async appendReceipt() { throw new Error('not expected'); },
    async listPendingReceipts() { return structuredClone(receipts); },
    async acknowledgeReceiptIds(ids) { this.acknowledged.push(...ids); return { removed: ids.length, remaining: 0 }; },
    async replayTerminal() { return null; },
  };
}

test('unpaired worker stays healthy without touching transport or local control agent', async () => {
  let transportCalls = 0;
  let statusCalls = 0;
  const link = new MastermindNodeLink({
    credentialStore: { async load() { return null; } },
    exchangeTransport: {
      async pair() { transportCalls += 1; },
      async exchange() { transportCalls += 1; },
    },
    journal: fakeJournal(),
    executor: { async execute() { throw new Error('not expected'); } },
    statusProvider: { async observeStatus() { statusCalls += 1; } },
    bootId: BOOT_ID,
  });
  const result = await link.runOnce();
  assert.deepEqual(result, { phase: 'unpaired', paired: false, nextPollAfterMs: 5_000, lease: null });
  assert.equal(link.health().state, 'unpaired');
  assert.equal(link.health().attentionCode, 'node-unpaired');
  assert.equal(transportCalls, 0);
  assert.equal(statusCalls, 0);
});

test('pending enrollment sends only the strict digest claim and atomically marks paired', async () => {
  const store = {
    record: credentialRecord('pending'),
    markCalls: [],
    async load() { return structuredClone(this.record); },
    async markPaired(scope) {
      this.markCalls.push(scope);
      this.record = { ...this.record, state: 'paired', pairingCredential: null, pairedAt: scope.pairedAt };
      return { state: 'paired', nodeId: NODE_ID, pairingId: PAIRING_ID };
    },
  };
  let captured;
  const link = new MastermindNodeLink({
    credentialStore: store,
    exchangeTransport: {
      async pair(request) {
        captured = request;
        return {
          schemaVersion: 1,
          nodeId: NODE_ID,
          pairedAt: '2026-08-15T04:00:01.000Z',
          nextPollAfterMs: 1_000,
        };
      },
      async exchange() { throw new Error('not expected'); },
    },
    journal: fakeJournal(),
    executor: { async execute() { throw new Error('not expected'); } },
    statusProvider: { async observeStatus() { throw new Error('not expected'); } },
    bootId: BOOT_ID,
    agentVersion: '0.1.0',
  });
  const result = await link.runOnce();
  assert.equal(result.phase, 'paired');
  assert.equal(result.paired, true);
  assert.equal(captured.node.credentialSha256, digestMastermindNodeCredential(NODE_CREDENTIAL));
  assert.equal(JSON.stringify(captured).includes(NODE_CREDENTIAL), false);
  assert.equal(JSON.stringify(captured).includes(PAIRING_CREDENTIAL), false);
  assert.deepEqual(store.markCalls, [{
    expectedNodeId: NODE_ID,
    expectedPairingId: PAIRING_ID,
    pairedAt: '2026-08-15T04:00:01.000Z',
  }]);
  assert.equal(store.record.pairingCredential, null);
  assert.equal(link.health().paired, true);
  assert.equal(link.health().state, 'degraded');
});

test('only a concrete terminal pairing expiry retires the exact pending claim', async () => {
  const store = {
    record: credentialRecord('pending'),
    retireCalls: [],
    async load() { return this.record ? structuredClone(this.record) : null; },
    async retirePendingPairing(scope) {
      this.retireCalls.push(scope);
      this.record = null;
      return { retired: true, state: 'unpaired', nodeId: null, pairingId: null };
    },
  };
  const link = new MastermindNodeLink({
    credentialStore: store,
    exchangeTransport: {
      async pair() { throw new MastermindNodeHttpsTransportError('NODE_PAIRING_EXPIRED'); },
      async exchange() { throw new Error('not expected'); },
    },
    journal: fakeJournal(),
    executor: { async execute() { throw new Error('not expected'); } },
    statusProvider: { async observeStatus() { throw new Error('not expected'); } },
    bootId: BOOT_ID,
  });
  const result = await link.runOnce();
  assert.equal(result.phase, 'unpaired');
  assert.deepEqual(store.retireCalls, [{
    expectedNodeId: NODE_ID,
    expectedPairingId: PAIRING_ID,
    expectedCredentialSha256: digestMastermindNodeCredential(NODE_CREDENTIAL),
  }]);
  assert.equal(store.record, null);
  assert.equal(link.health().state, 'unpaired');
  assert.equal(link.health().lastErrorCode, 'NODE_PAIRING_EXPIRED');
});

test('ambiguous pairing failures preserve the protected pending claim', async () => {
  const store = {
    record: credentialRecord('pending'),
    retireCalls: 0,
    async load() { return structuredClone(this.record); },
    async retirePendingPairing() { this.retireCalls += 1; },
  };
  const link = new MastermindNodeLink({
    credentialStore: store,
    exchangeTransport: {
      async pair() { throw new MastermindNodeHttpsTransportError('NODE_HOSTED_TIMEOUT', true); },
      async exchange() { throw new Error('not expected'); },
    },
    journal: fakeJournal(),
    executor: { async execute() { throw new Error('not expected'); } },
    statusProvider: { async observeStatus() { throw new Error('not expected'); } },
    bootId: BOOT_ID,
  });
  await assert.rejects(link.runOnce(), (error) => error?.code === 'NODE_HOSTED_TIMEOUT');
  assert.equal(store.retireCalls, 0);
  assert.equal(store.record.state, 'pending');
});

test('paired exchange is strict, redacted, and becomes online', async () => {
  let request;
  let statusOptions;
  const journal = fakeJournal();
  const ids = uuidSequence(200);
  const link = new MastermindNodeLink({
    credentialStore: { async load() { return credentialRecord('paired'); } },
    exchangeTransport: {
      async pair() { throw new Error('not expected'); },
      async exchange(value) {
        request = value;
        return {
          schemaVersion: 1,
          exchangeId: value.exchangeId,
          serverTime: '2026-08-15T04:00:03.000Z',
          nextPollAfterMs: 5_000,
          acknowledgedReceiptIds: [],
          lease: null,
        };
      },
    },
    journal,
    executor: { async execute() { throw new Error('not expected'); } },
    statusProvider: { async observeStatus(options) { statusOptions = options; return status(); } },
    now: () => Date.parse('2026-08-15T04:00:02.000Z'),
    monotonicNow: () => 1_000,
    randomUUID: () => ids(),
    bootId: BOOT_ID,
  });
  const result = await link.runOnce();
  assert.equal(result.phase, 'exchange');
  assert.equal(result.lease, null);
  assert.equal(request.nodeId, NODE_ID);
  assert.equal(request.bootId, BOOT_ID);
  assert.deepEqual(request.receipts, []);
  assert.equal(statusOptions.includeClientStatus, false);
  assert.equal(JSON.stringify(request).includes(NODE_CREDENTIAL), false);
  assert.equal(link.health().state, 'online');
  assert.equal(link.health().paired, true);
});

test('RTT-consumed lease budget never begins a durable local effect', async () => {
  const journal = fakeJournal();
  let monotonic = 0;
  let executorCalls = 0;
  const shortLease = lease({
    createdAt: '2026-08-15T03:59:00.000Z',
    leasedAt: '2026-08-15T03:59:59.000Z',
    leaseExpiresAt: '2026-08-15T04:00:05.000Z',
  });
  const link = new MastermindNodeLink({
    credentialStore: { async load() { return credentialRecord('paired'); } },
    exchangeTransport: {
      async pair() { throw new Error('not expected'); },
      async exchange(value) {
        monotonic = 6_000;
        return {
          schemaVersion: 1,
          exchangeId: value.exchangeId,
          serverTime: '2026-08-15T04:00:00.000Z',
          nextPollAfterMs: 5_000,
          acknowledgedReceiptIds: [],
          lease: shortLease,
        };
      },
    },
    journal,
    executor: { async execute() { executorCalls += 1; } },
    statusProvider: { async observeStatus() { return status(); } },
    now: () => Date.parse('2026-08-15T04:00:00.000Z'),
    monotonicNow: () => monotonic,
    randomUUID: () => EXCHANGE_ID,
    bootId: BOOT_ID,
  });
  const result = await link.runOnce();
  assert.deepEqual(result.execution, { skipped: true, code: 'lease-lost' });
  assert.equal(journal.beginCalls, 0);
  assert.equal(executorCalls, 0);
});

test('receipt acknowledgement time consumes the already anchored lease deadline', async () => {
  let monotonic = 0;
  const journal = fakeJournal();
  journal.acknowledgeReceiptIds = async () => {
    monotonic = 11_000;
    return { removed: 0, remaining: 0 };
  };
  const shortLease = lease({
    createdAt: '2026-08-15T03:59:00.000Z',
    leasedAt: '2026-08-15T03:59:59.000Z',
    leaseExpiresAt: '2026-08-15T04:00:10.000Z',
  });
  const link = new MastermindNodeLink({
    credentialStore: { async load() { return credentialRecord('paired'); } },
    exchangeTransport: {
      async pair() { throw new Error('not expected'); },
      async exchange(value) {
        monotonic = 1_000;
        return {
          schemaVersion: 1,
          exchangeId: value.exchangeId,
          serverTime: '2026-08-15T04:00:00.000Z',
          nextPollAfterMs: 5_000,
          acknowledgedReceiptIds: [],
          lease: shortLease,
        };
      },
    },
    journal,
    executor: { async execute() { throw new Error('not expected'); } },
    statusProvider: { async observeStatus() { return status(); } },
    now: () => Date.parse('2026-08-15T04:00:00.000Z'),
    monotonicNow: () => monotonic,
    randomUUID: () => EXCHANGE_ID,
    bootId: BOOT_ID,
  });
  const result = await link.runOnce();
  assert.deepEqual(result.execution, { skipped: true, code: 'lease-lost' });
  assert.equal(journal.beginCalls, 0);
});

test('fatal receipt-WAL poison completes the worker loop for supervisor restart', async () => {
  const journal = fakeJournal();
  journal.listPendingReceipts = async () => {
    const error = new Error('restart required');
    error.code = 'NODE_JOURNAL_RESTART_REQUIRED';
    throw error;
  };
  const link = new MastermindNodeLink({
    credentialStore: { async load() { return credentialRecord('paired'); } },
    exchangeTransport: { async pair() {}, async exchange() {} },
    journal,
    executor: { async execute() {} },
    statusProvider: { async observeStatus() { return status(); } },
    bootId: BOOT_ID,
  });
  await link.start();
  await assert.rejects(link.wait(), (error) => error?.code === 'NODE_JOURNAL_RESTART_REQUIRED');
  assert.equal(link.health().state, 'stopped');
});

test('new enrollment never uploads old-node receipts while same-node reconnect still replays them', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-node-identity-journal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const oldNodeId = '88888888-8888-4888-8888-888888888888';
  const oldLease = lease({ nodeId: oldNodeId });
  const oldJournal = new FileMastermindNodeEffectJournal(root, {
    now: () => Date.parse('2026-08-15T04:00:02.000Z'),
    randomUUID: uuidSequence(1),
  });
  await oldJournal.initialize();
  await oldJournal.selectNode(oldNodeId);
  await oldJournal.begin(oldLease);
  const oldReceipt = await oldJournal.appendReceipt(oldLease, BOOT_ID, {
    state: 'accepted', stage: 'journaled', code: 'accepted', retryable: false, result: null,
  });

  const requests = [];
  const exchangeTransport = {
    async pair() { throw new Error('not expected'); },
    async exchange(request) {
      requests.push(request);
      return {
        schemaVersion: 1,
        exchangeId: request.exchangeId,
        serverTime: '2026-08-15T04:00:03.000Z',
        nextPollAfterMs: 5_000,
        acknowledgedReceiptIds: [],
        lease: null,
      };
    },
  };
  const newJournal = new FileMastermindNodeEffectJournal(root, { randomUUID: uuidSequence(100) });
  const newLink = new MastermindNodeLink({
    credentialStore: { async load() { return pairedRecordFor(NODE_ID, 'N'); } },
    exchangeTransport,
    journal: newJournal,
    executor: { async execute() { throw new Error('not expected'); } },
    statusProvider: { async observeStatus() { return status(); } },
    now: () => Date.parse('2026-08-15T04:00:02.000Z'),
    monotonicNow: () => 1_000,
    randomUUID: uuidSequence(200),
    bootId: BOOT_ID,
  });
  await newLink.runOnce();
  assert.equal(requests[0].nodeId, NODE_ID);
  assert.deepEqual(requests[0].receipts, []);

  const reconnectJournal = new FileMastermindNodeEffectJournal(root, { randomUUID: uuidSequence(300) });
  const reconnectLink = new MastermindNodeLink({
    credentialStore: { async load() { return pairedRecordFor(oldNodeId, 'O'); } },
    exchangeTransport,
    journal: reconnectJournal,
    executor: { async execute() { throw new Error('not expected'); } },
    statusProvider: { async observeStatus() { return status(); } },
    now: () => Date.parse('2026-08-15T04:00:02.000Z'),
    monotonicNow: () => 1_000,
    randomUUID: uuidSequence(400),
    bootId: BOOT_ID,
  });
  await reconnectLink.runOnce();
  assert.equal(requests[1].nodeId, oldNodeId);
  assert.deepEqual(requests[1].receipts, [oldReceipt]);
});
