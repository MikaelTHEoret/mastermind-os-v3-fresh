import crypto from 'node:crypto';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';

const SHA256 = /^[a-f0-9]{64}$/;
const STORAGE_KEY = /^objects\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.(?:jpg|png)$/;

function archiveError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function resolveGenealogyArchiveRoot(environment = process.env) {
  const configured = String(environment.MASTERMIND_GENEALOGY_ARCHIVE_ROOT ?? '').trim();
  if (configured) {
    if (!path.isAbsolute(configured)) throw archiveError('ARCHIVE_ROOT_INVALID', 'The genealogy archive root must be absolute.');
    return path.resolve(configured);
  }
  const localAppData = String(environment.LOCALAPPDATA ?? '').trim();
  if (!localAppData || !path.isAbsolute(localAppData)) {
    throw archiveError('ARCHIVE_ROOT_UNAVAILABLE', 'LOCALAPPDATA is unavailable for the private genealogy archive.');
  }
  return path.resolve(localAppData, 'Mastermind', 'genealogy', 'archive-v1');
}

export function detectArchiveImage(bytes, declaredType = '') {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) throw archiveError('ARCHIVE_IMAGE_INVALID', 'The archive image is empty or truncated.');
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const detected = jpeg ? { mediaType: 'image/jpeg', extension: 'jpg' } : png ? { mediaType: 'image/png', extension: 'png' } : null;
  if (!detected) throw archiveError('ARCHIVE_IMAGE_INVALID', 'Only genuine JPEG and PNG archive images are accepted.');
  if (declaredType && declaredType !== detected.mediaType && !(declaredType === 'image/jpg' && detected.mediaType === 'image/jpeg')) {
    throw archiveError('ARCHIVE_IMAGE_TYPE_MISMATCH', 'The declared image type does not match its bytes.');
  }
  return detected;
}

async function verifyExisting(target, expectedHash) {
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw archiveError('ARCHIVE_OBJECT_INVALID', 'An archive object path is not a regular file.');
  const bytes = await readFile(target);
  if (sha256Hex(bytes) !== expectedHash) throw archiveError('ARCHIVE_OBJECT_HASH_MISMATCH', 'An existing archive object failed content verification.');
}

/**
 * @param {{bytes: Buffer, declaredType?: string, expectedSha256?: string | null, environment?: Record<string, string | undefined>}} input
 */
export async function persistArchiveImage({ bytes, declaredType = '', expectedSha256 = null, environment = process.env }) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('bytes must be a Buffer');
  const detected = detectArchiveImage(bytes, declaredType);
  const sha256 = sha256Hex(bytes);
  if (expectedSha256 && (!SHA256.test(expectedSha256) || expectedSha256 !== sha256)) {
    throw archiveError('ARCHIVE_IMAGE_HASH_MISMATCH', 'The supplied digest does not match the archive image.');
  }
  const root = resolveGenealogyArchiveRoot(environment);
  const storageKey = `objects/sha256/${sha256.slice(0, 2)}/${sha256}.${detected.extension}`;
  const target = path.join(root, ...storageKey.split('/'));
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${sha256}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let created = false;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, target);
      created = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await verifyExisting(target, sha256);
    }
  } finally {
    await unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
  return { sha256, mediaType: detected.mediaType, byteSize: bytes.length, storageKey, created, root };
}

export async function readArchiveImage(storageKey, environment = process.env) {
  const targetReal = await resolveArchiveImagePath(storageKey, environment);
  return readFile(targetReal);
}

export async function resolveArchiveImagePath(storageKey, environment = process.env) {
  if (!STORAGE_KEY.test(String(storageKey ?? ''))) throw archiveError('ARCHIVE_STORAGE_KEY_INVALID', 'The archive storage key is invalid.');
  const root = resolveGenealogyArchiveRoot(environment);
  const rootReal = await realpath(root);
  const target = path.resolve(root, ...storageKey.split('/'));
  const targetReal = await realpath(target);
  const relative = path.relative(rootReal, targetReal);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw archiveError('ARCHIVE_STORAGE_ESCAPE', 'The archive object escaped its managed root.');
  const info = await lstat(targetReal);
  if (!info.isFile() || info.isSymbolicLink()) throw archiveError('ARCHIVE_OBJECT_INVALID', 'The archive object is not a regular file.');
  return targetReal;
}

export function captureSecretMatches(secret, expectedDigest) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256 || !SHA256.test(String(expectedDigest ?? ''))) return false;
  const actual = Buffer.from(sha256Hex(secret), 'hex');
  const expected = Buffer.from(expectedDigest, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export const archiveStoreContract = Object.freeze({
  maxImageBytes: 24 * 1024 * 1024,
  sha256Pattern: SHA256,
  storageKeyPattern: STORAGE_KEY,
  exclusiveCopyFlag: fsConstants.COPYFILE_EXCL,
});
