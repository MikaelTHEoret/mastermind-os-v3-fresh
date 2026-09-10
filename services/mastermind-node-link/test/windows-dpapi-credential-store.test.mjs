import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { digestMastermindNodeCredential } from '../../../protocol/mastermind-node-exchange/contract.mjs';
import {
  WindowsDpapiMastermindNodeCredentialStore,
  acquireMastermindNodeCredentialPipeMutex,
} from '../src/windows-dpapi-credential-store.mjs';
import { NODE_ID, PAIRING_CREDENTIAL, PAIRING_ID, uuidSequence } from './fixtures.mjs';

function xorTransform(mask) {
  return async (_action, bytes) => {
    const result = Buffer.from(bytes);
    for (let index = 0; index < result.length; index += 1) result[index] ^= mask;
    return result;
  };
}

async function vaultPath(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-node-vault-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, 'credential-v1.dpapi.json');
}

test('pending enrollment is protected before use and pairing erases the one-time credential', async (t) => {
  const vaultFile = await vaultPath(t);
  const store = new WindowsDpapiMastermindNodeCredentialStore({
    vaultFile,
    transform: xorTransform(0x5a),
    now: () => Date.parse('2026-08-15T04:00:00.000Z'),
    randomUUID: (() => {
      const temporaryIds = uuidSequence(10);
      let first = true;
      return () => {
        if (first) { first = false; return NODE_ID; }
        return temporaryIds();
      };
    })(),
    randomBytes: () => Buffer.alloc(32, 7),
  });
  const begun = await store.beginPairing(PAIRING_CREDENTIAL, 'Family Laptop');
  assert.deepEqual(begun, { state: 'pending', nodeId: NODE_ID, pairingId: PAIRING_ID });
  assert.deepEqual(await store.beginPairing(PAIRING_CREDENTIAL, 'Family Laptop'), begun);
  const pending = await store.load();
  assert.equal(pending.state, 'pending');
  assert.equal(pending.nodeId, NODE_ID);
  assert.equal(pending.pairingCredential, PAIRING_CREDENTIAL);

  const rawPending = await fs.readFile(vaultFile, 'utf8');
  assert.equal(rawPending.includes('mn1.'), false);
  assert.equal(rawPending.includes('mnp1.'), false);
  assert.equal(rawPending.includes('Family Laptop'), false);

  const paired = await store.markPaired({
    expectedNodeId: NODE_ID,
    expectedPairingId: PAIRING_ID,
    pairedAt: '2026-08-15T04:00:01.000Z',
  });
  assert.deepEqual(paired, { state: 'paired', nodeId: NODE_ID, pairingId: PAIRING_ID });
  const record = await store.load();
  assert.equal(record.state, 'paired');
  assert.equal(record.pairingCredential, null);
  assert.equal(record.pairedAt, '2026-08-15T04:00:01.000Z');
});

test('CurrentUser protection mismatch cannot decrypt the host-bound vault', async (t) => {
  const vaultFile = await vaultPath(t);
  const options = {
    vaultFile,
    now: () => Date.parse('2026-08-15T04:00:00.000Z'),
    randomUUID: uuidSequence(),
    randomBytes: () => Buffer.alloc(32, 9),
  };
  const owner = new WindowsDpapiMastermindNodeCredentialStore({ ...options, transform: xorTransform(0x21) });
  await owner.beginPairing(PAIRING_CREDENTIAL, 'Family Laptop');
  const otherUser = new WindowsDpapiMastermindNodeCredentialStore({ ...options, transform: xorTransform(0x22) });
  await assert.rejects(otherUser.load(), (error) => error?.code === 'NODE_CREDENTIAL_VAULT_INVALID');
});

test('cross-process first publication elects one identity and identical claims converge on it', async (t) => {
  const vaultFile = await vaultPath(t);
  const transform = xorTransform(0x6c);
  const common = {
    vaultFile,
    transform,
    now: () => Date.parse('2026-08-15T04:00:00.000Z'),
    randomBytes: () => Buffer.alloc(32, 3),
  };
  const left = new WindowsDpapiMastermindNodeCredentialStore({ ...common, randomUUID: uuidSequence(1) });
  const right = new WindowsDpapiMastermindNodeCredentialStore({ ...common, randomUUID: uuidSequence(100) });
  const [leftResult, rightResult] = await Promise.all([
    left.beginPairing(PAIRING_CREDENTIAL, 'Family Laptop'),
    right.beginPairing(PAIRING_CREDENTIAL, 'Family Laptop'),
  ]);
  assert.deepEqual(leftResult, rightResult);
  const persisted = await left.load();
  assert.equal(persisted.nodeId, leftResult.nodeId);
  assert.equal(persisted.state, 'pending');
  await assert.rejects(
    right.beginPairing(`mnp1.${PAIRING_ID}.${'C'.repeat(43)}`, 'Family Laptop'),
    (error) => error?.code === 'NODE_PAIRING_STATE_CONFLICT',
  );
});

