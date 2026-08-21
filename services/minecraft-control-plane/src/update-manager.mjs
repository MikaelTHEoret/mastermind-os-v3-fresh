import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateInstanceId } from './config.mjs';
import { inspectVerifiedMinecraftServerJar, minecraftServerRelativePath } from './minecraft-server-version.mjs';
import {
  acquireWindowsDirectoryGuard,
  acquireWindowsFileGuard,
  assertWindowsFilesystemEntry,
  assertWindowsFilesystemTree,
  withHeldWindowsDirectoryGuards,
} from './windows-filesystem-safety.mjs';
import { createWindowsFilesystemSafetyBroker } from './backup-windows-safety-scope.mjs';
import { isAttestedLegacyUpdateTerminalMarker } from './legacy-update-terminal-attestation.mjs';

const ACTIVE_STATES = new Set(['starting', 'running', 'stopping']);
const UPDATE_LIFECYCLE_STAGES = new Set([
  'recovery-state', 'marker-inventory', 'marker-key', 'marker-authentication',
  'store-receipt', 'key-continuity',
]);
const TERMINAL_PHASES = new Set(['ready', 'rolled-back']);
const UPDATE_PHASES = new Set([
  'preparing', 'candidate-ready', 'original-backed-up', 'candidate-published', 'store-committed',
  'pending-readiness', 'readiness-observed', 'ready', 'rolling-back', 'rolled-back', 'rollback-failed',
]);
const UPDATE_MARKER_FIELDS = new Set([
  'schemaVersion', 'transactionId', 'instanceId', 'phase', 'updateKind', 'planId', 'createdAt', 'updatedAt',
  'originalRecord', 'target', 'levelName', 'worldBefore', 'mutableBefore', 'prepared', 'artifacts',
  'managedBefore',
  'legacyLaunchMigration',
  'legacyTerminalAttestation',
  'worldAfter', 'mutableAfter', 'targetRecord', 'commitError', 'readinessObservedAt', 'verifiedAt',
  'sourceDirectoryIdentity', 'rollbackOriginPhase', 'rollbackReason', 'rolledBackAt', 'rollbackError',
  'retiredCleanup', 'mac',
]);
const ROLLBACK_ORIGIN_PHASES = new Set([
  'preparing', 'candidate-ready', 'original-backed-up', 'candidate-published', 'store-committed',
  'pending-readiness', 'readiness-observed', 'ready',
]);
const RETIRED_CLEANUP_STATES = new Set(['preparing', 'staged', 'inventory-committed', 'purged']);
const LEGACY_LAUNCH_MIGRATION_STATES = new Set(['source-authenticated', 'pruning-authorized', 'candidate-pruned']);
const LEGACY_LAUNCH_ROOTS = Object.freeze(['.fabric', 'libraries', 'versions']);
const TRANSACTION_ID = /^[a-f0-9]{8}-[a-f0-9-]{27,72}$/i;
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._+\-]{0,95}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const MANAGED_ARTIFACTS = Object.freeze([
  'fabric-server-launch.jar',
  'mods/fabric-api.jar',
  'mods/geyser-fabric.jar',
  'mods/floodgate-fabric.jar',
  'config/Geyser-Fabric/config.yml',
]);
const ALWAYS_MANAGED_PATHS = new Set(['instance.json', ...MANAGED_ARTIFACTS]);
const PRIVATE_MANIFEST_MAX_BYTES = 1024 * 1024;
const MAX_UPDATE_TREE_ENTRIES = 500_000;
const MAX_UPDATE_TREE_BYTES = 80 * 1024 * 1024 * 1024;
const MAX_UPDATE_TREE_DEPTH = 64;
const MAX_UPDATE_MARKER_BYTES = 4 * 1024 * 1024;
const MAX_UPDATE_MARKERS = 4096;
const MAX_UPDATE_MARKER_AGGREGATE_BYTES = 64 * 1024 * 1024;
const MAX_UPDATE_GUARD_BATCH = 256;
const UPDATE_DELETE_SUFFIX = '.update-delete';
const DIRECTORY_GUARD_PATHS = new WeakMap();
const AUTHENTICATED_MUTATION_ROOT = new AsyncLocalStorage();

/**
 * Transactional updater for the one isolated Family Server project.
 *
 * The public input contains only an instance ID and an optional approval token.
 * Release metadata and candidate construction are trusted, injected local-service
 * dependencies; paths, URLs, and executables can never be supplied by a caller.
 */
export class FamilyServerUpdateManager {
  #queue = Promise.resolve();

  constructor(managedRoot, store, options = {}) {
    if (typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)) {
      throw new TypeError('managedRoot must be an absolute local-service path');
    }
    if (!store || typeof store.get !== 'function' || typeof store.update !== 'function' || typeof store.list !== 'function') {
      throw new TypeError('A compatible instance store is required');
    }
    if (typeof options.resolveTarget !== 'function') throw new TypeError('resolveTarget must be a trusted local-service function');
    if (typeof options.prepareCandidate !== 'function') throw new TypeError('prepareCandidate must be a trusted local-service function');
    if (typeof options.isInstanceActive !== 'function') throw new TypeError('isInstanceActive must share the process lifecycle boundary');
    if (typeof options.withInstanceLock !== 'function') throw new TypeError('withInstanceLock must share the process lifecycle boundary');
    if (typeof options.assertQuiescentWithinInstanceLock !== 'function') {
      throw new TypeError('assertQuiescentWithinInstanceLock must enforce the exact process and port boundary');
    }

