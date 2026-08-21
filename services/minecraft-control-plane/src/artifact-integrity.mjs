import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import zlib from 'node:zlib';
import { acquireLaunchIntegrityKey } from './integrity-key-continuity.mjs';
import { inspectVerifiedMinecraftServerJar, minecraftServerRelativePath } from './minecraft-server-version.mjs';
import {
  acquireWindowsDirectoryGuard,
  acquireWindowsFileGuard,
  assertWindowsFilesystemEntry,
  assertWindowsFilesystemTree,
} from './windows-filesystem-safety.mjs';

const SHA256 = /^[a-f0-9]{64}$/i;
const SHA1 = /^[a-f0-9]{40}$/i;
const MAX_PRIVATE_MANIFEST_BYTES = 1024 * 1024;
const MAX_LAUNCH_JAR_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_MANAGED_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_RUNTIME_MARKER_BYTES = 4 * 1024 * 1024;
const MAX_GEYSER_CONFIG_BYTES = 1024 * 1024;
const MAX_LAUNCH_INVENTORY_BYTES = 8 * 1024 * 1024;
const MAX_LAUNCH_FILES = 4096;
const MAX_MODS = 64;
const GEYSER_CONFIG_PATH = 'config/Geyser-Fabric/config.yml';
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const SHA512 = /^[a-f0-9]{128}$/i;
const SAFE_MANAGED_MOD = /^mastermind-[a-f0-9]{48}\.jar$/;
const WINDOWS_MOD_DISCOVERY_POLICY = 'authenticated-local-home';

export const REQUIRED_FAMILY_ARTIFACTS = Object.freeze([
  'fabric-server-launch.jar',
  'mods/fabric-api.jar',
  'mods/geyser-fabric.jar',
  'mods/floodgate-fabric.jar',
  GEYSER_CONFIG_PATH,
]);

const IMMUTABLE_FAMILY_ARTIFACTS = new Set(REQUIRED_FAMILY_ARTIFACTS.filter(
  (relativePath) => relativePath !== GEYSER_CONFIG_PATH,
));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function launchTrustUnavailable(message) {
  return Object.assign(new Error(message), { code: 'LAUNCH_TRUST_UNAVAILABLE', statusCode: 503 });
}

const LAUNCH_VERIFICATION_STAGES = new Set([
  'instance-validation', 'manifest-read', 'base-integrity', 'launch-inventory',
  'windows-policy', 'mod-inventory', 'native-metadata', 'launch-session',
  'classpath', 'lease-acquire', 'lease-assert',
]);

function launchVerificationStageError(error, stage) {
  if (error && typeof error === 'object' && LAUNCH_VERIFICATION_STAGES.has(stage)
    && !LAUNCH_VERIFICATION_STAGES.has(error.launchVerificationStage)) {
    Object.defineProperty(error, 'launchVerificationStage', {
      value: stage, enumerable: false, configurable: true,
    });
  }
  return error;
}

function containedFile(root, relativePath, label) {
  if (
    typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')
    || relativePath.includes('\\') || path.posix.isAbsolute(relativePath)
  ) throw new Error(`${label} contains an unsafe path`);
  const parts = relativePath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[:<>"|?*]/.test(part))) {
    throw new Error(`${label} contains an unsafe path`);
  }
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...parts);
  const relative = path.relative(absoluteRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped its managed directory`);
  }
  return target;
}

function sameNamedIdentity(before, after) {
  return before.dev === after.dev && before.ino === after.ino;
}

async function assertNamedDirectory(directory, label) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} is not a regular managed directory`);
  }
  return stat;
}

async function acquireManagedDirectoryChain(directories, label) {
  const guards = [];
  try {
    for (const directory of directories) {
      const before = await assertNamedDirectory(directory, label);
      const guard = await acquireWindowsDirectoryGuard(directory);
      guards.push({ directory, guard, identity: before });
      guard.assertHeld();
      await assertWindowsFilesystemEntry(directory);
      const after = await assertNamedDirectory(directory, label);
      if (!sameNamedIdentity(before, after)) throw new Error(`${label} changed during verification`);
    }
    return {
      async assertHeld() {
        for (const item of guards) {
          item.guard.assertHeld();
          await assertWindowsFilesystemEntry(item.directory);
          const after = await assertNamedDirectory(item.directory, label);
          if (!sameNamedIdentity(item.identity, after)) throw new Error(`${label} changed during verification`);
        }
      },
      async release() {
        let failure = null;
        for (const item of guards.toReversed()) {
          try { await item.guard.release(); } catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
      },
    };
  } catch (error) {
    for (const item of guards.toReversed()) {
      try { await item.guard.release(); } catch { /* Preserve the acquisition failure. */ }
    }
    throw error;
  }
}

async function inspectManagedMinecraftServerJar(instance, target, inventory, options = {}) {
  const instanceDirectory = path.resolve(instance.directory);
  const instanceParent = path.dirname(instanceDirectory);
  const managedRoot = path.dirname(instanceParent);
  const versionsDirectory = path.join(instanceDirectory, 'versions');
  const versionDirectory = path.join(versionsDirectory, instance.minecraftVersion);
  if (path.dirname(target) !== versionDirectory || path.dirname(versionsDirectory) !== instanceDirectory) {
    throw new Error('Managed Minecraft server artifact escaped its pinned version directory');
  }
  if (options.nativeFilesystemGuards === false || (options.platform ?? process.platform) !== 'win32') {
    return inspectVerifiedMinecraftServerJar(target, inventory);
  }

  const chain = await acquireManagedDirectoryChain([
    managedRoot,
    instanceParent,
    instanceDirectory,
    versionsDirectory,
    versionDirectory,
  ], 'Managed Minecraft server artifact ancestor');
  let fileGuard;
  try {
    fileGuard = await acquireWindowsFileGuard(target);
    fileGuard.assertHeld();
    await assertWindowsFilesystemEntry(target);
    const verified = await inspectVerifiedMinecraftServerJar(target, inventory);
    fileGuard.assertHeld();
    await assertWindowsFilesystemEntry(target);
    await chain.assertHeld();
    return verified;
  } finally {
    let failure = null;
    if (fileGuard) {
      try { await fileGuard.release(); } catch (error) { failure = error; }
    }
    try { await chain.release(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  }
}

async function readSmallJson(file, maximumBytes, label) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumBytes) {
    throw new Error(`${label} is not a valid managed file`);
  }
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function boundedDirectoryEntries(directory, maximumEntries, label) {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 0) throw new TypeError('Invalid directory entry bound');
  const handle = await fs.opendir(directory);
  const entries = [];
  try {
    while (true) {
      const entry = await handle.read();
      if (!entry) break;
      if (entries.length >= maximumEntries) throw new Error(`${label} exceeded its safe entry bound`);
      entries.push(entry);
    }
    return entries;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function hashFile(file, algorithm, maximumBytes, expectedSize, label) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) {
    throw new Error(`${label} is not a regular managed file`);
  }
  if (Number.isInteger(expectedSize) && stat.size !== expectedSize) {
    throw new Error(`${label} size does not match its trusted manifest`);
  }
  const hash = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { digest: hash.digest('hex'), size: stat.size };
}

function stripYamlComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (character === '\\') index += 1;
      else if (character === '"') quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index);
  }
  return value;
}

function decodeYamlScalar(value, label) {
  const scalar = stripYamlComment(value).trim();
  if (!scalar) throw new Error(`${label} contains an empty policy value`);
  if (scalar.startsWith("'") || scalar.endsWith("'")) {
    if (!(scalar.startsWith("'") && scalar.endsWith("'") && scalar.length >= 2)) {
      throw new Error(`${label} contains an invalid quoted policy value`);
    }
    return scalar.slice(1, -1).replaceAll("''", "'");
  }
  if (scalar.startsWith('"') || scalar.endsWith('"')) {
    if (!(scalar.startsWith('"') && scalar.endsWith('"') && scalar.length >= 2)) {
      throw new Error(`${label} contains an invalid quoted policy value`);
    }
    try {
      const decoded = JSON.parse(scalar);
      if (typeof decoded !== 'string') throw new Error('not a string');
      return decoded;
    } catch {
      throw new Error(`${label} contains an invalid quoted policy value`);
    }
  }
  return scalar;
}

