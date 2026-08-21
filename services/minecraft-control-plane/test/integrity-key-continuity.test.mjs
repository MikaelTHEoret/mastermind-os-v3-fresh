import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireLaunchIntegrityKey } from '../src/integrity-key-continuity.mjs';
import {
  acquireWindowsDirectoryGuard,
  withHeldWindowsDirectoryGuards,
} from '../src/windows-filesystem-safety.mjs';

async function fixture(t, label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mastermind-launch-key-${label}-`));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'state'));
  const keyFile = path.join(root, 'state', 'launch-integrity.hmac.key');
  const first = await acquireLaunchIntegrityKey(root, {
    platform: 'linux', createIfMissing: true, randomBytes: () => Buffer.alloc(32, 0x31),
  });
  assert.deepEqual(first.key, Buffer.alloc(32, 0x31));
  await first.release();
  return { root, keyFile };
}

test('same-process launch key deletion cannot create a new authentication root', async (t) => {
  const value = await fixture(t, 'delete');
  await fs.rm(value.keyFile);
  await assert.rejects(() => acquireLaunchIntegrityKey(value.root, {
    platform: 'linux', createIfMissing: true, randomBytes: () => Buffer.alloc(32, 0x42),
  }), (error) => error.code === 'LAUNCH_INTEGRITY_UNAVAILABLE');
});

test('same-process launch key delete-and-replace is rejected even with a valid length', async (t) => {
  const value = await fixture(t, 'replace');
  await fs.rename(value.keyFile, `${value.keyFile}.replaced`);
  await fs.writeFile(value.keyFile, Buffer.alloc(32, 0x31), { flag: 'wx' });
  await assert.rejects(() => acquireLaunchIntegrityKey(value.root, { platform: 'linux' }), (error) => {
    assert.equal(error.code, 'LAUNCH_INTEGRITY_UNAVAILABLE');
    assert.match(error.message, /changed|continuity|identity/i);
    return true;
  });
});

test('native alternate-stream evidence fails the cached key boundary closed', async (t) => {
  const value = await fixture(t, 'ads');
  const verifier = async (target) => {
    if (target === value.keyFile) throw Object.assign(new Error('injected alternate data stream'), { code: 'WORLD_INTEGRITY_FAILED' });
    return { ok: true, checked: true };
  };
  await assert.rejects(() => acquireLaunchIntegrityKey(value.root, {
    platform: 'linux', filesystemEntryVerifier: verifier,
  }), (error) => error.code === 'LAUNCH_INTEGRITY_UNAVAILABLE');
});

test('native Windows launch-key acquisition borrows an already-held authenticated state guard', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-launch-key-borrow-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = path.join(root, 'state');
  await fs.mkdir(state);
  const initial = await acquireLaunchIntegrityKey(root, { createIfMissing: true });
  await initial.release();
  const rootGuard = await acquireWindowsDirectoryGuard(root);
  const stateGuard = await acquireWindowsDirectoryGuard(state);
  try {
    const lease = await withHeldWindowsDirectoryGuards([
      { directory: root, guard: rootGuard },
      { directory: state, guard: stateGuard },
    ], () => acquireLaunchIntegrityKey(root));
    await lease.assertHeld();
    await lease.release();
    rootGuard.assertHeld();
    stateGuard.assertHeld();
  } finally {
    await stateGuard.release();
    await rootGuard.release();
  }
});

test('native Windows launch-key lease lends its held ancestor guards to nested trust domains', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-launch-key-lend-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = path.join(root, 'state');
  await fs.mkdir(state);
  const lease = await acquireLaunchIntegrityKey(root, { createIfMissing: true });
  try {
    await lease.withHeldDirectoryGuards(async () => {
      const borrowedRoot = await acquireWindowsDirectoryGuard(root, { borrowHeld: true });
      const borrowedState = await acquireWindowsDirectoryGuard(state, { borrowHeld: true });
      borrowedRoot.assertHeld();
      borrowedState.assertHeld();
      await borrowedState.release();
      await borrowedRoot.release();
    });
    await lease.assertHeld();
  } finally {
    await lease.release();
  }
});
