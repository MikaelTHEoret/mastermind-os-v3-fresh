import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WINDOWS_AUTOSTART_BUNDLE_PROVIDER,
  WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME,
  WINDOWS_AUTOSTART_HOST_PROVIDER,
  WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT,
  WINDOWS_AUTOSTART_OWNER,
  WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME,
  WINDOWS_AUTOSTART_SCHEMA_VERSION,
  WINDOWS_AUTOSTART_TASK_FOLDER,
  WINDOWS_AUTOSTART_TASK_NAME,
  WINDOWS_AUTOSTART_USER_PROVIDER,
  WindowsAutostartEnrollmentError,
  __test,
  createWindowsAutostartEnrollment,
} from '../lib/windows-autostart-enrollment.mjs';

const LOCAL_APP_DATA = String.raw`C:\Users\Family\AppData\Local`;
const HOST_ROOT = `${LOCAL_APP_DATA}\\${WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT}`;
const HOST_LAUNCHER = `${HOST_ROOT}\\${WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME}`;
const BUNDLE_E = String.raw`E:\MastermindNode`;
const BUNDLE_F = String.raw`F:\MastermindNode`;
const SID = 'S-1-5-21-111111111-222222222-333333333-1001';
const HOST_ID = '123e4567-e89b-42d3-a456-426614174010';
const PACKAGE_ID = '123e4567-e89b-42d3-a456-426614174000';
const HOST_DIGEST = 'a'.repeat(64);
const PACKAGE_DIGEST = 'b'.repeat(64);
const MANIFEST_DIGEST = 'c'.repeat(64);
const VOLUME_IDENTITY = 'd'.repeat(64);

function currentUser(overrides = {}) {
  return {
    schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
    provider: WINDOWS_AUTOSTART_USER_PROVIDER,
    sid: SID,
    interactiveSession: true,
    ...overrides,
  };
}

function host(overrides = {}) {
  return {
    schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
    provider: WINDOWS_AUTOSTART_HOST_PROVIDER,
    hostId: HOST_ID,
    localAppDataRoot: LOCAL_APP_DATA,
    canonicalLocalAppDataRoot: LOCAL_APP_DATA,
    hostRoot: HOST_ROOT,
    canonicalHostRoot: HOST_ROOT,
    launcher: {
      path: HOST_LAUNCHER,
      canonicalPath: HOST_LAUNCHER,
      kind: 'file',
      reparsePoint: false,
      subsystem: 'windows-gui',
      sha256: HOST_DIGEST,
      bytes: 1024,
    },
    pathProof: {
      fixedLocalVolume: true,
      reparsePointSeen: false,
      canonicalPathVerified: true,
      knownFolderVerified: true,
    },
    ...overrides,
  };
}

function portablePackage(bundleRoot = BUNDLE_E, overrides = {}) {
  const manifestPath = `${bundleRoot}\\${WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME}`;
  return {
    schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
    provider: WINDOWS_AUTOSTART_BUNDLE_PROVIDER,
    packageId: PACKAGE_ID,
    packageDigestSha256: PACKAGE_DIGEST,
    packageBytes: 4096,
    volumeIdentitySha256: VOLUME_IDENTITY,
    bundleRoot,
    canonicalBundleRoot: bundleRoot,
    manifest: {
      path: manifestPath,
      canonicalPath: manifestPath,
      kind: 'file',
      reparsePoint: false,
      sha256: MANIFEST_DIGEST,
      bytes: 512,
      signatureVerified: true,
    },
    pathProof: {
      localVolume: true,
      reparsePointSeen: false,
      canonicalPathVerified: true,
      volumeIdentityVerified: true,
    },
    ...overrides,
  };
}

function observed(plan, enabled = true) {
  return {
    schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
    folder: WINDOWS_AUTOSTART_TASK_FOLDER,
    name: WINDOWS_AUTOSTART_TASK_NAME,
    enabled,
    registrationData: structuredClone(plan.registrationData),
    definition: structuredClone(plan.definition),
  };
}

class FakeNativeAdapter {
  constructor(options = {}) {
    this.user = options.user ?? currentUser();
    this.hostValue = options.host ?? host();
    this.packageValue = options.packageValue ?? portablePackage(options.bundleRoot ?? BUNDLE_E);
    this.task = options.task ?? null;
    this.registerBehavior = options.registerBehavior ?? 'succeed';
    this.toggleBehavior = options.toggleBehavior ?? 'succeed';
    this.calls = {
      inspectHostLauncher: [], inspectPortablePackage: [], readTask: [], registerTask: [], setTaskEnabled: [],
    };
  }

  async inspectCurrentUser() { return structuredClone(this.user); }