function parseYamlMappingScalars(text, label) {
  if (text.includes('\0')) throw new Error(`${label} contains a null byte`);
  const values = new Map();
  const seen = new Set();
  const parents = [];
  for (const [lineIndex, originalLine] of text.split(/\r?\n/).entries()) {
    if (!originalLine.trim() || originalLine.trimStart().startsWith('#')) continue;
    const indentation = originalLine.match(/^[ \t]*/u)?.[0] ?? '';
    if (indentation.includes('\t')) throw new Error(`${label} uses ambiguous tab indentation at line ${lineIndex + 1}`);
    const content = stripYamlComment(originalLine.slice(indentation.length)).trimEnd();
    if (!content || content.startsWith('-')) continue;
    const mapping = content.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u);
    if (!mapping) continue;
    const depth = indentation.length;
    while (parents.length && parents.at(-1).depth >= depth) parents.pop();
    const keyPath = [...parents.map((parent) => parent.key), mapping[1]].join('.');
    if (seen.has(keyPath)) throw new Error(`${label} contains duplicate mapping '${keyPath}'`);
    seen.add(keyPath);
    const scalar = stripYamlComment(mapping[2]).trim();
    if (!scalar) parents.push({ depth, key: mapping[1] });
    else values.set(keyPath, decodeYamlScalar(scalar, label));
  }
  return values;
}

function requireConfigValue(values, keyPath, expected, label) {
  const actual = values.get(keyPath);
  if (actual === undefined) throw new Error(`${label} must define '${keyPath}'`);
  if (actual.toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`${label} must keep '${keyPath}' set to '${expected}'`);
  }
}

function requireConfigInteger(values, keyPath, expected, label) {
  const actual = values.get(keyPath);
  if (actual === undefined) throw new Error(`${label} must define '${keyPath}'`);
  if (!/^(?:0|[1-9]\d*)$/u.test(actual) || Number(actual) !== expected) {
    throw new Error(`${label} must keep '${keyPath}' set to '${expected}'`);
  }
}

function verifyOptionalRemoteEndpoint(values, instance, label) {
  const candidates = [
    ['java.address', 'java.port'],
    ['remote.address', 'remote.port'],
  ];
  let endpointFound = false;
  for (const [addressPath, portPath] of candidates) {
    const address = values.get(addressPath);
    const port = values.get(portPath);
    if (address === undefined && port === undefined) continue;
    endpointFound = true;
    if (address === undefined || port === undefined) {
      throw new Error(`${label} must define both '${addressPath}' and '${portPath}'`);
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(address.toLowerCase())) {
      throw new Error(`${label} must keep '${addressPath}' on the local Java server`);
    }
    if (!/^(?:0|[1-9]\d*)$/u.test(port) || Number(port) !== instance.javaPort) {
      throw new Error(`${label} must keep '${portPath}' set to '${instance.javaPort}'`);
    }
  }
  return endpointFound;
}

async function verifyGeyserConfig(instance, target, trustedArtifact) {
  const label = `Managed artifact ${GEYSER_CONFIG_PATH}`;
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_GEYSER_CONFIG_BYTES) {
    throw new Error(`${label} is not a regular managed configuration file`);
  }
  const bytes = await fs.readFile(target);
  let text;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const values = parseYamlMappingScalars(text, label);
  requireConfigValue(values, 'bedrock.address', '0.0.0.0', label);
  requireConfigInteger(values, 'bedrock.port', instance.bedrockPort, label);
  requireConfigValue(values, 'bedrock.clone-remote-port', 'false', label);
  requireConfigValue(values, 'java.auth-type', 'floodgate', label);
  requireConfigInteger(values, 'advanced.bedrock.broadcast-port', 0, label);
  requireConfigValue(values, 'advanced.bedrock.validate-bedrock-login', 'true', label);
  const configVersion = values.get('config-version');
  if (!/^[1-9]\d*$/u.test(configVersion ?? '') || Number(configVersion) < 5) {
    throw new Error(`${label} must keep a supported positive 'config-version'`);
  }

  const pristineManagedSeed = stat.size === trustedArtifact.size
    && digest === trustedArtifact.sha256.toLowerCase();
  const endpointFound = verifyOptionalRemoteEndpoint(values, instance, label);
  const directConnection = values.get('advanced.java.use-direct-connection');
  if (directConnection !== undefined && directConnection.toLowerCase() !== 'true') {
    throw new Error(`${label} must keep 'advanced.java.use-direct-connection' set to 'true'`);
  }
  if (!pristineManagedSeed && directConnection === undefined && !endpointFound) {
    throw new Error(`${label} must define a safe local Java connection policy`);
  }
  return { digest, size: stat.size };
}

function assertInstanceManifest(instance, manifest) {
  if (
    manifest?.schemaVersion !== 3 || manifest.id !== instance.id
    || manifest.projectId !== 'family-server' || manifest.kind !== 'server'
    || manifest.minecraftVersion !== instance.minecraftVersion
    || manifest.loader !== 'fabric' || manifest.loaderVersion !== instance.loaderVersion
    || canonicalJson(manifest.javaRuntime) !== canonicalJson(instance.javaRuntime)
  ) throw new Error('Private instance manifest does not match the managed inventory');
}

function normalizeServerBinding(value, minecraftVersion, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.minecraftVersion !== minecraftVersion
    || value.relativePath !== minecraftServerRelativePath(minecraftVersion)
    || !Number.isInteger(value.size) || value.size < 1 || value.size > MAX_MANAGED_ARTIFACT_BYTES
    || !SHA1.test(value.sha1 ?? '') || !SHA256.test(value.sha256 ?? '')
    || !Number.isSafeInteger(value.worldDataVersion) || value.worldDataVersion < 1 || value.worldDataVersion > 0x7fffffff) {
    throw new Error(`${label} contains invalid Minecraft server compatibility metadata`);
  }
  return {
    minecraftVersion, relativePath: value.relativePath, size: value.size,
    sha1: value.sha1.toLowerCase(), sha256: value.sha256.toLowerCase(), worldDataVersion: value.worldDataVersion,
  };
}

async function verifyMinecraftServerCompatibility(instance, manifest, options = {}) {
  const fields = [
    Object.hasOwn(instance, 'worldDataVersion'), Object.hasOwn(instance, 'minecraftServerArtifact'),
    Object.hasOwn(manifest, 'worldDataVersion'), Object.hasOwn(manifest, 'minecraftServerArtifact'),
  ];
  if (fields.every((present) => !present)) return null;
  if (!fields.every(Boolean)) throw new Error('Minecraft server compatibility metadata is incomplete');
  const inventory = normalizeServerBinding(instance.minecraftServerArtifact, instance.minecraftVersion, 'Managed inventory');
  const privateBinding = normalizeServerBinding(manifest.minecraftServerArtifact, instance.minecraftVersion, 'Private instance manifest');
  if (instance.worldDataVersion !== inventory.worldDataVersion || manifest.worldDataVersion !== privateBinding.worldDataVersion
    || JSON.stringify(inventory) !== JSON.stringify(privateBinding)) {
    throw new Error('Private instance manifest disagrees with managed Minecraft server compatibility metadata');
  }
  const target = containedFile(instance.directory, inventory.relativePath, 'Managed Minecraft server artifact');
  const verified = await inspectManagedMinecraftServerJar(instance, target, inventory, options);
  if (Object.keys(inventory).some((key) => verified[key] !== inventory[key])) {
    throw new Error('Minecraft server compatibility metadata failed verification');
  }
  return verified;
}

