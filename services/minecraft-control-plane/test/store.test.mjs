import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InstanceStore, readStateFile, replaceStateFile } from '../src/store.mjs';
import { acquireWindowsDirectoryGuard } from '../src/windows-filesystem-safety.mjs';

test('state replacement retries transient Windows sharing failures', async () => {
  const calls = [];
  const waits = [];
  await replaceStateFile('temporary', 'canonical', {
    filesystem: {
      async rename(source, destination) {
        calls.push([source, destination]);
        if (calls.length < 3) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
      },
    },
    retryDelays: [10, 20],
    async wait(milliseconds) { waits.push(milliseconds); },
  });
  assert.deepEqual(calls, [
    ['temporary', 'canonical'],
    ['temporary', 'canonical'],
    ['temporary', 'canonical'],
  ]);
  assert.deepEqual(waits, [10, 20]);
});

test('state replacement does not retry permanent failures', async () => {
  let calls = 0;
  await assert.rejects(
    () => replaceStateFile('temporary', 'canonical', {
      filesystem: {
        async rename() {
          calls += 1;
          throw Object.assign(new Error('invalid destination'), { code: 'EINVAL' });
        },
      },
      async wait() { throw new Error('must not wait'); },
    }),
    { code: 'EINVAL' },
  );
  assert.equal(calls, 1);
});

test('state reads retry transient Windows sharing failures', async () => {
  const waits = [];
  let calls = 0;
  const value = await readStateFile('canonical', {
    filesystem: {
      async readFile(file, encoding) {
        calls += 1;
        assert.equal(file, 'canonical');
        assert.equal(encoding, 'utf8');
        if (calls < 3) throw Object.assign(new Error('sharing violation'), { code: 'EBUSY' });
        return '{"schemaVersion":1,"instances":[]}\n';
      },
    },
    retryDelays: [10, 20],
    async wait(milliseconds) { waits.push(milliseconds); },
  });
  assert.equal(value, '{"schemaVersion":1,"instances":[]}\n');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]);
});

test('state reads do not retry permanent failures', async () => {
  let calls = 0;
  await assert.rejects(() => readStateFile('canonical', {
    filesystem: {
      async readFile() {
        calls += 1;
        throw Object.assign(new Error('invalid inventory'), { code: 'EINVAL' });
      },
    },
    async wait() { throw new Error('must not wait'); },
  }), { code: 'EINVAL' });
  assert.equal(calls, 1);
});

test('instance store publishes repeated updates without leaving temporary files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new InstanceStore(root);
  await store.initialize();
  await store.create({ id: 'family-server', status: 'stopped' });
  await Promise.all([
    store.update('family-server', { status: 'starting' }),
    store.update('family-server', { status: 'stopped' }),
  ]);
  assert.equal((await store.get('family-server')).status, 'stopped');
  const stateEntries = await fs.readdir(path.join(root, 'state'));
  assert.deepEqual(stateEntries, ['instance-store']);
  assert.deepEqual(await fs.readdir(path.join(root, 'state', 'instance-store')), ['instances.json']);
});

test('instance store migrates the legacy direct-child inventory without deleting it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-store-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'state', 'instances.json');
  await fs.mkdir(path.dirname(legacy), { recursive: true });
  await fs.writeFile(legacy, `${JSON.stringify({
    schemaVersion: 1,
    instances: [{ id: 'family-server', status: 'stopped' }],
  })}\n`);
  const store = new InstanceStore(root);
  await store.initialize();
  assert.equal((await store.get('family-server')).status, 'stopped');
  assert.equal(JSON.parse(await fs.readFile(legacy, 'utf8')).instances[0].id, 'family-server');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'state', 'instance-store', 'instances.json'), 'utf8')).instances[0].id,
    'family-server',
  );
});

test('Windows state-directory guard permits atomic nested inventory updates', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-store-guard-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new InstanceStore(root);
  await store.initialize();
  await store.create({ id: 'family-server', status: 'stopped' });
  const guard = await acquireWindowsDirectoryGuard(path.join(root, 'state'));
  try {
    await store.update('family-server', { status: 'starting' });
    assert.equal((await store.get('family-server')).status, 'starting');
  } finally {
    await guard.release();
  }
});
