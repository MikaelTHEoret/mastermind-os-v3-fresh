import crypto from 'node:crypto';
import { constants as FS_CONSTANTS } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import zlib from 'node:zlib';
import semver from 'semver';

const API_ROOT = 'https://api.modrinth.com/v2';
const USER_AGENT = 'mastermind-core/family-server-mod-manager/0.1 (mastermind-core.com)';
const PROJECT_ID = /^[A-Za-z0-9]{8}$/;
const VERSION_ID = /^[A-Za-z0-9]{8}$/;
const SHA512 = /^[a-f0-9]{128}$/i;
const SAFE_ENVIRONMENTS = new Set(['server_only', 'dedicated_server_only', 'server_only_client_optional']);
const SAFE_PROJECT_SIDE = new Set(['required', 'optional']);
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_MOD_BYTES = 128 * 1024 * 1024;
const MAX_GRAPH_BYTES = 512 * 1024 * 1024;
const MAX_GRAPH_NODES = 64;
const MAX_GRAPH_DEPTH = 8;
const MAX_JAR_ENTRIES = 8192;
const MAX_GRAPH_JAR_ENTRIES = 16_384;
const MAX_JAR_CENTRAL_BYTES = 16 * 1024 * 1024;
const MAX_JAR_UNCOMPRESSED = 256 * 1024 * 1024;
const MAX_NESTED_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_FABRIC_JSON_BYTES = 1024 * 1024;
const MAX_NESTED_JARS = 64;
const MAX_NESTED_DEPTH = 2;
const MOD_ID = /^[a-z][a-z0-9_-]{1,63}$/;
const RESERVED_MOD_IDS = new Set([
  'minecraft', 'java', 'fabricloader', 'fabric', 'fabric-api',
  'geyser', 'geyser-fabric', 'floodgate',
]);
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function modError(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

function checkedId(value, label, pattern = PROJECT_ID) {
  if (typeof value !== 'string' || !pattern.test(value)) throw modError('MOD_UPSTREAM_INVALID', 502, `Modrinth returned an invalid ${label}.`);
  return value;
}

function boundedText(value, maximum, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gu, '').trim();
  return text.slice(0, maximum) || fallback;
}

function strictJsonParse(text) {
  let index = 0;
  const whitespace = () => { while (/\s/u.test(text[index] ?? '')) index += 1; };
  const string = () => {
    const start = index;
    if (text[index++] !== '"') throw new Error('expected string');
    while (index < text.length) {
      if (text[index] === '"') {
        index += 1;
        const value = JSON.parse(text.slice(start, index));
        if (typeof value !== 'string') throw new Error('invalid string');
        return value;
      }
      if (text[index] === '\\') index += 2;
      else index += 1;
    }
    throw new Error('unterminated string');
  };
  const value = () => {
    whitespace();
    if (text[index] === '"') return string();
    if (text[index] === '{') {
      index += 1; whitespace();
      const result = Object.create(null); const keys = new Set();
      if (text[index] === '}') { index += 1; return result; }
      while (true) {
        whitespace(); const key = string();
        if (keys.has(key)) throw new Error('duplicate key');
        keys.add(key); whitespace();
        if (text[index++] !== ':') throw new Error('expected colon');
        result[key] = value(); whitespace();
        if (text[index] === '}') { index += 1; return result; }
        if (text[index++] !== ',') throw new Error('expected comma');
      }
    }
    if (text[index] === '[') {
      index += 1; whitespace(); const result = [];
      if (text[index] === ']') { index += 1; return result; }
      while (true) {
        result.push(value()); whitespace();
        if (text[index] === ']') { index += 1; return result; }
        if (text[index++] !== ',') throw new Error('expected comma');
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index));
    if (!match) throw new Error('invalid value');
    index += match[0].length;
    return JSON.parse(match[0]);
  };
  const parsed = value(); whitespace();
  if (index !== text.length) throw new Error('trailing input');
  return parsed;
}

function normalizeSemver(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /^[vV]/.test(value) || /[^0-9A-Za-z.+-]/.test(value)) return null;
  let expanded = /^\d+$/.test(value) ? `${value}.0.0` : /^\d+\.\d+$/.test(value) ? `${value}.0` : value;
  const twoComponentPrerelease = /^(\d+\.\d+)(-[0-9A-Za-z.-]+)$/.exec(expanded);
  if (twoComponentPrerelease) expanded = `${twoComponentPrerelease[1]}.0${twoComponentPrerelease[2]}`;
  return semver.valid(expanded, { loose: false }) ?? null;
}

function normalizePredicate(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[^0-9A-Za-z.*+<>=~^_-]/.test(value)) {
    throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains an unsupported dependency predicate.');
  }
  if (value === '*') return value;
  const match = /^(>=|<=|>|<|=|~|\^)?(.+)$/.exec(value);
  if (!match) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains an unsupported dependency predicate.');
  let version = match[2];
  if (match[1] === '~' && version.endsWith('-')) version = version.slice(0, -1);
  const normalized = normalizeSemver(version);
  if (!normalized) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains an unsupported dependency predicate.');
  return `${match[1] ?? '='}${normalized}`;
}

function predicates(value) {
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || values.length < 1 || values.length > 16) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains malformed dependency predicates.');
  return values.map(normalizePredicate);
}

