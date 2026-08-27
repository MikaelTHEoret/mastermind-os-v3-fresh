import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  WINDOWS_AUTOSTART_SCHEMA_VERSION,
  WINDOWS_AUTOSTART_TASK_FOLDER,
  WINDOWS_AUTOSTART_TASK_NAME,
} from '../lib/windows-autostart-enrollment.mjs';
import {
  WindowsAutostartNativeAdapterError,
  __test as nativeTest,
  createWindowsAutostartNativeAdapter,
  inspectPortableExecutableSubsystem,
  parseWindowsAutostartTaskXml,
  renderWindowsAutostartTaskXml,
} from '../lib/windows-autostart-native-adapter.mjs';

const SID = 'S-1-5-21-111111111-222222222-333333333-1001';
const OTHER_SID = 'S-1-5-21-111111111-222222222-333333333-1002';
const ACCOUNT_NAME = String.raw`DESKTOP-KNKT0GT\Mik`;
const WHOAMI_ACCOUNT_NAME = String.raw`desktop-knkt0gt\mik`;
const HOST_ROOT = String.raw`C:\Users\Family\AppData\Local\Mastermind\host-v1`;
const LAUNCHER = `${HOST_ROOT}\\MastermindNodeHost.exe`;

function plan() {
  return {
    task: { folder: WINDOWS_AUTOSTART_TASK_FOLDER, name: WINDOWS_AUTOSTART_TASK_NAME },
    registrationData: {
      schemaVersion: 1,
      owner: 'mastermind-portable-node-autostart-v1',
      ownershipId: 'a'.repeat(64),
      hostId: '123e4567-e89b-42d3-a456-426614174010',
      hostLauncherSha256: 'b'.repeat(64),
      packageId: '123e4567-e89b-42d3-a456-426614174000',
      packageDigestSha256: 'c'.repeat(64),
      volumeIdentitySha256: 'd'.repeat(64),
      manifestSha256: 'e'.repeat(64),
      definitionSha256: 'f'.repeat(64),
    },
    definition: {
      schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
      principal: {
        kind: 'current-user', userSid: SID, logonType: 'interactive-token', runLevel: 'least-privilege',
      },
      triggers: [{ kind: 'logon', userSid: SID, delay: 'PT15S', enabled: true }],
      actions: [{ kind: 'exec', executable: LAUNCHER, arguments: [], workingDirectory: HOST_ROOT }],
      settings: {
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
      },
    },
  };
}

function liveSchtasksQueryXml() {
  const rendered = renderWindowsAutostartTaskXml(plan());
  const description = rendered.match(/<Description>([^<]+)<\/Description>/u)?.[1];
  assert.ok(description);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Source>Mastermind</Source>
    <Description>${description}</Description>
    <URI>\\Mastermind Portable Node</URI>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>${SID}</UserId>
      <LogonType>InteractiveToken</LogonType>
    </Principal>
  </Principals>
  <Settings>
    <AllowHardTerminate>false</AllowHardTerminate>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Hidden>true</Hidden>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <RestartOnFailure>
      <Count>3</Count>
      <Interval>PT1M</Interval>
    </RestartOnFailure>
    <StartWhenAvailable>true</StartWhenAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
  </Settings>
  <Triggers>
    <LogonTrigger>
      <Delay>PT15S</Delay>
      <UserId>${ACCOUNT_NAME}</UserId>
    </LogonTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>${LAUNCHER}</Command>
      <WorkingDirectory>${HOST_ROOT}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}

test('Task Scheduler XML round-trips only the fixed GUI host with no portable path, shell, or secret', () => {
  const expected = plan();
  const xml = renderWindowsAutostartTaskXml(expected);
  assert.match(xml, /<URI>\\Mastermind Portable Node<\/URI>/u);
  assert.doesNotMatch(xml, /<URI>\\\\Mastermind Portable Node<\/URI>/u);
  assert.match(xml, /<Command>C:\\Users\\Family\\AppData\\Local\\Mastermind\\host-v1\\MastermindNodeHost\.exe<\/Command>/u);
  assert.doesNotMatch(xml, /E:\\|F:\\|powershell|cmd\.exe|npm|node\.exe|Bearer|mnp1\.|mn1\./iu);
  assert.doesNotMatch(xml, /<Arguments>/u);
  const parsed = parseWindowsAutostartTaskXml(xml);
  assert.equal(parsed.enabled, true);
  assert.deepEqual(parsed.registrationData, expected.registrationData);
  assert.deepEqual(parsed.definition, expected.definition);

  const disabled = parseWindowsAutostartTaskXml(renderWindowsAutostartTaskXml(expected, { enabled: false }));
  assert.equal(disabled.enabled, false);
});

test('task XML rejects a second trigger, action arguments, or a changed host action', () => {
  const xml = renderWindowsAutostartTaskXml(plan());
  for (const changed of [
    xml.replace('</Triggers>', '<BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>'),
    xml.replace('</Exec>', '<Arguments>--anything</Arguments></Exec>'),
    xml.replace('MastermindNodeHost.exe', 'powershell.exe'),
  ]) {
    assert.throws(() => parseWindowsAutostartTaskXml(changed), (error) => (
      error instanceof WindowsAutostartNativeAdapterError
      && error.code === 'AUTOSTART_TASK_XML_INVALID'
    ));
  }
});