async function verifyArtifacts(instance, manifest) {
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== REQUIRED_FAMILY_ARTIFACTS.length) {
    throw new Error('Private instance manifest does not contain the complete managed artifact set');
  }
  const entries = new Map();
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== 'object' || !REQUIRED_FAMILY_ARTIFACTS.includes(artifact.fileName)) {
      throw new Error('Private instance manifest contains an unknown managed artifact');
    }
    if (entries.has(artifact.fileName)) throw new Error('Private instance manifest contains a duplicate managed artifact');
    if (!SHA256.test(artifact.sha256 ?? '')) throw new Error('Private instance manifest contains an invalid artifact digest');
    if (artifact.size != null && (!Number.isInteger(artifact.size) || artifact.size < 1 || artifact.size > MAX_MANAGED_ARTIFACT_BYTES)) {
      throw new Error('Private instance manifest contains an invalid artifact size');
    }
    entries.set(artifact.fileName, artifact);
  }
  if (!Array.isArray(instance.artifacts) || instance.artifacts.length !== REQUIRED_FAMILY_ARTIFACTS.length) {
    throw new Error('Managed inventory does not contain the complete artifact trust set');
  }
  const inventoryEntries = new Map();
  for (const artifact of instance.artifacts) {
    if (
      !artifact || typeof artifact !== 'object' || !REQUIRED_FAMILY_ARTIFACTS.includes(artifact.fileName)
      || inventoryEntries.has(artifact.fileName) || !SHA256.test(artifact.sha256 ?? '')
      || !Number.isInteger(artifact.size) || artifact.size < 1 || artifact.size > MAX_MANAGED_ARTIFACT_BYTES
    ) throw new Error('Managed inventory contains invalid artifact trust metadata');
    inventoryEntries.set(artifact.fileName, artifact);
  }
  const verified = [];
  for (const relativePath of REQUIRED_FAMILY_ARTIFACTS) {
    const artifact = entries.get(relativePath);
    if (!artifact) throw new Error(`Private instance manifest omitted ${relativePath}`);
    const inventoryArtifact = inventoryEntries.get(relativePath);
    if (
      !inventoryArtifact || inventoryArtifact.sha256.toLowerCase() !== artifact.sha256.toLowerCase()
      || inventoryArtifact.size !== artifact.size
    ) throw new Error(`Private instance manifest disagrees with managed inventory for ${relativePath}`);
    const target = containedFile(instance.directory, relativePath, 'Managed artifact');
    if (!IMMUTABLE_FAMILY_ARTIFACTS.has(relativePath)) {
      const result = await verifyGeyserConfig(instance, target, artifact);
      verified.push({ relativePath, sha256: result.digest, size: result.size, runtimeMutable: true });
      continue;
    }
    const result = await hashFile(target, 'sha256', MAX_MANAGED_ARTIFACT_BYTES, artifact.size, `Managed artifact ${relativePath}`);
    if (result.digest !== artifact.sha256.toLowerCase()) {
      throw new Error(`Managed artifact ${relativePath} failed integrity verification`);
    }
    verified.push({ relativePath, sha256: result.digest, size: result.size });
  }
  return verified;
}

async function verifyExactTree(root, files, directories, allowedExtraFiles = new Set(), label = 'Managed tree') {
  if (!Array.isArray(files) || files.length > MAX_LAUNCH_FILES || !Array.isArray(directories) || directories.length > MAX_LAUNCH_FILES) {
    throw new Error(`${label} inventory exceeded its safe bound`);
  }
  const expectedFiles = new Map();
  const expectedDirectories = new Set();
  const canonicalNames = new Set();
  for (const entry of files) {
    const target = containedFile(root, entry.relativePath, `${label} file inventory`);
    const canonicalName = entry.relativePath.toLocaleLowerCase('en-US');
    if (canonicalNames.has(canonicalName) || !SHA256.test(entry.sha256 ?? '')
      || !Number.isInteger(entry.size) || entry.size < 0 || entry.size > MAX_MANAGED_ARTIFACT_BYTES) {
      throw new Error(`${label} inventory contains an invalid or duplicate file`);
    }
    canonicalNames.add(canonicalName);
    expectedFiles.set(entry.relativePath, { ...entry, target });
  }
  for (const relativePath of directories) {
    containedFile(root, `${relativePath}/.inventory-placeholder`, `${label} directory inventory`);
    const canonicalName = relativePath.toLocaleLowerCase('en-US');
    if (canonicalNames.has(canonicalName)) throw new Error(`${label} inventory contains an invalid or duplicate directory`);
    canonicalNames.add(canonicalName);
    expectedDirectories.add(relativePath);
  }
  const observedFiles = new Set();
  const observedDirectories = new Set();
  const queue = [{ directory: root, relativePath: '' }];
  let entries = 0;
  while (queue.length) {
    const current = queue.shift();
    const children = await boundedDirectoryEntries(
      current.directory,
      ((MAX_LAUNCH_FILES * 2) + allowedExtraFiles.size) - entries,
      label,
    );
    for (const child of children) {
      entries += 1;
      if (entries > (MAX_LAUNCH_FILES * 2) + allowedExtraFiles.size) throw new Error(`${label} exceeded its exact inventory bound`);
      const relativePath = current.relativePath ? `${current.relativePath}/${child.name}` : child.name;
      const target = containedFile(root, relativePath, label);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) throw new Error(`${label} contains a linked entry`);
      if (stat.isDirectory()) {
        if (!expectedDirectories.has(relativePath)) throw new Error(`${label} contains an unlisted directory: ${relativePath}`);
        observedDirectories.add(relativePath);
        queue.push({ directory: target, relativePath });
        continue;
      }
      if (allowedExtraFiles.has(relativePath)) {
        if (!stat.isFile() || stat.nlink !== 1) throw new Error(`${label} contains an unsafe metadata file`);
        continue;
      }
      const expected = expectedFiles.get(relativePath);
      if (!expected || !stat.isFile() || stat.nlink !== 1 || stat.size !== expected.size) {
        throw new Error(`${label} contains an unlisted or replaced file: ${relativePath}`);
      }
      const bytes = await fs.readFile(target);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected.sha256.toLowerCase()
        || (expected.sha1 && crypto.createHash('sha1').update(bytes).digest('hex') !== expected.sha1.toLowerCase())) {
        throw new Error(`${label} file failed integrity verification: ${relativePath}`);
      }
      observedFiles.add(relativePath);
    }
  }
  if (observedFiles.size !== expectedFiles.size || observedDirectories.size !== expectedDirectories.size) {
    throw new Error(`${label} does not match its exact inventory`);
  }
  return true;
}