export function fabricVersionSatisfies(version, accepted) {
  const normalized = normalizeSemver(version);
  if (!normalized || !Array.isArray(accepted) || accepted.length < 1) return false;
  return accepted.some((predicate) => {
    if (predicate === '*') return true;
    try { return semver.satisfies(normalized, predicate, { includePrerelease: true, loose: false }); } catch { return false; }
  });
}

function checkedCdnUrl(value, projectId, versionId) {
  let url;
  try { url = new URL(value); } catch { throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned an invalid artifact URL.'); }
  const prefix = `/data/${projectId}/versions/${versionId}/`;
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.modrinth.com' || url.port || url.username || url.password
    || !url.pathname.startsWith(prefix) || url.search || url.hash) {
    throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned an artifact outside its trusted CDN boundary.');
  }
  return url.href;
}

async function boundedJson(response) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth metadata exceeded its safe size limit.');
  const chunks = [];
  let size = 0;
  if (!response.body) throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned no metadata body.');
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth metadata exceeded its safe size limit.');
    chunks.push(chunk);
  }
  try { return strictJsonParse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned malformed metadata.'); }
}

function validateProject(value, expectedId = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned malformed project metadata.');
  const projectId = checkedId(value.id ?? value.project_id, 'project id');
  if (expectedId && projectId !== expectedId) throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned a mismatched project.');
  if (value.project_type !== 'mod' || value.status !== 'approved') throw modError('MOD_INCOMPATIBLE', 409, 'The selected project is not an approved Modrinth mod.');
  return {
    projectId,
    title: boundedText(value.title, 128, 'Untitled mod'),
    description: boundedText(value.description, 512),
    author: boundedText(value.author, 64, 'Unknown author'),
    downloads: Number.isSafeInteger(value.downloads) && value.downloads >= 0 ? value.downloads : 0,
    license: boundedText(value.license?.id, 64, 'Unknown'),
  };
}

function selectFile(version) {
  const files = Array.isArray(version.files) ? version.files : [];
  if (files.length < 1 || files.length > 32) throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned an unsafe artifact list.');
  const explicitlyPrimary = files.filter((file) => file?.primary === true);
  const ordinaryJars = files.filter((file) => file && typeof file.filename === 'string'
    && file.filename.toLowerCase().endsWith('.jar') && (file.file_type == null || file.file_type === 'unknown'));
  if (explicitlyPrimary.length > 1 || (explicitlyPrimary.length === 0 && ordinaryJars.length !== 1)) {
    throw modError('MOD_INCOMPATIBLE', 409, 'The compatible Modrinth release has no unambiguous primary JAR artifact.');
  }
  const primary = explicitlyPrimary[0] ?? ordinaryJars[0];
  if (!primary || typeof primary !== 'object' || typeof primary.filename !== 'string' || !primary.filename.toLowerCase().endsWith('.jar')
    || (primary.file_type != null && primary.file_type !== 'unknown')
    || !Number.isInteger(primary.size) || primary.size < 1 || primary.size > MAX_MOD_BYTES
    || !SHA512.test(primary.hashes?.sha512 ?? '')) {
    throw modError('MOD_INCOMPATIBLE', 409, 'The compatible Modrinth release has no trusted primary JAR artifact.');
  }
  return {
    sourceUrl: checkedCdnUrl(primary.url, version.project_id, version.id),
    sourceFileName: boundedText(primary.filename, 256, 'mod.jar'),
    sha512: primary.hashes.sha512.toLowerCase(),
    size: primary.size,
  };
}

function validateVersion(value, { projectId, minecraftVersion }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned malformed version metadata.');
  const versionId = checkedId(value.id, 'version id', VERSION_ID);
  const actualProjectId = checkedId(value.project_id, 'version project id');
  if (actualProjectId !== projectId || value.status !== 'listed' || value.version_type !== 'release'
    || !Array.isArray(value.loaders) || !value.loaders.includes('fabric')
    || !Array.isArray(value.game_versions) || !value.game_versions.includes(minecraftVersion)
    || !SAFE_ENVIRONMENTS.has(value.environment)) {
    throw modError('MOD_INCOMPATIBLE', 409, 'The selected release is not a listed server-only Fabric mod for this Minecraft version.');
  }
  if (!Array.isArray(value.dependencies) || value.dependencies.length > 128) throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned malformed dependencies.');
  return {
    projectId,
    versionId,
    version: boundedText(value.version_number, 128, versionId),
    releaseType: 'release',
    environment: value.environment,
    publishedAt: typeof value.date_published === 'string' && Number.isFinite(Date.parse(value.date_published))
      ? new Date(value.date_published).toISOString()
      : null,
    dependencies: value.dependencies,
    file: selectFile(value),
  };
}

export class ModrinthClient {
  constructor(fetcher = fetch) {
    if (typeof fetcher !== 'function') throw new TypeError('A Modrinth fetch implementation is required');
    this.fetcher = fetcher;
  }

