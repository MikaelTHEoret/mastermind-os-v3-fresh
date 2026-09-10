import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileMastermindNodeEffectJournal } from '../src/effect-journal.mjs';
import { BOOT_ID, PRIOR_BOOT_ID, lease, uuidSequence } from './fixtures.mjs';

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-node-journal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('durable receipts replay unchanged across boots and stay sequence-ordered per job', async (t) => {
  const root = await temporaryRoot(t);
  let clock = Date.parse('2026-08-15T04:00:02.000Z');
  const journal = new FileMastermindNodeEffectJournal(root, {
    now: () => clock,
    randomUUID: uuidSequence(),
  });
  const currentLease = lease();
  await journal.initialize();
  await journal.selectNode(currentLease.nodeId);
  await journal.begin(currentLease);
  const accepted = await journal.appendReceipt(currentLease, PRIOR_BOOT_ID, {
    state: 'accepted', stage: 'journaled', code: 'accepted', retryable: false, result: null,
  });
  clock -= 10_000; // clock rollback must not affect protocol ordering
  const running = await journal.appendReceipt(currentLease, PRIOR_BOOT_ID, {
    state: 'running', stage: 'starting-family-server', code: 'in-progress', retryable: false, result: null,
  });
  const pendingBeforeRestart = await journal.listPendingReceipts();
  assert.deepEqual(pendingBeforeRestart.map(({ sequence }) => sequence), [1, 2]);
  assert.equal(pendingBeforeRestart[0].bootId, PRIOR_BOOT_ID);
  assert.equal(pendingBeforeRestart[1].bootId, PRIOR_BOOT_ID);

  const restarted = new FileMastermindNodeEffectJournal(root, {
    now: () => Date.parse('2026-08-15T04:00:03.000Z'),
    randomUUID: uuidSequence(100),
  });
  await restarted.initialize();
  await restarted.selectNode(currentLease.nodeId);
  const pendingAfterRestart = await restarted.listPendingReceipts();
  assert.deepEqual(pendingAfterRestart, [accepted, running]);
  const terminal = await restarted.appendReceipt(currentLease, BOOT_ID, {
    state: 'succeeded',
    stage: 'desired-state-reached',
    code: 'desired-state-reached',
    retryable: false,
    result: { familyServer: 'running', companion: 'running', companionBridge: 'ready' },
  });
  assert.equal(terminal.sequence, 3);
  assert.equal(terminal.bootId, BOOT_ID);
});

test('receipt WAL reconciles a crash between receipt and effect publication', async (t) => {
  const root = await temporaryRoot(t);
  const currentLease = lease();
  let injected = false;
  const crashed = new FileMastermindNodeEffectJournal(root, {
    now: () => Date.parse('2026-08-15T04:00:02.000Z'),
    randomUUID: uuidSequence(),
    afterReceiptPublished: () => {
      if (!injected) {
        injected = true;
        throw new Error('simulated power loss after WAL publication');
      }
    },
  });
  await crashed.initialize();
  await crashed.selectNode(currentLease.nodeId);
  await crashed.begin(currentLease);
  await assert.rejects(
    crashed.appendReceipt(currentLease, PRIOR_BOOT_ID, {
      state: 'accepted', stage: 'journaled', code: 'accepted', retryable: false, result: null,
    }),
    (error) => error?.code === 'NODE_JOURNAL_RESTART_REQUIRED',
  );
  await assert.rejects(crashed.listPendingReceipts(), (error) => error?.code === 'NODE_JOURNAL_RESTART_REQUIRED');

  const recovered = new FileMastermindNodeEffectJournal(root, {
    now: () => Date.parse('2026-08-15T04:00:03.000Z'),
    randomUUID: uuidSequence(100),
  });
  const initialized = await recovered.initialize();
  assert.equal(initialized.pendingReceipts, 0);
  const selected = await recovered.selectNode(currentLease.nodeId);
  assert.equal(selected.pendingReceipts, 1);
  const effect = await recovered.get(currentLease);
  assert.equal(effect.lastSequence, 1);
  assert.equal(effect.state, 'accepted');
  const pending = await recovered.listPendingReceipts();
  assert.equal(pending[0].sequence, 1);
  assert.equal(pending[0].bootId, PRIOR_BOOT_ID);
  const next = await recovered.appendReceipt(currentLease, BOOT_ID, {
    state: 'running', stage: 'checking-local-state', code: 'in-progress', retryable: false, result: null,
  });
  assert.equal(next.sequence, 2);
});

