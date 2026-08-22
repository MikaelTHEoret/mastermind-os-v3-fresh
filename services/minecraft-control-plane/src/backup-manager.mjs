import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateInstanceId } from './config.mjs';
import { minecraftServerRelativePath } from './minecraft-server-version.mjs';
import {
  acquireWindowsDirectoryGuard,
  acquireWindowsFileGuard,
  assertWindowsFilesystemTree,
} from './windows-filesystem-safety.mjs';
import { createWindowsFilesystemSafetyBroker } from './backup-windows-safety-scope.mjs';

const BACKUP_ID = /^bkp-[a-f0-9]{32}$/;
const RESTORE_PLAN_ID = /^rst-[a-f0-9]{64}$/;
const TRANSACTION_ID = /^rtx-[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const INTERVALS = new Set([6, 12, 24, 72, 168]);
const KINDS = new Set(['manual', 'automatic', 'rescue']);
const RESTORE_PHASES = new Set([
  'rescue-ready', 'candidate-ready', 'original-backed-up', 'candidate-published',
  'store-committed', 'ready', 'rolled-back', 'manual-recovery-required',
]);
const RESTORE_MARKER_KEYS = new Set([
  'schemaVersion', 'transactionId', 'instanceId', 'backupId', 'rescueBackupId',
  'phase', 'createdAt', 'updatedAt', 'expectedTree', 'stackDigest',
  'worldStackBinding', 'originalTreeDigest', 'originalLastRestore', 'targetLastRestore', 'failureCode', 'mac',
]);
const CLEANUP_ID = /^cln-[a-f0-9]{32}$/;
const CLEANUP_MARKER_KEYS = new Set([
  'schemaVersion', 'cleanupId', 'instanceId', 'namespace', 'targetName',
  'tombstoneName', 'createdAt', 'mac',
]);
const MANIFEST_KEYS = new Set([
  'schemaVersion', 'policyVersion', 'backupId', 'instanceId', 'kind', 'createdAt',
  'minecraftVersion', 'levelName', 'stackDigest', 'worldStackBinding', 'tree',
  'integrity', 'verifiedAt', 'lastVerificationFailedAt',
]);
const MANIFEST_TREE_KEYS = new Set(['algorithm', 'digest', 'files', 'bytes', 'entries']);
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_POLICY_BYTES = 64 * 1024;
const MAX_FILES = 500_000;
const MAX_BYTES = 128 * 1024 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_RESTORE_MARKERS = 4_096;
const MAX_RESTORE_MARKER_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOTS_PER_INSTANCE = 4_096;
const MAX_RESTORE_PLANS = 4_096;
const MAX_RESTORE_PLANS_PER_INSTANCE = 128;
const PLAN_TTL_MS = 5 * 60 * 1000;
const AUTOMATIC_RETRY_BASE_MS = 5 * 60 * 1000;
const AUTOMATIC_RETRY_MAX_MS = 60 * 60 * 1000;
const RESCUE_PROTECTED_COUNT = 3;
const POLICY_VERSION = 1;
const MAX_GUARD_BATCH_ENTRIES = 128;
const DEFAULT_POLICY = Object.freeze({ enabled: false, intervalHours: 24, retentionCount: 7 });
const PRESERVE_TOP_LEVEL = new Set(['.fabric', 'libraries', 'versions']);
const DISCARD_TOP_LEVEL = new Set(['logs', 'crash-reports', 'debug']);
const FIXED_MANAGED_FILES = new Set([
  'instance.json',
  'fabric-server-launch.jar',
  'mods/fabric-api.jar',
  'mods/geyser-fabric.jar',
  'mods/floodgate-fabric.jar',
  'config/Geyser-Fabric/config.yml',
]);

function defaultFileGuard(file) {
  return acquireWindowsFileGuard(file, { unlink: fs.unlink, rename: fs.rename });
}

defaultFileGuard.batch = (files) => acquireWindowsFileGuard.batch(files, {
  unlink: fs.unlink,
  rename: fs.rename,
});

/**
 * Private, transactional snapshots for the isolated Family Server.
 *
 * Public callers provide only validated instance/backup/plan identifiers. All
 * filesystem roots, exclusion policy, transaction paths, and snapshot kinds
 * are derived by this local service.
 */
export class FamilyServerBackupManager {
  #queue = Promise.resolve();
  #plans = new Map();
  #dueRun = null;
  #recoveryRequired = new Set();
  #globalRecoveryRequired = false;
  #cleanupRecoveryRequired = new Set();
  #cleanupGlobalRecoveryRequired = false;

  constructor(managedRoot, store, options = {}) {
    if (typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)) throw new TypeError('managedRoot must be an absolute path');
    if (!store || typeof store.get !== 'function' || typeof store.list !== 'function') throw new TypeError('A compatible instance store is required');
    if (typeof options.withInstanceLock !== 'function') throw new TypeError('withInstanceLock is required');
    if (typeof options.assertQuiescentWithinInstanceLock !== 'function') throw new TypeError('assertQuiescentWithinInstanceLock is required');
    if (typeof options.verifyInstall !== 'function') throw new TypeError('verifyInstall is required');
    if (typeof options.currentWorldStackBindingWithinInstanceLock !== 'function') {
      throw new TypeError('currentWorldStackBindingWithinInstanceLock is required');
    }
    this.managedRoot = path.resolve(managedRoot);
    this.serverRoot = path.join(this.managedRoot, 'servers');
    this.snapshotRoot = path.join(this.managedRoot, 'operator-backups', 'snapshots');
    this.stateRoot = path.join(this.managedRoot, 'state', 'operator-backups');
    this.policyRoot = path.join(this.stateRoot, 'policies');
    this.transactionRoot = path.join(this.stateRoot, 'restore-transactions');
    this.cleanupRoot = path.join(this.stateRoot, 'cleanup-transactions');
    this.keyFile = path.join(this.stateRoot, 'hmac.key');
    this.store = store;
    this.withInstanceLock = options.withInstanceLock;
    this.assertQuiescentWithinInstanceLock = options.assertQuiescentWithinInstanceLock;
    this.verifyInstall = options.verifyInstall;
    this.currentWorldStackBindingWithinInstanceLock = options.currentWorldStackBindingWithinInstanceLock;
    this.validateRestoredWorldWithinInstanceLock = options.validateRestoredWorldWithinInstanceLock ?? null;
    if (this.validateRestoredWorldWithinInstanceLock !== null && typeof this.validateRestoredWorldWithinInstanceLock !== 'function') {
      throw new TypeError('validateRestoredWorldWithinInstanceLock must be a function');
    }
    this.assertWorldMutationAllowedWithinInstanceLock = options.assertWorldMutationAllowedWithinInstanceLock ?? null;
    if (this.assertWorldMutationAllowedWithinInstanceLock !== null
      && typeof this.assertWorldMutationAllowedWithinInstanceLock !== 'function') {
      throw new TypeError('assertWorldMutationAllowedWithinInstanceLock must be a function');
    }
    this.now = options.now ?? (() => new Date().toISOString());
    this.randomBytes = options.randomBytes ?? crypto.randomBytes;
    this.maxFiles = options.maxFiles ?? MAX_FILES;
    this.maxBytes = options.maxBytes ?? MAX_BYTES;
    this.maxRestoreMarkers = options.maxRestoreMarkers ?? MAX_RESTORE_MARKERS;
    this.maxRestoreMarkerBytes = options.maxRestoreMarkerBytes ?? MAX_RESTORE_MARKER_BYTES;
    this.maxManifestBytes = options.maxManifestBytes ?? MAX_MANIFEST_BYTES;
    this.maxSnapshots = options.maxSnapshots ?? MAX_SNAPSHOTS_PER_INSTANCE;
    this.maxRestorePlans = options.maxRestorePlans ?? MAX_RESTORE_PLANS;
    this.maxRestorePlansPerInstance = options.maxRestorePlansPerInstance ?? MAX_RESTORE_PLANS_PER_INSTANCE;
    if (!Number.isInteger(this.maxRestoreMarkers) || this.maxRestoreMarkers < 1
      || this.maxRestoreMarkers > MAX_RESTORE_MARKERS) throw new TypeError('maxRestoreMarkers is invalid');
    if (!Number.isInteger(this.maxRestoreMarkerBytes) || this.maxRestoreMarkerBytes < 2
      || this.maxRestoreMarkerBytes > MAX_RESTORE_MARKER_BYTES) throw new TypeError('maxRestoreMarkerBytes is invalid');
    if (!Number.isInteger(this.maxManifestBytes) || this.maxManifestBytes < 2
      || this.maxManifestBytes > MAX_MANIFEST_BYTES) throw new TypeError('maxManifestBytes is invalid');
    if (!Number.isInteger(this.maxSnapshots) || this.maxSnapshots < 1
      || this.maxSnapshots > MAX_SNAPSHOTS_PER_INSTANCE) throw new TypeError('maxSnapshots is invalid');
    if (!Number.isInteger(this.maxRestorePlans) || this.maxRestorePlans < 1
      || this.maxRestorePlans > MAX_RESTORE_PLANS) throw new TypeError('maxRestorePlans is invalid');
    if (!Number.isInteger(this.maxRestorePlansPerInstance) || this.maxRestorePlansPerInstance < 1
      || this.maxRestorePlansPerInstance > MAX_RESTORE_PLANS_PER_INSTANCE) {
      throw new TypeError('maxRestorePlansPerInstance is invalid');
    }
    const suppliedSafetyBroker = options.filesystemSafetyBroker;
    if (suppliedSafetyBroker !== undefined && (
      !suppliedSafetyBroker || typeof suppliedSafetyBroker !== 'object'
      || typeof suppliedSafetyBroker.runOperation !== 'function'
      || typeof suppliedSafetyBroker.directoryGuard !== 'function'
      || typeof suppliedSafetyBroker.fileGuard !== 'function'
      || typeof suppliedSafetyBroker.filesystemTreeVerifier !== 'function'
    )) throw new TypeError('filesystemSafetyBroker is invalid');
    const hasExplicitFilesystemDependency = options.filesystemTreeVerifier !== undefined
      || options.directoryGuard !== undefined || options.fileGuard !== undefined;
    const nativeFilesystemMode = (options.platform ?? process.platform) === 'win32';
    const safetyBroker = suppliedSafetyBroker ?? (nativeFilesystemMode && !hasExplicitFilesystemDependency
      ? createWindowsFilesystemSafetyBroker({
        ...(options.platform === undefined ? {} : { platform: options.platform }),
      })
      : null);
    this.runFilesystemSafetyOperation = safetyBroker
      ? (operation) => safetyBroker.runOperation(operation)
      : async (operation) => operation();
    this.filesystemTreeVerifier = options.filesystemTreeVerifier
      ?? safetyBroker?.filesystemTreeVerifier
      ?? assertWindowsFilesystemTree;
    if (typeof this.filesystemTreeVerifier !== 'function') throw new TypeError('filesystemTreeVerifier must be a function');
    this.directoryGuard = options.directoryGuard ?? safetyBroker?.directoryGuard ?? acquireWindowsDirectoryGuard;
    if (typeof this.directoryGuard !== 'function') throw new TypeError('directoryGuard must be a function');
    this.fileGuard = options.fileGuard ?? safetyBroker?.fileGuard ?? defaultFileGuard;
    if (typeof this.fileGuard !== 'function') throw new TypeError('fileGuard must be a function');
    this.planTtlMs = options.planTtlMs ?? PLAN_TTL_MS;
    this.onPhase = options.onPhase ?? (() => undefined);
    this.key = null;
    this.initialized = false;
  }

  async initialize() {
    let stage = 'integration';
    let operationCompleted = false;
    try {
      const result = await this.#withFilesystemSafety(async () => {
        this.#assertIntegrationConfigured();
        stage = 'storage-roots';
        await this.#ensureStorageRoots();
        stage = 'authentication-key';
        this.key = await this.#loadKey();
        stage = 'cleanup-recovery';
        const cleanupRecovery = await this.#reconcileInterruptedCleanups();
        stage = 'restore-recovery';
        const recovery = await this.#reconcileInterruptedTransactions();
        operationCompleted = true;
        return [...cleanupRecovery, ...recovery];
      });
      this.initialized = true;
      return result;
    } catch (error) {
      const safe = sanitizePublicError(error);
      Object.defineProperty(safe, 'backupInitializationStage', {
        value: operationCompleted ? 'filesystem-safety-close' : stage,
        enumerable: false,
        configurable: true,
      });
      throw safe;
    }
  }

  async preflightRecoveryEvidence() {
    return this.#safePublic(() => this.#withFilesystemSafety(async () => {
      this.#assertIntegrationConfigured();
      let transactionRootStat;
      try { transactionRootStat = await fs.lstat(this.transactionRoot); }
      catch (error) {
        if (error?.code === 'ENOENT') return { domain: 'backup', instances: [] };
        throw error;
      }
      if (!transactionRootStat.isDirectory() || transactionRootStat.isSymbolicLink()) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery evidence has an invalid root');
      }
      await assertRegularDirectory(this.transactionRoot, this.stateRoot, 'Restore transaction root');
      let rootGuard;
      if (typeof this.directoryGuard?.batch === 'function') {
        [rootGuard] = await acquireVerifiedDirectoryGuardBatch(
          [{ path: this.transactionRoot, stat: transactionRootStat }], this.directoryGuard, 'Restore transaction root',
        );
      } else {
        rootGuard = await this.directoryGuard(this.transactionRoot);
      }
      try {
        rootGuard.assertHeld?.();
        await this.filesystemTreeVerifier(this.transactionRoot, {
          maxEntries: this.maxRestoreMarkers,
          maxDepth: 0,
          recursive: false,
        });
        const entries = await safeDirectoryEntries(this.transactionRoot, {
          maxEntries: this.maxRestoreMarkers,
          limitError: () => backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery evidence exceeds its safe entry limit'),
        });
        if (entries.length === 0) return { domain: 'backup', instances: [] };
        const key = await this.#loadKey({ createIfMissing: false });
        let aggregateBytes = 0;
        const instances = [];
        const markerRecords = [];
        for (const entry of entries) {
          const transactionId = entry.name.slice(0, -5);
          if (!entry.isFile() || entry.name !== `${transactionId}.json` || !TRANSACTION_ID.test(transactionId)) {
            throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery evidence contains an invalid entry');
          }
          const markerFile = path.join(this.transactionRoot, entry.name);
          const stat = await safeLstat(markerFile);
          aggregateBytes += stat.size;
          if (!stat.isFile() || stat.size < 2 || stat.size > MAX_POLICY_BYTES
            || aggregateBytes > this.maxRestoreMarkerBytes) {
            throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery evidence exceeds its safe byte limit');
          }
          markerRecords.push({ path: markerFile, stat, transactionId });
        }
        const markerValues = await readSmallJsonGuardedBatch(
          markerRecords, MAX_POLICY_BYTES, 'Restore transaction marker', this.fileGuard, { requireCanonical: true },
        );
        for (let index = 0; index < markerRecords.length; index += 1) {
          const transactionId = markerRecords[index].transactionId;
          const marker = authenticateRestoreMarker(key, markerValues[index]);
          validateTransactionMarker(marker, transactionId);
          if (!['ready', 'rolled-back'].includes(marker.phase)) {
            instances.push({ instanceId: marker.instanceId, transactionRef: transactionId });
          }
        }
        if (instances.length > this.maxRestoreMarkers) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery evidence exceeds its safe bound');
        }
        return { domain: 'backup', instances };
      } finally {
        await releaseGuards(rootGuard);
      }
    }));
  }

  async list(input) {
    const { instanceId } = validateInstanceOnly(input);
    return this.#safePublic(() => this.withInstanceLock(instanceId, () => this.#serialized(async () => {
        await this.#ensureStorageRoots();
        const instance = await this.#instance(instanceId);
        // The native Windows safety broker deliberately rejects overlapping
        // guards for the same path. Policy and inventory reads both verify the
        // shared backup roots, so keep them ordered inside this one scope.
        const policyState = await this.#readPolicyState(instanceId, { storageReady: true });
        const allBackups = await this.#listBackups(instance, { limit: null, storageReady: true });
        return {
          instanceId,
          policy: publicPolicy(policyState.policy),
          status: scheduleStatus(policyState, allBackups, instance, Date.parse(this.now())),
          backups: allBackups.slice(0, 100),
        };
      })));
  }

  async create(input) {
    return this.#safePublic(async () => {
      const { instanceId } = validateInstanceOnly(input);
      await this.assertSafeForLifecycle({ instanceId });
      return this.withInstanceLock(instanceId, () => this.#serialized(async () => {
        await this.assertSafeForLifecycle({ instanceId });
        return this.#createWithinLock(instanceId, 'manual');
      }));
    });
  }

  setWorldInterlock(callback) {
    if (typeof callback !== 'function') throw new TypeError('world interlock must be a function');
    if (this.initialized) throw new TypeError('world interlock cannot change after backup initialization');
    this.assertWorldMutationAllowedWithinInstanceLock = callback;
  }

  setWorldRestoreValidator(callback) {
    if (typeof callback !== 'function') throw new TypeError('world restore validator must be a function');
    if (this.initialized) throw new TypeError('world restore validator cannot change after backup initialization');
    this.validateRestoredWorldWithinInstanceLock = callback;
  }

  #assertIntegrationConfigured() {
    if (typeof this.assertWorldMutationAllowedWithinInstanceLock !== 'function') {
      throw backupError('BACKUP_UNAVAILABLE', 503, 'The authenticated world mutation interlock is unavailable');
    }
    if (typeof this.validateRestoredWorldWithinInstanceLock !== 'function') {
      throw backupError('BACKUP_WORLD_VALIDATOR_UNAVAILABLE', 503, 'The authenticated world restore validator is unavailable');
    }
  }

  async createRescueWithinInstanceLock(instanceId) {
    this.#assertIntegrationConfigured();
    const { instanceId: checked } = validateInstanceOnly({ instanceId });
    await this.assertSafeForLifecycle({ instanceId: checked });
    return this.#serialized(async () => {
      await this.assertWorldMutationAllowedWithinInstanceLock(checked);
      return this.#createWithinLock(checked, 'rescue');
    });
  }

  async assertVerifiedSnapshotWithinInstanceLock(instanceId, backupId) {
    const request = validateBackupInput({ instanceId, backupId });
    await this.assertSafeForLifecycle({ instanceId: request.instanceId });
    return this.#serialized(async () => {
      const instance = await this.#quiescentInstance(request.instanceId);
      const verified = await this.#verifySnapshot(instance, request.backupId, { recordResult: false });
      return Object.freeze({
        backupId: verified.manifest.backupId,
        integrity: 'verified',
        identityDigest: verified.identityDigest,
      });
    });
  }

  async verify(input) {
    return this.#safePublic(async () => {
      const request = validateBackupInput(input);
      await this.assertSafeForLifecycle({ instanceId: request.instanceId });
      return this.withInstanceLock(request.instanceId, () => this.#serialized(async () => {
        await this.assertSafeForLifecycle({ instanceId: request.instanceId });
        await this.assertWorldMutationAllowedWithinInstanceLock(request.instanceId);
        const instance = await this.#quiescentInstance(request.instanceId);
        const verified = await this.#verifySnapshot(instance, request.backupId, { recordResult: true });
        return publicBackup(verified.manifest, { restorable: true, purgeable: await this.#purgeable(instance, verified.manifest) });
      }));
    });
  }

  async setPolicy(input) {
    return this.#safePublic(async () => {
      const request = validatePolicyInput(input);
      await this.assertSafeForLifecycle({ instanceId: request.instanceId });
      return this.withInstanceLock(request.instanceId, () => this.#serialized(async () => {
        await this.assertSafeForLifecycle({ instanceId: request.instanceId });
        await this.assertWorldMutationAllowedWithinInstanceLock(request.instanceId);
        const instance = await this.#quiescentInstance(request.instanceId);
        const current = await this.#readPolicyState(instance.id);
        const next = {
          schemaVersion: 1,
          instanceId: instance.id,
          policy: request.policy,
          lastAutomaticAttemptAt: current.lastAutomaticAttemptAt,
          lastAutomaticResult: current.lastAutomaticResult,
          automaticFailureCount: current.automaticFailureCount ?? 0,
          lastAutomaticError: current.lastAutomaticError ?? null,
          lastRetentionError: current.lastRetentionError ?? null,
          lastError: current.lastError ?? null,
          updatedAt: this.now(),
        };
        await this.#writePrivateJson(this.#policyFile(instance.id), next);
        const backups = await this.#listBackups(instance, { limit: null });
        return { instanceId: instance.id, policy: publicPolicy(next.policy), status: scheduleStatus(next, backups, instance, Date.parse(this.now())) };
      }));
    });
  }

  async createRestorePlan(input) {
    return this.#safePublic(async () => {
      const request = validateBackupInput(input);
      await this.assertSafeForLifecycle({ instanceId: request.instanceId });
      return this.withInstanceLock(request.instanceId, () => this.#serialized(async () => {
      await this.assertSafeForLifecycle({ instanceId: request.instanceId });
      await this.assertWorldMutationAllowedWithinInstanceLock(request.instanceId);
      const instance = await this.#quiescentInstance(request.instanceId);
      this.#prunePlans();
      this.#assertRestorePlanCapacity(instance.id);
      await this.verifyInstall(instance);
      const snapshot = await this.#verifySnapshot(instance, request.backupId, { recordResult: true });
      if (snapshot.manifest.minecraftVersion !== instance.minecraftVersion) {
        throw backupError('BACKUP_VERSION_INCOMPATIBLE', 409, 'This backup belongs to a different Minecraft version and cannot be restored into the current managed stack');
      }
      const policy = await this.#snapshotPolicy(instance.directory);
      const currentTree = await scanTree(instance.directory, policy, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
      const stackDigest = stackIdentity(instance);
      const worldStackBinding = await this.#worldStackBinding(instance.id);
      if (snapshot.manifest.stackDigest !== stackDigest
        || !sameWorldStackBinding(snapshot.manifest.worldStackBinding, worldStackBinding)) {
        throw backupError('BACKUP_STACK_INCOMPATIBLE', 409, 'This backup belongs to a different managed world and mod stack');
      }
      const expiresAt = new Date(Date.parse(this.now()) + this.planTtlMs).toISOString();
      const seed = this.randomBytes(32);
      const planId = `rst-${sha256(Buffer.concat([seed, Buffer.from(canonicalJson({
        instanceId: instance.id,
        backupId: request.backupId,
        backupDigest: snapshot.identityDigest,
        currentTreeDigest: currentTree.digest,
        stackDigest,
        worldStackBinding,
        expiresAt,
      }))]))}`;
      if (!RESTORE_PLAN_ID.test(planId)) throw new Error('Restore plan generation failed');
      if (this.#plans.has(planId)) throw backupError('BACKUP_ID_COLLISION', 409, 'Restore plan identity is already occupied');
      this.#plans.set(planId, {
        instanceId: instance.id,
        backupId: request.backupId,
        backupDigest: snapshot.identityDigest,
        currentTreeDigest: currentTree.digest,
        stackDigest,
        worldStackBinding,
        expiresAt,
      });
      return {
        planId,
        backupId: request.backupId,
        expiresAt,
        minecraftVersion: snapshot.manifest.minecraftVersion,
        currentMinecraftVersion: instance.minecraftVersion,
        safetySnapshotRequired: true,
      };
      }));
    });
  }

  async restore(input) {
    return this.#safePublic(async () => {
      const request = validateRestoreInput(input);
      await this.assertSafeForLifecycle({ instanceId: request.instanceId });
      return this.withInstanceLock(request.instanceId, () => this.#serialized(async () => {
        await this.assertSafeForLifecycle({ instanceId: request.instanceId });
        await this.assertWorldMutationAllowedWithinInstanceLock(request.instanceId);
        return this.#restoreWithinLock(request);
      }));
    });
  }

  async purge(input) {
    return this.#safePublic(async () => {
      const request = validatePurgeInput(input);
      await this.assertSafeForLifecycle({ instanceId: request.instanceId });
      return this.withInstanceLock(request.instanceId, () => this.#serialized(async () => {
      await this.assertSafeForLifecycle({ instanceId: request.instanceId });
      await this.assertWorldMutationAllowedWithinInstanceLock(request.instanceId);
      const instance = await this.#quiescentInstance(request.instanceId);
      const protection = await this.#freshProtection(instance);
      if (!protection.backups.some((item) => item.backupId === request.backupId)) {
        throw backupError('BACKUP_NOT_FOUND', 404, 'Backup was not found');
      }
      if (protection.protectedIds.has(request.backupId)) {
        throw backupError('BACKUP_PROTECTED', 409, 'This rescue or last verified backup is protected from deletion');
      }
      const immediateProtection = await this.#freshProtection(instance);
      if (immediateProtection.protectedIds.has(request.backupId)) {
        throw backupError('BACKUP_PROTECTED', 409, 'This backup is referenced by authenticated restore state');
      }
      await this.#purgeSnapshotDirectory(instance.id, request.backupId);
      return { backupId: request.backupId, purgedAt: this.now() };
      }));
    });
  }

  async assertSafeForLifecycle(input) {
    const { instanceId } = validateInstanceOnly(input);
    return this.#withFilesystemSafety(async () => {
    if (!this.initialized || !this.key) {
      throw backupError('BACKUP_UNAVAILABLE', 503, 'Backup recovery authentication has not completed initialization');
    }
    await this.#assertKeyContinuity();
    let evidence;
    try {
      evidence = await this.preflightRecoveryEvidence();
    } catch {
      this.#globalRecoveryRequired = true;
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup recovery evidence requires verified manual recovery before lifecycle changes');
    }
    await this.#assertKeyContinuity();
    if (evidence.instances.some((item) => item.instanceId === instanceId)) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'A backup restore transaction requires verified manual recovery before lifecycle changes');
    }
    if (this.#globalRecoveryRequired || this.#cleanupGlobalRecoveryRequired
      || this.#recoveryRequired.has(instanceId) || this.#cleanupRecoveryRequired.has(instanceId)) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'A backup restore transaction requires verified manual recovery before lifecycle changes');
    }
    return { ok: true, instanceId };
    });
  }

  recoveryStatus() {
    const required = new Set([...this.#recoveryRequired, ...this.#cleanupRecoveryRequired]);
    const global = this.#globalRecoveryRequired || this.#cleanupGlobalRecoveryRequired;
    const instanceIds = [...required].filter(validateInstanceId).sort().slice(0, 100);
    return {
      manualRecoveryRequired: required.size + (global ? 1 : 0),
      global,
      instanceIds,
    };
  }

  async recordSchedulerFailure(input) {
    return this.#safePublic(async () => {
      const code = validateSchedulerFailure(input);
      const recorded = [];
      for (const item of await this.store.list()) {
        if (item?.projectId !== 'family-server' || item?.kind !== 'server' || !validateInstanceId(item.id)) continue;
        if (this.#globalRecoveryRequired || this.#cleanupGlobalRecoveryRequired
          || this.#recoveryRequired.has(item.id) || this.#cleanupRecoveryRequired.has(item.id)) continue;
        const state = await this.#withFilesystemSafety(async () => {
          await this.#ensureStorageRoots();
          return this.#readPolicyState(item.id, { storageReady: true });
        });
        if (!state.policy.enabled) continue;
        await this.withInstanceLock(item.id, () => this.#serialized(async () => {
          await this.assertSafeForLifecycle({ instanceId: item.id });
          await this.#writeAutomaticResult(item.id, 'failed', { code });
        }));
        recorded.push(item.id);
      }
      return { recorded: recorded.length };
    });
  }

  async runDueBackups() {
    if (this.#dueRun) return this.#dueRun;
    const run = this.#safePublic(() => this.#runDueBackups());
    this.#dueRun = run;
    try { return await run; }
    finally { if (this.#dueRun === run) this.#dueRun = null; }
  }

  async #runDueBackups() {
    const results = [];
    let instances;
    try { instances = await this.store.list(); }
    catch (error) { throw schedulerStageError(error, 'instance-list'); }
    for (const instance of instances) {
      if (instance?.projectId !== 'family-server' || instance?.kind !== 'server' || !validateInstanceId(instance.id)) continue;
      if (this.#globalRecoveryRequired || this.#cleanupGlobalRecoveryRequired
        || this.#recoveryRequired.has(instance.id) || this.#cleanupRecoveryRequired.has(instance.id)) {
        results.push({ instanceId: instance.id, action: 'manual-recovery-required', code: 'BACKUP_MANUAL_RECOVERY_REQUIRED' });
        continue;
      }
      // No policy file is the canonical disabled-policy state. Avoid opening
      // the native filesystem-safety broker for that zero-work case so an
      // idle scheduler tick cannot contend with a server lifecycle operation.
      try { await fs.lstat(this.#policyFile(instance.id)); }
      catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw schedulerStageError(error, 'policy-read');
      }
      // A persisted disabled policy is also a zero-work state. Read only its
      // bounded regular file before deciding whether the complete native
      // filesystem-safety boundary is needed. Enabled stopped policies are
      // re-read inside that boundary before any inventory work or mutation.
      let preflightState;
      try { preflightState = await this.#readPolicyState(instance.id, { storageReady: true }); }
      catch (error) { throw schedulerStageError(error, 'policy-read'); }
      if (!preflightState.policy.enabled) continue;
      // A running managed child holds the continuous launch-integrity lease.
      // Automatic backups are stopped-state operations, so the bounded read
      // above is sufficient to report deferral without contending for it.
      if (instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess != null) {
        results.push({
          instanceId: instance.id,
          action: 'deferred-running',
          code: 'BACKUP_SERVER_NOT_QUIESCENT',
        });
        continue;
      }
      let state;
      try {
        state = await this.#withFilesystemSafety(async () => {
          await this.#ensureStorageRoots();
          return this.#readPolicyState(instance.id, { storageReady: true });
        });
      } catch (error) { throw schedulerStageError(error, 'policy-read'); }
      if (!state.policy.enabled) continue;
      let backups;
      try {
        backups = await this.#withFilesystemSafety(async () => {
          await this.#ensureStorageRoots();
          return this.#listBackups(instance, { limit: null, storageReady: true });
        });
      } catch (error) { throw schedulerStageError(error, 'backup-list'); }
      const status = scheduleStatus(state, backups, instance, Date.parse(this.now()));
      if (!status.due) continue;
      try {
        const result = await this.withInstanceLock(instance.id, () => this.#serialized(async () => {
          await this.assertSafeForLifecycle({ instanceId: instance.id });
          await this.assertWorldMutationAllowedWithinInstanceLock(instance.id);
          const lockedInstance = await this.#instance(instance.id);
          await this.#ensureStorageRoots();
          const lockedState = await this.#readPolicyState(instance.id, { storageReady: true });
          const lockedBackups = await this.#listBackups(lockedInstance, { limit: null, storageReady: true });
          const lockedStatus = scheduleStatus(lockedState, lockedBackups, lockedInstance, Date.parse(this.now()));
          if (!lockedState.policy.enabled || !lockedStatus.due) return { action: 'not-due' };
          const backup = await this.#createWithinLock(instance.id, 'automatic');
          return { action: backup.retention?.state === 'failed' ? 'created-retention-failed' : 'created', backup };
        }));
        if (result.action !== 'not-due') {
          results.push({ instanceId: instance.id, action: result.action, backupId: result.backup.backupId });
        }
      } catch (error) {
        const deferred = error?.code === 'BACKUP_SERVER_NOT_QUIESCENT';
        const safe = sanitizePublicError(error);
        try {
          await this.withInstanceLock(instance.id, () => this.#serialized(async () => {
            await this.assertSafeForLifecycle({ instanceId: instance.id });
            await this.#writeAutomaticResult(instance.id, deferred ? 'deferred-running' : 'failed', safe);
          }));
        } catch (recordError) {
          if (recordError?.code !== 'BACKUP_MANUAL_RECOVERY_REQUIRED') {
            throw schedulerStageError(recordError, 'scheduled-apply');
          }
          results.push({
            instanceId: instance.id,
            action: 'manual-recovery-required',
            code: 'BACKUP_MANUAL_RECOVERY_REQUIRED',
          });
          continue;
        }
        results.push({ instanceId: instance.id, action: deferred ? 'deferred-running' : 'failed', code: safe.code });
      }
    }
    return results;
  }

  async reconcileInterruptedTransactions() {
    return this.#safePublic(() => this.#withFilesystemSafety(async () => {
      this.#assertIntegrationConfigured();
      if (!this.key) throw backupError('BACKUP_UNAVAILABLE', 503, 'Backup recovery authentication was not initialized');
      return this.#reconcileInterruptedTransactions();
    }));
  }

  async #reconcileInterruptedTransactions() {
    const results = [];
    let recoveryRootGuard = null;
    let recoveryRootStat = null;
    try {
      await this.#ensureStorageRoots();
      if (typeof this.directoryGuard?.batch === 'function') {
        recoveryRootStat = await fs.lstat(this.transactionRoot);
        [recoveryRootGuard] = await acquireVerifiedDirectoryGuardBatch(
          [{ path: this.transactionRoot, stat: recoveryRootStat }], this.directoryGuard, 'Restore recovery root',
        );
      } else {
        recoveryRootStat = await fs.lstat(this.transactionRoot);
        recoveryRootGuard = await this.directoryGuard(this.transactionRoot);
      }
    } catch {
      this.#recoveryRequired = new Set();
      this.#globalRecoveryRequired = true;
      return [{ action: 'manual-recovery-required', code: 'BACKUP_RECOVERY_INVALID' }];
    }
    try {
      recoveryRootGuard.assertHeld?.();
    const required = new Set();
    let globalRequired = false;
    let entries;
    try {
      await this.filesystemTreeVerifier(this.transactionRoot, {
        maxEntries: this.maxRestoreMarkers,
        maxDepth: 0,
        recursive: false,
      });
      entries = await safeDirectoryEntries(this.transactionRoot, {
        maxEntries: this.maxRestoreMarkers,
        limitError: () => backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery state exceeds its safe entry limit'),
      });
    } catch {
      this.#recoveryRequired = required;
      this.#globalRecoveryRequired = true;
      return [{ action: 'manual-recovery-required', code: 'BACKUP_RECOVERY_INVALID' }];
    }
    let aggregateBytes = 0;
    const markerRecords = [];
    const compactedMarkerNames = new Set();
    for (const entry of entries) {
      const transactionId = entry.name.slice(0, -5);
      if (!entry.isFile() || entry.name !== `${transactionId}.json` || !TRANSACTION_ID.test(transactionId)) {
        globalRequired = true;
        results.push({ action: 'manual-recovery-required', code: 'BACKUP_RECOVERY_INVALID' });
        continue;
      }
      const markerFile = path.join(this.transactionRoot, entry.name);
      try {
        const stat = await safeLstat(markerFile);
        if (!stat.isFile() || stat.size < 2 || stat.size > MAX_POLICY_BYTES) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore transaction marker has an invalid size');
        }
        aggregateBytes += stat.size;
        if (aggregateBytes > this.maxRestoreMarkerBytes) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery state exceeds its safe byte limit');
        }
        markerRecords.push({ path: markerFile, stat, transactionId });
      } catch (error) {
        globalRequired = true;
        results.push({ transactionId, action: 'manual-recovery-required', code: error?.code ?? 'BACKUP_RECOVERY_FAILED' });
      }
    }
    const markerReads = await readSmallJsonGuardedBatchSettled(
      markerRecords, MAX_POLICY_BYTES, 'Restore transaction marker', this.fileGuard, { requireCanonical: true },
    );
    for (let index = 0; index < markerRecords.length; index += 1) {
      const record = markerRecords[index];
      const { transactionId, path: markerFile } = record;
      let marker = null;
      try {
        await this.#assertKeyContinuity();
        if (markerReads[index].error) throw markerReads[index].error;
        marker = authenticateRestoreMarker(this.key, markerReads[index].value);
        validateTransactionMarker(marker, transactionId);
        const result = await this.#withAuthenticatedRestoreMarkerLease(record, marker, (markerLease) => {
          marker = markerLease.marker;
          return this.withInstanceLock(marker.instanceId, () => this.#serialized(
            () => this.#reconcileMarker(
              marker, markerFile, recoveryRootGuard, recoveryRootStat, markerLease,
            ),
          ));
        });
        if (result.compacted === true) compactedMarkerNames.add(path.basename(markerFile));
        const { compacted: _compacted, ...publicResult } = result;
        results.push({ instanceId: marker.instanceId, transactionId, ...publicResult });
      } catch (error) {
        const instanceId = validateInstanceId(marker?.instanceId) ? marker.instanceId : null;
        if (instanceId) required.add(instanceId);
        else globalRequired = true;
        results.push({ transactionId, action: 'manual-recovery-required', code: error?.code ?? 'BACKUP_RECOVERY_FAILED' });
      }
    }
    try {
      await this.filesystemTreeVerifier(this.transactionRoot, {
        maxEntries: this.maxRestoreMarkers,
        maxDepth: 0,
        recursive: false,
      });
      const observed = await safeDirectoryEntries(this.transactionRoot, {
        maxEntries: this.maxRestoreMarkers,
        limitError: () => backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery state exceeds its safe entry limit'),
      });
      const expectedEntries = entries.filter((entry) => !compactedMarkerNames.has(entry.name));
      if (observed.length !== expectedEntries.length
        || observed.some((entry, index) => entry.name !== expectedEntries[index].name || !entry.isFile())) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery state changed during reconciliation');
      }
      let observedBytes = 0;
      const observedRecords = [];
      for (const entry of observed) {
        const transactionId = entry.name.slice(0, -5);
        if (entry.name !== `${transactionId}.json` || !TRANSACTION_ID.test(transactionId)) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery state contains an invalid entry');
        }
        const markerFile = path.join(this.transactionRoot, entry.name);
        const stat = await safeLstat(markerFile);
        observedBytes += stat.size;
        if (!stat.isFile() || stat.size < 2 || stat.size > MAX_POLICY_BYTES
          || observedBytes > this.maxRestoreMarkerBytes) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery state exceeds its safe byte limit');
        }
        observedRecords.push({ path: markerFile, stat, transactionId });
      }
      const observedValues = await readSmallJsonGuardedBatch(
        observedRecords, MAX_POLICY_BYTES, 'Restore transaction marker', this.fileGuard, { requireCanonical: true },
      );
      for (let index = 0; index < observedRecords.length; index += 1) {
        await this.#assertKeyContinuity();
        const marker = authenticateRestoreMarker(this.key, observedValues[index]);
        validateTransactionMarker(marker, observedRecords[index].transactionId);
      }
    } catch (error) {
      if (!globalRequired) results.push({ action: 'manual-recovery-required', code: error?.code ?? 'BACKUP_RECOVERY_FAILED' });
      globalRequired = true;
    }
    this.#recoveryRequired = required;
    this.#globalRecoveryRequired = globalRequired;
    return results;
    } finally {
      await releaseGuards(recoveryRootGuard);
    }
  }

  #limits() {
    return { maxFiles: this.maxFiles, maxBytes: this.maxBytes, maxDepth: MAX_DEPTH };
  }

  async #worldStackBinding(instanceId) {
    const value = await this.currentWorldStackBindingWithinInstanceLock(instanceId);
    return validateWorldStackBinding(value, 'BACKUP_STACK_UNAVAILABLE');
  }

  async #validateRestoredWorld(instanceId, worldStackBinding, directory) {
    if (typeof this.validateRestoredWorldWithinInstanceLock !== 'function') {
      throw backupError('BACKUP_WORLD_VALIDATOR_UNAVAILABLE', 503, 'World restore validation is unavailable');
    }
    const expected = validateWorldStackBinding(worldStackBinding, 'BACKUP_MANIFEST_INVALID');
    const result = await this.validateRestoredWorldWithinInstanceLock(instanceId, expected, { directory });
    if (!sameWorldStackBinding(result, expected)) {
      throw backupError('BACKUP_RESTORE_VERIFY_FAILED', 409, 'The restored world stack did not match the approved snapshot');
    }
    return expected;
  }

  async #verifyRolledBackInstance(marker, directory) {
    const instance = await this.#instanceRecord(marker.instanceId, { requireDirectory: false });
    if (path.resolve(directory) !== path.resolve(instance.directory)
      || stackIdentity(instance) !== marker.stackDigest
      || !sameWorldStackBinding(await this.#worldStackBinding(instance.id), marker.worldStackBinding)) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'The rolled-back server no longer matches its approved managed stack');
    }
    await this.verifyInstall(instance);
    const policy = await this.#snapshotPolicy(directory);
    const tree = await scanTree(directory, policy, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
    if (tree.digest !== marker.originalTreeDigest) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'The rolled-back server no longer matches its original verified tree');
    }
    await this.#validateRestoredWorld(instance.id, marker.worldStackBinding, directory);
  }

  async #ensureTargetLastRestore(instanceId, targetLastRestore) {
    if (!validOriginalLastRestore(targetLastRestore) || targetLastRestore === null) {
      throw backupError('BACKUP_RECOVERY_INVALID', 409, 'The restore receipt in durable recovery state is invalid');
    }
    const before = await this.store.get(instanceId);
    if (!before) throw backupError('INSTANCE_NOT_FOUND', 404, 'Instance was not found');
    if (!sameLastRestoreReceipt(before.lastRestore ?? null, targetLastRestore)) {
      await this.store.update(instanceId, { lastRestore: structuredClone(targetLastRestore) });
    }
    const after = await this.store.get(instanceId);
    if (!after || !sameLastRestoreReceipt(after.lastRestore ?? null, targetLastRestore)) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'The verified restore receipt could not be reconciled durably');
    }
  }

  #serialized(operation) {
    const run = this.#queue.catch(() => undefined).then(() => this.#withFilesystemSafety(async () => {
      await this.#assertKeyContinuity();
      return operation();
    }));
    this.#queue = run;
    return run;
  }

  #withFilesystemSafety(operation) {
    if (typeof operation !== 'function') throw new TypeError('Filesystem safety operation must be a function');
    return this.runFilesystemSafetyOperation(operation);
  }

  async #assertKeyContinuity() {
    if (!Buffer.isBuffer(this.key) || this.key.length !== 32) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup authentication continuity is unavailable');
    }
    let observed;
    try { observed = await this.#loadKey({ createIfMissing: false }); }
    catch {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup authentication continuity could not be verified');
    }
    if (!Buffer.isBuffer(observed) || observed.length !== this.key.length
      || !crypto.timingSafeEqual(observed, this.key)) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup authentication continuity changed after initialization');
    }
  }

  async #acquireKeyContinuityLease() {
    if (!Buffer.isBuffer(this.key) || this.key.length !== 32) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup authentication continuity is unavailable');
    }
    const ancestorChain = await acquireAnchoredGuardChain(
      this.managedRoot,
      this.stateRoot,
      'Backup authentication continuity root',
      this.directoryGuard,
      this.filesystemTreeVerifier,
    );
    let guard = null;
    let stat = null;
    try {
      await assertGuardChainHeld(ancestorChain, this.filesystemTreeVerifier);
      stat = await safeLstat(this.keyFile);
      if (stat.size !== 32) throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup authentication key has an invalid size');
      if (typeof this.fileGuard?.batch === 'function') {
        [guard] = await acquireVerifiedFileGuardBatch(
          [{ path: this.keyFile, stat }], this.fileGuard, 'Backup authentication continuity key',
        );
      } else {
        guard = await this.fileGuard(this.keyFile);
      }
      await this.#assertKeyContinuityLease({ guard, stat });
      await assertGuardChainHeld(ancestorChain, this.filesystemTreeVerifier);
    } catch (error) {
      await releaseGuards(guard, ...ancestorChain.map((entry) => entry.guard).reverse()).catch(() => undefined);
      throw error;
    }
    try { await releaseGuards(...ancestorChain.map((entry) => entry.guard).reverse()); }
    catch (error) {
      await releaseGuards(guard).catch(() => undefined);
      throw error;
    }
    return { guard, stat };
  }

  async #assertKeyContinuityLease(lease) {
    if (!lease?.guard || !lease?.stat?.isFile?.() || lease.stat.size !== 32) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup authentication continuity lease is unavailable');
    }
    lease.guard.assertHeld?.();
    const namedBefore = await safeLstat(this.keyFile);
    if (!sameFileIdentity(lease.stat, namedBefore)) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup authentication key identity changed');
    }
    const handle = await fs.open(this.keyFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let bytes;
    let failure = null;
    try {
      const openedBefore = await handle.stat();
      bytes = await handle.readFile();
      const openedAfter = await handle.stat();
      const namedAfter = await safeLstat(this.keyFile);
      if (bytes.length !== 32 || !sameFileIdentity(lease.stat, openedBefore)
        || !sameFileIdentity(openedBefore, openedAfter) || !sameFileIdentity(openedAfter, namedAfter)) {
        throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup authentication key changed under its continuity lease');
      }
    } catch (error) { failure = error; }
    try { await handle.close(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
    lease.guard.assertHeld?.();
    if (!Buffer.isBuffer(bytes) || bytes.length !== this.key.length || !crypto.timingSafeEqual(bytes, this.key)) {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup authentication continuity changed after initialization');
    }
  }

  async #safePublic(operation) {
    try { return await operation(); }
    catch (error) { throw sanitizePublicError(error); }
  }

  async #instance(id) {
    return this.#instanceRecord(id, { requireDirectory: true });
  }

  async #instanceRecord(id, { requireDirectory }) {
    const instance = await this.store.get(id);
    if (!instance) throw backupError('INSTANCE_NOT_FOUND', 404, 'Instance was not found');
    if (instance.projectId !== 'family-server' || instance.kind !== 'server') throw backupError('BACKUP_INVALID_INSTANCE', 409, 'Only the isolated Family Server can be backed up');
    const expected = path.resolve(this.serverRoot, id);
    if (typeof instance.directory !== 'string' || path.resolve(instance.directory) !== expected) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'The Family Server directory is outside its managed boundary');
    }
    if (requireDirectory) await assertAnchoredDirectory(this.managedRoot, expected, 'Family Server root');
    return instance;
  }

  async #quiescentInstance(id) {
    const checked = await this.assertQuiescentWithinInstanceLock(id);
    const instance = await this.#instance(id);
    if (!checked || checked.id !== instance.id || checked.status !== 'stopped') {
      throw backupError('BACKUP_SERVER_NOT_QUIESCENT', 409, 'The Family Server did not remain in a verified stopped state');
    }
    return instance;
  }

  async #assertManagedRoot() {
    await assertRegularDirectory(this.managedRoot, path.dirname(this.managedRoot), 'Managed Family project root', { allowEqual: true });
  }

  async #ensureStorageRoots() {
    await this.#assertManagedRoot();
    const targets = [this.snapshotRoot, this.stateRoot, this.policyRoot, this.transactionRoot, this.cleanupRoot];
    if (typeof this.directoryGuard?.batch === 'function') {
      let allExist = true;
      for (const target of targets) {
        try {
          const stat = await fs.lstat(target);
          if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Operator backup storage contains an unsafe directory');
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
          allExist = false;
          break;
        }
      }
      if (allExist) {
        const chain = await acquireAnchoredGuardBranches(
          this.managedRoot, targets, 'Operator backup storage roots', this.directoryGuard, this.filesystemTreeVerifier,
        );
        await releaseGuards(...chain.map((entry) => entry.guard).reverse());
        return;
      }
    }
    await ensureAnchoredDirectory(this.managedRoot, this.snapshotRoot, 'Operator backup root', this.directoryGuard, this.filesystemTreeVerifier);
    await ensureAnchoredDirectory(this.managedRoot, this.stateRoot, 'Operator backup state root', this.directoryGuard, this.filesystemTreeVerifier);
    await ensureAnchoredDirectory(this.managedRoot, this.policyRoot, 'Backup policy root', this.directoryGuard, this.filesystemTreeVerifier);
    await ensureAnchoredDirectory(this.managedRoot, this.transactionRoot, 'Restore transaction root', this.directoryGuard, this.filesystemTreeVerifier);
    await ensureAnchoredDirectory(this.managedRoot, this.cleanupRoot, 'Cleanup transaction root', this.directoryGuard, this.filesystemTreeVerifier);
  }

  async #loadKey({ createIfMissing = true } = {}) {
    const ancestorChain = await acquireAnchoredGuardChain(
      this.managedRoot,
      this.stateRoot,
      'Backup authentication state root',
      this.directoryGuard,
      this.filesystemTreeVerifier,
    );
    let keyGuard = null;
    let createdStat = null;
    try {
      await assertGuardChainHeld(ancestorChain, this.filesystemTreeVerifier);
      if (!await exists(this.keyFile)) {
        if (!createIfMissing) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery evidence cannot be authenticated');
        }
        const bytes = crypto.randomBytes(32);
        if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
          throw backupError('BACKUP_UNAVAILABLE', 503, 'The backup authentication key generator returned invalid bytes');
        }
        const handle = await fs.open(this.keyFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
        let failure = null;
        try {
          await handle.writeFile(bytes);
          await handle.chmod(0o600);
          await handle.sync();
          const opened = await handle.stat();
          const named = await fs.lstat(this.keyFile);
          if (!sameFileIdentity(opened, named) || opened.size !== 32) {
            throw backupError('BACKUP_UNAVAILABLE', 503, 'The backup authentication key changed while it was created');
          }
          createdStat = opened;
        } catch (error) { failure = error; }
        try { await handle.close(); } catch (error) { failure ??= error; }
        if (failure) throw failure;
      }
      if (typeof this.fileGuard?.batch === 'function') {
        const expectedKeyStat = await safeLstat(this.keyFile);
        [keyGuard] = await acquireVerifiedFileGuardBatch(
          [{ path: this.keyFile, stat: expectedKeyStat }], this.fileGuard, 'Backup authentication key',
        );
      } else {
        keyGuard = await this.fileGuard(this.keyFile);
      }
      keyGuard.assertHeld?.();
      await assertGuardChainHeld(ancestorChain, this.filesystemTreeVerifier);
      const namedBefore = await fs.lstat(this.keyFile);
      if (createdStat && !sameFileIdentity(createdStat, namedBefore)) {
        throw backupError('BACKUP_UNAVAILABLE', 503, 'The backup authentication key changed before it was guarded');
      }
      const handle = await fs.open(this.keyFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      let bytes;
      let failure = null;
      try {
        const openedBefore = await handle.stat();
        bytes = await handle.readFile();
        const openedAfter = await handle.stat();
        const namedAfter = await fs.lstat(this.keyFile);
        if (bytes.length !== 32 || !sameFileIdentity(namedBefore, openedBefore)
          || !sameFileIdentity(openedBefore, openedAfter) || !sameFileIdentity(openedAfter, namedAfter)) {
          throw backupError('BACKUP_UNAVAILABLE', 503, 'The backup authentication key is not a stable private file');
        }
      } catch (error) { failure = error; }
      try { await handle.close(); } catch (error) { failure ??= error; }
      if (failure) throw failure;
      await assertGuardChainHeld(ancestorChain, this.filesystemTreeVerifier);
      return bytes;
    } finally {
      await releaseGuards(keyGuard, ...ancestorChain.map((entry) => entry.guard).reverse());
    }
  }

  async #writePrivateJson(
    file,
    value,
    {
      storageReady = false,
      maxParentEntries = MAX_FILES,
    } = {},
  ) {
    if (!storageReady) await this.#ensureStorageRoots();
    await writeJsonAtomic(
      file,
      value,
      this.managedRoot,
      this.directoryGuard,
      this.fileGuard,
      this.filesystemTreeVerifier,
      { maxParentEntries },
    );
  }

  async #writeSnapshotManifest(file, manifest) {
    if (Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') > this.#manifestByteLimit()) {
      throw backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Backup manifest exceeds its safe serialized size limit');
    }
    await writeJsonAtomic(
      file, manifest, this.managedRoot, this.directoryGuard, this.fileGuard, this.filesystemTreeVerifier,
    );
  }

  #manifestByteLimit() {
    return Math.min(this.maxManifestBytes, 64 * 1024 + this.maxFiles * 4_608);
  }

  async #writeMarker(file, marker) {
    if (!this.key) throw backupError('BACKUP_UNAVAILABLE', 503, 'Backup recovery authentication was not initialized');
    const previouslyFenced = this.#recoveryRequired.has(marker.instanceId);
    this.#recoveryRequired.add(marker.instanceId);
    try {
      await this.#assertKeyContinuity();
      await this.#writePrivateJson(file, signRestoreMarker(this.key, marker), {
        maxParentEntries: this.maxRestoreMarkers,
      });
      await this.#assertKeyContinuity();
      if (!previouslyFenced) this.#recoveryRequired.delete(marker.instanceId);
    } catch (error) {
      this.#recoveryRequired.add(marker.instanceId);
      throw error;
    }
  }

  async #withAuthenticatedRestoreMarkerLease(record, expectedMarker, operation) {
    if (!record || typeof operation !== 'function') throw new TypeError('Restore marker lease request is invalid');
    let guard = null;
    let lease = null;
    try {
      if (typeof this.fileGuard?.batch === 'function') {
        [guard] = await acquireVerifiedFileGuardBatch(
          [{ path: record.path, stat: record.stat }], this.fileGuard, 'Restore reconciliation marker',
        );
      } else {
        guard = await this.fileGuard(record.path);
      }
      const value = await readSmallJsonGuarded(
        record.path,
        MAX_POLICY_BYTES,
        'Restore reconciliation marker',
        this.fileGuard,
        { guard, requireCanonical: true },
      );
      const marker = authenticateRestoreMarker(this.key, value);
      validateTransactionMarker(marker, record.transactionId);
      if (canonicalJson(marker) !== canonicalJson(expectedMarker)) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore transaction marker changed before reconciliation');
      }
      guard.assertHeld?.();
      if (!sameFileIdentity(record.stat, await safeLstat(record.path))) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore transaction marker identity changed before reconciliation');
      }
      lease = { guard, stat: record.stat, path: record.path, marker };
      const result = await operation(lease);
      guard = lease.guard;
      return result;
    } finally {
      await releaseGuards(lease ? lease.guard : guard);
    }
  }

  #cleanupBinding(instanceId, target, parent) {
    if (!validateInstanceId(instanceId)) throw new TypeError('Invalid cleanup instance id');
    const resolvedParent = path.resolve(parent);
    const resolvedTarget = path.resolve(target);
    if (path.dirname(resolvedTarget) !== resolvedParent || !safeName(path.basename(resolvedTarget))) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Backup cleanup escaped its exact parent');
    }
    let namespace;
    if (resolvedParent === path.resolve(this.#snapshotInstanceRoot(instanceId))) namespace = 'snapshot';
    else if (resolvedParent === path.resolve(this.serverRoot)) namespace = 'server';
    else throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Backup cleanup has an unknown managed namespace');
    const targetName = path.basename(resolvedTarget);
    if (!validCleanupTargetName(namespace, instanceId, targetName)) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Backup cleanup target is not transaction-bound');
    }
    const cleanupId = cleanupIdentity(namespace, instanceId, targetName);
    return {
      namespace, instanceId, targetName, cleanupId,
      tombstoneName: `.cleanup-${cleanupId}`,
      parent: resolvedParent,
      target: resolvedTarget,
      markerFile: path.join(this.cleanupRoot, `${cleanupId}.json`),
    };
  }

  async #removeTreeRecoverably(
    target,
    parent,
    label,
    instanceId,
    { storageReady = false, beforeTombstone = null, keyLease = null } = {},
  ) {
    if (beforeTombstone !== null && typeof beforeTombstone !== 'function') {
      throw new TypeError('Authenticated cleanup revalidation must be a function');
    }
    if (!storageReady) await this.#ensureStorageRoots();
    if (keyLease) await this.#assertKeyContinuityLease(keyLease);
    else await this.#assertKeyContinuity();
    const binding = this.#cleanupBinding(instanceId, target, parent);
    const tombstone = path.join(binding.parent, binding.tombstoneName);
    if (await exists(binding.markerFile) || await exists(tombstone)) {
      this.#cleanupRecoveryRequired.add(instanceId);
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'A prior authenticated backup cleanup requires reconciliation');
    }
    const marker = signCleanupMarker(this.key, {
      schemaVersion: 1,
      cleanupId: binding.cleanupId,
      instanceId,
      namespace: binding.namespace,
      targetName: binding.targetName,
      tombstoneName: binding.tombstoneName,
      createdAt: this.now(),
    });
    const previouslyFenced = this.#cleanupRecoveryRequired.has(instanceId);
    this.#cleanupRecoveryRequired.add(instanceId);
    try {
      await this.#writePrivateJson(binding.markerFile, marker, { storageReady: true });
      if (keyLease) await this.#assertKeyContinuityLease(keyLease);
      else await this.#assertKeyContinuity();
      await removeManagedTree(
        binding.target, binding.parent, label, this.filesystemTreeVerifier, this.directoryGuard,
        binding.tombstoneName, this.fileGuard, this.managedRoot, beforeTombstone,
      );
      await deleteGuardedFile(binding.markerFile, this.fileGuard);
      if (keyLease) await this.#assertKeyContinuityLease(keyLease);
      else await this.#assertKeyContinuity();
      if (!previouslyFenced) this.#cleanupRecoveryRequired.delete(instanceId);
    } catch (error) {
      this.#cleanupRecoveryRequired.add(instanceId);
      throw error;
    }
  }

  async #persistCleanupFence(target, parent, instanceId) {
    await this.#ensureStorageRoots();
    await this.#assertKeyContinuity();
    const binding = this.#cleanupBinding(instanceId, target, parent);
    this.#cleanupRecoveryRequired.add(instanceId);
    if (!await exists(binding.markerFile)) {
      const marker = signCleanupMarker(this.key, {
        schemaVersion: 1,
        cleanupId: binding.cleanupId,
        instanceId,
        namespace: binding.namespace,
        targetName: binding.targetName,
        tombstoneName: binding.tombstoneName,
        createdAt: this.now(),
      });
      await this.#writePrivateJson(binding.markerFile, marker, { storageReady: true });
    } else {
      const observed = authenticateCleanupMarker(this.key, await readSmallJsonGuarded(
        binding.markerFile,
        MAX_POLICY_BYTES,
        'Backup cleanup fence marker',
        this.fileGuard,
        { requireCanonical: true },
      ));
      validateCleanupMarker(observed, binding.cleanupId);
      if (observed.instanceId !== instanceId || observed.namespace !== binding.namespace
        || observed.targetName !== binding.targetName || observed.tombstoneName !== binding.tombstoneName) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup fence marker binding is invalid');
      }
    }
    await this.#assertKeyContinuity();
  }

  async #reconcileInterruptedCleanups() {
    const results = [];
    let rootGuard = null;
    try {
      await this.#assertKeyContinuity();
      const rootStat = await fs.lstat(this.cleanupRoot);
      if (typeof this.directoryGuard?.batch === 'function') {
        [rootGuard] = await acquireVerifiedDirectoryGuardBatch(
          [{ path: this.cleanupRoot, stat: rootStat }], this.directoryGuard, 'Backup cleanup recovery root',
        );
      } else {
        rootGuard = await this.directoryGuard(this.cleanupRoot);
      }
      rootGuard.assertHeld?.();
      const entries = await safeDirectoryEntries(this.cleanupRoot, {
        maxEntries: this.maxRestoreMarkers,
        limitError: () => backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup recovery exceeds its safe entry limit'),
      });
      const records = [];
      let aggregateBytes = 0;
      for (const entry of entries) {
        const cleanupId = entry.name.slice(0, -5);
        if (!entry.isFile() || entry.name !== `${cleanupId}.json` || !CLEANUP_ID.test(cleanupId)) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup recovery contains an invalid entry');
        }
        const markerFile = path.join(this.cleanupRoot, entry.name);
        const stat = await safeLstat(markerFile);
        aggregateBytes += stat.size;
        if (!stat.isFile() || stat.size < 2 || stat.size > MAX_POLICY_BYTES
          || aggregateBytes > this.maxRestoreMarkerBytes) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup recovery exceeds its safe byte limit');
        }
        records.push({ path: markerFile, stat, cleanupId });
      }
      const values = await readSmallJsonGuardedBatch(
        records, MAX_POLICY_BYTES, 'Backup cleanup marker', this.fileGuard, { requireCanonical: true },
      );
      const bindings = [];
      for (let index = 0; index < records.length; index += 1) {
        const marker = authenticateCleanupMarker(this.key, values[index]);
        validateCleanupMarker(marker, records[index].cleanupId);
        const parent = marker.namespace === 'snapshot'
          ? this.#snapshotInstanceRoot(marker.instanceId) : this.serverRoot;
        const binding = this.#cleanupBinding(marker.instanceId, path.join(parent, marker.targetName), parent);
        if (binding.cleanupId !== marker.cleanupId || binding.tombstoneName !== marker.tombstoneName) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup marker binding is invalid');
        }
        bindings.push(binding);
      }
      rootGuard.assertHeld?.();
      if (!sameDirectoryIdentity(rootStat, await fs.lstat(this.cleanupRoot))) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup recovery root changed during authentication');
      }
      const observed = await safeDirectoryEntries(this.cleanupRoot, {
        maxEntries: this.maxRestoreMarkers,
        limitError: () => backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup recovery exceeds its safe entry limit'),
      });
      if (observed.length !== records.length) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup recovery namespace changed during authentication');
      }
      for (let index = 0; index < observed.length; index += 1) {
        if (observed[index].name !== path.basename(records[index].path) || !observed[index].isFile()
          || !sameFileIdentity(records[index].stat, await safeLstat(records[index].path))) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup recovery namespace changed during authentication');
        }
      }
      await this.#assertNoUnknownCleanupTombstones(bindings);
      for (const binding of bindings) {
        this.#cleanupRecoveryRequired.add(binding.instanceId);
        results.push({
          instanceId: binding.instanceId,
          cleanupId: binding.cleanupId,
          action: 'manual-recovery-required',
          code: 'BACKUP_MANUAL_RECOVERY_REQUIRED',
        });
      }
    } catch (error) {
      this.#cleanupGlobalRecoveryRequired = true;
      results.push({ action: 'manual-recovery-required', code: error?.code ?? 'BACKUP_RECOVERY_INVALID' });
    } finally {
      await releaseGuards(rootGuard).catch(() => undefined);
    }
    try { await this.#assertKeyContinuity(); }
    catch {
      this.#cleanupGlobalRecoveryRequired = true;
      if (!results.some((item) => item.action === 'manual-recovery-required')) {
        results.push({ action: 'manual-recovery-required', code: 'BACKUP_RECOVERY_INVALID' });
      }
    }
    return results;
  }

  async #assertNoUnknownCleanupTombstones(bindings) {
    const expected = new Set(bindings.map((item) => path.resolve(item.parent, item.tombstoneName).toLowerCase()));
    const inspect = async (parent, maxEntries) => {
      if (!await exists(parent)) return;
      for (const entry of await safeDirectoryEntries(parent, {
        maxEntries,
        limitError: () => backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup namespace exceeds its safe entry limit'),
      })) {
        if (!entry.name.startsWith('.cleanup-cln-')) continue;
        const exact = path.resolve(parent, entry.name).toLowerCase();
        if (!entry.isDirectory() || !expected.has(exact)) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup namespace contains an unauthenticated tombstone');
        }
      }
    };
    await inspect(this.serverRoot, MAX_FILES);
    if (!await exists(this.snapshotRoot)) return;
    for (const entry of await safeDirectoryEntries(this.snapshotRoot, { maxEntries: MAX_FILES })) {
      if (!entry.isDirectory() || !validateInstanceId(entry.name)) continue;
      await inspect(path.join(this.snapshotRoot, entry.name), this.maxSnapshots + this.maxRestoreMarkers);
    }
  }

  async #snapshotPolicy(instanceRoot) {
    const managedFiles = new Set(FIXED_MANAGED_FILES);
    const levelName = await levelNameFromProperties(instanceRoot);
    const privateManifest = path.join(instanceRoot, 'instance.json');
    try {
      const value = await readSmallJson(privateManifest, 1024 * 1024, 'Private instance manifest');
      if (Array.isArray(value?.artifacts)) {
        for (const artifact of value.artifacts) {
          if (typeof artifact?.fileName !== 'string') continue;
          const relative = normalizeRelative(artifact.fileName);
          managedFiles.add(relative);
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return {
      policyVersion: POLICY_VERSION,
      managedFiles,
      include(relative, entry) {
        const normalized = normalizeRelative(relative);
        const top = normalized.split('/')[0];
        if (PRESERVE_TOP_LEVEL.has(top) || DISCARD_TOP_LEVEL.has(top)) return false;
        if (managedFiles.has(normalized)) return false;
        if (normalized === `${levelName}/session.lock`) return false;
        return true;
      },
    };
  }

  async #createWithinLock(instanceId, kind) {
    if (!KINDS.has(kind)) throw new TypeError('Invalid internal backup kind');
    await this.assertSafeForLifecycle({ instanceId });
    if (kind !== 'rescue') await this.assertWorldMutationAllowedWithinInstanceLock(instanceId);
    await this.#ensureStorageRoots();
    const instance = await this.#quiescentInstance(instanceId);
    await this.verifyInstall(instance);
    // Fail before scanning or copying a potentially large world when a legacy
    // instance lacks the authenticated stack metadata required by every
    // restorable snapshot manifest.
    const stackDigest = stackIdentity(instance);
    const worldStackBindingBefore = await this.#worldStackBinding(instance.id);
    const policy = await this.#snapshotPolicy(instance.directory);
    const sourceBefore = await scanTree(instance.directory, policy, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
    const backupId = `bkp-${this.randomBytes(16).toString('hex')}`;
    if (!BACKUP_ID.test(backupId)) throw new Error('Backup ID generation failed');
    const instanceRoot = this.#snapshotInstanceRoot(instance.id);
    const staging = path.join(instanceRoot, `.staging-${backupId}`);
    const destination = path.join(instanceRoot, backupId);
    await ensureAnchoredDirectory(this.managedRoot, instanceRoot, 'Instance backup root', this.directoryGuard, this.filesystemTreeVerifier);
    const existingSnapshotNamespace = await stableExactDirectoryNamespace(instanceRoot, this.maxSnapshots);
    if (existingSnapshotNamespace.some((entry) => entry.name.startsWith('.cleanup-cln-'))) {
      this.#cleanupGlobalRecoveryRequired = true;
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup inventory contains an unauthenticated cleanup tombstone');
    }
    if (existingSnapshotNamespace.some((entry) => entry.kind !== 'directory' || !BACKUP_ID.test(entry.name))) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Backup inventory contains an unexpected namespace entry');
    }
    if (existingSnapshotNamespace.length >= this.maxSnapshots) {
      throw backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Backup inventory reached its safe snapshot limit');
    }
    const instanceRootChain = await acquireAnchoredGuardChain(
      this.managedRoot, instanceRoot, 'Instance backup root', this.directoryGuard, this.filesystemTreeVerifier,
    );
    const instanceRootGuard = guardChainEntry(instanceRootChain, instanceRoot).guard;
    let stagingGuard = null;
    let stagingIdentity = null;
    let stagingExactIdentity = null;
    let stagingNamespaceReceipt = null;
    let stagingSetupError = null;
    try {
      instanceRootGuard.assertHeld?.();
      if (!sameExactNamespace(
        existingSnapshotNamespace, await stableExactDirectoryNamespace(instanceRoot, this.maxSnapshots),
      )) throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Backup inventory changed before staging');
      if (await exists(staging) || await exists(destination)) throw backupError('BACKUP_ID_COLLISION', 409, 'Generated backup storage is already occupied');
      await fs.mkdir(staging, { mode: 0o700 });
      const created = await fs.lstat(staging);
      const createdExact = await fs.lstat(staging, { bigint: true });
      stagingIdentity = created;
      stagingExactIdentity = createdExact;
      if (typeof this.directoryGuard?.batch === 'function') {
        [stagingGuard] = await acquireVerifiedDirectoryGuardBatch(
          [{ path: staging, stat: created }], this.directoryGuard, 'Backup staging directory',
        );
      } else {
        stagingGuard = await this.directoryGuard(staging);
      }
      stagingGuard.assertHeld?.();
      const guarded = await fs.lstat(staging);
      const guardedExact = await fs.lstat(staging, { bigint: true });
      if (!sameDirectoryIdentity(created, guarded)
        || !sameExactDirectoryIdentity(createdExact, guardedExact)) {
        throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Backup staging changed while it was created');
      }
      stagingNamespaceReceipt = expectedExactNamespaceAfterDirectoryCreate(
        existingSnapshotNamespace, path.basename(staging), createdExact,
      );
      if (!sameExactNamespace(
        stagingNamespaceReceipt, await stableExactDirectoryNamespace(instanceRoot, this.maxSnapshots),
      )) throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Backup inventory changed while staging was created');
    } catch (error) {
      stagingSetupError = error;
    }
    if (stagingSetupError) {
      const heldStagingGuard = stagingGuard;
      stagingGuard = null;
      await releaseGuards(heldStagingGuard, ...instanceRootChain.map((entry) => entry.guard).reverse());
      let cleanupFailure = null;
      if (await exists(staging).catch(() => false)) {
        try {
          const observedStaging = await fs.lstat(staging);
          const observedStagingExact = await fs.lstat(staging, { bigint: true });
          if (!stagingIdentity || !stagingExactIdentity
            || !sameDirectoryIdentity(stagingIdentity, observedStaging)
            || !sameExactDirectoryIdentity(stagingExactIdentity, observedStagingExact)) {
            await this.#persistCleanupFence(staging, instanceRoot, instance.id);
            throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Backup staging cleanup ownership could not be proven');
          }
          await this.#removeTreeRecoverably(staging, instanceRoot, 'Backup staging directory', instance.id);
        } catch (error) { cleanupFailure = error; }
      }
      if (cleanupFailure) {
        this.#cleanupRecoveryRequired.add(instance.id);
        throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Backup staging cleanup requires authenticated manual recovery');
      }
      throw stagingSetupError;
    }
    const verifiedStagingGuard = stagingGuard;
    stagingGuard = null;
    await releaseGuards(verifiedStagingGuard, ...instanceRootChain.map((entry) => entry.guard).reverse());
    const payload = path.join(staging, 'payload');
    let destinationPublished = false;
    try {
      await copyFilteredTree(instance.directory, payload, policy, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard, this.managedRoot);
      const copied = await scanTree(payload, includeEverythingPolicy(), this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
      const sourceAfter = await scanTree(instance.directory, policy, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
      const worldStackBindingAfter = await this.#worldStackBinding(instance.id);
      if (sourceBefore.digest !== sourceAfter.digest || sourceBefore.digest !== copied.digest) {
        throw backupError('BACKUP_SOURCE_CHANGED', 409, 'The stopped Family Server changed while its snapshot was being created');
      }
      if (!sameWorldStackBinding(worldStackBindingBefore, worldStackBindingAfter)) {
        throw backupError('BACKUP_SOURCE_CHANGED', 409, 'The managed world or mod stack changed while its snapshot was being created');
      }
      await this.#quiescentInstance(instance.id);
      const createdAt = this.now();
      const manifest = {
        schemaVersion: 1,
        policyVersion: POLICY_VERSION,
        backupId,
        instanceId: instance.id,
        kind,
        createdAt,
        minecraftVersion: instance.minecraftVersion,
        levelName: await levelNameFromProperties(instance.directory),
        stackDigest,
        worldStackBinding: worldStackBindingBefore,
        tree: copied,
        integrity: 'verified',
        verifiedAt: createdAt,
      };
      await this.#writeSnapshotManifest(path.join(staging, 'manifest.json'), manifest);
      await moveManagedDirectory(
        staging,
        destination,
        instanceRoot,
        this.directoryGuard,
        this.managedRoot,
        this.filesystemTreeVerifier,
        {
          maxParentEntries: this.maxSnapshots,
          beforeTerminal: (terminalNamespace) => {
            if (!stagingNamespaceReceipt || !sameExactNamespace(stagingNamespaceReceipt, terminalNamespace)) {
              throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Backup inventory changed before publication');
            }
          },
        },
      );
      destinationPublished = true;
      const published = await this.#verifySnapshot(instance, backupId, { recordResult: false });
      if (published.identityDigest !== manifestIdentity(manifest)
        || !sameTree(published.manifest.tree, manifest.tree)
        || published.manifest.stackDigest !== manifest.stackDigest
        || !sameWorldStackBinding(published.manifest.worldStackBinding, manifest.worldStackBinding)) {
        throw backupError('BACKUP_INTEGRITY_FAILED', 409, 'The published backup did not match its verified staged identity');
      }
      let retention = { state: 'applied' };
      try {
        await this.#applyRetention(instance);
        await this.#writeRetentionResult(instance.id, null).catch(() => undefined);
      } catch (error) {
        const safe = sanitizePublicError(error);
        retention = { state: 'failed', code: safe.code === 'BACKUP_STORAGE_FULL' ? safe.code : 'BACKUP_RETENTION_FAILED' };
        await this.#writeRetentionResult(instance.id, { code: retention.code }).catch(() => undefined);
        if (kind === 'automatic') await this.#writeAutomaticResult(instance.id, 'failed', { code: retention.code }).catch(() => undefined);
      }
      if (kind === 'automatic' && retention.state === 'applied') await this.#writeAutomaticResult(instance.id, backupId, null);
      return { ...publicBackup(manifest, { restorable: true, purgeable: kind !== 'rescue' }), retention };
    } catch (error) {
      let cleanupFailure = null;
      const heldStagingGuard = stagingGuard;
      stagingGuard = null;
      await releaseGuards(heldStagingGuard);
      const [stagingExists, destinationExists] = await Promise.all([
        exists(staging).catch(() => false), exists(destination).catch(() => false),
      ]);
      if (destinationExists) {
        try {
          const destinationIdentity = await fs.lstat(destination);
          const destinationExactIdentity = await fs.lstat(destination, { bigint: true });
          if (!stagingExists && stagingIdentity && stagingExactIdentity
            && sameDirectoryIdentity(stagingIdentity, destinationIdentity)
            && sameExactDirectoryIdentity(stagingExactIdentity, destinationExactIdentity)) {
            await this.#removeTreeRecoverably(destination, instanceRoot, 'Failed published backup', instance.id);
          } else if (destinationPublished || !stagingExists) {
            await this.#persistCleanupFence(destination, instanceRoot, instance.id);
            throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Failed backup publication ownership could not be proven');
          }
        } catch (failure) { cleanupFailure = failure; }
      }
      if (stagingExists) {
        try {
          const observedStaging = await fs.lstat(staging);
          const observedStagingExact = await fs.lstat(staging, { bigint: true });
          if (!stagingIdentity || !stagingExactIdentity
            || !sameDirectoryIdentity(stagingIdentity, observedStaging)
            || !sameExactDirectoryIdentity(stagingExactIdentity, observedStagingExact)) {
            await this.#persistCleanupFence(staging, instanceRoot, instance.id);
            throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Backup staging cleanup ownership could not be proven');
          }
          await this.#removeTreeRecoverably(staging, instanceRoot, 'Backup staging directory', instance.id);
        } catch (failure) { cleanupFailure ??= failure; }
      }
      if (cleanupFailure) {
        this.#cleanupRecoveryRequired.add(instance.id);
        const fenced = backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Published backup cleanup requires authenticated manual recovery');
        Object.defineProperty(fenced, 'cause', { value: cleanupFailure, enumerable: false });
        throw fenced;
      }
      throw error;
    }
  }

  async #listBackups(instance, { limit = 100, storageReady = false } = {}) {
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 100)) throw new TypeError('Invalid backup list limit');
    if (!storageReady) await this.#ensureStorageRoots();
    const root = this.#snapshotInstanceRoot(instance.id);
    if (!await exists(root)) return [];
    await assertRegularDirectory(root, this.snapshotRoot, 'Instance backup root');
    const raw = [];
    for (const entry of await safeDirectoryEntries(root, {
      maxEntries: this.maxSnapshots,
      limitError: () => backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Backup inventory exceeds its safe snapshot limit'),
    })) {
      if (!entry.isDirectory() || !BACKUP_ID.test(entry.name)) continue;
      try {
        const snapshot = await this.#readSnapshot(instance, entry.name);
        raw.push({ manifest: inventoryManifest(snapshot.manifest) });
      } catch {
        const stat = await fs.lstat(path.join(root, entry.name));
        raw.push({ manifest: {
          backupId: entry.name,
          kind: 'manual',
          createdAt: stat.mtime.toISOString(),
          minecraftVersion: 'unknown',
          tree: { files: 0, bytes: 0 },
          integrity: 'failed',
          verifiedAt: null,
        }, invalid: true });
      }
    }
    raw.sort((left, right) => Date.parse(right.manifest.createdAt) - Date.parse(left.manifest.createdAt));
    const lastVerifiedId = raw.find((item) => !item.invalid && item.manifest.integrity === 'verified')?.manifest.backupId ?? null;
    const referenced = await this.#referencedBackupIds(instance);
    const protectedRescues = new Set(raw
      .filter((item) => !item.invalid && item.manifest.kind === 'rescue' && item.manifest.integrity === 'verified')
      .slice(0, RESCUE_PROTECTED_COUNT)
      .map((item) => item.manifest.backupId));
    const selected = limit === null ? raw : raw.slice(0, limit);
    return selected.map((item) => publicBackup(item.manifest, {
      restorable: !item.invalid && item.manifest.integrity === 'verified',
      purgeable: !item.invalid && item.manifest.integrity === 'verified'
        && item.manifest.backupId !== lastVerifiedId
        && !referenced.has(item.manifest.backupId)
        && (item.manifest.kind !== 'rescue' || !protectedRescues.has(item.manifest.backupId)),
    }));
  }

  async #readSnapshot(instance, backupId) {
    await this.#ensureStorageRoots();
    await assertAnchoredDirectory(this.snapshotRoot, this.#snapshotInstanceRoot(instance.id), 'Instance backup root');
    const directory = this.#snapshotDirectory(instance.id, backupId);
    await assertRegularDirectory(directory, this.#snapshotInstanceRoot(instance.id), 'Backup directory');
    const manifest = await readSmallJsonGuarded(
      path.join(directory, 'manifest.json'), this.#manifestByteLimit(), 'Backup manifest', this.fileGuard,
    );
    validateManifest(manifest, instance.id, backupId, this.#limits());
    await assertRegularDirectory(path.join(directory, 'payload'), directory, 'Backup payload');
    return { directory, manifest, identityDigest: manifestIdentity(manifest) };
  }

  async #verifySnapshot(instance, backupId, { recordResult }) {
    const snapshot = await this.#readSnapshot(instance, backupId);
    try {
      const actual = await scanTree(path.join(snapshot.directory, 'payload'), includeEverythingPolicy(), this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
      if (!sameTree(actual, snapshot.manifest.tree)) throw backupError('BACKUP_INTEGRITY_FAILED', 409, 'Backup integrity verification failed');
      const observedManifest = await readSmallJsonGuarded(
        path.join(snapshot.directory, 'manifest.json'), this.#manifestByteLimit(), 'Backup manifest', this.fileGuard,
      );
      validateManifest(observedManifest, instance.id, backupId, this.#limits());
      if (canonicalJson(observedManifest) !== canonicalJson(snapshot.manifest)) {
        throw backupError('BACKUP_INTEGRITY_FAILED', 409, 'Backup manifest changed while the snapshot was verified');
      }
      if (recordResult) {
        snapshot.manifest.integrity = 'verified';
        snapshot.manifest.verifiedAt = this.now();
        delete snapshot.manifest.lastVerificationFailedAt;
        await this.#writeSnapshotManifest(path.join(snapshot.directory, 'manifest.json'), snapshot.manifest);
      }
      snapshot.identityDigest = manifestIdentity(snapshot.manifest);
      return snapshot;
    } catch (error) {
      if (recordResult && snapshot.manifest) {
        snapshot.manifest.integrity = 'failed';
        snapshot.manifest.verifiedAt = null;
        snapshot.manifest.lastVerificationFailedAt = this.now();
        await this.#writeSnapshotManifest(
          path.join(snapshot.directory, 'manifest.json'), snapshot.manifest,
        ).catch(() => undefined);
      }
      throw error;
    }
  }

  async #restoreWithinLock(request) {
    const plan = this.#plans.get(request.planId);
    this.#plans.delete(request.planId);
    if (!plan || plan.instanceId !== request.instanceId || plan.backupId !== request.backupId) {
      throw backupError('BACKUP_APPROVAL_STALE', 409, 'The restore approval is missing or no longer matches this backup');
    }
    if (Date.parse(plan.expiresAt) <= Date.parse(this.now())) throw backupError('BACKUP_APPROVAL_STALE', 409, 'The restore approval expired');
    const instance = await this.#quiescentInstance(request.instanceId);
    await this.verifyInstall(instance);
    const snapshot = await this.#verifySnapshot(instance, request.backupId, { recordResult: true });
    const policy = await this.#snapshotPolicy(instance.directory);
    const currentTree = await scanTree(instance.directory, policy, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
    const worldStackBinding = await this.#worldStackBinding(instance.id);
    if (
      snapshot.identityDigest !== plan.backupDigest
      || currentTree.digest !== plan.currentTreeDigest
      || stackIdentity(instance) !== plan.stackDigest
      || snapshot.manifest.stackDigest !== plan.stackDigest
      || !sameWorldStackBinding(snapshot.manifest.worldStackBinding, plan.worldStackBinding)
      || !sameWorldStackBinding(worldStackBinding, plan.worldStackBinding)
    ) throw backupError('BACKUP_APPROVAL_STALE', 409, 'The backup or current server changed after the restore plan was created');
    if (snapshot.manifest.minecraftVersion !== instance.minecraftVersion) {
      throw backupError('BACKUP_VERSION_INCOMPATIBLE', 409, 'This backup cannot be restored into a different Minecraft version');
    }

    const rescue = await this.#createWithinLock(instance.id, 'rescue');
    if (rescue.integrity !== 'verified') throw backupError('BACKUP_RESCUE_FAILED', 409, 'The mandatory rescue snapshot was not verified');
    if (!sameWorldStackBinding(await this.#worldStackBinding(instance.id), plan.worldStackBinding)) {
      throw backupError('BACKUP_APPROVAL_STALE', 409, 'The managed world or mod stack changed while the rescue snapshot was created');
    }

    const transactionId = `rtx-${this.randomBytes(16).toString('hex')}`;
    if (!TRANSACTION_ID.test(transactionId)) throw new Error('Restore transaction generation failed');
    const paths = this.#restorePaths(instance, transactionId);
    const createdAt = this.now();
    const targetLastRestore = {
      backupId: request.backupId,
      rescueBackupId: rescue.backupId,
      restoredAt: createdAt,
      state: 'verified',
    };
    const marker = {
      schemaVersion: 1,
      transactionId,
      instanceId: instance.id,
      backupId: request.backupId,
      rescueBackupId: rescue.backupId,
      phase: 'rescue-ready',
      createdAt,
      updatedAt: createdAt,
      expectedTree: treeSummary(snapshot.manifest.tree),
      stackDigest: plan.stackDigest,
      worldStackBinding: plan.worldStackBinding,
      originalTreeDigest: plan.currentTreeDigest,
      originalLastRestore: instance.lastRestore ?? null,
      targetLastRestore,
    };
    await this.#writeMarker(paths.marker, marker);
    try {
      await copyWholeTree(instance.directory, paths.candidate, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard, this.managedRoot);
      await clearMutableTree(paths.candidate, policy, this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard, this.managedRoot);
      await copyWholeTree(path.join(snapshot.directory, 'payload'), paths.overlay, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard, this.managedRoot);
      await mergeTree(paths.overlay, paths.candidate, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard, this.managedRoot);
      await this.#removeTreeRecoverably(paths.overlay, this.serverRoot, 'Restore overlay', instance.id);
      const candidateInstance = { ...instance, directory: paths.candidate };
      await this.verifyInstall(candidateInstance);
      const candidateTree = await scanTree(paths.candidate, policy, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
      if (!sameTree(candidateTree, snapshot.manifest.tree)) throw backupError('BACKUP_RESTORE_VERIFY_FAILED', 409, 'The staged restore did not match the selected backup');
      await this.#validateRestoredWorld(instance.id, marker.worldStackBinding, paths.candidate);
      await this.#phase(marker, paths.marker, 'candidate-ready');
      const liveTree = await scanTree(instance.directory, policy, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
      if (liveTree.digest !== plan.currentTreeDigest) throw backupError('BACKUP_APPROVAL_STALE', 409, 'The stopped server changed while restore was staged');
      await this.#quiescentInstance(instance.id);

      await moveManagedDirectory(instance.directory, paths.original, this.serverRoot, this.directoryGuard, this.managedRoot, this.filesystemTreeVerifier);
      await this.#phase(marker, paths.marker, 'original-backed-up');
      await moveManagedDirectory(paths.candidate, instance.directory, this.serverRoot, this.directoryGuard, this.managedRoot, this.filesystemTreeVerifier);
      await this.#phase(marker, paths.marker, 'candidate-published');
      const activeTree = await scanTree(instance.directory, policy, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
      await this.verifyInstall(instance);
      if (!sameTree(activeTree, snapshot.manifest.tree)) throw backupError('BACKUP_RESTORE_VERIFY_FAILED', 409, 'The published restore failed verification');
      await this.#validateRestoredWorld(instance.id, marker.worldStackBinding, instance.directory);
      await this.store.update(instance.id, { lastRestore: structuredClone(marker.targetLastRestore) });
      await this.#phase(marker, paths.marker, 'store-committed');
      await this.#phase(marker, paths.marker, 'ready');
      await this.#removeTreeRecoverably(paths.original, this.serverRoot, 'Restore original', instance.id);
      await this.#compactRestoreMarker(paths.marker, marker);
      return {
        backupId: request.backupId,
        rescueBackupId: rescue.backupId,
        safetySnapshotVerified: true,
        stackPreserved: true,
        minecraftVersion: instance.minecraftVersion,
        restoredAt: marker.targetLastRestore.restoredAt,
      };
    } catch (error) {
      if (['store-committed', 'ready'].includes(marker.phase)) {
        this.#recoveryRequired.add(marker.instanceId);
        throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'The restore committed, but final recovery cleanup requires reconciliation; the committed restore was not reversed');
      }
      await this.#rollbackRestore(marker, paths, error);
      throw error;
    }
  }

  async #rollbackRestore(marker, paths, cause) {
    try {
      let failed = null;
      if (await exists(paths.original)) {
        if (await exists(paths.instance)) {
          failed = `${paths.candidate}.failed-${Date.now()}`;
          if (!await exists(failed)) await moveManagedDirectory(paths.instance, failed, this.serverRoot, this.directoryGuard, this.managedRoot, this.filesystemTreeVerifier);
        }
        await moveManagedDirectory(paths.original, paths.instance, this.serverRoot, this.directoryGuard, this.managedRoot, this.filesystemTreeVerifier);
      }
      if (await exists(paths.candidate)) await this.#removeTreeRecoverably(paths.candidate, this.serverRoot, 'Restore candidate', marker.instanceId);
      if (await exists(paths.overlay)) await this.#removeTreeRecoverably(paths.overlay, this.serverRoot, 'Restore overlay', marker.instanceId);
      await this.#verifyRolledBackInstance(marker, paths.instance);
      if (failed && await exists(failed)) await this.#removeTreeRecoverably(failed, this.serverRoot, 'Failed restore publication', marker.instanceId);
      await this.store.update(marker.instanceId, { lastRestore: marker.originalLastRestore ?? null });
      await this.#phase(marker, paths.marker, 'rolled-back', { failureCode: cause?.code ?? 'BACKUP_RESTORE_FAILED' });
      await this.#compactRestoreMarker(paths.marker, marker);
    } catch {
      this.#recoveryRequired.add(marker.instanceId);
      await this.#phase(marker, paths.marker, 'manual-recovery-required', { failureCode: 'BACKUP_MANUAL_RECOVERY_REQUIRED' }).catch(() => undefined);
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Restore recovery requires manual attention; no further filesystem action was attempted');
    }
  }

  async #reconcileMarker(
    marker,
    markerFile,
    recoveryRootGuard = null,
    recoveryRootStat = null,
    markerLease = null,
  ) {
    if (!recoveryRootGuard || !recoveryRootStat || !markerLease?.guard
      || path.resolve(markerLease.path) !== path.resolve(markerFile)) {
      throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore reconciliation evidence is not held under an exact lease');
    }
    recoveryRootGuard.assertHeld?.();
    markerLease.guard.assertHeld?.();
    if (!sameDirectoryIdentity(recoveryRootStat, await fs.lstat(this.transactionRoot))) {
      throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore reconciliation root changed under its exact lease');
    }
    if (!['ready', 'rolled-back'].includes(marker.phase)) {
      throw backupError(
        'BACKUP_MANUAL_RECOVERY_REQUIRED',
        409,
        'Interrupted nonterminal restore recovery is fenced until an authenticated compare-and-swap transition is available',
      );
    }
    const checked = await this.assertQuiescentWithinInstanceLock(marker.instanceId);
    const instance = await this.#instanceRecord(marker.instanceId, { requireDirectory: false });
    if (!checked || checked.id !== instance.id || checked.status !== 'stopped') {
      throw backupError('BACKUP_SERVER_NOT_QUIESCENT', 409, 'Restore recovery requires a verified stopped Family Server');
    }
    const paths = this.#restorePaths(instance, marker.transactionId);
    if (marker.phase === 'ready') {
      if (stackIdentity(instance) !== marker.stackDigest
        || !sameWorldStackBinding(await this.#worldStackBinding(instance.id), marker.worldStackBinding)) {
        throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'The completed restore no longer matches its approved managed stack');
      }
      await this.verifyInstall(instance);
      const policy = await this.#snapshotPolicy(instance.directory);
      const activeTree = await scanTree(instance.directory, policy, this.#limits(), this.filesystemTreeVerifier, this.directoryGuard, this.managedRoot, this.fileGuard);
      if (!sameTree(activeTree, marker.expectedTree)) {
        throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'The completed restore no longer matches its verified payload');
      }
      await this.#validateRestoredWorld(instance.id, marker.worldStackBinding, instance.directory);
      await this.#ensureTargetLastRestore(instance.id, marker.targetLastRestore);
      if (await exists(paths.original)) await this.#removeTreeRecoverably(
        paths.original, this.serverRoot, 'Restore original', marker.instanceId, { storageReady: true },
      );
      await this.#compactRestoreMarker(markerFile, marker, { rootGuard: recoveryRootGuard, markerLease });
      return { action: 'none', phase: marker.phase, compacted: true };
    }
    if (marker.phase === 'rolled-back') {
      await this.#verifyRolledBackInstance(marker, paths.instance);
      await this.store.update(marker.instanceId, { lastRestore: marker.originalLastRestore ?? null });
      await this.#compactRestoreMarker(markerFile, marker, { rootGuard: recoveryRootGuard, markerLease });
      return { action: 'none', phase: marker.phase, compacted: true };
    }
    throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery reached an invalid terminal state');
  }

  async #phase(marker, file, phase, extra = {}) {
    Object.assign(marker, extra, { phase, updatedAt: this.now() });
    await this.#writeMarker(file, marker);
    await this.onPhase(structuredClone(marker));
  }

  async #compactRestoreMarker(
    file,
    expectedMarker,
    { rootGuard: suppliedRootGuard = null, markerLease: suppliedMarkerLease = null } = {},
  ) {
    if (path.dirname(path.resolve(file)) !== path.resolve(this.transactionRoot)
      || !TRANSACTION_ID.test(path.basename(file, '.json'))
      || path.basename(file) !== `${path.basename(file, '.json')}.json`) {
      throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore marker compaction escaped its exact namespace');
    }
    if (!expectedMarker || !['ready', 'rolled-back'].includes(expectedMarker.phase)) {
      throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Only an authenticated terminal restore marker can be compacted');
    }
    let keyLease = null;
    try { keyLease = await this.#acquireKeyContinuityLease(); }
    catch {
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Terminal restore marker key continuity could not be leased');
    }
    let rootStat = null;
    let rootGuard = suppliedRootGuard;
    let markerGuard = suppliedMarkerLease?.guard ?? null;
    try {
      rootStat = await fs.lstat(this.transactionRoot);
      if (!rootGuard) {
        if (typeof this.directoryGuard?.batch === 'function') {
          [rootGuard] = await acquireVerifiedDirectoryGuardBatch(
            [{ path: this.transactionRoot, stat: rootStat }], this.directoryGuard, 'Restore marker compaction root',
          );
        } else {
          rootGuard = await this.directoryGuard(this.transactionRoot);
        }
      }
      rootGuard.assertHeld?.();
      if (!sameDirectoryIdentity(rootStat, await fs.lstat(this.transactionRoot))) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore marker namespace changed before compaction');
      }
      const markerStat = suppliedMarkerLease?.stat ?? await safeLstat(file);
      if (suppliedMarkerLease && path.resolve(suppliedMarkerLease.path) !== path.resolve(file)) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Terminal restore marker lease has an invalid path binding');
      }
      if (!markerGuard) {
        if (typeof this.fileGuard?.batch === 'function') {
          [markerGuard] = await acquireVerifiedFileGuardBatch(
            [{ path: file, stat: markerStat }], this.fileGuard, 'Terminal restore marker',
          );
        } else {
          markerGuard = await this.fileGuard(file);
        }
      }
      const value = await readSmallJsonGuarded(
        file, MAX_POLICY_BYTES, 'Terminal restore marker', this.fileGuard,
        { guard: markerGuard, requireCanonical: true },
      );
      const observed = authenticateRestoreMarker(this.key, value);
      const transactionId = path.basename(file, '.json');
      validateTransactionMarker(observed, transactionId);
      const expected = structuredClone(expectedMarker);
      delete expected.mac;
      if (!['ready', 'rolled-back'].includes(observed.phase)
        || canonicalJson(observed) !== canonicalJson(expected)) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Terminal restore marker changed before compaction');
      }
      rootGuard.assertHeld?.();
      markerGuard.assertHeld?.();
      await this.#assertKeyContinuityLease(keyLease);
      if (!sameDirectoryIdentity(rootStat, await fs.lstat(this.transactionRoot))
        || !sameFileIdentity(markerStat, await fs.lstat(file))) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Terminal restore marker changed before deletion');
      }
      await markerGuard.delete();
      if (suppliedMarkerLease) suppliedMarkerLease.guard = null;
      markerGuard = null;
      await this.#assertKeyContinuityLease(keyLease);
    } finally {
      await releaseGuards(
        suppliedMarkerLease ? null : markerGuard,
        suppliedRootGuard ? null : rootGuard,
        keyLease?.guard,
      );
    }
  }

  async #purgeable(instance, manifest, { fresh = false } = {}) {
    if (fresh) {
      const protection = await this.#freshProtection(instance);
      return !protection.protectedIds.has(manifest.backupId);
    }
    const backups = await this.#listBackups(instance, { limit: null });
    return backups.find((item) => item.backupId === manifest.backupId)?.purgeable === true;
  }

  async #applyRetention(instance) {
    const state = await this.#readPolicyState(instance.id);
    const protection = await this.#freshProtection(instance);
    const automatic = protection.verifiedBackups.filter((item) => item.kind === 'automatic');
    const retainedAutomatic = automatic.slice(0, state.policy.retentionCount);
    for (const backup of automatic.slice(state.policy.retentionCount)) {
      if (protection.protectedIds.has(backup.backupId)) continue;
      let retainedStillGood = true;
      for (const retained of retainedAutomatic) {
        try { await this.#verifySnapshot(instance, retained.backupId, { recordResult: true }); }
        catch (error) {
          if (!isCorruptSnapshotError(error)) throw error;
          retainedStillGood = false;
          break;
        }
      }
      if (!retainedStillGood) continue;
      try { await this.#verifySnapshot(instance, backup.backupId, { recordResult: true }); }
      catch (error) {
        if (isCorruptSnapshotError(error)) continue;
        throw error;
      }
      const immediatelyReferenced = await this.#referencedBackupIds(instance);
      if (immediatelyReferenced.has(backup.backupId)) continue;
      await this.#purgeSnapshotDirectory(instance.id, backup.backupId);
    }
  }

  async #freshProtection(instance) {
    const backups = await this.#listBackups(instance, { limit: null });
    const protectedIds = await this.#referencedBackupIds(instance);
    const verifiedBackups = [];
    const corruptBackups = [];
    for (const backup of backups) {
      try {
        const verified = await this.#verifySnapshot(instance, backup.backupId, { recordResult: true });
        verifiedBackups.push(publicBackup(verified.manifest, { restorable: true, purgeable: false }));
      } catch (error) {
        if (!isCorruptSnapshotError(error)) throw error;
        corruptBackups.push(backup);
      }
    }
    if (verifiedBackups.length > 0) protectedIds.add(verifiedBackups[0].backupId);
    for (const rescue of verifiedBackups.filter((item) => item.kind === 'rescue').slice(0, RESCUE_PROTECTED_COUNT)) {
      protectedIds.add(rescue.backupId);
    }
    return { backups, verifiedBackups, corruptBackups, protectedIds };
  }

  async #referencedBackupIds(
    instance,
    protectedOperation = null,
    { rootGuard: suppliedRootGuard = null, keyLease: suppliedKeyLease = null } = {},
  ) {
    if (protectedOperation !== null && typeof protectedOperation !== 'function') {
      throw new TypeError('Authenticated backup protection operation must be a function');
    }
    const ids = new Set();
    let rootGuard = suppliedRootGuard;
    let keyLease = suppliedKeyLease;
    let leaseReleaseFailed = false;
    let operationResult;
    let operationError = null;
    try {
      if (!suppliedRootGuard) await this.#ensureStorageRoots();
      if (keyLease) await this.#assertKeyContinuityLease(keyLease);
      else if (protectedOperation) keyLease = await this.#acquireKeyContinuityLease();
      else await this.#assertKeyContinuity();
      const rootStat = await fs.lstat(this.transactionRoot);
      if (!rootGuard) {
        if (typeof this.directoryGuard?.batch === 'function') {
          [rootGuard] = await acquireVerifiedDirectoryGuardBatch(
            [{ path: this.transactionRoot, stat: rootStat }], this.directoryGuard, 'Restore transaction protection root',
          );
        } else {
          rootGuard = await this.directoryGuard(this.transactionRoot);
        }
      }
      rootGuard.assertHeld?.();
      await this.filesystemTreeVerifier(this.transactionRoot, {
        maxEntries: this.maxRestoreMarkers, maxDepth: 0, recursive: false,
      });
      const entries = await safeDirectoryEntries(this.transactionRoot, {
        maxEntries: this.maxRestoreMarkers,
        limitError: () => backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery state exceeds its safe entry limit'),
      });
      const markerRecords = [];
      let aggregateBytes = 0;
      for (const entry of entries) {
        const transactionId = entry.name.slice(0, -5);
        if (!entry.isFile() || entry.name !== `${transactionId}.json` || !TRANSACTION_ID.test(transactionId)) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery state contains an invalid namespace entry');
        }
        const markerFile = path.join(this.transactionRoot, entry.name);
        const stat = await safeLstat(markerFile);
        aggregateBytes += stat.size;
        if (!stat.isFile() || stat.size < 2 || stat.size > MAX_POLICY_BYTES
          || aggregateBytes > this.maxRestoreMarkerBytes) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery state exceeds its safe byte limit');
        }
        markerRecords.push({ path: markerFile, stat, transactionId, name: entry.name });
      }
      const markerValues = await readSmallJsonGuardedBatch(
        markerRecords, MAX_POLICY_BYTES, 'Restore transaction marker', this.fileGuard, { requireCanonical: true },
      );
      const markers = [];
      for (let index = 0; index < markerRecords.length; index += 1) {
        const marker = authenticateRestoreMarker(this.key, markerValues[index]);
        validateTransactionMarker(marker, markerRecords[index].transactionId);
        markers.push(marker);
      }
      rootGuard.assertHeld?.();
      if (!sameDirectoryIdentity(rootStat, await fs.lstat(this.transactionRoot))) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery namespace changed during protection');
      }
      const observed = await safeDirectoryEntries(this.transactionRoot, {
        maxEntries: this.maxRestoreMarkers,
        limitError: () => backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery state exceeds its safe entry limit'),
      });
      if (observed.length !== markerRecords.length) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery namespace changed during protection');
      }
      for (let index = 0; index < observed.length; index += 1) {
        if (observed[index].name !== markerRecords[index].name || !observed[index].isFile()
          || !sameFileIdentity(markerRecords[index].stat, await safeLstat(markerRecords[index].path))) {
          throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore recovery namespace changed during protection');
        }
      }
      if (BACKUP_ID.test(instance?.lastRestore?.backupId ?? '')) ids.add(instance.lastRestore.backupId);
      if (BACKUP_ID.test(instance?.lastRestore?.rescueBackupId ?? '')) ids.add(instance.lastRestore.rescueBackupId);
      for (const marker of markers) {
        if (marker.instanceId !== instance.id || ['ready', 'rolled-back'].includes(marker.phase)) continue;
        ids.add(marker.backupId);
        ids.add(marker.rescueBackupId);
      }
      if (protectedOperation) {
        const revalidate = () => this.#referencedBackupIds(
          instance, null, { rootGuard, keyLease },
        );
        try { operationResult = await protectedOperation(ids, revalidate, keyLease); }
        catch (error) { operationError = error; }
      }
      if (keyLease) await this.#assertKeyContinuityLease(keyLease);
    } catch {
      this.#globalRecoveryRequired = true;
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Authenticated backup protection evidence could not be verified');
    } finally {
      try {
        await releaseGuards(
          suppliedRootGuard ? null : rootGuard,
          suppliedKeyLease ? null : keyLease?.guard,
        );
      } catch { leaseReleaseFailed = true; }
    }
    if (leaseReleaseFailed) {
      this.#globalRecoveryRequired = true;
      throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Authenticated backup protection lease could not be released safely');
    }
    if (!keyLease) {
      try { await this.#assertKeyContinuity(); }
      catch {
        this.#globalRecoveryRequired = true;
        throw backupError('BACKUP_MANUAL_RECOVERY_REQUIRED', 409, 'Authenticated backup protection continuity changed');
      }
    }
    if (operationError) throw operationError;
    return protectedOperation ? operationResult : ids;
  }

  async #purgeSnapshotDirectory(instanceId, backupId) {
    await this.#ensureStorageRoots();
    const instance = await this.#instanceRecord(instanceId, { requireDirectory: false });
    await this.#referencedBackupIds(instance, async (referenced, revalidate, keyLease) => {
      if (referenced.has(backupId)) {
        throw backupError('BACKUP_PROTECTED', 409, 'This backup is referenced by authenticated restore state');
      }
      await assertAnchoredDirectory(this.snapshotRoot, this.#snapshotInstanceRoot(instanceId), 'Instance backup root');
      const target = this.#snapshotDirectory(instanceId, backupId);
      await assertRegularDirectory(target, this.#snapshotInstanceRoot(instanceId), 'Backup directory');
      await this.#removeTreeRecoverably(
        target,
        this.#snapshotInstanceRoot(instanceId),
        'Backup directory',
        instanceId,
        {
          storageReady: true,
          keyLease,
          beforeTombstone: async () => {
            const currentReferences = await revalidate();
            if (currentReferences.has(backupId)) {
              throw backupError('BACKUP_PROTECTED', 409, 'This backup became referenced before authenticated deletion');
            }
          },
        },
      );
    });
  }

  async #readPolicyState(instanceId, { storageReady = false } = {}) {
    if (!storageReady) await this.#ensureStorageRoots();
    const file = this.#policyFile(instanceId);
    try {
      const value = await readSmallJson(file, MAX_POLICY_BYTES, 'Backup policy');
      validatePolicyState(value, instanceId);
      return value;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return {
        schemaVersion: 1,
        instanceId,
        policy: { ...DEFAULT_POLICY },
        lastAutomaticAttemptAt: null,
        lastAutomaticResult: null,
        automaticFailureCount: 0,
        lastAutomaticError: null,
        lastRetentionError: null,
        lastError: null,
        updatedAt: null,
      };
    }
  }

  async #writeAutomaticResult(instanceId, result, error) {
    const state = await this.#readPolicyState(instanceId);
    const deferred = result === 'deferred-running';
    state.lastAutomaticAttemptAt = this.now();
    state.lastAutomaticResult = result;
    state.automaticFailureCount = error && !deferred ? Math.min(16, (state.automaticFailureCount ?? 0) + 1) : 0;
    state.lastAutomaticError = error && !deferred ? safeErrorCode(error) : null;
    state.lastError = state.lastRetentionError ?? state.lastAutomaticError;
    state.updatedAt = this.now();
    await this.#writePrivateJson(this.#policyFile(instanceId), state);
  }

  async #writeRetentionResult(instanceId, error) {
    const state = await this.#readPolicyState(instanceId);
    state.lastRetentionError = error ? safeErrorCode(error) : null;
    state.lastError = state.lastRetentionError ?? state.lastAutomaticError ?? null;
    state.updatedAt = this.now();
    await this.#writePrivateJson(this.#policyFile(instanceId), state);
  }

  #policyFile(instanceId) {
    if (!validateInstanceId(instanceId)) throw new TypeError('Invalid instance id');
    return path.join(this.policyRoot, `${instanceId}.json`);
  }

  #snapshotInstanceRoot(instanceId) {
    if (!validateInstanceId(instanceId)) throw new TypeError('Invalid instance id');
    return path.join(this.snapshotRoot, instanceId);
  }

  #snapshotDirectory(instanceId, backupId) {
    if (!BACKUP_ID.test(backupId)) throw new TypeError('Invalid backup id');
    return path.join(this.#snapshotInstanceRoot(instanceId), backupId);
  }

  #restorePaths(instance, transactionId) {
    if (!TRANSACTION_ID.test(transactionId)) throw new TypeError('Invalid restore transaction id');
    const base = `.${instance.id}.${transactionId}`;
    return {
      marker: path.join(this.transactionRoot, `${transactionId}.json`),
      instance: path.resolve(instance.directory),
      candidate: path.join(this.serverRoot, `${base}.candidate`),
      overlay: path.join(this.serverRoot, `${base}.overlay`),
      original: path.join(this.serverRoot, `${base}.original`),
    };
  }

  #prunePlans() {
    const now = Date.parse(this.now());
    for (const [id, plan] of this.#plans) if (Date.parse(plan.expiresAt) <= now) this.#plans.delete(id);
  }

  #assertRestorePlanCapacity(instanceId) {
    let instancePlans = 0;
    for (const plan of this.#plans.values()) if (plan.instanceId === instanceId) instancePlans += 1;
    if (this.#plans.size >= this.maxRestorePlans || instancePlans >= this.maxRestorePlansPerInstance) {
      throw backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Restore approval plan capacity has been reached safely');
    }
  }
}