  async #json(pathname, search = null) {
    const url = new URL(`${API_ROOT}${pathname}`);
    if (search) for (const [key, value] of Object.entries(search)) url.searchParams.set(key, String(value));
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw modError(response.status === 404 ? 'MOD_NOT_FOUND' : 'MOD_UPSTREAM_UNAVAILABLE', response.status === 404 ? 404 : 502, 'Modrinth metadata is unavailable.');
    return boundedJson(response);
  }

  async search({ query, minecraftVersion, offset, limit }) {
    const facets = JSON.stringify([
      ['project_type:mod'], ['categories:fabric'], [`versions:${minecraftVersion}`],
      ['environment:server_only', 'environment:dedicated_server_only', 'environment:server_only_client_optional'],
    ]);
    const value = await this.#json('/search', { query, facets, index: 'relevance', offset, limit });
    if (!value || !Array.isArray(value.hits)) throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned malformed search results.');
    const items = [];
    for (const hit of value.hits.slice(0, limit)) {
      const environments = Array.isArray(hit?.environment) ? hit.environment : null;
      const safeEnvironment = environments?.find((environment) => SAFE_ENVIRONMENTS.has(environment)) ?? null;
      if (!hit || hit.project_type !== 'mod'
        || (environments ? !safeEnvironment : !SAFE_PROJECT_SIDE.has(hit.server_side))) continue;
      items.push({
        projectId: checkedId(hit.project_id, 'search project id'),
        title: boundedText(hit.title, 128, 'Untitled mod'),
        description: boundedText(hit.description, 512),
        author: boundedText(hit.author, 64, 'Unknown author'),
        downloads: Number.isSafeInteger(hit.downloads) && hit.downloads >= 0 ? hit.downloads : 0,
        serverSupport: safeEnvironment ? 'required' : hit.server_side,
        clientSupport: safeEnvironment === 'server_only_client_optional' ? 'optional'
          : safeEnvironment ? 'unsupported'
            : ['required', 'optional', 'unsupported', 'unknown'].includes(hit.client_side) ? hit.client_side : 'unknown',
        updatedAt: typeof hit.date_modified === 'string' && Number.isFinite(Date.parse(hit.date_modified)) ? new Date(hit.date_modified).toISOString() : null,
      });
    }
    return { totalHits: Number.isSafeInteger(value.total_hits) && value.total_hits >= 0 ? value.total_hits : items.length, items };
  }

  async project(projectId) {
    return validateProject(await this.#json(`/project/${checkedId(projectId, 'project id')}`), projectId);
  }

  async resolveGraph({ projectId, minecraftVersion, coreVersions = new Map(), installedProjectIds = new Set(), currentVersions = new Map(), pinnedRootVersionId = null, pinnedVersions = new Map() }) {
    checkedId(projectId, 'project id');
    const selected = new Map();
    const visiting = new Set();
    const incompatible = [];
    let totalBytes = 0;
    const visit = async (requestedProjectId, pinnedVersionId = null, depth = 0, relationship = 'requested') => {
      if (depth > MAX_GRAPH_DEPTH) throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'The required dependency graph exceeded its safe depth.');
      checkedId(requestedProjectId, 'dependency project id');
      if (coreVersions.has(requestedProjectId)) {
        const currentVersion = coreVersions.get(requestedProjectId);
        if (pinnedVersionId && pinnedVersionId !== currentVersion) throw modError('MOD_CORE_PROTECTED', 409, 'A dependency requires changing a protected managed core mod; update the server stack instead.');
        return { core: true, projectId: requestedProjectId, versionId: currentVersion };
      }
      if (visiting.has(requestedProjectId)) throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'The required dependency graph contains a cycle.');
      if (selected.has(requestedProjectId)) {
        const existing = selected.get(requestedProjectId);
        if (pinnedVersionId && existing.versionId !== pinnedVersionId) throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'The dependency graph requires conflicting versions of one mod.');
        return existing;
      }
      if (selected.size >= MAX_GRAPH_NODES) throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'The required dependency graph exceeded its safe size.');
      visiting.add(requestedProjectId);
      const project = await this.project(requestedProjectId);
      let rawVersion;
      const effectivePin = pinnedVersionId ?? pinnedVersions.get(requestedProjectId) ?? (requestedProjectId === projectId ? pinnedRootVersionId : null);
      if (effectivePin) {
        rawVersion = await this.#json(`/version/${checkedId(effectivePin, 'dependency version id', VERSION_ID)}`);
      } else {
        const versions = await this.#json(`/project/${requestedProjectId}/version`, {
          loaders: JSON.stringify(['fabric']), game_versions: JSON.stringify([minecraftVersion]), include_changelog: 'false',
        });
        if (!Array.isArray(versions) || versions.length > 1024) throw modError('MOD_UPSTREAM_INVALID', 502, 'Modrinth returned malformed version results.');
        const compatible = versions.filter((version) => version?.status === 'listed' && version?.version_type === 'release'
          && SAFE_ENVIRONMENTS.has(version?.environment) && typeof version?.date_published === 'string'
          && Number.isFinite(Date.parse(version.date_published)));
        compatible.sort((left, right) => Date.parse(right.date_published) - Date.parse(left.date_published)
          || String(right.id).localeCompare(String(left.id)));
        rawVersion = compatible[0];
      }
      if (!rawVersion) throw modError('MOD_INCOMPATIBLE', 409, 'No listed server-only Fabric release supports this Minecraft version.');
      const version = validateVersion(rawVersion, { projectId: requestedProjectId, minecraftVersion });
      const current = currentVersions.get(requestedProjectId);
      if (current && (!version.publishedAt || !Number.isFinite(Date.parse(current.publishedAt))
        || Date.parse(version.publishedAt) < Date.parse(current.publishedAt))) {
        throw modError('MOD_INCOMPATIBLE', 409, 'The selected release would downgrade an installed mod.');
      }
      totalBytes += version.file.size;
      if (totalBytes > MAX_GRAPH_BYTES) throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'The required mod set exceeded its safe download size.');
      const node = { ...project, ...version, relationship };
      node.requiredProjectIds = [];
      selected.set(requestedProjectId, node);
      if (version.dependencies.length > 128) throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'The dependency graph exceeded its safe edge count.');
      for (const dependency of version.dependencies) {
        if (!dependency || !['required', 'optional', 'incompatible', 'embedded'].includes(dependency.dependency_type)) {
          throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'Modrinth returned an unsupported dependency declaration.');
        }
        if (dependency.dependency_type === 'optional' || dependency.dependency_type === 'embedded') continue;
        const dependencyProjectId = dependency.project_id == null ? null : checkedId(dependency.project_id, 'dependency project id');
        const dependencyVersionId = dependency.version_id == null ? null : checkedId(dependency.version_id, 'dependency version id', VERSION_ID);
        if (!dependencyProjectId && !dependencyVersionId) throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'A required file-name-only dependency cannot be resolved safely.');
        if (dependency.dependency_type === 'incompatible') {
          incompatible.push({ projectId: dependencyProjectId, versionId: dependencyVersionId });
          continue;
        }
        let resolvedProjectId = dependencyProjectId;
        if (!resolvedProjectId && dependencyVersionId) {
          const pinned = await this.#json(`/version/${dependencyVersionId}`);
          resolvedProjectId = checkedId(pinned?.project_id, 'dependency project id');
        }
        const resolved = await visit(resolvedProjectId, dependencyVersionId, depth + 1, 'required-dependency');
        if (!resolved.core) node.requiredProjectIds.push(resolvedProjectId);
      }
      visiting.delete(requestedProjectId);
      return node;
    };
    await visit(projectId);
    const blocked = new Set([...selected.keys(), ...installedProjectIds, ...coreVersions.keys()]);
    for (const edge of incompatible) {
      let target = edge.projectId;
      if (!target && edge.versionId) target = checkedId((await this.#json(`/version/${edge.versionId}`))?.project_id, 'incompatible project id');
      if (!target || blocked.has(target)) throw modError('MOD_INCOMPATIBLE', 409, 'The selected mod set declares an incompatibility with the current server mod set.');
    }
    return { rootProjectId: projectId, totalBytes, nodes: [...selected.values()] };
  }

  async download(node, destination, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => !['anchorRoot', 'trustedRoot'].includes(key))) throw new TypeError('Invalid download boundary options');
    if (!node?.file || !SHA512.test(node.file.sha512 ?? '') || !Number.isInteger(node.file.size)) throw new TypeError('Trusted resolved mod metadata is required');
    const url = checkedCdnUrl(node.file.sourceUrl, node.projectId, node.versionId);
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/java-archive', 'Accept-Encoding': 'identity', 'User-Agent': USER_AGENT }, redirect: 'error', signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok || !response.body) throw modError('MOD_UPSTREAM_UNAVAILABLE', 502, 'The Modrinth artifact download failed.');
    if (response.url) checkedCdnUrl(response.url, node.projectId, node.versionId);
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') throw modError('MOD_INTEGRITY_FAILED', 502, 'The Modrinth artifact used an unsupported transfer encoding.');
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > 0 && declared !== node.file.size) throw modError('MOD_INTEGRITY_FAILED', 502, 'The Modrinth artifact size did not match its signed metadata.');
    const anchorRoot = options.anchorRoot ?? path.dirname(destination);
    const trustedRoot = options.trustedRoot ?? anchorRoot;
    await validateTrustedPath(path.dirname(destination), anchorRoot, trustedRoot, true);
    const handle = await fs.open(destination, 'wx+', 0o600);
    const hash = crypto.createHash('sha512');
    let persistedHash = null;
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_MOD_BYTES || size > node.file.size) throw modError('MOD_INTEGRITY_FAILED', 502, 'The Modrinth artifact exceeded its trusted size.');
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
          if (!Number.isInteger(bytesWritten) || bytesWritten < 1) throw modError('MOD_INTEGRITY_FAILED', 502, 'The staged artifact could not be written completely.');
          offset += bytesWritten;
        }
      }
      await handle.sync();
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== size) throw modError('MOD_INTEGRITY_FAILED', 502, 'The staged artifact changed during download.');
      const persisted = crypto.createHash('sha512');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let position = 0;
      while (position < stat.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - position), position);
        if (bytesRead < 1) throw modError('MOD_INTEGRITY_FAILED', 502, 'The staged artifact could not be read back completely.');
        persisted.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      const restat = await handle.stat();
      if (restat.size !== stat.size || restat.dev !== stat.dev || restat.ino !== stat.ino || restat.nlink !== 1) {
        throw modError('MOD_INTEGRITY_FAILED', 502, 'The staged artifact changed during verification.');
      }
      persistedHash = persisted.digest('hex');
      const named = await validateTrustedPath(destination, anchorRoot, trustedRoot, false);
      if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1
        || (stat.ino && named.ino && (stat.dev !== named.dev || stat.ino !== named.ino))) {
        throw modError('MOD_INTEGRITY_FAILED', 502, 'The staged artifact path changed during download.');
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await fs.rm(destination, { force: true });
      throw error;
    } finally { await handle.close().catch(() => undefined); }
    if (size !== node.file.size || hash.digest('hex') !== node.file.sha512 || persistedHash !== node.file.sha512) {
      await fs.rm(destination, { force: true });
      throw modError('MOD_INTEGRITY_FAILED', 502, 'The Modrinth artifact hash did not match its trusted metadata.');
    }
    return { size, sha512: node.file.sha512 };
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function safeEntryName(bytes) {
  let name;
  try { name = UTF8.decode(bytes); } catch { throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains a non-UTF-8 entry name.'); }
  const pathName = name.endsWith('/') ? name.slice(0, -1) : name;
  const parts = pathName.split('/');
  if (!pathName || name !== name.normalize('NFC') || name.includes('\\') || name.includes(':') || name.includes('\0')
    || /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(name)
    || name.startsWith('/') || /^[A-Za-z]:/.test(name)
    || parts.some((part) => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ')
      || WINDOWS_DEVICE.test(part))) {
    throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains an unsafe entry name.');
  }
  return name;
}

function assertNoZip64Extra(bytes) {
  let cursor = 0;
  while (cursor < bytes.length) {
    if (cursor + 4 > bytes.length) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains malformed archive metadata.');
    const kind = bytes.readUInt16LE(cursor);
    const size = bytes.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + size > bytes.length) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains malformed archive metadata.');
    if (kind === 0x0001) throw modError('MOD_INTEGRITY_FAILED', 409, 'ZIP64 mod archives are not supported.');
    cursor += size;
  }
}

