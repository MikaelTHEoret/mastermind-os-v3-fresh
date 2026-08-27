import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { JavaRuntimeManager, safeRuntimeMetadata } from '../runtime-manager.mjs';

const USER_AGENT = 'Mastermind-Minecraft-Control/0.2 (Family AI client provisioner)';
const LATEST_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const METADATA_HOSTS = new Set(['piston-meta.mojang.com', 'launchermeta.mojang.com']);
const MOJANG_DATA_HOSTS = new Set(['piston-data.mojang.com', 'launcher.mojang.com']);
const LIBRARY_HOSTS = new Set(['libraries.minecraft.net']);
const ASSET_HOSTS = new Set(['resources.download.minecraft.net']);
const FABRIC_HOSTS = new Set(['meta.fabricmc.net', 'maven.fabricmc.net']);
const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_ASSET_HASH = /^[a-f0-9]{40}$/;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_NATIVE_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_NATIVE_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_NATIVE_ENTRIES = 4096;
const MAX_SKIN_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_SKIN_CACHE_FILES = 4096;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 6;
const FABRIC_JVM_ARGUMENT = '-DFabricMcEmu= net.minecraft.client.main.Main ';
const LOCK_FILE = fileURLToPath(new URL('../../../../minecraft/family-client-lock.v1.json', import.meta.url));
const MINECRAFT_ROOT = path.dirname(LOCK_FILE);

function exactObject(value, label, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains unsupported field '${key}'`);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${label} omitted '${key}'`);
  return value;
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`${label} was not valid JSON`); }
}

function checkedUrl(value, hosts, label) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`${label} was not a valid URL`); }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error(`${label} used an unexpected download URL`);
  }
  return url;
}

function validSize(value, maximum = MAX_ARTIFACT_BYTES, allowZero = false) {
  return Number.isInteger(value) && value >= (allowZero ? 0 : 1) && value <= maximum;
}

function safeRelative(value, label) {
  if (
    typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\\')
    || value.includes('\0') || path.posix.isAbsolute(value) || /^[a-zA-Z]:/.test(value)
  ) throw new Error(`${label} contained an unsafe path`);
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f<>:"|?*]/.test(part))) {
    throw new Error(`${label} contained an unsafe path`);
  }
  return parts.join('/');
}

function childPath(root, relativePath, label) {
  const safe = safeRelative(relativePath, label);
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...safe.split('/'));
  const relative = path.relative(absoluteRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped its managed root`);
  }
  return target;
}

function assertScopedChild(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside its managed root`);
  }
}

function sameFilesystemPath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function assertTrustedClientMutationRoot(managedRoot, clientRoot) {
  const trustedManagedRoot = path.resolve(managedRoot);
  const trustedClientsRoot = path.join(trustedManagedRoot, 'clients');
  const trustedClientRoot = path.join(trustedClientsRoot, 'family-ai-client');
  if (!sameFilesystemPath(clientRoot, trustedClientRoot)) throw new Error('Managed client mutation root was not the fixed Family client directory');
  for (const [directory, label] of [
    [trustedManagedRoot, 'Managed root'],
    [trustedClientsRoot, 'Managed clients root'],
    [trustedClientRoot, 'Managed Family client root'],
  ]) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} was not a trusted non-link directory`);
  }
  const canonicalManagedRoot = await fs.realpath(trustedManagedRoot);
  const canonicalClientsRoot = await fs.realpath(trustedClientsRoot);
  const canonicalClientRoot = await fs.realpath(trustedClientRoot);
  if (
    !sameFilesystemPath(canonicalClientsRoot, path.join(canonicalManagedRoot, 'clients'))
    || !sameFilesystemPath(canonicalClientRoot, path.join(canonicalClientsRoot, 'family-ai-client'))
  ) throw new Error('Managed Family client root failed canonical containment verification');
}

function hashBytes(bytes, algorithm) {
  return crypto.createHash(algorithm).update(bytes).digest('hex');
}

async function hashFile(file, algorithm, expectedSize, maximumBytes, label) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes || stat.size !== expectedSize) {
    throw new Error(`${label} size did not match its trusted metadata`);
  }
  const hash = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function fetchBytes(fetcher, value, hosts, label, expectedSize, algorithm, expectedDigest, maximumBytes = MAX_ARTIFACT_BYTES) {
  if (!validSize(expectedSize, maximumBytes)) throw new Error(`${label} had an invalid trusted size`);
  const url = checkedUrl(value, hosts, label);
  const response = await fetcher(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/java-archive, application/octet-stream, */*', 'Accept-Encoding': 'identity' },
    signal: AbortSignal.timeout(5 * 60 * 1000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`${label} request failed (${response.status})`);
  if (response.url) checkedUrl(response.url, hosts, `${label} response`);
  const declared = response.headers.get('content-length');
  const contentEncoding = response.headers.get('content-encoding');
  if (declared !== null && (!contentEncoding || contentEncoding === 'identity') && (!/^\d+$/.test(declared) || Number(declared) !== expectedSize)) {
    throw new Error(`${label} response size did not match trusted metadata`);
  }
  const bytes = await readResponseBytes(response, label, maximumBytes);
  if (bytes.length !== expectedSize) throw new Error(`${label} size did not match trusted metadata`);
  if (hashBytes(bytes, algorithm) !== expectedDigest.toLowerCase()) throw new Error(`${label} failed ${algorithm.toUpperCase()} verification`);
  return bytes;
}

async function fetchBoundedJson(fetcher, value, hosts, label, maximumBytes = MAX_JSON_BYTES) {
  const url = checkedUrl(value, hosts, label);
  const response = await fetcher(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Encoding': 'identity' },
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`${label} request failed (${response.status})`);
  if (response.url) checkedUrl(response.url, hosts, `${label} response`);
  const declared = response.headers.get('content-length');
  const contentEncoding = response.headers.get('content-encoding');
  if (declared !== null && (!contentEncoding || contentEncoding === 'identity') && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) throw new Error(`${label} exceeded its size limit`);
  const bytes = await readResponseBytes(response, label, maximumBytes);
  if (bytes.length < 2 || bytes.length > maximumBytes) throw new Error(`${label} exceeded its size limit`);
  return { bytes, value: parseJson(bytes, label) };
}

async function readResponseBytes(response, label, maximumBytes) {
  if (!response.body) throw new Error(`${label} response had no body`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) {
      await response.body.cancel?.().catch(() => undefined);
      throw new Error(`${label} exceeded its size limit`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

function assertDigest(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${label} had an invalid digest`);
  return value.toLowerCase();
}

function coordinatePath(coordinate) {
  if (typeof coordinate !== 'string' || !/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.+\-]+$/.test(coordinate)) {
    throw new Error('Fabric profile contained an invalid library coordinate');
  }
  const [group, name, version] = coordinate.split(':');
  return `${group.replaceAll('.', '/')}/${name}/${version}/${name}-${version}.jar`;
}

function ruleMatches(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !['allow', 'disallow'].includes(rule.action)) {
    throw new Error('Minecraft library used an unsupported rule');
  }
  if (rule.features != null) return false;
  if (rule.os == null) return true;
  exactObject(rule.os, 'Minecraft OS rule', [], ['name', 'arch', 'version', 'versionRange']);
  if (rule.os.name != null && !['windows', 'linux', 'osx'].includes(rule.os.name)) throw new Error('Minecraft library used an unsupported OS rule');
  if (rule.os.arch != null && !['x86', 'x86_64', 'arm64'].includes(rule.os.arch)) throw new Error('Minecraft library used an unsupported architecture rule');
  if (rule.os.version != null || rule.os.versionRange != null) throw new Error('Minecraft library used an unsupported version rule');
  return (rule.os.name == null || rule.os.name === 'windows') && (rule.os.arch == null || rule.os.arch === 'x86_64');
}

