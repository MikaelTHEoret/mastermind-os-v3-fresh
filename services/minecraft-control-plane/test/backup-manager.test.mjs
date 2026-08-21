import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { FamilyServerBackupManager } from '../src/backup-manager.mjs';
import { createWindowsFilesystemSafetyBroker } from '../src/backup-windows-safety-scope.mjs';
import {
  acquireWindowsDirectoryGuard,
  acquireWindowsFileGuard,
  assertWindowsFilesystemTree,
} from '../src/windows-filesystem-safety.mjs';

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function writeRestoreMarker(value, transactionId, marker) {
  const key = await fs.readFile(path.join(value.managedRoot, 'state', 'operator-backups', 'hmac.key'));
  const unsigned = structuredClone(marker);
  delete unsigned.mac;
  const mac = crypto.createHmac('sha256', key).update(canonicalJson(unsigned), 'utf8').digest('hex');
  const markerRoot = path.join(value.managedRoot, 'state', 'operator-backups', 'restore-transactions');
  await fs.writeFile(path.join(markerRoot, `${transactionId}.json`), `${JSON.stringify({ ...unsigned, mac }, null, 2)}\n`);
}

async function writeCleanupMarker(value, marker) {
  const key = await fs.readFile(path.join(value.managedRoot, 'state', 'operator-backups', 'hmac.key'));
  const unsigned = structuredClone(marker);
  delete unsigned.mac;
  const mac = crypto.createHmac('sha256', key)
    .update(`backup-cleanup-v1\n${canonicalJson(unsigned)}`, 'utf8').digest('hex');
  const root = path.join(value.managedRoot, 'state', 'operator-backups', 'cleanup-transactions');
  await fs.writeFile(path.join(root, `${marker.cleanupId}.json`), `${JSON.stringify({ ...unsigned, mac }, null, 2)}\n`);
}

class MemoryStore {
  constructor(record) { this.record = structuredClone(record); }
  async get(id) { return id === this.record.id ? structuredClone(this.record) : null; }
  async list() { return [structuredClone(this.record)]; }
  async update(id, patch) {
    if (id !== this.record.id) throw new Error('not found');
    this.record = { ...this.record, ...structuredClone(patch), updatedAt: new Date().toISOString() };
    return structuredClone(this.record);
  }
}

function batchGuardHarness(options = {}) {
  const trace = {
    directoryBatches: [], fileBatches: [], directorySingles: [], fileSingles: [], active: new Set(), released: [],
  };
  let batchSequence = 0;
  const makeGuard = (kind, target, batchId, index) => {
    const token = `${kind}:${batchId}:${index}:${target}`;
    let held = true;
    trace.active.add(token);
    const consume = () => {
      if (!held) return;
      held = false;
      trace.active.delete(token);
      trace.released.push(token);
    };
    return {
      assertHeld() {
        assert.equal(held, true, `guard was not held: ${target}`);
        options.onAssertHeld?.({ kind, target, batchId, index, trace });
      },
      async release() { consume(); },
      async rename(destination) { assert.equal(held, true); await fs.rename(target, destination); consume(); },
      async replace(destination) { assert.equal(held, true); await fs.rename(target, destination); consume(); },
      async delete() {
        assert.equal(held, true);
        if (kind === 'directory') await fs.rmdir(target); else await fs.unlink(target);
        consume();
      },
    };
  };
  const factory = (kind) => {
    const single = async (target) => {
      const batchId = `single-${++batchSequence}`;
      trace[`${kind}Singles`].push(target);
      return makeGuard(kind, target, batchId, 0);
    };
    single.batch = async (targets) => {
      const batchId = `batch-${++batchSequence}`;
      trace[`${kind}Batches`].push([...targets]);
      await options.onBatch?.({ kind, targets, batchId, trace });
      return targets.map((target, index) => makeGuard(kind, target, batchId, index));
    };
    return single;
  };
  return { trace, directoryGuard: factory('directory'), fileGuard: factory('file') };
}

function retainedGuardHarness(options = {}) {
  const held = new Map();
  const count = (target) => held.get(path.resolve(target).toLowerCase()) ?? 0;
  const adjust = (target, delta) => {
    const key = path.resolve(target).toLowerCase();
    const next = (held.get(key) ?? 0) + delta;
    if (next > 0) held.set(key, next); else held.delete(key);
  };
  const make = (kind) => async (target) => {
    let active = true;
    adjust(target, 1);
    try { await options.onAcquire?.({ kind, target, count }); }
    catch (error) { adjust(target, -1); throw error; }
    const consume = () => {
      if (!active) return;
      active = false;
      adjust(target, -1);
    };
    return {
      assertHeld() { assert.equal(active, true); },
      async release() {
        assert.equal(active, true);
        await options.beforeRelease?.({ kind, target, count });
        consume();
      },
      async rename(destination) {
        assert.equal(active, true);
        await options.beforeRename?.({ kind, target, destination, count });
        await fs.rename(target, destination);
        consume();
      },
      async replace(destination) {
        assert.equal(active, true);
        await options.beforeReplace?.({ kind, target, destination, count });
        await fs.rename(target, destination);
        consume();
      },
      async delete() {
        assert.equal(active, true);
        await options.beforeDelete?.({ kind, target, count });
        if (kind === 'directory') await fs.rmdir(target); else await fs.unlink(target);
        consume();
      },
    };
  };
  return { held, count, directoryGuard: make('directory'), fileGuard: make('file') };
}

function scopedBrokerHarness() {
  const trace = {
    outerOperations: 0,
    nestedOperations: 0,
    guardCalls: 0,
    verifierCalls: 0,
    scopeDepth: 0,
    active: new Set(),
    activePaths: new Set(),
  };
  let scopeActive = false;
  let sequence = 0;
  let broker;
  const assertScoped = () => assert.equal(scopeActive, true, 'filesystem dependency escaped its broker scope');
  const makeGuard = (kind, target) => {
    assertScoped();
    trace.guardCalls += 1;
    const pathToken = `${kind}:${path.resolve(target).toLowerCase()}`;
    assert.equal(trace.activePaths.has(pathToken), false, `duplicate scoped guard path: ${target}`);
    const token = `${kind}:${++sequence}:${target}`;
    let held = true;
    trace.active.add(token);
    trace.activePaths.add(pathToken);
    const consume = () => {
      assert.equal(held, true);
      held = false;
      trace.active.delete(token);
      trace.activePaths.delete(pathToken);
    };
    return {
      assertHeld() { assertScoped(); assert.equal(held, true); },
      async release() { assertScoped(); consume(); },
      async delete() {
        assertScoped();
        if (kind === 'directory') await fs.rmdir(target); else await fs.unlink(target);
        consume();
      },
      async rename(destination) { assertScoped(); await fs.rename(target, destination); consume(); },
      ...(kind === 'file' ? {
        async replace(destination) { assertScoped(); await fs.rename(target, destination); consume(); },
      } : {}),
    };
  };
  const guardFactory = (kind) => {
    const guard = async (target) => makeGuard(kind, target);
    guard.batch = async (targets) => {
      assertScoped();
      return targets.map((target) => makeGuard(kind, target));
    };
    return guard;
  };
  const directoryGuard = guardFactory('directory');
  const fileGuard = guardFactory('file');
  const filesystemTreeVerifier = async () => {
    assertScoped();
    trace.verifierCalls += 1;
    return { ok: true, checked: false };
  };
  const runOperation = async (operation) => {
    if (scopeActive) {
      trace.nestedOperations += 1;
      return operation(broker);
    }
    trace.outerOperations += 1;
    scopeActive = true;
    trace.scopeDepth = 1;
    let result;
    let failure = null;
    try { result = await operation(broker); } catch (error) { failure = error; }
    try { assert.equal(trace.active.size, 0, 'broker scope closed with live guards'); }
    catch (error) { failure ??= error; }
    try { assert.equal(trace.activePaths.size, 0, 'broker scope closed with live guard paths'); }
    catch (error) { failure ??= error; }
    scopeActive = false;
    trace.scopeDepth = 0;
    if (failure) throw failure;
    return result;
  };
  broker = { runOperation, directoryGuard, fileGuard, filesystemTreeVerifier };
  return { broker, trace };
}

function nativeBrokerHelperKind(args) {
  const helper = String(args.at(-1)).replaceAll('\\', '/');
  if (helper.includes('inspect-minecraft-world-files-session')) return 'verifier';
  if (helper.includes('guard-minecraft-world-directories-session')) return 'directory';
  if (helper.includes('guard-minecraft-world-files-session')) return 'file';
  throw new Error(`Unexpected native backup helper: ${helper}`);
}