function parseArchive(bytes, budget, depth = 0, requireFabricMetadata = true, protectedIds = RESERVED_MOD_IDS) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_MOD_BYTES) throw modError('MOD_INTEGRITY_FAILED', 409, 'The downloaded mod is not a bounded JAR archive.');
  budget.archiveBytes = (budget.archiveBytes ?? 0) + bytes.length;
  if (budget.archiveBytes > MAX_GRAPH_BYTES) throw modError('MOD_INTEGRITY_FAILED', 409, 'The nested mod archives exceeded their safe aggregate size.');
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= searchStart; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0
    || bytes.readUInt16LE(eocd + 8) !== bytes.readUInt16LE(eocd + 10)
    || eocd + 22 + bytes.readUInt16LE(eocd + 20) !== bytes.length) {
    throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR uses an unsupported archive layout.');
  }
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entryCount < 1 || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
    || entryCount > MAX_JAR_ENTRIES || centralSize > MAX_JAR_CENTRAL_BYTES
    || centralOffset + centralSize !== eocd) {
    throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR central directory exceeded its safe limits.');
  }
  budget.entries = (budget.entries ?? 0) + entryCount;
  if (budget.entries > MAX_GRAPH_JAR_ENTRIES) throw modError('MOD_INTEGRITY_FAILED', 409, 'The nested mod archives contained too many entries.');
  const entries = new Map();
  const localRanges = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR central directory is malformed.');
    const flags = bytes.readUInt16LE(cursor + 8);
    const compression = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const madeBy = bytes.readUInt16LE(cursor + 4);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const unixType = unixMode & 0xf000;
    if ((flags & ~0x080e) !== 0 || (compression === 0 && (flags & 0x0006) !== 0)
      || ![0, 8].includes(compression) || [compressedSize, uncompressedSize, localOffset].includes(0xffffffff)
      || compressedSize > MAX_MOD_BYTES || uncompressedSize > MAX_JAR_UNCOMPRESSED
      || (compressedSize === 0 && uncompressedSize > 0) || (compressedSize > 0 && uncompressedSize / compressedSize > 200)) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains an unsafe compressed entry.');
    }
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR central directory is truncated.');
    const centralName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const centralExtra = bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
    assertNoZip64Extra(centralExtra);
    const name = safeEntryName(centralName);
    const isDirectory = name.endsWith('/');
    if ((madeBy >>> 8) === 3 && unixType !== 0
      && !((isDirectory && (unixType === 0x4000 || externalAttributes === 0xffff0000))
        || (!isDirectory && unixType === 0x8000))) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains a non-regular archive entry.');
    }
    if (isDirectory && (uncompressedSize !== 0 || crc !== 0
      || !((compression === 0 && compressedSize === 0) || (compression === 8 && compressedSize === 2)))) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains an invalid directory entry.');
    }
    const canonical = name.normalize('NFC').toLowerCase();
    if (entries.has(canonical)) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains duplicate entry names.');
    totalUncompressed += uncompressedSize;
    budget.uncompressed += uncompressedSize;
    if (totalUncompressed > MAX_JAR_UNCOMPRESSED || budget.uncompressed > MAX_JAR_UNCOMPRESSED) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR expanded beyond its safe limit.');
    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR local entry is malformed.');
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localCompression = bytes.readUInt16LE(localOffset + 8);
    const localCrc = bytes.readUInt32LE(localOffset + 14);
    const localCompressedSize = bytes.readUInt32LE(localOffset + 18);
    const localUncompressedSize = bytes.readUInt32LE(localOffset + 22);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localHeaderEnd = localOffset + 30 + localNameLength + localExtraLength;
    if (localFlags !== flags || localCompression !== compression || localHeaderEnd > centralOffset
      || ((flags & 0x0008) === 0 && (localCrc !== crc || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize))
      || ((flags & 0x0008) !== 0 && (localCrc !== 0 || localCompressedSize !== 0 || localUncompressedSize !== 0))
      || !bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(centralName)) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR local and central entries do not match.');
    }
    assertNoZip64Extra(bytes.subarray(localOffset + 30 + localNameLength, localHeaderEnd));
    const dataEnd = localHeaderEnd + compressedSize;
    if (dataEnd > centralOffset) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR entry overlaps archive metadata.');
    let localEnd = dataEnd;
    if ((flags & 0x0008) !== 0) {
      if (dataEnd + 16 > centralOffset || bytes.readUInt32LE(dataEnd) !== 0x08074b50
        || bytes.readUInt32LE(dataEnd + 4) !== crc || bytes.readUInt32LE(dataEnd + 8) !== compressedSize
        || bytes.readUInt32LE(dataEnd + 12) !== uncompressedSize) {
        throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR data descriptor does not match its central entry.');
      }
      localEnd += 16;
    }
    if (isDirectory && compression === 8
      && (bytes[localHeaderEnd] !== 0x03 || bytes[localHeaderEnd + 1] !== 0x00)) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains an invalid directory entry.');
    }
    localRanges.push([localOffset, localEnd]);
    entries.set(canonical, { name, compression, crc, compressedSize, uncompressedSize, localOffset, dataOffset: localHeaderEnd });
    cursor = end;
  }
  if (cursor !== centralOffset + centralSize) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR central directory size is inconsistent.');
  localRanges.sort((left, right) => left[0] - right[0]);
  if (localRanges[0]?.[0] !== 0 || localRanges.at(-1)?.[1] !== centralOffset) {
    throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains unaccounted archive data.');
  }
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index][0] !== localRanges[index - 1][1]) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains overlapping or hidden entry data.');
  }
  const readEntry = (name, maximum = MAX_NESTED_ENTRY_BYTES) => {
    const entry = entries.get(name.toLowerCase());
    if (!entry) throw modError('MOD_INTEGRITY_FAILED', 409, `The mod JAR is missing ${name}.`);
    if (entry.name.endsWith('/')) throw modError('MOD_INTEGRITY_FAILED', 409, 'A directory entry cannot be read as mod data.');
    if (entry.uncompressedSize > maximum) throw modError('MOD_INTEGRITY_FAILED', 409, 'A nested mod archive entry exceeded its safe size.');
    const start = entry.dataOffset;
    const end = start + entry.compressedSize;
    if (end > bytes.length) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR entry is truncated.');
    const compressed = bytes.subarray(start, end);
    let output;
    try {
      output = entry.compression === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
    } catch { throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR entry could not be decompressed safely.'); }
    if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR entry integrity check failed.');
    return output;
  };
  const fabricEntries = [...entries.values()].filter((entry) => entry.name.toLowerCase() === 'fabric.mod.json');
  if (fabricEntries.length === 0 && !requireFabricMetadata) return { ids: [], depends: [], breaks: [], conflicts: [], nested: [] };
  if (fabricEntries.length !== 1) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR must contain exactly one root fabric.mod.json.');
  const metadataBytes = readEntry('fabric.mod.json', MAX_FABRIC_JSON_BYTES);
  if (metadataBytes.length < 2 || metadataBytes.length > MAX_FABRIC_JSON_BYTES) throw modError('MOD_INTEGRITY_FAILED', 409, 'fabric.mod.json exceeded its safe size.');
  let metadata;
  try { metadata = strictJsonParse(UTF8.decode(metadataBytes)); } catch { throw modError('MOD_INTEGRITY_FAILED', 409, 'fabric.mod.json is malformed or has duplicate keys.'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !MOD_ID.test(metadata.id ?? '')
    || metadata.schemaVersion !== 1 || typeof metadata.version !== 'string' || metadata.version.length < 1 || metadata.version.length > 128
    || !normalizeSemver(metadata.version) || ![undefined, '*', 'server', 'client'].includes(metadata.environment)
    || (depth === 0 && metadata.environment === 'client')) {
    throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR declares invalid or client-only Fabric metadata.');
  }
  const ids = new Set([metadata.id]);
  if (metadata.provides !== undefined && !Array.isArray(metadata.provides)) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR declares malformed Fabric provides metadata.');
  if (Array.isArray(metadata.provides)) {
    for (const id of metadata.provides) {
      if (!MOD_ID.test(id) || ids.has(id)) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR declares invalid duplicate Fabric identifiers.');
      ids.add(id);
    }
  }
  const serverRelevant = metadata.environment !== 'client';
  if (serverRelevant) for (const id of ids) if (protectedIds.has(id)) throw modError('MOD_CORE_PROTECTED', 409, 'A third-party mod attempted to claim a protected Fabric/core identifier.');
  const dependencyMaps = {};
  for (const key of ['depends', 'breaks', 'conflicts']) {
    const value = metadata[key] ?? {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw modError('MOD_INTEGRITY_FAILED', 409, `The mod JAR has malformed ${key} metadata.`);
    dependencyMaps[key] = Object.create(null);
    for (const [id, predicate] of Object.entries(value)) {
      if (!MOD_ID.test(id)) throw modError('MOD_INTEGRITY_FAILED', 409, `The mod JAR has an invalid ${key} identifier.`);
      dependencyMaps[key][id] = predicates(predicate);
    }
  }
  const nested = [];
  if (metadata.jars !== undefined) {
    if (!Array.isArray(metadata.jars)) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR nested-jar metadata is malformed.');
    for (const item of metadata.jars) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 1 || typeof item.file !== 'string') throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR nested-jar metadata is malformed.');
      if (!serverRelevant) continue;
      budget.nested += 1;
      if (depth >= MAX_NESTED_DEPTH || budget.nested > MAX_NESTED_JARS) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains too many nested archives.');
      nested.push(parseArchive(readEntry(item.file, MAX_NESTED_ENTRY_BYTES), budget, depth + 1, false, protectedIds));
    }
  }
  return {
    id: metadata.id, version: normalizeSemver(metadata.version), environment: metadata.environment ?? '*',
    ids: serverRelevant ? [...ids] : [], depends: dependencyMaps.depends, breaks: dependencyMaps.breaks, conflicts: dependencyMaps.conflicts, nested,
  };
}

