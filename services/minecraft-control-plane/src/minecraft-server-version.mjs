import crypto from 'node:crypto';
import { constants as FS_CONSTANTS } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import zlib from 'node:zlib';

const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._+\-]{0,95}$/;
const MAX_SERVER_JAR_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 50_000;
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_VERSION_JSON_BYTES = 64 * 1024;
const MAX_BUNDLE_LIST_BYTES = 1024 * 1024;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

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

function strictJsonParse(text) {
  let index = 0;
  const whitespace = () => { while ([' ', '\t', '\r', '\n'].includes(text[index])) index += 1; };
  const string = () => {
    const start = index;
    if (text[index++] !== '"') throw new Error('expected string');
    while (index < text.length) {
      if (text[index] === '"') {
        index += 1;
        const parsed = JSON.parse(text.slice(start, index));
        if (typeof parsed !== 'string') throw new Error('invalid string');
        return parsed;
      }
      const code = text.charCodeAt(index);
      if (code < 0x20) throw new Error('raw control character in string');
      if (text[index] === '\\') {
        const escape = text[index + 1];
        if (escape === 'u') {
          if (!/^[0-9a-f]{4}$/i.test(text.slice(index + 2, index + 6))) throw new Error('invalid Unicode escape');
          index += 6;
        } else {
          if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) throw new Error('invalid string escape');
          index += 2;
        }
      } else index += 1;
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

function assertNoZip64Extra(bytes) {
  let cursor = 0;
  while (cursor < bytes.length) {
    if (cursor + 4 > bytes.length) throw new Error('malformed ZIP extra field');
    const kind = bytes.readUInt16LE(cursor); const size = bytes.readUInt16LE(cursor + 2); cursor += 4;
    if (cursor + size > bytes.length || kind === 0x0001) throw new Error('unsupported ZIP64 metadata');
    cursor += size;
  }
}

function safeArchiveName(bytes) {
  const name = UTF8.decode(bytes);
  const withoutSlash = name.endsWith('/') ? name.slice(0, -1) : name;
  const parts = withoutSlash.split('/');
  if (!withoutSlash || name !== name.normalize('NFC') || name.includes('\\') || name.includes(':') || name.includes('\0')
    || /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(name)
    || name.startsWith('/') || /^[A-Za-z]:/u.test(name)
    || parts.some((part) => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ') || WINDOWS_DEVICE.test(part))) {
    throw new Error('unsafe ZIP entry name');
  }
  return name;
}

function versionJsonFromJar(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_SERVER_JAR_BYTES) {
    throw new Error('Minecraft server artifact is not a bounded JAR');
  }
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= searchStart; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50
      && index + 22 + bytes.readUInt16LE(index + 20) === bytes.length) { eocd = index; break; }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0
    || bytes.readUInt16LE(eocd + 8) !== bytes.readUInt16LE(eocd + 10)) throw new Error('unsupported Minecraft server JAR layout');
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entryCount < 1 || entryCount === 0xffff || entryCount > MAX_ARCHIVE_ENTRIES
    || centralSize === 0xffffffff || centralSize > MAX_CENTRAL_DIRECTORY_BYTES
    || centralOffset === 0xffffffff || centralOffset + centralSize !== eocd) {
    throw new Error('Minecraft server JAR central directory exceeded its safe limits');
  }

  const names = new Set(); let cursor = centralOffset; let expandedBytes = 0; let versionEntry = null;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('malformed Minecraft server JAR central directory');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || (flags & 0x0001) !== 0 || ![0, 8].includes(method)
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff
      || (compressedSize === 0 && uncompressedSize > 0)
      || (compressedSize > 0 && uncompressedSize / compressedSize > 200)) throw new Error('unsafe Minecraft server JAR entry');
    assertNoZip64Extra(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
    const centralName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = safeArchiveName(centralName); const canonicalName = name.toLocaleLowerCase('en-US');
    if (names.has(canonicalName)) throw new Error('duplicate Minecraft server JAR entry');
    names.add(canonicalName);
    expandedBytes += uncompressedSize;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) throw new Error('Minecraft server JAR expanded beyond its safe limit');
    if (canonicalName === 'version.json') {
      if (name !== 'version.json' || versionEntry) throw new Error('Minecraft server JAR contains ambiguous version metadata');
      versionEntry = { flags, method, crc, compressedSize, uncompressedSize, localOffset, centralName };
    }
    cursor = end;
  }
  if (cursor !== eocd || !versionEntry || versionEntry.uncompressedSize < 2 || versionEntry.uncompressedSize > MAX_VERSION_JSON_BYTES) {
    throw new Error('Minecraft server JAR omitted valid version.json metadata');
  }

  const entry = versionEntry; const local = entry.localOffset;
  if (local + 30 > centralOffset || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('malformed version.json local entry');
  const localFlags = bytes.readUInt16LE(local + 6); const localMethod = bytes.readUInt16LE(local + 8);
  const localCrc = bytes.readUInt32LE(local + 14); const localCompressed = bytes.readUInt32LE(local + 18);
  const localUncompressed = bytes.readUInt32LE(local + 22); const localNameLength = bytes.readUInt16LE(local + 26);
  const localExtraLength = bytes.readUInt16LE(local + 28); const dataOffset = local + 30 + localNameLength + localExtraLength;
  if (localFlags !== entry.flags || localMethod !== entry.method || dataOffset > centralOffset
    || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(entry.centralName)
    || ((entry.flags & 0x0008) === 0 && (localCrc !== entry.crc || localCompressed !== entry.compressedSize || localUncompressed !== entry.uncompressedSize))
    || ((entry.flags & 0x0008) !== 0 && (localCrc !== 0 || localCompressed !== 0 || localUncompressed !== 0))) {
    throw new Error('version.json local entry disagreed with its central metadata');
  }
  assertNoZip64Extra(bytes.subarray(local + 30 + localNameLength, dataOffset));
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > centralOffset) throw new Error('version.json entry overlaps archive metadata');
  if ((entry.flags & 0x0008) !== 0) {
    const signed = dataEnd + 16 <= centralOffset && bytes.readUInt32LE(dataEnd) === 0x08074b50;
    const descriptor = signed ? dataEnd + 4 : dataEnd;
    if (descriptor + 12 > centralOffset || bytes.readUInt32LE(descriptor) !== entry.crc
      || bytes.readUInt32LE(descriptor + 4) !== entry.compressedSize
      || bytes.readUInt32LE(descriptor + 8) !== entry.uncompressedSize) throw new Error('version.json data descriptor is invalid');
  }
  const compressed = bytes.subarray(dataOffset, dataEnd);
  let output;
  try { output = entry.method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize }); }
  catch { throw new Error('version.json could not be decompressed safely'); }
  if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc) throw new Error('version.json failed ZIP integrity verification');
  return output;
}