test('Task Scheduler query XML tolerates scheduler-owned Date, Author, and harmless defaults', () => {
  const xml = renderWindowsAutostartTaskXml(plan());
  const registration = xml.match(/<RegistrationInfo>([\s\S]*?)<\/RegistrationInfo>/u)?.[1];
  assert.ok(registration);
  const source = registration.match(/<Source>[\s\S]*?<\/Source>/u)?.[0];
  const description = registration.match(/<Description>[\s\S]*?<\/Description>/u)?.[0];
  const uri = registration.match(/<URI>[\s\S]*?<\/URI>/u)?.[0];
  const queried = xml
    .replace(registration,
      `<Date>2026-08-15T12:34:56.1234567</Date><Author>FAMILY\\Mik</Author>${uri}${source}${description}`)
    .replace('</Settings>', '<Priority>7</Priority></Settings>');
  const parsed = parseWindowsAutostartTaskXml(queried);
  assert.deepEqual(parsed.definition, plan().definition);
  assert.deepEqual(parsed.registrationData, plan().registrationData);
});

test('real schtasks query normalization binds the account-name trigger back to the current SID', () => {
  const parsed = parseWindowsAutostartTaskXml(liveSchtasksQueryXml(), {
    currentUser: { sid: SID, accountName: WHOAMI_ACCOUNT_NAME },
  });
  assert.equal(parsed.enabled, true);
  assert.deepEqual(parsed.definition, plan().definition);
  assert.deepEqual(parsed.registrationData, plan().registrationData);
});

test('account-name triggers require the exact current account and principal SID binding', () => {
  const xml = liveSchtasksQueryXml();
  for (const [changed, currentUser] of [
    [xml, undefined],
    [xml, { sid: SID, accountName: String.raw`DESKTOP-KNKT0GT\SomeoneElse` }],
    [xml, { sid: OTHER_SID, accountName: ACCOUNT_NAME }],
    [xml.replace(`<UserId>${SID}</UserId>`, `<UserId>${OTHER_SID}</UserId>`),
      { sid: SID, accountName: ACCOUNT_NAME }],
    [xml.replace(`<UserId>${ACCOUNT_NAME}</UserId>`, '<UserId>DESKTOP-KNKT0GT\\SomeoneElse</UserId>'),
      { sid: SID, accountName: ACCOUNT_NAME }],
  ]) {
    assert.throws(() => parseWindowsAutostartTaskXml(
      changed, currentUser ? { currentUser } : undefined,
    ), (error) => (
      error instanceof WindowsAutostartNativeAdapterError
      && ['AUTOSTART_TASK_XML_INVALID', 'AUTOSTART_USER_INVALID'].includes(error.code)
    ));
  }
});

test('schtasks omissions are defaults, while wrong explicit defaults and ownership are rejected', () => {
  const xml = liveSchtasksQueryXml();
  const binding = { currentUser: { sid: SID, accountName: ACCOUNT_NAME } };
  for (const changed of [
    xml.replace('</LogonType>', '</LogonType><RunLevel>HighestAvailable</RunLevel>'),
    xml.replace('</LogonTrigger>', '<Enabled>false</Enabled></LogonTrigger>'),
    xml.replace('</Settings>', '<RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable></Settings>'),
    xml.replace('</Settings>', '<AllowStartOnDemand>false</AllowStartOnDemand></Settings>'),
    xml.replace('</Settings>', '<RunOnlyIfIdle>true</RunOnlyIfIdle></Settings>'),
    xml.replace('</Settings>', '<WakeToRun>true</WakeToRun></Settings>'),
    xml.replace('<UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>',
      '<UseUnifiedSchedulingEngine>false</UseUnifiedSchedulingEngine>'),
    xml.replace('MastermindNodeHost.exe', 'powershell.exe'),
    xml.replace('mastermind-autostart-v1.', 'foreign-autostart-v1.'),
  ]) {
    assert.throws(() => parseWindowsAutostartTaskXml(changed, binding), (error) => (
      error instanceof WindowsAutostartNativeAdapterError
      && error.code === 'AUTOSTART_TASK_XML_INVALID'
    ));
  }

  const disabled = xml.replace('</Settings>', '<Enabled>false</Enabled></Settings>');
  assert.equal(parseWindowsAutostartTaskXml(disabled, binding).enabled, false);
});