function validateInstanceOnly(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Backup request must be an object');
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'instanceId') || !validateInstanceId(input.instanceId)) throw new TypeError('Backup request requires one valid instanceId');
  return { instanceId: input.instanceId };
}

function validateBackupInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Backup request must be an object');
  if (Object.keys(input).length !== 2 || !validateInstanceId(input.instanceId) || !BACKUP_ID.test(input.backupId ?? '')) throw new TypeError('Backup request identity is invalid');
  return { instanceId: input.instanceId, backupId: input.backupId };
}

function validatePolicyInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Backup policy request must be an object');
  if (Object.keys(input).some((key) => !['instanceId', 'enabled', 'intervalHours', 'retentionCount'].includes(key)) || Object.keys(input).length !== 4) throw new TypeError('Backup policy request contains unsupported fields');
  if (!validateInstanceId(input.instanceId) || typeof input.enabled !== 'boolean' || !INTERVALS.has(input.intervalHours) || !Number.isInteger(input.retentionCount) || input.retentionCount < 3 || input.retentionCount > 30) throw new TypeError('Backup policy request is invalid');
  return { instanceId: input.instanceId, policy: { enabled: input.enabled, intervalHours: input.intervalHours, retentionCount: input.retentionCount } };
}

function validateRestoreInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3) throw new TypeError('Restore request is invalid');
  if (!validateInstanceId(input.instanceId) || !BACKUP_ID.test(input.backupId ?? '') || !RESTORE_PLAN_ID.test(input.planId ?? '')) throw new TypeError('Restore approval is invalid');
  return { instanceId: input.instanceId, backupId: input.backupId, planId: input.planId };
}

function validatePurgeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3 || input.confirmation !== 'PURGE') throw new TypeError('Backup purge confirmation is invalid');
  if (!validateInstanceId(input.instanceId) || !BACKUP_ID.test(input.backupId ?? '')) throw new TypeError('Backup purge identity is invalid');
  return { instanceId: input.instanceId, backupId: input.backupId };
}

function validateSchedulerFailure(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1) {
    throw new TypeError('Scheduler failure record must contain only a safe code');
  }
  if (typeof input.code !== 'string' || !/^BACKUP_[A-Z0-9_]{3,56}$/.test(input.code)) {
    throw new TypeError('Scheduler failure code is invalid');
  }
  return input.code;
}

function validatePolicyState(value, instanceId) {
  if (!value || value.schemaVersion !== 1 || value.instanceId !== instanceId || !value.policy) throw backupError('BACKUP_POLICY_INVALID', 409, 'Backup policy state is invalid');
  const policy = value.policy;
  if (typeof policy.enabled !== 'boolean' || !INTERVALS.has(policy.intervalHours) || !Number.isInteger(policy.retentionCount) || policy.retentionCount < 3 || policy.retentionCount > 30) throw backupError('BACKUP_POLICY_INVALID', 409, 'Backup policy state is invalid');
  if (value.automaticFailureCount !== undefined && (!Number.isInteger(value.automaticFailureCount) || value.automaticFailureCount < 0 || value.automaticFailureCount > 16)) throw backupError('BACKUP_POLICY_INVALID', 409, 'Backup policy state is invalid');
  for (const field of ['lastError', 'lastAutomaticError', 'lastRetentionError']) {
    if (value[field] !== undefined && value[field] !== null && (typeof value[field] !== 'string' || !/^BACKUP_[A-Z0-9_]{3,56}$/.test(value[field]))) {
      throw backupError('BACKUP_POLICY_INVALID', 409, 'Backup policy state is invalid');
    }
  }
}

