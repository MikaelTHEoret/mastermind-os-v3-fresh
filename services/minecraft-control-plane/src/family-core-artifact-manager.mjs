import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireLaunchIntegrityKey } from './integrity-key-continuity.mjs';
import { inspectFabricModJar, validateFabricCandidateGraph } from './modrinth-client.mjs';

const FAMILY_ID = 'family-server';
const FILE_NAME = 'mastermind-family-core.jar';
const MOD_ID = 'mastermind-family-core';
const SHA256 = /^[a-f0-9]{64}$/;
const BACKUP_ID = /^bkp-[a-f0-9]{32}$/;
const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSACTION_PHASES = new Set(['prepared', 'candidate-published', 'manifest-committed']);
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const CORE_FILES = Object.freeze(['fabric-api.jar', 'geyser-fabric.jar', 'floodgate-fabric.jar']);
const CONFIRM_PROMOTION = 'PROMOTE FIRST-PARTY FAMILY CORE';
const CONFIRM_ROLLBACK = 'ROLL BACK FIRST-PARTY FAMILY CORE';

function coreError(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function sameArtifact(left, right) {
  return left === null && right === null
    || left !== null && right !== null
      && left.fileName === right.fileName && left.sha256 === right.sha256 && left.size === right.size;
}

async function boundedRegularFile(file, maximumBytes = MAX_ARTIFACT_BYTES) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 22 || stat.size > maximumBytes) {
    throw coreError('FAMILY_CORE_ARTIFACT_INVALID', 409, 'The Family Core candidate is not a bounded regular JAR.');
  }
  const bytes = await fs.readFile(file);
  if (bytes.length !== stat.size) {
    throw coreError('FAMILY_CORE_ARTIFACT_INVALID', 409, 'The Family Core candidate changed while it was being read.');
  }
  const after = await fs.lstat(file);
  if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || after.size !== stat.size
    || (stat.ino && after.ino && (stat.dev !== after.dev || stat.ino !== after.ino))) {
    throw coreError('FAMILY_CORE_ARTIFACT_INVALID', 409, 'The Family Core candidate changed while it was being verified.');
  }
  return { bytes, size: bytes.length, sha256: digest(bytes) };
}

function validateArtifact(value) {
  if (!exactKeys(value, [
    'fileName', 'sha256', 'size', 'modId', 'version', 'minecraftVersion', 'loaderVersion',
    'registryRelativePath', 'promotedAt', 'backupId',
  ]) || value.fileName !== FILE_NAME || value.modId !== MOD_ID || !SHA256.test(value.sha256 ?? '')
    || !Number.isInteger(value.size) || value.size < 22 || value.size > MAX_ARTIFACT_BYTES
    || typeof value.version !== 'string' || value.version.length < 1 || value.version.length > 96
    || typeof value.minecraftVersion !== 'string' || value.minecraftVersion.length < 1
    || typeof value.loaderVersion !== 'string' || value.loaderVersion.length < 1
    || value.registryRelativePath !== `state/first-party-core/artifacts/${value.sha256}.jar`
    || !Number.isFinite(Date.parse(value.promotedAt)) || !BACKUP_ID.test(value.backupId ?? '')) {
    throw coreError('FAMILY_CORE_STATE_INVALID', 409, 'The authenticated Family Core artifact record is invalid.');
  }
  return Object.freeze(structuredClone(value));
}

function validateManifest(value, instanceId = FAMILY_ID) {
  if (!exactKeys(value, ['schemaVersion', 'instanceId', 'generation', 'active', 'previous', 'updatedAt'])
    || value.schemaVersion !== 2 || value.instanceId !== instanceId || !SHA256.test(value.generation ?? '')
    || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw coreError('FAMILY_CORE_STATE_INVALID', 409, 'The authenticated Family Core manifest is invalid.');
  }
  const active = value.active === null ? null : validateArtifact(value.active);
  const previous = value.previous === null ? null : validateArtifact(value.previous);
  const identity = { schemaVersion: 2, instanceId, active, previous, updatedAt: value.updatedAt };
  if (digest(canonical(identity)) !== value.generation) {
    throw coreError('FAMILY_CORE_STATE_INVALID', 409, 'The Family Core manifest generation is invalid.');
  }
  return Object.freeze({ ...identity, generation: value.generation });
}

function buildManifest(instanceId, active, previous, updatedAt) {
  const identity = { schemaVersion: 2, instanceId, active, previous, updatedAt };
  return { ...identity, generation: digest(canonical(identity)) };
}