function rulesAllow(rules) {
  if (rules == null) return true;
  if (!Array.isArray(rules) || rules.length === 0) throw new Error('Minecraft library had invalid rules');
  let allowed = false;
  for (const rule of rules) if (ruleMatches(rule)) allowed = rule.action === 'allow';
  return allowed;
}

function normalizeDescriptor(descriptor, relativePath, hosts, label, algorithm = 'sha1') {
  exactObject(descriptor, label, ['url', 'size', algorithm], ['path']);
  if (descriptor.path != null && safeRelative(descriptor.path, label) !== safeRelative(relativePath.replace(/^libraries\//, ''), label)) {
    throw new Error(`${label} path did not match its descriptor`);
  }
  checkedUrl(descriptor.url, hosts, `${label} URL`);
  if (!validSize(descriptor.size)) throw new Error(`${label} had an invalid size`);
  const digest = assertDigest(descriptor[algorithm], algorithm === 'sha1' ? SHA1 : SHA256, label);
  return { relativePath: safeRelative(relativePath, label), url: descriptor.url, size: descriptor.size, algorithm, digest };
}

function validateLock(lock) {
  exactObject(lock, 'Family client lock', ['schemaVersion', 'projectId', 'serverProjectId', 'kind', 'platform', 'minecraft', 'fabric', 'bootstrap', 'mods']);
  if (lock.schemaVersion !== 1 || lock.projectId !== 'family-ai-client' || lock.serverProjectId !== 'family-server' || lock.kind !== 'client' || lock.platform !== 'windows-x64') {
    throw new Error('Family client lock identity was invalid');
  }
  exactObject(lock.minecraft, 'Minecraft lock', ['channel', 'version', 'versionManifest', 'versionJson', 'client', 'assetIndex', 'logging', 'java']);
  if (lock.minecraft.channel !== 'latest-release' || lock.minecraft.version !== '26.2') throw new Error('Family client lock must target exact current release 26.2');
  exactObject(lock.minecraft.versionManifest, 'Minecraft manifest lock', ['url', 'entry', 'maximumBytes']);
  exactObject(lock.minecraft.versionManifest.entry, 'Minecraft manifest entry lock', ['id', 'type', 'url', 'sha1', 'time', 'releaseTime', 'complianceLevel']);
  if (lock.minecraft.versionManifest.url !== LATEST_MANIFEST_URL || lock.minecraft.versionManifest.maximumBytes !== MAX_JSON_BYTES) throw new Error('Minecraft manifest lock was invalid');
  checkedUrl(lock.minecraft.versionManifest.entry.url, METADATA_HOSTS, 'Locked Minecraft version JSON');
  assertDigest(lock.minecraft.versionManifest.entry.sha1, SHA1, 'Locked Minecraft version JSON');
  if (lock.minecraft.versionManifest.entry.id !== '26.2' || lock.minecraft.versionManifest.entry.type !== 'release') throw new Error('Minecraft manifest entry lock was invalid');
  exactObject(lock.minecraft.java, 'Minecraft Java lock', ['component', 'major']);
  if (lock.minecraft.java.component !== 'java-runtime-epsilon' || lock.minecraft.java.major !== 25) throw new Error('Minecraft Java lock was invalid');
  exactObject(lock.minecraft.versionJson, 'Minecraft version JSON lock', ['url', 'size', 'sha1']);
  exactObject(lock.minecraft.client, 'Minecraft client lock', ['url', 'size', 'sha1']);
  exactObject(lock.minecraft.assetIndex, 'Minecraft asset index lock', ['id', 'url', 'size', 'totalSize', 'sha1']);
  exactObject(lock.minecraft.logging, 'Minecraft logging lock', ['id', 'url', 'size', 'sha1']);
  for (const [label, descriptor, hosts, maximum] of [
    ['Minecraft version JSON lock', lock.minecraft.versionJson, METADATA_HOSTS, MAX_JSON_BYTES],
    ['Minecraft client lock', lock.minecraft.client, MOJANG_DATA_HOSTS, MAX_ARTIFACT_BYTES],
    ['Minecraft asset index lock', lock.minecraft.assetIndex, METADATA_HOSTS, MAX_JSON_BYTES],
    ['Minecraft logging lock', lock.minecraft.logging, MOJANG_DATA_HOSTS, MAX_JSON_BYTES],
  ]) {
    checkedUrl(descriptor.url, hosts, label);
    assertDigest(descriptor.sha1, SHA1, label);
    if (!validSize(descriptor.size, maximum)) throw new Error(`${label} size was invalid`);
  }
  if (
    lock.minecraft.versionJson.url !== lock.minecraft.versionManifest.entry.url
    || lock.minecraft.versionJson.sha1 !== lock.minecraft.versionManifest.entry.sha1
    || lock.minecraft.assetIndex.id !== '32'
    || !validSize(lock.minecraft.assetIndex.totalSize, MAX_TOTAL_DOWNLOAD_BYTES)
  ) throw new Error('Minecraft artifact lock was internally inconsistent');
  exactObject(lock.fabric, 'Fabric lock', ['loaderVersion', 'profile', 'libraries']);
  exactObject(lock.fabric.profile, 'Fabric profile lock', ['url', 'size', 'sha256', 'id', 'inheritsFrom', 'mainClass']);
  if (lock.fabric.loaderVersion !== '0.19.3' || lock.fabric.profile.inheritsFrom !== '26.2' || lock.fabric.profile.id !== 'fabric-loader-0.19.3-26.2' || lock.fabric.profile.mainClass !== 'net.fabricmc.loader.impl.launch.knot.KnotClient') throw new Error('Fabric profile lock was invalid');
  checkedUrl(lock.fabric.profile.url, FABRIC_HOSTS, 'Fabric profile lock');
  assertDigest(lock.fabric.profile.sha256, SHA256, 'Fabric profile lock');
  if (!validSize(lock.fabric.profile.size, MAX_JSON_BYTES)) throw new Error('Fabric profile lock size was invalid');
  if (!Array.isArray(lock.fabric.libraries) || lock.fabric.libraries.length !== 7) throw new Error('Fabric lock must contain its exact seven profile libraries');
  const fabricCoordinates = new Set();
  for (const library of lock.fabric.libraries) {
    exactObject(library, 'Fabric library lock', ['coordinate', 'url', 'size', 'sha256', 'inProfile'], ['role']);
    if (library.inProfile !== true || fabricCoordinates.has(library.coordinate)) throw new Error('Fabric library lock was invalid or duplicated');
    fabricCoordinates.add(library.coordinate);
    checkedUrl(library.url, FABRIC_HOSTS, 'Fabric library lock');
    assertDigest(library.sha256, SHA256, 'Fabric library lock');
    if (!validSize(library.size)) throw new Error('Fabric library lock size was invalid');
    coordinatePath(library.coordinate);
  }
  if (!fabricCoordinates.has('net.fabricmc:fabric-loader:0.19.3')) throw new Error('Fabric lock omitted Loader');
  exactObject(lock.bootstrap, 'Family client bootstrap lock', ['version', 'mainClass', 'fileName', 'source', 'size', 'sha256']);
  if (
    lock.bootstrap.version !== '0.1.0'
    || lock.bootstrap.mainClass !== 'com.mastermind.minecraft.familyclientbootstrap.FamilyClientBootstrap'
    || lock.bootstrap.fileName !== 'family-client-bootstrap-0.1.0.jar'
    || !validSize(lock.bootstrap.size) || !SHA256.test(lock.bootstrap.sha256)
  ) throw new Error('Family client bootstrap lock was invalid');
  safeRelative(lock.bootstrap.source, 'Family client bootstrap source');
  exactObject(lock.mods, 'Mod lock', ['remote', 'local']);
  if (!Array.isArray(lock.mods.remote) || lock.mods.remote.length !== 1 || !Array.isArray(lock.mods.local) || lock.mods.local.length !== 3) throw new Error('Family mod lock was incomplete');
  const ids = new Set();
  for (const mod of [...lock.mods.remote, ...lock.mods.local]) {
    exactObject(mod, 'Mod lock entry', ['id', 'version', 'fileName', 'size', 'sha256', ...(Object.hasOwn(mod, 'source') ? ['source'] : ['url'])]);
    if (ids.has(mod.id) || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(mod.id) || !validSize(mod.size) || !SHA256.test(mod.sha256)) throw new Error('Mod lock entry was invalid or duplicated');
    ids.add(mod.id);
    safeRelative(mod.fileName, 'Mod filename');
    if (mod.fileName.includes('/')) throw new Error('Mod filename cannot contain directories');
    if (mod.url) checkedUrl(mod.url, FABRIC_HOSTS, 'Remote mod URL');
    if (mod.source) safeRelative(mod.source, 'Local mod source');
  }
  for (const required of ['fabric-api', 'mastermind-family-agent-bridge', 'mastermind-family-agent-baritone-provider', 'baritone']) if (!ids.has(required)) throw new Error(`Family mod lock omitted ${required}`);
  return lock;
}

function validateManifestEntry(manifest, lock) {
  if (manifest?.latest?.release !== lock.minecraft.version) throw new Error(`Minecraft ${lock.minecraft.version} is no longer Mojang's latest release; update the audited Family client lock first`);
  const matches = Array.isArray(manifest?.versions) ? manifest.versions.filter((entry) => entry?.id === lock.minecraft.version) : [];
  if (matches.length !== 1) throw new Error('Mojang version manifest did not contain one exact locked release entry');
  const actual = matches[0];
  const expected = lock.minecraft.versionManifest.entry;
  for (const key of ['id', 'type', 'url', 'sha1', 'time', 'releaseTime', 'complianceLevel']) {
    if (actual[key] !== expected[key]) throw new Error(`Mojang version manifest disagreed with the lock on '${key}'`);
  }
  return actual;
}

function platformLibraryPlan(versionJson) {
  if (!Array.isArray(versionJson.libraries) || versionJson.libraries.length === 0 || versionJson.libraries.length > 512) throw new Error('Minecraft version JSON had invalid libraries');
  const artifacts = [];
  const natives = [];
  const seen = new Set();
  for (const library of versionJson.libraries) {
    if (!library || typeof library !== 'object' || Array.isArray(library) || typeof library.name !== 'string') throw new Error('Minecraft version JSON had an invalid library');
    if (!rulesAllow(library.rules)) continue;
    const classifier = library.name.split(':')[3] ?? null;
    if (classifier?.startsWith('natives-windows') && classifier !== 'natives-windows') continue;
    const artifact = library.downloads?.artifact;
    if (!artifact) throw new Error(`Minecraft library ${library.name} omitted its artifact download`);
    const normalized = normalizeDescriptor(artifact, `libraries/${artifact.path}`, LIBRARY_HOSTS, `Minecraft library ${library.name}`);
    if (seen.has(normalized.relativePath)) throw new Error('Minecraft version JSON contained duplicate library paths');
    seen.add(normalized.relativePath);
    const native = classifier === 'natives-windows';
    artifacts.push({ ...normalized, kind: native ? 'native-jar' : 'library', coordinate: library.name });
    if (native) natives.push(normalized.relativePath);
  }
  if (artifacts.length === 0 || natives.length === 0) throw new Error('Minecraft version JSON did not select Windows x64 client libraries and natives');
  return { artifacts, natives };
}

function validateVersionJson(versionJson, lock) {
  if (
    versionJson?.id !== lock.minecraft.version || versionJson?.type !== 'release'
    || versionJson?.javaVersion?.component !== lock.minecraft.java.component
    || versionJson?.javaVersion?.majorVersion !== lock.minecraft.java.major
    || versionJson?.mainClass !== 'net.minecraft.client.main.Main'
  ) throw new Error('Minecraft version JSON did not match the locked 26.2 client');
  for (const [key, expected] of [['client', lock.minecraft.client]]) {
    const actual = versionJson.downloads?.[key];
    if (actual?.url !== expected.url || actual?.size !== expected.size || actual?.sha1 !== expected.sha1) throw new Error(`Minecraft ${key} descriptor disagreed with the lock`);
  }
  for (const key of ['id', 'url', 'size', 'totalSize', 'sha1']) if (versionJson.assetIndex?.[key] !== lock.minecraft.assetIndex[key]) throw new Error(`Minecraft asset index disagreed with the lock on '${key}'`);
  const log = versionJson.logging?.client?.file;
  for (const key of ['id', 'url', 'size', 'sha1']) if (log?.[key] !== lock.minecraft.logging[key]) throw new Error(`Minecraft logging descriptor disagreed with the lock on '${key}'`);
  return platformLibraryPlan(versionJson);
}

function validateFabricProfile(profile, lock) {
  if (
    profile?.id !== lock.fabric.profile.id || profile?.inheritsFrom !== lock.fabric.profile.inheritsFrom
    || profile?.mainClass !== lock.fabric.profile.mainClass || profile?.type !== 'release'
    || !profile.arguments || !Array.isArray(profile.arguments.game) || !Array.isArray(profile.arguments.jvm)
  ) throw new Error('Fabric profile structure did not match the lock');
  if (profile.arguments.game.length !== 0 || profile.arguments.jvm.length !== 1 || profile.arguments.jvm[0] !== FABRIC_JVM_ARGUMENT) {
    throw new Error('Fabric profile launch arguments drifted from the audited 26.2 contract');
  }
  if (!Array.isArray(profile.libraries) || profile.libraries.length !== lock.fabric.libraries.length) throw new Error('Fabric profile library set did not match the lock');
  const actual = new Map(profile.libraries.map((entry) => [entry?.name, entry]));
  if (actual.size !== profile.libraries.length) throw new Error('Fabric profile contained duplicate libraries');
  for (const pinned of lock.fabric.libraries) {
    const entry = actual.get(pinned.coordinate);
    if (!entry || entry.url !== 'https://maven.fabricmc.net/') throw new Error(`Fabric profile omitted or changed ${pinned.coordinate}`);
    if (pinned.coordinate !== 'net.fabricmc:fabric-loader:0.19.3') {
      if (entry.size !== pinned.size || entry.sha256 !== pinned.sha256) throw new Error(`Fabric profile integrity metadata changed for ${pinned.coordinate}`);
    }
  }
}

function validateAssetIndex(index, lock) {
  if (!index || typeof index !== 'object' || Array.isArray(index) || !index.objects || typeof index.objects !== 'object' || Array.isArray(index.objects)) throw new Error('Minecraft asset index was invalid');
  const artifacts = [];
  let total = 0;
  const seen = new Set();
  for (const [name, object] of Object.entries(index.objects)) {
    if (typeof name !== 'string' || name.length < 1 || name.length > 512 || !SAFE_ASSET_HASH.test(object?.hash ?? '') || !validSize(object?.size)) throw new Error('Minecraft asset index contained invalid metadata');
    if (seen.has(object.hash)) throw new Error('Minecraft asset index duplicated an object digest');
    seen.add(object.hash);
    total += object.size;
    if (total > lock.minecraft.assetIndex.totalSize) throw new Error('Minecraft asset index exceeded its locked total size');
    artifacts.push({
      kind: 'asset', relativePath: `assets/objects/${object.hash.slice(0, 2)}/${object.hash}`,
      url: `https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`,
      size: object.size, algorithm: 'sha1', digest: object.hash,
    });
  }
  if (artifacts.length === 0 || total !== lock.minecraft.assetIndex.totalSize) throw new Error('Minecraft asset index total did not match the lock');
  return artifacts;
}

function descriptorKey(value) {
  return `${value.algorithm}-${value.digest}`;
}

function publicResolved(resolved) {
  return {
    projectId: 'family-ai-client', kind: 'client', platform: 'windows-x64', state: 'resolved',
    minecraftVersion: resolved.minecraftVersion, updateChannel: 'latest-release', requiredJavaMajor: 25,
    loader: { name: 'Fabric Loader', version: resolved.loaderVersion }, assetIndex: resolved.assetIndexId,
    counts: { libraries: resolved.counts.libraries, nativeJars: resolved.counts.nativeJars, assets: resolved.counts.assets, mods: resolved.counts.mods },
    totalDownloadBytes: resolved.totalDownloadBytes,
  };
}

async function concurrentMap(values, concurrency, operation) {
  let next = 0;
  let failure = null;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (!failure && next < values.length) {
      const index = next;
      next += 1;
      try { await operation(values[index], index); }
      catch (error) { failure ??= error; }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
}

async function exists(target) {
  try { await fs.access(target); return true; }
  catch { return false; }
}

async function atomicPublish(source, destination, label) {
  for (const waitMs of [0, 15, 40, 80]) {
    if (await exists(destination)) throw new Error(`${label} destination became occupied`);
    if (waitMs) await delay(waitMs);
    try { await fs.rename(source, destination); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || waitMs === 80) throw error;
    }
  }
}

async function tryVerifiedFile(file, descriptor) {
  try {
    const digest = await hashFile(file, descriptor.algorithm, descriptor.size, MAX_ARTIFACT_BYTES, 'Cached artifact');
    return digest === descriptor.digest;
  } catch { return false; }
}

async function copyVerified(source, destination, descriptor) {
  if (!await tryVerifiedFile(source, descriptor)) return false;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  if (!await tryVerifiedFile(destination, descriptor)) {
    await fs.rm(destination, { force: true });
    throw new Error('Artifact changed while copying into the managed cache');
  }
  return true;
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  throw new Error('Native JAR had no valid ZIP central directory');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipEntries(bytes) {
  const end = findEndOfCentralDirectory(bytes);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw new Error('Multi-disk native ZIPs are not supported');
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (count > MAX_NATIVE_ENTRIES || centralOffset + centralSize > end) throw new Error('Native JAR central directory was invalid');
  const entries = [];
  const seen = new Set();
  let total = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Native JAR central directory was invalid');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const external = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replaceAll('\\', '/');
    cursor += 46 + nameLength + extraLength + commentLength;
    if ((flags & 0x1) !== 0 || (flags & 0x800) === 0 || ![0, 8].includes(method)) throw new Error('Native JAR used unsupported ZIP features');
    if ((external >>> 16 & 0o170000) === 0o120000) throw new Error('Native JAR contained a symbolic link');
    const directory = name.endsWith('/');
    const normalized = safeRelative(directory ? name.slice(0, -1) : name, 'Native JAR entry');
    const key = normalized.toLowerCase();
    if (seen.has(key)) throw new Error('Native JAR contained duplicate paths');
    seen.add(key);
    if (normalized.split('/')[0].toUpperCase() === 'META-INF') continue;
    if (size > MAX_NATIVE_ENTRY_BYTES) throw new Error('Native JAR entry exceeded its size limit');
    total += size;
    if (total > MAX_NATIVE_TOTAL_BYTES) throw new Error('Native JAR extraction exceeded its size limit');
    entries.push({ normalized, directory, flags, method, checksum, compressedSize, size, localOffset });
  }
  if (cursor !== centralOffset + centralSize) throw new Error('Native JAR central directory size was invalid');
  return entries;
}

async function extractNativeJarDetailed(source, destination) {
  const bytes = await fs.readFile(source);
  const entries = zipEntries(bytes);
  const extracted = [];
  for (const entry of entries) {
    const target = childPath(destination, entry.normalized, 'Native extraction path');
    if (entry.directory) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    const offset = entry.localOffset;
    if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('Native JAR local entry was invalid');
    const localFlags = bytes.readUInt16LE(offset + 6);
    const localMethod = bytes.readUInt16LE(offset + 8);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const localName = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8').replaceAll('\\', '/');
    const localDirectory = localName.endsWith('/');
    const localNormalized = safeRelative(localDirectory ? localName.slice(0, -1) : localName, 'Native JAR local entry');
    if (localFlags !== entry.flags || localMethod !== entry.method || localDirectory !== entry.directory || localNormalized !== entry.normalized) throw new Error('Native JAR local entry disagreed with its central directory');
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > bytes.length) throw new Error('Native JAR local entry exceeded its archive');
    const compressed = bytes.subarray(dataStart, dataEnd);
    const payload = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_NATIVE_ENTRY_BYTES });
    if (payload.length !== entry.size || crc32(payload) !== entry.checksum) throw new Error('Native JAR entry integrity did not match its directory');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, payload, { flag: 'wx' });
    extracted.push({ relativePath: entry.normalized, size: payload.length, sha256: hashBytes(payload, 'sha256') });
  }
  return extracted;
}

