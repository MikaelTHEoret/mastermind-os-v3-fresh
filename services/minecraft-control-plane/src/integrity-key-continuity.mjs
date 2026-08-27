import crypto from 'node:crypto';
import { constants as FS_CONSTANTS } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  acquireWindowsDirectoryGuard,
  acquireWindowsFileGuard,
  assertWindowsFilesystemEntry,
  withHeldWindowsDirectoryGuards,
} from './windows-filesystem-safety.mjs';

const KEY_BYTES = 32;
const continuity = new Map();

function unavailable(message = 'The launch-integrity key continuity boundary is unavailable') {
  return Object.assign(new Error(message), { code: 'LAUNCH_INTEGRITY_UNAVAILABLE', statusCode: 503 });
}

function sameIdentity(left, right) {
  if (!left || !right) return false;
  if (left.dev !== right.dev || left.ino !== right.ino) return false;
  if (left.birthtimeMs && right.birthtimeMs && left.birthtimeMs !== right.birthtimeMs) return false;
  return true;
}

async function releaseGuards(guards) {
  let failure = null;
  for (const guard of guards.toReversed()) {
    try { await guard.release(); } catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
}

async function readGuardedKey(keyFile, expectedIdentity = null) {
  const namedBefore = await fs.lstat(keyFile);
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1 || namedBefore.size !== KEY_BYTES) {
    throw unavailable('The launch-integrity key is not an exact regular one-link file');
  }
  if (expectedIdentity && !sameIdentity(expectedIdentity, namedBefore)) {
    throw unavailable('The launch-integrity key identity changed after initialization');
  }
  const handle = await fs.open(keyFile, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
  try {
    const openedBefore = await handle.stat();
    if (!openedBefore.isFile() || openedBefore.nlink !== 1 || openedBefore.size !== KEY_BYTES
      || !sameIdentity(openedBefore, namedBefore)) {
      throw unavailable('The launch-integrity key changed while it was opened');
    }
    const key = Buffer.alloc(KEY_BYTES);
    const { bytesRead } = await handle.read(key, 0, KEY_BYTES, 0);
    const [openedAfter, namedAfter] = await Promise.all([handle.stat(), fs.lstat(keyFile)]);
    if (bytesRead !== KEY_BYTES || openedAfter.size !== KEY_BYTES || openedAfter.nlink !== 1
      || namedAfter.isSymbolicLink() || namedAfter.nlink !== 1 || namedAfter.size !== KEY_BYTES
      || !sameIdentity(openedBefore, openedAfter) || !sameIdentity(openedAfter, namedAfter)) {
      throw unavailable('The launch-integrity key changed while it was read');
    }
    return { key, identity: namedAfter };
  } finally {
    await handle.close();
  }
}

function exactChild(parent, child, expectedName) {
  return path.dirname(child) === parent && path.basename(child) === expectedName;
}

/**
 * Acquires the one process-wide launch-integrity trust anchor. The first
 * successful acquisition pins exact ancestor/file identities and key bytes;
 * every later acquisition must observe the same values. Guards stay held until
 * the returned lease is released, so callers can cover authentication and
 * publication with one continuous capability.
 */
export async function acquireLaunchIntegrityKey(managedRoot, options = {}) {
  const root = path.resolve(managedRoot);
  const stateRoot = path.join(root, 'state');
  const keyFile = path.join(stateRoot, 'launch-integrity.hmac.key');
  if (!path.isAbsolute(managedRoot) || !exactChild(root, stateRoot, 'state')
    || !exactChild(stateRoot, keyFile, 'launch-integrity.hmac.key')) {
    throw new TypeError('Invalid launch-integrity key boundary');
  }
  const platform = options.platform ?? process.platform;
  const directoryGuard = options.directoryGuard
    ?? ((directory) => acquireWindowsDirectoryGuard(directory, { platform, borrowHeld: true }));
  const fileGuard = options.fileGuard
    ?? ((file) => acquireWindowsFileGuard(file, { platform }));
  const verifyEntry = options.filesystemEntryVerifier
    ?? ((target) => assertWindowsFilesystemEntry(target, { platform }));
  if (typeof directoryGuard !== 'function' || typeof fileGuard !== 'function' || typeof verifyEntry !== 'function') {
    throw new TypeError('Invalid launch-integrity filesystem boundary');
  }
  const guards = [];
  const guardedStateDirectories = [];
  let released = false;
  try {
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw unavailable('The managed root is not a regular directory');
    const rootGuard = await directoryGuard(root); guards.push(rootGuard); rootGuard.assertHeld?.();
    await verifyEntry(root);
    const stateStat = await fs.lstat(stateRoot);
    if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) throw unavailable('The managed state root is not a regular directory');
    const stateGuard = await directoryGuard(stateRoot); guards.push(stateGuard); stateGuard.assertHeld?.();
    await verifyEntry(stateRoot);
    const [realRoot, realState] = await Promise.all([fs.realpath(root), fs.realpath(stateRoot)]);
    if (path.relative(realRoot, realState) !== 'state') throw unavailable('The launch-integrity state root escaped its managed boundary');
    const physicalKeyFile = path.join(realState, 'launch-integrity.hmac.key');
    const continuityId = platform === 'win32' ? physicalKeyFile.toLocaleLowerCase('en-US') : physicalKeyFile;

    let createdIdentity = null;
    try { await fs.lstat(keyFile); }
    catch (error) {
      if (error?.code !== 'ENOENT' || options.createIfMissing !== true || continuity.has(continuityId)) throw unavailable();
      if (typeof options.assertCanCreate === 'function') await options.assertCanCreate();
      const bytes = (options.randomBytes ?? crypto.randomBytes)(KEY_BYTES);
      if (!Buffer.isBuffer(bytes) || bytes.length !== KEY_BYTES) throw unavailable();
      const handle = await fs.open(keyFile, FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL, 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.chmod(0o600);
        await handle.sync();
        createdIdentity = await handle.stat();
        if (!createdIdentity.isFile() || createdIdentity.nlink !== 1 || createdIdentity.size !== KEY_BYTES) throw unavailable();
      } finally { await handle.close(); }
    }

    const keyGuard = await fileGuard(keyFile); guards.push(keyGuard); keyGuard.assertHeld?.();
    rootGuard.assertHeld?.(); stateGuard.assertHeld?.();
    await verifyEntry(keyFile);
    const cached = continuity.get(continuityId) ?? null;
    const observed = await readGuardedKey(keyFile, cached?.keyIdentity ?? createdIdentity);
    if (cached && (!sameIdentity(cached.rootIdentity, rootStat) || !sameIdentity(cached.stateIdentity, stateStat)
      || !sameIdentity(cached.keyIdentity, observed.identity)
      || !crypto.timingSafeEqual(cached.key, observed.key))) {
      throw unavailable('The launch-integrity trust anchor changed after process initialization');
    }
    if (!cached) {
      continuity.set(continuityId, {
        key: Buffer.from(observed.key), rootIdentity: rootStat, stateIdentity: stateStat, keyIdentity: observed.identity,
      });
    }
    const pinned = continuity.get(continuityId);
    const assertHeld = async () => {
      if (released) throw unavailable('The launch-integrity key lease was already released');
      for (const guard of guards) guard.assertHeld?.();
      for (const target of [root, stateRoot, keyFile]) await verifyEntry(target);
      const [currentRoot, currentState] = await Promise.all([fs.lstat(root), fs.lstat(stateRoot)]);
      if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink() || !sameIdentity(pinned.rootIdentity, currentRoot)
        || !currentState.isDirectory() || currentState.isSymbolicLink() || !sameIdentity(pinned.stateIdentity, currentState)) {
        throw unavailable('A launch-integrity ancestor changed while leased');
      }
      for (const item of guardedStateDirectories) {
        await verifyEntry(item.directory);
        const current = await fs.lstat(item.directory);
        if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(item.identity, current)) {
          throw unavailable('A guarded launch-integrity state child changed while leased');
        }
      }
      const current = await readGuardedKey(keyFile, pinned.keyIdentity);
      if (!crypto.timingSafeEqual(pinned.key, current.key)) {
        throw unavailable('The launch-integrity key bytes changed while leased');
      }
      return true;
    };
    await assertHeld();
    return {
      key: Buffer.from(pinned.key), keyFile, assertHeld,
      async withHeldDirectoryGuards(operation) {
        if (released || typeof operation !== 'function') throw unavailable('Invalid launch-integrity guard borrowing request');
        await assertHeld();
        const heldDirectories = [
          { directory: root, guard: rootGuard },
          { directory: stateRoot, guard: stateGuard },
          ...guardedStateDirectories.map((item) => ({ directory: item.directory, guard: item.guard })),
        ];
        return withHeldWindowsDirectoryGuards(heldDirectories, async () => {
          await assertHeld();
          return operation();
        });
      },
      async guardStateDirectory(directory) {
        if (released || path.dirname(directory) !== stateRoot) throw unavailable('Invalid launch-integrity state child boundary');
        await assertHeld();
        const before = await fs.lstat(directory);
        if (!before.isDirectory() || before.isSymbolicLink()) throw unavailable('Launch-integrity state child is not a regular directory');
        const guard = await directoryGuard(directory);
        guards.push(guard);
        guard.assertHeld?.();
        await verifyEntry(directory);
        const after = await fs.lstat(directory);
        if (!after.isDirectory() || after.isSymbolicLink() || !sameIdentity(before, after)) {
          throw unavailable('Launch-integrity state child changed while it was guarded');
        }
        guardedStateDirectories.push({ directory, identity: after, guard });
        await assertHeld();
        return true;
      },
      async release() {
        if (released) return;
        released = true;
        await releaseGuards(guards);
      },
    };
  } catch (error) {
    released = true;
    await releaseGuards(guards).catch(() => undefined);
    if (error?.code === 'LAUNCH_INTEGRITY_UNAVAILABLE' || error instanceof TypeError) throw error;
    throw unavailable();
  }
}
