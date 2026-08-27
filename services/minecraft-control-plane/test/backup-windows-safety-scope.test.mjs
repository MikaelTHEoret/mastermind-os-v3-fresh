import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  createBackupWindowsSafetyBroker,
  createWindowsFilesystemSafetyBroker,
} from '../src/backup-windows-safety-scope.mjs';
import { withHeldWindowsDirectoryGuards } from '../src/windows-filesystem-safety.mjs';

test('broker borrows an outer held directory guard instead of reopening it', async () => {
  const directory = 'C:\\managed';
  let assertions = 0;
  const held = { assertHeld() { assertions += 1; } };
  const broker = createWindowsFilesystemSafetyBroker({
    platform: 'win32',
    spawnProcess() { throw new Error('a borrowed directory must not spawn a new native guard'); },
  });
  await withHeldWindowsDirectoryGuards([{ directory, guard: held }], () => broker.runOperation(async () => {
    const single = await broker.directoryGuard(directory);
    single.assertHeld();
    await single.release();
    const [batch] = await broker.directoryGuard.batch([directory]);
    batch.assertHeld();
    await batch.release();
  }));
  assert.ok(assertions >= 6);
});

class FakeStream extends EventEmitter {}

class FakeChild extends EventEmitter {
  constructor(factory, kind, workerIndex) {
    super();
    this.factory = factory;
    this.kind = kind;
    this.workerIndex = workerIndex;
    this.pid = 10_000 + factory.children.length;
    this.stdout = new FakeStream();
    this.stdin = new FakeStream();
    this.stdin.write = (line, callback) => {
      queueMicrotask(() => {
        callback?.(null);
        this.#receive(line);
      });
      return true;
    };
    this.stdin.end = () => {};
    this.active = new Map();
    this.generations = new Map();
    this.requests = [];
    this.killed = false;
    this.closed = false;
  }

  kill() {
    if (this.closed) return true;
    this.killed = true;
    if (this.factory.deferKilledExit) return true;
    this.#exit(1);
    return true;
  }

  finishKilledExit() { this.#exit(1); }

  #receive(line) {
    if (this.closed) return;
    let request;
    try { request = JSON.parse(String(line).trimEnd()); } catch {
      this.#exit(1);
      return;
    }
    this.requests.push(request);
    this.factory.requests.push({ child: this, request });
    const fault = this.factory.onRequest?.({ child: this, request });
    if (fault?.type === 'crash') {
      this.#exit(fault.code ?? 1);
      return;
    }
    if (fault?.type === 'raw') {
      this.#writeRaw(fault.value);
      return;
    }
    if (fault?.type === 'hang') return;
    const response = fault?.type === 'reply' ? fault.value : this.#defaultResponse(request);
    if (response === null) return;
    this.#writeJson(response, request.command === 'close', fault?.exitCode ?? 0);
  }

