import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createWindowsFilesystemSafetyBroker } from '../src/backup-windows-safety-scope.mjs';

const ENABLED = process.platform === 'win32'
  && process.env.MASTERMIND_RUN_NATIVE_SAFETY_SESSION === '1';
const TEST_NAME = 'persistent native safety session reuses cohorts and leaves zero helper PIDs';

function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function helperKind(args) {
  const helper = String(args.at(-1)).replaceAll('\\', '/');
  if (helper.includes('inspect-minecraft-world-files-session')) return 'verifier';
  if (helper.includes('directories-session')) return 'directory';
  if (helper.includes('files-session')) return 'file';
  throw new Error(`Unexpected native helper: ${helper}`);
}

function consumeLines(record, field, chunk) {
  record[field] += Buffer.from(chunk).toString('utf8');
  while (true) {
    const newline = record[field].indexOf('\n');
    if (newline < 0) return;
    let line = record[field].slice(0, newline);
    record[field] = record[field].slice(newline + 1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) continue;
    const value = JSON.parse(line);
    if (field === 'inputBuffer') record.requests.push(value);
    else {
      record.responses.push(value);
      if (value.command === 'close' && value.ok === true) record.events.push('close-ack');
    }
  }
}

function recordingSpawn(records) {
  return (command, args, options) => {
    const child = spawn(command, args, options);
    const record = {
      kind: helperKind(args),
      child,
      pid: child.pid,
      requests: [],
      responses: [],
      inputBuffer: '',
      outputBuffer: '',
      events: [],
      closeCode: null,
      closeSignal: null,
    };
    records.push(record);

    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (chunk, ...writeArgs) => {
      consumeLines(record, 'inputBuffer', chunk);
      return write(chunk, ...writeArgs);
    };
    child.stdout.on('data', (chunk) => consumeLines(record, 'outputBuffer', chunk));
    child.once('close', (code, signal) => {
      record.closeCode = code;
      record.closeSignal = signal;
      record.events.push('process-close');
    });
    return child;
  };
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function assertSafeFixture(fixture) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(fixture);
  const relative = path.relative(temporaryRoot, resolved);
  assert.equal(path.isAbsolute(relative), false);
  assert.notEqual(relative, '..');
  assert.equal(relative.startsWith(`..${path.sep}`), false);
  assert.match(path.basename(resolved), /^mastermind-native-session-[A-Za-z0-9_-]+$/);
  return resolved;
}