async function extractNativeJar(source, destination) {
  return (await extractNativeJarDetailed(source, destination)).length;
}

async function readLock(lockFile) {
  const stat = await fs.lstat(lockFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_JSON_BYTES) throw new Error('Family client lock was not a regular bounded file');
  return validateLock(parseJson(await fs.readFile(lockFile), 'Family client lock'));
}

async function readManagedJson(file, maximumBytes, label) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumBytes) throw new Error(`${label} was not a regular bounded file`);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error(`${label} permissions were broader than 0600`);
  return parseJson(await fs.readFile(file), label);
}

function expectedInstalledArtifacts(lock, versionJson, assetIndex) {
  const libraryPlan = validateVersionJson(versionJson, lock);
  const assets = validateAssetIndex(assetIndex, lock);
  return {
    nativePaths: libraryPlan.natives,
    artifacts: [
      { kind: 'version-json', relativePath: `versions/${lock.minecraft.version}/${lock.minecraft.version}.json`, size: lock.minecraft.versionJson.size, algorithm: 'sha1', digest: lock.minecraft.versionJson.sha1 },
      { kind: 'fabric-profile', relativePath: `versions/${lock.fabric.profile.id}/${lock.fabric.profile.id}.json`, size: lock.fabric.profile.size, algorithm: 'sha256', digest: lock.fabric.profile.sha256 },
      { kind: 'client', relativePath: `versions/${lock.minecraft.version}/${lock.minecraft.version}.jar`, size: lock.minecraft.client.size, algorithm: 'sha1', digest: lock.minecraft.client.sha1 },
      { kind: 'asset-index', relativePath: `assets/indexes/${lock.minecraft.assetIndex.id}.json`, size: lock.minecraft.assetIndex.size, algorithm: 'sha1', digest: lock.minecraft.assetIndex.sha1 },
      { kind: 'logging', relativePath: `assets/log_configs/${lock.minecraft.logging.id}`, size: lock.minecraft.logging.size, algorithm: 'sha1', digest: lock.minecraft.logging.sha1 },
      ...libraryPlan.artifacts.map(({ kind, relativePath, size, algorithm, digest }) => ({ kind, relativePath, size, algorithm, digest })),
      ...assets.map(({ kind, relativePath, size, algorithm, digest }) => ({ kind, relativePath, size, algorithm, digest })),
      ...lock.fabric.libraries.map((library) => ({ kind: 'fabric-library', relativePath: `libraries/${coordinatePath(library.coordinate)}`, size: library.size, algorithm: 'sha256', digest: library.sha256 })),
      ...lock.mods.remote.map((mod) => ({ kind: 'mod', relativePath: `mods/${mod.fileName}`, size: mod.size, algorithm: 'sha256', digest: mod.sha256 })),
      { kind: 'bootstrap', relativePath: `bootstrap/${lock.bootstrap.fileName}`, size: lock.bootstrap.size, algorithm: 'sha256', digest: lock.bootstrap.sha256 },
      ...lock.mods.local.map((mod) => ({ kind: 'mod', relativePath: `mods/${mod.fileName}`, size: mod.size, algorithm: 'sha256', digest: mod.sha256 })),
    ],
  };
}

