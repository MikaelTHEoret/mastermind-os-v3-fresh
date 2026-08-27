import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const USER_AGENT = 'Mastermind-Minecraft-Control/0.2 (managed Mojang Java runtime)';
const MOJANG_RUNTIME_INDEX = 'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const METADATA_HOSTS = new Set(['piston-meta.mojang.com', 'launchermeta.mojang.com']);
const DATA_HOSTS = new Set(['piston-data.mojang.com', 'launcher.mojang.com']);
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_FILE_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_RUNTIME_FILE_BYTES = 200 * 1024 * 1024;
const MAX_RUNTIME_BYTES = 300 * 1024 * 1024;
const MAX_RUNTIME_ENTRIES = 4096;
const MAX_RUNTIME_MARKER_BYTES = 4 * 1024 * 1024;
const MAX_JAVA_OUTPUT_BYTES = 64 * 1024;
const DOWNLOAD_CONCURRENCY = 6;

function run(executable, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch { reject(new Error('Managed Java inspection could not be started')); return; }
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let timer;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* The sanitized failure is authoritative. */ }
      reject(new Error(message));
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const collect = (target, chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_JAVA_OUTPUT_BYTES) return fail('Managed Java inspection output exceeded its safe limit');
      if (target === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));
    timer = setTimeout(() => fail('Managed Java inspection timed out'), timeoutMs);
    child.once('error', () => fail('Managed Java inspection could not be started'));
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('Managed Java inspection failed'));
      resolve({ stdout, stderr });
    });
  });
}

export async function inspectJava(executable) {
  if (typeof executable !== 'string' || !path.isAbsolute(executable) || executable.includes('\0') || executable.length > 30_000) {
    throw new TypeError('Managed Java inspection requires an absolute executable path');
  }
  const { stdout, stderr } = await run(executable, ['-version']);
  const output = `${stderr}\n${stdout}`;
  const match = output.match(/version\s+"(?:1\.)?(\d+)(?:[._+\-][^"]*)?"/i)
    ?? output.match(/openjdk\s+(\d+)(?:[._+\-]\S*)?/i);
  if (!match) throw new Error('Could not determine the managed Java version');
  const major = Number(match[1]);
  if (!Number.isSafeInteger(major) || major < 1 || major > 99) throw new Error('Could not determine the managed Java version');
  return { major, version: String(major) };
}

function sha1(bytes) {
  return crypto.createHash('sha1').update(bytes).digest('hex');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checkedUrl(value, allowedHosts, label) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`${label} was not a valid URL`); }
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
    throw new Error(`${label} used an unexpected download host`);
  }
  return url;
}

