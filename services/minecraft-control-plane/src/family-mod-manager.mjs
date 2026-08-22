import crypto from 'node:crypto';
import { constants as FS_CONSTANTS } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateInstanceId } from './config.mjs';
import {
  inspectFabricModJar, MODRINTH_CORE_PROJECTS, sha512File, validateFabricCandidateGraph,
} from './modrinth-client.mjs';
import {
  acquireWindowsDirectoryGuard,
  acquireWindowsFileGuard,
  assertWindowsFilesystemEntry,
} from './windows-filesystem-safety.mjs';

const FAMILY_ID = 'family-server';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CATALOG_REF = /^modref-[a-f0-9]{64}$/;
const INSTALLED_REF = /^modinst-[a-f0-9]{64}$/;
const PLAN_REF = /^modplan-[a-f0-9]{64}$/;
const TX_REF = /^modtx-[a-f0-9]{64}$/;
const SNAPSHOT_REF = /^modsnap-[a-f0-9]{64}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_MODS = 64;
const MAX_MOD_DIR_ENTRIES = 500;
const MAX_COPY_BYTES = 1024 * 1024 * 1024;
const MAX_ACTIVE_PLANS = 8;
const MAX_RETAINED_ROLLBACKS = 4;
const MAX_PLAN_REQUEST_RECORDS = MAX_ACTIVE_PLANS + MAX_RETAINED_ROLLBACKS;
const MAX_PLAN_INSTANCE_ENTRIES = 1 + (MAX_PLAN_REQUEST_RECORDS * 2);
const MAX_PLAN_TREE_ENTRIES = (MAX_MOD_DIR_ENTRIES * 2) + 2;
const MAX_RETAINED_ROLLBACK_BYTES = 1024 * 1024 * 1024;
const MAX_PLAN_BYTES = 2 * 1024 * 1024 * 1024;
const MIN_FREE_BYTES = 1024 * 1024 * 1024;
const MAX_TRANSACTION_RECORDS = 4096;
const MAX_TRANSACTION_INSTANCE_ENTRIES = MAX_TRANSACTION_RECORDS + 1;
const MAX_TRANSACTION_TREE_ENTRIES = (MAX_TRANSACTION_RECORDS * 3) + (MAX_MOD_DIR_ENTRIES * 3) + 16;
const MAX_TRANSACTION_STATE_BYTES = 64 * 1024 * 1024;
const CORE_FILES = Object.freeze({
  fabricApi: 'fabric-api.jar', geyser: 'geyser-fabric.jar', floodgate: 'floodgate-fabric.jar',
});
const FIRST_PARTY_CORE_FILE = 'mastermind-family-core.jar';
const CORE_NAMES = Object.freeze({ fabricApi: 'Fabric API', geyser: 'Geyser', floodgate: 'Floodgate' });
const SAFE_ENVIRONMENTS = new Set(['server_only', 'dedicated_server_only', 'server_only_client_optional']);
const CONFIRMATIONS = Object.freeze({
  install: 'INSTALL THIRD-PARTY MOD CODE', update: 'UPDATE THIRD-PARTY MOD CODE',
  remove: 'REMOVE MANAGED MODS', rollback: 'RESTORE MOD SNAPSHOT',
});
const FINAL_STATES = new Set(['committed', 'rolled-back', 'completion-unknown', 'manual-recovery-required', 'rejected-before-mutation']);

function modError(code, statusCode, message) { return Object.assign(new Error(message), { code, statusCode }); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hmac(key, value) { return crypto.createHmac('sha256', key).update(value).digest('hex'); }
function clone(value) { return structuredClone(value); }
function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function safeText(value, maximum, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gu, '').trim();
  return text.slice(0, maximum) || fallback;
}
function nowIso(now) {
  const value = now();
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('The local clock returned an invalid timestamp');
  return new Date(value).toISOString();
}
function stateError(code, message, statusCode = 409) { return modError(code, statusCode, message); }

export class FamilyModManager {
  #queue = Promise.resolve();
  #auditQueue = Promise.resolve();
  #catalog = new Map();
  #recovery = new Map();