function validateManifest(value, instanceId, backupId, limits = { maxFiles: MAX_FILES, maxBytes: MAX_BYTES }) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !MANIFEST_KEYS.has(key))
    || value.schemaVersion !== 1 || value.policyVersion !== POLICY_VERSION
    || value.instanceId !== instanceId || value.backupId !== backupId || !KINDS.has(value.kind)
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.minecraftVersion !== 'string' || value.minecraftVersion.length < 1 || value.minecraftVersion.length > 96
    || typeof value.levelName !== 'string' || value.levelName.length < 1 || value.levelName.length > 240
    || typeof value.stackDigest !== 'string' || !SHA256.test(value.stackDigest)
    || !isWorldStackBinding(value.worldStackBinding)
    || !validManifestTree(value.tree, limits) || !['verified', 'failed'].includes(value.integrity)
    || (value.verifiedAt !== null && (typeof value.verifiedAt !== 'string' || !Number.isFinite(Date.parse(value.verifiedAt))))
    || (value.lastVerificationFailedAt !== undefined
      && (typeof value.lastVerificationFailedAt !== 'string'
        || !validIsoTimestamp(value.lastVerificationFailedAt)))
  ) throw backupError('BACKUP_MANIFEST_INVALID', 409, 'Backup manifest is invalid');
}