async function fetchBytes(fetcher, value, allowedHosts, label, maxBytes, timeoutMs) {
  const url = checkedUrl(value, allowedHosts, label);
  const response = await fetcher(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/octet-stream, */*' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`${label} request failed (${response.status})`);
  if (response.url) checkedUrl(response.url, allowedHosts, `${label} response`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error(`${label} exceeded the size limit`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`${label} exceeded the size limit`);
  return bytes;
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`${label} was not valid JSON`); }
}

function runtimePlatform(platform, arch) {
  if (platform === 'win32' && arch === 'x64') return 'windows-x64';
  throw new Error('Automatic Mojang Java runtime provisioning currently supports Windows x64 only');
}

function validIdentifier(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._+\-]{0,79}$/.test(value);
}

function safeChild(root, relativePath) {
  if (
    typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0') ||
    relativePath.includes('\\') || path.posix.isAbsolute(relativePath)
  ) throw new Error('Mojang runtime manifest contained an unsafe path');
  const parts = relativePath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[:<>"|?*]/.test(part))) {
    throw new Error('Mojang runtime manifest contained an unsafe path');
  }
  const target = path.resolve(root, ...parts);
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Mojang runtime manifest path escaped its installation root');
  }
  return target;
}

function validateRuntimeRelativePath(relativePath) {
  // Use a synthetic absolute root only to apply the same containment and
  // Windows-name policy without depending on the host platform's cwd.
  safeChild(path.resolve('runtime-inventory-root'), relativePath);
  if (relativePath !== relativePath.normalize('NFC')) {
    throw new Error('Mojang runtime manifest contained an ambiguous path');
  }
  return relativePath;
}

function assertScopedRemoval(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to remove a runtime path outside the managed runtime root');
  }
}

function validateDigestAndSize(bytes, descriptor, label) {
  if (!Number.isInteger(descriptor?.size) || descriptor.size < 0 || descriptor.size > MAX_RUNTIME_FILE_BYTES) {
    throw new Error(`${label} had an invalid size`);
  }
  if (bytes.length !== descriptor.size) throw new Error(`${label} size did not match Mojang metadata`);
  if (typeof descriptor.sha1 !== 'string' || !/^[a-f0-9]{40}$/i.test(descriptor.sha1)) {
    throw new Error(`${label} did not include a valid SHA-1 digest`);
  }
  if (sha1(bytes) !== descriptor.sha1.toLowerCase()) throw new Error(`${label} failed SHA-1 verification`);
}

async function concurrentMap(values, concurrency, operation) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      await operation(values[index], index);
    }
  });
  await Promise.all(workers);
}

async function boundedDirectoryEntries(directory, maximumEntries) {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 0) throw new TypeError('Invalid runtime directory bound');
  const handle = await fs.opendir(directory);
  const entries = [];
  try {
    while (true) {
      const entry = await handle.read();
      if (!entry) break;
      if (entries.length >= maximumEntries) throw new Error('Managed Java runtime exceeded its safe entry bound');
      entries.push(entry);
    }
    return entries;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function safeRuntimeMetadata(runtime) {
  return {
    component: runtime.component,
    major: runtime.major,
    version: runtime.version,
    vendor: runtime.vendor,
    managed: runtime.managed === true,
    source: runtime.source,
    platform: runtime.platform,
    manifestSha1: runtime.manifestSha1,
    binarySha1: runtime.executableSha1,
    binarySize: runtime.executableSize,
    inventorySha256: runtime.inventorySha256,
    inventoryFileCount: runtime.files?.length,
    installedAt: runtime.installedAt,
  };
}

function normalizeRuntimeInventory(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_RUNTIME_ENTRIES) {
    throw new Error('Mojang Java file manifest exceeded the runtime inventory limit');
  }
  const normalized = [];
  const names = new Set();
  for (const [relativePath, entry] of files) {
    validateRuntimeRelativePath(relativePath);
    const canonicalName = relativePath.normalize('NFC').toLocaleLowerCase('en-US');
    if (relativePath !== relativePath.normalize('NFC') || names.has(canonicalName)) {
      throw new Error('Mojang Java file manifest contained an ambiguous path');
    }
    names.add(canonicalName);
    if (entry?.type === 'directory') {
      normalized.push({ relativePath, type: 'directory' });
      continue;
    }
    if (entry?.type !== 'file') throw new Error(`Mojang Java file manifest used unsupported entry type '${entry?.type ?? 'unknown'}'`);
    const raw = entry?.downloads?.raw;
    if (
      typeof raw?.url !== 'string' || typeof raw?.sha1 !== 'string' || !/^[a-f0-9]{40}$/i.test(raw.sha1)
      || !Number.isInteger(raw?.size) || raw.size < 0 || raw.size > MAX_RUNTIME_FILE_BYTES
    ) throw new Error(`Mojang returned invalid file metadata for ${relativePath}`);
    checkedUrl(raw.url, DATA_HOSTS, `Mojang runtime file ${relativePath}`);
    normalized.push({
      relativePath,
      type: 'file',
      sha1: raw.sha1.toLowerCase(),
      size: raw.size,
      url: raw.url,
    });
  }
  return normalized.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en-US'));
}

function runtimeInventoryDigest(files, directories = []) {
  const normalizedFiles = files.map((entry) => {
    if (entry.type === 'directory') return entry;
    return { relativePath: entry.relativePath, type: entry.type, sha1: entry.sha1, sha256: entry.sha256, size: entry.size };
  });
  return crypto.createHash('sha256').update(canonicalJson({ directories, files: normalizedFiles }), 'utf8').digest('hex');
}

function validateInstalledRuntimeInventory(marker) {
  if (!Array.isArray(marker.files) || marker.files.length < 1 || marker.files.length > MAX_RUNTIME_ENTRIES
    || !Array.isArray(marker.directories) || marker.directories.length > MAX_RUNTIME_ENTRIES) return false;
  const names = new Set();
  const fileNames = new Set();
  const directoryNames = new Set();
  let lastFile = null;
  for (const entry of marker.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || entry.type !== 'file' || !/^[a-f0-9]{40}$/.test(entry.sha1 ?? '')
      || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')
      || !Number.isInteger(entry.size) || entry.size < 0 || entry.size > MAX_RUNTIME_FILE_BYTES) return false;
    try { validateRuntimeRelativePath(entry.relativePath); } catch { return false; }
    const canonicalName = entry.relativePath.toLocaleLowerCase('en-US');
    if (names.has(canonicalName) || (lastFile !== null && lastFile.localeCompare(entry.relativePath, 'en-US') >= 0)) return false;
    names.add(canonicalName); fileNames.add(entry.relativePath); lastFile = entry.relativePath;
  }
  let lastDirectory = null;
  for (const relativePath of marker.directories) {
    try { validateRuntimeRelativePath(relativePath); } catch { return false; }
    const canonicalName = relativePath.toLocaleLowerCase('en-US');
    if (names.has(canonicalName)
      || (lastDirectory !== null && lastDirectory.localeCompare(relativePath, 'en-US') >= 0)) return false;
    names.add(canonicalName); directoryNames.add(relativePath); lastDirectory = relativePath;
  }
  if (!fileNames.has('bin/java.exe') || !directoryNames.has('bin')) return false;
  for (const relativePath of fileNames) {
    let parent = path.posix.dirname(relativePath);
    while (parent && parent !== '.') {
      if (!directoryNames.has(parent)) return false;
      parent = path.posix.dirname(parent);
    }
  }
  for (const relativePath of directoryNames) {
    const parent = path.posix.dirname(relativePath);
    if (parent !== '.' && !directoryNames.has(parent)) return false;
  }
  return true;
}

async function inspectInstalledRuntimeTree(root, marker) {
  const expectedFiles = new Map(marker.files.map((entry) => [entry.relativePath, entry]));
  const expectedDirectories = new Set(marker.directories);
  const observedFiles = new Set();
  const observedDirectories = new Set();
  const queue = [{ directory: root, relativePath: '' }];
  let entries = 0;
  while (queue.length) {
    const current = queue.shift();
    const children = await boundedDirectoryEntries(
      current.directory,
      (MAX_RUNTIME_ENTRIES + marker.directories.length + 1) - entries,
    );
    for (const child of children) {
      entries += 1;
      if (entries > MAX_RUNTIME_ENTRIES + marker.directories.length + 1) return false;
      const relativePath = current.relativePath ? `${current.relativePath}/${child.name}` : child.name;
      if (relativePath === 'runtime.json') {
        if (!child.isFile() || child.isSymbolicLink()) return false;
        continue;
      }
      const target = safeChild(root, relativePath);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || stat.nlink !== 1) return false;
      if (stat.isDirectory()) {
        if (!expectedDirectories.has(relativePath)) return false;
        observedDirectories.add(relativePath);
        queue.push({ directory: target, relativePath });
      } else if (stat.isFile()) {
        const expected = expectedFiles.get(relativePath);
        if (!expected || stat.size !== expected.size) return false;
        const bytes = await fs.readFile(target);
        if (sha1(bytes) !== expected.sha1 || sha256(bytes) !== expected.sha256) return false;
        observedFiles.add(relativePath);
      } else return false;
    }
  }
  return observedFiles.size === expectedFiles.size && observedDirectories.size === expectedDirectories.size;
}

export class JavaRuntimeManager {
  #queue = Promise.resolve();

  constructor(dataRoot, fetcher = fetch, options = {}) {
    this.dataRoot = path.resolve(dataRoot);
    this.fetcher = fetcher;
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.inspect = options.inspectJava ?? inspectJava;
    this.runtimeIndexUrl = options.runtimeIndexUrl ?? MOJANG_RUNTIME_INDEX;
  }

  async ensure(requiredMajor, component) {
    if (!Number.isInteger(requiredMajor) || requiredMajor < 8 || requiredMajor > 99) {
      throw new Error('Minecraft returned an invalid required Java generation');
    }
    if (!validIdentifier(component)) throw new Error('Minecraft returned an invalid Java runtime component');
    const operation = this.#queue.then(() => this.#ensure(requiredMajor, component));
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async #ensure(requiredMajor, component) {
    const platform = runtimePlatform(this.platform, this.arch);
    const indexBytes = await fetchBytes(
      this.fetcher, this.runtimeIndexUrl, METADATA_HOSTS, 'Mojang Java runtime index', MAX_INDEX_BYTES, 30_000,
    );
    const index = parseJson(indexBytes, 'Mojang Java runtime index');
    const entries = index?.[platform]?.[component];
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`Mojang did not publish ${component} for ${platform}`);
    }
    const candidates = entries
      .filter((entry) => entry?.availability?.progress === 100)
      .sort((left, right) => Date.parse(right?.version?.released ?? 0) - Date.parse(left?.version?.released ?? 0));
    const selected = candidates[0];
    const runtimeVersion = selected?.version?.name;
    const manifestDescriptor = selected?.manifest;
    if (
      !validIdentifier(runtimeVersion) ||
      typeof manifestDescriptor?.url !== 'string' ||
      typeof manifestDescriptor?.sha1 !== 'string' || !/^[a-f0-9]{40}$/i.test(manifestDescriptor.sha1) ||
      !Number.isInteger(manifestDescriptor?.size) || manifestDescriptor.size < 1 || manifestDescriptor.size > MAX_FILE_MANIFEST_BYTES
    ) throw new Error(`Mojang returned invalid metadata for ${component}`);

    const manifestBytes = await fetchBytes(
      this.fetcher, manifestDescriptor.url, METADATA_HOSTS, 'Mojang Java file manifest', MAX_FILE_MANIFEST_BYTES, 30_000,
    );
    validateDigestAndSize(manifestBytes, manifestDescriptor, 'Mojang Java file manifest');
    const fileManifest = parseJson(manifestBytes, 'Mojang Java file manifest');
    const files = normalizeRuntimeInventory(Object.entries(fileManifest?.files ?? {}));

    let totalBytes = 0;
    for (const entry of files) {
      if (entry.type !== 'file') continue;
      totalBytes += entry.size;
      if (totalBytes > MAX_RUNTIME_BYTES) throw new Error('Mojang Java runtime exceeded the installation size limit');
    }
    const executableDescriptor = files.find((entry) => entry.relativePath === 'bin/java.exe' && entry.type === 'file');
    if (
      typeof executableDescriptor?.sha1 !== 'string' || !/^[a-f0-9]{40}$/i.test(executableDescriptor.sha1)
      || !Number.isInteger(executableDescriptor?.size) || executableDescriptor.size < 1
    ) throw new Error('Mojang Java file manifest did not contain a verified bin/java.exe');
    const sourceInventorySha256 = crypto.createHash('sha256').update(canonicalJson(files.map((entry) => {
      if (entry.type === 'directory') return entry;
      return { relativePath: entry.relativePath, type: entry.type, sha1: entry.sha1, size: entry.size };
    })), 'utf8').digest('hex');

    const destination = path.join(this.dataRoot, component, runtimeVersion, platform);
    const markerPath = path.join(destination, 'runtime.json');
    const installed = await this.#readInstalled(markerPath, destination, {
      component, requiredMajor, runtimeVersion, platform, manifestSha1: manifestDescriptor.sha1.toLowerCase(),
      executableSha1: executableDescriptor.sha1.toLowerCase(), executableSize: executableDescriptor.size,
      sourceInventorySha256,
    });
    if (installed) return installed;

    if (await exists(destination)) {
      assertScopedRemoval(this.dataRoot, destination);
      await fs.rm(destination, { recursive: true, force: true });
    }

    const staging = path.join(this.dataRoot, component, runtimeVersion, `.${platform}-staging-${crypto.randomUUID()}`);
    assertScopedRemoval(this.dataRoot, staging);
    await fs.mkdir(staging, { recursive: true });
    try {
      for (const entry of files) {
        if (entry.type === 'directory') await fs.mkdir(safeChild(staging, entry.relativePath), { recursive: true });
      }
      const downloads = files.filter((entry) => entry.type === 'file');
      await concurrentMap(downloads, DOWNLOAD_CONCURRENCY, async (entry) => {
        const bytes = await fetchBytes(
          this.fetcher, entry.url, DATA_HOSTS, `Mojang runtime file ${entry.relativePath}`, MAX_RUNTIME_FILE_BYTES, 5 * 60 * 1000,
        );
        validateDigestAndSize(bytes, entry, `Mojang runtime file ${entry.relativePath}`);
        entry.sha256 = sha256(bytes);
        const target = safeChild(staging, entry.relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes, { flag: 'wx' });
      });

      const stagedExecutable = safeChild(staging, 'bin/java.exe');
      if (!await exists(stagedExecutable)) throw new Error('The Mojang runtime did not contain bin/java.exe');
      const inspected = await this.inspect(stagedExecutable);
      if (inspected.major !== requiredMajor) {
        throw new Error(`The managed runtime is Java ${inspected.major}, but Minecraft requires Java ${requiredMajor}`);
      }
      const runtimeFiles = downloads.map((entry) => ({
        relativePath: entry.relativePath, type: 'file', sha1: entry.sha1, sha256: entry.sha256, size: entry.size,
      })).sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en-US'));
      const directories = new Set(files.filter((entry) => entry.type === 'directory').map((entry) => entry.relativePath));
      for (const entry of runtimeFiles) {
        let parent = path.posix.dirname(entry.relativePath);
        while (parent && parent !== '.') {
          directories.add(parent);
          parent = path.posix.dirname(parent);
        }
      }
      const runtimeDirectories = [...directories].sort((left, right) => left.localeCompare(right, 'en-US'));
      const runtimeManifest = {
        schemaVersion: 2,
        component,
        major: requiredMajor,
        version: runtimeVersion,
        vendor: 'Mojang launcher runtime',
        managed: true,
        source: 'piston-meta.mojang.com',
        platform,
        manifestSha1: manifestDescriptor.sha1.toLowerCase(),
        executableRelativePath: 'bin/java.exe',
        executableSha1: executableDescriptor.sha1.toLowerCase(),
        executableSize: executableDescriptor.size,
        sourceInventorySha256,
        inventorySha256: runtimeInventoryDigest(runtimeFiles, runtimeDirectories),
        files: runtimeFiles,
        directories: runtimeDirectories,
        installedAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(staging, 'runtime.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await fs.mkdir(path.dirname(destination), { recursive: true });
      if (await exists(destination)) throw new Error('Managed Java runtime destination became occupied during installation');
      await fs.rename(staging, destination);
      return { ...runtimeManifest, executable: path.join(destination, runtimeManifest.executableRelativePath) };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async #readInstalled(markerPath, destination, expected) {
    try {
      const markerStat = await fs.lstat(markerPath);
      if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1
        || markerStat.size < 2 || markerStat.size > MAX_RUNTIME_MARKER_BYTES) return null;
      const installed = JSON.parse(await fs.readFile(markerPath, 'utf8'));
      if (
        installed?.schemaVersion !== 2 || installed?.managed !== true ||
        installed.component !== expected.component || installed.major !== expected.requiredMajor ||
        installed.version !== expected.runtimeVersion || installed.platform !== expected.platform ||
        installed.manifestSha1 !== expected.manifestSha1 ||
        installed.executableSha1 !== expected.executableSha1 || installed.executableSize !== expected.executableSize ||
        installed.executableRelativePath !== 'bin/java.exe' || installed.sourceInventorySha256 !== expected.sourceInventorySha256
        || !/^[a-f0-9]{64}$/.test(installed.inventorySha256 ?? '')
        || !validateInstalledRuntimeInventory(installed)
        || runtimeInventoryDigest(installed.files, installed.directories) !== installed.inventorySha256
      ) return null;
      const executable = safeChild(destination, installed.executableRelativePath.replaceAll('\\', '/'));
      const stat = await fs.lstat(executable);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.executableSize) return null;
      if (!await inspectInstalledRuntimeTree(destination, installed)) return null;
      const inspected = await this.inspect(executable);
      if (inspected.major !== expected.requiredMajor) return null;
      return { ...installed, executable };
    } catch {
      return null;
    }
  }
}

export { safeRuntimeMetadata };

async function exists(target) {
  try { await fs.access(target); return true; }
  catch { return false; }
}
