import crypto from 'node:crypto';
import path from 'node:path';
import { WINDOWS_NODE_PACKAGE_PROFILE } from './windows-node-package-tree.mjs';

export const WINDOWS_NODE_HOST_CONFIG_SCHEMA_VERSION = 1;
export const WINDOWS_NODE_HOST_CONFIG_PROVIDER = 'mastermind-windows-node-host-config-v1';
export const WINDOWS_NODE_HOST_CONFIG_NAME = 'host-config-v1.json';
export const WINDOWS_NODE_HOST_RUNTIME_RELATIVE_ROOT = 'runtime-v1';
export const WINDOWS_NODE_HOST_SUPERVISOR_RELATIVE_PATH = String.raw`scripts\run-local-control.mjs`;
export const WINDOWS_NODE_PACKAGE_SCHEMA_VERSION = 1;
export const WINDOWS_NODE_PACKAGE_PROVIDER = 'mastermind-portable-package-manifest-v1';
export const WINDOWS_NODE_PACKAGE_PAYLOAD_PROVIDER = 'mastermind-portable-package-payload-v1';
export const WINDOWS_NODE_PACKAGE_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256';

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAX_CONFIG_BYTES = 32 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_RUNTIME_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024 * 1024;

export class WindowsNodeHostContractError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'WindowsNodeHostContractError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new WindowsNodeHostContractError(code, message, cause ? { cause } : undefined);
}

function record(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value, keys) {
  return record(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedWindowsPath(value, { allowDriveRoot = false } = {}) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 1024
    || value.includes('\0') || /[\x00-\x1f\x7f]/u.test(value)
    || !/^[A-Za-z]:\\/u.test(value) || !path.win32.isAbsolute(value)
    || value.includes('/') || /[<>"|?*:]/u.test(value.slice(2))) return null;
  const resolved = path.win32.resolve(value);
  const isDriveRoot = path.win32.parse(resolved).root === resolved;
  if (isDriveRoot) return allowDriveRoot && value.length === 3 ? resolved : null;
  const segments = value.slice(3).split('\\');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'
    || segment.endsWith(' ') || segment.endsWith('.')
    || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(segment))
    || resolved.toLocaleLowerCase('en-US') !== value.toLocaleLowerCase('en-US')) return null;
  return resolved;
}

function normalizedRelativeWindowsPath(value, { exact } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512
    || value.includes('/') || value.includes('\0') || /[\x00-\x1f\x7f]/u.test(value)
    || path.win32.isAbsolute(value) || /[<>"|?*:]/u.test(value)) return null;
  if (value === '.') return exact === undefined ? value : null;
  const normalized = path.win32.normalize(value);
  if (normalized !== value || normalized === '..' || normalized.startsWith('..\\')) return null;
  const segments = value.split('\\');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'
    || segment.endsWith(' ') || segment.endsWith('.'))) return null;
  if (exact !== undefined && value !== exact) return null;
  return value;
}