async function verifyRuntime(instance, manifest) {
  if (typeof instance.javaExecutable !== 'string' || !path.isAbsolute(instance.javaExecutable)) {
    throw new Error('Managed instance has no absolute Java executable');
  }
  if (
    !instance.javaRuntime || instance.javaRuntime.managed !== true
    || !SHA1.test(instance.javaRuntime.binarySha1 ?? '')
    || !Number.isInteger(instance.javaRuntime.binarySize) || instance.javaRuntime.binarySize < 1
  ) {
    throw new Error('Managed instance has no verified Mojang Java runtime metadata');
  }
  if (manifest.javaExecutable !== instance.javaExecutable) {
    throw new Error('Private instance manifest and inventory disagree about the Java executable');
  }
  const managedRoot = path.dirname(path.dirname(path.resolve(instance.directory)));
  const runtimeRoot = path.join(managedRoot, 'runtimes');
  const executable = path.resolve(instance.javaExecutable);
  const relativeExecutable = path.relative(runtimeRoot, executable);
  if (!relativeExecutable || relativeExecutable === '..' || relativeExecutable.startsWith(`..${path.sep}`) || path.isAbsolute(relativeExecutable)) {
    throw new Error('Java executable is outside the managed runtime directory');
  }
  const runtimeDirectory = path.dirname(path.dirname(executable));
  const marker = await readSmallJson(path.join(runtimeDirectory, 'runtime.json'), MAX_RUNTIME_MARKER_BYTES, 'Managed Java runtime marker');
  if (
    ![1, 2].includes(marker?.schemaVersion) || marker.managed !== true || marker.executableRelativePath !== 'bin/java.exe'
    || marker.component !== instance.javaRuntime.component || marker.major !== instance.javaRuntime.major
    || marker.version !== instance.javaRuntime.version || marker.platform !== instance.javaRuntime.platform
    || marker.manifestSha1 !== instance.javaRuntime.manifestSha1
    || marker.executableSha1 !== instance.javaRuntime.binarySha1
    || marker.executableSize !== instance.javaRuntime.binarySize
    || !SHA1.test(marker.executableSha1 ?? '')
    || !Number.isInteger(marker.executableSize) || marker.executableSize < 1
    || path.resolve(runtimeDirectory, 'bin', 'java.exe') !== executable
  ) throw new Error('Managed Java runtime marker does not match the instance');
  if (marker.schemaVersion === 2) {
    if (!SHA256.test(marker.inventorySha256 ?? '') || !Array.isArray(marker.files) || !Array.isArray(marker.directories)
      || marker.files.length < 1 || marker.files.length > MAX_LAUNCH_FILES || marker.directories.length > MAX_LAUNCH_FILES
      || instance.javaRuntime.inventorySha256 !== marker.inventorySha256
      || instance.javaRuntime.inventoryFileCount !== marker.files.length) {
      throw new Error('Managed Java runtime marker omitted its complete file inventory');
    }
    const files = marker.files.map((entry) => {
      containedFile(runtimeDirectory, entry?.relativePath, 'Managed Java runtime inventory');
      if (entry?.type !== 'file' || !SHA1.test(entry.sha1 ?? '') || !SHA256.test(entry.sha256 ?? '')
        || !Number.isInteger(entry.size) || entry.size < 0 || entry.size > MAX_MANAGED_ARTIFACT_BYTES) {
        throw new Error('Managed Java runtime marker contains an invalid file inventory');
      }
      return { relativePath: entry.relativePath, type: 'file', sha1: entry.sha1, sha256: entry.sha256, size: entry.size };
    });
    const directories = marker.directories.map((relativePath) => {
      containedFile(runtimeDirectory, `${relativePath}/.inventory-placeholder`, 'Managed Java runtime directory inventory');
      return relativePath;
    });
    const inventoryDigest = crypto.createHash('sha256').update(canonicalJson({ directories, files }), 'utf8').digest('hex');
    if (inventoryDigest !== marker.inventorySha256) throw new Error('Managed Java runtime marker inventory digest is invalid');
    await verifyExactTree(runtimeDirectory, files, directories, new Set(['runtime.json']), 'Managed Java runtime');
  }
  const result = await hashFile(executable, 'sha1', MAX_MANAGED_ARTIFACT_BYTES, marker.executableSize, 'Managed Java executable');
  if (result.digest !== marker.executableSha1.toLowerCase()) {
    throw new Error('Managed Java executable failed integrity verification');
  }
  return {
    component: marker.component, major: marker.major, version: marker.version, executableSha1: result.digest,
    marker, runtimeDirectory, executable,
  };
}