    this.managedRoot = path.resolve(managedRoot);
    this.serverRoot = path.join(this.managedRoot, 'servers');
    this.backupRoot = path.join(this.managedRoot, 'backups');
    this.transactionRoot = path.join(this.managedRoot, 'state', 'update-transactions');
    this.markerKeyFile = path.join(this.managedRoot, 'state', 'update-transactions.hmac.key');
    this.runtimeRoot = path.join(this.managedRoot, 'runtimes');
    this.store = store;
    this.resolveTarget = options.resolveTarget;
    this.prepareCandidate = options.prepareCandidate;
    this.isInstanceActive = options.isInstanceActive;
    this.withInstanceLock = options.withInstanceLock;
    this.assertQuiescentWithinInstanceLock = options.assertQuiescentWithinInstanceLock;
    this.assertStackUpdateAllowedWithinInstanceLock = options.assertStackUpdateAllowedWithinInstanceLock;
    if (typeof this.assertStackUpdateAllowedWithinInstanceLock !== 'function') throw new TypeError('assertStackUpdateAllowedWithinInstanceLock is required');
    this.now = options.now ?? (() => new Date().toISOString());
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
    this.randomBytes = options.randomBytes ?? crypto.randomBytes;
    this.onPhase = options.onPhase ?? (() => undefined);
    this.nativeFilesystemGuards = options.nativeFilesystemGuards ?? true;
    if (typeof this.nativeFilesystemGuards !== 'boolean') throw new TypeError('nativeFilesystemGuards must be a boolean');
    const explicitlyInjectedGuard = options.directoryGuard !== undefined || options.fileGuard !== undefined;
    const useDefaultNativeBroker = this.nativeFilesystemGuards && !explicitlyInjectedGuard;
    this.filesystemSafetyBroker = null;
    if (useDefaultNativeBroker) {
      const broker = options.filesystemSafetyBroker ?? createWindowsFilesystemSafetyBroker();
      if (!broker || typeof broker.runOperation !== 'function'
        || typeof broker.directoryGuard !== 'function' || typeof broker.fileGuard !== 'function'
        || typeof broker.filesystemTreeVerifier !== 'function') {
        throw new TypeError('filesystemSafetyBroker must provide the Windows safety broker interface');
      }
      this.filesystemSafetyBroker = broker;
      this.directoryGuard = broker.directoryGuard;
      this.fileGuard = broker.fileGuard;
      this.filesystemTreeVerifier = options.filesystemTreeVerifier ?? broker.filesystemTreeVerifier;
      this.filesystemEntryVerifier = options.filesystemEntryVerifier ?? ((target) => (
        broker.filesystemTreeVerifier(target, { maxEntries: 1, maxDepth: 0, recursive: false })
      ));
    } else {
      if (options.filesystemSafetyBroker !== undefined) {
        throw new TypeError('filesystemSafetyBroker requires the default native guard dependencies');
      }
      this.directoryGuard = options.directoryGuard ?? acquireWindowsDirectoryGuard;
      this.fileGuard = options.fileGuard ?? acquireWindowsFileGuard;
      this.filesystemTreeVerifier = options.filesystemTreeVerifier ?? assertWindowsFilesystemTree;
      this.filesystemEntryVerifier = options.filesystemEntryVerifier ?? assertWindowsFilesystemEntry;
    }
    if (typeof this.directoryGuard !== 'function' || typeof this.fileGuard !== 'function'
      || typeof this.filesystemTreeVerifier !== 'function' || typeof this.filesystemEntryVerifier !== 'function') {
      throw new TypeError('Filesystem guard dependencies must be functions');
    }
    if (!this.nativeFilesystemGuards) {
      this.directoryGuard = options.directoryGuard ?? localDirectoryGuard;
      this.fileGuard = options.fileGuard ?? localFileGuard;
      this.filesystemTreeVerifier = options.filesystemTreeVerifier ?? (async () => ({ ok: true, checked: false }));
      this.filesystemEntryVerifier = options.filesystemEntryVerifier ?? (async () => ({ ok: true, checked: false }));
    }
    if (options.markerAuthenticationKey !== undefined
      && (!Buffer.isBuffer(options.markerAuthenticationKey) || options.markerAuthenticationKey.length !== 32)) {
      throw new TypeError('markerAuthenticationKey must be 32 bytes');
    }
    this.markerAuthenticationKey = options.markerAuthenticationKey ? Buffer.from(options.markerAuthenticationKey) : null;
    this.markerAuthenticationKeyInjected = options.markerAuthenticationKey !== undefined;
    this.updateRecoveryScanState = 'not-run';
    this.updateRecoveryGlobalError = null;
    this.updateRecoveryRequiredInstances = new Set();
  }

  setModInterlock(callback) {
    if (typeof callback !== 'function') throw new TypeError('mod interlock must be a function');
    this.assertStackUpdateAllowedWithinInstanceLock = callback;
  }

  setStackInterlock(callback) {
    if (typeof callback !== 'function') throw new TypeError('stack interlock must be a function');
    this.assertStackUpdateAllowedWithinInstanceLock = callback;
  }

  async check(input) {
    const request = validateUpdateInput(input, false);
    const instance = await this.#instance(request.instanceId);
    const plan = await this.#plan(instance);
    return publicPlan(plan);
  }

  async update(input) {
    const request = validateUpdateInput(input, true);
    return this.withInstanceLock(request.instanceId, () => this.#serialized(
      () => this.#withFilesystemSafety(() => this.#update(request)),
    ));
  }

  async updateWithinInstanceLock(input) {
    const request = validateUpdateInput(input, true);
    return this.#serialized(() => this.#withFilesystemSafety(() => this.#update(request)));
  }

  async preflightRecoveryEvidence() {
    return this.#withFilesystemSafety(() => this.#preflightRecoveryEvidence());
  }

  async #preflightRecoveryEvidence() {
    const inventory = await this.#markerInventory({ create: false });
    const payloadBefore = await this.#assertCleanupTombstoneInventory(inventory);
    const markerKey = inventory.length > 0 ? await this.#ensureMarkerKey(false) : null;
    const unfinished = [];
    const counts = new Map();
    const authenticatedBefore = [];
    for (const item of inventory) {
      const marker = await this.#readMarker(item.markerPath, markerKey);
      validateMarker(marker, item.instanceId, item.transactionId);
      const markerInstance = await this.#instance(item.instanceId);
      authenticatedBefore.push([item.relativePath, canonicalJson(marker)]);
      let requiresRecovery = !TERMINAL_PHASES.has(marker.phase);
      const paths = this.#paths(item.instanceId, item.transactionId);
      const transactionDirectory = path.dirname(paths.backup);
      if (!await exists(transactionDirectory) && !markerAllowsMissingPayloadDirectory(marker)) {
        throw recoveryRequiredError('Update recovery evidence is missing its transaction payload directory');
      }
      if (marker.phase === 'rolled-back') {
        if (await managedTreeRemovalPending(paths.backup) || await managedTreeRemovalPending(paths.cleanupRoot)) {
          throw recoveryRequiredError('Rolled-back update evidence retains contradictory rollback state');
        }
        requiresRecovery = await managedTreeRemovalPending(paths.candidate)
          || await managedTreeRemovalPending(paths.failedCandidate);
      } else if (marker.phase === 'ready') {
        const instance = markerInstance;
        const current = instance.updateStatus?.transactionId === marker.transactionId;
        const cleanup = marker.retiredCleanup ? validateRetiredCleanup(marker.retiredCleanup) : null;
        if (cleanup && cleanup.state !== 'purged') {
          if (!current) throw recoveryRequiredError('Historical update evidence retains unfinished cleanup state');
          requiresRecovery = true;
        } else {
          await this.#verifyHistoricalReadyMarker(marker);
          if (current) {
            if (cleanup?.state === 'purged') {
              validateVerifiedBackupStatus(instance.updateStatus, false);
            } else if (instance.updateStatus?.state === 'verified') {
              validateVerifiedBackupStatus(instance.updateStatus, true);
            } else {
              requiresRecovery = true;
            }
          } else if (!instance.updateStatus?.transactionId) {
            throw recoveryRequiredError('Terminal update evidence has no matching current or historical inventory receipt');
          }
        }
      }
      if (!requiresRecovery) continue;
      counts.set(item.instanceId, (counts.get(item.instanceId) ?? 0) + 1);
      unfinished.push({ instanceId: item.instanceId, transactionRef: item.transactionId });
    }
    const markerMapBefore = new Map(inventory.map((item, index) => [
      `${item.instanceId}\0${item.transactionId}`,
      JSON.parse(authenticatedBefore[index][1]),
    ]));
    if ([...counts.values()].some((count) => count > 1)) {
      throw recoveryRequiredError('Update recovery contains multiple unfinished transactions for one instance');
    }
    const receiptsBefore = await this.#storeReceiptFingerprint(inventory, markerMapBefore);
    unfinished.sort((left, right) => left.instanceId.localeCompare(right.instanceId, 'en')
      || left.transactionRef.localeCompare(right.transactionRef, 'en'));
    const afterInventory = await this.#markerInventory({ create: false });
    const payloadAfter = await this.#assertCleanupTombstoneInventory(afterInventory);
    if (canonicalJson(inventory.map((item) => item.relativePath))
      !== canonicalJson(afterInventory.map((item) => item.relativePath))) {
      throw recoveryRequiredError('Update recovery namespace changed during read-only preflight');
    }
    const markerKeyAfter = afterInventory.length > 0 ? await this.#ensureMarkerKey(false) : null;
    const authenticatedAfter = [];
    for (const item of afterInventory) {
      const marker = await this.#readMarker(item.markerPath, markerKeyAfter);
      validateMarker(marker, item.instanceId, item.transactionId);
      authenticatedAfter.push([item.relativePath, canonicalJson(marker)]);
    }
    const markerMapAfter = new Map(afterInventory.map((item, index) => [
      `${item.instanceId}\0${item.transactionId}`,
      JSON.parse(authenticatedAfter[index][1]),
    ]));
    const receiptsAfter = await this.#storeReceiptFingerprint(afterInventory, markerMapAfter);
    if (canonicalJson(authenticatedBefore) !== canonicalJson(authenticatedAfter)
      || receiptsBefore !== receiptsAfter || payloadBefore !== payloadAfter) {
      throw recoveryRequiredError('Update recovery evidence changed during read-only preflight');
    }
    return { domain: 'update', instances: unfinished };
  }

  async #storeReceiptFingerprint(inventory, markerMap = null) {
    const markerKeys = new Set(inventory.map((item) => `${item.instanceId}\0${item.transactionId}`));
    const receipts = [];
    for (const instance of await this.store.list()) {
      if (instance?.projectId !== 'family-server' || instance?.kind !== 'server') continue;
      if (!validateInstanceId(instance.id)) throw recoveryRequiredError('Update inventory contains an invalid Family Server identity');
      if (instance.updateStatus === undefined || instance.updateStatus === null) continue;
      const transactionId = instance.updateStatus?.transactionId;
      if (!TRANSACTION_ID.test(transactionId ?? '') || !markerKeys.has(`${instance.id}\0${transactionId}`)) {
        throw recoveryRequiredError('Family Server update inventory is missing its authenticated transaction marker');
      }
      if (markerMap) {
        const marker = markerMap.get(`${instance.id}\0${transactionId}`);
        const receiptBearingPhase = ['candidate-published', 'store-committed', 'pending-readiness',
          'readiness-observed', 'ready', 'rolling-back', 'rollback-failed'].includes(marker?.phase);
        if (!marker || instance.updateStatus.planId !== marker.planId
          || instance.updateStatus.previousMinecraftVersion !== marker.originalRecord.minecraftVersion
          || instance.updateStatus.targetMinecraftVersion !== marker.target.minecraftVersion
          || !receiptBearingPhase
          || !['pending-unverified', 'verified'].includes(instance.updateStatus.state)
          || canonicalJson(normalizeCurrentForMarker(instance, marker)) !== canonicalJson(marker.target)) {
          throw recoveryRequiredError('Family Server update inventory contradicts its authenticated transaction marker');
        }
        const cleanupState = marker.retiredCleanup?.state ?? null;
        const backupReceiptAllowed = cleanupState === 'purged' || cleanupState === 'inventory-committed'
          ? instance.updateStatus.state === 'verified' && instance.updateStatus.backupAvailable === false
          : cleanupState === 'staged'
            ? [true, false].includes(instance.updateStatus.backupAvailable)
            : instance.updateStatus.backupAvailable === true;
        if (!backupReceiptAllowed) {
          throw recoveryRequiredError('Family Server update backup receipt contradicts its authenticated transaction marker');
        }
      }
      receipts.push({ instanceId: instance.id, updateStatus: freezeClone(instance.updateStatus) });
    }
    receipts.sort((left, right) => left.instanceId.localeCompare(right.instanceId, 'en'));
    return canonicalJson(receipts);
  }

  async reconcileInterruptedTransactions() {
    this.updateRecoveryScanState = 'in-progress';
    this.updateRecoveryGlobalError = 'Update recovery is still being reconciled';
    const requiredInstances = new Set();
    try {
      const results = [];
      const { beforeInventory, preflight } = await this.#withFilesystemSafety(async () => {
        await ensureAnchoredDirectory(this.managedRoot, this.transactionRoot, this.directoryGuard);
        const markerKey = await this.#ensureMarkerKey();
        const inventory = await this.#markerInventory();
        const authenticated = [];
        const unfinishedByInstance = new Map();
        for (const item of inventory) {
          const marker = await this.#readMarker(item.markerPath, markerKey);
          validateMarker(marker, item.instanceId, item.transactionId);
          await this.#instance(item.instanceId);
          authenticated.push({ ...item, marker, authenticatedState: canonicalJson(marker) });
          if (!TERMINAL_PHASES.has(marker.phase)) {
            unfinishedByInstance.set(item.instanceId, (unfinishedByInstance.get(item.instanceId) ?? 0) + 1);
          }
        }
        if ([...unfinishedByInstance.values()].some((count) => count > 1)) {
          throw stateError('Update recovery contains multiple unfinished transactions for one instance');
        }
        await this.#storeReceiptFingerprint(inventory, new Map(authenticated.map((item) => [
          `${item.instanceId}\0${item.transactionId}`,
          item.marker,
        ])));
        return { beforeInventory: inventory, preflight: authenticated };
      });
      for (const item of preflight) {
        const { instanceId, transactionId, markerPath, authenticatedState } = item;
        let marker = item.marker;
        try {
          const result = await this.withInstanceLock(marker.instanceId, () => this.#serialized(
            () => this.#withFilesystemSafety(async () => {
              // Revalidate the external key at the exact instance-locked recovery
              // boundary; the earlier global preflight key must not authorize a
              // later destructive branch after a same-process key swap.
              marker = await this.#readMarker(markerPath);
              validateMarker(marker, instanceId, transactionId);
              if (canonicalJson(marker) !== authenticatedState) {
                throw stateError('Update recovery evidence changed after authenticated preflight');
              }
              if (marker.phase === 'rolled-back') {
                await this.#ensureMarkerKey(false);
                const cleaned = await this.#cleanupRolledBackPayloads(marker);
                return { phase: 'rolled-back', action: cleaned ? 'rolled-back-payloads-cleaned' : 'none' };
              }
              if (marker.phase === 'ready') {
                const current = await this.#instance(marker.instanceId);
                if (current.updateStatus?.transactionId !== marker.transactionId) {
                  await this.#verifyHistoricalReadyMarker(marker);
                  return { phase: 'ready', action: 'historical-terminal-verified' };
                }
                if (marker.retiredCleanup && marker.retiredCleanup.state !== 'purged') {
                  await this.#ensureMarkerKey(false);
                  const action = await this.#reconcileRetiredCleanup(marker);
                  if (action === 'purged') return { phase: 'ready', action: 'retired-version-purged' };
                  marker = await this.#marker(marker.instanceId, marker.transactionId);
                }
                const changed = await this.#finalizeReadiness(marker);
                return { phase: 'ready', action: changed ? 'readiness-finalized' : 'none' };
              }
              if (marker.phase === 'readiness-observed') {
                await this.#finalizeReadiness(marker);
                return { phase: 'ready', action: 'readiness-finalized' };
              }
              const instance = await this.#instance(marker.instanceId);
              const inventoryCommitted = instance.updateStatus?.transactionId === marker.transactionId;
              if (['store-committed', 'pending-readiness'].includes(marker.phase)
                || (marker.phase === 'candidate-published' && inventoryCommitted)) {
                const state = await this.#preserveAwaitingReadiness(marker, instance);
                return state === 'verified'
                  ? { phase: 'ready', action: 'readiness-finalized' }
                  : { phase: 'pending-readiness', action: 'awaiting-readiness' };
              }
              await this.#rollback(marker, `Recovered interrupted transaction from phase ${marker.phase}`);
              return { phase: 'rolled-back', action: 'rolled-back' };
            }),
          ));
          results.push({ instanceId: marker.instanceId, transactionId: marker.transactionId, ...result });
        } catch (error) {
          requiredInstances.add(marker.instanceId);
          results.push({
            instanceId: marker.instanceId,
            transactionId: marker.transactionId,
            phase: marker.phase,
            action: 'manual-recovery-required',
            code: typeof error?.code === 'string' && /^UPDATE_[A-Z0-9_]+$/.test(error.code)
              ? error.code
              : 'UPDATE_RECOVERY_REQUIRED',
          });
        }
      }
      await this.#withFilesystemSafety(async () => {
        const afterInventory = await this.#markerInventory();
        if (canonicalJson(beforeInventory.map((item) => item.relativePath))
          !== canonicalJson(afterInventory.map((item) => item.relativePath))) {
          throw stateError('Update recovery namespace changed while it was being reconciled');
        }
        const afterMarkers = new Map();
        for (const item of afterInventory) {
          const marker = await this.#readMarker(item.markerPath);
          validateMarker(marker, item.instanceId, item.transactionId);
          afterMarkers.set(`${item.instanceId}\0${item.transactionId}`, marker);
          if (!['ready', 'rolled-back', 'pending-readiness'].includes(marker.phase)) {
            requiredInstances.add(item.instanceId);
          }
        }
        await this.#storeReceiptFingerprint(afterInventory, afterMarkers);
      });
      this.updateRecoveryRequiredInstances = requiredInstances;
      this.updateRecoveryGlobalError = null;
      this.updateRecoveryScanState = 'complete';
      return results;
    } catch (error) {
      this.updateRecoveryScanState = 'failed';
      this.updateRecoveryGlobalError = 'Update recovery evidence requires manual review';
      throw error;
    }
  }

  async assertSafeForLifecycle(instanceId, options = {}) {
    if (!validateInstanceId(instanceId)) throw new TypeError('Invalid Family Server instance ID');
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'allowPendingReadiness')
      || (options.allowPendingReadiness !== undefined && typeof options.allowPendingReadiness !== 'boolean')) {
      throw new TypeError('Invalid update lifecycle-fence options');
    }
    return this.#withFilesystemSafety(() => this.#assertSafeForLifecycle(instanceId, options));
  }

  async #assertSafeForLifecycle(instanceId, options) {
    if (this.updateRecoveryScanState !== 'complete' || this.updateRecoveryGlobalError) {
      throw updateLifecycleStageError(recoveryRequiredError('Update recovery has not completed safely'), 'recovery-state');
    }
    if (this.updateRecoveryRequiredInstances.has(instanceId)) {
      throw updateLifecycleStageError(
        recoveryRequiredError('This instance has an update transaction that requires manual recovery'),
        'recovery-state',
      );
    }
    const allowed = options.allowPendingReadiness
      ? new Set(['ready', 'rolled-back', 'pending-readiness'])
      : TERMINAL_PHASES;
    let stage = 'marker-inventory';
    try {
      const inventory = await this.#markerInventory();
      stage = 'marker-key';
      const markerKey = inventory.length > 0 ? await this.#ensureMarkerKey(false) : null;
      const markerMap = new Map();
      stage = 'marker-authentication';
      for (const item of inventory) {
        const marker = await this.#readMarker(item.markerPath, markerKey);
        validateMarker(marker, item.instanceId, item.transactionId);
        markerMap.set(`${item.instanceId}\0${item.transactionId}`, marker);
        if (item.instanceId !== instanceId) continue;
        if (!allowed.has(marker.phase)) {
          this.updateRecoveryRequiredInstances.add(instanceId);
          throw recoveryRequiredError('This instance has an unfinished update transaction');
        }
      }
      stage = 'store-receipt';
      await this.#storeReceiptFingerprint(inventory, markerMap);
      // A lifecycle admission must end with the same authenticated key still
      // present on disk; otherwise a start could escape a just-lost recovery
      // boundary after the marker scan completed.
      stage = 'key-continuity';
      if (inventory.length > 0) await this.#ensureMarkerKey(false);
    } catch (error) {
      if (error?.code !== 'UPDATE_RECOVERY_REQUIRED') {
        this.updateRecoveryGlobalError = 'Update recovery evidence changed after startup';
        this.updateRecoveryScanState = 'failed';
        throw updateLifecycleStageError(
          recoveryRequiredError('Update recovery evidence could not be verified'),
          stage,
        );
      }
      throw updateLifecycleStageError(error, stage);
    }
    return true;
  }

  async markReady(input) {
    const request = validateTransactionInput(input);
    return this.withInstanceLock(request.instanceId, () => this.#serialized(() => this.#withFilesystemSafety(async () => {
      const marker = await this.#marker(request.instanceId, request.transactionId);
      if (!['pending-readiness', 'readiness-observed', 'ready'].includes(marker.phase)) {
        throw stateError(`Transaction is '${marker.phase}', not pending readiness`);
      }
      if (marker.phase === 'pending-readiness') {
        await this.#phase(marker, 'readiness-observed', { readinessObservedAt: this.now() });
      }
      await this.#finalizeReadiness(marker);
      return { instance: await this.#instance(request.instanceId), transaction: publicTransaction(marker) };
    })));
  }

  async rollbackPending(input) {
    const request = validateTransactionInput(input);
    return this.withInstanceLock(request.instanceId, () => this.#serialized(() => this.#withFilesystemSafety(async () => {
      const marker = await this.#marker(request.instanceId, request.transactionId);
      if (marker.phase !== 'pending-readiness') throw stateError(`Transaction is '${marker.phase}', not pending readiness`);
      const instance = await this.#instance(request.instanceId);
      if (ACTIVE_STATES.has(instance.status) || await this.isInstanceActive(instance.id)) {
        throw stateError('The Family Server must be inactive before rollback');
      }
      return this.#rollback(marker, 'Updated server failed readiness validation');
    })));
  }

  async purgeRetiredVersion(input) {
    const request = validatePurgeInput(input);
    return this.withInstanceLock(request.instanceId, () => this.#serialized(
      () => this.#withFilesystemSafety(() => this.#purgeRetiredVersion(request)),
    ));
  }

  async purgeRetiredVersionWithinInstanceLock(input) {
    const request = validatePurgeInput(input);
    return this.#serialized(() => this.#withFilesystemSafety(() => this.#purgeRetiredVersion(request)));
  }

  #withFilesystemSafety(operation) {
    if (typeof operation !== 'function') throw new TypeError('Filesystem safety operation must be a function');
    return this.filesystemSafetyBroker
      ? this.filesystemSafetyBroker.runOperation(operation)
      : operation();
  }

  #serialized(operation) {
    const run = this.#queue.then(operation);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #instance(id) {
    const instance = await this.store.get(id);
    if (!instance) throw notFoundError(`Instance '${id}' was not found`);
    if (instance.projectId !== 'family-server' || instance.kind !== 'server') {
      throw stateError('Only an isolated Family Server instance can be updated');
    }
    const expectedDirectory = this.#paths(id, '00000000-0000-4000-8000-000000000000').instance;
    if (typeof instance.directory !== 'string' || path.resolve(instance.directory) !== expectedDirectory) {
      throw stateError('The Family Server directory is outside its managed boundary');
    }
    return instance;
  }

  async #assertStopped(instance) {
    if (ACTIVE_STATES.has(instance.status) || instance.status !== 'stopped' || await this.isInstanceActive(instance.id)) {
      throw stateError('The Family Server must be fully stopped before reconciliation');
    }
    if (await this.assertQuiescentWithinInstanceLock(instance.id) !== true) {
      throw stateError('The Family Server process and network boundary is not exactly quiescent');
    }
  }

  async #plan(instance) {
    const raw = await this.resolveTarget(freezeClone(instance));
    const target = normalizeTarget(raw, instance);
    const current = normalizeCurrent(instance);
    const sameMinecraft = current.minecraftVersion === target.identity.minecraftVersion;
    const legacyMigration = instance.provisioningStatus === 'legacy-update-required'
      || instance.updateState === 'minecraft-update-approval-required';
    let kind;
    if (!sameMinecraft && ['downgrade', 'unknown'].includes(target.minecraftDirection)) {
      kind = target.minecraftDirection;
    } else if (legacyMigration) {
      kind = 'legacy-migration';
    } else if (sameMinecraft) {
      kind = canonicalJson(current) === canonicalJson(target.identity) ? 'current' : 'component';
    } else {
      kind = target.minecraftDirection;
    }
    const sourceIdentity = {
      current,
      migrationWorldSha256: SHA256.test(instance.migration?.worldSha256 ?? '') ? instance.migration.worldSha256.toLowerCase() : null,
      migrationSourceTreeSha256: SHA256.test(instance.migration?.sourceTreeSha256 ?? '') ? instance.migration.sourceTreeSha256.toLowerCase() : null,
    };
    const targetFingerprint = crypto.createHash('sha256').update(canonicalJson(target.identity)).digest('hex');
    const planId = crypto.createHash('sha256').update(canonicalJson({ source: sourceIdentity, target: target.identity })).digest('hex');
    return { raw, target, current, kind, planId, targetFingerprint };
  }

  async #update(request) {
    let instance = await this.#instance(request.instanceId);
    await this.#assertStopped(instance);
    await this.#assertNoUnfinishedTransaction(instance.id);
    let plan = await this.#plan(instance);
    await this.assertStackUpdateAllowedWithinInstanceLock(instance.id, plan.target.identity);

    if (request.approval && request.approval.planId !== plan.planId) {
      throw staleApprovalError('The approved update plan does not match the trusted release plan');
    }
    if (plan.kind === 'current') return { action: 'current', instance, plan: publicPlan(plan) };
    if (plan.kind === 'downgrade') throw stateError('Refusing to apply a Minecraft world downgrade');
    if (plan.kind === 'unknown') throw stateError('Minecraft release ordering is unknown; refusing to alter the world');
    if (requiresApproval(plan) && !approved(request.approval, plan.planId)) {
      return { action: 'approval-required', instance, plan: publicPlan(plan) };
    }

    // Resolve and validate again under the update queue immediately before mutation.
    instance = await this.#instance(request.instanceId);
    await this.#assertStopped(instance);
    plan = await this.#plan(instance);
    await this.assertStackUpdateAllowedWithinInstanceLock(instance.id, plan.target.identity);
    if (request.approval && request.approval.planId !== plan.planId) {
      throw staleApprovalError('The approved update plan changed before it could be applied');
    }
    if (plan.kind === 'current') return { action: 'current', instance, plan: publicPlan(plan) };
    if (plan.kind === 'downgrade' || plan.kind === 'unknown') throw stateError('The latest update plan is not a verified Minecraft upgrade');
    if (requiresApproval(plan) && !approved(request.approval, plan.planId)) {
      return { action: 'approval-required', instance, plan: publicPlan(plan) };
    }
    await this.#assertRetentionCapacity(instance.id);

    const transactionId = this.randomUUID();
    if (!TRANSACTION_ID.test(transactionId)) throw new Error('The local transaction ID generator returned an invalid value');
    const paths = this.#paths(instance.id, transactionId);
    if (await exists(paths.candidate) || await exists(paths.backup) || await exists(paths.marker)) {
      throw stateError('The generated update transaction paths are already occupied');
    }

    const levelName = await levelDirectory(paths.instance);
    const worldBefore = await hashTree(path.join(paths.instance, ...levelName.split('/')), new Set(), this.managedRoot, this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard);
    const managedPaths = await managedMutableExclusions(paths.instance);
    managedPaths.add(plan.target.identity.minecraftServerArtifact.relativePath);
    const legacyLaunchMigration = await captureLegacyLaunchMigrationEvidence({
      updateKind: plan.kind,
      instance,
      instanceRoot: paths.instance,
      targetServerArtifact: plan.target.identity.minecraftServerArtifact,
      managedRoot: this.managedRoot,
      filesystemTreeVerifier: this.filesystemTreeVerifier,
      filesystemEntryVerifier: this.filesystemEntryVerifier,
      directoryGuard: this.directoryGuard,
      fileGuard: this.fileGuard,
    });
    const mutableExclusions = new Set(managedPaths);
    if (legacyLaunchMigration) {
      for (const root of LEGACY_LAUNCH_ROOTS) mutableExclusions.add(root);
      if (legacyLaunchMigration.previousServerArtifact) {
        managedPaths.add(legacyLaunchMigration.previousServerArtifact.relativePath);
        mutableExclusions.add(legacyLaunchMigration.previousServerArtifact.relativePath);
      }
    }
    const mutableBefore = await hashTree(paths.instance, mutableExclusions, this.managedRoot, this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard);
    const managedBefore = await hashManagedFiles(
      paths.instance,
      managedPaths,
      this.managedRoot,
      this.directoryGuard,
      this.fileGuard,
      this.filesystemEntryVerifier,
    );
    const migratedRoots = legacyLaunchMigration?.roots.reduce((total, root) => ({
      bytes: total.bytes + root.tree.bytes,
      files: total.files + root.tree.files,
    }), { bytes: 0, files: 0 }) ?? { bytes: 0, files: 0 };
    if (mutableBefore.bytes + managedBefore.bytes + migratedRoots.bytes > MAX_UPDATE_TREE_BYTES
      || mutableBefore.files + managedBefore.files + migratedRoots.files > MAX_UPDATE_TREE_ENTRIES) {
      throw stateError('The protected update source exceeds its safe aggregate bounds');
    }
    const sourceDirectoryIdentity = await readManagedDirectoryIdentity(
      paths.instance,
      this.managedRoot,
      this.directoryGuard,
      this.filesystemEntryVerifier,
    );
    const marker = {
      schemaVersion: 1,
      transactionId,
      instanceId: instance.id,
      phase: 'preparing',
      updateKind: plan.kind,
      planId: plan.planId,
      createdAt: this.now(),
      updatedAt: this.now(),
      originalRecord: freezeClone(instance),
      target: freezeClone(plan.target.identity),
      levelName,
      worldBefore,
      mutableBefore,
      managedBefore,
      sourceDirectoryIdentity,
      ...(legacyLaunchMigration ? { legacyLaunchMigration } : {}),
    };
    if (legacyLaunchMigration && plan.kind === 'legacy-migration') {
      throw codedError(
        'Legacy launch namespace migration requires explicit operator authorization',
        'UPDATE_LEGACY_MIGRATION_UNAVAILABLE',
      );
    }
    try {
      await this.#writeMarker(marker);
    } catch (error) {
      await removeEmptyManagedDirectory(
        path.dirname(paths.marker),
        this.managedRoot,
        this.directoryGuard,
        this.filesystemEntryVerifier,
      )
        .catch(() => undefined);
      throw error;
    }

    let inventoryCommitted = false;
    try {
      await this.#withAuthenticatedMutationBoundary(marker, async () => {
        await ensureAnchoredDirectory(this.managedRoot, path.dirname(paths.backup), this.directoryGuard);
        await copyTree(
          paths.instance,
          paths.candidate,
          this.managedRoot,
          this.filesystemTreeVerifier,
          this.directoryGuard,
          this.fileGuard,
          new Set(marker.legacyLaunchMigration?.roots.map((root) => root.relativePath) ?? []),
        );
      });
      const preparationDirectories = [
        paths.candidate,
        path.join(paths.candidate, 'mods'),
        path.join(paths.candidate, 'versions'),
        path.dirname(safeRelative(paths.candidate, plan.target.identity.minecraftServerArtifact.relativePath)),
        path.join(paths.candidate, 'config'),
        path.join(paths.candidate, 'config', 'Geyser-Fabric'),
      ];
      let prepared;
      await this.#withAuthenticatedMutationBoundary(marker, async () => {
        for (const directory of preparationDirectories) {
          await ensureAnchoredDirectory(this.managedRoot, directory, this.directoryGuard);
        }
        const preparationGuards = await acquireGuardBranches(
          this.managedRoot,
          preparationDirectories,
          this.directoryGuard,
        );
        try {
          assertGuardsHeld(preparationGuards);
          for (const directory of preparationDirectories) await this.filesystemEntryVerifier(directory);
          prepared = validatePreparedCandidate(await this.prepareCandidate({
            instance: freezeClone(instance),
            target: plan.raw,
            candidateDirectory: paths.candidate,
            transactionId,
          }), this.runtimeRoot, plan.target.identity);
          assertGuardsHeld(preparationGuards);
          for (const directory of preparationDirectories) await this.filesystemEntryVerifier(directory);
        } finally { await releaseGuards(...preparationGuards.reverse()); }
      });
      if (marker.legacyLaunchMigration) {
        const launchDigests = preparedLaunchTrustDigests(prepared.recordPatch.javaRuntime);
        marker.legacyLaunchMigration = {
          ...marker.legacyLaunchMigration,
          state: 'pruning-authorized',
          targetLaunchAssetDigest: launchDigests.launchAssetDigest,
          targetLaunchInventoryDigest: launchDigests.launchInventoryDigest,
        };
        marker.updatedAt = this.now();
        await this.#writeMarker(marker);
        await verifyLegacyLaunchTreeEvidence(
          paths.instance,
          marker.legacyLaunchMigration,
          this.managedRoot,
          this.filesystemTreeVerifier,
          this.filesystemEntryVerifier,
          this.directoryGuard,
          this.fileGuard,
        );
        await pruneLegacyLaunchCandidate(
          paths.candidate,
          marker.legacyLaunchMigration,
          plan.target.identity.minecraftServerArtifact.relativePath,
          this.managedRoot,
          this.filesystemEntryVerifier,
          this.directoryGuard,
        );
        marker.legacyLaunchMigration.state = 'candidate-pruned';
        marker.updatedAt = this.now();
        await this.#writeMarker(marker);
      }
      await assertReplacedLegacyManagedArtifacts(
        paths.candidate,
        managedPaths,
        new Set([plan.target.identity.minecraftServerArtifact.relativePath]),
      );
      if (marker.legacyLaunchMigration) {
        await assertLegacyLaunchCandidatePruned(
          paths.candidate,
          marker.legacyLaunchMigration,
          plan.target.identity.minecraftServerArtifact.relativePath,
          this.managedRoot,
          this.filesystemEntryVerifier,
          this.directoryGuard,
        );
      }
      const artifacts = await verifyArtifacts(
        paths.candidate,
        prepared.managedArtifacts,
        this.managedRoot,
        this.directoryGuard,
        this.fileGuard,
        this.filesystemEntryVerifier,
      );
      const verifiedServerArtifact = await this.#inspectCandidateServerArtifact(
        paths.candidate,
        prepared.recordPatch.minecraftServerArtifact,
      );
      if (canonicalJson(verifiedServerArtifact) !== canonicalJson(prepared.recordPatch.minecraftServerArtifact)
        || verifiedServerArtifact.worldDataVersion !== prepared.recordPatch.worldDataVersion) {
        throw stateError('Prepared Minecraft server compatibility metadata failed verification');
      }
      const worldAfter = await hashTree(path.join(paths.candidate, ...levelName.split('/')), new Set(), this.managedRoot, this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard);
      const mutableAfter = await hashTree(paths.candidate, mutableExclusions, this.managedRoot, this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard);
      if (worldAfter.digest !== worldBefore.digest) throw stateError('The staged update changed the Minecraft world before launch');
      if (mutableAfter.digest !== mutableBefore.digest) throw stateError('The staged update changed protected mutable server state');
      const sourceWorldNow = await hashTree(path.join(paths.instance, ...levelName.split('/')), new Set(), this.managedRoot, this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard);
      const sourceMutableNow = await hashTree(paths.instance, mutableExclusions, this.managedRoot, this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard);
      if (sourceWorldNow.digest !== worldBefore.digest || sourceMutableNow.digest !== mutableBefore.digest) {
        throw stateError('The stopped server changed while its update was being staged');
      }
      if (marker.legacyLaunchMigration) {
        await verifyLegacyLaunchTreeEvidence(
          paths.instance,
          marker.legacyLaunchMigration,
          this.managedRoot,
          this.filesystemTreeVerifier,
          this.filesystemEntryVerifier,
          this.directoryGuard,
          this.fileGuard,
        );
      }
      marker.prepared = prepared.recordPatch;
      marker.artifacts = artifacts;
      marker.worldAfter = worldAfter;
      marker.mutableAfter = mutableAfter;
      await this.#phase(marker, 'candidate-ready');

      await this.#assertStopped(await this.#instance(instance.id));
      await this.assertStackUpdateAllowedWithinInstanceLock(instance.id, {
        ...plan.target.identity,
        worldDataVersion: prepared.recordPatch.worldDataVersion,
        minecraftServerArtifact: verifiedServerArtifact,
      });
      const verifyCandidateForPublication = async () => {
        await this.filesystemTreeVerifier(paths.candidate, {
          maxEntries: MAX_UPDATE_TREE_ENTRIES,
          maxDepth: MAX_UPDATE_TREE_DEPTH,
        });
        const publicationArtifacts = await verifyArtifacts(
          paths.candidate,
          prepared.managedArtifacts,
          this.managedRoot,
          this.directoryGuard,
          this.fileGuard,
          this.filesystemEntryVerifier,
        );
        if (canonicalJson(publicationArtifacts) !== canonicalJson(artifacts)) {
          throw stateError('The update candidate artifacts changed before publication');
        }
        const publicationServerArtifact = await this.#inspectCandidateServerArtifact(
          paths.candidate,
          prepared.recordPatch.minecraftServerArtifact,
        );
        if (canonicalJson(publicationServerArtifact) !== canonicalJson(verifiedServerArtifact)) {
          throw stateError('The update candidate server artifact changed before publication');
        }
        const publicationWorld = await hashTree(path.join(paths.candidate, ...levelName.split('/')), new Set(), this.managedRoot, this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard);
        const publicationMutable = await hashTree(paths.candidate, mutableExclusions, this.managedRoot, this.filesystemTreeVerifier, this.directoryGuard, this.fileGuard);
        if (publicationWorld.digest !== worldAfter.digest || publicationMutable.digest !== mutableAfter.digest) {
          throw stateError('The update candidate changed after final staging verification');
        }
        if (marker.legacyLaunchMigration) {
          await assertLegacyLaunchCandidatePruned(
            paths.candidate,
            marker.legacyLaunchMigration,
            plan.target.identity.minecraftServerArtifact.relativePath,
            this.managedRoot,
            this.filesystemEntryVerifier,
            this.directoryGuard,
          );
        }
        return hashTree(
          paths.candidate,
          new Set(),
          this.managedRoot,
          this.filesystemTreeVerifier,
          this.directoryGuard,
          this.fileGuard,
        );
      };
      const verifySourceForPublication = async ({ sourceGuard, ancestorGuards = [] }) => {
        const heldDirectoryGuards = [
          ...ancestorGuards.map((guard) => ({ directory: DIRECTORY_GUARD_PATHS.get(guard), guard })),
          { directory: paths.instance, guard: sourceGuard },
        ].filter((entry) => typeof entry.directory === 'string');
        return withHeldWindowsDirectoryGuards(heldDirectoryGuards, async () => {
        sourceGuard.assertHeld?.();
        const publicationSourceIdentity = managedDirectoryIdentity(
          await fs.lstat(paths.instance, { bigint: true }),
        );
        if (canonicalJson(publicationSourceIdentity) !== canonicalJson(marker.sourceDirectoryIdentity)) {
          throw stateError('The canonical server directory changed identity before final update publication');
        }
        await this.#assertStopped(await this.#instance(instance.id));
        await this.assertStackUpdateAllowedWithinInstanceLock(instance.id, {
          ...plan.target.identity,
          worldDataVersion: prepared.recordPatch.worldDataVersion,
          minecraftServerArtifact: verifiedServerArtifact,
        });
        await this.filesystemTreeVerifier(paths.instance, {
          maxEntries: MAX_UPDATE_TREE_ENTRIES,
          maxDepth: MAX_UPDATE_TREE_DEPTH,
        });
        const publicationSourceMutable = await hashTreeWithinHeldRoot(
          paths.instance,
          mutableExclusions,
          this.filesystemTreeVerifier,
          this.directoryGuard,
          this.fileGuard,
          sourceGuard,
        );
        if (canonicalJson(publicationSourceMutable) !== canonicalJson(mutableBefore)) {
          throw stateError('The stopped server changed during final update publication verification');
        }
        if (marker.legacyLaunchMigration) {
          await verifyLegacyLaunchTreeEvidenceWithinHeldRoot(
            paths.instance,
            marker.legacyLaunchMigration,
            this.filesystemTreeVerifier,
            this.filesystemEntryVerifier,
            this.directoryGuard,
            this.fileGuard,
            sourceGuard,
          );
        }
        sourceGuard.assertHeld?.();
        const publicationSourceIdentityAfter = managedDirectoryIdentity(
          await fs.lstat(paths.instance, { bigint: true }),
        );
        if (canonicalJson(publicationSourceIdentityAfter) !== canonicalJson(marker.sourceDirectoryIdentity)) {
          throw stateError('The canonical server directory changed identity during final update publication');
        }
        });
      };
      const candidatePublicationTree = await verifyCandidateForPublication();
      await this.#withAuthenticatedMutationBoundary(marker, () => moveManagedDirectory(
          paths.instance,
          paths.backup,
          this.managedRoot,
          this.directoryGuard,
          verifySourceForPublication,
          this.filesystemEntryVerifier,
        ));
      await this.#phase(marker, 'original-backed-up');
      await this.#withAuthenticatedMutationBoundary(marker, () => moveManagedDirectory(
          paths.candidate,
          paths.instance,
          this.managedRoot,
          this.directoryGuard,
          async ({ sourceGuard }) => {
            const heldCandidateTree = await hashTreeWithinHeldRoot(
              paths.candidate,
              new Set(),
              this.filesystemTreeVerifier,
              this.directoryGuard,
              this.fileGuard,
              sourceGuard,
            );
            if (canonicalJson(heldCandidateTree) !== canonicalJson(candidatePublicationTree)) {
              throw stateError('The update candidate changed during held publication verification');
            }
          },
          this.filesystemEntryVerifier,
        ));
      await this.#phase(marker, 'candidate-published');

      const updateStatus = {
        state: 'pending-unverified',
        transactionId,
        planId: plan.planId,
        kind: plan.kind,
        previousMinecraftVersion: instance.minecraftVersion,
        targetMinecraftVersion: plan.target.identity.minecraftVersion,
        backupAvailable: true,
        updatedAt: this.now(),
      };
      const patch = {
        ...prepared.recordPatch,
        projectId: 'family-server',
        kind: 'server',
        updateChannel: 'latest-compatible',
        minecraftVersion: plan.target.identity.minecraftVersion,
        latestMinecraftVersion: plan.target.identity.latestMinecraftVersion,
        minecraftReleaseTime: plan.target.identity.minecraftReleaseTime,
        requiredJavaMajor: plan.target.identity.requiredJavaMajor,
        javaRuntimeComponent: plan.target.identity.javaRuntimeComponent,
        loader: 'fabric',
        loaderVersion: plan.target.identity.loaderVersion,
        installerVersion: plan.target.identity.installerVersion,
        components: freezeClone(plan.target.identity.components),
        artifacts,
        stackFingerprint: plan.targetFingerprint,
        directory: paths.instance,
        provisioningStatus: 'ready',
        status: 'stopped',
        pid: null,
        lastError: null,
        update: undefined,
        updateState: undefined,
        updateStatus,
      };
      const updated = await this.#withAuthenticatedMutationBoundary(
        marker,
        () => this.store.update(instance.id, patch),
      );
      inventoryCommitted = true;
      marker.targetRecord = freezeClone(updated);
      await this.#phase(marker, 'store-committed');
      await this.#phase(marker, 'pending-readiness');
      return { action: 'updated', instance: updated, plan: publicPlan(plan), transaction: publicTransaction(marker), readiness: 'pending-unverified' };
    } catch (error) {
      if (inventoryCommitted) {
        let reconciliationError;
        try {
          if (!['pending-readiness', 'readiness-observed', 'ready'].includes(marker.phase)) {
            await this.#phase(marker, 'pending-readiness', { commitError: String(error.message).slice(0, 500) });
          }
        } catch (phaseError) {
          reconciliationError = phaseError;
        }
        if (reconciliationError) {
          throw new AggregateError([error, reconciliationError], 'Update inventory was committed and must be reconciled at next startup');
        }
        throw error;
      }
      try {
        await this.#rollback(marker, error.message);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Update failed and automatic rollback requires manual recovery');
      }
      throw error;
    }
  }

  async #assertNoUnfinishedTransaction(instanceId) {
    if (this.updateRecoveryGlobalError || this.updateRecoveryRequiredInstances.has(instanceId)) {
      throw recoveryRequiredError('Update recovery must be resolved before another mutation');
    }
    for (const item of await this.#markerInventory()) {
      if (item.instanceId !== instanceId) continue;
      const marker = await this.#readMarker(item.markerPath);
      validateMarker(marker, instanceId, item.transactionId);
      if (!TERMINAL_PHASES.has(marker.phase)) {
        throw stateError(`Transaction '${marker.transactionId}' is still ${marker.phase}`);
      }
    }
  }

  async #purgeRetiredVersion(request) {
    let instance = await this.#instance(request.instanceId);
    await this.#assertStopped(instance);
    await this.#assertNoUnfinishedTransaction(instance.id);
    const status = validateVerifiedBackupStatus(instance.updateStatus);
    const paths = this.#paths(instance.id, status.transactionId);
    this.#assertCleanupPathLayout(instance.id, status.transactionId, paths);
    await assertManagedRegularFile(this.managedRoot, paths.marker, 'update transaction marker');
    let marker = await this.#marker(instance.id, status.transactionId);

    if (marker.retiredCleanup) {
      if (marker.retiredCleanup.state === 'purged') {
        throw stateError('The retired Minecraft version backup was already purged');
      }
      await this.#reconcileRetiredCleanup(marker);
      instance = await this.#instance(request.instanceId);
      marker = await this.#marker(instance.id, status.transactionId);
    }
    const cleanup = this.#validateRetiredCleanupTarget(instance, marker, true);
    await assertManagedDirectory(this.managedRoot, paths.instance, 'canonical Family Server directory');
    await assertManagedDirectory(this.managedRoot, paths.backup, 'verified rollback backup');

    const cacheEntries = this.#retiredCacheEntries(marker, paths);
    const stagedCacheIndexes = [];
    for (const entry of cacheEntries) {
      if (!await exists(entry.source)) continue;
      await assertManagedRegularFile(paths.instance, entry.source, 'retired game-version cache');
      stagedCacheIndexes.push(entry.index);
    }
    if (await managedTreeRemovalPending(paths.cleanupRoot)) {
      throw stateError('A retired-version cleanup staging path is already occupied');
    }

    marker.retiredCleanup = {
      schemaVersion: 1,
      state: 'preparing',
      previousMinecraftVersion: cleanup.previousMinecraftVersion,
      targetMinecraftVersion: cleanup.targetMinecraftVersion,
      stagedCacheIndexes,
      preparedAt: this.now(),
    };
    marker.updatedAt = this.now();
    await this.#writeMarker(marker);

    try {
      await this.#withAuthenticatedMutationBoundary(marker, async () => {
        await moveManagedDirectory(
          paths.backup,
          paths.cleanupBackup,
          this.managedRoot,
          this.directoryGuard,
          null,
          this.filesystemEntryVerifier,
        );
        if (stagedCacheIndexes.length > 0) await ensureAnchoredDirectory(this.managedRoot, paths.cleanupCaches, this.directoryGuard);
        for (const index of stagedCacheIndexes) {
          const entry = cacheEntries[index];
          await moveManagedFile(
            entry.source,
            entry.staged,
            this.managedRoot,
            this.directoryGuard,
            this.fileGuard,
            this.filesystemEntryVerifier,
          );
        }
      });
      marker.retiredCleanup.state = 'staged';
      marker.retiredCleanup.stagedAt = this.now();
      marker.updatedAt = this.now();
      await this.#writeMarker(marker);

      const purgedAt = this.now();
      instance = await this.#withAuthenticatedMutationBoundary(marker, () => this.store.update(instance.id, {
          updateStatus: {
            ...instance.updateStatus,
            backupAvailable: false,
            backupPurgedAt: purgedAt,
            retiredMinecraftVersion: cleanup.previousMinecraftVersion,
            obsoleteCacheEntriesPurged: stagedCacheIndexes.length,
          },
        }));
      marker.retiredCleanup.state = 'inventory-committed';
      marker.retiredCleanup.inventoryCommittedAt = purgedAt;
      marker.updatedAt = this.now();
      await this.#writeMarker(marker);

      await this.#withAuthenticatedMutationBoundary(marker, () => removeManagedTree(
          paths.cleanupRoot,
          this.managedRoot,
          this.filesystemTreeVerifier,
          this.directoryGuard,
          this.fileGuard,
          this.filesystemEntryVerifier,
        ));
      marker.retiredCleanup.state = 'purged';
      marker.retiredCleanup.purgedAt = purgedAt;
      marker.updatedAt = this.now();
      await this.#writeMarker(marker);
      return publicRetiredCleanup(instance, marker);
    } catch (error) {
      try {
        const recovery = await this.#reconcileRetiredCleanup(marker);
        if (recovery === 'purged') {
          return publicRetiredCleanup(await this.#instance(instance.id), await this.#marker(instance.id, status.transactionId));
        }
      } catch (recoveryError) {
        throw new AggregateError([error, recoveryError], 'Retired-version cleanup requires startup reconciliation');
      }
      throw error;
    }
  }

  #validateRetiredCleanupTarget(instance, marker, requireBackup) {
    validateMarker(marker, instance.id, instance.updateStatus?.transactionId);
    const status = validateVerifiedBackupStatus(instance.updateStatus, requireBackup);
    if (marker.phase !== 'ready') throw stateError(`Transaction is '${marker.phase}', not verified ready`);
    if (marker.planId !== status.planId) throw stateError('Verified update inventory does not match its transaction plan');
    if (!marker.target || canonicalJson(normalizeCurrentForMarker(instance, marker)) !== canonicalJson(marker.target)) {
      throw stateError('Current Family Server identity does not match the verified update target');
    }
    const previousMinecraftVersion = validVersion(marker.originalRecord?.minecraftVersion, 'retired Minecraft version');
    const targetMinecraftVersion = validVersion(marker.target?.minecraftVersion, 'verified target Minecraft version');
    const previousLoaderVersion = validVersion(marker.originalRecord?.loaderVersion, 'retired Fabric Loader version');
    validVersion(marker.target?.loaderVersion, 'verified target Fabric Loader version');
    if (
      status.previousMinecraftVersion !== previousMinecraftVersion
      || status.targetMinecraftVersion !== targetMinecraftVersion
      || instance.minecraftVersion !== targetMinecraftVersion
      || marker.targetRecord?.minecraftVersion !== targetMinecraftVersion
    ) throw stateError('Current and retired Minecraft version identities do not match the verified transaction');
    return { previousMinecraftVersion, targetMinecraftVersion, previousLoaderVersion };
  }

  #retiredCacheEntries(marker, paths) {
    const previousMinecraftVersion = validVersion(marker.originalRecord?.minecraftVersion, 'retired Minecraft version');
    const previousLoaderVersion = validVersion(marker.originalRecord?.loaderVersion, 'retired Fabric Loader version');
    const targetMinecraftVersion = validVersion(marker.target?.minecraftVersion, 'verified target Minecraft version');
    const targetLoaderVersion = validVersion(marker.target?.loaderVersion, 'verified target Fabric Loader version');
    const retiredNames = [
      `${previousMinecraftVersion}-server.jar`,
      `fabric-loader-server-${previousLoaderVersion}-minecraft-${previousMinecraftVersion}.jar`,
    ];
    const currentNames = new Set([
      `${targetMinecraftVersion}-server.jar`,
      `fabric-loader-server-${targetLoaderVersion}-minecraft-${targetMinecraftVersion}.jar`,
    ]);
    return retiredNames.flatMap((name, index) => (currentNames.has(name) ? [] : [{
      index,
      source: safeRelative(paths.instance, `.fabric/server/${name}`),
      staged: safeRelative(paths.cleanupCaches, `cache-${index}.jar`),
    }]));
  }

  async #reconcileRetiredCleanup(marker) {
    const cleanup = validateRetiredCleanup(marker.retiredCleanup);
    const paths = this.#paths(marker.instanceId, marker.transactionId);
    this.#assertCleanupPathLayout(marker.instanceId, marker.transactionId, paths);
    const instance = await this.#instance(marker.instanceId);
    await this.#assertStopped(instance);
    const status = validateVerifiedBackupStatus(instance.updateStatus, false);
    if (status.transactionId !== marker.transactionId) {
      throw stateError('Retired-version cleanup inventory does not match its transaction marker');
    }
    const target = this.#validateRetiredCleanupTarget(instance, marker, status.backupAvailable !== false);
    if (
      cleanup.previousMinecraftVersion !== target.previousMinecraftVersion
      || cleanup.targetMinecraftVersion !== target.targetMinecraftVersion
    ) throw stateError('Retired-version cleanup marker does not match the verified update target');
    const cacheEntries = this.#retiredCacheEntries(marker, paths);

    if (status.backupAvailable === false) {
      if (await managedTreeRemovalPending(paths.backup)) throw stateError('A purged rollback backup unexpectedly reappeared');
      for (const index of cleanup.stagedCacheIndexes) {
        if (await exists(cacheEntries[index].source)) {
          throw stateError('A purged retired-version cache unexpectedly reappeared');
        }
      }
      if (await managedTreeRemovalPending(paths.cleanupRoot)) {
        if (await exists(paths.cleanupRoot)) {
          await assertManagedDirectory(this.managedRoot, paths.cleanupRoot, 'retired-version cleanup staging directory');
        }
        await this.#withAuthenticatedMutationBoundary(marker, () => removeManagedTree(
            paths.cleanupRoot,
            this.managedRoot,
            this.filesystemTreeVerifier,
            this.directoryGuard,
            this.fileGuard,
            this.filesystemEntryVerifier,
          ));
      }
      marker.retiredCleanup = {
        ...cleanup,
        state: 'purged',
        purgedAt: cleanup.purgedAt ?? status.backupPurgedAt ?? this.now(),
      };
      marker.updatedAt = this.now();
      await this.#writeMarker(marker);
      return 'purged';
    }

    if (status.backupAvailable !== true) throw stateError('Verified update backup availability is invalid');
    await this.#withAuthenticatedMutationBoundary(marker, async () => {
      // Cache files live inside the staged rollback tree. Restore them before
      // moving that tree back to its canonical rollback name.
      for (const index of [...cleanup.stagedCacheIndexes].reverse()) {
        const entry = cacheEntries[index];
        if (!await exists(entry.staged)) continue;
        if (await exists(entry.source)) throw stateError('Both active and staged retired-version caches exist');
        await assertManagedRegularFile(this.managedRoot, entry.staged, 'staged retired-version cache');
        await assertManagedDirectory(paths.instance, path.dirname(entry.source), 'Fabric game-version cache directory');
        await moveManagedFile(
          entry.staged,
          entry.source,
          this.managedRoot,
          this.directoryGuard,
          this.fileGuard,
          this.filesystemEntryVerifier,
        );
      }
      if (await exists(paths.cleanupBackup)) {
        if (await exists(paths.backup)) throw stateError('Both active and staged rollback backups exist');
        await assertManagedDirectory(this.managedRoot, paths.cleanupBackup, 'staged rollback backup');
        await moveManagedDirectory(
          paths.cleanupBackup,
          paths.backup,
          this.managedRoot,
          this.directoryGuard,
          null,
          this.filesystemEntryVerifier,
        );
      }
      if (!await exists(paths.backup)) throw stateError('The verified rollback backup could not be restored');
      if (await managedTreeRemovalPending(paths.cleanupRoot)) {
        if (await exists(paths.cleanupRoot)) {
          await assertManagedDirectory(this.managedRoot, paths.cleanupRoot, 'retired-version cleanup staging directory');
        }
        await removeManagedTree(
          paths.cleanupRoot,
          this.managedRoot,
          this.filesystemTreeVerifier,
          this.directoryGuard,
          this.fileGuard,
          this.filesystemEntryVerifier,
        );
      }
    });
    delete marker.retiredCleanup;
    marker.updatedAt = this.now();
    await this.#writeMarker(marker);
    return 'restored';
  }

  #assertCleanupPathLayout(id, transactionId, paths) {
    if (!validateInstanceId(id) || !TRANSACTION_ID.test(transactionId)) throw new TypeError('Invalid retired-version cleanup identity');
    const expected = {
      instance: path.resolve(this.serverRoot, id),
      backup: path.resolve(this.backupRoot, id, transactionId, 'instance'),
      marker: path.resolve(this.transactionRoot, id, `${transactionId}.json`),
      cleanupRoot: path.resolve(this.backupRoot, id, transactionId, '.retired-version-cleanup'),
    };
    for (const [key, target] of Object.entries(expected)) {
      if (paths[key] !== target || !isChild(this.managedRoot, target)) {
        throw stateError('Retired-version cleanup path escaped its managed boundary');
      }
    }
    if (path.resolve(paths.cleanupBackup) !== path.resolve(paths.cleanupRoot)
      || !isChild(paths.cleanupRoot, paths.cleanupCaches)) {
      throw stateError('Retired-version cleanup staging path escaped its transaction boundary');
    }
  }

  #paths(id, transactionId) {
    const cleanupRoot = path.resolve(this.backupRoot, id, transactionId, '.retired-version-cleanup');
    return {
      instance: path.resolve(this.serverRoot, id),
      candidate: path.resolve(this.serverRoot, `.${id}-candidate-${transactionId}`),
      backup: path.resolve(this.backupRoot, id, transactionId, 'instance'),
      failedCandidate: path.resolve(this.backupRoot, id, transactionId, 'failed-candidate'),
      marker: path.resolve(this.transactionRoot, id, `${transactionId}.json`),
      cleanupRoot,
      // The retained instance moves to a sibling staging name. A nested
      // destination would require releasing both a directory and its own
      // ancestor, which cannot be anchored safely with native Windows guards.
      cleanupBackup: cleanupRoot,
      cleanupCaches: path.resolve(cleanupRoot, 'caches'),
    };
  }

  async #marker(id, transactionId) {
    const marker = await this.#readMarker(this.#paths(id, transactionId).marker);
    validateMarker(marker, id, transactionId);
    return marker;
  }

  async #phase(marker, phase, fields = {}) {
    Object.assign(marker, fields, { phase, updatedAt: this.now() });
    await this.#writeMarker(marker);
    await this.onPhase({ instanceId: marker.instanceId, transactionId: marker.transactionId, phase });
  }

  async #withAuthenticatedMutationBoundary(marker, operation) {
    if (typeof operation !== 'function') throw new TypeError('Authenticated update mutation must be a function');
    validateMarker(marker, marker.instanceId, marker.transactionId);
    const key = await this.#ensureMarkerKey(false);
    const markerPath = this.#paths(marker.instanceId, marker.transactionId).marker;
    const protectedFiles = this.markerAuthenticationKeyInjected
      ? [markerPath]
      : [this.markerKeyFile, markerPath];
    const ancestors = await acquireGuardBranches(
      this.managedRoot,
      protectedFiles.map((file) => path.dirname(file)),
      this.directoryGuard,
    );
    let files = { guards: [] };
    try {
      files = await acquireTypedGuardBatch(
        protectedFiles,
        this.fileGuard,
        'file',
        'Update recovery authentication changed before mutation',
      );
      let markerIndex = 0;
      if (!this.markerAuthenticationKeyInjected) {
        const keyBytes = await readGuardedFileBytes(
          this.markerKeyFile,
          files.guards[0],
          32,
          32,
          'Update recovery key',
        );
        if (!crypto.timingSafeEqual(key, keyBytes)) {
          throw recoveryRequiredError('Update recovery authentication evidence changed before mutation');
        }
        markerIndex = 1;
      }
      const beforeBytes = await readGuardedFileBytes(
        markerPath,
        files.guards[markerIndex],
        2,
        MAX_UPDATE_MARKER_BYTES,
        'Update transaction marker',
      );
      const observed = authenticateCanonicalMarkerBytes(beforeBytes, key);
      validateMarker(observed, marker.instanceId, marker.transactionId);
      if (canonicalJson(observed) !== canonicalJson(marker)) {
        throw recoveryRequiredError('Update recovery evidence changed before an authenticated mutation');
      }
      assertGuardsHeld(ancestors, files.guards);
      const managedRootKey = guardedPathKey(this.managedRoot);
      const managedRootGuard = ancestors.find((guard) => {
        const guardedPath = guard && DIRECTORY_GUARD_PATHS.get(guard);
        return guardedPath !== undefined && guardedPathKey(guardedPath) === managedRootKey;
      });
      if (!managedRootGuard) {
        throw recoveryRequiredError('Update recovery authentication lost its anchored mutation root');
      }
      const heldDirectoryGuards = ancestors.map((guard) => ({
        directory: DIRECTORY_GUARD_PATHS.get(guard),
        guard,
      })).filter((entry) => typeof entry.directory === 'string');
      const value = await AUTHENTICATED_MUTATION_ROOT.run(
        { root: path.resolve(this.managedRoot), guard: managedRootGuard },
        () => withHeldWindowsDirectoryGuards(heldDirectoryGuards, operation),
      );
      assertGuardsHeld(ancestors, files.guards);
      const afterBytes = await readGuardedFileBytes(
        markerPath,
        files.guards[markerIndex],
        2,
        MAX_UPDATE_MARKER_BYTES,
        'Update transaction marker',
      );
      if (!beforeBytes.equals(afterBytes)) {
        throw recoveryRequiredError('Update recovery evidence changed during an authenticated mutation');
      }
      if (!this.markerAuthenticationKeyInjected) {
        const keyAfter = await readGuardedFileBytes(
          this.markerKeyFile,
          files.guards[0],
          32,
          32,
          'Update recovery key',
        );
        if (!crypto.timingSafeEqual(key, keyAfter)) {
          throw recoveryRequiredError('Update recovery authentication evidence changed during mutation');
        }
      }
      return value;
    } finally {
      await releaseGuards(...files.guards.reverse(), ...ancestors.reverse());
    }
  }

  async #preserveAwaitingReadiness(marker, current = null) {
    const paths = this.#paths(marker.instanceId, marker.transactionId);
    if (!await exists(paths.instance) || !await exists(paths.backup)
      || await exists(managedTreeTombstone(paths.backup))) {
      throw stateError('Committed update is missing its canonical instance or rollback backup; manual recovery is required');
    }
    const instance = current ?? await this.#instance(marker.instanceId);
    if (instance.updateStatus?.transactionId !== marker.transactionId) {
      throw stateError('Committed update inventory does not match its transaction marker; manual recovery is required');
    }
    if (instance.updateStatus.state === 'verified') {
      if (marker.phase !== 'ready') {
        await this.#phase(marker, 'ready', {
          verifiedAt: instance.updateStatus.verifiedAt ?? marker.readinessObservedAt ?? this.now(),
        });
      }
      return 'verified';
    }
    if (marker.phase !== 'pending-readiness') await this.#phase(marker, 'pending-readiness');
    return 'pending-unverified';
  }

  async #finalizeReadiness(marker) {
    const paths = this.#paths(marker.instanceId, marker.transactionId);
    if (marker.retiredCleanup?.state === 'purged') {
      const cleanup = validateRetiredCleanup(marker.retiredCleanup);
      const instance = await this.#instance(marker.instanceId);
      const status = validateVerifiedBackupStatus(instance.updateStatus, false);
      if (status.transactionId !== marker.transactionId || status.backupAvailable !== false
        || await managedTreeRemovalPending(paths.backup)) {
        throw stateError('Purged update backup state does not match its verified inventory');
      }
      const target = this.#validateRetiredCleanupTarget(instance, marker, false);
      if (
        cleanup.previousMinecraftVersion !== target.previousMinecraftVersion
        || cleanup.targetMinecraftVersion !== target.targetMinecraftVersion
      ) throw stateError('Purged update marker does not match the verified update target');
      return false;
    }
    if (!await exists(paths.instance) || !await exists(paths.backup)
      || await exists(managedTreeTombstone(paths.backup))) {
      throw stateError('Ready update is missing its canonical instance or rollback backup; manual recovery is required');
    }
    let instance = await this.#instance(marker.instanceId);
    if (instance.updateStatus?.transactionId !== marker.transactionId) {
      throw stateError('Ready update inventory does not match its transaction marker; manual recovery is required');
    }
    let changed = false;
    if (instance.updateStatus.state !== 'verified') {
      const verifiedAt = marker.verifiedAt ?? marker.readinessObservedAt ?? this.now();
      instance = await this.#withAuthenticatedMutationBoundary(marker, () => this.store.update(instance.id, {
          updateStatus: {
            ...instance.updateStatus,
            state: 'verified',
            verifiedAt,
            backupAvailable: true,
          },
        }));
      changed = true;
    }
    if (marker.phase !== 'ready') {
      await this.#phase(marker, 'ready', { verifiedAt: instance.updateStatus.verifiedAt });
      changed = true;
    }
    return changed;
  }

  async #verifyHistoricalReadyMarker(marker) {
    validateMarker(marker, marker.instanceId, marker.transactionId);
    if (marker.phase !== 'ready') throw stateError('Historical update evidence is not terminal');
    const paths = this.#paths(marker.instanceId, marker.transactionId);
    this.#assertCleanupPathLayout(marker.instanceId, marker.transactionId, paths);
    const generatedPayload = await managedTreeRemovalPending(paths.candidate)
      || await managedTreeRemovalPending(paths.failedCandidate);
    if (marker.retiredCleanup?.state === 'purged') {
      validateRetiredCleanup(marker.retiredCleanup);
      if (generatedPayload || await managedTreeRemovalPending(paths.backup)
        || await managedTreeRemovalPending(paths.cleanupRoot)) {
        throw stateError('Purged historical update evidence retains contradictory backup state');
      }
      return true;
    }
    if (generatedPayload || !await exists(paths.backup) || await managedTreeRemovalPending(paths.cleanupRoot)
      || await exists(managedTreeTombstone(paths.backup))) {
      throw stateError('Historical update evidence is missing its immutable rollback backup');
    }
    await assertManagedDirectory(this.managedRoot, paths.backup, 'historical rollback backup');
    await this.filesystemEntryVerifier(paths.backup);
    return true;
  }

  async #assertRetentionCapacity(instanceId) {
    const instance = await this.#instance(instanceId);
    const contradiction = (message) => {
      this.updateRecoveryRequiredInstances.add(instanceId);
      throw recoveryRequiredError(message);
    };
    for (const item of await this.#markerInventory()) {
      if (item.instanceId !== instanceId) continue;
      const marker = await this.#readMarker(item.markerPath);
      validateMarker(marker, item.instanceId, item.transactionId);
      const paths = this.#paths(item.instanceId, item.transactionId);
      const present = {
        backup: await exists(paths.backup),
        candidate: await exists(paths.candidate),
        failedCandidate: await exists(paths.failedCandidate),
        cleanup: await exists(paths.cleanupRoot),
        backupTombstone: await exists(managedTreeTombstone(paths.backup)),
        candidateTombstone: await exists(managedTreeTombstone(paths.candidate)),
        failedCandidateTombstone: await exists(managedTreeTombstone(paths.failedCandidate)),
        cleanupTombstone: await exists(managedTreeTombstone(paths.cleanupRoot)),
      };
      if (marker.phase === 'rolled-back') {
        if (Object.values(present).some(Boolean)) contradiction('Rolled-back update evidence retains contradictory payloads');
        continue;
      }
      if (marker.phase !== 'ready') contradiction('An unfinished update transaction blocks retention admission');
      const cleanup = marker.retiredCleanup ? validateRetiredCleanup(marker.retiredCleanup) : null;
      const currentStatus = instance.updateStatus?.transactionId === marker.transactionId
        ? instance.updateStatus
        : null;
      if (cleanup?.state === 'purged') {
        if (Object.values(present).some(Boolean) || (currentStatus && currentStatus.backupAvailable !== false)) {
          contradiction('Purged update evidence contradicts its retained payload inventory');
        }
        continue;
      }
      if (cleanup || !present.backup || present.candidate || present.failedCandidate || present.cleanup
        || (currentStatus && (currentStatus.state !== 'verified' || currentStatus.backupAvailable !== true))) {
        contradiction('Verified update rollback evidence is missing or contradictory');
      }
      await assertManagedDirectory(this.managedRoot, paths.backup, 'retained verified rollback backup');
      await this.filesystemEntryVerifier(paths.backup);
      throw retentionRequiredError('A retained verified update payload must be explicitly purged before another update');
    }
  }

  async #writeMarker(marker) {
    const markerPath = this.#paths(marker.instanceId, marker.transactionId).marker;
    const markerKey = await this.#ensureMarkerKey();
    const content = `${JSON.stringify(signUpdateMarker(markerKey, marker), null, 2)}\n`;
    const contentBytes = Buffer.byteLength(content);
    if (contentBytes > MAX_UPDATE_MARKER_BYTES) throw stateError('Update recovery marker exceeds its safe byte limit');
    const inventory = await this.#markerInventory({ create: false });
    const existing = inventory.find((item) => path.resolve(item.markerPath) === path.resolve(markerPath));
    if (!existing && inventory.length >= MAX_UPDATE_MARKERS) {
      throw stateError('Update recovery journal exceeds its safe marker limit');
    }
    const projectedBytes = inventory.reduce((total, item) => total + item.size, 0)
      - (existing?.size ?? 0) + contentBytes;
    if (projectedBytes > MAX_UPDATE_MARKER_AGGREGATE_BYTES) {
      throw stateError('Update recovery journal exceeds its safe aggregate byte limit');
    }
    await ensureAnchoredDirectory(this.managedRoot, path.dirname(markerPath), this.directoryGuard);
    let published = false;
    try {
      await writeAtomicManagedFile(
        markerPath,
        content,
        this.managedRoot,
        this.directoryGuard,
        this.fileGuard,
        this.filesystemEntryVerifier,
      );
      published = true;
      // Re-assess every marker, payload namespace, and store receipt twice after
      // publication. This closes both quota and authentication admission windows
      // before any caller may mutate a candidate or live tree.
      const evidence = await this.preflightRecoveryEvidence();
      if (evidence.instances.length > 1 || evidence.instances.some((item) => (
        item.instanceId !== marker.instanceId || item.transactionRef !== marker.transactionId
      ))) {
        throw recoveryRequiredError('Another update transaction requires recovery before journal admission');
      }
      // Re-open the named external key at the final admission boundary. The key
      // used to construct content above must still be the key on disk before a
      // caller is allowed to proceed toward candidate or live-tree mutation.
      const observed = await this.#readMarker(markerPath);
      if (canonicalJson(observed) !== canonicalJson(marker)) {
        throw stateError('The update transaction marker changed during journal admission');
      }
    } catch (error) {
      if (published && !existing) {
        await removeExactManagedFile(
          markerPath,
          content,
          this.managedRoot,
          this.directoryGuard,
          this.fileGuard,
          this.filesystemEntryVerifier,
        ).catch(() => undefined);
      }
      throw error;
    }
  }

  async #readMarker(markerPath, authenticatedKey = null) {
    const key = authenticatedKey ?? await this.#ensureMarkerKey();
    if (!Buffer.isBuffer(key) || key.length !== 32) throw recoveryRequiredError('Update recovery authentication is unavailable');
    const parent = path.dirname(path.resolve(markerPath));
    const guards = await acquireGuardChain(this.managedRoot, parent, this.directoryGuard);
    try {
      assertGuardsHeld(guards);
      return await readMarker(markerPath, key, this.fileGuard);
    } finally { await releaseGuards(...guards.reverse()); }
  }

  async #inspectCandidateServerArtifact(candidateRoot, inventory) {
    const target = safeRelative(candidateRoot, inventory.relativePath);
    const versionDirectory = path.join(candidateRoot, 'versions', inventory.minecraftVersion);
    if (path.dirname(target) !== path.resolve(versionDirectory)) {
      throw stateError('The prepared Minecraft server artifact escaped its pinned version directory');
    }
    const directories = [
      this.managedRoot,
      this.serverRoot,
      candidateRoot,
      path.join(candidateRoot, 'versions'),
      versionDirectory,
    ].map((entry) => path.resolve(entry));
    const guards = await acquireGuardChain(this.managedRoot, versionDirectory, this.directoryGuard);
    let fileGuard = null;
    try {
      assertGuardsHeld(guards);
      for (const directory of directories) await this.filesystemEntryVerifier(directory);
      fileGuard = await this.fileGuard(target);
      fileGuard.assertHeld?.();
      await this.filesystemEntryVerifier(target);
      const verified = await inspectVerifiedMinecraftServerJar(target, inventory);
      fileGuard.assertHeld?.();
      await this.filesystemEntryVerifier(target);
      for (const directory of directories) await this.filesystemEntryVerifier(directory);
      assertGuardsHeld(guards);
      return verified;
    } finally { await releaseGuards(fileGuard, ...guards.reverse()); }
  }

  async #markerInventory(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'create')
      || (options.create !== undefined && typeof options.create !== 'boolean')) {
      throw new TypeError('Invalid update recovery inventory options');
    }
    const create = options.create ?? true;
    if (!await exists(this.transactionRoot)) {
      if (!create) {
        await this.#assertCleanupTombstoneInventory([]);
        return [];
      }
      await ensureAnchoredDirectory(this.managedRoot, this.transactionRoot, this.directoryGuard);
    }
    const rootGuards = await acquireGuardChain(this.managedRoot, this.transactionRoot, this.directoryGuard);
    const inventory = [];
    let totalBytes = 0;
    try {
      assertGuardsHeld(rootGuards);
      await this.filesystemTreeVerifier(this.transactionRoot, {
        maxEntries: (MAX_UPDATE_MARKERS * 2) + 1,
        maxDepth: 2,
      });
      const instanceEntries = await safeTreeEntriesBounded(this.transactionRoot, MAX_UPDATE_MARKERS);
      if (instanceEntries.length > MAX_UPDATE_MARKERS) throw stateError('Update recovery namespace exceeds its safe entry limit');
      for (const chunk of boundedChunks(instanceEntries)) {
        for (const instanceEntry of chunk) {
          if (!instanceEntry.isDirectory() || !validateInstanceId(instanceEntry.name)) {
            throw stateError('Update recovery namespace contains an unexpected entry');
          }
        }
        const directories = chunk.map((instanceEntry) => path.join(this.transactionRoot, instanceEntry.name));
        const instanceGuards = await acquireTypedGuardBatch(
          directories,
          this.directoryGuard,
          'directory',
          'Update recovery namespace contains an unsafe instance directory',
        );
        try {
          for (let index = 0; index < chunk.length; index += 1) {
            const instanceEntry = chunk[index];
            const instanceDirectory = directories[index];
            const instanceGuard = instanceGuards.guards[index];
            assertGuardsHeld(rootGuards, instanceGuard);
            const entries = await safeTreeEntriesBounded(instanceDirectory, MAX_UPDATE_MARKERS);
            if (entries.length === 0) throw stateError('Update recovery namespace contains an incomplete empty transaction directory');
            for (const entry of entries) {
              const transactionId = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
              if (!entry.isFile() || !TRANSACTION_ID.test(transactionId)) {
                throw stateError('Update recovery namespace contains an unexpected transaction entry');
              }
              const markerPath = path.join(instanceDirectory, entry.name);
              const stat = await safeTreeStat(markerPath, 'Update recovery namespace contains an unsafe transaction marker', 'file');
              if (stat.size < 2 || stat.size > MAX_UPDATE_MARKER_BYTES) {
                throw stateError('Update recovery marker exceeds its safe byte limit');
              }
              totalBytes += stat.size;
              if (inventory.length >= MAX_UPDATE_MARKERS || totalBytes > MAX_UPDATE_MARKER_AGGREGATE_BYTES) {
                throw stateError('Update recovery journal exceeds its safe quota');
              }
              inventory.push({
                instanceId: instanceEntry.name,
                transactionId,
                markerPath,
                size: stat.size,
                relativePath: path.relative(this.transactionRoot, markerPath).replaceAll('\\', '/'),
              });
            }
          }
        } finally { await releaseGuards(...instanceGuards.guards.reverse()); }
      }
      await this.filesystemTreeVerifier(this.transactionRoot, {
        maxEntries: (MAX_UPDATE_MARKERS * 2) + 1,
        maxDepth: 2,
      });
      inventory.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
    } finally { await releaseGuards(...rootGuards.reverse()); }
    await this.#assertCleanupTombstoneInventory(inventory);
    return inventory;
  }

  async #assertCleanupTombstoneInventory(inventory) {
    const allowed = new Set();
    const candidatePaths = new Set();
    const transactionKeys = new Set();
    const instanceIds = new Set();
    const observed = [];
    for (const item of inventory) {
      const paths = this.#paths(item.instanceId, item.transactionId);
      for (const target of [paths.candidate, paths.failedCandidate, paths.cleanupRoot]) {
        allowed.add(filesystemPathKey(managedTreeTombstone(target)));
      }
      candidatePaths.add(filesystemPathKey(paths.candidate));
      transactionKeys.add(`${item.instanceId}\0${item.transactionId}`);
      instanceIds.add(item.instanceId);
    }
    let entriesSeen = 0;
    const countEntries = (count) => {
      entriesSeen += count;
      if (entriesSeen > MAX_UPDATE_MARKERS * 16) {
        throw stateError('Update cleanup namespace exceeds its safe entry limit');
      }
    };
    const validateTombstone = async (parent, entry) => {
      if (!entry.name.endsWith(UPDATE_DELETE_SUFFIX)) return;
      const target = path.resolve(parent, entry.name);
      if (!allowed.has(filesystemPathKey(target))) {
        throw stateError('Update cleanup namespace contains an unknown tombstone');
      }
      if (!entry.isDirectory()) throw stateError('Update cleanup namespace contains an unsafe tombstone');
      await this.filesystemEntryVerifier(target);
      observed.push(namespaceEntryIdentity(this.managedRoot, target, await fs.lstat(target, { bigint: true })));
    };

    if (await exists(this.serverRoot)) {
      const guards = await acquireGuardChain(this.managedRoot, this.serverRoot, this.directoryGuard);
      try {
        observed.push(namespaceEntryIdentity(this.managedRoot, this.serverRoot, await fs.lstat(this.serverRoot, { bigint: true })));
        const entries = await safeTreeEntriesBounded(this.serverRoot, (MAX_UPDATE_MARKERS * 2) + 1);
        countEntries(entries.length);
        for (const entry of entries) {
          const target = path.resolve(this.serverRoot, entry.name);
          if (entry.name.endsWith(UPDATE_DELETE_SUFFIX)) {
            await validateTombstone(this.serverRoot, entry);
          } else if (/^\..+-candidate-/i.test(entry.name)) {
            if (!candidatePaths.has(filesystemPathKey(target)) || !entry.isDirectory()) {
              throw stateError('Update cleanup namespace contains an orphan candidate');
            }
            await this.filesystemEntryVerifier(target);
            observed.push(namespaceEntryIdentity(this.managedRoot, target, await fs.lstat(target, { bigint: true })));
          }
        }
      } finally { await releaseGuards(...guards.reverse()); }
    } else observed.push(['root', 'servers', false]);
    if (!await exists(this.backupRoot)) {
      observed.push(['root', 'backups', false]);
      return canonicalJson(observed);
    }
    const backupGuards = await acquireGuardChain(this.managedRoot, this.backupRoot, this.directoryGuard);
    try {
      assertGuardsHeld(backupGuards);
      observed.push(namespaceEntryIdentity(this.managedRoot, this.backupRoot, await fs.lstat(this.backupRoot, { bigint: true })));
      const instanceEntries = await safeTreeEntriesBounded(this.backupRoot, MAX_UPDATE_MARKERS);
      countEntries(instanceEntries.length);
      for (const instanceChunk of boundedChunks(instanceEntries)) {
        for (const instanceEntry of instanceChunk) {
          if (!validateInstanceId(instanceEntry.name) || !instanceIds.has(instanceEntry.name)
            || !instanceEntry.isDirectory()) {
            throw stateError('Update cleanup namespace contains an unexpected instance entry');
          }
        }
        const instanceDirectories = instanceChunk.map(
          (instanceEntry) => path.join(this.backupRoot, instanceEntry.name),
        );
        const instanceGuards = await acquireTypedGuardBatch(
          instanceDirectories,
          this.directoryGuard,
          'directory',
          'Update cleanup namespace contains an unsafe instance entry',
        );
        try {
          for (let instanceIndex = 0; instanceIndex < instanceChunk.length; instanceIndex += 1) {
            const instanceEntry = instanceChunk[instanceIndex];
            const instanceDirectory = instanceDirectories[instanceIndex];
            assertGuardsHeld(backupGuards, instanceGuards.guards[instanceIndex]);
            observed.push(namespaceEntryIdentity(this.managedRoot, instanceDirectory, await fs.lstat(instanceDirectory, { bigint: true })));
            const transactionEntries = await safeTreeEntriesBounded(instanceDirectory, MAX_UPDATE_MARKERS);
            countEntries(transactionEntries.length);
            for (const transactionChunk of boundedChunks(transactionEntries)) {
              for (const transactionEntry of transactionChunk) {
                if (!TRANSACTION_ID.test(transactionEntry.name)
                  || !transactionKeys.has(`${instanceEntry.name}\0${transactionEntry.name}`)
                  || !transactionEntry.isDirectory()) {
                  throw stateError('Update cleanup namespace contains an orphan transaction entry');
                }
              }
              const transactionDirectories = transactionChunk.map(
                (transactionEntry) => path.join(instanceDirectory, transactionEntry.name),
              );
              const transactionGuards = await acquireTypedGuardBatch(
                transactionDirectories,
                this.directoryGuard,
                'directory',
                'Update cleanup namespace contains an unsafe transaction entry',
              );
              try {
                for (let transactionIndex = 0; transactionIndex < transactionChunk.length; transactionIndex += 1) {
                  const transactionEntry = transactionChunk[transactionIndex];
                  const transactionDirectory = transactionDirectories[transactionIndex];
                  assertGuardsHeld(
                    backupGuards,
                    instanceGuards.guards[instanceIndex],
                    transactionGuards.guards[transactionIndex],
                  );
                  observed.push(namespaceEntryIdentity(this.managedRoot, transactionDirectory, await fs.lstat(transactionDirectory, { bigint: true })));
                  const payloadEntries = await safeTreeEntriesBounded(transactionDirectory, 5);
                  countEntries(payloadEntries.length);
                  const allowedPayloadNames = new Set([
                    'instance',
                    'failed-candidate',
                    '.retired-version-cleanup',
                    `failed-candidate${UPDATE_DELETE_SUFFIX}`,
                    `.retired-version-cleanup${UPDATE_DELETE_SUFFIX}`,
                  ]);
                  for (const payloadEntry of payloadEntries) {
                    if (!allowedPayloadNames.has(payloadEntry.name) || !payloadEntry.isDirectory()) {
                      throw stateError('Update cleanup namespace contains an unexpected transaction payload');
                    }
                    if (payloadEntry.name.endsWith(UPDATE_DELETE_SUFFIX)) {
                      await validateTombstone(transactionDirectory, payloadEntry);
                    } else {
                      const payloadPath = path.join(transactionDirectory, payloadEntry.name);
                      observed.push(namespaceEntryIdentity(this.managedRoot, payloadPath, await fs.lstat(payloadPath, { bigint: true })));
                    }
                  }
                }
              } finally { await releaseGuards(...transactionGuards.guards.reverse()); }
            }
          }
        } finally { await releaseGuards(...instanceGuards.guards.reverse()); }
      }
    } finally { await releaseGuards(...backupGuards.reverse()); }
    observed.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right), 'en'));
    return canonicalJson(observed);
  }

  async #ensureMarkerKey(allowCreate = true) {
    if (typeof allowCreate !== 'boolean') throw new TypeError('allowCreate must be a boolean');
    if (this.markerAuthenticationKeyInjected) return this.markerAuthenticationKey;
    const cachedKey = this.markerAuthenticationKey ? Buffer.from(this.markerAuthenticationKey) : null;
    const parent = path.dirname(this.markerKeyFile);
    if (!await exists(parent)) {
      if (!allowCreate) throw recoveryRequiredError('Update recovery authentication evidence is missing');
      await ensureAnchoredDirectory(this.managedRoot, parent, this.directoryGuard);
    }
    const protectedDirectories = [this.managedRoot, parent].map((entry) => path.resolve(entry));
    const ancestors = await acquireGuardChain(this.managedRoot, parent, this.directoryGuard);
    let keyGuard = null; let created = null;
    try {
      assertGuardsHeld(ancestors);
      for (const directory of protectedDirectories) await this.filesystemEntryVerifier(directory);
      if (!await exists(this.markerKeyFile)) {
        if (cachedKey) throw recoveryRequiredError('Update recovery authentication evidence disappeared after startup');
        if (!allowCreate) throw recoveryRequiredError('Update recovery authentication evidence is missing');
        const bytes = this.randomBytes(32);
        if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw stateError('The update recovery key generator returned invalid bytes');
        const handle = await fs.open(this.markerKeyFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
        try {
          await handle.writeFile(bytes); await handle.chmod(0o600); await handle.sync(); created = await handle.stat();
        } finally { await handle.close(); }
      }
      keyGuard = await this.fileGuard(this.markerKeyFile); keyGuard.assertHeld?.();
      await this.filesystemEntryVerifier(this.markerKeyFile);
      const namedBefore = await fs.lstat(this.markerKeyFile);
      if (created && !sameFileIdentity(created, namedBefore)) throw stateError('The update recovery key changed before it was guarded');
      const handle = await fs.open(this.markerKeyFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const openedBefore = await handle.stat(); const bytes = await handle.readFile();
        const openedAfter = await handle.stat(); const namedAfter = await fs.lstat(this.markerKeyFile);
        if (bytes.length !== 32 || !sameFileIdentity(namedBefore, openedBefore)
          || !sameFileIdentity(openedBefore, openedAfter) || !sameFileIdentity(openedAfter, namedAfter)) {
          throw stateError('The update recovery key is not a stable private file');
        }
        if (cachedKey && !crypto.timingSafeEqual(cachedKey, bytes)) {
          throw recoveryRequiredError('Update recovery authentication evidence changed after startup');
        }
        await this.filesystemEntryVerifier(this.markerKeyFile);
        for (const directory of protectedDirectories) await this.filesystemEntryVerifier(directory);
        this.markerAuthenticationKey = Buffer.from(bytes);
        return this.markerAuthenticationKey;
      } finally { await handle.close(); }
    } finally { await releaseGuards(keyGuard, ...ancestors.reverse()); }
  }

  async #verifyRollbackSource(marker, root) {
    await this.filesystemTreeVerifier(root, {
      maxEntries: MAX_UPDATE_TREE_ENTRIES,
      maxDepth: MAX_UPDATE_TREE_DEPTH,
    });
    await this.filesystemEntryVerifier(root);
    const restoredWorld = await hashTree(
      path.join(root, ...marker.levelName.split('/')),
      new Set(),
      this.managedRoot,
      this.filesystemTreeVerifier,
      this.directoryGuard,
      this.fileGuard,
    );
    const managedPaths = new Set(marker.managedBefore.entries.map((entry) => entry.relativePath));
    const mutableExclusions = mutableExclusionsFromMarker(marker, managedPaths);
    const restoredMutable = await hashTree(
      root,
      mutableExclusions,
      this.managedRoot,
      this.filesystemTreeVerifier,
      this.directoryGuard,
      this.fileGuard,
    );
    const restoredManaged = await hashManagedFiles(
      root,
      managedPaths,
      this.managedRoot,
      this.directoryGuard,
      this.fileGuard,
      this.filesystemEntryVerifier,
    );
    if (restoredMutable.bytes + restoredManaged.bytes > MAX_UPDATE_TREE_BYTES
      || restoredMutable.files + restoredManaged.files > MAX_UPDATE_TREE_ENTRIES
      || canonicalJson(restoredWorld) !== canonicalJson(marker.worldBefore)
      || canonicalJson(restoredMutable) !== canonicalJson(marker.mutableBefore)
      || canonicalJson(restoredManaged) !== canonicalJson(marker.managedBefore)) {
      throw stateError('The rollback source does not match its authenticated pre-update state');
    }
    if (marker.originalRecord.minecraftServerArtifact !== undefined
      || marker.originalRecord.worldDataVersion !== undefined) {
      const expectedServer = normalizeInstalledServerArtifact(
        marker.originalRecord.minecraftServerArtifact,
        marker.originalRecord.minecraftVersion,
      );
      if (marker.originalRecord.worldDataVersion !== expectedServer.worldDataVersion) {
        throw stateError('The rollback source has invalid authenticated Minecraft compatibility metadata');
      }
      const observedServer = await this.#inspectCandidateServerArtifact(root, expectedServer);
      if (canonicalJson(observedServer) !== canonicalJson(expectedServer)) {
      throw stateError('The rollback source Minecraft server artifact changed while retained');
      }
    }
    if (marker.legacyLaunchMigration) {
      await verifyLegacyLaunchTreeEvidence(
        root,
        marker.legacyLaunchMigration,
        this.managedRoot,
        this.filesystemTreeVerifier,
        this.filesystemEntryVerifier,
        this.directoryGuard,
        this.fileGuard,
      );
    }
    await this.filesystemEntryVerifier(root);
    return true;
  }

  async #verifyRollbackSourceWithinHeldRoot(marker, root, rootGuard) {
    rootGuard.assertHeld?.();
    await this.filesystemEntryVerifier(root);
    await this.filesystemTreeVerifier(root, {
      maxEntries: MAX_UPDATE_TREE_ENTRIES,
      maxDepth: MAX_UPDATE_TREE_DEPTH,
    });
    const managedPaths = new Set(marker.managedBefore.entries.map((entry) => entry.relativePath));
    const mutableExclusions = mutableExclusionsFromMarker(marker, managedPaths);
    const worldRoot = safeRelative(root, marker.levelName);
    const worldGuards = await acquireDescendantGuardChainWithinHeldRoot(
      root,
      worldRoot,
      this.directoryGuard,
      this.filesystemEntryVerifier,
      rootGuard,
    );
    let restoredWorld;
    try {
      restoredWorld = await hashTreeWithinHeldRoot(
        worldRoot,
        new Set(),
        this.filesystemTreeVerifier,
        this.directoryGuard,
        this.fileGuard,
        worldGuards.at(-1) ?? rootGuard,
      );
    } finally { await releaseGuards(...worldGuards.reverse()); }
    const restoredMutable = await hashTreeWithinHeldRoot(
      root,
      mutableExclusions,
      this.filesystemTreeVerifier,
      this.directoryGuard,
      this.fileGuard,
      rootGuard,
    );
    const restoredManaged = await hashManagedFiles(
      root,
      managedPaths,
      this.managedRoot,
      this.directoryGuard,
      this.fileGuard,
      this.filesystemEntryVerifier,
      rootGuard,
    );
    if (restoredMutable.bytes + restoredManaged.bytes > MAX_UPDATE_TREE_BYTES
      || restoredMutable.files + restoredManaged.files > MAX_UPDATE_TREE_ENTRIES
      || canonicalJson(restoredWorld) !== canonicalJson(marker.worldBefore)
      || canonicalJson(restoredMutable) !== canonicalJson(marker.mutableBefore)
      || canonicalJson(restoredManaged) !== canonicalJson(marker.managedBefore)) {
      throw stateError('The held rollback source does not match its authenticated pre-update state');
    }
    if (marker.originalRecord.minecraftServerArtifact !== undefined
      || marker.originalRecord.worldDataVersion !== undefined) {
      const expectedServer = normalizeInstalledServerArtifact(
        marker.originalRecord.minecraftServerArtifact,
        marker.originalRecord.minecraftVersion,
      );
      if (marker.originalRecord.worldDataVersion !== expectedServer.worldDataVersion) {
        throw stateError('The held rollback source has invalid authenticated Minecraft compatibility metadata');
      }
      const serverEntry = marker.managedBefore.entries.find(
        (entry) => entry.relativePath === expectedServer.relativePath,
      );
      if (!serverEntry?.present || serverEntry.sha256 !== expectedServer.sha256
        || serverEntry.size !== expectedServer.size) {
        throw stateError('The held rollback source contradicts its authenticated Minecraft server artifact');
      }
    }
    if (marker.legacyLaunchMigration) {
      await verifyLegacyLaunchTreeEvidenceWithinHeldRoot(
        root,
        marker.legacyLaunchMigration,
        this.filesystemTreeVerifier,
        this.filesystemEntryVerifier,
        this.directoryGuard,
        this.fileGuard,
        rootGuard,
      );
    }
    rootGuard.assertHeld?.();
    await this.filesystemEntryVerifier(root);
    await this.filesystemTreeVerifier(root, {
      maxEntries: MAX_UPDATE_TREE_ENTRIES,
      maxDepth: MAX_UPDATE_TREE_DEPTH,
    });
    rootGuard.assertHeld?.();
    return true;
  }

  async #rollback(marker, reason) {
    validateMarker(marker, marker.instanceId, marker.transactionId);
    const paths = this.#paths(marker.instanceId, marker.transactionId);
    try {
      if (await this.isInstanceActive(marker.instanceId)) throw stateError('Refusing to roll back an active Family Server process');
      await this.#assertStopped(await this.#instance(marker.instanceId));
      const entryPhase = marker.phase;
      const rollbackOriginPhase = marker.rollbackOriginPhase ?? entryPhase;
      if (!ROLLBACK_ORIGIN_PHASES.has(rollbackOriginPhase)) {
        throw stateError('Update rollback is missing its authenticated origin phase');
      }
      await this.#phase(marker, 'rolling-back', {
        rollbackOriginPhase,
        rollbackReason: String(reason).slice(0, 500),
      });
      await this.#withAuthenticatedMutationBoundary(
        marker,
        () => ensureAnchoredDirectory(this.managedRoot, path.dirname(paths.backup), this.directoryGuard),
      );
      const canonicalExists = await exists(paths.instance);
      const backupExists = await exists(paths.backup);
      const liveWasNeverMoved = ['preparing', 'candidate-ready'].includes(rollbackOriginPhase)
        && canonicalExists && !backupExists;
      if (backupExists && canonicalExists) {
        if (await managedTreeRemovalPending(paths.failedCandidate)) {
          throw stateError('A failed candidate archive already exists; refusing to overwrite it');
        }
        await this.#withAuthenticatedMutationBoundary(marker, () => restoreManagedDirectory(
            paths.instance,
            paths.failedCandidate,
            paths.backup,
            this.managedRoot,
            this.directoryGuard,
            ({ backupGuard }) => this.#verifyRollbackSourceWithinHeldRoot(marker, paths.backup, backupGuard),
            this.filesystemEntryVerifier,
          ));
      } else if (backupExists) {
        if (await exists(paths.instance)) throw stateError('The canonical server path remained occupied during rollback');
        await this.#withAuthenticatedMutationBoundary(marker, () => moveManagedDirectory(
            paths.backup,
            paths.instance,
            this.managedRoot,
            this.directoryGuard,
            ({ sourceGuard }) => this.#verifyRollbackSourceWithinHeldRoot(marker, paths.backup, sourceGuard),
            this.filesystemEntryVerifier,
          ));
      }
      if (!await exists(paths.instance)) throw stateError('The legacy Family Server could not be restored');
      if (liveWasNeverMoved) {
        const observedIdentity = await readManagedDirectoryIdentity(
          paths.instance,
          this.managedRoot,
          this.directoryGuard,
          this.filesystemEntryVerifier,
        );
        if (canonicalJson(observedIdentity) !== canonicalJson(marker.sourceDirectoryIdentity)) {
          throw stateError('The untouched canonical server directory changed identity before rollback');
        }
      }
      await this.#verifyRollbackSource(marker, paths.instance);
      const currentRecord = await this.store.get(marker.instanceId);
      const restorationPatch = {
        ...marker.originalRecord,
        id: marker.instanceId,
        projectId: 'family-server',
        kind: 'server',
        directory: paths.instance,
        status: 'stopped',
        pid: null,
      };
      for (const key of Object.keys(currentRecord ?? {})) {
        if (!Object.hasOwn(marker.originalRecord, key)) restorationPatch[key] = undefined;
      }
      await this.#withAuthenticatedMutationBoundary(
        marker,
        () => this.store.update(marker.instanceId, restorationPatch),
      );
      await this.#cleanupRolledBackPayloads(marker);
      await this.#phase(marker, 'rolled-back', { rolledBackAt: this.now() });
      return { instance: await this.#instance(marker.instanceId), transaction: publicTransaction(marker) };
    } catch (error) {
      try { await this.#phase(marker, 'rollback-failed', { rollbackError: String(error.message).slice(0, 500) }); }
      catch { /* The original marker remains the recovery source. */ }
      throw error;
    }
  }

  async #cleanupRolledBackPayloads(marker) {
    const paths = this.#paths(marker.instanceId, marker.transactionId);
    await this.#assertStopped(await this.#instance(marker.instanceId));
    if (await managedTreeRemovalPending(paths.backup) || await managedTreeRemovalPending(paths.cleanupRoot)) {
      throw stateError('Rolled-back update evidence retains a contradictory rollback payload');
    }
    let cleaned = false;
    for (const target of [paths.candidate, paths.failedCandidate]) {
      if (!await managedTreeRemovalPending(target)) continue;
      if (await exists(target)) {
        await assertManagedDirectory(this.managedRoot, target, 'rolled-back generated update payload');
      }
      await this.#withAuthenticatedMutationBoundary(marker, () => removeManagedTree(
          target,
          this.managedRoot,
          this.filesystemTreeVerifier,
          this.directoryGuard,
          this.fileGuard,
          this.filesystemEntryVerifier,
        ));
      cleaned = true;
    }
    return cleaned;
  }
}