function flattenMetadata(root) {
  const values = [];
  const visit = (item) => {
    if (item.ids.length > 0) values.push({
      id: item.id, version: item.version, environment: item.environment, ids: item.ids,
      depends: item.depends, breaks: item.breaks, conflicts: item.conflicts,
    });
    for (const nested of item.nested) visit(nested);
  };
  visit(root);
  return values;
}

async function validateTrustedPath(target, anchorRoot, trustedRoot, allowDirectory) {
  const trusted = path.resolve(trustedRoot);
  const anchor = path.resolve(anchorRoot);
  const resolved = path.resolve(target);
  if ((anchor !== trusted && !anchor.startsWith(`${trusted}${path.sep}`))
    || (resolved !== anchor && !resolved.startsWith(`${anchor}${path.sep}`))) {
    throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact escaped its trusted storage boundary.');
  }
  const rootStat = await fs.lstat(trusted);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw modError('MOD_INTEGRITY_FAILED', 409, 'The trusted mod storage root is a link or reparse boundary.');
  let current = trusted;
  const relative = path.relative(trusted, resolved);
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (!allowDirectory && current === resolved ? !stat.isFile() : !stat.isDirectory())) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact path contains a link or non-regular boundary.');
    }
  }
  const [realTrusted, realTarget] = await Promise.all([fs.realpath(trusted), fs.realpath(resolved)]);
  if (realTarget !== realTrusted && !realTarget.startsWith(`${realTrusted}${path.sep}`)) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact escaped its canonical storage boundary.');
  return fs.lstat(resolved);
}