  constructor(managedRoot, store, client, options = {}) {
    if (typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)) throw new TypeError('managedRoot must be an absolute path');
    if (!store || typeof store.get !== 'function') throw new TypeError('A compatible instance store is required');
    if (!client || typeof client.search !== 'function' || typeof client.resolveGraph !== 'function' || typeof client.download !== 'function') {
      throw new TypeError('A compatible Modrinth client is required');
    }
    if (typeof options.withInstanceLock !== 'function' || typeof options.assertQuiescentWithinInstanceLock !== 'function') {
      throw new TypeError('The exact process lifecycle boundary is required');
    }
    this.managedRoot = path.resolve(managedRoot);
    this.serverRoot = path.join(this.managedRoot, 'servers');
    this.stateRoot = path.join(this.managedRoot, 'state', 'family-mods');
    this.manifestRoot = path.join(this.stateRoot, 'manifests');
    this.planRoot = path.join(this.stateRoot, 'plans');
    this.transactionRoot = path.join(this.stateRoot, 'transactions');
    this.auditFile = path.join(this.stateRoot, 'audit.jsonl');
    this.keyFile = path.join(this.stateRoot, 'hmac.key');
    this.store = store;
    this.client = client;
    this.withInstanceLock = options.withInstanceLock;
    this.assertQuiescentWithinInstanceLock = options.assertQuiescentWithinInstanceLock;
    this.assertWorldMutationAllowedWithinInstanceLock = options.assertWorldMutationAllowedWithinInstanceLock ?? null;
    if (this.assertWorldMutationAllowedWithinInstanceLock !== null
      && typeof this.assertWorldMutationAllowedWithinInstanceLock !== 'function') {
      throw new TypeError('assertWorldMutationAllowedWithinInstanceLock must be a function');
    }
    this.now = options.now ?? (() => new Date().toISOString());
    this.randomBytes = options.randomBytes ?? crypto.randomBytes;
    this.planTtlMs = options.planTtlMs ?? PLAN_TTL_MS;
    this.statfs = options.statfs;
    if (this.statfs !== undefined && typeof this.statfs !== 'function') throw new TypeError('statfs must be a function');
    this.onPhase = options.onPhase ?? (() => undefined);
    this.platform = options.platform ?? process.platform;
    if (typeof this.platform !== 'string') throw new TypeError('platform must be a string');
    this.fileGuard = options.fileGuard ?? ((file) => acquireWindowsFileGuard(file, { unlink: fs.unlink }));
    this.directoryGuard = options.directoryGuard
      ?? ((directory) => acquireWindowsDirectoryGuard(directory, { borrowHeld: true }));
    this.filesystemEntryVerifier = options.filesystemEntryVerifier ?? assertWindowsFilesystemEntry;
    if (typeof this.fileGuard !== 'function' || typeof this.directoryGuard !== 'function'
      || typeof this.filesystemEntryVerifier !== 'function') {
      throw new TypeError('The private mod key filesystem boundary is required');
    }
    this.key = null;
    this.stackValidationPrepared = false;
    this.initialized = false;
  }

  async prepareStackValidation() {
    if (this.stackValidationPrepared && this.key) {
      await this.#assertKeyContinuity();
      return true;
    }
    await this.#ensureRoots();
    this.key = await this.#loadKey();
    this.stackValidationPrepared = true;
    return true;
  }

  async preflightRecoveryEvidence() {
    if (!this.stackValidationPrepared || !this.key) {
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod recovery verifier is not initialized.');
    }
    await this.#assertKeyContinuity();
    const instances = [];
    let recordCount = 0;
    let aggregateBytes = 0;
    const rootChain = await acquireModGuardChain(
      this.managedRoot, this.transactionRoot, this.directoryGuard, this.filesystemEntryVerifier,
    );
    try {
      const instanceEntries = await safeReadDir(this.transactionRoot, 1);
      if (instanceEntries.length > 1) throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected managed mod recovery namespace.');
      for (const instanceEntry of instanceEntries) {
        if (!instanceEntry.isDirectory() || instanceEntry.isSymbolicLink() || instanceEntry.name !== FAMILY_ID) {
          throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected managed mod recovery namespace.');
        }
        const instanceRoot = path.join(this.transactionRoot, instanceEntry.name);
        const instanceGuard = await this.directoryGuard(instanceRoot);
        try {
          instanceGuard.assertHeld?.();
          await this.filesystemEntryVerifier(instanceRoot);
          const entries = await safeReadDir(instanceRoot, MAX_TRANSACTION_INSTANCE_ENTRIES);
          for (const entry of entries) {
            if (entry.name === 'operations') {
              if (!entry.isDirectory() || entry.isSymbolicLink()) {
                throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected managed mod operation namespace.');
              }
              continue;
            }
            if (!entry.isDirectory() || entry.isSymbolicLink() || !TX_REF.test(entry.name)) {
              throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected managed mod recovery evidence.');
            }
            recordCount += 1;
            if (recordCount > MAX_TRANSACTION_RECORDS) throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod recovery evidence exceeds its safe bound.');
            const transactionDirectory = path.join(instanceRoot, entry.name);
            const transactionGuard = await this.directoryGuard(transactionDirectory);
            try {
              transactionGuard.assertHeld?.();
              await this.filesystemEntryVerifier(transactionDirectory);
              const markerFile = path.join(transactionDirectory, 'marker.json');
              const stat = await fs.lstat(markerFile);
              aggregateBytes += stat.size;
              if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 2 || stat.size > MAX_STATE_BYTES
                || aggregateBytes > MAX_TRANSACTION_STATE_BYTES) {
                throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod recovery evidence exceeds its safe byte bound.');
              }
              const marker = await readJsonFileGuarded(markerFile, this.fileGuard, this.filesystemEntryVerifier);
              validateAuthenticatedMarker(marker, instanceEntry.name, entry.name, this.key);
              if (!['committed', 'rolled-back', 'rejected-before-mutation'].includes(marker.phase)) {
                instances.push({ instanceId: marker.instanceId, transactionRef: marker.transactionRef });
              }
            } finally { await transactionGuard.release(); }
          }
          const operationsRoot = path.join(instanceRoot, 'operations');
          let operationsGuard = null;
          try {
            if (await exists(operationsRoot)) {
              operationsGuard = await this.directoryGuard(operationsRoot);
              operationsGuard.assertHeld?.();
              await this.filesystemEntryVerifier(operationsRoot);
            }
            for (const operationEntry of await safeReadDir(operationsRoot, MAX_TRANSACTION_RECORDS - recordCount)) {
              if (!operationEntry.isFile() || operationEntry.isSymbolicLink() || operationEntry.nlink > 1
                || !/^([0-9a-f-]{36})\.json$/.test(operationEntry.name)) {
                throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected managed mod operation evidence.');
              }
              recordCount += 1;
              if (recordCount > MAX_TRANSACTION_RECORDS) throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod recovery evidence exceeds its safe bound.');
              const operationFile = path.join(operationsRoot, operationEntry.name);
              const stat = await fs.lstat(operationFile);
              aggregateBytes += stat.size;
              if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 2 || stat.size > MAX_STATE_BYTES
                || aggregateBytes > MAX_TRANSACTION_STATE_BYTES) {
                throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod operation evidence exceeds its safe byte bound.');
              }
              const requestId = operationEntry.name.slice(0, -5);
              const operation = await readJsonFileGuarded(operationFile, this.fileGuard, this.filesystemEntryVerifier);
              validateAuthenticatedOperation(operation, requestId, this.key);
            }
          } finally { await operationsGuard?.release(); }
        } finally { await instanceGuard.release(); }
      }
      await assertModGuardChainHeld(rootChain, this.filesystemEntryVerifier);
    } finally { await releaseModGuards(...rootChain.map((entry) => entry.guard).reverse()); }
    await this.#assertKeyContinuity();
    return { domain: 'mods', instances: instances.sort((left, right) => left.transactionRef.localeCompare(right.transactionRef)) };
  }

  async initialize() {
    if (typeof this.assertWorldMutationAllowedWithinInstanceLock !== 'function') {
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'The managed world safety boundary is unavailable.');
    }
    try {
      await this.prepareStackValidation();
      if (this.platform === 'win32') {
        let evidence;
        let hasTransactionPayload;
        try {
          evidence = await this.preflightRecoveryEvidence();
          hasTransactionPayload = await this.#hasWindowsTransactionPayload();
        } catch {
          this.#recovery.set(FAMILY_ID, { transactionRef: `modtx-${'0'.repeat(64)}`, state: 'manual-recovery-required' });
          throw modError('MOD_MANUAL_RECOVERY_REQUIRED', 409, 'Managed mod recovery evidence requires verified repair.');
        }
        if (hasTransactionPayload || evidence.instances.length > 0) {
          const transactionRef = evidence.instances[0]?.transactionRef ?? `modtx-${'0'.repeat(64)}`;
          this.#recovery.set(FAMILY_ID, { transactionRef, state: 'manual-recovery-required' });
          throw modError('MOD_MANUAL_RECOVERY_REQUIRED', 409, 'Managed mod recovery evidence requires verified repair.');
        }
        this.initialized = true;
        return [];
      }
      await this.#ensureInstanceRoots(FAMILY_ID);
      await this.#ensureAuditFile();
      await this.#auditTail();
      const recovery = await this.#recoverTransactions();
      this.initialized = true;
      return recovery;
    } catch (error) {
      if (!this.#recovery.has(FAMILY_ID)) {
        this.#recovery.set(FAMILY_ID, { transactionRef: `modtx-${'0'.repeat(64)}`, state: 'manual-recovery-required' });
      }
      throw error;
    }
  }

  async search(instanceId, input) {
    await this.#assertKeyContinuity();
    const request = validateSearch(input);
    const instance = await this.#instance(instanceId);
    const manifest = await this.#manifest(instance.id);
    const stack = this.#stack(instance, manifest, await this.#modsDigest(instance, manifest, { tolerateUnmanaged: true }));
    const result = await this.client.search({ ...request, minecraftVersion: instance.minecraftVersion });
    await this.#assertKeyContinuity();
    const candidates = result.items.map((item) => {
      const catalogRef = `modref-${hmac(this.key, canonical({ projectId: item.projectId, stack, nonce: this.randomBytes(16).toString('hex') }))}`;
      this.#catalog.set(catalogRef, { projectId: item.projectId, stack, expiresAt: Date.now() + this.planTtlMs });
      return { catalogRef, title: item.title, summary: item.description, author: item.author, compatibility: 'provisional' };
    });
    this.#pruneCatalog();
    return { stack, catalog: { query: request.query, offset: request.offset, limit: request.limit, totalHits: result.totalHits, candidates } };
  }

  async detail(instanceId, catalogRef) {
    await this.#assertKeyContinuity();
    const instance = await this.#instance(instanceId);
    const manifest = await this.#manifest(instance.id);
    const currentDigest = await this.#modsDigest(instance, manifest, { tolerateUnmanaged: true });
    const stack = this.#stack(instance, manifest, currentDigest);
    const catalog = this.#catalogEntry(catalogRef, stack);
    const resolved = await this.#resolveRoots(instance, manifest, new Set([catalog.projectId]));
    const root = resolved.nodes.get(catalog.projectId);
    const project = await this.client.project(catalog.projectId);
    const digest = sha256(canonical(resolved.ordered.map((node) => ({ projectId: node.projectId, versionId: node.versionId, sha512: node.file.sha512 }))));
    await this.#assertKeyContinuity();
    return {
      catalogRef, title: project.title, summary: project.description, author: project.author, licenseId: project.license,
      compatibility: {
        state: 'compatible', reason: null, minecraftVersion: instance.minecraftVersion, loader: 'fabric',
        environment: root.environment, versionType: 'release', evidence: 'version-metadata',
      },
      selectedVersion: { versionNumber: root.version, publishedAt: root.publishedAt },
      graph: {
        nodeCount: resolved.ordered.length,
        requiredDependencyCount: Math.max(0, resolved.ordered.length - 1), totalBytes: resolved.totalBytes,
        warnings: ['optional-dependencies-not-installed', 'server-metadata-not-bedrock-proof'], digest,
      },
    };
  }

  async inventory(instanceId) {
    await this.#assertKeyContinuity();
    const instance = await this.#instance(instanceId);
    const manifest = await this.#manifest(instance.id);
    const scan = await this.#scanMods(instance, manifest, { tolerateUnmanaged: true });
    await this.#inspectCore(instance);
    if (manifest.mods.some((item) => scan.hashes.get(item.fileName) !== item.sha512)) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'A managed installed mod failed integrity verification.');
    }
    const inventoryDigest = digestEntries(scan.entries);
    const stack = this.#stack(instance, manifest, inventoryDigest);
    const recovery = this.#publicRecovery(instance.id);
    const installed = manifest.mods.map((item) => ({
      installedRef: this.#installedRef(instance.id, item.projectId), title: item.title, versionNumber: item.version,
      environment: item.environment, role: manifest.roots.includes(item.projectId) ? 'explicit' : 'dependency',
      requiredByCount: item.requiredBy.length, managedCore: false, installedAt: item.installedAt,
    }));
    await this.#assertKeyContinuity();
    return { stack, recovery, installed, unmanaged: { present: scan.unmanagedCount > 0, count: scan.unmanagedCount } };
  }

  async createPlan(instanceId, input) {
    const request = validatePlanRequest(input);
    this.#assertMutationsAvailable();
    return this.withInstanceLock(instanceId, () => this.#serialized(() => this.#createPlanWithinLock(instanceId, request)));
  }

  setWorldInterlock(callback) {
    if (typeof callback !== 'function') throw new TypeError('world interlock must be a function');
    if (this.initialized) throw new TypeError('world interlock must be installed before mod-manager initialization');
    this.assertWorldMutationAllowedWithinInstanceLock = callback;
  }

  async stackBindingWithinInstanceLock(instanceId = FAMILY_ID) {
    if (!this.stackValidationPrepared || !this.key) {
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod stack verifier is not initialized.');
    }
    await this.#assertKeyContinuity();
    await this.assertSafeForLifecycle({ instanceId });
    const instance = await this.#instance(instanceId);
    const manifest = await this.#manifest(instance.id);
    const scan = await this.#scanMods(instance, manifest, { tolerateUnmanaged: false });
    const stack = this.#stack(instance, manifest, digestEntries(scan.entries));
    await this.#assertKeyContinuity();
    return stack;
  }

  async execute(instanceId, input) {
    const request = validateActionRequest(input);
    this.#assertMutationsAvailable();
    const replay = await this.operation(instanceId, request.requestId, { allowMissing: true });
    if (replay) {
      if (replay.planId !== request.planId) throw modError('MOD_REQUEST_ID_CONFLICT', 409, 'requestId was already used for a different mod action.');
      if (request.confirmation !== CONFIRMATIONS[replay.operation]) throw modError('MOD_REQUEST_ID_CONFLICT', 409, 'requestId was already used with different approval data.');
      return replay;
    }
    return this.withInstanceLock(instanceId, () => this.#serialized(() => this.#executeWithinLock(instanceId, request)));
  }

  async operation(instanceId, requestId, options = {}) {
    await this.#assertKeyContinuity();
    normalizeInstance(instanceId); normalizeUuid(requestId);
    const file = this.#operationFile(instanceId, requestId);
    const operationsRoot = path.dirname(file);
    let ancestorChain = null;
    let value;
    try {
      ancestorChain = await acquireModGuardChain(
        this.managedRoot, operationsRoot, this.directoryGuard, this.filesystemEntryVerifier,
      );
      value = await readJsonFileGuarded(file, this.fileGuard, this.filesystemEntryVerifier);
      await assertModGuardChainHeld(ancestorChain, this.filesystemEntryVerifier);
    } catch (error) {
      if (error?.code === 'ENOENT' && options.allowMissing) {
        await releaseModGuards(...(ancestorChain ?? []).map((entry) => entry.guard).reverse());
        ancestorChain = null;
        await this.#assertKeyContinuity();
        return null;
      }
      if (error?.code === 'ENOENT') throw modError('MOD_OPERATION_NOT_FOUND', 404, 'The mod operation was not found.');
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'The mod operation journal is unavailable.');
    } finally {
      await releaseModGuards(...(ancestorChain ?? []).map((entry) => entry.guard).reverse());
    }
    try { validateAuthenticatedOperation(value, requestId, this.key); }
    catch { throw modError('MOD_STATE_UNAVAILABLE', 503, 'The mod operation journal failed authentication.'); }
    await this.#assertKeyContinuity();
    return publicOperation(value);
  }

  async hasUserMods(instanceId = FAMILY_ID) {
    await this.#assertKeyContinuity();
    const manifest = await this.#manifest(instanceId);
    return manifest.roots.length > 0;
  }

  async assertStackUpdateAllowedWithinInstanceLock(instanceId = FAMILY_ID) {
    await this.#assertKeyContinuity();
    await this.assertSafeForLifecycle({ instanceId });
    const instance = await this.#instance(instanceId);
    const manifest = await this.#manifest(instance.id);
    const scan = await this.#scanMods(instance, manifest, { tolerateUnmanaged: true });
    if (manifest.mods.length > 0 || manifest.roots.length > 0 || scan.unmanagedCount > 0
      || scan.entries.length !== Object.keys(CORE_FILES).length) {
      throw modError('MODS_BLOCK_MINECRAFT_UPDATE', 409, 'Remove managed and unmanaged add-on mods before changing the Minecraft/Fabric stack.');
    }
    await this.#inspectCore(instance);
    return true;
  }

  async assertStartAllowedWithinInstanceLock(instanceId = FAMILY_ID) {
    await this.#assertKeyContinuity();
    await this.assertSafeForLifecycle({ instanceId });
    const instance = await this.#instance(instanceId); const manifest = await this.#manifest(instance.id);
    const scan = await this.#scanMods(instance, manifest, { tolerateUnmanaged: true });
    if (scan.unmanagedCount > 0 || manifest.mods.some((item) => scan.hashes.get(item.fileName) !== item.sha512)) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The installed mod inventory must be fully managed and verified before server start.');
    }
    await this.#inspectCore(instance);
    return true;
  }

  async acquireLaunchBindingWithinInstanceLock(instanceId = FAMILY_ID) {
    const inspect = async () => {
      await this.#assertKeyContinuity();
      await this.assertSafeForLifecycle({ instanceId });
      const instance = await this.#instance(instanceId);
      const manifest = await this.#manifest(instance.id);
      const scan = await this.#scanMods(instance, manifest, { tolerateUnmanaged: true });
      const firstPartyCoreCount = scan.entries.some((item) => item.name === FIRST_PARTY_CORE_FILE) ? 1 : 0;
      const expectedCount = Object.keys(CORE_FILES).length + manifest.mods.length + firstPartyCoreCount;
      if (scan.unmanagedCount !== 0 || scan.entries.length !== expectedCount
        || manifest.mods.some((item) => scan.hashes.get(item.fileName) !== item.sha512)) {
        throw modError('MOD_INTEGRITY_FAILED', 409, 'The exact managed mod inventory is unavailable for launch.');
      }
      await this.#inspectCore(instance);
      await this.#assertKeyContinuity();
      return {
        schemaVersion: 1,
        instanceId,
        generation: manifest.generation,
        inventoryDigest: digestEntries(scan.entries),
        mods: manifest.mods.map((item) => ({
          fileName: item.fileName, sha512: item.sha512, size: item.size,
        })),
      };
    };
    const binding = await inspect();
    const identity = canonical(binding);
    const publicBinding = structuredClone(binding);
    for (const mod of publicBinding.mods) Object.freeze(mod);
    Object.freeze(publicBinding.mods);
    Object.freeze(publicBinding);
    let released = false;
    return {
      binding: publicBinding,
      async assertHeld() {
        if (released) throw modError('MOD_STATE_UNAVAILABLE', 503, 'The managed mod launch binding was already released.');
        if (canonical(await inspect()) !== identity) {
          throw modError('MOD_INTEGRITY_FAILED', 409, 'The managed mod inventory changed while launch was pending.');
        }
        return true;
      },
      async release() { released = true; },
    };
  }

  async assertSafeForLifecycle({ instanceId }) {
    normalizeInstance(instanceId);
    if (!this.stackValidationPrepared || !this.key) {
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'The authenticated mod recovery boundary is unavailable.');
    }
    await this.#assertKeyContinuity();
    const recordedRecovery = this.#recovery.get(instanceId);
    if (recordedRecovery) {
      throw modError('MOD_MANUAL_RECOVERY_REQUIRED', 409, 'A mod transaction requires recovery before the Family Server can start or update.');
    }
    if (!this.initialized) {
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'The authenticated mod recovery boundary is unavailable.');
    }
    let evidence;
    try {
      evidence = await this.preflightRecoveryEvidence();
    } catch {
      this.#recovery.set(instanceId, { transactionRef: `modtx-${'0'.repeat(64)}`, state: 'manual-recovery-required' });
      throw modError('MOD_MANUAL_RECOVERY_REQUIRED', 409, 'A mod transaction requires recovery before the Family Server can start or update.');
    }
    await this.#assertKeyContinuity();
    const pending = evidence.instances.find((item) => item.instanceId === instanceId);
    if (pending) {
      this.#recovery.set(instanceId, { transactionRef: pending.transactionRef, state: 'manual-recovery-required' });
      throw modError('MOD_MANUAL_RECOVERY_REQUIRED', 409, 'A mod transaction requires recovery before the Family Server can start or update.');
    }
    return true;
  }

  #assertMutationsAvailable() {
    if (this.platform === 'win32') {
      throw modError('MOD_MUTATION_UNAVAILABLE', 503, 'Managed mod mutations are unavailable on this Windows safety boundary.');
    }
  }

  async #hasWindowsTransactionPayload() {
    const rootChain = await acquireModGuardChain(
      this.managedRoot, this.transactionRoot, this.directoryGuard, this.filesystemEntryVerifier,
    );
    try {
      const rootProbe = await probeSingleExpectedEntry(this.transactionRoot, (entry) => (
        entry.name === FAMILY_ID && entry.isDirectory() && !entry.isSymbolicLink()
      ));
      if (rootProbe.empty) return false;
      if (rootProbe.unexpected) return true;
      const instanceRoot = path.join(this.transactionRoot, FAMILY_ID);
      const instanceGuard = await this.directoryGuard(instanceRoot);
      try {
        instanceGuard.assertHeld?.();
        await this.filesystemEntryVerifier(instanceRoot);
        const payloadProbe = await probeSingleExpectedEntry(instanceRoot, (entry) => (
          entry.name === 'operations' && entry.isDirectory() && !entry.isSymbolicLink()
        ));
        return payloadProbe.unexpected;
      } finally { await instanceGuard.release(); }
    } finally { await releaseModGuards(...rootChain.map((entry) => entry.guard).reverse()); }
  }

  async #createPlanWithinLock(instanceId, request) {
    await this.assertSafeForLifecycle({ instanceId });
    const instance = await this.#quiescent(instanceId);
    await this.assertWorldMutationAllowedWithinInstanceLock(instanceId);
    const replayFile = this.#planRequestFile(instance.id, request.requestId);
    const requestDigest = sha256(canonical(request));
    try {
      const replay = await readJsonFile(replayFile);
      if (replay.requestDigest !== requestDigest) throw modError('MOD_REQUEST_ID_CONFLICT', 409, 'requestId was already used for a different mod plan.');
      await this.#validatePrivatePlan(replay, instance.id);
      return replay.public;
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (await this.operation(instance.id, request.requestId, { allowMissing: true })) {
      throw modError('MOD_REQUEST_ID_CONFLICT', 409, 'requestId was already used by a completed mod transaction.');
    }

    const manifest = await this.#manifest(instance.id);
    const before = await this.#scanMods(instance, manifest);
    if (before.unmanagedCount > 0) throw modError('MOD_UNMANAGED_MODS_PRESENT', 409, 'Unmanaged mod entries must be removed or adopted before managed mod changes.');
    if (before.entries.some((item) => item.name === FIRST_PARTY_CORE_FILE)) {
      throw modError(
        'MOD_FIRST_PARTY_CORE_ACTIVE',
        409,
        'Third-party mod changes remain disabled while the staged first-party Family Core artifact is active.',
      );
    }
    const beforeDigest = digestEntries(before.entries);
    const reservationBytes = before.entries.reduce((sum, entry) => sum + entry.size, 0) * 2 + 512 * 1024 * 1024;
    await this.#assertPlanCapacity(instance.id, reservationBytes);
    const stack = this.#stack(instance, manifest, beforeDigest);
    let targetRoots = new Set(manifest.roots);
    let requestedProjectId = null;
    let rollbackSource = null;
    if (request.operation === 'install') {
      requestedProjectId = this.#catalogEntry(request.catalogRef, stack).projectId;
      if (manifest.mods.some((item) => item.projectId === requestedProjectId)) throw modError('MOD_ALREADY_MANAGED', 409, 'This project is already managed; dependency promotion is not available in v1.');
      targetRoots.add(requestedProjectId);
    } else if (request.operation === 'rollback') {
      rollbackSource = await this.#rollbackSource(instance, manifest, request.transactionRef, beforeDigest);
    } else {
      requestedProjectId = this.#projectFromInstalledRef(instance.id, manifest, request.installedRef);
      if (!targetRoots.has(requestedProjectId)) throw modError('MOD_DEPENDENCY_OWNED', 409, 'Only explicitly installed root mods can be updated or removed.');
      if (request.operation === 'remove') {
        const target = manifest.mods.find((item) => item.projectId === requestedProjectId);
        if (target?.requiredBy?.some((id) => id !== requestedProjectId && targetRoots.has(id))) {
          throw modError('MOD_DEPENDENT_ROOT_EXISTS', 409, 'Another explicit root mod requires this mod.');
        }
        targetRoots.delete(requestedProjectId);
        if (targetRoots.size > 0 && (await this.#resolveRoots(instance, manifest, targetRoots)).nodes.has(requestedProjectId)) {
          throw modError('MOD_DEPENDENT_ROOT_EXISTS', 409, 'Another explicit root mod transitively requires this mod.');
        }
      }
    }

    const requestDirectory = path.join(this.planRoot, instance.id, request.requestId);
    await this.#freshDirectory(requestDirectory);
    const stageDirectory = path.join(requestDirectory, 'stage');
    const snapshotDirectory = path.join(requestDirectory, 'snapshot');
    await fs.mkdir(stageDirectory, { mode: 0o700 });
    await copyFlatDirectory(path.join(instance.directory, 'mods'), snapshotDirectory, this.managedRoot);
    const snapshotScan = await scanFlatDirectory(snapshotDirectory, this.managedRoot);
    if (digestEntries(snapshotScan.entries) !== beforeDigest) throw modError('MOD_SNAPSHOT_FAILED', 507, 'The rollback snapshot could not be verified.');

    let targetManifest;
    let staged = [];
    if (rollbackSource) {
      targetManifest = rollbackSource.manifest;
    } else {
      const resolved = await this.#resolveRoots(instance, manifest, targetRoots, { operation: request.operation, requestedProjectId });
      const core = await this.#inspectCore(instance);
      const protectedIds = [...new Set(core.flatMap((artifact) => artifact.metadata.flatMap((item) => item.ids)))];
      for (const node of resolved.ordered) {
        await this.#assertKeyContinuity();
        const fileName = `mastermind-${hmac(this.key, `${node.projectId}:${node.versionId}`).slice(0, 48)}.jar`;
        const file = path.join(stageDirectory, fileName);
        await this.client.download(node, file, { anchorRoot: stageDirectory, trustedRoot: this.managedRoot });
        const metadata = await inspectFabricModJar(file, { protectedIds, anchorRoot: stageDirectory, trustedRoot: this.managedRoot });
        staged.push({
          projectId: node.projectId, versionId: node.versionId, title: node.title, version: node.version,
          environment: node.environment, publishedAt: node.publishedAt, fileName, sha512: node.file.sha512,
          size: node.file.size, requiredProjectIds: [...new Set(node.requiredProjectIds)].sort(), metadata,
          installedAt: manifest.mods.find((item) => item.projectId === node.projectId)?.installedAt ?? nowIso(this.now),
        });
      }
      validateFabricCandidateGraph({
        artifacts: staged, coreMetadata: core, minecraftVersion: instance.minecraftVersion,
        loaderVersion: instance.loaderVersion, javaMajor: instance.requiredJavaMajor,
      });
      const requiredBy = new Map(staged.map((item) => [item.projectId, []]));
      for (const item of staged) for (const dependency of item.requiredProjectIds) requiredBy.get(dependency)?.push(item.projectId);
      targetManifest = {
        schemaVersion: 1, instanceId: instance.id, roots: [...targetRoots].sort(),
        mods: staged.map((item) => ({ ...item, requiredBy: [...new Set(requiredBy.get(item.projectId))].sort() })),
        generation: sha256(canonical({ previous: manifest.generation, staged: staged.map((item) => [item.projectId, item.versionId, item.sha512]) })),
        updatedAt: nowIso(this.now),
      };
    }
    validateManifest(targetManifest, instance.id);
    await this.#assertKeyContinuity();
    const snapshotRef = `modsnap-${hmac(this.key, canonical({ instanceId, requestId: request.requestId, beforeDigest }))}`;
    const privateBinding = {
      request, requestDigest, beforeManifest: manifest, targetManifest, beforeDigest,
      snapshotDigest: beforeDigest, snapshotRef,
      staged: staged.map((item) => ({ projectId: item.projectId, versionId: item.versionId, fileName: item.fileName,
        sha512: item.sha512, metadataDigest: sha256(canonical(item.metadata)) })),
      rollbackSource: rollbackSource ? { transactionRef: request.transactionRef } : null,
    };
    const changes = diffManifests(manifest, targetManifest, request.operation);
    const expiresAt = new Date(Date.parse(nowIso(this.now)) + this.planTtlMs).toISOString();
    const planSeed = { requestId: request.requestId, operation: request.operation, expiresAt, stackBinding: stack,
      snapshotRef, changes, targetDigest: sha256(canonical(targetManifest)), staged: privateBinding.staged };
    const planId = `modplan-${hmac(this.key, canonical(planSeed))}`;
    const publicPlanSeed = {
      planId, requestId: request.requestId, operation: request.operation, requiredConfirmation: CONFIRMATIONS[request.operation], expiresAt,
      stackBinding: stack, rollbackSnapshot: { snapshotRef, state: 'reserved' }, changes,
      dependentClosure: { state: 'clear', requiredBy: [] },
      risk: { codeExecutesAsLocalUser: true, hashVerifiesBytesNotSafety: true },
    };
    await this.#assertKeyContinuity();
    const planDigest = hmac(this.key, canonical({ public: publicPlanSeed, private: privateBinding }));
    const privatePlan = { schemaVersion: 1, planId, planDigest, requestDigest, public: { planDigest, ...publicPlanSeed }, private: privateBinding };
    await writeJsonDurable(path.join(requestDirectory, 'plan.json'), privatePlan);
    await writeJsonDurable(replayFile, privatePlan);
    await this.#assertKeyContinuity();
    return clone(privatePlan.public);
  }

  async #executeWithinLock(instanceId, request) {
    const replay = await this.operation(instanceId, request.requestId, { allowMissing: true });
    if (replay) {
      if (replay.planId !== request.planId) throw modError('MOD_REQUEST_ID_CONFLICT', 409, 'requestId was already used for a different mod action.');
      if (request.confirmation !== CONFIRMATIONS[replay.operation]) throw modError('MOD_REQUEST_ID_CONFLICT', 409, 'requestId was already used with different approval data.');
      return replay;
    }
    await this.assertSafeForLifecycle({ instanceId });
    const instance = await this.#quiescent(instanceId);
    await this.assertWorldMutationAllowedWithinInstanceLock(instanceId);
    const plan = await this.#findPlan(instance.id, request.planId);
    if (plan.public.requestId !== request.requestId) throw modError('MOD_APPROVAL_INVALID', 409, 'The action requestId does not match its plan.');
    await this.#assertKeyContinuity();
    const transactionRef = `modtx-${hmac(this.key, canonical({ requestId: request.requestId, planDigest: plan.planDigest }))}`;
    let manifest; let current; let currentDigest;
    try {
      if (request.confirmation !== plan.public.requiredConfirmation) throw modError('MOD_APPROVAL_INVALID', 409, 'The exact mod confirmation phrase is required.');
      if (Date.parse(plan.public.expiresAt) <= Date.parse(nowIso(this.now))) throw modError('MOD_PLAN_EXPIRED', 409, 'The mod plan expired; create and inspect a new plan.');
      manifest = await this.#manifest(instance.id);
      current = await this.#scanMods(instance, manifest);
      if (current.unmanagedCount > 0) throw modError('MOD_UNMANAGED_MODS_PRESENT', 409, 'Unmanaged mod entries block managed mutations.');
      currentDigest = digestEntries(current.entries);
      const stack = this.#stack(instance, manifest, currentDigest);
      if (canonical(stack) !== canonical(plan.public.stackBinding) || currentDigest !== plan.private.snapshotDigest) {
        throw modError('MOD_PLAN_STALE', 409, 'The Family Server stack changed after this mod plan was created.');
      }
      const requestDirectory = path.join(this.planRoot, instance.id, request.requestId);
      const snapshotScan = await scanFlatDirectory(path.join(requestDirectory, 'snapshot'), this.managedRoot);
      if (digestEntries(snapshotScan.entries) !== plan.private.snapshotDigest) throw modError('MOD_SNAPSHOT_FAILED', 409, 'The reserved rollback snapshot is no longer verified.');
      for (const staged of plan.private.staged) {
        const file = path.join(requestDirectory, 'stage', staged.fileName);
        if (await sha512File(file, { anchorRoot: path.join(requestDirectory, 'stage'), trustedRoot: this.managedRoot }) !== staged.sha512
          || sha256(canonical(await inspectFabricModJar(file,
            { protectedIds: await this.#protectedIds(instance), anchorRoot: path.join(requestDirectory, 'stage'), trustedRoot: this.managedRoot }))) !== staged.metadataDigest) {
          throw modError('MOD_INTEGRITY_FAILED', 409, 'A staged mod changed after planning.');
        }
      }
    } catch (error) {
      if (typeof error?.code === 'string' && ['MOD_APPROVAL_INVALID', 'MOD_PLAN_EXPIRED', 'MOD_PLAN_STALE',
        'MOD_UNMANAGED_MODS_PRESENT', 'MOD_SNAPSHOT_FAILED', 'MOD_INTEGRITY_FAILED'].includes(error.code)) {
        await this.#persistRejectedOperation(instance, plan, transactionRef);
      }
      throw error;
    }
    const requestDirectory = path.join(this.planRoot, instance.id, request.requestId);
    const txDirectory = path.join(this.transactionRoot, instance.id, transactionRef);
    await this.#assertTransactionCapacity(instance.id);
    await this.#freshDirectory(txDirectory);
    const marker = {
      schemaVersion: 1, transactionRef, instanceId, requestId: request.requestId, planId: plan.planId, planDigest: plan.planDigest,
      operation: plan.public.operation, phase: 'prepared', beforeManifest: plan.private.beforeManifest,
      targetManifest: plan.private.targetManifest, beforeDigest: currentDigest, targetDigest: null,
      snapshotRef: plan.public.rollbackSnapshot.snapshotRef, stackBefore: plan.public.stackBinding, stackAfter: null,
      startedAt: nowIso(this.now), updatedAt: nowIso(this.now), failureCode: null,
    };
    await this.#writeMarker(txDirectory, marker);
    this.#recovery.set(instance.id, { transactionRef, state: 'completion-unknown' });
    const candidate = path.join(txDirectory, 'candidate');
    const displaced = path.join(txDirectory, 'displaced');
    let mutationIntentEntered = false;
    let prewriteAudited = false;
    try {
      await this.#appendAudit({
        event: 'prewrite', instanceId, requestId: request.requestId, planDigest: plan.planDigest, transactionRef,
        operation: plan.public.operation, stackBefore: plan.public.stackBinding.generation,
        beforeInventoryDigest: currentDigest, targetInventoryDigest: null,
        snapshotRef: plan.public.rollbackSnapshot.snapshotRef, actor: 'trusted-local-command-center',
        state: 'completion-unknown', application: 'unknown', failureCode: null, at: marker.startedAt,
      });
      prewriteAudited = true;
      const pending = operationRecord(plan, transactionRef, 'completion-unknown', 'unknown', null, 'verified', marker.startedAt, marker.updatedAt);
      await this.#writeOperation(instance.id, pending);
      await this.onPhase('prepared', clone(marker));
      await copyFlatDirectory(path.join(instance.directory, 'mods'), candidate, this.managedRoot);
      for (const item of manifest.mods) await fs.rm(path.join(candidate, item.fileName), { force: true });
      if (plan.public.operation === 'rollback') {
        await fs.rm(candidate, { recursive: true, force: false });
        await copyFlatDirectory(plan.private.rollbackSource
          ? (await this.#rollbackSource(instance, manifest, plan.private.rollbackSource.transactionRef, currentDigest)).snapshotPath
          : path.join(requestDirectory, 'snapshot'), candidate, this.managedRoot);
      } else {
        for (const item of plan.private.targetManifest.mods) {
          await copyRegularFile(path.join(requestDirectory, 'stage', item.fileName), path.join(candidate, item.fileName), item.sha512);
        }
      }
      const candidateScan = await scanFlatDirectory(candidate, this.managedRoot);
      marker.targetDigest = digestEntries(candidateScan.entries);
      marker.stackAfter = this.#stack(instance, plan.private.targetManifest, marker.targetDigest);
      await this.#verifyCandidate(instance, plan.private.targetManifest, candidate, current);
      await this.#phase(txDirectory, marker, 'candidate-verified');
      await this.#phase(txDirectory, marker, 'moving-old-intent');
      mutationIntentEntered = true;
      await fs.rename(path.join(instance.directory, 'mods'), displaced);
      await this.#phase(txDirectory, marker, 'old-moved');
      await this.#phase(txDirectory, marker, 'publishing-candidate-intent');
      await fs.rename(candidate, path.join(instance.directory, 'mods'));
      await this.#phase(txDirectory, marker, 'candidate-published');
      await this.#phase(txDirectory, marker, 'committing-manifest-intent');
      await this.#writeManifest(instance.id, plan.private.targetManifest);
      await this.#phase(txDirectory, marker, 'manifest-committed');
      const live = await this.#scanMods(instance, plan.private.targetManifest);
      if (digestEntries(live.entries) !== marker.targetDigest) throw new Error('Published mod inventory verification failed');
      await this.#phase(txDirectory, marker, 'committed');
      const afterStack = this.#stack(instance, plan.private.targetManifest, marker.targetDigest);
      const result = operationRecord(plan, transactionRef, 'committed', 'verified', afterStack, 'verified', marker.startedAt, nowIso(this.now));
      await this.#appendAudit({ event: 'terminal', instanceId, requestId: request.requestId, planDigest: plan.planDigest,
        transactionRef, operation: plan.public.operation, stackBefore: plan.public.stackBinding.generation,
        beforeInventoryDigest: currentDigest, targetInventoryDigest: marker.targetDigest,
        snapshotRef: plan.public.rollbackSnapshot.snapshotRef, actor: 'trusted-local-command-center',
        state: 'committed', application: 'verified', failureCode: null, at: result.updatedAt });
      await this.#writeOperation(instance.id, result);
      await this.#cleanupTerminalPayload(txDirectory);
      await this.#gcExpiredPlans(instance.id);
      this.#recovery.delete(instance.id);
      return publicOperation(result);
    } catch (error) {
      if (!mutationIntentEntered) {
        marker.failureCode = null;
        marker.targetDigest = null;
        marker.stackAfter = null;
        await this.#phase(txDirectory, marker, 'rejected-before-mutation');
        const result = operationRecord(plan, transactionRef, 'rejected-before-mutation', 'not-applied', null,
          'unavailable', marker.startedAt, nowIso(this.now));
        if (prewriteAudited) await this.#appendTerminalAudit(plan, marker, result);
        await this.#writeOperation(instance.id, result);
        await this.#cleanupTerminalPayload(txDirectory);
        this.#recovery.delete(instance.id);
        throw error;
      }
      if (marker.phase === 'committed') {
        this.#recovery.set(instance.id, { transactionRef, state: 'completion-unknown' });
        const failure = modError('MOD_COMPLETION_UNKNOWN', 202, 'The mod transaction committed, but terminal reconciliation is incomplete; do not retry automatically.');
        failure.cause = error; throw failure;
      }
      const restored = await this.#restoreAfterFailure(instance, txDirectory, marker).catch(() => false);
      if (restored) {
        const result = operationRecord(plan, transactionRef, 'rolled-back', 'rolled-back-verified', plan.public.stackBinding,
          'restored-verified', marker.startedAt, nowIso(this.now));
        try {
          await this.#appendAudit({ event: 'terminal', instanceId, requestId: request.requestId, planDigest: plan.planDigest,
            transactionRef, operation: plan.public.operation, stackBefore: plan.public.stackBinding.generation,
            beforeInventoryDigest: currentDigest, targetInventoryDigest: currentDigest,
            snapshotRef: plan.public.rollbackSnapshot.snapshotRef, actor: 'trusted-local-command-center',
            state: 'rolled-back', application: 'rolled-back-verified', failureCode: null, at: result.updatedAt });
          await this.#writeOperation(instance.id, result);
          await this.#cleanupTerminalPayload(txDirectory);
          this.#recovery.delete(instance.id);
          return publicOperation(result);
        } catch {
          this.#recovery.set(instance.id, { transactionRef, state: 'completion-unknown' });
          throw modError('MOD_COMPLETION_UNKNOWN', 202, 'The mod transaction rolled back, but terminal reconciliation is incomplete; do not retry automatically.');
        }
      }
      marker.failureCode = 'MOD_RECOVERY_REQUIRED';
      await this.#phase(txDirectory, marker, 'manual-recovery-required').catch(() => undefined);
      this.#recovery.set(instance.id, { transactionRef, state: 'manual-recovery-required' });
      const result = operationRecord(plan, transactionRef, 'manual-recovery-required', 'unknown', null, 'unavailable', marker.startedAt, nowIso(this.now));
      await this.#writeOperation(instance.id, result);
      throw modError('MOD_MANUAL_RECOVERY_REQUIRED', 500, 'The mod transaction requires local recovery before the server can start.');
    }
  }

  async #persistRejectedOperation(instance, plan, transactionRef) {
    const existing = await this.operation(instance.id, plan.public.requestId, { allowMissing: true });
    if (existing) return existing;
    await this.#assertTransactionCapacity(instance.id);
    const txDirectory = path.join(this.transactionRoot, instance.id, transactionRef);
    await this.#freshDirectory(txDirectory);
    const timestamp = nowIso(this.now);
    const marker = {
      schemaVersion: 1, transactionRef, instanceId: instance.id, requestId: plan.public.requestId,
      planId: plan.planId, planDigest: plan.planDigest, operation: plan.public.operation,
      phase: 'rejected-before-mutation', beforeManifest: plan.private.beforeManifest,
      targetManifest: plan.private.targetManifest, beforeDigest: plan.private.beforeDigest,
      targetDigest: null, snapshotRef: plan.public.rollbackSnapshot.snapshotRef,
      stackBefore: plan.public.stackBinding, stackAfter: null, startedAt: timestamp, updatedAt: timestamp,
      failureCode: null,
    };
    await this.#writeMarker(txDirectory, marker);
    this.#recovery.set(instance.id, { transactionRef, state: 'completion-unknown' });
    const rejected = operationRecord(plan, transactionRef, 'rejected-before-mutation', 'not-applied', null,
      'unavailable', timestamp, timestamp);
    try {
      await this.#appendTerminalAudit(plan, marker, rejected);
      await this.#writeOperation(instance.id, rejected);
      await this.#cleanupTerminalPayload(txDirectory);
      this.#recovery.delete(instance.id);
      return publicOperation(rejected);
    } catch (error) {
      throw modError('MOD_COMPLETION_UNKNOWN', 202, 'The rejected mod operation could not be durably reconciled; do not retry automatically.');
    }
  }

  async #restoreAfterFailure(instance, txDirectory, marker) {
    const live = path.join(instance.directory, 'mods');
    const displaced = path.join(txDirectory, 'displaced');
    const failedLive = path.join(txDirectory, 'failed-live');
    if (await exists(failedLive)) {
      const failed = await scanFlatDirectory(failedLive, this.managedRoot);
      if (marker.targetDigest === null || digestEntries(failed.entries) !== marker.targetDigest) return false;
      if (await exists(displaced) && !await exists(live)) {
        const displacedScan = await scanFlatDirectory(displaced, this.managedRoot);
        if (digestEntries(displacedScan.entries) !== marker.beforeDigest) return false;
        await fs.rename(displaced, live);
      } else if (await exists(live) && !await exists(displaced)) {
        const liveScan = await scanFlatDirectory(live, this.managedRoot);
        if (digestEntries(liveScan.entries) !== marker.beforeDigest) return false;
      } else return false;
    }
    else if (await exists(displaced)) {
      const displacedScan = await scanFlatDirectory(displaced, this.managedRoot);
      if (digestEntries(displacedScan.entries) !== marker.beforeDigest) return false;
      if (await exists(live)) {
        const liveScan = await scanFlatDirectory(live, this.managedRoot);
        if (marker.targetDigest === null || digestEntries(liveScan.entries) !== marker.targetDigest) return false;
        await fs.rename(live, failedLive);
      }
      await fs.rename(displaced, live);
    } else {
      if (!await exists(live)) return false;
      const liveScan = await scanFlatDirectory(live, this.managedRoot);
      if (digestEntries(liveScan.entries) !== marker.beforeDigest) return false;
    }
    await this.#writeManifest(instance.id, marker.beforeManifest);
    const scan = await this.#scanMods(instance, marker.beforeManifest);
    if (digestEntries(scan.entries) !== marker.beforeDigest) return false;
    await this.#phase(txDirectory, marker, 'rolled-back');
    return true;
  }

  async #recoverTransactions() {
    const results = [];
    for (const instanceEntry of await safeReadDir(this.transactionRoot, 1)) {
      if (!instanceEntry.isDirectory() || instanceEntry.isSymbolicLink() || !validateInstanceId(instanceEntry.name)) {
        this.#recovery.set(FAMILY_ID, { transactionRef: `modtx-${'0'.repeat(64)}`, state: 'manual-recovery-required' });
        throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected managed transaction storage requires recovery.');
      }
      for (const txEntry of await safeReadDir(
        path.join(this.transactionRoot, instanceEntry.name), MAX_TRANSACTION_INSTANCE_ENTRIES,
      )) {
        if (txEntry.name === 'operations' && txEntry.isDirectory() && !txEntry.isSymbolicLink()) continue;
        if (!txEntry.isDirectory() || txEntry.isSymbolicLink() || !TX_REF.test(txEntry.name)) {
          this.#recovery.set(instanceEntry.name, { transactionRef: `modtx-${'0'.repeat(64)}`, state: 'manual-recovery-required' });
          throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected managed transaction storage requires recovery.');
        }
        const txDirectory = path.join(this.transactionRoot, instanceEntry.name, txEntry.name);
        let marker;
        try { marker = await readJsonFile(path.join(txDirectory, 'marker.json')); await this.#validateMarker(marker, instanceEntry.name, txEntry.name); }
        catch { this.#recovery.set(instanceEntry.name, { transactionRef: txEntry.name, state: 'manual-recovery-required' }); continue; }
        if (['committed', 'rolled-back', 'rejected-before-mutation'].includes(marker.phase)) {
          try {
            const existing = await this.operation(marker.instanceId, marker.requestId, { allowMissing: true });
            if (existing && existing.state !== 'completion-unknown') {
              if (existing.transactionRef !== marker.transactionRef || existing.planDigest !== marker.planDigest
                || existing.state !== marker.phase) throw new Error('terminal journal conflicts with marker');
              await this.#appendTerminalAudit(null, marker, existing);
              await this.#cleanupTerminalPayload(txDirectory);
              results.push({ instanceId: marker.instanceId, transactionRef: marker.transactionRef, action: marker.phase });
              continue;
            }
            await this.withInstanceLock(marker.instanceId, () => this.#serialized(async () => {
              await this.assertWorldMutationAllowedWithinInstanceLock(marker.instanceId);
              const instance = await this.#quiescent(marker.instanceId);
              if (marker.phase === 'rejected-before-mutation') {
                const plan = await this.#findPlan(marker.instanceId, marker.planId);
                const operation = operationRecord(plan, marker.transactionRef, 'rejected-before-mutation', 'not-applied',
                  null, 'unavailable', marker.startedAt, marker.updatedAt);
                await this.#appendTerminalAudit(plan, marker, operation);
                await this.#writeOperation(marker.instanceId, operation);
                await this.#cleanupTerminalPayload(txDirectory);
                return;
              }
              const liveManifest = await this.#manifest(marker.instanceId);
              const live = await this.#scanMods(instance, liveManifest);
              const liveDigest = digestEntries(live.entries);
              const committed = marker.phase === 'committed';
              const expectedManifest = committed ? marker.targetManifest : marker.beforeManifest;
              const expectedDigest = committed ? marker.targetDigest : marker.beforeDigest;
              if (canonical(liveManifest) !== canonical(expectedManifest) || liveDigest !== expectedDigest) throw new Error('terminal layout does not match marker');
              const plan = await this.#findPlan(marker.instanceId, marker.planId);
              const stackAfter = committed ? this.#stack(instance, marker.targetManifest, marker.targetDigest) : plan.public.stackBinding;
              const operation = operationRecord(plan, marker.transactionRef, committed ? 'committed' : 'rolled-back',
                committed ? 'verified' : 'rolled-back-verified', stackAfter,
                committed ? 'verified' : 'restored-verified', marker.startedAt, marker.updatedAt);
              await this.#appendTerminalAudit(plan, marker, operation);
              await this.#writeOperation(marker.instanceId, operation);
              await this.#cleanupTerminalPayload(txDirectory);
            }));
            results.push({ instanceId: marker.instanceId, transactionRef: marker.transactionRef, action: marker.phase });
          } catch {
            this.#recovery.set(marker.instanceId, { transactionRef: marker.transactionRef, state: 'manual-recovery-required' });
            results.push({ instanceId: marker.instanceId, transactionRef: marker.transactionRef, action: 'manual-recovery-required' });
          }
          continue;
        }
        try {
          const action = await this.withInstanceLock(instanceEntry.name, () => this.#serialized(async () => {
            await this.assertWorldMutationAllowedWithinInstanceLock(instanceEntry.name);
            const instance = await this.#quiescent(instanceEntry.name);
            if (marker.phase === 'manifest-committed') {
              const scan = await this.#scanMods(instance, marker.targetManifest);
              if (digestEntries(scan.entries) === marker.targetDigest) {
                const liveManifest = await this.#manifest(marker.instanceId);
                if (canonical(liveManifest) === canonical(marker.targetManifest)) {
                  await this.#phase(txDirectory, marker, 'committed');
                  const plan = await this.#findPlan(marker.instanceId, marker.planId);
                  const operation = operationRecord(plan, marker.transactionRef, 'committed', 'verified',
                    this.#stack(instance, marker.targetManifest, marker.targetDigest), 'verified', marker.startedAt, marker.updatedAt);
                  await this.#appendTerminalAudit(plan, marker, operation);
                  await this.#writeOperation(marker.instanceId, operation);
                  await this.#cleanupTerminalPayload(txDirectory);
                  return 'committed';
                }
              }
            }
            if (await this.#restoreAfterFailure(instance, txDirectory, marker)) {
              const plan = await this.#findPlan(marker.instanceId, marker.planId);
              const operation = operationRecord(plan, marker.transactionRef, 'rolled-back', 'rolled-back-verified',
                plan.public.stackBinding, 'restored-verified', marker.startedAt, marker.updatedAt);
              await this.#appendTerminalAudit(plan, marker, operation);
              await this.#writeOperation(marker.instanceId, operation);
              await this.#cleanupTerminalPayload(txDirectory);
              return 'rolled-back';
            }
            throw new Error('recovery verification failed');
          }));
          results.push({ instanceId: instanceEntry.name, transactionRef: marker.transactionRef, action });
        } catch {
          this.#recovery.set(instanceEntry.name, { transactionRef: marker.transactionRef, state: 'manual-recovery-required' });
          results.push({ instanceId: instanceEntry.name, transactionRef: marker.transactionRef, action: 'manual-recovery-required' });
        }
      }
      const knownTransactions = new Set((await safeReadDir(
        path.join(this.transactionRoot, instanceEntry.name), MAX_TRANSACTION_INSTANCE_ENTRIES,
      ))
        .filter((entry) => entry.isDirectory() && TX_REF.test(entry.name)).map((entry) => entry.name));
      for (const operationEntry of await safeReadDir(
        path.join(this.transactionRoot, instanceEntry.name, 'operations'), MAX_TRANSACTION_RECORDS,
      )) {
        if (!operationEntry.isFile() || operationEntry.isSymbolicLink() || !/^([0-9a-f-]{36})\.json$/.test(operationEntry.name)) {
          this.#recovery.set(instanceEntry.name, { transactionRef: `modtx-${'0'.repeat(64)}`, state: 'manual-recovery-required' });
          throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected mod operation storage requires recovery.');
        }
        const requestId = operationEntry.name.slice(0, -5);
        const operation = await this.operation(instanceEntry.name, requestId);
        if (!knownTransactions.has(operation.transactionRef)) {
          this.#recovery.set(instanceEntry.name, { transactionRef: operation.transactionRef,
            state: ['completion-unknown', 'manual-recovery-required'].includes(operation.state) ? operation.state : 'manual-recovery-required' });
          throw modError('MOD_STATE_UNAVAILABLE', 503, 'A mod operation is missing its authenticated transaction evidence.');
        }
      }
    }
    return results;
  }

  async #rollbackSource(instance, currentManifest, transactionRef, currentDigest) {
    if (!TX_REF.test(transactionRef)) throw modError('MOD_INVALID_REF', 400, 'Invalid transactionRef.');
    const directory = path.join(this.transactionRoot, instance.id, transactionRef);
    const marker = await readJsonFile(path.join(directory, 'marker.json')).catch(() => { throw modError('MOD_TRANSACTION_NOT_FOUND', 404, 'The mod transaction was not found.'); });
    await this.#validateMarker(marker, instance.id, transactionRef);
    const currentStack = this.#stack(instance, currentManifest, currentDigest);
    if (marker.phase !== 'committed' || marker.targetDigest !== currentDigest || canonical(marker.stackAfter) !== canonical(currentStack)) {
      throw modError('MOD_ROLLBACK_STALE', 409, 'Rollback requires the exact unchanged post-transaction stack and mod inventory.');
    }
    const snapshotPath = path.join(this.planRoot, instance.id, marker.requestId, 'snapshot');
    const snapshot = await scanFlatDirectory(snapshotPath, this.managedRoot);
    if (digestEntries(snapshot.entries) !== marker.beforeDigest) throw modError('MOD_SNAPSHOT_FAILED', 409, 'The transaction rollback snapshot is not verified.');
    await this.#inspectManifestDirectory(instance, marker.beforeManifest, snapshotPath);
    return { manifest: marker.beforeManifest, snapshotPath };
  }

  async #inspectManifestDirectory(instance, manifest, directory) {
    const core = await this.#inspectCore(instance); const protectedIds = [...new Set(core.flatMap((item) => item.metadata.flatMap((meta) => meta.ids)))];
    const artifacts = [];
    for (const item of manifest.mods) {
      const file = path.join(directory, item.fileName);
      if (await sha512File(file, { anchorRoot: directory, trustedRoot: this.managedRoot }) !== item.sha512) throw modError('MOD_INTEGRITY_FAILED', 409, 'A snapshot mod failed its bound hash.');
      artifacts.push({ metadata: await inspectFabricModJar(file, { protectedIds, anchorRoot: directory, trustedRoot: this.managedRoot }) });
    }
    validateFabricCandidateGraph({ artifacts, coreMetadata: core, minecraftVersion: instance.minecraftVersion,
      loaderVersion: instance.loaderVersion, javaMajor: instance.requiredJavaMajor });
  }

  async #resolveRoots(instance, manifest, roots, scope = {}) {
    const coreVersions = this.#coreVersions(instance);
    const currentVersions = new Map(manifest.mods.map((item) => [item.projectId, { publishedAt: item.publishedAt, versionId: item.versionId }]));
    const selected = new Map();
    const rootIds = new Set(roots);
    const installedByProject = new Map(manifest.mods.map((item) => [item.projectId, item]));
    const resolve = (projectId, installedIds) => this.client.resolveGraph({ projectId, minecraftVersion: instance.minecraftVersion,
      coreVersions, installedProjectIds: installedIds, currentVersions,
      ...(projectId !== scope.requestedProjectId && installedByProject.has(projectId)
        ? { pinnedRootVersionId: installedByProject.get(projectId).versionId, pinnedVersions: new Map(manifest.mods.map((item) => [item.projectId, item.versionId])) }
        : {}) });
    for (const projectId of [...roots].sort()) {
      const result = await resolve(projectId, rootIds);
      for (const node of result.nodes) {
        const existing = selected.get(node.projectId);
        if (existing && existing.versionId !== node.versionId) throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'Explicit roots require conflicting dependency versions.');
        selected.set(node.projectId, node);
      }
    }
    const allIds = new Set(selected.keys());
    const verified = new Map(); let totalBytes = 0;
    for (const projectId of [...roots].sort()) {
      const result = await resolve(projectId, allIds);
      totalBytes += result.totalBytes;
      for (const node of result.nodes) {
        const existing = verified.get(node.projectId);
        if (existing && existing.versionId !== node.versionId) throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'Explicit roots require conflicting dependency versions.');
        verified.set(node.projectId, node);
      }
    }
    for (const [projectId, node] of verified) {
      const installed = installedByProject.get(projectId);
      if (!installed || node.versionId === installed.versionId || projectId === scope.requestedProjectId) continue;
      const changedFromRequestedClosure = verified.get(scope.requestedProjectId)?.requiredProjectIds?.includes(projectId);
      if (!changedFromRequestedClosure) throw modError('MOD_COLLATERAL_UPDATE', 409, 'The selected action would update an unrelated managed mod; update it separately.');
    }
    if (verified.size > MAX_MODS || totalBytes > 512 * 1024 * 1024) throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'The resolved mod closure exceeded its safe bounds.');
    return { nodes: verified, ordered: [...verified.values()].sort((a, b) => a.projectId.localeCompare(b.projectId)), totalBytes };
  }

  async #inspectCore(instance) {
    const modsRoot = path.join(instance.directory, 'mods');
    const ancestorChain = await acquireModGuardChain(
      this.managedRoot, modsRoot, this.directoryGuard, this.filesystemEntryVerifier,
    );
    const artifacts = [];
    try {
      for (const [key, fileName] of Object.entries(CORE_FILES)) {
        const file = path.join(modsRoot, fileName);
        const expected = instance.components?.[key]?.sourceHash?.value;
        const actual = await sha512FileGuarded(
          file, modsRoot, this.managedRoot, this.fileGuard, this.filesystemEntryVerifier,
        ).catch(() => null);
        if (typeof expected !== 'string' || actual !== expected.toLowerCase()) throw modError('MOD_CORE_INTEGRITY_FAILED', 409, 'A protected managed core mod failed integrity verification.');
        artifacts.push({
          projectId: MODRINTH_CORE_PROJECTS[key],
          metadata: await inspectFabricModJarGuarded(file, {
            trustedCore: true, anchorRoot: modsRoot, trustedRoot: this.managedRoot,
          }, this.fileGuard, this.filesystemEntryVerifier),
        });
      }
      await assertModGuardChainHeld(ancestorChain, this.filesystemEntryVerifier);
      return artifacts;
    } finally { await releaseModGuards(...ancestorChain.map((entry) => entry.guard).reverse()); }
  }

  async #protectedIds(instance) { return [...new Set((await this.#inspectCore(instance)).flatMap((item) => item.metadata.flatMap((meta) => meta.ids)))]; }

  async #verifyCandidate(instance, manifest, directory, beforeScan) {
    const firstPartyCore = beforeScan.entries.some((item) => item.name === FIRST_PARTY_CORE_FILE)
      ? [FIRST_PARTY_CORE_FILE] : [];
    const expected = new Set([...Object.values(CORE_FILES), ...firstPartyCore, ...manifest.mods.map((item) => item.fileName)]);
    const scan = await scanFlatDirectory(directory, this.managedRoot);
    for (const [name, hash] of scan.hashes) {
      if (!expected.has(name)) throw modError('MOD_UNMANAGED_MODS_PRESENT', 409, 'The candidate contains an unmanaged mod entry.');
      if (Object.values(CORE_FILES).includes(name) && beforeScan.hashes.get(name) !== hash) throw modError('MOD_CORE_INTEGRITY_FAILED', 409, 'A protected core mod changed during the transaction.');
      if (name === FIRST_PARTY_CORE_FILE && beforeScan.hashes.get(name) !== hash) throw modError('MOD_CORE_INTEGRITY_FAILED', 409, 'The protected first-party core mod changed during the transaction.');
    }
    for (const item of manifest.mods) if (scan.hashes.get(item.fileName) !== item.sha512) throw modError('MOD_INTEGRITY_FAILED', 409, 'A candidate mod failed final hash verification.');
    if (scan.entries.length !== expected.size) throw modError('MOD_INTEGRITY_FAILED', 409, 'The candidate mod inventory is incomplete.');
  }

  async #scanMods(instance, manifest, options = {}) {
    const modsRoot = path.join(instance.directory, 'mods');
    const ancestorChain = await acquireModGuardChain(
      this.managedRoot, modsRoot, this.directoryGuard, this.filesystemEntryVerifier,
    );
    try {
      const result = await scanFlatDirectory(
        modsRoot, this.managedRoot, this.fileGuard, this.filesystemEntryVerifier,
      );
      const known = new Set([...Object.values(CORE_FILES), FIRST_PARTY_CORE_FILE, ...manifest.mods.map((item) => item.fileName)]);
      const unmanagedCount = result.entries.filter((item) => !known.has(item.name)).length;
      if (!options.tolerateUnmanaged && unmanagedCount > 0) throw modError('MOD_UNMANAGED_MODS_PRESENT', 409, 'Unmanaged mod entries block managed mod transactions.');
      await assertModGuardChainHeld(ancestorChain, this.filesystemEntryVerifier);
      return { ...result, unmanagedCount };
    } finally { await releaseModGuards(...ancestorChain.map((entry) => entry.guard).reverse()); }
  }

  async #modsDigest(instance, manifest, options) { return digestEntries((await this.#scanMods(instance, manifest, options)).entries); }
  #coreVersions(instance) {
    const map = new Map();
    for (const key of Object.keys(CORE_FILES)) {
      const id = MODRINTH_CORE_PROJECTS[key]; const versionId = instance.components?.[key]?.versionId;
      if (typeof versionId !== 'string' || !/^[A-Za-z0-9]{8}$/.test(versionId)) throw modError('MOD_CORE_INTEGRITY_FAILED', 409, 'The managed core version identity is incomplete.');
      map.set(id, versionId);
    }
    return map;
  }

  #stack(instance, manifest, inventoryDigest) {
    const generation = sha256(canonical({ minecraftVersion: instance.minecraftVersion, loader: instance.loader,
      loaderVersion: instance.loaderVersion, components: instance.components, modGeneration: manifest.generation }));
    return { minecraftVersion: instance.minecraftVersion, loader: 'fabric', loaderVersion: instance.loaderVersion, generation, inventoryDigest };
  }

  async #instance(id) {
    normalizeInstance(id);
    const instance = await this.store.get(id);
    if (!instance) throw modError('MOD_INSTANCE_NOT_FOUND', 404, 'The Family Server instance was not found.');
    if (instance.id !== FAMILY_ID || instance.projectId !== 'family-server' || instance.kind !== 'server'
      || instance.loader !== 'fabric' || path.resolve(instance.directory) !== path.join(this.serverRoot, id)) {
      throw modError('MOD_INVALID_INSTANCE', 409, 'Mod management is restricted to the isolated Family Server Fabric instance.');
    }
    return instance;
  }

  async #quiescent(id) {
    const fromManager = await this.assertQuiescentWithinInstanceLock(id);
    const current = await this.#instance(id);
    if (!fromManager || fromManager.id !== current.id || current.status !== 'stopped' || current.pid !== null || current.managedProcess != null) {
      throw modError('MOD_SERVER_NOT_QUIESCENT', 409, 'Stop the exact managed Family Server before changing mods.');
    }
    return current;
  }

  async #manifest(instanceId) {
    await this.#assertKeyContinuity();
    let ancestorChain = null;
    let manifest;
    try {
      ancestorChain = await acquireModGuardChain(
        this.managedRoot, this.manifestRoot, this.directoryGuard, this.filesystemEntryVerifier,
      );
      const manifestFile = this.#manifestFile(instanceId);
      try { await fs.lstat(manifestFile); }
      catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        await assertModGuardChainHeld(ancestorChain, this.filesystemEntryVerifier);
        manifest = { schemaVersion: 1, instanceId, roots: [], mods: [], generation: sha256(`empty:${instanceId}`), updatedAt: null };
      }
      if (!manifest) {
        const wrapper = await readJsonFileGuarded(manifestFile, this.fileGuard, this.filesystemEntryVerifier);
        if (!exactKeys(wrapper, ['schemaVersion', 'manifest', 'mac']) || wrapper.schemaVersion !== 1 || !HEX64.test(wrapper.mac)) throw new Error('Invalid manifest wrapper');
        validateManifest(wrapper.manifest, instanceId);
        if (!crypto.timingSafeEqual(Buffer.from(wrapper.mac), Buffer.from(hmac(this.key, canonical(wrapper.manifest))))) throw new Error('Manifest authentication failed');
        await assertModGuardChainHeld(ancestorChain, this.filesystemEntryVerifier);
        manifest = wrapper.manifest;
      }
    }
    catch (error) {
      if (error?.code !== 'ENOENT') throw modError('MOD_STATE_UNAVAILABLE', 503, 'The managed mod manifest is unavailable.');
      manifest = { schemaVersion: 1, instanceId, roots: [], mods: [], generation: sha256(`empty:${instanceId}`), updatedAt: null };
    } finally {
      await releaseModGuards(...(ancestorChain ?? []).map((entry) => entry.guard).reverse());
    }
    await this.#assertKeyContinuity();
    return manifest;
  }
  async #writeManifest(id, manifest) {
    validateManifest(manifest, id);
    await this.#assertKeyContinuity();
    await writeJsonDurable(this.#manifestFile(id), { schemaVersion: 1, manifest, mac: hmac(this.key, canonical(manifest)) });
    await this.#assertKeyContinuity();
  }
  #manifestFile(id) { return path.join(this.manifestRoot, `${id}.json`); }
  #operationFile(id, requestId) { return path.join(this.transactionRoot, id, 'operations', `${requestId}.json`); }
  #planRequestFile(id, requestId) { return path.join(this.planRoot, id, 'requests', `${requestId}.json`); }
  #installedRef(id, projectId) { return `modinst-${hmac(this.key, `${id}:${projectId}`)}`; }
  #projectFromInstalledRef(id, manifest, ref) {
    if (!INSTALLED_REF.test(ref)) throw modError('MOD_INVALID_REF', 400, 'Invalid installedRef.');
    const item = manifest.mods.find((candidate) => crypto.timingSafeEqual(Buffer.from(this.#installedRef(id, candidate.projectId)), Buffer.from(ref)));
    if (!item) throw modError('MOD_INSTALLED_NOT_FOUND', 404, 'The managed installed mod was not found.');
    return item.projectId;
  }
  #catalogEntry(ref, stack) {
    if (!CATALOG_REF.test(ref)) throw modError('MOD_INVALID_REF', 400, 'Invalid catalogRef.');
    const value = this.#catalog.get(ref);
    if (!value || value.expiresAt <= Date.now()) throw modError('MOD_CATALOG_REF_EXPIRED', 409, 'The catalog reference expired; search again.');
    if (canonical(value.stack) !== canonical(stack)) throw modError('MOD_PLAN_STALE', 409, 'The catalog reference belongs to an older Family Server stack.');
    return value;
  }
  #rememberCatalog(projectId, stack) {
    const ref = `modref-${hmac(this.key, canonical({ projectId, stack, nonce: this.randomBytes(16).toString('hex') }))}`;
    this.#catalog.set(ref, { projectId, stack, expiresAt: Date.now() + this.planTtlMs }); return ref;
  }
  #pruneCatalog() { const now = Date.now(); for (const [key, value] of this.#catalog) if (value.expiresAt <= now) this.#catalog.delete(key); }

  async #findPlan(instanceId, planId) {
    if (!PLAN_REF.test(planId)) throw modError('MOD_INVALID_REF', 400, 'Invalid planId.');
    const requests = path.join(this.planRoot, instanceId, 'requests');
    for (const entry of await safeReadDir(requests, MAX_PLAN_REQUEST_RECORDS)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const plan = await readJsonFile(path.join(requests, entry.name)); await this.#validatePrivatePlan(plan, instanceId);
      if (plan.planId === planId) return plan;
    }
    throw modError('MOD_PLAN_NOT_FOUND', 404, 'The mod plan was not found.');
  }
  async #assertPlanCapacity(instanceId, reservationBytes) {
    const requestRoot = path.join(this.planRoot, instanceId, 'requests');
    await this.#gcExpiredPlans(instanceId);
    const requests = await safeReadDir(requestRoot, MAX_PLAN_REQUEST_RECORDS);
    if (requests.some((entry) => !entry.isFile() || !/^[-0-9a-f]{36}\.json$/.test(entry.name))) {
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected data exists in managed mod plan storage.');
    }
    let activePlans = 0;
    for (const entry of requests) {
      const requestId = entry.name.slice(0, -5);
      if (!await this.operation(instanceId, requestId, { allowMissing: true })) activePlans += 1;
    }
    if (activePlans >= MAX_ACTIVE_PLANS || requests.length >= MAX_ACTIVE_PLANS + MAX_RETAINED_ROLLBACKS) {
      throw modError('MOD_PLAN_QUOTA_EXCEEDED', 507, 'The bounded mod-plan reservation quota is full.');
    }
    let existingBytes = 0;
    for (const entry of await safeReadDir(path.join(this.planRoot, instanceId), MAX_PLAN_INSTANCE_ENTRIES)) {
      if (entry.name === 'requests') continue;
      if (!entry.isDirectory() || !UUID.test(entry.name)) throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected data exists in managed mod staging.');
      existingBytes += await boundedDirectoryBytes(
        path.join(this.planRoot, instanceId, entry.name), MAX_PLAN_BYTES, MAX_PLAN_TREE_ENTRIES,
      );
      if (existingBytes > MAX_PLAN_BYTES) throw modError('MOD_PLAN_QUOTA_EXCEEDED', 507, 'The bounded mod-plan storage quota is full.');
    }
    const disk = await (this.statfs ?? fs.statfs)(this.stateRoot);
    const free = Number(disk.bavail) * Number(disk.bsize);
    if (!Number.isSafeInteger(free) || reservationBytes > MAX_PLAN_BYTES - existingBytes || free < reservationBytes + MIN_FREE_BYTES) {
      throw modError('MOD_PLAN_QUOTA_EXCEEDED', 507, 'There is not enough reserved local storage for a verified mod plan and rollback snapshot.');
    }
  }
  async #assertTransactionCapacity(instanceId) {
    const root = path.join(this.transactionRoot, instanceId);
    const entries = await safeReadDir(root, MAX_TRANSACTION_INSTANCE_ENTRIES);
    let transactions = 0;
    for (const entry of entries) {
      if (entry.name === 'operations' && entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink() || !TX_REF.test(entry.name)) {
        throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected data exists in managed mod transaction storage.');
      }
      transactions += 1;
    }
    if (transactions >= MAX_TRANSACTION_RECORDS) {
      throw modError('MOD_PLAN_QUOTA_EXCEEDED', 507, 'The bounded mod transaction journal is full.');
    }
    const bytes = await boundedDirectoryBytes(root, MAX_TRANSACTION_STATE_BYTES, MAX_TRANSACTION_TREE_ENTRIES);
    if (bytes > MAX_TRANSACTION_STATE_BYTES) {
      throw modError('MOD_PLAN_QUOTA_EXCEEDED', 507, 'The bounded mod transaction storage quota is full.');
    }
  }
  async #gcExpiredPlans(instanceId) {
    const requestRoot = path.join(this.planRoot, instanceId, 'requests');
    const instanceRoot = path.join(this.planRoot, instanceId);
    const requests = new Map();
    for (const entry of await safeReadDir(requestRoot, MAX_PLAN_REQUEST_RECORDS)) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^([0-9a-f-]{36})\.json$/.test(entry.name)) {
        throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected plan request storage blocks cleanup.');
      }
      const requestId = entry.name.slice(0, -5);
      const file = path.join(requestRoot, entry.name);
      const plan = await readJsonFile(file);
      await this.#validatePrivatePlan(plan, instanceId);
      if (plan.public.requestId !== requestId) throw modError('MOD_STATE_UNAVAILABLE', 503, 'A managed mod plan has inconsistent request identity.');
      requests.set(requestId, { file, plan, directory: path.join(instanceRoot, requestId) });
    }

    const protectedRequests = new Set();
    const committed = [];
    for (const entry of await safeReadDir(
      path.join(this.transactionRoot, instanceId), MAX_TRANSACTION_INSTANCE_ENTRIES,
    )) {
      if (entry.name === 'operations') continue;
      if (!entry.isDirectory() || !TX_REF.test(entry.name)) throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected transaction storage blocks plan cleanup.');
      const txDirectory = path.join(this.transactionRoot, instanceId, entry.name);
      const marker = await readJsonFile(path.join(txDirectory, 'marker.json'));
      await this.#validateMarker(marker, instanceId, entry.name);
      const operation = await this.operation(instanceId, marker.requestId, { allowMissing: true });
      const terminal = ['committed', 'rolled-back', 'rejected-before-mutation'].includes(marker.phase)
        && operation && operation.transactionRef === marker.transactionRef && operation.planDigest === marker.planDigest
        && operation.state === marker.phase;
      if (!terminal) {
        protectedRequests.add(marker.requestId);
        continue;
      }
      await this.#cleanupTerminalPayload(txDirectory);
      if (marker.phase === 'committed') committed.push({ marker, updatedAt: Date.parse(marker.updatedAt) });
    }

    let retainedBytes = 0; let retainedCount = 0;
    for (const item of committed.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const request = requests.get(item.marker.requestId);
      if (!request || !await exists(request.directory)) continue;
      const bytes = await boundedDirectoryBytes(
        request.directory, MAX_RETAINED_ROLLBACK_BYTES, MAX_PLAN_TREE_ENTRIES,
      );
      if (retainedCount < MAX_RETAINED_ROLLBACKS && bytes <= MAX_RETAINED_ROLLBACK_BYTES - retainedBytes) {
        protectedRequests.add(item.marker.requestId); retainedCount += 1; retainedBytes += bytes;
      }
    }

    const knownDirectories = new Set(requests.keys());
    for (const entry of await safeReadDir(instanceRoot, MAX_PLAN_INSTANCE_ENTRIES)) {
      if (entry.name === 'requests') continue;
      if (/^\.gc-[0-9a-f-]{36}$/.test(entry.name)) {
        await this.#removeManagedTree(path.join(instanceRoot, entry.name), null);
        continue;
      }
      if (!entry.isDirectory() || entry.isSymbolicLink() || !UUID.test(entry.name)) {
        throw modError('MOD_STATE_UNAVAILABLE', 503, 'Unexpected managed mod staging blocks cleanup.');
      }
      if (!knownDirectories.has(entry.name)) {
        await this.#removeManagedTree(path.join(instanceRoot, entry.name), path.join(instanceRoot, `.gc-${entry.name}`));
      }
    }

    const now = Date.parse(nowIso(this.now));
    for (const [requestId, request] of requests) {
      if (Date.parse(request.plan.public.expiresAt) > now || protectedRequests.has(requestId)) {
        if (!await exists(request.directory)) throw modError('MOD_STATE_UNAVAILABLE', 503, 'A retained mod plan is missing its staged evidence.');
        continue;
      }
      if (await exists(request.directory)) {
        await this.#removeManagedTree(request.directory, path.join(instanceRoot, `.gc-${requestId}`));
      }
      await fs.rm(request.file);
    }
  }

  async #removeManagedTree(directory, tombstone) {
    if (tombstone && await exists(tombstone)) {
      await assertDirectory(tombstone, this.managedRoot);
      if (await boundedDirectoryBytes(tombstone, MAX_PLAN_BYTES, MAX_PLAN_TREE_ENTRIES) > MAX_PLAN_BYTES) {
        throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod staging exceeded its safe byte bound.');
      }
      await fs.rm(tombstone, { recursive: true, force: false });
    }
    if (!await exists(directory)) return;
    await assertDirectory(directory, this.managedRoot);
    if (await boundedDirectoryBytes(directory, MAX_PLAN_BYTES, MAX_PLAN_TREE_ENTRIES) > MAX_PLAN_BYTES) {
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod staging exceeded its safe byte bound.');
    }
    const target = tombstone ?? directory;
    if (tombstone) {
      await fs.rename(directory, tombstone);
      await assertDirectory(tombstone, this.managedRoot);
      if (await boundedDirectoryBytes(tombstone, MAX_PLAN_BYTES, MAX_PLAN_TREE_ENTRIES) > MAX_PLAN_BYTES) {
        throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod staging exceeded its safe byte bound.');
      }
    }
    await fs.rm(target, { recursive: true, force: false });
  }

  async #phase(directory, marker, phase) {
    marker.phase = phase; marker.updatedAt = nowIso(this.now);
    await this.#writeMarker(directory, marker);
    await this.onPhase(phase, clone(marker));
  }
  #markerMac(marker) { const value = clone(marker); delete value.mac; return hmac(this.key, canonical(value)); }
  async #writeMarker(directory, marker) {
    await this.#assertKeyContinuity();
    marker.mac = this.#markerMac(marker);
    await writeJsonDurable(path.join(directory, 'marker.json'), marker);
    await this.#assertKeyContinuity();
  }
  async #validateMarker(marker, instanceId, transactionRef) {
    await this.#assertKeyContinuity();
    validateAuthenticatedMarker(marker, instanceId, transactionRef, this.key);
    await this.#assertKeyContinuity();
  }
  async #writeOperation(instanceId, operation) {
    await this.#assertKeyContinuity();
    const unsigned = clone(operation); delete unsigned.mac;
    const value = { ...unsigned, mac: hmac(this.key, canonical(unsigned)) };
    validateOperation(value);
    await writeJsonDurable(this.#operationFile(instanceId, value.requestId), value);
    await this.#assertKeyContinuity();
  }
  async #appendAudit(fields) {
    const run = this.#auditQueue.then(async () => {
      await this.#assertKeyContinuity();
      const handle = await this.#openAuditHandle();
      try {
        const stat = await handle.stat();
        const previous = await this.#auditTailFromHandle(handle, stat);
        await this.#assertKeyContinuity();
        const terminalKey = fields.event === 'terminal' ? `${fields.transactionRef}:${fields.state}` : null;
        if (terminalKey && previous.terminals.has(terminalKey)) return;
        const entry = { schemaVersion: 1, sequence: previous.sequence + 1, previous: previous.mac, ...fields };
        await this.#assertKeyContinuity();
        const mac = hmac(this.key, canonical(entry));
        const line = Buffer.from(`${JSON.stringify({ ...entry, mac })}\n`);
        if (line.length > 8192 || stat.size + line.length > 16 * 1024 * 1024) throw modError('MOD_AUDIT_UNAVAILABLE', 507, 'The bounded mod audit journal is full.');
        let written = 0;
        while (written < line.length) {
          const result = await handle.write(line, written, line.length - written, stat.size + written);
          if (result.bytesWritten < 1) throw new Error('partial audit write');
          written += result.bytesWritten;
        }
        await handle.sync();
        const after = await handle.stat();
        const named = await fs.lstat(this.auditFile);
        if (after.size !== stat.size + line.length || after.nlink !== 1 || named.isSymbolicLink() || named.nlink !== 1
          || (after.ino && named.ino && (after.dev !== named.dev || after.ino !== named.ino))) throw new Error('audit identity changed');
        await this.#assertKeyContinuity();
      } finally { await handle.close(); }
    });
    this.#auditQueue = run.catch(() => undefined);
    try { return await run; } catch (error) {
      if (error?.code === 'MOD_AUDIT_UNAVAILABLE') throw error;
      throw modError('MOD_AUDIT_UNAVAILABLE', 503, 'The mod audit journal is unavailable.');
    }
  }
  async #auditTail() {
    await this.#assertKeyContinuity();
    const handle = await this.#openAuditHandle();
    try {
      const result = await this.#auditTailFromHandle(handle, await handle.stat());
      await this.#assertKeyContinuity();
      return result;
    }
    catch { throw modError('MOD_AUDIT_UNAVAILABLE', 503, 'The mod audit journal is unavailable.'); }
    finally { await handle.close(); }
  }
  async #auditTailFromHandle(handle, stat) {
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) throw new Error('unsafe audit');
    const bytes = Buffer.alloc(stat.size); let position = 0;
    while (position < bytes.length) {
      const result = await handle.read(bytes, position, bytes.length - position, position);
      if (result.bytesRead < 1) throw new Error('short audit read'); position += result.bytesRead;
    }
    let previous = { sequence: 0, mac: '0'.repeat(64), terminals: new Set() };
    const text = bytes.toString('utf8');
    if (text && !text.endsWith('\n')) throw new Error('partial audit record');
    for (const line of text ? text.slice(0, -1).split('\n') : []) {
      const value = JSON.parse(line); const mac = value.mac; delete value.mac;
      if (!HEX64.test(mac) || value.sequence !== previous.sequence + 1 || value.previous !== previous.mac
        || hmac(this.key, canonical(value)) !== mac) throw new Error('corrupt audit');
      const terminals = previous.terminals;
      if (value.event === 'terminal') terminals.add(`${value.transactionRef}:${value.state}`);
      previous = { sequence: value.sequence, mac, terminals };
    }
    return previous;
  }
  async #appendTerminalAudit(plan, marker, operation) {
    return this.#appendAudit({ event: 'terminal', instanceId: marker.instanceId, requestId: marker.requestId,
      planDigest: marker.planDigest, transactionRef: marker.transactionRef, operation: marker.operation,
      stackBefore: marker.stackBefore.generation, beforeInventoryDigest: marker.beforeDigest,
      targetInventoryDigest: operation.stackAfter?.inventoryDigest ?? marker.beforeDigest,
      snapshotRef: marker.snapshotRef, actor: 'trusted-local-command-center', state: operation.state,
      application: operation.application, failureCode: marker.failureCode, at: operation.updatedAt });
  }
  async #cleanupTerminalPayload(txDirectory) {
    for (const name of ['candidate', 'displaced', 'failed-live']) {
      const target = path.join(txDirectory, name);
      const tombstone = path.join(txDirectory, `.cleanup-${name}`);
      if (await exists(tombstone)) await this.#removeManagedTree(tombstone, null);
      if (!await exists(target)) continue;
      await this.#removeManagedTree(target, tombstone);
    }
  }
  async #ensureAuditFile() {
    try {
      const handle = await fs.open(this.auditFile, 'wx', 0o600);
      try { await handle.sync(); } finally { await handle.close(); }
    } catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  async #openAuditHandle() {
    await assertDirectory(this.stateRoot, this.managedRoot);
    const namedBefore = await fs.lstat(this.auditFile);
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1) throw new Error('unsafe audit file');
    const handle = await fs.open(this.auditFile, 'r+');
    try {
      const opened = await handle.stat();
      const namedAfter = await fs.lstat(this.auditFile);
      if (!opened.isFile() || opened.nlink !== 1 || namedAfter.isSymbolicLink() || namedAfter.nlink !== 1
        || (opened.ino && namedAfter.ino && (opened.dev !== namedAfter.dev || opened.ino !== namedAfter.ino))
        || (opened.ino && namedBefore.ino && (opened.dev !== namedBefore.dev || opened.ino !== namedBefore.ino))) throw new Error('audit identity changed');
      return handle;
    } catch (error) { await handle.close(); throw error; }
  }

  async #validatePrivatePlan(value, instanceId) {
    await this.#assertKeyContinuity();
    validatePrivatePlan(value);
    if (value.public.planId !== value.planId || value.public.planDigest !== value.planDigest
      || value.public.requestId !== value.private.request.requestId || value.private.requestDigest !== value.requestDigest
      || sha256(canonical(value.private.request)) !== value.requestDigest
      || value.public.operation !== value.private.request.operation
      || value.public.requiredConfirmation !== CONFIRMATIONS[value.public.operation]
      || value.public.rollbackSnapshot.snapshotRef !== value.private.snapshotRef
      || !SNAPSHOT_REF.test(value.private.snapshotRef) || !HEX64.test(value.private.beforeDigest)
      || !HEX64.test(value.private.snapshotDigest) || value.private.beforeDigest !== value.private.snapshotDigest
      || !Array.isArray(value.private.staged) || value.private.staged.length > MAX_MODS) throw new Error('Invalid private mod plan binding');
    validateManifest(value.private.beforeManifest, instanceId); validateManifest(value.private.targetManifest, instanceId);
    for (const item of value.private.staged) {
      if (!exactKeys(item, ['projectId', 'versionId', 'fileName', 'sha512', 'metadataDigest'])
        || !/^[A-Za-z0-9]{8}$/.test(item.projectId) || !/^[A-Za-z0-9]{8}$/.test(item.versionId)
        || !/^mastermind-[a-f0-9]{48}\.jar$/.test(item.fileName) || !/^[a-f0-9]{128}$/.test(item.sha512)
        || !HEX64.test(item.metadataDigest)) throw new Error('Invalid staged mod binding');
    }
    const publicWithoutDigest = clone(value.public); delete publicWithoutDigest.planDigest;
    if (hmac(this.key, canonical({ public: publicWithoutDigest, private: value.private })) !== value.planDigest) throw new Error('Invalid private mod plan authentication');
    await this.#assertKeyContinuity();
  }
  #publicRecovery(id) {
    const value = this.#recovery.get(id);
    return value ? { required: true, transactionRef: value.transactionRef, state: value.state }
      : { required: false, transactionRef: null, state: null };
  }
  #serialized(operation) {
    const run = this.#queue.then(async () => {
      await this.#assertKeyContinuity();
      return operation();
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #assertKeyContinuity() {
    if (!Buffer.isBuffer(this.key) || this.key.length !== 32) {
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod authentication boundary is unavailable.');
    }
    let observed;
    try { observed = await this.#loadKey({ createIfMissing: false }); }
    catch { throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod authentication boundary could not be verified.'); }
    if (!Buffer.isBuffer(observed) || observed.length !== this.key.length
      || !crypto.timingSafeEqual(observed, this.key)) {
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod authentication boundary changed after initialization.');
    }
  }

  async #freshDirectory(directory) {
    if (await exists(directory)) throw modError('MOD_REQUEST_ID_CONFLICT', 409, 'The generated mod transaction identity is already in use.');
    await assertDirectory(path.dirname(directory), this.managedRoot);
    await fs.mkdir(directory, { mode: 0o700 });
    await assertDirectory(directory, this.managedRoot);
  }

  async #ensureRoots() {
    await ensureModDirectoryChain(this.managedRoot, this.stateRoot, this.directoryGuard, this.filesystemEntryVerifier);
    for (const target of [this.manifestRoot, this.planRoot, this.transactionRoot]) {
      await ensureModDirectoryChain(this.managedRoot, target, this.directoryGuard, this.filesystemEntryVerifier);
    }
  }
  async #ensureInstanceRoots(id) {
    const planInstance = path.join(this.planRoot, id); const transactionInstance = path.join(this.transactionRoot, id);
    await ensureModDirectoryChain(this.managedRoot, planInstance, this.directoryGuard, this.filesystemEntryVerifier);
    await ensureModDirectoryChain(this.managedRoot, path.join(planInstance, 'requests'), this.directoryGuard, this.filesystemEntryVerifier);
    await ensureModDirectoryChain(this.managedRoot, transactionInstance, this.directoryGuard, this.filesystemEntryVerifier);
    await ensureModDirectoryChain(this.managedRoot, path.join(transactionInstance, 'operations'), this.directoryGuard, this.filesystemEntryVerifier);
  }
  async #loadKey({ createIfMissing = true } = {}) {
    const ancestorChain = await acquireModGuardChain(
      this.managedRoot,
      this.stateRoot,
      this.directoryGuard,
      this.filesystemEntryVerifier,
    );
    let keyGuard = null;
    let createdStat = null;
    try {
      await assertModGuardChainHeld(ancestorChain, this.filesystemEntryVerifier);
      if (!await exists(this.keyFile)) {
        if (!createIfMissing) throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod-manager key is unavailable.');
        const bytes = this.randomBytes(32);
        if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod-manager key is unavailable.');
        const handle = await fs.open(this.keyFile, FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL, 0o600);
        let failure = null;
        try {
          await handle.writeFile(bytes);
          await handle.chmod(0o600);
          await handle.sync();
          const opened = await handle.stat();
          const named = await fs.lstat(this.keyFile);
          if (!sameModFileIdentity(opened, named) || opened.size !== 32) throw new Error('unsafe key creation');
          createdStat = opened;
        } catch (error) { failure = error; }
        try { await handle.close(); } catch (error) { failure ??= error; }
        if (failure) throw failure;
      }
      keyGuard = await this.fileGuard(this.keyFile);
      keyGuard.assertHeld?.();
      await assertModGuardChainHeld(ancestorChain, this.filesystemEntryVerifier);
      await this.filesystemEntryVerifier(this.keyFile);
      const namedBefore = await fs.lstat(this.keyFile);
      if (createdStat && !sameModFileIdentity(createdStat, namedBefore)) throw new Error('unsafe key replacement');
      if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1 || namedBefore.size !== 32) throw new Error('unsafe key');
      const [realRoot, realKey] = await Promise.all([fs.realpath(this.stateRoot), fs.realpath(this.keyFile)]);
      if (!realKey.startsWith(`${realRoot}${path.sep}`)) throw new Error('unsafe key boundary');
      const handle = await fs.open(this.keyFile, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size !== 32
          || (before.ino && namedBefore.ino && (before.dev !== namedBefore.dev || before.ino !== namedBefore.ino))) throw new Error('unsafe key');
        const bytes = Buffer.alloc(32); const { bytesRead } = await handle.read(bytes, 0, 32, 0);
        const after = await handle.stat();
        const namedAfter = await fs.lstat(this.keyFile);
        await this.filesystemEntryVerifier(this.keyFile);
        if (bytesRead !== 32 || after.size !== before.size || after.nlink !== 1
          || namedAfter.isSymbolicLink() || namedAfter.nlink !== 1
          || (before.ino && after.ino && (before.dev !== after.dev || before.ino !== after.ino))
          || (after.ino && namedAfter.ino && (after.dev !== namedAfter.dev || after.ino !== namedAfter.ino))) throw new Error('unsafe key');
        await assertModGuardChainHeld(ancestorChain, this.filesystemEntryVerifier);
        return bytes;
      } finally { await handle.close(); }
    } catch (error) {
      if (error?.code === 'MOD_STATE_UNAVAILABLE') throw error;
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod-manager key is unavailable.');
    } finally {
      await releaseModGuards(keyGuard, ...ancestorChain.map((entry) => entry.guard).reverse());
    }
  }
}

