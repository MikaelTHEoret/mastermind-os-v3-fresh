import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const WINDOWS_NODE_PACKAGE_PROFILE = 'mastermind-source-runtime-v1';
export const WINDOWS_NODE_PACKAGE_FILES = Object.freeze([
  'minecraft\\family-client-lock.v1.json',
  'next.config.js',
  'package-lock.json',
  'package.json',
]);
export const WINDOWS_NODE_PACKAGE_DIRECTORIES = Object.freeze([
  '.next',
  'node_modules',
  'protocol\\mastermind-domain-event',
  'protocol\\mastermind-node-exchange',
  'public',
  'scripts',
  'services\\mastermind-node-link\\src',
  'services\\minecraft-control-plane\\src',
]);

const MAX_PACKAGE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_PACKAGE_FILES = 100_000;
const EXCLUDED = Object.freeze([
  '.next/cache',
  '.next/trace',
  'node_modules/.cache',
  'scripts/test',
]);

export class WindowsNodePackageTreeError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'WindowsNodePackageTreeError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new WindowsNodePackageTreeError(code, message, cause ? { cause } : undefined);
}

function portableRelative(value) {
  return value.replaceAll('\\', '/').toLowerCase();
}

function excluded(relative) {
  const value = portableRelative(relative);
  return EXCLUDED.some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
}

function append(hash, value) {
  hash.update(Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'));
}

export async function computeWindowsNodePackageTree({ workspace, fsApi = fs } = {}) {
  if (typeof workspace !== 'string' || !path.win32.isAbsolute(workspace)
    || path.win32.resolve(workspace) !== workspace || workspace.includes('/')) {
    fail('PACKAGE_TREE_INPUT_INVALID', 'The package-tree workspace is invalid.');
  }
  const files = [];

  const addFile = async (relative) => {
    if (excluded(relative)) return;
    const absolute = path.win32.join(workspace, relative);
    const stat = await fsApi.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail('PACKAGE_TREE_UNSAFE', 'The package tree contains a non-regular file or reparse point.');
    }
    files.push({ relative: portableRelative(relative), absolute });
  };

  const walk = async (relative) => {
    if (excluded(relative)) return;
    const absolute = path.win32.join(workspace, relative);
    const directoryStat = await fsApi.lstat(absolute);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      fail('PACKAGE_TREE_UNSAFE', 'The package tree contains a non-directory or reparse point.');
    }
    const entries = await fsApi.readdir(absolute, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const child = path.win32.join(relative, entry.name);
      if (excluded(child)) continue;
      if (entry.isSymbolicLink()) {
        fail('PACKAGE_TREE_UNSAFE', 'The package tree contains a reparse point.');
      }
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) await addFile(child);
      else fail('PACKAGE_TREE_UNSAFE', 'The package tree contains an unsupported filesystem entry.');
    }
  };

  try {
    for (const relative of WINDOWS_NODE_PACKAGE_FILES) await addFile(relative);
    for (const relative of WINDOWS_NODE_PACKAGE_DIRECTORIES) await walk(relative);
  } catch (error) {
    if (error instanceof WindowsNodePackageTreeError) throw error;
    fail('PACKAGE_TREE_UNAVAILABLE', 'The complete Mastermind runtime package is unavailable.', error);
  }
  files.sort((left, right) => left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0);
  if (files.length < 1 || files.length > MAX_PACKAGE_FILES
    || new Set(files.map(({ relative }) => relative)).size !== files.length) {
    fail('PACKAGE_TREE_UNSAFE', 'The package tree has an invalid file inventory.');
  }

  const digest = crypto.createHash('sha256');
  let packageBytes = 0;
  for (const file of files) {
    const before = await fsApi.lstat(file.absolute);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 0) {
      fail('PACKAGE_TREE_UNSAFE', 'A package file changed type during inspection.');
    }
    const bytes = await fsApi.readFile(file.absolute);
    const after = await fsApi.lstat(file.absolute);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || bytes.length !== before.size) {
      fail('PACKAGE_TREE_CHANGED', 'The package tree changed while its identity was being computed.');
    }
    packageBytes += bytes.length;
    if (!Number.isSafeInteger(packageBytes) || packageBytes > MAX_PACKAGE_BYTES) {
      fail('PACKAGE_TREE_TOO_LARGE', 'The package tree exceeds the supported portable package size.');
    }
    append(digest, file.relative);
    append(digest, Buffer.from([0]));
    append(digest, String(bytes.length));
    append(digest, Buffer.from([0]));
    append(digest, crypto.createHash('sha256').update(bytes).digest('hex'));
    append(digest, '\n');
  }
  return Object.freeze({
    packageProfile: WINDOWS_NODE_PACKAGE_PROFILE,
    packageDigestSha256: digest.digest('hex'),
    packageBytes,
    packageFileCount: files.length,
  });
}

export const __test = Object.freeze({ excluded, portableRelative });
