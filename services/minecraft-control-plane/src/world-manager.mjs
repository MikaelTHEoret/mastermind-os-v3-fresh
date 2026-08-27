import crypto from 'node:crypto';
import { constants as FS_CONSTANTS } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { minecraftServerRelativePath } from './minecraft-server-version.mjs';
import {
  acquireWindowsDirectoryGuard,
  acquireWindowsFileGuard,
  assertWindowsFilesystemEntry,
  assertWindowsFilesystemTree,
} from './windows-filesystem-safety.mjs';

const FAMILY_ID = 'family-server';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORLD_REF = /^world-[a-f0-9]{64}$/;
const PLAN_ID = /^worldplan-[a-f0-9]{64}$/;
const TX_REF = /^worldtx-[a-f0-9]{64}$/;
const BACKUP_ID = /^bkp-[a-f0-9]{32}$/;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const OPERATIONS = new Set(['create', 'clone', 'rename', 'archive', 'switch']);
const STATES = new Set(['active', 'inactive', 'archived']);
const TERMINAL_STATES = new Set(['committed', 'rolled-back', 'rejected-before-mutation', 'completion-unknown', 'manual-recovery-required']);
const TRANSACTION_PHASES = new Set([
  'admitted', 'snapshot-verified', 'rejected-before-mutation',
  'intent', 'candidate-ready', 'intent-publish', 'target-published',
  'intent-live-to-temp', 'live-in-temp', 'intent-target-to-live', 'target-live',
  'intent-temp-to-storage', 'previous-stored', 'intent-catalog', 'catalog-committed',
  'committed', 'rolled-back',
]);
const TERMINAL_TRANSACTION_PHASES = new Set(['committed', 'rolled-back', 'rejected-before-mutation']);
const CONFIRMATIONS = Object.freeze({
  create: 'CREATE NEW WORLD', clone: 'CLONE WORLD', rename: 'RENAME WORLD',
  archive: 'ARCHIVE WORLD', switch: 'SWITCH ACTIVE WORLD',
});
const APPLICATIONS = Object.freeze({
  committed: 'verified', 'rolled-back': 'rolled-back-verified',
  'rejected-before-mutation': 'not-applied', 'completion-unknown': 'unknown',
  'manual-recovery-required': 'unknown',
});
const MAX_WORLDS = 12;
const MAX_WORLD_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024 * 1024;
const MAX_FILES = 500_000;
const MAX_DEPTH = 64;
const MAX_GUARD_BATCH = 256;
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_LEVEL_DAT_BYTES = 8 * 1024 * 1024;
const MAX_NBT_BYTES = 32 * 1024 * 1024;
const MAX_NBT_NODES = 200_000;
const MAX_NBT_COLLECTION = 2_000_000;
const MAX_JOURNAL_RECORDS = 4096;
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const MAX_SERVER_JAR_BYTES = 128 * 1024 * 1024;
const PLAN_TTL_MS = 5 * 60 * 1000;
const PRIVATE_ROOT_NAME = '.mastermind';
const PRIVATE_WORLDS_NAME = 'worlds';
const ACTIVE_DIRECTORY_NAME = 'world';
const MODERN_SESSION_LOCK = Buffer.from([0xe2, 0x98, 0x83]);
const WORLD_INITIALIZATION_STAGES = new Set([
  'restore-validation', 'store-read', 'lifecycle-lock', 'store-recheck', 'instance-validation',
  'version-verification', 'running-recovery', 'quiescence', 'root-initialization',
  'catalog-initialization', 'journal-recovery',
]);
const SAFE_ENTRY = /^(?!\.\.?$)(?!.*[. ]$)(?!.*[:\\/\x00-\x1f\x7f])[^\u200b-\u200f\u202a-\u202e\u2060-\u206f]+$/u;
const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const SAFE_LABEL = /^[^\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\\/:]+$/u;

function worldError(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

function worldInitializationStageError(error, stage) {
  if (!WORLD_INITIALIZATION_STAGES.has(stage)) return error;
  if (!Object.hasOwn(error, 'worldInitializationStage')) {
    Object.defineProperty(error, 'worldInitializationStage', { value: stage, enumerable: false });
  }
  return error;
}

function namespaceDiscontinuity(message) {
  return Object.assign(worldError('WORLD_INTEGRITY_FAILED', 409, message), {
    worldNamespaceDiscontinuity: true,
  });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sign(key, value) { return crypto.createHmac('sha256', key).update(canonical(value)).digest('hex'); }
function clone(value) { return structuredClone(value); }

function timingEqual(left, right) {
  return HEX64.test(left ?? '') && HEX64.test(right ?? '')
    && crypto.timingSafeEqual(Buffer.from(left, 'ascii'), Buffer.from(right, 'ascii'));
}

function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function trustedWorldDataVersion(instance, { allowMissing = false } = {}) {
  const fields = [Object.hasOwn(instance ?? {}, 'worldDataVersion'), Object.hasOwn(instance ?? {}, 'minecraftServerArtifact')];
  if (!fields.some(Boolean)) {
    if (allowMissing) return null;
    throw worldError('WORLD_VERSION_METADATA_REQUIRED', 503, 'Run a verified same-version server update before using world management.');
  }
  if (!fields.every(Boolean) || typeof instance.minecraftVersion !== 'string') {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The trusted Minecraft world compatibility binding is incomplete.');
  }
  let expectedPath;
  try { expectedPath = minecraftServerRelativePath(instance.minecraftVersion); }
  catch { throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The trusted Minecraft world compatibility binding is invalid.'); }
  const artifact = instance.minecraftServerArtifact;
  if (!exactKeys(artifact, ['minecraftVersion', 'worldDataVersion', 'relativePath', 'size', 'sha1', 'sha256'])
    || artifact.minecraftVersion !== instance.minecraftVersion || artifact.relativePath !== expectedPath
    || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > MAX_SERVER_JAR_BYTES
    || !HEX40.test(artifact.sha1 ?? '') || !HEX64.test(artifact.sha256 ?? '')
    || !Number.isSafeInteger(artifact.worldDataVersion) || artifact.worldDataVersion < 1 || artifact.worldDataVersion > 0x7fffffff
    || instance.worldDataVersion !== artifact.worldDataVersion) {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The trusted Minecraft world compatibility binding is invalid.');
  }
  return artifact.worldDataVersion;
}

function isSameVersionCompatibilityMigration(instance, target) {
  if (!target || typeof target !== 'object' || target.minecraftVersion !== instance.minecraftVersion) return false;
  const artifact = target.minecraftServerArtifact;
  let expectedPath;
  try { expectedPath = minecraftServerRelativePath(instance.minecraftVersion); } catch { return false; }
  const hasVerifiedDigest = Object.hasOwn(artifact ?? {}, 'sha256');
  const hasWorldDataVersion = Object.hasOwn(artifact ?? {}, 'worldDataVersion');
  const hasTargetWorldDataVersion = Object.hasOwn(target, 'worldDataVersion');
  return exactKeys(
    artifact,
    ['minecraftVersion', 'relativePath', 'size', 'sha1'],
    ['sha256', 'worldDataVersion'],
  )
    && artifact.minecraftVersion === instance.minecraftVersion && artifact.relativePath === expectedPath
    && Number.isSafeInteger(artifact.size) && artifact.size >= 1 && artifact.size <= MAX_SERVER_JAR_BYTES
    && HEX40.test(artifact.sha1 ?? '')
    && hasVerifiedDigest === hasWorldDataVersion
    && hasWorldDataVersion === hasTargetWorldDataVersion
    && (!hasVerifiedDigest || HEX64.test(artifact.sha256 ?? ''))
    && (!hasWorldDataVersion || (
      Number.isSafeInteger(artifact.worldDataVersion)
      && artifact.worldDataVersion >= 1 && artifact.worldDataVersion <= 0x7fffffff
      && target.worldDataVersion === artifact.worldDataVersion
    ));
}

function assertCatalogDataVersions(catalog, maximumDataVersion) {
  for (const record of catalog.worlds) {
    if (record.dataVersion !== null && record.dataVersion > maximumDataVersion) {
      throw worldError('WORLD_VERSION_INCOMPATIBLE', 409, 'A managed world was created by a newer Minecraft data version.');
    }
  }
  return catalog;
}

function iso(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  const normalized = new Date(value).toISOString();
  return normalized === value ? value : null;
}

function nowIso(now) {
  const value = now();
  const checked = iso(value);
  if (!checked) throw new Error('The local clock returned an invalid timestamp');
  return checked;
}

function normalizeInstance(instanceId) {
  if (instanceId !== FAMILY_ID) throw worldError('WORLD_INVALID_INSTANCE', 409, 'World management is available only for the isolated Family Server.');
  return instanceId;
}

function normalizeUuid(value) {
  if (!UUID.test(value ?? '')) throw worldError('WORLD_INVALID_REQUEST', 400, 'World requestId must be a lowercase UUID.');
  return value;
}

function normalizeWorldRef(value) {
  if (!WORLD_REF.test(value ?? '')) throw worldError('WORLD_INVALID_REF', 400, 'The world reference is invalid.');
  return value;
}

function normalizeLabel(value) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || [...value].length > 64
    || Buffer.byteLength(value, 'utf8') > 256 || !SAFE_LABEL.test(value)) {
    throw worldError('WORLD_INVALID_LABEL', 400, 'World label must contain 1 to 64 safe visible characters.');
  }
  const normalized = value.normalize('NFKC');
  if (normalized.trim() !== normalized || [...normalized].length > 64 || Buffer.byteLength(normalized, 'utf8') > 256 || !SAFE_LABEL.test(normalized)) {
    throw worldError('WORLD_INVALID_LABEL', 400, 'World label normalizes to an unsafe value.');
  }
  return normalized;
}

function labelKey(value) { return value.normalize('NFKC').toLocaleLowerCase('en-US'); }

function restoreEpoch(instance) {
  const value = instance?.lastRestore;
  if (value === undefined || value === null) return null;
  if (!exactKeys(value, ['backupId', 'rescueBackupId', 'restoredAt', 'state'])
    || !BACKUP_ID.test(value.backupId ?? '') || !BACKUP_ID.test(value.rescueBackupId ?? '')
    || value.state !== 'verified' || !iso(value.restoredAt)) {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The verified restore history is invalid.');
  }
  return { backupId: value.backupId, rescueBackupId: value.rescueBackupId, restoredAt: value.restoredAt, state: 'verified' };
}

function validatePlanRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw worldError('WORLD_INVALID_REQUEST', 400, 'The world plan request is invalid.');
  const { operation } = value;
  if (!OPERATIONS.has(operation)) throw worldError('WORLD_INVALID_REQUEST', 400, 'The world operation is unsupported.');
  normalizeUuid(value.requestId);
  if (operation === 'create') {
    if (!exactKeys(value, ['requestId', 'operation', 'displayLabel'])) throw worldError('WORLD_INVALID_REQUEST', 400, 'The create-world request is invalid.');
    return { requestId: value.requestId, operation, displayLabel: normalizeLabel(value.displayLabel) };
  }
  if (operation === 'clone' || operation === 'rename') {
    if (!exactKeys(value, ['requestId', 'operation', 'targetWorldRef', 'displayLabel'])) throw worldError('WORLD_INVALID_REQUEST', 400, 'The world plan request is invalid.');
    return { requestId: value.requestId, operation, targetWorldRef: normalizeWorldRef(value.targetWorldRef), displayLabel: normalizeLabel(value.displayLabel) };
  }
  if (!exactKeys(value, ['requestId', 'operation', 'targetWorldRef'])) throw worldError('WORLD_INVALID_REQUEST', 400, 'The world plan request is invalid.');
  return { requestId: value.requestId, operation, targetWorldRef: normalizeWorldRef(value.targetWorldRef) };
}

function validateActionRequest(value) {
  if (!exactKeys(value, ['requestId', 'planId', 'planDigest', 'confirmation'])) {
    throw worldError('WORLD_INVALID_REQUEST', 400, 'The world action request is invalid.');
  }
  normalizeUuid(value.requestId);
  if (!PLAN_ID.test(value.planId ?? '') || !HEX64.test(value.planDigest ?? '') || typeof value.confirmation !== 'string') {
    throw worldError('WORLD_INVALID_REQUEST', 400, 'The world action approval is invalid.');
  }
  return { requestId: value.requestId, planId: value.planId, planDigest: value.planDigest, confirmation: value.confirmation };
}

function assertSafeEntryName(name) {
  if (typeof name !== 'string' || !SAFE_ENTRY.test(name) || RESERVED_WINDOWS_NAME.test(name)) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The managed world contains an unsafe filesystem entry.');
  }
}

function contained(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function lstatOrNull(target) {
  try { return await fs.lstat(target); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function readBoundedDirectoryEntries(directory, maximumEntries, overflow = null) {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0 || maximumEntries > MAX_FILES) {
    throw new TypeError('Invalid bounded world-directory entry limit');
  }
  const entries = [];
  const foldedNames = new Set();
  const handle = await fs.opendir(directory);
  try {
    while (true) {
      const entry = await handle.read();
      if (!entry) break;
      if (entries.length >= maximumEntries) {
        throw typeof overflow === 'function'
          ? overflow()
          : worldError('WORLD_STATE_UNAVAILABLE', 503, 'A managed world namespace exceeded its safe entry bound.');
      }
      assertSafeEntryName(entry.name);
      const folded = entry.name.normalize('NFKC').toLocaleLowerCase('en-US');
      if (foldedNames.has(folded)) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world namespace contains colliding filesystem names.');
      }
      foldedNames.add(folded);
      entries.push(entry);
    }
  } finally {
    await handle.close().catch((error) => { if (error?.code !== 'ERR_DIR_CLOSED') throw error; });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en-US'));
  return entries;
}

async function releaseGuards(...guards) {
  let firstError = null;
  for (const guard of guards.reverse()) {
    if (!guard) continue;
    try { await guard.release(); } catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
}

async function acquireGuardChain(paths, directoryGuard) {
  const guards = [];
  let batch = null;
  try {
    const expected = [];
    for (const directory of paths) {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed filesystem ancestor is unsafe.');
      }
      expected.push(stat);
    }
    batch = paths.length > 1 && typeof directoryGuard?.batch === 'function'
      ? await directoryGuard.batch(paths)
      : null;
    if (batch && (!Array.isArray(batch) || batch.length !== paths.length)) {
      if (Array.isArray(batch)) {
        await releaseGuards(...batch.filter((guard) => guard && typeof guard.release === 'function')).catch(() => undefined);
      }
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed filesystem guard batch returned an invalid result.');
    }
    for (let index = 0; index < paths.length; index += 1) {
      const directory = paths[index];
      const stat = expected[index];
      const guard = batch ? batch[index] : await directoryGuard(directory);
      if (!guard || typeof guard.release !== 'function') {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed filesystem guard is unavailable.');
      }
      const record = { path: directory, stat, guard };
      if (!batch) guards.push(record);
      guard.assertHeld?.();
      const checked = await fs.lstat(directory);
      if (!sameIdentity(stat, checked)) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed filesystem ancestor changed while it was guarded.');
      record.stat = checked;
      if (batch) guards.push(record);
    }
    return guards;
  } catch (error) {
    const acquired = Array.isArray(batch) ? batch : guards.map((entry) => entry.guard);
    await releaseGuards(...acquired.filter((guard) => guard && typeof guard.release === 'function')).catch(() => undefined);
    throw error;
  }
}

async function acquireAnchoredGuardChain(root, target, label, directoryGuard) {
  const before = await assertDirectory(target, root, label);
  const chain = await acquireGuardChain(managedGuardPaths(root, target), directoryGuard);
  try {
    const after = await fs.lstat(target);
    if (!sameIdentity(before, after)) throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} changed while its guard chain was acquired.`);
    await assertGuardChainHeld(chain);
    return chain;
  } catch (error) {
    await releaseGuards(...chain.map((entry) => entry.guard)).catch(() => undefined);
    throw error;
  }
}

function managedGuardPaths(root, target) {
  const trustedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(trustedRoot, resolvedTarget);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed filesystem path escaped its trusted root.');
  }
  const paths = [trustedRoot];
  let cursor = trustedRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    assertSafeEntryName(component);
    cursor = path.join(cursor, component);
    paths.push(cursor);
  }
  return paths;
}

async function assertGuardChainHeld(chain) {
  for (const entry of chain) {
    entry.guard.assertHeld?.();
    const current = await fs.lstat(entry.path);
    if (!sameIdentity(entry.stat, current)) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed filesystem ancestor changed during the operation.');
  }
}

async function extendGuardChain(heldChain, paths, directoryGuard) {
  if (!heldChain?.length) {
    const owned = await acquireGuardChain(paths, directoryGuard);
    return { chain: owned, owned };
  }
  await assertGuardChainHeld(heldChain);
  const held = new Map(heldChain.map((entry) => [path.resolve(entry.path), entry]));
  const missing = [];
  let encounteredMissing = false;
  for (const directory of paths) {
    const entry = held.get(path.resolve(directory));
    if (!encounteredMissing && entry) continue;
    encounteredMissing = true;
    missing.push(directory);
  }
  const owned = await acquireGuardChain(missing, directoryGuard);
  return { chain: [...heldChain, ...owned], owned };
}

async function verifyImmediateNamespace(directory, snapshot, filesystemEntryVerifier) {
  await filesystemEntryVerifier(directory);
  for (const name of snapshot.keys()) await filesystemEntryVerifier(path.join(directory, name));
}

async function extendMutableGuardChain(chain, root, target, directoryGuard) {
  const extended = await extendGuardChain(chain, managedGuardPaths(root, target), directoryGuard);
  chain.push(...extended.owned);
  return chain.find((entry) => path.resolve(entry.path) === path.resolve(target)) ?? null;
}

async function releaseDirectoryEntries(entries, released = new Set()) {
  for (const entry of [...entries].sort((left, right) => right.path.length - left.path.length)) {
    released.add(entry);
    await entry.guard.release();
  }
  return released;
}

async function rebindDirectoryEntries(entries, directoryGuard) {
  const ordered = [...entries].sort((left, right) => left.path.length - right.path.length);
  for (const entry of ordered) {
    const before = await fs.lstat(entry.path);
    if (!sameIdentity(entry.stat, before)) {
      throw namespaceDiscontinuity('A managed namespace parent changed during its child operation.');
    }
  }
  const reboundEntries = [];
  let reboundBatch = null;
  try {
    reboundBatch = ordered.length > 1 && typeof directoryGuard?.batch === 'function'
      ? await directoryGuard.batch(ordered.map((entry) => entry.path))
      : null;
    if (reboundBatch && (!Array.isArray(reboundBatch) || reboundBatch.length !== ordered.length)) {
      throw namespaceDiscontinuity('A managed namespace parent guard batch returned an invalid result.');
    }
    for (let index = 0; index < ordered.length; index += 1) {
      const entry = ordered[index];
      const rebound = reboundBatch ? reboundBatch[index] : await directoryGuard(entry.path);
      if (!rebound || typeof rebound.release !== 'function') {
        throw namespaceDiscontinuity('A managed namespace parent guard is unavailable.');
      }
      const reboundEntry = { entry, guard: rebound, stat: null };
      if (!reboundBatch) reboundEntries.push(reboundEntry);
      rebound.assertHeld?.();
      const checked = await fs.lstat(entry.path);
      if (!sameIdentity(entry.stat, checked)) {
        throw namespaceDiscontinuity('A managed namespace parent changed while its guard was rebound.');
      }
      reboundEntry.stat = checked;
      if (reboundBatch) reboundEntries.push(reboundEntry);
    }
  } catch (error) {
    const acquired = Array.isArray(reboundBatch) ? reboundBatch : reboundEntries.map((item) => item.guard);
    await releaseGuards(...acquired.filter((guard) => guard && typeof guard.release === 'function')).catch(() => undefined);
    throw error;
  }
  for (const rebound of reboundEntries) {
    rebound.entry.guard = rebound.guard;
    rebound.entry.stat = rebound.stat;
  }
}

async function renameGuardedDirectory(
  source,
  destination,
  chain,
  directoryGuard,
  filesystemEntryVerifier = assertWindowsFilesystemEntry,
) {
  if (path.dirname(source) === source || path.dirname(destination) === destination || source === destination) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world rename escaped its namespace.');
  }
  const guardRoot = chain[0]?.path;
  if (!guardRoot) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world rename omitted its guard root.');
  const sourceParent = path.dirname(source);
  const destinationParent = path.dirname(destination);
  await extendMutableGuardChain(chain, guardRoot, sourceParent, directoryGuard);
  await extendMutableGuardChain(chain, guardRoot, destinationParent, directoryGuard);
  const parentEntries = [...new Map([sourceParent, destinationParent].map((parent) => {
    const entry = chain.find((candidate) => path.resolve(candidate.path) === path.resolve(parent));
    return [path.resolve(parent), entry];
  })).values()];
  if (parentEntries.some((entry) => !entry)) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world rename omitted a namespace-parent guard.');
  }
  await assertGuardChainHeld(chain);
  if (await lstatOrNull(destination)) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world rename destination was already occupied.');
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world rename source is unsafe.');
  let sourceGuard = null;
  let sourceGuardConsumed = false;
  const releasedParents = new Set();
  let renameCompleted = false;
  let movedGuard = null;
  try {
    sourceGuard = await directoryGuard(source);
    if (!sourceGuard || typeof sourceGuard.release !== 'function' || typeof sourceGuard.rename !== 'function') {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world rename source guard is unavailable.');
    }
    sourceGuard.assertHeld?.();
    const checked = await fs.lstat(source);
    if (!sameIdentity(sourceStat, checked)) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world rename source changed before publication.');
    const snapshots = new Map();
    for (const entry of parentEntries) {
      snapshots.set(path.resolve(entry.path), await captureGuardedNamespace(entry.path, {
        maximumEntries: MAX_FILES,
        label: 'Managed world rename namespace',
        verifyNamespace: (root, snapshot) => verifyImmediateNamespace(root, snapshot, filesystemEntryVerifier),
      }));
    }
    const expected = new Map([...snapshots].map(([key, value]) => [key, new Map(value)]));
    const sourceNamespace = expected.get(path.resolve(sourceParent));
    const destinationNamespace = expected.get(path.resolve(destinationParent));
    const sourceName = path.basename(source);
    const destinationName = path.basename(destination);
    const sourceEntry = sourceNamespace.get(sourceName);
    if (!sourceEntry || sourceEntry.kind !== 'directory' || !sameIdentity(sourceEntry.stat, sourceStat)
      || destinationNamespace.has(destinationName)) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world rename namespace changed before publication.');
    }
    sourceNamespace.delete(sourceName);
    destinationNamespace.set(destinationName, sourceEntry);
    await releaseDirectoryEntries(parentEntries, releasedParents);
    const remainingChain = chain.filter((entry) => !releasedParents.has(entry));
    await assertGuardChainHeld(remainingChain);
    for (const entry of parentEntries) {
      if (!sameIdentity(entry.stat, await fs.lstat(entry.path))) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world rename parent changed at publication.');
      }
    }
    sourceGuardConsumed = true;
    await sourceGuard.rename(destination);
    renameCompleted = true;
    movedGuard = await directoryGuard(destination);
    movedGuard.assertHeld?.();
    const moved = await fs.lstat(destination);
    if (!sameIdentity(sourceStat, moved)) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world rename changed identity during publication.');
    await rebindDirectoryEntries([...releasedParents], directoryGuard);
    releasedParents.clear();
    await assertGuardChainHeld(chain);
    for (const entry of parentEntries) {
      const observed = await captureGuardedNamespace(entry.path, {
        maximumEntries: MAX_FILES,
        label: 'Managed world rename namespace',
        verifyNamespace: (root, snapshot) => verifyImmediateNamespace(root, snapshot, filesystemEntryVerifier),
      });
      assertExactNamespace(expected.get(path.resolve(entry.path)), observed, 'Managed world rename namespace');
    }
    const final = await fs.lstat(destination);
    if (!sameIdentity(sourceStat, final)) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A published managed world changed identity.');
    await assertGuardChainHeld(chain);
  } finally {
    let failure = null;
    if (releasedParents.size > 0) {
      try {
        await rebindDirectoryEntries([...releasedParents], directoryGuard);
        releasedParents.clear();
      } catch (error) { failure = error; }
    }
    if (sourceGuard && !sourceGuardConsumed) {
      try { await sourceGuard.release(); } catch (error) { failure ??= error; }
    } else if (!renameCompleted && await lstatOrNull(source)) {
      // A terminal native rename attempt can fail without consuming the named
      // source; startup must see that failure instead of silently continuing.
      failure ??= worldError('WORLD_INTEGRITY_FAILED', 409, 'A guarded world rename did not complete safely.');
    }
    try { await movedGuard?.release(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  }
}

async function assertDirectory(target, parent, label) {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} is not a safe managed directory.`);
  const [realTarget, realParent] = await Promise.all([fs.realpath(target), fs.realpath(parent)]);
  if (!contained(realTarget, realParent)) throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} escaped its managed boundary.`);
  return stat;
}

function sameIdentity(left, right) {
  return Boolean(left && right)
    && left.isDirectory() === right.isDirectory()
    && left.isFile() === right.isFile()
    && left.nlink === right.nlink
    && (!left.ino || !right.ino || (left.dev === right.dev && left.ino === right.ino));
}

async function readDirectoryNamespace(directory, maximumEntries, label) {
  const entries = await readBoundedDirectoryEntries(
    directory,
    maximumEntries,
    () => namespaceDiscontinuity(`${label} exceeded its bounded namespace.`),
  );
  const snapshot = new Map();
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    const stat = await fs.lstat(target);
    const kind = stat.isDirectory() && !stat.isSymbolicLink()
      ? 'directory'
      : stat.isFile() && !stat.isSymbolicLink() ? 'file' : null;
    if (!kind || (kind === 'file' && stat.nlink !== 1)) {
      throw namespaceDiscontinuity(`${label} contains an unsafe filesystem entry.`);
    }
    snapshot.set(entry.name, { kind, stat, size: kind === 'file' ? stat.size : null });
  }
  return snapshot;
}

function sameNamespaceEntry(left, right) {
  return Boolean(left && right) && left.kind === right.kind && left.size === right.size
    && sameIdentity(left.stat, right.stat);
}

function assertExactNamespace(expected, observed, label) {
  if (expected.size !== observed.size) {
    throw namespaceDiscontinuity(`${label} changed during its guarded filesystem transition.`);
  }
  for (const [name, entry] of expected) {
    if (!sameNamespaceEntry(entry, observed.get(name))) {
      throw namespaceDiscontinuity(`${label} changed during its guarded filesystem transition.`);
    }
  }
}

async function captureGuardedNamespace(directory, {
  maximumEntries,
  label,
  verifyNamespace,
}) {
  const before = await readDirectoryNamespace(directory, maximumEntries, label);
  await verifyNamespace(directory, before);
  const after = await readDirectoryNamespace(directory, maximumEntries, label);
  assertExactNamespace(before, after, label);
  return after;
}

function namespaceAfterRename(before, sourceName, destinationName, label) {
  const expected = new Map(before);
  const source = expected.get(sourceName);
  if (!source || expected.has(destinationName)) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} did not match its guarded rename precondition.`);
  }
  expected.delete(sourceName);
  expected.set(destinationName, source);
  return expected;
}