function sameArtifact(left, right) {
  return left?.kind === right.kind && left?.relativePath === right.relativePath && left?.size === right.size
    && left?.algorithm === right.algorithm && left?.digest === right.digest;
}

async function collectRelativeFiles(root, prefix = '', result = []) {
  if (result.length > MAX_NATIVE_ENTRIES + 8192) throw new Error('Managed client contained too many files');
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = safeRelative(prefix ? `${prefix}/${entry.name}` : entry.name, 'Managed client file');
    const target = childPath(root, entry.name, 'Managed client file');
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error('Managed client contained a symbolic link');
    if (stat.isDirectory()) await collectRelativeFiles(target, relativePath, result);
    else if (stat.isFile()) result.push(relativePath);
    else throw new Error('Managed client contained an unsupported filesystem entry');
  }
  return result;
}

function isRuntimeSkinCacheFile(relativePath) {
  const match = /^assets\/skins\/([a-f0-9]{2})\/([a-f0-9]{40})$/.exec(relativePath);
  return match !== null && match[2].startsWith(match[1]);
}

async function resetRuntimeNativeDirectories(managedRoot, clientRoot) {
  await assertTrustedClientMutationRoot(managedRoot, clientRoot);
  const root = path.join(clientRoot, 'runtime-natives');
  assertScopedChild(clientRoot, root, 'Runtime-native root');
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Runtime-native root was not a trusted directory');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await fs.mkdir(root, { mode: 0o700 });
  }
  const result = { root };
  for (const name of ['jna', 'lwjgl', 'netty']) {
    const target = path.join(root, name);
    assertScopedChild(root, target, `Runtime-native ${name} directory`);
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) await fs.unlink(target);
      else await fs.rm(target, { recursive: true, force: false });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await fs.mkdir(target, { mode: 0o700 });
    result[name] = target;
  }
  return Object.freeze(result);
}