function normalizeExpected(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) || !VERSION.test(expected.minecraftVersion ?? '')
    || !Number.isInteger(expected.size) || expected.size < 1 || expected.size > MAX_SERVER_JAR_BYTES
    || !SHA1.test(expected.sha1 ?? '') || (expected.sha256 !== undefined && !SHA256.test(expected.sha256 ?? ''))) {
    throw new TypeError('Trusted Minecraft server artifact metadata is invalid');
  }
  return { minecraftVersion: expected.minecraftVersion, size: expected.size, sha1: expected.sha1.toLowerCase(),
    sha256: expected.sha256?.toLowerCase() };
}

function zipEntries(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_SERVER_JAR_BYTES) {
    throw new Error('Minecraft server artifact is not a bounded JAR');
  }
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= searchStart; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50
      && index + 22 + bytes.readUInt16LE(index + 20) === bytes.length) { eocd = index; break; }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0
    || bytes.readUInt16LE(eocd + 8) !== bytes.readUInt16LE(eocd + 10)) throw new Error('unsupported Minecraft server JAR layout');
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entryCount < 1 || entryCount === 0xffff || entryCount > MAX_ARCHIVE_ENTRIES
    || centralSize === 0xffffffff || centralSize > MAX_CENTRAL_DIRECTORY_BYTES
    || centralOffset === 0xffffffff || centralOffset + centralSize !== eocd) {
    throw new Error('Minecraft server JAR central directory exceeded its safe limits');
  }
  const entries = new Map();
  const canonicalNames = new Set();
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('malformed Minecraft server JAR central directory');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || (flags & 0x0001) !== 0 || ![0, 8].includes(method)
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff
      || (compressedSize === 0 && uncompressedSize > 0)
      || (compressedSize > 0 && uncompressedSize / compressedSize > 200)) throw new Error('unsafe Minecraft server JAR entry');
    assertNoZip64Extra(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
    const centralName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = safeArchiveName(centralName);
    const canonicalName = name.toLocaleLowerCase('en-US');
    if (canonicalNames.has(canonicalName)) throw new Error('duplicate Minecraft server JAR entry');
    canonicalNames.add(canonicalName);
    expandedBytes += uncompressedSize;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw new Error('Minecraft server JAR expanded beyond its safe limit');
    }
    const local = localOffset;
    if (local + 30 > centralOffset || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error(`malformed local ZIP entry for ${name}`);
    const localFlags = bytes.readUInt16LE(local + 6);
    const localMethod = bytes.readUInt16LE(local + 8);
    const localCrc = bytes.readUInt32LE(local + 14);
    const localCompressed = bytes.readUInt32LE(local + 18);
    const localUncompressed = bytes.readUInt32LE(local + 22);
    const localNameLength = bytes.readUInt16LE(local + 26);
    const localExtraLength = bytes.readUInt16LE(local + 28);
    const dataOffset = local + 30 + localNameLength + localExtraLength;
    if (localFlags !== flags || localMethod !== method || dataOffset > centralOffset
      || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(centralName)
      || ((flags & 0x0008) === 0 && (localCrc !== crc || localCompressed !== compressedSize || localUncompressed !== uncompressedSize))
      || ((flags & 0x0008) !== 0 && (localCrc !== 0 || localCompressed !== 0 || localUncompressed !== 0))) {
      throw new Error(`local ZIP entry disagreed with central metadata for ${name}`);
    }
    assertNoZip64Extra(bytes.subarray(local + 30 + localNameLength, dataOffset));
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > centralOffset) throw new Error(`ZIP entry overlaps archive metadata for ${name}`);
    if ((flags & 0x0008) !== 0) {
      const signed = dataEnd + 16 <= centralOffset && bytes.readUInt32LE(dataEnd) === 0x08074b50;
      const descriptor = signed ? dataEnd + 4 : dataEnd;
      if (descriptor + 12 > centralOffset || bytes.readUInt32LE(descriptor) !== crc
        || bytes.readUInt32LE(descriptor + 4) !== compressedSize
        || bytes.readUInt32LE(descriptor + 8) !== uncompressedSize) throw new Error(`invalid ZIP data descriptor for ${name}`);
    }
    entries.set(name, { name, method, crc, compressedSize, uncompressedSize, dataOffset, directory: name.endsWith('/') });
    cursor = end;
  }
  if (cursor !== eocd) throw new Error('malformed Minecraft server JAR central directory');
  return entries;
}

