import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  WINDOWS_NODE_HOST_CONFIG_NAME,
  WINDOWS_NODE_HOST_RUNTIME_RELATIVE_ROOT,
  WINDOWS_NODE_HOST_SUPERVISOR_RELATIVE_PATH,
  WindowsNodeHostContractError,
  canonicalJson,
  createWindowsNodeHostConfig,
  createWindowsNodePackageManifest,
  parseAndVerifyWindowsNodePackageManifest,
  parseWindowsNodeHostConfig,
  serializeWindowsNodeHostConfig,
  sha256Bytes,
} from '../lib/windows-node-host-contract.mjs';

const HOST_ID = '123e4567-e89b-42d3-a456-426614174010';
const PACKAGE_ID = '123e4567-e89b-42d3-a456-426614174000';
const VOLUME_IDENTITY = 'a'.repeat(64);
const SUPERVISOR_DIGEST = 'b'.repeat(64);
const RUNTIME_DIGEST = 'c'.repeat(64);

function signedPackage() {
  const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const created = createWindowsNodePackageManifest({
    packageId: PACKAGE_ID,
    packageDigestSha256: 'f'.repeat(64),
    packageBytes: 8192,
    packageFileCount: 12,
    volumeIdentitySha256: VOLUME_IDENTITY,
    supervisorSha256: SUPERVISOR_DIGEST,
    supervisorBytes: 4096,
    ...keyPair,
  });
  return { ...created, manifestSha256: sha256Bytes(created.manifestBytes) };
}

test('the portable bootstrap manifest has a pinned signing identity and exact signed payload', () => {
  const created = signedPackage();
  const verified = parseAndVerifyWindowsNodePackageManifest(created.manifestBytes, {
    expectedManifestSha256: created.manifestSha256,
    expectedPublicKeySha256: created.publicKeySha256,
  });
  assert.equal(verified.payload.packageId, PACKAGE_ID);
  assert.equal(verified.payload.volumeIdentitySha256, VOLUME_IDENTITY);
  assert.equal(verified.payload.supervisorRelativePath, WINDOWS_NODE_HOST_SUPERVISOR_RELATIVE_PATH);
  assert.equal(verified.payload.supervisorSha256, SUPERVISOR_DIGEST);
  assert.equal(verified.payload.packageBytes, 8192);
  assert.equal(verified.payload.packageFileCount, 12);

  const tampered = structuredClone(created.manifest);
  const payload = JSON.parse(Buffer.from(tampered.payloadBase64, 'base64').toString('utf8'));
  payload.supervisorSha256 = 'd'.repeat(64);
  tampered.payloadBase64 = Buffer.from(canonicalJson(payload), 'utf8').toString('base64');
  const tamperedBytes = Buffer.from(canonicalJson(tampered), 'utf8');
  assert.throws(() => parseAndVerifyWindowsNodePackageManifest(tamperedBytes, {
    expectedManifestSha256: sha256Bytes(tamperedBytes),
    expectedPublicKeySha256: created.publicKeySha256,
  }), (error) => error instanceof WindowsNodeHostContractError
    && error.code === 'HOST_PACKAGE_MANIFEST_INVALID');
});

test('host config is canonical, exact, command-free, and keeps portable location outside the task', () => {
  const created = signedPackage();
  const config = createWindowsNodeHostConfig({
    hostId: HOST_ID,
    hostLauncherSha256: 'e'.repeat(64),
    hostLauncherBytes: 4096,
    packageManifest: created,
    bundleRootHint: String.raw`E:\MastermindNode`,
    runtimeSha256: RUNTIME_DIGEST,
    runtimeBytes: 80 * 1024 * 1024,
  });
  assert.equal(config.package.bundlePathFromVolumeRoot, 'MastermindNode');
  assert.equal(config.launch.runtimeRelativePath,
    `${WINDOWS_NODE_HOST_RUNTIME_RELATIVE_ROOT}\\${RUNTIME_DIGEST}\\node.exe`);
  assert.deepEqual(config.launch.arguments, ['--production']);
  assert.equal(Object.hasOwn(config.launch, 'command'), false);
  assert.equal(Object.hasOwn(config.launch, 'url'), false);
  assert.equal(Object.hasOwn(config.launch, 'environment'), false);

  const serialized = serializeWindowsNodeHostConfig(config);
  assert.equal(serialized.toString('utf8'), canonicalJson(config));
  assert.deepEqual(parseWindowsNodeHostConfig(serialized), config);
  const moved = structuredClone(config);
  moved.package.bundleRootHint = String.raw`F:\MastermindNode`;
  assert.equal(parseWindowsNodeHostConfig(Buffer.from(canonicalJson(moved))).package.bundlePathFromVolumeRoot,
    'MastermindNode');
  const injected = structuredClone(config);
  injected.launch.arguments.push('--eval=malicious');
  assert.throws(() => serializeWindowsNodeHostConfig(injected), /configuration is invalid/i);
  const extra = { ...config, secret: 'must never become a config field' };
  assert.throws(() => serializeWindowsNodeHostConfig(extra), /configuration is invalid/i);
  assert.equal(WINDOWS_NODE_HOST_CONFIG_NAME, 'host-config-v1.json');
});

test('manifest and config readers reject non-canonical JSON and oversized input', () => {
  const created = signedPackage();
  const pretty = Buffer.from(JSON.stringify(created.manifest, null, 2));
  assert.throws(() => parseAndVerifyWindowsNodePackageManifest(pretty, {
    expectedManifestSha256: sha256Bytes(pretty),
    expectedPublicKeySha256: created.publicKeySha256,
  }), /manifest is invalid/i);
  assert.throws(() => parseWindowsNodeHostConfig(Buffer.alloc(33 * 1024, 0x20)), /configuration is invalid/i);
});