function modGuardPaths(root, target) {
  const boundary = path.resolve(root);
  const resolved = path.resolve(target);
  const relative = path.relative(boundary, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod filesystem boundary is unavailable.');
  }
  const paths = [boundary];
  let cursor = boundary;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(component) || component === '.' || component === '..') {
      throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod filesystem boundary is unavailable.');
    }
    cursor = path.join(cursor, component);
    paths.push(cursor);
  }
  return paths;
}

async function acquireModGuardChain(root, target, directoryGuard, filesystemEntryVerifier) {
  return acquireModGuardBranches(root, [target], directoryGuard, filesystemEntryVerifier);
}

async function acquireModGuardBranches(root, targets, directoryGuard, filesystemEntryVerifier) {
  const chain = [];
  try {
    const unique = new Map();
    for (const target of targets) {
      for (const directory of modGuardPaths(root, target)) {
        unique.set(path.resolve(directory).toLocaleLowerCase('en-US'), path.resolve(directory));
      }
    }
    const directories = [...unique.values()].sort((left, right) => {
      const depth = modGuardPaths(root, left).length - modGuardPaths(root, right).length;
      return depth || left.localeCompare(right, 'en-US');
    });
    for (const directory of directories) {
      await assertModGuardChainHeld(chain, filesystemEntryVerifier);
      const before = await fs.lstat(directory);
      if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('unsafe mod ancestor');
      const guard = await directoryGuard(directory);
      guard.assertHeld?.();
      const after = await fs.lstat(directory);
      if (!sameModDirectoryIdentity(before, after)) throw new Error('mod ancestor changed');
      await filesystemEntryVerifier(directory);
      chain.push({ path: directory, stat: after, guard });
    }
    await assertModGuardChainHeld(chain, filesystemEntryVerifier);
    const realRoot = await fs.realpath(path.resolve(root));
    for (const target of targets) {
      const realTarget = await fs.realpath(path.resolve(target));
      const relative = path.relative(realRoot, realTarget);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('unsafe mod ancestor');
    }
    return chain;
  } catch (error) {
    await releaseModGuards(...chain.map((entry) => entry.guard).reverse()).catch(() => undefined);
    if (error?.code === 'MOD_STATE_UNAVAILABLE') throw error;
    throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod filesystem boundary is unavailable.');
  }
}