function consumeNativeBrokerLines(record, field, chunk) {
  record[field] += Buffer.from(chunk).toString('utf8');
  for (;;) {
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

function nativeBrokerRecorder() {
  const records = [];
  const spawnProcess = (command, args, options) => {
    const child = spawn(command, args, options);
    const record = {
      kind: nativeBrokerHelperKind(args),
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
    child.stdin.write = (chunk, ...writeArguments) => {
      consumeNativeBrokerLines(record, 'inputBuffer', chunk);
      return write(chunk, ...writeArguments);
    };
    child.stdout.on('data', (chunk) => consumeNativeBrokerLines(record, 'outputBuffer', chunk));
    child.once('close', (code, signal) => {
      record.closeCode = code;
      record.closeSignal = signal;
      record.events.push('process-close');
    });
    return child;
  };
  return {
    records,
    broker: createWindowsFilesystemSafetyBroker({
      platform: 'win32',
      spawnProcess,
      requestTimeoutMs: 30_000,
      verificationTimeoutMs: 120_000,
    }),
  };
}

function nativePidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function nativeBrokerEvidence(records) {
  return records.map((record) => {
    const cohortRequests = record.requests.filter(({ command }) => ['acquire', 'verify'].includes(command));
    const acquiredCapabilities = record.responses
      .filter(({ command, ok }) => command === 'acquire' && ok === true)
      .reduce((count, response) => count + (Array.isArray(response.guards) ? response.guards.length : 0), 0);
    const terminalCapabilities = record.requests.filter(
      ({ command }) => ['release', 'delete', 'rename', 'replace'].includes(command),
    ).length;
    return {
      kind: record.kind,
      pid: record.pid,
      cohorts: cohortRequests.length,
      uniqueCohorts: new Set(cohortRequests.map(({ cohortId }) => cohortId)).size,
      acquiredCapabilities,
      terminalCapabilities,
      closeAck: record.responses.some(({ command, ok }) => command === 'close' && ok === true),
      closeCode: record.closeCode,
      aliveAfterClose: nativePidIsAlive(record.pid),
    };
  });
}

function fileBatchProtocolHarness() {
  const trace = { batches: [], spawnInvocations: [], singleCalls: [], killed: [] };
  let sequence = 0;
  const spawnProcess = (command, args, options) => {
    const batch = {
      id: ++sequence,
      command,
      args: [...args],
      options: { ...options },
      requests: [],
      paths: [],
      closed: false,
      exitCode: null,
    };
    trace.batches.push(batch);
    trace.spawnInvocations.push({ command, args: [...args], options: { ...options } });
    const child = new EventEmitter();
    child.pid = 50_000 + batch.id;
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    let input = '';
    let operationTail = Promise.resolve();
    const active = new Set();
    const close = (code) => {
      if (batch.closed) return;
      batch.closed = true;
      batch.exitCode = code;
      child.stdout.end();
      setImmediate(() => child.emit('close', code));
    };
    child.kill = () => {
      trace.killed.push(batch.id);
      close(1);
      return true;
    };
    const respond = (value) => child.stdout.write(`${JSON.stringify(value)}\n`);
    const consume = async (request) => {
      batch.requests.push(structuredClone(request));
      if (request.command === 'acquire') {
        batch.paths = [...request.paths];
        request.paths.forEach((_target, id) => active.add(id));
        const guards = await Promise.all(request.paths.map(async (target, id) => ({
          id,
          identity: `${batch.id.toString(16).padStart(8, '0')}:${(BigInt(batch.id) * 1_000n + BigInt(id + 1)).toString(16).padStart(16, '0')}`,
          size: String((await fs.lstat(target)).size),
        })));
        respond({ ok: true, guards });
        return;
      }
      const target = batch.paths[request.id];
      if (!active.has(request.id) || typeof target !== 'string') throw new Error('invalid fake batch terminal command');
      if (request.command === 'rename' || request.command === 'replace') {
        await fs.rename(target, request.destination);
      } else if (request.command === 'delete') {
        await fs.unlink(target);
      } else if (request.command !== 'release') {
        throw new Error(`unexpected fake batch command: ${request.command}`);
      }
      active.delete(request.id);
      const field = request.command === 'release' ? 'released'
        : request.command === 'delete' ? 'deleted'
          : request.command === 'replace' ? 'replaced' : 'renamed';
      respond({ ok: true, id: request.id, [field]: true });
      if (active.size === 0) close(0);
    };
    child.stdin.on('data', (chunk) => {
      input += Buffer.from(chunk).toString('utf8');
      for (;;) {
        const newline = input.indexOf('\n');
        if (newline < 0) break;
        const request = JSON.parse(input.slice(0, newline));
        input = input.slice(newline + 1);
        operationTail = operationTail.then(() => consume(request)).catch(() => close(1));
      }
    });
    return child;
  };
  const fileGuard = async (target) => {
    trace.singleCalls.push(target);
    throw new Error(`unexpected unbatched file guard: ${target}`);
  };
  fileGuard.batch = (files) => acquireWindowsFileGuard.batch(files, {
    platform: 'win32',
    windowsRoot: 'C:\\Windows',
    spawnProcess,
  });
  return { fileGuard, trace };
}

async function fixture(t, options = {}) {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-backups-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const id = 'family-server';
  const directory = path.join(managedRoot, 'servers', id);
  await fs.mkdir(path.join(directory, 'world', 'region'), { recursive: true });
  await fs.mkdir(path.join(directory, 'config', 'Geyser-Fabric'), { recursive: true });
  await fs.mkdir(path.join(directory, 'mods'), { recursive: true });
  await fs.mkdir(path.join(directory, 'versions'), { recursive: true });
  if (!options.minimalFilesystem) {
    await fs.mkdir(path.join(directory, 'config', 'floodgate'), { recursive: true });
    await fs.mkdir(path.join(directory, '.fabric'), { recursive: true });
    await fs.mkdir(path.join(directory, 'libraries'), { recursive: true });
    await fs.mkdir(path.join(directory, 'logs'), { recursive: true });
    await fs.mkdir(path.join(directory, 'custom-state'), { recursive: true });
  }
  await fs.writeFile(path.join(directory, 'world', 'level.dat'), 'world-before');
  await fs.writeFile(path.join(directory, 'world', 'region', 'r.0.0.mca'), 'region-before');
  await fs.writeFile(path.join(directory, 'world', 'session.lock'), 'volatile-lock');
  await fs.writeFile(path.join(directory, 'config', 'Geyser-Fabric', 'config.yml'), 'managed-current-geyser-config');
  await fs.writeFile(path.join(directory, 'server.properties'), 'level-name=world\nserver-port=25565\n');
  if (!options.minimalFilesystem) {
    await fs.writeFile(path.join(directory, 'config', 'floodgate', 'key.pem'), 'private-floodgate-key');
    await fs.writeFile(path.join(directory, 'ops.json'), '[{"uuid":"owner"}]\n');
    await fs.writeFile(path.join(directory, 'custom-state', 'claims.json'), '{"home":true}\n');
    await fs.writeFile(path.join(directory, 'mods', 'family-custom.jar'), 'custom-mod');
    await fs.writeFile(path.join(directory, '.fabric', 'cache.jar'), 'runtime-cache');
    await fs.writeFile(path.join(directory, 'libraries', 'library.jar'), 'runtime-library');
    await fs.writeFile(path.join(directory, 'versions', 'server.jar'), 'runtime-version');
    await fs.writeFile(path.join(directory, 'logs', 'latest.log'), 'volatile-log');
  }
  const managedFiles = [
    'fabric-server-launch.jar',
    'mods/fabric-api.jar',
    'mods/geyser-fabric.jar',
    'mods/floodgate-fabric.jar',
  ];
  for (const relative of managedFiles) await fs.writeFile(path.join(directory, ...relative.split('/')), `managed-current:${relative}`);
  await fs.writeFile(path.join(directory, 'instance.json'), `${JSON.stringify({
    schemaVersion: 3,
    artifacts: managedFiles.map((fileName) => ({ fileName })),
  })}\n`);
  const now = '2026-08-13T12:00:00.000Z';
  const store = new MemoryStore({
    id,
    displayName: 'Family Server',
    projectId: 'family-server',
    kind: 'server',
    directory,
    status: 'stopped',
    pid: null,
    managedProcess: null,
    provisioningStatus: 'ready',
    minecraftVersion: '26.2',
    worldDataVersion: 4550,
    minecraftServerArtifact: {
      minecraftVersion: '26.2',
      worldDataVersion: 4550,
      relativePath: 'versions/26.2/server-26.2.jar',
      size: 1024,
      sha1: 'a'.repeat(40),
      sha256: 'b'.repeat(64),
    },
    loader: 'fabric',
    loaderVersion: '0.19.3',
    installerVersion: '1.1.2',
    requiredJavaMajor: 25,
    javaRuntime: {
      launchAssetDigest: 'c'.repeat(64),
      launchInventoryDigest: 'd'.repeat(64),
    },
    javaPort: 25565,
    bedrockPort: 19132,
    artifacts: managedFiles.map((fileName, index) => ({ fileName, size: index + 1, sha256: String(index + 1).repeat(64).slice(0, 64) })),
    createdAt: now,
    updatedAt: now,
  });
  let sequence = 0;
  const state = { active: false, verifyCalls: 0 };
  const worldStackBinding = options.worldStackBinding ?? {
    generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64),
  };
  const managerOptions = {
    withInstanceLock: options.withInstanceLock ?? (async (_instanceId, operation) => operation()),
    assertQuiescentWithinInstanceLock: async (instanceId) => {
      const instance = await store.get(instanceId);
      if (state.active || instance.status !== 'stopped' || instance.pid !== null) {
        throw Object.assign(new Error('not quiescent'), { code: 'BACKUP_SERVER_NOT_QUIESCENT', statusCode: 409 });
      }
      return instance;
    },
    verifyInstall: options.verifyInstall ?? (async (instance) => {
      state.verifyCalls += 1;
      assert.equal(await fs.readFile(path.join(instance.directory, 'fabric-server-launch.jar'), 'utf8'), 'managed-current:fabric-server-launch.jar');
      return { ok: true };
    }),
    currentWorldStackBindingWithinInstanceLock: options.currentWorldStackBindingWithinInstanceLock
      ?? (async () => structuredClone(worldStackBinding)),
    ...(options.omitWorldInterlock ? {} : {
      assertWorldMutationAllowedWithinInstanceLock: options.assertWorldMutationAllowedWithinInstanceLock
        ?? (async () => true),
    }),
    ...(options.omitWorldRestoreValidator ? {} : {
      validateRestoredWorldWithinInstanceLock: options.validateRestoredWorldWithinInstanceLock
        ?? (async (_id, expected) => structuredClone(expected)),
    }),
    ...(options.filesystemSafetyBroker ? {
      filesystemSafetyBroker: options.filesystemSafetyBroker,
      ...(options.filesystemTreeVerifier ? { filesystemTreeVerifier: options.filesystemTreeVerifier } : {}),
      ...(options.directoryGuard ? { directoryGuard: options.directoryGuard } : {}),
      ...(options.fileGuard ? { fileGuard: options.fileGuard } : {}),
    } : options.nativeFilesystemBoundary ? {
      ...(options.filesystemTreeVerifier ? { filesystemTreeVerifier: options.filesystemTreeVerifier } : {}),
      ...(options.directoryGuard ? { directoryGuard: options.directoryGuard } : {}),
      ...(options.fileGuard ? { fileGuard: options.fileGuard } : {}),
    } : {
      filesystemTreeVerifier: options.filesystemTreeVerifier ?? (async () => ({ ok: true, checked: false })),
      directoryGuard: options.directoryGuard ?? (async (directory) => ({
        assertHeld() {},
        async delete() { await fs.rmdir(directory); },
        async release() {},
        async rename(destination) { await fs.rename(directory, destination); },
      })),
      fileGuard: options.fileGuard ?? (async (file) => ({
        assertHeld() {},
        async delete() { await fs.unlink(file); },
        async rename(destination) { await fs.rename(file, destination); },
        async replace(destination) { await fs.rename(file, destination); },
        async release() {},
      })),
    }),
    now: options.now ?? (() => now),
    randomBytes: (size) => Buffer.alloc(size, ++sequence),
    ...(options.maxRestoreMarkers ? { maxRestoreMarkers: options.maxRestoreMarkers } : {}),
    ...(options.maxRestoreMarkerBytes ? { maxRestoreMarkerBytes: options.maxRestoreMarkerBytes } : {}),
    ...(options.maxManifestBytes ? { maxManifestBytes: options.maxManifestBytes } : {}),
    ...(options.maxSnapshots ? { maxSnapshots: options.maxSnapshots } : {}),
    ...(options.maxRestorePlans ? { maxRestorePlans: options.maxRestorePlans } : {}),
    ...(options.maxRestorePlansPerInstance ? { maxRestorePlansPerInstance: options.maxRestorePlansPerInstance } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
    onPhase: options.onPhase,
  };
  const makeManager = () => new FamilyServerBackupManager(managedRoot, store, managerOptions);
  const manager = makeManager();
  if (!options.skipInitialize) await manager.initialize();
  return {
    managedRoot, directory, id, manager, state, store,
    async recreateManager() {
      const recreated = makeManager();
      await recreated.initialize();
      return recreated;
    },
  };
}

test('creates a private verified mutable-state snapshot while excluding exact runtime data', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  assert.match(backup.backupId, /^bkp-[a-f0-9]{32}$/);
  assert.equal(backup.kind, 'manual');
  assert.equal(backup.integrity, 'verified');
  assert.equal(backup.restorable, true);
  const root = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id, backup.backupId);
  assert.equal(await fs.readFile(path.join(root, 'payload', 'world', 'level.dat'), 'utf8'), 'world-before');
  assert.equal(await fs.readFile(path.join(root, 'payload', 'config', 'floodgate', 'key.pem'), 'utf8'), 'private-floodgate-key');
  assert.equal(await fs.readFile(path.join(root, 'payload', 'mods', 'family-custom.jar'), 'utf8'), 'custom-mod');
  assert.equal(await fs.readFile(path.join(root, 'payload', 'custom-state', 'claims.json'), 'utf8'), '{"home":true}\n');
  for (const excluded of ['instance.json', 'fabric-server-launch.jar', '.fabric', 'libraries', 'versions', 'logs', 'world/session.lock', 'mods/fabric-api.jar', 'config/Geyser-Fabric/config.yml']) {
    await assert.rejects(() => fs.lstat(path.join(root, 'payload', ...excluded.split('/'))), (error) => error.code === 'ENOENT');
  }
  const publicList = await value.manager.list({ instanceId: value.id });
  assert.equal(publicList.backups.length, 1);
  assert.equal(JSON.stringify(publicList).includes('key.pem'), false);
  assert.equal(JSON.stringify(publicList).includes(value.managedRoot), false);
});

test('list verifies shared storage roots once and safely returns an empty inventory', async (t) => {
  const guards = batchGuardHarness();
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  guards.trace.directoryBatches.length = 0;

  const listed = await value.manager.list({ instanceId: value.id });

  assert.deepEqual(listed.policy, { enabled: false, intervalHours: 24, retentionCount: 7 });
  assert.deepEqual(listed.backups, []);
  const storageRoots = [
    path.join(value.managedRoot, 'operator-backups', 'snapshots'),
    path.join(value.managedRoot, 'state', 'operator-backups'),
    path.join(value.managedRoot, 'state', 'operator-backups', 'policies'),
    path.join(value.managedRoot, 'state', 'operator-backups', 'restore-transactions'),
    path.join(value.managedRoot, 'state', 'operator-backups', 'cleanup-transactions'),
  ].map((target) => path.resolve(target).toLowerCase());
  const storageVerificationBatches = guards.trace.directoryBatches.filter((directories) => {
    const normalized = new Set(directories.map((target) => path.resolve(target).toLowerCase()));
    return storageRoots.every((target) => normalized.has(target));
  });
  assert.equal(storageVerificationBatches.length, 1, 'one list flow must verify the shared storage roots once');
  assert.equal(guards.trace.active.size, 0);
});

test('batches sibling directory and file guards once per bounded tree set', async (t) => {
  const guards = batchGuardHarness();
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  assert.equal(guards.trace.active.size, 0);
  guards.trace.directoryBatches.length = 0;
  guards.trace.fileBatches.length = 0;
  guards.trace.directorySingles.length = 0;
  guards.trace.fileSingles.length = 0;
  guards.trace.released.length = 0;
  const sourceWorld = path.join(value.directory, 'world');
  for (const name of ['peer-a.dat', 'peer-b.dat', 'peer-c.dat']) {
    await fs.writeFile(path.join(sourceWorld, name), `sibling:${name}`);
  }

  const backup = await value.manager.create({ instanceId: value.id });
  const sourceWorldBatches = guards.trace.fileBatches.filter((files) => files.some(
    (file) => path.dirname(file) === sourceWorld && path.basename(file) === 'peer-a.dat',
  ));
  assert.equal(sourceWorldBatches.length, 3);
  for (const files of sourceWorldBatches) {
    assert.deepEqual(
      files.filter((file) => path.dirname(file) === sourceWorld).map((file) => path.basename(file)).filter((name) => name.startsWith('peer-')).sort(),
      ['peer-a.dat', 'peer-b.dat', 'peer-c.dat'],
    );
  }
  assert.equal(guards.trace.fileSingles.some((file) => path.dirname(file) === sourceWorld), false);
  assert.equal(guards.trace.directoryBatches.some((directories) => {
    const names = directories.filter((directory) => path.dirname(directory) === value.directory)
      .map((directory) => path.basename(directory));
    return ['config', 'mods', 'world'].every((name) => names.includes(name));
  }), true);
  const payloadWorld = path.join(
    value.managedRoot, 'operator-backups', 'snapshots', value.id, backup.backupId, 'payload', 'world',
  );
  assert.equal(await fs.readFile(path.join(payloadWorld, 'peer-b.dat'), 'utf8'), 'sibling:peer-b.dat');
  assert.equal(guards.trace.active.size, 0);
});

test('releases every acquired batch peer when one sibling guard fails', async (t) => {
  let failedBatchId = null;
  const guards = batchGuardHarness({
    onAssertHeld({ kind, target, batchId }) {
      if (!failedBatchId && kind === 'file' && path.basename(target) === 'peer-b.dat') {
        failedBatchId = batchId;
        throw Object.assign(new Error('simulated batch peer failure'), {
          code: 'BACKUP_SOURCE_CHANGED', statusCode: 409,
        });
      }
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  for (const name of ['peer-a.dat', 'peer-b.dat', 'peer-c.dat']) {
    await fs.writeFile(path.join(value.directory, 'world', name), `sibling:${name}`);
  }
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_SOURCE_CHANGED',
  );
  assert.ok(failedBatchId);
  const acquiredPeers = guards.trace.fileBatches.find((files) => files.some((file) => path.basename(file) === 'peer-b.dat'));
  assert.ok(acquiredPeers);
  assert.equal(guards.trace.released.filter((token) => token.includes(`:${failedBatchId}:`)).length, acquiredPeers.length);
  assert.equal(guards.trace.active.size, 0);
});

test('rejects a sibling file identity replacement during batch acquisition', async (t) => {
  let swapped = false;
  const guards = batchGuardHarness({
    async onBatch({ kind, targets }) {
      const victim = targets.find((target) => path.basename(target) === 'peer-b.dat');
      if (swapped || kind !== 'file' || !victim) return;
      swapped = true;
      await fs.rename(victim, `${victim}.original`);
      await fs.writeFile(victim, 'replacement-with-a-new-identity');
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  for (const name of ['peer-a.dat', 'peer-b.dat', 'peer-c.dat']) {
    await fs.writeFile(path.join(value.directory, 'world', name), `sibling:${name}`);
  }
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_SOURCE_CHANGED',
  );
  assert.equal(swapped, true);
  assert.equal(guards.trace.active.size, 0);
});

test('restore file batches obey the shared Windows protocol grouping and terminal order', async (t) => {
  const directories = batchGuardHarness();
  const protocol = fileBatchProtocolHarness();
  const value = await fixture(t, {
    directoryGuard: directories.directoryGuard,
    fileGuard: protocol.fileGuard,
    minimalFilesystem: true,
  });
  const backup = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'world-after-protocol-regression');
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  const restored = await value.manager.restore({
    instanceId: value.id,
    backupId: backup.backupId,
    planId: plan.planId,
  });

  assert.equal(restored.backupId, backup.backupId);
  assert.equal(await fs.readFile(path.join(value.directory, 'world', 'level.dat'), 'utf8'), 'world-before');
  assert.equal(protocol.trace.singleCalls.length, 0);
  assert.equal(protocol.trace.killed.length, 0);
  assert.equal(protocol.trace.spawnInvocations.length, protocol.trace.batches.length);
  assert.ok(protocol.trace.batches.length > 0);
  for (const batch of protocol.trace.batches) {
    assert.match(batch.command, /powershell\.exe$/i);
    assert.equal(batch.options.windowsHide, true);
    assert.deepEqual(batch.options.stdio, ['pipe', 'pipe', 'ignore']);
    assert.equal(batch.args.includes('-NoProfile'), true);
    assert.equal(batch.args.includes('-NonInteractive'), true);
    assert.match(batch.args.at(-1), /guard-minecraft-world-files\.ps1$/i);
    assert.equal(batch.closed, true);
    assert.equal(batch.exitCode, 0);
    assert.deepEqual(batch.requests[0], { command: 'acquire', paths: batch.paths });
    assert.ok(batch.paths.length >= 1 && batch.paths.length <= 128);
    assert.equal(new Set(batch.paths.map((target) => path.resolve(target).toLowerCase())).size, batch.paths.length);
    const terminal = batch.requests.slice(1);
    assert.equal(terminal.length, batch.paths.length);
    assert.deepEqual(
      terminal.map(({ id }) => id).sort((left, right) => left - right),
      batch.paths.map((_target, id) => id),
    );
  }

  const cleanupRename = protocol.trace.batches.find((batch) => {
    const names = batch.paths.map((target) => path.basename(target));
    const terminal = batch.requests.slice(1);
    return names.includes('level.dat') && names.includes('session.lock')
      && terminal.length === names.length && terminal.every(({ command }) => command === 'rename');
  });
  assert.ok(cleanupRename, 'restore cleanup must rename its held sibling files in one shared process');
  assert.deepEqual(cleanupRename.requests.slice(1).map(({ id }) => id), cleanupRename.paths.map((_target, id) => id));
  const cleanupDelete = protocol.trace.batches.find((batch) => batch.paths.length === cleanupRename.paths.length
    && batch.paths.every((target) => path.basename(target).startsWith('.clear-file-'))
    && batch.requests.slice(1).every(({ command }) => command === 'delete'));
  assert.ok(cleanupDelete, 'restore cleanup must reacquire and delete the exact tombstone sibling set');
  assert.equal(protocol.trace.batches.some((batch) => batch.requests.some(({ command }) => command === 'replace')), true);
  const terminalCounts = protocol.trace.batches.flatMap((batch) => batch.requests.slice(1))
    .reduce((counts, request) => ({ ...counts, [request.command]: (counts[request.command] ?? 0) + 1 }), {});
  t.diagnostic(`injected guard process estimate: directory batches=${directories.trace.directoryBatches.length}, directory singles=${directories.trace.directorySingles.length}, file batches=${protocol.trace.batches.length}, maximum file peers=${Math.max(...protocol.trace.batches.map(({ paths }) => paths.length))}; file terminals=${JSON.stringify(terminalCounts)}`);
});

test('non-reentrant handle model permits backup publication and verified restore without duplicate guards', async (t) => {
  const directories = new Set();
  const files = new Set();
  const normalized = (target) => path.resolve(target).toLocaleLowerCase('en-US');
  const directoryGuard = async (directory) => {
    const key = normalized(directory);
    assert.equal(directories.has(key), false, `duplicate directory guard: ${directory}`);
    directories.add(key);
    let held = true;
    const consume = () => { assert.equal(held, true); held = false; assert.equal(directories.delete(key), true); };
    return {
      assertHeld() { assert.equal(held, true); assert.equal(directories.has(key), true); },
      async release() { consume(); },
      async rename(destination) { assert.equal(held, true); await fs.rename(directory, destination); consume(); },
      async delete() { assert.equal(held, true); await fs.rmdir(directory); consume(); },
    };
  };
  const fileGuard = async (file) => {
    const key = normalized(file);
    assert.equal(files.has(key), false, `duplicate file guard: ${file}`);
    files.add(key);
    let held = true;
    const consume = () => { assert.equal(held, true); held = false; assert.equal(files.delete(key), true); };
    return {
      assertHeld() { assert.equal(held, true); assert.equal(files.has(key), true); },
      async release() { consume(); },
      async rename(destination) { assert.equal(held, true); await fs.rename(file, destination); consume(); },
      async replace(destination) { assert.equal(held, true); await fs.rename(file, destination); consume(); },
      async delete() { assert.equal(held, true); await fs.unlink(file); consume(); },
    };
  };
  const value = await fixture(t, { directoryGuard, fileGuard, minimalFilesystem: true });
  const backup = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'strict-model-after');
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  await value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId });
  assert.equal(await fs.readFile(path.join(value.directory, 'world', 'level.dat'), 'utf8'), 'world-before');
  assert.equal(directories.size, 0);
  assert.equal(files.size, 0);
});

test('keeps locked backup work inside one injected filesystem safety broker scope', async (t) => {
  const scoped = scopedBrokerHarness();
  let clock = Date.parse('2026-08-13T12:00:00.000Z');
  const value = await fixture(t, {
    filesystemSafetyBroker: scoped.broker,
    minimalFilesystem: true,
    now: () => new Date(clock++).toISOString(),
  });
  assert.equal(scoped.trace.outerOperations, 1, 'initialization must use one outer broker scope');
  assert.equal(scoped.trace.active.size, 0);

  let outerBefore = scoped.trace.outerOperations;
  let nestedBefore = scoped.trace.nestedOperations;
  const backup = await value.manager.create({ instanceId: value.id });
  assert.equal(scoped.trace.outerOperations - outerBefore, 2, 'preflight and locked create each own one outer scope');
  assert.ok(scoped.trace.nestedOperations > nestedBefore, 'locked lifecycle checks must reuse the create scope');
  assert.equal(scoped.trace.active.size, 0);

  outerBefore = scoped.trace.outerOperations;
  const listed = await value.manager.list({ instanceId: value.id });
  assert.equal(listed.backups.length, 1);
  assert.equal(scoped.trace.outerOperations - outerBefore, 1, 'locked listing must use one broker scope');
  assert.equal(scoped.trace.activePaths.size, 0);

  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'broker-snapshot-two');
  const retained = await value.manager.create({ instanceId: value.id });
  outerBefore = scoped.trace.outerOperations;
  await value.manager.purge({ instanceId: value.id, backupId: backup.backupId, confirmation: 'PURGE' });
  assert.equal(scoped.trace.outerOperations - outerBefore, 2, 'preflight and locked purge each own one outer scope');

  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'broker-scope-after');
  outerBefore = scoped.trace.outerOperations;
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: retained.backupId });
  assert.equal(scoped.trace.outerOperations - outerBefore, 2, 'preflight and locked planning each own one outer scope');

  outerBefore = scoped.trace.outerOperations;
  nestedBefore = scoped.trace.nestedOperations;
  await value.manager.restore({ instanceId: value.id, backupId: retained.backupId, planId: plan.planId });
  assert.equal(scoped.trace.outerOperations - outerBefore, 2, 'preflight and locked restore each own one outer scope');
  assert.ok(scoped.trace.nestedOperations > nestedBefore, 'restore lifecycle and rescue work must reuse the locked scope');

  outerBefore = scoped.trace.outerOperations;
  await value.manager.reconcileInterruptedTransactions();
  assert.equal(scoped.trace.outerOperations - outerBefore, 1, 'public recovery must retain one scope through nested work');
  assert.ok(scoped.trace.guardCalls > 0);
  assert.ok(scoped.trace.verifierCalls > 0);
  assert.equal(scoped.trace.active.size, 0);
  assert.equal(await fs.readFile(path.join(value.directory, 'world', 'level.dat'), 'utf8'), 'broker-snapshot-two');
});