function validateUpdateInput(input, allowApproval) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Update input must be an object');
  const allowed = new Set(allowApproval ? ['instanceId', 'approval'] : ['instanceId']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`Unsupported update field: ${key}`);
  if (!validateInstanceId(input.instanceId)) throw new TypeError('Invalid Family Server instance ID');
  let approval = null;
  if (input.approval !== undefined) {
    if (!allowApproval || !input.approval || typeof input.approval !== 'object' || Array.isArray(input.approval)) throw new TypeError('Invalid update approval');
    for (const key of Object.keys(input.approval)) if (!['planId', 'minecraftVersionChange'].includes(key)) throw new TypeError(`Unsupported approval field: ${key}`);
    if (!SHA256.test(input.approval.planId) || input.approval.minecraftVersionChange !== true) throw new TypeError('Invalid Minecraft version-change approval');
    approval = { planId: input.approval.planId.toLowerCase(), minecraftVersionChange: true };
  }
  return { instanceId: input.instanceId, approval };
}

function validateTransactionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Transaction input must be an object');
  for (const key of Object.keys(input)) if (!['instanceId', 'transactionId'].includes(key)) throw new TypeError(`Unsupported transaction field: ${key}`);
  if (!validateInstanceId(input.instanceId) || !TRANSACTION_ID.test(input.transactionId)) throw new TypeError('Invalid update transaction identity');
  return { instanceId: input.instanceId, transactionId: input.transactionId };
}

function validatePurgeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Retired-version cleanup input must be an object');
  for (const key of Object.keys(input)) if (key !== 'instanceId') throw new TypeError(`Unsupported retired-version cleanup field: ${key}`);
  if (!validateInstanceId(input.instanceId)) throw new TypeError('Invalid Family Server instance ID');
  return { instanceId: input.instanceId };
}

function validateVerifiedBackupStatus(value, requireBackup = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw stateError('The Family Server has no verified update backup inventory');
  if (value.state !== 'verified') throw stateError('The Family Server update is still pending verification');
  if (!TRANSACTION_ID.test(value.transactionId ?? '') || !SHA256.test(value.planId ?? '')) {
    throw stateError('Verified update inventory has an invalid transaction identity');
  }
  const previousMinecraftVersion = validVersion(value.previousMinecraftVersion, 'inventory retired Minecraft version');
  const targetMinecraftVersion = validVersion(value.targetMinecraftVersion, 'inventory target Minecraft version');
  if (requireBackup && value.backupAvailable !== true) throw stateError('The verified rollback backup is not available');
  if (!requireBackup && typeof value.backupAvailable !== 'boolean') throw stateError('Verified update backup availability is invalid');
  return {
    ...value,
    transactionId: value.transactionId,
    planId: value.planId.toLowerCase(),
    previousMinecraftVersion,
    targetMinecraftVersion,
  };
}

function validateRetiredCleanup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) {
    throw stateError('Invalid retired-version cleanup marker');
  }
  if (!RETIRED_CLEANUP_STATES.has(value.state)) throw stateError('Invalid retired-version cleanup state');
  validVersion(value.previousMinecraftVersion, 'cleanup retired Minecraft version');
  validVersion(value.targetMinecraftVersion, 'cleanup target Minecraft version');
  if (
    !Array.isArray(value.stagedCacheIndexes)
    || value.stagedCacheIndexes.some((index) => !Number.isInteger(index) || index < 0 || index > 1)
    || new Set(value.stagedCacheIndexes).size !== value.stagedCacheIndexes.length
  ) throw stateError('Invalid retired-version cache cleanup inventory');
  return freezeClone(value);
}