function modGuardEntry(chain, target) {
  const resolved = path.resolve(target).toLocaleLowerCase('en-US');
  const entry = chain.find((candidate) => candidate.path.toLocaleLowerCase('en-US') === resolved);
  if (!entry) throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod filesystem boundary is unavailable.');
  return entry;
}

async function ensureModDirectoryChain(root, target, directoryGuard, filesystemEntryVerifier) {
  const chain = [];
  try {
    for (const directory of modGuardPaths(root, target)) {
      await assertModGuardChainHeld(chain, filesystemEntryVerifier);
      let before;
      try { before = await fs.lstat(directory); }
      catch (error) {
        if (error?.code !== 'ENOENT' || chain.length === 0) throw error;
        chain.at(-1).guard.assertHeld?.();
        await fs.mkdir(directory, { recursive: false, mode: 0o700 });
        before = await fs.lstat(directory);
      }
      if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('unsafe mod ancestor');
      const guard = await directoryGuard(directory);
      guard.assertHeld?.();
      const after = await fs.lstat(directory);
      if (!sameModDirectoryIdentity(before, after)) throw new Error('mod ancestor changed');
      await filesystemEntryVerifier(directory);
      chain.push({ path: directory, stat: after, guard });
    }
    await assertModGuardChainHeld(chain, filesystemEntryVerifier);
    const [realRoot, realTarget] = await Promise.all([fs.realpath(path.resolve(root)), fs.realpath(path.resolve(target))]);
    const relative = path.relative(realRoot, realTarget);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('unsafe mod ancestor');
  } catch (error) {
    if (error?.code === 'MOD_STATE_UNAVAILABLE') throw error;
    throw modError('MOD_STATE_UNAVAILABLE', 503, 'The private mod filesystem boundary is unavailable.');
  } finally {
    await releaseModGuards(...chain.map((entry) => entry.guard).reverse());
  }
}