  #defaultResponse(request) {
    if (request.command === 'acquire') {
      const guards = request.paths.map((requestedPath) => {
        let slot = 0;
        while (this.active.has(slot)) slot += 1;
        const generation = String((this.generations.get(slot) ?? 0) + 1);
        this.generations.set(slot, Number(generation));
        const identity = this.factory.identityFor({
          child: this, kind: this.kind, path: requestedPath, slot, generation,
        });
        const guard = { slot, generation, identity, ...(this.kind === 'file' ? { size: '7' } : {}) };
        this.active.set(slot, { ...guard, cohortId: request.cohortId, path: requestedPath });
        return guard;
      });
      return {
        ok: true, command: 'acquire', requestId: request.requestId, cohortId: request.cohortId, guards,
      };
    }
    if (['release', 'delete', 'rename', 'replace'].includes(request.command)) {
      const held = this.active.get(request.slot);
      assert.ok(held, 'fake helper received a terminal command for an inactive slot');
      assert.equal(request.cohortId, held.cohortId);
      assert.equal(request.generation, held.generation);
      this.active.delete(request.slot);
      return {
        ok: true,
        command: request.command,
        requestId: request.requestId,
        cohortId: request.cohortId,
        slot: request.slot,
        generation: request.generation,
      };
    }
    if (request.command === 'verify') {
      return {
        ok: true,
        command: 'verify',
        requestId: request.requestId,
        cohortId: request.cohortId,
        generation: request.generation,
        entries: 3,
      };
    }
    if (request.command === 'close') {
      assert.equal(this.active.size, 0, 'fake helper was closed with live capabilities');
      return {
        ok: true, command: 'close', requestId: request.requestId, cohortId: request.cohortId,
      };
    }
    throw new Error(`Unexpected fake protocol command: ${request.command}`);
  }

  #writeRaw(value) {
    queueMicrotask(() => {
      if (!this.closed) this.stdout.emit('data', Buffer.from(value));
    });
  }

  #writeJson(value, exitAfter, exitCode) {
    queueMicrotask(() => {
      if (this.closed) return;
      this.stdout.emit('data', Buffer.from(`${JSON.stringify(value)}\n`));
      if (exitAfter) this.#exit(exitCode);
    });
  }

  #exit(code) {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => {
      this.stdout.emit('end');
      this.stdin.emit('close');
      this.emit('close', code);
    });
  }
}

class FakeSessionFactory {
  constructor(options = {}) {
    this.children = [];
    this.requests = [];
    this.onRequest = options.onRequest ?? null;
    this.identityOverride = options.identityFor ?? null;
    this.deferKilledExit = options.deferKilledExit ?? false;
    this.identities = new Map();
    this.nextIdentity = 1;
  }

  spawn = (_executable, args) => {
    const helper = args.at(-1).replaceAll('\\', '/');
    const kind = helper.includes('inspect-minecraft-world-files-session')
      ? 'verifier'
      : helper.includes('directories-session')
      ? 'directory'
      : helper.includes('files-session') ? 'file' : 'verifier';
    const child = new FakeChild(this, kind, this.children.filter((item) => item.kind === kind).length);
    this.children.push(child);
    return child;
  };

  identityFor(context) {
    if (this.identityOverride) return this.identityOverride(context);
    const key = `${context.kind}:${context.path.toLowerCase()}`;
    if (!this.identities.has(key)) {
      this.identities.set(key, `00000001:${String(this.nextIdentity).padStart(16, '0')}`);
      this.nextIdentity += 1;
    }
    return this.identities.get(key);
  }

  ofKind(kind) {
    return this.children.filter((child) => child.kind === kind);
  }
}

function fixture(factory, options = {}) {
  assert.equal(createBackupWindowsSafetyBroker, createWindowsFilesystemSafetyBroker);
  return createWindowsFilesystemSafetyBroker({
    platform: 'win32',
    spawnProcess: factory.spawn,
    requestTimeoutMs: 100,
    ...options,
  });
}

function unsafe(error) {
  return error?.code === 'WORLD_INTEGRITY_FAILED' && error?.statusCode === 409;
}