function extractEntry(bytes, entry, maximumBytes) {
  if (!entry || entry.directory || entry.uncompressedSize > maximumBytes) throw new Error('Minecraft server bundle entry exceeded its safe limit');
  const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  let output;
  try { output = entry.method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize }); }
  catch { throw new Error(`Minecraft server bundle entry could not be decompressed safely: ${entry.name}`); }
  if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc) {
    throw new Error(`Minecraft server bundle entry failed ZIP integrity verification: ${entry.name}`);
  }
  return output;
}

function parseBundleList(bytes, label) {
  if (bytes.length < 1 || bytes.length > MAX_BUNDLE_LIST_BYTES) throw new Error(`${label} exceeded its safe limit`);
  let text;
  try { text = UTF8.decode(bytes); } catch { throw new Error(`${label} is not valid UTF-8`); }
  const result = [];
  const names = new Set();
  const ids = new Set();
  for (const line of text.split(/\r?\n/u)) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length !== 3 || !SHA256.test(parts[0]) || !parts[1] || parts[1].length > 256
      || /[\x00-\x1f\x7f]/u.test(parts[1])) throw new Error(`${label} contains invalid metadata`);
    const relativePath = safeArchiveName(Buffer.from(parts[2], 'utf8'));
    if (relativePath.endsWith('/') || names.has(relativePath.toLocaleLowerCase('en-US')) || ids.has(parts[1])) {
      throw new Error(`${label} contains a duplicate or invalid path`);
    }
    names.add(relativePath.toLocaleLowerCase('en-US'));
    ids.add(parts[1]);
    result.push({ sha256: parts[0].toLowerCase(), id: parts[1], relativePath });
  }
  if (result.length < 1) throw new Error(`${label} is empty`);
  return result;
}