function positiveBytes(value, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function validBase64(value, minBytes, maxBytes) {
  if (typeof value !== 'string' || !BASE64.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length >= minBytes && decoded.length <= maxBytes
    && decoded.toString('base64') === value;
}

export function createWindowsNodePackageManifest({
  packageId,
  packageDigestSha256,
  packageBytes,
  packageFileCount,
  volumeIdentitySha256,
  supervisorSha256,
  supervisorBytes,
  privateKey,
  publicKey,
}) {
  const draft = {
    schemaVersion: WINDOWS_NODE_PACKAGE_SCHEMA_VERSION,
    provider: WINDOWS_NODE_PACKAGE_PAYLOAD_PROVIDER,
    packageId,
    packageProfile: WINDOWS_NODE_PACKAGE_PROFILE,
    packageDigestSha256,
    packageBytes,
    packageFileCount,
    volumeIdentitySha256,
    supervisorRelativePath: WINDOWS_NODE_HOST_SUPERVISOR_RELATIVE_PATH,
    supervisorSha256,
    supervisorBytes,
  };
  validatePackagePayload(draft);
  const payloadBytes = Buffer.from(canonicalJson(draft), 'utf8');
  const publicKeyBytes = publicKey.export({ type: 'spki', format: 'der' });
  const signatureBytes = crypto.sign('sha256', payloadBytes, {
    key: privateKey,
    dsaEncoding: 'der',
  });
  const manifest = {
    schemaVersion: WINDOWS_NODE_PACKAGE_SCHEMA_VERSION,
    provider: WINDOWS_NODE_PACKAGE_PROVIDER,
    payloadBase64: payloadBytes.toString('base64'),
    signature: {
      algorithm: WINDOWS_NODE_PACKAGE_SIGNATURE_ALGORITHM,
      publicKeySpkiBase64: publicKeyBytes.toString('base64'),
      valueBase64: signatureBytes.toString('base64'),
    },
  };
  return Object.freeze({
    manifest: structuredClone(manifest),
    payload: Object.freeze(structuredClone(draft)),
    manifestBytes: Buffer.from(canonicalJson(manifest), 'utf8'),
    publicKeySha256: sha256Bytes(publicKeyBytes),
  });
}

function validatePackagePayload(value) {
  if (!exactKeys(value, [
    'schemaVersion', 'provider', 'packageId', 'packageProfile', 'packageDigestSha256',
    'packageBytes', 'packageFileCount', 'volumeIdentitySha256', 'supervisorRelativePath',
    'supervisorSha256', 'supervisorBytes',
  ]) || value.schemaVersion !== WINDOWS_NODE_PACKAGE_SCHEMA_VERSION
    || value.provider !== WINDOWS_NODE_PACKAGE_PAYLOAD_PROVIDER
    || typeof value.packageId !== 'string' || !UUID.test(value.packageId)
    || value.packageProfile !== WINDOWS_NODE_PACKAGE_PROFILE
    || typeof value.packageDigestSha256 !== 'string' || !SHA256.test(value.packageDigestSha256)
    || !positiveBytes(value.packageBytes, MAX_PACKAGE_BYTES)
    || typeof value.volumeIdentitySha256 !== 'string' || !SHA256.test(value.volumeIdentitySha256)
    || value.supervisorRelativePath !== WINDOWS_NODE_HOST_SUPERVISOR_RELATIVE_PATH
    || typeof value.supervisorSha256 !== 'string' || !SHA256.test(value.supervisorSha256)
    || !positiveBytes(value.supervisorBytes, MAX_PACKAGE_BYTES)
    || !Number.isSafeInteger(value.packageFileCount) || value.packageFileCount < 1
    || value.packageFileCount > 100_000) {
    fail('HOST_PACKAGE_PAYLOAD_INVALID', 'The portable package payload is invalid.');
  }
  return Object.freeze(structuredClone(value));
}

export function parseAndVerifyWindowsNodePackageManifest(bytes, {
  expectedManifestSha256,
  expectedPublicKeySha256,
} = {}) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? '');
  if (body.length < 1 || body.length > MAX_MANIFEST_BYTES
    || typeof expectedManifestSha256 !== 'string' || !SHA256.test(expectedManifestSha256)
    || typeof expectedPublicKeySha256 !== 'string' || !SHA256.test(expectedPublicKeySha256)
    || sha256Bytes(body) !== expectedManifestSha256) {
    fail('HOST_PACKAGE_MANIFEST_INVALID', 'The portable package manifest failed its pinned identity check.');
  }
  let value;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    value = JSON.parse(text);
    if (canonicalJson(value) !== text) throw new Error('The manifest is not canonical JSON');
  } catch (error) {
    fail('HOST_PACKAGE_MANIFEST_INVALID', 'The portable package manifest is invalid.', error);
  }
  if (!exactKeys(value, ['schemaVersion', 'provider', 'payloadBase64', 'signature'])
    || value.schemaVersion !== WINDOWS_NODE_PACKAGE_SCHEMA_VERSION
    || value.provider !== WINDOWS_NODE_PACKAGE_PROVIDER
    || !validBase64(value.payloadBase64, 128, MAX_MANIFEST_BYTES)
    || !exactKeys(value.signature, ['algorithm', 'publicKeySpkiBase64', 'valueBase64'])
    || value.signature.algorithm !== WINDOWS_NODE_PACKAGE_SIGNATURE_ALGORITHM
    || !validBase64(value.signature.publicKeySpkiBase64, 64, 1024)
    || !validBase64(value.signature.valueBase64, 64, 256)) {
    fail('HOST_PACKAGE_MANIFEST_INVALID', 'The portable package manifest is invalid.');
  }
  const payloadBytes = Buffer.from(value.payloadBase64, 'base64');
  const publicKeyBytes = Buffer.from(value.signature.publicKeySpkiBase64, 'base64');
  if (sha256Bytes(publicKeyBytes) !== expectedPublicKeySha256) {
    fail('HOST_PACKAGE_MANIFEST_INVALID', 'The portable package signing identity changed unexpectedly.');
  }
  let verified = false;
  try {
    verified = crypto.verify('sha256', payloadBytes, {
      key: crypto.createPublicKey({ key: publicKeyBytes, format: 'der', type: 'spki' }),
      dsaEncoding: 'der',
    }, Buffer.from(value.signature.valueBase64, 'base64'));
  } catch (error) {
    fail('HOST_PACKAGE_MANIFEST_INVALID', 'The portable package signature could not be verified.', error);
  }
  if (!verified) fail('HOST_PACKAGE_MANIFEST_INVALID', 'The portable package signature is invalid.');
  let payload;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
    payload = JSON.parse(text);
    if (canonicalJson(payload) !== text) throw new Error('The signed payload is not canonical JSON');
  } catch (error) {
    fail('HOST_PACKAGE_PAYLOAD_INVALID', 'The portable package payload is invalid.', error);
  }
  return Object.freeze({
    manifest: Object.freeze(structuredClone(value)),
    payload: validatePackagePayload(payload),
    manifestSha256: expectedManifestSha256,
    publicKeySha256: expectedPublicKeySha256,
  });
}