test('nested operations reuse lazy persistent workers, cohorts, slots, and exact close handshakes', async () => {
  const factory = new FakeSessionFactory();
  const broker = fixture(factory);

  const result = await broker.runOperation(async (injected) => {
    assert.equal(injected, broker);
    const [first] = await broker.directoryGuard.batch(['C:\\safe\\first']);
    const [second] = await broker.directoryGuard.batch(['C:\\safe\\second']);
    assert.equal(first.processId, second.processId);
    assert.notEqual(first.cohortId, second.cohortId);
    assert.equal(factory.ofKind('directory').length, 1);

    await broker.runOperation(async () => {
      const file = await broker.fileGuard('C:\\safe\\value.dat');
      const verified = await broker.filesystemTreeVerifier('C:\\safe', { maxEntries: 20, maxDepth: 4 });
      assert.deepEqual(verified, { ok: true, checked: true, entries: 3 });
      const verifiedAgain = await broker.filesystemTreeVerifier('C:\\safe\\second', { maxEntries: 20, maxDepth: 4 });
      assert.deepEqual(verifiedAgain, { ok: true, checked: true, entries: 3 });
      assert.equal(factory.ofKind('verifier').length, 1);
      await file.release();
      assert.equal(factory.ofKind('file')[0].closed, false, 'terminal ACK must not wait for worker exit');
    });
    assert.equal(factory.children.some((child) => child.closed), false, 'nested runOperation must not close the outer scope');

    await Promise.all([first.release(), second.release()]);
    const recycled = await broker.directoryGuard('C:\\safe\\third');
    assert.equal(recycled.slot, first.slot);
    assert.equal(recycled.generation, '2');
    assert.equal(recycled.processId, first.processId);
    await recycled.release();
    return 'complete';
  });

  assert.equal(result, 'complete');
  assert.deepEqual(factory.children.map((child) => child.kind).sort(), ['directory', 'file', 'verifier']);
  for (const child of factory.children) {
    assert.equal(child.closed, true);
    assert.equal(child.killed, false);
    assert.equal(child.requests.filter((request) => request.command === 'close').length, 1);
  }
  const requestIds = factory.requests.map(({ request }) => request.requestId);
  assert.equal(new Set(requestIds).size, requestIds.length);
  assert.ok(factory.requests.every(({ request }) => typeof request.cohortId === 'string'));
  assert.deepEqual(
    factory.ofKind('verifier')[0].requests.filter((request) => request.command === 'verify').map((request) => request.generation),
    ['1', '2'],
  );
});

test('capacity reservations spawn bounded pools and fail immediately instead of waiting for held ancestors', async () => {
  const factory = new FakeSessionFactory();
  const broker = fixture(factory, { workerCapacity: 2, maxDirectoryWorkers: 2, maxFileWorkers: 2 });

  await broker.runOperation(async () => {
    const directories = [];
    for (let index = 0; index < 4; index += 1) {
      directories.push(await broker.directoryGuard(`C:\\safe\\directory-${index}`));
    }
    assert.equal(factory.ofKind('directory').length, 2);
    await assert.rejects(broker.directoryGuard('C:\\safe\\directory-overflow'), unsafe);
    assert.equal(factory.ofKind('directory').length, 2);

    const files = [];
    for (let index = 0; index < 4; index += 1) {
      files.push(await broker.fileGuard(`C:\\safe\\file-${index}.dat`));
    }
    assert.equal(factory.ofKind('file').length, 2);
    await assert.rejects(broker.fileGuard('C:\\safe\\file-overflow.dat'), unsafe);
    assert.equal(factory.ofKind('file').length, 2);
    await Promise.all([...directories, ...files].map((guard) => guard.release()));
  });

  assert.equal(factory.children.every((child) => child.closed && !child.killed), true);
});

test('normalized path duplicates are rejected across cohorts without mutable deduplication', async () => {
  const factory = new FakeSessionFactory();
  const broker = fixture(factory);
  await broker.runOperation(async () => {
    const guard = await broker.directoryGuard('C:\\safe\\CaseSensitive');
    await assert.rejects(broker.fileGuard('c:/safe/casesensitive'), unsafe);
    assert.equal(factory.children.length, 1, 'duplicate paths must be rejected before another helper is spawned');
    guard.assertHeld();
    await guard.release();
  });
});

test('native identity collisions across workers poison the entire operation scope', async () => {
  const factory = new FakeSessionFactory({ identityFor: () => '0000000a:000000000000000b' });
  const broker = fixture(factory, { workerCapacity: 1, maxDirectoryWorkers: 2 });
  let first;
  await assert.rejects(broker.runOperation(async () => {
    first = await broker.directoryGuard('C:\\safe\\alias-a');
    await assert.rejects(broker.directoryGuard('C:\\safe\\alias-b'), unsafe);
    assert.throws(() => first.assertHeld(), unsafe);
  }), unsafe);
  assert.equal(factory.ofKind('directory').length, 2);
  assert.equal(factory.ofKind('directory').every((child) => child.killed), true);
});