test('exact expired pending enrollment retires idempotently and permits a fresh claim', async (t) => {
  const vaultFile = await vaultPath(t);
  const ids = uuidSequence(500);
  let first = true;
  const store = new WindowsDpapiMastermindNodeCredentialStore({
    vaultFile,
    transform: xorTransform(0x31),
    now: () => Date.parse('2026-08-15T04:00:00.000Z'),
    randomUUID: () => {
      if (first) { first = false; return NODE_ID; }
      return ids();
    },
    randomBytes: () => Buffer.alloc(32, 5),
  });
  await store.beginPairing(PAIRING_CREDENTIAL, 'Family Laptop');
  const pending = await store.load();
  const scope = {
    expectedNodeId: pending.nodeId,
    expectedPairingId: pending.pairingId,
    expectedCredentialSha256: digestMastermindNodeCredential(pending.nodeCredential),
  };
  assert.deepEqual(await store.retirePendingPairing(scope), {
    retired: true, state: 'unpaired', nodeId: null, pairingId: null,
  });
  assert.equal(await store.load(), null);
  assert.deepEqual(await store.retirePendingPairing(scope), {
    retired: false, state: 'unpaired', nodeId: null, pairingId: null,
  });
  const fresh = await store.beginPairing(PAIRING_CREDENTIAL, 'Family Laptop');
  assert.notEqual(fresh.nodeId, NODE_ID);
  assert.equal((await store.load()).state, 'pending');
});

test('wrong-scope and paired retirement attempts preserve the protected identity', async (t) => {
  const vaultFile = await vaultPath(t);
  const store = new WindowsDpapiMastermindNodeCredentialStore({
    vaultFile,
    transform: xorTransform(0x32),
    now: () => Date.parse('2026-08-15T04:00:00.000Z'),
    randomUUID: (() => {
      const temporaryIds = uuidSequence(600);
      let first = true;
      return () => {
        if (first) { first = false; return NODE_ID; }
        return temporaryIds();
      };
    })(),
    randomBytes: () => Buffer.alloc(32, 6),
  });
  await store.beginPairing(PAIRING_CREDENTIAL, 'Family Laptop');
  const pending = await store.load();
  const exactScope = {
    expectedNodeId: pending.nodeId,
    expectedPairingId: pending.pairingId,
    expectedCredentialSha256: digestMastermindNodeCredential(pending.nodeCredential),
  };
  await assert.rejects(
    store.retirePendingPairing({ ...exactScope, expectedCredentialSha256: '0'.repeat(64) }),
    (error) => error?.code === 'NODE_PAIRING_SCOPE_MISMATCH',
  );
  assert.equal((await store.load()).state, 'pending');
  await store.markPaired({
    expectedNodeId: NODE_ID,
    expectedPairingId: PAIRING_ID,
    pairedAt: '2026-08-15T04:00:01.000Z',
  });
  assert.deepEqual(await store.retirePendingPairing(exactScope), {
    retired: false, state: 'paired', nodeId: NODE_ID, pairingId: PAIRING_ID,
  });
  assert.equal((await store.load()).state, 'paired');
});

test('crash after restoration hard-link publication is reconciled without hiding the paired identity', async (t) => {
  const vaultFile = await vaultPath(t);
  const store = new WindowsDpapiMastermindNodeCredentialStore({
    vaultFile,
    transform: xorTransform(0x33),
    now: () => Date.parse('2026-08-15T04:00:00.000Z'),
    randomUUID: (() => {
      const temporaryIds = uuidSequence(650);
      let first = true;
      return () => {
        if (first) { first = false; return NODE_ID; }
        return temporaryIds();
      };
    })(),
    randomBytes: () => Buffer.alloc(32, 7),
  });
  await store.beginPairing(PAIRING_CREDENTIAL, 'Family Laptop');
  const pending = await store.load();
  const scope = {
    expectedNodeId: pending.nodeId,
    expectedPairingId: pending.pairingId,
    expectedCredentialSha256: digestMastermindNodeCredential(pending.nodeCredential),
  };
  await store.markPaired({
    expectedNodeId: NODE_ID,
    expectedPairingId: PAIRING_ID,
    pairedAt: '2026-08-15T04:00:01.000Z',
  });
  await fs.link(vaultFile, `${vaultFile}.retiring`);
  await fs.writeFile(
    `${vaultFile}.retire-intent.json`,
    `${JSON.stringify({ schemaVersion: 1, ...scope })}\n`,
    'utf8',
  );
  const recovered = await store.load();
  assert.equal(recovered.state, 'paired');
  await assert.rejects(fs.lstat(`${vaultFile}.retiring`), (error) => error?.code === 'ENOENT');
  await assert.rejects(fs.lstat(`${vaultFile}.retire-intent.json`), (error) => error?.code === 'ENOENT');
});