async function assertModGuardChainHeld(chain, filesystemEntryVerifier = null) {
  for (const entry of chain) {
    entry.guard.assertHeld?.();
    const current = await fs.lstat(entry.path);
    if (!sameModDirectoryIdentity(entry.stat, current)) throw new Error('mod ancestor changed');
    if (filesystemEntryVerifier) await filesystemEntryVerifier(entry.path);
  }
}

async function releaseModGuards(...guards) {
  let firstError = null;
  for (const guard of guards) {
    if (!guard) continue;
    try { await guard.release(); } catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
}

function sameModDirectoryIdentity(left, right) {
  return left?.isDirectory?.() === true && right?.isDirectory?.() === true
    && (!left.ino || !right.ino || (left.dev === right.dev && left.ino === right.ino));
}

function sameModFileIdentity(left, right) {
  return left?.isFile?.() === true && right?.isFile?.() === true && left.nlink === 1 && right.nlink === 1
    && left.size === right.size && (!left.ino || !right.ino || (left.dev === right.dev && left.ino === right.ino));
}

function validateSearch(input) {
  if (!exactKeys(input, ['query', 'offset', 'limit']) || typeof input.query !== 'string'
    || input.query.length < 1 || input.query.length > 80 || Buffer.byteLength(input.query, 'utf8') > 80
    || input.query !== input.query.trim() || /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(input.query)
    || !Number.isInteger(input.offset) || input.offset < 0 || input.offset > 1000
    || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) throw modError('MOD_INVALID_REQUEST', 400, 'Invalid catalog search request.');
  return clone(input);
}
function validatePlanRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw modError('MOD_INVALID_REQUEST', 400, 'Invalid mod plan request.');
  normalizeUuid(input.requestId);
  if (input.operation === 'install' && exactKeys(input, ['requestId', 'operation', 'catalogRef']) && CATALOG_REF.test(input.catalogRef)) return clone(input);
  if (['update', 'remove'].includes(input.operation) && exactKeys(input, ['requestId', 'operation', 'installedRef']) && INSTALLED_REF.test(input.installedRef)) return clone(input);
  if (input.operation === 'rollback' && exactKeys(input, ['requestId', 'operation', 'transactionRef']) && TX_REF.test(input.transactionRef)) return clone(input);
  throw modError('MOD_INVALID_REQUEST', 400, 'Invalid typed mod plan request.');
}
function validateActionRequest(input) {
  if (!exactKeys(input, ['requestId', 'planId', 'confirmation'])) throw modError('MOD_INVALID_REQUEST', 400, 'Invalid mod action request.');
  normalizeUuid(input.requestId);
  if (!PLAN_REF.test(input.planId) || typeof input.confirmation !== 'string' || !Object.values(CONFIRMATIONS).includes(input.confirmation)) {
    throw modError('MOD_INVALID_REQUEST', 400, 'Invalid mod approval.');
  }
  return clone(input);
}
function normalizeUuid(value) { if (typeof value !== 'string' || !UUID.test(value) || value !== value.toLowerCase()) throw modError('MOD_INVALID_REQUEST', 400, 'requestId must be a lowercase UUID.'); return value; }
function normalizeInstance(id) { if (id !== FAMILY_ID || !validateInstanceId(id)) throw modError('MOD_INVALID_INSTANCE', 400, 'Mod management is restricted to family-server.'); }