test('an invalid helper reply poisons every worker and is never retried', async () => {
  let invalidated = false;
  const factory = new FakeSessionFactory({
    onRequest: ({ child, request }) => {
      if (!invalidated && child.kind === 'directory' && request.command === 'acquire') {
        invalidated = true;
        return { type: 'reply', value: { ok: true, unexpected: true } };
      }
      return null;
    },
  });
  const broker = fixture(factory);
  await assert.rejects(broker.runOperation(async () => {
    const file = await broker.fileGuard('C:\\safe\\held.dat');
    await assert.rejects(broker.directoryGuard('C:\\safe\\invalid'), unsafe);
    assert.throws(() => file.assertHeld(), unsafe);
    assert.equal(factory.ofKind('directory').length, 1);
  }), unsafe);
  assert.equal(factory.children.every((child) => child.killed), true);
});

test('a timed-out helper request poisons the scope and is not retried', async () => {
  const factory = new FakeSessionFactory({
    onRequest: ({ child, request }) => (
      child.kind === 'directory' && request.command === 'acquire' ? { type: 'hang' } : null
    ),
  });
  const broker = fixture(factory, { requestTimeoutMs: 20 });
  await assert.rejects(broker.runOperation(
    () => broker.directoryGuard('C:\\safe\\timeout'),
  ), unsafe);
  assert.equal(factory.ofKind('directory').length, 1);
  assert.equal(factory.ofKind('directory')[0].killed, true);
  assert.equal(factory.requests.filter(({ request }) => request.command === 'acquire').length, 1);
});

test('poisoned scope waits for observed helper exit before failure completion', async () => {
  const factory = new FakeSessionFactory({
    deferKilledExit: true,
    onRequest: ({ child, request }) => (
      child.kind === 'directory' && request.command === 'acquire' ? { type: 'hang' } : null
    ),
  });
  const broker = fixture(factory, { requestTimeoutMs: 20 });
  let settled = false;
  const result = broker.runOperation(
    () => broker.directoryGuard('C:\\safe\\deferred-exit'),
  ).finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const [child] = factory.ofKind('directory');
  assert.equal(child.killed, true);
  assert.equal(settled, false, 'failure must retain custody until the killed helper is observed exiting');
  child.finishKilledExit();
  await assert.rejects(result, unsafe);
  assert.equal(settled, true);
});

test('worker crash and terminal ambiguity poison the scope with one memoized terminal request', async () => {
  const factory = new FakeSessionFactory({
    onRequest: ({ request }) => (request.command === 'delete' ? { type: 'crash' } : null),
  });
  const broker = fixture(factory);
  await assert.rejects(broker.runOperation(async () => {
    const guard = await broker.fileGuard('C:\\safe\\crash.dat');
    const deletion = guard.delete();
    assert.equal(guard.delete(), deletion);
    await assert.rejects(deletion, unsafe);
    await assert.rejects(guard.release(), unsafe);
  }), unsafe);
  assert.equal(factory.requests.filter(({ request }) => request.command === 'delete').length, 1);
});

test('terminal ACK accounting requires the exact request, cohort, slot, and generation tuple', async () => {
  const factory = new FakeSessionFactory({
    onRequest: ({ request }) => {
      if (request.command !== 'release') return null;
      return {
        type: 'reply',
        value: {
          ok: true,
          command: 'release',
          requestId: request.requestId,
          cohortId: request.cohortId,
          slot: request.slot,
          generation: String(Number(request.generation) + 1),
        },
      };
    },
  });
  const broker = fixture(factory);
  await assert.rejects(broker.runOperation(async () => {
    const file = await broker.fileGuard('C:\\safe\\exact-file.dat');
    const directory = await broker.directoryGuard('C:\\safe\\exact-directory');
    await assert.rejects(file.release(), unsafe);
    assert.throws(() => directory.assertHeld(), unsafe);
  }), unsafe);
  assert.equal(factory.requests.filter(({ request }) => request.command === 'release').length, 1);
  assert.equal(factory.children.every((child) => child.killed), true);
});