function validateTransactionMarker(value, transactionId) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !RESTORE_MARKER_KEYS.has(key))
    || value.schemaVersion !== 1 || value.transactionId !== transactionId
    || !validateInstanceId(value.instanceId) || !BACKUP_ID.test(value.backupId ?? '')
    || !BACKUP_ID.test(value.rescueBackupId ?? '') || !RESTORE_PHASES.has(value.phase)
    || !validIsoTimestamp(value.createdAt) || !validIsoTimestamp(value.updatedAt)
    || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
    || !SHA256.test(value.stackDigest ?? '') || !isWorldStackBinding(value.worldStackBinding)
    || !SHA256.test(value.originalTreeDigest ?? '') || !validMarkerTree(value.expectedTree)
    || !validOriginalLastRestore(value.originalLastRestore)
    || !validOriginalLastRestore(value.targetLastRestore) || value.targetLastRestore === null
    || value.targetLastRestore.backupId !== value.backupId || value.targetLastRestore.rescueBackupId !== value.rescueBackupId
    || value.targetLastRestore.restoredAt !== value.createdAt
    || (value.failureCode !== undefined && (typeof value.failureCode !== 'string' || !/^[A-Z0-9_]{3,64}$/.test(value.failureCode)))
  ) throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore transaction marker is invalid');
}

function signRestoreMarker(key, marker) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !marker || typeof marker !== 'object' || Array.isArray(marker)) {
    throw backupError('BACKUP_UNAVAILABLE', 503, 'Restore transaction authentication is unavailable');
  }
  const unsigned = structuredClone(marker);
  delete unsigned.mac;
  const mac = crypto.createHmac('sha256', key).update(canonicalJson(unsigned), 'utf8').digest('hex');
  return { ...unsigned, mac };
}

function authenticateRestoreMarker(key, value) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((field) => !RESTORE_MARKER_KEYS.has(field)) || !SHA256.test(value.mac ?? '')) {
    throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore transaction marker authentication failed');
  }
  const unsigned = structuredClone(value);
  delete unsigned.mac;
  const expected = crypto.createHmac('sha256', key).update(canonicalJson(unsigned), 'utf8').digest();
  const observed = Buffer.from(value.mac, 'hex');
  if (observed.length !== expected.length || !crypto.timingSafeEqual(observed, expected)) {
    throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Restore transaction marker authentication failed');
  }
  return unsigned;
}

function cleanupIdentity(namespace, instanceId, targetName) {
  return `cln-${sha256(canonicalJson({ schemaVersion: 1, namespace, instanceId, targetName })).slice(0, 32)}`;
}

function validCleanupTargetName(namespace, instanceId, targetName) {
  if (!safeName(targetName)) return false;
  if (namespace === 'snapshot') {
    return BACKUP_ID.test(targetName) || /^\.staging-bkp-[a-f0-9]{32}$/.test(targetName);
  }
  if (namespace !== 'server') return false;
  const escaped = instanceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\.${escaped}\\.rtx-[a-f0-9]{32}\\.(?:candidate|overlay|original)(?:\\.(?:failed-[0-9]+|recovery-failed))?$`).test(targetName);
}

function validateCleanupMarker(value, cleanupId) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !CLEANUP_MARKER_KEYS.has(key))
    || value.schemaVersion !== 1 || value.cleanupId !== cleanupId || !CLEANUP_ID.test(value.cleanupId ?? '')
    || !validateInstanceId(value.instanceId) || !['snapshot', 'server'].includes(value.namespace)
    || !validCleanupTargetName(value.namespace, value.instanceId, value.targetName)
    || value.cleanupId !== cleanupIdentity(value.namespace, value.instanceId, value.targetName)
    || value.tombstoneName !== `.cleanup-${value.cleanupId}` || !validIsoTimestamp(value.createdAt)
  ) throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup marker is invalid');
}

function signCleanupMarker(key, marker) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !marker || typeof marker !== 'object' || Array.isArray(marker)) {
    throw backupError('BACKUP_UNAVAILABLE', 503, 'Backup cleanup authentication is unavailable');
  }
  const unsigned = structuredClone(marker);
  delete unsigned.mac;
  const mac = crypto.createHmac('sha256', key)
    .update(`backup-cleanup-v1\n${canonicalJson(unsigned)}`, 'utf8').digest('hex');
  return { ...unsigned, mac };
}

function authenticateCleanupMarker(key, value) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((field) => !CLEANUP_MARKER_KEYS.has(field)) || !SHA256.test(value.mac ?? '')) {
    throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup marker authentication failed');
  }
  const unsigned = structuredClone(value);
  delete unsigned.mac;
  const expected = crypto.createHmac('sha256', key)
    .update(`backup-cleanup-v1\n${canonicalJson(unsigned)}`, 'utf8').digest();
  const observed = Buffer.from(value.mac, 'hex');
  if (observed.length !== expected.length || !crypto.timingSafeEqual(observed, expected)) {
    throw backupError('BACKUP_RECOVERY_INVALID', 409, 'Backup cleanup marker authentication failed');
  }
  return unsigned;
}

function validIsoTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validMarkerTree(value) {
  return validTree(value) && value.entries.length === 0
    && value.files <= MAX_FILES && value.bytes <= MAX_BYTES;
}

function validOriginalLastRestore(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 4
    && keys.every((key) => ['backupId', 'rescueBackupId', 'restoredAt', 'state'].includes(key))
    && BACKUP_ID.test(value.backupId ?? '') && BACKUP_ID.test(value.rescueBackupId ?? '')
    && validIsoTimestamp(value.restoredAt) && value.state === 'verified';
}

function sameLastRestoreReceipt(left, right) {
  return validOriginalLastRestore(left) && validOriginalLastRestore(right)
    && left !== null && right !== null
    && left.backupId === right.backupId && left.rescueBackupId === right.rescueBackupId
    && left.restoredAt === right.restoredAt && left.state === right.state;
}

function publicPolicy(value) {
  return { enabled: value.enabled, intervalHours: value.intervalHours, retentionCount: value.retentionCount };
}

function publicBackup(manifest, options) {
  return {
    backupId: manifest.backupId,
    kind: manifest.kind,
    createdAt: manifest.createdAt,
    minecraftVersion: manifest.minecraftVersion,
    files: Number.isSafeInteger(manifest.tree?.files) ? manifest.tree.files : 0,
    bytes: Number.isSafeInteger(manifest.tree?.bytes) ? manifest.tree.bytes : 0,
    integrity: manifest.integrity,
    verifiedAt: manifest.integrity === 'verified' ? manifest.verifiedAt : null,
    restorable: options.restorable === true && manifest.integrity === 'verified',
    purgeable: options.purgeable === true,
  };
}

function inventoryManifest(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    policyVersion: manifest.policyVersion,
    backupId: manifest.backupId,
    instanceId: manifest.instanceId,
    kind: manifest.kind,
    createdAt: manifest.createdAt,
    minecraftVersion: manifest.minecraftVersion,
    levelName: manifest.levelName,
    stackDigest: manifest.stackDigest,
    worldStackBinding: structuredClone(manifest.worldStackBinding),
    tree: treeSummary(manifest.tree),
    integrity: manifest.integrity,
    verifiedAt: manifest.verifiedAt,
    ...(manifest.lastVerificationFailedAt === undefined ? {} : {
      lastVerificationFailedAt: manifest.lastVerificationFailedAt,
    }),
  };
}

function scheduleStatus(state, backups, instance, now) {
  const automatic = backups.find((backup) => backup.kind === 'automatic' && backup.integrity === 'verified');
  const base = automatic ? Date.parse(automatic.createdAt) : 0;
  const next = base ? base + state.policy.intervalHours * 60 * 60 * 1000 : now;
  const scheduledDue = state.policy.enabled && next <= now;
  const failures = Number.isInteger(state.automaticFailureCount) ? state.automaticFailureCount : 0;
  const attempt = typeof state.lastAutomaticAttemptAt === 'string' ? Date.parse(state.lastAutomaticAttemptAt) : NaN;
  const retryDelay = failures > 0
    ? Math.min(AUTOMATIC_RETRY_MAX_MS, AUTOMATIC_RETRY_BASE_MS * (2 ** Math.min(8, failures - 1)))
    : 0;
  const retryAt = Number.isFinite(attempt) && retryDelay > 0 ? attempt + retryDelay : 0;
  const due = scheduledDue && (!retryAt || retryAt <= now);
  const active = instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess != null;
  const failed = typeof state.lastError === 'string' && state.lastError.length > 0;
  return {
    state: scheduledDue && active ? 'deferred-running' : failed ? 'failed' : due ? 'due' : 'idle',
    due,
    deferred: scheduledDue && active,
    lastAutomaticAttemptAt: state.lastAutomaticAttemptAt ?? null,
    lastAutomaticResult: state.lastAutomaticResult ?? null,
    nextDueAt: state.policy.enabled ? new Date(Math.max(next, retryAt || 0)).toISOString() : null,
    lastError: state.lastError ?? null,
  };
}

function stackIdentity(instance) {
  const artifact = instance?.minecraftServerArtifact;
  const runtime = instance?.javaRuntime;
  let expectedPath;
  try { expectedPath = minecraftServerRelativePath(instance?.minecraftVersion); }
  catch { throw backupError('BACKUP_STACK_UNAVAILABLE', 503, 'The trusted Minecraft server stack binding is unavailable'); }
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)
    || Object.keys(artifact).sort().join(',') !== 'minecraftVersion,relativePath,sha1,sha256,size,worldDataVersion'
    || artifact.minecraftVersion !== instance.minecraftVersion || artifact.relativePath !== expectedPath
    || !Number.isSafeInteger(instance.worldDataVersion) || instance.worldDataVersion < 1 || instance.worldDataVersion > 0x7fffffff
    || artifact.worldDataVersion !== instance.worldDataVersion
    || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 128 * 1024 * 1024
    || !SHA1.test(artifact.sha1 ?? '') || !SHA256.test(artifact.sha256 ?? '')
    || !runtime || typeof runtime !== 'object' || Array.isArray(runtime)
    || !SHA256.test(runtime.launchAssetDigest ?? '')
    || !SHA256.test(runtime.launchInventoryDigest ?? '')) {
    throw backupError('BACKUP_STACK_UNAVAILABLE', 503, 'The trusted Minecraft server stack binding is unavailable');
  }
  return sha256(canonicalJson({
    minecraftVersion: instance.minecraftVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    installerVersion: instance.installerVersion,
    requiredJavaMajor: instance.requiredJavaMajor,
    worldDataVersion: instance.worldDataVersion ?? null,
    minecraftServerArtifact: artifact,
    javaRuntime: instance.javaRuntime ?? null,
    artifacts: instance.artifacts ?? null,
    components: instance.components ?? null,
  }));
}

function isWorldStackBinding(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, 'generation') && Object.hasOwn(value, 'inventoryDigest')
    && SHA256.test(value.generation ?? '') && SHA256.test(value.inventoryDigest ?? '');
}

function validateWorldStackBinding(value, code) {
  if (!isWorldStackBinding(value)) {
    throw backupError(code, 409, 'The managed world and mod stack binding is unavailable or invalid');
  }
  return { generation: value.generation, inventoryDigest: value.inventoryDigest };
}

function sameWorldStackBinding(left, right) {
  return isWorldStackBinding(left) && isWorldStackBinding(right)
    && left.generation === right.generation && left.inventoryDigest === right.inventoryDigest;
}

async function releaseGuards(...guards) {
  let firstError = null;
  for (const guard of guards) {
    if (!guard) continue;
    try { await guard.release(); } catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
}

function guardBatches(entries) {
  const batches = [];
  for (let index = 0; index < entries.length; index += MAX_GUARD_BATCH_ENTRIES) {
    batches.push(entries.slice(index, index + MAX_GUARD_BATCH_ENTRIES));
  }
  return batches;
}

async function acquireVerifiedDirectoryGuardBatch(records, directoryGuard, label) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_GUARD_BATCH_ENTRIES
    || typeof directoryGuard?.batch !== 'function') {
    throw new TypeError('A bounded directory guard batch is required');
  }
  let guards = null;
  try {
    guards = await directoryGuard.batch(records.map((record) => record.path));
    if (!Array.isArray(guards) || guards.length !== records.length) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} returned an invalid directory guard batch`);
    }
    for (let index = 0; index < records.length; index += 1) {
      const guard = guards[index];
      if (!guard || typeof guard.release !== 'function') {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} could not acquire every directory guard`);
      }
      guard.assertHeld?.();
      const current = await fs.lstat(records[index].path);
      if (!current.isDirectory() || current.isSymbolicLink()
        || !sameDirectoryIdentity(records[index].stat, current)) {
        throw backupError('BACKUP_SOURCE_CHANGED', 409, `${label} changed while its directory guards were acquired`);
      }
    }
    return guards;
  } catch (error) {
    if (Array.isArray(guards)) {
      await releaseGuards(...guards.filter((guard) => guard && typeof guard.release === 'function').reverse())
        .catch(() => undefined);
    }
    throw error;
  }
}

async function acquireVerifiedFileGuardBatch(records, fileGuard, label) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_GUARD_BATCH_ENTRIES
    || typeof fileGuard?.batch !== 'function') {
    throw new TypeError('A bounded file guard batch is required');
  }
  let guards = null;
  try {
    guards = await fileGuard.batch(records.map((record) => record.path));
    if (!Array.isArray(guards) || guards.length !== records.length) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} returned an invalid file guard batch`);
    }
    for (let index = 0; index < records.length; index += 1) {
      const guard = guards[index];
      if (!guard || typeof guard.release !== 'function') {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} could not acquire every file guard`);
      }
      guard.assertHeld?.();
      const current = await fs.lstat(records[index].path);
      if (!sameFileIdentity(records[index].stat, current)) {
        throw backupError('BACKUP_SOURCE_CHANGED', 409, `${label} changed while its file guards were acquired`);
      }
    }
    return guards;
  } catch (error) {
    if (Array.isArray(guards)) {
      await releaseGuards(...guards.filter((guard) => guard && typeof guard.release === 'function').reverse())
        .catch(() => undefined);
    }
    throw error;
  }
}

function managedGuardPaths(root, target) {
  const boundary = path.resolve(root);
  const resolved = path.resolve(target);
  const relative = path.relative(boundary, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'A managed backup path escaped its trusted root');
  }
  const paths = [boundary];
  let cursor = boundary;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    if (!safeName(component)) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'A managed backup path contains an unsafe component');
    cursor = path.join(cursor, component);
    paths.push(cursor);
  }
  return paths;
}

async function acquireAnchoredGuardChain(root, target, label, directoryGuard, filesystemTreeVerifier) {
  return acquireAnchoredGuardBranches(root, [target], label, directoryGuard, filesystemTreeVerifier);
}

async function acquireAnchoredGuardBranches(root, targets, label, directoryGuard, filesystemTreeVerifier) {
  const guards = [];
  let batch = null;
  try {
    const boundary = path.resolve(root);
    const wanted = new Map();
    for (const target of targets) {
      for (const directory of managedGuardPaths(boundary, target)) {
        wanted.set(process.platform === 'win32' ? directory.toLowerCase() : directory, directory);
      }
    }
    const ordered = [...wanted.values()].sort((left, right) => {
      const depth = path.relative(boundary, left).split(path.sep).filter(Boolean).length
        - path.relative(boundary, right).split(path.sep).filter(Boolean).length;
      return depth || left.localeCompare(right, 'en');
    });
    const expected = [];
    for (const directory of ordered) {
      const before = await fs.lstat(directory);
      if (!before.isDirectory() || before.isSymbolicLink()) {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} contains an unsafe directory`);
      }
      expected.push(before);
    }
    batch = typeof directoryGuard?.batch === 'function'
      ? await directoryGuard.batch(ordered)
      : null;
    if (batch && (!Array.isArray(batch) || batch.length !== ordered.length)) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} returned an invalid directory guard batch`);
    }
    for (let index = 0; index < ordered.length; index += 1) {
      const directory = ordered[index];
      const before = expected[index];
      const guard = batch ? batch[index] : await directoryGuard(directory);
      if (!guard || typeof guard.release !== 'function') {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} could not acquire a directory guard`);
      }
      guard.assertHeld?.();
      const after = await fs.lstat(directory);
      if (!sameDirectoryIdentity(before, after)) {
        throw backupError('BACKUP_SOURCE_CHANGED', 409, `${label} changed while its guard chain was acquired`);
      }
      try {
        await filesystemTreeVerifier(directory, { maxEntries: 1, maxDepth: 0, recursive: false });
      } catch {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} contains unsafe filesystem metadata`);
      }
      guards.push({ path: directory, stat: after, guard });
    }
    await assertGuardChainHeld(guards, filesystemTreeVerifier);
    const realRoot = await fs.realpath(boundary);
    for (const target of targets) {
      const realTarget = await fs.realpath(path.resolve(target));
      const realRelative = path.relative(realRoot, realTarget);
      if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} escaped its canonical trusted root`);
      }
    }
    return guards;
  } catch (error) {
    const acquired = Array.isArray(batch) ? batch : guards.map((entry) => entry.guard);
    await releaseGuards(...acquired.filter((guard) => guard && typeof guard.release === 'function').reverse()).catch(() => undefined);
    throw error;
  }
}