function namespaceAfterReplacement(before, temporaryName, destinationName, label) {
  const expected = new Map(before);
  const temporary = expected.get(temporaryName);
  if (!temporary || temporary.kind !== 'file') {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} omitted its guarded temporary output.`);
  }
  expected.delete(temporaryName);
  expected.delete(destinationName);
  expected.set(destinationName, temporary);
  return expected;
}

function namespaceAfterDeletion(before, childName, label) {
  const expected = new Map(before);
  if (!expected.delete(childName)) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} omitted its guarded deletion target.`);
  }
  return expected;
}

async function assertUnchangedDirectory(target, expected, boundary, label) {
  const current = await assertDirectory(target, boundary, label);
  if (!sameIdentity(expected, current)) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} changed during the filesystem operation.`);
  }
  return current;
}

async function ensureGuardedChildDirectory(
  parent,
  name,
  chain,
  directoryGuard,
  filesystemEntryVerifier,
  label,
) {
  assertSafeEntryName(name);
  await assertGuardChainHeld(chain);
  const parentEntry = chain.find((entry) => path.resolve(entry.path) === path.resolve(parent));
  if (!parentEntry) throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} parent is not anchored by a held guard.`);
  parentEntry.guard.assertHeld?.();
  const parentStat = await fs.lstat(parent);
  if (!sameIdentity(parentEntry.stat, parentStat)) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} parent changed during initialization.`);
  }
  const target = path.join(parent, name);
  let expected = await lstatOrNull(target);
  if (!expected) {
    await fs.mkdir(target, { recursive: false, mode: 0o700 });
    expected = await fs.lstat(target);
  }
  if (!expected.isDirectory() || expected.isSymbolicLink()) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} is not a safe managed directory.`);
  }
  await filesystemEntryVerifier(target);
  const guard = await directoryGuard(target);
  try {
    guard.assertHeld?.();
    const checked = await fs.lstat(target);
    if (!sameIdentity(expected, checked)) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} changed while its guard was acquired.`);
    }
    await filesystemEntryVerifier(target);
    await assertGuardChainHeld(chain);
    chain.push({ path: target, stat: checked, guard });
    return target;
  } catch (error) {
    await guard.release().catch(() => undefined);
    throw error;
  }
}

async function createGuardedChildDirectory(parent, name, chain, directoryGuard, label) {
  assertSafeEntryName(name);
  await assertGuardChainHeld(chain);
  const target = path.join(parent, name);
  if (await lstatOrNull(target)) throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} was already occupied.`);
  await fs.mkdir(target, { mode: 0o700 });
  const created = await fs.lstat(target);
  if (!created.isDirectory() || created.isSymbolicLink()) throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} was not created safely.`);
  const guard = await directoryGuard(target);
  try {
    guard.assertHeld?.();
    const named = await fs.lstat(target);
    if (!sameIdentity(created, named)) throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} changed during creation.`);
    await assertGuardChainHeld(chain);
  } finally { await guard.release(); }
  return target;
}

async function mutateWithReleasedDirectoryParent({
  chain,
  parent,
  directoryGuard,
  filesystemEntryVerifier,
  label,
  mutate,
  expectedNamespace,
}) {
  const parentEntry = chain.find((entry) => path.resolve(entry.path) === path.resolve(parent));
  if (!parentEntry || typeof mutate !== 'function' || typeof expectedNamespace !== 'function') {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} is missing its guarded parent mutation contract.`);
  }
  const ancestors = chain.filter((entry) => entry !== parentEntry);
  if (ancestors.length < 1) throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} parent is not anchored.`);
  await assertGuardChainHeld(chain);
  const before = await captureGuardedNamespace(parent, {
    maximumEntries: MAX_FILES,
    label,
    verifyNamespace: (root, snapshot) => verifyImmediateNamespace(root, snapshot, filesystemEntryVerifier),
  });
  let mutationError = null;
  let rebindError = null;
  await parentEntry.guard.release();
  try { await mutate(); } catch (error) { mutationError = error; }
  try {
    await assertGuardChainHeld(ancestors);
    await rebindDirectoryEntries([parentEntry], directoryGuard);
    const after = await captureGuardedNamespace(parent, {
      maximumEntries: MAX_FILES,
      label,
      verifyNamespace: (root, snapshot) => verifyImmediateNamespace(root, snapshot, filesystemEntryVerifier),
    });
    if (!mutationError) assertExactNamespace(expectedNamespace(before), after, label);
  } catch (error) { rebindError = error; }
  if (mutationError && rebindError) {
    throw new AggregateError([mutationError, rebindError], `${label} failed and its parent could not be rebound.`);
  }
  if (rebindError) throw rebindError;
  if (mutationError) throw mutationError;
  await assertGuardChainHeld(chain);
}

function managedWorldTreeTombstone(target) {
  const resolved = path.resolve(target);
  const name = path.basename(resolved);
  assertSafeEntryName(name);
  return path.join(path.dirname(resolved), `.delete-${name}`);
}

async function managedWorldTreeRemovalPending(target) {
  return Boolean(await lstatOrNull(target)) || Boolean(await lstatOrNull(managedWorldTreeTombstone(target)));
}