async function openAnchoredRegularFile(file, anchorRoot, trustedRoot, maximum) {
  const root = path.resolve(anchorRoot);
  const namedBefore = await validateTrustedPath(file, root, trustedRoot, false);
  const handle = await fs.open(file, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || namedBefore.isSymbolicLink() || before.nlink !== 1 || namedBefore.nlink !== 1
      || before.size < 1 || before.size > maximum
      || (before.ino && namedBefore.ino && (before.dev !== namedBefore.dev || before.ino !== namedBefore.ino))) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact is not a safe regular file.');
    }
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
    if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact escaped its managed staging boundary.');
    const named = await fs.stat(realFile);
    if (!named.isFile() || named.nlink !== 1 || named.size !== before.size
      || (before.ino && named.ino && (before.dev !== named.dev || before.ino !== named.ino))) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact identity changed before verification.');
    }
    return { handle, before, anchorRoot: root, trustedRoot };
  } catch (error) { await handle.close().catch(() => undefined); throw error; }
}

export async function inspectFabricModJar(file, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => !['trustedCore', 'protectedIds', 'anchorRoot', 'trustedRoot'].includes(key))) {
    throw new TypeError('Invalid Fabric JAR inspection options');
  }
  const extraProtected = options.protectedIds ?? [];
  if (!Array.isArray(extraProtected) || extraProtected.some((id) => !MOD_ID.test(id))) throw new TypeError('protectedIds must contain valid Fabric identifiers');
  const anchorRoot = options.anchorRoot ?? path.dirname(file); const trustedRoot = options.trustedRoot ?? anchorRoot;
  const { handle, before } = await openAnchoredRegularFile(file, anchorRoot, trustedRoot, MAX_MOD_BYTES);
  let bytes;
  try {
    if (before.size < 22) throw modError('MOD_INTEGRITY_FAILED', 409, 'The downloaded mod is not a safe regular JAR file.');
    bytes = Buffer.allocUnsafe(before.size);
    let position = 0;
    while (position < bytes.length) {
      const { bytesRead } = await handle.read(bytes, position, bytes.length - position, position);
      if (bytesRead < 1) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact could not be read completely.');
      position += bytesRead;
    }
    const after = await handle.stat();
    const namedAfter = await validateTrustedPath(file, anchorRoot, trustedRoot, false);
    if (after.size !== before.size || after.nlink !== 1 || (before.ino && after.ino && (before.dev !== after.dev || before.ino !== after.ino))) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact changed during verification.');
    }
    if (namedAfter.isSymbolicLink() || namedAfter.nlink !== 1
      || (after.ino && namedAfter.ino && (after.dev !== namedAfter.dev || after.ino !== namedAfter.ino))) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact name changed during verification.');
  } finally { await handle.close(); }
  const protectedIds = options.trustedCore ? new Set() : new Set([...RESERVED_MOD_IDS, ...extraProtected]);
  const metadata = flattenMetadata(parseArchive(bytes, { uncompressed: 0, nested: 0, archiveBytes: 0, entries: 0 }, 0, true, protectedIds));
  const identifiers = new Set();
  for (const item of metadata) {
    for (const id of item.ids) {
      if (identifiers.has(id)) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod JAR contains duplicate Fabric identifiers.');
      identifiers.add(id);
    }
  }
  return metadata;
}