async function verifiedServerJarBytes(file, expected) {
  const trusted = normalizeExpected(expected);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== trusted.size) {
    throw new Error('Minecraft server artifact is not the trusted regular file');
  }
  const bytes = await fs.readFile(file);
  const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha1 !== trusted.sha1 || (trusted.sha256 && sha256 !== trusted.sha256)) {
    throw new Error('Minecraft server artifact failed trusted digest verification');
  }
  return { bytes, sha256, trusted };
}

export async function materializeVerifiedMinecraftServerBundle(file, expected, destination) {
  const { bytes, sha256: outerSha256, trusted } = await verifiedServerJarBytes(file, expected);
  const entries = zipEntries(bytes);
  const librariesEntry = entries.get('META-INF/libraries.list');
  const versionsEntry = entries.get('META-INF/versions.list');
  if (!librariesEntry && !versionsEntry) {
    const relativePath = `mojang/versions/${outerSha256}/server.jar`;
    const target = pathForBundleDestination(destination, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: 'wx' });
    return { bundled: false, outerSha256, gameJar: { relativePath, sha256: outerSha256, size: bytes.length }, libraries: [] };
  }
  if (!librariesEntry || !versionsEntry) throw new Error('Minecraft server bundle metadata is incomplete');
  const libraries = parseBundleList(extractEntry(bytes, librariesEntry, MAX_BUNDLE_LIST_BYTES), 'Minecraft server libraries.list');
  const versions = parseBundleList(extractEntry(bytes, versionsEntry, MAX_BUNDLE_LIST_BYTES), 'Minecraft server versions.list');
  if (versions.length !== 1) throw new Error('Minecraft server bundle must identify exactly one launch version JAR');
  if (versions[0].id !== trusted.minecraftVersion) {
    throw new Error('Minecraft server bundle version identity does not match the trusted release');
  }
  const listedArchivePaths = new Set([
    ...libraries.map((entry) => `META-INF/libraries/${entry.relativePath}`),
    ...versions.map((entry) => `META-INF/versions/${entry.relativePath}`),
  ]);
  for (const entry of entries.values()) {
    if (!entry.directory && (entry.name.startsWith('META-INF/libraries/') || entry.name.startsWith('META-INF/versions/'))
      && !listedArchivePaths.has(entry.name)) throw new Error(`Minecraft server bundle contains an unlisted launch artifact: ${entry.name}`);
  }
  const materialized = [];
  for (const item of [...libraries, ...versions]) {
    const kind = libraries.includes(item) ? 'libraries' : 'versions';
    const archiveName = `META-INF/${kind}/${item.relativePath}`;
    const entry = entries.get(archiveName);
    if (!entry) throw new Error(`Minecraft server bundle omitted ${archiveName}`);
    const output = extractEntry(bytes, entry, MAX_SERVER_JAR_BYTES);
    if (crypto.createHash('sha256').update(output).digest('hex') !== item.sha256) {
      throw new Error(`Minecraft server bundle digest failed for ${archiveName}`);
    }
    const relativePath = `mojang/${kind}/${item.relativePath}`;
    const target = pathForBundleDestination(destination, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, output, { flag: 'wx' });
    materialized.push({ relativePath, sha256: item.sha256, size: output.length, id: item.id, kind });
  }
  const gameJar = materialized.find((entry) => entry.kind === 'versions');
  return {
    bundled: true,
    outerSha256,
    gameJar: { relativePath: gameJar.relativePath, sha256: gameJar.sha256, size: gameJar.size, id: gameJar.id },
    libraries: materialized.filter((entry) => entry.kind === 'libraries').map(({ kind, ...entry }) => entry),
  };
}

