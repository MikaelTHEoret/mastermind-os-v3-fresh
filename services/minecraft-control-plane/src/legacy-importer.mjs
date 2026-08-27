import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateInstanceId } from './config.mjs';

const BEDROCK_LAN_PORT = 19132;
const UPDATE_STATE = 'minecraft-update-approval-required';
const PROVISIONING_STATE = 'legacy-update-required';
const MARKER_DIRECTORY = '.mastermind';
const MARKER_FILE = 'legacy-source.json';
const ACTIVE_LEGACY_STATES = new Set(['starting', 'running', 'stopping']);

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function containedPath(root, ...segments) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...segments);
  if (!isContained(absoluteRoot, target)) throw new Error('Legacy instance path escaped its trusted root');
  return target;
}

async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readLegacyRecords(dataRoot) {
  const stateFile = containedPath(dataRoot, 'state', 'instances.json');
  let contents;
  try {
    contents = await fs.readFile(stateFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const parsed = JSON.parse(contents);
  if (!parsed || !Array.isArray(parsed.instances)) {
    throw new Error('Legacy instance state is not a valid instances file');
  }
  return parsed.instances;
}

function validateLegacyRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Legacy instance state contains an invalid record');
  }
  if (!validateInstanceId(record.id)) {
    throw new TypeError(`Legacy instance id '${String(record.id)}' is invalid`);
  }
  if (record.projectId != null && record.projectId !== 'family-server') return false;
  if (record.kind != null && record.kind !== 'server') return false;
  return true;
}

function integerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function publicCandidate(record) {
  return {
    id: record.id,
    displayName: typeof record.displayName === 'string' && record.displayName.trim()
      ? record.displayName.trim().slice(0, 64)
      : record.id,
    kind: 'server',
    minecraftVersion: typeof record.minecraftVersion === 'string' ? record.minecraftVersion : null,
    memoryMb: integerInRange(record.memoryMb, 512, 32768) ? record.memoryMb : 2048,
    serverPort: integerInRange(record.serverPort, 1, 65535) ? record.serverPort : null,
  };
}

async function legacyWorld(source) {
  let contents;
  try {
    contents = await fs.readFile(containedPath(source, 'server.properties'), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') contents = '';
    else throw error;
  }
  let levelName = 'world';
  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*[#!]/.test(line)) continue;
    const match = /^\s*level-name\s*[=:]\s*(.*?)\s*$/.exec(line);
    if (match) {
      levelName = match[1] || 'world';
      break;
    }
  }
  if (levelName.includes('\0')) throw new Error('Legacy level-name contains an invalid character');
  const directory = containedPath(source, levelName);
  const relative = path.relative(source, directory);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Legacy level-name must identify a world inside the server directory');
  }
  return { levelName, directory, relative };
}

/**
 * Read-only discovery of pre-project-layout Family Server instances.
 * Returned candidates are deliberately path-free so they are safe to surface in a UI.
 */
export async function discoverLegacyFamilyInstances(dataRoot) {
  const legacyRoot = path.resolve(dataRoot);
  const records = await readLegacyRecords(legacyRoot);
  const candidates = [];
  const seen = new Set();
  for (const record of records) {
    if (!validateLegacyRecord(record)) continue;
    if (seen.has(record.id)) throw new Error(`Legacy instance '${record.id}' is duplicated in state`);
    seen.add(record.id);
    const source = containedPath(legacyRoot, 'servers', record.id);
    if (!await isDirectory(source)) continue;
    const world = await legacyWorld(source);
    if (await isDirectory(world.directory)) candidates.push(publicCandidate(record));
  }
  return candidates;
}

/**
 * Copies one legacy Family Server into the isolated project root without changing,
 * starting, upgrading, or deleting the source instance.
 */