export async function sha512File(file, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => !['anchorRoot', 'trustedRoot'].includes(key))) throw new TypeError('Invalid hash options');
  const anchorRoot = options.anchorRoot ?? path.dirname(file); const trustedRoot = options.trustedRoot ?? anchorRoot;
  const { handle, before } = await openAnchoredRegularFile(file, anchorRoot, trustedRoot, MAX_MOD_BYTES);
  const hash = crypto.createHash('sha512');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024); let position = 0;
    while (position < before.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (bytesRead < 1) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact could not be hashed completely.');
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const after = await handle.stat();
    const namedAfter = await validateTrustedPath(file, anchorRoot, trustedRoot, false);
    if (after.size !== before.size || after.nlink !== 1 || (before.ino && after.ino && (before.dev !== after.dev || before.ino !== after.ino))) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact changed while hashing.');
    if (namedAfter.isSymbolicLink() || namedAfter.nlink !== 1
      || (after.ino && namedAfter.ino && (after.dev !== namedAfter.dev || after.ino !== namedAfter.ino))) throw modError('MOD_INTEGRITY_FAILED', 409, 'The mod artifact name changed while hashing.');
    return hash.digest('hex');
  } finally { await handle.close(); }
}

/**
 * Proves Fabric metadata across the complete proposed runtime set.  The caller
 * supplies only inspector results produced above; public input never reaches
 * this boundary. Unsupported Fabric predicate grammar is rejected during JAR
 * inspection rather than being approximated.
 */