function validateManifest(value, id) {
  if (!exactKeys(value, ['schemaVersion', 'instanceId', 'roots', 'mods', 'generation', 'updatedAt']) || value.schemaVersion !== 1
    || value.instanceId !== id || !HEX64.test(value.generation) || !Array.isArray(value.roots) || !Array.isArray(value.mods)
    || value.roots.length > MAX_MODS || value.mods.length > MAX_MODS || new Set(value.roots).size !== value.roots.length
    || (value.updatedAt !== null && (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))))) throw new Error('Invalid private mod manifest');
  const projects = new Set(); const files = new Set();
  for (const item of value.mods) {
    const keys = ['projectId', 'versionId', 'title', 'version', 'environment', 'publishedAt', 'fileName', 'sha512', 'size', 'requiredProjectIds', 'metadata', 'requiredBy', 'installedAt'];
    if (!exactKeys(item, keys) || !/^[A-Za-z0-9]{8}$/.test(item.projectId) || !/^[A-Za-z0-9]{8}$/.test(item.versionId)
      || !/^mastermind-[a-f0-9]{48}\.jar$/.test(item.fileName) || !/^[a-f0-9]{128}$/.test(item.sha512)
      || !Number.isInteger(item.size) || item.size < 1 || item.size > 128 * 1024 * 1024
      || !Array.isArray(item.requiredProjectIds) || !Array.isArray(item.requiredBy) || !Array.isArray(item.metadata)
      || typeof item.installedAt !== 'string' || !Number.isFinite(Date.parse(item.installedAt))
      || safeText(item.title, 128, '') !== item.title || safeText(item.version, 128, '') !== item.version
      || !SAFE_ENVIRONMENTS.has(item.environment) || typeof item.publishedAt !== 'string' || !Number.isFinite(Date.parse(item.publishedAt))
      || item.requiredProjectIds.length > MAX_MODS || item.requiredBy.length > MAX_MODS || item.metadata.length < 1 || item.metadata.length > 4096
      || new Set(item.requiredProjectIds).size !== item.requiredProjectIds.length || new Set(item.requiredBy).size !== item.requiredBy.length
      || [...item.requiredProjectIds, ...item.requiredBy].some((projectId) => !/^[A-Za-z0-9]{8}$/.test(projectId) || projectId === item.projectId)
      || projects.has(item.projectId) || files.has(item.fileName)) throw new Error('Invalid private managed mod entry');
    for (const metadata of item.metadata) validateFabricMetadata(metadata);
    projects.add(item.projectId); files.add(item.fileName);
  }
  if (value.roots.some((root) => !projects.has(root))) throw new Error('Invalid private root set');
  const byProject = new Map(value.mods.map((item) => [item.projectId, item]));
  for (const item of value.mods) {
    for (const dependency of item.requiredProjectIds) {
      if (!byProject.get(dependency)?.requiredBy.includes(item.projectId)) throw new Error('Invalid private dependency edge');
    }
    for (const dependent of item.requiredBy) {
      if (!byProject.get(dependent)?.requiredProjectIds.includes(item.projectId)) throw new Error('Invalid private dependent edge');
    }
  }
}
function validateFabricMetadata(value) {
  if (!exactKeys(value, ['id', 'version', 'environment', 'ids', 'depends', 'breaks', 'conflicts'])
    || typeof value.id !== 'string' || typeof value.version !== 'string' || !['*', 'server'].includes(value.environment)
    || !Array.isArray(value.ids) || value.ids.length < 1 || value.ids.length > 256 || new Set(value.ids).size !== value.ids.length) throw new Error('Invalid inspected Fabric metadata');
  for (const key of ['depends', 'breaks', 'conflicts']) {
    if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]) || Object.keys(value[key]).length > 256) throw new Error('Invalid inspected Fabric predicates');
    for (const predicates of Object.values(value[key])) if (!Array.isArray(predicates) || predicates.length < 1 || predicates.length > 16 || predicates.some((item) => typeof item !== 'string' || item.length > 128)) throw new Error('Invalid inspected Fabric predicate');
  }
}
function validateStack(value) {
  if (!exactKeys(value, ['minecraftVersion', 'loader', 'loaderVersion', 'generation', 'inventoryDigest'])
    || safeText(value.minecraftVersion, 128, '') !== value.minecraftVersion || value.loader !== 'fabric'
    || safeText(value.loaderVersion, 128, '') !== value.loaderVersion || !HEX64.test(value.generation) || !HEX64.test(value.inventoryDigest)) throw new Error('Invalid mod stack binding');
}
function validateOperationStack(value) {
  if (!exactKeys(value, ['generation', 'inventoryDigest']) || !HEX64.test(value.generation) || !HEX64.test(value.inventoryDigest)) throw new Error('Invalid operation stack binding');
}
function validatePrivatePlan(value) {
  if (!exactKeys(value, ['schemaVersion', 'planId', 'planDigest', 'requestDigest', 'public', 'private']) || value.schemaVersion !== 1
    || !PLAN_REF.test(value.planId) || !HEX64.test(value.planDigest) || !HEX64.test(value.requestDigest)) throw new Error('Invalid private mod plan');
}
function validateMarker(value) {
  const required = ['schemaVersion', 'transactionRef', 'instanceId', 'requestId', 'planId', 'planDigest', 'operation', 'phase',
    'beforeManifest', 'targetManifest', 'beforeDigest', 'targetDigest', 'snapshotRef', 'stackBefore', 'stackAfter', 'startedAt', 'updatedAt', 'failureCode', 'mac'];
  if (!exactKeys(value, required) || value.schemaVersion !== 1 || !TX_REF.test(value.transactionRef) || value.instanceId !== FAMILY_ID
    || !UUID.test(value.requestId) || !PLAN_REF.test(value.planId) || !HEX64.test(value.planDigest)
    || !['install', 'update', 'remove', 'rollback'].includes(value.operation)
    || !['prepared', 'rejected-before-mutation', 'candidate-verified', 'moving-old-intent', 'old-moved', 'publishing-candidate-intent', 'candidate-published',
      'committing-manifest-intent', 'manifest-committed', 'committed', 'rolled-back', 'manual-recovery-required'].includes(value.phase)
    || !HEX64.test(value.beforeDigest) || (value.targetDigest !== null && !HEX64.test(value.targetDigest))
    || !value.stackBefore || (value.stackAfter !== null && !value.stackAfter)
    || !SNAPSHOT_REF.test(value.snapshotRef) || !HEX64.test(value.mac) || !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.updatedAt))
    || Date.parse(value.updatedAt) < Date.parse(value.startedAt)
    || (value.failureCode !== null && value.failureCode !== 'MOD_RECOVERY_REQUIRED')) throw new Error('Invalid mod transaction marker');
  validateManifest(value.beforeManifest, value.instanceId); validateManifest(value.targetManifest, value.instanceId);
  validateStack(value.stackBefore); if (value.stackAfter !== null) validateStack(value.stackAfter);
  if (['candidate-verified', 'moving-old-intent', 'old-moved', 'publishing-candidate-intent', 'candidate-published',
    'committing-manifest-intent', 'manifest-committed', 'committed'].includes(value.phase)
    && (value.targetDigest === null || value.stackAfter === null)) throw new Error('Invalid phase digest invariant');
  if (['prepared', 'rejected-before-mutation'].includes(value.phase) && (value.targetDigest !== null || value.stackAfter !== null)) throw new Error('Invalid pre-candidate phase invariant');
  if (value.phase === 'manual-recovery-required' && value.failureCode !== 'MOD_RECOVERY_REQUIRED') throw new Error('Invalid recovery failure invariant');
  if (value.phase !== 'manual-recovery-required' && value.failureCode !== null) throw new Error('Invalid non-recovery failure invariant');
}
function validateAuthenticatedMarker(value, instanceId, transactionRef, key) {
  validateMarker(value);
  if (value.instanceId !== instanceId || value.transactionRef !== transactionRef) {
    throw new Error('Mod marker directory identity mismatch');
  }
  const unsigned = clone(value);
  delete unsigned.mac;
  const expected = hmac(key, canonical(unsigned));
  if (!crypto.timingSafeEqual(Buffer.from(value.mac), Buffer.from(expected))) {
    throw new Error('Mod marker authentication failed');
  }
}
function validateOperation(value) {
  const keys = ['schemaVersion', 'requestId', 'planId', 'planDigest', 'operation', 'state', 'application', 'transactionRef',
    'stackBefore', 'stackAfter', 'rollbackSnapshot', 'summary', 'startedAt', 'updatedAt', 'mac'];
  if (!exactKeys(value, keys) || value.schemaVersion !== 1 || !UUID.test(value.requestId) || !PLAN_REF.test(value.planId) || !HEX64.test(value.planDigest)
    || !TX_REF.test(value.transactionRef) || !FINAL_STATES.has(value.state) || !['install', 'update', 'remove', 'rollback'].includes(value.operation)
    || !['verified', 'rolled-back-verified', 'unknown', 'not-applied'].includes(value.application) || !HEX64.test(value.mac)
    || !exactKeys(value.rollbackSnapshot, ['snapshotRef', 'state']) || !SNAPSHOT_REF.test(value.rollbackSnapshot.snapshotRef)
    || !['verified', 'restored-verified', 'unavailable'].includes(value.rollbackSnapshot.state)
    || !exactKeys(value.summary, ['installedCount', 'updatedCount', 'removedCount'])
    || Object.values(value.summary).some((count) => !Number.isInteger(count) || count < 0 || count > MAX_MODS)
    || Object.values(value.summary).reduce((sum, count) => sum + count, 0) > MAX_MODS
    || !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.updatedAt))
    || Date.parse(value.updatedAt) < Date.parse(value.startedAt)) throw new Error('Invalid mod operation journal');
  validateOperationStack(value.stackBefore); if (value.stackAfter !== null) validateOperationStack(value.stackAfter);
  if (value.state === 'committed' && (value.application !== 'verified' || value.stackAfter === null || value.rollbackSnapshot.state !== 'verified')) throw new Error('Invalid committed operation');
  if (value.state === 'rolled-back' && (value.application !== 'rolled-back-verified' || value.stackAfter === null || value.rollbackSnapshot.state !== 'restored-verified')) throw new Error('Invalid rolled-back operation');
  if (value.state === 'rolled-back' && canonical(value.stackAfter) !== canonical(value.stackBefore)) throw new Error('Invalid rolled-back stack truth');
  if (value.state === 'completion-unknown' && (value.application !== 'unknown' || value.stackAfter !== null || !['verified', 'unavailable'].includes(value.rollbackSnapshot.state))) throw new Error('Invalid completion-unknown operation');
  if (value.state === 'manual-recovery-required' && (value.application !== 'unknown' || value.stackAfter !== null || value.rollbackSnapshot.state !== 'unavailable')) throw new Error('Invalid manual recovery operation');
  if (value.state === 'rejected-before-mutation' && (value.application !== 'not-applied' || value.stackAfter !== null || !['verified', 'unavailable'].includes(value.rollbackSnapshot.state))) throw new Error('Invalid rejected operation');
}
function validateAuthenticatedOperation(value, requestId, key) {
  validateOperation(value);
  if (value.requestId !== requestId) throw new Error('Mod operation file identity mismatch');
  const unsigned = clone(value);
  delete unsigned.mac;
  const expected = hmac(key, canonical(unsigned));
  if (!crypto.timingSafeEqual(Buffer.from(value.mac), Buffer.from(expected))) {
    throw new Error('Mod operation authentication failed');
  }
}
function publicOperation(value) {
  validateOperation(value.mac ? value : { ...value, mac: '0'.repeat(64) });
  return clone({ requestId: value.requestId, planId: value.planId, planDigest: value.planDigest, operation: value.operation,
    state: value.state, application: value.application, transactionRef: value.transactionRef,
    stackBefore: value.stackBefore, stackAfter: value.stackAfter, rollbackSnapshot: value.rollbackSnapshot,
    summary: value.summary, startedAt: value.startedAt, updatedAt: value.updatedAt });
}
function operationRecord(plan, transactionRef, state, application, stackAfter, snapshotState, startedAt, updatedAt) {
  const changes = plan.public.changes;
  return { schemaVersion: 1, requestId: plan.public.requestId, planId: plan.planId, planDigest: plan.planDigest,
    operation: plan.public.operation, state, application, transactionRef,
    stackBefore: { generation: plan.public.stackBinding.generation, inventoryDigest: plan.public.stackBinding.inventoryDigest },
    stackAfter: stackAfter ? { generation: stackAfter.generation, inventoryDigest: stackAfter.inventoryDigest } : null,
    rollbackSnapshot: { snapshotRef: plan.public.rollbackSnapshot.snapshotRef, state: snapshotState },
    summary: { installedCount: changes.install.length, updatedCount: changes.update.length, removedCount: changes.remove.length },
    startedAt, updatedAt };
}
function diffManifests(before, after, operation) {
  const old = new Map(before.mods.map((item) => [item.projectId, item])); const next = new Map(after.mods.map((item) => [item.projectId, item]));
  const install = []; const update = []; const remove = [];
  for (const item of after.mods) {
    const previous = old.get(item.projectId);
    if (!previous) install.push({ title: item.title, versionNumber: item.version, environment: item.environment,
      reason: after.roots.includes(item.projectId) ? 'requested' : 'required-dependency' });
    else if (previous.versionId !== item.versionId) update.push({ title: item.title, fromVersion: previous.version, toVersion: item.version, environment: item.environment });
  }
  for (const item of before.mods) if (!next.has(item.projectId)) remove.push({ title: item.title, versionNumber: item.version,
    reason: before.roots.includes(item.projectId) ? 'requested' : 'orphaned-dependency' });
  return { install, update, remove };
}