function guardChainEntry(chain, target) {
  const expected = path.resolve(target);
  const entry = chain.find((candidate) => path.resolve(candidate.path) === expected
    || (process.platform === 'win32' && path.resolve(candidate.path).toLowerCase() === expected.toLowerCase()));
  if (!entry) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'A required managed backup guard is unavailable');
  return entry;
}

async function acquireMutableDirectoryBinding(
  boundary,
  directory,
  label,
  directoryGuard,
  filesystemTreeVerifier,
) {
  const resolvedBoundary = path.resolve(boundary);
  const resolvedDirectory = path.resolve(directory);
  const ancestor = path.dirname(resolvedDirectory);
  if (resolvedDirectory === resolvedBoundary || ancestor === resolvedDirectory) {
    throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} has no guarded managed ancestor`);
  }
  const chain = await acquireAnchoredGuardChain(
    resolvedBoundary, ancestor, `${label} ancestor`, directoryGuard, filesystemTreeVerifier,
  );
  let leafGuard = null;
  try {
    await assertGuardChainHeld(chain, filesystemTreeVerifier);
    const stat = await fs.lstat(resolvedDirectory);
    const exactStat = await fs.lstat(resolvedDirectory, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} is not a regular directory`);
    }
    await filesystemTreeVerifier(resolvedDirectory, { maxEntries: 1, maxDepth: 0, recursive: false });
    const [realBoundary, realDirectory] = await Promise.all([
      fs.realpath(resolvedBoundary), fs.realpath(resolvedDirectory),
    ]);
    const relative = path.relative(realBoundary, realDirectory);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} escaped its canonical managed boundary`);
    }
    if (typeof directoryGuard?.batch === 'function') {
      [leafGuard] = await acquireVerifiedDirectoryGuardBatch(
        [{ path: resolvedDirectory, stat }], directoryGuard, `${label} mutable directory`,
      );
    } else {
      leafGuard = await directoryGuard(resolvedDirectory);
    }
    leafGuard.assertHeld?.();
    if (!sameDirectoryIdentity(stat, await fs.lstat(resolvedDirectory))
      || !sameExactDirectoryIdentity(exactStat, await fs.lstat(resolvedDirectory, { bigint: true }))) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, `${label} changed while its exact guard was acquired`);
    }
    await assertGuardChainHeld(chain, filesystemTreeVerifier);
    return {
      boundary: resolvedBoundary,
      directory: resolvedDirectory,
      stat,
      exactStat,
      nativeIdentity: typeof leafGuard.identity === 'string' ? leafGuard.identity : null,
      chain,
      leafGuard,
    };
  } catch (error) {
    await releaseGuards(leafGuard, ...chain.map((entry) => entry.guard).reverse()).catch(() => undefined);
    throw error;
  }
}

async function assertMutableDirectoryBinding(binding, filesystemTreeVerifier) {
  binding.leafGuard?.assertHeld?.();
  await assertGuardChainHeld(binding.chain, filesystemTreeVerifier);
  const current = await fs.lstat(binding.directory);
  const exactCurrent = await fs.lstat(binding.directory, { bigint: true });
  if (!sameDirectoryIdentity(binding.stat, current)
    || !sameExactDirectoryIdentity(binding.exactStat, exactCurrent)
    || (binding.nativeIdentity !== null && binding.leafGuard?.identity !== binding.nativeIdentity)) {
    throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A mutable managed directory changed during publication');
  }
  await filesystemTreeVerifier(binding.directory, { maxEntries: 1, maxDepth: 0, recursive: false });
}

async function reacquireMutableDirectoryLeaf(binding, directoryGuard, filesystemTreeVerifier) {
  if (binding.leafGuard) {
    throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'A mutable managed directory guard was not released for rebinding');
  }
  let leafGuard = null;
  try {
    await assertGuardChainHeld(binding.chain, filesystemTreeVerifier);
    const current = await fs.lstat(binding.directory);
    const exactCurrent = await fs.lstat(binding.directory, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !sameDirectoryIdentity(binding.stat, current)
      || !sameExactDirectoryIdentity(binding.exactStat, exactCurrent)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A mutable managed directory changed before it could be rebound');
    }
    await filesystemTreeVerifier(binding.directory, { maxEntries: 1, maxDepth: 0, recursive: false });
    if (typeof directoryGuard?.batch === 'function') {
      [leafGuard] = await acquireVerifiedDirectoryGuardBatch(
        [{ path: binding.directory, stat: binding.stat }], directoryGuard, 'Mutable managed directory rebind',
      );
    } else {
      leafGuard = await directoryGuard(binding.directory);
    }
    leafGuard.assertHeld?.();
    const rebound = await fs.lstat(binding.directory);
    const exactRebound = await fs.lstat(binding.directory, { bigint: true });
    if (!sameDirectoryIdentity(binding.stat, rebound)
      || !sameExactDirectoryIdentity(binding.exactStat, exactRebound)
      || (binding.nativeIdentity !== null && leafGuard.identity !== binding.nativeIdentity)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A mutable managed directory changed while it was rebound');
    }
    await filesystemTreeVerifier(binding.directory, { maxEntries: 1, maxDepth: 0, recursive: false });
    await assertGuardChainHeld(binding.chain, filesystemTreeVerifier);
    binding.leafGuard = leafGuard;
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
  } catch (error) {
    if (binding.leafGuard === leafGuard) binding.leafGuard = null;
    await releaseGuards(leafGuard).catch(() => undefined);
    throw error;
  }
}

async function releaseMutableDirectoryBinding(binding) {
  if (!binding) return;
  await releaseGuards(binding.leafGuard, ...binding.chain.map((entry) => entry.guard).reverse());
}

async function directoryNamespace(directory, maxEntries = MAX_FILES) {
  const result = [];
  for (const entry of await safeDirectoryEntries(directory, {
    maxEntries,
    limitError: () => backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Managed namespace exceeds its safe entry limit'),
  })) {
    const stat = await safeLstat(path.join(directory, entry.name));
    result.push({
      name: entry.name,
      kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
      dev: Number.isSafeInteger(stat.dev) ? stat.dev : null,
      ino: Number.isSafeInteger(stat.ino) ? stat.ino : null,
    });
  }
  return result;
}

function exactNamespaceEntry(name, stat) {
  if (!safeName(name) || typeof stat?.dev !== 'bigint' || typeof stat?.ino !== 'bigint' || stat.ino === 0n
    || stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())
    || (stat.isFile() && stat.nlink !== 1n)) {
    throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Managed namespace identity is unavailable');
  }
  return {
    name,
    kind: stat.isDirectory() ? 'directory' : 'file',
    dev: stat.dev.toString(10),
    ino: stat.ino.toString(10),
  };
}

async function exactDirectoryNamespace(directory, maxEntries = MAX_FILES) {
  const result = [];
  for (const entry of await safeDirectoryEntries(directory, {
    maxEntries,
    limitError: () => backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Managed namespace exceeds its safe entry limit'),
  })) {
    result.push(exactNamespaceEntry(
      entry.name,
      await fs.lstat(path.join(directory, entry.name), { bigint: true }),
    ));
  }
  return result;
}

async function stableExactDirectoryNamespace(directory, maxEntries = MAX_FILES) {
  const first = await exactDirectoryNamespace(directory, maxEntries);
  const second = await exactDirectoryNamespace(directory, maxEntries);
  if (!sameExactNamespace(first, second)) {
    throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Managed namespace changed while its exact identity was inventoried');
  }
  return first;
}

function sameExactNamespace(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((entry, index) => entry.name === right[index]?.name
      && entry.kind === right[index]?.kind && entry.dev === right[index]?.dev && entry.ino === right[index]?.ino);
}

function expectedExactNamespaceAfterFileCreate(before, createdName, createdStat) {
  if (before.some((entry) => entry.name === createdName)) {
    throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Managed namespace already contains the staging file');
  }
  return [...before, exactNamespaceEntry(createdName, createdStat)]
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function expectedExactNamespaceAfterDirectoryCreate(before, createdName, createdStat) {
  if (before.some((entry) => entry.name === createdName) || !createdStat?.isDirectory?.()) {
    throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Managed namespace already contains the staging directory');
  }
  return [...before, exactNamespaceEntry(createdName, createdStat)]
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function expectedExactNamespaceAfterReplace(before, destinationName, publishedStat) {
  return [
    ...before.filter((entry) => entry.name !== destinationName),
    exactNamespaceEntry(destinationName, publishedStat),
  ].sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function expectedExactNamespaceAfterRename(before, sourceName, destinationName) {
  if (!safeName(sourceName) || !safeName(destinationName) || sourceName === destinationName
    || !before.some((entry) => entry.name === sourceName)
    || before.some((entry) => entry.name === destinationName)) {
    throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A managed exact namespace was not in the expected rename state');
  }
  return before.map((entry) => entry.name === sourceName ? { ...entry, name: destinationName } : entry)
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function expectedNamespaceAfterRemove(before, targetName) {
  if (!safeName(targetName) || !before.some((entry) => entry.name === targetName)) {
    throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A managed cleanup namespace was not in the expected state');
  }
  return before.filter((entry) => entry.name !== targetName);
}

function sameNamespace(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((entry, index) => entry.name === right[index]?.name && entry.kind === right[index]?.kind
    && (entry.ino === null || right[index].ino === null || (entry.dev === right[index].dev && entry.ino === right[index].ino)));
}

async function assertGuardChainHeld(chain, filesystemTreeVerifier = null) {
  for (const entry of chain) {
    entry.guard.assertHeld?.();
    const current = await fs.lstat(entry.path);
    if (!sameDirectoryIdentity(entry.stat, current)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A managed backup ancestor changed during the operation');
    }
    if (filesystemTreeVerifier) {
      try {
        await filesystemTreeVerifier(entry.path, { maxEntries: 1, maxDepth: 0, recursive: false });
      } catch {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'A managed backup ancestor contains unsafe filesystem metadata');
      }
    }
  }
}

function manifestIdentity(manifest) {
  return sha256(canonicalJson({
    schemaVersion: manifest.schemaVersion,
    policyVersion: manifest.policyVersion,
    backupId: manifest.backupId,
    instanceId: manifest.instanceId,
    kind: manifest.kind,
    createdAt: manifest.createdAt,
    minecraftVersion: manifest.minecraftVersion,
    levelName: manifest.levelName,
    stackDigest: manifest.stackDigest,
    worldStackBinding: manifest.worldStackBinding,
    tree: manifest.tree,
  }));
}

function validTree(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === MANIFEST_TREE_KEYS.size
    && Object.keys(value).every((key) => MANIFEST_TREE_KEYS.has(key))
    && value.algorithm === 'sha256' && SHA256.test(value.digest ?? '')
    && Number.isSafeInteger(value.files) && value.files >= 0
    && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && Array.isArray(value.entries);
}

function validManifestTree(value, limits) {
  if (!validTree(value) || !limits || !Number.isInteger(limits.maxFiles) || !Number.isSafeInteger(limits.maxBytes)
    || value.files > limits.maxFiles || value.bytes > limits.maxBytes || value.entries.length > limits.maxFiles) return false;
  const seen = new Set();
  let files = 0;
  let bytes = 0;
  for (const entry of value.entries) {
    if (!Array.isArray(entry) || (entry.length !== 2 && entry.length !== 4)) return false;
    const [kind, relative] = entry;
    if (!validManifestRelativePath(relative) || seen.has(relative)) return false;
    seen.add(relative);
    if (kind === 'directory') {
      if (entry.length !== 2) return false;
      continue;
    }
    if (kind !== 'file' || entry.length !== 4
      || !Number.isSafeInteger(entry[2]) || entry[2] < 0 || entry[2] > limits.maxBytes
      || !SHA256.test(entry[3] ?? '')) return false;
    files += 1;
    bytes += entry[2];
    if (files > limits.maxFiles || bytes > limits.maxBytes) return false;
  }
  return files === value.files && bytes === value.bytes
    && sha256(canonicalJson(value.entries)) === value.digest;
}

function validManifestRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4_096
    || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false;
  return value.split('/').every((part) => part.length <= 255 && safeName(part));
}

function sameTree(left, right) {
  return validTree(left) && validTree(right) && left.digest === right.digest && left.files === right.files && left.bytes === right.bytes;
}

function treeSummary(value) {
  if (!validTree(value)) throw backupError('BACKUP_MANIFEST_INVALID', 409, 'Backup tree metadata is invalid');
  return { algorithm: 'sha256', digest: value.digest, files: value.files, bytes: value.bytes, entries: [] };
}

function includeEverythingPolicy() {
  return { policyVersion: POLICY_VERSION, managedFiles: new Set(), include: () => true };
}

async function scanTree(
  root,
  policy,
  limits,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  directoryGuard = acquireWindowsDirectoryGuard,
  boundary = root,
  fileGuard = defaultFileGuard,
) {
  const ancestorChain = await acquireAnchoredGuardChain(
    boundary, root, 'Snapshot tree root', directoryGuard, filesystemTreeVerifier,
  );
  const guard = ancestorChain.at(-1).guard;
  try {
    await assertGuardChainHeld(ancestorChain, filesystemTreeVerifier);
    await filesystemTreeVerifier(root, { maxEntries: limits.maxFiles, maxDepth: limits.maxDepth });
    await assertRegularDirectory(root, path.dirname(root), 'Snapshot tree root', { allowEqual: true });
    const entries = [];
    let files = 0;
    let bytes = 0;
    const walk = async (directory, prefix, depth, heldGuard = null) => {
      const localGuard = heldGuard ?? await directoryGuard(directory);
      try {
        localGuard.assertHeld?.();
        if (depth > limits.maxDepth) throw backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Backup directory depth exceeds the safe limit');
        const children = await safeDirectoryEntries(directory, { maxEntries: limits.maxFiles });
        const records = [];
        for (const child of children) {
          const relative = prefix ? `${prefix}/${child.name}` : child.name;
          const target = path.join(directory, child.name);
          const stat = await safeLstat(target, relative);
          if (!policy.include(relative, child)) continue;
          if (!stat.isDirectory() && !stat.isFile()) {
            throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Backup source contains an unsupported filesystem entry');
          }
          if (stat.isFile()) {
            files += 1;
            bytes += stat.size;
            if (files > limits.maxFiles || bytes > limits.maxBytes) {
              throw backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Backup exceeds the safe file or byte limit');
            }
          }
          records.push({ child, relative, path: target, stat });
        }

        if (typeof directoryGuard?.batch !== 'function' && typeof fileGuard?.batch !== 'function') {
          for (const record of records) {
            if (record.stat.isDirectory()) {
              entries.push(['directory', record.relative]);
              await walk(record.path, record.relative, depth + 1);
            } else {
              entries.push(['file', record.relative, record.stat.size, await hashFile(record.path, fileGuard)]);
            }
          }
          return;
        }

        for (const recordsBatch of guardBatches(records)) {
          const directories = recordsBatch.filter((record) => record.stat.isDirectory());
          const regularFiles = recordsBatch.filter((record) => record.stat.isFile());
          let directoryGuards = null;
          let fileGuards = null;
          try {
            if (directories.length > 0 && typeof directoryGuard?.batch === 'function') {
              directoryGuards = await acquireVerifiedDirectoryGuardBatch(
                directories, directoryGuard, 'Snapshot sibling directory set',
              );
            }
            if (regularFiles.length > 0 && typeof fileGuard?.batch === 'function') {
              fileGuards = await acquireVerifiedFileGuardBatch(
                regularFiles, fileGuard, 'Snapshot sibling file set',
              );
            }
            for (const record of recordsBatch) {
              if (record.stat.isDirectory()) {
                entries.push(['directory', record.relative]);
                const index = directories.indexOf(record);
                await walk(record.path, record.relative, depth + 1, directoryGuards?.[index] ?? null);
              } else {
                const index = regularFiles.indexOf(record);
                const digest = fileGuards
                  ? await hashFileWithHeldGuard(record.path, record.stat, fileGuards[index])
                  : await hashFile(record.path, fileGuard);
                entries.push(['file', record.relative, record.stat.size, digest]);
              }
            }
          } finally {
            await releaseGuards(...(fileGuards ?? []).reverse(), ...(directoryGuards ?? []).reverse());
          }
        }
      } finally { if (!heldGuard) await releaseGuards(localGuard); }
    };
    await walk(root, '', 0, guard);
    await filesystemTreeVerifier(root, { maxEntries: limits.maxFiles, maxDepth: limits.maxDepth });
    await assertGuardChainHeld(ancestorChain, filesystemTreeVerifier);
    return { algorithm: 'sha256', digest: sha256(canonicalJson(entries)), files, bytes, entries };
  } finally { await releaseGuards(...ancestorChain.map((entry) => entry.guard).reverse()); }
}

async function copyFilteredTree(
  source,
  destination,
  policy,
  limits,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = defaultFileGuard,
  boundary = source,
) {
  const ancestorChain = await acquireAnchoredGuardBranches(
    boundary, [source, path.dirname(destination)], 'Backup copy boundary', directoryGuard, filesystemTreeVerifier,
  );
  const sourceGuard = guardChainEntry(ancestorChain, source).guard;
  const destinationParentGuard = guardChainEntry(ancestorChain, path.dirname(destination)).guard;
  let destinationGuard = null;
  try {
    await assertGuardChainHeld(ancestorChain, filesystemTreeVerifier);
    await filesystemTreeVerifier(source, { maxEntries: limits.maxFiles, maxDepth: limits.maxDepth });
    await assertRegularDirectory(source, path.dirname(source), 'Backup source', { allowEqual: true });
    await fs.mkdir(destination, { recursive: false, mode: 0o700 });
    const destinationStat = await fs.lstat(destination);
    if (typeof directoryGuard?.batch === 'function') {
      [destinationGuard] = await acquireVerifiedDirectoryGuardBatch(
        [{ path: destination, stat: destinationStat }], directoryGuard, 'Backup destination root',
      );
    } else {
      destinationGuard = await directoryGuard(destination);
    }
    let files = 0;
    let bytes = 0;
    const walk = async (from, to, prefix, depth, heldFrom = null, heldTo = null) => {
      const fromGuard = heldFrom ?? await directoryGuard(from);
      let toGuard = heldTo;
      try {
        fromGuard.assertHeld?.();
        toGuard ??= await directoryGuard(to);
        toGuard.assertHeld?.();
        if (depth > limits.maxDepth) throw backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Backup directory depth exceeds the safe limit');
        const records = [];
        for (const entry of await safeDirectoryEntries(from, { maxEntries: limits.maxFiles })) {
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
          const sourcePath = path.join(from, entry.name);
          const targetPath = path.join(to, entry.name);
          const stat = await safeLstat(sourcePath, relative);
          if (!policy.include(relative, entry)) continue;
          if (!stat.isDirectory() && !stat.isFile()) {
            throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Backup source contains an unsupported filesystem entry');
          }
          if (stat.isFile()) {
            files += 1;
            bytes += stat.size;
            if (files > limits.maxFiles || bytes > limits.maxBytes) {
              throw backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Backup exceeds the safe file or byte limit');
            }
          }
          records.push({ entry, relative, path: sourcePath, destination: targetPath, stat });
        }

        if (typeof directoryGuard?.batch !== 'function' && typeof fileGuard?.batch !== 'function') {
          for (const record of records) {
            if (record.stat.isDirectory()) {
              await fs.mkdir(record.destination, { mode: record.stat.mode });
              await walk(record.path, record.destination, record.relative, depth + 1);
            } else {
              await copyRegularFile(record.path, record.destination, record.stat, fileGuard);
            }
          }
          return;
        }

        const directoryRecords = records.filter((record) => record.stat.isDirectory());
        const fileRecords = records.filter((record) => record.stat.isFile());
        if (typeof directoryGuard?.batch === 'function') {
          const pairBatchSize = Math.floor(MAX_GUARD_BATCH_ENTRIES / 2);
          for (let index = 0; index < directoryRecords.length; index += pairBatchSize) {
            const batch = directoryRecords.slice(index, index + pairBatchSize);
            for (const record of batch) {
              await fs.mkdir(record.destination, { mode: record.stat.mode });
              record.destinationStat = await fs.lstat(record.destination);
            }
            const guarded = batch.flatMap((record) => [
              { path: record.path, stat: record.stat },
              { path: record.destination, stat: record.destinationStat },
            ]);
            let guards = null;
            try {
              guards = await acquireVerifiedDirectoryGuardBatch(guarded, directoryGuard, 'Backup copy sibling directory set');
              for (let offset = 0; offset < batch.length; offset += 1) {
                await walk(
                  batch[offset].path, batch[offset].destination, batch[offset].relative, depth + 1,
                  guards[offset * 2], guards[(offset * 2) + 1],
                );
              }
            } finally { await releaseGuards(...(guards ?? []).reverse()); }
          }
        } else {
          for (const record of directoryRecords) {
            await fs.mkdir(record.destination, { mode: record.stat.mode });
            await walk(record.path, record.destination, record.relative, depth + 1);
          }
        }
        if (typeof fileGuard?.batch === 'function') {
          for (const batch of guardBatches(fileRecords)) await copyRegularFileBatch(batch, fileGuard);
        } else {
          for (const record of fileRecords) {
            await copyRegularFile(record.path, record.destination, record.stat, fileGuard);
          }
        }
      } finally { await releaseGuards(heldTo ? null : toGuard, heldFrom ? null : fromGuard); }
    };
    await walk(source, destination, '', 0, sourceGuard, destinationGuard);
    await filesystemTreeVerifier(source, { maxEntries: limits.maxFiles, maxDepth: limits.maxDepth });
    await filesystemTreeVerifier(destination, { maxEntries: limits.maxFiles, maxDepth: limits.maxDepth });
    await assertGuardChainHeld(ancestorChain, filesystemTreeVerifier);
  } finally {
    await releaseGuards(
      destinationGuard,
      ...ancestorChain.map((entry) => entry.guard).reverse(),
    );
  }
}

async function copyWholeTree(
  source,
  destination,
  limits,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = defaultFileGuard,
  boundary = source,
) {
  return copyFilteredTree(source, destination, includeEverythingPolicy(), limits, filesystemTreeVerifier, directoryGuard, fileGuard, boundary);
}

async function mergeTree(
  source,
  destination,
  limits,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = defaultFileGuard,
  boundary = source,
) {
  const ancestorChain = await acquireAnchoredGuardBranches(
    boundary, [source, destination], 'Restore merge boundary', directoryGuard, filesystemTreeVerifier,
  );
  const sourceGuard = guardChainEntry(ancestorChain, source).guard;
  const destinationGuard = guardChainEntry(ancestorChain, destination).guard;
  try {
    await assertGuardChainHeld(ancestorChain, filesystemTreeVerifier);
    await filesystemTreeVerifier(source, { maxEntries: limits.maxFiles, maxDepth: limits.maxDepth });
    await filesystemTreeVerifier(destination, { maxEntries: limits.maxFiles, maxDepth: limits.maxDepth });
    await assertRegularDirectory(source, path.dirname(source), 'Restore overlay', { allowEqual: true });
    let files = 0;
    let bytes = 0;
    const walk = async (from, to, depth, heldFrom = null, heldTo = null) => {
      const fromGuard = heldFrom ?? await directoryGuard(from);
      let toGuard = heldTo;
      try {
        fromGuard.assertHeld?.();
        toGuard ??= await directoryGuard(to);
        toGuard.assertHeld?.();
        if (depth > limits.maxDepth) throw backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Restore directory depth exceeds the safe limit');
        const records = [];
        for (const entry of await safeDirectoryEntries(from, { maxEntries: limits.maxFiles })) {
          const sourcePath = path.join(from, entry.name);
          const targetPath = path.join(to, entry.name);
          const stat = await safeLstat(sourcePath, entry.name);
          if (!stat.isDirectory() && !stat.isFile()) {
            throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Restore overlay contains an unsupported filesystem entry');
          }
          if (stat.isFile()) {
            files += 1;
            bytes += stat.size;
            if (files > limits.maxFiles || bytes > limits.maxBytes) {
              throw backupError('BACKUP_LIMIT_EXCEEDED', 413, 'Restore exceeds the safe file or byte limit');
            }
          }
          records.push({ path: sourcePath, destination: targetPath, stat });
        }

        if (typeof directoryGuard?.batch !== 'function' && typeof fileGuard?.batch !== 'function') {
          for (const record of records) {
            if (record.stat.isDirectory()) {
              await fs.mkdir(record.destination, { recursive: false, mode: record.stat.mode })
                .catch((error) => { if (error?.code !== 'EEXIST') throw error; });
              await walk(record.path, record.destination, depth + 1);
            } else {
              await copyRegularFile(record.path, record.destination, record.stat, fileGuard);
            }
          }
          return;
        }

        const directoryRecords = records.filter((record) => record.stat.isDirectory());
        const fileRecords = records.filter((record) => record.stat.isFile());
        if (typeof directoryGuard?.batch === 'function') {
          const pairBatchSize = Math.floor(MAX_GUARD_BATCH_ENTRIES / 2);
          for (let index = 0; index < directoryRecords.length; index += pairBatchSize) {
            const batch = directoryRecords.slice(index, index + pairBatchSize);
            for (const record of batch) {
              await fs.mkdir(record.destination, { recursive: false, mode: record.stat.mode })
                .catch((error) => { if (error?.code !== 'EEXIST') throw error; });
              record.destinationStat = await safeLstat(record.destination);
              if (!record.destinationStat.isDirectory()) {
                throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Restore destination contains an unsupported filesystem entry');
              }
            }
            const guarded = batch.flatMap((record) => [
              { path: record.path, stat: record.stat },
              { path: record.destination, stat: record.destinationStat },
            ]);
            let guards = null;
            try {
              guards = await acquireVerifiedDirectoryGuardBatch(guarded, directoryGuard, 'Restore merge sibling directory set');
              for (let offset = 0; offset < batch.length; offset += 1) {
                await walk(batch[offset].path, batch[offset].destination, depth + 1, guards[offset * 2], guards[(offset * 2) + 1]);
              }
            } finally { await releaseGuards(...(guards ?? []).reverse()); }
          }
        } else {
          for (const record of directoryRecords) {
            await fs.mkdir(record.destination, { recursive: false, mode: record.stat.mode })
              .catch((error) => { if (error?.code !== 'EEXIST') throw error; });
            await walk(record.path, record.destination, depth + 1);
          }
        }
        if (typeof fileGuard?.batch === 'function') {
          for (const batch of guardBatches(fileRecords)) await copyRegularFileBatch(batch, fileGuard);
        } else {
          for (const record of fileRecords) {
            await copyRegularFile(record.path, record.destination, record.stat, fileGuard);
          }
        }
      } finally { await releaseGuards(heldTo ? null : toGuard, heldFrom ? null : fromGuard); }
    };
    await walk(source, destination, 0, sourceGuard, destinationGuard);
    await filesystemTreeVerifier(source, { maxEntries: limits.maxFiles, maxDepth: limits.maxDepth });
    await filesystemTreeVerifier(destination, { maxEntries: limits.maxFiles, maxDepth: limits.maxDepth });
    await assertGuardChainHeld(ancestorChain, filesystemTreeVerifier);
  } finally {
    await releaseGuards(
      ...ancestorChain.map((entry) => entry.guard).reverse(),
    );
  }
}

async function clearMutableTree(
  root,
  policy,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = defaultFileGuard,
  boundary = root,
) {
  const binding = await acquireMutableDirectoryBinding(
    boundary, root, 'Restore mutable tree', directoryGuard, filesystemTreeVerifier,
  );
  const rootParentGuard = binding.leafGuard;
  try {
  await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
  await filesystemTreeVerifier(root, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
  const walk = async (directory, prefix, heldParentGuard, expectedDirectoryStat) => {
    heldParentGuard.assertHeld?.();
    const current = await fs.lstat(directory);
    if (!sameDirectoryIdentity(expectedDirectoryStat, current)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore directory changed during cleanup');
    }
    const children = await safeDirectoryEntries(directory);
    if (typeof directoryGuard?.batch !== 'function' && typeof fileGuard?.batch !== 'function') {
      for (const entry of children) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const target = path.join(directory, entry.name);
        const before = await safeLstat(target, relative);
        const top = relative.split('/')[0];
        if (PRESERVE_TOP_LEVEL.has(top) || policy.managedFiles.has(relative)) continue;
        if (entry.isDirectory()) {
          const childGuard = await directoryGuard(target);
          try {
            childGuard.assertHeld?.();
            if (!sameDirectoryIdentity(before, await fs.lstat(target))) {
              throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore directory changed while its exact guard was acquired');
            }
            await walk(target, relative, childGuard, before);
          } finally { await childGuard.release(); }
          if (!await directoryIsEmpty(target)) continue;
          const checked = await safeLstat(target, relative);
          if (!sameDirectoryIdentity(before, checked)) throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore directory changed before cleanup');
          const tombstone = await tombstoneManagedEntry(
            directory, target, checked, '.clear-directory', null, directoryGuard, fileGuard,
          );
          const tombstoneGuard = await directoryGuard(tombstone);
          tombstoneGuard.assertHeld?.();
          await tombstoneGuard.delete();
        } else {
          const tombstone = await tombstoneManagedEntry(
            directory, target, before, '.clear-file', null, directoryGuard, fileGuard,
          );
          await deleteGuardedFile(tombstone, fileGuard);
        }
      }
    } else {
      const records = [];
      for (const entry of children) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const target = path.join(directory, entry.name);
        const before = await safeLstat(target, relative);
        const top = relative.split('/')[0];
        if (PRESERVE_TOP_LEVEL.has(top) || policy.managedFiles.has(relative)) continue;
        if (!before.isDirectory() && !before.isFile()) {
          throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Restore cleanup contains an unsupported filesystem entry');
        }
        records.push({ path: target, stat: before, relative });
      }
      const directories = records.filter((record) => record.stat.isDirectory());
      const regularFiles = records.filter((record) => record.stat.isFile());

      if (typeof directoryGuard?.batch === 'function') {
        for (const batch of guardBatches(directories)) {
          let guards = null;
          const tombstones = [];
          try {
            guards = await acquireVerifiedDirectoryGuardBatch(batch, directoryGuard, 'Restore cleanup sibling directory set');
            for (let index = 0; index < batch.length; index += 1) {
              const record = batch[index];
              await walk(record.path, record.relative, guards[index], record.stat);
              if (!await directoryIsEmpty(record.path)) continue;
              const checked = await safeLstat(record.path, record.relative);
              if (!sameDirectoryIdentity(record.stat, checked)) {
                throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore directory changed before cleanup');
              }
              const tombstone = await tombstoneManagedEntryWithGuard(
                directory, record.path, checked, '.clear-directory', null, guards[index],
              );
              guards[index] = null;
              await assertTombstoneIdentity(tombstone, checked);
              tombstones.push({ path: tombstone, stat: checked });
            }
          } finally { await releaseGuards(...(guards ?? []).filter(Boolean).reverse()); }
          if (tombstones.length > 0) {
            let tombstoneGuards = null;
            try {
              tombstoneGuards = await acquireVerifiedDirectoryGuardBatch(
                tombstones, directoryGuard, 'Restore cleanup tombstone directory set',
              );
              for (let index = 0; index < tombstoneGuards.length; index += 1) {
                await tombstoneGuards[index].delete();
                tombstoneGuards[index] = null;
              }
            } finally { await releaseGuards(...(tombstoneGuards ?? []).filter(Boolean).reverse()); }
          }
        }
      } else {
        for (const record of directories) {
          const childGuard = await directoryGuard(record.path);
          try {
            childGuard.assertHeld?.();
            if (!sameDirectoryIdentity(record.stat, await fs.lstat(record.path))) {
              throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore directory changed while its exact guard was acquired');
            }
            await walk(record.path, record.relative, childGuard, record.stat);
          } finally { await childGuard.release(); }
          if (!await directoryIsEmpty(record.path)) continue;
          const checked = await safeLstat(record.path, record.relative);
          const tombstone = await tombstoneManagedEntry(
            directory, record.path, checked, '.clear-directory', null, directoryGuard, fileGuard,
          );
          const tombstoneGuard = await directoryGuard(tombstone);
          tombstoneGuard.assertHeld?.();
          await tombstoneGuard.delete();
        }
      }

      if (typeof fileGuard?.batch === 'function') {
        for (const batch of guardBatches(regularFiles)) {
          let guards = null;
          const tombstones = [];
          try {
            guards = await acquireVerifiedFileGuardBatch(batch, fileGuard, 'Restore cleanup sibling file set');
            for (let index = 0; index < batch.length; index += 1) {
              const tombstone = await tombstoneManagedEntryWithGuard(
                directory, batch[index].path, batch[index].stat, '.clear-file', null, guards[index],
              );
              guards[index] = null;
              await assertTombstoneIdentity(tombstone, batch[index].stat);
              tombstones.push({ path: tombstone, stat: batch[index].stat });
            }
          } finally { await releaseGuards(...(guards ?? []).filter(Boolean).reverse()); }
          if (tombstones.length > 0) {
            let tombstoneGuards = null;
            try {
              tombstoneGuards = await acquireVerifiedFileGuardBatch(
                tombstones, fileGuard, 'Restore cleanup tombstone file set',
              );
              for (let index = 0; index < tombstoneGuards.length; index += 1) {
                await tombstoneGuards[index].delete();
                tombstoneGuards[index] = null;
              }
            } finally { await releaseGuards(...(tombstoneGuards ?? []).filter(Boolean).reverse()); }
          }
        }
      } else {
        for (const record of regularFiles) {
          const tombstone = await tombstoneManagedEntry(
            directory, record.path, record.stat, '.clear-file', null, directoryGuard, fileGuard,
          );
          await deleteGuardedFile(tombstone, fileGuard);
        }
      }
    }
    heldParentGuard.assertHeld?.();
    if (!sameDirectoryIdentity(expectedDirectoryStat, await fs.lstat(directory))) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore directory changed after cleanup');
    }
  };
  await walk(root, '', rootParentGuard, binding.stat);
    await filesystemTreeVerifier(root, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
  } finally { await releaseMutableDirectoryBinding(binding); }
}

async function tombstoneManagedEntry(
  parent,
  target,
  expectedStat,
  prefix,
  exactName = null,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = defaultFileGuard,
  beforeTerminal = null,
) {
  if (beforeTerminal !== null && typeof beforeTerminal !== 'function') {
    throw new TypeError('Managed cleanup terminal callback must be a function');
  }
  const guardFactory = expectedStat.isDirectory() ? directoryGuard : fileGuard;
  let guard;
  if (typeof guardFactory?.batch === 'function') {
    if (expectedStat.isDirectory()) {
      [guard] = await acquireVerifiedDirectoryGuardBatch(
        [{ path: target, stat: expectedStat }], directoryGuard, 'Managed cleanup target',
      );
    } else {
      [guard] = await acquireVerifiedFileGuardBatch(
        [{ path: target, stat: expectedStat }], fileGuard, 'Managed cleanup target',
      );
    }
  } else {
    guard = await guardFactory(target);
  }
  try {
    const tombstone = await tombstoneManagedEntryWithGuard(
      parent, target, expectedStat, prefix, exactName, guard, beforeTerminal,
    );
    guard = null;
    await assertTombstoneIdentity(tombstone, expectedStat);
    return tombstone;
  } finally { await releaseGuards(guard); }
}

async function tombstoneManagedEntryWithGuard(
  parent,
  target,
  expectedStat,
  prefix,
  exactName,
  guard,
  beforeTerminal = null,
) {
  if (path.dirname(target) !== parent || !safeName(path.basename(target))) {
    throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Managed cleanup target escaped its verified parent');
  }
  const name = exactName ?? `${prefix}-${crypto.randomBytes(16).toString('hex')}`;
  if (!safeName(name)) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Generated cleanup storage has an unsafe name');
  const tombstone = path.join(parent, name);
  if (await exists(tombstone)) throw backupError('BACKUP_ID_COLLISION', 409, 'Generated cleanup storage is already occupied');
  guard.assertHeld?.();
  const held = await fs.lstat(target);
  const heldSame = expectedStat.isDirectory() ? sameDirectoryIdentity(expectedStat, held) : sameFileIdentity(expectedStat, held);
  if (!heldSame || typeof guard.rename !== 'function') {
    throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A managed cleanup target changed before tombstoning');
  }
  if (beforeTerminal !== null) {
    if (typeof beforeTerminal !== 'function') throw new TypeError('Managed cleanup terminal callback must be a function');
    await beforeTerminal();
    guard.assertHeld?.();
    const rechecked = await fs.lstat(target);
    const recheckedSame = expectedStat.isDirectory()
      ? sameDirectoryIdentity(expectedStat, rechecked)
      : sameFileIdentity(expectedStat, rechecked);
    if (!recheckedSame) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A managed cleanup target changed during terminal revalidation');
    }
  }
  await guard.rename(tombstone);
  return tombstone;
}

async function assertTombstoneIdentity(tombstone, expectedStat) {
  const moved = await safeLstat(tombstone);
  const same = expectedStat.isDirectory() ? sameDirectoryIdentity(expectedStat, moved) : sameFileIdentity(expectedStat, moved);
  if (!same) throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A managed cleanup target changed during tombstoning');
}

async function moveManagedDirectory(
  source,
  destination,
  parent,
  directoryGuard = acquireWindowsDirectoryGuard,
  boundary = parent,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  { beforeTerminal = null, maxParentEntries = MAX_FILES } = {},
) {
  if (beforeTerminal !== null && typeof beforeTerminal !== 'function') {
    throw new TypeError('Restore publication terminal callback must be a function');
  }
  if (!Number.isInteger(maxParentEntries) || maxParentEntries < 1 || maxParentEntries > MAX_FILES) {
    throw new TypeError('Restore publication parent entry limit is invalid');
  }
  const resolvedParent = path.resolve(parent);
  const resolvedSource = path.resolve(source);
  const resolvedDestination = path.resolve(destination);
  if (path.dirname(resolvedSource) !== resolvedParent || path.dirname(resolvedDestination) !== resolvedParent
    || !safeName(path.basename(resolvedSource)) || !safeName(path.basename(resolvedDestination))
    || resolvedSource === resolvedDestination) {
    throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'A restore publication move escaped its verified parent');
  }
  const binding = await acquireMutableDirectoryBinding(
    boundary, resolvedParent, 'Restore publication parent', directoryGuard, filesystemTreeVerifier,
  );
  let sourceGuard = null;
  let destinationGuard = null;
  try {
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
    const namespaceBefore = await stableExactDirectoryNamespace(resolvedParent, maxParentEntries);
    const before = await fs.lstat(resolvedSource);
    const beforeExact = await fs.lstat(resolvedSource, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'A restore publication source is not a regular directory');
    }
    if (!sameExactDirectoryIdentity(beforeExact, beforeExact)) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'A restore publication source has no exact directory identity');
    }
    if (await exists(resolvedDestination)) {
      throw backupError('BACKUP_ID_COLLISION', 409, 'A restore publication destination is already occupied');
    }
    if (typeof directoryGuard?.batch === 'function') {
      [sourceGuard] = await acquireVerifiedDirectoryGuardBatch(
        [{ path: resolvedSource, stat: before }], directoryGuard, 'Restore publication source',
      );
    } else {
      sourceGuard = await directoryGuard(resolvedSource);
    }
    sourceGuard.assertHeld?.();
    const held = await fs.lstat(resolvedSource);
    const heldExact = await fs.lstat(resolvedSource, { bigint: true });
    const sourceNativeIdentity = typeof sourceGuard.identity === 'string' ? sourceGuard.identity : null;
    if (!sameDirectoryIdentity(before, held) || !sameExactDirectoryIdentity(beforeExact, heldExact)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore publication source changed before its move');
    }
    if (typeof sourceGuard.rename !== 'function') {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'The exact restore publication move boundary is unavailable');
    }
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
    const terminalNamespace = await stableExactDirectoryNamespace(resolvedParent, maxParentEntries);
    if (!sameExactNamespace(namespaceBefore, terminalNamespace)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore publication namespace changed before its terminal move');
    }
    if (beforeTerminal) await beforeTerminal(terminalNamespace);
    sourceGuard.assertHeld?.();
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
    const rechecked = await fs.lstat(resolvedSource);
    const recheckedExact = await fs.lstat(resolvedSource, { bigint: true });
    if (!sameDirectoryIdentity(before, rechecked)
      || !sameExactDirectoryIdentity(beforeExact, recheckedExact)
      || (sourceNativeIdentity !== null && sourceGuard.identity !== sourceNativeIdentity)
      || !sameExactNamespace(
        namespaceBefore, await stableExactDirectoryNamespace(resolvedParent, maxParentEntries),
      )) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore publication source changed during terminal revalidation');
    }

    const releasedLeafGuard = binding.leafGuard;
    let leafReleased = false;
    let publicationError = null;
    let rebindError = null;
    try {
      releasedLeafGuard?.assertHeld?.();
      if (!releasedLeafGuard || typeof releasedLeafGuard.release !== 'function') {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'The restore publication parent leaf cannot be released safely');
      }
      await releasedLeafGuard.release();
      binding.leafGuard = null;
      leafReleased = true;
      await sourceGuard.rename(resolvedDestination);
      sourceGuard = null;
    } catch (error) {
      publicationError = error;
    } finally {
      if (leafReleased) {
        try { await reacquireMutableDirectoryLeaf(binding, directoryGuard, filesystemTreeVerifier); }
        catch (error) { rebindError = error; }
      }
    }
    if (rebindError) throw rebindError;
    if (publicationError) throw publicationError;
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
    const moved = await fs.lstat(resolvedDestination);
    const movedExact = await fs.lstat(resolvedDestination, { bigint: true });
    if (!sameDirectoryIdentity(before, moved) || !sameExactDirectoryIdentity(beforeExact, movedExact)
      || await exists(resolvedSource)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore publication move did not preserve the verified source identity');
    }
    if (typeof directoryGuard?.batch === 'function') {
      [destinationGuard] = await acquireVerifiedDirectoryGuardBatch(
        [{ path: resolvedDestination, stat: moved }], directoryGuard, 'Restore publication destination',
      );
    } else {
      destinationGuard = await directoryGuard(resolvedDestination);
    }
    destinationGuard.assertHeld?.();
    const published = await fs.lstat(resolvedDestination);
    const publishedExact = await fs.lstat(resolvedDestination, { bigint: true });
    if (!sameDirectoryIdentity(before, published)
      || !sameExactDirectoryIdentity(beforeExact, publishedExact)
      || (sourceNativeIdentity !== null && destinationGuard.identity !== sourceNativeIdentity)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore publication destination changed after its move');
    }
    const expectedNamespace = expectedExactNamespaceAfterRename(
      namespaceBefore, path.basename(resolvedSource), path.basename(resolvedDestination),
    );
    if (!sameExactNamespace(
      expectedNamespace, await stableExactDirectoryNamespace(resolvedParent, maxParentEntries),
    )) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A restore publication changed an unexpected namespace entry');
    }
    await filesystemTreeVerifier(resolvedDestination, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
  } finally {
    let failure = null;
    try { await releaseGuards(destinationGuard, sourceGuard); } catch (error) { failure = error; }
    try { await releaseMutableDirectoryBinding(binding); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  }
}

function sameDirectoryIdentity(left, right) {
  return left?.isDirectory?.() === true && right?.isDirectory?.() === true
    && (!left.ino || !right.ino || (left.dev === right.dev && left.ino === right.ino));
}

function sameExactDirectoryIdentity(left, right) {
  return left?.isDirectory?.() === true && right?.isDirectory?.() === true
    && left.isSymbolicLink() === false && right.isSymbolicLink() === false
    && typeof left.dev === 'bigint' && typeof right.dev === 'bigint'
    && typeof left.ino === 'bigint' && typeof right.ino === 'bigint'
    && left.ino !== 0n && right.ino !== 0n && left.dev === right.dev && left.ino === right.ino;
}

async function safeDirectoryEntries(directory, options = {}) {
  const maxEntries = options.maxEntries ?? MAX_FILES;
  if (!Number.isInteger(maxEntries) || maxEntries < 0 || maxEntries > MAX_FILES) {
    throw new TypeError('A valid bounded directory entry limit is required');
  }
  const limitError = options.limitError ?? (() => backupError(
    'BACKUP_LIMIT_EXCEEDED', 413, 'Managed server state exceeds its safe directory entry limit',
  ));
  if (typeof limitError !== 'function') throw new TypeError('A directory entry limit error factory is required');
  const entries = [];
  const names = new Set();
  const handle = await fs.opendir(directory);
  let failure = null;
  try {
    while (true) {
      const entry = await handle.read();
      if (entry === null) break;
      if (entries.length >= maxEntries) throw limitError();
      if (!safeName(entry.name)) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Managed server state contains an unsafe filename');
      const folded = entry.name.toLocaleLowerCase('en-US');
      if (names.has(folded)) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Managed server state contains a case-colliding filename');
      names.add(folded);
      entries.push(entry);
    }
  } catch (error) { failure = error; }
  try { await handle.close(); } catch (error) { if (error?.code !== 'ERR_DIR_CLOSED') failure ??= error; }
  if (failure) throw failure;
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  return entries;
}

async function directoryIsEmpty(directory) {
  const handle = await fs.opendir(directory);
  let entry;
  let failure = null;
  try { entry = await handle.read(); } catch (error) { failure = error; }
  try { await handle.close(); } catch (error) { if (error?.code !== 'ERR_DIR_CLOSED') failure ??= error; }
  if (failure) throw failure;
  return entry === null;
}

async function safeLstat(target) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Managed server state contains a symbolic link');
  if (stat.isFile() && Number.isInteger(stat.nlink) && stat.nlink > 1) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Managed server state contains a hard-linked file');
  return stat;
}

async function assertRegularDirectory(target, parent, label, options = {}) {
  const resolved = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  const relative = path.relative(resolvedParent, resolved);
  if ((!options.allowEqual && !relative) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} escaped its managed boundary`);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} is not a regular directory`);
  const [realTarget, realParent] = await Promise.all([fs.realpath(resolved), fs.realpath(resolvedParent)]);
  const realRelative = path.relative(realParent, realTarget);
  if ((!options.allowEqual && !realRelative) || realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} escaped its canonical managed boundary`);
}