  async inspectHostLauncher(request) {
    this.calls.inspectHostLauncher.push(structuredClone(request));
    return structuredClone(this.hostValue);
  }

  async inspectPortablePackage(request) {
    this.calls.inspectPortablePackage.push(structuredClone(request));
    return structuredClone(this.packageValue);
  }

  async readTask(identity) {
    this.calls.readTask.push(structuredClone(identity));
    return this.task === null ? null : structuredClone(this.task);
  }

  async registerTask(operation) {
    this.calls.registerTask.push(structuredClone(operation));
    if (this.registerBehavior === 'fail-before') throw new Error('native register failed');
    this.task = observed(operation.plan, operation.enabled);
    if (this.registerBehavior === 'fail-after') throw new Error('native result was ambiguous');
  }

  async setTaskEnabled(operation) {
    this.calls.setTaskEnabled.push(structuredClone(operation));
    if (this.toggleBehavior === 'fail-before') throw new Error('native toggle failed');
    if (this.task !== null) this.task.enabled = operation.enabled;
    if (this.toggleBehavior === 'fail-after') throw new Error('native result was ambiguous');
  }
}

function controller(adapter = new FakeNativeAdapter()) {
  return createWindowsAutostartEnrollment({ nativeAdapter: adapter });
}

async function generatedPlan(options = {}) {
  return controller(new FakeNativeAdapter(options)).plan();
}

function rejectsCode(code) {
  return (error) => error instanceof WindowsAutostartEnrollmentError && error.code === code;
}

