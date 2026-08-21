import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  acquireWindowsDirectoryGuard,
  acquireWindowsDirectoryGuardBatch,
  acquireWindowsFileGuard,
  acquireWindowsFileGuardBatch,
  assertWindowsFilesystemTree,
} from '../src/windows-filesystem-safety.mjs';

const UNSAFE_WINDOWS_GUARD_PATHS = Object.freeze([
  '\\\\?\\C:\\guard-fixture',
  '\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy1\\guard-fixture',
  '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\guard-fixture',
  '\\\\??\\C:\\guard-fixture',
  '\\??\\C:\\guard-fixture',
  'C:\\',
  '\\\\server\\share\\',
  'C:\\guard-fixture\\tail.',
  'C:\\guard-fixture\\tail ',
  'C:\\guard-fixture\\NUL',
  'C:\\guard-fixture\\COM\u00b9',
  'C:\\guard-fixture\\bad<name',
  'C:\\guard-fixture\\bad\u0001name',
  'C:\\guard-fixture\\.\\child',
  'C:\\guard-fixture\\..\\child',
  'C:\\\\guard-fixture',
  '\\\\server\\share\\\\guard-fixture',
  'C:\\guard-fixture\\\\child',
  'C:\\guard-fixture\\child\\',
  'C:\\guard-fixture\\child:concealed',
  '\\\\.\\C:\\guard-fixture',
]);

function fakeSingleGuardHelper({ file = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  const commands = [];
  let input = '';
  child.kill = () => { setImmediate(() => child.emit('close', 1)); return true; };
  child.stdin.on('data', (chunk) => {
    input += Buffer.from(chunk).toString('utf8');
    for (;;) {
      const newline = input.indexOf('\n');
      if (newline < 0) break;
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      commands.push(line.startsWith('{') ? JSON.parse(line) : line);
      if (commands.length === 1) {
        child.stdout.write(file
          ? '{"ok":true,"identity":"00000003:0000000000000001","size":"7"}\n'
          : '{"ok":true}\n');
        continue;
      }
      const field = line === 'release' ? 'released'
        : line === 'delete' ? 'deleted'
          : JSON.parse(line).command === 'replace' ? 'replaced' : 'renamed';
      child.stdout.write(`${JSON.stringify({ ok: true, [field]: true })}\n`);
      child.stdout.end();
      setImmediate(() => child.emit('close', 0));
    }
  });
  return { child, commands };
}

function fakeBatchHelper({ identities, delayFinalExit = false, mutateResponse } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 42420;
  const commands = [];
  const active = new Set();
  let killed = false;
  let input = '';
  let finishExit = null;
  const close = (code) => {
    if (killed && code === 0) return;
    child.stdout.end();
    setImmediate(() => child.emit('close', code));
  };
  child.kill = () => {
    if (killed) return false;
    killed = true;
    close(1);
    return true;
  };
  child.stdin.on('data', (chunk) => {
    input += Buffer.from(chunk).toString('utf8');
    for (;;) {
      const newline = input.indexOf('\n');
      if (newline < 0) break;
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      const request = JSON.parse(line);
      commands.push(request);
      if (request.command === 'acquire') {
        const readyIdentities = identities ?? request.paths.map((_, id) => `00000001:${String(id + 1).padStart(16, '0')}`);
        for (let id = 0; id < request.paths.length; id += 1) active.add(id);
        child.stdout.write(`${JSON.stringify({
          ok: true,
          guards: readyIdentities.map((identity, id) => ({ id, identity })),
        })}\n`);
        continue;
      }
      active.delete(request.id);
      const field = request.command === 'release' ? 'released'
        : request.command === 'delete' ? 'deleted' : 'renamed';
      const response = mutateResponse?.({ field, request }) ?? { ok: true, id: request.id, [field]: true };
      child.stdout.write(`${JSON.stringify(response)}\n`);
      if (active.size === 0) {
        if (delayFinalExit) finishExit = () => close(0);
        else close(0);
      }
    }
  });
  return {
    child,
    commands,
    finishExit: () => finishExit?.(),
    get killed() { return killed; },
  };
}

function fakeFileBatchHelper({ evidence, delayFinalExit = false, mutateResponse } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 42421;
  const commands = [];
  const active = new Set();
  let killed = false;
  let input = '';
  let finishExit = null;
  const close = (code) => {
    if (killed && code === 0) return;
    child.stdout.end();
    setImmediate(() => child.emit('close', code));
  };
  child.kill = () => {
    if (killed) return false;
    killed = true;
    close(1);
    return true;
  };
  child.stdin.on('data', (chunk) => {
    input += Buffer.from(chunk).toString('utf8');
    for (;;) {
      const newline = input.indexOf('\n');
      if (newline < 0) break;
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      const request = JSON.parse(line);
      commands.push(request);
      if (request.command === 'acquire') {
        const readyEvidence = evidence ?? request.paths.map((_, id) => ({
          identity: `00000002:${String(id + 1).padStart(16, '0')}`,
          size: String(id + 7),
        }));
        for (let id = 0; id < request.paths.length; id += 1) active.add(id);
        child.stdout.write(`${JSON.stringify({
          ok: true,
          guards: readyEvidence.map(({ identity, size }, id) => ({ id, identity, size })),
        })}\n`);
        continue;
      }
      active.delete(request.id);
      const field = request.command === 'release' ? 'released'
        : request.command === 'delete' ? 'deleted'
          : request.command === 'replace' ? 'replaced' : 'renamed';
      const response = mutateResponse?.({ field, request }) ?? { ok: true, id: request.id, [field]: true };
      child.stdout.write(`${JSON.stringify(response)}\n`);
      if (active.size === 0) {
        if (delayFinalExit) finishExit = () => close(0);
        else close(0);
      }
    }
  });
  return {
    child,
    commands,
    finishExit: () => finishExit?.(),
    get killed() { return killed; },
  };
}

test('Windows world metadata verifier accepts an ordinary bounded tree', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-native-safe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'region'));
  await fs.writeFile(path.join(root, 'level.dat'), 'bounded fixture');
  await fs.writeFile(path.join(root, 'region', 'r.0.0.mca'), 'region');

  const result = await assertWindowsFilesystemTree(root, { maxEntries: 8, maxDepth: 4 });
  assert.equal(result.checked, true);
  assert.equal(result.entries, 3);
});