test('native readTask resolves whoami before normalizing the scheduler account-name trigger', async () => {
  const calls = [];
  const adapter = createWindowsAutostartNativeAdapter({
    platform: 'win32',
    environment: { LOCALAPPDATA: String.raw`C:\Users\Mik\AppData\Local` },
    commandRunner: async (executable, args) => {
      calls.push([executable, ...args]);
      if (executable === 'schtasks.exe') return { stdout: liveSchtasksQueryXml() };
      if (executable === 'whoami.exe') return { stdout: `"${WHOAMI_ACCOUNT_NAME}","${SID}"\r\n` };
      throw new Error(`unexpected command: ${executable}`);
    },
  });
  const task = await adapter.readTask({
    folder: WINDOWS_AUTOSTART_TASK_FOLDER,
    name: WINDOWS_AUTOSTART_TASK_NAME,
  });
  assert.equal(task.definition.principal.userSid, SID);
  assert.equal(task.definition.triggers[0].userSid, SID);
  assert.deepEqual(calls.map((call) => call[0]), ['schtasks.exe', 'whoami.exe']);
});

test('PE inspection distinguishes a GUI-subsystem launcher from a console program', () => {
  const executable = Buffer.alloc(512);
  executable.writeUInt16LE(0x5a4d, 0);
  executable.writeUInt32LE(128, 0x3c);
  executable.writeUInt32LE(0x00004550, 128);
  executable.writeUInt16LE(0x20b, 128 + 24);
  executable.writeUInt16LE(2, 128 + 24 + 68);
  assert.equal(inspectPortableExecutableSubsystem(executable), 2);
  executable.writeUInt16LE(3, 128 + 24 + 68);
  assert.equal(inspectPortableExecutableSubsystem(executable), 3);
  assert.throws(() => inspectPortableExecutableSubsystem(Buffer.alloc(512)), /not a valid Windows executable/i);
});

test('native command output accepts both UTF-8 utility text and UTF-16 Task Scheduler XML', () => {
  const xml = renderWindowsAutostartTaskXml(plan());
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
  assert.equal(nativeTest.commandText(Buffer.from('S-1-5-21-ascii', 'utf8')), 'S-1-5-21-ascii');
  assert.equal(nativeTest.commandText(utf16), xml);
  assert.deepEqual(parseWindowsAutostartTaskXml(nativeTest.commandText(utf16)).definition, plan().definition);
});

test('missing Scheduled Task is recognized by its locale-independent HRESULT', () => {
  assert.equal(nativeTest.taskNotFound({ code: -2147024894, stderr: 'Aufgabe nicht gefunden' }), true);
  assert.equal(nativeTest.taskNotFound({ code: 0x80070002, stderr: 'Tâche inconnue' }), true);
  assert.equal(nativeTest.taskNotFound({ code: 5, stderr: 'Access denied' }), false);
});

test('the exact task identity resolves at the Task Scheduler root', () => {
  assert.equal(WINDOWS_AUTOSTART_TASK_FOLDER, '\\');
  assert.equal(nativeTest.qualifiedTaskPath(
    WINDOWS_AUTOSTART_TASK_FOLDER, WINDOWS_AUTOSTART_TASK_NAME,
  ), String.raw`\Mastermind Portable Node`);
});

test('LocalAppData attestation matches the current-user known-folder registry value', async () => {
  const environment = {
    USERPROFILE: String.raw`C:\Users\Family`,
    LOCALAPPDATA: String.raw`C:\Users\Family\AppData\Local`,
  };
  const commandRunner = async (executable, args) => {
    assert.equal(executable, 'reg.exe');
    assert.deepEqual(args.slice(-2), ['/v', 'Local AppData']);
    return {
      stdout: `    Local AppData    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\r\n`,
    };
  };
  assert.equal(await nativeTest.verifyLocalAppDataKnownFolder(
    commandRunner, environment, environment.LOCALAPPDATA,
  ), true);
  assert.equal(await nativeTest.verifyLocalAppDataKnownFolder(
    commandRunner, environment, String.raw`D:\Redirected`,
  ), false);
});

test('native launcher and installer sources encode no-console, no-shell startup', async () => {
  const [project, program, contract, shutdown, installer] = await Promise.all([
    fs.readFile(new URL('../../native/windows/MastermindNodeHost/MastermindNodeHost.csproj', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../native/windows/MastermindNodeHost/Program.cs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../native/windows/MastermindNodeHost/HostContract.cs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../native/windows/MastermindNodeHost/ShutdownBridge.cs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../install-windows-node-host.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(project, /<OutputType>WinExe<\/OutputType>/u);
  assert.match(project, /<SelfContained>true<\/SelfContained>/u);
  assert.match(program, /CreateNoWindow = true/u);
  assert.match(program, /UseShellExecute = false/u);
  assert.match(program, /start\.ArgumentList\.Add\(supervisor\)/u);
  assert.doesNotMatch(program, /cmd\.exe|powershell/iu);
  assert.match(contract, /GetVolumeNameForVolumeMountPoint/u);
  assert.match(contract, /BundlePathFromVolumeRoot/u);
  assert.match(shutdown, /PipeOptions\.Asynchronous/u);
  assert.match(shutdown, /WmQueryEndSession/u);
  assert.doesNotMatch(shutdown, /(?:Read|Write)Timeout\s*=/u);
  assert.match(installer, /process\.argv\.length !== 2/u);
  assert.doesNotMatch(installer, /powershell|cmd\.exe/iu);
});