async function assertAnchoredDirectory(boundary, target, label, options = {}) {
  const root = path.resolve(boundary);
  const resolved = path.resolve(target);
  await assertRegularDirectory(root, path.dirname(root), `${label} boundary`, { allowEqual: true });
  const relative = path.relative(root, resolved);
  if ((!options.allowEqual && !relative) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} escaped its managed boundary`);
  }
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} crosses a linked directory`);
  }
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(resolved)]);
  const canonical = path.relative(realRoot, realTarget);
  if ((!options.allowEqual && !canonical) || canonical === '..' || canonical.startsWith(`..${path.sep}`) || path.isAbsolute(canonical)) {
    throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} escaped its canonical managed boundary`);
  }
  return resolved;
}

async function ensureAnchoredDirectory(
  boundary,
  target,
  label,
  directoryGuard = acquireWindowsDirectoryGuard,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
) {
  const paths = managedGuardPaths(boundary, target);
  const chain = [];
  if (typeof directoryGuard?.batch === 'function') {
    try {
      let existingCount = 0;
      for (const directory of paths) {
        let stat;
        try { stat = await fs.lstat(directory); }
        catch (error) {
          if (error?.code === 'ENOENT' && existingCount > 0) break;
          throw error;
        }
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} crosses an unsafe directory`);
        }
        existingCount += 1;
      }
      if (existingCount < 1) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} boundary is unavailable`);
      chain.push(...await acquireAnchoredGuardChain(
        boundary, paths[existingCount - 1], label, directoryGuard, filesystemTreeVerifier,
      ));
      for (let index = existingCount; index < paths.length; index += 1) {
        await assertGuardChainHeld(chain, filesystemTreeVerifier);
        const parent = chain.at(-1);
        parent.guard.assertHeld?.();
        await fs.mkdir(paths[index], { recursive: false, mode: 0o700 });
        const created = await fs.lstat(paths[index]);
        if (!created.isDirectory() || created.isSymbolicLink()) {
          throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} created an unsafe directory`);
        }
        const [guard] = await acquireVerifiedDirectoryGuardBatch(
          [{ path: paths[index], stat: created }], directoryGuard, label,
        );
        chain.push({ path: paths[index], stat: created, guard });
        try { await filesystemTreeVerifier(paths[index], { maxEntries: 1, maxDepth: 0, recursive: false }); }
        catch { throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} contains unsafe filesystem metadata`); }
      }
      await assertGuardChainHeld(chain, filesystemTreeVerifier);
      const [realRoot, realTarget] = await Promise.all([
        fs.realpath(path.resolve(boundary)), fs.realpath(path.resolve(target)),
      ]);
      const relative = path.relative(realRoot, realTarget);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} escaped its canonical managed boundary`);
      }
      return path.resolve(target);
    } finally {
      await releaseGuards(...chain.map((entry) => entry.guard).reverse());
    }
  }
  try {
    for (const directory of paths) {
      await assertGuardChainHeld(chain);
      let before;
      try { before = await fs.lstat(directory); }
      catch (error) {
        if (error?.code !== 'ENOENT' || chain.length === 0) throw error;
        const parent = chain.at(-1);
        parent.guard.assertHeld?.();
        await fs.mkdir(directory, { recursive: false, mode: 0o700 });
        before = await fs.lstat(directory);
      }
      if (!before.isDirectory() || before.isSymbolicLink()) {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} crosses an unsafe directory`);
      }
      const guard = await directoryGuard(directory);
      guard.assertHeld?.();
      const after = await fs.lstat(directory);
      if (!sameDirectoryIdentity(before, after)) {
        throw backupError('BACKUP_SOURCE_CHANGED', 409, `${label} changed while it was guarded`);
      }
      try { await filesystemTreeVerifier(directory, { maxEntries: 1, maxDepth: 0, recursive: false }); }
      catch { throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} contains unsafe filesystem metadata`); }
      chain.push({ path: directory, stat: after, guard });
    }
    await assertGuardChainHeld(chain, filesystemTreeVerifier);
    const [realRoot, realTarget] = await Promise.all([fs.realpath(path.resolve(boundary)), fs.realpath(path.resolve(target))]);
    const relative = path.relative(realRoot, realTarget);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} escaped its canonical managed boundary`);
    }
    return path.resolve(target);
  } finally {
    await releaseGuards(...chain.map((entry) => entry.guard).reverse());
  }
}

async function removeManagedTree(
  target,
  parent,
  label,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  directoryGuard = acquireWindowsDirectoryGuard,
  tombstoneName = null,
  fileGuard = defaultFileGuard,
  boundary = parent,
  beforeTombstone = null,
) {
  if (typeof tombstoneName !== 'string' || !/^\.cleanup-cln-[a-f0-9]{32}$/.test(tombstoneName)) {
    throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Managed tree cleanup requires a deterministic authenticated tombstone');
  }
  const binding = await acquireMutableDirectoryBinding(
    boundary, parent, `${label} parent`, directoryGuard, filesystemTreeVerifier,
  );
  const parentAncestorGuard = binding.chain.at(-1).guard;
  let tombstone = null;
  try {
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
    const namespaceBefore = await directoryNamespace(parent);
    await assertRegularDirectory(target, parent, label);
    const before = await fs.lstat(target);
    tombstone = await tombstoneManagedEntry(
      parent, target, before, '.cleanup', tombstoneName, directoryGuard, fileGuard, beforeTombstone,
    );
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
    await deleteTombstonedTree(
      tombstone, parent, filesystemTreeVerifier, directoryGuard, fileGuard, parentAncestorGuard, binding.stat,
    );
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
    if (!sameNamespace(
      expectedNamespaceAfterRemove(namespaceBefore, path.basename(target)),
      await directoryNamespace(parent),
    )) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, `${label} cleanup changed an unexpected namespace entry`);
    }
  } finally { await releaseMutableDirectoryBinding(binding); }
}

async function deleteTombstonedTree(
  root,
  parent,
  filesystemTreeVerifier,
  directoryGuard,
  fileGuard,
  heldParentAncestorGuard,
  expectedParentStat,
) {
  const rootIdentity = await fs.lstat(root);
  let parentGuard = null;
  let rootGuard = null;
  try {
    if (!heldParentAncestorGuard) throw new TypeError('A verified parent ancestor guard is required');
    heldParentAncestorGuard.assertHeld?.();
    if (!sameDirectoryIdentity(expectedParentStat, await fs.lstat(parent))) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Managed cleanup parent changed before recursive deletion');
    }
    parentGuard = heldParentAncestorGuard;
    parentGuard.assertHeld?.();
    if (typeof directoryGuard?.batch === 'function') {
      [rootGuard] = await acquireVerifiedDirectoryGuardBatch(
        [{ path: root, stat: rootIdentity }], directoryGuard, 'Managed cleanup root',
      );
    } else {
      rootGuard = await directoryGuard(root);
    }
    rootGuard.assertHeld?.();
    if (!sameDirectoryIdentity(rootIdentity, await fs.lstat(root))) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Managed cleanup root changed before recursive deletion');
    }
    await filesystemTreeVerifier(root, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
    for (const entry of await safeDirectoryEntries(root)) {
      const target = path.join(root, entry.name);
      const before = await safeLstat(target);
      const tombstone = await tombstoneManagedEntry(
        root, target, before, entry.isDirectory() ? '.delete-directory' : '.delete-file', null, directoryGuard, fileGuard,
      );
      if (entry.isDirectory()) {
        await deleteTombstonedTree(
          tombstone, root, filesystemTreeVerifier, directoryGuard, fileGuard, parentGuard, rootIdentity,
        );
      } else {
        await deleteGuardedFile(tombstone, fileGuard);
      }
    }
    if (!await directoryIsEmpty(root)) throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Managed cleanup left unexpected entries');
    heldParentAncestorGuard.assertHeld?.();
    parentGuard.assertHeld?.();
    rootGuard.assertHeld?.();
    if (!sameDirectoryIdentity(expectedParentStat, await fs.lstat(parent))) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Managed cleanup parent changed before root deletion');
    }
    rootGuard.assertHeld?.();
    if (!sameDirectoryIdentity(rootIdentity, await fs.lstat(root))) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Managed cleanup root changed before deletion');
    }
    await rootGuard.delete();
    rootGuard = null;
  } finally { await releaseGuards(rootGuard); }
  heldParentAncestorGuard.assertHeld?.();
  if (!sameDirectoryIdentity(expectedParentStat, await fs.lstat(parent)) || await exists(root)) {
    throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Managed cleanup root deletion was not exact');
  }
}

async function deleteGuardedFile(file, fileGuard) {
  let guard;
  if (typeof fileGuard?.batch === 'function') {
    const stat = await safeLstat(file);
    [guard] = await acquireVerifiedFileGuardBatch([{ path: file, stat }], fileGuard, 'Managed cleanup file');
  } else {
    guard = await fileGuard(file);
  }
  guard.assertHeld?.();
  await guard.delete();
}

async function levelNameFromProperties(instanceRoot) {
  let text = '';
  try { text = await fs.readFile(path.join(instanceRoot, 'server.properties'), 'utf8'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  let levelName = 'world';
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*[#!]/.test(line)) continue;
    const index = line.indexOf('=');
    if (index >= 0 && line.slice(0, index).trim() === 'level-name') levelName = line.slice(index + 1).trim() || 'world';
  }
  normalizeRelative(levelName);
  return levelName.replaceAll('\\', '/');
}

function normalizeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Managed state contains an unsafe relative path');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => !safeName(part) || part === '.' || part === '..')) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Managed state contains an unsafe relative path');
  return normalized;
}

function safeName(value) {
  return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..'
    && !/[\0\x00-\x1f\x7f<>:"|?*]/.test(value) && !/[. ]$/.test(value)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(value);
}

async function hashFile(file, fileGuard = defaultFileGuard) {
  const guard = await fileGuard(file);
  let failure = null;
  let digest;
  try { digest = await hashFileWithHeldGuard(file, await safeLstat(file), guard); }
  catch (error) { failure = error; }
  try { await releaseGuards(guard); } catch (error) { failure ??= error; }
  if (failure) throw failure;
  return digest;
}

async function hashFileWithHeldGuard(file, expectedStat, guard) {
  const hash = crypto.createHash('sha256');
  let handle = null;
  try {
    guard.assertHeld?.();
    const namedBefore = await fs.lstat(file);
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1) {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Managed server state contains an unsafe file');
    }
    if (!sameFileIdentity(expectedStat, namedBefore)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A backup source file changed before hashing');
    }
    handle = await fs.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!sameFileIdentity(namedBefore, opened)) throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A backup source file changed before hashing');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (!bytesRead) throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A backup source file was truncated while hashing');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const openedAfter = await handle.stat();
    const namedAfter = await fs.lstat(file);
    if (!sameFileIdentity(opened, openedAfter) || !sameFileIdentity(opened, namedAfter)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A backup source file changed while hashing');
    }
  } finally {
    if (handle) await handle.close();
  }
  return hash.digest('hex');
}

async function copyRegularFile(source, destination, expectedStat, fileGuard) {
  const inputGuard = await fileGuard(source);
  let outputGuard = null;
  let copied;
  let failure = null;
  try {
    copied = await copyRegularFileWithHeldSource(source, destination, expectedStat, inputGuard);
    outputGuard = await fileGuard(destination);
    outputGuard.assertHeld?.();
    if (!sameFileIdentity(copied, await fs.lstat(destination))) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A backup destination changed while its verified identity was rebound');
    }
  } catch (error) { failure = error; }
  try { await releaseGuards(outputGuard, inputGuard); } catch (error) { failure ??= error; }
  if (failure) throw failure;
}

async function copyRegularFileBatch(records, fileGuard) {
  const sourceRecords = records.map((record) => ({ path: record.path, stat: record.stat }));
  let sourceGuards = null;
  let destinationGuards = null;
  try {
    sourceGuards = await acquireVerifiedFileGuardBatch(sourceRecords, fileGuard, 'Backup copy sibling source set');
    const destinationRecords = [];
    for (let index = 0; index < records.length; index += 1) {
      const copied = await copyRegularFileWithHeldSource(
        records[index].path, records[index].destination, records[index].stat, sourceGuards[index],
      );
      destinationRecords.push({ path: records[index].destination, stat: copied });
    }
    destinationGuards = await acquireVerifiedFileGuardBatch(
      destinationRecords, fileGuard, 'Backup copy sibling destination set',
    );
  } finally {
    await releaseGuards(...(destinationGuards ?? []).reverse(), ...(sourceGuards ?? []).reverse());
  }
}

async function copyRegularFileWithHeldSource(source, destination, expectedStat, inputGuard) {
  inputGuard.assertHeld?.();
  let input = null;
  let output = null;
  let failure = null;
  let copied = null;
  try {
    input = await fs.open(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = await input.stat();
    if (!sameFileIdentity(expectedStat, opened)) throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A backup source file changed before copying');
    output = await fs.open(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, expectedStat.mode);
    if (!sameFileIdentity(await output.stat(), await fs.lstat(destination))) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A backup destination changed before copying');
    }
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (!bytesRead) throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A backup source file was truncated while copying');
      let offset = 0;
      while (offset < bytesRead) {
        const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset, position + offset);
        if (!bytesWritten) throw backupError('BACKUP_STORAGE_FAILED', 507, 'A backup destination file could not be written completely');
        offset += bytesWritten;
      }
      position += bytesRead;
    }
    await output.chmod(expectedStat.mode);
    await output.sync();
    const [openedAfter, namedAfter, copiedStat, namedDestination] = await Promise.all([
      input.stat(), fs.lstat(source), output.stat(), fs.lstat(destination),
    ]);
    if (!sameFileIdentity(opened, openedAfter) || !sameFileIdentity(opened, namedAfter)
      || !copiedStat.isFile() || copiedStat.nlink !== 1 || copiedStat.size !== opened.size
      || !sameFileIdentity(copiedStat, namedDestination)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'A backup source or destination file changed while copying');
    }
    copied = copiedStat;
    await output.close();
    output = null;
  } catch (error) {
    failure = error;
  }
  let closeError = null;
  for (const handle of [output, input]) {
    if (!handle) continue;
    try { await handle.close(); } catch (error) { closeError ??= error; }
  }
  if (closeError) throw closeError;
  if (failure) throw failure;
  return copied;
}

function sameFileIdentity(left, right) {
  return left?.isFile?.() === true && right?.isFile?.() === true && left.nlink === 1 && right.nlink === 1
    && left.size === right.size && left.mtimeMs === right.mtimeMs
    && (!left.ino || !right.ino || (left.dev === right.dev && left.ino === right.ino));
}

function sameExactFileIdentity(left, right) {
  return left?.isFile?.() === true && right?.isFile?.() === true
    && left.isSymbolicLink() === false && right.isSymbolicLink() === false
    && left.nlink === 1n && right.nlink === 1n
    && typeof left.dev === 'bigint' && typeof right.dev === 'bigint'
    && typeof left.ino === 'bigint' && typeof right.ino === 'bigint'
    && left.ino !== 0n && right.ino !== 0n && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeNs === right.mtimeNs;
}

async function readSmallJson(file, maximumBytes, label) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumBytes) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, `${label} is not a safe regular file`);
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { throw backupError('BACKUP_MANIFEST_INVALID', 409, `${label} is not valid JSON`); }
}

async function readSmallJsonGuardedBatch(records, maximumBytes, label, fileGuard, options = {}) {
  const values = [];
  if (typeof fileGuard?.batch !== 'function') {
    for (const record of records) {
      values.push(await readSmallJsonGuarded(record.path, maximumBytes, label, fileGuard, options));
    }
    return values;
  }
  for (const batch of guardBatches(records)) {
    let guards = null;
    try {
      guards = await acquireVerifiedFileGuardBatch(batch, fileGuard, `${label} sibling set`);
      for (let index = 0; index < batch.length; index += 1) {
        values.push(await readSmallJsonGuarded(batch[index].path, maximumBytes, label, fileGuard, {
          ...options,
          guard: guards[index],
        }));
      }
    } finally { await releaseGuards(...(guards ?? []).reverse()); }
  }
  return values;
}

async function readSmallJsonGuardedBatchSettled(records, maximumBytes, label, fileGuard, options = {}) {
  const results = [];
  if (typeof fileGuard?.batch !== 'function') {
    for (const record of records) {
      try {
        results.push({ value: await readSmallJsonGuarded(record.path, maximumBytes, label, fileGuard, options) });
      } catch (error) { results.push({ error }); }
    }
    return results;
  }
  for (const batch of guardBatches(records)) {
    const resultOffset = results.length;
    let guards = null;
    let batchError = null;
    try {
      guards = await acquireVerifiedFileGuardBatch(batch, fileGuard, `${label} sibling set`);
      for (let index = 0; index < batch.length; index += 1) {
        try {
          results.push({ value: await readSmallJsonGuarded(batch[index].path, maximumBytes, label, fileGuard, {
            ...options,
            guard: guards[index],
          }) });
        } catch (error) { results.push({ error }); }
      }
    } catch (error) {
      batchError = error;
    }
    try { await releaseGuards(...(guards ?? []).reverse()); } catch (error) { batchError ??= error; }
    if (batchError) {
      results.splice(resultOffset, results.length - resultOffset, ...batch.map(() => ({ error: batchError })));
    }
  }
  return results;
}

async function readSmallJsonGuarded(file, maximumBytes, label, fileGuard, options = {}) {
  const suppliedGuard = options.guard ?? null;
  let guard = suppliedGuard;
  if (!guard && typeof fileGuard?.batch === 'function') {
    const expected = await safeLstat(file);
    [guard] = await acquireVerifiedFileGuardBatch([{ path: file, stat: expected }], fileGuard, label);
  } else if (!guard) {
    guard = await fileGuard(file);
  }
  try {
    guard.assertHeld?.();
    const namedBefore = await fs.lstat(file);
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1
      || namedBefore.size < 2 || namedBefore.size > maximumBytes) {
      throw backupError('BACKUP_RECOVERY_INVALID', 409, `${label} is not a safe regular file`);
    }
    const handle = await fs.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let bytes;
    let failure = null;
    try {
      const openedBefore = await handle.stat();
      bytes = await handle.readFile();
      const openedAfter = await handle.stat();
      const namedAfter = await fs.lstat(file);
      if (!sameFileIdentity(namedBefore, openedBefore) || !sameFileIdentity(openedBefore, openedAfter)
        || !sameFileIdentity(openedAfter, namedAfter) || bytes.length < 2 || bytes.length > maximumBytes) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, `${label} changed while it was read`);
      }
    } catch (error) { failure = error; }
    try { await handle.close(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
    try {
      const text = bytes.toString('utf8');
      const value = JSON.parse(text);
      if (options.requireCanonical === true && text !== `${JSON.stringify(value, null, 2)}\n`) {
        throw backupError('BACKUP_RECOVERY_INVALID', 409, `${label} is not in its canonical serialized form`);
      }
      return value;
    } catch (error) {
      if (error?.code === 'BACKUP_RECOVERY_INVALID') throw error;
      throw backupError('BACKUP_RECOVERY_INVALID', 409, `${label} is not valid JSON`);
    }
  } finally {
    if (!suppliedGuard) await releaseGuards(guard);
  }
}

async function writeJsonAtomic(
  file,
  value,
  boundary,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = defaultFileGuard,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  { maxParentEntries = MAX_FILES } = {},
) {
  if (typeof boundary !== 'string' || !path.isAbsolute(boundary)) throw new TypeError('A managed JSON boundary is required');
  if (!Number.isInteger(maxParentEntries) || maxParentEntries < 1 || maxParentEntries > MAX_FILES) {
    throw new TypeError('A valid private-state parent entry limit is required');
  }
  const parent = path.dirname(file);
  if (!safeName(path.basename(file))) throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'Private backup state has an unsafe filename');
  await ensureAnchoredDirectory(boundary, parent, 'Private backup state parent', directoryGuard, filesystemTreeVerifier);
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const binding = await acquireMutableDirectoryBinding(
    boundary, parent, 'Private backup state parent', directoryGuard, filesystemTreeVerifier,
  );
  const ownsBinding = true;
  let temporaryGuard = null;
  let publishedGuard = null;
  let temporaryStat = null;
  let temporaryExactStat = null;
  let bindingReadyForCleanup = true;
  try {
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
    const namespaceBefore = await stableExactDirectoryNamespace(parent, maxParentEntries);
    const handle = await fs.open(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    let failure = null;
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await handle.chmod(0o600);
      await handle.sync();
      temporaryStat = await handle.stat();
      temporaryExactStat = await handle.stat({ bigint: true });
      const named = await fs.lstat(temporary);
      const namedExact = await fs.lstat(temporary, { bigint: true });
      if (!sameFileIdentity(temporaryStat, named)
        || !sameExactFileIdentity(temporaryExactStat, namedExact)) {
        throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Private backup state changed while it was staged');
      }
    } catch (error) { failure = error; }
    try { await handle.close(); } catch (error) { failure ??= error; }
    if (failure) throw failure;

    if (typeof fileGuard?.batch === 'function') {
      [temporaryGuard] = await acquireVerifiedFileGuardBatch(
        [{ path: temporary, stat: temporaryStat }], fileGuard, 'Private backup staging file',
      );
    } else {
      temporaryGuard = await fileGuard(temporary);
    }
    temporaryGuard.assertHeld?.();
    const held = await fs.lstat(temporary);
    if (!sameFileIdentity(temporaryStat, held) || typeof temporaryGuard.replace !== 'function') {
      throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'The exact private-state publication boundary is unavailable');
    }
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
    if (!sameExactNamespace(
      expectedExactNamespaceAfterFileCreate(namespaceBefore, path.basename(temporary), temporaryExactStat),
      await stableExactDirectoryNamespace(parent, maxParentEntries),
    )) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Private backup staging changed an unexpected namespace entry');
    }

    const releasedLeafGuard = binding.leafGuard;
    let leafReleased = false;
    let publicationError = null;
    let rebindError = null;
    bindingReadyForCleanup = false;
    try {
      releasedLeafGuard?.assertHeld?.();
      if (!releasedLeafGuard || typeof releasedLeafGuard.release !== 'function') {
        throw backupError('BACKUP_UNSAFE_FILESYSTEM', 409, 'The private-state parent leaf guard cannot be released safely');
      }
      await releasedLeafGuard.release();
      binding.leafGuard = null;
      leafReleased = true;
      await temporaryGuard.replace(file);
      temporaryGuard = null;
    } catch (error) {
      publicationError = error;
    } finally {
      if (leafReleased) {
        try {
          await reacquireMutableDirectoryLeaf(binding, directoryGuard, filesystemTreeVerifier);
          bindingReadyForCleanup = true;
        } catch (error) { rebindError = error; }
      }
    }
    if (rebindError) throw rebindError;
    if (publicationError) throw publicationError;
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
    const published = await fs.lstat(file);
    const publishedExact = await fs.lstat(file, { bigint: true });
    if (!sameFileIdentity(temporaryStat, published)
      || !sameExactFileIdentity(temporaryExactStat, publishedExact) || await exists(temporary)) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Private backup state publication did not preserve its verified identity');
    }
    if (typeof fileGuard?.batch === 'function') {
      [publishedGuard] = await acquireVerifiedFileGuardBatch(
        [{ path: file, stat: published }], fileGuard, 'Published private backup state',
      );
    } else {
      publishedGuard = await fileGuard(file);
    }
    publishedGuard.assertHeld?.();
    if (!sameFileIdentity(temporaryStat, await fs.lstat(file))) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Private backup state changed while its published identity was rebound');
    }
    if (!sameExactNamespace(
      expectedExactNamespaceAfterReplace(namespaceBefore, path.basename(file), publishedExact),
      await stableExactDirectoryNamespace(parent, maxParentEntries),
    )) {
      throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Private backup state publication changed an unexpected namespace entry');
    }
    await assertMutableDirectoryBinding(binding, filesystemTreeVerifier);
  } catch (error) {
    let failure = error;
    if (bindingReadyForCleanup && await exists(temporary).catch(() => false)) {
      let cleanupGuard = temporaryGuard;
      temporaryGuard = null;
      try {
        const cleanupStat = await fs.lstat(temporary);
        if (cleanupGuard) {
          cleanupGuard.assertHeld?.();
        } else if (typeof fileGuard?.batch === 'function') {
          [cleanupGuard] = await acquireVerifiedFileGuardBatch(
            [{ path: temporary, stat: cleanupStat }], fileGuard, 'Private backup staging cleanup',
          );
        } else {
          cleanupGuard = await fileGuard(temporary);
        }
        cleanupGuard.assertHeld?.();
        const checked = await fs.lstat(temporary);
        if (temporaryStat && !sameFileIdentity(temporaryStat, checked)) {
          throw backupError('BACKUP_SOURCE_CHANGED', 409, 'Private backup staging changed before cleanup');
        }
        await cleanupGuard.delete();
        cleanupGuard = null;
      } catch (cleanupError) { failure = cleanupError; }
      finally { await releaseGuards(cleanupGuard); }
    }
    throw failure;
  } finally {
    let failure = null;
    try { await releaseGuards(publishedGuard, temporaryGuard); } catch (error) { failure = error; }
    if (ownsBinding) {
      try { await releaseMutableDirectoryBinding(binding); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function backupError(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

function sanitizePublicError(error) {
  if (error instanceof TypeError) return error;
  if (
    error && typeof error.code === 'string' && /^BACKUP_[A-Z0-9_]{3,56}$/.test(error.code)
    && Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
  ) return error;
  if (error?.code === 'INSTANCE_NOT_FOUND' && error?.statusCode === 404) {
    return backupError('INSTANCE_NOT_FOUND', 404, 'Instance was not found');
  }
  if (['ENOSPC', 'EDQUOT'].includes(error?.code)) {
    return backupError('BACKUP_STORAGE_FULL', 507, 'The local backup storage does not have enough available space');
  }
  const safe = backupError('BACKUP_STORAGE_FAILED', 500, 'The local backup operation failed safely');
  Object.defineProperty(safe, 'cause', { value: error, enumerable: false });
  return safe;
}

const SCHEDULER_ERROR_STAGES = new Set(['instance-list', 'policy-read', 'backup-list', 'scheduled-apply']);

function schedulerStageError(error, stage) {
  const safe = sanitizePublicError(error);
  if (SCHEDULER_ERROR_STAGES.has(stage)) {
    Object.defineProperty(safe, 'schedulerStage', { value: stage, enumerable: false, configurable: true });
  }
  return safe;
}

function isCorruptSnapshotError(error) {
  return [
    'BACKUP_INTEGRITY_FAILED', 'BACKUP_MANIFEST_INVALID', 'BACKUP_UNSAFE_FILESYSTEM',
    'BACKUP_RECOVERY_INVALID', 'ENOENT',
  ].includes(error?.code);
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(error.code) ? error.code : 'BACKUP_FAILED';
  return code;
}

async function exists(target) {
  try { await fs.lstat(target); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}