async function scanFlatDirectory(
  directory,
  trustedRoot = directory,
  fileGuard = null,
  filesystemEntryVerifier = null,
) {
  const entries = await readDirectoryBounded(directory, MAX_MOD_DIR_ENTRIES, () => (
    modError('MOD_INTEGRITY_FAILED', 409, 'The mods directory exceeded its safe entry limit.')
  ));
  const result = []; const hashes = new Map(); let bytes = 0;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !/^[A-Za-z0-9._+-]{1,128}\.jar$/.test(entry.name)) throw modError('MOD_UNMANAGED_MODS_PRESENT', 409, 'The mods directory contains an unsafe or unsupported entry.');
    const file = path.join(directory, entry.name); const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mods directory contains a linked or non-regular entry.');
    bytes += stat.size; if (bytes > MAX_COPY_BYTES) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mods directory exceeded its safe byte limit.');
    const hash = fileGuard
      ? await sha512FileGuarded(file, directory, trustedRoot, fileGuard, filesystemEntryVerifier)
      : await sha512File(file, { anchorRoot: directory, trustedRoot });
    result.push({ name: entry.name, size: stat.size, sha512: hash }); hashes.set(entry.name, hash);
  }
  return { entries: result, hashes };
}
function digestEntries(entries) { return sha256(canonical(entries)); }
async function copyFlatDirectory(source, destination, trustedRoot = source) {
  const scan = await scanFlatDirectory(source, trustedRoot); await fs.mkdir(destination, { mode: 0o700 });
  for (const entry of scan.entries) await copyRegularFile(path.join(source, entry.name), path.join(destination, entry.name), entry.sha512);
  const copied = await scanFlatDirectory(destination, trustedRoot);
  if (digestEntries(copied.entries) !== digestEntries(scan.entries)) throw modError('MOD_SNAPSHOT_FAILED', 507, 'The mod snapshot copy did not verify.');
  return copied;
}
async function copyRegularFile(source, destination, expectedSha512) {
  const namedBefore = await fs.lstat(source);
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1) throw modError('MOD_INTEGRITY_FAILED', 409, 'A source mod entry is not a safe regular file.');
  const input = await fs.open(source, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
  const output = await fs.open(destination, 'wx', 0o600);
  const hash = crypto.createHash('sha512');
  try {
    const opened = await input.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size !== namedBefore.size
      || (opened.ino && namedBefore.ino && (opened.dev !== namedBefore.dev || opened.ino !== namedBefore.ino))) throw modError('MOD_INTEGRITY_FAILED', 409, 'A source mod entry changed before copying.');
    const buffer = Buffer.allocUnsafe(1024 * 1024); let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (bytesRead < 1) throw modError('MOD_INTEGRITY_FAILED', 409, 'A source mod entry could not be copied completely.');
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, null);
        if (result.bytesWritten < 1) throw modError('MOD_INTEGRITY_FAILED', 409, 'A destination mod entry could not be written completely.');
        written += result.bytesWritten;
      }
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    await output.sync();
    const [inputAfter, outputAfter, namedAfter, destinationNamed] = await Promise.all([
      input.stat(), output.stat(), fs.lstat(source), fs.lstat(destination),
    ]);
    if (inputAfter.size !== opened.size || inputAfter.nlink !== 1 || namedAfter.isSymbolicLink()
      || namedAfter.nlink !== 1 || outputAfter.size !== opened.size || outputAfter.nlink !== 1
      || destinationNamed.isSymbolicLink() || destinationNamed.nlink !== 1
      || (opened.ino && namedAfter.ino && (opened.dev !== namedAfter.dev || opened.ino !== namedAfter.ino))
      || (outputAfter.ino && destinationNamed.ino && (outputAfter.dev !== destinationNamed.dev || outputAfter.ino !== destinationNamed.ino))
      || hash.digest('hex') !== expectedSha512) throw modError('MOD_INTEGRITY_FAILED', 409, 'A copied mod entry failed identity or hash verification.');
  } finally { await Promise.allSettled([input.close(), output.close()]); }
}
async function exists(file) { try { await fs.lstat(file); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }
async function readDirectoryBounded(directory, maximumEntries, overflowError) {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 0 || typeof overflowError !== 'function') {
    throw new TypeError('Invalid managed directory entry bound');
  }
  const handle = await fs.opendir(directory);
  const entries = [];
  try {
    while (true) {
      const entry = await handle.read();
      if (!entry) break;
      if (entries.length >= maximumEntries) throw overflowError();
      entries.push(entry);
    }
    return entries;
  } finally { await handle.close().catch(() => undefined); }
}
async function safeReadDir(directory, maximumEntries) {
  try {
    return await readDirectoryBounded(directory, maximumEntries, () => (
      modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod state exceeded its safe entry bound.')
    ));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}
async function probeSingleExpectedEntry(directory, predicate) {
  if (typeof predicate !== 'function') throw new TypeError('Invalid managed directory probe');
  let handle;
  try { handle = await fs.opendir(directory); }
  catch (error) {
    if (error?.code === 'ENOENT') return { empty: true, unexpected: false };
    throw error;
  }
  try {
    const first = await handle.read();
    if (!first) return { empty: true, unexpected: false };
    if (!predicate(first)) return { empty: false, unexpected: true };
    return { empty: false, unexpected: Boolean(await handle.read()) };
  } finally { await handle.close().catch(() => undefined); }
}
async function boundedDirectoryBytes(directory, limit, entryLimit) {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isInteger(entryLimit) || entryLimit < 0) {
    throw new TypeError('Invalid managed staging bound');
  }
  let total = 0;
  let entryCount = 0;
  const visit = async (current, depth) => {
    if (depth > 4) throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod staging exceeded its safe depth.');
    const entries = await readDirectoryBounded(current, entryLimit - entryCount, () => (
      modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod staging exceeded its safe entry bound.')
    ));
    for (const entry of entries) {
      if (entryCount >= entryLimit) {
        throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod staging exceeded its safe entry bound.');
      }
      entryCount += 1;
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod staging contains a link.');
      if (entry.isDirectory()) await visit(target, depth + 1);
      else if (entry.isFile()) {
        const stat = await fs.lstat(target); if (stat.nlink !== 1) throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod staging contains a linked file.');
        total += stat.size; if (total > limit) return;
      } else throw modError('MOD_STATE_UNAVAILABLE', 503, 'Managed mod staging contains an unsupported entry.');
      if (total > limit) return;
    }
  };
  await visit(directory, 0); return total;
}
async function readJsonFile(file) {
  const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_STATE_BYTES) throw new Error('Unsafe state file');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function readJsonFileGuarded(file, fileGuard, filesystemEntryVerifier = null) {
  const guard = await fileGuard(file);
  let handle = null;
  try {
    guard.assertHeld?.();
    if (filesystemEntryVerifier) await filesystemEntryVerifier(file);
    const namedBefore = await fs.lstat(file);
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1
      || namedBefore.size < 2 || namedBefore.size > MAX_STATE_BYTES) throw new Error('Unsafe state file');
    handle = await fs.open(file, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
    const openedBefore = await handle.stat();
    if (!sameModFileIdentity(namedBefore, openedBefore)) throw new Error('State file identity changed');
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat();
    const namedAfter = await fs.lstat(file);
    if (!sameModFileIdentity(openedBefore, openedAfter) || !sameModFileIdentity(openedAfter, namedAfter)) {
      throw new Error('State file identity changed');
    }
    if (filesystemEntryVerifier) await filesystemEntryVerifier(file);
    guard.assertHeld?.();
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    let failure = null;
    if (handle) try { await handle.close(); } catch (error) { failure = error; }
    try { await guard.release(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  }
}

async function sha512FileGuarded(file, anchorRoot, trustedRoot, fileGuard, filesystemEntryVerifier = null) {
  const guard = await fileGuard(file);
  try {
    guard.assertHeld?.();
    if (filesystemEntryVerifier) await filesystemEntryVerifier(file);
    const digest = await sha512File(file, { anchorRoot, trustedRoot });
    if (filesystemEntryVerifier) await filesystemEntryVerifier(file);
    guard.assertHeld?.();
    return digest;
  } finally { await guard.release(); }
}

async function inspectFabricModJarGuarded(file, options, fileGuard, filesystemEntryVerifier = null) {
  const guard = await fileGuard(file);
  try {
    guard.assertHeld?.();
    if (filesystemEntryVerifier) await filesystemEntryVerifier(file);
    const metadata = await inspectFabricModJar(file, options);
    if (filesystemEntryVerifier) await filesystemEntryVerifier(file);
    guard.assertHeld?.();
    return metadata;
  } finally { await guard.release(); }
}
async function writeJsonDurable(file, value) {
  await assertDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, file);
  const parent = await fs.open(path.dirname(file), 'r'); try { await parent.sync(); } catch { /* Windows may not sync directories. */ } finally { await parent.close(); }
}
async function assertDirectory(directory, managedRoot = null) {
  const stat = await fs.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw modError('MOD_STATE_UNAVAILABLE', 503, 'The mod-manager storage boundary is unsafe.');
  if (managedRoot) {
    const [root, actual] = await Promise.all([fs.realpath(managedRoot), fs.realpath(directory)]);
    if (actual !== root && !actual.startsWith(`${root}${path.sep}`)) throw modError('MOD_STATE_UNAVAILABLE', 503, 'The mod-manager storage boundary escaped its managed root.');
  }
}
async function mkdirChecked(directory, managedRoot = null) {
  try { await fs.mkdir(directory, { mode: 0o700 }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
  await assertDirectory(directory, managedRoot);
}

export const FAMILY_MOD_CONFIRMATIONS = CONFIRMATIONS;