test('the task starts only the fixed LocalAppData GUI host and never a USB path or shell', async () => {
  const plan = await generatedPlan();
  assert.equal(plan.routine, true);
  assert.deepEqual(plan.task, {
    folder: '\\',
    name: 'Mastermind Portable Node',
  });
  assert.equal(plan.registrationData.owner, WINDOWS_AUTOSTART_OWNER);
  assert.deepEqual(plan.definition.principal, {
    kind: 'current-user',
    userSid: SID,
    logonType: 'interactive-token',
    runLevel: 'least-privilege',
  });
  assert.deepEqual(plan.definition.triggers, [{ kind: 'logon', userSid: SID, delay: 'PT15S', enabled: true }]);
  assert.deepEqual(plan.definition.actions, [{
    kind: 'exec',
    executable: HOST_LAUNCHER,
    arguments: [],
    workingDirectory: HOST_ROOT,
  }]);
  assert.deepEqual(plan.definition.settings, {
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
  assert.equal(plan.portablePackage.bundleRoot, BUNDLE_E);
  const taskMaterial = JSON.stringify({
    task: plan.task,
    registrationData: plan.registrationData,
    definition: plan.definition,
  }).toLocaleLowerCase('en-US');
  assert.equal(taskMaterial.includes('e:\\\\'), false);
  assert.equal(taskMaterial.includes('mastermindnode\\\\'), false);
  assert.equal(taskMaterial.includes('npm'), false);
  assert.equal(taskMaterial.includes('powershell'), false);
  assert.equal(Object.isFrozen(plan.definition.actions[0]), true);
});

test('callers cannot supply a command, host path, bundle path, or package identity', () => {
  const adapter = new FakeNativeAdapter();
  for (const extra of [
    { command: 'calc.exe' }, { hostLauncherPath: HOST_LAUNCHER },
    { portableBundleRoot: BUNDLE_E }, { packageId: PACKAGE_ID },
  ]) {
    assert.throws(
      () => createWindowsAutostartEnrollment({ nativeAdapter: adapter, ...extra }),
      rejectsCode('AUTOSTART_INPUT_INVALID'),
    );
  }
  assert.throws(
    () => createWindowsAutostartEnrollment({ nativeAdapter: {} }),
    rejectsCode('AUTOSTART_ADAPTER_INVALID'),
  );
});

test('validate uses only injected attestations and does not inspect or mutate Task Scheduler', async () => {
  const adapter = new FakeNativeAdapter();
  const enrollment = controller(adapter);
  const plan = await enrollment.plan();
  const result = await enrollment.validate();
  assert.deepEqual(result, {
    ok: true,
    valid: true,
    task: plan.task,
    hostId: HOST_ID,
    packageId: PACKAGE_ID,
    volumeIdentitySha256: VOLUME_IDENTITY,
    definitionSha256: plan.registrationData.definitionSha256,
  });
  assert.deepEqual(adapter.calls.inspectHostLauncher[0], {
    schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
    knownFolder: 'FOLDERID_LocalAppData',
    relativeHostRoot: WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT,
    expectedLauncherName: WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME,
  });
  assert.deepEqual(adapter.calls.inspectPortablePackage[0], {
    schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
    expectedManifestName: WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME,
    requireSignedManifest: true,
    requireStableVolumeIdentity: true,
  });
  assert.equal(adapter.calls.readTask.length, 0);
  assert.equal(adapter.calls.registerTask.length, 0);
  assert.equal(adapter.calls.setTaskEnabled.length, 0);
});

test('current user, host, and portable package attestations fail closed', async () => {
  const invalidAdapters = [
    new FakeNativeAdapter({ user: currentUser({ interactiveSession: false }) }),
    new FakeNativeAdapter({ user: currentUser({ sid: 'S-1-5-18' }) }),
    new FakeNativeAdapter({ host: host({ canonicalHostRoot: String.raw`C:\Elsewhere` }) }),
    new FakeNativeAdapter({ host: host({ pathProof: { ...host().pathProof, reparsePointSeen: true } }) }),
    new FakeNativeAdapter({ host: host({ launcher: { ...host().launcher, subsystem: 'console' } }) }),
    new FakeNativeAdapter({ packageValue: portablePackage(BUNDLE_E, {
      canonicalBundleRoot: String.raw`F:\Wrong`,
    }) }),
    new FakeNativeAdapter({ packageValue: portablePackage(BUNDLE_E, {
      pathProof: { ...portablePackage().pathProof, reparsePointSeen: true },
    }) }),
    new FakeNativeAdapter({ packageValue: portablePackage(BUNDLE_E, {
      manifest: { ...portablePackage().manifest, signatureVerified: false },
    }) }),
    new FakeNativeAdapter({ packageValue: portablePackage(BUNDLE_E, { volumeIdentitySha256: 'bad' }) }),
  ];
  for (const adapter of invalidAdapters) {
    await assert.rejects(controller(adapter).validate(), (error) => (
      error instanceof WindowsAutostartEnrollmentError
      && ['AUTOSTART_USER_INVALID', 'AUTOSTART_HOST_INVALID', 'AUTOSTART_PACKAGE_INVALID'].includes(error.code)
    ));
    assert.equal(adapter.calls.readTask.length, 0);
  }
});

test('status is read-only and reports absent, enabled, and disabled exactly', async () => {
  const adapter = new FakeNativeAdapter();
  const enrollment = controller(adapter);
  assert.equal((await enrollment.status()).state, 'not-installed');
  assert.equal(adapter.calls.registerTask.length, 0);
  const plan = await enrollment.plan();
  adapter.task = observed(plan, true);
  assert.equal((await enrollment.status()).state, 'enabled');
  adapter.task.enabled = false;
  assert.equal((await enrollment.status()).state, 'disabled');
  assert.equal(adapter.calls.setTaskEnabled.length, 0);
});

test('enable registers the fixed enrollment once and is then idempotent', async () => {
  const adapter = new FakeNativeAdapter();
  const enrollment = controller(adapter);
  const first = await enrollment.enable();
  assert.equal(first.state, 'enabled');
  assert.equal(first.changed, true);
  assert.equal(adapter.calls.registerTask.length, 1);
  assert.equal(adapter.calls.registerTask[0].replaceOwned, false);
  assert.equal(adapter.calls.registerTask[0].plan.definition.actions[0].executable, HOST_LAUNCHER);
  assert.deepEqual(adapter.calls.registerTask[0].plan.definition.actions[0].arguments, []);
  assert.equal((await enrollment.enable()).changed, false);
  assert.equal(adapter.calls.registerTask.length, 1);
});

test('moving the same attested volume from E: to F: leaves the task current', async () => {
  const oldPlan = await generatedPlan({ bundleRoot: BUNDLE_E });
  const adapter = new FakeNativeAdapter({ bundleRoot: BUNDLE_F, task: observed(oldPlan, true) });
  const enrollment = controller(adapter);
  const newPlan = await enrollment.plan();
  assert.deepEqual(newPlan.definition, oldPlan.definition);
  assert.deepEqual(newPlan.registrationData, oldPlan.registrationData);
  assert.notEqual(newPlan.portablePackage.bundleRoot, oldPlan.portablePackage.bundleRoot);
  assert.equal((await enrollment.status()).state, 'enabled');
  assert.equal((await enrollment.enable()).changed, false);
  assert.equal(adapter.calls.registerTask.length, 0);
  assert.equal(adapter.calls.setTaskEnabled.length, 0);
});

test('a copied package on a new volume is stale-owned and refreshes only stable metadata', async () => {
  const oldPlan = await generatedPlan({ bundleRoot: BUNDLE_E });
  const adapter = new FakeNativeAdapter({
    packageValue: portablePackage(BUNDLE_F, { volumeIdentitySha256: 'e'.repeat(64) }),
    task: observed(oldPlan, true),
  });
  const enrollment = controller(adapter);
  assert.equal((await enrollment.status()).state, 'stale-enabled');
  const result = await enrollment.enable();
  assert.equal(result.state, 'enabled');
  assert.equal(result.current, true);
  assert.equal(adapter.calls.registerTask.length, 1);
  assert.equal(adapter.calls.registerTask[0].replaceOwned, true);
  assert.equal(JSON.stringify(adapter.task).includes(BUNDLE_F), false);
});

test('foreign, tampered, path-bearing, or shell-bearing reserved tasks are never mutated', async () => {
  const plan = await generatedPlan();
  const cases = [];
  const foreignOwner = observed(plan);
  foreignOwner.registrationData.owner = 'somebody-else';
  cases.push(foreignOwner);
  const pathBearing = observed(plan);
  pathBearing.registrationData.portableBundleRoot = BUNDLE_E;
  cases.push(pathBearing);
  const inconsistentHash = observed(plan);
  inconsistentHash.definition.actions[0].workingDirectory = String.raw`C:\Elsewhere`;
  cases.push(inconsistentHash);
  const powershell = observed(plan);
  powershell.definition.actions[0] = {
    kind: 'exec',
    executable: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
    arguments: [],
    workingDirectory: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0`,
  };
  powershell.registrationData.definitionSha256 = __test.sha256(__test.canonicalJson(powershell.definition));
  cases.push(powershell);

  for (const task of cases) {
    const adapter = new FakeNativeAdapter({ task });
    await assert.rejects(controller(adapter).enable(), rejectsCode('AUTOSTART_FOREIGN_TASK'));
    assert.equal(adapter.calls.registerTask.length, 0);
    assert.equal(adapter.calls.setTaskEnabled.length, 0);
  }
});

test('a different host or package identity cannot claim the reserved task', async () => {
  const plan = await generatedPlan();
  const otherHost = new FakeNativeAdapter({
    host: host({ hostId: '123e4567-e89b-42d3-a456-426614174011' }),
    task: observed(plan),
  });
  await assert.rejects(controller(otherHost).status(), rejectsCode('AUTOSTART_FOREIGN_TASK'));

  const otherPackage = new FakeNativeAdapter({
    packageValue: portablePackage(BUNDLE_E, {
      packageId: '123e4567-e89b-42d3-a456-426614174001',
    }),
    task: observed(plan),
  });
  await assert.rejects(controller(otherPackage).status(), rejectsCode('AUTOSTART_FOREIGN_TASK'));
});

test('disable is idempotent and toggles owned current or stale tasks without deletion', async () => {
  const adapter = new FakeNativeAdapter();
  const enrollment = controller(adapter);
  assert.equal((await enrollment.disable()).state, 'not-installed');
  const plan = await enrollment.plan();
  adapter.task = observed(plan, true);
  assert.equal((await enrollment.disable()).state, 'disabled');
  assert.equal(adapter.calls.setTaskEnabled.length, 1);
  assert.equal(adapter.calls.setTaskEnabled[0].enabled, false);
  assert.equal((await enrollment.disable()).changed, false);

  adapter.packageValue = portablePackage(BUNDLE_F, { packageDigestSha256: 'f'.repeat(64) });
  adapter.task = observed(plan, true);
  assert.equal((await enrollment.disable()).state, 'stale-disabled');
  assert.equal(adapter.calls.registerTask.length, 0);
});

test('ambiguous native results reconcile, while unchanged failures fail closed', async () => {
  const registerAfter = new FakeNativeAdapter({ registerBehavior: 'fail-after' });
  assert.equal((await controller(registerAfter).enable()).state, 'enabled');

  const toggleAfter = new FakeNativeAdapter({ toggleBehavior: 'fail-after' });
  const toggleEnrollment = controller(toggleAfter);
  toggleAfter.task = observed(await toggleEnrollment.plan(), true);
  assert.equal((await toggleEnrollment.disable()).state, 'disabled');

  const registerBefore = new FakeNativeAdapter({ registerBehavior: 'fail-before' });
  await assert.rejects(controller(registerBefore).enable(), rejectsCode('AUTOSTART_MUTATION_FAILED'));

  const toggleBefore = new FakeNativeAdapter({ toggleBehavior: 'fail-before' });
  const failingEnrollment = controller(toggleBefore);
  toggleBefore.task = observed(await failingEnrollment.plan(), true);
  await assert.rejects(failingEnrollment.disable(), rejectsCode('AUTOSTART_MUTATION_FAILED'));
});