async function removeManagedTree(target, parent, label, {
  guardRoot = parent,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  filesystemEntryVerifier = assertWindowsFilesystemEntry,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = acquireWindowsFileGuard,
  isolatedBatchDeletion = false,
} = {}) {
  const directParent = path.dirname(path.resolve(target));
  if (!contained(directParent, parent) || directParent === path.resolve(target)) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} escaped its managed boundary.`);
  }
  const tombstone = managedWorldTreeTombstone(target);
  const [targetStat, tombstoneStat] = await Promise.all([lstatOrNull(target), lstatOrNull(tombstone)]);
  if (targetStat && tombstoneStat) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} and its recoverable cleanup tombstone both exist.`);
  }
  if (!targetStat && !tombstoneStat) return false;
  const chain = await acquireAnchoredGuardChain(guardRoot, directParent, `${label} parent`, directoryGuard);
  try {
    if (targetStat) {
      await assertDirectory(target, parent, label);
      await renameGuardedDirectory(target, tombstone, chain, directoryGuard, filesystemEntryVerifier);
      const moved = await fs.lstat(tombstone);
      if (!sameIdentity(targetStat, moved) || await lstatOrNull(target)) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} changed while being isolated.`);
      }
    } else if (!tombstoneStat.isDirectory() || tombstoneStat.isSymbolicLink()) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, `${label} cleanup tombstone is unsafe.`);
    }
    await (isolatedBatchDeletion ? deleteIsolatedTreeBatchGuarded : deleteTombstonedTree)(
      tombstone, chain, filesystemTreeVerifier, filesystemEntryVerifier, directoryGuard, fileGuard,
    );
    await assertGuardChainHeld(chain);
    return true;
  } finally { await releaseGuards(...chain.map((entry) => entry.guard)); }
}

export async function removeManagedFabricRuntimeCache(managedRoot, instance, options = {}) {
  if (!instance || typeof instance.directory !== 'string' || !path.isAbsolute(instance.directory)
    || !contained(instance.directory, managedRoot)) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The Fabric runtime cache escaped its managed instance boundary.');
  }
  return removeManagedTree(
    path.join(instance.directory, '.fabric'),
    instance.directory,
    'Fabric runtime cache',
    { guardRoot: managedRoot, isolatedBatchDeletion: true, ...options },
  );
}

async function deleteTombstonedTree(
  root,
  parentChain,
  filesystemTreeVerifier,
  filesystemEntryVerifier,
  directoryGuard,
  fileGuard,
) {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, 'An isolated world cleanup root is unsafe.');
  }
  await filesystemTreeVerifier(root, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
  await filesystemEntryVerifier(root);
  let rootGuard = null;
  let checkedRoot;
  try {
    rootGuard = await directoryGuard(root);
    if (!rootGuard || typeof rootGuard.release !== 'function' || typeof rootGuard.delete !== 'function') {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'An isolated world cleanup root guard is unavailable.');
    }
    rootGuard.assertHeld?.();
    checkedRoot = await fs.lstat(root);
    if (!sameIdentity(rootStat, checkedRoot)) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'An isolated world cleanup root changed before deletion.');
    }
  } catch (error) {
    await rootGuard?.release?.().catch(() => undefined);
    throw error;
  }
  const rootEntry = { path: root, stat: checkedRoot, guard: rootGuard };
  const budget = { entries: 0, bytes: 0 };
  const acquireCleanupGuards = async (descriptors) => {
    const acquired = [];
    const acquireKind = async (selected, factory) => {
      if (selected.length === 0) return;
      let batch = null;
      if (selected.length > 1 && typeof factory?.batch === 'function') {
        batch = await factory.batch(selected.map((descriptor) => descriptor.target));
        if (!Array.isArray(batch) || batch.length !== selected.length) {
          if (Array.isArray(batch)) {
            await releaseGuards(...batch.filter((guard) => guard && typeof guard.release === 'function')).catch(() => undefined);
          }
          throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world cleanup guard batch returned an invalid result.');
        }
        if (batch.some((guard) => !guard || typeof guard.release !== 'function' || typeof guard.delete !== 'function')) {
          await releaseGuards(...batch.filter((guard) => guard && typeof guard.release === 'function')).catch(() => undefined);
          throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world cleanup guard batch returned an invalid guard.');
        }
        acquired.push(...batch);
      }
      for (let index = 0; index < selected.length; index += 1) {
        const descriptor = selected[index];
        const guard = batch ? batch[index] : await factory(descriptor.target);
        if (!batch && guard && typeof guard.release === 'function') acquired.push(guard);
        if (!guard || typeof guard.release !== 'function' || typeof guard.delete !== 'function') {
          throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world cleanup guard is unavailable.');
        }
        descriptor.guard = guard;
      }
    };
    try {
      await acquireKind(descriptors.filter((descriptor) => descriptor.stat.isDirectory()), directoryGuard);
      await acquireKind(descriptors.filter((descriptor) => descriptor.stat.isFile()), fileGuard);
      for (const descriptor of descriptors) {
        descriptor.guard.assertHeld?.();
        await filesystemEntryVerifier(descriptor.target);
        const checked = await fs.lstat(descriptor.target);
        if (!sameIdentity(descriptor.stat, checked)) {
          throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A managed world entry changed before cleanup.');
        }
        descriptor.stat = checked;
      }
    } catch (error) {
      await releaseGuards(...acquired).catch(() => undefined);
      for (const descriptor of descriptors) descriptor.guard = null;
      throw error;
    }
  };
  const erase = async (directory, chain, depth) => {
    if (depth > MAX_DEPTH) throw worldError('WORLD_QUOTA_EXCEEDED', 413, 'The managed world exceeded its directory-depth limit.');
    await assertGuardChainHeld(chain);
    const remaining = MAX_FILES - budget.entries;
    const entries = await readBoundedDirectoryEntries(
      directory,
      remaining,
      () => worldError('WORLD_QUOTA_EXCEEDED', 507, 'The managed world exceeded its safe entry-count limit.'),
    );
    for (let offset = 0; offset < entries.length; offset += MAX_GUARD_BATCH) {
      const descriptors = [];
      for (const entry of entries.slice(offset, offset + MAX_GUARD_BATCH)) {
        budget.entries += 1;
        const target = path.join(directory, entry.name);
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
          throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The managed world contains an unsupported filesystem entry.');
        }
        if (stat.isFile()) {
          if (stat.nlink !== 1) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The managed world contains a hard-linked file.');
          budget.bytes += stat.size;
          if (!Number.isSafeInteger(budget.bytes) || budget.bytes > MAX_WORLD_BYTES) {
            throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'The managed world exceeded its safe storage limit.');
          }
        }
        descriptors.push({ entry, target, stat, guard: null });
      }
      await acquireCleanupGuards(descriptors);
      try {
        for (const descriptor of descriptors) {
          const { entry, target } = descriptor;
          if (descriptor.stat.isDirectory()) {
            const childChain = [...chain, { path: target, stat: descriptor.stat, guard: descriptor.guard }];
            const childEntry = childChain.at(-1);
            try { await erase(target, childChain, depth + 1); }
            finally { descriptor.guard = childEntry.guard; }
            await mutateWithReleasedDirectoryParent({
              chain,
              parent: directory,
              directoryGuard,
              filesystemEntryVerifier,
              label: 'Managed world cleanup directory namespace',
              mutate: async () => { await descriptor.guard.delete(); descriptor.guard = null; },
              expectedNamespace: (before) => namespaceAfterDeletion(before, entry.name, 'Managed world cleanup directory namespace'),
            });
          } else {
            await mutateWithReleasedDirectoryParent({
              chain,
              parent: directory,
              directoryGuard,
              filesystemEntryVerifier,
              label: 'Managed world cleanup file namespace',
              mutate: async () => { await descriptor.guard.delete(); descriptor.guard = null; },
              expectedNamespace: (before) => namespaceAfterDeletion(before, entry.name, 'Managed world cleanup file namespace'),
            });
          }
        }
      } finally {
        await releaseGuards(...descriptors.map((descriptor) => descriptor.guard).filter(Boolean)).catch(() => undefined);
      }
    }
    const remainingEntries = await readBoundedDirectoryEntries(directory, 1);
    if (remainingEntries.length !== 0) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'Managed world cleanup left unexpected entries.');
    }
  };
  try {
    const rootChain = [...parentChain, rootEntry];
    try { await erase(root, rootChain, 0); }
    finally { rootGuard = rootEntry.guard; }
    const parent = path.dirname(root);
    await mutateWithReleasedDirectoryParent({
      chain: parentChain,
      parent,
      directoryGuard,
      filesystemEntryVerifier,
      label: 'Managed world cleanup tombstone namespace',
      mutate: async () => { await rootGuard.delete(); rootGuard = null; },
      expectedNamespace: (before) => namespaceAfterDeletion(before, path.basename(root), 'Managed world cleanup tombstone namespace'),
    });
  } finally { await rootGuard?.release().catch(() => undefined); }
}

async function deleteIsolatedTreeBatchGuarded(
  root,
  parentChain,
  filesystemTreeVerifier,
  filesystemEntryVerifier,
  directoryGuard,
  fileGuard,
) {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, 'An isolated cache cleanup root is unsafe.');
  }
  await filesystemTreeVerifier(root, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
  const descriptors = [{ target: root, stat: rootStat, depth: 0, guard: null }];
  const budget = { entries: 0, bytes: 0 };
  const collect = async (directory, depth) => {
    if (depth > MAX_DEPTH) throw worldError('WORLD_QUOTA_EXCEEDED', 413, 'The isolated cache exceeded its directory-depth limit.');
    const entries = await readBoundedDirectoryEntries(
      directory,
      MAX_FILES - budget.entries,
      () => worldError('WORLD_QUOTA_EXCEEDED', 507, 'The isolated cache exceeded its safe entry-count limit.'),
    );
    for (const entry of entries) {
      budget.entries += 1;
      const target = path.join(directory, entry.name);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The isolated cache contains an unsupported filesystem entry.');
      }
      if (stat.isFile()) {
        if (stat.nlink !== 1) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The isolated cache contains a hard-linked file.');
        budget.bytes += stat.size;
        if (!Number.isSafeInteger(budget.bytes) || budget.bytes > MAX_WORLD_BYTES) {
          throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'The isolated cache exceeded its safe storage limit.');
        }
      }
      descriptors.push({ target, stat, depth: depth + 1, guard: null });
      if (stat.isDirectory()) await collect(target, depth + 1);
    }
  };
  await collect(root, 0);
  await assertGuardChainHeld(parentChain);

  const acquire = async (selected, factory) => {
    for (let offset = 0; offset < selected.length; offset += MAX_GUARD_BATCH) {
      const chunk = selected.slice(offset, offset + MAX_GUARD_BATCH);
      const batch = typeof factory?.batch === 'function'
        ? await factory.batch(chunk.map((descriptor) => descriptor.target))
        : await Promise.all(chunk.map((descriptor) => factory(descriptor.target)));
      if (!Array.isArray(batch) || batch.length !== chunk.length
        || batch.some((guard) => !guard || typeof guard.assertHeld !== 'function'
          || typeof guard.release !== 'function' || typeof guard.delete !== 'function')) {
        await releaseGuards(...(Array.isArray(batch) ? batch : []).filter((guard) => guard?.release)).catch(() => undefined);
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The isolated cache guard batch was incomplete.');
      }
      for (let index = 0; index < chunk.length; index += 1) chunk[index].guard = batch[index];
    }
  };

  try {
    await acquire(descriptors.filter((descriptor) => descriptor.stat.isDirectory()), directoryGuard);
    await acquire(descriptors.filter((descriptor) => descriptor.stat.isFile()), fileGuard);
    for (const descriptor of descriptors) {
      descriptor.guard.assertHeld();
      await filesystemEntryVerifier(descriptor.target);
      if (!sameIdentity(descriptor.stat, await fs.lstat(descriptor.target))) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'An isolated cache entry changed before deletion.');
      }
    }
    for (const descriptor of descriptors.filter((item) => item.stat.isFile())) {
      await descriptor.guard.delete();
      descriptor.guard = null;
    }
    const directories = descriptors.filter((item) => item.stat.isDirectory())
      .sort((left, right) => right.depth - left.depth);
    for (const descriptor of directories) {
      await descriptor.guard.delete();
      descriptor.guard = null;
    }
    if (await lstatOrNull(root)) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'Isolated cache cleanup left unexpected entries.');
    }
    await assertGuardChainHeld(parentChain);
  } finally {
    await releaseGuards(...descriptors.map((descriptor) => descriptor.guard).filter(Boolean)).catch(() => undefined);
  }
}

async function writeAtomic(file, value, boundary, {
  guardRoot = boundary,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = acquireWindowsFileGuard,
  filesystemEntryVerifier = assertWindowsFilesystemEntry,
  namespaceMaximumEntries = MAX_FILES,
  namespaceVerifier = null,
  validateNamespace = null,
  protectDirectoryChildren = false,
  heldChain = null,
} = {}) {
  const directory = path.dirname(file);
  if (!contained(file, boundary) || file === boundary) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'Private world state escaped its managed boundary.');
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (bytes.length > MAX_STATE_BYTES) throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'Private world state exceeded its safe size limit.');
  const directoryIdentity = await assertDirectory(directory, guardRoot, 'Private world-state directory');
  const guarded = await extendGuardChain(heldChain, managedGuardPaths(guardRoot, directory), directoryGuard);
  const chain = guarded.chain;
  const publicationDirectoryEntry = guarded.owned.find((entry) => path.resolve(entry.path) === path.resolve(directory)) ?? null;
  const publicationAncestors = publicationDirectoryEntry
    ? chain.filter((entry) => entry !== publicationDirectoryEntry)
    : chain;
  const temporary = path.join(directory, `.tmp-${crypto.randomBytes(16).toString('hex')}`);
  const verifyBoundedNamespace = namespaceVerifier ?? (async (root, snapshot) => {
    await filesystemEntryVerifier(root);
    for (const name of snapshot.keys()) await filesystemEntryVerifier(path.join(root, name));
  });
  if (!Number.isSafeInteger(namespaceMaximumEntries) || namespaceMaximumEntries < 1 || namespaceMaximumEntries > MAX_FILES
    || typeof verifyBoundedNamespace !== 'function'
    || (validateNamespace !== null && typeof validateNamespace !== 'function')
    || typeof protectDirectoryChildren !== 'boolean') {
    throw new TypeError('Invalid private world-state namespace verifier');
  }
  let temporaryCreated = false;
  let temporaryGuard = null;
  let temporaryGuardConsumed = false;
  let publicationDirectoryReleased = false;
  let replacementDirectoryGuard = null;
  const namespaceProtectionGuards = [];
  try {
    if (!publicationDirectoryEntry) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'Private world-state publication requires an owned destination-directory guard.');
    }
    await assertGuardChainHeld(chain);
    if (!sameIdentity(directoryIdentity, await fs.lstat(directory))) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'Private world-state directory changed before publication.');
    const existing = await lstatOrNull(file);
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state output is unsafe.');
      }
      await filesystemEntryVerifier(file);
    }
    await validateNamespace?.({ stage: 'before', destinationExisted: Boolean(existing), heldChain: chain });
    const handle = await fs.open(temporary, FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL, 0o600);
    temporaryCreated = true;
    let opened;
    try {
      await handle.writeFile(bytes); await handle.sync();
      opened = await handle.stat();
      const named = await fs.lstat(temporary);
      if (!opened.isFile() || opened.nlink !== 1 || opened.size !== bytes.length || !sameIdentity(opened, named)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state output changed while being written.');
      }
    } finally { await handle.close(); }
    await filesystemEntryVerifier(temporary);
    temporaryGuard = await fileGuard(temporary);
    temporaryGuard.assertHeld?.();
    const guarded = await fs.lstat(temporary);
    if (!sameIdentity(opened, guarded) || guarded.size !== bytes.length || guarded.nlink !== 1) {
      await temporaryGuard.release().catch(() => undefined);
      temporaryGuardConsumed = true;
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state output changed before publication.');
    }
    const namespaceBefore = await captureGuardedNamespace(directory, {
      maximumEntries: namespaceMaximumEntries,
      label: 'Private world-state namespace',
      verifyNamespace: verifyBoundedNamespace,
    });
    const expectedNamespace = namespaceAfterReplacement(
      namespaceBefore,
      path.basename(temporary),
      path.basename(file),
      'Private world-state namespace',
    );
    if (protectDirectoryChildren) {
      for (const [name, entry] of namespaceBefore) {
        if (entry.kind !== 'directory') continue;
        const child = path.join(directory, name);
        let guard = null;
        let registered = false;
        try {
          guard = await directoryGuard(child);
          if (!guard || typeof guard.release !== 'function') {
            throw namespaceDiscontinuity('A protected world-state namespace child guard is unavailable.');
          }
          guard.assertHeld?.();
          const checked = await fs.lstat(child);
          if (!sameIdentity(entry.stat, checked)) {
            throw namespaceDiscontinuity('A protected world-state namespace child changed before publication.');
          }
          namespaceProtectionGuards.push({ path: child, stat: checked, guard });
          registered = true;
        } finally {
          if (!registered) await guard?.release?.().catch(() => undefined);
        }
      }
    }
    await assertGuardChainHeld(chain);
    await filesystemEntryVerifier(directory);
    if (!sameIdentity(directoryIdentity, await fs.lstat(directory))) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'Private world-state directory changed before atomic publication.');
    }
    // A native Windows directory guard intentionally denies child renames. Keep
    // every ancestor through the destination directory's parent held, and keep
    // the exact temporary file handle guarded, while briefly releasing only the
    // leaf directory. The guarded temporary makes that leaf non-empty; the held
    // parent prevents its rename/removal. Reacquire and rebind the same leaf
    // identity immediately after the handle-based atomic replacement.
    publicationDirectoryReleased = true;
    await publicationDirectoryEntry.guard.release();
    await assertGuardChainHeld(publicationAncestors);
    if (!sameIdentity(directoryIdentity, await fs.lstat(directory))) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'Private world-state directory changed at atomic publication.');
    }
    temporaryGuardConsumed = true;
    await temporaryGuard.replace(file);
    temporaryCreated = false;
    replacementDirectoryGuard = await directoryGuard(directory);
    replacementDirectoryGuard.assertHeld?.();
    const reboundDirectory = await fs.lstat(directory);
    if (!sameIdentity(directoryIdentity, reboundDirectory)) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'Private world-state directory changed during atomic publication.');
    }
    const reboundNamespace = await captureGuardedNamespace(directory, {
      maximumEntries: namespaceMaximumEntries,
      label: 'Private world-state namespace',
      verifyNamespace: verifyBoundedNamespace,
    });
    assertExactNamespace(expectedNamespace, reboundNamespace, 'Private world-state namespace');
    await assertGuardChainHeld(namespaceProtectionGuards);
    await validateNamespace?.({
      stage: 'after',
      destinationExisted: true,
      heldChain: [
        ...publicationAncestors,
        { path: directory, stat: reboundDirectory, guard: replacementDirectoryGuard },
      ],
    });
    const published = await fs.lstat(file);
    if (!sameIdentity(opened, published) || published.size !== bytes.length || published.nlink !== 1) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state changed during publication.');
    }
    await filesystemEntryVerifier(file);
    await assertGuardChainHeld([
      ...publicationAncestors,
      { path: directory, stat: reboundDirectory, guard: replacementDirectoryGuard },
    ]);
  } catch (error) {
    if (temporaryCreated) {
      try {
        if (!publicationDirectoryReleased && publicationDirectoryEntry) {
          await assertGuardChainHeld(chain);
          publicationDirectoryReleased = true;
          await publicationDirectoryEntry.guard.release();
        }
        await assertGuardChainHeld(publicationAncestors);
        if (temporaryGuard && !temporaryGuardConsumed) {
          temporaryGuardConsumed = true;
          await temporaryGuard.delete();
        } else {
          const cleanupGuard = await fileGuard(temporary);
          cleanupGuard.assertHeld?.();
          await cleanupGuard.delete();
        }
      } catch { /* A suspicious temporary is deliberately left for fail-closed startup detection. */ }
    }
    throw error;
  } finally {
    await releaseGuards(
      ...guarded.owned
        .filter((entry) => entry !== publicationDirectoryEntry || !publicationDirectoryReleased)
        .map((entry) => entry.guard),
      replacementDirectoryGuard,
      ...namespaceProtectionGuards.map((entry) => entry.guard),
    );
  }
}

async function readRegularFile(file, maximumBytes, minimumBytes = 0) {
  const namedBefore = await fs.lstat(file);
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1
    || namedBefore.size < minimumBytes || namedBefore.size > maximumBytes) {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state is unavailable.');
  }
  const handle = await fs.open(file, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size !== namedBefore.size
      || (opened.ino && namedBefore.ino && (opened.dev !== namedBefore.dev || opened.ino !== namedBefore.ino))) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state changed during verification.');
    }
    const bytes = await handle.readFile();
    const [after, namedAfter] = await Promise.all([handle.stat(), fs.lstat(file)]);
    if (bytes.length !== opened.size || after.size !== opened.size || after.nlink !== 1
      || !namedAfter.isFile() || namedAfter.isSymbolicLink() || namedAfter.nlink !== 1
      || (opened.ino && namedAfter.ino && (opened.dev !== namedAfter.dev || opened.ino !== namedAfter.ino))) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state changed during verification.');
    }
    return bytes;
  } finally { await handle.close(); }
}

async function readJson(file) {
  let value; let bytes;
  try {
    bytes = await readRegularFile(file, MAX_STATE_BYTES, 2);
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'WORLD_STATE_UNAVAILABLE') throw error;
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state is malformed.');
  }
  const expected = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (bytes.length !== expected.length || !crypto.timingSafeEqual(bytes, expected)) {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state is not in its canonical persisted form.');
  }
  return value;
}

async function assertPrivateRootEntries(privateRoot, { catalogRequired = false } = {}) {
  const expected = new Map([
    ['storage', 'directory'], ['plans', 'directory'], ['transactions', 'directory'], ['operations', 'directory'],
  ]);
  if (catalogRequired) expected.set('catalog.json', 'file');
  for (const entry of await readBoundedDirectoryEntries(
    privateRoot,
    6,
    () => worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state exceeded its exact root-entry bound.'),
  )) {
    if (entry.name === 'catalog.json' && !catalogRequired) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world catalog storage is unsafe.');
      continue;
    }
    const kind = expected.get(entry.name);
    if (!kind || entry.isSymbolicLink() || (kind === 'file' ? !entry.isFile() : !entry.isDirectory())) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state contains an unexpected root entry.');
    }
    expected.delete(entry.name);
  }
  if (catalogRequired && expected.size !== 0) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state is incomplete.');
  if (!catalogRequired && expected.size !== 0) {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state is incomplete.');
  }
  return true;
}

function signRecord(key, value) {
  const unsigned = clone(value); delete unsigned.mac;
  return { ...unsigned, mac: sign(key, unsigned) };
}

function authenticateRecord(key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state is malformed.');
  const unsigned = clone(value); const mac = unsigned.mac; delete unsigned.mac;
  if (!timingEqual(mac, sign(key, unsigned))) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world state failed authentication.');
  return unsigned;
}

function decodeJavaProperties(text) {
  const physical = text.replace(/\r\n?/g, '\n').split('\n');
  const logical = [];
  let pending = '';
  for (let line of physical) {
    if (pending) line = line.replace(/^[ \t\f]+/, '');
    pending += line;
    let slashes = 0;
    for (let index = pending.length - 1; index >= 0 && pending[index] === '\\'; index -= 1) slashes += 1;
    if (slashes % 2 === 1) { pending = pending.slice(0, -1); continue; }
    logical.push(pending); pending = '';
  }
  if (pending) logical.push(pending);

  const unescape = (value) => {
    let output = '';
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] !== '\\') { output += value[index]; continue; }
      index += 1;
      if (index >= value.length) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'server.properties contains an invalid escape.');
      const marker = value[index];
      if (marker === 'u') {
        const hex = value.slice(index + 1, index + 5);
        if (!/^[0-9a-f]{4}$/i.test(hex)) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'server.properties contains an invalid Unicode escape.');
        output += String.fromCharCode(Number.parseInt(hex, 16)); index += 4;
      } else if (marker === 't') output += '\t';
      else if (marker === 'n') output += '\n';
      else if (marker === 'r') output += '\r';
      else if (marker === 'f') output += '\f';
      else output += marker;
    }
    return output;
  };

  const entries = [];
  for (const raw of logical) {
    const trimmed = raw.replace(/^[ \t\f]+/, '');
    if (!trimmed || trimmed[0] === '#' || trimmed[0] === '!') continue;
    let escaped = false; let separator = -1;
    for (let index = 0; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (!escaped && (character === '=' || character === ':' || /[ \t\f]/.test(character))) { separator = index; break; }
      if (character === '\\') escaped = !escaped; else escaped = false;
    }
    const keyText = separator < 0 ? trimmed : trimmed.slice(0, separator);
    let valueStart = separator < 0 ? trimmed.length : separator;
    while (/[ \t\f]/.test(trimmed[valueStart] ?? '')) valueStart += 1;
    if (trimmed[valueStart] === '=' || trimmed[valueStart] === ':') valueStart += 1;
    while (/[ \t\f]/.test(trimmed[valueStart] ?? '')) valueStart += 1;
    entries.push([unescape(keyText), unescape(trimmed.slice(valueStart))]);
  }
  return entries;
}

async function assertCanonicalLevelName(instanceDirectory) {
  const file = path.join(instanceDirectory, 'server.properties');
  let bytes;
  try { bytes = await readRegularFile(file, 1024 * 1024); }
  catch { throw worldError('WORLD_INTEGRITY_FAILED', 409, 'server.properties is not a safe managed file.'); }
  const entries = decodeJavaProperties(bytes.toString('utf8'));
  const values = entries.filter(([key]) => key === 'level-name').map(([, value]) => value);
  if (values.length !== 1 || values[0] !== ACTIVE_DIRECTORY_NAME) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, 'World management requires exactly one level-name=world setting.');
  }
}

class NbtReader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; this.nodes = 0; }
  need(length) { if (!Number.isInteger(length) || length < 0 || this.offset + length > this.bytes.length) throw new Error('truncated nbt'); }
  u8() { this.need(1); return this.bytes[this.offset++]; }
  i16() { this.need(2); const value = this.bytes.readInt16BE(this.offset); this.offset += 2; return value; }
  u16() { this.need(2); const value = this.bytes.readUInt16BE(this.offset); this.offset += 2; return value; }
  i32() { this.need(4); const value = this.bytes.readInt32BE(this.offset); this.offset += 4; return value; }
  skip(length) { this.need(length); this.offset += length; }
  string() {
    const length = this.u16(); if (length > 65_535) throw new Error('long nbt string'); this.need(length);
    const value = decodeModifiedUtf8(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length; return value;
  }
  payload(type, depth, visitor, pathParts) {
    this.nodes += 1;
    if (this.nodes > MAX_NBT_NODES || depth > MAX_DEPTH) throw new Error('nbt limits');
    if (type === 1) return this.skip(1);
    if (type === 2) return this.skip(2);
    if (type === 3) { const value = this.i32(); visitor(pathParts, type, value); return; }
    if (type === 4 || type === 6) return this.skip(8);
    if (type === 5) return this.skip(4);
    if (type === 7) { const length = this.i32(); if (length < 0 || length > MAX_NBT_COLLECTION) throw new Error('nbt array'); return this.skip(length); }
    if (type === 8) { const value = this.string(); visitor(pathParts, type, value); return; }
    if (type === 9) {
      const childType = this.u8(); const length = this.i32();
      if (length < 0 || length > MAX_NBT_COLLECTION || (childType === 0 && length !== 0)) throw new Error('nbt list');
      for (let index = 0; index < length; index += 1) this.payload(childType, depth + 1, visitor, [...pathParts, String(index)]);
      return;
    }
    if (type === 10) {
      const names = new Set();
      while (true) {
        const childType = this.u8(); if (childType === 0) return;
        const name = this.string();
        if (names.has(name)) throw new Error('duplicate nbt compound key');
        names.add(name); this.payload(childType, depth + 1, visitor, [...pathParts, name]);
      }
    }
    if (type === 11) { const length = this.i32(); if (length < 0 || length > MAX_NBT_COLLECTION) throw new Error('nbt int array'); return this.skip(length * 4); }
    if (type === 12) { const length = this.i32(); if (length < 0 || length > MAX_NBT_COLLECTION) throw new Error('nbt long array'); return this.skip(length * 8); }
    throw new Error('unknown nbt type');
  }
}

function decodeModifiedUtf8(bytes) {
  const units = [];
  for (let offset = 0; offset < bytes.length;) {
    const first = bytes[offset++];
    if (first >= 0x01 && first <= 0x7f) { units.push(first); continue; }
    if (first >= 0xc0 && first <= 0xdf) {
      if (offset >= bytes.length) throw new Error('truncated modified utf8');
      const second = bytes[offset++];
      if ((second & 0xc0) !== 0x80) throw new Error('invalid modified utf8 continuation');
      const unit = ((first & 0x1f) << 6) | (second & 0x3f);
      if (unit === 0) {
        if (first !== 0xc0 || second !== 0x80) throw new Error('noncanonical modified utf8 null');
      } else if (unit < 0x80) throw new Error('overlong modified utf8');
      units.push(unit); continue;
    }
    if (first >= 0xe0 && first <= 0xef) {
      if (offset + 1 >= bytes.length) throw new Error('truncated modified utf8');
      const second = bytes[offset++]; const third = bytes[offset++];
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) throw new Error('invalid modified utf8 continuation');
      const unit = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
      if (unit < 0x800) throw new Error('overlong modified utf8');
      units.push(unit); continue;
    }
    throw new Error('invalid modified utf8 leading byte');
  }
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = units[index + 1];
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new Error('unpaired modified utf8 surrogate');
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new Error('unpaired modified utf8 surrogate');
  }
  let output = '';
  for (let offset = 0; offset < units.length; offset += 4096) {
    output += String.fromCharCode(...units.slice(offset, offset + 4096));
  }
  return output;
}

function parseLevelDat(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_LEVEL_DAT_BYTES) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'level.dat exceeded its safe size.');
  let expanded;
  try { expanded = zlib.gunzipSync(bytes, { maxOutputLength: MAX_NBT_BYTES }); } catch { throw worldError('WORLD_INTEGRITY_FAILED', 409, 'level.dat is not valid bounded gzip NBT.'); }
  try {
    const reader = new NbtReader(expanded);
    if (reader.u8() !== 10) throw new Error('root is not compound');
    reader.string();
    let dataVersion = null; let levelName = null; let dataVersionCount = 0; let levelNameCount = 0;
    reader.payload(10, 0, (parts, type, value) => {
      if (parts.length === 2 && parts[0] === 'Data' && parts[1] === 'DataVersion' && type === 3) { dataVersion = value; dataVersionCount += 1; }
      if (parts.length === 2 && parts[0] === 'Data' && parts[1] === 'LevelName' && type === 8) { levelName = value; levelNameCount += 1; }
    }, []);
    if (reader.offset !== expanded.length || dataVersionCount !== 1 || levelNameCount > 1
      || !Number.isInteger(dataVersion) || dataVersion < 1) throw new Error('missing or duplicate dataversion');
    return { dataVersion, levelName: typeof levelName === 'string' ? levelName : null };
  } catch { throw worldError('WORLD_INTEGRITY_FAILED', 409, 'level.dat does not contain valid bounded world metadata.'); }
}

async function hashRegularFile(file, expectedStat, capture = false) {
  const flags = FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0);
  const handle = await fs.open(file, flags);
  const hash = crypto.createHash('sha256');
  const captured = capture ? Buffer.alloc(expectedStat.size) : null;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size !== expectedStat.size
      || (opened.ino && expectedStat.ino && (opened.dev !== expectedStat.dev || opened.ino !== expectedStat.ino))) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A world file changed during verification.');
    }
    const buffer = Buffer.allocUnsafe(1024 * 1024); let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (bytesRead < 1) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A world file could not be read completely.');
      hash.update(buffer.subarray(0, bytesRead));
      if (captured) buffer.copy(captured, position, 0, bytesRead);
      position += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.nlink !== 1) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A world file changed during verification.');
  } finally { await handle.close(); }
  const named = await fs.lstat(file);
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1
    || (named.ino && expectedStat.ino && (named.dev !== expectedStat.dev || named.ino !== expectedStat.ino))) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A world file path changed during verification.');
  }
  return { digest: hash.digest('hex'), bytes: captured };
}

async function assertWorldSessionLock(file, expectedStat) {
  if (!expectedStat.isFile() || expectedStat.isSymbolicLink() || expectedStat.nlink !== 1
    || ![8, MODERN_SESSION_LOCK.length].includes(expectedStat.size)) {
    throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The world session lock is unsafe.');
  }
  const handle = await fs.open(file, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    const bytes = await handle.readFile();
    const named = await fs.lstat(file);
    if (!opened.isFile() || opened.nlink !== 1 || bytes.length !== expectedStat.size
      || named.isSymbolicLink() || named.nlink !== 1 || !sameIdentity(opened, named)
      || !sameIdentity(expectedStat, opened) || opened.mtimeMs !== expectedStat.mtimeMs
      || (bytes.length === MODERN_SESSION_LOCK.length && !bytes.equals(MODERN_SESSION_LOCK))) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The world session lock is unsafe.');
    }
  } finally { await handle.close(); }
}

async function scanWorld(root, boundary, {
  allowPending = false,
  maximumDataVersion,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  directoryGuard = acquireWindowsDirectoryGuard,
} = {}) {
  if (!Number.isSafeInteger(maximumDataVersion) || maximumDataVersion < 1 || maximumDataVersion > 0x7fffffff) {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The trusted Minecraft world compatibility ceiling is unavailable.');
  }
  await filesystemTreeVerifier(root, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
  await assertDirectory(root, boundary, 'Managed world root');
  const files = []; let bytes = 0; let entryCount = 0; let levelDat = null;
  const seenPaths = new Set();
  const visit = async (directory, relativeDirectory, depth) => {
    if (depth > MAX_DEPTH) throw worldError('WORLD_QUOTA_EXCEEDED', 413, 'The world exceeded its directory-depth limit.');
    const guard = await directoryGuard(directory);
    try {
      const directoryBefore = await assertDirectory(directory, boundary, 'Managed world directory');
      for (const entry of await readBoundedDirectoryEntries(
        directory,
        MAX_FILES - entryCount,
        () => worldError('WORLD_QUOTA_EXCEEDED', 507, 'The world exceeded its safe entry-count limit.'),
      )) {
      entryCount += 1;
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const foldedPath = relative.normalize('NFKC').toLocaleLowerCase('en-US');
      if (seenPaths.has(foldedPath)) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The world contains colliding filesystem paths.');
      seenPaths.add(foldedPath);
      const target = path.join(directory, entry.name);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The world contains an unsupported filesystem entry.');
      if (relative === 'session.lock') {
        await assertWorldSessionLock(target, stat);
        continue;
      }
      if (stat.isDirectory()) { await visit(target, relative, depth + 1); continue; }
      if (stat.nlink !== 1) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The world contains a hard-linked file.');
      if (files.length >= MAX_FILES || bytes + stat.size > MAX_WORLD_BYTES) throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'The world exceeded its safe storage limit.');
      if (relative === 'level.dat' && stat.size > MAX_LEVEL_DAT_BYTES) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'level.dat exceeded its safe size.');
      const hashed = await hashRegularFile(target, stat, relative === 'level.dat');
      files.push({ path: relative, size: stat.size, sha256: hashed.digest }); bytes += stat.size;
      if (relative === 'level.dat') levelDat = hashed.bytes;
      }
      const directoryAfter = await fs.lstat(directory);
      if (!directoryAfter.isDirectory() || directoryAfter.isSymbolicLink()
        || directoryAfter.mtimeMs !== directoryBefore.mtimeMs
        || (directoryAfter.ino && directoryBefore.ino
          && (directoryAfter.dev !== directoryBefore.dev || directoryAfter.ino !== directoryBefore.ino))) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A world directory changed during verification.');
      }
    } finally { await guard.release(); }
  };
  await visit(root, '', 0);
  await filesystemTreeVerifier(root, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
  files.sort((left, right) => left.path.localeCompare(right.path, 'en-US'));
  if (!levelDat && !allowPending) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The world does not contain a valid level.dat.');
  const metadata = levelDat ? parseLevelDat(levelDat) : { dataVersion: null, levelName: null };
  if (metadata.dataVersion !== null && metadata.dataVersion > maximumDataVersion) {
    throw worldError('WORLD_VERSION_INCOMPATIBLE', 409, 'This world was created by a newer Minecraft data version.');
  }
  return { files: files.length, bytes, digest: sha256(canonical(files)), dataVersion: metadata.dataVersion, levelName: metadata.levelName, pendingGeneration: !levelDat };
}

async function copyWorld(
  source, destination, sourceBoundary, destinationBoundary,
  filesystemTreeVerifier = assertWindowsFilesystemTree,
  directoryGuard = acquireWindowsDirectoryGuard,
  guardRoot = destinationBoundary,
  fileGuard = acquireWindowsFileGuard,
  filesystemEntryVerifier = assertWindowsFilesystemEntry,
) {
  await filesystemTreeVerifier(source, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
  const sourceRoot = await assertDirectory(source, sourceBoundary, 'World copy source');
  const destinationParent = path.dirname(destination);
  const destinationParentRoot = await assertDirectory(destinationParent, destinationBoundary, 'World copy parent');
  await filesystemTreeVerifier(destinationParent, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
  const ancestorChain = await acquireAnchoredGuardChain(guardRoot, destinationParent, 'World copy parent', directoryGuard);
  let entries = 0; let bytes = 0;
  const copyDirectory = async (from, to, depth) => {
    if (depth > MAX_DEPTH) throw worldError('WORLD_QUOTA_EXCEEDED', 413, 'The world exceeded its directory-depth limit.');
    const sourceGuard = await directoryGuard(from);
    let destinationGuard;
    try {
      destinationGuard = await directoryGuard(to);
      const directoryBefore = await assertDirectory(from, sourceBoundary, 'World copy source directory');
      for (const entry of await readBoundedDirectoryEntries(
        from,
        MAX_FILES - entries,
        () => worldError('WORLD_QUOTA_EXCEEDED', 507, 'The world exceeded its safe entry-count limit.'),
      )) {
      entries += 1;
      const sourcePath = path.join(from, entry.name); const targetPath = path.join(to, entry.name);
      const stat = await fs.lstat(sourcePath);
      if (depth === 0 && entry.name === 'session.lock') {
        await assertWorldSessionLock(sourcePath, stat);
        continue;
      }
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1)) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The source world contains an unsupported filesystem entry.');
      }
      const targetParentBefore = await assertDirectory(to, destinationBoundary, 'World copy destination parent');
      if (stat.isDirectory()) {
        await fs.mkdir(targetPath, { mode: 0o700 });
        await assertUnchangedDirectory(to, targetParentBefore, destinationBoundary, 'World copy destination parent');
        await copyDirectory(sourcePath, targetPath, depth + 1);
        continue;
      }
      if (!Number.isSafeInteger(stat.size) || bytes + stat.size > MAX_WORLD_BYTES) throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'The world exceeded its safe storage limit.');
      bytes += stat.size;
      const input = await fs.open(sourcePath, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
      const output = await fs.open(targetPath, 'wx', 0o600);
      try {
        const opened = await input.stat();
        const outputOpened = await output.stat();
        const targetNamed = await fs.lstat(targetPath);
        if (!opened.isFile() || opened.nlink !== 1 || opened.size !== stat.size
          || (opened.ino && stat.ino && (opened.dev !== stat.dev || opened.ino !== stat.ino))
          || !outputOpened.isFile() || outputOpened.nlink !== 1 || !sameIdentity(outputOpened, targetNamed)) {
          throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The world copy path changed during creation.');
        }
        await assertUnchangedDirectory(to, targetParentBefore, destinationBoundary, 'World copy destination parent');
        const buffer = Buffer.allocUnsafe(1024 * 1024); let position = 0;
        while (position < opened.size) {
          const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, opened.size - position), position);
          if (bytesRead < 1) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The source world could not be copied completely.');
          let offset = 0;
          while (offset < bytesRead) { const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset); if (bytesWritten < 1) throw new Error('short write'); offset += bytesWritten; }
          position += bytesRead;
        }
        await output.sync();
        const after = await input.stat();
        if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.nlink !== 1) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The source world changed during copying.');
      } finally { await Promise.allSettled([input.close(), output.close()]); }
      const namedAfter = await fs.lstat(sourcePath);
      if (!namedAfter.isFile() || namedAfter.isSymbolicLink() || namedAfter.nlink !== 1
        || namedAfter.size !== stat.size || namedAfter.mtimeMs !== stat.mtimeMs
        || (namedAfter.ino && stat.ino && (namedAfter.dev !== stat.dev || namedAfter.ino !== stat.ino))) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A source world file path changed during copying.');
      }
      await assertUnchangedDirectory(to, targetParentBefore, destinationBoundary, 'World copy destination parent');
      }
      const directoryAfter = await fs.lstat(from);
      if (!directoryAfter.isDirectory() || directoryAfter.isSymbolicLink()
        || directoryAfter.mtimeMs !== directoryBefore.mtimeMs
        || (directoryAfter.ino && directoryBefore.ino
          && (directoryAfter.dev !== directoryBefore.dev || directoryAfter.ino !== directoryBefore.ino))) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A source world directory changed during copying.');
      }
    } finally {
      let releaseError = null;
      try { await destinationGuard?.release(); } catch (error) { releaseError = error; }
      try { await sourceGuard.release(); } catch (error) { releaseError ??= error; }
      if (releaseError) throw releaseError;
    }
  };
  let failure = null;
  try {
    await assertGuardChainHeld(ancestorChain);
    if (await lstatOrNull(destination)) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'Generated world storage was already occupied.');
    await fs.mkdir(destination, { mode: 0o700 });
    await assertUnchangedDirectory(destinationParent, destinationParentRoot, destinationBoundary, 'World copy parent');
    await copyDirectory(source, destination, 0);
    await filesystemTreeVerifier(source, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
    await filesystemTreeVerifier(destination, { maxEntries: MAX_FILES, maxDepth: MAX_DEPTH });
    const sourceAfter = await fs.lstat(source);
    if (!sourceAfter.isDirectory() || sourceAfter.isSymbolicLink()
      || sourceAfter.mtimeMs !== sourceRoot.mtimeMs
      || (sourceAfter.ino && sourceRoot.ino && (sourceAfter.dev !== sourceRoot.dev || sourceAfter.ino !== sourceRoot.ino))) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The source world root changed during copying.');
    }
    await assertGuardChainHeld(ancestorChain);
  } catch (error) { failure = error; }
  try { await releaseGuards(...ancestorChain.map((entry) => entry.guard)); } catch (error) { failure ??= error; }
  if (failure) {
    await removeManagedTree(destination, destinationBoundary, 'World copy staging', {
      guardRoot, filesystemTreeVerifier, filesystemEntryVerifier, directoryGuard, fileGuard,
    }).catch(() => undefined);
    throw failure;
  }
}

async function assertFreeSpace(directory, requiredBytes) {
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0 || requiredBytes > MAX_WORLD_BYTES) {
    throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'The planned world copy exceeds its storage limit.');
  }
  let statistics;
  try { statistics = await fs.statfs(directory); } catch { throw worldError('WORLD_STORAGE_FULL', 507, 'World storage capacity could not be verified safely.'); }
  const available = statistics.bavail * statistics.bsize;
  const reserve = 128 * 1024 * 1024;
  if (!Number.isSafeInteger(available) || available < requiredBytes + reserve) {
    throw worldError('WORLD_STORAGE_FULL', 507, 'There is not enough verified free space for this world operation.');
  }
}

function worldRecordPublic(record, currentMinecraftVersion, currentStack, activeUnverified = false) {
  let integrity = record.pendingGeneration ? 'pending-generation' : 'verified';
  if (activeUnverified && record.state === 'active') integrity = 'unverified-active';
  if (record.state === 'archived' && (record.minecraftVersion !== currentMinecraftVersion
    || record.stackGeneration !== currentStack.generation || record.modsInventoryDigest !== currentStack.inventoryDigest)) integrity = 'locked-version';
  return {
    worldRef: record.worldRef, displayLabel: record.displayLabel, state: record.state,
    pendingGeneration: record.pendingGeneration, minecraftVersion: record.minecraftVersion,
    dataVersion: record.dataVersion, createdAt: record.createdAt, updatedAt: record.updatedAt,
    files: record.files, bytes: record.bytes, integrity,
  };
}

function publicOperation(value) {
  return {
    requestId: value.requestId, planId: value.planId, planDigest: value.planDigest,
    operation: value.operation, state: value.state, application: APPLICATIONS[value.state],
    transactionRef: value.transactionRef, failureCode: value.failureCode, result: value.result,
    startedAt: value.startedAt, updatedAt: value.updatedAt,
  };
}

function validateCatalog(value, instanceId) {
  if (!exactKeys(value, ['schemaVersion', 'instanceId', 'revision', 'activeWorldRef', 'worlds', 'createdAt', 'updatedAt'])
    || value.schemaVersion !== 1 || value.instanceId !== instanceId || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !WORLD_REF.test(value.activeWorldRef ?? '') || !Array.isArray(value.worlds) || value.worlds.length < 1 || value.worlds.length > MAX_WORLDS
    || !iso(value.createdAt) || !iso(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world catalog is invalid.');
  }
  const refs = new Set(); const labels = new Set(); let active = 0; let totalBytes = 0;
  for (const record of value.worlds) {
    if (!exactKeys(record, ['worldRef', 'displayLabel', 'state', 'pendingGeneration', 'minecraftVersion', 'stackGeneration', 'modsInventoryDigest', 'dataVersion', 'createdAt', 'updatedAt', 'files', 'bytes', 'treeDigest'])
      || !WORLD_REF.test(record.worldRef ?? '') || !STATES.has(record.state) || typeof record.pendingGeneration !== 'boolean'
      || typeof record.minecraftVersion !== 'string' || record.minecraftVersion.length < 1 || record.minecraftVersion.length > 96
      || !HEX64.test(record.stackGeneration ?? '') || !HEX64.test(record.modsInventoryDigest ?? '')
      || (record.dataVersion !== null && (!Number.isSafeInteger(record.dataVersion) || record.dataVersion < 1))
      || !Number.isSafeInteger(record.files) || record.files < 0 || record.files > MAX_FILES
      || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > MAX_WORLD_BYTES || !HEX64.test(record.treeDigest ?? '')
      || !iso(record.createdAt) || !iso(record.updatedAt) || Date.parse(record.updatedAt) < Date.parse(record.createdAt)) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world catalog contains an invalid record.');
    }
    normalizeLabel(record.displayLabel);
    if (record.pendingGeneration !== (record.dataVersion === null)) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world catalog has inconsistent generation state.');
    if (refs.has(record.worldRef) || labels.has(labelKey(record.displayLabel))) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world catalog contains duplicate records.');
    refs.add(record.worldRef); labels.add(labelKey(record.displayLabel));
    totalBytes += record.bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world catalog exceeds its aggregate storage limit.');
    }
    if (record.state === 'active') { active += 1; if (record.worldRef !== value.activeWorldRef) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world catalog active reference is inconsistent.'); }
  }
  if (active !== 1) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world catalog must contain exactly one active world.');
  return value;
}

function validateOperation(value) {
  if (!exactKeys(value, ['schemaVersion', 'instanceId', 'requestId', 'planId', 'planDigest', 'operation', 'state', 'transactionRef', 'failureCode', 'result', 'startedAt', 'updatedAt'])
    || value.schemaVersion !== 1 || value.instanceId !== FAMILY_ID || !UUID.test(value.requestId ?? '') || !PLAN_ID.test(value.planId ?? '')
    || !HEX64.test(value.planDigest ?? '') || !OPERATIONS.has(value.operation) || !TERMINAL_STATES.has(value.state)
    || !TX_REF.test(value.transactionRef ?? '') || !iso(value.startedAt) || !iso(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.startedAt)) {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world operation is invalid.');
  }
  if (value.state === 'committed') {
    if (value.failureCode !== null || !value.result || typeof value.result !== 'object' || Array.isArray(value.result)) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private committed world operation is inconsistent.');
    }
    if (value.operation === 'switch') {
      if (!exactKeys(value.result, ['activeWorldRef', 'previousWorldRef', 'rescueVerified', 'pendingGeneration', 'generation', 'inventoryDigest'])
        || !WORLD_REF.test(value.result.activeWorldRef ?? '') || !WORLD_REF.test(value.result.previousWorldRef ?? '')
        || value.result.activeWorldRef === value.result.previousWorldRef || value.result.rescueVerified !== true
        || typeof value.result.pendingGeneration !== 'boolean' || !HEX64.test(value.result.generation ?? '') || !HEX64.test(value.result.inventoryDigest ?? '')) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private switch result is invalid.');
      }
    } else if (!exactKeys(value.result, ['worldRef', 'displayLabel', 'state', 'pendingGeneration', 'generation', 'inventoryDigest'])
      || !WORLD_REF.test(value.result.worldRef ?? '') || !STATES.has(value.result.state)
      || typeof value.result.pendingGeneration !== 'boolean' || !HEX64.test(value.result.generation ?? '') || !HEX64.test(value.result.inventoryDigest ?? '')) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world result is invalid.');
    } else normalizeLabel(value.result.displayLabel);
  } else if (value.state === 'rolled-back') {
    if (value.failureCode !== null || value.result !== null) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private rolled-back world operation is inconsistent.');
  } else if (typeof value.failureCode !== 'string' || value.result !== null) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world operation result is inconsistent.');
  return value;
}

function validateMarker(value, instanceId) {
  if (!exactKeys(value, [
    'schemaVersion', 'instanceId', 'transactionRef', 'requestId', 'planId', 'planDigest', 'operation', 'phase',
    'sourceWorldRef', 'targetWorldRef', 'rescueBackupId', 'beforeCatalog', 'afterCatalog',
    'expectedTargetDigest', 'expectedTargetBytes', 'createdAt', 'updatedAt', 'failureCode',
  ]) || value.schemaVersion !== 1 || value.instanceId !== instanceId || !TX_REF.test(value.transactionRef ?? '')
    || !UUID.test(value.requestId ?? '') || !PLAN_ID.test(value.planId ?? '') || !HEX64.test(value.planDigest ?? '')
    || !OPERATIONS.has(value.operation) || !TRANSACTION_PHASES.has(value.phase)
    || (value.sourceWorldRef !== null && !WORLD_REF.test(value.sourceWorldRef ?? '')) || !WORLD_REF.test(value.targetWorldRef ?? '')
    || (value.rescueBackupId !== null && !BACKUP_ID.test(value.rescueBackupId ?? ''))
    || (value.expectedTargetDigest !== null && !HEX64.test(value.expectedTargetDigest ?? ''))
    || (value.expectedTargetBytes !== null && (!Number.isSafeInteger(value.expectedTargetBytes) || value.expectedTargetBytes < 0 || value.expectedTargetBytes > MAX_WORLD_BYTES))
    || !iso(value.createdAt) || !iso(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
    || (value.failureCode !== null && typeof value.failureCode !== 'string')) {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world transaction is invalid.');
  }
  validateCatalog(value.beforeCatalog, instanceId);
  if (value.afterCatalog !== null) validateCatalog(value.afterCatalog, instanceId);
  if (value.operation === 'switch') {
    if (!value.sourceWorldRef || value.sourceWorldRef !== value.beforeCatalog.activeWorldRef || value.targetWorldRef === value.sourceWorldRef
      || (!['admitted', 'rejected-before-mutation'].includes(value.phase) && !value.rescueBackupId)
      || (value.phase === 'admitted' && value.rescueBackupId !== null)) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private switch transaction is inconsistent.');
    }
  } else if (value.rescueBackupId !== null) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world transaction contains unexpected rescue state.');
  if (value.phase === 'rejected-before-mutation' && typeof value.failureCode !== 'string') {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The rejected world transaction omitted its failure reason.');
  }
  if (['intent-catalog', 'catalog-committed', 'committed'].includes(value.phase) && !value.afterCatalog) {
    throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world transaction omitted its target catalog.');
  }
  return value;
}

export class FamilyWorldManager {
  #queue = Promise.resolve();
  #recovery = new Map();
  #rescueAdmissions = new Map();

  constructor(managedRoot, store, options = {}) {
    if (typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)) throw new TypeError('managedRoot must be an absolute path');
    if (!store || typeof store.get !== 'function' || typeof store.list !== 'function') throw new TypeError('A compatible instance store is required');
    for (const name of [
      'withInstanceLock', 'assertQuiescentWithinInstanceLock', 'createRescueWithinInstanceLock',
      'assertCompanionInactiveWithinInstanceLock', 'currentStackBindingWithinInstanceLock',
      'assertLifecycleMutationAllowedWithinInstanceLock',
    ]) {
      if (typeof options[name] !== 'function') throw new TypeError(`${name} is required`);
    }
    this.managedRoot = path.resolve(managedRoot);
    this.serverRoot = path.join(this.managedRoot, 'servers');
    this.stateRoot = path.join(this.managedRoot, 'state', 'family-worlds');
    this.keyFile = path.join(this.stateRoot, 'hmac.key');
    this.store = store;
    this.withInstanceLock = options.withInstanceLock;
    this.assertQuiescentWithinInstanceLock = options.assertQuiescentWithinInstanceLock;
    this.createRescueWithinInstanceLock = options.createRescueWithinInstanceLock;
    this.assertCompanionInactiveWithinInstanceLock = options.assertCompanionInactiveWithinInstanceLock;
    this.verifyInstall = options.verifyInstall ?? (async () => {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The verified Family Server install boundary is unavailable.');
    });
    if (typeof this.verifyInstall !== 'function') throw new TypeError('verifyInstall must be a function');
    this.currentStackBindingWithinInstanceLock = options.currentStackBindingWithinInstanceLock;
    this.assertLifecycleMutationAllowedWithinInstanceLock = options.assertLifecycleMutationAllowedWithinInstanceLock;
    this.filesystemTreeVerifier = options.filesystemTreeVerifier ?? assertWindowsFilesystemTree;
    if (typeof this.filesystemTreeVerifier !== 'function') throw new TypeError('filesystemTreeVerifier must be a function');
    this.directoryGuard = options.directoryGuard
      ?? ((directory) => acquireWindowsDirectoryGuard(directory, { borrowHeld: true }));
    if (typeof this.directoryGuard !== 'function') throw new TypeError('directoryGuard must be a function');
    this.fileGuard = options.fileGuard ?? acquireWindowsFileGuard;
    if (typeof this.fileGuard !== 'function') throw new TypeError('fileGuard must be a function');
    this.filesystemEntryVerifier = options.filesystemEntryVerifier ?? assertWindowsFilesystemEntry;
    if (typeof this.filesystemEntryVerifier !== 'function') throw new TypeError('filesystemEntryVerifier must be a function');
    this.now = options.now ?? (() => new Date().toISOString());
    this.randomBytes = options.randomBytes ?? crypto.randomBytes;
    this.planTtlMs = options.planTtlMs ?? PLAN_TTL_MS;
    this.onPhase = options.onPhase ?? (() => undefined);
    this.key = null;
  }

  async initialize() {
    let stage = 'restore-validation';
    try {
      await this.prepareRestoreValidation();
      stage = 'store-read';
      const instance = await this.store.get(FAMILY_ID);
      if (!instance) return [];
      stage = 'lifecycle-lock';
      return await this.withInstanceLock(FAMILY_ID, () => this.#serialized(async () => {
        stage = 'store-recheck';
        const latest = await this.store.get(FAMILY_ID);
        if (latest?.provisioningStatus !== 'ready') return [{ instanceId: FAMILY_ID, action: 'deferred-migration' }];
        stage = 'instance-validation';
        const current = await this.#instance(FAMILY_ID);
        if (trustedWorldDataVersion(current, { allowMissing: true }) === null) {
          return [{ instanceId: FAMILY_ID, action: 'deferred-version-metadata-migration' }];
        }
        stage = 'version-verification';
        await this.#verifiedWorldDataVersion(current);
        if (current.status !== 'stopped' || current.pid !== null || current.managedProcess != null) {
          stage = 'running-recovery';
          const recovery = await this.#detectRecoveryReadOnly(current);
          if (recovery) return [recovery];
          return [{ instanceId: FAMILY_ID, action: 'deferred-running' }];
        }
        stage = 'quiescence';
        await this.assertQuiescentWithinInstanceLock(FAMILY_ID);
        stage = 'root-initialization';
        await this.#ensureInstanceRoots(current);
        stage = 'catalog-initialization';
        await this.#ensureCatalog(current);
        stage = 'journal-recovery';
        return this.#recover(current);
      }));
    } catch (error) {
      this.#recovery.set(FAMILY_ID, { state: 'manual-recovery-required', transactionRef: `worldtx-${'0'.repeat(64)}` });
      throw worldInitializationStageError(error, stage);
    }
  }

  async prepareRestoreValidation() {
    await this.#ensureGlobalRoot();
    if (!this.key) this.key = await this.#loadKey();
    else await this.#revalidateKey();
    return true;
  }

  async preflightRecoveryEvidence() {
    if (!this.key) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery preflight requires initialized authentication state.');
    }
    return this.#serialized(() => this.#preflightRecoveryEvidenceWithinSerialization());
  }

  async validateRestoredStateWithinInstanceLock(instanceId, expectedBinding, options = {}) {
    normalizeInstance(instanceId);
    if (!exactKeys(expectedBinding, ['generation', 'inventoryDigest'])
      || !HEX64.test(expectedBinding.generation ?? '') || !HEX64.test(expectedBinding.inventoryDigest ?? '')) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The approved restored-world stack binding is invalid.');
    }
    if (!exactKeys(options, [], ['directory']) || (options.directory !== undefined && typeof options.directory !== 'string')) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The trusted restored-world validation target is invalid.');
    }
    if (!this.key) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World restore validation was not initialized.');
    await this.#revalidateKey();
    const stored = await this.store.get(instanceId);
    if (!stored) throw worldError('WORLD_INSTANCE_NOT_FOUND', 404, 'The Family Server instance was not found.');
    const canonicalRoot = path.resolve(this.serverRoot, instanceId);
    if (stored.projectId !== FAMILY_ID || stored.kind !== 'server' || path.resolve(stored.directory ?? '') !== canonicalRoot) {
      throw worldError('WORLD_INVALID_INSTANCE', 409, 'The managed instance is not the isolated Family Server.');
    }
    const directory = path.resolve(options.directory ?? canonicalRoot);
    const candidateName = path.basename(directory);
    if (directory !== canonicalRoot && (path.dirname(directory) !== path.resolve(this.serverRoot)
      || !/^\.family-server\.rtx-[a-f0-9]{32}\.candidate$/.test(candidateName))) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored-world validation target escaped its trusted transaction boundary.');
    }
    await assertDirectory(this.managedRoot, this.managedRoot, 'Managed root');
    await assertDirectory(this.serverRoot, this.managedRoot, 'Server root');
    await assertDirectory(directory, this.serverRoot, 'Restored Family Server root');
    const instance = { ...stored, directory };
    await assertCanonicalLevelName(directory);
    await this.#verifiedWorldDataVersion(instance);
    await this.#assertInstanceRoots(instance);
    const currentBinding = await this.#currentStack(stored);
    if (currentBinding.generation !== expectedBinding.generation
      || currentBinding.inventoryDigest !== expectedBinding.inventoryDigest) {
      throw worldError('WORLD_VERSION_INCOMPATIBLE', 409, 'The restored server does not match the approved managed mod stack.');
    }
    const catalog = await this.#readCatalog(instance);
    const incompatible = catalog.worlds.find((world) => world.state !== 'archived'
      && (world.minecraftVersion !== stored.minecraftVersion
        || world.stackGeneration !== expectedBinding.generation
        || world.modsInventoryDigest !== expectedBinding.inventoryDigest));
    if (incompatible) {
      throw worldError('WORLD_VERSION_INCOMPATIBLE', 409, 'A restored active or inactive world belongs to a different server or mod stack.');
    }
    await this.#validateRestoredJournal(instance);
    await this.#assertLayoutMatchesCatalog(instance, catalog);
    return { generation: expectedBinding.generation, inventoryDigest: expectedBinding.inventoryDigest };
  }

  async inventory(instanceId = FAMILY_ID) {
    normalizeInstance(instanceId);
    return this.withInstanceLock(instanceId, () => this.#serialized(async () => {
      const instance = await this.#instance(instanceId);
      await this.#verifiedWorldDataVersion(instance);
      await this.#ensureInstanceRoots(instance);
      let catalog = await this.#ensureCatalog(instance);
      let activeUnverified = true;
      if (instance.status === 'stopped' && instance.pid === null && instance.managedProcess == null) {
        await this.assertQuiescentWithinInstanceLock(instance.id);
        await this.#recover(instance);
        catalog = await this.#refreshCatalog(instance, catalog);
        activeUnverified = false;
      }
      return this.#publicInventory(instance, catalog, activeUnverified);
    }));
  }

  async createPlan(instanceId, input) {
    normalizeInstance(instanceId); const request = validatePlanRequest(input);
    return this.withInstanceLock(instanceId, () => this.#serialized(() => this.#createPlanWithinLock(instanceId, request)));
  }

  async execute(instanceId, input) {
    normalizeInstance(instanceId); const request = validateActionRequest(input);
    const replay = await this.operation(instanceId, request.requestId, { allowMissing: true });
    if (replay) {
      if (replay.planId !== request.planId || replay.planDigest !== request.planDigest || CONFIRMATIONS[replay.operation] !== request.confirmation) {
        throw worldError('WORLD_REQUEST_ID_CONFLICT', 409, 'requestId was already used for a different world operation.');
      }
      return replay;
    }
    return this.withInstanceLock(instanceId, () => this.#serialized(() => this.#executeWithinLock(instanceId, request)));
  }

  async operation(instanceId, requestId, options = {}) {
    normalizeInstance(instanceId); normalizeUuid(requestId);
    const instance = await this.#instance(instanceId);
    const file = path.join(this.#operationsRoot(instance), `${requestId}.json`);
    let value;
    try { value = await this.#readAuthenticatedState(file); } catch (error) {
      if (error?.code === 'ENOENT' || error?.cause?.code === 'ENOENT') {
        if (options.allowMissing) return null;
        throw worldError('WORLD_OPERATION_NOT_FOUND', 404, 'The world operation was not found.');
      }
      if (error?.code === 'WORLD_STATE_UNAVAILABLE' && !await lstatOrNull(file)) {
        if (options.allowMissing) return null;
        throw worldError('WORLD_OPERATION_NOT_FOUND', 404, 'The world operation was not found.');
      }
      throw error;
    }
    validateOperation(value);
    return publicOperation(value);
  }

  async assertSafeForLifecycle({ instanceId }) {
    normalizeInstance(instanceId);
    return this.#serialized(async () => {
      const evidence = await this.#preflightRecoveryEvidenceWithinSerialization();
      if (evidence.instances.some((item) => item.instanceId === instanceId)) {
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'A world transaction requires recovery before lifecycle changes can continue.');
      }
      this.#assertKnownRecoverySafe(instanceId);
      return true;
    });
  }

  #assertKnownRecoverySafe(instanceId) {
    if (this.#recovery.has(instanceId)) throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'A world transaction requires recovery before lifecycle changes can continue.');
  }

  async assertMutationAllowedWithinInstanceLock(instanceId = FAMILY_ID) {
    normalizeInstance(instanceId);
    await this.#revalidateKey();
    const instance = await this.#instance(instanceId);
    const stopped = instance.status === 'stopped' && instance.pid === null && instance.managedProcess == null;
    await this.#verifiedWorldDataVersion(instance);
    if (stopped) {
      const checked = await this.assertQuiescentWithinInstanceLock(instanceId);
      if (!checked || checked.id !== instance.id || checked.status !== 'stopped' || checked.pid !== null || checked.managedProcess != null) {
        throw worldError('WORLD_SERVER_NOT_QUIESCENT', 409, 'The Family Server must be fully stopped before changing managed world state.');
      }
    }
    await this.#ensureInstanceRoots(instance);
    await this.#ensureCatalog(instance);
    const rescueAdmission = this.#rescueAdmissions.get(instanceId);
    if (rescueAdmission) {
      if (!stopped) {
        throw worldError('WORLD_SERVER_NOT_QUIESCENT', 409, 'A rescue snapshot requires the Family Server to remain fully stopped.');
      }
      await this.#assertOwnedRescueAdmission(instance, rescueAdmission);
      this.#assertKnownRecoverySafe(instanceId);
      return true;
    }
    if (!stopped) {
      this.#assertKnownRecoverySafe(instanceId);
      await this.#readCatalog(instance);
      return true;
    }
    await this.#recover(instance);
    this.#assertKnownRecoverySafe(instanceId);
    await this.#refreshCatalog(instance, await this.#readCatalog(instance));
    return true;
  }

  async assertModMutationAllowedWithinInstanceLock(instanceId = FAMILY_ID) {
    normalizeInstance(instanceId);
    await this.#revalidateKey();
    const instance = await this.#instance(instanceId);
    if (instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess != null) {
      throw worldError('WORLD_SERVER_NOT_QUIESCENT', 409, 'The Family Server must be fully stopped before changing its world-bound mod stack.');
    }
    const checked = await this.assertQuiescentWithinInstanceLock(instanceId);
    if (!checked || checked.id !== instance.id || checked.status !== 'stopped' || checked.pid !== null || checked.managedProcess != null) {
      throw worldError('WORLD_SERVER_NOT_QUIESCENT', 409, 'The Family Server must be fully stopped before changing its world-bound mod stack.');
    }
    await this.#verifiedWorldDataVersion(instance);
    await this.#ensureInstanceRoots(instance);
    await this.#recover(instance);
    this.#assertKnownRecoverySafe(instanceId);
    const catalog = await this.#refreshCatalog(instance, await this.#ensureCatalog(instance));
    if (catalog.worlds.some((world) => world.state !== 'active')) {
      throw worldError('WORLDS_BLOCK_MOD_MUTATION', 409, 'This version requires one active world and no stored worlds before changing the managed mod stack.');
    }
    return true;
  }

  async assertStackUpdateAllowedWithinInstanceLock(instanceId = FAMILY_ID, target = null) {
    normalizeInstance(instanceId);
    await this.#revalidateKey();
    const instance = await this.#instance(instanceId);
    if (instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess != null) {
      throw worldError('WORLD_SERVER_NOT_QUIESCENT', 409, 'The Family Server must be fully stopped before changing its world-bound server stack.');
    }
    const checked = await this.assertQuiescentWithinInstanceLock(instanceId);
    if (!checked || checked.id !== instance.id || checked.status !== 'stopped' || checked.pid !== null || checked.managedProcess != null) {
      throw worldError('WORLD_SERVER_NOT_QUIESCENT', 409, 'The Family Server must be fully stopped before changing its world-bound server stack.');
    }
    if (trustedWorldDataVersion(instance, { allowMissing: true }) === null) {
      return this.#assertCompatibilityMigrationAllowed(instance, target);
    }
    await this.#verifiedWorldDataVersion(instance);
    await this.#ensureInstanceRoots(instance);
    await this.#recover(instance);
    this.#assertKnownRecoverySafe(instanceId);
    const catalog = await this.#ensureCatalog(instance);
    const targetDataVersion = target?.worldDataVersion ?? target?.minecraftServerArtifact?.worldDataVersion ?? null;
    if (targetDataVersion !== null) {
      if (!Number.isSafeInteger(targetDataVersion) || targetDataVersion < 1 || targetDataVersion > 0x7fffffff
        || (target?.worldDataVersion !== undefined && target?.minecraftServerArtifact?.worldDataVersion !== undefined
          && target.worldDataVersion !== target.minecraftServerArtifact.worldDataVersion)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The candidate server world compatibility ceiling is invalid.');
      }
      if (catalog.worlds.some((world) => world.state !== 'archived'
        && world.dataVersion !== null && world.dataVersion > targetDataVersion)) {
        throw worldError('WORLD_VERSION_INCOMPATIBLE', 409, 'A current managed world was created by a newer data version than the candidate server supports.');
      }
    }
    const targetVersion = target?.minecraftVersion ?? target?.targetMinecraftVersion ?? null;
    const minecraftChanging = typeof targetVersion === 'string' && targetVersion !== instance.minecraftVersion;
    if (minecraftChanging) {
      if (catalog.worlds.some((world) => world.state === 'inactive')) {
        throw worldError('WORLDS_BLOCK_MINECRAFT_UPDATE', 409, 'Archive every inactive world before changing the Minecraft version.');
      }
      return true;
    }
    if (catalog.worlds.some((world) => world.state !== 'active') && target && typeof target === 'object'
      && (target.loaderVersion !== undefined || target.fabricVersion !== undefined || target.component !== undefined || target.components !== undefined)) {
      throw worldError('WORLDS_BLOCK_STACK_UPDATE', 409, 'This version requires one active world and no stored worlds before changing Fabric or managed components.');
    }
    return true;
  }

  async reconcileGeneratedWorldWithinInstanceLock(instanceId = FAMILY_ID) {
    normalizeInstance(instanceId);
    await this.#revalidateKey();
    const instance = await this.#instance(instanceId);
    if (instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess != null) {
      throw worldError('WORLD_SERVER_NOT_QUIESCENT', 409, 'Generated world reconciliation requires a fully stopped Family Server.');
    }
    await this.#verifiedWorldDataVersion(instance);
    await this.assertQuiescentWithinInstanceLock(instance.id);
    await this.assertCompanionInactiveWithinInstanceLock(instance.id);
    await this.#recover(instance);
    this.#assertKnownRecoverySafe(instanceId);
    const catalog = await this.#readCatalog(instance);
    const active = catalog.worlds.find((world) => world.worldRef === catalog.activeWorldRef);
    if (!active?.pendingGeneration) return false;
    const scanned = await scanWorld(this.#activeRoot(instance), instance.directory, {
      allowPending: false, maximumDataVersion: this.#worldDataVersion(instance),
      filesystemTreeVerifier: this.filesystemTreeVerifier, directoryGuard: this.directoryGuard,
    });
    const next = clone(catalog); const record = next.worlds.find((world) => world.worldRef === next.activeWorldRef);
    Object.assign(record, {
      pendingGeneration: false, dataVersion: scanned.dataVersion, files: scanned.files,
      bytes: scanned.bytes, treeDigest: scanned.digest, updatedAt: nowIso(this.now),
    });
    next.revision += 1; next.updatedAt = nowIso(this.now);
    await this.#writeCatalog(instance, next);
    return true;
  }

  async #createPlanWithinLock(instanceId, request) {
    await this.#assertExternalLifecycleMutationAllowed(instanceId);
    this.#assertKnownRecoverySafe(instanceId);
    const instance = await this.#quiescent(instanceId);
    await this.#recover(instance);
    this.#assertKnownRecoverySafe(instanceId);
    let catalog = await this.#refreshCatalog(instance, await this.#readCatalog(instance));
    const requestFile = path.join(this.#plansRoot(instance), `${request.requestId}.json`);
    const requestDigest = sha256(canonical(request));
    const existing = await lstatOrNull(requestFile);
    if (existing) {
      const replay = await this.#readAuthenticatedState(requestFile);
      if (replay.requestDigest !== requestDigest) throw worldError('WORLD_REQUEST_ID_CONFLICT', 409, 'requestId was already used for a different world plan.');
      this.#validatePlan(replay, instance.id);
      return replay.public;
    }
    if (await this.operation(instance.id, request.requestId, { allowMissing: true })) throw worldError('WORLD_REQUEST_ID_CONFLICT', 409, 'requestId was already used by a world operation.');
    const planEntries = await readBoundedDirectoryEntries(
      this.#plansRoot(instance), MAX_JOURNAL_RECORDS,
      () => worldError('WORLD_QUOTA_EXCEEDED', 507, 'The bounded world-operation journal is full.'),
    );
    if (planEntries.some((entry) => !entry.isFile() || !entry.name.endsWith('.json') || !UUID.test(entry.name.slice(0, -5)))) {
      throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Unexpected private world plan state requires manual recovery.');
    }
    if (planEntries.length >= MAX_JOURNAL_RECORDS) {
      throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'The bounded world-operation journal is full.');
    }
    const inventory = await this.#publicInventory(instance, catalog, false);
    const currentStack = await this.#currentStack(instance);
    const byRef = new Map(catalog.worlds.map((world) => [world.worldRef, world]));
    const active = byRef.get(catalog.activeWorldRef);
    let source = null; let target; let changes;
    if ('displayLabel' in request) {
      const conflict = catalog.worlds.find((world) => labelKey(world.displayLabel) === labelKey(request.displayLabel)
        && !(request.operation === 'rename' && world.worldRef === request.targetWorldRef));
      if (conflict) throw worldError('WORLD_INVALID_STATE', 409, 'A world already uses that display label.');
    }
    if (request.operation === 'create' || request.operation === 'clone') {
      if (catalog.worlds.length >= MAX_WORLDS) throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'The Family Server world limit has been reached.');
      const worldRef = await this.#newWorldRef(instance.id, request.requestId);
      if (byRef.has(worldRef) || await lstatOrNull(path.join(this.#storageRoot(instance), worldRef))) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Generated world storage was already occupied.');
      if (request.operation === 'clone') {
        source = byRef.get(request.targetWorldRef);
        if (!source) throw worldError('WORLD_NOT_FOUND', 404, 'The source world was not found.');
        if (source.state === 'archived' && (source.minecraftVersion !== instance.minecraftVersion
          || source.stackGeneration !== currentStack.generation || source.modsInventoryDigest !== currentStack.inventoryDigest)) {
          throw worldError('WORLD_VERSION_INCOMPATIBLE', 409, 'The archived world belongs to a different managed server stack.');
        }
      }
      target = { worldRef, displayLabel: request.displayLabel, state: 'inactive' };
      changes = [{ worldRef, displayLabel: request.displayLabel, fromState: null, toState: 'inactive' }];
    } else {
      const selected = byRef.get(request.targetWorldRef);
      if (!selected) throw worldError('WORLD_NOT_FOUND', 404, 'The selected world was not found.');
      if (request.operation === 'rename') {
        source = selected; target = { worldRef: selected.worldRef, displayLabel: request.displayLabel, state: selected.state };
        changes = [{ worldRef: selected.worldRef, displayLabel: request.displayLabel, fromState: selected.state, toState: selected.state }];
      } else if (request.operation === 'archive') {
        if (selected.state !== 'inactive') throw worldError('WORLD_INVALID_STATE', 409, 'Only an inactive world can be archived.');
        source = selected; target = { worldRef: selected.worldRef, displayLabel: selected.displayLabel, state: 'archived' };
        changes = [{ worldRef: selected.worldRef, displayLabel: selected.displayLabel, fromState: 'inactive', toState: 'archived' }];
      } else {
        if (!['inactive', 'archived'].includes(selected.state)) throw worldError('WORLD_INVALID_STATE', 409, 'Select an inactive or compatible archived world to switch.');
        if (selected.minecraftVersion !== instance.minecraftVersion || selected.stackGeneration !== currentStack.generation
          || selected.modsInventoryDigest !== currentStack.inventoryDigest) {
          throw worldError('WORLD_VERSION_INCOMPATIBLE', 409, 'The selected world belongs to a different managed server stack.');
        }
        source = active; target = { worldRef: selected.worldRef, displayLabel: selected.displayLabel, state: 'active' };
        changes = [
          { worldRef: selected.worldRef, displayLabel: selected.displayLabel, fromState: selected.state, toState: 'active' },
          { worldRef: active.worldRef, displayLabel: active.displayLabel, fromState: 'active', toState: 'inactive' },
        ];
      }
    }
    const expiresAt = new Date(Date.parse(nowIso(this.now)) + this.planTtlMs).toISOString();
    const planSeed = { instanceId: instance.id, request, sourceRef: source?.worldRef ?? null, targetRef: target.worldRef,
      generation: inventory.generation, inventoryDigest: inventory.inventoryDigest, expiresAt, nonce: this.randomBytes(16).toString('hex') };
    const { planId, planDigest } = await this.#withRevalidatedKey(async (key) => {
      const authenticatedPlanId = `worldplan-${sign(key, planSeed)}`;
      return {
        planId: authenticatedPlanId,
        planDigest: sign(key, { ...planSeed, planId: authenticatedPlanId }),
      };
    });
    const publicPlan = {
      planId, planDigest, requestId: request.requestId, operation: request.operation,
      requiredConfirmation: CONFIRMATIONS[request.operation], expiresAt,
      source: source ? { worldRef: source.worldRef, displayLabel: source.displayLabel, state: source.state } : null,
      target, changes,
      safety: { requiresStopped: true, rescueBackupRequired: request.operation === 'switch', destructive: false },
      inventoryBinding: { generation: inventory.generation, digest: inventory.inventoryDigest },
    };
    const privatePlan = { schemaVersion: 1, instanceId: instance.id, requestDigest, request, public: publicPlan, createdAt: nowIso(this.now) };
    await this.#writeSignedState(instance, requestFile, privatePlan);
    return publicPlan;
  }

  async #executeWithinLock(instanceId, request) {
    await this.#assertExternalLifecycleMutationAllowed(instanceId);
    this.#assertKnownRecoverySafe(instanceId);
    const instance = await this.#quiescent(instanceId);
    await this.#recover(instance);
    this.#assertKnownRecoverySafe(instanceId);
    const replay = await this.operation(instance.id, request.requestId, { allowMissing: true });
    if (replay) {
      if (replay.planId !== request.planId || replay.planDigest !== request.planDigest || CONFIRMATIONS[replay.operation] !== request.confirmation) {
        throw worldError('WORLD_REQUEST_ID_CONFLICT', 409, 'requestId was already used for a different world operation.');
      }
      return replay;
    }
    const planFile = path.join(this.#plansRoot(instance), `${request.requestId}.json`);
    if (!await lstatOrNull(planFile)) throw worldError('WORLD_PLAN_NOT_FOUND', 404, 'The world plan was not found.');
    const plan = await this.#readAuthenticatedState(planFile); this.#validatePlan(plan, instance.id);
    if (plan.public.planId !== request.planId || plan.public.planDigest !== request.planDigest) throw worldError('WORLD_PLAN_STALE', 409, 'The world plan no longer matches this action.');
    if (request.confirmation !== CONFIRMATIONS[plan.request.operation]) throw worldError('WORLD_APPROVAL_INVALID', 409, 'The exact world confirmation phrase is required.');
    if (Date.parse(plan.public.expiresAt) <= Date.parse(nowIso(this.now))) return this.#rejectBeforeMutation(instance, plan, 'WORLD_PLAN_STALE');
    let catalog = await this.#refreshCatalog(instance, await this.#readCatalog(instance));
    const inventory = await this.#publicInventory(instance, catalog, false);
    if (inventory.generation !== plan.public.inventoryBinding.generation || inventory.inventoryDigest !== plan.public.inventoryBinding.digest) {
      return this.#rejectBeforeMutation(instance, plan, 'WORLD_PLAN_STALE');
    }
    try { await this.assertCompanionInactiveWithinInstanceLock(instance.id); }
    catch { return this.#rejectBeforeMutation(instance, plan, 'WORLD_PLAN_STALE'); }
    const operation = plan.request.operation;
    const transactionRef = await this.#withRevalidatedKey(async (key) => `worldtx-${sign(key, {
      requestId: request.requestId, planId: request.planId, planDigest: request.planDigest, admission: 'world-action-v1',
    })}`);
    const startedAt = nowIso(this.now);
    const selectedRecord = catalog.worlds.find((world) => world.worldRef === plan.public.target.worldRef) ?? null;
    const marker = {
      schemaVersion: 1, instanceId: instance.id, transactionRef, requestId: request.requestId,
      planId: request.planId, planDigest: request.planDigest, operation,
      phase: operation === 'switch' ? 'admitted' : 'intent',
      sourceWorldRef: operation === 'switch' ? catalog.activeWorldRef : (plan.public.source?.worldRef ?? null),
      targetWorldRef: plan.public.target.worldRef,
      rescueBackupId: null, beforeCatalog: catalog, afterCatalog: null,
      expectedTargetDigest: selectedRecord?.treeDigest ?? null, expectedTargetBytes: selectedRecord?.bytes ?? null,
      createdAt: startedAt, updatedAt: startedAt, failureCode: null,
    };
    try { await this.#writeMarker(instance, marker); }
    catch {
      try { return await this.#rejectAdmitted(instance, marker, 'WORLD_STATE_UNAVAILABLE'); }
      catch {
        this.#recovery.set(instance.id, { state: 'completion-unknown', transactionRef });
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The admitted world action requires reconciliation before retry.');
      }
    }
    let rescue = null;
    if (operation === 'switch') {
      this.#rescueAdmissions.set(instance.id, transactionRef);
      try { rescue = await this.createRescueWithinInstanceLock(instance.id); }
      catch { return this.#rejectAdmitted(instance, marker, 'WORLD_SNAPSHOT_FAILED'); }
      finally {
        if (this.#rescueAdmissions.get(instance.id) === transactionRef) this.#rescueAdmissions.delete(instance.id);
      }
      if (!rescue || !BACKUP_ID.test(rescue.backupId ?? '') || rescue.integrity !== 'verified') {
        return this.#rejectAdmitted(instance, marker, 'WORLD_SNAPSHOT_FAILED');
      }
      await this.#phase(instance, marker, 'snapshot-verified', { rescueBackupId: rescue.backupId });
      try {
        await this.#quiescent(instance.id);
        catalog = await this.#refreshCatalog(instance, await this.#readCatalog(instance));
      } catch {
        return this.#rejectAdmitted(instance, marker, 'WORLD_PLAN_STALE', { requireOriginalLayout: false });
      }
      const afterRescue = await this.#publicInventory(instance, catalog, false);
      if (afterRescue.generation !== inventory.generation || afterRescue.inventoryDigest !== inventory.inventoryDigest) {
        return this.#rejectAdmitted(instance, marker, 'WORLD_PLAN_STALE', { requireOriginalLayout: false });
      }
      marker.beforeCatalog = catalog;
      await this.#phase(instance, marker, 'intent');
    }
    let committed = null;
    try {
      const result = operation === 'switch'
        ? await this.#executeSwitch(instance, plan, marker)
        : await this.#executeSimple(instance, plan, marker);
      committed = {
        schemaVersion: 1, instanceId: instance.id, requestId: request.requestId, planId: request.planId,
        planDigest: request.planDigest, operation, state: 'committed', transactionRef,
        failureCode: null, result, startedAt, updatedAt: nowIso(this.now),
      };
      await this.#phase(instance, marker, 'committed');
      await this.#writeOperation(instance, committed);
      this.#recovery.delete(instance.id);
      return publicOperation(committed);
    } catch (operationError) {
      if (operationError?.worldNamespaceDiscontinuity === true) {
        this.#recovery.set(instance.id, { state: 'manual-recovery-required', transactionRef });
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The world namespace changed during a guarded transaction and requires manual recovery.');
      }
      if (await this.#persistedMarkerHasPhase(instance, marker, 'committed')) {
        this.#recovery.set(instance.id, { state: 'completion-unknown', transactionRef });
        if (committed) {
          try {
            await this.#writeOperation(instance, committed);
            this.#recovery.delete(instance.id);
            return publicOperation(committed);
          } catch { /* The committed marker remains the monotonic recovery authority. */ }
        }
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The committed world transaction requires reconciliation before further changes.');
      }
      try {
        await this.#rollback(instance, marker);
        const rolledBack = {
          schemaVersion: 1, instanceId: instance.id, requestId: request.requestId, planId: request.planId,
          planDigest: request.planDigest, operation, state: 'rolled-back', transactionRef,
          failureCode: null, result: null, startedAt, updatedAt: nowIso(this.now),
        };
        await this.#phase(instance, marker, 'rolled-back', { failureCode: 'WORLD_OPERATION_FAILED' });
        await this.#writeOperation(instance, rolledBack);
        this.#recovery.delete(instance.id);
        return publicOperation(rolledBack);
      } catch {
        if (await this.#persistedMarkerHasPhase(instance, marker, 'rolled-back')) {
          const rolledBack = await this.#operationForMarker(instance, marker, 'rolled-back');
          this.#recovery.set(instance.id, { state: 'completion-unknown', transactionRef });
          try {
            await this.#writeOperation(instance, rolledBack);
            this.#recovery.delete(instance.id);
            return publicOperation(rolledBack);
          } catch { /* The rolled-back marker remains the monotonic recovery authority. */ }
        }
        this.#recovery.set(instance.id, { state: 'manual-recovery-required', transactionRef });
        const manual = {
          schemaVersion: 1, instanceId: instance.id, requestId: request.requestId, planId: request.planId,
          planDigest: request.planDigest, operation, state: 'manual-recovery-required', transactionRef,
          failureCode: 'WORLD_OPERATION_FAILED', result: null, startedAt, updatedAt: nowIso(this.now),
        };
        await this.#writeOperation(instance, manual).catch(() => undefined);
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The world transaction requires manual recovery before further changes.');
      }
    }
  }

  async #executeSimple(instance, plan, marker) {
    const request = plan.request; const catalog = clone(marker.beforeCatalog); const timestamp = nowIso(this.now);
    let record; let candidate = null;
    if (request.operation === 'create' || request.operation === 'clone') {
      const worldRef = plan.public.target.worldRef;
      candidate = path.join(this.#storageRoot(instance), `.staging-${marker.transactionRef}`);
      if (request.operation === 'create') {
        await assertFreeSpace(this.#storageRoot(instance), 0);
        const creationChain = await acquireAnchoredGuardChain(this.managedRoot, this.#storageRoot(instance), 'World storage root', this.directoryGuard);
        try {
          await createGuardedChildDirectory(
            this.#storageRoot(instance), path.basename(candidate), creationChain, this.directoryGuard, 'World transaction staging',
          );
        } finally { await releaseGuards(...creationChain.map((entry) => entry.guard)); }
      }
      else {
        const source = catalog.worlds.find((world) => world.worldRef === request.targetWorldRef);
        await assertFreeSpace(this.#storageRoot(instance), source.bytes);
        await copyWorld(
          this.#worldPath(instance, source), candidate,
          source.state === 'active' ? instance.directory : this.#privateRoot(instance),
          this.#privateRoot(instance),
          this.filesystemTreeVerifier,
          this.directoryGuard,
          this.managedRoot,
          this.fileGuard,
          this.filesystemEntryVerifier,
        );
      }
      const scanned = await scanWorld(candidate, this.#privateRoot(instance), {
        allowPending: request.operation === 'create', maximumDataVersion: this.#worldDataVersion(instance),
        filesystemTreeVerifier: this.filesystemTreeVerifier,
        directoryGuard: this.directoryGuard,
      });
      if (request.operation === 'clone' && scanned.pendingGeneration) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'The source world was not generated.');
      const currentTotal = catalog.worlds.reduce((total, world) => total + world.bytes, 0);
      if (currentTotal + scanned.bytes > MAX_TOTAL_BYTES) throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'Family Server world storage exceeded its aggregate limit.');
      marker.expectedTargetDigest = scanned.digest; marker.expectedTargetBytes = scanned.bytes;
      await this.#phase(instance, marker, 'candidate-ready');
      const destination = path.join(this.#storageRoot(instance), worldRef);
      await this.#phase(instance, marker, 'intent-publish');
      const publishChain = await acquireAnchoredGuardChain(this.managedRoot, this.#storageRoot(instance), 'World storage root', this.directoryGuard);
      try {
        await renameGuardedDirectory(candidate, destination, publishChain, this.directoryGuard, this.filesystemEntryVerifier);
        await this.#phase(instance, marker, 'target-published', {}, publishChain);
      } finally { await releaseGuards(...publishChain.map((entry) => entry.guard)); }
      const currentStack = await this.#currentStack(instance);
      record = { worldRef, displayLabel: request.displayLabel, state: 'inactive', pendingGeneration: scanned.pendingGeneration,
        minecraftVersion: instance.minecraftVersion, dataVersion: scanned.dataVersion, createdAt: timestamp, updatedAt: timestamp,
        stackGeneration: currentStack.generation, modsInventoryDigest: currentStack.inventoryDigest,
        files: scanned.files, bytes: scanned.bytes, treeDigest: scanned.digest };
      catalog.worlds.push(record);
      marker.afterCatalog = catalog;
    } else {
      record = catalog.worlds.find((world) => world.worldRef === request.targetWorldRef);
      if (!record) throw worldError('WORLD_NOT_FOUND', 404, 'The selected world was not found.');
      if (request.operation === 'rename') { record.displayLabel = request.displayLabel; record.updatedAt = timestamp; }
      else { if (record.state !== 'inactive') throw worldError('WORLD_INVALID_STATE', 409, 'Only an inactive world can be archived.'); record.state = 'archived'; record.updatedAt = timestamp; }
    }
    catalog.revision += 1; catalog.updatedAt = timestamp; marker.afterCatalog = catalog;
    await this.#phase(instance, marker, 'intent-catalog'); await this.#writeCatalog(instance, catalog); await this.#phase(instance, marker, 'catalog-committed');
    const inventory = await this.#publicInventory(instance, catalog, false);
    return { worldRef: record.worldRef, displayLabel: record.displayLabel, state: record.state,
      pendingGeneration: record.pendingGeneration, generation: inventory.generation, inventoryDigest: inventory.inventoryDigest };
  }

  async #executeSwitch(instance, plan, marker) {
    const before = marker.beforeCatalog; const next = clone(before); const timestamp = nowIso(this.now);
    const previous = next.worlds.find((world) => world.worldRef === next.activeWorldRef);
    const target = next.worlds.find((world) => world.worldRef === plan.request.targetWorldRef);
    if (!previous || !target || !['inactive', 'archived'].includes(target.state)) throw worldError('WORLD_PLAN_STALE', 409, 'The selected world changed before switching.');
    const live = this.#activeRoot(instance); const targetPath = this.#worldPath(instance, target);
    const previousTemporary = path.join(this.#storageRoot(instance), `.previous-${marker.transactionRef}`);
    const previousDestination = path.join(this.#storageRoot(instance), previous.worldRef);
    await this.#phase(instance, marker, 'intent-live-to-temp');
    const switchChain = await acquireAnchoredGuardChain(this.managedRoot, this.#storageRoot(instance), 'World storage root', this.directoryGuard);
    try {
      await renameGuardedDirectory(live, previousTemporary, switchChain, this.directoryGuard, this.filesystemEntryVerifier);
      await this.#phase(instance, marker, 'live-in-temp', {}, switchChain);
      await this.#phase(instance, marker, 'intent-target-to-live', {}, switchChain);
      await renameGuardedDirectory(targetPath, live, switchChain, this.directoryGuard, this.filesystemEntryVerifier);
      await this.#phase(instance, marker, 'target-live', {}, switchChain);
      await this.#phase(instance, marker, 'intent-temp-to-storage', {}, switchChain);
      await renameGuardedDirectory(previousTemporary, previousDestination, switchChain, this.directoryGuard, this.filesystemEntryVerifier);
      await this.#phase(instance, marker, 'previous-stored', {}, switchChain);
    } finally { await releaseGuards(...switchChain.map((entry) => entry.guard)); }
    previous.state = 'inactive'; previous.updatedAt = timestamp;
    target.state = 'active'; target.updatedAt = timestamp;
    next.activeWorldRef = target.worldRef; next.revision += 1; next.updatedAt = timestamp; marker.afterCatalog = next;
    await this.#phase(instance, marker, 'intent-catalog'); await this.#writeCatalog(instance, next); await this.#phase(instance, marker, 'catalog-committed');
    const [liveScan, priorScan] = await Promise.all([
      scanWorld(live, instance.directory, {
        allowPending: target.pendingGeneration, maximumDataVersion: this.#worldDataVersion(instance),
        filesystemTreeVerifier: this.filesystemTreeVerifier,
        directoryGuard: this.directoryGuard,
      }),
      scanWorld(previousDestination, this.#privateRoot(instance), {
        allowPending: previous.pendingGeneration, maximumDataVersion: this.#worldDataVersion(instance),
        filesystemTreeVerifier: this.filesystemTreeVerifier,
        directoryGuard: this.directoryGuard,
      }),
    ]);
    if (liveScan.digest !== target.treeDigest || priorScan.digest !== previous.treeDigest) throw worldError('WORLD_SWITCH_VERIFY_FAILED', 409, 'The switched worlds did not match their verified transaction records.');
    const inventory = await this.#publicInventory(instance, next, false);
    return { activeWorldRef: target.worldRef, previousWorldRef: previous.worldRef, rescueVerified: true,
      pendingGeneration: target.pendingGeneration, generation: inventory.generation, inventoryDigest: inventory.inventoryDigest };
  }

  async #rejectBeforeMutation(instance, plan, failureCode) {
    const transactionRef = await this.#withRevalidatedKey(async (key) => `worldtx-${sign(key, {
      requestId: plan.request.requestId, planId: plan.public.planId, rejected: failureCode,
    })}`);
    const timestamp = nowIso(this.now);
    const value = { schemaVersion: 1, instanceId: instance.id, requestId: plan.request.requestId, planId: plan.public.planId,
      planDigest: plan.public.planDigest, operation: plan.request.operation, state: 'rejected-before-mutation', transactionRef,
      failureCode, result: null, startedAt: timestamp, updatedAt: timestamp };
    await this.#writeOperation(instance, value);
    return publicOperation(value);
  }

  async #rejectAdmitted(instance, marker, failureCode, options = {}) {
    try {
      if (options.requireOriginalLayout !== false) {
        await this.#assertLayoutMatchesCatalog(instance, marker.beforeCatalog, { allowGeneratedActive: true });
      }
      await this.#phase(instance, marker, 'rejected-before-mutation', { failureCode });
      const value = await this.#operationForMarker(instance, marker, 'rejected-before-mutation');
      await this.#writeOperation(instance, value);
      this.#recovery.delete(instance.id);
      return publicOperation(value);
    } catch {
      this.#recovery.set(instance.id, { state: 'completion-unknown', transactionRef: marker.transactionRef });
      throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The rejected world admission requires reconciliation before retry.');
    }
  }

  async #assertOwnedRescueAdmission(instance, transactionRef) {
    if (!TX_REF.test(transactionRef ?? '')) {
      throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The rescue admission capability is invalid.');
    }
    await this.#assertJournalBound(instance);
    const transactionFile = path.join(this.#transactionsRoot(instance), `${transactionRef}.json`);
    const marker = validateMarker(await this.#readAuthenticatedState(transactionFile), instance.id);
    if (marker.transactionRef !== transactionRef || marker.operation !== 'switch' || marker.phase !== 'admitted'
      || marker.rescueBackupId !== null || marker.failureCode !== null) {
      throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The rescue admission no longer matches its authenticated transaction.');
    }
    let unfinished = 0;
    for (const entry of await readBoundedDirectoryEntries(
      this.#transactionsRoot(instance), MAX_JOURNAL_RECORDS,
      () => worldError('WORLD_RECOVERY_REQUIRED', 409, 'Private world transaction history exceeded its safe bound.'),
    )) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Unexpected private world transaction state requires manual recovery.');
      }
      const candidate = validateMarker(await this.#readAuthenticatedState(
        path.join(this.#transactionsRoot(instance), entry.name),
      ), instance.id);
      if (entry.name !== `${candidate.transactionRef}.json`) {
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Private world transaction state is inconsistent.');
      }
      if (!TERMINAL_TRANSACTION_PHASES.has(candidate.phase)) {
        unfinished += 1;
        if (candidate.transactionRef !== transactionRef || candidate.phase !== 'admitted') {
          throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Another unfinished world transaction blocks rescue admission.');
        }
      }
    }
    if (unfinished !== 1) throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The rescue admission is not uniquely authoritative.');
    const catalog = await this.#readCatalog(instance);
    if (canonical(catalog) !== canonical(marker.beforeCatalog)) {
      throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The authenticated world catalog changed after rescue admission.');
    }
    const operation = await this.operation(instance.id, marker.requestId, { allowMissing: true });
    if (operation) throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The rescue admission already has terminal operation evidence.');
    await this.#assertLayoutMatchesCatalog(instance, marker.beforeCatalog, { allowGeneratedActive: true });
    return marker;
  }

  async #rollback(instance, marker) {
    const storage = this.#storageRoot(instance); const live = this.#activeRoot(instance);
    const previousTemporary = path.join(storage, `.previous-${marker.transactionRef}`);
    const before = marker.beforeCatalog; const previous = before.worlds.find((world) => world.worldRef === before.activeWorldRef);
    if (marker.operation === 'switch') {
      const target = before.worlds.find((world) => world.worldRef === marker.targetWorldRef);
      if (!previous || !target || previous.worldRef !== marker.sourceWorldRef) throw new Error('invalid switch identities');
      const targetStorage = path.join(storage, target.worldRef);
      const previousStorage = path.join(storage, previous.worldRef);
      const presence = async () => ({ live: Boolean(await lstatOrNull(live)), target: Boolean(await lstatOrNull(targetStorage)),
        temporary: Boolean(await lstatOrNull(previousTemporary)), previous: Boolean(await lstatOrNull(previousStorage)) });
      const rollbackChain = await acquireAnchoredGuardChain(this.managedRoot, storage, 'World storage root', this.directoryGuard);
      try {
        let slots = await presence();
        if (slots.live && slots.target && !slots.temporary && !slots.previous) {
          await this.#assertWorldMatches(instance, live, instance.directory, previous);
          await this.#assertWorldMatches(instance, targetStorage, this.#privateRoot(instance), target);
        } else if (!slots.live && slots.target && slots.temporary && !slots.previous) {
          await this.#assertWorldMatches(instance, targetStorage, this.#privateRoot(instance), target);
          await this.#assertWorldMatches(instance, previousTemporary, this.#privateRoot(instance), previous);
          await renameGuardedDirectory(previousTemporary, live, rollbackChain, this.directoryGuard, this.filesystemEntryVerifier);
        } else if (slots.live && !slots.target && slots.temporary && !slots.previous) {
          await this.#assertWorldMatches(instance, live, instance.directory, target);
          await this.#assertWorldMatches(instance, previousTemporary, this.#privateRoot(instance), previous);
          await renameGuardedDirectory(live, targetStorage, rollbackChain, this.directoryGuard, this.filesystemEntryVerifier);
          await renameGuardedDirectory(previousTemporary, live, rollbackChain, this.directoryGuard, this.filesystemEntryVerifier);
        } else if (slots.live && !slots.target && !slots.temporary && slots.previous) {
          await this.#assertWorldMatches(instance, live, instance.directory, target);
          await this.#assertWorldMatches(instance, previousStorage, this.#privateRoot(instance), previous);
          await renameGuardedDirectory(live, targetStorage, rollbackChain, this.directoryGuard, this.filesystemEntryVerifier);
          await renameGuardedDirectory(previousStorage, live, rollbackChain, this.directoryGuard, this.filesystemEntryVerifier);
        } else if (!slots.live && slots.target && !slots.temporary && slots.previous) {
          await this.#assertWorldMatches(instance, targetStorage, this.#privateRoot(instance), target);
          await this.#assertWorldMatches(instance, previousStorage, this.#privateRoot(instance), previous);
          await renameGuardedDirectory(previousStorage, live, rollbackChain, this.directoryGuard, this.filesystemEntryVerifier);
        } else throw new Error('ambiguous switch layout');
        slots = await presence();
        if (!slots.live || !slots.target || slots.temporary || slots.previous) throw new Error('switch rollback did not reach its canonical layout');
        await this.#assertWorldMatches(instance, live, instance.directory, previous);
        await this.#assertWorldMatches(instance, targetStorage, this.#privateRoot(instance), target);
        await assertGuardChainHeld(rollbackChain);
      } finally { await releaseGuards(...rollbackChain.map((entry) => entry.guard)); }
      await this.#writeCatalog(instance, before);
    } else {
      const staging = path.join(storage, `.staging-${marker.transactionRef}`);
      if (await managedWorldTreeRemovalPending(staging)) await this.#removeTree(instance, staging, 'World transaction staging');
      if (marker.operation === 'create' || marker.operation === 'clone') {
        const published = path.join(storage, marker.targetWorldRef);
        if (await managedWorldTreeRemovalPending(published)) {
          const publishedStat = await lstatOrNull(published);
          if (publishedStat) {
            if (!marker.expectedTargetDigest) throw new Error('published world has no authenticated digest');
            const scanned = await scanWorld(published, this.#privateRoot(instance), {
              allowPending: marker.operation === 'create', maximumDataVersion: this.#worldDataVersion(instance),
              filesystemTreeVerifier: this.filesystemTreeVerifier,
              directoryGuard: this.directoryGuard,
            });
            if (scanned.digest !== marker.expectedTargetDigest || scanned.bytes !== marker.expectedTargetBytes) throw new Error('published world does not match transaction evidence');
          }
          await this.#removeTree(instance, published, 'Published world rollback');
        }
      }
      await this.#writeCatalog(instance, before);
    }
  }

  async #recover(instance) {
    await this.#revalidateKey();
    await this.#assertJournalBound(instance);
    const results = [];
    const root = this.#transactionsRoot(instance);
    const seenTransactions = new Set();
    const transactionEntries = await readBoundedDirectoryEntries(
      root, MAX_JOURNAL_RECORDS,
      () => worldError('WORLD_RECOVERY_REQUIRED', 409, 'Private world transaction history exceeded its safe bound.'),
    );
    const markers = [];
    for (const entry of transactionEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        this.#recovery.set(instance.id, { state: 'manual-recovery-required', transactionRef: `worldtx-${'0'.repeat(64)}` });
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Unexpected private world transaction state requires manual recovery.');
      }
      const marker = validateMarker(await this.#readAuthenticatedState(path.join(root, entry.name)), instance.id);
      if (entry.name !== `${marker.transactionRef}.json`) throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Private world transaction state is inconsistent.');
      markers.push(marker);
    }
    if (markers.filter((marker) => !TERMINAL_TRANSACTION_PHASES.has(marker.phase)).length > 1) {
      throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Multiple unfinished world transactions require manual recovery.');
    }
    for (const marker of markers.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))) {
      seenTransactions.add(marker.transactionRef);
      if (TERMINAL_TRANSACTION_PHASES.has(marker.phase)) {
        const existing = await this.operation(instance.id, marker.requestId, { allowMissing: true });
        const expectedState = marker.phase;
        if (!existing) {
          await this.#writeOperation(instance, await this.#operationForMarker(instance, marker, expectedState));
          results.push({ instanceId: instance.id, transactionRef: marker.transactionRef, action: 'repaired-terminal-operation' });
          continue;
        }
        if (existing.transactionRef !== marker.transactionRef || existing.planId !== marker.planId
          || existing.planDigest !== marker.planDigest || existing.operation !== marker.operation || existing.state !== expectedState
          || (expectedState === 'rejected-before-mutation' && existing.failureCode !== marker.failureCode)) {
          this.#recovery.set(instance.id, { state: 'manual-recovery-required', transactionRef: marker.transactionRef });
          throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Terminal world transaction evidence is contradictory.');
        }
        continue;
      }
      this.#recovery.set(instance.id, { state: 'completion-unknown', transactionRef: marker.transactionRef });
      try {
        const existing = await this.operation(instance.id, marker.requestId, { allowMissing: true });
        if (existing && (existing.transactionRef !== marker.transactionRef || existing.planId !== marker.planId
          || existing.planDigest !== marker.planDigest || existing.operation !== marker.operation
          || !['committed', 'rolled-back', 'rejected-before-mutation'].includes(existing.state))) {
          throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'World operation evidence contradicts its transaction marker.');
        }
        if (!existing && ['admitted', 'snapshot-verified'].includes(marker.phase)) {
          const admissionFailure = marker.phase === 'admitted' ? 'WORLD_SNAPSHOT_FAILED' : 'WORLD_PLAN_STALE';
          await this.#assertLayoutMatchesCatalog(instance, marker.beforeCatalog, { allowGeneratedActive: true });
          await this.#phase(instance, marker, 'rejected-before-mutation', { failureCode: admissionFailure });
          await this.#writeOperation(instance, await this.#operationForMarker(instance, marker, 'rejected-before-mutation'));
          this.#recovery.delete(instance.id);
          results.push({ instanceId: instance.id, transactionRef: marker.transactionRef, action: 'reconciled-admission' });
          continue;
        }
        const recoverCommitted = existing?.state === 'committed'
          || (!existing && ['intent-catalog', 'catalog-committed'].includes(marker.phase));
        if (recoverCommitted) {
          if (!marker.afterCatalog) throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Committed world recovery is missing its authenticated target catalog.');
          await this.#assertLayoutMatchesCatalog(instance, marker.afterCatalog);
          await this.#writeCatalog(instance, marker.afterCatalog);
          await this.#phase(instance, marker, 'committed');
          if (!existing) await this.#writeOperation(instance, await this.#operationForMarker(instance, marker, 'committed'));
        } else {
          await this.#rollback(instance, marker);
          await this.#writeCatalog(instance, marker.beforeCatalog);
          await this.#phase(instance, marker, 'rolled-back', { failureCode: 'WORLD_OPERATION_FAILED' });
          if (!existing) await this.#writeOperation(instance, await this.#operationForMarker(instance, marker, 'rolled-back'));
        }
        this.#recovery.delete(instance.id); results.push({ instanceId: instance.id, transactionRef: marker.transactionRef, action: 'reconciled' });
      } catch {
        this.#recovery.set(instance.id, { state: 'manual-recovery-required', transactionRef: marker.transactionRef });
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'A world transaction requires manual recovery.');
      }
    }
    const operationEntries = await readBoundedDirectoryEntries(
      this.#operationsRoot(instance), MAX_JOURNAL_RECORDS,
      () => worldError('WORLD_RECOVERY_REQUIRED', 409, 'Private world operation history exceeded its safe bound.'),
    );
    for (const entry of operationEntries) {
      if (!entry.isFile() || !UUID.test(entry.name.replace(/\.json$/, '')) || !entry.name.endsWith('.json')) {
        this.#recovery.set(instance.id, { state: 'manual-recovery-required', transactionRef: `worldtx-${'0'.repeat(64)}` });
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Unexpected private world operation state requires manual recovery.');
      }
      const operation = validateOperation(await this.#readAuthenticatedState(path.join(this.#operationsRoot(instance), entry.name)));
      if (operation.state !== 'rejected-before-mutation' && !seenTransactions.has(operation.transactionRef)) {
        this.#recovery.set(instance.id, { state: 'manual-recovery-required', transactionRef: operation.transactionRef });
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'A world operation lost its authenticated transaction evidence.');
      }
    }
    const planEntries = await readBoundedDirectoryEntries(
      this.#plansRoot(instance), MAX_JOURNAL_RECORDS,
      () => worldError('WORLD_RECOVERY_REQUIRED', 409, 'Private world plan history exceeded its safe bound.'),
    );
    for (const entry of planEntries) {
      const requestId = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
      if (!entry.isFile() || !UUID.test(requestId)) throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Unexpected private world plan state requires manual recovery.');
      const plan = await this.#readAuthenticatedState(path.join(this.#plansRoot(instance), entry.name));
      this.#validatePlan(plan, instance.id);
      if (plan.request.requestId !== requestId) throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Private world plan identity is inconsistent.');
    }
    // The active world is expected to change while Minecraft is running. Once
    // every journal record is terminal, rescan and authenticate that stopped
    // active world while retaining exact digest checks for inactive storage.
    // Requiring the pre-launch active digest here would fence every clean stop
    // after Minecraft saved ordinary gameplay data.
    await this.#refreshCatalog(instance, await this.#readCatalog(instance));
    this.#recovery.delete(instance.id);
    return results;
  }

  async #preflightRecoveryEvidenceWithinSerialization() {
    await this.#revalidateKey();
    const stored = await this.store.get(FAMILY_ID);
    if (!stored) return { domain: 'world', instances: [] };
    const instance = await this.#instance(FAMILY_ID);
    if (!await lstatOrNull(this.#privateRoot(instance))) return { domain: 'world', instances: [] };
    const transactionRef = await this.#preflightInstanceRecoveryEvidence(instance);
    return {
      domain: 'world',
      instances: transactionRef ? [{ instanceId: instance.id, transactionRef }] : [],
    };
  }

  async #preflightInstanceRecoveryEvidence(instance) {
    await this.#assertInstanceRoots(instance);
    const commonChain = await acquireAnchoredGuardChain(
      this.managedRoot, this.#privateRoot(instance), 'Private worlds root', this.directoryGuard,
    );
    let journalChain = [];
    try {
      journalChain = await acquireGuardChain([
        this.#transactionsRoot(instance), this.#operationsRoot(instance),
      ], this.directoryGuard);
      const heldJournalChain = [...commonChain, ...journalChain];
      await assertGuardChainHeld(heldJournalChain);
      await Promise.all([
        this.filesystemTreeVerifier(this.#transactionsRoot(instance), { maxEntries: MAX_JOURNAL_RECORDS, maxDepth: 1 }),
        this.filesystemTreeVerifier(this.#operationsRoot(instance), { maxEntries: MAX_JOURNAL_RECORDS, maxDepth: 1 }),
      ]);
      await this.#assertJournalBound(instance);
      let before = await this.#readRecoveryPreflightNamespace(instance, heldJournalChain);
      const beforeFingerprint = before.fingerprint;
      before = null;
      const evidence = await this.#readRecoveryPreflightNamespace(instance, heldJournalChain);
      await this.#assertJournalBound(instance);
      await assertGuardChainHeld(heldJournalChain);
      if (evidence.fingerprint !== beforeFingerprint) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery evidence changed during read-only preflight.');
      }

      const unfinished = new Set();
      for (const marker of evidence.transactions.values()) {
        const operation = evidence.operations.get(marker.requestId) ?? null;
        if (operation && (operation.transactionRef !== marker.transactionRef || operation.planId !== marker.planId
          || operation.planDigest !== marker.planDigest || operation.operation !== marker.operation)) {
          throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery marker and operation evidence is contradictory.');
        }
        if (!TERMINAL_TRANSACTION_PHASES.has(marker.phase)) {
          unfinished.add(marker.transactionRef);
          continue;
        }
        if (!operation) {
          unfinished.add(marker.transactionRef);
          continue;
        }
        if (operation.state !== marker.phase
          || (marker.phase === 'rejected-before-mutation' && operation.failureCode !== marker.failureCode)) {
          throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Terminal world recovery evidence is contradictory.');
        }
      }
      for (const operation of evidence.operations.values()) {
        const marker = evidence.transactions.get(operation.transactionRef) ?? null;
        if (marker && marker.requestId !== operation.requestId) {
          throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery operation identity is contradictory.');
        }
        if (!marker && operation.state !== 'rejected-before-mutation') {
          throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery operation lost its authenticated transaction evidence.');
        }
      }
      if (unfinished.size > 1) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Multiple unfinished world transactions require manual recovery.');
      }
      return unfinished.values().next().value ?? null;
    } finally {
      await releaseGuards(
        ...commonChain.map((entry) => entry.guard),
        ...journalChain.map((entry) => entry.guard),
      );
    }
  }

  async #readRecoveryPreflightNamespace(instance, heldChain = null) {
    const transactionEntries = await readBoundedDirectoryEntries(
      this.#transactionsRoot(instance), MAX_JOURNAL_RECORDS,
      () => worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery evidence exceeded its record bound.'),
    );
    const operationEntries = await readBoundedDirectoryEntries(
      this.#operationsRoot(instance), MAX_JOURNAL_RECORDS,
      () => worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery evidence exceeded its record bound.'),
    );
    const transactions = new Map(); const transactionRequests = new Set(); const transactionDigests = [];
    for (const entry of transactionEntries.sort((left, right) => left.name.localeCompare(right.name, 'en-US'))) {
      const transactionRef = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
      if (!entry.isFile() || entry.isSymbolicLink() || !TX_REF.test(transactionRef)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery transaction namespace is invalid.');
      }
      const marker = validateMarker(await this.#readAuthenticatedState(
        path.join(this.#transactionsRoot(instance), entry.name), heldChain,
      ), instance.id);
      if (marker.transactionRef !== transactionRef || transactions.has(transactionRef)
        || transactionRequests.has(marker.requestId)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery transaction identity is inconsistent.');
      }
      transactions.set(transactionRef, marker); transactionRequests.add(marker.requestId);
      transactionDigests.push([entry.name, sha256(canonical(marker))]);
    }
    const operations = new Map(); const operationTransactions = new Set(); const operationDigests = [];
    for (const entry of operationEntries.sort((left, right) => left.name.localeCompare(right.name, 'en-US'))) {
      const requestId = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
      if (!entry.isFile() || entry.isSymbolicLink() || !UUID.test(requestId)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery operation namespace is invalid.');
      }
      const operation = validateOperation(await this.#readAuthenticatedState(
        path.join(this.#operationsRoot(instance), entry.name), heldChain,
      ));
      if (operation.requestId !== requestId || operations.has(requestId)
        || operationTransactions.has(operation.transactionRef)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World recovery operation identity is inconsistent.');
      }
      operations.set(requestId, operation); operationTransactions.add(operation.transactionRef);
      operationDigests.push([entry.name, sha256(canonical(operation))]);
    }
    return {
      transactions,
      operations,
      fingerprint: sha256(canonical({ transactions: transactionDigests, operations: operationDigests })),
    };
  }

  async #validateRestoredJournal(instance) {
    await this.#assertJournalBound(instance);
    const privateRoot = this.#privateRoot(instance);
    const expectedRootEntries = new Map([
      ['catalog.json', 'file'], ['storage', 'directory'], ['plans', 'directory'],
      ['transactions', 'directory'], ['operations', 'directory'],
    ]);
    for (const entry of await readBoundedDirectoryEntries(
      privateRoot, 5,
      () => worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored private world-state layout exceeded its exact bound.'),
    )) {
      const expectedType = expectedRootEntries.get(entry.name);
      if (!expectedType || (expectedType === 'file' ? !entry.isFile() : !entry.isDirectory()) || entry.isSymbolicLink()) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored private world-state layout is invalid.');
      }
      expectedRootEntries.delete(entry.name);
    }
    if (expectedRootEntries.size !== 0) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored private world-state layout is incomplete.');

    const markers = new Map();
    const transactionEntries = await readBoundedDirectoryEntries(
      this.#transactionsRoot(instance), MAX_JOURNAL_RECORDS,
      () => worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world transaction history exceeded its safe bound.'),
    );
    for (const entry of transactionEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world transaction history is invalid.');
      const marker = validateMarker(await this.#readAuthenticatedState(
        path.join(this.#transactionsRoot(instance), entry.name),
      ), instance.id);
      if (entry.name !== `${marker.transactionRef}.json` || !TERMINAL_TRANSACTION_PHASES.has(marker.phase)
        || markers.has(marker.transactionRef)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world transaction history contains unfinished or inconsistent state.');
      }
      markers.set(marker.transactionRef, marker);
    }

    const operations = new Map();
    const operationEntries = await readBoundedDirectoryEntries(
      this.#operationsRoot(instance), MAX_JOURNAL_RECORDS,
      () => worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world operation history exceeded its safe bound.'),
    );
    for (const entry of operationEntries) {
      const requestId = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
      if (!entry.isFile() || !UUID.test(requestId)) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world operation history is invalid.');
      const operation = validateOperation(await this.#readAuthenticatedState(
        path.join(this.#operationsRoot(instance), entry.name),
      ));
      if (operation.requestId !== requestId || operations.has(requestId)
        || ['completion-unknown', 'manual-recovery-required'].includes(operation.state)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world operation history contains unresolved state.');
      }
      operations.set(requestId, operation);
    }
    for (const marker of markers.values()) {
      const operation = operations.get(marker.requestId);
      const expectedState = marker.phase;
      if (!operation || operation.transactionRef !== marker.transactionRef || operation.planId !== marker.planId
        || operation.planDigest !== marker.planDigest || operation.operation !== marker.operation || operation.state !== expectedState
        || (expectedState === 'rejected-before-mutation' && operation.failureCode !== marker.failureCode)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world journal lost terminal authenticated evidence.');
      }
    }
    for (const operation of operations.values()) {
      if (operation.state !== 'rejected-before-mutation' && !markers.has(operation.transactionRef)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world operation lost its authenticated transaction marker.');
      }
    }

    const planEntries = await readBoundedDirectoryEntries(
      this.#plansRoot(instance), MAX_JOURNAL_RECORDS,
      () => worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world plan history exceeded its safe bound.'),
    );
    for (const entry of planEntries) {
      const requestId = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
      if (!entry.isFile() || !UUID.test(requestId)) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world plan history is invalid.');
      const plan = await this.#readAuthenticatedState(path.join(this.#plansRoot(instance), entry.name));
      this.#validatePlan(plan, instance.id);
      if (plan.request.requestId !== requestId) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The restored world plan history is inconsistent.');
    }
  }

  async #detectRecoveryReadOnly(instance) {
    if (!await lstatOrNull(this.#privateRoot(instance))) return null;
    try {
      await this.#assertInstanceRoots(instance);
      await this.#assertJournalBound(instance);
      const entries = await readBoundedDirectoryEntries(
        this.#transactionsRoot(instance), MAX_JOURNAL_RECORDS,
        () => worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world transaction history exceeded its safe bound.'),
      );
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world transaction state is invalid.');
        const marker = validateMarker(await this.#readAuthenticatedState(
          path.join(this.#transactionsRoot(instance), entry.name),
        ), instance.id);
        if (entry.name !== `${marker.transactionRef}.json`) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world transaction identity is inconsistent.');
        const operation = await this.operation(instance.id, marker.requestId, { allowMissing: true });
        const expectedState = TERMINAL_TRANSACTION_PHASES.has(marker.phase) ? marker.phase : null;
        if (!expectedState || !operation || operation.transactionRef !== marker.transactionRef || operation.state !== expectedState
          || (expectedState === 'rejected-before-mutation' && operation.failureCode !== marker.failureCode)) {
          this.#recovery.set(instance.id, { state: 'completion-unknown', transactionRef: marker.transactionRef });
          return { instanceId: instance.id, transactionRef: marker.transactionRef, action: 'deferred-running-recovery' };
        }
      }
      return null;
    } catch {
      this.#recovery.set(instance.id, { state: 'manual-recovery-required', transactionRef: `worldtx-${'0'.repeat(64)}` });
      return { instanceId: instance.id, transactionRef: `worldtx-${'0'.repeat(64)}`, action: 'manual-recovery-required' };
    }
  }

  async #assertWorldMatches(instance, root, boundary, record, options = {}) {
    const scanned = await scanWorld(root, boundary, {
      allowPending: record.pendingGeneration, maximumDataVersion: this.#worldDataVersion(instance),
      filesystemTreeVerifier: this.filesystemTreeVerifier,
      directoryGuard: this.directoryGuard,
    });
    if (options.allowGeneratedActive === true && record.state === 'active' && record.pendingGeneration === true
      && scanned.pendingGeneration === false && scanned.dataVersion !== null) return scanned;
    if (scanned.digest !== record.treeDigest || scanned.bytes !== record.bytes || scanned.files !== record.files
      || scanned.pendingGeneration !== record.pendingGeneration || scanned.dataVersion !== record.dataVersion) {
      throw worldError('WORLD_INTEGRITY_FAILED', 409, 'A world transaction slot failed authenticated integrity verification.');
    }
    return scanned;
  }

  async #assertLayoutMatchesCatalog(instance, catalog, options = {}) {
    assertCatalogDataVersions(validateCatalog(catalog, instance.id), this.#worldDataVersion(instance));
    const expectedStorage = new Set(catalog.worlds.filter((world) => world.state !== 'active').map((world) => world.worldRef));
    for (const entry of await readBoundedDirectoryEntries(
      this.#storageRoot(instance), MAX_WORLDS,
      () => worldError('WORLD_INTEGRITY_FAILED', 409, 'World storage exceeded its authenticated catalog bound.'),
    )) {
      if (!entry.isDirectory() || !WORLD_REF.test(entry.name) || !expectedStorage.delete(entry.name)) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'World storage does not match its authenticated catalog.');
      }
    }
    if (expectedStorage.size !== 0) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'Authenticated world storage is incomplete.');
    for (const record of catalog.worlds) {
      await this.#assertWorldMatches(
        instance, this.#worldPath(instance, record), record.state === 'active' ? instance.directory : this.#privateRoot(instance), record,
        { allowGeneratedActive: options.allowGeneratedActive === true },
      );
    }
  }

  async #operationForMarker(instance, marker, state) {
    const catalog = state === 'committed' ? marker.afterCatalog : marker.beforeCatalog;
    let result = null;
    if (state === 'committed') {
      const inventory = await this.#publicInventory(instance, catalog, false);
      if (marker.operation === 'switch') {
        const active = catalog.worlds.find((world) => world.worldRef === catalog.activeWorldRef);
        result = {
          activeWorldRef: active.worldRef, previousWorldRef: marker.sourceWorldRef, rescueVerified: true,
          pendingGeneration: active.pendingGeneration, generation: inventory.generation, inventoryDigest: inventory.inventoryDigest,
        };
      } else {
        const record = catalog.worlds.find((world) => world.worldRef === marker.targetWorldRef);
        if (!record) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The terminal world transaction omitted its result record.');
        result = { worldRef: record.worldRef, displayLabel: record.displayLabel, state: record.state,
          pendingGeneration: record.pendingGeneration, generation: inventory.generation, inventoryDigest: inventory.inventoryDigest };
      }
    }
    return {
      schemaVersion: 1, instanceId: instance.id, requestId: marker.requestId, planId: marker.planId,
      planDigest: marker.planDigest, operation: marker.operation, state, transactionRef: marker.transactionRef,
      failureCode: state === 'rejected-before-mutation' ? marker.failureCode : null,
      result, startedAt: marker.createdAt, updatedAt: nowIso(this.now),
    };
  }

  #validatePlan(plan, instanceId) {
    if (!exactKeys(plan, ['schemaVersion', 'instanceId', 'requestDigest', 'request', 'public', 'createdAt'])
      || plan.schemaVersion !== 1 || plan.instanceId !== instanceId || !HEX64.test(plan.requestDigest ?? '') || !iso(plan.createdAt)) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world plan is invalid.');
    }
    const request = validatePlanRequest(plan.request);
    if (sha256(canonical(request)) !== plan.requestDigest || !plan.public || plan.public.requestId !== request.requestId
      || plan.public.operation !== request.operation || !PLAN_ID.test(plan.public.planId ?? '') || !HEX64.test(plan.public.planDigest ?? '')
      || plan.public.requiredConfirmation !== CONFIRMATIONS[request.operation] || !iso(plan.public.expiresAt)) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world plan is inconsistent.');
    }
  }

  async #quiescent(instanceId) {
    const checked = await this.assertQuiescentWithinInstanceLock(instanceId);
    const instance = await this.#instance(instanceId);
    if (!checked || checked.id !== instance.id || instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess != null) {
      throw worldError('WORLD_SERVER_NOT_QUIESCENT', 409, 'The Family Server must be fully stopped before changing worlds.');
    }
    await this.#ensureInstanceRoots(instance);
    await this.assertCompanionInactiveWithinInstanceLock(instanceId);
    await assertCanonicalLevelName(instance.directory);
    await this.#verifiedWorldDataVersion(instance);
    return instance;
  }

  async #assertExternalLifecycleMutationAllowed(instanceId) {
    const allowed = await this.assertLifecycleMutationAllowedWithinInstanceLock(instanceId);
    if (allowed !== true) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The external lifecycle mutation boundary did not grant world mutation.');
    }
    return true;
  }

  #worldDataVersion(instance) {
    return trustedWorldDataVersion(instance);
  }

  async #verifiedWorldDataVersion(instance) {
    const maximumDataVersion = this.#worldDataVersion(instance);
    let verified;
    try { verified = await this.verifyInstall(instance); }
    catch {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The verified Minecraft world compatibility artifact is unavailable.');
    }
    if (!verified || typeof verified !== 'object' || verified.worldDataVersion !== maximumDataVersion
      || verified.minecraftVersion !== instance.minecraftVersion) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The verified Minecraft world compatibility artifact does not match the managed instance.');
    }
    return maximumDataVersion;
  }

  async #assertCompatibilityMigrationAllowed(instance, target) {
    if (!isSameVersionCompatibilityMigration(instance, target)) {
      throw worldError('WORLD_VERSION_METADATA_REQUIRED', 503, 'Run a verified same-version server update before changing or using managed worlds.');
    }
    const privateRoot = this.#privateRoot(instance);
    if (!await lstatOrNull(privateRoot)) return true;
    await this.#assertInstanceRoots(instance);
    const catalogFile = this.#catalogFile(instance);
    if (await lstatOrNull(catalogFile)) {
      throw worldError('WORLD_VERSION_METADATA_REQUIRED', 503, 'Existing managed world history requires verified compatibility metadata before migration.');
    }
    const rootEntries = await readBoundedDirectoryEntries(
      privateRoot, 4,
      () => worldError('WORLD_STATE_UNAVAILABLE', 503, 'Legacy private world state exceeded its exact root-entry bound.'),
    );
    const expected = new Set(['storage', 'plans', 'transactions', 'operations']);
    if (rootEntries.some((entry) => !entry.isDirectory() || !expected.delete(entry.name)) || expected.size !== 0) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Legacy private world state requires manual verification before metadata migration.');
    }
    for (const directory of [this.#storageRoot(instance), this.#plansRoot(instance), this.#transactionsRoot(instance), this.#operationsRoot(instance)]) {
      if ((await readBoundedDirectoryEntries(directory, 1)).length !== 0) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Legacy private world state requires manual verification before metadata migration.');
      }
    }
    return true;
  }

  async #instance(instanceId) {
    normalizeInstance(instanceId);
    const instance = await this.store.get(instanceId);
    if (!instance) throw worldError('WORLD_INSTANCE_NOT_FOUND', 404, 'The Family Server instance was not found.');
    const expected = path.join(this.serverRoot, instanceId);
    if (instance.projectId !== FAMILY_ID || instance.kind !== 'server' || path.resolve(instance.directory ?? '') !== path.resolve(expected)) {
      throw worldError('WORLD_INVALID_INSTANCE', 409, 'The managed instance is not the isolated Family Server.');
    }
    await assertDirectory(this.managedRoot, this.managedRoot, 'Managed root');
    await assertDirectory(this.serverRoot, this.managedRoot, 'Server root');
    await assertDirectory(instance.directory, this.serverRoot, 'Family Server root');
    await assertCanonicalLevelName(instance.directory);
    return instance;
  }

  async #ensureGlobalRoot() {
    const chain = await acquireAnchoredGuardChain(
      this.managedRoot,
      this.managedRoot,
      'Managed root',
      this.directoryGuard,
    );
    try {
      const state = await ensureGuardedChildDirectory(
        this.managedRoot, 'state', chain, this.directoryGuard, this.filesystemEntryVerifier, 'Managed state root',
      );
      await ensureGuardedChildDirectory(
        state, 'family-worlds', chain, this.directoryGuard, this.filesystemEntryVerifier, 'World state root',
      );
      await assertGuardChainHeld(chain);
    } finally { await releaseGuards(...chain.map((entry) => entry.guard)); }
  }

  async #ensureInstanceRoots(instance) {
    if (instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess != null) {
      try { return await this.#assertInstanceRoots(instance); }
      catch { throw worldError('WORLD_SERVER_NOT_QUIESCENT', 409, 'Stop the Family Server once before initializing world management.'); }
    }
    const chain = await acquireAnchoredGuardChain(
      this.managedRoot,
      instance.directory,
      'Family Server root',
      this.directoryGuard,
    );
    try {
      const privateRoot = await ensureGuardedChildDirectory(
        instance.directory, PRIVATE_ROOT_NAME, chain, this.directoryGuard, this.filesystemEntryVerifier, 'Private instance root',
      );
      const worlds = await ensureGuardedChildDirectory(
        privateRoot, PRIVATE_WORLDS_NAME, chain, this.directoryGuard, this.filesystemEntryVerifier, 'Private worlds root',
      );
      for (const name of ['storage', 'plans', 'transactions', 'operations']) {
        await ensureGuardedChildDirectory(
          worlds, name, chain, this.directoryGuard, this.filesystemEntryVerifier, `World ${name} root`,
        );
      }
      await assertPrivateRootEntries(worlds);
      await this.filesystemTreeVerifier(privateRoot, { maxEntries: 1, maxDepth: 0, recursive: false });
      await this.filesystemTreeVerifier(worlds, { maxEntries: 1, maxDepth: 0, recursive: false });
      for (const name of ['storage', 'plans', 'transactions', 'operations']) {
        await this.filesystemTreeVerifier(path.join(worlds, name), { maxEntries: 1, maxDepth: 0, recursive: false });
      }
      await assertGuardChainHeld(chain);
    } finally { await releaseGuards(...chain.map((entry) => entry.guard)); }
  }

  async #assertInstanceRoots(instance) {
    const privateRoot = path.join(instance.directory, PRIVATE_ROOT_NAME);
    const worlds = this.#privateRoot(instance);
    await assertDirectory(privateRoot, instance.directory, 'Private instance root');
    await assertDirectory(worlds, instance.directory, 'Private worlds root');
    for (const name of ['storage', 'plans', 'transactions', 'operations']) {
      await assertDirectory(path.join(worlds, name), instance.directory, `World ${name} root`);
    }
    await assertPrivateRootEntries(worlds);
    await this.filesystemTreeVerifier(privateRoot, { maxEntries: 1, maxDepth: 0, recursive: false });
    await this.filesystemTreeVerifier(worlds, { maxEntries: 1, maxDepth: 0, recursive: false });
    for (const name of ['storage', 'plans', 'transactions', 'operations']) {
      await this.filesystemTreeVerifier(path.join(worlds, name), { maxEntries: 1, maxDepth: 0, recursive: false });
    }
    return worlds;
  }

  async #withLoadedKey({ allowCreate = true, heldChain = null } = {}, operation) {
    const rootIdentity = await assertDirectory(this.stateRoot, this.managedRoot, 'World state root');
    const guarded = await extendGuardChain(
      heldChain,
      managedGuardPaths(this.managedRoot, this.stateRoot),
      this.directoryGuard,
    );
    const chain = guarded.chain;
    let keyGuard = null;
    try {
      if (!sameIdentity(rootIdentity, await fs.lstat(this.stateRoot))) {
        throw worldError('WORLD_INTEGRITY_FAILED', 409, 'World state root changed while its guard chain was acquired.');
      }
      await assertGuardChainHeld(chain);
      let stat = await lstatOrNull(this.keyFile);
      let createdIdentity = null;
      if (!stat) {
        if (!allowCreate) {
          throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world authentication key disappeared after initialization.');
        }
        const bytes = this.randomBytes(32);
        if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world key generation failed safely.');
        const output = await fs.open(this.keyFile, FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL, 0o600);
        try {
          await output.writeFile(bytes); await output.sync();
          const opened = await output.stat(); const named = await fs.lstat(this.keyFile);
          if (!opened.isFile() || opened.nlink !== 1 || opened.size !== 32 || !sameIdentity(opened, named)) throw new Error('key creation identity');
          createdIdentity = opened;
        } finally { await output.close(); }
        await this.filesystemEntryVerifier(this.keyFile);
        stat = await fs.lstat(this.keyFile);
        if (!sameIdentity(createdIdentity, stat)) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world authentication key changed during creation.');
      }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== 32) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world authentication key is unavailable.');
      await this.filesystemEntryVerifier(this.keyFile);
      keyGuard = await this.fileGuard(this.keyFile);
      keyGuard.assertHeld?.();
      let bytes;
      const checked = await fs.lstat(this.keyFile);
      if (!sameIdentity(stat, checked) || (createdIdentity && !sameIdentity(createdIdentity, checked)) || checked.size !== 32) throw new Error('key guarded identity');
      const handle = await fs.open(this.keyFile, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat(); bytes = await handle.readFile(); const named = await fs.lstat(this.keyFile);
        if (!opened.isFile() || opened.nlink !== 1 || bytes.length !== 32 || named.isSymbolicLink() || named.nlink !== 1
          || !sameIdentity(opened, named) || !sameIdentity(stat, opened)
          || (createdIdentity && !sameIdentity(createdIdentity, opened))) throw new Error('key identity');
      } finally { await handle.close(); }
      await this.filesystemTreeVerifier(this.stateRoot, { maxEntries: 32, maxDepth: 2 });
      await this.filesystemEntryVerifier(this.keyFile);
      keyGuard.assertHeld?.();
      const final = await fs.lstat(this.keyFile);
      if (!sameIdentity(stat, final) || final.size !== 32 || final.nlink !== 1) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world authentication key changed during validation.');
      }
      await assertGuardChainHeld(chain);
      return await operation(bytes, chain);
    } finally {
      await releaseGuards(...guarded.owned.map((entry) => entry.guard), keyGuard);
    }
  }

  async #loadKey(options = {}) {
    return this.#withLoadedKey(options, (bytes) => Buffer.from(bytes));
  }

  async #withRevalidatedKey(operation, heldChain = null) {
    if (!Buffer.isBuffer(this.key) || this.key.length !== 32) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World authentication state was not initialized.');
    }
    return this.#withLoadedKey({ allowCreate: false, heldChain }, async (observed, chain) => {
      if (!crypto.timingSafeEqual(this.key, observed)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The private world authentication key changed after initialization.');
      }
      return operation(this.key, chain);
    });
  }

  async #revalidateKey(heldChain = null) {
    return this.#withRevalidatedKey(async () => true, heldChain);
  }

  async #readAuthenticatedState(file, heldChain = null) {
    return this.#withRevalidatedKey(
      async (key) => authenticateRecord(key, await readJson(file)),
      heldChain,
    );
  }

  async #writeSignedState(instance, file, value, heldChain = null) {
    return this.#withRevalidatedKey(
      async (key, keyChain) => this.#writeState(instance, file, signRecord(key, value), key, keyChain),
      heldChain,
    );
  }

  async #ensureCatalog(instance) {
    const maximumDataVersion = this.#worldDataVersion(instance);
    const file = this.#catalogFile(instance);
    if (await lstatOrNull(file)) return this.#readCatalog(instance);
    for (const root of [this.#storageRoot(instance), this.#plansRoot(instance), this.#transactionsRoot(instance), this.#operationsRoot(instance)]) {
      if ((await readBoundedDirectoryEntries(root, 1)).length !== 0) {
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The private world catalog is missing while managed world history still exists.');
      }
    }
    if (instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess != null) {
      throw worldError('WORLD_SERVER_NOT_QUIESCENT', 409, 'Stop the Family Server once before initializing world management.');
    }
    const activeRoot = this.#activeRoot(instance);
    const scanned = await scanWorld(activeRoot, instance.directory, {
      allowPending: true, maximumDataVersion,
      filesystemTreeVerifier: this.filesystemTreeVerifier, directoryGuard: this.directoryGuard,
    });
    const timestamp = nowIso(this.now); const worldRef = await this.#newWorldRef(instance.id, 'bootstrap');
    const currentStack = await this.#currentStack(instance);
    const catalog = { schemaVersion: 1, instanceId: instance.id, revision: 1, activeWorldRef: worldRef,
      worlds: [{ worldRef, displayLabel: scanned.levelName && (() => { try { return normalizeLabel(scanned.levelName); } catch { return null; } })() || 'Family World',
        state: 'active', pendingGeneration: scanned.pendingGeneration, minecraftVersion: instance.minecraftVersion,
        stackGeneration: currentStack.generation, modsInventoryDigest: currentStack.inventoryDigest,
        dataVersion: scanned.dataVersion, createdAt: timestamp, updatedAt: timestamp, files: scanned.files, bytes: scanned.bytes, treeDigest: scanned.digest }],
      createdAt: timestamp, updatedAt: timestamp };
    await this.#writeCatalog(instance, catalog); return catalog;
  }

  async #readCatalog(instance) {
    const value = await this.#readAuthenticatedState(this.#catalogFile(instance));
    return assertCatalogDataVersions(validateCatalog(value, instance.id), this.#worldDataVersion(instance));
  }

  async #writeCatalog(instance, catalog) {
    assertCatalogDataVersions(validateCatalog(catalog, instance.id), this.#worldDataVersion(instance));
    await this.#writeSignedState(instance, this.#catalogFile(instance), catalog);
  }

  async #refreshCatalog(instance, catalog) {
    const maximumDataVersion = this.#worldDataVersion(instance);
    assertCatalogDataVersions(validateCatalog(catalog, instance.id), maximumDataVersion);
    const next = clone(catalog); let changed = false; let total = 0;
    const currentStack = await this.#currentStack(instance);
    for (const record of next.worlds) {
      const root = this.#worldPath(instance, record);
      const scanned = await scanWorld(root, record.state === 'active' ? instance.directory : this.#privateRoot(instance), {
        allowPending: record.pendingGeneration, maximumDataVersion,
        filesystemTreeVerifier: this.filesystemTreeVerifier,
        directoryGuard: this.directoryGuard,
      });
      if (record.state !== 'active' && scanned.digest !== record.treeDigest) throw worldError('WORLD_INTEGRITY_FAILED', 409, 'An inactive world failed integrity verification.');
      if (record.state === 'active' && (record.treeDigest !== scanned.digest || record.pendingGeneration !== scanned.pendingGeneration
        || record.dataVersion !== scanned.dataVersion || record.files !== scanned.files || record.bytes !== scanned.bytes
        || record.minecraftVersion !== instance.minecraftVersion || record.stackGeneration !== currentStack.generation
        || record.modsInventoryDigest !== currentStack.inventoryDigest)) {
        Object.assign(record, {
          pendingGeneration: scanned.pendingGeneration, dataVersion: scanned.dataVersion,
          files: scanned.files, bytes: scanned.bytes, treeDigest: scanned.digest,
          minecraftVersion: instance.minecraftVersion, stackGeneration: currentStack.generation,
          modsInventoryDigest: currentStack.inventoryDigest,
          updatedAt: nowIso(this.now),
        });
        changed = true;
      }
      total += scanned.bytes;
    }
    if (total > MAX_TOTAL_BYTES) throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'Family Server world storage exceeded its aggregate limit.');
    if (changed) { next.revision += 1; next.updatedAt = nowIso(this.now); await this.#writeCatalog(instance, next); }
    return next;
  }

  async #publicInventory(instance, catalog, activeUnverified) {
    const active = catalog.worlds.find((record) => record.worldRef === catalog.activeWorldRef);
    const currentStack = { generation: active.stackGeneration, inventoryDigest: active.modsInventoryDigest };
    const worlds = catalog.worlds.map((record) => worldRecordPublic(record, instance.minecraftVersion, currentStack, activeUnverified));
    const inventoryDigest = sha256(canonical(worlds));
    const generation = await this.#withRevalidatedKey(async (key) => sign(key, {
      instanceId: instance.id, revision: catalog.revision, inventoryDigest,
      updatedAt: catalog.updatedAt, restoreEpoch: restoreEpoch(instance),
    }));
    const recovery = this.#recovery.get(instance.id);
    return { generation, inventoryDigest,
      recovery: recovery ? { required: true, state: recovery.state, transactionRef: recovery.transactionRef }
        : { required: false, state: null, transactionRef: null },
      activeWorldRef: catalog.activeWorldRef, worlds,
      limits: { maxWorlds: MAX_WORLDS, maxWorldBytes: MAX_WORLD_BYTES, maxTotalBytes: MAX_TOTAL_BYTES } };
  }

  async #writeOperation(instance, value) {
    validateOperation(value);
    await this.#writeSignedState(instance, path.join(this.#operationsRoot(instance), `${value.requestId}.json`), value);
  }

  async #currentStack(instance) {
    const value = await this.currentStackBindingWithinInstanceLock(instance);
    if (!exactKeys(value, ['generation', 'inventoryDigest']) || !HEX64.test(value.generation ?? '') || !HEX64.test(value.inventoryDigest ?? '')) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'The managed server stack binding is unavailable.');
    }
    return value;
  }

  async #writeMarker(instance, marker, heldChain = null) {
    marker.updatedAt = nowIso(this.now);
    await this.#writeSignedState(
      instance,
      path.join(this.#transactionsRoot(instance), `${marker.transactionRef}.json`),
      marker,
      heldChain,
    );
  }

  async #persistedMarkerHasPhase(instance, marker, phase) {
    try {
      const persisted = validateMarker(await this.#readAuthenticatedState(
        path.join(this.#transactionsRoot(instance), `${marker.transactionRef}.json`),
      ), instance.id);
      return persisted.requestId === marker.requestId && persisted.planId === marker.planId
        && persisted.planDigest === marker.planDigest && persisted.operation === marker.operation
        && persisted.phase === phase;
    } catch { return false; }
  }

  async #phase(instance, marker, phase, patch = {}, heldChain = null) {
    Object.assign(marker, patch, { phase, updatedAt: nowIso(this.now) }); await this.#writeMarker(instance, marker, heldChain); await this.onPhase(clone(marker));
  }

  async #newWorldRef(instanceId, requestId) {
    return this.#withRevalidatedKey(async (key) => `world-${sign(key, {
      instanceId, requestId, nonce: this.randomBytes(32).toString('hex'),
    })}`);
  }

  #worldPath(instance, record) { return record.state === 'active' ? this.#activeRoot(instance) : path.join(this.#storageRoot(instance), record.worldRef); }
  #activeRoot(instance) { return path.join(instance.directory, ACTIVE_DIRECTORY_NAME); }
  #privateRoot(instance) { return path.join(instance.directory, PRIVATE_ROOT_NAME, PRIVATE_WORLDS_NAME); }
  #storageRoot(instance) { return path.join(this.#privateRoot(instance), 'storage'); }
  #plansRoot(instance) { return path.join(this.#privateRoot(instance), 'plans'); }
  #transactionsRoot(instance) { return path.join(this.#privateRoot(instance), 'transactions'); }
  #operationsRoot(instance) { return path.join(this.#privateRoot(instance), 'operations'); }
  #catalogFile(instance) { return path.join(this.#privateRoot(instance), 'catalog.json'); }

  async #readAuthenticatedJournalSnapshot(instance, key, heldChain) {
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'World journal authentication state is unavailable.');
    }
    await assertGuardChainHeld(heldChain);
    const rootSpecs = [
      { name: 'plans', root: this.#plansRoot(instance) },
      { name: 'transactions', root: this.#transactionsRoot(instance) },
      { name: 'operations', root: this.#operationsRoot(instance) },
    ];
    const roots = new Map();
    const plans = new Map();
    const transactions = new Map();
    const operations = new Map();
    const transactionRequests = new Set();
    const operationTransactions = new Set();
    for (const spec of rootSpecs) {
      const entries = await readBoundedDirectoryEntries(
        spec.root,
        MAX_JOURNAL_RECORDS,
        () => worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world journal history exceeded its record bound.'),
      );
      const digests = new Map();
      for (const entry of entries) {
        if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
          throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world journal storage is unsafe.');
        }
        const file = path.join(spec.root, entry.name);
        await this.filesystemEntryVerifier(file);
        const statBefore = await fs.lstat(file, { bigint: true });
        if (!statBefore.isFile() || statBefore.isSymbolicLink() || statBefore.nlink !== 1n
          || statBefore.size < 2n || statBefore.size > BigInt(MAX_STATE_BYTES)) {
          throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world journal storage is unsafe.');
        }
        const unsigned = authenticateRecord(key, await readJson(file));
        if (spec.name === 'plans') {
          const requestId = entry.name.slice(0, -5);
          if (!UUID.test(requestId)) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world plan identity is invalid.');
          this.#validatePlan(unsigned, instance.id);
          if (unsigned.request.requestId !== requestId || plans.has(requestId)) {
            throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world plan identity is inconsistent.');
          }
          plans.set(requestId, unsigned);
        } else if (spec.name === 'transactions') {
          const transactionRef = entry.name.slice(0, -5);
          if (!TX_REF.test(transactionRef)) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world transaction identity is invalid.');
          const marker = validateMarker(unsigned, instance.id);
          if (marker.transactionRef !== transactionRef || transactions.has(transactionRef)
            || transactionRequests.has(marker.requestId)) {
            throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world transaction identity is inconsistent.');
          }
          transactions.set(transactionRef, marker);
          transactionRequests.add(marker.requestId);
        } else {
          const requestId = entry.name.slice(0, -5);
          if (!UUID.test(requestId)) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world operation identity is invalid.');
          const operation = validateOperation(unsigned);
          if (operation.requestId !== requestId || operations.has(requestId)
            || operationTransactions.has(operation.transactionRef)) {
            throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world operation identity is inconsistent.');
          }
          operations.set(requestId, operation);
          operationTransactions.add(operation.transactionRef);
        }
        const statAfter = await fs.lstat(file, { bigint: true });
        await this.filesystemEntryVerifier(file);
        if (!sameIdentity(statBefore, statAfter) || statBefore.size !== statAfter.size) {
          throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world journal storage changed during validation.');
        }
        digests.set(entry.name, {
          digest: sha256(canonical(unsigned)),
          identity: canonical([
            String(statAfter.dev), String(statAfter.ino), String(statAfter.size), String(statAfter.nlink),
          ]),
        });
      }
      roots.set(path.resolve(spec.root), digests);
    }
    for (const marker of transactions.values()) {
      const operation = operations.get(marker.requestId) ?? null;
      if (!operation) continue;
      if (operation.transactionRef !== marker.transactionRef || operation.planId !== marker.planId
        || operation.planDigest !== marker.planDigest || operation.operation !== marker.operation
        || (TERMINAL_TRANSACTION_PHASES.has(marker.phase) && operation.state !== marker.phase
          && !['completion-unknown', 'manual-recovery-required'].includes(operation.state))
        || (marker.phase === 'rejected-before-mutation' && operation.failureCode !== marker.failureCode)) {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world marker and operation evidence is contradictory.');
      }
    }
    for (const operation of operations.values()) {
      const marker = transactions.get(operation.transactionRef) ?? null;
      if (!marker && operation.state !== 'rejected-before-mutation') {
        throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world operation lost its authenticated transaction evidence.');
      }
    }
    await assertGuardChainHeld(heldChain);
    return { roots, plans, transactions, operations };
  }

  #assertJournalPublicationTransition(before, after, instance, file, expectedUnsigned) {
    const targetRoot = path.resolve(path.dirname(file));
    const targetName = path.basename(file);
    for (const [root, observed] of after.roots) {
      const expected = new Map(before.roots.get(root) ?? []);
      if (root === targetRoot) {
        const published = observed.get(targetName);
        if (!published || published.digest !== sha256(canonical(expectedUnsigned))) {
          throw namespaceDiscontinuity('Private world journal publication lost its exact authenticated output.');
        }
        expected.set(targetName, published);
      }
      if (expected.size !== observed.size) {
        throw namespaceDiscontinuity('Private world journal siblings changed during authenticated publication.');
      }
      for (const [name, record] of expected) {
        const current = observed.get(name);
        if (!current || current.digest !== record.digest || current.identity !== record.identity) {
          throw namespaceDiscontinuity('Private world journal siblings changed during authenticated publication.');
        }
      }
    }
    const unfinished = [...after.transactions.values()].filter((marker) => !TERMINAL_TRANSACTION_PHASES.has(marker.phase));
    const transactionsRoot = path.resolve(this.#transactionsRoot(instance));
    const operationsRoot = path.resolve(this.#operationsRoot(instance));
    if (targetRoot === transactionsRoot) {
      if (!TERMINAL_TRANSACTION_PHASES.has(expectedUnsigned.phase)) {
        if (unfinished.length !== 1 || unfinished[0].transactionRef !== expectedUnsigned.transactionRef) {
          throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'The world transaction admission is not uniquely authoritative.');
        }
      } else if (unfinished.length !== 0) {
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'A terminal world marker conflicts with unfinished transaction evidence.');
      }
    } else if (unfinished.length !== 0) {
      const ownsManualRecovery = targetRoot === operationsRoot && unfinished.length === 1
        && unfinished[0].transactionRef === expectedUnsigned.transactionRef
        && ['completion-unknown', 'manual-recovery-required'].includes(expectedUnsigned.state);
      if (!ownsManualRecovery) {
        throw worldError('WORLD_RECOVERY_REQUIRED', 409, 'Unfinished world transaction evidence blocks journal publication.');
      }
    }
  }

  async #writeState(instance, file, value, key, heldChain = null) {
    const journalRoots = new Set([this.#plansRoot(instance), this.#transactionsRoot(instance), this.#operationsRoot(instance)]);
    const targetRoot = path.dirname(file);
    const replacement = {
      replacement: file,
      replacementBytes: Buffer.byteLength(`${JSON.stringify(value)}\n`, 'utf8'),
    };
    let writeChain = heldChain;
    const siblingOwned = [];
    try {
      if (journalRoots.has(targetRoot)) {
        for (const sibling of [...journalRoots].filter((root) => root !== targetRoot)) {
          const extended = await extendGuardChain(
            writeChain,
            managedGuardPaths(this.managedRoot, sibling),
            this.directoryGuard,
          );
          writeChain = extended.chain;
          siblingOwned.push(...extended.owned);
        }
      }
      return await writeAtomic(file, value, this.#privateRoot(instance), {
        guardRoot: this.managedRoot,
        directoryGuard: this.directoryGuard,
        fileGuard: this.fileGuard,
        filesystemEntryVerifier: this.filesystemEntryVerifier,
        namespaceMaximumEntries: journalRoots.has(targetRoot) ? MAX_JOURNAL_RECORDS + 1 : 8,
        namespaceVerifier: journalRoots.has(targetRoot)
          ? (root) => this.filesystemTreeVerifier(root, { maxEntries: MAX_JOURNAL_RECORDS + 1, maxDepth: 1 })
          : null,
        validateNamespace: journalRoots.has(targetRoot)
          ? async ({ stage, heldChain: publicationChain }) => {
            await this.#assertJournalBound(instance, replacement);
            const snapshot = await this.#readAuthenticatedJournalSnapshot(instance, key, publicationChain);
            if (stage === 'before') {
              replacement.before = snapshot;
              return;
            }
            if (!replacement.before) {
              throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world journal publication lost its precondition snapshot.');
            }
            this.#assertJournalPublicationTransition(
              replacement.before,
              snapshot,
              instance,
              file,
              authenticateRecord(key, value),
            );
          }
          : ({ stage, destinationExisted }) => assertPrivateRootEntries(
            this.#privateRoot(instance),
            { catalogRequired: stage === 'after' || destinationExisted },
          ),
        protectDirectoryChildren: !journalRoots.has(targetRoot),
        heldChain: writeChain,
      });
    } finally {
      await releaseGuards(...siblingOwned.map((entry) => entry.guard));
    }
  }

  async #assertJournalBound(instance, options = {}) {
    let total = 0; let replacedBytes = 0;
    const replacement = options.replacement ? path.resolve(options.replacement) : null;
    for (const root of [this.#plansRoot(instance), this.#transactionsRoot(instance), this.#operationsRoot(instance)]) {
      const entries = await readBoundedDirectoryEntries(
        root,
        MAX_JOURNAL_RECORDS,
        () => worldError(
          options.replacement ? 'WORLD_QUOTA_EXCEEDED' : 'WORLD_STATE_UNAVAILABLE',
          options.replacement ? 507 : 503,
          'Private world journal history exceeded its record bound.',
        ),
      );
      let replacementInRoot = false;
      for (const entry of entries) {
        assertSafeEntryName(entry.name);
        const file = path.join(root, entry.name);
        const stat = await fs.lstat(file);
        if (!entry.isFile() || entry.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink()
          || stat.nlink !== 1 || stat.size < 2 || stat.size > MAX_STATE_BYTES) {
          throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world journal storage is unsafe.');
        }
        total += stat.size;
        if (!Number.isSafeInteger(total)) throw worldError('WORLD_STATE_UNAVAILABLE', 503, 'Private world journal size is invalid.');
        if (replacement && path.resolve(file) === replacement) { replacedBytes = stat.size; replacementInRoot = true; }
      }
      if (replacement && path.dirname(replacement) === path.resolve(root) && !replacementInRoot && entries.length >= MAX_JOURNAL_RECORDS) {
        throw worldError('WORLD_QUOTA_EXCEEDED', 507, 'The bounded world-operation journal is full.');
      }
    }
    const prospective = options.replacementBytes ?? 0;
    if (!Number.isSafeInteger(prospective) || prospective < 0 || total - replacedBytes + prospective > MAX_JOURNAL_BYTES) {
      throw worldError(options.replacement ? 'WORLD_QUOTA_EXCEEDED' : 'WORLD_STATE_UNAVAILABLE', options.replacement ? 507 : 503,
        'Private world journal history exceeded its aggregate byte bound.');
    }
    return total;
  }

  async #removeTree(instance, target, label) {
    return removeManagedTree(target, this.#privateRoot(instance), label, {
      guardRoot: this.managedRoot,
      filesystemTreeVerifier: this.filesystemTreeVerifier,
      filesystemEntryVerifier: this.filesystemEntryVerifier,
      directoryGuard: this.directoryGuard,
      fileGuard: this.fileGuard,
    });
  }

  async #serialized(operation) {
    const current = this.#queue.catch(() => undefined).then(async () => {
      await this.#revalidateKey();
      return operation();
    });
    this.#queue = current;
    return current;
  }
}