async function resetLaunchArgumentsDirectory(managedRoot, clientRoot) {
  await assertTrustedClientMutationRoot(managedRoot, clientRoot);
  const target = path.join(clientRoot, 'runtime-launch');
  assertScopedChild(clientRoot, target, 'Runtime launch-argument directory');
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) await fs.unlink(target);
    else await fs.rm(target, { recursive: true, force: false });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fs.mkdir(target, { mode: 0o700 });
  return target;
}

export class FamilyClientProvisioner {
  #queue = Promise.resolve();

  constructor(managedRoot, options = {}) {
    this.managedRoot = path.resolve(managedRoot);
    this.clientRoot = path.join(this.managedRoot, 'clients', 'family-ai-client');
    this.clientParent = path.dirname(this.clientRoot);
    this.cacheRoot = path.join(this.managedRoot, 'cache', 'family-ai-client', 'objects');
    this.privateManifest = path.join(this.managedRoot, 'private', 'family-ai-client-install.json');
    this.fetcher = options.fetcher ?? fetch;
    this.lockFile = path.resolve(options.lockFile ?? LOCK_FILE);
    this.localArtifactRoot = path.resolve(options.localArtifactRoot ?? MINECRAFT_ROOT);
    this.runtimeManager = options.runtimeManager ?? new JavaRuntimeManager(path.join(this.managedRoot, 'runtimes'), this.fetcher, options.runtimeOptions);
    this.seedCacheRoots = Array.isArray(options.seedCacheRoots) ? options.seedCacheRoots.map((value) => path.resolve(value)) : [];
    this.now = options.now ?? (() => new Date());
  }

  async resolve() {
    const lock = await readLock(this.lockFile);
    const manifestResult = await fetchBoundedJson(this.fetcher, lock.minecraft.versionManifest.url, METADATA_HOSTS, 'Mojang version manifest', lock.minecraft.versionManifest.maximumBytes);
    validateManifestEntry(manifestResult.value, lock);
    const versionBytes = await fetchBytes(this.fetcher, lock.minecraft.versionJson.url, METADATA_HOSTS, 'Minecraft version JSON', lock.minecraft.versionJson.size, 'sha1', lock.minecraft.versionJson.sha1, MAX_JSON_BYTES);
    const versionJson = parseJson(versionBytes, 'Minecraft version JSON');
    const libraryPlan = validateVersionJson(versionJson, lock);
    const profileBytes = await fetchBytes(this.fetcher, lock.fabric.profile.url, FABRIC_HOSTS, 'Fabric profile', lock.fabric.profile.size, 'sha256', lock.fabric.profile.sha256, MAX_JSON_BYTES);
    validateFabricProfile(parseJson(profileBytes, 'Fabric profile'), lock);
    const assetBytes = await fetchBytes(this.fetcher, lock.minecraft.assetIndex.url, METADATA_HOSTS, 'Minecraft asset index', lock.minecraft.assetIndex.size, 'sha1', lock.minecraft.assetIndex.sha1, MAX_JSON_BYTES);
    const assets = validateAssetIndex(parseJson(assetBytes, 'Minecraft asset index'), lock);
    const artifacts = [
      { kind: 'version-json', relativePath: `versions/${lock.minecraft.version}/${lock.minecraft.version}.json`, inlineBytes: Buffer.from(versionBytes), url: lock.minecraft.versionJson.url, size: lock.minecraft.versionJson.size, algorithm: 'sha1', digest: lock.minecraft.versionJson.sha1 },
      { kind: 'fabric-profile', relativePath: `versions/${lock.fabric.profile.id}/${lock.fabric.profile.id}.json`, inlineBytes: Buffer.from(profileBytes), url: lock.fabric.profile.url, size: lock.fabric.profile.size, algorithm: 'sha256', digest: lock.fabric.profile.sha256 },
      { kind: 'client', relativePath: `versions/${lock.minecraft.version}/${lock.minecraft.version}.jar`, url: lock.minecraft.client.url, size: lock.minecraft.client.size, algorithm: 'sha1', digest: lock.minecraft.client.sha1 },
      { kind: 'asset-index', relativePath: `assets/indexes/${lock.minecraft.assetIndex.id}.json`, inlineBytes: Buffer.from(assetBytes), url: lock.minecraft.assetIndex.url, size: lock.minecraft.assetIndex.size, algorithm: 'sha1', digest: lock.minecraft.assetIndex.sha1 },
      { kind: 'logging', relativePath: `assets/log_configs/${lock.minecraft.logging.id}`, url: lock.minecraft.logging.url, size: lock.minecraft.logging.size, algorithm: 'sha1', digest: lock.minecraft.logging.sha1 },
      ...libraryPlan.artifacts,
      ...assets,
      ...lock.fabric.libraries.map((library) => ({ kind: 'fabric-library', coordinate: library.coordinate, relativePath: `libraries/${coordinatePath(library.coordinate)}`, url: library.url, size: library.size, algorithm: 'sha256', digest: library.sha256 })),
      ...lock.mods.remote.map((mod) => ({ kind: 'mod', modId: mod.id, relativePath: `mods/${mod.fileName}`, url: mod.url, size: mod.size, algorithm: 'sha256', digest: mod.sha256 })),
    ];
    const localArtifacts = [{
      kind: 'bootstrap', relativePath: `bootstrap/${lock.bootstrap.fileName}`,
      source: childPath(this.localArtifactRoot, lock.bootstrap.source, 'Family client bootstrap source'),
      size: lock.bootstrap.size, algorithm: 'sha256', digest: lock.bootstrap.sha256,
    }, ...lock.mods.local.map((mod) => ({
      kind: 'mod', modId: mod.id, relativePath: `mods/${mod.fileName}`, source: childPath(this.localArtifactRoot, mod.source, 'Local mod source'),
      size: mod.size, algorithm: 'sha256', digest: mod.sha256,
    }))];
    let totalDownloadBytes = 0;
    const destinations = new Set();
    for (const artifact of [...artifacts, ...localArtifacts]) {
      safeRelative(artifact.relativePath, 'Client artifact path');
      if (destinations.has(artifact.relativePath.toLowerCase())) throw new Error('Resolved client plan contained duplicate paths');
      destinations.add(artifact.relativePath.toLowerCase());
      if (artifact.url) totalDownloadBytes += artifact.size;
      if (totalDownloadBytes > MAX_TOTAL_DOWNLOAD_BYTES) throw new Error('Resolved client plan exceeded its download budget');
    }
    const resolved = {
      lock, minecraftVersion: lock.minecraft.version, loaderVersion: lock.fabric.loaderVersion, assetIndexId: lock.minecraft.assetIndex.id,
      requiredJavaMajor: lock.minecraft.java.major, javaRuntimeComponent: lock.minecraft.java.component,
      artifacts, localArtifacts, nativePaths: libraryPlan.natives,
      counts: { libraries: libraryPlan.artifacts.length + lock.fabric.libraries.length, nativeJars: libraryPlan.natives.length, assets: assets.length, mods: lock.mods.local.length + lock.mods.remote.length },
      totalDownloadBytes,
    };
    return Object.freeze(resolved);
  }