export function createWindowsNodeHostConfig({
  hostId,
  hostLauncherSha256,
  hostLauncherBytes,
  packageManifest,
  bundleRootHint,
  runtimeSha256,
  runtimeBytes,
}) {
  const root = normalizedWindowsPath(bundleRootHint, { allowDriveRoot: true });
  if (!root) fail('HOST_CONFIG_INVALID', 'The host bundle root is invalid.');
  const volumeRoot = path.win32.parse(root).root;
  const relative = path.win32.relative(volumeRoot, root) || '.';
  const config = {
    schemaVersion: WINDOWS_NODE_HOST_CONFIG_SCHEMA_VERSION,
    provider: WINDOWS_NODE_HOST_CONFIG_PROVIDER,
    hostId,
    hostLauncherSha256,
    hostLauncherBytes,
    package: {
      packageId: packageManifest.payload.packageId,
      packageDigestSha256: packageManifest.payload.packageDigestSha256,
      packageBytes: packageManifest.payload.packageBytes,
      volumeIdentitySha256: packageManifest.payload.volumeIdentitySha256,
      bundleRootHint: root,
      bundlePathFromVolumeRoot: relative,
      manifestSha256: packageManifest.manifestSha256,
      manifestPublicKeySha256: packageManifest.publicKeySha256,
    },
    launch: {
      runtimeRelativePath: `${WINDOWS_NODE_HOST_RUNTIME_RELATIVE_ROOT}\\${runtimeSha256}\\node.exe`,
      runtimeSha256,
      runtimeBytes,
      supervisorRelativePath: WINDOWS_NODE_HOST_SUPERVISOR_RELATIVE_PATH,
      arguments: ['--production'],
    },
  };
  return validateWindowsNodeHostConfig(config);
}