function pathForBundleDestination(destination, relativePath) {
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) throw new TypeError('Bundle destination must be absolute');
  const parts = relativePath.split('/');
  const target = path.resolve(destination, ...parts);
  const relative = path.relative(path.resolve(destination), target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Minecraft server bundle output escaped its destination');
  }
  return target;
}

export function minecraftServerRelativePath(minecraftVersion) {
  if (!VERSION.test(minecraftVersion ?? '')) throw new TypeError('Minecraft version is unsafe for a managed server artifact path');
  return `versions/${minecraftVersion}/server-${minecraftVersion}.jar`;
}

export async function inspectVerifiedMinecraftServerJar(file, expected) {
  const trusted = normalizeExpected(expected);
  const namedBefore = await fs.lstat(file);
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1 || namedBefore.size !== trusted.size) {
    throw new Error('Minecraft server artifact is not the trusted regular file');
  }
  const handle = await fs.open(file, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size !== trusted.size
      || (opened.ino && namedBefore.ino && (opened.dev !== namedBefore.dev || opened.ino !== namedBefore.ino))) {
      throw new Error('Minecraft server artifact changed during verification');
    }
    bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== trusted.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.nlink !== 1) {
      throw new Error('Minecraft server artifact changed during verification');
    }
  } finally { await handle.close(); }
  const namedAfter = await fs.lstat(file);
  if (!namedAfter.isFile() || namedAfter.isSymbolicLink() || namedAfter.nlink !== 1 || namedAfter.size !== trusted.size
    || (namedAfter.ino && namedBefore.ino && (namedAfter.dev !== namedBefore.dev || namedAfter.ino !== namedBefore.ino))) {
    throw new Error('Minecraft server artifact path changed during verification');
  }
  const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha1 !== trusted.sha1 || (trusted.sha256 && sha256 !== trusted.sha256)) throw new Error('Minecraft server artifact failed trusted digest verification');
  let metadata;
  try { metadata = strictJsonParse(UTF8.decode(versionJsonFromJar(bytes))); }
  catch (error) { throw new Error(`Minecraft server version metadata is invalid: ${error.message}`); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.id !== trusted.minecraftVersion
    || !Number.isSafeInteger(metadata.world_version) || metadata.world_version < 1 || metadata.world_version > 0x7fffffff) {
    throw new Error('Minecraft server version metadata does not match the trusted release');
  }
  return { minecraftVersion: trusted.minecraftVersion, worldDataVersion: metadata.world_version,
    relativePath: minecraftServerRelativePath(trusted.minecraftVersion), size: trusted.size, sha1, sha256 };
}

export const __test = Object.freeze({ strictJsonParse, versionJsonFromJar });