function approved(approval, planId) {
  return approval?.minecraftVersionChange === true && approval.planId === planId;
}

function normalizeTarget(raw, instance) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('The trusted release resolver returned an invalid target');
  if (raw.projectId !== 'family-server' || raw.updateChannel !== 'latest-compatible') throw new TypeError('The update target is outside the Family Server release channel');
  const minecraftVersion = validVersion(raw.minecraftVersion, 'minecraftVersion');
  const same = minecraftVersion === instance.minecraftVersion;
  const minecraftDirection = same ? 'same' : raw.minecraftDirection;
  if (
    !['same', 'upgrade', 'downgrade', 'unknown'].includes(minecraftDirection)
    || (same && minecraftDirection !== 'same')
    || (!same && minecraftDirection === 'same')
  ) {
    throw new TypeError('The trusted resolver did not declare a valid Minecraft release direction');
  }
  const components = {};
  for (const name of ['fabricApi', 'geyser', 'floodgate']) {
    const component = raw.components?.[name];
    if (!component || typeof component !== 'object') throw new TypeError(`The update target omitted ${name}`);
    components[name] = {
      versionId: validVersion(component.versionId, `${name}.versionId`),
      versionNumber: validVersion(component.versionNumber, `${name}.versionNumber`),
      versionType: validVersion(component.versionType, `${name}.versionType`),
      sourceHash: normalizeSourceHash(component.file?.expected ?? component.sourceHash, name),
    };
  }
  const requiredJavaMajor = raw.requiredJavaMajor;
  if (!Number.isInteger(requiredJavaMajor) || requiredJavaMajor < 8 || requiredJavaMajor > 99) throw new TypeError('Invalid required Java generation');
  const releaseTime = typeof raw.minecraftReleaseTime === 'string' && Number.isFinite(Date.parse(raw.minecraftReleaseTime))
    ? new Date(raw.minecraftReleaseTime).toISOString() : null;
  const minecraftServerArtifact = normalizeTargetServerArtifact(raw.minecraftServerArtifact, minecraftVersion);
  const identity = {
    projectId: 'family-server',
    updateChannel: 'latest-compatible',
    minecraftVersion,
    latestMinecraftVersion: validVersion(raw.latestMinecraftVersion, 'latestMinecraftVersion'),
    minecraftReleaseTime: releaseTime,
    requiredJavaMajor,
    javaRuntimeComponent: validVersion(raw.javaRuntimeComponent, 'javaRuntimeComponent'),
    loaderVersion: validVersion(raw.loaderVersion, 'loaderVersion'),
    installerVersion: validVersion(raw.installerVersion, 'installerVersion'),
    minecraftServerArtifact,
    components,
  };
  return { identity, minecraftDirection };
}

function normalizeCurrent(instance) {
  const components = {};
  for (const name of ['fabricApi', 'geyser', 'floodgate']) {
    const value = instance.components?.[name] ?? {};
    components[name] = {
      versionId: value.versionId ?? null,
      versionNumber: value.versionNumber ?? null,
      versionType: value.versionType ?? null,
      sourceHash: value.sourceHash ?? null,
    };
  }
  let minecraftServerArtifact = null;
  try {
    const value = normalizeInstalledServerArtifact(instance.minecraftServerArtifact, instance.minecraftVersion);
    if (instance.worldDataVersion === value.worldDataVersion) {
      minecraftServerArtifact = {
        minecraftVersion: value.minecraftVersion, relativePath: value.relativePath,
        size: value.size, sha1: value.sha1,
      };
    }
  } catch { minecraftServerArtifact = null; }
  return {
    projectId: 'family-server',
    updateChannel: 'latest-compatible',
    minecraftVersion: instance.minecraftVersion ?? null,
    latestMinecraftVersion: instance.latestMinecraftVersion ?? instance.minecraftVersion ?? null,
    minecraftReleaseTime: instance.minecraftReleaseTime ?? null,
    requiredJavaMajor: instance.requiredJavaMajor ?? null,
    javaRuntimeComponent: instance.javaRuntimeComponent ?? null,
    loaderVersion: instance.loaderVersion ?? null,
    installerVersion: instance.installerVersion ?? null,
    minecraftServerArtifact,
    components,
  };
}

function normalizeCurrentForMarker(instance, marker) {
  const current = normalizeCurrent(instance);
  if (isAttestedLegacyUpdateTerminalMarker(marker)
    && marker.target && !Object.hasOwn(marker.target, 'minecraftServerArtifact')) {
    const { minecraftServerArtifact: _legacyMissingServerArtifact, ...legacy } = current;
    return legacy;
  }
  return current;
}

function normalizeTargetServerArtifact(value, minecraftVersion) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.minecraftVersion !== minecraftVersion
    || value.relativePath !== minecraftServerRelativePath(minecraftVersion)
    || !Number.isInteger(value.size) || value.size < 1 || value.size > 128 * 1024 * 1024
    || !/^[a-f0-9]{40}$/i.test(value.sha1 ?? '')) {
    throw new TypeError('The trusted release omitted valid Mojang server artifact metadata');
  }
  return { minecraftVersion, relativePath: value.relativePath, size: value.size, sha1: value.sha1.toLowerCase() };
}

function normalizeInstalledServerArtifact(value, minecraftVersion) {
  const target = normalizeTargetServerArtifact(value, minecraftVersion);
  if (!SHA256.test(value.sha256 ?? '') || !Number.isSafeInteger(value.worldDataVersion)
    || value.worldDataVersion < 1 || value.worldDataVersion > 0x7fffffff) {
    throw new TypeError('Installed Minecraft server compatibility metadata is invalid');
  }
  return { ...target, sha256: value.sha256.toLowerCase(), worldDataVersion: value.worldDataVersion };
}

