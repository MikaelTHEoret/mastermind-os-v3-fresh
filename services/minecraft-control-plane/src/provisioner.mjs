import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireLaunchIntegrityKey } from './integrity-key-continuity.mjs';
import { JavaRuntimeManager, safeRuntimeMetadata } from './runtime-manager.mjs';
import { FAMILY_SERVER_MANAGED_ARTIFACTS } from './update-manager.mjs';
import {
  inspectVerifiedMinecraftServerJar,
  materializeVerifiedMinecraftServerBundle,
  minecraftServerRelativePath,
} from './minecraft-server-version.mjs';

const USER_AGENT = 'Mastermind-Minecraft-Control/0.2 (family server manager)';
const MOJANG_VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MODRINTH_PROJECTS = Object.freeze({
  fabricApi: 'P7dR8mSH',
  geyser: 'wKkoqHrH',
  floodgate: 'bWrNNfkb',
});
const MAX_RELEASE_CANDIDATES = 20;
const MODRINTH_DOWNLOAD_HOSTS = new Set(['cdn.modrinth.com']);
const FABRIC_DOWNLOAD_HOSTS = new Set(['meta.fabricmc.net']);
const FABRIC_MAVEN_HOSTS = new Set(['maven.fabricmc.net']);
const MOJANG_DOWNLOAD_HOSTS = new Set(['piston-data.mojang.com', 'launcher.mojang.com']);
const MAX_MOD_BYTES = 128 * 1024 * 1024;
const MAX_SERVER_JAR_BYTES = 128 * 1024 * 1024;
const MAX_FABRIC_LIBRARIES = 128;
const MAX_LAUNCH_FILES = 4096;
const MAX_BUNDLE_ENTRIES = 50_000;
const MAX_BUNDLE_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_BUNDLE_LIST_BYTES = 1024 * 1024;
const MAX_LAUNCH_INVENTORY_BYTES = 8 * 1024 * 1024;
const GEYSER_CONFIG_PATH = 'config/Geyser-Fabric/config.yml';
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._+\-]{0,95}$/;
const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const SHA512 = /^[a-f0-9]{128}$/i;
const JAVA_CLASS = /^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)+[A-Za-z_$][A-Za-z0-9_$]*$/;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