test('preserves explicit guard and verifier injections when an operation broker is supplied', async (t) => {
  const scoped = scopedBrokerHarness();
  const guards = retainedGuardHarness();
  let verifierCalls = 0;
  const value = await fixture(t, {
    filesystemSafetyBroker: scoped.broker,
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    filesystemTreeVerifier: async () => {
      verifierCalls += 1;
      return { ok: true, checked: false };
    },
    minimalFilesystem: true,
  });
  await value.manager.create({ instanceId: value.id });
  assert.ok(verifierCalls > 0);
  assert.equal(scoped.trace.guardCalls, 0, 'explicit guards must override broker guard proxies');
  assert.equal(scoped.trace.verifierCalls, 0, 'an explicit verifier must override the broker proxy');
  assert.ok(scoped.trace.outerOperations > 0, 'the supplied broker must still own operation scope');
  assert.equal(scoped.trace.active.size, 0);
  assert.equal(guards.held.size, 0);
});

test('releases and exactly rebinds the owned publication parent around the held directory rename', async (t) => {
  const events = [];
  let publicationParent = null;
  const guards = retainedGuardHarness({
    onAcquire({ kind, target }) {
      if (kind === 'directory') events.push({ action: 'acquire', target: path.resolve(target) });
    },
    beforeRelease({ kind, target }) {
      if (kind === 'directory') events.push({ action: 'release', target: path.resolve(target) });
    },
    beforeRename({ kind, target, destination, count }) {
      if (kind !== 'directory' || !path.basename(target).startsWith('.staging-bkp-')
        || !/^bkp-[a-f0-9]{32}$/.test(path.basename(destination))) return;
      publicationParent = path.resolve(path.dirname(target));
      events.push({ action: 'rename', target: publicationParent });
      assert.equal(count(publicationParent), 0, 'the exact leaf must be released for the child-directory rename');
      assert.ok(count(path.dirname(publicationParent)) > 0, 'the exact ancestor chain must remain held');
      assert.equal(count(target), 1, 'the exact source directory must remain held during publication');
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  await value.manager.create({ instanceId: value.id });
  assert.ok(publicationParent);
  const renameIndex = events.findIndex(({ action, target }) => action === 'rename' && target === publicationParent);
  assert.ok(renameIndex > 0);
  assert.equal(events.slice(0, renameIndex).some(
    ({ action, target }) => action === 'release' && target === publicationParent,
  ), true);
  assert.equal(events.slice(renameIndex + 1).some(
    ({ action, target }) => action === 'acquire' && target === publicationParent,
  ), true, 'the exact original parent identity must be rebound after publication');
  assert.equal(guards.held.size, 0);
});

test('rebinds the publication parent and releases every peer when held directory rename fails', async (t) => {
  const events = [];
  let publicationParent = null;
  let injected = false;
  const guards = retainedGuardHarness({
    onAcquire({ kind, target }) {
      if (kind === 'directory') events.push({ action: 'acquire', target: path.resolve(target) });
    },
    beforeRelease({ kind, target }) {
      if (kind === 'directory') events.push({ action: 'release', target: path.resolve(target) });
    },
    beforeRename({ kind, target, destination, count }) {
      if (injected || kind !== 'directory' || !path.basename(target).startsWith('.staging-bkp-')
        || !/^bkp-[a-f0-9]{32}$/.test(path.basename(destination))) return;
      injected = true;
      publicationParent = path.resolve(path.dirname(target));
      events.push({ action: 'rename-failed', target: publicationParent });
      assert.equal(count(publicationParent), 0);
      assert.equal(count(target), 1);
      throw Object.assign(new Error('injected held-directory rename failure'), {
        code: 'BACKUP_SOURCE_CHANGED', statusCode: 409,
      });
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_SOURCE_CHANGED',
  );
  assert.equal(injected, true);
  const failureIndex = events.findIndex(({ action }) => action === 'rename-failed');
  assert.equal(events.slice(failureIndex + 1).some(
    ({ action, target }) => action === 'acquire' && target === publicationParent,
  ), true, 'the exact parent must be rebound even when directory publication fails');
  assert.deepEqual(
    (await fs.readdir(path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id))).sort(),
    [],
  );
  assert.equal(guards.held.size, 0);
});

test('rejects a same-name publication parent replacement while preserving the displaced tree', async (t) => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-publication-parent-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  let displacedParent = null;
  const guards = retainedGuardHarness({
    async beforeRename({ kind, target, destination, count }) {
      if (displacedParent || kind !== 'directory' || !path.basename(target).startsWith('.staging-bkp-')
        || !/^bkp-[a-f0-9]{32}$/.test(path.basename(destination))) return;
      const parent = path.dirname(target);
      assert.equal(count(parent), 0);
      displacedParent = path.join(outside, 'original-parent');
      await fs.rename(parent, displacedParent);
      await fs.mkdir(parent);
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_SOURCE_CHANGED',
  );
  assert.ok(displacedParent);
  const entries = await fs.readdir(displacedParent);
  const stagingName = entries.find((name) => name.startsWith('.staging-bkp-'));
  assert.ok(stagingName);
  assert.equal(
    await fs.readFile(path.join(displacedParent, stagingName, 'payload', 'world', 'level.dat'), 'utf8'),
    'world-before',
  );
  assert.deepEqual(await fs.readdir(path.join(
    value.managedRoot, 'operator-backups', 'snapshots', value.id,
  )), []);
  assert.equal(guards.held.size, 0);
});

test('releases and exactly rebinds an owned JSON parent around the held file replace', async (t) => {
  const events = [];
  let publicationParent = null;
  const guards = retainedGuardHarness({
    onAcquire({ kind, target }) {
      if (kind === 'directory') events.push({ action: 'acquire', target: path.resolve(target) });
    },
    beforeRelease({ kind, target }) {
      if (kind === 'directory') events.push({ action: 'release', target: path.resolve(target) });
    },
    beforeReplace({ kind, target, destination, count }) {
      if (kind !== 'file' || path.basename(destination) !== 'manifest.json'
        || !path.basename(path.dirname(destination)).startsWith('.staging-bkp-')) return;
      publicationParent = path.resolve(path.dirname(destination));
      events.push({ action: 'replace', target: publicationParent });
      assert.equal(count(publicationParent), 0, 'the exact leaf must be released for the child-file replace');
      assert.ok(count(path.dirname(publicationParent)) > 0, 'the exact ancestor chain must remain held');
      assert.ok(count(target) > 0, 'the exact temporary file must remain held during replace');
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  await value.manager.create({ instanceId: value.id });
  assert.ok(publicationParent);
  const replaceIndex = events.findIndex(({ action, target }) => action === 'replace' && target === publicationParent);
  assert.ok(replaceIndex > 0);
  assert.equal(events.slice(0, replaceIndex).some(
    ({ action, target }) => action === 'release' && target === publicationParent,
  ), true);
  assert.equal(events.slice(replaceIndex + 1).some(
    ({ action, target }) => action === 'acquire' && target === publicationParent,
  ), true, 'the exact original leaf identity must be rebound after publication');
  assert.equal(guards.held.size, 0);
});

test('rebinds the JSON parent and releases every peer when held file replace fails', async (t) => {
  const events = [];
  let failedTemporary = null;
  let publicationParent = null;
  let deletedWithOriginalGuard = false;
  const guards = retainedGuardHarness({
    onAcquire({ kind, target }) {
      events.push({ action: 'acquire', kind, target: path.resolve(target) });
    },
    beforeRelease({ kind, target }) {
      events.push({ action: 'release', kind, target: path.resolve(target) });
    },
    beforeReplace({ kind, target, destination, count }) {
      if (failedTemporary || kind !== 'file' || path.basename(destination) !== 'manifest.json'
        || !path.basename(path.dirname(destination)).startsWith('.staging-bkp-')) return;
      failedTemporary = path.resolve(target);
      publicationParent = path.resolve(path.dirname(destination));
      events.push({ action: 'replace-failed', kind, target: publicationParent });
      assert.equal(count(publicationParent), 0);
      throw Object.assign(new Error('injected held-file replace failure'), {
        code: 'BACKUP_SOURCE_CHANGED', statusCode: 409,
      });
    },
    beforeDelete({ kind, target, count }) {
      if (kind === 'file' && failedTemporary && path.resolve(target) === failedTemporary) {
        deletedWithOriginalGuard = true;
        assert.equal(count(target), 1, 'cleanup must reuse the exact still-held temporary-file guard');
      }
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_SOURCE_CHANGED',
  );
  assert.ok(failedTemporary && publicationParent);
  const failureIndex = events.findIndex(({ action }) => action === 'replace-failed');
  assert.equal(events.slice(failureIndex + 1).some(
    ({ action, kind, target }) => action === 'acquire' && kind === 'directory' && target === publicationParent,
  ), true, 'the leaf must be rebound even when child replacement fails');
  assert.equal(events.filter(
    ({ action, kind, target }) => action === 'acquire' && kind === 'file' && target === failedTemporary,
  ).length, 1, 'failure cleanup must not acquire a duplicate temporary-file peer');
  assert.equal(deletedWithOriginalGuard, true);
  assert.deepEqual(
    (await fs.readdir(path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id))).sort(),
    [],
  );
  assert.equal(guards.held.size, 0);
});

test('rejects an unexpected JSON parent namespace peer after leaf rebinding', async (t) => {
  let injectedPeer = null;
  const guards = retainedGuardHarness({
    async beforeReplace({ kind, destination, count }) {
      if (injectedPeer || kind !== 'file' || path.basename(destination) !== 'manifest.json'
        || !path.basename(path.dirname(destination)).startsWith('.staging-bkp-')) return;
      const parent = path.dirname(destination);
      assert.equal(count(parent), 0);
      injectedPeer = path.join(parent, 'unexpected-publication-peer');
      await fs.writeFile(injectedPeer, 'untrusted peer');
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_SOURCE_CHANGED',
  );
  assert.ok(injectedPeer);
  assert.deepEqual(
    (await fs.readdir(path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id))).sort(),
    [],
  );
  assert.equal(guards.held.size, 0);
});

test('rejects a same-name JSON parent peer identity replacement after leaf rebinding', async (t) => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-json-peer-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  let displacedPayload = null;
  const guards = retainedGuardHarness({
    async beforeReplace({ kind, destination, count }) {
      if (displacedPayload || kind !== 'file' || path.basename(destination) !== 'manifest.json'
        || !path.basename(path.dirname(destination)).startsWith('.staging-bkp-')) return;
      const parent = path.dirname(destination);
      assert.equal(count(parent), 0);
      const payload = path.join(parent, 'payload');
      displacedPayload = path.join(outside, 'original-payload');
      await fs.rename(payload, displacedPayload);
      await fs.mkdir(payload);
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_SOURCE_CHANGED',
  );
  assert.ok(displacedPayload);
  assert.equal(await fs.readFile(path.join(displacedPayload, 'world', 'level.dat'), 'utf8'), 'world-before');
  assert.deepEqual(
    (await fs.readdir(path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id))).sort(),
    [],
  );
  assert.equal(guards.held.size, 0);
});

test('holds the exact deterministic tombstone root throughout recursive enumeration and deletion', async (t) => {
  let observedTombstone = false;
  let observedProtectionLease = false;
  let clock = Date.parse('2026-08-13T12:00:00.000Z');
  const guards = retainedGuardHarness({
    beforeRename({ kind, target, destination, count }) {
      if (kind !== 'directory' || !/^bkp-[a-f0-9]{32}$/.test(path.basename(target))
        || !path.basename(destination).startsWith('.cleanup-cln-')) return;
      const transactionRoot = path.resolve(
        target, '..', '..', '..', '..', 'state', 'operator-backups', 'restore-transactions',
      );
      observedProtectionLease = true;
      assert.ok(count(transactionRoot) > 0, 'authenticated restore protection must remain leased through tombstoning');
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
    filesystemTreeVerifier: async (target) => {
      if (path.basename(target).startsWith('.cleanup-cln-')) {
        observedTombstone = true;
        assert.ok(guards.count(target) > 0, 'the exact tombstone root must be held before enumeration');
      }
      return { ok: true, checked: false };
    },
    now: () => new Date(clock++).toISOString(),
  });
  const first = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'second-world');
  await value.manager.create({ instanceId: value.id });
  await value.manager.purge({ instanceId: value.id, backupId: first.backupId, confirmation: 'PURGE' });
  assert.equal(observedTombstone, true);
  assert.equal(observedProtectionLease, true);
  assert.equal(guards.held.size, 0);
});

test('holds the exact restore candidate root across mutable-tree enumeration', async (t) => {
  const guards = retainedGuardHarness();
  const candidateChecks = [];
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
    filesystemTreeVerifier: async (target) => {
      if (/\.candidate$/.test(path.basename(target))) candidateChecks.push(guards.count(target) > 0);
      return { ok: true, checked: false };
    },
  });
  const backup = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'changed-before-root-guard-test');
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  await value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId });
  const unguardedBindingProbe = candidateChecks.indexOf(false);
  assert.ok(unguardedBindingProbe >= 0, 'the pre-binding identity probe must be observed');
  assert.deepEqual(candidateChecks.slice(unguardedBindingProbe + 1, unguardedBindingProbe + 3), [true, true]);
  assert.equal(guards.held.size, 0);
});

test('native backup broker skips disabled scheduling and lists an empty inventory cleanly', {
  skip: process.platform !== 'win32' || process.env.MASTERMIND_NATIVE_BACKUP_TEST !== '1',
  timeout: 120_000,
}, async (t) => {
  const { broker, records } = nativeBrokerRecorder();
  const value = await fixture(t, {
    filesystemSafetyBroker: broker,
    minimalFilesystem: true,
  });

  assert.deepEqual(await value.manager.runDueBackups(), []);
  const listed = await value.manager.list({ instanceId: value.id });
  assert.deepEqual(listed.policy, { enabled: false, intervalHours: 24, retentionCount: 7 });
  assert.deepEqual(listed.backups, []);

  const evidence = nativeBrokerEvidence(records);
  assert.ok(evidence.length > 0);
  assert.equal(evidence.every(({ closeAck, closeCode, aliveAfterClose }) => (
    closeAck && closeCode === 0 && !aliveAfterClose
  )), true);
});

test('persistent native backup broker publishes and restores with zero surviving helper PIDs', {
  skip: process.platform !== 'win32' || process.env.MASTERMIND_NATIVE_BACKUP_TEST !== '1',
  timeout: 900_000,
}, async (t) => {
  const { broker, records } = nativeBrokerRecorder();
  try {
    const value = await fixture(t, {
      filesystemSafetyBroker: broker,
      minimalFilesystem: true,
    });
    const backup = await value.manager.create({ instanceId: value.id });
    const listed = await value.manager.list({ instanceId: value.id });
    assert.equal(listed.backups.some(({ backupId }) => backupId === backup.backupId), true);
    await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'native-world-after');
    const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
    const restored = await value.manager.restore({
      instanceId: value.id, backupId: backup.backupId, planId: plan.planId,
    });
    assert.equal(restored.backupId, backup.backupId);
    assert.equal(restored.stackPreserved, true);
    assert.equal(await fs.readFile(path.join(value.directory, 'world', 'level.dat'), 'utf8'), 'world-before');
    assert.equal(value.manager.recoveryStatus().manualRecoveryRequired, 0);

    assert.ok(records.length >= 3 && records.length <= 24, `unexpected persistent helper bound: ${records.length}`);
    for (const record of records) {
      assert.equal(record.inputBuffer, '');
      assert.equal(record.outputBuffer, '');
      assert.equal(record.closeCode, 0);
      assert.equal(record.closeSignal, null);
      assert.equal(record.child.exitCode, 0);
      assert.equal(record.child.signalCode, null);
      assert.deepEqual(record.events.slice(-2), ['close-ack', 'process-close']);
      const closeRequests = record.requests.filter(({ command }) => command === 'close');
      const closeReplies = record.responses.filter(({ command }) => command === 'close');
      assert.equal(closeRequests.length, 1);
      assert.equal(closeReplies.length, 1);
      assert.deepEqual(Object.keys(closeReplies[0]).sort(), ['cohortId', 'command', 'ok', 'requestId']);
      assert.deepEqual(closeReplies[0], {
        ok: true,
        command: 'close',
        requestId: closeRequests[0].requestId,
        cohortId: closeRequests[0].cohortId,
      });
    }
    const evidence = nativeBrokerEvidence(records);
    assert.deepEqual([...new Set(evidence.map(({ kind }) => kind))].sort(), ['directory', 'file', 'verifier']);
    assert.ok(evidence.filter(({ kind }) => kind === 'directory').some(({ cohorts }) => cohorts > 1));
    assert.ok(evidence.filter(({ kind }) => kind === 'file').some(({ cohorts }) => cohorts > 1));
    assert.ok(evidence.filter(({ kind }) => kind === 'verifier').some(({ cohorts }) => cohorts > 1));
    assert.equal(evidence.every(({ cohorts, uniqueCohorts }) => cohorts === uniqueCohorts), true);
    assert.equal(evidence.filter(({ kind }) => kind !== 'verifier').every(
      ({ acquiredCapabilities, terminalCapabilities }) => acquiredCapabilities === terminalCapabilities,
    ), true, 'every acquired native capability must receive one terminal command before close');
    assert.equal(evidence.every(({ closeAck, closeCode, aliveAfterClose }) => closeAck && closeCode === 0 && !aliveAfterClose), true);
    t.diagnostic(`native persistent backup evidence: ${JSON.stringify(evidence)}`);
  } catch (error) {
    const evidence = nativeBrokerEvidence(records);
    const survivors = evidence.filter(({ aliveAfterClose }) => aliveAfterClose).map(({ pid }) => pid);
    const recent = records.slice(-8).map((record) => ({
      kind: record.kind,
      pid: record.pid,
      requests: record.requests.slice(-8),
      responses: record.responses.slice(-8),
      events: record.events,
      closeCode: record.closeCode,
      closeSignal: record.closeSignal,
    }));
    t.diagnostic(`native persistent backup failure evidence: ${JSON.stringify(evidence)}`);
    t.diagnostic(`native persistent backup surviving PIDs: ${survivors.join(',') || 'none'}`);
    error.message = `${error.message}\nNative broker evidence: ${JSON.stringify(evidence)}\nNative broker survivors: ${JSON.stringify(survivors)}\nRecent broker protocol: ${JSON.stringify(recent)}`;
    throw error;
  }
});

test('initialization fails closed until both world integration callbacks are installed', async (t) => {
  const notInitialized = await fixture(t, { skipInitialize: true });
  await assert.rejects(
    () => notInitialized.manager.create({ instanceId: notInitialized.id }),
    (error) => error.code === 'BACKUP_UNAVAILABLE',
  );
  const missingInterlock = await fixture(t, { skipInitialize: true, omitWorldInterlock: true });
  await assert.rejects(
    () => missingInterlock.manager.initialize(),
    (error) => error.code === 'BACKUP_UNAVAILABLE',
  );
  const missingValidator = await fixture(t, { skipInitialize: true, omitWorldRestoreValidator: true });
  await assert.rejects(
    () => missingValidator.manager.initialize(),
    (error) => error.code === 'BACKUP_WORLD_VALIDATOR_UNAVAILABLE',
  );
});

test('initializes an empty partial backup bootstrap without inventing recovery evidence', async (t) => {
  const guards = batchGuardHarness();
  const value = await fixture(t, {
    skipInitialize: true,
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
  });
  await fs.mkdir(path.join(value.managedRoot, 'operator-backups', 'snapshots'), { recursive: true });
  await fs.mkdir(path.join(value.managedRoot, 'state', 'operator-backups', 'policies'), { recursive: true });
  await fs.mkdir(path.join(
    value.managedRoot, 'state', 'operator-backups', 'restore-transactions',
  ), { recursive: true });

  assert.deepEqual(await value.manager.initialize(), []);
  assert.equal((await fs.lstat(path.join(
    value.managedRoot, 'state', 'operator-backups', 'cleanup-transactions',
  ))).isDirectory(), true);
  assert.equal((await fs.lstat(path.join(
    value.managedRoot, 'state', 'operator-backups', 'hmac.key',
  ))).size, 32);
  assert.deepEqual(value.manager.recoveryStatus(), {
    manualRecoveryRequired: 0, global: false, instanceIds: [],
  });
  assert.equal(guards.trace.active.size, 0);
});

test('does not become initialized when the filesystem safety close proof fails', async (t) => {
  const guards = batchGuardHarness();
  let failClose = true;
  const broker = {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    filesystemTreeVerifier: async () => ({ ok: true, checked: false }),
    async runOperation(operation) {
      const result = await operation();
      if (failClose) {
        failClose = false;
        throw Object.assign(new Error('simulated exact-close failure'), {
          code: 'WORLD_INTEGRITY_FAILED', statusCode: 409,
        });
      }
      return result;
    },
  };
  const value = await fixture(t, { skipInitialize: true, filesystemSafetyBroker: broker });
  await assert.rejects(
    () => value.manager.initialize(),
    (error) => error.code === 'BACKUP_STORAGE_FAILED'
      && error.backupInitializationStage === 'filesystem-safety-close'
      && Object.keys(error).includes('backupInitializationStage') === false,
  );
  await assert.rejects(
    () => value.manager.assertSafeForLifecycle({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_UNAVAILABLE',
  );
  assert.equal(guards.trace.active.size, 0);
});

test('recovery preflight is strictly read-only when backup state has never been initialized', async (t) => {
  const value = await fixture(t, { skipInitialize: true });
  const stateRoot = path.join(value.managedRoot, 'state', 'operator-backups');
  await assert.rejects(() => fs.lstat(stateRoot), (error) => error.code === 'ENOENT');
  assert.deepEqual(await value.manager.preflightRecoveryEvidence(), { domain: 'backup', instances: [] });
  await assert.rejects(() => fs.lstat(stateRoot), (error) => error.code === 'ENOENT');
});

test('batches authenticated recovery marker reads and rechecks with exact file guards', async (t) => {
  const guards = batchGuardHarness();
  const value = await fixture(t, { directoryGuard: guards.directoryGuard, fileGuard: guards.fileGuard });
  const transactionId = `rtx-${'7'.repeat(32)}`;
  const backupId = `bkp-${'8'.repeat(32)}`;
  const rescueBackupId = `bkp-${'9'.repeat(32)}`;
  const createdAt = '2026-08-13T12:00:00.000Z';
  await writeRestoreMarker(value, transactionId, {
    schemaVersion: 1,
    transactionId,
    instanceId: value.id,
    backupId,
    rescueBackupId,
    phase: 'rescue-ready',
    createdAt,
    updatedAt: createdAt,
    expectedTree: { algorithm: 'sha256', digest: '1'.repeat(64), files: 1, bytes: 1, entries: [] },
    stackDigest: '2'.repeat(64),
    worldStackBinding: { generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64) },
    originalTreeDigest: '3'.repeat(64),
    originalLastRestore: null,
    targetLastRestore: { backupId, rescueBackupId, restoredAt: createdAt, state: 'verified' },
  });
  const markerFile = path.join(
    value.managedRoot, 'state', 'operator-backups', 'restore-transactions', `${transactionId}.json`,
  );
  guards.trace.fileBatches.length = 0;
  assert.deepEqual(await value.manager.preflightRecoveryEvidence(), {
    domain: 'backup', instances: [{ instanceId: value.id, transactionRef: transactionId }],
  });
  assert.equal(guards.trace.fileBatches.some((files) => files.length === 1 && files[0] === markerFile), true);

  const tampered = JSON.parse(await fs.readFile(markerFile, 'utf8'));
  tampered.mac = '0'.repeat(64);
  await fs.writeFile(markerFile, `${JSON.stringify(tampered, null, 2)}\n`);
  await value.manager.reconcileInterruptedTransactions();
  assert.equal(value.manager.recoveryStatus().global, true);
  assert.equal(guards.trace.active.size, 0);
});

test('binds a newly created authentication key to the exact guarded file identity', async (t) => {
  let keyGuardCalls = 0;
  const value = await fixture(t, {
    skipInitialize: true,
    fileGuard: async (file) => {
      if (path.basename(file) === 'hmac.key' && keyGuardCalls++ === 0) {
        const replacement = `${file}.replacement`;
        await fs.writeFile(replacement, Buffer.alloc(32, 9), { flag: 'wx' });
        await fs.rename(file, `${file}.original`);
        await fs.rename(replacement, file);
      }
      return {
        assertHeld() {},
        async delete() { await fs.unlink(file); },
        async rename(destination) { await fs.rename(file, destination); },
        async replace(destination) { await fs.rename(file, destination); },
        async release() {},
      };
    },
  });
  await assert.rejects(() => value.manager.initialize(), (error) => error.code === 'BACKUP_UNAVAILABLE');
});

for (const mutation of ['delete', 'replace']) {
  test(`post-initialization backup key ${mutation} fences lifecycle and snapshot creation`, async (t) => {
    const value = await fixture(t);
    const key = path.join(value.managedRoot, 'state', 'operator-backups', 'hmac.key');
    if (mutation === 'delete') await fs.rm(key);
    else await fs.writeFile(key, Buffer.alloc(32, 23));
    await assert.rejects(
      () => value.manager.assertSafeForLifecycle({ instanceId: value.id }),
      (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
    );
    await assert.rejects(
      () => value.manager.create({ instanceId: value.id }),
      (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
    );
    assert.deepEqual(await fs.readdir(path.join(value.managedRoot, 'operator-backups', 'snapshots')), []);
  });
}

test('rejects a backup root swapped to a directory junction after initialization', { skip: process.platform !== 'win32' }, async (t) => {
  const value = await fixture(t);
  const operatorRoot = path.join(value.managedRoot, 'operator-backups');
  const displaced = path.join(value.managedRoot, 'operator-backups-real');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-backups-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.rename(operatorRoot, displaced);
  await fs.symlink(outside, operatorRoot, 'junction');
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_UNSAFE_FILESYSTEM',
  );
  assert.deepEqual(await fs.readdir(outside), []);
});

test('rejects a backup state root swapped to a directory junction after initialization', { skip: process.platform !== 'win32' }, async (t) => {
  const value = await fixture(t);
  const stateRoot = path.join(value.managedRoot, 'state', 'operator-backups');
  const displaced = path.join(value.managedRoot, 'state', 'operator-backups-real');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-backup-state-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.rename(stateRoot, displaced);
  await fs.symlink(outside, stateRoot, 'junction');
  await assert.rejects(
    () => value.manager.setPolicy({ instanceId: value.id, enabled: true, intervalHours: 24, retentionCount: 7 }),
    (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  );
  assert.deepEqual(await fs.readdir(outside), []);
});

test('uses the complete private inventory for retention even when more than 100 backups exist', async (t) => {
  let clock = Date.parse('2026-08-13T12:00:00.000Z');
  const value = await fixture(t, { now: () => new Date(clock++).toISOString() });
  await value.manager.setPolicy({ instanceId: value.id, enabled: false, intervalHours: 24, retentionCount: 3 });
  const root = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id);
  await fs.mkdir(root, { recursive: true });
  for (let index = 0; index < 105; index += 1) {
    const backupId = `bkp-${index.toString(16).padStart(32, '0')}`;
    const directory = path.join(root, backupId);
    await fs.mkdir(path.join(directory, 'payload'), { recursive: true });
    const createdAt = new Date(Date.parse('2026-08-13T00:00:00.000Z') + index * 1000).toISOString();
    const emptyTree = { algorithm: 'sha256', digest: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', files: 0, bytes: 0, entries: [] };
    await fs.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify({
      schemaVersion: 1, policyVersion: 1, backupId, instanceId: value.id, kind: 'automatic', createdAt,
      minecraftVersion: '26.2', levelName: 'world', stackDigest: 'a'.repeat(64),
      worldStackBinding: { generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64) }, tree: emptyTree,
      integrity: 'verified', verifiedAt: createdAt,
    })}\n`);
  }
  const visible = await value.manager.list({ instanceId: value.id });
  assert.equal(visible.backups.length, 100);
  await value.manager.verify({ instanceId: value.id, backupId: `bkp-${'0'.repeat(32)}` });
  const retained = await value.manager.create({ instanceId: value.id });
  assert.deepEqual(retained.retention, { state: 'applied' });
  const remainingAutomatic = (await fs.readdir(root)).filter((name) => /^bkp-/.test(name));
  assert.ok(remainingAutomatic.length <= 4, `retention must inspect and purge beyond the public first page (remaining=${remainingAutomatic.length})`);
});

test('fresh verification detects payload tampering and records failed integrity', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  const file = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id, backup.backupId, 'payload', 'world', 'level.dat');
  await fs.writeFile(file, 'tampered-world');
  await assert.rejects(() => value.manager.verify({ instanceId: value.id, backupId: backup.backupId }), (error) => error.code === 'BACKUP_INTEGRITY_FAILED');
  const listed = await value.manager.list({ instanceId: value.id });
  assert.equal(listed.backups[0].integrity, 'failed');
  assert.equal(listed.backups[0].verifiedAt, null);
  assert.equal(listed.backups[0].restorable, false);
});

for (const timing of ['before', 'after']) {
  test(`re-verifies a published snapshot after ${timing}-move child substitution`, async (t) => {
    const value = await fixture(t, {
      directoryGuard: async (directory) => ({
        assertHeld() {},
        async release() {},
        async delete() { await fs.rmdir(directory); },
        async rename(destination) {
          const publishesStaging = path.basename(directory).startsWith('.staging-bkp-')
            && /^bkp-[a-f0-9]{32}$/.test(path.basename(destination));
          if (publishesStaging && timing === 'before') {
            await fs.writeFile(path.join(directory, 'payload', 'world', 'level.dat'), 'substituted-before-publication');
          }
          await fs.rename(directory, destination);
          if (publishesStaging && timing === 'after') {
            await fs.writeFile(path.join(destination, 'payload', 'world', 'level.dat'), 'substituted-after-publication');
          }
        },
      }),
    });
    await assert.rejects(
      () => value.manager.create({ instanceId: value.id }),
      (error) => error.code === 'BACKUP_INTEGRITY_FAILED',
    );
    const snapshotRoot = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id);
    assert.equal((await fs.readdir(snapshotRoot)).some((name) => /^bkp-/.test(name)), false);
    const cleanupRoot = path.join(value.managedRoot, 'state', 'operator-backups', 'cleanup-transactions');
    assert.deepEqual(await fs.readdir(cleanupRoot), []);
  });
}

test('never cleans an unowned generated destination after a terminal publication collision', async (t) => {
  let injectedDestination = null;
  const value = await fixture(t, {
    directoryGuard: async (directory) => ({
      assertHeld() {},
      async release() {},
      async delete() { await fs.rmdir(directory); },
      async rename(destination) {
        if (!injectedDestination && path.basename(directory).startsWith('.staging-bkp-')
          && /^bkp-[a-f0-9]{32}$/.test(path.basename(destination))) {
          injectedDestination = destination;
          await fs.mkdir(destination);
          await fs.writeFile(path.join(destination, 'outside-victim.txt'), 'must-survive');
        }
        await fs.rename(directory, destination);
      },
    }),
  });
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => ['BACKUP_STORAGE_FAILED', 'BACKUP_ID_COLLISION'].includes(error.code),
  );
  assert.ok(injectedDestination);
  assert.equal(await fs.readFile(path.join(injectedDestination, 'outside-victim.txt'), 'utf8'), 'must-survive');
  assert.deepEqual(await fs.readdir(path.join(
    value.managedRoot, 'state', 'operator-backups', 'cleanup-transactions',
  )), []);
});

test('never cleans a substituted staging directory whose created identity was lost', async (t) => {
  let substituted = null;
  const value = await fixture(t, {
    directoryGuard: async (directory) => {
      if (!substituted && path.basename(directory).startsWith('.staging-bkp-')) {
        substituted = directory;
        await fs.rename(directory, `${directory}.owned-original`);
        await fs.mkdir(directory);
        await fs.writeFile(path.join(directory, 'outside-victim.txt'), 'must-survive');
      }
      return {
        assertHeld() {},
        async release() {},
        async delete() { await fs.rmdir(directory); },
        async rename(destination) { await fs.rename(directory, destination); },
      };
    },
  });
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  );
  assert.ok(substituted);
  assert.equal(await fs.readFile(path.join(substituted, 'outside-victim.txt'), 'utf8'), 'must-survive');
  assert.equal(value.manager.recoveryStatus().manualRecoveryRequired, 1);
  const cleanupRoot = path.join(value.managedRoot, 'state', 'operator-backups', 'cleanup-transactions');
  assert.equal((await fs.readdir(cleanupRoot)).length, 1);
  const restarted = await value.recreateManager();
  assert.equal(restarted.recoveryStatus().manualRecoveryRequired, 1);
  assert.equal(await fs.readFile(path.join(substituted, 'outside-victim.txt'), 'utf8'), 'must-survive');
});

test('a corrupt newest snapshot cannot cause the older verified survivor to be purged', async (t) => {
  let clock = Date.parse('2026-08-13T12:00:00.000Z');
  const value = await fixture(t, { now: () => new Date(clock++).toISOString() });
  const older = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'newest-world');
  const newest = await value.manager.create({ instanceId: value.id });
  const newestPayload = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id, newest.backupId, 'payload', 'world', 'level.dat');
  await fs.writeFile(newestPayload, 'corrupt-newest-world');
  await assert.rejects(
    () => value.manager.purge({ instanceId: value.id, backupId: older.backupId, confirmation: 'PURGE' }),
    (error) => error.code === 'BACKUP_PROTECTED',
  );
  assert.equal(await fs.readFile(path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id, older.backupId, 'payload', 'world', 'level.dat'), 'utf8'), 'world-before');
  const listed = await value.manager.list({ instanceId: value.id });
  assert.equal(listed.backups.find((item) => item.backupId === newest.backupId).integrity, 'failed');
});

test('retention counts freshly verified-good automatic snapshots and corrupt snapshots consume no slots', async (t) => {
  let clock = Date.parse('2026-08-13T12:00:00.000Z');
  const value = await fixture(t, { now: () => new Date(clock).toISOString() });
  await value.manager.setPolicy({ instanceId: value.id, enabled: true, intervalHours: 6, retentionCount: 3 });
  const created = [];
  for (let index = 0; index < 3; index += 1) {
    created.push((await value.manager.runDueBackups())[0].backupId);
    clock += 6 * 60 * 60 * 1000;
  }
  const corruptPayload = path.join(
    value.managedRoot, 'operator-backups', 'snapshots', value.id, created[2], 'payload', 'world', 'level.dat',
  );
  await fs.writeFile(corruptPayload, 'corrupt-automatic');
  for (let index = 0; index < 2; index += 1) {
    assert.equal((await value.manager.runDueBackups())[0].action, 'created');
    clock += 6 * 60 * 60 * 1000;
  }
  const listed = await value.manager.list({ instanceId: value.id });
  const automatic = listed.backups.filter((item) => item.kind === 'automatic');
  assert.equal(automatic.filter((item) => item.integrity === 'verified').length, 3);
  assert.equal(automatic.filter((item) => item.integrity === 'failed').length, 1);
});

test('explicit confirmation can structurally purge a corrupt unreferenced snapshot', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  const directory = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id, backup.backupId);
  await fs.writeFile(path.join(directory, 'payload', 'world', 'level.dat'), 'corrupt-before-confirmed-purge');
  const purged = await value.manager.purge({ instanceId: value.id, backupId: backup.backupId, confirmation: 'PURGE' });
  assert.equal(purged.backupId, backup.backupId);
  await assert.rejects(() => fs.lstat(directory), (error) => error.code === 'ENOENT');
});

test('retains the exact authentication-key lease through the irreversible snapshot tombstone', async (t) => {
  let keyFile = null;
  let protectedRenameObserved = false;
  const guards = retainedGuardHarness({
    beforeRename: async ({ kind, target, destination, count }) => {
      if (kind !== 'directory' || !/^bkp-[a-f0-9]{32}$/.test(path.basename(target))
        || !/^\.cleanup-cln-[a-f0-9]{32}$/.test(path.basename(destination))) return;
      assert.ok(keyFile);
      assert.equal(count(keyFile), 1, 'the exact HMAC key guard must remain held through tombstoning');
      protectedRenameObserved = true;
    },
  });
  const value = await fixture(t, { directoryGuard: guards.directoryGuard, fileGuard: guards.fileGuard });
  keyFile = path.join(value.managedRoot, 'state', 'operator-backups', 'hmac.key');
  const backup = await value.manager.create({ instanceId: value.id });
  const directory = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id, backup.backupId);
  await fs.writeFile(path.join(directory, 'payload', 'world', 'level.dat'), 'corrupt-before-key-leased-purge');
  await value.manager.purge({ instanceId: value.id, backupId: backup.backupId, confirmation: 'PURGE' });
  assert.equal(protectedRenameObserved, true);
  assert.equal(guards.held.size, 0);
});

test('an unauthenticated restore marker fences retention protection before deletion', async (t) => {
  let clock = Date.parse('2026-08-13T12:00:00.000Z');
  const value = await fixture(t, { now: () => new Date(clock++).toISOString() });
  const first = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'second-world');
  await value.manager.create({ instanceId: value.id });
  const transactionId = `rtx-${'e'.repeat(32)}`;
  const markerFile = path.join(
    value.managedRoot, 'state', 'operator-backups', 'restore-transactions', `${transactionId}.json`,
  );
  await fs.writeFile(markerFile, `${JSON.stringify({
    schemaVersion: 1, transactionId, instanceId: value.id,
    backupId: first.backupId, rescueBackupId: `bkp-${'f'.repeat(32)}`,
    phase: 'rescue-ready', createdAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:00.000Z',
    expectedTree: { algorithm: 'sha256', digest: 'a'.repeat(64), files: 1, bytes: 1, entries: [] },
    stackDigest: 'b'.repeat(64), worldStackBinding: { generation: 'c'.repeat(64), inventoryDigest: 'd'.repeat(64) },
    originalTreeDigest: 'e'.repeat(64), originalLastRestore: null,
    targetLastRestore: {
      backupId: first.backupId, rescueBackupId: `bkp-${'f'.repeat(32)}`,
      restoredAt: '2026-08-13T12:00:00.000Z', state: 'verified',
    },
    mac: '0'.repeat(64),
  }, null, 2)}\n`);
  await assert.rejects(
    () => value.manager.purge({ instanceId: value.id, backupId: first.backupId, confirmation: 'PURGE' }),
    (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  );
  assert.equal(value.manager.recoveryStatus().global, true);
  assert.equal(await fs.readFile(path.join(
    value.managedRoot, 'operator-backups', 'snapshots', value.id, first.backupId, 'payload', 'world', 'level.dat',
  ), 'utf8'), 'world-before');
});

test('rejects an oversized serialized manifest before publishing a snapshot', async (t) => {
  const value = await fixture(t, { maxManifestBytes: 256 });
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_LIMIT_EXCEEDED',
  );
  const snapshotRoot = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id);
  assert.equal((await fs.readdir(snapshotRoot)).some((name) => /^bkp-/.test(name)), false);
  assert.deepEqual(await fs.readdir(path.join(
    value.managedRoot, 'state', 'operator-backups', 'cleanup-transactions',
  )), []);
});

test('bounds total snapshot inventory before allocating another publication', async (t) => {
  const value = await fixture(t, { maxSnapshots: 2 });
  await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'second-bounded-world');
  await value.manager.create({ instanceId: value.id });
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_LIMIT_EXCEEDED',
  );
  const root = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id);
  assert.equal((await fs.readdir(root)).filter((name) => /^bkp-/.test(name)).length, 2);
});

test('bounds live restore approval plans per instance without evicting unexpired approvals', async (t) => {
  const value = await fixture(t, { maxRestorePlans: 4, maxRestorePlansPerInstance: 2 });
  const backup = await value.manager.create({ instanceId: value.id });
  const first = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  const second = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  assert.notEqual(first.planId, second.planId);
  await assert.rejects(
    () => value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId }),
    (error) => error.code === 'BACKUP_LIMIT_EXCEEDED',
  );
});

test('rejects nested or open-ended manifest tree records before identity canonicalization', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  const manifestFile = path.join(
    value.managedRoot, 'operator-backups', 'snapshots', value.id, backup.backupId, 'manifest.json',
  );
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  manifest.tree.entries[0] = ['directory', manifest.tree.entries[0][1], { nested: ['untrusted'] }];
  manifest.unexpected = { recursively: { nested: true } };
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  await assert.rejects(
    () => value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId }),
    (error) => error.code === 'BACKUP_MANIFEST_INVALID',
  );
});

test('authenticated interrupted cleanup tombstones survive reboot and fence retries without deleting payloads', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  const root = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id);
  const cleanupId = `cln-${crypto.createHash('sha256').update(canonicalJson({
    schemaVersion: 1, namespace: 'snapshot', instanceId: value.id, targetName: backup.backupId,
  })).digest('hex').slice(0, 32)}`;
  const target = path.join(root, backup.backupId);
  const tombstoneName = `.cleanup-${cleanupId}`;
  const tombstone = path.join(root, tombstoneName);
  await fs.rename(target, tombstone);
  await writeCleanupMarker(value, {
    schemaVersion: 1, cleanupId, instanceId: value.id, namespace: 'snapshot',
    targetName: backup.backupId, tombstoneName, createdAt: '2026-08-13T12:00:00.000Z',
  });
  const restarted = await value.recreateManager();
  assert.deepEqual(restarted.recoveryStatus(), {
    manualRecoveryRequired: 1, global: false, instanceIds: [value.id],
  });
  await assert.rejects(
    () => restarted.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  );
  assert.equal(await fs.readFile(path.join(tombstone, 'payload', 'world', 'level.dat'), 'utf8'), 'world-before');
});

test('cleanup marker publication failure leaves a durable fence before payload deletion begins', async (t) => {
  let failedAfterPublication = false;
  const fileGuard = async (file) => ({
    assertHeld() {},
    async release() {},
    async delete() { await fs.unlink(file); },
    async rename(destination) { await fs.rename(file, destination); },
    async replace(destination) {
      await fs.rename(file, destination);
      if (!failedAfterPublication && path.basename(path.dirname(destination)) === 'cleanup-transactions'
        && /^cln-[a-f0-9]{32}\.json$/.test(path.basename(destination))) {
        failedAfterPublication = true;
        throw new Error('simulated post-publication failure');
      }
    },
  });
  const value = await fixture(t, { fileGuard });
  const backup = await value.manager.create({ instanceId: value.id });
  const target = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id, backup.backupId);
  await fs.writeFile(path.join(target, 'payload', 'world', 'level.dat'), 'corrupt-before-fenced-purge');
  await assert.rejects(
    () => value.manager.purge({ instanceId: value.id, backupId: backup.backupId, confirmation: 'PURGE' }),
    (error) => error.code === 'BACKUP_STORAGE_FAILED',
  );
  assert.equal(failedAfterPublication, true);
  assert.equal(await fs.readFile(path.join(target, 'payload', 'world', 'level.dat'), 'utf8'), 'corrupt-before-fenced-purge');
  const cleanupRoot = path.join(value.managedRoot, 'state', 'operator-backups', 'cleanup-transactions');
  assert.equal((await fs.readdir(cleanupRoot)).length, 1);
  assert.equal(value.manager.recoveryStatus().manualRecoveryRequired, 1);
  const restarted = await value.recreateManager();
  assert.equal(restarted.recoveryStatus().manualRecoveryRequired, 1);
  assert.equal(await fs.readFile(path.join(target, 'payload', 'world', 'level.dat'), 'utf8'), 'corrupt-before-fenced-purge');
});

test('an unauthenticated cleanup tombstone fences globally on reboot', async (t) => {
  const value = await fixture(t);
  const root = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id);
  const tombstone = path.join(root, `.cleanup-cln-${'a'.repeat(32)}`);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(tombstone);
  const restarted = await value.recreateManager();
  assert.equal(restarted.recoveryStatus().global, true);
  await assert.rejects(
    () => restarted.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  );
  assert.deepEqual(await fs.readdir(tombstone), []);
});

test('automatic policy is fixed, creates only while quiescent, and reports running deferral', async (t) => {
  let clock = Date.parse('2026-08-13T12:00:00.000Z');
  const value = await fixture(t, { now: () => new Date(clock).toISOString() });
  const saved = await value.manager.setPolicy({ instanceId: value.id, enabled: true, intervalHours: 6, retentionCount: 3 });
  assert.deepEqual(saved.policy, { enabled: true, intervalHours: 6, retentionCount: 3 });
  value.state.active = true;
  await value.store.update(value.id, { status: 'running', pid: 123 });
  const deferred = await value.manager.runDueBackups();
  assert.equal(deferred[0].action, 'deferred-running');
  const status = await value.manager.list({ instanceId: value.id });
  assert.equal(status.status.state, 'deferred-running');
  assert.equal(status.backups.length, 0);

  value.state.active = false;
  await value.store.update(value.id, { status: 'stopped', pid: null, managedProcess: null });
  const created = await value.manager.runDueBackups();
  assert.equal(created[0].action, 'created');
  assert.equal((await value.manager.list({ instanceId: value.id })).backups[0].kind, 'automatic');
  clock += 60 * 60 * 1000;
  assert.deepEqual(await value.manager.runDueBackups(), []);
});

test('disabled automatic policy skips backup inventory verification', async (t) => {
  let inventoryVerifications = 0;
  let schedulerFilesystemProofs = 0;
  let observeScheduler = false;
  const inventorySuffix = path.join('operator-backups', 'snapshots', 'family-server').toLowerCase();
  const value = await fixture(t, {
    filesystemTreeVerifier: async (target) => {
      if (observeScheduler) schedulerFilesystemProofs += 1;
      if (path.resolve(target).toLowerCase().endsWith(inventorySuffix)) inventoryVerifications += 1;
      return { ok: true, checked: false };
    },
  });
  await fs.mkdir(path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id));

  observeScheduler = true;
  assert.deepEqual(await value.manager.runDueBackups(), []);
  assert.equal(inventoryVerifications, 0, 'a disabled policy must not touch the backup inventory tree');
  assert.equal(schedulerFilesystemProofs, 0, 'a missing disabled policy must not open filesystem proof work');
});

test('scheduled backup rejects missing stack metadata before scanning or staging the world', async (t) => {
  let sourceTreeScans = 0;
  const serverSuffix = path.join('servers', 'family-server').toLowerCase();
  const value = await fixture(t, {
    filesystemTreeVerifier: async (target, options = {}) => {
      if (path.resolve(target).toLowerCase().endsWith(serverSuffix) && options.maxEntries === 500_000) {
        sourceTreeScans += 1;
      }
      return { ok: true, checked: false };
    },
  });
  await value.manager.setPolicy({ instanceId: value.id, enabled: true, intervalHours: 6, retentionCount: 3 });
  await value.store.update(value.id, { worldDataVersion: null, minecraftServerArtifact: null });

  assert.deepEqual(await value.manager.runDueBackups(), [{
    instanceId: value.id,
    action: 'failed',
    code: 'BACKUP_STACK_UNAVAILABLE',
  }]);
  assert.equal(sourceTreeScans, 0, 'missing authenticated stack metadata must fail before a source-tree scan');
  await assert.rejects(
    fs.lstat(path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id)),
    (error) => error.code === 'ENOENT',
  );
});

test('scheduler failures expose only a closed diagnostic stage and safe backup code', async (t) => {
  const instanceList = await fixture(t);
  instanceList.store.list = async () => { throw Object.assign(new Error('private instance path'), { code: 'EIO' }); };
  await assert.rejects(instanceList.manager.runDueBackups(), (error) => (
    error.code === 'BACKUP_STORAGE_FAILED'
      && error.schedulerStage === 'instance-list'
      && !JSON.stringify(error).includes('private')
  ));

  let failPolicyRead = false;
  const policyRead = await fixture(t, {
    directoryGuard: async (directory) => {
      if (failPolicyRead) throw Object.assign(new Error(`private policy path: ${directory}`), { code: 'EACCES' });
      return { assertHeld() {}, async release() {} };
    },
  });
  failPolicyRead = true;
  await assert.rejects(policyRead.manager.runDueBackups(), (error) => (
    error.code === 'BACKUP_STORAGE_FAILED' && error.schedulerStage === 'policy-read'
  ));

  const backupList = await fixture(t, {
    maxSnapshots: 1,
  });
  await backupList.manager.setPolicy({ instanceId: backupList.id, enabled: true, intervalHours: 6, retentionCount: 3 });
  const inventoryRoot = path.join(backupList.managedRoot, 'operator-backups', 'snapshots', backupList.id);
  await fs.mkdir(path.join(inventoryRoot, `bkp-${'a'.repeat(32)}`), { recursive: true });
  await fs.mkdir(path.join(inventoryRoot, `bkp-${'b'.repeat(32)}`), { recursive: true });
  await assert.rejects(backupList.manager.runDueBackups(), (error) => (
    error.code === 'BACKUP_LIMIT_EXCEEDED' && error.schedulerStage === 'backup-list'
  ));

  let failApply = false;
  const scheduledApply = await fixture(t, {
    withInstanceLock: async (_id, operation) => {
      if (failApply) throw Object.assign(new Error('private apply path'), { code: 'EIO' });
      return operation();
    },
  });
  await scheduledApply.manager.setPolicy({ instanceId: scheduledApply.id, enabled: true, intervalHours: 6, retentionCount: 3 });
  failApply = true;
  await assert.rejects(scheduledApply.manager.runDueBackups(), (error) => (
    error.code === 'BACKUP_STORAGE_FAILED' && error.schedulerStage === 'scheduled-apply'
  ));
});

test('coalesces concurrent scheduled scans and rechecks due state inside the instance lock', async (t) => {
  let releaseLock;
  let enteredLock;
  let delay = false;
  let lockEntries = 0;
  const gate = new Promise((resolve) => { releaseLock = resolve; });
  const entered = new Promise((resolve) => { enteredLock = resolve; });
  const value = await fixture(t, {
    withInstanceLock: async (_id, operation) => {
      lockEntries += 1;
      if (delay) {
        enteredLock();
        await gate;
      }
      return operation();
    },
  });
  await value.manager.setPolicy({ instanceId: value.id, enabled: true, intervalHours: 6, retentionCount: 3 });
  const baseline = lockEntries;
  delay = true;
  const first = value.manager.runDueBackups();
  await entered;
  const second = value.manager.runDueBackups();
  releaseLock();
  assert.deepEqual(await first, await second);
  assert.equal(lockEntries - baseline, 1);
  assert.equal((await value.manager.list({ instanceId: value.id })).backups.filter((item) => item.kind === 'automatic').length, 1);
});

test('backs off persistent automatic failures but retries after the bounded delay', async (t) => {
  let clock = Date.parse('2026-08-13T12:00:00.000Z');
  let verificationCalls = 0;
  const value = await fixture(t, {
    now: () => new Date(clock).toISOString(),
    verifyInstall: async () => {
      verificationCalls += 1;
      throw Object.assign(new Error('private install failure detail'), { code: 'BACKUP_INSTALL_FAILED', statusCode: 409 });
    },
  });
  await value.manager.setPolicy({ instanceId: value.id, enabled: true, intervalHours: 6, retentionCount: 3 });
  assert.equal((await value.manager.runDueBackups())[0].action, 'failed');
  assert.equal(verificationCalls, 1);
  assert.deepEqual(await value.manager.runDueBackups(), []);
  assert.equal(verificationCalls, 1);
  clock += 5 * 60 * 1000;
  assert.equal((await value.manager.runDueBackups())[0].action, 'failed');
  assert.equal(verificationCalls, 2);
});

test('sanitizes scheduled operating-system failures to a fixed backup-domain code', async (t) => {
  const value = await fixture(t, {
    verifyInstall: async () => { throw Object.assign(new Error('C:\\private\\disk detail'), { code: 'EACCES' }); },
  });
  await value.manager.setPolicy({ instanceId: value.id, enabled: true, intervalHours: 6, retentionCount: 3 });
  assert.deepEqual(await value.manager.runDueBackups(), [{
    instanceId: value.id,
    action: 'failed',
    code: 'BACKUP_STORAGE_FAILED',
  }]);
  const status = await value.manager.list({ instanceId: value.id });
  assert.equal(status.status.lastError, 'BACKUP_STORAGE_FAILED');
  assert.equal(JSON.stringify(status).includes('private'), false);
});

test('records a scheduled failure only under the instance lock and serialized broker scope', async (t) => {
  const scoped = scopedBrokerHarness();
  let lockDepth = 0;
  let lockEntries = 0;
  let observeFailureWrite = false;
  let observedFailureWrite = false;
  const guards = retainedGuardHarness({
    beforeReplace({ kind, destination }) {
      if (!observeFailureWrite || kind !== 'file'
        || path.basename(destination) !== 'family-server.json'
        || path.basename(path.dirname(destination)) !== 'policies') return;
      observedFailureWrite = true;
      assert.equal(lockDepth, 1, 'scheduled failure state escaped the exact instance lock');
      assert.equal(scoped.trace.scopeDepth, 1, 'scheduled failure state escaped the serialized broker scope');
    },
  });
  const value = await fixture(t, {
    filesystemSafetyBroker: scoped.broker,
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    filesystemTreeVerifier: async () => ({ ok: true, checked: false }),
    withInstanceLock: async (_instanceId, operation) => {
      assert.equal(lockDepth, 0, 'the instance lock must not be reacquired before the prior attempt releases it');
      lockEntries += 1;
      lockDepth = 1;
      try { return await operation(); } finally { lockDepth = 0; }
    },
    verifyInstall: async () => {
      throw Object.assign(new Error('scheduled failure'), { code: 'BACKUP_INSTALL_FAILED', statusCode: 409 });
    },
    minimalFilesystem: true,
  });
  await value.manager.setPolicy({ instanceId: value.id, enabled: true, intervalHours: 6, retentionCount: 3 });
  const baselineLockEntries = lockEntries;
  observeFailureWrite = true;
  const result = await value.manager.runDueBackups();
  observeFailureWrite = false;
  assert.equal(result[0].action, 'failed');
  assert.equal(lockEntries - baselineLockEntries, 2, 'the failed attempt and its state write need distinct lock acquisitions');
  assert.equal(observedFailureWrite, true);
  assert.equal(scoped.trace.scopeDepth, 0);
  assert.equal(scoped.trace.active.size, 0);
  assert.equal(guards.held.size, 0);
});

test('rejects and durably fences a deterministic unauthenticated cleanup target before publication', async (t) => {
  let clock = Date.parse('2026-08-13T12:00:00.000Z');
  const value = await fixture(t, { now: () => new Date(clock).toISOString() });
  await value.manager.setPolicy({ instanceId: value.id, enabled: true, intervalHours: 6, retentionCount: 3 });
  const created = [];
  for (let index = 0; index < 3; index += 1) {
    const result = await value.manager.runDueBackups();
    created.push(result[0].backupId);
    clock += 6 * 60 * 60 * 1000;
  }
  const root = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id);
  const cleanupId = `cln-${crypto.createHash('sha256').update(canonicalJson({
    schemaVersion: 1, namespace: 'snapshot', instanceId: value.id, targetName: created[0],
  })).digest('hex').slice(0, 32)}`;
  const occupiedTombstone = path.join(root, `.cleanup-${cleanupId}`);
  const policyFile = path.join(value.managedRoot, 'state', 'operator-backups', 'policies', `${value.id}.json`);
  const policyBeforeFence = await fs.readFile(policyFile);
  await fs.mkdir(occupiedTombstone);
  const failed = await value.manager.runDueBackups();
  assert.deepEqual(failed, [{
    instanceId: value.id,
    action: 'manual-recovery-required',
    code: 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  }]);
  assert.deepEqual(await fs.readFile(policyFile), policyBeforeFence, 'manual recovery must block scheduler telemetry writes');
  await fs.rmdir(occupiedTombstone);
  clock += 6 * 60 * 60 * 1000;
  const recovered = await value.manager.runDueBackups();
  assert.equal(recovered[0].action, 'manual-recovery-required');
  assert.deepEqual(await fs.readFile(policyFile), policyBeforeFence);
});

test('list is an authoritative completion barrier behind an in-flight mutation', async (t) => {
  let previous = Promise.resolve();
  let hold = false;
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const mutationEntered = new Promise((resolve) => { entered = resolve; });
  const value = await fixture(t, {
    withInstanceLock: (_id, operation) => {
      const current = previous.catch(() => undefined).then(async () => {
        if (hold) {
          entered();
          await gate;
        }
        return operation();
      });
      previous = current;
      return current;
    },
  });
  hold = true;
  const creating = value.manager.create({ instanceId: value.id });
  await mutationEntered;
  let listResolved = false;
  const listing = value.manager.list({ instanceId: value.id }).then((result) => {
    listResolved = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(listResolved, false);
  release();
  const created = await creating;
  const inventory = await listing;
  assert.equal(inventory.backups.some((item) => item.backupId === created.backupId), true);
});

test('uses a hash-bound plan, creates a rescue snapshot, restores mutable state, and preserves the current stack', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'world-after');
  await fs.writeFile(path.join(value.directory, 'custom-state', 'later.json'), '{"later":true}\n');
  await fs.writeFile(path.join(value.directory, 'config', 'Geyser-Fabric', 'config.yml'), 'managed-current-geyser-config-after');
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  assert.match(plan.planId, /^rst-[a-f0-9]{64}$/);
  assert.equal(plan.safetySnapshotRequired, true);
  const restored = await value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId });
  assert.equal(restored.safetySnapshotVerified, true);
  assert.equal(restored.stackPreserved, true);
  assert.equal(await fs.readFile(path.join(value.directory, 'world', 'level.dat'), 'utf8'), 'world-before');
  assert.equal(await fs.readFile(path.join(value.directory, 'fabric-server-launch.jar'), 'utf8'), 'managed-current:fabric-server-launch.jar');
  assert.equal(await fs.readFile(path.join(value.directory, 'config', 'Geyser-Fabric', 'config.yml'), 'utf8'), 'managed-current-geyser-config-after');
  await assert.rejects(() => fs.lstat(path.join(value.directory, 'custom-state', 'later.json')), (error) => error.code === 'ENOENT');
  const inventory = await value.manager.list({ instanceId: value.id });
  const rescue = inventory.backups.find((item) => item.backupId === restored.rescueBackupId);
  assert.equal(rescue.kind, 'rescue');
  assert.equal(rescue.integrity, 'verified');
  assert.equal(rescue.purgeable, false);
});

test('invalidates a restore approval if current state changes after planning', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'changed-after-plan');
  await assert.rejects(
    () => value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId }),
    (error) => error.code === 'BACKUP_APPROVAL_STALE',
  );
  assert.equal((await value.manager.list({ instanceId: value.id })).backups.filter((item) => item.kind === 'rescue').length, 0);
});

test('binds restore approval to the exact managed world and mod fingerprint', async (t) => {
  let binding = { generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64) };
  const value = await fixture(t, {
    currentWorldStackBindingWithinInstanceLock: async () => structuredClone(binding),
  });
  const backup = await value.manager.create({ instanceId: value.id });
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  binding = { generation: 'c'.repeat(64), inventoryDigest: 'd'.repeat(64) };
  await assert.rejects(
    () => value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId }),
    (error) => error.code === 'BACKUP_APPROVAL_STALE',
  );
});

test('binds snapshots and restore approvals to the trusted server artifact and world data version', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  const original = await value.store.get(value.id);
  await value.store.update(value.id, {
    worldDataVersion: 4551,
    minecraftServerArtifact: {
      ...original.minecraftServerArtifact,
      worldDataVersion: 4551,
      sha256: 'c'.repeat(64),
    },
  });
  await assert.rejects(
    () => value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId }),
    (error) => error.code === 'BACKUP_STACK_INCOMPATIBLE',
  );

  await value.store.update(value.id, {
    worldDataVersion: original.worldDataVersion,
    minecraftServerArtifact: original.minecraftServerArtifact,
  });
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  await value.store.update(value.id, {
    minecraftServerArtifact: { ...original.minecraftServerArtifact, sha1: 'd'.repeat(40), sha256: 'e'.repeat(64) },
  });
  await assert.rejects(
    () => value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId }),
    (error) => error.code === 'BACKUP_APPROVAL_STALE',
  );
});

test('binds snapshots and restore approvals to both authenticated launch-trust digests', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  const original = await value.store.get(value.id);
  await value.store.update(value.id, {
    javaRuntime: { ...original.javaRuntime, launchInventoryDigest: 'e'.repeat(64) },
  });
  await assert.rejects(
    () => value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId }),
    (error) => error.code === 'BACKUP_STACK_INCOMPATIBLE',
  );

  await value.store.update(value.id, { javaRuntime: original.javaRuntime });
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  await value.store.update(value.id, {
    javaRuntime: { ...original.javaRuntime, launchAssetDigest: 'f'.repeat(64) },
  });
  await assert.rejects(
    () => value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId }),
    (error) => error.code === 'BACKUP_APPROVAL_STALE',
  );
});

test('rolls back a published restore when authenticated world validation rejects it', async (t) => {
  let validationCalls = 0;
  const value = await fixture(t, {
    validateRestoredWorldWithinInstanceLock: async (_id, expected, options) => {
      validationCalls += 1;
      if (options.directory.endsWith('.candidate')) return structuredClone(expected);
      if (await fs.readFile(path.join(options.directory, 'world', 'level.dat'), 'utf8') === 'current-must-survive') {
        return structuredClone(expected);
      }
      throw Object.assign(new Error('restored journal mismatch'), { code: 'WORLD_STATE_UNAVAILABLE', statusCode: 503 });
    },
  });
  const backup = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'current-must-survive');
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  await assert.rejects(
    () => value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId }),
    (error) => error.code === 'BACKUP_STORAGE_FAILED',
  );
  assert.equal(validationCalls, 3);
  assert.equal(await fs.readFile(path.join(value.directory, 'world', 'level.dat'), 'utf8'), 'current-must-survive');
});

test('fences recovery instead of claiming rollback when the restored original cannot be reverified', async (t) => {
  const value = await fixture(t, {
    validateRestoredWorldWithinInstanceLock: async (_id, expected, options) => {
      if (options.directory.endsWith('.candidate')) return structuredClone(expected);
      throw Object.assign(new Error('world verification unavailable'), { code: 'WORLD_STATE_UNAVAILABLE', statusCode: 503 });
    },
  });
  const backup = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'original-needs-verification');
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  await assert.rejects(
    () => value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId }),
    (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  );
  assert.equal(value.manager.recoveryStatus().manualRecoveryRequired, 1);
  assert.equal(await fs.readFile(path.join(value.directory, 'world', 'level.dat'), 'utf8'), 'original-needs-verification');
});

test('does not reverse a committed restore when ready-phase terminalization reports an error', async (t) => {
  let failReady = false;
  const value = await fixture(t, {
    onPhase: async (marker) => {
      if (failReady && marker.phase === 'ready') throw Object.assign(new Error('terminal notification failed'), { code: 'SIMULATED_FAILURE' });
    },
  });
  const backup = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'newer-live-world');
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  failReady = true;
  await assert.rejects(
    () => value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId }),
    (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  );
  assert.equal(await fs.readFile(path.join(value.directory, 'world', 'level.dat'), 'utf8'), 'world-before');
  const committedReceipt = (await value.store.get(value.id)).lastRestore;
  assert.equal(committedReceipt?.backupId, backup.backupId);
  assert.equal(value.manager.recoveryStatus().manualRecoveryRequired, 1);
  await value.store.update(value.id, {
    lastRestore: {
      backupId: `bkp-${'7'.repeat(32)}`, rescueBackupId: `bkp-${'8'.repeat(32)}`,
      restoredAt: '2026-08-13T11:00:00.000Z', state: 'verified',
    },
  });
  failReady = false;
  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.equal(recovery.find((item) => item.instanceId === value.id)?.phase, 'ready');
  assert.deepEqual((await value.store.get(value.id)).lastRestore, committedReceipt);
  assert.equal(value.manager.recoveryStatus().manualRecoveryRequired, 0);
});

test('rolls the original server back if publication is interrupted', async (t) => {
  let failAtPublication = false;
  const value = await fixture(t, {
    onPhase: async (marker) => {
      if (failAtPublication && marker.phase === 'candidate-published') throw Object.assign(new Error('simulated publication interruption'), { code: 'SIMULATED_FAILURE' });
    },
  });
  const backup = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'current-must-return');
  const plan = await value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId });
  failAtPublication = true;
  await assert.rejects(
    () => value.manager.restore({ instanceId: value.id, backupId: backup.backupId, planId: plan.planId }),
    (error) => error.code === 'BACKUP_STORAGE_FAILED'
      && error.message === 'The local backup operation failed safely'
      && !error.message.includes('simulated'),
  );
  assert.equal(await fs.readFile(path.join(value.directory, 'world', 'level.dat'), 'utf8'), 'current-must-return');
  assert.equal(await fs.readFile(path.join(value.directory, 'fabric-server-launch.jar'), 'utf8'), 'managed-current:fabric-server-launch.jar');
});

test('startup recovery fences a nonterminal marker without mutating live layout before authenticated CAS', async (t) => {
  let expectedMarkerFile = null;
  let exactMarkerLeaseObserved = false;
  const guards = retainedGuardHarness();
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    withInstanceLock: async (_instanceId, operation) => {
      if (expectedMarkerFile) {
        assert.equal(guards.count(expectedMarkerFile), 1, 'recovery must hold the exact authenticated marker');
        exactMarkerLeaseObserved = true;
      }
      return operation();
    },
  });
  const originalLastRestore = {
    backupId: `bkp-${'1'.repeat(32)}`,
    rescueBackupId: `bkp-${'2'.repeat(32)}`,
    restoredAt: '2026-08-12T12:00:00.000Z',
    state: 'verified',
  };
  await value.store.update(value.id, { lastRestore: originalLastRestore });
  const backup = await value.manager.create({ instanceId: value.id });
  const transactionId = `rtx-${'d'.repeat(32)}`;
  const prefix = `.${value.id}.${transactionId}`;
  const original = path.join(value.managedRoot, 'servers', `${prefix}.original`);
  const candidate = path.join(value.managedRoot, 'servers', `${prefix}.candidate`);
  await fs.cp(value.directory, candidate, { recursive: true, errorOnExist: true, force: false });
  await fs.rename(value.directory, original);
  const manifest = JSON.parse(await fs.readFile(path.join(
    value.managedRoot, 'operator-backups', 'snapshots', value.id, backup.backupId, 'manifest.json',
  ), 'utf8'));
  await writeRestoreMarker(value, transactionId, {
    schemaVersion: 1,
    transactionId,
    instanceId: value.id,
    backupId: backup.backupId,
    rescueBackupId: `bkp-${'e'.repeat(32)}`,
    phase: 'candidate-ready',
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
    expectedTree: { ...manifest.tree, entries: [] },
    stackDigest: manifest.stackDigest,
    worldStackBinding: { generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64) },
    originalTreeDigest: manifest.tree.digest,
    originalLastRestore,
    targetLastRestore: {
      backupId: backup.backupId, rescueBackupId: `bkp-${'e'.repeat(32)}`,
      restoredAt: '2026-08-13T12:00:00.000Z', state: 'verified',
    },
  });
  const markerFile = path.join(value.managedRoot, 'state', 'operator-backups', 'restore-transactions', `${transactionId}.json`);
  expectedMarkerFile = markerFile;
  const markerBefore = await fs.readFile(markerFile);
  const storeBefore = await value.store.get(value.id);
  assert.deepEqual(await value.manager.preflightRecoveryEvidence(), {
    domain: 'backup', instances: [{ instanceId: value.id, transactionRef: transactionId }],
  });
  assert.deepEqual(await fs.readFile(markerFile), markerBefore);
  assert.deepEqual(await value.store.get(value.id), storeBefore);
  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.equal(recovery[0].action, 'manual-recovery-required');
  assert.equal(recovery[0].code, 'BACKUP_MANUAL_RECOVERY_REQUIRED');
  await assert.rejects(() => fs.lstat(value.directory), (error) => error.code === 'ENOENT');
  assert.equal(await fs.readFile(path.join(original, 'world', 'level.dat'), 'utf8'), 'world-before');
  assert.equal(await fs.readFile(path.join(candidate, 'world', 'level.dat'), 'utf8'), 'world-before');
  assert.deepEqual(await fs.readFile(markerFile), markerBefore);
  assert.deepEqual(await value.store.get(value.id), storeBefore);
  assert.equal(value.manager.recoveryStatus().manualRecoveryRequired, 1);
  assert.equal(exactMarkerLeaseObserved, true);
  assert.equal(guards.held.size, 0);
});

test('terminal recovery compacts only under exact root marker and key leases without guard leaks', async (t) => {
  let markerFile = null;
  let transactionRoot = null;
  let keyFile = null;
  let exactLeasesObserved = false;
  const guards = retainedGuardHarness({
    beforeDelete({ kind, target, count }) {
      if (kind !== 'file' || path.resolve(target) !== path.resolve(markerFile ?? 'missing-marker')) return;
      assert.equal(count(transactionRoot), 1, 'terminal compaction must retain the exact transaction root lease');
      assert.equal(count(markerFile), 1, 'terminal compaction must delete through the authenticated marker lease');
      assert.equal(count(keyFile), 1, 'terminal compaction must retain the exact authentication-key lease');
      exactLeasesObserved = true;
    },
  });
  const value = await fixture(t, {
    directoryGuard: guards.directoryGuard,
    fileGuard: guards.fileGuard,
    minimalFilesystem: true,
  });
  const backup = await value.manager.create({ instanceId: value.id });
  const snapshotRoot = path.join(
    value.managedRoot, 'operator-backups', 'snapshots', value.id, backup.backupId,
  );
  const manifest = JSON.parse(await fs.readFile(path.join(snapshotRoot, 'manifest.json'), 'utf8'));
  const transactionId = `rtx-${'6'.repeat(32)}`;
  transactionRoot = path.join(value.managedRoot, 'state', 'operator-backups', 'restore-transactions');
  markerFile = path.join(transactionRoot, `${transactionId}.json`);
  keyFile = path.join(value.managedRoot, 'state', 'operator-backups', 'hmac.key');
  await writeRestoreMarker(value, transactionId, {
    schemaVersion: 1,
    transactionId,
    instanceId: value.id,
    backupId: backup.backupId,
    rescueBackupId: `bkp-${'7'.repeat(32)}`,
    phase: 'rolled-back',
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
    expectedTree: { ...manifest.tree, entries: [] },
    stackDigest: manifest.stackDigest,
    worldStackBinding: manifest.worldStackBinding,
    originalTreeDigest: manifest.tree.digest,
    originalLastRestore: null,
    targetLastRestore: {
      backupId: backup.backupId,
      rescueBackupId: `bkp-${'7'.repeat(32)}`,
      restoredAt: '2026-08-13T12:00:00.000Z',
      state: 'verified',
    },
  });

  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.deepEqual(recovery, [{
    instanceId: value.id,
    transactionId,
    action: 'none',
    phase: 'rolled-back',
  }]);
  assert.equal(exactLeasesObserved, true);
  await assert.rejects(() => fs.lstat(markerFile), (error) => error.code === 'ENOENT');
  assert.equal(guards.held.size, 0);
});

test('sets a lifecycle recovery fence when restore reconciliation cannot prove a safe layout', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  const transactionId = `rtx-${'c'.repeat(32)}`;
  await writeRestoreMarker(value, transactionId, {
    schemaVersion: 1,
    transactionId,
    instanceId: value.id,
    backupId: backup.backupId,
    rescueBackupId: `bkp-${'d'.repeat(32)}`,
    phase: 'original-backed-up',
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
    expectedTree: { algorithm: 'sha256', digest: 'f'.repeat(64), files: 1, bytes: 1, entries: [] },
    stackDigest: 'f'.repeat(64),
    worldStackBinding: { generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64) },
    originalTreeDigest: 'e'.repeat(64),
    originalLastRestore: null,
    targetLastRestore: {
      backupId: backup.backupId, rescueBackupId: `bkp-${'d'.repeat(32)}`,
      restoredAt: '2026-08-13T12:00:00.000Z', state: 'verified',
    },
  });
  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.equal(recovery[0].action, 'manual-recovery-required');
  assert.deepEqual(value.manager.recoveryStatus(), {
    manualRecoveryRequired: 1,
    global: false,
    instanceIds: [value.id],
  });
  await assert.rejects(
    () => value.manager.assertSafeForLifecycle({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  );
  await assert.rejects(
    () => value.manager.create({ instanceId: value.id }),
    (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  );
  assert.equal((await value.manager.list({ instanceId: value.id })).instanceId, value.id);
});

test('ready recovery re-verifies the canonical tree before deleting its rollback copy', async (t) => {
  const value = await fixture(t);
  const backup = await value.manager.create({ instanceId: value.id });
  const backupRoot = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id, backup.backupId);
  const manifest = JSON.parse(await fs.readFile(path.join(backupRoot, 'manifest.json'), 'utf8'));
  const transactionId = `rtx-${'a'.repeat(32)}`;
  const original = path.join(value.managedRoot, 'servers', `.${value.id}.${transactionId}.original`);
  await fs.cp(value.directory, original, { recursive: true, errorOnExist: true, force: false });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'corrupt-after-ready');
  await writeRestoreMarker(value, transactionId, {
    schemaVersion: 1,
    transactionId,
    instanceId: value.id,
    backupId: backup.backupId,
    rescueBackupId: `bkp-${'b'.repeat(32)}`,
    phase: 'ready',
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
    expectedTree: { ...manifest.tree, entries: [] },
    stackDigest: manifest.stackDigest,
    worldStackBinding: manifest.worldStackBinding,
    originalTreeDigest: manifest.tree.digest,
    originalLastRestore: null,
    targetLastRestore: {
      backupId: backup.backupId, rescueBackupId: `bkp-${'b'.repeat(32)}`,
      restoredAt: '2026-08-13T12:00:00.000Z', state: 'verified',
    },
  });
  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.equal(recovery[0].action, 'manual-recovery-required');
  assert.equal(await fs.readFile(path.join(original, 'world', 'level.dat'), 'utf8'), 'world-before');
  assert.equal(value.manager.recoveryStatus().manualRecoveryRequired, 1);
});

test('rejects restore markers with extra fields or unbounded lastRestore state', async (t) => {
  const value = await fixture(t);
  const base = {
    schemaVersion: 1,
    instanceId: value.id,
    backupId: `bkp-${'1'.repeat(32)}`,
    rescueBackupId: `bkp-${'2'.repeat(32)}`,
    phase: 'rolled-back',
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
    expectedTree: { algorithm: 'sha256', digest: 'f'.repeat(64), files: 1, bytes: 1, entries: [] },
    stackDigest: 'e'.repeat(64),
    worldStackBinding: { generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64) },
    originalTreeDigest: 'd'.repeat(64),
    originalLastRestore: null,
    targetLastRestore: {
      backupId: `bkp-${'1'.repeat(32)}`, rescueBackupId: `bkp-${'2'.repeat(32)}`,
      restoredAt: '2026-08-13T12:00:00.000Z', state: 'verified',
    },
  };
  const firstId = `rtx-${'3'.repeat(32)}`;
  const secondId = `rtx-${'4'.repeat(32)}`;
  await writeRestoreMarker(value, firstId, { ...base, transactionId: firstId, filesystemPath: 'C:\\private' });
  await writeRestoreMarker(value, secondId, {
    ...base,
    transactionId: secondId,
    originalLastRestore: { ...base, state: 'verified' },
  });
  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.equal(recovery.length, 2);
  assert.equal(recovery.every((item) => item.action === 'manual-recovery-required'), true);
  assert.equal(value.manager.recoveryStatus().manualRecoveryRequired, 2);
  assert.equal(value.manager.recoveryStatus().global, true);
  await assert.rejects(() => value.manager.assertSafeForLifecycle({ instanceId: value.id }), (error) => error.code === 'BACKUP_MANUAL_RECOVERY_REQUIRED');
});

test('authenticates restore markers and fences tampered recovery state globally', async (t) => {
  const value = await fixture(t);
  const transactionId = `rtx-${'7'.repeat(32)}`;
  await writeRestoreMarker(value, transactionId, {
    schemaVersion: 1, transactionId, instanceId: value.id,
    backupId: `bkp-${'8'.repeat(32)}`, rescueBackupId: `bkp-${'9'.repeat(32)}`,
    phase: 'rolled-back', createdAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:00.000Z',
    expectedTree: { algorithm: 'sha256', digest: 'a'.repeat(64), files: 1, bytes: 1, entries: [] },
    stackDigest: 'b'.repeat(64), worldStackBinding: { generation: 'c'.repeat(64), inventoryDigest: 'd'.repeat(64) },
    originalTreeDigest: 'e'.repeat(64), originalLastRestore: null,
    targetLastRestore: {
      backupId: `bkp-${'8'.repeat(32)}`, rescueBackupId: `bkp-${'9'.repeat(32)}`,
      restoredAt: '2026-08-13T12:00:00.000Z', state: 'verified',
    },
  });
  const marker = path.join(value.managedRoot, 'state', 'operator-backups', 'restore-transactions', `${transactionId}.json`);
  const tampered = JSON.parse(await fs.readFile(marker, 'utf8'));
  tampered.phase = 'ready';
  await fs.writeFile(marker, `${JSON.stringify(tampered, null, 2)}\n`);
  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.equal(recovery[0].action, 'manual-recovery-required');
  assert.equal(value.manager.recoveryStatus().global, true);
});

test('fences a canonically encoded restore marker signed by the wrong key', async (t) => {
  const value = await fixture(t);
  const transactionId = `rtx-${'5'.repeat(32)}`;
  const marker = {
    schemaVersion: 1, transactionId, instanceId: value.id,
    backupId: `bkp-${'4'.repeat(32)}`, rescueBackupId: `bkp-${'3'.repeat(32)}`,
    phase: 'rolled-back', createdAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:00.000Z',
    expectedTree: { algorithm: 'sha256', digest: '2'.repeat(64), files: 1, bytes: 1, entries: [] },
    stackDigest: '1'.repeat(64), worldStackBinding: { generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64) },
    originalTreeDigest: 'c'.repeat(64), originalLastRestore: null,
    targetLastRestore: {
      backupId: `bkp-${'4'.repeat(32)}`, rescueBackupId: `bkp-${'3'.repeat(32)}`,
      restoredAt: '2026-08-13T12:00:00.000Z', state: 'verified',
    },
  };
  const mac = crypto.createHmac('sha256', Buffer.alloc(32, 0xff)).update(canonicalJson(marker), 'utf8').digest('hex');
  const file = path.join(value.managedRoot, 'state', 'operator-backups', 'restore-transactions', `${transactionId}.json`);
  await fs.writeFile(file, `${JSON.stringify({ ...marker, mac }, null, 2)}\n`);
  await value.manager.reconcileInterruptedTransactions();
  assert.equal(value.manager.recoveryStatus().global, true);
});

test('rejects every unexpected restore-transaction namespace entry', async (t) => {
  for (const [name, create] of [
    ['.tmp-orphan', (root) => fs.writeFile(path.join(root, '.tmp-orphan'), '{}')],
    ['invalid-name.json', (root) => fs.writeFile(path.join(root, 'invalid-name.json'), '{}')],
    ['unexpected-directory', (root) => fs.mkdir(path.join(root, 'unexpected-directory'))],
  ]) {
    const value = await fixture(t);
    const root = path.join(value.managedRoot, 'state', 'operator-backups', 'restore-transactions');
    await create(root);
    const recovery = await value.manager.reconcileInterruptedTransactions();
    assert.equal(recovery.some((entry) => entry.action === 'manual-recovery-required'), true, name);
    assert.equal(value.manager.recoveryStatus().global, true, name);
  }
});

test('rejects a hard-linked restore marker before authentication', async (t) => {
  const value = await fixture(t);
  const transactionId = `rtx-${'6'.repeat(32)}`;
  const root = path.join(value.managedRoot, 'state', 'operator-backups', 'restore-transactions');
  const outside = path.join(value.managedRoot, 'hardlink-source.json');
  await fs.writeFile(outside, '{}');
  await fs.link(outside, path.join(root, `${transactionId}.json`));
  await value.manager.reconcileInterruptedTransactions();
  assert.equal(value.manager.recoveryStatus().global, true);
});

test('rejects alternate data streams in restore recovery state', { skip: process.platform !== 'win32' }, async (t) => {
  const value = await fixture(t, { filesystemTreeVerifier: assertWindowsFilesystemTree });
  const root = path.join(value.managedRoot, 'state', 'operator-backups', 'restore-transactions');
  await fs.writeFile(`${root}:hidden-recovery`, 'tampered');
  await value.manager.reconcileInterruptedTransactions();
  assert.equal(value.manager.recoveryStatus().global, true);
});

test('bounds restore-transaction entry count and aggregate bytes', async (t) => {
  const countBound = await fixture(t, { maxRestoreMarkers: 1 });
  const countRoot = path.join(countBound.managedRoot, 'state', 'operator-backups', 'restore-transactions');
  await fs.writeFile(path.join(countRoot, '.extra-one'), '{}');
  await fs.writeFile(path.join(countRoot, '.extra-two'), '{}');
  await countBound.manager.reconcileInterruptedTransactions();
  assert.equal(countBound.manager.recoveryStatus().global, true);

  const byteBound = await fixture(t, { maxRestoreMarkerBytes: 64 });
  const byteId = `rtx-${'a'.repeat(32)}`;
  const byteRoot = path.join(byteBound.managedRoot, 'state', 'operator-backups', 'restore-transactions');
  await fs.writeFile(path.join(byteRoot, `${byteId}.json`), JSON.stringify({ mac: 'a'.repeat(64) }));
  await byteBound.manager.reconcileInterruptedTransactions();
  assert.equal(byteBound.manager.recoveryStatus().global, true);
});

test('recovery status counts every fenced instance while bounding the public id list', async (t) => {
  const value = await fixture(t);
  for (let index = 0; index < 101; index += 1) {
    const transactionId = `rtx-${index.toString(16).padStart(32, '0')}`;
    const instanceId = `missing-${index.toString().padStart(3, '0')}`;
    await writeRestoreMarker(value, transactionId, {
      schemaVersion: 1, transactionId, instanceId,
      backupId: `bkp-${'5'.repeat(32)}`, rescueBackupId: `bkp-${'6'.repeat(32)}`,
      phase: 'rolled-back', createdAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:00.000Z',
      expectedTree: { algorithm: 'sha256', digest: 'f'.repeat(64), files: 1, bytes: 1, entries: [] },
      stackDigest: 'e'.repeat(64), worldStackBinding: { generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64) },
      originalTreeDigest: 'd'.repeat(64), originalLastRestore: null,
      targetLastRestore: {
        backupId: `bkp-${'5'.repeat(32)}`, rescueBackupId: `bkp-${'6'.repeat(32)}`,
        restoredAt: '2026-08-13T12:00:00.000Z', state: 'verified',
      },
    });
  }
  await value.manager.reconcileInterruptedTransactions();
  const status = value.manager.recoveryStatus();
  assert.equal(status.manualRecoveryRequired, 101);
  assert.equal(status.instanceIds.length, 100);
});

test('protects the newest verified and rescue snapshots while allowing explicit older purge', async (t) => {
  let clock = Date.parse('2026-08-13T12:00:00.000Z');
  const value = await fixture(t, { now: () => new Date(clock++).toISOString() });
  const first = await value.manager.create({ instanceId: value.id });
  await fs.writeFile(path.join(value.directory, 'world', 'level.dat'), 'second-world');
  const second = await value.manager.create({ instanceId: value.id });
  const before = await value.manager.list({ instanceId: value.id });
  assert.equal(before.backups.find((item) => item.backupId === first.backupId).purgeable, true);
  assert.equal(before.backups.find((item) => item.backupId === second.backupId).purgeable, false);
  const purged = await value.manager.purge({ instanceId: value.id, backupId: first.backupId, confirmation: 'PURGE' });
  assert.equal(purged.backupId, first.backupId);
  await assert.rejects(
    () => value.manager.purge({ instanceId: value.id, backupId: second.backupId, confirmation: 'PURGE' }),
    (error) => error.code === 'BACKUP_PROTECTED',
  );
});

test('fails closed on hard links before publishing a backup', async (t) => {
  const value = await fixture(t);
  const original = path.join(value.directory, 'custom-state', 'claims.json');
  const linked = path.join(value.directory, 'custom-state', 'claims-copy.json');
  await fs.link(original, linked);
  await assert.rejects(() => value.manager.create({ instanceId: value.id }), (error) => error.code === 'BACKUP_UNSAFE_FILESYSTEM');
  const root = path.join(value.managedRoot, 'operator-backups', 'snapshots', value.id);
  const entries = await fs.readdir(root).catch(() => []);
  assert.equal(entries.some((entry) => /^bkp-/.test(entry)), false);
});

test('rejects caller-controlled fields and refuses a different Minecraft version', async (t) => {
  const value = await fixture(t);
  await assert.rejects(() => value.manager.create({ instanceId: value.id, path: 'C:\\unsafe' }), /one valid instanceId/);
  const backup = await value.manager.create({ instanceId: value.id });
  await value.store.update(value.id, { minecraftVersion: '26.3' });
  await assert.rejects(
    () => value.manager.createRestorePlan({ instanceId: value.id, backupId: backup.backupId }),
    (error) => error.code === 'BACKUP_VERSION_INCOMPATIBLE',
  );
});