function normalizeSourceHash(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} omitted its source hash`);
  if (!['sha512', 'sha1'].includes(value.algorithm) || typeof value.value !== 'string') throw new TypeError(`${label} returned an invalid source hash`);
  const length = value.algorithm === 'sha512' ? 128 : 40;
  if (!new RegExp(`^[a-f0-9]{${length}}$`, 'i').test(value.value)) throw new TypeError(`${label} returned an invalid source hash`);
  return { algorithm: value.algorithm, value: value.value.toLowerCase() };
}

function validatePreparedCandidate(value, runtimeRoot, expectedTarget) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Candidate preparation returned an invalid result');
  for (const key of Object.keys(value)) if (!['recordPatch', 'managedArtifacts'].includes(key)) throw new TypeError(`Unsupported prepared-candidate field: ${key}`);
  const patch = value.recordPatch ?? {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('recordPatch must be an object');
  const allowedPatch = new Set(['javaExecutable', 'javaRuntime', 'worldDataVersion', 'minecraftServerArtifact']);
  for (const key of Object.keys(patch)) if (!allowedPatch.has(key)) throw new TypeError(`Unsupported candidate record field: ${key}`);
  if (patch.javaExecutable !== undefined) {
    if (typeof patch.javaExecutable !== 'string' || !path.isAbsolute(patch.javaExecutable) || !isChild(runtimeRoot, patch.javaExecutable)) {
      throw new TypeError('The prepared Java executable is outside the managed runtime root');
    }
  }
  const safePatch = {};
  if (patch.javaExecutable !== undefined) safePatch.javaExecutable = path.resolve(patch.javaExecutable);
  if (patch.javaRuntime !== undefined) {
    if (!plainJsonObject(patch.javaRuntime) || containsPrivateField(patch.javaRuntime)) {
      throw new TypeError('The prepared Java runtime metadata contains a private field');
    }
    safePatch.javaRuntime = freezeClone(patch.javaRuntime);
  }
  const minecraftServerArtifact = normalizeInstalledServerArtifact(patch.minecraftServerArtifact, expectedTarget.minecraftVersion);
  if (patch.worldDataVersion !== minecraftServerArtifact.worldDataVersion
    || canonicalJson({ minecraftVersion: minecraftServerArtifact.minecraftVersion,
      relativePath: minecraftServerArtifact.relativePath, size: minecraftServerArtifact.size, sha1: minecraftServerArtifact.sha1 })
      !== canonicalJson(expectedTarget.minecraftServerArtifact)) {
    throw new TypeError('Prepared Minecraft server compatibility metadata does not match the trusted update target');
  }
  safePatch.worldDataVersion = minecraftServerArtifact.worldDataVersion;
  safePatch.minecraftServerArtifact = minecraftServerArtifact;
  if (!Array.isArray(value.managedArtifacts) || value.managedArtifacts.length !== MANAGED_ARTIFACTS.length) {
    throw new TypeError('Candidate preparation must report every managed artifact');
  }
  const artifacts = value.managedArtifacts.map((item) => {
    if (!item || typeof item !== 'object' || !MANAGED_ARTIFACTS.includes(item.relativePath) || !SHA256.test(item.sha256)) {
      throw new TypeError('Candidate preparation returned invalid managed-artifact metadata');
    }
    return { relativePath: item.relativePath, sha256: item.sha256.toLowerCase() };
  });
  if (new Set(artifacts.map((item) => item.relativePath)).size !== MANAGED_ARTIFACTS.length) throw new TypeError('Candidate preparation returned duplicate managed artifacts');
  return { recordPatch: safePatch, managedArtifacts: artifacts };
}

async function verifyArtifacts(
  root,
  expected,
  managedRoot,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = acquireWindowsFileGuard,
  filesystemEntryVerifier = assertWindowsFilesystemEntry,
) {
  if (!Array.isArray(expected) || expected.length < 1 || expected.length > MAX_UPDATE_GUARD_BATCH) {
    throw stateError('The managed artifact verification inventory is invalid');
  }
  const result = [];
  const descriptors = expected.map((item) => ({ item, target: safeRelative(root, item.relativePath) }));
  const guards = await acquireGuardBranches(
    managedRoot,
    descriptors.map(({ target }) => path.dirname(target)),
    directoryGuard,
  );
  let files = { guards: [] };
  try {
    assertGuardsHeld(guards);
    for (const descriptor of descriptors) {
      const { item, target } = descriptor;
      await filesystemEntryVerifier(target);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw stateError(`Managed artifact '${item.relativePath}' is not a regular file`);
      descriptor.stat = stat;
    }
    files = await acquireTypedGuardBatch(
      descriptors.map(({ target }) => target),
      fileGuard,
      'file',
      'A managed update artifact changed during verification',
    );
    for (let index = 0; index < descriptors.length; index += 1) {
      const { item, target, stat } = descriptors[index];
      const digest = await hashFileWithinGuard(target, stat, files.guards[index]);
      await filesystemEntryVerifier(target);
      assertGuardsHeld(guards, files.guards[index]);
      if (digest !== item.sha256) throw stateError(`Managed artifact '${item.relativePath}' failed SHA-256 verification`);
      result.push({ fileName: item.relativePath, sha256: digest, size: stat.size });
    }
    return result;
  } finally { await releaseGuards(...files.guards.reverse(), ...guards.reverse()); }
}

async function hashManagedFiles(
  root,
  managedPaths,
  managedRoot,
  directoryGuard,
  fileGuard,
  filesystemEntryVerifier,
  heldRootGuard = null,
) {
  const relativePaths = [...managedPaths];
  if (relativePaths.length < 1 || relativePaths.length > 256
    || relativePaths.some((relativePath) => !validManagedRelativePath(relativePath))) {
    throw stateError('The managed update artifact inventory is invalid or exceeds its safe limit');
  }
  relativePaths.sort((left, right) => left.localeCompare(right, 'en'));
  if (new Set(relativePaths).size !== relativePaths.length) {
    throw stateError('The managed update artifact inventory contains duplicates');
  }
  const entries = [];
  let bytes = 0;
  let files = 0;
  const rootGuards = heldRootGuard ? [] : await acquireGuardChain(managedRoot, root, directoryGuard);
  let parentDirectories = { guards: [] };
  let guardedFiles = { guards: [] };
  try {
    assertGuardsHeld(heldRootGuard, rootGuards);
    const descriptors = [];
    const directoryPaths = new Map();
    for (const relativePath of relativePaths) {
      const target = safeRelative(root, relativePath);
      let cursor = path.resolve(root);
      let missingPath = null;
      for (const part of relativePath.split('/').slice(0, -1)) {
        cursor = path.join(cursor, part);
        const before = await fs.lstat(cursor).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
        if (!before) { missingPath = cursor; break; }
        if (!before.isDirectory() || before.isSymbolicLink()) {
          throw stateError(`Managed update artifact '${relativePath}' crosses an unsafe parent`);
        }
        await filesystemEntryVerifier(cursor);
        directoryPaths.set(filesystemPathKey(cursor), cursor);
      }
      let stat = null;
      if (!missingPath) {
        stat = await fs.lstat(target).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
        if (!stat) missingPath = target;
        else if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
          || stat.size < 0 || stat.size > MAX_UPDATE_TREE_BYTES) {
          throw stateError(`Managed update artifact '${relativePath}' is not a bounded regular file`);
        }
      }
      descriptors.push({ relativePath, target, stat, missingPath });
    }
    parentDirectories = await acquireTypedGuardBatch(
      [...directoryPaths.values()],
      directoryGuard,
      'directory',
      'A managed update artifact parent changed during inventory capture',
    );
    assertGuardsHeld(heldRootGuard, rootGuards, parentDirectories.guards);
    for (const descriptor of descriptors.filter(({ missingPath }) => missingPath)) {
      const appeared = await fs.lstat(descriptor.missingPath)
        .catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
      if (appeared) throw stateError(`Managed update artifact '${descriptor.relativePath}' appeared during inventory capture`);
    }
    const present = descriptors.filter(({ stat }) => stat);
    guardedFiles = await acquireTypedGuardBatch(
      present.map(({ target }) => target),
      fileGuard,
      'file',
      'A managed update artifact changed during inventory capture',
    );
    let fileIndex = 0;
    for (const descriptor of descriptors) {
      if (!descriptor.stat) {
        const appeared = await fs.lstat(descriptor.missingPath)
          .catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
        if (appeared) throw stateError(`Managed update artifact '${descriptor.relativePath}' appeared during inventory capture`);
        entries.push({ relativePath: descriptor.relativePath, present: false, sha256: null, size: null });
        continue;
      }
      await filesystemEntryVerifier(descriptor.target);
      const sha256 = await hashFileWithinGuard(
        descriptor.target,
        descriptor.stat,
        guardedFiles.guards[fileIndex++],
      );
      await filesystemEntryVerifier(descriptor.target);
      assertGuardsHeld(heldRootGuard, rootGuards, parentDirectories.guards);
      bytes += descriptor.stat.size;
      if (bytes > MAX_UPDATE_TREE_BYTES) {
        throw stateError('The managed update artifact inventory exceeds its safe byte limit');
      }
      files += 1;
      entries.push({
        relativePath: descriptor.relativePath,
        present: true,
        sha256,
        size: descriptor.stat.size,
      });
    }
    return {
      algorithm: 'sha256',
      digest: crypto.createHash('sha256').update(canonicalJson(entries), 'utf8').digest('hex'),
      files,
      bytes,
      entries,
    };
  } finally {
    await releaseGuards(
      ...guardedFiles.guards.reverse(),
      ...parentDirectories.guards.reverse(),
      ...rootGuards.reverse(),
    );
  }
}

function missingHashTree() {
  return {
    algorithm: 'sha256',
    digest: crypto.createHash('sha256').update('MISSING\0').digest('hex'),
    files: 0,
    bytes: 0,
  };
}

function preparedLaunchTrustDigests(runtime) {
  if (!plainJsonObject(runtime) || !SHA256.test(runtime.launchAssetDigest ?? '')
    || !SHA256.test(runtime.launchInventoryDigest ?? '')) {
    throw stateError('The prepared legacy launch migration lacks authenticated target launch trust');
  }
  return {
    launchAssetDigest: runtime.launchAssetDigest.toLowerCase(),
    launchInventoryDigest: runtime.launchInventoryDigest.toLowerCase(),
  };
}

function mutableExclusionsFromMarker(marker, managedPaths) {
  const exclusions = new Set(managedPaths);
  if (marker.legacyLaunchMigration) {
    for (const root of marker.legacyLaunchMigration.roots) exclusions.add(root.relativePath);
    if (marker.legacyLaunchMigration.previousServerArtifact) {
      exclusions.add(marker.legacyLaunchMigration.previousServerArtifact.relativePath);
    }
  }
  return exclusions;
}

async function captureLegacyLaunchMigrationEvidence({
  updateKind,
  instance,
  instanceRoot,
  targetServerArtifact,
  managedRoot,
  filesystemTreeVerifier,
  filesystemEntryVerifier,
  directoryGuard,
  fileGuard,
}) {
  if (!['component', 'legacy-migration'].includes(updateKind)) return null;
  const runtime = instance.javaRuntime;
  const hasInventoryDigest = plainJsonObject(runtime) && Object.hasOwn(runtime, 'launchInventoryDigest');
  if (hasInventoryDigest) {
    if (!SHA256.test(runtime.launchInventoryDigest ?? '') || !SHA256.test(runtime.launchAssetDigest ?? '')) {
      throw stateError('The legacy update source has malformed launch-trust metadata');
    }
    return null;
  }
  if (runtime !== undefined && runtime !== null && !plainJsonObject(runtime)) {
    throw stateError('The legacy update source has malformed Java runtime metadata');
  }
  if (plainJsonObject(runtime) && Object.hasOwn(runtime, 'launchAssetDigest')
    && !SHA256.test(runtime.launchAssetDigest ?? '')) {
    throw stateError('The legacy update source has malformed launch-trust metadata');
  }
  const roots = await captureLegacyLaunchRootEvidence(
    instanceRoot,
    managedRoot,
    filesystemTreeVerifier,
    filesystemEntryVerifier,
    directoryGuard,
    fileGuard,
  );
  let previousServerArtifact = null;
  if (instance.minecraftServerArtifact !== undefined || instance.worldDataVersion !== undefined) {
    const installed = normalizeInstalledServerArtifact(instance.minecraftServerArtifact, instance.minecraftVersion);
    if (instance.worldDataVersion !== installed.worldDataVersion) {
      throw stateError('The legacy update source has invalid Minecraft compatibility metadata');
    }
    if (installed.relativePath !== targetServerArtifact.relativePath) {
      previousServerArtifact = await captureManagedFileEvidence(
        instanceRoot,
        installed,
        managedRoot,
        filesystemEntryVerifier,
        directoryGuard,
        fileGuard,
      );
    }
  }
  return {
    schemaVersion: 1,
    state: 'source-authenticated',
    sourceLaunchInventoryDigest: null,
    targetLaunchAssetDigest: null,
    targetLaunchInventoryDigest: null,
    roots,
    previousServerArtifact,
  };
}

async function captureLegacyLaunchRootEvidence(
  root,
  managedRoot,
  filesystemTreeVerifier,
  filesystemEntryVerifier,
  directoryGuard,
  fileGuard,
) {
  const guards = await acquireGuardChain(managedRoot, root, directoryGuard);
  try {
    return await captureLegacyLaunchRootEvidenceWithinHeldRoot(
      root,
      filesystemTreeVerifier,
      filesystemEntryVerifier,
      directoryGuard,
      fileGuard,
      guards.at(-1),
    );
  } finally { await releaseGuards(...guards.reverse()); }
}

async function captureLegacyLaunchRootEvidenceWithinHeldRoot(
  root,
  filesystemTreeVerifier,
  filesystemEntryVerifier,
  directoryGuard,
  fileGuard,
  rootGuard,
) {
  rootGuard.assertHeld?.();
  await filesystemEntryVerifier(root);
  const namespaceBefore = await captureMutableParentNamespace(root);
  const descriptors = [];
  for (const relativePath of LEGACY_LAUNCH_ROOTS) {
    const target = safeRelative(root, relativePath);
    const stat = await fs.lstat(target).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw stateError(`Legacy launch root '${relativePath}' is unsafe`);
    }
    descriptors.push({ relativePath, target, stat });
  }
  let directories = { guards: [] };
  try {
    directories = await acquireTypedGuardBatch(
      descriptors.filter(({ stat }) => stat).map(({ target }) => target),
      directoryGuard,
      'directory',
      'A legacy launch root changed during authenticated capture',
    );
    let directoryIndex = 0;
    for (const descriptor of descriptors) {
      if (!descriptor.stat) {
        descriptor.tree = missingHashTree();
        continue;
      }
      descriptor.tree = await hashTreeWithinHeldRoot(
        descriptor.target,
        new Set(),
        filesystemTreeVerifier,
        directoryGuard,
        fileGuard,
        directories.guards[directoryIndex++],
      );
    }
  } finally { await releaseGuards(...directories.guards.reverse()); }
  rootGuard.assertHeld?.();
  await filesystemEntryVerifier(root);
  const namespaceAfter = await captureMutableParentNamespace(root);
  if (canonicalJson(namespaceBefore.directoryIdentity) !== canonicalJson(namespaceAfter.directoryIdentity)) {
    throw stateError('The legacy launch source root changed identity during authenticated capture');
  }
  assertNamespaceMatches(
    namespaceBefore.entries,
    namespaceAfter.entries,
    'The legacy launch source namespace changed during authenticated capture',
  );
  return descriptors.map(({ relativePath, tree }) => ({ relativePath, tree }));
}

async function captureManagedFileEvidence(
  root,
  artifact,
  managedRoot,
  filesystemEntryVerifier,
  directoryGuard,
  fileGuard,
) {
  const target = safeRelative(root, artifact.relativePath);
  const guards = await acquireGuardChain(managedRoot, path.dirname(target), directoryGuard);
  let files = { guards: [] };
  try {
    await filesystemEntryVerifier(target);
    const stat = await safeTreeStat(target, 'The legacy Minecraft server artifact is unsafe', 'file');
    if (stat.size !== artifact.size) throw stateError('The legacy Minecraft server artifact size changed');
    files = await acquireTypedGuardBatch(
      [target],
      fileGuard,
      'file',
      'The legacy Minecraft server artifact changed during authenticated capture',
    );
    const digest = await hashFileWithinGuard(target, stat, files.guards[0]);
    if (digest !== artifact.sha256) throw stateError('The legacy Minecraft server artifact failed authenticated verification');
    assertGuardsHeld(guards, files.guards);
    await filesystemEntryVerifier(target);
    return { relativePath: artifact.relativePath, sha256: digest, size: stat.size };
  } finally { await releaseGuards(...files.guards.reverse(), ...guards.reverse()); }
}

async function verifyLegacyLaunchTreeEvidence(
  root,
  migration,
  managedRoot,
  filesystemTreeVerifier,
  filesystemEntryVerifier,
  directoryGuard,
  fileGuard,
) {
  const guards = await acquireGuardChain(managedRoot, root, directoryGuard);
  try {
    return await verifyLegacyLaunchTreeEvidenceWithinHeldRoot(
      root,
      migration,
      filesystemTreeVerifier,
      filesystemEntryVerifier,
      directoryGuard,
      fileGuard,
      guards.at(-1),
    );
  } finally { await releaseGuards(...guards.reverse()); }
}

async function verifyLegacyLaunchTreeEvidenceWithinHeldRoot(
  root,
  migration,
  filesystemTreeVerifier,
  filesystemEntryVerifier,
  directoryGuard,
  fileGuard,
  rootGuard,
) {
  const observedRoots = await captureLegacyLaunchRootEvidenceWithinHeldRoot(
    root,
    filesystemTreeVerifier,
    filesystemEntryVerifier,
    directoryGuard,
    fileGuard,
    rootGuard,
  );
  if (canonicalJson(observedRoots) !== canonicalJson(migration.roots)) {
    throw stateError('Legacy launch roots changed after their authenticated pre-transition capture');
  }
  if (migration.previousServerArtifact) {
    const target = safeRelative(root, migration.previousServerArtifact.relativePath);
    const parent = path.dirname(target);
    const parentGuards = await acquireDescendantGuardChainWithinHeldRoot(
      root,
      parent,
      directoryGuard,
      filesystemEntryVerifier,
      rootGuard,
    );
    let files = { guards: [] };
    try {
      const stat = await safeTreeStat(target, 'The authenticated legacy server artifact is unsafe', 'file');
      if (stat.size !== migration.previousServerArtifact.size) {
        throw stateError('The authenticated legacy server artifact size changed');
      }
      files = await acquireTypedGuardBatch(
        [target],
        fileGuard,
        'file',
        'The authenticated legacy server artifact changed before pruning',
      );
      const digest = await hashFileWithinGuard(target, stat, files.guards[0]);
      if (digest !== migration.previousServerArtifact.sha256) {
        throw stateError('The authenticated legacy server artifact digest changed');
      }
      assertGuardsHeld(rootGuard, parentGuards, files.guards);
    } finally { await releaseGuards(...files.guards.reverse(), ...parentGuards.reverse()); }
  }
  rootGuard.assertHeld?.();
  return true;
}

async function pruneLegacyLaunchCandidate(
  candidateRoot,
  migration,
  targetServerArtifact,
  managedRoot,
  filesystemEntryVerifier,
  directoryGuard,
) {
  // The authenticated legacy executable roots are deliberately never copied
  // into the candidate. Their exact source remains in the rollback backup,
  // while the trusted provisioner creates the sole target versions artifact.
  return assertLegacyLaunchCandidatePruned(
    candidateRoot,
    migration,
    targetServerArtifact,
    managedRoot,
    filesystemEntryVerifier,
    directoryGuard,
  );
}

async function assertLegacyLaunchCandidatePruned(
  candidateRoot,
  migration,
  targetServerArtifact,
  managedRoot,
  filesystemEntryVerifier,
  directoryGuard,
) {
  if (!validLegacyLaunchMigration(migration)
    || typeof targetServerArtifact !== 'string'
    || !targetServerArtifact.startsWith('versions/')) {
    throw stateError('The legacy launch candidate migration evidence is invalid');
  }
  const target = safeRelative(candidateRoot, targetServerArtifact);
  const relativeParts = targetServerArtifact.split('/');
  if (relativeParts.length !== 3) {
    throw stateError('The target Minecraft server artifact path is invalid');
  }
  const versionsRoot = path.join(candidateRoot, 'versions');
  const versionRoot = path.dirname(target);
  const guards = await acquireGuardBranches(
    managedRoot,
    [candidateRoot, versionsRoot, versionRoot],
    directoryGuard,
  );
  try {
    assertGuardsHeld(guards);
    const assertCandidateRoot = async () => {
      const entries = await safeTreeEntriesBounded(candidateRoot, MAX_UPDATE_TREE_ENTRIES);
      const names = new Set(entries.map((entry) => entry.name));
      if (names.has('.fabric') || names.has('libraries') || !names.has('versions')) {
        throw stateError('The update candidate retained a legacy executable namespace');
      }
    };
    await assertCandidateRoot();
    const versions = await safeTreeEntriesBounded(versionsRoot, 2);
    if (versions.length !== 1 || versions[0].name !== relativeParts[1]
      || !(await safeTreeStat(versionRoot, 'The target Minecraft version directory is unsafe')).isDirectory()) {
      throw stateError('The update candidate retained a non-target Minecraft version');
    }
    const artifacts = await safeTreeEntriesBounded(versionRoot, 2);
    if (artifacts.length !== 1 || artifacts[0].name !== relativeParts[2]
      || !(await safeTreeStat(target, 'The target Minecraft server artifact is unsafe')).isFile()) {
      throw stateError('The update candidate versions tree is not target-exact');
    }
    await filesystemEntryVerifier(target);
    await assertCandidateRoot();
    assertGuardsHeld(guards);
    return true;
  } finally { await releaseGuards(...guards.reverse()); }
}

async function managedMutableExclusions(instanceRoot) {
  const managed = new Set(ALWAYS_MANAGED_PATHS);
  const manifestPath = path.join(instanceRoot, 'instance.json');
  try {
    const stat = await fs.lstat(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > PRIVATE_MANIFEST_MAX_BYTES) {
      throw stateError('The private instance manifest is not a safe regular file');
    }
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (Array.isArray(manifest?.artifacts)) {
      for (const artifact of manifest.artifacts) {
        const relativePath = knownManagedArtifactPath(artifact?.fileName);
        if (relativePath) managed.add(relativePath);
      }
    }
    if (manifest?.minecraftServerArtifact !== undefined) {
      managed.add(normalizeInstalledServerArtifact(
        manifest.minecraftServerArtifact,
        validVersion(manifest.minecraftVersion, 'private manifest Minecraft version'),
      ).relativePath);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      if (error instanceof SyntaxError) throw stateError('The private instance manifest is not valid JSON');
      throw error;
    }
  }
  return managed;
}

function knownManagedArtifactPath(fileName) {
  if (typeof fileName !== 'string' || fileName.length < 5 || fileName.length > 160) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+\-]*\.jar$/i.test(fileName)) return null;
  if (/^fabric-server(?:-launch|[-_.])/i.test(fileName)) return fileName;
  if (/^(?:fabric-api|geyser(?:-fabric)?|floodgate(?:-fabric)?)(?:[-_.]|\.jar$)/i.test(fileName)) return `mods/${fileName}`;
  return null;
}

async function assertReplacedLegacyManagedArtifacts(candidateRoot, managedPaths, allowedPresentPaths = new Set()) {
  for (const relativePath of managedPaths) {
    if (ALWAYS_MANAGED_PATHS.has(relativePath) || allowedPresentPaths.has(relativePath)) continue;
    if (await exists(safeRelative(candidateRoot, relativePath))) {
      throw stateError(`Candidate preparation did not replace legacy managed artifact '${relativePath}'`);
    }
  }
}

async function levelDirectory(instanceRoot) {
  let text = '';
  try { text = await fs.readFile(path.join(instanceRoot, 'server.properties'), 'utf8'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  let value = 'world';
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*[#!]/.test(line)) continue;
    const index = line.indexOf('=');
    if (index >= 0 && line.slice(0, index).trim() === 'level-name') value = line.slice(index + 1).trim() || 'world';
  }
  value = value.replaceAll('\\', '/');
  safeRelative(instanceRoot, value);
  return value;
}

async function copyTree(
  source,
  destination,
  managedRoot,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = acquireWindowsFileGuard,
  rootExclusions = new Set(),
) {
  if (!(rootExclusions instanceof Set)
    || [...rootExclusions].some((relativePath) => !safeName(relativePath) || relativePath.includes('/'))) {
    throw new TypeError('Invalid managed update copy exclusions');
  }
  const sourceStat = await safeTreeStat(source, 'The managed server root is not a regular directory', 'directory');
  const ancestorGuards = await acquireGuardChain(managedRoot, path.dirname(destination), directoryGuard);
  let sourceRootGuard = null;
  let destinationGuard = null;
  const budget = { entries: 0, bytes: 0 };
  try {
    sourceRootGuard = await directoryGuard(source);
    await filesystemTreeVerifier(source, { maxEntries: MAX_UPDATE_TREE_ENTRIES, maxDepth: MAX_UPDATE_TREE_DEPTH });
    assertGuardsHeld(ancestorGuards, sourceRootGuard);
    if (await exists(destination)) throw stateError('The update candidate destination is already occupied');
    await fs.mkdir(destination, { recursive: false, mode: 0o700 });
    destinationGuard = await directoryGuard(destination);
    const walk = async (from, to, depth, heldFrom, heldTo) => {
      if (depth > MAX_UPDATE_TREE_DEPTH) throw stateError('Managed server state exceeds the safe update depth limit');
      heldFrom.assertHeld?.(); heldTo.assertHeld?.();
      const entries = await safeTreeEntries(from);
      for (const entryChunk of boundedChunks(entries)) {
        const descriptors = [];
        for (const entry of entryChunk) {
          if (depth === 0 && rootExclusions.has(entry.name)) continue;
          const sourcePath = path.join(from, entry.name);
          const destinationPath = path.join(to, entry.name);
          const stat = await safeTreeStat(sourcePath, 'Managed server state contains an unsafe filesystem entry');
          budget.entries += 1;
          if (budget.entries > MAX_UPDATE_TREE_ENTRIES) throw stateError('Managed server state exceeds the safe update entry limit');
          if (stat.isFile()) {
            budget.bytes += stat.size;
            if (budget.bytes > MAX_UPDATE_TREE_BYTES) throw stateError('Managed server state exceeds the safe update byte limit');
          } else if (!stat.isDirectory()) {
            throw stateError('Managed server state contains an unsupported filesystem entry');
          }
          descriptors.push({ entry, sourcePath, destinationPath, stat });
        }
        heldFrom.assertHeld?.(); heldTo.assertHeld?.();
        for (const descriptor of descriptors.filter(({ stat }) => stat.isDirectory())) {
          await fs.mkdir(descriptor.destinationPath, { recursive: false, mode: descriptor.stat.mode });
        }
        const directories = descriptors.filter(({ stat }) => stat.isDirectory());
        const files = descriptors.filter(({ stat }) => stat.isFile());
        let sourceDirectories = { guards: [] };
        let destinationDirectories = { guards: [] };
        let sourceFiles = { guards: [] };
        try {
          sourceDirectories = await acquireTypedGuardBatch(
            directories.map(({ sourcePath }) => sourcePath),
            directoryGuard,
            'directory',
            'A managed source directory changed during candidate copy',
          );
          destinationDirectories = await acquireTypedGuardBatch(
            directories.map(({ destinationPath }) => destinationPath),
            directoryGuard,
            'directory',
            'A managed candidate directory changed during copy',
          );
          sourceFiles = await acquireTypedGuardBatch(
            files.map(({ sourcePath }) => sourcePath),
            fileGuard,
            'file',
            'A managed source file changed during candidate copy',
          );
          let directoryIndex = 0;
          let fileIndex = 0;
          for (const descriptor of descriptors) {
            if (descriptor.stat.isDirectory()) {
              const fromGuard = sourceDirectories.guards[directoryIndex];
              const toGuard = destinationDirectories.guards[directoryIndex];
              directoryIndex += 1;
              await walk(descriptor.sourcePath, descriptor.destinationPath, depth + 1, fromGuard, toGuard);
              heldTo.assertHeld?.(); toGuard.assertHeld?.();
              await fs.chmod(descriptor.destinationPath, descriptor.stat.mode);
              await fs.utimes(descriptor.destinationPath, descriptor.stat.atime, descriptor.stat.mtime);
            } else {
              const sourceGuard = sourceFiles.guards[fileIndex];
              fileIndex += 1;
              await copyRegularFileWithinGuard(
                descriptor.sourcePath,
                descriptor.destinationPath,
                descriptor.stat,
                heldFrom,
                heldTo,
                sourceGuard,
              );
            }
          }
        } finally {
          await releaseGuards(
            ...sourceFiles.guards.reverse(),
            ...destinationDirectories.guards.reverse(),
            ...sourceDirectories.guards.reverse(),
          );
        }
      }
    };
    await walk(source, destination, 0, sourceRootGuard, destinationGuard);
    assertGuardsHeld(ancestorGuards, sourceRootGuard, destinationGuard);
    await filesystemTreeVerifier(source, { maxEntries: MAX_UPDATE_TREE_ENTRIES, maxDepth: MAX_UPDATE_TREE_DEPTH });
    await filesystemTreeVerifier(destination, { maxEntries: MAX_UPDATE_TREE_ENTRIES, maxDepth: MAX_UPDATE_TREE_DEPTH });
    await fs.chmod(destination, sourceStat.mode);
    await fs.utimes(destination, sourceStat.atime, sourceStat.mtime);
  } finally { await releaseGuards(destinationGuard, sourceRootGuard, ...ancestorGuards.reverse()); }
}

async function hashTree(
  root,
  exclusions = new Set(),
  managedRoot = path.dirname(root),
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = acquireWindowsFileGuard,
) {
  if (!await exists(root)) return { algorithm: 'sha256', digest: crypto.createHash('sha256').update('MISSING\0').digest('hex'), files: 0, bytes: 0 };
  const ancestors = await acquireGuardChain(managedRoot, path.dirname(root), directoryGuard);
  let rootGuard = null;
  try {
    rootGuard = await directoryGuard(root);
    const result = await hashTreeWithinHeldRoot(
      root,
      exclusions,
      filesystemTreeVerifier,
      directoryGuard,
      fileGuard,
      rootGuard,
    );
    assertGuardsHeld(ancestors, rootGuard);
    return result;
  } finally { await releaseGuards(rootGuard, ...ancestors.reverse()); }
}

async function hashTreeWithinHeldRoot(
  root,
  exclusions,
  filesystemTreeVerifier,
  directoryGuard,
  fileGuard,
  rootGuard,
) {
  rootGuard.assertHeld?.();
  await filesystemTreeVerifier(root, { maxEntries: MAX_UPDATE_TREE_ENTRIES, maxDepth: MAX_UPDATE_TREE_DEPTH });
  const records = [];
  let files = 0; let bytes = 0; let entries = 0;
  const walk = async (directory, prefix, depth, heldGuard) => {
    if (depth > MAX_UPDATE_TREE_DEPTH) throw stateError('Managed server state exceeds the safe hash depth limit');
    heldGuard.assertHeld?.();
    const directoryEntries = await safeTreeEntries(directory);
    for (const entryChunk of boundedChunks(directoryEntries)) {
      const descriptors = [];
      for (const entry of entryChunk) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (exclusions.has(relative)) continue;
        const target = path.join(directory, entry.name);
        const stat = await safeTreeStat(target, 'Managed server state contains an unsafe filesystem entry');
        entries += 1;
        if (entries > MAX_UPDATE_TREE_ENTRIES) throw stateError('Managed server state exceeds the safe hash entry limit');
        if (stat.isFile()) {
          bytes += stat.size; files += 1;
          if (bytes > MAX_UPDATE_TREE_BYTES) throw stateError('Managed server state exceeds the safe hash byte limit');
        } else if (!stat.isDirectory()) {
          throw stateError('Managed server state contains an unsupported filesystem entry');
        }
        descriptors.push({ relative, target, stat });
      }
      let directoryBatch = { guards: [] };
      let fileBatch = { guards: [] };
      try {
        directoryBatch = await acquireTypedGuardBatch(
          descriptors.filter(({ stat }) => stat.isDirectory()).map(({ target }) => target),
          directoryGuard,
          'directory',
          'A managed server directory changed during hashing',
        );
        fileBatch = await acquireTypedGuardBatch(
          descriptors.filter(({ stat }) => stat.isFile()).map(({ target }) => target),
          fileGuard,
          'file',
          'A managed server file changed during hashing',
        );
        let directoryIndex = 0;
        let fileIndex = 0;
        for (const descriptor of descriptors) {
          if (descriptor.stat.isDirectory()) {
            const managedAncestor = [...exclusions].some(
              (excluded) => excluded.startsWith(`${descriptor.relative}/`),
            );
            if (!managedAncestor) records.push(['directory', descriptor.relative]);
            const childGuard = directoryBatch.guards[directoryIndex];
            directoryIndex += 1;
            await walk(descriptor.target, descriptor.relative, depth + 1, childGuard);
          } else {
            const childGuard = fileBatch.guards[fileIndex];
            fileIndex += 1;
            const digest = await hashFileWithinGuard(descriptor.target, descriptor.stat, childGuard);
            records.push(['file', descriptor.relative, descriptor.stat.size, digest]);
          }
        }
      } finally {
        await releaseGuards(...fileBatch.guards.reverse(), ...directoryBatch.guards.reverse());
      }
    }
  };
  await walk(root, '', 0, rootGuard);
  rootGuard.assertHeld?.();
  await filesystemTreeVerifier(root, { maxEntries: MAX_UPDATE_TREE_ENTRIES, maxDepth: MAX_UPDATE_TREE_DEPTH });
  rootGuard.assertHeld?.();
  return { algorithm: 'sha256', digest: crypto.createHash('sha256').update(canonicalJson(records)).digest('hex'), files, bytes };
}

async function hashFile(file, expectedStat = null, fileGuard = acquireWindowsFileGuard) {
  const namedBefore = expectedStat ?? await safeTreeStat(file, 'Managed server state contains an unsafe file', 'file');
  const guard = await fileGuard(file);
  try { return await hashFileWithinGuard(file, namedBefore, guard); }
  finally { await releaseGuards(guard); }
}

async function hashFileWithinGuard(file, namedBefore, guard) {
  guard.assertHeld?.();
  const digest = crypto.createHash('sha256');
  const handle = await fs.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!sameFileIdentity(namedBefore, opened)) throw stateError('A managed server file changed before hashing');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (!bytesRead) throw stateError('A managed server file changed while hashing');
      digest.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const [openedAfter, namedAfter] = await Promise.all([handle.stat(), fs.lstat(file)]);
    guard.assertHeld?.();
    if (!sameFileIdentity(opened, openedAfter) || !sameFileIdentity(opened, namedAfter)) {
      throw stateError('A managed server file changed while hashing');
    }
  } finally { await handle.close(); }
  return digest.digest('hex');
}

async function copyRegularFile(source, destination, expectedStat, sourceParentGuard, destinationParentGuard, fileGuard) {
  sourceParentGuard.assertHeld?.(); destinationParentGuard.assertHeld?.();
  const sourceGuard = await fileGuard(source);
  try {
    await copyRegularFileWithinGuard(
      source,
      destination,
      expectedStat,
      sourceParentGuard,
      destinationParentGuard,
      sourceGuard,
    );
  } finally { await releaseGuards(sourceGuard); }
}

async function copyRegularFileWithinGuard(
  source,
  destination,
  expectedStat,
  sourceParentGuard,
  destinationParentGuard,
  sourceGuard,
) {
  sourceGuard.assertHeld?.(); sourceParentGuard.assertHeld?.(); destinationParentGuard.assertHeld?.();
  const input = await fs.open(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let output = null;
  try {
    const opened = await input.stat();
    if (!sameFileIdentity(expectedStat, opened)) throw stateError('A managed server file changed before copying');
    output = await fs.open(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, expectedStat.mode);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (!bytesRead) throw stateError('A managed server file changed while copying');
      let offset = 0;
      while (offset < bytesRead) {
        const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset, position + offset);
        if (!bytesWritten) throw stateError('An update candidate file could not be written completely');
        offset += bytesWritten;
      }
      position += bytesRead;
    }
    await output.chmod(expectedStat.mode); await output.sync();
    const [sourceAfter, openedAfter, copied, namedDestination] = await Promise.all([
      fs.lstat(source), input.stat(), output.stat(), fs.lstat(destination),
    ]);
    sourceGuard.assertHeld?.(); sourceParentGuard.assertHeld?.(); destinationParentGuard.assertHeld?.();
    if (!sameFileIdentity(opened, sourceAfter) || !sameFileIdentity(opened, openedAfter)
      || !sameFileIdentity(copied, namedDestination) || copied.size !== opened.size) {
      throw stateError('A managed server source or candidate file changed while copying');
    }
  } catch (error) {
    // Never remove a pathname after a failed copy unless its exact object can
    // still be proven. The fenced candidate is safer than deleting a raced entry.
    throw error;
  } finally {
    await output?.close().catch(() => undefined);
    await input.close().catch(() => undefined);
  }
  await fs.utimes(destination, expectedStat.atime, expectedStat.mtime);
}

async function safeTreeEntries(directory) {
  return safeTreeEntriesBounded(directory, MAX_UPDATE_TREE_ENTRIES);
}

async function safeTreeEntriesBounded(directory, maxEntries) {
  if (!Number.isInteger(maxEntries) || maxEntries < 0) throw new TypeError('Invalid bounded directory entry limit');
  const entries = [];
  const folded = new Set();
  const handle = await fs.opendir(directory);
  for await (const entry of handle) {
    if (entries.length >= maxEntries) throw stateError('Managed update namespace exceeds its safe entry limit');
    if (!safeName(entry.name)) throw stateError('Managed update namespace contains an unsafe filename');
    const key = entry.name.normalize('NFKC').toLocaleLowerCase('en-US');
    if (folded.has(key)) throw stateError('Managed update namespace contains a colliding filename');
    folded.add(key); entries.push(entry);
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  return entries;
}

async function safeTreeStat(target, message, expectedKind = null) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || (stat.isFile() && Number.isInteger(stat.nlink) && stat.nlink !== 1)) throw stateError(message);
  if (expectedKind === 'directory' && !stat.isDirectory()) throw stateError(message);
  if (expectedKind === 'file' && !stat.isFile()) throw stateError(message);
  return stat;
}

function sameFileIdentity(left, right) {
  return left?.isFile?.() === true && right?.isFile?.() === true && left.nlink === 1 && right.nlink === 1
    && left.size === right.size && left.mtimeMs === right.mtimeMs
    && (!left.ino || !right.ino || (left.dev === right.dev && left.ino === right.ino));
}

function sameDirectoryIdentity(left, right) {
  return left?.isDirectory?.() === true && right?.isDirectory?.() === true
    && (!left.ino || !right.ino || (left.dev === right.dev && left.ino === right.ino));
}

async function readManagedDirectoryIdentity(target, managedRoot, directoryGuard, filesystemEntryVerifier) {
  const guards = await acquireGuardChain(managedRoot, target, directoryGuard);
  try {
    assertGuardsHeld(guards);
    await filesystemEntryVerifier(target);
    return managedDirectoryIdentity(await fs.lstat(target, { bigint: true }));
  } finally { await releaseGuards(...guards.reverse()); }
}

function managedDirectoryIdentity(stat) {
  if (!stat?.isDirectory?.() || stat.isSymbolicLink() || stat.ino <= 0n || stat.dev < 0n
    || typeof stat.birthtimeNs !== 'bigint' || stat.birthtimeNs < 0n) {
    throw stateError('The canonical server directory has no stable filesystem identity');
  }
  return {
    dev: stat.dev.toString(10),
    ino: stat.ino.toString(10),
    birthtimeNs: stat.birthtimeNs.toString(10),
  };
}

function boundedChunks(values, size = MAX_UPDATE_GUARD_BATCH) {
  if (!Array.isArray(values) || !Number.isInteger(size) || size < 1 || size > MAX_UPDATE_GUARD_BATCH) {
    throw new TypeError('Invalid managed update batch');
  }
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function acquireTypedGuardBatch(paths, guardFactory, expectedKind, message) {
  if (!Array.isArray(paths) || paths.length > MAX_UPDATE_TREE_ENTRIES
    || !['directory', 'file'].includes(expectedKind) || typeof guardFactory !== 'function') {
    throw new TypeError('Invalid managed update guard batch');
  }
  if (paths.length === 0) return { guards: [], stats: [] };
  const resolved = paths.map((target) => path.resolve(target));
  if (new Set(resolved.map(filesystemPathKey)).size !== resolved.length) {
    throw stateError('A managed update guard batch contains duplicate paths');
  }
  const guards = [];
  const stats = [];
  try {
    for (const chunk of boundedChunks(resolved)) {
      const expected = [];
      for (const target of chunk) expected.push(await safeTreeStat(target, message, expectedKind));
      const batch = chunk.length > 1 && typeof guardFactory.batch === 'function'
        ? await guardFactory.batch(chunk)
        : null;
      if (batch && (!Array.isArray(batch) || batch.length !== chunk.length)) {
        if (Array.isArray(batch)) {
          await releaseGuards(...batch.filter((guard) => guard && typeof guard.release === 'function').reverse());
        }
        throw stateError('A managed update guard batch is invalid');
      }
      const chunkGuards = [];
      try {
        for (let index = 0; index < chunk.length; index += 1) {
          const target = chunk[index];
          const guard = batch ? batch[index] : await guardFactory(target);
          if (!guard || typeof guard.release !== 'function') {
            throw stateError('A managed update filesystem guard is unavailable');
          }
          guard.assertHeld?.();
          const checked = await safeTreeStat(target, message, expectedKind);
          const stable = expectedKind === 'directory'
            ? sameDirectoryIdentity(expected[index], checked)
            : sameFileIdentity(expected[index], checked);
          if (!stable) throw stateError('A managed update entry changed while it was being guarded');
          if (expectedKind === 'directory' && (typeof guard === 'object' || typeof guard === 'function')) {
            DIRECTORY_GUARD_PATHS.set(guard, target);
          }
          chunkGuards.push(guard);
          guards.push(guard);
          stats.push(expected[index]);
        }
      } catch (error) {
        const peers = Array.isArray(batch) ? batch : chunkGuards;
        await releaseGuards(...peers.filter((guard) => guard && typeof guard.release === 'function').reverse());
        for (const guard of chunkGuards) {
          const position = guards.lastIndexOf(guard);
          if (position >= 0) {
            guards.splice(position, 1);
            stats.splice(position, 1);
          }
        }
        throw error;
      }
    }
    return { guards, stats };
  } catch (error) {
    await releaseGuards(...guards.reverse());
    throw error;
  }
}

async function acquireGuardChain(root, target, directoryGuard) {
  return acquireGuardBranches(root, [target], directoryGuard);
}

async function acquireGuardBranches(root, targets, directoryGuard) {
  const boundary = path.resolve(root);
  const wanted = new Map([[process.platform === 'win32' ? boundary.toLowerCase() : boundary, boundary]]);
  for (const target of targets) {
    const resolved = path.resolve(target); const relative = path.relative(boundary, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw stateError('A managed update path escaped its anchored boundary');
    }
    let cursor = boundary;
    for (const part of relative ? relative.split(path.sep) : []) {
      if (!safeName(part)) throw stateError('A managed update path contains an unsafe name');
      cursor = path.join(cursor, part);
      wanted.set(process.platform === 'win32' ? cursor.toLowerCase() : cursor, cursor);
    }
  }
  const ordered = [...wanted.values()].sort((left, right) => {
    const depth = path.relative(boundary, left).split(path.sep).filter(Boolean).length
      - path.relative(boundary, right).split(path.sep).filter(Boolean).length;
    return depth || left.localeCompare(right, 'en');
  });
  const guards = [];
  try {
    const borrowedRoot = borrowAuthenticatedMutationRoot(boundary);
    const ownedPaths = borrowedRoot ? ordered.filter((target) => guardedPathKey(target) !== guardedPathKey(boundary)) : ordered;
    const acquired = await acquireTypedGuardBatch(
      ownedPaths,
      directoryGuard,
      'directory',
      'A managed update directory chain is unsafe',
    );
    let ownedIndex = 0;
    for (const target of ordered) {
      guards.push(borrowedRoot && guardedPathKey(target) === guardedPathKey(boundary)
        ? borrowedRoot
        : acquired.guards[ownedIndex++]);
    }
    return guards;
  } catch (error) {
    await releaseGuards(...guards.reverse());
    throw error;
  }
}

function borrowAuthenticatedMutationRoot(root) {
  const active = AUTHENTICATED_MUTATION_ROOT.getStore();
  const resolved = path.resolve(root);
  if (!active || guardedPathKey(active.root) !== guardedPathKey(resolved)) return null;
  active.guard.assertHeld?.();
  const borrowed = {
    get identity() { return active.guard.identity; },
    assertHeld() { active.guard.assertHeld?.(); },
    async release() {},
  };
  DIRECTORY_GUARD_PATHS.set(borrowed, resolved);
  return borrowed;
}

async function acquireDescendantGuardChainWithinHeldRoot(
  root,
  target,
  directoryGuard,
  filesystemEntryVerifier,
  rootGuard,
) {
  const boundary = path.resolve(root);
  const resolved = path.resolve(target);
  const relative = path.relative(boundary, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    if (!relative) return [];
    throw stateError('A held update path escaped its verified directory root');
  }
  rootGuard.assertHeld?.();
  const guards = [];
  let cursor = boundary;
  try {
    const paths = [];
    for (const part of relative.split(path.sep)) {
      if (!safeName(part)) throw stateError('A held update path contains an unsafe name');
      cursor = path.join(cursor, part);
      await filesystemEntryVerifier(cursor);
      paths.push(cursor);
    }
    const acquired = await acquireTypedGuardBatch(
      paths,
      directoryGuard,
      'directory',
      'A held update directory chain is unsafe',
    );
    guards.push(...acquired.guards);
    for (const targetPath of paths) await filesystemEntryVerifier(targetPath);
    rootGuard.assertHeld?.();
    return guards;
  } catch (error) {
    await releaseGuards(...guards.reverse());
    throw error;
  }
}

function assertGuardsHeld(...items) {
  for (const item of items.flat(Infinity)) item?.assertHeld?.();
}

function guardedPathKey(target) {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function exactNamespaceEntryIdentity(stat) {
  if (stat?.isSymbolicLink?.() || (!stat?.isDirectory?.() && !stat?.isFile?.())
    || (stat.isFile() && stat.nlink !== 1n)) {
    throw stateError('A mutable update namespace contains an unsafe entry');
  }
  return JSON.stringify([
    stat.isDirectory() ? 'directory' : 'file',
    String(stat.dev),
    String(stat.ino),
    stat.isFile() ? String(stat.size) : '',
    String(stat.nlink),
  ]);
}

async function captureMutableParentNamespace(directory, maxEntries = MAX_UPDATE_TREE_ENTRIES) {
  const directoryIdentity = managedDirectoryIdentity(await fs.lstat(directory, { bigint: true }));
  const entries = new Map();
  const folded = new Set();
  const handle = await fs.opendir(directory);
  for await (const entry of handle) {
    if (entries.size >= maxEntries) throw stateError('A mutable update namespace exceeds its safe entry limit');
    if (!safeName(entry.name)) throw stateError('A mutable update namespace contains an unsafe filename');
    const foldedName = entry.name.normalize('NFKC').toLocaleLowerCase('en-US');
    if (folded.has(foldedName)) throw stateError('A mutable update namespace contains a colliding filename');
    folded.add(foldedName);
    const target = path.join(directory, entry.name);
    entries.set(entry.name, exactNamespaceEntryIdentity(await fs.lstat(target, { bigint: true })));
  }
  return { directoryIdentity, entries };
}

function namespaceAfterTransition(before, changes) {
  const expected = new Map(before.entries);
  for (const change of changes) {
    if (change.remove) {
      const observed = expected.get(change.remove.name);
      if (observed === undefined || (change.remove.identity !== undefined && observed !== change.remove.identity)) {
        throw stateError('A mutable update namespace did not contain the expected source identity');
      }
      expected.delete(change.remove.name);
    }
    if (change.add) expected.set(change.add.name, change.add.identity);
  }
  return expected;
}

function assertNamespaceMatches(expected, observed, message) {
  if (expected.size !== observed.size) throw stateError(message);
  for (const [name, identity] of expected) {
    if (observed.get(name) !== identity) throw stateError(message);
  }
}

async function mutateWithinReleasedParents({
  guards,
  parentDirectories,
  directoryGuard,
  filesystemEntryVerifier,
  mutate,
  verify,
}) {
  if (!Array.isArray(guards) || typeof mutate !== 'function' || typeof verify !== 'function') {
    throw new TypeError('Invalid mutable-parent publication contract');
  }
  const uniqueParents = [...new Map(parentDirectories.map((directory) => {
    const resolved = path.resolve(directory);
    return [guardedPathKey(resolved), resolved];
  })).values()];
  for (let left = 0; left < uniqueParents.length; left += 1) {
    for (let right = left + 1; right < uniqueParents.length; right += 1) {
      const relative = path.relative(uniqueParents[left], uniqueParents[right]);
      const reverse = path.relative(uniqueParents[right], uniqueParents[left]);
      if ((relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
        || (reverse && reverse !== '..' && !reverse.startsWith(`..${path.sep}`) && !path.isAbsolute(reverse))) {
        throw stateError('Nested mutable update parents cannot be released together');
      }
    }
  }

  const records = [];
  for (const directory of uniqueParents) {
    const key = guardedPathKey(directory);
    const index = guards.findIndex((guard) => {
      const guardedPath = guard && DIRECTORY_GUARD_PATHS.get(guard);
      return guardedPath !== undefined && guardedPathKey(guardedPath) === key;
    });
    if (index < 0) throw stateError('A mutable update parent is missing its exact directory guard');
    const parentKey = guardedPathKey(path.dirname(directory));
    const parentGuard = guards.find((guard) => {
      const guardedPath = guard && DIRECTORY_GUARD_PATHS.get(guard);
      return guardedPath !== undefined && guardedPathKey(guardedPath) === parentKey;
    });
    if (!parentGuard) throw stateError('A mutable update parent is missing its anchored parent guard');
    assertGuardsHeld(guards, parentGuard);
    await filesystemEntryVerifier(directory);
    const before = await captureMutableParentNamespace(directory);
    records.push({ directory, key, index, guard: guards[index], parentGuard, before, after: null });
  }

  const released = [];
  try {
    for (const record of records) {
      assertGuardsHeld(record.parentGuard, record.guard);
      await record.guard.release();
      guards[record.index] = null;
      released.push(record);
    }
  } catch (error) {
    let reboundError = null;
    for (const record of released.reverse()) {
      try {
        const rebound = await directoryGuard(record.directory);
        DIRECTORY_GUARD_PATHS.set(rebound, record.directory);
        guards[record.index] = rebound;
      } catch (rebindError) { reboundError ??= rebindError; }
    }
    if (reboundError) throw new AggregateError([error, reboundError], 'A mutable update parent could not be rebound');
    throw error;
  }

  let value;
  let mutationError = null;
  try { value = await mutate(new Map(records.map((record) => [record.key, record.before]))); }
  catch (error) { mutationError = error; }

  let rebindError = null;
  for (const record of records) {
    try {
      assertGuardsHeld(record.parentGuard);
      const rebound = await directoryGuard(record.directory); rebound.assertHeld?.();
      DIRECTORY_GUARD_PATHS.set(rebound, record.directory);
      guards[record.index] = rebound;
      await filesystemEntryVerifier(record.directory);
      record.after = await captureMutableParentNamespace(record.directory);
      if (canonicalJson(record.after.directoryIdentity) !== canonicalJson(record.before.directoryIdentity)) {
        throw stateError('A mutable update parent changed identity during guarded publication');
      }
    } catch (error) { rebindError ??= error; }
  }
  if (mutationError && rebindError) {
    throw new AggregateError([mutationError, rebindError], 'A guarded update mutation failed and its parent could not be rebound');
  }
  if (rebindError) throw rebindError;
  if (mutationError) throw mutationError;
  await verify(new Map(records.map((record) => [record.key, { before: record.before, after: record.after }])));
  return value;
}

async function releaseGuards(...guards) {
  let firstError = null;
  for (const guard of guards) {
    if (!guard) continue;
    try { await guard.release(); } catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
}

async function localDirectoryGuard(directory) {
  const before = await fs.lstat(directory);
  if (!before.isDirectory() || before.isSymbolicLink()) throw stateError('A managed directory guard target is unsafe');
  return {
    assertHeld() {}, async release() {},
    async rename(destination) { await fs.rename(directory, destination); },
    async delete() { await fs.rmdir(directory); },
  };
}

async function localFileGuard(file) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw stateError('A managed file guard target is unsafe');
  return {
    assertHeld() {}, async release() {}, async delete() { await fs.unlink(file); },
    async rename(destination) { await fs.rename(file, destination); },
    async replace(destination) {
      // The local guard is a test/non-Windows fallback. Windows production uses
      // the native handle replacement primitive, while its test fallback must
      // remove the old name because fs.rename does not replace it on Windows.
      if (process.platform === 'win32') await fs.rm(destination, { force: true });
      await fs.rename(file, destination);
    },
  };
}

async function ensureAnchoredDirectory(root, target, directoryGuard = acquireWindowsDirectoryGuard) {
  const boundary = path.resolve(root); const resolved = path.resolve(target);
  const relative = path.relative(boundary, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw stateError('A managed update state path escaped its anchored boundary');
  }
  let cursor = boundary;
  const guards = [];
  try {
    guards.push(borrowAuthenticatedMutationRoot(cursor) ?? await directoryGuard(cursor));
    for (const part of relative.split(path.sep)) {
      if (!safeName(part)) throw stateError('A managed update state path contains an unsafe name');
      const parentGuard = guards.at(-1); parentGuard.assertHeld?.();
      cursor = path.join(cursor, part);
      let stat = await fs.lstat(cursor).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
      if (!stat) {
        await fs.mkdir(cursor, { recursive: false, mode: 0o700 });
        stat = await fs.lstat(cursor);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw stateError('A managed update state parent is unsafe');
      guards.push(await directoryGuard(cursor));
    }
  } finally { await releaseGuards(...guards.reverse()); }
}

async function removeEmptyManagedDirectory(target, managedRoot, directoryGuard, filesystemEntryVerifier = async () => undefined) {
  if (!await exists(target)) return false;
  const parent = path.dirname(path.resolve(target));
  const ancestors = await acquireGuardChain(managedRoot, parent, directoryGuard);
  let guard = null;
  try {
    const before = await safeTreeStat(target, 'An empty update admission directory is unsafe', 'directory');
    guard = await directoryGuard(target); guard.assertHeld?.();
    const checked = await fs.lstat(target);
    if (!sameDirectoryIdentity(before, checked)) throw stateError('An update admission directory changed before cleanup');
    if ((await safeTreeEntriesBounded(target, 1)).length !== 0) return false;
    if (typeof guard.delete !== 'function') throw stateError('The update admission directory cannot be removed safely');
    await mutateWithinReleasedParents({
      guards: ancestors,
      parentDirectories: [parent],
      directoryGuard,
      filesystemEntryVerifier,
      mutate: async () => { await guard.delete(); guard = null; },
      verify: async (snapshots) => {
        const snapshot = snapshots.get(guardedPathKey(parent));
        const sourceName = path.basename(target);
        const sourceIdentity = snapshot.before.entries.get(sourceName);
        const expected = namespaceAfterTransition(snapshot.before, [{ remove: { name: sourceName, identity: sourceIdentity } }]);
        assertNamespaceMatches(expected, snapshot.after.entries, 'The empty update admission directory changed during guarded cleanup');
      },
    });
    return true;
  } finally { await releaseGuards(guard, ...ancestors.reverse()); }
}

async function moveManagedDirectory(
  source,
  destination,
  managedRoot,
  directoryGuard = acquireWindowsDirectoryGuard,
  beforeRename = null,
  filesystemEntryVerifier = async () => undefined,
) {
  if (beforeRename !== null && typeof beforeRename !== 'function') throw new TypeError('beforeRename must be a function');
  const sourceParent = path.dirname(path.resolve(source)); const destinationParent = path.dirname(path.resolve(destination));
  const ancestors = await acquireGuardBranches(managedRoot, [sourceParent, destinationParent], directoryGuard);
  let sourceGuard = null;
  try {
    const before = await safeTreeStat(source, 'The managed update publication source is unsafe', 'directory');
    if (await exists(destination)) throw stateError('The managed update publication destination is occupied');
    sourceGuard = await directoryGuard(source); assertGuardsHeld(ancestors, sourceGuard);
    const held = await fs.lstat(source);
    if (!sameDirectoryIdentity(before, held) || typeof sourceGuard.rename !== 'function') {
      throw stateError('The managed update publication source changed before its move');
    }
    if (beforeRename) {
      await beforeRename({ sourceGuard, ancestorGuards: ancestors });
      assertGuardsHeld(ancestors, sourceGuard);
      const checked = await fs.lstat(source);
      if (!sameDirectoryIdentity(before, checked) || await exists(destination)) {
        throw stateError('The managed update publication source changed during final verification');
      }
    }
    await mutateWithinReleasedParents({
      guards: ancestors,
      parentDirectories: [sourceParent, destinationParent],
      directoryGuard,
      filesystemEntryVerifier,
      mutate: async () => { await sourceGuard.rename(path.resolve(destination)); sourceGuard = null; },
      verify: async (snapshots) => {
        const sourceSnapshot = snapshots.get(guardedPathKey(sourceParent));
        const destinationSnapshot = snapshots.get(guardedPathKey(destinationParent));
        const sourceName = path.basename(source);
        const destinationName = path.basename(destination);
        const sourceIdentity = sourceSnapshot.before.entries.get(sourceName);
        if (sourceIdentity === undefined || destinationSnapshot.before.entries.has(destinationName)) {
          throw stateError('The managed update publication namespace changed before its move');
        }
        if (sourceSnapshot === destinationSnapshot) {
          const expected = namespaceAfterTransition(sourceSnapshot.before, [
            { remove: { name: sourceName, identity: sourceIdentity } },
            { add: { name: destinationName, identity: sourceIdentity } },
          ]);
          assertNamespaceMatches(expected, sourceSnapshot.after.entries, 'The managed update publication namespace changed during its move');
        } else {
          const sourceExpected = namespaceAfterTransition(sourceSnapshot.before, [{ remove: { name: sourceName, identity: sourceIdentity } }]);
          const destinationExpected = namespaceAfterTransition(destinationSnapshot.before, [{ add: { name: destinationName, identity: sourceIdentity } }]);
          assertNamespaceMatches(sourceExpected, sourceSnapshot.after.entries, 'The managed update source namespace changed during its move');
          assertNamespaceMatches(destinationExpected, destinationSnapshot.after.entries, 'The managed update destination namespace changed during its move');
        }
      },
    });
    assertGuardsHeld(ancestors);
    const moved = await fs.lstat(destination);
    if (!sameDirectoryIdentity(before, moved) || await exists(source)) {
      throw stateError('The managed update publication move did not preserve its source identity');
    }
  } finally { await releaseGuards(sourceGuard, ...ancestors.reverse()); }
}

async function restoreManagedDirectory(
  current,
  failedCandidate,
  backup,
  managedRoot,
  directoryGuard,
  verifyBackup,
  filesystemEntryVerifier = async () => undefined,
) {
  if (typeof verifyBackup !== 'function') throw new TypeError('verifyBackup must be a function');
  const ancestors = await acquireGuardBranches(
    managedRoot,
    [path.dirname(path.resolve(current)), path.dirname(path.resolve(failedCandidate)), path.dirname(path.resolve(backup))],
    directoryGuard,
  );
  let currentGuard = null;
  let backupGuard = null;
  try {
    const currentBefore = await safeTreeStat(current, 'The current update tree is unsafe during rollback', 'directory');
    const backupBefore = await safeTreeStat(backup, 'The retained rollback tree is unsafe', 'directory');
    if (await exists(failedCandidate)) throw stateError('A failed candidate archive already exists; refusing to overwrite it');
    currentGuard = await directoryGuard(current);
    backupGuard = await directoryGuard(backup);
    assertGuardsHeld(ancestors, currentGuard, backupGuard);
    const [currentHeld, backupHeld] = await Promise.all([fs.lstat(current), fs.lstat(backup)]);
    if (!sameDirectoryIdentity(currentBefore, currentHeld)
      || !sameDirectoryIdentity(backupBefore, backupHeld)
      || typeof currentGuard.rename !== 'function' || typeof backupGuard.rename !== 'function') {
      throw stateError('An update rollback directory changed before its guarded restore');
    }
    await verifyBackup({ backupGuard, currentGuard, ancestorGuards: ancestors });
    assertGuardsHeld(ancestors, currentGuard, backupGuard);
    const [currentChecked, backupChecked] = await Promise.all([fs.lstat(current), fs.lstat(backup)]);
    if (!sameDirectoryIdentity(currentBefore, currentChecked)
      || !sameDirectoryIdentity(backupBefore, backupChecked)
      || await exists(failedCandidate)) {
      throw stateError('An update rollback directory changed during held source verification');
    }
    const currentParent = path.dirname(path.resolve(current));
    const failedParent = path.dirname(path.resolve(failedCandidate));
    const backupParent = path.dirname(path.resolve(backup));
    await mutateWithinReleasedParents({
      guards: ancestors,
      parentDirectories: [currentParent, failedParent, backupParent],
      directoryGuard,
      filesystemEntryVerifier,
      mutate: async () => {
        await currentGuard.rename(path.resolve(failedCandidate)); currentGuard = null;
        await backupGuard.rename(path.resolve(current)); backupGuard = null;
      },
      verify: async (snapshots) => {
        const currentSnapshot = snapshots.get(guardedPathKey(currentParent));
        const failedSnapshot = snapshots.get(guardedPathKey(failedParent));
        const backupSnapshot = snapshots.get(guardedPathKey(backupParent));
        const currentName = path.basename(current);
        const failedName = path.basename(failedCandidate);
        const backupName = path.basename(backup);
        const currentIdentity = currentSnapshot.before.entries.get(currentName);
        const backupIdentity = backupSnapshot.before.entries.get(backupName);
        if (currentIdentity === undefined || backupIdentity === undefined || failedSnapshot.before.entries.has(failedName)) {
          throw stateError('The update rollback namespace changed before its guarded restore');
        }
        const expectedByKey = new Map();
        for (const [key, snapshot] of snapshots) expectedByKey.set(key, new Map(snapshot.before.entries));
        expectedByKey.get(guardedPathKey(currentParent)).delete(currentName);
        expectedByKey.get(guardedPathKey(failedParent)).set(failedName, currentIdentity);
        expectedByKey.get(guardedPathKey(backupParent)).delete(backupName);
        expectedByKey.get(guardedPathKey(currentParent)).set(currentName, backupIdentity);
        for (const [key, expected] of expectedByKey) {
          assertNamespaceMatches(expected, snapshots.get(key).after.entries, 'The update rollback namespace changed during guarded restore');
        }
      },
    });
    assertGuardsHeld(ancestors);
    const displaced = await fs.lstat(failedCandidate);
    if (!sameDirectoryIdentity(currentBefore, displaced) || await exists(backup)) {
      throw stateError('The current update tree was not displaced with its verified identity');
    }
    const restored = await fs.lstat(current);
    if (!sameDirectoryIdentity(backupBefore, restored) || await exists(backup)) {
      throw stateError('The rollback backup was not restored with its verified identity');
    }
  } finally { await releaseGuards(backupGuard, currentGuard, ...ancestors.reverse()); }
}

async function moveManagedFile(
  source,
  destination,
  managedRoot,
  directoryGuard,
  fileGuard,
  filesystemEntryVerifier = async () => undefined,
) {
  const sourceParent = path.dirname(path.resolve(source)); const destinationParent = path.dirname(path.resolve(destination));
  const ancestors = await acquireGuardBranches(managedRoot, [sourceParent, destinationParent], directoryGuard);
  let guard = null;
  try {
    const before = await safeTreeStat(source, 'The managed update file move source is unsafe', 'file');
    if (await exists(destination)) throw stateError('The managed update file move destination is occupied');
    guard = await fileGuard(source); assertGuardsHeld(ancestors, guard);
    const held = await fs.lstat(source);
    if (!sameFileIdentity(before, held) || typeof guard.rename !== 'function') throw stateError('A managed update file changed before its move');
    await mutateWithinReleasedParents({
      guards: ancestors,
      parentDirectories: [sourceParent, destinationParent],
      directoryGuard,
      filesystemEntryVerifier,
      mutate: async () => { await guard.rename(path.resolve(destination)); guard = null; },
      verify: async (snapshots) => {
        const sourceSnapshot = snapshots.get(guardedPathKey(sourceParent));
        const destinationSnapshot = snapshots.get(guardedPathKey(destinationParent));
        const sourceName = path.basename(source);
        const destinationName = path.basename(destination);
        const sourceIdentity = sourceSnapshot.before.entries.get(sourceName);
        if (sourceIdentity === undefined || destinationSnapshot.before.entries.has(destinationName)) {
          throw stateError('The managed update file namespace changed before its move');
        }
        if (sourceSnapshot === destinationSnapshot) {
          const expected = namespaceAfterTransition(sourceSnapshot.before, [
            { remove: { name: sourceName, identity: sourceIdentity } },
            { add: { name: destinationName, identity: sourceIdentity } },
          ]);
          assertNamespaceMatches(expected, sourceSnapshot.after.entries, 'The managed update file namespace changed during its move');
        } else {
          assertNamespaceMatches(
            namespaceAfterTransition(sourceSnapshot.before, [{ remove: { name: sourceName, identity: sourceIdentity } }]),
            sourceSnapshot.after.entries,
            'The managed update file source namespace changed during its move',
          );
          assertNamespaceMatches(
            namespaceAfterTransition(destinationSnapshot.before, [{ add: { name: destinationName, identity: sourceIdentity } }]),
            destinationSnapshot.after.entries,
            'The managed update file destination namespace changed during its move',
          );
        }
      },
    });
    const moved = await fs.lstat(destination);
    if (!sameFileIdentity(before, moved) || await exists(source)) throw stateError('A managed update file move changed its verified identity');
  } finally { await releaseGuards(guard, ...ancestors.reverse()); }
}

async function removeManagedTree(
  target,
  managedRoot,
  filesystemTreeVerifier,
  directoryGuard,
  fileGuard,
  filesystemEntryVerifier = async () => undefined,
) {
  const parent = path.dirname(path.resolve(target));
  const ancestors = await acquireGuardChain(managedRoot, parent, directoryGuard);
  const tombstone = managedTreeTombstone(target);
  let targetGuard = null; let rootGuard = null;
  try {
    const targetPresent = await exists(target);
    const tombstonePresent = await exists(tombstone);
    if (targetPresent && tombstonePresent) {
      throw stateError('The managed cleanup tree and its deterministic tombstone both exist');
    }
    if (!targetPresent && !tombstonePresent) return false;
    let isolated;
    if (targetPresent) {
      const before = await safeTreeStat(target, 'The managed cleanup tree is unsafe', 'directory');
      targetGuard = await directoryGuard(target); assertGuardsHeld(ancestors, targetGuard);
      const held = await fs.lstat(target);
      if (!sameDirectoryIdentity(before, held) || typeof targetGuard.rename !== 'function') {
        throw stateError('The managed cleanup tree changed before isolation');
      }
      await mutateWithinReleasedParents({
        guards: ancestors,
        parentDirectories: [parent],
        directoryGuard,
        filesystemEntryVerifier,
        mutate: async () => { await targetGuard.rename(tombstone); targetGuard = null; },
        verify: async (snapshots) => {
          const snapshot = snapshots.get(guardedPathKey(parent));
          const targetName = path.basename(target);
          const tombstoneName = path.basename(tombstone);
          const targetIdentity = snapshot.before.entries.get(targetName);
          if (targetIdentity === undefined || snapshot.before.entries.has(tombstoneName)) {
            throw stateError('The managed cleanup namespace changed before isolation');
          }
          const expected = namespaceAfterTransition(snapshot.before, [
            { remove: { name: targetName, identity: targetIdentity } },
            { add: { name: tombstoneName, identity: targetIdentity } },
          ]);
          assertNamespaceMatches(expected, snapshot.after.entries, 'The managed cleanup namespace changed during isolation');
        },
      });
      isolated = await fs.lstat(tombstone);
      if (!sameDirectoryIdentity(before, isolated) || await exists(target)) {
        throw stateError('The managed cleanup tree changed while being isolated');
      }
    } else {
      isolated = await safeTreeStat(tombstone, 'The managed cleanup tombstone is unsafe', 'directory');
    }
    rootGuard = await directoryGuard(tombstone);
    DIRECTORY_GUARD_PATHS.set(rootGuard, path.resolve(tombstone));
    rootGuard.assertHeld?.();
    const heldTombstone = await fs.lstat(tombstone);
    if (!sameDirectoryIdentity(isolated, heldTombstone)) {
      throw stateError('The managed cleanup tombstone changed before deletion');
    }
    await filesystemTreeVerifier(tombstone, { maxEntries: MAX_UPDATE_TREE_ENTRIES, maxDepth: MAX_UPDATE_TREE_DEPTH });
    const budget = { entries: 0, bytes: 0 };
    const erase = async (directory, guardChain, depth) => {
      if (depth > MAX_UPDATE_TREE_DEPTH) throw stateError('Managed cleanup exceeds the safe depth limit');
      assertGuardsHeld(guardChain);
      const remaining = MAX_UPDATE_TREE_ENTRIES - budget.entries;
      const directoryEntries = await safeTreeEntriesBounded(directory, remaining);
      for (const entryChunk of boundedChunks(directoryEntries)) {
        const descriptors = [];
        for (const entry of entryChunk) {
          budget.entries += 1;
          if (budget.entries > MAX_UPDATE_TREE_ENTRIES) throw stateError('Managed cleanup exceeds the safe entry limit');
          const entryPath = path.join(directory, entry.name);
          const stat = await safeTreeStat(entryPath, 'Managed cleanup contains an unsafe entry');
          if (stat.isFile()) {
            budget.bytes += stat.size;
            if (budget.bytes > MAX_UPDATE_TREE_BYTES) throw stateError('Managed cleanup exceeds the safe byte limit');
          } else if (!stat.isDirectory()) {
            throw stateError('Managed cleanup contains an unsupported entry');
          }
          descriptors.push({ entry, entryPath, stat, guard: null });
        }
        let directoryBatch = { guards: [] };
        let fileBatch = { guards: [] };
        try {
          directoryBatch = await acquireTypedGuardBatch(
            descriptors.filter(({ stat }) => stat.isDirectory()).map(({ entryPath }) => entryPath),
            directoryGuard,
            'directory',
            'A managed cleanup directory changed before deletion',
          );
          fileBatch = await acquireTypedGuardBatch(
            descriptors.filter(({ stat }) => stat.isFile()).map(({ entryPath }) => entryPath),
            fileGuard,
            'file',
            'A managed cleanup file changed before deletion',
          );
          let directoryIndex = 0;
          let fileIndex = 0;
          for (const descriptor of descriptors) {
            descriptor.guard = descriptor.stat.isDirectory()
              ? directoryBatch.guards[directoryIndex++]
              : fileBatch.guards[fileIndex++];
          }
          for (const descriptor of descriptors) {
            let childGuard = descriptor.guard;
            childGuard.assertHeld?.();
            if (typeof childGuard.delete !== 'function') {
              throw stateError('A managed cleanup entry cannot be deleted safely');
            }
            if (descriptor.stat.isDirectory()) {
              const childGuardChain = [...guardChain, childGuard];
              try { await erase(descriptor.entryPath, childGuardChain, depth + 1); }
              finally {
                childGuard = childGuardChain.at(-1);
                descriptor.guard = childGuard;
              }
            }
            await mutateWithinReleasedParents({
              guards: guardChain,
              parentDirectories: [directory],
              directoryGuard,
              filesystemEntryVerifier,
              mutate: async () => {
                await childGuard.delete();
                childGuard = null;
                descriptor.guard = null;
              },
              verify: async (snapshots) => {
                const snapshot = snapshots.get(guardedPathKey(directory));
                const sourceIdentity = snapshot.before.entries.get(descriptor.entry.name);
                const expected = namespaceAfterTransition(snapshot.before, [{
                  remove: { name: descriptor.entry.name, identity: sourceIdentity },
                }]);
                assertNamespaceMatches(
                  expected,
                  snapshot.after.entries,
                  `A managed cleanup ${descriptor.stat.isDirectory() ? 'directory' : 'file'} namespace changed during deletion`,
                );
              },
            });
          }
        } finally {
          await releaseGuards(...descriptors.map(({ guard }) => guard).filter(Boolean).reverse());
        }
      }
      if ((await safeTreeEntriesBounded(directory, 1)).length !== 0) {
        throw stateError('Managed cleanup did not reach an empty verified directory');
      }
    };
    const tombstoneGuardChain = [...ancestors, rootGuard];
    try { await erase(tombstone, tombstoneGuardChain, 0); }
    finally { rootGuard = tombstoneGuardChain.at(-1); }
    if (typeof rootGuard.delete !== 'function') throw stateError('Managed cleanup cannot delete its verified tombstone');
    await mutateWithinReleasedParents({
      guards: ancestors,
      parentDirectories: [parent],
      directoryGuard,
      filesystemEntryVerifier,
      mutate: async () => { await rootGuard.delete(); rootGuard = null; },
      verify: async (snapshots) => {
        const snapshot = snapshots.get(guardedPathKey(parent));
        const tombstoneName = path.basename(tombstone);
        const tombstoneIdentity = snapshot.before.entries.get(tombstoneName);
        const expected = namespaceAfterTransition(snapshot.before, [{ remove: { name: tombstoneName, identity: tombstoneIdentity } }]);
        assertNamespaceMatches(expected, snapshot.after.entries, 'The managed cleanup tombstone namespace changed during deletion');
      },
    });
    return true;
  } finally { await releaseGuards(rootGuard, targetGuard, ...ancestors.reverse()); }
}

function managedTreeTombstone(target) {
  return `${path.resolve(target)}${UPDATE_DELETE_SUFFIX}`;
}

async function managedTreeRemovalPending(target) {
  return await exists(target) || await exists(managedTreeTombstone(target));
}

function filesystemPathKey(target) {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function namespaceEntryIdentity(managedRoot, target, stat) {
  const relativePath = path.relative(path.resolve(managedRoot), path.resolve(target)).replaceAll('\\', '/');
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
    throw stateError('Update payload namespace identity escaped its managed boundary');
  }
  const kind = stat?.isDirectory?.() ? 'directory' : stat?.isFile?.() ? 'file' : 'unsupported';
  return [
    relativePath,
    kind,
    String(stat?.dev ?? ''),
    String(stat?.ino ?? ''),
    String(stat?.birthtimeNs ?? ''),
    String(stat?.size ?? ''),
  ];
}

async function writeAtomicManagedFile(
  file,
  content,
  managedRoot,
  directoryGuard,
  fileGuard,
  filesystemEntryVerifier = async () => undefined,
  options = {},
) {
  const parent = path.dirname(path.resolve(file));
  const temporary = options.temporaryFile === undefined
    ? path.join(parent, `.update-state-${crypto.randomUUID()}.tmp`)
    : path.resolve(options.temporaryFile);
  if (path.dirname(temporary) !== parent || !safeName(path.basename(temporary))) {
    throw new TypeError('The managed update temp file must be a safe direct sibling');
  }
  const replaceExisting = options.replaceExisting ?? true;
  const allowExistingTemporary = options.allowExistingTemporary ?? false;
  const preserveTemporaryOnError = options.preserveTemporaryOnError ?? false;
  const requireDestinationPresent = options.requireDestinationPresent ?? false;
  const requireDestinationAbsent = options.requireDestinationAbsent ?? false;
  const expectedDestinationContent = options.expectedDestinationContent === undefined
    ? null
    : Buffer.isBuffer(options.expectedDestinationContent)
      ? options.expectedDestinationContent
      : typeof options.expectedDestinationContent === 'string'
        ? Buffer.from(options.expectedDestinationContent, 'utf8')
        : undefined;
  if ([replaceExisting, allowExistingTemporary, preserveTemporaryOnError,
    requireDestinationPresent, requireDestinationAbsent].some((value) => typeof value !== 'boolean')
    || (requireDestinationPresent && requireDestinationAbsent)
    || expectedDestinationContent === undefined) {
    throw new TypeError('Invalid managed update publication options');
  }
  const expectedContent = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const ancestors = await acquireGuardChain(managedRoot, parent, directoryGuard);
  let created = null; let tempGuard = null; let expectedDestinationIdentity = null;
  try {
    assertGuardsHeld(ancestors);
    if (expectedDestinationContent !== null) {
      const destinationGuard = await fileGuard(path.resolve(file));
      try {
        assertGuardsHeld(ancestors, destinationGuard);
        const destinationBefore = await fs.lstat(file);
        if (!destinationBefore.isFile() || destinationBefore.isSymbolicLink() || destinationBefore.nlink !== 1
          || destinationBefore.size !== expectedDestinationContent.length) {
          throw stateError('The managed update publication destination changed before custody');
        }
        const destinationHandle = await fs.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        try {
          const openedBefore = await destinationHandle.stat();
          if (!(await destinationHandle.readFile()).equals(expectedDestinationContent)) {
            throw stateError('The managed update publication destination content changed before custody');
          }
          const openedAfter = await destinationHandle.stat();
          const destinationAfter = await fs.lstat(file);
          if (!sameFileIdentity(destinationBefore, openedBefore)
            || !sameFileIdentity(openedBefore, openedAfter)
            || !sameFileIdentity(openedAfter, destinationAfter)) {
            throw stateError('The managed update publication destination changed during custody');
          }
        } finally { await destinationHandle.close(); }
        expectedDestinationIdentity = exactNamespaceEntryIdentity(await fs.lstat(file, { bigint: true }));
      } finally { await releaseGuards(destinationGuard); }
    }
    if (allowExistingTemporary && await exists(temporary)) {
      created = await fs.lstat(temporary);
      if (!created.isFile() || created.isSymbolicLink() || created.nlink !== 1 || created.size !== expectedContent.length) {
        throw stateError('The resumable update temp file is not a safe private file');
      }
    } else {
      const handle = await fs.open(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      try {
        await handle.writeFile(expectedContent); await handle.sync(); created = await handle.stat();
      } finally { await handle.close(); }
    }
    tempGuard = await fileGuard(temporary); assertGuardsHeld(ancestors, tempGuard);
    const named = await fs.lstat(temporary);
    if (!sameFileIdentity(created, named)
      || typeof tempGuard[replaceExisting ? 'replace' : 'rename'] !== 'function') {
      throw stateError('The update transaction marker changed before publication');
    }
    const stagedHandle = await fs.open(temporary, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const staged = await stagedHandle.readFile();
      if (!staged.equals(expectedContent)) throw stateError('The resumable update temp content does not match its publication');
    } finally { await stagedHandle.close(); }
    await mutateWithinReleasedParents({
      guards: ancestors,
      parentDirectories: [parent],
      directoryGuard,
      filesystemEntryVerifier,
      mutate: async (snapshots) => {
        const snapshot = snapshots.get(guardedPathKey(parent));
        const targetPresent = snapshot.entries.has(path.basename(file));
        if ((requireDestinationPresent && !targetPresent) || (requireDestinationAbsent && targetPresent)) {
          throw stateError('The managed update publication destination changed state');
        }
        if (expectedDestinationIdentity !== null
          && snapshot.entries.get(path.basename(file)) !== expectedDestinationIdentity) {
          throw stateError('The managed update publication destination changed identity');
        }
        await tempGuard[replaceExisting ? 'replace' : 'rename'](path.resolve(file));
        tempGuard = null;
      },
      verify: async (snapshots) => {
        const snapshot = snapshots.get(guardedPathKey(parent));
        const temporaryName = path.basename(temporary);
        const targetName = path.basename(file);
        const temporaryIdentity = snapshot.before.entries.get(temporaryName);
        if (temporaryIdentity === undefined) throw stateError('The update transaction marker temp identity disappeared before publication');
        const expected = namespaceAfterTransition(snapshot.before, [
          { remove: { name: temporaryName, identity: temporaryIdentity } },
          { add: { name: targetName, identity: temporaryIdentity } },
        ]);
        assertNamespaceMatches(expected, snapshot.after.entries, 'The update transaction marker namespace changed during publication');
      },
    });
    const publishedGuard = await fileGuard(file);
    try {
      publishedGuard.assertHeld?.();
      const published = await fs.lstat(file);
      if (!published.isFile() || published.isSymbolicLink() || published.nlink !== 1 || published.size !== expectedContent.length) {
        throw stateError('The update transaction marker was not published safely');
      }
      const readHandle = await fs.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const value = await readHandle.readFile();
        if (!value.equals(expectedContent)) throw stateError('The update transaction marker changed after publication');
      } finally { await readHandle.close(); }
    } finally { await releaseGuards(publishedGuard); }
  } catch (error) {
    if (tempGuard && !preserveTemporaryOnError) {
      try {
        const checked = await fs.lstat(temporary);
        if (sameFileIdentity(created, checked)) {
          await mutateWithinReleasedParents({
            guards: ancestors,
            parentDirectories: [parent],
            directoryGuard,
            filesystemEntryVerifier,
            mutate: async () => { await tempGuard.delete(); tempGuard = null; },
            verify: async (snapshots) => {
              const snapshot = snapshots.get(guardedPathKey(parent));
              const temporaryName = path.basename(temporary);
              const temporaryIdentity = snapshot.before.entries.get(temporaryName);
              const expected = namespaceAfterTransition(snapshot.before, [{
                remove: { name: temporaryName, identity: temporaryIdentity },
              }]);
              assertNamespaceMatches(expected, snapshot.after.entries, 'The rejected update temp namespace changed during cleanup');
            },
          });
        }
      } catch { /* Leave the exact temp artifact fenced for startup review. */ }
    }
    throw error;
  } finally { await releaseGuards(tempGuard, ...ancestors.reverse()); }
}

export async function publishAtomicManagedUpdateFile({
  file,
  content,
  managedRoot,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = acquireWindowsFileGuard,
  filesystemEntryVerifier = assertWindowsFilesystemEntry,
  ...options
}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)
    || typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)
    || (!Buffer.isBuffer(content) && typeof content !== 'string')) {
    throw new TypeError('A bounded managed update file publication is required');
  }
  return writeAtomicManagedFile(
    file,
    content,
    managedRoot,
    directoryGuard,
    fileGuard,
    filesystemEntryVerifier,
    options,
  );
}

async function removeExactManagedFile(
  file,
  expectedContent,
  managedRoot,
  directoryGuard,
  fileGuard,
  filesystemEntryVerifier = async () => undefined,
) {
  const expectedBytes = Buffer.isBuffer(expectedContent)
    ? expectedContent
    : Buffer.from(expectedContent, 'utf8');
  const resolved = path.resolve(file);
  const parent = path.dirname(resolved);
  const ancestors = await acquireGuardChain(managedRoot, parent, directoryGuard);
  let guard = null;
  try {
    assertGuardsHeld(ancestors);
    guard = await fileGuard(resolved);
    assertGuardsHeld(ancestors, guard);
    const namedBefore = await fs.lstat(resolved);
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1
      || namedBefore.size !== expectedBytes.length) return false;
    const handle = await fs.open(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let observed;
    try {
      const openedBefore = await handle.stat();
      observed = await handle.readFile();
      const openedAfter = await handle.stat();
      const namedAfter = await fs.lstat(resolved);
      if (!sameFileIdentity(namedBefore, openedBefore) || !sameFileIdentity(openedBefore, openedAfter)
        || !sameFileIdentity(openedAfter, namedAfter)) return false;
    } finally { await handle.close(); }
    if (!observed.equals(expectedBytes) || typeof guard.delete !== 'function') return false;
    await mutateWithinReleasedParents({
      guards: ancestors,
      parentDirectories: [parent],
      directoryGuard,
      filesystemEntryVerifier,
      mutate: async () => { await guard.delete(); guard = null; },
      verify: async (snapshots) => {
        const snapshot = snapshots.get(guardedPathKey(parent));
        const sourceName = path.basename(resolved);
        const sourceIdentity = snapshot.before.entries.get(sourceName);
        const expected = namespaceAfterTransition(snapshot.before, [{ remove: { name: sourceName, identity: sourceIdentity } }]);
        assertNamespaceMatches(expected, snapshot.after.entries, 'The rejected update marker namespace changed during cleanup');
      },
    });
    return true;
  } finally { await releaseGuards(guard, ...ancestors.reverse()); }
}

export async function removeExactManagedUpdateFile({
  file,
  expectedContent,
  managedRoot,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = acquireWindowsFileGuard,
  filesystemEntryVerifier = assertWindowsFilesystemEntry,
}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)
    || typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)
    || (!Buffer.isBuffer(expectedContent) && typeof expectedContent !== 'string')
    || Buffer.byteLength(expectedContent) > MAX_UPDATE_MARKER_BYTES) {
    throw new TypeError('A bounded exact managed update file removal is required');
  }
  return removeExactManagedFile(
    file,
    expectedContent,
    managedRoot,
    directoryGuard,
    fileGuard,
    filesystemEntryVerifier,
  );
}

function safeName(value) {
  return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..'
    && !/[\0\x00-\x1f\x7f<>:"|?*]/.test(value) && !/[. ]$/.test(value)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(value);
}

function safeRelative(root, value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) throw new TypeError('Unsafe managed relative path');
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[<>:"|?*]/.test(part))) throw new TypeError('Unsafe managed relative path');
  const target = path.resolve(root, ...parts);
  if (!isChild(root, target)) throw new TypeError('Managed path escaped its root');
  return target;
}

function isChild(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function assertManagedDirectory(root, target, label) {
  return assertManagedEntry(root, target, label, 'directory');
}

async function assertManagedRegularFile(root, target, label) {
  return assertManagedEntry(root, target, label, 'file');
}

async function assertManagedEntry(root, target, label, expectedKind) {
  const boundary = path.resolve(root);
  const resolved = path.resolve(target);
  if (!isChild(boundary, resolved)) throw stateError(`The ${label} escaped its managed boundary`);
  const relative = path.relative(boundary, resolved);
  const rootStat = await fs.lstat(boundary).catch((error) => {
    throw stateError(`Could not inspect the ${label} boundary: ${error.message}`);
  });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw stateError(`The ${label} boundary is not a safe directory`);
  let cursor = boundary;
  const parts = relative.split(path.sep);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const stat = await fs.lstat(cursor).catch((error) => {
      throw stateError(`Could not inspect the ${label}: ${error.message}`);
    });
    if (stat.isSymbolicLink()) throw stateError(`The ${label} crosses a symbolic-link boundary`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw stateError(`The ${label} parent is not a directory`);
    if (index === parts.length - 1) {
      if (expectedKind === 'directory' && !stat.isDirectory()) throw stateError(`The ${label} is not a directory`);
      if (expectedKind === 'file' && !stat.isFile()) throw stateError(`The ${label} is not a regular file`);
    }
  }
  const [realBoundary, realTarget] = await Promise.all([fs.realpath(boundary), fs.realpath(resolved)]);
  if (!isChild(realBoundary, realTarget)) throw stateError(`The ${label} resolved outside its managed boundary`);
  return resolved;
}

function validateMarker(marker, expectedId, expectedTransactionId) {
  const attestedLegacyTerminal = isAttestedLegacyUpdateTerminalMarker(marker);
  if (!marker || marker.schemaVersion !== 1 || marker.instanceId !== expectedId || !validateInstanceId(marker.instanceId)) throw stateError('Invalid update transaction marker');
  if (!TRANSACTION_ID.test(marker.transactionId) || (expectedTransactionId && marker.transactionId !== expectedTransactionId)) throw stateError('Invalid update transaction identity');
  if (!UPDATE_PHASES.has(marker.phase) || !marker.originalRecord || !validHashTree(marker.worldBefore)
    || !validHashTree(marker.mutableBefore)
    || (!attestedLegacyTerminal && !validManagedSnapshot(marker.managedBefore))
    || (!attestedLegacyTerminal && !validDirectoryIdentity(marker.sourceDirectoryIdentity))
    || (marker.legacyTerminalAttestation !== undefined && !attestedLegacyTerminal)
    || (marker.legacyLaunchMigration !== undefined && !validLegacyLaunchMigration(marker.legacyLaunchMigration))
    || typeof marker.levelName !== 'string' || marker.levelName.length > 240
    || !validTimestamp(marker.createdAt) || !validTimestamp(marker.updatedAt)
    || Date.parse(marker.updatedAt) < Date.parse(marker.createdAt)) throw stateError('Incomplete update transaction marker');
  if (['rolling-back', 'rollback-failed', 'rolled-back'].includes(marker.phase)) {
    if (!ROLLBACK_ORIGIN_PHASES.has(marker.rollbackOriginPhase)) {
      throw stateError('Update rollback marker is missing its authenticated origin phase');
    }
  } else if (marker.rollbackOriginPhase !== undefined && !ROLLBACK_ORIGIN_PHASES.has(marker.rollbackOriginPhase)) {
    throw stateError('Update rollback marker has an invalid origin phase');
  }
}

export function validateUpdateRecoveryMarker(marker, expectedId, expectedTransactionId) {
  validateMarker(marker, expectedId, expectedTransactionId);
  return true;
}

function validLegacyLaunchMigration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([
      'previousServerArtifact', 'roots', 'schemaVersion', 'sourceLaunchInventoryDigest', 'state',
      'targetLaunchAssetDigest', 'targetLaunchInventoryDigest',
    ])
    || value.schemaVersion !== 1 || !LEGACY_LAUNCH_MIGRATION_STATES.has(value.state)
    || value.sourceLaunchInventoryDigest !== null
    || !Array.isArray(value.roots) || value.roots.length !== LEGACY_LAUNCH_ROOTS.length) return false;
  for (let index = 0; index < LEGACY_LAUNCH_ROOTS.length; index += 1) {
    const root = value.roots[index];
    if (!root || typeof root !== 'object' || Array.isArray(root)
      || canonicalJson(Object.keys(root).sort()) !== canonicalJson(['relativePath', 'tree'])
      || root.relativePath !== LEGACY_LAUNCH_ROOTS[index] || !validHashTree(root.tree)) return false;
  }
  if (value.previousServerArtifact !== null) {
    const artifact = value.previousServerArtifact;
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)
      || canonicalJson(Object.keys(artifact).sort()) !== canonicalJson(['relativePath', 'sha256', 'size'])
      || !validManagedRelativePath(artifact.relativePath) || !artifact.relativePath.startsWith('versions/')
      || !SHA256.test(artifact.sha256 ?? '') || !Number.isSafeInteger(artifact.size)
      || artifact.size < 1 || artifact.size > 128 * 1024 * 1024) return false;
  }
  if (value.state === 'source-authenticated') {
    return value.targetLaunchAssetDigest === null && value.targetLaunchInventoryDigest === null;
  }
  return SHA256.test(value.targetLaunchAssetDigest ?? '') && SHA256.test(value.targetLaunchInventoryDigest ?? '');
}

function validManagedRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 240
    || value !== value.replaceAll('\\', '/') || value.includes('\0')
    || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false;
  const parts = value.split('/');
  return parts.every((part) => safeName(part));
}

function validManagedSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson(['algorithm', 'bytes', 'digest', 'entries', 'files'])
    || value.algorithm !== 'sha256' || !SHA256.test(value.digest ?? '')
    || !Number.isSafeInteger(value.files) || value.files < 0 || value.files > 256
    || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX_UPDATE_TREE_BYTES
    || !Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 256) return false;
  let bytes = 0;
  let files = 0;
  let previous = null;
  for (const entry of value.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || canonicalJson(Object.keys(entry).sort()) !== canonicalJson(['present', 'relativePath', 'sha256', 'size'])
      || !validManagedRelativePath(entry.relativePath) || typeof entry.present !== 'boolean'
      || (previous !== null && previous.localeCompare(entry.relativePath, 'en') >= 0)) return false;
    if (entry.present) {
      if (!SHA256.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.size)
        || entry.size < 0 || entry.size > MAX_UPDATE_TREE_BYTES) return false;
      files += 1;
      bytes += entry.size;
    } else if (entry.sha256 !== null || entry.size !== null) return false;
    previous = entry.relativePath;
    if (!Number.isSafeInteger(bytes) || bytes > MAX_UPDATE_TREE_BYTES) return false;
  }
  return files === value.files && bytes === value.bytes
    && crypto.createHash('sha256').update(canonicalJson(value.entries), 'utf8').digest('hex') === value.digest;
}

function markerAllowsMissingPayloadDirectory(marker) {
  return marker.phase === 'preparing'
    || (['rolling-back', 'rollback-failed'].includes(marker.phase)
      && marker.rollbackOriginPhase === 'preparing');
}

function validDirectoryIdentity(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 3
    && ['dev', 'ino', 'birthtimeNs'].every((field) => typeof value[field] === 'string' && /^\d{1,40}$/.test(value[field]));
}

function signUpdateMarker(key, marker) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !marker || typeof marker !== 'object' || Array.isArray(marker)) {
    throw stateError('Update recovery authentication is unavailable');
  }
  const unsigned = freezeClone(marker); delete unsigned.mac;
  const mac = crypto.createHmac('sha256', key).update(canonicalJson(unsigned), 'utf8').digest('hex');
  return { ...unsigned, mac };
}

function authenticateUpdateMarker(key, value) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((field) => !UPDATE_MARKER_FIELDS.has(field)) || !SHA256.test(value.mac ?? '')) {
    throw stateError('Update transaction marker authentication failed');
  }
  if (value.legacyTerminalAttestation !== undefined
    && value.legacyTerminalAttestation?.keySha256 !== crypto.createHash('sha256').update(key).digest('hex')) {
    throw stateError('Update transaction marker authentication failed');
  }
  const unsigned = freezeClone(value); delete unsigned.mac;
  const expected = crypto.createHmac('sha256', key).update(canonicalJson(unsigned), 'utf8').digest();
  const observed = Buffer.from(value.mac, 'hex');
  if (observed.length !== expected.length || !crypto.timingSafeEqual(observed, expected)) {
    throw stateError('Update transaction marker authentication failed');
  }
  return unsigned;
}

async function readGuardedFileBytes(file, guard, minimumBytes, maximumBytes, label) {
  if (!Number.isSafeInteger(minimumBytes) || !Number.isSafeInteger(maximumBytes)
    || minimumBytes < 0 || maximumBytes < minimumBytes) {
    throw new TypeError('Invalid guarded update file bounds');
  }
  guard.assertHeld?.();
  const namedBefore = await fs.lstat(file);
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1
    || namedBefore.size < minimumBytes || namedBefore.size > maximumBytes) {
    throw stateError(`${label} is not a bounded private file`);
  }
  const handle = await fs.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const openedBefore = await handle.stat();
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat();
    const namedAfter = await fs.lstat(file);
    guard.assertHeld?.();
    if (bytes.length !== namedBefore.size || !sameFileIdentity(namedBefore, openedBefore)
      || !sameFileIdentity(openedBefore, openedAfter) || !sameFileIdentity(openedAfter, namedAfter)) {
      throw stateError(`${label} changed while it was read`);
    }
    return bytes;
  } finally { await handle.close(); }
}

function authenticateCanonicalMarkerBytes(bytes, key) {
  let text;
  let value;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw stateError('Update transaction marker is not valid canonical JSON');
  }
  if (text !== `${JSON.stringify(value, null, 2)}\n`) {
    throw stateError('Update transaction marker is not in canonical serialized form');
  }
  return authenticateUpdateMarker(key, value);
}

async function readMarker(markerPath, key, fileGuard = acquireWindowsFileGuard) {
  const guard = await fileGuard(markerPath);
  try {
    guard.assertHeld?.();
    const namedBefore = await fs.lstat(markerPath);
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1
      || namedBefore.size < 2 || namedBefore.size > MAX_UPDATE_MARKER_BYTES) throw stateError('Update transaction marker is not a safe private file');
    const handle = await fs.open(markerPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const openedBefore = await handle.stat(); const bytes = await handle.readFile();
      const openedAfter = await handle.stat(); const namedAfter = await fs.lstat(markerPath);
      if (bytes.length !== namedBefore.size || !sameFileIdentity(namedBefore, openedBefore)
        || !sameFileIdentity(openedBefore, openedAfter) || !sameFileIdentity(openedAfter, namedAfter)) {
        throw stateError('Update transaction marker changed while it was read');
      }
      let text; let value;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); value = JSON.parse(text); }
      catch { throw stateError('Update transaction marker is not valid canonical JSON'); }
      if (text !== `${JSON.stringify(value, null, 2)}\n`) throw stateError('Update transaction marker is not in canonical serialized form');
      return authenticateUpdateMarker(key, value);
    } finally { await handle.close(); }
  } finally { await releaseGuards(guard); }
}

function validTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validHashTree(value) {
  return value && value.algorithm === 'sha256' && SHA256.test(value.digest ?? '')
    && Number.isSafeInteger(value.files) && value.files >= 0 && value.files <= MAX_UPDATE_TREE_ENTRIES
    && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= MAX_UPDATE_TREE_BYTES;
}

function publicPlan(plan) {
  const states = {
    current: 'current',
    component: 'component-update-available',
    upgrade: 'minecraft-update-approval-required',
    'legacy-migration': 'minecraft-update-approval-required',
    downgrade: 'blocked-downgrade',
    unknown: 'blocked-unknown-order',
  };
  return {
    planId: plan.planId,
    state: states[plan.kind],
    updateKind: plan.kind,
    requiresApproval: requiresApproval(plan),
    currentMinecraftVersion: plan.current.minecraftVersion,
    targetMinecraftVersion: plan.target.identity.minecraftVersion,
    target: freezeClone(plan.target.identity),
  };
}

function requiresApproval(plan) {
  return plan.kind === 'upgrade' || plan.kind === 'legacy-migration';
}

function publicTransaction(marker) {
  return {
    transactionId: marker.transactionId,
    instanceId: marker.instanceId,
    phase: marker.phase,
    updateKind: marker.updateKind,
    planId: marker.planId,
    backupAvailable: marker.retiredCleanup?.state === 'purged'
      ? false
      : ['candidate-published', 'store-committed', 'pending-readiness', 'readiness-observed', 'ready'].includes(marker.phase),
    createdAt: marker.createdAt,
    updatedAt: marker.updatedAt,
  };
}

function publicRetiredCleanup(instance, marker) {
  const cleanup = validateRetiredCleanup(marker.retiredCleanup);
  if (cleanup.state !== 'purged' || instance.updateStatus?.backupAvailable !== false) {
    throw stateError('Retired-version cleanup did not reach a purged state');
  }
  return {
    action: 'retired-version-purged',
    instanceId: instance.id,
    transactionId: marker.transactionId,
    retiredMinecraftVersion: cleanup.previousMinecraftVersion,
    currentMinecraftVersion: cleanup.targetMinecraftVersion,
    backupAvailable: false,
    cacheEntriesPurged: cleanup.stagedCacheIndexes.length,
    purgedAt: cleanup.purgedAt,
  };
}

function plainJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  try { JSON.stringify(value); return true; }
  catch { return false; }
}

function containsPrivateField(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsPrivateField);
  return Object.entries(value).some(([key, nested]) => /executable|path|url/i.test(key) || containsPrivateField(nested));
}

function validVersion(value, label) {
  if (typeof value !== 'string' || !VERSION.test(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function freezeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function exists(target) {
  try { await fs.lstat(target); return true; }
  catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function codedError(message, code, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function stateError(message) { return codedError(message, 'UPDATE_INVALID_STATE'); }
function recoveryRequiredError(message) { return codedError(message, 'UPDATE_RECOVERY_REQUIRED'); }
function updateLifecycleStageError(error, stage) {
  if (!UPDATE_LIFECYCLE_STAGES.has(stage)) return error;
  if (!Object.hasOwn(error, 'updateLifecycleStage')) {
    Object.defineProperty(error, 'updateLifecycleStage', { value: stage, enumerable: false });
  }
  return error;
}
function retentionRequiredError(message) { return codedError(message, 'UPDATE_BACKUP_RETENTION_REQUIRED'); }
function staleApprovalError(message) { return codedError(message, 'UPDATE_PLAN_CHANGED'); }
function notFoundError(message) { return codedError(message, 'INSTANCE_NOT_FOUND', 404); }

export const FAMILY_SERVER_MANAGED_ARTIFACTS = MANAGED_ARTIFACTS;
