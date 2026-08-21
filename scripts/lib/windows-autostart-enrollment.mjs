import crypto from 'node:crypto';
import path from 'node:path';

export const WINDOWS_AUTOSTART_SCHEMA_VERSION = 1;
export const WINDOWS_AUTOSTART_HOST_PROVIDER = 'mastermind-host-launcher-attestation-v1';
export const WINDOWS_AUTOSTART_BUNDLE_PROVIDER = 'mastermind-portable-package-attestation-v1';
export const WINDOWS_AUTOSTART_USER_PROVIDER = 'windows-current-user-v1';
export const WINDOWS_AUTOSTART_OWNER = 'mastermind-portable-node-autostart-v1';
export const WINDOWS_AUTOSTART_TASK_FOLDER = '\\';
export const WINDOWS_AUTOSTART_TASK_NAME = 'Mastermind Portable Node';
export const WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT = String.raw`Mastermind\host-v1`;
export const WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME = 'MastermindNodeHost.exe';
export const WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME = 'mastermind-node-package.json';

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const USER_SID = /^S-1-5-21-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})$/u;
const SAFE_PACKAGE_BYTES = 4 * 1024 * 1024 * 1024;
const SAFE_LAUNCHER_BYTES = 64 * 1024 * 1024;
const SAFE_MANIFEST_BYTES = 1024 * 1024;

const TASK_SETTINGS = Object.freeze({
  allowDemandStart: true,
  disallowStartIfOnBatteries: false,
  executionTimeLimit: 'PT0S',
  hidden: true,
  multipleInstances: 'ignore-new',
  restartCount: 3,
  restartInterval: 'PT1M',
  runOnlyIfNetworkAvailable: false,
  startWhenAvailable: true,
  stopIfGoingOnBatteries: false,
});

export class WindowsAutostartEnrollmentError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'WindowsAutostartEnrollmentError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new WindowsAutostartEnrollmentError(code, message, cause ? { cause } : undefined);
}