export async function importLegacyFamilyInstance(options) {
  if (!options || typeof options !== 'object') throw new TypeError('Legacy import options are required');
  const { dataRoot, store, instanceId } = options;
  if (!validateInstanceId(instanceId)) throw new TypeError('Invalid legacy instance id');
  if (!store || typeof store.list !== 'function' || typeof store.create !== 'function') {
    throw new TypeError('A managed instance store is required');
  }

  const legacyRoot = path.resolve(dataRoot);
  const managedRoot = path.resolve(options.managedRoot ?? path.join(legacyRoot, 'projects', 'family-server'));
  const expectedManagedRoot = containedPath(legacyRoot, 'projects', 'family-server');
  if (managedRoot !== expectedManagedRoot) {
    throw new Error('Managed Family Server root must use the isolated project directory');
  }

  const records = await readLegacyRecords(legacyRoot);
  let legacyRecord = null;
  for (const record of records) {
    if (!validateLegacyRecord(record)) continue;
    if (record.id !== instanceId) continue;
    if (legacyRecord) throw new Error(`Legacy instance '${instanceId}' is duplicated in state`);
    legacyRecord = record;
  }
  if (!legacyRecord) throw new Error(`Legacy instance '${instanceId}' was not found`);

  const serverRoot = containedPath(managedRoot, 'servers');
  const destination = containedPath(serverRoot, instanceId);
  const managedRecords = await store.list();
  if (!Array.isArray(managedRecords)) throw new Error('Managed instance store returned invalid state');
  if (managedRecords.length > 0) return { imported: false, reason: 'managed-store-not-empty', instance: null };
  if (await exists(destination)) return { imported: false, reason: 'destination-exists', instance: null };

  const source = containedPath(legacyRoot, 'servers', instanceId);
  if (!await isDirectory(source)) throw new Error(`Legacy instance '${instanceId}' directory was not found`);
  const sourceWorldInfo = await legacyWorld(source);
  const sourceWorld = sourceWorldInfo.directory;
  if (!await isDirectory(sourceWorld)) throw new Error(`Legacy instance '${instanceId}' has no '${sourceWorldInfo.levelName}' world directory`);
  if (!integerInRange(legacyRecord.serverPort, 1, 65535)) {
    throw new Error(`Legacy instance '${instanceId}' has an invalid serverPort`);
  }
  if (ACTIVE_LEGACY_STATES.has(legacyRecord.status)) {
    throw new Error(`Legacy instance '${instanceId}' must be stopped before it can be imported`);
  }
  if (typeof options.isLegacyActive === 'function' && await options.isLegacyActive({
    id: instanceId,
    serverPort: legacyRecord.serverPort,
    status: legacyRecord.status,
  })) {
    throw new Error(`Legacy instance '${instanceId}' still owns its Java server port and cannot be imported`);
  }
  const beforeSource = await hashTree(source);
  const beforeWorld = await hashTree(sourceWorld);
  await fs.mkdir(serverRoot, { recursive: true });
  const stagingContainer = await fs.mkdtemp(containedPath(serverRoot, `.${instanceId}-legacy-staging-`));
  const staging = containedPath(stagingContainer, 'instance');
  let published = false;
  try {
    await fs.cp(source, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
      preserveTimestamps: true,
    });

    const copiedSource = await hashTree(staging);
    const copiedWorld = await hashTree(containedPath(staging, sourceWorldInfo.relative));
    const afterSource = await hashTree(source);
    const afterWorld = await hashTree(sourceWorld);
    if (beforeSource.sha256 !== copiedSource.sha256 || beforeSource.fileCount !== copiedSource.fileCount || beforeSource.byteCount !== copiedSource.byteCount) {
      throw new Error('Legacy instance copy did not preserve the complete source tree');
    }
    if (beforeWorld.sha256 !== copiedWorld.sha256 || beforeWorld.fileCount !== copiedWorld.fileCount || beforeWorld.byteCount !== copiedWorld.byteCount) {
      throw new Error('Legacy world verification failed after copying');
    }
    if (beforeSource.sha256 !== afterSource.sha256 || beforeWorld.sha256 !== afterWorld.sha256) {
      throw new Error('Legacy source changed during import; no managed copy was published');
    }

    const importedAt = new Date().toISOString();
    const markerDirectory = containedPath(staging, MARKER_DIRECTORY);
    await fs.mkdir(markerDirectory, { recursive: true });
    await fs.writeFile(containedPath(markerDirectory, MARKER_FILE), `${JSON.stringify({
      schemaVersion: 1,
      importKind: 'legacy-v1-family-server',
      instanceId,
      sourceDirectory: source,
      sourceStateFile: containedPath(legacyRoot, 'state', 'instances.json'),
      sourceTreeSha256: beforeSource.sha256,
      worldSha256: beforeWorld.sha256,
      levelName: sourceWorldInfo.levelName,
      importedAt,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });

    const currentManagedRecords = await store.list();
    if (!Array.isArray(currentManagedRecords)) throw new Error('Managed instance store returned invalid state');
    if (currentManagedRecords.length > 0) {
      await fs.rm(stagingContainer, { recursive: true, force: true });
      return { imported: false, reason: 'managed-store-not-empty', instance: null };
    }
    if (await exists(destination)) {
      await fs.rm(stagingContainer, { recursive: true, force: true });
      return { imported: false, reason: 'destination-exists', instance: null };
    }
    await fs.rename(staging, destination);
    published = true;
    await fs.rm(stagingContainer, { recursive: true, force: true });

    const minecraftVersion = typeof legacyRecord.minecraftVersion === 'string' && legacyRecord.minecraftVersion.trim()
      ? legacyRecord.minecraftVersion.trim()
      : 'unknown';
    const record = {
      id: instanceId,
      displayName: typeof legacyRecord.displayName === 'string' && legacyRecord.displayName.trim()
        ? legacyRecord.displayName.trim().slice(0, 64)
        : instanceId,
      projectId: 'family-server',
      kind: 'server',
      updateChannel: 'latest-compatible',
      minecraftVersion,
      memoryMb: integerInRange(legacyRecord.memoryMb, 512, 32768) ? legacyRecord.memoryMb : 2048,
      javaPort: legacyRecord.serverPort,
      serverPort: legacyRecord.serverPort,
      bedrockPort: BEDROCK_LAN_PORT,
      directory: destination,
      provisioningStatus: PROVISIONING_STATE,
      status: 'stopped',
      pid: null,
      lastError: null,
      updateState: UPDATE_STATE,
      update: {
        state: UPDATE_STATE,
        currentMinecraft: minecraftVersion,
        requiresApproval: true,
      },
      migration: {
        kind: 'legacy-v1',
        worldSha256: beforeWorld.sha256,
        sourceTreeSha256: beforeSource.sha256,
        levelName: sourceWorldInfo.levelName,
        importedAt,
      },
      createdAt: validTimestamp(legacyRecord.createdAt) ?? importedAt,
      updatedAt: importedAt,
    };
    for (const field of ['loader', 'loaderVersion']) {
      if (typeof legacyRecord[field] === 'string' && legacyRecord[field]) record[field] = legacyRecord[field];
    }
    await store.create(record);
    return { imported: true, reason: null, instance: record };
  } catch (error) {
    await fs.rm(stagingContainer, { recursive: true, force: true }).catch(() => undefined);
    if (published) await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function isDirectory(target) {
  try {
    const stat = await fs.lstat(target);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

async function hashTree(root) {
  const absoluteRoot = path.resolve(root);
  const rootStat = await fs.lstat(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Legacy tree root must be a real directory');
  const hash = crypto.createHash('sha256');
  let fileCount = 0;
  let byteCount = 0;

  async function visit(directory, relativeDirectory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      const target = containedPath(absoluteRoot, relative);
      const stat = await fs.lstat(target);
      const portableRelative = relative.split(path.sep).join('/');
      if (stat.isSymbolicLink()) throw new Error(`Legacy tree contains unsupported symbolic link '${portableRelative}'`);
      if (stat.isDirectory()) {
        hash.update(`${JSON.stringify(['directory', portableRelative])}\n`);
        await visit(target, relative);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Legacy tree contains unsupported entry '${portableRelative}'`);
      hash.update(`${JSON.stringify(['file', portableRelative, stat.size])}\n`);
      const file = await fs.open(target, 'r');
      try {
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let position = 0;
        while (position < stat.size) {
          const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, stat.size - position), position);
          if (bytesRead === 0) throw new Error(`Legacy file '${portableRelative}' changed while it was being verified`);
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
      } finally {
        await file.close();
      }
      hash.update('\0');
      fileCount += 1;
      byteCount += stat.size;
    }
  }

  await visit(absoluteRoot, '');
  return { sha256: hash.digest('hex'), fileCount, byteCount };
}