function directoryInventoryForFiles(files) {
  const directories = new Set();
  for (const entry of files) {
    let parent = path.posix.dirname(entry.relativePath);
    while (parent && parent !== '.') {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  return [...directories].sort((left, right) => left.localeCompare(right, 'en-US'));
}

function safeLaunchStatePath(managedRoot, relativePath, label) {
  const target = containedFile(managedRoot, relativePath, label);
  const relative = path.relative(path.resolve(managedRoot, 'state'), target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside authenticated launch state`);
  }
  return target;
}

function exactObjectKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function exactKeysFromChoices(value, choices) {
  return choices.some((keys) => exactObjectKeys(value, keys));
}

function assertExactLaunchInventorySchema(inventory) {
  if (!exactObjectKeys(inventory, [
    'schemaVersion', 'instanceId', 'stack', 'runtime', 'launchAssets', 'instanceFiles', 'exactMutableTrees',
  ]) || !exactObjectKeys(inventory.stack, [
    'projectId', 'kind', 'minecraftVersion', 'loaderVersion', 'installerVersion', 'minecraftServerArtifact',
    'components', 'runtime', 'launchAssetDigest',
  ]) || !exactObjectKeys(inventory.stack.minecraftServerArtifact, [
    'minecraftVersion', 'relativePath', 'size', 'sha1', 'sha256', 'worldDataVersion',
  ]) || !exactObjectKeys(inventory.stack.runtime, [
    'component', 'major', 'version', 'platform', 'manifestSha1', 'inventorySha256',
  ]) || !exactObjectKeys(inventory.runtime, [
    'relativeRoot', 'executableRelativePath', 'inventorySha256', 'files', 'directories',
  ]) || !exactObjectKeys(inventory.launchAssets, [
    'schemaVersion', 'digest', 'relativeRoot', 'mainClass', 'fabricClasspath', 'gameJar', 'gameLibraries',
    'files', 'fabricMetadataSha256', 'outerServerSha256',
  ]) || !exactObjectKeys(inventory.exactMutableTrees, ['mods', 'libraries', 'fabric', 'versions'])) {
    throw new Error('Authenticated launch inventory contains an unexpected schema field');
  }
  const components = inventory.stack.components;
  if (!exactObjectKeys(components, ['fabricApi', 'geyser', 'floodgate'])) {
    throw new Error('Authenticated launch inventory component schema is invalid');
  }
  for (const component of Object.values(components)) {
    if (!exactObjectKeys(component, ['versionId', 'versionNumber', 'versionType', 'sourceHash'])
      || !exactObjectKeys(component.sourceHash, ['algorithm', 'value'])) {
      throw new Error('Authenticated launch inventory component schema is invalid');
    }
  }
  if (!Array.isArray(inventory.runtime.files)
    || inventory.runtime.files.some((entry) => !exactObjectKeys(entry, ['relativePath', 'sha1', 'sha256', 'size']))
    || !Array.isArray(inventory.runtime.directories)
    || !Array.isArray(inventory.launchAssets.files)
    || inventory.launchAssets.files.some((entry) => !exactKeysFromChoices(entry, [
      ['relativePath', 'sha256', 'size'],
      ['relativePath', 'sha256', 'size', 'coordinate'],
      ['relativePath', 'sha256', 'size', 'role'],
      ['relativePath', 'sha256', 'size', 'coordinate', 'role'],
    ]))
    || !Array.isArray(inventory.instanceFiles)
    || inventory.instanceFiles.some((entry) => !exactObjectKeys(entry, ['relativePath', 'sha256', 'size']))) {
    throw new Error('Authenticated launch inventory file schema is invalid');
  }
}

async function readAuthenticatedLaunchInventory(instance, manifest, runtime, options = {}) {
  const digest = instance.javaRuntime?.launchInventoryDigest;
  if (digest == null) return null;
  if (!SHA256.test(digest) || manifest.javaRuntime?.launchInventoryDigest !== digest
    || instance.javaRuntime?.launchAssetDigest !== manifest.javaRuntime?.launchAssetDigest) {
    throw new Error('Managed instance launch inventory binding is invalid');
  }
  const managedRoot = path.dirname(path.dirname(path.resolve(instance.directory)));
  const inventoryFile = path.join(managedRoot, 'state', 'launch-inventories', `${digest}.json`);
  const keyLease = await acquireLaunchIntegrityKey(managedRoot, {
    ...(options.integrityKeyOptions ?? {}),
    platform: options.nativeFilesystemGuards === false ? 'linux' : (options.platform ?? process.platform),
    createIfMissing: false,
  });
  const { key, keyFile } = keyLease;
  try {
    await keyLease.assertHeld();
  const inventoryStat = await fs.lstat(inventoryFile);
  if (!inventoryStat.isFile() || inventoryStat.isSymbolicLink() || inventoryStat.nlink !== 1
    || inventoryStat.size < 2 || inventoryStat.size > MAX_LAUNCH_INVENTORY_BYTES) {
    throw new Error('Authenticated launch inventory is not a valid managed file');
  }
  const inventoryBytes = await fs.readFile(inventoryFile);
  let wrapper;
  try { wrapper = JSON.parse(inventoryBytes.toString('utf8')); }
  catch { throw new Error('Authenticated launch inventory is not valid JSON'); }
  if (!exactObjectKeys(wrapper, ['schemaVersion', 'inventory', 'mac']) || wrapper.schemaVersion !== 1 || !SHA256.test(wrapper.mac ?? '')) {
    throw new Error('Authenticated launch inventory wrapper is invalid');
  }
  assertExactLaunchInventorySchema(wrapper.inventory);
  const encoded = Buffer.from(canonicalJson(wrapper.inventory), 'utf8');
  if (crypto.createHash('sha256').update(encoded).digest('hex') !== digest) throw new Error('Launch inventory digest does not match its identity');
  const expectedMac = crypto.createHmac('sha256', key).update(encoded).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expectedMac, 'hex'), Buffer.from(wrapper.mac, 'hex'))) {
    throw new Error('Launch inventory authentication failed');
  }
  const inventory = wrapper.inventory;
  if (inventory?.schemaVersion !== 1 || inventory.instanceId !== instance.id
    || inventory.stack?.projectId !== 'family-server' || inventory.stack?.kind !== 'server'
    || inventory.stack?.minecraftVersion !== instance.minecraftVersion
    || inventory.stack?.loaderVersion !== instance.loaderVersion
    || inventory.stack?.installerVersion !== instance.installerVersion
    || canonicalJson(inventory.stack?.minecraftServerArtifact) !== canonicalJson(instance.minecraftServerArtifact)
    || canonicalJson(inventory.stack?.components) !== canonicalJson(instance.components)
    || inventory.stack?.launchAssetDigest !== instance.javaRuntime.launchAssetDigest
    || canonicalJson(inventory.stack?.runtime) !== canonicalJson({
      component: instance.javaRuntime.component,
      major: instance.javaRuntime.major,
      version: instance.javaRuntime.version,
      platform: instance.javaRuntime.platform,
      manifestSha1: instance.javaRuntime.manifestSha1,
      inventorySha256: instance.javaRuntime.inventorySha256,
    })
    || inventory.runtime?.inventorySha256 !== runtime.marker.inventorySha256
    || inventory.runtime?.relativeRoot !== path.relative(managedRoot, runtime.runtimeDirectory).split(path.sep).join('/')
    || inventory.runtime?.executableRelativePath !== 'bin/java.exe'
    || canonicalJson(inventory.runtime?.files) !== canonicalJson(runtime.marker.files.map((entry) => ({
      relativePath: entry.relativePath, sha1: entry.sha1, sha256: entry.sha256, size: entry.size,
    })))
    || canonicalJson(inventory.runtime?.directories) !== canonicalJson(runtime.marker.directories)
    || inventory.exactMutableTrees.mods !== 'authenticated-family-mod-manifest-plus-core-only'
    || inventory.exactMutableTrees.libraries !== 'absent' || inventory.exactMutableTrees.fabric !== 'absent'
    || !Array.isArray(inventory.exactMutableTrees.versions) || inventory.exactMutableTrees.versions.length !== 1
    || inventory.exactMutableTrees.versions[0] !== instance.minecraftServerArtifact.relativePath) {
    throw new Error('Authenticated launch inventory was replayed against a different instance or stack');
  }
  const launchAssets = inventory.launchAssets;
  if (launchAssets?.schemaVersion !== 1 || launchAssets.digest !== instance.javaRuntime.launchAssetDigest
    || launchAssets.relativeRoot !== `state/launch-artifacts/${launchAssets.digest}`
    || !Array.isArray(launchAssets.files) || launchAssets.files.length < 1 || launchAssets.files.length > MAX_LAUNCH_FILES
    || !SHA256.test(launchAssets.fabricMetadataSha256 ?? '') || !SHA256.test(launchAssets.outerServerSha256 ?? '')
    || launchAssets.outerServerSha256.toLowerCase() !== instance.minecraftServerArtifact.sha256.toLowerCase()
    || typeof launchAssets.mainClass !== 'string'
    || !/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)+[A-Za-z_$][A-Za-z0-9_$]*$/.test(launchAssets.mainClass)
    || !Array.isArray(launchAssets.fabricClasspath) || launchAssets.fabricClasspath.length < 1
    || !Array.isArray(launchAssets.gameLibraries) || typeof launchAssets.gameJar !== 'string') {
    throw new Error('Authenticated launch asset inventory is invalid');
  }
  const launchAssetIdentity = {
    schemaVersion: 1,
    minecraftVersion: instance.minecraftVersion,
    loaderVersion: instance.loaderVersion,
    fabricMetadataSha256: launchAssets.fabricMetadataSha256,
    mainClass: launchAssets.mainClass,
    outerServerSha256: launchAssets.outerServerSha256,
    files: launchAssets.files,
  };
  if (crypto.createHash('sha256').update(canonicalJson(launchAssetIdentity), 'utf8').digest('hex') !== launchAssets.digest) {
    throw new Error('Authenticated launch asset identity is invalid');
  }
  const assetRoot = safeLaunchStatePath(managedRoot, launchAssets.relativeRoot, 'Launch asset root');
  await verifyExactTree(assetRoot, launchAssets.files, directoryInventoryForFiles(launchAssets.files), new Set(), 'Launch asset tree');
  const assetFiles = new Map(launchAssets.files.map((entry) => [entry.relativePath, entry]));
  const commandAssetPaths = [...launchAssets.fabricClasspath, launchAssets.gameJar, ...launchAssets.gameLibraries];
  if (new Set(commandAssetPaths).size !== commandAssetPaths.length
    || commandAssetPaths.some((relativePath) => !assetFiles.has(relativePath))) {
    throw new Error('Launch command references an unlisted classpath input');
  }
  if (!Array.isArray(inventory.instanceFiles) || inventory.instanceFiles.length !== 5) {
    throw new Error('Launch inventory omitted the exact instance executable inputs');
  }
  const expectedInstanceFiles = new Set([
    'fabric-server-launch.jar', 'mods/fabric-api.jar', 'mods/geyser-fabric.jar', 'mods/floodgate-fabric.jar',
    instance.minecraftServerArtifact.relativePath,
  ]);
  for (const entry of inventory.instanceFiles) {
    if (!expectedInstanceFiles.delete(entry.relativePath) || !SHA256.test(entry.sha256 ?? '')
      || !Number.isInteger(entry.size) || entry.size < 1) throw new Error('Launch inventory contains an unlisted instance executable input');
    const result = await hashFile(containedFile(instance.directory, entry.relativePath, 'Launch instance input'), 'sha256',
      MAX_MANAGED_ARTIFACT_BYTES, entry.size, `Launch instance input ${entry.relativePath}`);
    if (result.digest !== entry.sha256.toLowerCase()) throw new Error(`Launch instance input failed verification: ${entry.relativePath}`);
  }
  if (expectedInstanceFiles.size !== 0) throw new Error('Launch inventory omitted an instance executable input');
  for (const absent of ['.fabric', 'libraries']) {
    try {
      await fs.lstat(path.join(instance.directory, absent));
      throw new Error(`Unlisted executable namespace '${absent}' is present`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const versionRelative = instance.minecraftServerArtifact.relativePath.slice('versions/'.length);
  await verifyExactTree(path.join(instance.directory, 'versions'), [{
    relativePath: versionRelative,
    sha256: instance.minecraftServerArtifact.sha256,
    size: instance.minecraftServerArtifact.size,
  }], [path.posix.dirname(versionRelative)], new Set(), 'Managed versions tree');
  await keyLease.assertHeld();
  return {
    digest, inventory, key, keyFile, inventoryFile, managedRoot, assetRoot, assetFiles,
    keyLease,
    inventoryFileSha256: crypto.createHash('sha256').update(inventoryBytes).digest('hex'),
    inventoryFileSize: inventoryBytes.length,
  };
  } catch (error) {
    await keyLease.release().catch(() => undefined);
    throw error;
  }
}

async function authenticatedManagedMods(instance, capability) {
  if (!capability || typeof capability !== 'object' || typeof capability.assertHeld !== 'function'
    || typeof capability.release !== 'function') {
    throw launchTrustUnavailable('The authenticated mod launch binding is unavailable');
  }
  await capability.assertHeld();
  const binding = capability.binding;
  if (!exactObjectKeys(binding, ['schemaVersion', 'instanceId', 'generation', 'inventoryDigest', 'mods'])
    || binding.schemaVersion !== 1 || binding.instanceId !== instance.id || !SHA256.test(binding.generation ?? '')
    || !SHA256.test(binding.inventoryDigest ?? '') || !Array.isArray(binding.mods) || binding.mods.length > MAX_MODS) {
    throw launchTrustUnavailable('The authenticated mod launch binding is invalid');
  }
  const names = new Set();
  return binding.mods.map((entry) => {
    if (!exactObjectKeys(entry, ['fileName', 'sha512', 'size'])) {
      throw launchTrustUnavailable('The authenticated mod launch binding contains an invalid entry');
    }
    if (!SAFE_MANAGED_MOD.test(entry?.fileName ?? '') || names.has(entry.fileName.toLocaleLowerCase('en-US'))
      || !SHA512.test(entry.sha512 ?? '') || !Number.isInteger(entry.size) || entry.size < 1
      || entry.size > MAX_MANAGED_ARTIFACT_BYTES) throw launchTrustUnavailable('The authenticated mod launch binding contains an invalid entry');
    names.add(entry.fileName.toLocaleLowerCase('en-US'));
    return { fileName: entry.fileName, sha512: entry.sha512.toLowerCase(), size: entry.size };
  });
}

async function verifiedEffectiveMods(instance, launch, modCapability) {
  const managed = await authenticatedManagedMods(instance, modCapability);
  const core = launch.inventory.instanceFiles
    .filter((entry) => entry.relativePath.startsWith('mods/'))
    .map((entry) => ({ fileName: path.posix.basename(entry.relativePath), sha256: entry.sha256, size: entry.size }));
  const expected = new Map([...core, ...managed].map((entry) => [entry.fileName, entry]));
  const directory = path.join(instance.directory, 'mods');
  const children = await boundedDirectoryEntries(directory, expected.size, 'Mods directory');
  if (children.length !== expected.size) throw new Error('Mods directory contains an unlisted executable input');
  for (const child of children) {
    const entry = expected.get(child.name);
    const target = path.join(directory, child.name);
    const stat = await fs.lstat(target);
    if (!entry || !child.isFile() || child.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size !== entry.size) {
      throw new Error(`Mods directory contains an unsafe or unlisted executable input: ${child.name}`);
    }
    const algorithm = entry.sha512 ? 'sha512' : 'sha256';
    const result = await hashFile(target, algorithm, MAX_MANAGED_ARTIFACT_BYTES, entry.size, `Effective mod ${child.name}`);
    if (result.digest !== entry[algorithm]) throw new Error(`Effective mod failed integrity verification: ${child.name}`);
  }
  return [...expected].map(([fileName, entry]) => ({ fileName, ...entry }));
}

async function manifestClassPath(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 22 || stat.size > MAX_MANAGED_ARTIFACT_BYTES) {
    throw new Error(`Launch JAR is not a regular bounded archive: ${path.basename(file)}`);
  }
  const bytes = await fs.readFile(file);
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= searchStart; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50
      && index + 22 + bytes.readUInt16LE(index + 20) === bytes.length) { eocd = index; break; }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0
    || bytes.readUInt16LE(eocd + 8) !== bytes.readUInt16LE(eocd + 10)) {
    throw new Error(`Launch JAR has an unsupported archive layout: ${path.basename(file)}`);
  }
  const count = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (count < 1 || count > 50_000 || centralOffset + centralSize !== eocd) {
    throw new Error(`Launch JAR central directory is invalid: ${path.basename(file)}`);
  }
  let cursor = centralOffset;
  let manifest = null;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Launch JAR central directory is malformed');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || (flags & 1) !== 0 || ![0, 8].includes(method)
      || [compressedSize, size, localOffset].includes(0xffffffff) || size > MAX_MANAGED_ARTIFACT_BYTES) {
      throw new Error(`Launch JAR contains an unsafe archive entry: ${path.basename(file)}`);
    }
    let name;
    try { name = UTF8_DECODER.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); }
    catch { throw new Error('Launch JAR contains an invalid entry name'); }
    if (name.toLocaleLowerCase('en-US') === 'meta-inf/manifest.mf') {
      if (name !== 'META-INF/MANIFEST.MF' || manifest) throw new Error('Launch JAR contains ambiguous manifest metadata');
      if (size > MAX_LAUNCH_JAR_MANIFEST_BYTES) throw new Error('Launch JAR manifest exceeded its safe limit');
      if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Launch JAR manifest local entry is malformed');
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      if (dataOffset + compressedSize > centralOffset) throw new Error('Launch JAR manifest overlaps archive metadata');
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
      try {
        manifest = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_LAUNCH_JAR_MANIFEST_BYTES });
      } catch { throw new Error('Launch JAR manifest could not be decompressed safely'); }
      if (manifest.length !== size) throw new Error('Launch JAR manifest size is invalid');
    }
    cursor = end;
  }
  if (cursor !== eocd || !manifest) return [];
  let text;
  try { text = UTF8_DECODER.decode(manifest); } catch { throw new Error('Launch JAR manifest is not valid UTF-8'); }
  const unfolded = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith(' ')) {
      if (unfolded.length === 0) throw new Error('Launch JAR manifest begins with an invalid continuation');
      unfolded[unfolded.length - 1] += line.slice(1);
    } else unfolded.push(line);
  }
  const values = unfolded.filter((line) => /^class-path\s*:/iu.test(line));
  if (values.length > 1) throw new Error('Launch JAR contains duplicate Class-Path metadata');
  if (values.length === 0) return [];
  return values[0].slice(values[0].indexOf(':') + 1).trim().split(/ +/u).filter(Boolean);
}

async function verifyManifestClassPaths(files) {
  const approved = new Set(files.map((file) => path.resolve(file).toLocaleLowerCase('en-US')));
  for (const file of files) {
    if (path.extname(file).toLowerCase() !== '.jar') continue;
    for (const reference of await manifestClassPath(file)) {
      if (!reference || reference.includes('\\') || reference.includes('\0') || reference.includes('%')
        || reference.includes('?') || reference.includes('#') || reference.includes(':') || reference.startsWith('/')) {
        throw new Error(`Launch JAR contains an unsafe manifest Class-Path reference: ${reference || '<empty>'}`);
      }
      const parts = reference.split('/');
      if (parts.some((part) => !part || part === '.' || part === '..')) {
        throw new Error(`Launch JAR contains a traversing manifest Class-Path reference: ${reference}`);
      }
      const target = path.resolve(path.dirname(file), ...parts).toLocaleLowerCase('en-US');
      if (!approved.has(target)) throw new Error(`Launch JAR contains an unlisted manifest Class-Path input: ${reference}`);
    }
  }
}

export const __test = Object.freeze({ manifestClassPath, verifyManifestClassPaths });

async function assertNativeLaunchMetadata(instance, launch, options) {
  const platform = options.platform ?? process.platform;
  if (options.nativeFilesystemGuards === false || platform !== 'win32') return;
  const runtimeRoot = containedFile(launch.managedRoot, `${launch.inventory.runtime.relativeRoot}/runtime.json`, 'Runtime root anchor');
  await assertWindowsFilesystemTree(path.dirname(runtimeRoot));
  await assertWindowsFilesystemTree(launch.assetRoot);
  await assertWindowsFilesystemTree(path.join(instance.directory, 'mods'), { maxEntries: 500, maxDepth: 1 });
  await assertWindowsFilesystemTree(path.join(instance.directory, 'versions'), { maxEntries: 16, maxDepth: 2 });
  for (const file of [launch.keyFile, launch.inventoryFile, path.join(instance.directory, 'instance.json'),
    path.join(instance.directory, 'fabric-server-launch.jar')]) await assertWindowsFilesystemEntry(file);
}

async function createLaunchSession(instance, launch, mods, modBinding) {
  const parent = path.join(launch.managedRoot, 'state', 'launch-sessions');
  const session = path.join(parent, `${instance.id}-${crypto.randomUUID()}`);
  const modsDirectory = path.join(session, 'mods');
  await fs.mkdir(modsDirectory, { recursive: true, mode: 0o700 });
  const copiedMods = [];
  try {
    for (const mod of mods) {
      const source = path.join(instance.directory, 'mods', mod.fileName);
      const destination = path.join(modsDirectory, mod.fileName);
      const bytes = await fs.readFile(source);
      const algorithm = mod.sha512 ? 'sha512' : 'sha256';
      if (bytes.length !== mod.size || crypto.createHash(algorithm).update(bytes).digest('hex') !== mod[algorithm]) {
        throw new Error(`Effective mod changed during launch snapshot: ${mod.fileName}`);
      }
      await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o400 });
      copiedMods.push({ relativePath: mod.fileName, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
    }
    const modsList = path.join(session, 'mods.list');
    const gameLibrariesList = path.join(session, 'game-libraries.list');
    const modsListBytes = Buffer.from(`${copiedMods.map((entry) => path.join(modsDirectory, entry.relativePath)).join('\n')}\n`, 'utf8');
    await fs.writeFile(modsList, modsListBytes, { flag: 'wx', mode: 0o400 });
    const gameLibraries = launch.inventory.launchAssets.gameLibraries.map((relativePath) => path.join(launch.assetRoot, ...relativePath.split('/')));
    const gameLibrariesBytes = Buffer.from(gameLibraries.length ? `${gameLibraries.join('\n')}\n` : '', 'utf8');
    await fs.writeFile(gameLibrariesList, gameLibrariesBytes, { flag: 'wx', mode: 0o400 });
    const effectiveInventory = {
      schemaVersion: 1,
      instanceId: instance.id,
      sessionId: path.basename(session),
      baseLaunchInventoryDigest: launch.digest,
      stack: launch.inventory.stack,
      modBinding,
      mods: copiedMods,
      commandFiles: {
        modsList: { sha256: crypto.createHash('sha256').update(modsListBytes).digest('hex'), size: modsListBytes.length },
        gameLibrariesList: { sha256: crypto.createHash('sha256').update(gameLibrariesBytes).digest('hex'), size: gameLibrariesBytes.length },
      },
    };
    const encoded = Buffer.from(canonicalJson(effectiveInventory), 'utf8');
    const effectiveInventoryDigest = crypto.createHash('sha256').update(encoded).digest('hex');
    const effectiveInventoryFile = path.join(session, 'effective-launch-inventory.json');
    const effectiveInventoryBytes = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      inventory: effectiveInventory,
      mac: crypto.createHmac('sha256', launch.key).update(encoded).digest('hex'),
    }), 'utf8');
    await fs.writeFile(effectiveInventoryFile, effectiveInventoryBytes, { flag: 'wx', mode: 0o400 });
    return {
      session, modsDirectory, modsList, gameLibrariesList, copiedMods,
      effectiveInventory, effectiveInventoryDigest, effectiveInventoryFile,
      effectiveInventoryFileSha256: crypto.createHash('sha256').update(effectiveInventoryBytes).digest('hex'),
      effectiveInventoryFileSize: effectiveInventoryBytes.length,
    };
  } catch (error) {
    await fs.rm(session, { recursive: true, force: true });
    throw error;
  }
}

async function acquireLaunchLease(instance, launch, session, commandInputs, externalLeases, postSealLeases, options) {
  const guards = [];
  const leases = [...externalLeases];
  let released = false;
  const platform = options.platform ?? process.platform;
  try {
    for (const lease of leases) await lease.assertHeld();
    const inputs = new Map();
    for (const input of commandInputs) {
      const file = path.resolve(input.file);
      const previous = inputs.get(file);
      if ((input.sha256 != null && !SHA256.test(input.sha256)) || (input.size != null && (!Number.isInteger(input.size) || input.size < 0))) {
        throw new Error('Launch lease contains invalid expected file metadata');
      }
      if (previous && (previous.sha256 !== input.sha256 || previous.size !== input.size)) {
        throw new Error('Launch lease contains conflicting file metadata');
      }
      inputs.set(file, { file, sha256: input.sha256 ?? null, size: input.size ?? null });
    }
    const uniqueFiles = [...inputs.keys()];
    if (options.nativeFilesystemGuards !== false && platform === 'win32') {
      for (let index = 0; index < uniqueFiles.length; index += 256) {
        const batch = await acquireWindowsFileGuard.batch(uniqueFiles.slice(index, index + 256), { readCompatible: true });
        for (const guard of batch) guard.assertHeld();
        guards.push(...batch);
      }
    }
    const baselines = new Map();
    for (const file of uniqueFiles) {
      const stat = await fs.lstat(file);
      const expected = inputs.get(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_MANAGED_ARTIFACT_BYTES) {
        throw new Error('A launch input cannot be leased as a regular file');
      }
      const bytes = await fs.readFile(file);
      const actual = { size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
      if ((expected.size !== null && actual.size !== expected.size)
        || (expected.sha256 !== null && actual.sha256 !== expected.sha256.toLowerCase())) {
        throw new Error('A launch input changed before its lease was acquired');
      }
      baselines.set(file, actual);
    }
    const assertHeld = async () => {
      if (released) throw new Error('Launch capability was already released');
      for (const guard of guards) guard.assertHeld();
      // Mutable source capabilities are asserted before their exact inputs are
      // copied, hashed, and natively guarded. Reopening those source trees after
      // sealing self-locks on Windows and is unnecessary: the command consumes
      // only the sealed snapshot. Long-lived continuity leases still reassert.
      for (const external of postSealLeases) await external.assertHeld();
      const key = await fs.readFile(launch.keyFile);
      if (key.length !== launch.key.length || !crypto.timingSafeEqual(key, launch.key)) throw new Error('Launch integrity key changed while leased');
      const wrapper = await readSmallJson(session.effectiveInventoryFile, MAX_LAUNCH_INVENTORY_BYTES, 'Effective launch inventory');
      const encoded = Buffer.from(canonicalJson(wrapper.inventory), 'utf8');
      const mac = crypto.createHmac('sha256', launch.key).update(encoded).digest('hex');
      if (!exactObjectKeys(wrapper, ['schemaVersion', 'inventory', 'mac']) || wrapper.schemaVersion !== 1
        || wrapper.inventory?.instanceId !== instance.id || wrapper.inventory?.baseLaunchInventoryDigest !== launch.digest
        || crypto.createHash('sha256').update(encoded).digest('hex') !== session.effectiveInventoryDigest
        || !SHA256.test(wrapper.mac ?? '')
        || !crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(wrapper.mac, 'hex'))) {
        throw new Error('Effective launch inventory authentication changed while leased');
      }
      await verifyExactTree(session.modsDirectory, session.copiedMods, [], new Set(), 'Launch mod snapshot');
      for (const file of uniqueFiles) {
        const stat = await fs.lstat(file);
        const baseline = baselines.get(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== baseline.size) {
          throw new Error('A leased launch input changed before spawn');
        }
        const bytes = await fs.readFile(file);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== baseline.sha256) {
          throw new Error('A leased launch input changed before spawn');
        }
      }
      return true;
    };
    return {
      assertHeld,
      withHeldDirectoryGuards(operation) {
        if (released || typeof operation !== 'function') throw new Error('Launch capability is unavailable');
        return typeof launch.keyLease.withHeldDirectoryGuards === 'function'
          ? launch.keyLease.withHeldDirectoryGuards(operation)
          : operation();
      },
      async release() {
        if (released) return;
        released = true;
        let failure = null;
        for (const guard of guards.toReversed()) {
          try { await guard.release(); } catch (error) { failure ??= error; }
        }
        try { await fs.rm(session.session, { recursive: true, force: true }); } catch (error) { failure ??= error; }
        for (const external of leases.toReversed()) {
          try { await external.release(); } catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
      },
    };
  } catch (error) {
    for (const guard of guards.toReversed()) {
      try { await guard.release(); } catch { /* Preserve acquisition failure. */ }
    }
    await fs.rm(session.session, { recursive: true, force: true });
    for (const external of leases.toReversed()) await external.release().catch(() => undefined);
    throw error;
  }
}

async function createLaunchCapability(instance, manifest, runtime, launch, options) {
  const suppliedModCapability = options.modLaunchBinding;
  const modCapability = suppliedModCapability && typeof launch.keyLease?.withHeldDirectoryGuards === 'function'
    ? {
      binding: suppliedModCapability.binding,
      assertHeld: () => launch.keyLease.withHeldDirectoryGuards(() => suppliedModCapability.assertHeld()),
      release: () => suppliedModCapability.release(),
    }
    : suppliedModCapability;
  const externalLeases = [launch.keyLease, modCapability].filter(Boolean);
  let session = null;
  let lease = null;
  let stage = 'windows-policy';
  try {
    const platform = options.platform ?? process.platform;
    if (platform === 'win32' && options.windowsModDiscoveryPolicy !== WINDOWS_MOD_DISCOVERY_POLICY) {
      throw launchTrustUnavailable(
        'Fabric Loader 0.19.3 always scans fabric.modsFolder, but the current Windows guard cannot prevent same-user child creation; launch is fail-closed.',
      );
    }
    stage = 'mod-inventory';
    const mods = await verifiedEffectiveMods(instance, launch, modCapability);
    stage = 'native-metadata';
    await assertNativeLaunchMetadata(instance, launch, options);
    stage = 'launch-session';
    session = await createLaunchSession(instance, launch, mods, structuredClone(modCapability.binding));
    const runtimeExecutable = path.join(runtime.runtimeDirectory, 'bin', 'java.exe');
    const assets = launch.inventory.launchAssets;
    const fabricClasspath = assets.fabricClasspath.map((relativePath) => path.join(launch.assetRoot, ...relativePath.split('/')));
    const gameJar = path.join(launch.assetRoot, ...assets.gameJar.split('/'));
    const assetInputs = assets.files.map((entry) => ({
      file: path.join(launch.assetRoot, ...entry.relativePath.split('/')), sha256: entry.sha256, size: entry.size,
    }));
    const instanceInputs = launch.inventory.instanceFiles.map((entry) => ({
      file: path.join(instance.directory, ...entry.relativePath.split('/')), sha256: entry.sha256, size: entry.size,
    }));
    const runtimeInputs = runtime.marker.files.map((entry) => ({
      file: path.join(runtime.runtimeDirectory, ...entry.relativePath.split('/')), sha256: entry.sha256, size: entry.size,
    }));
    const snapshotInputs = session.copiedMods.map((entry) => ({
      file: path.join(session.modsDirectory, entry.relativePath), sha256: entry.sha256, size: entry.size,
    }));
    const assetFiles = assetInputs.map((entry) => entry.file);
    const instanceFiles = instanceInputs.map((entry) => entry.file);
    const snapshotMods = snapshotInputs.map((entry) => entry.file);
    stage = 'classpath';
    await verifyManifestClassPaths([...assetFiles, ...instanceFiles.filter((file) => path.extname(file).toLowerCase() === '.jar'), ...snapshotMods]);
    const commandInputs = [
      ...runtimeInputs,
      ...assetInputs,
      ...instanceInputs,
      ...snapshotInputs,
      { file: launch.inventoryFile, sha256: launch.inventoryFileSha256, size: launch.inventoryFileSize },
      { file: session.modsList, ...session.effectiveInventory.commandFiles.modsList },
      { file: session.gameLibrariesList, ...session.effectiveInventory.commandFiles.gameLibrariesList },
      { file: session.effectiveInventoryFile, sha256: session.effectiveInventoryFileSha256, size: session.effectiveInventoryFileSize },
    ];
    stage = 'lease-acquire';
    lease = await acquireLaunchLease(instance, launch, session, commandInputs, externalLeases, [launch.keyLease], options);
    stage = 'lease-assert';
    await lease.assertHeld();
    const args = [
      `-Xms${Math.min(1024, instance.memoryMb)}M`,
      `-Xmx${instance.memoryMb}M`,
      `-Dfabric.gameJarPath=${gameJar}`,
      `-Dfabric.gameVersion=${instance.minecraftVersion}`,
      `-Dfabric.modsFolder=${session.modsDirectory}`,
      `-Dfabric.addMods=@${session.modsList}`,
      ...(assets.gameLibraries.length > 0 ? [`-Dfabric.gameLibraries=@${session.gameLibrariesList}`] : []),
      '-cp', fabricClasspath.join(path.delimiter), assets.mainClass, 'nogui',
    ];
    return {
      command: { executable: runtimeExecutable, args, cwd: instance.directory },
      lease,
      launchInventoryDigest: launch.digest,
      effectiveLaunchInventoryDigest: session.effectiveInventoryDigest,
      modSnapshot: { count: snapshotMods.length },
    };
  } catch (error) {
    if (lease) await lease.release().catch(() => undefined);
    else {
      if (session) await fs.rm(session.session, { recursive: true, force: true });
      for (const external of externalLeases.toReversed()) await external.release?.().catch(() => undefined);
    }
    throw launchVerificationStageError(error, stage);
  }
}

export async function verifyFamilyServerInstall(instance, options = {}) {
  let launch = null;
  let capabilityTransferred = false;
  let stage = 'instance-validation';
  try {
  if (
    !instance || instance.projectId !== 'family-server' || instance.kind !== 'server'
    || instance.provisioningStatus !== 'ready' || typeof instance.directory !== 'string' || !path.isAbsolute(instance.directory)
  ) throw new Error('Only a ready managed Family Server can be integrity checked');
  stage = 'manifest-read';
  const manifest = await readSmallJson(path.join(instance.directory, 'instance.json'), MAX_PRIVATE_MANIFEST_BYTES, 'Private instance manifest');
  assertInstanceManifest(instance, manifest);
  stage = 'base-integrity';
  const [artifacts, runtime, minecraftServerArtifact] = await Promise.all([
    verifyArtifacts(instance, manifest), verifyRuntime(instance, manifest), verifyMinecraftServerCompatibility(instance, manifest, options),
  ]);
  stage = 'launch-inventory';
  launch = await readAuthenticatedLaunchInventory(instance, manifest, runtime, options);
  if (options.requireLaunchCapability === true && !launch) {
    throw launchTrustUnavailable('The instance predates the complete authenticated launch inventory and cannot be executed.');
  }
  const result = {
    ok: true,
    artifactCount: artifacts.length + (minecraftServerArtifact ? 1 : 0),
    runtime: {
      component: runtime.component,
      major: runtime.major,
      version: runtime.version,
      executableSha1: runtime.executableSha1,
      ...(runtime.marker.inventorySha256 ? { inventorySha256: runtime.marker.inventorySha256 } : {}),
    },
    minecraftVersion: instance.minecraftVersion,
    worldDataVersion: minecraftServerArtifact?.worldDataVersion ?? null,
    ...(launch ? { launchInventoryDigest: launch.digest } : {}),
  };
  if (options.requireLaunchCapability === true) {
    stage = 'launch-capability';
    const capability = await createLaunchCapability(instance, manifest, runtime, launch, options);
    capabilityTransferred = true;
    return { ...result, ...capability };
  }
  return result;
  } catch (error) {
    throw launchVerificationStageError(error, stage);
  } finally {
    if (!capabilityTransferred) {
      await launch?.keyLease?.release().catch(() => undefined);
      await options.modLaunchBinding?.release?.().catch(() => undefined);
    }
  }
}