async function request(fetcher, url, timeoutMs) {
  const response = await fetcher(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/java-archive, */*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Download request failed (${response.status})`);
  return response;
}

async function jsonRequest(fetcher, url) {
  return (await request(fetcher, url, 30_000)).json();
}

function stableFabricVersion(values) {
  if (!Array.isArray(values)) return null;
  const stable = values.find((item) => item?.loader?.stable === true || item?.stable === true);
  return stable?.loader?.version ?? stable?.version ?? null;
}

function requiredHash(file) {
  if (file?.hashes?.sha512) return { algorithm: 'sha512', value: file.hashes.sha512 };
  if (file?.hashes?.sha1) return { algorithm: 'sha1', value: file.hashes.sha1 };
  throw new Error(`Modrinth did not provide an integrity hash for ${file?.filename ?? 'an artifact'}`);
}

function selectVersion(values, allowedTypes = ['release']) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) {
    throw new TypeError('At least one Modrinth release type must be allowed');
  }
  const version = allowedTypes
    .map((type) => values.find((item) => item?.version_type === type))
    .find(Boolean);
  if (!version) return null;
  const file = version?.files?.find((item) => item.primary) ?? version?.files?.[0];
  if (!file?.url || !file?.filename) return null;
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_MOD_BYTES) {
    throw new Error(`Modrinth returned an invalid artifact size for ${file.filename}`);
  }
  return {
    versionId: version.id,
    versionNumber: version.version_number,
    versionType: version.version_type,
    file: { filename: file.filename, url: file.url, expected: requiredHash(file), expectedSize: file.size },
  };
}

async function modrinthVersion(fetcher, projectId, minecraftVersion, allowedTypes = ['release']) {
  const query = new URLSearchParams({
    loaders: JSON.stringify(['fabric']),
    game_versions: JSON.stringify([minecraftVersion]),
  });
  return selectVersion(
    await jsonRequest(fetcher, `https://api.modrinth.com/v2/project/${projectId}/version?${query}`),
    allowedTypes,
  );
}

export async function resolveLatestCompatibleFamilyRelease(fetcher = fetch, currentMinecraftVersion = null) {
  const manifest = await jsonRequest(fetcher, MOJANG_VERSION_MANIFEST);
  const latestMinecraftVersion = manifest?.latest?.release;
  if (typeof latestMinecraftVersion !== 'string' || !latestMinecraftVersion) {
    throw new Error('Mojang did not identify a latest stable Minecraft release');
  }
  const releaseEntries = Array.isArray(manifest.versions)
    ? manifest.versions.filter((item) => item?.type === 'release' && typeof item?.id === 'string')
    : [];
  const uniqueCandidates = new Map();
  const latestEntry = releaseEntries.find((item) => item.id === latestMinecraftVersion);
  if (latestEntry) uniqueCandidates.set(latestEntry.id, latestEntry);
  for (const entry of releaseEntries) uniqueCandidates.set(entry.id, entry);
  const candidates = [...uniqueCandidates.values()].slice(0, MAX_RELEASE_CANDIDATES);
  if (candidates.length === 0 || candidates[0].id !== latestMinecraftVersion) {
    throw new Error(`Mojang omitted metadata for its latest stable release ${latestMinecraftVersion}`);
  }

  for (const candidate of candidates) {
    const minecraftVersion = candidate.id;
    if (!VERSION.test(minecraftVersion)) throw new Error('Mojang returned an unsafe Minecraft release identifier');
    const loaderUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`;
    const [loaders, fabricApi, geyser, floodgate] = await Promise.all([
      jsonRequest(fetcher, loaderUrl),
      modrinthVersion(fetcher, MODRINTH_PROJECTS.fabricApi, minecraftVersion, ['release']),
      // Canonical Geyser builds are commonly labelled beta on Modrinth.
      modrinthVersion(fetcher, MODRINTH_PROJECTS.geyser, minecraftVersion, ['release', 'beta']),
      modrinthVersion(fetcher, MODRINTH_PROJECTS.floodgate, minecraftVersion, ['release']),
    ]);
    const loaderVersion = stableFabricVersion(loaders);
    if (!loaderVersion || !fabricApi || !geyser || !floodgate) continue;
    const metadataUrl = checkedMojangVersionUrl(candidate.url, minecraftVersion);
    const versionMetadata = await jsonRequest(fetcher, metadataUrl);
    if (versionMetadata?.id !== minecraftVersion) throw new Error(`Mojang returned mismatched metadata for Minecraft ${minecraftVersion}`);
    const requiredJavaMajor = versionMetadata?.javaVersion?.majorVersion;
    const javaRuntimeComponent = versionMetadata?.javaVersion?.component;
    if (!Number.isInteger(requiredJavaMajor) || requiredJavaMajor < 8 || requiredJavaMajor > 99) {
      throw new Error(`Mojang did not declare a valid Java generation for Minecraft ${minecraftVersion}`);
    }
    if (typeof javaRuntimeComponent !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+\-]{0,79}$/.test(javaRuntimeComponent)) {
      throw new Error(`Mojang did not declare a valid Java runtime component for Minecraft ${minecraftVersion}`);
    }
    const minecraftServerArtifact = checkedMojangServerArtifact(versionMetadata?.downloads?.server, minecraftVersion);
    const installerVersion = stableFabricVersion(await jsonRequest(fetcher, 'https://meta.fabricmc.net/v2/versions/installer'));
    if (!installerVersion) throw new Error('Fabric did not return a stable installer version');
    const fabricLaunch = await fabricServerLaunchMetadata(fetcher, minecraftVersion, loaderVersion);
    return {
      projectId: 'family-server',
      updateChannel: 'latest-compatible',
      latestMinecraftVersion,
      minecraftVersion,
      minecraftReleaseTime: typeof candidate.releaseTime === 'string' && Number.isFinite(Date.parse(candidate.releaseTime))
        ? new Date(candidate.releaseTime).toISOString()
        : null,
      minecraftDirection: releaseDirection(releaseEntries, currentMinecraftVersion, minecraftVersion),
      isLatestRelease: minecraftVersion === latestMinecraftVersion,
      requiredJavaMajor,
      javaRuntimeComponent,
      loaderVersion,
      installerVersion,
      fabricLaunch,
      minecraftServerArtifact,
      components: { fabricApi, geyser, floodgate },
    };
  }
  throw new Error(`No complete Fabric/Geyser/Floodgate stack supports Minecraft ${latestMinecraftVersion} or a recent stable release`);
}

function checkedMojangServerArtifact(value, minecraftVersion) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !SHA1.test(value.sha1 ?? '') || !Number.isInteger(value.size) || value.size < 1 || value.size > MAX_SERVER_JAR_BYTES) {
    throw new Error(`Mojang did not provide trusted server artifact metadata for Minecraft ${minecraftVersion}`);
  }
  const sha1 = value.sha1.toLowerCase();
  const url = checkedArtifactUrl(value.url, MOJANG_DOWNLOAD_HOSTS);
  if (url.port || url.search || url.hash || url.pathname !== `/v1/objects/${sha1}/server.jar`) {
    throw new Error(`Mojang returned an unexpected server artifact URL for Minecraft ${minecraftVersion}`);
  }
  return { minecraftVersion, relativePath: minecraftServerRelativePath(minecraftVersion), url: url.href, size: value.size, sha1 };
}

function releaseDirection(releaseEntries, currentMinecraftVersion, targetMinecraftVersion) {
  if (currentMinecraftVersion == null || currentMinecraftVersion === targetMinecraftVersion) return 'same';
  if (typeof currentMinecraftVersion !== 'string') return 'unknown';
  const currentIndex = releaseEntries.findIndex((entry) => entry.id === currentMinecraftVersion);
  const targetIndex = releaseEntries.findIndex((entry) => entry.id === targetMinecraftVersion);
  if (currentIndex < 0 || targetIndex < 0) return 'unknown';
  return targetIndex < currentIndex ? 'upgrade' : 'downgrade';
}

function checkedMojangVersionUrl(value, minecraftVersion) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`Mojang omitted the version metadata URL for Minecraft ${minecraftVersion}`); }
  if (url.protocol !== 'https:' || !['piston-meta.mojang.com', 'launchermeta.mojang.com'].includes(url.hostname)) {
    throw new Error(`Mojang returned an unexpected version metadata host for Minecraft ${minecraftVersion}`);
  }
  return url;
}

function checkedArtifactUrl(value, allowedHosts) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('Artifact download URL was invalid'); }
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password) {
    throw new Error(`Artifact download host '${url.hostname || 'unknown'}' is not allowed`);
  }
  return url;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safePortableRelative(value, label) {
  if (typeof value !== 'string' || !value || value !== value.normalize('NFC') || value.includes('\\')
    || value.includes('\0') || path.posix.isAbsolute(value) || /^[A-Za-z]:/u.test(value)) {
    throw new Error(`${label} contains an unsafe path`);
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ')
    || /[:<>"|?*\x00-\x1f\x7f-\x9f]/u.test(part) || WINDOWS_DEVICE.test(part))) {
    throw new Error(`${label} contains an unsafe path`);
  }
  return value;
}

function containedLaunchPath(root, relativePath, label) {
  const safe = safePortableRelative(relativePath, label);
  const target = path.resolve(root, ...safe.split('/'));
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped its launch root`);
  }
  return target;
}

function mavenArtifact(value) {
  if (typeof value !== 'string' || value.length > 240) throw new Error('Fabric launch metadata contains an invalid Maven coordinate');
  const parts = value.split(':');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._+\-]{0,95}$/.test(part))) {
    throw new Error('Fabric launch metadata contains an unsupported Maven coordinate');
  }
  const [group, artifact, version] = parts;
  const relativePath = `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}.jar`;
  safePortableRelative(relativePath, 'Fabric library');
  return { name: value, relativePath };
}

async function fabricServerLaunchMetadata(fetcher, minecraftVersion, loaderVersion) {
  const raw = await jsonRequest(fetcher,
    `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion)}/server/json`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || raw.id !== `fabric-loader-${loaderVersion}-${minecraftVersion}` || raw.inheritsFrom !== minecraftVersion
    || !JAVA_CLASS.test(raw.mainClass ?? '') || !Array.isArray(raw.libraries)
    || raw.libraries.length < 1 || raw.libraries.length > MAX_FABRIC_LIBRARIES) {
    throw new Error('Fabric returned invalid server launch metadata');
  }
  const names = new Set();
  const paths = new Set();
  const libraries = raw.libraries.map((library) => {
    const coordinate = mavenArtifact(library?.name);
    if (names.has(coordinate.name) || paths.has(coordinate.relativePath.toLocaleLowerCase('en-US'))) {
      throw new Error('Fabric server launch metadata contains a duplicate library');
    }
    names.add(coordinate.name);
    paths.add(coordinate.relativePath.toLocaleLowerCase('en-US'));
    const base = checkedArtifactUrl(library?.url, FABRIC_MAVEN_HOSTS);
    if (base.port || base.search || base.hash || base.pathname !== '/') {
      throw new Error('Fabric library base URL is not canonical');
    }
    const url = new URL(coordinate.relativePath, base);
    checkedArtifactUrl(url, FABRIC_MAVEN_HOSTS);
    if (url.pathname !== `/${coordinate.relativePath}` || url.search || url.hash) {
      throw new Error('Fabric library URL is not canonical');
    }
    const sha256 = library.sha256 == null ? null : String(library.sha256).toLowerCase();
    const sha512 = library.sha512 == null ? null : String(library.sha512).toLowerCase();
    const size = library.size == null ? null : library.size;
    if ((sha256 !== null && !SHA256.test(sha256)) || (sha512 !== null && !SHA512.test(sha512))
      || (size !== null && (!Number.isInteger(size) || size < 1 || size > MAX_SERVER_JAR_BYTES))) {
      throw new Error('Fabric library integrity metadata is invalid');
    }
    return { ...coordinate, url: url.href, sha256, sha512, size };
  });
  const normalized = { mainClass: raw.mainClass, libraries };
  return { ...normalized, metadataSha256: crypto.createHash('sha256').update(canonicalJson(normalized), 'utf8').digest('hex') };
}

async function download(fetcher, value, destination, expected, policy) {
  const url = checkedArtifactUrl(value, policy.allowedHosts);
  const response = await request(fetcher, url, 300_000);
  if (response.url) checkedArtifactUrl(response.url, policy.allowedHosts);
  const declaredHeader = response.headers.get('content-length');
  const declaredSize = declaredHeader === null ? null : Number(declaredHeader);
  if (Number.isFinite(declaredSize) && declaredSize > policy.maxBytes) throw new Error(`Artifact ${path.basename(destination)} exceeded its size limit`);
  if (Number.isInteger(policy.expectedSize) && Number.isFinite(declaredSize) && declaredSize !== policy.expectedSize) {
    throw new Error(`Artifact ${path.basename(destination)} size did not match metadata`);
  }
  if (!response.body) throw new Error(`Artifact ${path.basename(destination)} returned no body`);

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const file = await fs.open(destination, 'wx');
  const integrity = expected ? crypto.createHash(expected.algorithm) : null;
  const sha256 = crypto.createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > policy.maxBytes) throw new Error(`Artifact ${path.basename(destination)} exceeded its size limit`);
      integrity?.update(bytes);
      sha256.update(bytes);
      await file.write(bytes);
    }
    if (Number.isInteger(policy.expectedSize) && size !== policy.expectedSize) {
      throw new Error(`Artifact ${path.basename(destination)} size did not match metadata`);
    }
    if (expected && integrity.digest('hex') !== expected.value.toLowerCase()) {
      throw new Error(`Integrity check failed for ${path.basename(destination)}`);
    }
    return {
      fileName: path.basename(destination),
      sha256: sha256.digest('hex'),
      size,
      source: url.hostname,
    };
  } catch (error) {
    await file.close();
    await fs.rm(destination, { force: true });
    throw error;
  } finally {
    await file.close().catch(() => undefined);
  }
}

function sha256Value(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function boundedDirectoryEntries(directory, maximumEntries) {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 0) throw new TypeError('Invalid directory entry bound');
  const handle = await fs.opendir(directory);
  const entries = [];
  try {
    while (true) {
      const entry = await handle.read();
      if (!entry) break;
      if (entries.length >= maximumEntries) throw new Error('Managed directory exceeded its safe entry bound');
      entries.push(entry);
    }
    return entries;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function hashLocalFile(file, maximumBytes = MAX_SERVER_JAR_BYTES) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > maximumBytes) {
    throw new Error(`Launch artifact ${path.basename(file)} is not a trusted regular file`);
  }
  const bytes = await fs.readFile(file);
  return { sha256: sha256Value(bytes), size: bytes.length };
}

async function exactLaunchAssetTree(root, files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_LAUNCH_FILES) return false;
  const expected = new Map(files.map((entry) => [entry.relativePath, entry]));
  const observed = new Set();
  const queue = [{ directory: root, relativePath: '' }];
  let count = 0;
  while (queue.length) {
    const current = queue.shift();
    let children;
    try { children = await boundedDirectoryEntries(current.directory, (MAX_LAUNCH_FILES * 3) - count); } catch { return false; }
    for (const child of children) {
      count += 1;
      if (count > MAX_LAUNCH_FILES * 3) return false;
      const relativePath = current.relativePath ? `${current.relativePath}/${child.name}` : child.name;
      let target;
      try { target = containedLaunchPath(root, relativePath, 'Launch artifact tree'); } catch { return false; }
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) return false;
      if (stat.isDirectory()) {
        queue.push({ directory: target, relativePath });
        continue;
      }
      const entry = expected.get(relativePath);
      if (!entry || !stat.isFile() || stat.nlink !== 1 || stat.size !== entry.size) return false;
      if ((await hashLocalFile(target, MAX_SERVER_JAR_BYTES)).sha256 !== entry.sha256) return false;
      observed.add(relativePath);
    }
  }
  return observed.size === expected.size;
}

async function materializeLaunchAssets(dataRoot, fetcher, resolved, officialServerPath, minecraftServerArtifact) {
  if (!resolved?.fabricLaunch || !Array.isArray(resolved.fabricLaunch.libraries)) {
    throw new Error('Resolved release omitted the exact Fabric launch inventory');
  }
  const assetParent = path.join(dataRoot, 'state', 'launch-artifacts');
  const staging = path.join(assetParent, `.staging-${crypto.randomUUID()}`);
  await fs.mkdir(staging, { recursive: true });
  try {
    const fabricFiles = [];
    for (const library of resolved.fabricLaunch.libraries) {
      const relativePath = `fabric/libraries/${library.relativePath}`;
      const expected = library.sha512
        ? { algorithm: 'sha512', value: library.sha512 }
        : library.sha256 ? { algorithm: 'sha256', value: library.sha256 } : null;
      const result = await download(fetcher, library.url, containedLaunchPath(staging, relativePath, 'Fabric launch library'), expected, {
        allowedHosts: FABRIC_MAVEN_HOSTS,
        maxBytes: MAX_SERVER_JAR_BYTES,
        expectedSize: library.size,
      });
      fabricFiles.push({ relativePath, sha256: result.sha256, size: result.size, coordinate: library.name });
    }
    const bundle = await materializeVerifiedMinecraftServerBundle(officialServerPath, minecraftServerArtifact, staging);
    const files = [
      ...fabricFiles,
      { ...bundle.gameJar, role: 'minecraft-game-jar' },
      ...bundle.libraries.map((entry) => ({ ...entry, role: 'minecraft-library' })),
    ].map((entry) => ({
      relativePath: safePortableRelative(entry.relativePath, 'Launch asset inventory'),
      sha256: entry.sha256,
      size: entry.size,
      ...(entry.coordinate ? { coordinate: entry.coordinate } : {}),
      ...(entry.id ? { coordinate: entry.id } : {}),
      ...(entry.role ? { role: entry.role } : {}),
    })).sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en-US'));
    if (files.length < 2 || files.length > MAX_LAUNCH_FILES
      || files.some((entry) => !SHA256.test(entry.sha256) || !Number.isInteger(entry.size) || entry.size < 1)) {
      throw new Error('Complete launch asset inventory could not be constructed');
    }
    const fileNames = new Set();
    for (const entry of files) {
      const canonicalName = entry.relativePath.toLocaleLowerCase('en-US');
      if (fileNames.has(canonicalName)) throw new Error('Launch asset inventory contains a path collision');
      fileNames.add(canonicalName);
    }
    const identity = {
      schemaVersion: 1,
      minecraftVersion: resolved.minecraftVersion,
      loaderVersion: resolved.loaderVersion,
      fabricMetadataSha256: resolved.fabricLaunch.metadataSha256,
      mainClass: resolved.fabricLaunch.mainClass,
      outerServerSha256: bundle.outerSha256,
      files,
    };
    const digest = sha256Value(Buffer.from(canonicalJson(identity), 'utf8'));
    const destination = path.join(assetParent, digest);
    if (await exists(destination)) {
      if (!await exactLaunchAssetTree(destination, files)) {
        await fs.rm(destination, { recursive: true, force: true });
        await fs.rename(staging, destination);
      } else {
        await fs.rm(staging, { recursive: true, force: true });
      }
    } else {
      await fs.rename(staging, destination);
    }
    if (!await exactLaunchAssetTree(destination, files)) throw new Error('Published launch asset tree failed exact verification');
    const toAssetRelative = (value) => safePortableRelative(value, 'Launch command asset');
    return {
      schemaVersion: 1,
      digest,
      relativeRoot: `state/launch-artifacts/${digest}`,
      mainClass: resolved.fabricLaunch.mainClass,
      fabricClasspath: fabricFiles.map((entry) => toAssetRelative(entry.relativePath)),
      gameJar: toAssetRelative(bundle.gameJar.relativePath),
      gameLibraries: bundle.libraries.map((entry) => toAssetRelative(entry.relativePath)),
      files,
      fabricMetadataSha256: resolved.fabricLaunch.metadataSha256,
      outerServerSha256: bundle.outerSha256,
    };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

function normalizedRuntimeInventory(dataRoot, runtime) {
  if (!Array.isArray(runtime?.files) || runtime.files.length < 1 || runtime.files.length > MAX_LAUNCH_FILES
    || !Array.isArray(runtime.directories) || !SHA256.test(runtime.inventorySha256 ?? '')) {
    throw new Error('Managed Java runtime omitted its complete authenticated file inventory');
  }
  const runtimeDirectory = path.dirname(path.dirname(path.resolve(runtime.executable)));
  const relativeRoot = path.relative(path.resolve(dataRoot), runtimeDirectory).split(path.sep).join('/');
  safePortableRelative(relativeRoot, 'Managed Java runtime root');
  const files = runtime.files.map((entry) => {
    safePortableRelative(entry.relativePath, 'Managed Java runtime inventory');
    if (entry.type !== 'file' || !SHA1.test(entry.sha1 ?? '') || !SHA256.test(entry.sha256 ?? '')
      || !Number.isInteger(entry.size) || entry.size < 0) throw new Error('Managed Java runtime inventory is invalid');
    return { relativePath: entry.relativePath, sha1: entry.sha1.toLowerCase(), sha256: entry.sha256.toLowerCase(), size: entry.size };
  });
  return {
    relativeRoot,
    executableRelativePath: 'bin/java.exe',
    inventorySha256: runtime.inventorySha256,
    files,
    directories: [...runtime.directories],
  };
}

async function writeAuthenticatedLaunchInventory(dataRoot, inventory, integrityKeyOptions = {}) {
  const encoded = Buffer.from(canonicalJson(inventory), 'utf8');
  if (encoded.length < 2 || encoded.length > MAX_LAUNCH_INVENTORY_BYTES) throw new Error('Launch inventory exceeded its safe size');
  const digest = sha256Value(encoded);
  const inventoryRoot = path.join(dataRoot, 'state', 'launch-inventories');
  const ensureInventoryRoot = async () => {
    try { await fs.mkdir(inventoryRoot, { mode: 0o700 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(inventoryRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Launch inventory root is not a regular managed directory');
  };
  const callerCanCreate = integrityKeyOptions.assertCanCreate;
  const keyLease = await acquireLaunchIntegrityKey(dataRoot, {
    ...integrityKeyOptions,
    createIfMissing: true,
    assertCanCreate: async () => {
      if (typeof callerCanCreate === 'function') await callerCanCreate();
      await ensureInventoryRoot();
      try { await boundedDirectoryEntries(inventoryRoot, 0); }
      catch (error) {
        if (/entry bound/.test(error?.message ?? '')) throw new Error('Launch integrity key continuity was lost');
        throw error;
      }
    },
  });
  try {
    await keyLease.assertHeld();
    await ensureInventoryRoot();
    await keyLease.guardStateDirectory(inventoryRoot);
    const wrapper = {
      schemaVersion: 1,
      inventory,
      mac: crypto.createHmac('sha256', keyLease.key).update(encoded).digest('hex'),
    };
    const file = path.join(inventoryRoot, `${digest}.json`);
    const serialized = `${JSON.stringify(wrapper, null, 2)}\n`;
    try { await fs.writeFile(file, serialized, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw new Error('Authenticated launch inventory destination is occupied');
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== Buffer.byteLength(serialized)
        || await fs.readFile(file, 'utf8') !== serialized) {
        throw new Error('Authenticated launch inventory destination is occupied');
      }
    }
    const published = await fs.lstat(file);
    if (!published.isFile() || published.isSymbolicLink() || published.nlink !== 1
      || published.size !== Buffer.byteLength(serialized) || await fs.readFile(file, 'utf8') !== serialized) {
      throw new Error('Authenticated launch inventory publication failed verification');
    }
    await keyLease.assertHeld();
    return { digest, relativePath: `state/launch-inventories/${digest}.json` };
  } finally {
    await keyLease.release();
  }
}

async function createLaunchInventory({ dataRoot, instanceId, resolved, runtime, launchAssets, minecraftServerArtifact, artifacts, integrityKeyOptions }) {
  if (typeof instanceId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(instanceId)) {
    throw new Error('Launch inventory instance binding is invalid');
  }
  const effectiveInstanceFiles = artifacts
    .filter((entry) => entry.fileName !== GEYSER_CONFIG_PATH)
    .map((entry) => ({ relativePath: safePortableRelative(entry.fileName, 'Effective instance artifact'), sha256: entry.sha256, size: entry.size }));
  effectiveInstanceFiles.push({
    relativePath: minecraftServerArtifact.relativePath,
    sha256: minecraftServerArtifact.sha256,
    size: minecraftServerArtifact.size,
  });
  effectiveInstanceFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en-US'));
  const runtimeInventory = normalizedRuntimeInventory(dataRoot, runtime);
  const inventory = {
    schemaVersion: 1,
    instanceId,
    stack: {
      projectId: 'family-server',
      kind: 'server',
      minecraftVersion: resolved.minecraftVersion,
      loaderVersion: resolved.loaderVersion,
      installerVersion: resolved.installerVersion,
      minecraftServerArtifact,
      components: Object.fromEntries(Object.entries(resolved.components).map(([name, component]) => [name, {
        versionId: component.versionId,
        versionNumber: component.versionNumber,
        versionType: component.versionType,
        sourceHash: component.file.expected,
      }])),
      runtime: {
        component: runtime.component,
        major: runtime.major,
        version: runtime.version,
        platform: runtime.platform,
        manifestSha1: runtime.manifestSha1,
        inventorySha256: runtime.inventorySha256,
      },
      launchAssetDigest: launchAssets.digest,
    },
    runtime: runtimeInventory,
    launchAssets,
    instanceFiles: effectiveInstanceFiles,
    exactMutableTrees: {
      mods: 'authenticated-family-mod-manifest-plus-core-only',
      libraries: 'absent',
      fabric: 'absent',
      versions: [minecraftServerArtifact.relativePath],
    },
  };
  return writeAuthenticatedLaunchInventory(dataRoot, inventory, integrityKeyOptions);
}

function publicCatalog(resolved) {
  return {
    projectId: resolved.projectId,
    updateChannel: resolved.updateChannel,
    latestMinecraftVersion: resolved.latestMinecraftVersion,
    minecraftVersion: resolved.minecraftVersion,
    minecraftReleaseTime: resolved.minecraftReleaseTime,
    isLatestRelease: resolved.isLatestRelease,
    requiredJavaMajor: resolved.requiredJavaMajor,
    javaRuntimeComponent: resolved.javaRuntimeComponent,
    loader: { name: 'Fabric Loader', version: resolved.loaderVersion },
    components: {
      fabricApi: { name: 'Fabric API', version: resolved.components.fabricApi.versionNumber, versionType: resolved.components.fabricApi.versionType },
      geyser: { name: 'Geyser-Fabric', version: resolved.components.geyser.versionNumber, versionType: resolved.components.geyser.versionType },
      floodgate: { name: 'Floodgate-Fabric', version: resolved.components.floodgate.versionNumber, versionType: resolved.components.floodgate.versionType },
    },
  };
}

function sameComponentPlan(installed, resolved) {
  return installed?.minecraftVersion === resolved.minecraftVersion
    && installed?.minecraftServerArtifact?.minecraftVersion === resolved.minecraftServerArtifact.minecraftVersion
    && installed?.minecraftServerArtifact?.relativePath === resolved.minecraftServerArtifact.relativePath
    && installed?.minecraftServerArtifact?.size === resolved.minecraftServerArtifact.size
    && installed?.minecraftServerArtifact?.sha1 === resolved.minecraftServerArtifact.sha1
    && Number.isSafeInteger(installed?.minecraftServerArtifact?.worldDataVersion)
    && installed.minecraftServerArtifact.worldDataVersion > 0
    && installed?.worldDataVersion === installed.minecraftServerArtifact.worldDataVersion
    && SHA256.test(installed?.minecraftServerArtifact?.sha256 ?? '')
    && installed?.loaderVersion === resolved.loaderVersion
    && installed?.components?.fabricApi?.versionId === resolved.components.fabricApi.versionId
    && installed?.components?.geyser?.versionId === resolved.components.geyser.versionId
    && installed?.components?.floodgate?.versionId === resolved.components.floodgate.versionId
    && SHA256.test(installed?.javaRuntime?.launchAssetDigest ?? '')
    && SHA256.test(installed?.javaRuntime?.launchInventoryDigest ?? '');
}

function geyserConfiguration(bedrockPort) {
  return [
    '# Managed by Mastermind for the isolated family server.',
    'bedrock:',
    '  address: 0.0.0.0',
    `  port: ${bedrockPort}`,
    '  clone-remote-port: false',
    'java:',
    '  auth-type: floodgate',
    'advanced:',
    '  bedrock:',
    '    broadcast-port: 0',
    '    validate-bedrock-login: true',
    'config-version: 5',
    '',
  ].join('\n');
}

export class ServerProvisioner {
  constructor(dataRoot, store, fetcher = fetch, options = {}) {
    this.dataRoot = path.resolve(dataRoot);
    this.store = store;
    this.fetcher = fetcher;
    this.runtimeManager = options.runtimeManager ?? new JavaRuntimeManager(path.join(this.dataRoot, 'runtimes'), fetcher, options.runtimeOptions);
    this.integrityKeyOptions = options.integrityKeyOptions ?? {};
    if (!this.integrityKeyOptions || typeof this.integrityKeyOptions !== 'object' || Array.isArray(this.integrityKeyOptions)) {
      throw new TypeError('integrityKeyOptions must be an object');
    }
    this.queue = Promise.resolve();
    this.catalogCache = null;
  }

  async catalog(maxAgeMs = 5 * 60 * 1000) {
    if (this.catalogCache && Date.now() - this.catalogCache.at < maxAgeMs) {
      return publicCatalog(this.catalogCache.value);
    }
    const value = await resolveLatestCompatibleFamilyRelease(this.fetcher);
    this.catalogCache = { at: Date.now(), value };
    return publicCatalog(value);
  }

  async provision(input) {
    const operation = this.queue.then(() => this.#provision(input));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async updateStatus(instance) {
    const resolved = await resolveLatestCompatibleFamilyRelease(this.fetcher, instance.minecraftVersion);
    this.catalogCache = { at: Date.now(), value: resolved };
    const checkedAt = new Date().toISOString();
    if (instance.minecraftVersion === resolved.minecraftVersion) {
      return {
        state: sameComponentPlan(instance, resolved) ? 'current' : 'component-update-available',
        currentMinecraft: instance.minecraftVersion,
        targetMinecraft: resolved.minecraftVersion,
        requiresApproval: false,
        checkedAt,
      };
    }
    if (instance.minecraftVersion === resolved.latestMinecraftVersion && resolved.minecraftVersion !== resolved.latestMinecraftVersion) {
      return {
        state: 'waiting-for-compatible-stack',
        currentMinecraft: instance.minecraftVersion,
        targetMinecraft: resolved.minecraftVersion,
        requiresApproval: false,
        checkedAt,
      };
    }
    return {
      state: 'minecraft-update-approval-required',
      currentMinecraft: instance.minecraftVersion,
      targetMinecraft: resolved.minecraftVersion,
      requiresApproval: true,
      checkedAt,
    };
  }

  async resolveUpdateTarget(instance) {
    return resolveLatestCompatibleFamilyRelease(this.fetcher, instance?.minecraftVersion);
  }

  async prepareUpdateCandidate({ instance, target, candidateDirectory, transactionId }) {
    if (!instance || instance.projectId !== 'family-server' || instance.kind !== 'server') {
      throw new TypeError('Only a trusted Family Server instance can be prepared for update');
    }
    if (!target || target.projectId !== 'family-server' || target.updateChannel !== 'latest-compatible') {
      throw new TypeError('Update target is outside the Family Server release channel');
    }
    if (typeof transactionId !== 'string' || !/^[a-f0-9-]{36,80}$/i.test(transactionId)) {
      throw new TypeError('Invalid update transaction id');
    }
    const serverRoot = path.join(this.dataRoot, 'servers');
    const candidate = path.resolve(candidateDirectory);
    const relativeCandidate = path.relative(serverRoot, candidate);
    if (
      !relativeCandidate || relativeCandidate.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCandidate)
      || !path.basename(candidate).startsWith(`.${instance.id}-candidate-`)
    ) throw new TypeError('Update candidate is outside the managed server staging boundary');

    const runtime = await this.runtimeManager.ensure(target.requiredJavaMajor, target.javaRuntimeComponent);
    if (typeof runtime?.executable !== 'string' || !path.isAbsolute(runtime.executable)) {
      throw new Error('Managed Java runtime did not return an absolute executable path');
    }
    if (runtime.major !== target.requiredJavaMajor || runtime.component !== target.javaRuntimeComponent) {
      throw new Error('Managed Java runtime did not match the update target');
    }
    const baseRuntime = safeRuntimeMetadata(runtime);
    const modsDirectory = path.join(candidate, 'mods');
    await fs.mkdir(modsDirectory, { recursive: true });
    await removeManagedModJars(modsDirectory);
    await fs.rm(path.join(candidate, 'fabric-server-launch.jar'), { force: true });
    const officialRelativePath = minecraftServerRelativePath(target.minecraftVersion);
    if (target.minecraftServerArtifact?.relativePath !== officialRelativePath) {
      throw new Error('Update target omitted the canonical Mojang server artifact path');
    }
    const officialServerPath = path.join(candidate, ...officialRelativePath.split('/'));
    await fs.mkdir(path.dirname(officialServerPath), { recursive: true });
    await fs.rm(officialServerPath, { force: true });

    const componentSpecs = [
      ['fabricApi', 'mods/fabric-api.jar'],
      ['geyser', 'mods/geyser-fabric.jar'],
      ['floodgate', 'mods/floodgate-fabric.jar'],
    ];
    const componentResults = await Promise.all(componentSpecs.map(([name, relativePath]) => {
      const component = target.components?.[name];
      if (!component?.file) throw new Error(`Update target omitted ${name} artifact metadata`);
      return download(this.fetcher, component.file.url, path.join(candidate, ...relativePath.split('/')), component.file.expected, {
        allowedHosts: MODRINTH_DOWNLOAD_HOSTS,
        maxBytes: MAX_MOD_BYTES,
        expectedSize: component.file.expectedSize,
      }).then((artifact) => ({ ...artifact, relativePath }));
    }));
    const serverUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(target.minecraftVersion)}/${encodeURIComponent(target.loaderVersion)}/${encodeURIComponent(target.installerVersion)}/server/jar`;
    const serverJar = await download(this.fetcher, serverUrl, path.join(candidate, 'fabric-server-launch.jar'), null, {
      allowedHosts: FABRIC_DOWNLOAD_HOSTS,
      maxBytes: MAX_SERVER_JAR_BYTES,
    });
    const officialDownload = await download(
      this.fetcher,
      target.minecraftServerArtifact.url,
      officialServerPath,
      { algorithm: 'sha1', value: target.minecraftServerArtifact.sha1 },
      { allowedHosts: MOJANG_DOWNLOAD_HOSTS, maxBytes: MAX_SERVER_JAR_BYTES, expectedSize: target.minecraftServerArtifact.size },
    );
    const minecraftServerArtifact = await inspectVerifiedMinecraftServerJar(officialServerPath, {
      minecraftVersion: target.minecraftVersion,
      size: target.minecraftServerArtifact.size,
      sha1: target.minecraftServerArtifact.sha1,
      sha256: officialDownload.sha256,
    });
    const geyserConfig = Buffer.from(geyserConfiguration(instance.bedrockPort ?? 19132), 'utf8');
    const geyserConfigPath = path.join(candidate, 'config', 'Geyser-Fabric', 'config.yml');
    await fs.mkdir(path.dirname(geyserConfigPath), { recursive: true });
    await fs.rm(geyserConfigPath, { force: true });
    await fs.writeFile(geyserConfigPath, geyserConfig, { flag: 'wx' });

    const componentManifest = Object.fromEntries(componentSpecs.map(([name]) => [name, {
      versionId: target.components[name].versionId,
      versionNumber: target.components[name].versionNumber,
      versionType: target.components[name].versionType,
      sourceHash: target.components[name].file.expected,
    }]));
    const artifacts = [
      { ...serverJar, fileName: 'fabric-server-launch.jar' },
      ...componentResults.map((artifact) => ({ ...artifact, fileName: artifact.relativePath })),
      { fileName: GEYSER_CONFIG_PATH, sha256: crypto.createHash('sha256').update(geyserConfig).digest('hex'), size: geyserConfig.length, source: 'mastermind' },
    ];
    const launchAssets = await materializeLaunchAssets(this.dataRoot, this.fetcher, target, officialServerPath, minecraftServerArtifact);
    const launchInventory = await createLaunchInventory({
      dataRoot: this.dataRoot,
      instanceId: instance.id,
      resolved: target,
      runtime,
      launchAssets,
      minecraftServerArtifact,
      artifacts,
      integrityKeyOptions: this.integrityKeyOptions,
    });
    const publicRuntime = {
      ...baseRuntime,
      launchAssetDigest: launchAssets.digest,
      launchInventoryDigest: launchInventory.digest,
    };
    const now = new Date().toISOString();
    const privateManifest = {
      schemaVersion: 3,
      id: instance.id,
      displayName: instance.displayName,
      projectId: 'family-server',
      kind: 'server',
      updateChannel: 'latest-compatible',
      minecraftVersion: target.minecraftVersion,
      worldDataVersion: minecraftServerArtifact.worldDataVersion,
      minecraftServerArtifact,
      latestMinecraftVersion: target.latestMinecraftVersion,
      minecraftReleaseTime: target.minecraftReleaseTime,
      requiredJavaMajor: target.requiredJavaMajor,
      javaRuntimeComponent: target.javaRuntimeComponent,
      javaRuntime: publicRuntime,
      javaExecutable: runtime.executable,
      loader: 'fabric',
      loaderVersion: target.loaderVersion,
      installerVersion: target.installerVersion,
      memoryMb: instance.memoryMb,
      javaPort: instance.javaPort,
      bedrockPort: instance.bedrockPort ?? 19132,
      components: componentManifest,
      createdAt: instance.createdAt ?? now,
      updatedAt: now,
      transactionId,
      artifacts,
    };
    const privateManifestPath = path.join(candidate, 'instance.json');
    await fs.rm(privateManifestPath, { force: true });
    await fs.writeFile(privateManifestPath, `${JSON.stringify(privateManifest, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });

    const managedArtifacts = [
      { relativePath: 'fabric-server-launch.jar', sha256: serverJar.sha256 },
      ...componentResults.map((artifact) => ({ relativePath: artifact.relativePath, sha256: artifact.sha256 })),
      { relativePath: 'config/Geyser-Fabric/config.yml', sha256: crypto.createHash('sha256').update(geyserConfig).digest('hex') },
    ];
    if (
      managedArtifacts.length !== FAMILY_SERVER_MANAGED_ARTIFACTS.length
      || managedArtifacts.some((artifact) => !FAMILY_SERVER_MANAGED_ARTIFACTS.includes(artifact.relativePath))
    ) throw new Error('Prepared update artifact set did not match the Family Server policy');
    return { recordPatch: {
      javaExecutable: runtime.executable,
      javaRuntime: publicRuntime,
      worldDataVersion: minecraftServerArtifact.worldDataVersion,
      minecraftServerArtifact,
    }, managedArtifacts };
  }

  async #provision(input) {
    const serverRoot = path.join(this.dataRoot, 'servers');
    const destination = path.join(serverRoot, input.instanceId);
    const staging = path.join(serverRoot, `.${input.instanceId}-staging-${crypto.randomUUID()}`);
    const existing = await this.store.list();
    if (existing.some((item) => item.id === input.instanceId) || await exists(destination)) throw new Error(`Instance '${input.instanceId}' already exists`);
    if (existing.some((item) => item.projectId === 'family-server' && item.bedrockPort === 19132)) {
      throw new Error('The PS4-discoverable family server already reserves Bedrock UDP port 19132');
    }
    const usedPorts = new Set(existing.map((item) => item.javaPort ?? item.serverPort).filter(Number.isInteger));
    const javaPort = Array.from({ length: 100 }, (_, index) => 25565 + index).find((port) => !usedPorts.has(port));
    const bedrockPort = 19132;
    if (!javaPort) throw new Error('No managed Minecraft Java server ports are available');
    await fs.mkdir(serverRoot, { recursive: true });
    await fs.mkdir(staging, { recursive: true });
    let published = false;
    try {
      const resolved = await resolveLatestCompatibleFamilyRelease(this.fetcher);
      this.catalogCache = { at: Date.now(), value: resolved };
      const runtime = await this.runtimeManager.ensure(resolved.requiredJavaMajor, resolved.javaRuntimeComponent);
      if (typeof runtime?.executable !== 'string' || !path.isAbsolute(runtime.executable)) {
        throw new Error('Managed Java runtime did not return an absolute executable path');
      }
      if (runtime.major !== resolved.requiredJavaMajor || runtime.component !== resolved.javaRuntimeComponent) {
        throw new Error('Managed Java runtime did not match Minecraft release metadata');
      }
      const baseRuntime = safeRuntimeMetadata(runtime);
      const modsDirectory = path.join(staging, 'mods');
      await fs.mkdir(modsDirectory, { recursive: true });

      const componentResults = await Promise.allSettled([
        download(this.fetcher, resolved.components.fabricApi.file.url, path.join(modsDirectory, 'fabric-api.jar'), resolved.components.fabricApi.file.expected, {
          allowedHosts: MODRINTH_DOWNLOAD_HOSTS, maxBytes: MAX_MOD_BYTES, expectedSize: resolved.components.fabricApi.file.expectedSize,
        }),
        download(this.fetcher, resolved.components.geyser.file.url, path.join(modsDirectory, 'geyser-fabric.jar'), resolved.components.geyser.file.expected, {
          allowedHosts: MODRINTH_DOWNLOAD_HOSTS, maxBytes: MAX_MOD_BYTES, expectedSize: resolved.components.geyser.file.expectedSize,
        }),
        download(this.fetcher, resolved.components.floodgate.file.url, path.join(modsDirectory, 'floodgate-fabric.jar'), resolved.components.floodgate.file.expected, {
          allowedHosts: MODRINTH_DOWNLOAD_HOSTS, maxBytes: MAX_MOD_BYTES, expectedSize: resolved.components.floodgate.file.expectedSize,
        }),
      ]);
      const failedDownload = componentResults.find((result) => result.status === 'rejected');
      if (failedDownload?.status === 'rejected') throw failedDownload.reason;
      const componentDownloads = componentResults.map((result) => result.status === 'fulfilled' ? result.value : null).filter(Boolean);
      const serverUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(resolved.minecraftVersion)}/${encodeURIComponent(resolved.loaderVersion)}/${encodeURIComponent(resolved.installerVersion)}/server/jar`;
      const serverJar = await download(this.fetcher, serverUrl, path.join(staging, 'fabric-server-launch.jar'), null, {
        allowedHosts: FABRIC_DOWNLOAD_HOSTS, maxBytes: MAX_SERVER_JAR_BYTES,
      });
      const officialRelativePath = minecraftServerRelativePath(resolved.minecraftVersion);
      if (resolved.minecraftServerArtifact.relativePath !== officialRelativePath) {
        throw new Error('Resolved release omitted the canonical Mojang server artifact path');
      }
      const officialServerPath = path.join(staging, ...officialRelativePath.split('/'));
      const officialDownload = await download(
        this.fetcher,
        resolved.minecraftServerArtifact.url,
        officialServerPath,
        { algorithm: 'sha1', value: resolved.minecraftServerArtifact.sha1 },
        { allowedHosts: MOJANG_DOWNLOAD_HOSTS, maxBytes: MAX_SERVER_JAR_BYTES, expectedSize: resolved.minecraftServerArtifact.size },
      );
      const minecraftServerArtifact = await inspectVerifiedMinecraftServerJar(officialServerPath, {
        minecraftVersion: resolved.minecraftVersion,
        size: resolved.minecraftServerArtifact.size,
        sha1: resolved.minecraftServerArtifact.sha1,
        sha256: officialDownload.sha256,
      });
      const geyserConfig = Buffer.from(geyserConfiguration(bedrockPort), 'utf8');
      await fs.mkdir(path.join(staging, 'config', 'Geyser-Fabric'), { recursive: true });
      await fs.mkdir(path.join(staging, 'world'), { mode: 0o700 });
      await fs.writeFile(path.join(staging, 'config', 'Geyser-Fabric', 'config.yml'), geyserConfig);
      await fs.writeFile(path.join(staging, 'eula.txt'), 'eula=true\n', 'utf8');
      await fs.writeFile(
        path.join(staging, 'server.properties'),
        `online-mode=true\nserver-ip=\nserver-port=${javaPort}\nlevel-name=world\nmotd=Mastermind Family Server\ndifficulty=peaceful\nview-distance=10\n`,
        'utf8',
      );
      const now = new Date().toISOString();
      const componentManifest = {
        fabricApi: { versionId: resolved.components.fabricApi.versionId, versionNumber: resolved.components.fabricApi.versionNumber, versionType: resolved.components.fabricApi.versionType, sourceHash: resolved.components.fabricApi.file.expected },
        geyser: { versionId: resolved.components.geyser.versionId, versionNumber: resolved.components.geyser.versionNumber, versionType: resolved.components.geyser.versionType, sourceHash: resolved.components.geyser.file.expected },
        floodgate: { versionId: resolved.components.floodgate.versionId, versionNumber: resolved.components.floodgate.versionNumber, versionType: resolved.components.floodgate.versionType, sourceHash: resolved.components.floodgate.file.expected },
      };
      const artifacts = [
        { ...serverJar, fileName: 'fabric-server-launch.jar' },
        { ...componentDownloads[0], fileName: 'mods/fabric-api.jar' },
        { ...componentDownloads[1], fileName: 'mods/geyser-fabric.jar' },
        { ...componentDownloads[2], fileName: 'mods/floodgate-fabric.jar' },
        {
          fileName: GEYSER_CONFIG_PATH,
          sha256: crypto.createHash('sha256').update(geyserConfig).digest('hex'),
          size: geyserConfig.length,
          source: 'mastermind',
        },
      ];
      const launchAssets = await materializeLaunchAssets(this.dataRoot, this.fetcher, resolved, officialServerPath, minecraftServerArtifact);
      const launchInventory = await createLaunchInventory({
        dataRoot: this.dataRoot,
        instanceId: input.instanceId,
        resolved,
        runtime,
        launchAssets,
        minecraftServerArtifact,
        artifacts,
        integrityKeyOptions: this.integrityKeyOptions,
      });
      const publicRuntime = {
        ...baseRuntime,
        launchAssetDigest: launchAssets.digest,
        launchInventoryDigest: launchInventory.digest,
      };
      const manifest = {
        schemaVersion: 3,
        id: input.instanceId,
        displayName: input.displayName,
        projectId: 'family-server',
        kind: 'server',
        updateChannel: 'latest-compatible',
        minecraftVersion: resolved.minecraftVersion,
        worldDataVersion: minecraftServerArtifact.worldDataVersion,
        minecraftServerArtifact,
        latestMinecraftVersion: resolved.latestMinecraftVersion,
        minecraftReleaseTime: resolved.minecraftReleaseTime,
        requiredJavaMajor: resolved.requiredJavaMajor,
        javaRuntimeComponent: resolved.javaRuntimeComponent,
        javaRuntime: publicRuntime,
        javaExecutable: runtime.executable,
        loader: 'fabric',
        loaderVersion: resolved.loaderVersion,
        installerVersion: resolved.installerVersion,
        memoryMb: input.memoryMb,
        javaPort,
        bedrockPort,
        components: componentManifest,
        createdAt: now,
        artifacts,
      };
      await fs.writeFile(path.join(staging, 'instance.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(staging, destination);
      published = true;
      const record = {
        id: input.instanceId,
        displayName: input.displayName,
        projectId: 'family-server',
        kind: 'server',
        updateChannel: 'latest-compatible',
        minecraftVersion: resolved.minecraftVersion,
        worldDataVersion: minecraftServerArtifact.worldDataVersion,
        minecraftServerArtifact,
        latestMinecraftVersion: resolved.latestMinecraftVersion,
        minecraftReleaseTime: resolved.minecraftReleaseTime,
        requiredJavaMajor: resolved.requiredJavaMajor,
        javaRuntimeComponent: resolved.javaRuntimeComponent,
        javaRuntime: publicRuntime,
        // Private local state. agent.mjs strips this before every browser response.
        javaExecutable: runtime.executable,
        loader: 'fabric',
        loaderVersion: resolved.loaderVersion,
        installerVersion: resolved.installerVersion,
        memoryMb: input.memoryMb,
        javaPort,
        serverPort: javaPort,
        bedrockPort,
        components: componentManifest,
        artifacts: manifest.artifacts,
        directory: destination,
        provisioningStatus: 'ready',
        status: 'stopped',
        pid: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.create(record);
      return record;
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      if (published) await fs.rm(destination, { recursive: true, force: true });
      throw error;
    }
  }
}

async function removeManagedModJars(modsDirectory) {
  const entries = await boundedDirectoryEntries(modsDirectory, 500);
  const managedName = /^(?:fabric-api|geyser-fabric|floodgate-fabric)(?:-[a-z0-9][a-z0-9._+\-]*)?\.jar$/i;
  for (const entry of entries) {
    if (!managedName.test(entry.name)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Managed mod artifact '${entry.name}' is not a regular file`);
    await fs.rm(path.join(modsDirectory, entry.name), { force: true });
  }
}

async function exists(target) {
  try { await fs.access(target); return true; }
  catch { return false; }
}