test('persistent native verifier rejects ambiguous child entries and leaves zero helper PIDs', {
  skip: ENABLED ? false : 'explicit native safety-session gate is disabled',
}, async (t) => {
  const fixture = assertSafeFixture(await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-native-session-')));
  const ambiguousPath = `\\\\?\\${path.join(fixture, 'ambiguous.').replaceAll('/', '\\')}`;
  const records = [];
  try {
    try {
      await fs.writeFile(ambiguousPath, 'ambiguous native child\n', { flag: 'wx' });
    } catch (error) {
      t.skip(`extended-path ambiguous child creation is unavailable: ${error?.code ?? 'unknown'}`);
      return;
    }
    const broker = createWindowsFilesystemSafetyBroker({
      platform: 'win32',
      spawnProcess: recordingSpawn(records),
      requestTimeoutMs: 30_000,
      verificationTimeoutMs: 120_000,
    });
    await assert.rejects(
      () => broker.runOperation(() => broker.filesystemTreeVerifier(fixture, { maxEntries: 8, maxDepth: 2 })),
      (error) => error?.code === 'WORLD_INTEGRITY_FAILED' && error?.statusCode === 409,
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, 'verifier');
    assert.notEqual(records[0].closeCode, 0);
    assert.equal(isPidAlive(records[0].pid), false, `verifier PID ${records[0].pid} survived rejection`);
    t.diagnostic(`ambiguous-child verifier PID exited: ${records[0].pid}`);
  } finally {
    await fs.unlink(ambiguousPath).catch(() => undefined);
    assertSafeFixture(fixture);
    await fs.rm(fixture, { recursive: true, force: true });
  }
});

test(TEST_NAME, { skip: ENABLED ? false : 'explicit native safety-session gate is disabled' }, async () => {
  const fixture = assertSafeFixture(await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-native-session-')));
  const directories = ['directory-a', 'directory-b', 'directory-c'].map((name) => path.join(fixture, name));
  const files = ['file-a.dat', 'file-b.dat', 'file-c.dat'].map((name) => path.join(fixture, name));
  const records = [];
  let evidence;

  try {
    await Promise.all(directories.map((directory) => fs.mkdir(directory)));
    await Promise.all(files.map((file, index) => fs.writeFile(file, `native-session-${index}\n`, { flag: 'wx' })));

    const broker = createWindowsFilesystemSafetyBroker({
      platform: 'win32',
      spawnProcess: recordingSpawn(records),
      requestTimeoutMs: 30_000,
      verificationTimeoutMs: 120_000,
    });

    await broker.runOperation(async () => {
      const [directoryA] = await broker.directoryGuard.batch([directories[0]]);
      const [directoryB] = await broker.directoryGuard.batch([directories[1]]);
      assert.equal(directoryA.processId, directoryB.processId);
      assert.notEqual(directoryA.cohortId, directoryB.cohortId);
      await Promise.all([directoryA.release(), directoryB.release()]);
      const directoryC = await broker.directoryGuard(directories[2]);
      assert.equal(directoryC.processId, directoryA.processId);
      assert.equal(directoryC.slot, directoryA.slot);
      assert.equal(BigInt(directoryC.generation) > BigInt(directoryA.generation), true);
      await directoryC.release();

      const [fileA] = await broker.fileGuard.batch([files[0]]);
      const [fileB] = await broker.fileGuard.batch([files[1]]);
      assert.equal(fileA.processId, fileB.processId);
      assert.notEqual(fileA.cohortId, fileB.cohortId);
      await Promise.all([fileA.release(), fileB.release()]);
      const fileC = await broker.fileGuard(files[2]);
      assert.equal(fileC.processId, fileA.processId);
      assert.equal(fileC.slot, fileA.slot);
      assert.equal(BigInt(fileC.generation) > BigInt(fileA.generation), true);
      await fileC.release();

      const firstVerification = await broker.filesystemTreeVerifier(fixture, { maxEntries: 32, maxDepth: 4 });
      const secondVerification = await broker.filesystemTreeVerifier(directories[0], {
        maxEntries: 32, maxDepth: 4,
      });
      assert.equal(firstVerification.checked, true);
      assert.equal(secondVerification.checked, true);
      assert.equal(records.filter((record) => record.kind === 'verifier').length, 1);

      assert.equal(records.length, 3);
      assert.equal(new Set(records.map((record) => record.pid)).size, 3);
      assert.equal(records.every((record) => record.child.exitCode === null), true,
        'terminal ACKs must leave persistent helpers alive until scope close');
    });

    assert.deepEqual(records.map((record) => record.kind).sort(), ['directory', 'file', 'verifier']);
    for (const record of records) {
      assert.equal(record.inputBuffer, '');
      assert.equal(record.outputBuffer, '');
      assert.equal(record.closeCode, 0);
      assert.equal(record.closeSignal, null);
      assert.equal(record.child.exitCode, 0);
      assert.equal(record.child.signalCode, null);
      assert.deepEqual(record.events.slice(-2), ['close-ack', 'process-close']);

      const closeRequests = record.requests.filter((request) => request.command === 'close');
      const closeReplies = record.responses.filter((response) => response.command === 'close');
      assert.equal(closeRequests.length, 1);
      assert.equal(closeReplies.length, 1);
      const request = closeRequests[0];
      const reply = closeReplies[0];
      assert.equal(exactKeys(reply, ['ok', 'command', 'requestId', 'cohortId']), true);
      assert.deepEqual(reply, {
        ok: true, command: 'close', requestId: request.requestId, cohortId: request.cohortId,
      });
      assert.equal(isPidAlive(record.pid), false, `helper PID ${record.pid} survived scope close`);
    }

    const directoryRecord = records.find((record) => record.kind === 'directory');
    const fileRecord = records.find((record) => record.kind === 'file');
    const verifierRecord = records.find((record) => record.kind === 'verifier');
    assert.equal(directoryRecord.requests.filter((request) => request.command === 'acquire').length, 3);
    assert.equal(fileRecord.requests.filter((request) => request.command === 'acquire').length, 3);
    assert.equal(verifierRecord.requests.filter((request) => request.command === 'verify').length, 2);

    evidence = records.map((record) => ({
      kind: record.kind,
      pid: record.pid,
      cohorts: record.requests.filter((request) => ['acquire', 'verify'].includes(request.command)).length,
      closeAck: true,
      closeCode: record.closeCode,
      aliveAfterClose: isPidAlive(record.pid),
    }));
    console.log(`NATIVE_SESSION_EVIDENCE ${JSON.stringify(evidence)}`);
  } finally {
    assertSafeFixture(fixture);
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