export function validateWindowsNodeHostConfig(value) {
  if (!exactKeys(value, [
    'schemaVersion', 'provider', 'hostId', 'hostLauncherSha256', 'hostLauncherBytes', 'package', 'launch',
  ])
    || value.schemaVersion !== WINDOWS_NODE_HOST_CONFIG_SCHEMA_VERSION
    || value.provider !== WINDOWS_NODE_HOST_CONFIG_PROVIDER
    || typeof value.hostId !== 'string' || !UUID.test(value.hostId)
    || typeof value.hostLauncherSha256 !== 'string' || !SHA256.test(value.hostLauncherSha256)
    || !positiveBytes(value.hostLauncherBytes, 64 * 1024 * 1024)
    || !exactKeys(value.package, [
      'packageId', 'packageDigestSha256', 'packageBytes', 'volumeIdentitySha256',
      'bundleRootHint', 'bundlePathFromVolumeRoot', 'manifestSha256', 'manifestPublicKeySha256',
    ]) || typeof value.package.packageId !== 'string' || !UUID.test(value.package.packageId)
    || typeof value.package.packageDigestSha256 !== 'string' || !SHA256.test(value.package.packageDigestSha256)
    || !positiveBytes(value.package.packageBytes, MAX_PACKAGE_BYTES)
    || typeof value.package.volumeIdentitySha256 !== 'string' || !SHA256.test(value.package.volumeIdentitySha256)
    || !normalizedWindowsPath(value.package.bundleRootHint, { allowDriveRoot: true })
    || !normalizedRelativeWindowsPath(value.package.bundlePathFromVolumeRoot)
    || typeof value.package.manifestSha256 !== 'string' || !SHA256.test(value.package.manifestSha256)
    || typeof value.package.manifestPublicKeySha256 !== 'string' || !SHA256.test(value.package.manifestPublicKeySha256)
    || !exactKeys(value.launch, [
      'runtimeRelativePath', 'runtimeSha256', 'runtimeBytes', 'supervisorRelativePath', 'arguments',
    ]) || !normalizedRelativeWindowsPath(value.launch.runtimeRelativePath)
    || typeof value.launch.runtimeSha256 !== 'string' || !SHA256.test(value.launch.runtimeSha256)
    || value.launch.runtimeRelativePath
      !== `${WINDOWS_NODE_HOST_RUNTIME_RELATIVE_ROOT}\\${value.launch.runtimeSha256}\\node.exe`
    || !positiveBytes(value.launch.runtimeBytes, MAX_RUNTIME_BYTES)
    || !normalizedRelativeWindowsPath(value.launch.supervisorRelativePath, {
      exact: WINDOWS_NODE_HOST_SUPERVISOR_RELATIVE_PATH,
    }) || !Array.isArray(value.launch.arguments) || value.launch.arguments.length !== 1
    || value.launch.arguments[0] !== '--production') {
    fail('HOST_CONFIG_INVALID', 'The fixed Mastermind node host configuration is invalid.');
  }
  const root = normalizedWindowsPath(value.package.bundleRootHint, { allowDriveRoot: true });
  const expectedRelative = path.win32.relative(path.win32.parse(root).root, root) || '.';
  if (expectedRelative.toLocaleLowerCase('en-US')
    !== value.package.bundlePathFromVolumeRoot.toLocaleLowerCase('en-US')) {
    fail('HOST_CONFIG_INVALID', 'The host bundle root hint does not match its volume-relative path.');
  }
  return Object.freeze(structuredClone(value));
}

export function parseWindowsNodeHostConfig(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? '');
  if (body.length < 1 || body.length > MAX_CONFIG_BYTES) {
    fail('HOST_CONFIG_INVALID', 'The fixed Mastermind node host configuration is invalid.');
  }
  let value;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    value = JSON.parse(text);
    if (canonicalJson(value) !== text) throw new Error('The configuration is not canonical JSON');
  } catch (error) {
    fail('HOST_CONFIG_INVALID', 'The fixed Mastermind node host configuration is invalid.', error);
  }
  return validateWindowsNodeHostConfig(value);
}

export function serializeWindowsNodeHostConfig(value) {
  return Buffer.from(canonicalJson(validateWindowsNodeHostConfig(value)), 'utf8');
}

export const __test = Object.freeze({
  MAX_CONFIG_BYTES,
  MAX_MANIFEST_BYTES,
  normalizedWindowsPath,
  normalizedRelativeWindowsPath,
});