export function validateFabricCandidateGraph({ artifacts, coreMetadata, minecraftVersion, loaderVersion, javaMajor }) {
  if (!Array.isArray(artifacts) || artifacts.length > MAX_GRAPH_NODES || !Array.isArray(coreMetadata)
    || coreMetadata.length > MAX_GRAPH_NODES || !Number.isInteger(javaMajor) || javaMajor < 8 || javaMajor > 99) {
    throw new TypeError('A bounded inspected Fabric candidate graph is required');
  }
  const index = new Map();
  const add = (id, version, source) => {
    const normalized = normalizeSemver(version);
    if (!MOD_ID.test(id) || !normalized) throw modError('MOD_INTEGRITY_FAILED', 409, 'An inspected Fabric identifier has no provable version.');
    const existing = index.get(id);
    if (!existing) {
      index.set(id, { versions: new Set([normalized]), sources: new Set([source]) });
      return;
    }
    if (source !== 'core' || [...existing.sources].some((item) => item !== 'core')) {
      throw modError('MOD_INTEGRITY_FAILED', 409, 'The proposed mod set contains duplicate Fabric identifiers.');
    }
    existing.versions.add(normalized);
    existing.sources.add(source);
  };
  add('minecraft', normalizeSemver(minecraftVersion) ?? '', 'platform');
  add('fabricloader', normalizeSemver(loaderVersion) ?? '', 'platform');
  add('java', `${javaMajor}.0.0`, 'platform');
  const inspected = [];
  let metadataCount = 0;
  for (const [source, collection] of [['core', coreMetadata], ['candidate', artifacts]]) {
    for (const artifact of collection) {
      if (!artifact || !Array.isArray(artifact.metadata) || artifact.metadata.length < 1 || artifact.metadata.length > MAX_JAR_ENTRIES) {
        throw modError('MOD_INTEGRITY_FAILED', 409, 'An inspected Fabric artifact manifest is malformed.');
      }
      for (const metadata of artifact.metadata) {
        metadataCount += 1;
        if (metadataCount > MAX_GRAPH_JAR_ENTRIES) throw modError('MOD_INTEGRITY_FAILED', 409, 'The proposed Fabric metadata graph exceeded its safe bound.');
        if (!metadata || !Array.isArray(metadata.ids) || metadata.ids.length < 1) throw modError('MOD_INTEGRITY_FAILED', 409, 'An inspected Fabric artifact manifest is incomplete.');
        for (const id of metadata.ids) add(id, metadata.version, source);
        inspected.push({ metadata, source });
      }
    }
  }
  for (const { metadata, source } of inspected) {
    for (const [id, accepted] of Object.entries(metadata.depends)) {
      const target = index.get(id);
      const candidateOnlyTarget = source === 'core' && target && [...target.sources].every((item) => item === 'candidate');
      if (!target || candidateOnlyTarget || [...target.versions].some((version) => !fabricVersionSatisfies(version, accepted))) {
        throw modError('MOD_DEPENDENCY_UNRESOLVED', 409, 'The proposed mod set does not satisfy all declared Fabric dependencies.');
      }
    }
    for (const key of ['breaks', 'conflicts']) {
      for (const [id, rejected] of Object.entries(metadata[key])) {
        const target = index.get(id);
        if (target && [...target.versions].some((version) => fabricVersionSatisfies(version, rejected))) {
          throw modError('MOD_INCOMPATIBLE', 409, 'The proposed mod set contains a declared Fabric incompatibility.');
        }
      }
    }
  }
  return Object.freeze({ identifiers: Object.freeze([...index.keys()].sort()), artifactCount: artifacts.length });
}

export const MODRINTH_CORE_PROJECTS = Object.freeze({
  fabricApi: 'P7dR8mSH', geyser: 'wKkoqHrH', floodgate: 'bWrNNfkb',
});