  plan(resolved) {
    if (!resolved || resolved.lock?.projectId !== 'family-ai-client' || resolved.minecraftVersion !== '26.2') throw new Error('Only a resolved locked Family AI client can be planned');
    return {
      ...publicResolved(resolved), action: 'provision', destination: 'managed-family-client',
      cache: { contentAddressed: true, rehashOnReuse: true, optionalReadOnlySeedCaches: this.seedCacheRoots.length },
      transaction: { siblingStaging: true, atomicPublish: true, privateManifestMode: '0600' },
      launchesClient: false, containsAuthentication: false,
    };
  }

  async provision(resolved) {
    const operation = this.#queue.then(() => this.#provision(resolved));
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async #provision(resolved) {
    this.plan(resolved);
    if (await exists(this.clientRoot)) throw new Error('Managed Family AI client already exists; replacement requires an explicit future update transaction');
    if (await exists(this.privateManifest)) throw new Error('A private Family AI client manifest already exists without its managed client; operator repair is required');
    await fs.mkdir(this.clientParent, { recursive: true });
    await fs.mkdir(this.cacheRoot, { recursive: true });
    const staging = path.join(this.clientParent, `.family-ai-client-staging-${crypto.randomUUID()}`);
    assertScopedChild(this.clientParent, staging, 'Client staging directory');
    await fs.mkdir(staging, { recursive: false });
    try {
      const runtime = await this.runtimeManager.ensure(resolved.requiredJavaMajor, resolved.javaRuntimeComponent);
      if (!runtime || runtime.managed !== true || runtime.major !== 25 || runtime.component !== 'java-runtime-epsilon' || typeof runtime.executable !== 'string' || !path.isAbsolute(runtime.executable)) {
        throw new Error('Managed Java runtime did not return the locked Java 25 component');
      }
      const all = [...resolved.artifacts, ...resolved.localArtifacts];
      await concurrentMap(all, DOWNLOAD_CONCURRENCY, async (descriptor) => {
        const cacheFile = path.join(this.cacheRoot, descriptorKey(descriptor));
        let ready = await tryVerifiedFile(cacheFile, descriptor);
        if (!ready) {
          await fs.rm(cacheFile, { force: true });
          for (const seedRoot of this.seedCacheRoots) {
            const candidate = childPath(seedRoot, descriptor.relativePath, 'Seed cache artifact');
            if (await copyVerified(candidate, cacheFile, descriptor)) { ready = true; break; }
          }
        }
        if (!ready && descriptor.source) ready = await copyVerified(descriptor.source, cacheFile, descriptor);
        if (!ready && descriptor.inlineBytes) {
          if (descriptor.inlineBytes.length !== descriptor.size || hashBytes(descriptor.inlineBytes, descriptor.algorithm) !== descriptor.digest) {
            throw new Error(`Verified metadata changed before provisioning ${descriptor.kind}`);
          }
          await fs.writeFile(cacheFile, descriptor.inlineBytes, { flag: 'wx', mode: 0o600 });
          ready = true;
        }
        if (!ready && descriptor.url) {
          const hosts = descriptor.kind === 'asset' ? ASSET_HOSTS : descriptor.kind === 'fabric-library' || descriptor.kind === 'mod' ? FABRIC_HOSTS : descriptor.kind === 'library' || descriptor.kind === 'native-jar' ? LIBRARY_HOSTS : descriptor.kind === 'client' || descriptor.kind === 'logging' ? MOJANG_DATA_HOSTS : METADATA_HOSTS;
          const bytes = await fetchBytes(this.fetcher, descriptor.url, hosts, `Client artifact ${descriptor.kind}`, descriptor.size, descriptor.algorithm, descriptor.digest);
          await fs.writeFile(cacheFile, bytes, { flag: 'wx', mode: 0o600 });
          ready = true;
        }
        if (!ready || !await tryVerifiedFile(cacheFile, descriptor)) throw new Error(`Could not prepare verified client artifact ${descriptor.kind}`);
        const destination = childPath(staging, descriptor.relativePath, 'Client artifact destination');
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(cacheFile, destination, fs.constants.COPYFILE_EXCL);
        if (!await tryVerifiedFile(destination, descriptor)) throw new Error(`Published client artifact ${descriptor.kind} failed verification`);
      });
      const natives = path.join(staging, 'natives');
      await fs.mkdir(natives, { recursive: true });
      const extractedNatives = [];
      for (const relativePath of resolved.nativePaths) extractedNatives.push(...await extractNativeJarDetailed(childPath(staging, relativePath, 'Native JAR'), natives));
      const installedAt = this.now().toISOString();
      const manifest = {
        schemaVersion: 1, projectId: 'family-ai-client', serverProjectId: 'family-server', kind: 'client', platform: 'windows-x64',
        minecraftVersion: resolved.minecraftVersion, updateChannel: 'latest-release', loaderVersion: resolved.loaderVersion,
        javaRuntime: safeRuntimeMetadata(runtime), installedAt, artifactCount: all.length, nativeFiles: extractedNatives.length,
        artifacts: all.map((artifact) => ({ kind: artifact.kind, relativePath: artifact.relativePath, size: artifact.size, algorithm: artifact.algorithm, digest: artifact.digest })),
        natives: extractedNatives,
      };
      const privateInstallManifest = { ...manifest, javaExecutable: runtime.executable, clientDirectory: this.clientRoot };
      await fs.writeFile(path.join(staging, 'install.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await fs.mkdir(path.dirname(this.privateManifest), { recursive: true });
      const privateStaging = `${this.privateManifest}.staging-${crypto.randomUUID()}`;
      assertScopedChild(path.dirname(this.privateManifest), privateStaging, 'Private manifest staging file');
      try {
        await fs.writeFile(privateStaging, `${JSON.stringify(privateInstallManifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        await atomicPublish(staging, this.clientRoot, 'Managed Family client');
        try { await atomicPublish(privateStaging, this.privateManifest, 'Private Family client manifest'); }
        catch (error) {
          await fs.rm(this.clientRoot, { recursive: true, force: true });
          throw error;
        }
      } finally {
        await fs.rm(privateStaging, { force: true });
      }
      return this.status();
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async status() {
    try {
      return (await this.verifyInstalled()).status;
    } catch {
      const [clientExists, privateExists] = await Promise.all([exists(this.clientRoot), exists(this.privateManifest)]);
      return {
        projectId: 'family-ai-client', kind: 'client', state: clientExists || privateExists ? 'invalid' : 'not-installed', integrity: clientExists || privateExists ? 'failed' : 'not-installed',
        minecraftVersion: '26.2', loader: { name: 'Fabric Loader', version: '0.19.3' }, requiredJavaMajor: 25,
        installedAt: null, artifactCount: 0, nativeFiles: 0, launchReady: false, launchesClient: false, authenticationConfigured: false,
      };
    }
  }

  async verifyInstalled() {
    const lock = await readLock(this.lockFile);
    const marker = await readManagedJson(path.join(this.clientRoot, 'install.json'), MAX_MANIFEST_BYTES, 'Family client install marker');
    const privateManifest = await readManagedJson(this.privateManifest, MAX_MANIFEST_BYTES, 'Private Family client manifest');
    const commonFields = ['schemaVersion', 'projectId', 'serverProjectId', 'kind', 'platform', 'minecraftVersion', 'updateChannel', 'loaderVersion', 'javaRuntime', 'installedAt', 'artifactCount', 'nativeFiles', 'artifacts', 'natives'];
    exactObject(marker, 'Family client install marker', commonFields);
    exactObject(privateManifest, 'Private Family client manifest', [...commonFields, 'javaExecutable', 'clientDirectory']);
    if (
      marker.schemaVersion !== 1 || marker.projectId !== 'family-ai-client' || marker.serverProjectId !== 'family-server'
      || marker.kind !== 'client' || marker.platform !== 'windows-x64' || marker.minecraftVersion !== lock.minecraft.version
      || marker.updateChannel !== 'latest-release' || marker.loaderVersion !== lock.fabric.loaderVersion
      || typeof marker.installedAt !== 'string' || new Date(marker.installedAt).toISOString() !== marker.installedAt
      || privateManifest.clientDirectory !== this.clientRoot
    ) throw new Error('Family client install manifest identity was invalid');
    const { javaExecutable, clientDirectory, ...privateCommon } = privateManifest;
    if (JSON.stringify(privateCommon) !== JSON.stringify(marker)) throw new Error('Public and private Family client manifests disagreed');
    if (typeof javaExecutable !== 'string' || !path.isAbsolute(javaExecutable)) throw new Error('Private Family client manifest had no absolute Java executable');
    const runtimeRoot = path.join(this.managedRoot, 'runtimes');
    const relativeJava = path.relative(runtimeRoot, path.resolve(javaExecutable));
    if (!relativeJava || relativeJava === '..' || relativeJava.startsWith(`..${path.sep}`) || path.isAbsolute(relativeJava)) throw new Error('Private Family client Java executable escaped managed runtimes');
    exactObject(
      marker.javaRuntime,
      'Family client Java runtime',
      ['component', 'major', 'version', 'vendor', 'managed', 'source', 'platform', 'manifestSha1', 'binarySha1', 'binarySize', 'installedAt'],
      ['inventorySha256', 'inventoryFileCount'],
    );
    const hasRuntimeInventoryDigest = Object.hasOwn(marker.javaRuntime, 'inventorySha256');
    const hasRuntimeInventoryCount = Object.hasOwn(marker.javaRuntime, 'inventoryFileCount');
    if (
      marker.javaRuntime.component !== lock.minecraft.java.component || marker.javaRuntime.major !== lock.minecraft.java.major
      || marker.javaRuntime.managed !== true || marker.javaRuntime.platform !== 'windows-x64'
      || !SHA1.test(marker.javaRuntime.binarySha1 ?? '') || !validSize(marker.javaRuntime.binarySize)
      || hasRuntimeInventoryDigest !== hasRuntimeInventoryCount
      || (hasRuntimeInventoryDigest && (!SHA256.test(marker.javaRuntime.inventorySha256 ?? '')
        || !Number.isSafeInteger(marker.javaRuntime.inventoryFileCount)
        || marker.javaRuntime.inventoryFileCount < 1 || marker.javaRuntime.inventoryFileCount > MAX_NATIVE_ENTRIES + 8192))
    ) throw new Error('Family client Java runtime did not match the lock');
    const javaDigest = await hashFile(javaExecutable, 'sha1', marker.javaRuntime.binarySize, MAX_ARTIFACT_BYTES, 'Managed Family client Java executable');
    if (javaDigest !== marker.javaRuntime.binarySha1) throw new Error('Managed Family client Java executable failed integrity verification');

    const versionPath = childPath(this.clientRoot, `versions/${lock.minecraft.version}/${lock.minecraft.version}.json`, 'Installed Minecraft version JSON');
    const profilePath = childPath(this.clientRoot, `versions/${lock.fabric.profile.id}/${lock.fabric.profile.id}.json`, 'Installed Fabric profile');
    const assetIndexPath = childPath(this.clientRoot, `assets/indexes/${lock.minecraft.assetIndex.id}.json`, 'Installed Minecraft asset index');
    for (const [file, descriptor, algorithm, label] of [
      [versionPath, lock.minecraft.versionJson, 'sha1', 'Installed Minecraft version JSON'],
      [profilePath, lock.fabric.profile, 'sha256', 'Installed Fabric profile'],
      [assetIndexPath, lock.minecraft.assetIndex, 'sha1', 'Installed Minecraft asset index'],
    ]) {
      if (await hashFile(file, algorithm, descriptor.size, MAX_JSON_BYTES, label) !== descriptor[algorithm]) throw new Error(`${label} failed lock verification`);
    }
    const versionJson = parseJson(await fs.readFile(versionPath), 'Installed Minecraft version JSON');
    const fabricProfile = parseJson(await fs.readFile(profilePath), 'Installed Fabric profile');
    const assetIndex = parseJson(await fs.readFile(assetIndexPath), 'Installed Minecraft asset index');
    validateFabricProfile(fabricProfile, lock);
    const expected = expectedInstalledArtifacts(lock, versionJson, assetIndex);
    if (!Array.isArray(marker.artifacts) || marker.artifacts.length !== expected.artifacts.length || marker.artifactCount !== expected.artifacts.length) throw new Error('Family client install manifest had an incomplete artifact set');
    for (let index = 0; index < expected.artifacts.length; index += 1) {
      exactObject(marker.artifacts[index], 'Installed artifact record', ['kind', 'relativePath', 'size', 'algorithm', 'digest']);
      if (!sameArtifact(marker.artifacts[index], expected.artifacts[index])) throw new Error('Family client install manifest disagreed with the audited lock');
    }
    await concurrentMap(expected.artifacts, DOWNLOAD_CONCURRENCY, async (artifact) => {
      const target = childPath(this.clientRoot, artifact.relativePath, 'Installed client artifact');
      const actual = await hashFile(target, artifact.algorithm, artifact.size, MAX_ARTIFACT_BYTES, `Installed client artifact ${artifact.kind}`);
      if (actual !== artifact.digest) throw new Error(`Installed client artifact ${artifact.kind} failed integrity verification`);
    });

    if (!Array.isArray(marker.natives) || marker.natives.length !== marker.nativeFiles || marker.natives.length > MAX_NATIVE_ENTRIES) throw new Error('Family client native manifest was invalid');
    const expectedManagedFiles = new Set(expected.artifacts.map((artifact) => artifact.relativePath.toLowerCase()));
    const nativeRecords = new Map();
    for (const native of marker.natives) {
      exactObject(native, 'Installed native record', ['relativePath', 'size', 'sha256']);
      const relativePath = safeRelative(native.relativePath, 'Installed native record');
      if (!validSize(native.size, MAX_NATIVE_ENTRY_BYTES) || !SHA256.test(native.sha256) || nativeRecords.has(relativePath.toLowerCase())) throw new Error('Family client native manifest was invalid');
      nativeRecords.set(relativePath.toLowerCase(), native);
      expectedManagedFiles.add(`natives/${relativePath}`.toLowerCase());
      const target = childPath(path.join(this.clientRoot, 'natives'), relativePath, 'Installed native');
      if (await hashFile(target, 'sha256', native.size, MAX_NATIVE_ENTRY_BYTES, 'Installed native') !== native.sha256) throw new Error('Installed native failed integrity verification');
    }
    const actualManagedFiles = [];
    for (const managedDirectory of ['versions', 'libraries', 'assets', 'mods', 'bootstrap', 'natives']) {
      for (const relativePath of await collectRelativeFiles(path.join(this.clientRoot, managedDirectory))) actualManagedFiles.push(`${managedDirectory}/${relativePath}`.toLowerCase());
    }
    const actualManagedFileSet = new Set(actualManagedFiles);
    const runtimeSkinCacheFiles = actualManagedFiles.filter((value) => !expectedManagedFiles.has(value));
    if (
      [...expectedManagedFiles].some((value) => !actualManagedFileSet.has(value))
      || runtimeSkinCacheFiles.length > MAX_SKIN_CACHE_FILES
      || runtimeSkinCacheFiles.some((value) => !isRuntimeSkinCacheFile(value))
    ) throw new Error('Managed Family client contained untrusted executable or asset files');
    await concurrentMap(runtimeSkinCacheFiles, DOWNLOAD_CONCURRENCY, async (relativePath) => {
      const target = childPath(this.clientRoot, relativePath, 'Runtime skin cache file');
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || !validSize(stat.size, MAX_SKIN_CACHE_BYTES)) {
        throw new Error('Managed Family client contained an invalid runtime skin cache file');
      }
    });

    const status = Object.freeze({
      projectId: 'family-ai-client', kind: 'client', state: 'installed', integrity: 'verified', minecraftVersion: lock.minecraft.version,
      loader: { name: 'Fabric Loader', version: lock.fabric.loaderVersion }, requiredJavaMajor: lock.minecraft.java.major,
      installedAt: marker.installedAt, artifactCount: marker.artifactCount, nativeFiles: marker.nativeFiles,
      launchReady: false, launchesClient: false, authenticationConfigured: false,
    });
    const classpathKinds = new Set(['bootstrap', 'client', 'library', 'native-jar', 'fabric-library']);
    const classpath = Object.freeze(expected.artifacts.filter((artifact) => classpathKinds.has(artifact.kind)).map((artifact) => childPath(this.clientRoot, artifact.relativePath, 'Verified launch classpath')));
    const runtimeNatives = Object.freeze({
      root: path.join(this.clientRoot, 'runtime-natives'),
      jna: path.join(this.clientRoot, 'runtime-natives', 'jna'),
      lwjgl: path.join(this.clientRoot, 'runtime-natives', 'lwjgl'),
      netty: path.join(this.clientRoot, 'runtime-natives', 'netty'),
    });
    const launchArgumentsDirectory = path.join(this.clientRoot, 'runtime-launch');
    const loggingConfiguration = childPath(this.clientRoot, `assets/log_configs/${lock.minecraft.logging.id}`, 'Verified logging configuration');
    const bridgeVersion = lock.mods.local.find((mod) => mod.id === 'mastermind-family-agent-bridge')?.version;
    const baritoneVersion = lock.mods.local.find((mod) => mod.id === 'baritone')?.version;
    if (!bridgeVersion || !baritoneVersion) throw new Error('Family client lock omitted launch manifest versions');
    const jvmArguments = Object.freeze([
      '-Xms512m', '-Xmx2048m',
      '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump',
      '--sun-misc-unsafe-memory-access=allow', '--enable-native-access=ALL-UNNAMED',
      `-Djava.library.path=${path.join(this.clientRoot, 'natives')}`,
      `-Djna.tmpdir=${runtimeNatives.jna}`,
      `-Dorg.lwjgl.system.SharedLibraryExtractPath=${runtimeNatives.lwjgl}`,
      `-Dio.netty.native.workdir=${runtimeNatives.netty}`,
      `-Dlog4j.configurationFile=${loggingConfiguration}`,
      '-Dminecraft.launcher.brand=Mastermind', '-Dminecraft.launcher.version=0.1.0',
      `-Dmastermind.family.versionJson.sha1=${lock.minecraft.versionJson.sha1}`,
      `-Dmastermind.family.fabricProfile.sha256=${lock.fabric.profile.sha256}`,
      `-Dmastermind.family.bootstrap.sha256=${lock.bootstrap.sha256}`,
      FABRIC_JVM_ARGUMENT,
    ]);
    const bootstrapArguments = Object.freeze([
      '--game-dir', this.clientRoot,
      '--assets-dir', path.join(this.clientRoot, 'assets'),
      '--asset-index', lock.minecraft.assetIndex.id,
      '--version', lock.fabric.profile.id,
      '--version-type', 'Mastermind',
    ]);
    const profile = Object.freeze({
      projectId: 'family-ai-client', serverProjectId: 'family-server', kind: 'client', platform: 'windows-x64',
      minecraftVersion: lock.minecraft.version, loaderVersion: lock.fabric.loaderVersion, javaMajor: lock.minecraft.java.major,
      javaExecutable, clientDirectory: this.clientRoot, assetsDirectory: path.join(this.clientRoot, 'assets'), nativesDirectory: path.join(this.clientRoot, 'natives'),
      runtimeNatives, launchArgumentsDirectory, loggingConfiguration,
      assetIndexId: lock.minecraft.assetIndex.id, versionId: lock.fabric.profile.id,
      mainClass: lock.bootstrap.mainClass, classpath, jvmArguments, bootstrapArguments,
      versionManifest: Object.freeze({ clientId: 'family-ai-client', bridgeVersion, minecraftVersion: lock.minecraft.version, loaderVersion: lock.fabric.loaderVersion, baritoneVersion }),
      verifiedMetadata: Object.freeze({ versionJsonSha1: lock.minecraft.versionJson.sha1, fabricProfileSha256: lock.fabric.profile.sha256, bootstrapSha256: lock.bootstrap.sha256 }),
      launchPrepared: false, authentication: null,
    });
    return Object.freeze({ ok: true, status, profile });
  }

  async internalLaunchProfile() {
    const profile = (await this.verifyInstalled()).profile;
    const runtimeNatives = await resetRuntimeNativeDirectories(this.managedRoot, this.clientRoot);
    const launchArgumentsDirectory = await resetLaunchArgumentsDirectory(this.managedRoot, this.clientRoot);
    return Object.freeze({ ...profile, runtimeNatives, launchArgumentsDirectory, launchPrepared: true });
  }

  internalProfileDescription(status) {
    if (!status || status.projectId !== 'family-ai-client' || status.state !== 'installed' || status.integrity !== 'verified') throw new Error('A verified installed Family AI client is required');
    return Object.freeze({
      projectId: 'family-ai-client', serverProjectId: 'family-server', kind: 'client', platform: 'windows-x64',
      minecraftVersion: '26.2', loaderVersion: '0.19.3', javaMajor: 25,
      mainClass: 'com.mastermind.minecraft.familyclientbootstrap.FamilyClientBootstrap',
      bootstrapClasspath: ['bootstrap/family-client-bootstrap-0.1.0.jar'],
      launchPrepared: false,
    });
  }
}

export const __test = Object.freeze({ validateLock, validateManifestEntry, validateVersionJson, validateFabricProfile, validateAssetIndex, rulesAllow, zipEntries, extractNativeJar, safeRelative, lockFile: LOCK_FILE, minecraftRoot: MINECRAFT_ROOT });