test('cross-process pairing publication cannot be deleted by an overlapping expiry retirement', async (t) => {
  const vaultFile = await vaultPath(t);
  const common = {
    vaultFile,
    now: () => Date.parse('2026-08-15T04:00:00.000Z'),
    randomUUID: uuidSequence(700),
    randomBytes: () => Buffer.alloc(32, 8),
  };
  const owner = new WindowsDpapiMastermindNodeCredentialStore({ ...common, transform: xorTransform(0x44) });
  await owner.beginPairing(PAIRING_CREDENTIAL, 'Family Laptop');
  const pending = await owner.load();
  const scope = {
    expectedNodeId: pending.nodeId,
    expectedPairingId: pending.pairingId,
    expectedCredentialSha256: digestMastermindNodeCredential(pending.nodeCredential),
  };

  let pairProtectReached;
  let releasePairProtect;
  const pairProtectGate = new Promise((resolve) => { releasePairProtect = resolve; });
  const pairer = new WindowsDpapiMastermindNodeCredentialStore({
    ...common,
    transform: async (action, bytes) => {
      const result = await xorTransform(0x44)(action, bytes);
      if (action === 'Protect') {
        pairProtectReached?.();
        await pairProtectGate;
      }
      return result;
    },
  });
  const pairReady = new Promise((resolve) => { pairProtectReached = resolve; });
  const pairing = pairer.markPaired({
    expectedNodeId: pending.nodeId,
    expectedPairingId: pending.pairingId,
    pairedAt: '2026-08-15T04:00:01.000Z',
  });
  await pairReady;

  const retirer = new WindowsDpapiMastermindNodeCredentialStore({
    ...common,
    transform: xorTransform(0x44),
  });
  const retirement = retirer.retirePendingPairing(scope);
  let retirementSettled = false;
  retirement.finally(() => { retirementSettled = true; }).catch(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retirementSettled, false);
  releasePairProtect();
  await pairing;
  assert.equal((await owner.load()).state, 'paired');
  assert.deepEqual(await retirement, {
    retired: false, state: 'paired', nodeId: pending.nodeId, pairingId: pending.pairingId,
  });
  assert.equal((await owner.load()).state, 'paired');
});

test('the process-owned named-pipe mutex serializes contenders until exact release', async () => {
  const pipeName = String.raw`\\.\pipe\mastermind-node-credential-${'f'.repeat(64)}`;
  const releaseFirst = await acquireMastermindNodeCredentialPipeMutex(pipeName, 1_000);
  let secondAcquired = false;
  const second = acquireMastermindNodeCredentialPipeMutex(pipeName, 1_000).then((release) => {
    secondAcquired = true;
    return release;
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(secondAcquired, false);
  await releaseFirst();
  const releaseSecond = await second;
  assert.equal(secondAcquired, true);
  await releaseSecond();
});

test('held pipe errors are bounded and unexpected ownership loss fail-stops', async () => {
  class FakePipeServer extends EventEmitter {
    listen(_pipeName, callback) {
      queueMicrotask(callback);
      return this;
    }

    close(callback) {
      this.emit('close');
      callback?.();
    }
  }

  const pipeName = String.raw`\\.\pipe\mastermind-node-credential-${'e'.repeat(64)}`;
  const errorServer = new FakePipeServer();
  const releaseAfterError = await acquireMastermindNodeCredentialPipeMutex(
    pipeName,
    1_000,
    () => errorServer,
  );
  errorServer.emit('error', Object.assign(new Error('private native detail'), { code: 'EIO' }));
  await assert.rejects(
    releaseAfterError(),
    (error) => error?.code === 'NODE_CREDENTIAL_WRITE_FAILED'
      && error.message === 'The node credential mutex reported an error while held.',
  );

  const closedServer = new FakePipeServer();
  const releaseAfterClose = await acquireMastermindNodeCredentialPipeMutex(
    pipeName,
    1_000,
    () => closedServer,
  );
  assert.throws(
    () => closedServer.emit('close'),
    (error) => error?.code === 'NODE_CREDENTIAL_WRITE_FAILED'
      && error.message === 'The node credential mutex closed unexpectedly.',
  );
  await releaseAfterClose();
});