test('outer scope close rejects leaked capabilities instead of sending an inexact close', async () => {
  const factory = new FakeSessionFactory();
  const broker = fixture(factory);
  await assert.rejects(broker.runOperation(async () => {
    await broker.directoryGuard('C:\\safe\\leaked');
  }), unsafe);
  const [child] = factory.children;
  assert.equal(child.killed, true);
  assert.equal(child.requests.some((request) => request.command === 'close'), false);
});

test('scope close requires an explicit valid close ACK and clean zero exit', async () => {
  for (const mode of ['bad-ack', 'bad-exit']) {
    const factory = new FakeSessionFactory({
      onRequest: ({ request }) => {
        if (request.command !== 'close') return null;
        if (mode === 'bad-ack') {
          return { type: 'reply', value: { ok: true, command: 'close', requestId: request.requestId } };
        }
        return {
          type: 'reply',
          value: { ok: true, command: 'close', requestId: request.requestId, cohortId: request.cohortId },
          exitCode: 9,
        };
      },
    });
    const broker = fixture(factory);
    await assert.rejects(broker.runOperation(async () => {
      const guard = await broker.directoryGuard(`C:\\safe\\${mode}`);
      await guard.release();
    }), unsafe);
  }
});

test('concurrent reentrant cohorts serialize per worker and use distinct request/cohort IDs', async () => {
  const factory = new FakeSessionFactory();
  const broker = fixture(factory, { workerCapacity: 4 });
  await broker.runOperation(async () => {
    const [first, second] = await Promise.all([
      broker.fileGuard('C:\\safe\\one.dat'),
      broker.runOperation(() => broker.fileGuard('C:\\safe\\two.dat')),
    ]);
    assert.equal(first.processId, second.processId);
    assert.notEqual(first.cohortId, second.cohortId);
    await Promise.all([first.release(), second.release()]);
  });
  const requests = factory.ofKind('file')[0].requests;
  assert.deepEqual(requests.map((request) => request.command), ['acquire', 'acquire', 'release', 'release', 'close']);
  assert.equal(new Set(requests.map((request) => request.requestId)).size, requests.length);
});

test('strict Windows path validation rejects namespaces, ADS, devices, and ambiguous roots before spawn', async () => {
  const factory = new FakeSessionFactory();
  const broker = fixture(factory);
  await broker.runOperation(async () => {
    for (const unsafePath of [
      '\\\\.\\C:\\safe\\file.dat',
      '\\\\?\\C:\\safe\\file.dat',
      '//./C:/safe/file.dat',
      '//?/C:/safe/file.dat',
      '\\??\\C:\\safe\\file.dat',
      '\\\\??\\C:\\safe\\file.dat',
      'C:drive-relative.dat',
      'C:\\safe\\file.dat:stream',
      'C:\\safe\\NUL.txt',
      'C:\\safe\\CON .txt',
      '\\root-relative',
      'C:\\',
      '\\\\server\\share',
      '\\\\server\\share\\',
      'C:\\safe\\.\\file.dat',
      'C:\\safe\\..\\file.dat',
      'C:\\safe\\\\file.dat',
      'C:\\safe\\trailing.\\file.dat',
    ]) {
      await assert.rejects(broker.fileGuard(unsafePath), unsafe, unsafePath);
    }
  });
  assert.equal(factory.children.length, 0);
});

test('guard and verifier proxies fail closed outside or after their operation context', async () => {
  const factory = new FakeSessionFactory();
  const broker = fixture(factory);
  await assert.rejects(async () => broker.directoryGuard('C:\\safe\\outside'), unsafe);
  let escaped;
  await broker.runOperation(async () => {
    escaped = () => broker.filesystemTreeVerifier('C:\\safe');
  });
  await assert.rejects(escaped(), unsafe);
});