test('Windows world metadata verifier rejects NTFS alternate data streams', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-native-ads-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'level.dat');
  await fs.writeFile(file, 'bounded fixture');
  try { await fs.writeFile(`${file}:concealed`, 'not part of the visible tree'); }
  catch (error) { t.skip(`NTFS named streams are unavailable: ${error?.code ?? 'unknown'}`); }

  await assert.rejects(
    () => assertWindowsFilesystemTree(root, { maxEntries: 8, maxDepth: 4 }),
    (error) => error?.code === 'WORLD_INTEGRITY_FAILED' && !String(error.message).includes(root),
  );
});

test('Windows directory guard prevents a managed parent from being swapped', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-native-guard-'));
  const moved = `${root}-moved`;
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(moved, { recursive: true, force: true }).catch(() => undefined);
  });
  const guard = await acquireWindowsDirectoryGuard(root);
  const child = path.join(root, 'child-created-under-guard');
  await fs.writeFile(child, 'bounded');
  await assert.rejects(() => fs.rename(root, moved), (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code));
  await fs.unlink(child);
  await assert.rejects(() => fs.rmdir(root), (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code));
  await guard.release();
  await fs.rename(root, moved);
});

test('Windows directory guard treats a helper exit as loss of protection', async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    child.stdin.once('data', () => {
      child.stdout.write('{"ok":true}\n');
      setImmediate(() => child.emit('close', 1));
    });
    return child;
  };
  const guard = await acquireWindowsDirectoryGuard('C:\\guard-fixture', { platform: 'win32', spawnProcess });
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() => guard.assertHeld(), (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
  await assert.rejects(() => guard.release(), (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
});

test('Windows directory guard batch uses one helper and retains sibling handles independently', async () => {
  assert.equal(acquireWindowsDirectoryGuard.batch, acquireWindowsDirectoryGuardBatch);
  const fake = fakeBatchHelper({ delayFinalExit: true });
  let spawnCount = 0;
  const guards = await acquireWindowsDirectoryGuardBatch(
    ['C:\\guard-fixture-a', 'C:\\guard-fixture-b'],
    { platform: 'win32', spawnProcess: () => { spawnCount += 1; return fake.child; } },
  );

  assert.equal(spawnCount, 1);
  assert.deepEqual(fake.commands[0], {
    command: 'acquire',
    paths: ['C:\\guard-fixture-a', 'C:\\guard-fixture-b'],
  });
  assert.deepEqual(guards.map(({ id, identity, processId }) => ({ id, identity, processId })), [
    { id: 0, identity: '00000001:0000000000000001', processId: 42420 },
    { id: 1, identity: '00000001:0000000000000002', processId: 42420 },
  ]);

  await guards[0].release();
  assert.throws(() => guards[0].assertHeld(), (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
  guards[1].assertHeld();

  for (const unsafePath of UNSAFE_WINDOWS_GUARD_PATHS) {
    await assert.rejects(
      () => guards[1].rename(unsafePath),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
    guards[1].assertHeld();
  }

  let finalResolved = false;
  const final = guards[1].rename('C:\\guard-fixture-b-moved').then(() => { finalResolved = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finalResolved, false, 'the final operation must wait for the helper process to exit');
  fake.finishExit();
  await final;
  assert.equal(finalResolved, true);
  assert.deepEqual(fake.commands.slice(1), [
    { command: 'release', id: 0 },
    { command: 'rename', id: 1, destination: 'C:\\guard-fixture-b-moved' },
  ]);
});

test('Windows directory guard batch rejects ambiguous path sets before spawning', async () => {
  let spawned = false;
  const spawnProcess = () => { spawned = true; throw new Error('must not spawn'); };
  for (const unsafePath of UNSAFE_WINDOWS_GUARD_PATHS) {
    await assert.rejects(
      () => acquireWindowsDirectoryGuardBatch([unsafePath], { platform: 'win32', spawnProcess }),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
    await assert.rejects(
      () => acquireWindowsDirectoryGuard(unsafePath, { platform: 'win32', spawnProcess }),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
  }
  await assert.rejects(
    () => acquireWindowsDirectoryGuardBatch(
      ['C:\\Guard-Fixture\\child', 'c:\\guard-fixture\\child\\'],
      { platform: 'win32', spawnProcess },
    ),
    (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
  );
  await assert.rejects(
    () => acquireWindowsDirectoryGuardBatch(
      Array.from({ length: 257 }, (_, id) => `C:\\guard-fixture-${id}`),
      { platform: 'win32', spawnProcess },
    ),
    (error) => error instanceof TypeError,
  );
  assert.equal(spawned, false);
});

test('single Windows guards reject unsafe destinations without consuming the held guard', async () => {
  const directoryFake = fakeSingleGuardHelper();
  const directoryGuard = await acquireWindowsDirectoryGuard('C:\\guard-fixture\\directory', {
    platform: 'win32', spawnProcess: () => directoryFake.child,
  });
  for (const unsafePath of UNSAFE_WINDOWS_GUARD_PATHS) {
    await assert.rejects(
      () => directoryGuard.rename(unsafePath),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
    directoryGuard.assertHeld();
  }
  assert.equal(directoryFake.commands.length, 1);
  await directoryGuard.release();

  const fileFake = fakeSingleGuardHelper({ file: true });
  const fileGuard = await acquireWindowsFileGuard('C:\\guard-fixture\\file.dat', {
    platform: 'win32', spawnProcess: () => fileFake.child,
  });
  for (const unsafePath of UNSAFE_WINDOWS_GUARD_PATHS) {
    await assert.rejects(
      () => fileGuard.rename(unsafePath),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
    await assert.rejects(
      () => fileGuard.replace(unsafePath),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
    fileGuard.assertHeld();
  }
  assert.equal(fileFake.commands.length, 1);
  await fileGuard.release();
});

test('Windows directory guard batch rejects duplicate native identities', async () => {
  const fake = fakeBatchHelper({
    identities: ['00000001:0000000000000001', '00000001:0000000000000001'],
  });
  await assert.rejects(
    () => acquireWindowsDirectoryGuardBatch(
      ['C:\\guard-fixture-a', 'C:\\guard-fixture-b'],
      { platform: 'win32', spawnProcess: () => fake.child },
    ),
    (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
  );
  assert.equal(fake.killed, true);
});

test('Windows directory guard batch waits for helper exit after failed readiness', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  let killed = false;
  child.kill = () => { killed = true; return true; };
  child.stdin.once('data', () => {
    child.stdout.write('{"ok":true,"guards":[]}\n');
  });
  let settled = false;
  const acquisition = acquireWindowsDirectoryGuardBatch(['C:\\guard-fixture'], {
    platform: 'win32',
    spawnProcess: () => child,
    commandTimeoutMs: 1_000,
  }).finally(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(killed, true);
  assert.equal(settled, false, 'failed acquisition must retain control until the helper exits');
  child.stdout.end();
  child.emit('close', 1);
  await assert.rejects(acquisition, (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
  assert.equal(settled, true);
});

test('Windows directory guard batch waits for helper exit after valid readiness then fatal output', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  let exited = false;
  let closeScheduled = false;
  child.kill = () => {
    if (!closeScheduled) {
      closeScheduled = true;
      setTimeout(() => {
        exited = true;
        child.stdout.end();
        child.emit('close', 1);
      }, 25);
    }
    return true;
  };
  child.stdin.once('data', () => {
    child.stdout.write('{"ok":true,"guards":[{"id":0,"identity":"00000001:0000000000000001"}]}\n{}\n');
  });
  await assert.rejects(
    () => acquireWindowsDirectoryGuardBatch(['C:\\guard-fixture\\directory'], {
      platform: 'win32', spawnProcess: () => child, commandTimeoutMs: 100,
    }),
    (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
  );
  assert.equal(exited, true);
});

test('Windows directory guard batch fails closed on an invalid terminal response', async () => {
  const fake = fakeBatchHelper({
    mutateResponse: ({ field, request }) => ({ ok: true, id: request.id + 1, [field]: true }),
  });
  const [guard] = await acquireWindowsDirectoryGuardBatch(
    ['C:\\guard-fixture'],
    { platform: 'win32', spawnProcess: () => fake.child },
  );
  await assert.rejects(() => guard.delete(), (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
  assert.equal(fake.killed, true);
});

test('Windows directory guard batch treats an unexpected helper exit as loss of every handle', async () => {
  const fake = fakeBatchHelper();
  const guards = await acquireWindowsDirectoryGuardBatch(
    ['C:\\guard-fixture-a', 'C:\\guard-fixture-b'],
    { platform: 'win32', spawnProcess: () => fake.child },
  );
  fake.child.stdout.end();
  fake.child.emit('close', 1);
  assert.throws(() => guards[0].assertHeld(), (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
  assert.throws(() => guards[1].assertHeld(), (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
  await assert.rejects(() => guards[0].release(), (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
});

test('directory guard batch non-Windows fallback mirrors per-path operations', async () => {
  const calls = [];
  const guards = await acquireWindowsDirectoryGuardBatch(['relative-a', 'relative-b'], {
    platform: 'linux',
    rmdir: async (target) => calls.push(['delete', target]),
    rename: async (source, destination) => calls.push(['rename', source, destination]),
  });
  assert.equal(guards.length, 2);
  guards[0].assertHeld();
  await guards[0].release();
  await guards[0].rename('moved-a');
  await guards[1].delete();
  assert.deepEqual(calls, [
    ['rename', 'relative-a', 'moved-a'],
    ['delete', 'relative-b'],
  ]);
});

test('Windows file guard batch uses one helper and retains sibling handles independently', async () => {
  assert.equal(acquireWindowsFileGuard.batch, acquireWindowsFileGuardBatch);
  const fake = fakeFileBatchHelper({ delayFinalExit: true });
  let spawnCount = 0;
  const guards = await acquireWindowsFileGuardBatch(
    ['C:\\guard-file-a', 'C:\\guard-file-b'],
    { platform: 'win32', spawnProcess: () => { spawnCount += 1; return fake.child; } },
  );

  assert.equal(spawnCount, 1);
  assert.deepEqual(fake.commands[0], {
    command: 'acquire',
    paths: ['C:\\guard-file-a', 'C:\\guard-file-b'],
  });
  assert.deepEqual(guards.map(({ id, identity, size, processId }) => ({ id, identity, size, processId })), [
    { id: 0, identity: '00000002:0000000000000001', size: '7', processId: 42421 },
    { id: 1, identity: '00000002:0000000000000002', size: '8', processId: 42421 },
  ]);

  await guards[0].release();
  assert.throws(() => guards[0].assertHeld(), (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
  guards[1].assertHeld();

  for (const unsafePath of UNSAFE_WINDOWS_GUARD_PATHS) {
    await assert.rejects(
      () => guards[1].rename(unsafePath),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
    await assert.rejects(
      () => guards[1].replace(unsafePath),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
    guards[1].assertHeld();
  }

  let finalResolved = false;
  const final = guards[1].replace('C:\\guard-file-b-destination').then(() => { finalResolved = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finalResolved, false, 'the final file operation must wait for clean helper exit');
  fake.finishExit();
  await final;
  assert.equal(finalResolved, true);
  assert.deepEqual(fake.commands.slice(1), [
    { command: 'release', id: 0 },
    { command: 'replace', id: 1, destination: 'C:\\guard-file-b-destination' },
  ]);
});

test('read-compatible file guard batches deny mutation commands', async () => {
  const fake = fakeFileBatchHelper();
  const [guard] = await acquireWindowsFileGuardBatch(['C:\\guard-file-readable'], {
    platform: 'win32',
    readCompatible: true,
    spawnProcess: () => fake.child,
  });
  assert.deepEqual(fake.commands[0], {
    command: 'acquire',
    paths: ['C:\\guard-file-readable'],
    readCompatible: true,
  });
  for (const operation of [
    () => guard.delete(),
    () => guard.rename('C:\\guard-file-readable-moved'),
    () => guard.replace('C:\\guard-file-readable-replaced'),
  ]) {
    await assert.rejects(operation, (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
    guard.assertHeld();
  }
  assert.equal(fake.commands.length, 1);
  await guard.release();
  assert.deepEqual(fake.commands[1], { command: 'release', id: 0 });
});

test('Windows file guard batch rejects ambiguous paths and unsafe evidence', async (t) => {
  let spawned = false;
  const spawnProcess = () => { spawned = true; throw new Error('must not spawn'); };
  for (const unsafePath of UNSAFE_WINDOWS_GUARD_PATHS) {
    await assert.rejects(
      () => acquireWindowsFileGuard(unsafePath, { platform: 'win32', spawnProcess }),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
    await assert.rejects(
      () => acquireWindowsFileGuardBatch([unsafePath], { platform: 'win32', spawnProcess }),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
  }
  await assert.rejects(
    () => acquireWindowsFileGuardBatch(
      ['C:\\Guard-Fixture\\child.dat', 'c:\\guard-fixture\\child.dat'],
      { platform: 'win32', spawnProcess },
    ),
    (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
  );
  await assert.rejects(
    () => acquireWindowsFileGuardBatch(
      Array.from({ length: 257 }, (_, id) => `C:\\guard-file-${id}`),
      { platform: 'win32', spawnProcess },
    ),
    (error) => error instanceof TypeError,
  );
  await assert.rejects(
    () => acquireWindowsFileGuardBatch(
      Array.from({ length: 256 }, (_, id) => `C:\\${String(id).padStart(3, '0')}-${'x'.repeat(5_000)}`),
      { platform: 'win32', spawnProcess },
    ),
    (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
  );
  assert.equal(spawned, false);

  await t.test('duplicate native identities fail closed', async () => {
    const fake = fakeFileBatchHelper({
      evidence: [
        { identity: '00000002:0000000000000001', size: '1' },
        { identity: '00000002:0000000000000001', size: '2' },
      ],
    });
    await assert.rejects(
      () => acquireWindowsFileGuardBatch(
        ['C:\\guard-file-a', 'C:\\guard-file-b'],
        { platform: 'win32', spawnProcess: () => fake.child },
      ),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
    );
    assert.equal(fake.killed, true);
  });

  await t.test('non-canonical or overflowing size evidence fails closed', async () => {
    for (const size of ['01', '18446744073709551616']) {
      const fake = fakeFileBatchHelper({
        evidence: [{ identity: '00000002:0000000000000001', size }],
      });
      await assert.rejects(
        () => acquireWindowsFileGuardBatch(
          ['C:\\guard-file-a'],
          { platform: 'win32', spawnProcess: () => fake.child },
        ),
        (error) => error?.code === 'WORLD_INTEGRITY_FAILED',
      );
      assert.equal(fake.killed, true);
    }
  });
});

test('Windows file guard batch waits for helper exit after failed readiness', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  let killed = false;
  child.kill = () => { killed = true; return true; };
  child.stdin.once('data', () => {
    child.stdout.write('{"ok":true,"guards":[]}\n');
  });
  let settled = false;
  const acquisition = acquireWindowsFileGuardBatch(['C:\\guard-file'], {
    platform: 'win32',
    spawnProcess: () => child,
    commandTimeoutMs: 1_000,
  }).finally(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(killed, true);
  assert.equal(settled, false, 'failed file acquisition must retain control until helper exit');
  child.stdout.end();
  child.emit('close', 1);
  await assert.rejects(acquisition, (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
  assert.equal(settled, true);
});

test('Windows file guard batch fails closed on an invalid terminal response', async () => {
  const fake = fakeFileBatchHelper({
    mutateResponse: ({ field, request }) => ({ ok: true, id: request.id + 1, [field]: true }),
  });
  const [guard] = await acquireWindowsFileGuardBatch(
    ['C:\\guard-file'],
    { platform: 'win32', spawnProcess: () => fake.child },
  );
  await assert.rejects(() => guard.delete(), (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
  assert.equal(fake.killed, true);
});

test('file guard batch non-Windows fallback mirrors per-path operations', async () => {
  const calls = [];
  const guards = await acquireWindowsFileGuardBatch(['relative-a', 'relative-b', 'relative-c'], {
    platform: 'linux',
    unlink: async (target) => calls.push(['delete', target]),
    rename: async (source, destination) => calls.push(['rename', source, destination]),
  });
  assert.equal(guards.length, 3);
  assert.equal(guards[0].size, null);
  guards[0].assertHeld();
  await guards[0].release();
  await guards[0].rename('moved-a');
  await guards[1].replace('replaced-b');
  await guards[2].delete();
  assert.deepEqual(calls, [
    ['rename', 'relative-a', 'moved-a'],
    ['rename', 'relative-b', 'replaced-b'],
    ['delete', 'relative-c'],
  ]);
});

test('native Windows directory guard batch retains peers across release and rebind', {
  skip: process.platform !== 'win32',
  timeout: 120_000,
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-native-batch-'));
  const first = path.join(root, 'first-parent');
  const second = path.join(root, 'second-parent');
  const third = path.join(root, 'third-parent');
  const movedFirst = path.join(root, 'first-parent-moved');
  const movedSecond = path.join(root, 'second-parent-moved');
  await fs.mkdir(first);
  await fs.mkdir(second);
  await fs.mkdir(third);
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  const spawnedPids = [];
  const spawnProcess = (...args) => {
    const child = spawnChild(...args);
    spawnedPids.push(child.pid);
    return child;
  };
  const [firstGuard, secondGuard, thirdGuard] = await acquireWindowsDirectoryGuardBatch(
    [first, second, third], { spawnProcess, timeoutMs: 30_000 },
  );
  assert.equal(spawnedPids.length, 1);
  assert.equal(firstGuard.processId, secondGuard.processId);
  assert.equal(secondGuard.processId, thirdGuard.processId);
  const childFile = path.join(first, 'child-open-under-held-parent');
  await fs.writeFile(childFile, 'ordinary child access remains available');
  assert.equal(await fs.readFile(childFile, 'utf8'), 'ordinary child access remains available');
  await fs.unlink(childFile);
  await assert.rejects(() => fs.rename(first, movedFirst), (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code));
  await assert.rejects(() => fs.rename(second, movedSecond), (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code));

  await firstGuard.release();
  secondGuard.assertHeld();
  await fs.rename(first, movedFirst);
  await fs.rename(movedFirst, first);
  await assert.rejects(() => fs.rename(second, movedSecond), (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code));

  const [reboundFirst] = await acquireWindowsDirectoryGuardBatch(
    [first], { spawnProcess, timeoutMs: 30_000 },
  );
  assert.equal(spawnedPids.length, 2, 'rebind uses one new helper, not one process per original path');
  assert.equal(reboundFirst.identity, firstGuard.identity);
  await assert.rejects(() => fs.rename(first, movedFirst), (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code));
  await secondGuard.rename(movedSecond);
  assert.equal((await fs.lstat(movedSecond)).isDirectory(), true);
  await assert.rejects(() => fs.lstat(second), (error) => error?.code === 'ENOENT');
  await thirdGuard.delete();
  await assert.rejects(() => fs.lstat(third), (error) => error?.code === 'ENOENT');
  reboundFirst.assertHeld();
  await reboundFirst.release();
  await fs.rename(first, movedFirst);
  t.diagnostic(`batch helper PIDs: ${spawnedPids.join(', ')}`);
});

test('native Windows file guard batch retains peers across release, rebind, replace, and delete', {
  skip: process.platform !== 'win32',
  timeout: 120_000,
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-native-file-batch-'));
  const readableFile = path.join(root, 'readable-child.dat');
  const replacementFile = path.join(root, 'replacement-source.dat');
  const deletionFile = path.join(root, 'deletion-target.dat');
  const destinationFile = path.join(root, 'replacement-destination.dat');
  const movedReadableFile = path.join(root, 'readable-child-moved.dat');
  const readableContent = 'ordinary child reads remain available';
  const replacementContent = 'exact replacement payload';
  await fs.writeFile(readableFile, readableContent);
  await fs.writeFile(replacementFile, replacementContent);
  await fs.writeFile(deletionFile, 'exact deletion payload');
  await fs.writeFile(destinationFile, 'superseded payload');

  const spawnedChildren = [];
  const acquiredGuards = [];
  t.after(async () => {
    await Promise.allSettled(acquiredGuards.map((guard) => guard.release()));
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });
  const spawnProcess = (...args) => {
    const child = spawnChild(...args);
    spawnedChildren.push(child);
    return child;
  };

  const [readableGuard, replacementGuard, deletionGuard] = await acquireWindowsFileGuardBatch(
    [readableFile, replacementFile, deletionFile],
    { spawnProcess, timeoutMs: 30_000 },
  );
  acquiredGuards.push(readableGuard, replacementGuard, deletionGuard);
  t.diagnostic(`primary file batch helper PID: ${readableGuard.processId}`);
  assert.equal(spawnedChildren.length, 1);
  assert.equal(readableGuard.processId, replacementGuard.processId);
  assert.equal(replacementGuard.processId, deletionGuard.processId);
  assert.equal(readableGuard.size, String(Buffer.byteLength(readableContent)));
  assert.equal(replacementGuard.size, String(Buffer.byteLength(replacementContent)));
  assert.equal(await fs.readFile(readableFile, 'utf8'), readableContent);
  await assert.rejects(
    () => fs.rename(readableFile, movedReadableFile),
    (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code),
  );
  await assert.rejects(
    () => fs.unlink(deletionFile),
    (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code),
  );

  t.diagnostic('file batch stage: release and rebind');
  await readableGuard.release();
  replacementGuard.assertHeld();
  deletionGuard.assertHeld();
  await fs.rename(readableFile, movedReadableFile);
  await fs.rename(movedReadableFile, readableFile);
  const [reboundReadableGuard] = await acquireWindowsFileGuardBatch(
    [readableFile],
    { spawnProcess, timeoutMs: 30_000 },
  );
  acquiredGuards.push(reboundReadableGuard);
  t.diagnostic(`rebound file batch helper PID: ${reboundReadableGuard.processId}`);
  assert.equal(spawnedChildren.length, 2, 'rebind starts one new batch helper');
  assert.equal(reboundReadableGuard.identity, readableGuard.identity);
  assert.equal(reboundReadableGuard.size, readableGuard.size);
  await assert.rejects(
    () => fs.rename(readableFile, movedReadableFile),
    (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code),
  );

  t.diagnostic('file batch stage: exact replace');
  await replacementGuard.replace(destinationFile);
  deletionGuard.assertHeld();
  assert.equal(await fs.readFile(destinationFile, 'utf8'), replacementContent);
  await assert.rejects(() => fs.lstat(replacementFile), (error) => error?.code === 'ENOENT');
  t.diagnostic('file batch stage: exact delete');
  await deletionGuard.delete();
  await assert.rejects(() => fs.lstat(deletionFile), (error) => error?.code === 'ENOENT');
  reboundReadableGuard.assertHeld();
  t.diagnostic('file batch stage: final rebound release');
  await reboundReadableGuard.release();
  await fs.rename(readableFile, movedReadableFile);

  for (const child of spawnedChildren) {
    assert.equal(child.exitCode, 0, `batch helper ${child.pid} must exit cleanly`);
    assert.throws(
      () => process.kill(child.pid, 0),
      (error) => error?.code === 'ESRCH',
      `batch helper PID ${child.pid} must not remain live`,
    );
  }
  t.diagnostic(`file batch helper PIDs exited cleanly: ${spawnedChildren.map(({ pid }) => pid).join(', ')}`);
});

test('native read-compatible file guard permits a non-delete-sharing reader while denying mutation', {
  skip: process.platform !== 'win32',
  timeout: 60_000,
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-launch-readable-guard-'));
  const file = path.join(root, 'jvm.cfg');
  const moved = path.join(root, 'jvm-moved.cfg');
  await fs.writeFile(file, 'launch-reader-compatible');
  const [guard] = await acquireWindowsFileGuardBatch([file], { readCompatible: true, timeoutMs: 30_000 });
  t.after(async () => {
    await guard.release().catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  const reader = spawnChild('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '$stream=[IO.File]::Open($env:MASTERMIND_TEST_READ_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);try{$reader=[IO.StreamReader]::new($stream);try{[Console]::Out.Write($reader.ReadToEnd())}finally{$reader.Dispose()}}finally{$stream.Dispose()}',
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MASTERMIND_TEST_READ_FILE: file },
  });
  const output = [];
  const errors = [];
  reader.stdout.on('data', (chunk) => output.push(Buffer.from(chunk)));
  reader.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)));
  const code = await new Promise((resolve, reject) => {
    reader.once('error', reject);
    reader.once('close', resolve);
  });
  assert.equal(code, 0, Buffer.concat(errors).toString('utf8'));
  assert.equal(Buffer.concat(output).toString('utf8'), 'launch-reader-compatible');
  await assert.rejects(() => fs.writeFile(file, 'changed'), (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code));
  await assert.rejects(() => fs.rename(file, moved), (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code));
  await assert.rejects(() => guard.delete(), (error) => error?.code === 'WORLD_INTEGRITY_FAILED');
  await guard.release();
  await fs.writeFile(file, 'changed-after-release');
});

test('Windows file guard deletes only the exact held file object', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-native-file-guard-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'owned-tombstone');
  const moved = path.join(root, 'swap-attempt');
  await fs.writeFile(file, 'bounded');
  const guard = await acquireWindowsFileGuard(file);
  await assert.rejects(() => fs.rename(file, moved), (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code));
  await guard.delete();
  await assert.rejects(() => fs.lstat(file), (error) => error?.code === 'ENOENT');
  await assert.rejects(() => fs.lstat(moved), (error) => error?.code === 'ENOENT');
});

test('Windows guards rename the exact held directory and file objects', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-native-held-rename-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, 'source-directory');
  const movedDirectory = path.join(root, 'moved-directory');
  await fs.mkdir(sourceDirectory);
  const directoryGuard = await acquireWindowsDirectoryGuard(sourceDirectory);
  await directoryGuard.rename(movedDirectory);
  assert.equal((await fs.lstat(movedDirectory)).isDirectory(), true);
  await assert.rejects(() => fs.lstat(sourceDirectory), (error) => error?.code === 'ENOENT');

  const sourceFile = path.join(root, 'source-file');
  const movedFile = path.join(root, 'moved-file');
  await fs.writeFile(sourceFile, 'bounded');
  const fileGuard = await acquireWindowsFileGuard(sourceFile);
  await fileGuard.rename(movedFile);
  assert.equal(await fs.readFile(movedFile, 'utf8'), 'bounded');
  await assert.rejects(() => fs.lstat(sourceFile), (error) => error?.code === 'ENOENT');
});

test('Windows file guard atomically replaces an existing destination with the exact held object', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-native-held-replace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source-file');
  const destination = path.join(root, 'destination-file');
  await fs.writeFile(source, 'new bounded content');
  await fs.writeFile(destination, 'old content');
  const guard = await acquireWindowsFileGuard(source);
  await guard.replace(destination);
  assert.equal(await fs.readFile(destination, 'utf8'), 'new bounded content');
  await assert.rejects(() => fs.lstat(source), (error) => error?.code === 'ENOENT');
});

test('Windows directory guard deletes only the exact held empty directory', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-native-directory-delete-'));
  const child = path.join(root, 'owned-empty-directory');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(child);
  const guard = await acquireWindowsDirectoryGuard(child);
  await guard.delete();
  await assert.rejects(() => fs.lstat(child), (error) => error?.code === 'ENOENT');
});