function record(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value, keys) {
  return record(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
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

function sameWindowsPath(left, right, options) {
  const normalizedLeft = normalizedWindowsPath(left, options);
  const normalizedRight = normalizedWindowsPath(right, options);
  return Boolean(normalizedLeft && normalizedRight
    && normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US'));
}

function validateCurrentUser(value) {
  if (!exactKeys(value, ['schemaVersion', 'provider', 'sid', 'interactiveSession'])
    || value.schemaVersion !== WINDOWS_AUTOSTART_SCHEMA_VERSION
    || value.provider !== WINDOWS_AUTOSTART_USER_PROVIDER
    || value.interactiveSession !== true || typeof value.sid !== 'string' || !USER_SID.test(value.sid)) {
    fail('AUTOSTART_USER_INVALID', 'The current interactive Windows user identity is unavailable.');
  }
  return Object.freeze({ sid: value.sid });
}

function validateHostAttestation(value) {
  if (!exactKeys(value, [
    'schemaVersion', 'provider', 'hostId', 'localAppDataRoot', 'canonicalLocalAppDataRoot',
    'hostRoot', 'canonicalHostRoot', 'launcher', 'pathProof',
  ]) || value.schemaVersion !== WINDOWS_AUTOSTART_SCHEMA_VERSION
    || value.provider !== WINDOWS_AUTOSTART_HOST_PROVIDER
    || typeof value.hostId !== 'string' || !UUID.test(value.hostId)) {
    fail('AUTOSTART_HOST_INVALID', 'The fixed per-user Mastermind host launcher failed validation.');
  }
  const localAppDataRoot = normalizedWindowsPath(value.localAppDataRoot);
  if (!localAppDataRoot || !sameWindowsPath(value.canonicalLocalAppDataRoot, localAppDataRoot)) {
    fail('AUTOSTART_HOST_INVALID', 'The fixed per-user Mastermind host launcher failed validation.');
  }
  const hostRoot = path.win32.join(localAppDataRoot, WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT);
  const launcherPath = path.win32.join(hostRoot, WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME);
  if (!sameWindowsPath(value.hostRoot, hostRoot) || !sameWindowsPath(value.canonicalHostRoot, hostRoot)
    || !exactKeys(value.pathProof, [
      'fixedLocalVolume', 'reparsePointSeen', 'canonicalPathVerified', 'knownFolderVerified',
    ]) || value.pathProof.fixedLocalVolume !== true || value.pathProof.reparsePointSeen !== false
    || value.pathProof.canonicalPathVerified !== true || value.pathProof.knownFolderVerified !== true
    || !exactKeys(value.launcher, [
      'path', 'canonicalPath', 'kind', 'reparsePoint', 'subsystem', 'sha256', 'bytes',
    ]) || !sameWindowsPath(value.launcher.path, launcherPath)
    || !sameWindowsPath(value.launcher.canonicalPath, launcherPath)
    || value.launcher.kind !== 'file' || value.launcher.reparsePoint !== false
    || value.launcher.subsystem !== 'windows-gui'
    || typeof value.launcher.sha256 !== 'string' || !SHA256.test(value.launcher.sha256)
    || !Number.isSafeInteger(value.launcher.bytes) || value.launcher.bytes < 1
    || value.launcher.bytes > SAFE_LAUNCHER_BYTES) {
    fail('AUTOSTART_HOST_INVALID', 'The fixed per-user Mastermind host launcher failed validation.');
  }
  return deepFreeze({
    hostId: value.hostId,
    hostRoot,
    launcherPath,
    launcherSha256: value.launcher.sha256,
  });
}

function validatePortablePackageAttestation(value) {
  if (!exactKeys(value, [
    'schemaVersion', 'provider', 'packageId', 'packageDigestSha256', 'packageBytes',
    'volumeIdentitySha256', 'bundleRoot', 'canonicalBundleRoot', 'manifest', 'pathProof',
  ]) || value.schemaVersion !== WINDOWS_AUTOSTART_SCHEMA_VERSION
    || value.provider !== WINDOWS_AUTOSTART_BUNDLE_PROVIDER
    || typeof value.packageId !== 'string' || !UUID.test(value.packageId)
    || typeof value.packageDigestSha256 !== 'string' || !SHA256.test(value.packageDigestSha256)
    || !Number.isSafeInteger(value.packageBytes) || value.packageBytes < 1
    || value.packageBytes > SAFE_PACKAGE_BYTES
    || typeof value.volumeIdentitySha256 !== 'string' || !SHA256.test(value.volumeIdentitySha256)) {
    fail('AUTOSTART_PACKAGE_INVALID', 'The portable Mastermind package failed exact identity validation.');
  }
  const bundleRoot = normalizedWindowsPath(value.bundleRoot, { allowDriveRoot: true });
  const manifestPath = bundleRoot
    ? path.win32.join(bundleRoot, WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME)
    : null;
  if (!bundleRoot || !sameWindowsPath(value.canonicalBundleRoot, bundleRoot, { allowDriveRoot: true })
    || !exactKeys(value.pathProof, [
      'localVolume', 'reparsePointSeen', 'canonicalPathVerified', 'volumeIdentityVerified',
    ]) || value.pathProof.localVolume !== true || value.pathProof.reparsePointSeen !== false
    || value.pathProof.canonicalPathVerified !== true || value.pathProof.volumeIdentityVerified !== true
    || !exactKeys(value.manifest, [
      'path', 'canonicalPath', 'kind', 'reparsePoint', 'sha256', 'bytes', 'signatureVerified',
    ]) || !sameWindowsPath(value.manifest.path, manifestPath)
    || !sameWindowsPath(value.manifest.canonicalPath, manifestPath)
    || value.manifest.kind !== 'file' || value.manifest.reparsePoint !== false
    || typeof value.manifest.sha256 !== 'string' || !SHA256.test(value.manifest.sha256)
    || !Number.isSafeInteger(value.manifest.bytes) || value.manifest.bytes < 1
    || value.manifest.bytes > SAFE_MANIFEST_BYTES || value.manifest.signatureVerified !== true) {
    fail('AUTOSTART_PACKAGE_INVALID', 'The portable Mastermind package failed exact identity validation.');
  }
  return deepFreeze({
    packageId: value.packageId,
    packageDigestSha256: value.packageDigestSha256,
    volumeIdentitySha256: value.volumeIdentitySha256,
    bundleRoot,
    manifestSha256: value.manifest.sha256,
  });
}

function validateAdapter(adapter) {
  const methods = [
    'inspectCurrentUser', 'inspectHostLauncher', 'inspectPortablePackage',
    'readTask', 'registerTask', 'setTaskEnabled',
  ];
  if (!record(adapter) || methods.some((method) => typeof adapter[method] !== 'function')) {
    fail('AUTOSTART_ADAPTER_INVALID', 'The Windows autostart native adapter is unavailable.');
  }
  return adapter;
}

function taskDefinition({ hostRoot, launcherPath, userSid }) {
  return {
    schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
    principal: {
      kind: 'current-user',
      userSid,
      logonType: 'interactive-token',
      runLevel: 'least-privilege',
    },
    triggers: [{
      kind: 'logon',
      userSid,
      delay: 'PT15S',
      enabled: true,
    }],
    actions: [{
      kind: 'exec',
      executable: launcherPath,
      arguments: [],
      workingDirectory: hostRoot,
    }],
    settings: { ...TASK_SETTINGS },
  };
}

function ownershipId({ hostId, userSid }) {
  return sha256(canonicalJson({
    schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
    owner: WINDOWS_AUTOSTART_OWNER,
    hostId,
    userSid,
    folder: WINDOWS_AUTOSTART_TASK_FOLDER,
    name: WINDOWS_AUTOSTART_TASK_NAME,
  }));
}

function registrationData({ host, portablePackage, userSid, definitionSha256 }) {
  return {
    schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
    owner: WINDOWS_AUTOSTART_OWNER,
    ownershipId: ownershipId({ hostId: host.hostId, userSid }),
    hostId: host.hostId,
    hostLauncherSha256: host.launcherSha256,
    packageId: portablePackage.packageId,
    packageDigestSha256: portablePackage.packageDigestSha256,
    volumeIdentitySha256: portablePackage.volumeIdentitySha256,
    manifestSha256: portablePackage.manifestSha256,
    definitionSha256,
  };
}

function createPlan(user, host, portablePackage) {
  const definition = taskDefinition({
    hostRoot: host.hostRoot,
    launcherPath: host.launcherPath,
    userSid: user.sid,
  });
  const definitionSha256 = sha256(canonicalJson(definition));
  return deepFreeze({
    schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
    kind: 'windows-current-user-logon',
    routine: true,
    task: {
      folder: WINDOWS_AUTOSTART_TASK_FOLDER,
      name: WINDOWS_AUTOSTART_TASK_NAME,
    },
    host: { ...host },
    portablePackage: { ...portablePackage },
    registrationData: registrationData({ host, portablePackage, userSid: user.sid, definitionSha256 }),
    definition,
  });
}

function validateSafeManagedDefinition(value, expected) {
  if (!exactKeys(value, ['schemaVersion', 'principal', 'triggers', 'actions', 'settings'])
    || value.schemaVersion !== WINDOWS_AUTOSTART_SCHEMA_VERSION
    || !exactKeys(value.principal, ['kind', 'userSid', 'logonType', 'runLevel'])
    || value.principal.kind !== 'current-user' || value.principal.userSid !== expected.definition.principal.userSid
    || value.principal.logonType !== 'interactive-token' || value.principal.runLevel !== 'least-privilege'
    || !Array.isArray(value.triggers) || value.triggers.length !== 1
    || !exactKeys(value.triggers[0], ['kind', 'userSid', 'delay', 'enabled'])
    || value.triggers[0].kind !== 'logon' || value.triggers[0].userSid !== expected.definition.principal.userSid
    || value.triggers[0].delay !== 'PT15S' || value.triggers[0].enabled !== true
    || !Array.isArray(value.actions) || value.actions.length !== 1
    || !exactKeys(value.actions[0], ['kind', 'executable', 'arguments', 'workingDirectory'])
    || value.actions[0].kind !== 'exec' || !Array.isArray(value.actions[0].arguments)
    || value.actions[0].arguments.length !== 0
    || !sameWindowsPath(value.actions[0].executable, expected.host.launcherPath)
    || !sameWindowsPath(value.actions[0].workingDirectory, expected.host.hostRoot)
    || canonicalJson(value.settings) !== canonicalJson(TASK_SETTINGS)) {
    fail('AUTOSTART_FOREIGN_TASK', 'The reserved Mastermind autostart task is foreign or was modified.');
  }
}

function validateRegistrationData(value, plan, definition) {
  if (!exactKeys(value, [
    'schemaVersion', 'owner', 'ownershipId', 'hostId', 'hostLauncherSha256', 'packageId',
    'packageDigestSha256', 'volumeIdentitySha256', 'manifestSha256', 'definitionSha256',
  ]) || value.schemaVersion !== WINDOWS_AUTOSTART_SCHEMA_VERSION
    || value.owner !== WINDOWS_AUTOSTART_OWNER || value.hostId !== plan.host.hostId
    || value.packageId !== plan.portablePackage.packageId
    || value.ownershipId !== ownershipId({
      hostId: plan.host.hostId,
      userSid: plan.definition.principal.userSid,
    })
    || typeof value.hostLauncherSha256 !== 'string' || !SHA256.test(value.hostLauncherSha256)
    || typeof value.packageDigestSha256 !== 'string' || !SHA256.test(value.packageDigestSha256)
    || typeof value.volumeIdentitySha256 !== 'string' || !SHA256.test(value.volumeIdentitySha256)
    || typeof value.manifestSha256 !== 'string' || !SHA256.test(value.manifestSha256)
    || typeof value.definitionSha256 !== 'string' || !SHA256.test(value.definitionSha256)
    || value.definitionSha256 !== sha256(canonicalJson(definition))) {
    fail('AUTOSTART_FOREIGN_TASK', 'The reserved Mastermind autostart task is foreign or was modified.');
  }
}

function inspectObservedTask(value, plan) {
  if (value === null) return Object.freeze({ state: 'not-installed', enabled: null, current: false });
  if (!exactKeys(value, ['schemaVersion', 'folder', 'name', 'enabled', 'registrationData', 'definition'])
    || value.schemaVersion !== WINDOWS_AUTOSTART_SCHEMA_VERSION
    || value.folder !== WINDOWS_AUTOSTART_TASK_FOLDER || value.name !== WINDOWS_AUTOSTART_TASK_NAME
    || typeof value.enabled !== 'boolean') {
    fail('AUTOSTART_FOREIGN_TASK', 'The reserved Mastermind autostart task is foreign or was modified.');
  }
  validateRegistrationData(value.registrationData, plan, value.definition);
  validateSafeManagedDefinition(value.definition, plan);
  const current = canonicalJson(value.definition) === canonicalJson(plan.definition)
    && canonicalJson(value.registrationData) === canonicalJson(plan.registrationData);
  return Object.freeze({
    state: current ? (value.enabled ? 'enabled' : 'disabled') : (value.enabled ? 'stale-enabled' : 'stale-disabled'),
    enabled: value.enabled,
    current,
  });
}

function publicStatus(plan, inspected, changed = false) {
  return Object.freeze({
    ok: true,
    state: inspected.state,
    enabled: inspected.enabled,
    current: inspected.current,
    changed,
    task: Object.freeze({ ...plan.task }),
    hostId: plan.host.hostId,
    packageId: plan.portablePackage.packageId,
  });
}

function publicValidation(plan) {
  return Object.freeze({
    ok: true,
    valid: true,
    task: Object.freeze({ ...plan.task }),
    hostId: plan.host.hostId,
    packageId: plan.portablePackage.packageId,
    volumeIdentitySha256: plan.portablePackage.volumeIdentitySha256,
    definitionSha256: plan.registrationData.definitionSha256,
  });
}

async function resolvePlan(adapter) {
  let userValue;
  let hostValue;
  let packageValue;
  try {
    [userValue, hostValue, packageValue] = await Promise.all([
      adapter.inspectCurrentUser(),
      adapter.inspectHostLauncher(Object.freeze({
        schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
        knownFolder: 'FOLDERID_LocalAppData',
        relativeHostRoot: WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT,
        expectedLauncherName: WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME,
      })),
      adapter.inspectPortablePackage(Object.freeze({
        schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
        expectedManifestName: WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME,
        requireSignedManifest: true,
        requireStableVolumeIdentity: true,
      })),
    ]);
  } catch (error) {
    fail('AUTOSTART_INSPECTION_FAILED', 'The Windows autostart prerequisites could not be inspected.', error);
  }
  return createPlan(
    validateCurrentUser(userValue),
    validateHostAttestation(hostValue),
    validatePortablePackageAttestation(packageValue),
  );
}

async function readInspectedTask(adapter, plan) {
  let observed;
  try { observed = await adapter.readTask(Object.freeze({ ...plan.task })); }
  catch (error) { fail('AUTOSTART_INSPECTION_FAILED', 'The Windows autostart task could not be inspected.', error); }
  return inspectObservedTask(observed, plan);
}

/**
 * Compose a fixed current-user Task Scheduler enrollment around an injected
 * native boundary. The task always starts the attested LocalAppData GUI host;
 * portable paths are attested separately and never enter the task definition
 * or registration data.
 */
export function createWindowsAutostartEnrollment(options = {}) {
  if (!exactKeys(options, ['nativeAdapter'])) {
    fail('AUTOSTART_INPUT_INVALID', 'The Windows autostart composition input is invalid.');
  }
  const adapter = validateAdapter(options.nativeAdapter);
  const plan = () => resolvePlan(adapter);
  const validate = async () => publicValidation(await plan());

  const status = async () => {
    const resolved = await plan();
    return publicStatus(resolved, await readInspectedTask(adapter, resolved));
  };

  const enable = async () => {
    const resolved = await plan();
    const before = await readInspectedTask(adapter, resolved);
    if (before.state === 'enabled') return publicStatus(resolved, before);
    let mutationError = null;
    try {
      if (before.state === 'disabled') {
        await adapter.setTaskEnabled(deepFreeze({
          schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
          task: { ...resolved.task },
          ownershipId: resolved.registrationData.ownershipId,
          enabled: true,
        }));
      } else {
        await adapter.registerTask(deepFreeze({
          schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
          replaceOwned: before.state !== 'not-installed',
          enabled: true,
          plan: clone(resolved),
        }));
      }
    } catch (error) { mutationError = error; }
    let after;
    try { after = await readInspectedTask(adapter, resolved); }
    catch (error) {
      if (mutationError) fail('AUTOSTART_MUTATION_FAILED', 'Windows autostart could not be enabled safely.', mutationError);
      throw error;
    }
    if (after.state !== 'enabled') {
      fail('AUTOSTART_MUTATION_FAILED', 'Windows autostart could not be enabled safely.', mutationError);
    }
    return publicStatus(resolved, after, true);
  };

  const disable = async () => {
    const resolved = await plan();
    const before = await readInspectedTask(adapter, resolved);
    if (before.state === 'not-installed' || before.enabled === false) return publicStatus(resolved, before);
    let mutationError = null;
    try {
      await adapter.setTaskEnabled(deepFreeze({
        schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
        task: { ...resolved.task },
        ownershipId: resolved.registrationData.ownershipId,
        enabled: false,
      }));
    } catch (error) { mutationError = error; }
    let after;
    try { after = await readInspectedTask(adapter, resolved); }
    catch (error) {
      if (mutationError) fail('AUTOSTART_MUTATION_FAILED', 'Windows autostart could not be disabled safely.', mutationError);
      throw error;
    }
    if (after.enabled !== false || !['disabled', 'stale-disabled'].includes(after.state)) {
      fail('AUTOSTART_MUTATION_FAILED', 'Windows autostart could not be disabled safely.', mutationError);
    }
    return publicStatus(resolved, after, true);
  };

  return Object.freeze({ plan, validate, status, enable, disable });
}

export const __test = Object.freeze({ canonicalJson, sha256, inspectObservedTask });