function validateTransaction(value) {
  if (!exactKeys(value, [
    'schemaVersion', 'transactionId', 'instanceId', 'phase', 'previousManifest', 'nextManifest',
    'temporaryFileName', 'previousFileName', 'createdAt', 'updatedAt',
  ]) || value.schemaVersion !== 2 || !TRANSACTION_ID.test(value.transactionId ?? '')
    || value.instanceId !== FAMILY_ID || !TRANSACTION_PHASES.has(value.phase)
    || value.temporaryFileName !== `.${FILE_NAME}.${value.transactionId}.tmp`
    || value.previousFileName !== `${value.transactionId}.previous.jar`
    || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw coreError('FAMILY_CORE_RECOVERY_REQUIRED', 409, 'The Family Core transaction marker is invalid.');
  }
  return Object.freeze({
    ...structuredClone(value),
    previousManifest: validateManifest(value.previousManifest, FAMILY_ID),
    nextManifest: validateManifest(value.nextManifest, FAMILY_ID),
  });
}

async function atomicWrite(file, bytes) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  try { await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}

export class FamilyCoreArtifactManager {
  #queue = Promise.resolve();

  constructor(managedRoot, store, options = {}) {
    if (typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)) throw new TypeError('managedRoot must be absolute');
    if (!store || typeof store.get !== 'function') throw new TypeError('A compatible instance store is required');
    if (typeof options.withInstanceLock !== 'function' || typeof options.assertQuiescentWithinInstanceLock !== 'function') {
      throw new TypeError('The exact process lifecycle boundary is required');
    }
    if (typeof options.assertVerifiedBackupWithinInstanceLock !== 'function') {
      throw new TypeError('A verified snapshot boundary is required');
    }
    this.managedRoot = path.resolve(managedRoot);
    this.stateRoot = path.join(this.managedRoot, 'state', 'first-party-core');
    this.artifactRoot = path.join(this.stateRoot, 'artifacts');
    this.manifestRoot = path.join(this.stateRoot, 'manifests');
    this.transactionRoot = path.join(this.stateRoot, 'transactions');
    this.store = store;
    this.withInstanceLock = options.withInstanceLock;
    this.assertQuiescentWithinInstanceLock = options.assertQuiescentWithinInstanceLock;
    this.assertVerifiedBackupWithinInstanceLock = options.assertVerifiedBackupWithinInstanceLock;
    this.acquireIntegrityKey = options.acquireIntegrityKey ?? acquireLaunchIntegrityKey;
    this.inspectArtifact = options.inspectArtifact ?? inspectFabricModJar;
    this.validateGraph = options.validateGraph ?? validateFabricCandidateGraph;
    this.now = options.now ?? (() => new Date().toISOString());
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
    this.initialized = false;
  }

  async initialize() {
    await fs.mkdir(this.artifactRoot, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.manifestRoot, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.transactionRoot, { recursive: true, mode: 0o700 });
    const key = await this.acquireIntegrityKey(this.managedRoot, { createIfMissing: true });
    await key.release();
    this.initialized = true;
    await this.#recoverTransactions();
    if (!await this.store.get(FAMILY_ID)) {
      return { state: 'unprovisioned', generation: null, artifact: null, rollbackAvailable: false };
    }
    return this.status(FAMILY_ID);
  }

  #run(operation) {
    const current = this.#queue.catch(() => undefined).then(operation);
    this.#queue = current;
    return current;
  }

  #manifestFile(instanceId) { return path.join(this.manifestRoot, `${instanceId}.v2.json`); }
  #transactionFile(transactionId) { return path.join(this.transactionRoot, `${transactionId}.v2.json`); }

  async #withKey(operation) {
    const lease = await this.acquireIntegrityKey(this.managedRoot, { createIfMissing: false });
    try {
      await lease.assertHeld();
      const result = await operation(lease.key, lease);
      await lease.assertHeld();
      return result;
    } finally { await lease.release(); }
  }

  async #readManifest(instanceId = FAMILY_ID) {
    const file = this.#manifestFile(instanceId);
    let bytes;
    try { bytes = await fs.readFile(file); }
    catch (error) {
      if (error?.code === 'ENOENT') return buildManifest(instanceId, null, null, new Date(0).toISOString());
      throw error;
    }
    if (bytes.length < 2 || bytes.length > 128 * 1024) throw coreError('FAMILY_CORE_STATE_INVALID', 409, 'The Family Core manifest is not a bounded file.');
    let wrapper;
    try { wrapper = JSON.parse(bytes.toString('utf8')); }
    catch { throw coreError('FAMILY_CORE_STATE_INVALID', 409, 'The Family Core manifest is not valid JSON.'); }
    if (!exactKeys(wrapper, ['schemaVersion', 'manifest', 'mac']) || wrapper.schemaVersion !== 2 || !SHA256.test(wrapper.mac ?? '')) {
      throw coreError('FAMILY_CORE_STATE_INVALID', 409, 'The Family Core manifest wrapper is invalid.');
    }
    return this.#withKey(async (key) => {
      const expected = crypto.createHmac('sha256', key).update(canonical(wrapper.manifest)).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(wrapper.mac, 'hex'))) {
        throw coreError('FAMILY_CORE_STATE_INVALID', 409, 'The Family Core manifest authentication failed.');
      }
      return validateManifest(wrapper.manifest, instanceId);
    });
  }

  async #writeManifest(manifest) {
    const validated = validateManifest(manifest, manifest.instanceId);
    await this.#withKey(async (key) => {
      const wrapper = {
        schemaVersion: 2,
        manifest: validated,
        mac: crypto.createHmac('sha256', key).update(canonical(validated)).digest('hex'),
      };
      await atomicWrite(this.#manifestFile(validated.instanceId), `${JSON.stringify(wrapper, null, 2)}\n`);
    });
    return validated;
  }

  async #writeTransaction(transaction) {
    const validated = validateTransaction(transaction);
    await this.#withKey(async (key) => {
      const wrapper = {
        schemaVersion: 2,
        transaction: validated,
        mac: crypto.createHmac('sha256', key).update(`family-core-transaction-v2\n${canonical(validated)}`).digest('hex'),
      };
      await atomicWrite(this.#transactionFile(validated.transactionId), `${JSON.stringify(wrapper, null, 2)}\n`);
    });
    return validated;
  }

  async #readTransaction(file) {
    const bytes = await fs.readFile(file);
    if (bytes.length < 2 || bytes.length > 256 * 1024) {
      throw coreError('FAMILY_CORE_RECOVERY_REQUIRED', 409, 'A Family Core transaction marker is not bounded.');
    }
    let wrapper;
    try { wrapper = JSON.parse(bytes.toString('utf8')); }
    catch { throw coreError('FAMILY_CORE_RECOVERY_REQUIRED', 409, 'A Family Core transaction marker is not valid JSON.'); }
    if (!exactKeys(wrapper, ['schemaVersion', 'transaction', 'mac']) || wrapper.schemaVersion !== 2 || !SHA256.test(wrapper.mac ?? '')) {
      throw coreError('FAMILY_CORE_RECOVERY_REQUIRED', 409, 'A Family Core transaction wrapper is invalid.');
    }
    return this.#withKey(async (key) => {
      const expected = crypto.createHmac('sha256', key)
        .update(`family-core-transaction-v2\n${canonical(wrapper.transaction)}`).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(wrapper.mac, 'hex'))) {
        throw coreError('FAMILY_CORE_RECOVERY_REQUIRED', 409, 'A Family Core transaction authentication check failed.');
      }
      return validateTransaction(wrapper.transaction);
    });
  }

  async #fileIdentity(file) {
    try {
      const value = await boundedRegularFile(file);
      return { sha256: value.sha256, size: value.size };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async #recoverTransaction(transaction) {
    const instance = await this.#instance(transaction.instanceId);
    await this.assertQuiescentWithinInstanceLock(instance.id);
    const target = path.join(instance.directory, 'mods', FILE_NAME);
    const temporary = path.join(instance.directory, 'mods', transaction.temporaryFileName);
    const previous = path.join(this.transactionRoot, transaction.previousFileName);
    const [targetIdentity, previousIdentity] = await Promise.all([
      this.#fileIdentity(target), this.#fileIdentity(previous),
    ]);
    const desired = transaction.nextManifest.active;
    const prior = transaction.previousManifest.active;
    const targetIsDesired = desired === null
      ? targetIdentity === null && (prior === null || previousIdentity !== null)
      : targetIdentity?.sha256 === desired.sha256 && targetIdentity.size === desired.size;
    const targetIsPrior = prior === null
      ? targetIdentity === null
      : targetIdentity?.sha256 === prior.sha256 && targetIdentity.size === prior.size;
    if (targetIsDesired) {
      if (desired) await this.#verifyRegistryArtifact(desired);
      await this.#writeManifest(transaction.nextManifest);
    } else if (targetIsPrior) {
      await this.#writeManifest(transaction.previousManifest);
    } else if (targetIdentity === null && prior && previousIdentity?.sha256 === prior.sha256 && previousIdentity.size === prior.size) {
      await fs.rename(previous, target);
      await this.#writeManifest(transaction.previousManifest);
    } else {
      throw coreError('FAMILY_CORE_RECOVERY_REQUIRED', 409, 'Family Core publication cannot be reconciled automatically.');
    }
    await fs.rm(temporary, { force: true });
    await fs.rm(previous, { force: true });
    await fs.rm(this.#transactionFile(transaction.transactionId), { force: true });
  }

  async #recoverTransactions() {
    const entries = await fs.readdir(this.transactionRoot, { withFileTypes: true });
    const markerEntries = entries.filter((entry) => entry.name.endsWith('.v2.json'));
    const allowed = new Set(markerEntries.flatMap((entry) => {
      const transactionId = entry.name.slice(0, -'.v2.json'.length);
      return [entry.name, `${transactionId}.previous.jar`];
    }));
    if (markerEntries.length > 1 || entries.some((entry) => !entry.isFile() || !allowed.has(entry.name))) {
      throw coreError('FAMILY_CORE_RECOVERY_REQUIRED', 409, 'The Family Core recovery namespace is ambiguous.');
    }
    for (const entry of markerEntries) {
      const transaction = await this.#readTransaction(path.join(this.transactionRoot, entry.name));
      await this.withInstanceLock(transaction.instanceId, () => this.#recoverTransaction(transaction));
    }
  }

  async #instance(instanceId) {
    if (instanceId !== FAMILY_ID) throw coreError('FAMILY_CORE_INSTANCE_INVALID', 404, 'Only the Family Server can receive first-party core artifacts.');
    const instance = await this.store.get(instanceId);
    if (!instance || instance.projectId !== 'family-server' || instance.kind !== 'server'
      || typeof instance.directory !== 'string' || !path.isAbsolute(instance.directory)) {
      throw coreError('FAMILY_CORE_INSTANCE_INVALID', 404, 'The managed Family Server was not found.');
    }
    return instance;
  }

  async #verifyRegistryArtifact(artifact) {
    const target = path.join(this.managedRoot, ...artifact.registryRelativePath.split('/'));
    const verified = await boundedRegularFile(target);
    if (verified.sha256 !== artifact.sha256 || verified.size !== artifact.size) {
      throw coreError('FAMILY_CORE_INTEGRITY_FAILED', 409, 'The registered Family Core artifact failed integrity verification.');
    }
    return { ...verified, target };
  }

  async #verifyInstalled(instance, manifest) {
    const target = path.join(instance.directory, 'mods', FILE_NAME);
    if (manifest.active === null) {
      try {
        await fs.lstat(target);
        throw coreError('FAMILY_CORE_UNMANAGED', 409, 'An unmanaged Family Core JAR is present.');
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      return null;
    }
    const result = await boundedRegularFile(target);
    if (result.sha256 !== manifest.active.sha256 || result.size !== manifest.active.size) {
      throw coreError('FAMILY_CORE_INTEGRITY_FAILED', 409, 'The installed Family Core JAR does not match its authenticated manifest.');
    }
    return result;
  }

  async status(instanceId = FAMILY_ID) {
    if (!this.initialized) throw coreError('FAMILY_CORE_STATE_UNAVAILABLE', 503, 'The Family Core artifact manager is not initialized.');
    const instance = await this.#instance(instanceId);
    const manifest = await this.#readManifest(instanceId);
    await this.#verifyInstalled(instance, manifest);
    if (manifest.active) await this.#verifyRegistryArtifact(manifest.active);
    return {
      state: manifest.active ? 'installed' : 'disabled',
      generation: manifest.generation,
      artifact: manifest.active ? structuredClone(manifest.active) : null,
      rollbackAvailable: manifest.previous !== null,
    };
  }

  async #inspectCandidate(instance, sourcePath, expectedSha256, expectedSize, backupId) {
    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || !SHA256.test(expectedSha256 ?? '')
      || !Number.isInteger(expectedSize) || expectedSize < 22 || expectedSize > MAX_ARTIFACT_BYTES || !BACKUP_ID.test(backupId ?? '')) {
      throw coreError('FAMILY_CORE_ARTIFACT_INVALID', 400, 'The Family Core promotion request is invalid.');
    }
    const verified = await boundedRegularFile(sourcePath);
    if (verified.sha256 !== expectedSha256 || verified.size !== expectedSize) {
      throw coreError('FAMILY_CORE_ARTIFACT_INVALID', 409, 'The Family Core candidate does not match its pinned identity.');
    }
    const metadata = await this.inspectArtifact(sourcePath, {
      trustedCore: true, anchorRoot: path.dirname(sourcePath), trustedRoot: path.dirname(sourcePath),
    });
    if (!Array.isArray(metadata) || metadata.length !== 1 || metadata[0]?.ids?.length !== 1 || metadata[0].ids[0] !== MOD_ID) {
      throw coreError('FAMILY_CORE_ARTIFACT_INVALID', 409, 'The candidate is not the singular Mastermind Family Core Fabric mod.');
    }
    const coreMetadata = [];
    for (const fileName of CORE_FILES) {
      coreMetadata.push({ metadata: await this.inspectArtifact(path.join(instance.directory, 'mods', fileName), {
        trustedCore: true, anchorRoot: instance.directory, trustedRoot: instance.directory,
      }) });
    }
    this.validateGraph({
      artifacts: [{ metadata }], coreMetadata,
      minecraftVersion: instance.minecraftVersion,
      loaderVersion: instance.loaderVersion,
      javaMajor: instance.javaRuntime?.major,
    });
    const promotedAt = new Date(this.now()).toISOString();
    return validateArtifact({
      fileName: FILE_NAME,
      sha256: verified.sha256,
      size: verified.size,
      modId: MOD_ID,
      version: metadata[0].version,
      minecraftVersion: instance.minecraftVersion,
      loaderVersion: instance.loaderVersion,
      registryRelativePath: `state/first-party-core/artifacts/${verified.sha256}.jar`,
      promotedAt,
      backupId,
    });
  }

  async #publishRegistry(sourcePath, artifact) {
    const destination = path.join(this.managedRoot, ...artifact.registryRelativePath.split('/'));
    try {
      const existing = await boundedRegularFile(destination);
      if (existing.sha256 !== artifact.sha256 || existing.size !== artifact.size) {
        throw coreError('FAMILY_CORE_INTEGRITY_FAILED', 409, 'The content-addressed Family Core registry entry is occupied.');
      }
      return destination;
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const source = await boundedRegularFile(sourcePath);
    await fs.writeFile(destination, source.bytes, { flag: 'wx', mode: 0o400 });
    await this.#verifyRegistryArtifact(artifact);
    return destination;
  }

  async #activateWithinLock(instance, current, next, sourcePath = null) {
    await this.assertQuiescentWithinInstanceLock(instance.id);
    if (next) await this.assertVerifiedBackupWithinInstanceLock(instance.id, next.backupId);
    await this.#verifyInstalled(instance, current);
    if (next) {
      if (sourcePath) await this.#publishRegistry(sourcePath, next);
      await this.#verifyRegistryArtifact(next);
    }
    const target = path.join(instance.directory, 'mods', FILE_NAME);
    const transactionId = this.randomUUID();
    if (!TRANSACTION_ID.test(transactionId)) throw coreError('FAMILY_CORE_STATE_INVALID', 409, 'Family Core transaction identity generation failed.');
    const temporaryFileName = `.${FILE_NAME}.${transactionId}.tmp`;
    const previousFileName = `${transactionId}.previous.jar`;
    const temporary = path.join(instance.directory, 'mods', temporaryFileName);
    const previousTarget = path.join(this.transactionRoot, previousFileName);
    if (next) {
      const registry = path.join(this.managedRoot, ...next.registryRelativePath.split('/'));
      const bytes = await fs.readFile(registry);
      await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o400 });
      const staged = await boundedRegularFile(temporary);
      if (staged.sha256 !== next.sha256 || staged.size !== next.size) throw coreError('FAMILY_CORE_INTEGRITY_FAILED', 409, 'The staged Family Core JAR failed verification.');
    }
    const createdAt = new Date(this.now()).toISOString();
    const nextManifest = buildManifest(instance.id, next, current.active, createdAt);
    let transaction;
    try {
      transaction = await this.#writeTransaction({
        schemaVersion: 2,
        transactionId,
        instanceId: instance.id,
        phase: 'prepared',
        previousManifest: current,
        nextManifest,
        temporaryFileName,
        previousFileName,
        createdAt,
        updatedAt: createdAt,
      });
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    let retained = false;
    let targetChanged = false;
    try {
      if (current.active) { await fs.rename(target, previousTarget); retained = true; targetChanged = true; }
      if (next) { await fs.rename(temporary, target); targetChanged = true; }
      transaction = await this.#writeTransaction({
        ...transaction, phase: 'candidate-published', updatedAt: new Date(this.now()).toISOString(),
      });
      const manifest = await this.#writeManifest(nextManifest);
      transaction = await this.#writeTransaction({
        ...transaction, phase: 'manifest-committed', updatedAt: new Date(this.now()).toISOString(),
      });
      await fs.rm(previousTarget, { force: true });
      await fs.rm(this.#transactionFile(transactionId), { force: true });
      return manifest;
    } catch (error) {
      let restored = true;
      if (targetChanged && next) await fs.rm(target, { force: true }).catch(() => { restored = false; });
      if (retained) await fs.rename(previousTarget, target).catch(() => { restored = false; });
      await this.#writeManifest(current).catch(() => { restored = false; });
      if (restored) {
        await fs.rm(temporary, { force: true });
        await fs.rm(previousTarget, { force: true });
        await fs.rm(this.#transactionFile(transactionId), { force: true });
      }
      throw error;
    }
  }

  async promote({ instanceId = FAMILY_ID, sourcePath, expectedSha256, expectedSize, backupId, confirmation }) {
    if (confirmation !== CONFIRM_PROMOTION) throw coreError('FAMILY_CORE_CONFIRMATION_REQUIRED', 409, `Confirmation must be '${CONFIRM_PROMOTION}'.`);
    return this.#run(async () => {
      const instance = await this.#instance(instanceId);
      const candidate = await this.#inspectCandidate(instance, sourcePath, expectedSha256, expectedSize, backupId);
      return this.withInstanceLock(instanceId, async () => {
        const current = await this.#readManifest(instanceId);
        if (sameArtifact(current.active, candidate)) return { action: 'already-installed', manifest: current };
        const manifest = await this.#activateWithinLock(instance, current, candidate, sourcePath);
        return { action: 'promoted', manifest };
      });
    });
  }

  async rollback({ instanceId = FAMILY_ID, expectedGeneration, confirmation }) {
    if (confirmation !== CONFIRM_ROLLBACK) throw coreError('FAMILY_CORE_CONFIRMATION_REQUIRED', 409, `Confirmation must be '${CONFIRM_ROLLBACK}'.`);
    return this.#run(() => this.withInstanceLock(instanceId, async () => {
      const instance = await this.#instance(instanceId);
      const current = await this.#readManifest(instanceId);
      if (!SHA256.test(expectedGeneration ?? '') || expectedGeneration !== current.generation) {
        throw coreError('FAMILY_CORE_STATE_CHANGED', 409, 'The Family Core generation changed before rollback.');
      }
      const manifest = await this.#activateWithinLock(instance, current, current.previous);
      return { action: current.previous ? 'rolled-back' : 'disabled', manifest };
    }));
  }

  async acquireLaunchBindingWithinInstanceLock(instanceId = FAMILY_ID) {
    const inspect = async () => {
      const instance = await this.#instance(instanceId);
      const manifest = await this.#readManifest(instanceId);
      await this.#verifyInstalled(instance, manifest);
      if (manifest.active) await this.#verifyRegistryArtifact(manifest.active);
      return Object.freeze({
        schemaVersion: 2,
        instanceId,
        generation: manifest.generation,
        artifacts: Object.freeze(manifest.active ? [Object.freeze({
          fileName: manifest.active.fileName,
          sha256: manifest.active.sha256,
          size: manifest.active.size,
          modId: manifest.active.modId,
          version: manifest.active.version,
        })] : []),
      });
    };
    const binding = await inspect();
    const identity = canonical(binding);
    let released = false;
    return {
      binding,
      async assertHeld() {
        if (released) throw coreError('FAMILY_CORE_STATE_UNAVAILABLE', 503, 'The Family Core launch binding was already released.');
        if (canonical(await inspect()) !== identity) throw coreError('FAMILY_CORE_INTEGRITY_FAILED', 409, 'The Family Core launch binding changed while launch was pending.');
        return true;
      },
      async release() { released = true; },
    };
  }

  async assertSafeForLifecycleWithinInstanceLock(instanceId = FAMILY_ID) {
    await this.status(instanceId);
    return true;
  }
}

export const FAMILY_CORE_ARTIFACT_FILE = FILE_NAME;
export const FAMILY_CORE_PROMOTION_CONFIRMATION = CONFIRM_PROMOTION;
export const FAMILY_CORE_ROLLBACK_CONFIRMATION = CONFIRM_ROLLBACK;