test('a command cannot be rebound across node-owned journal namespaces', async (t) => {
  const root = await temporaryRoot(t);
  const journal = new FileMastermindNodeEffectJournal(root, { randomUUID: uuidSequence() });
  await journal.initialize();
  await journal.selectNode(lease().nodeId);
  await journal.begin(lease());
  await assert.rejects(
    journal.begin(lease({ nodeId: '99999999-9999-4999-8999-999999999999' })),
    (error) => error?.code === 'NODE_JOURNAL_OWNER_MISMATCH',
  );
});

test('portable receipts remain in their immutable node namespace across re-enrollment', async (t) => {
  const root = await temporaryRoot(t);
  const oldNodeId = '88888888-8888-4888-8888-888888888888';
  const newNodeId = '99999999-9999-4999-8999-999999999999';
  const oldLease = lease({ nodeId: oldNodeId });
  const journal = new FileMastermindNodeEffectJournal(root, {
    now: () => Date.parse('2026-08-15T04:00:02.000Z'),
    randomUUID: uuidSequence(),
  });
  await journal.initialize();
  await journal.selectNode(oldNodeId);
  await journal.begin(oldLease);
  const oldReceipt = await journal.appendReceipt(oldLease, PRIOR_BOOT_ID, {
    state: 'accepted', stage: 'journaled', code: 'accepted', retryable: false, result: null,
  });

  const newSelection = await journal.selectNode(newNodeId);
  assert.deepEqual(newSelection, { selectedNodeId: newNodeId, effects: 0, pendingReceipts: 0 });
  assert.deepEqual(await journal.listPendingReceipts(), []);

  const restored = await journal.selectNode(oldNodeId);
  assert.equal(restored.pendingReceipts, 1);
  assert.deepEqual(await journal.listPendingReceipts(), [oldReceipt]);
});

test('journal identity cannot switch while a local effect can still mutate', async (t) => {
  const root = await temporaryRoot(t);
  const oldNodeId = '88888888-8888-4888-8888-888888888888';
  const newNodeId = '99999999-9999-4999-8999-999999999999';
  const journal = new FileMastermindNodeEffectJournal(root, { randomUUID: uuidSequence() });
  await journal.initialize();
  await journal.selectNode(oldNodeId);
  const release = await journal.acquireExecution(oldNodeId);
  await assert.rejects(
    journal.selectNode(newNodeId),
    (error) => error?.code === 'NODE_JOURNAL_SWITCH_IN_FLIGHT',
  );
  await release();
  const selected = await journal.selectNode(newNodeId);
  assert.equal(selected.selectedNodeId, newNodeId);
});

test('persisted owner record rejects a renamed namespace', async (t) => {
  const root = await temporaryRoot(t);
  const oldNodeId = '88888888-8888-4888-8888-888888888888';
  const newNodeId = '99999999-9999-4999-8999-999999999999';
  const journal = new FileMastermindNodeEffectJournal(root, { randomUUID: uuidSequence() });
  await journal.initialize();
  await journal.selectNode(oldNodeId);
  await fs.rename(path.join(root, 'nodes', oldNodeId), path.join(root, 'nodes', newNodeId));

  const reopened = new FileMastermindNodeEffectJournal(root, { randomUUID: uuidSequence(100) });
  await reopened.initialize();
  await assert.rejects(
    reopened.selectNode(newNodeId),
    (error) => error?.code === 'NODE_JOURNAL_OWNER_MISMATCH',
  );
});
