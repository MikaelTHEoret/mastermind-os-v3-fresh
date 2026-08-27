import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  WINDOWS_AUTOSTART_BUNDLE_PROVIDER,
  WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME,
  WINDOWS_AUTOSTART_HOST_PROVIDER,
  WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT,
  WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME,
  WINDOWS_AUTOSTART_SCHEMA_VERSION,
  WINDOWS_AUTOSTART_TASK_FOLDER,
  WINDOWS_AUTOSTART_TASK_NAME,
  WINDOWS_AUTOSTART_USER_PROVIDER,
} from './windows-autostart-enrollment.mjs';
import {
  WINDOWS_NODE_HOST_CONFIG_NAME,
  canonicalJson,
  parseAndVerifyWindowsNodePackageManifest,
  parseWindowsNodeHostConfig,
  sha256Bytes,
} from './windows-node-host-contract.mjs';

const execFileAsync = promisify(execFile);
const TASK_DESCRIPTION_PREFIX = 'mastermind-autostart-v1.';
const WINDOWS_GUI_SUBSYSTEM = 2;
const MAX_TASK_XML_BYTES = 256 * 1024;
const SID = /^S-1-5-21-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})$/u;
const VOLUME_GUID = /^\\\\\?\\Volume\{[0-9A-Fa-f-]{36}\}\\$/u;

function qualifiedTaskPath(folder, name) {
  return folder === '\\' ? `\\${name}` : `${folder}\\${name}`;
}

export class WindowsAutostartNativeAdapterError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'WindowsAutostartNativeAdapterError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new WindowsAutostartNativeAdapterError(code, message, cause ? { cause } : undefined);
}

function record(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value, keys) {
  return record(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function xmlUnescape(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos);)/u.test(value)) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task XML contains an unknown entity.');
  }
  return value.replaceAll('&apos;', "'").replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
}

function tagValue(source, tag) {
  const pattern = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'gu');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) fail('AUTOSTART_TASK_XML_INVALID', `The task XML has an invalid ${tag} field.`);
  return xmlUnescape(matches[0][1]);
}

function optionalTagValue(source, tag, fallback) {
  const pattern = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'gu');
  const matches = [...source.matchAll(pattern)];
  if (matches.length > 1) fail('AUTOSTART_TASK_XML_INVALID', `The task XML has an invalid ${tag} field.`);
  return matches.length === 0 ? fallback : xmlUnescape(matches[0][1]);
}

function directChildren(source) {
  const children = [];
  let cursor = 0;
  while (cursor < source.length) {
    const opening = source.slice(cursor).match(/^<([A-Za-z][A-Za-z0-9]*)([^<>]*)>/u);
    if (!opening || opening[2].endsWith('/')) {
      fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task XML changed shape.');
    }
    const [, name, attributes] = opening;
    const close = `</${name}>`;
    const closeAt = source.indexOf(close, cursor + opening[0].length);
    if (closeAt < 0) fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task XML changed shape.');
    const end = closeAt + close.length;
    children.push(Object.freeze({
      name,
      attributes,
      source: source.slice(cursor + opening[0].length, closeAt),
    }));
    cursor = end;
  }
  return children;
}

function childMap(source, { required, optional = [] }) {
  const allowed = new Set([...required, ...optional]);
  const result = new Map();
  for (const child of directChildren(source)) {
    if (!allowed.has(child.name) || result.has(child.name) || child.attributes !== '') {
      fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task XML changed shape.');
    }
    result.set(child.name, child);
  }
  if (required.some((name) => !result.has(name))) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task XML changed shape.');
  }
  return result;
}

function singleChild(source, name, attributes = '') {
  const children = directChildren(source);
  if (children.length !== 1 || children[0].name !== name || children[0].attributes !== attributes) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task XML changed shape.');
  }
  return children[0].source;
}

function exactSection(source, tag, expectedAttributes = '') {
  const pattern = new RegExp(`<${tag}([^<>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gu');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || matches[0][1] !== expectedAttributes) {
    fail('AUTOSTART_TASK_XML_INVALID', `The task XML has an invalid ${tag} section.`);
  }
  return matches[0][2];
}

function validateRegistrationInfo(source) {
  const fields = childMap(source, {
    required: ['Source', 'Description', 'URI'],
    optional: ['Author', 'Date'],
  });
  if (tagValue(source, 'Source') !== 'Mastermind'
    || tagValue(source, 'URI') !== qualifiedTaskPath(
      WINDOWS_AUTOSTART_TASK_FOLDER, WINDOWS_AUTOSTART_TASK_NAME,
    )) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task registration is invalid.');
  }
  if (fields.has('Author')) {
    const author = tagValue(source, 'Author');
    if (author.length < 1 || author.length > 256 || /[\x00-\x1f\x7f]/u.test(author)) {
      fail('AUTOSTART_TASK_XML_INVALID', 'The scheduler-owned task author is invalid.');
    }
  }
  if (fields.has('Date')) {
    const date = tagValue(source, 'Date');
    if (date.length > 64 || !/^\d{4}-\d{2}-\d{2}T/u.test(date) || !Number.isFinite(Date.parse(date))) {
      fail('AUTOSTART_TASK_XML_INVALID', 'The scheduler-owned task registration date is invalid.');
    }
  }
}

function booleanTag(source, tag) {
  const value = tagValue(source, tag);
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail('AUTOSTART_TASK_XML_INVALID', `The task XML has an invalid ${tag} value.`);
}

function optionalBooleanTag(source, tag, fallback) {
  const value = optionalTagValue(source, tag, String(fallback));
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail('AUTOSTART_TASK_XML_INVALID', `The task XML has an invalid ${tag} value.`);
}

function registrationDescription(registrationData) {
  return `${TASK_DESCRIPTION_PREFIX}${Buffer.from(canonicalJson(registrationData), 'utf8').toString('base64url')}`;
}

function parseRegistrationDescription(value) {
  if (typeof value !== 'string' || !value.startsWith(TASK_DESCRIPTION_PREFIX)) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task has no managed registration identity.');
  }
  let parsed;
  try {
    const encoded = value.slice(TASK_DESCRIPTION_PREFIX.length);
    if (!/^[A-Za-z0-9_-]{16,4096}$/u.test(encoded)) throw new Error('invalid base64url');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url'));
    parsed = JSON.parse(text);
    if (canonicalJson(parsed) !== text) throw new Error('registration is not canonical');
  } catch (error) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task registration identity is invalid.', error);
  }
  return parsed;
}

export function renderWindowsAutostartTaskXml(plan, { enabled = true } = {}) {
  if (!record(plan) || !record(plan.definition) || !record(plan.registrationData)
    || plan.task?.folder !== WINDOWS_AUTOSTART_TASK_FOLDER
    || plan.task?.name !== WINDOWS_AUTOSTART_TASK_NAME || typeof enabled !== 'boolean') {
    fail('AUTOSTART_TASK_XML_INVALID', 'The managed task plan is invalid.');
  }
  const definition = plan.definition;
  const principal = definition.principal;
  const trigger = definition.triggers?.[0];
  const action = definition.actions?.[0];
  const settings = definition.settings;
  if (!principal || !trigger || !action || !settings || definition.triggers.length !== 1
    || definition.actions.length !== 1 || action.arguments?.length !== 0) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The managed task plan is invalid.');
  }
  const description = registrationDescription(plan.registrationData);
  return `<?xml version="1.0" encoding="UTF-16"?>\r\n`
    + `<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n`
    + `  <RegistrationInfo><Source>Mastermind</Source><Description>${xmlEscape(description)}</Description><URI>${xmlEscape(qualifiedTaskPath(WINDOWS_AUTOSTART_TASK_FOLDER, WINDOWS_AUTOSTART_TASK_NAME))}</URI></RegistrationInfo>\r\n`
    + `  <Triggers><LogonTrigger><Enabled>${String(trigger.enabled)}</Enabled><UserId>${xmlEscape(trigger.userSid)}</UserId><Delay>${trigger.delay}</Delay></LogonTrigger></Triggers>\r\n`
    + `  <Principals><Principal id="Author"><UserId>${xmlEscape(principal.userSid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\r\n`
    + '  <Settings>'
    + `<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`
    + `<DisallowStartIfOnBatteries>${String(settings.disallowStartIfOnBatteries)}</DisallowStartIfOnBatteries>`
    + `<StopIfGoingOnBatteries>${String(settings.stopIfGoingOnBatteries)}</StopIfGoingOnBatteries>`
    + `<AllowHardTerminate>false</AllowHardTerminate>`
    + `<StartWhenAvailable>${String(settings.startWhenAvailable)}</StartWhenAvailable>`
    + `<RunOnlyIfNetworkAvailable>${String(settings.runOnlyIfNetworkAvailable)}</RunOnlyIfNetworkAvailable>`
    + `<IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>`
    + `<AllowStartOnDemand>${String(settings.allowDemandStart)}</AllowStartOnDemand>`
    + `<Enabled>${String(enabled)}</Enabled>`
    + `<Hidden>${String(settings.hidden)}</Hidden>`
    + `<RunOnlyIfIdle>false</RunOnlyIfIdle>`
    + `<WakeToRun>false</WakeToRun>`
    + `<ExecutionTimeLimit>${settings.executionTimeLimit}</ExecutionTimeLimit>`
    + `<RestartOnFailure><Interval>${settings.restartInterval}</Interval><Count>${settings.restartCount}</Count></RestartOnFailure>`
    + '  </Settings>\r\n'
    + `  <Actions Context="Author"><Exec><Command>${xmlEscape(action.executable)}</Command><WorkingDirectory>${xmlEscape(action.workingDirectory)}</WorkingDirectory></Exec></Actions>\r\n`
    + '</Task>\r\n';
}

function trustedCurrentUser(options) {
  if (options === undefined) return null;
  if (!exactKeys(options, ['currentUser'])
    || !exactKeys(options.currentUser, ['sid', 'accountName'])
    || typeof options.currentUser.sid !== 'string' || !SID.test(options.currentUser.sid)
    || typeof options.currentUser.accountName !== 'string'
    || options.currentUser.accountName.length > 512
    || !/^[^\\/\x00-\x1f\x7f]{1,255}\\[^\\/\x00-\x1f\x7f]{1,255}$/u
      .test(options.currentUser.accountName)) {
    fail('AUTOSTART_USER_INVALID', 'The current Windows account binding is invalid.');
  }
  return options.currentUser;
}

function canonicalTriggerSid(triggerUserId, principalSid, currentUser) {
  if (SID.test(triggerUserId)) {
    if (triggerUserId !== principalSid) {
      fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task principal is invalid.');
    }
    return principalSid;
  }
  if (!currentUser || currentUser.sid !== principalSid
    || currentUser.accountName.toLocaleLowerCase('en-US')
      !== triggerUserId.toLocaleLowerCase('en-US')) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind logon identity is invalid.');
  }
  return principalSid;
}

export function parseWindowsAutostartTaskXml(xml, options) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') < 1
    || Buffer.byteLength(xml, 'utf8') > MAX_TASK_XML_BYTES || /<!DOCTYPE|<!ENTITY|<Arguments>/iu.test(xml)) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task XML is invalid.');
  }
  const currentUser = trustedCurrentUser(options);
  const compact = xml.replace(/^\uFEFF/u, '').replace(/>\s+</gu, '><').trim();
  const registration = exactSection(compact, 'RegistrationInfo');
  const triggers = exactSection(compact, 'Triggers');
  const principals = exactSection(compact, 'Principals');
  const settings = exactSection(compact, 'Settings');
  const actions = exactSection(compact, 'Actions', ' Context="Author"');
  validateRegistrationInfo(registration);
  const logonTrigger = singleChild(triggers, 'LogonTrigger');
  childMap(logonTrigger, { required: ['UserId', 'Delay'], optional: ['Enabled'] });
  const principal = singleChild(principals, 'Principal', ' id="Author"');
  childMap(principal, { required: ['UserId', 'LogonType'], optional: ['RunLevel'] });
  const execution = singleChild(actions, 'Exec');
  childMap(execution, { required: ['Command', 'WorkingDirectory'] });
  childMap(settings, {
    required: [
      'MultipleInstancesPolicy', 'DisallowStartIfOnBatteries', 'StopIfGoingOnBatteries',
      'AllowHardTerminate', 'StartWhenAvailable', 'IdleSettings', 'Hidden',
      'ExecutionTimeLimit', 'RestartOnFailure',
    ],
    optional: [
      'RunOnlyIfNetworkAvailable', 'AllowStartOnDemand', 'Enabled', 'RunOnlyIfIdle',
      'WakeToRun', 'UseUnifiedSchedulingEngine', 'Priority',
    ],
  });
  const idle = exactSection(settings, 'IdleSettings');
  childMap(idle, { required: ['StopOnIdleEnd', 'RestartOnIdle'] });
  const restart = exactSection(settings, 'RestartOnFailure');
  childMap(restart, { required: ['Interval', 'Count'] });

  const userSid = tagValue(principal, 'UserId');
  if (!SID.test(userSid) || (currentUser && currentUser.sid !== userSid)
    || tagValue(principal, 'LogonType') !== 'InteractiveToken'
    || optionalTagValue(principal, 'RunLevel', 'LeastPrivilege') !== 'LeastPrivilege') {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task principal is invalid.');
  }
  const triggerSid = canonicalTriggerSid(tagValue(logonTrigger, 'UserId'), userSid, currentUser);
  const triggerEnabled = optionalBooleanTag(logonTrigger, 'Enabled', true);
  const triggerDelay = tagValue(logonTrigger, 'Delay');
  const multipleInstances = tagValue(settings, 'MultipleInstancesPolicy');
  const allowDemandStart = optionalBooleanTag(settings, 'AllowStartOnDemand', true);
  const disallowStartIfOnBatteries = booleanTag(settings, 'DisallowStartIfOnBatteries');
  const hidden = booleanTag(settings, 'Hidden');
  const runOnlyIfNetworkAvailable = optionalBooleanTag(settings, 'RunOnlyIfNetworkAvailable', false);
  const startWhenAvailable = booleanTag(settings, 'StartWhenAvailable');
  const stopIfGoingOnBatteries = booleanTag(settings, 'StopIfGoingOnBatteries');
  if (multipleInstances !== 'IgnoreNew' || triggerDelay !== 'PT15S' || triggerEnabled !== true
    || tagValue(restart, 'Interval') !== 'PT1M'
    || tagValue(restart, 'Count') !== '3' || tagValue(settings, 'ExecutionTimeLimit') !== 'PT0S'
    || tagValue(settings, 'AllowHardTerminate') !== 'false'
    || optionalTagValue(settings, 'RunOnlyIfIdle', 'false') !== 'false'
    || optionalTagValue(settings, 'WakeToRun', 'false') !== 'false'
    || optionalTagValue(settings, 'UseUnifiedSchedulingEngine', 'true') !== 'true'
    || optionalTagValue(settings, 'Priority', '7') !== '7'
    || tagValue(idle, 'StopOnIdleEnd') !== 'false' || tagValue(idle, 'RestartOnIdle') !== 'false'
    || allowDemandStart !== true || disallowStartIfOnBatteries !== false || hidden !== true
    || runOnlyIfNetworkAvailable !== false || startWhenAvailable !== true
    || stopIfGoingOnBatteries !== false) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task settings are invalid.');
  }
  const enabled = optionalBooleanTag(settings, 'Enabled', true);
  const executable = tagValue(execution, 'Command');
  const workingDirectory = tagValue(execution, 'WorkingDirectory');
  const expectedSuffix = `\\${WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT}\\${WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME}`;
  if (!executable.toLocaleLowerCase('en-US').endsWith(expectedSuffix.toLocaleLowerCase('en-US'))
    || path.win32.dirname(executable).toLocaleLowerCase('en-US')
      !== workingDirectory.toLocaleLowerCase('en-US')) {
    fail('AUTOSTART_TASK_XML_INVALID', 'The reserved Mastermind task does not start the fixed GUI host.');
  }
  return Object.freeze({
    enabled,
    registrationData: parseRegistrationDescription(tagValue(registration, 'Description')),
    definition: {
      schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
      principal: {
        kind: 'current-user', userSid, logonType: 'interactive-token', runLevel: 'least-privilege',
      },
      triggers: [{
        kind: 'logon', userSid: triggerSid, delay: triggerDelay, enabled: triggerEnabled,
      }],
      actions: [{
        kind: 'exec', executable, arguments: [], workingDirectory,
      }],
      settings: {
        allowDemandStart,
        disallowStartIfOnBatteries,
        executionTimeLimit: tagValue(settings, 'ExecutionTimeLimit'),
        hidden,
        multipleInstances: 'ignore-new',
        restartCount: Number(tagValue(restart, 'Count')),
        restartInterval: tagValue(restart, 'Interval'),
        runOnlyIfNetworkAvailable,
        startWhenAvailable,
        stopIfGoingOnBatteries,
      },
    },
  });
}

export function inspectPortableExecutableSubsystem(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? '');
  if (body.length < 256 || body.readUInt16LE(0) !== 0x5a4d) {
    fail('AUTOSTART_HOST_INVALID', 'The fixed host launcher is not a valid Windows executable.');
  }
  const peOffset = body.readUInt32LE(0x3c);
  if (peOffset < 0x40 || peOffset + 24 + 70 > body.length || body.readUInt32LE(peOffset) !== 0x00004550) {
    fail('AUTOSTART_HOST_INVALID', 'The fixed host launcher is not a valid Windows executable.');
  }
  const optional = peOffset + 24;
  const magic = body.readUInt16LE(optional);
  if (![0x10b, 0x20b].includes(magic)) {
    fail('AUTOSTART_HOST_INVALID', 'The fixed host launcher has an unsupported PE format.');
  }
  return body.readUInt16LE(optional + 68);
}

function taskPath(identity) {
  if (!exactKeys(identity, ['folder', 'name']) || identity.folder !== WINDOWS_AUTOSTART_TASK_FOLDER
    || identity.name !== WINDOWS_AUTOSTART_TASK_NAME) {
    fail('AUTOSTART_TASK_IDENTITY_INVALID', 'The requested Task Scheduler identity is invalid.');
  }
  return qualifiedTaskPath(identity.folder, identity.name);
}

async function defaultCommandRunner(executable, args, options = {}) {
  return execFileAsync(executable, args, {
    windowsHide: true,
    encoding: null,
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
    ...options,
  });
}

function commandText(value) {
  if (!Buffer.isBuffer(value)) return String(value ?? '');
  if (value.length >= 2 && ((value[0] === 0xff && value[1] === 0xfe)
    || (value[0] !== 0 && value[1] === 0))) {
    return value.toString('utf16le').replace(/^\uFEFF/u, '');
  }
  return value.toString('utf8').replace(/^\uFEFF/u, '');
}

async function noReparsePath(fsApi, target, { file = false } = {}) {
  const parsed = path.win32.parse(target);
  const relative = path.win32.relative(parsed.root, target);
  let current = parsed.root;
  for (const segment of relative.split('\\').filter(Boolean)) {
    current = path.win32.join(current, segment);
    const stat = await fsApi.lstat(current);
    if (stat.isSymbolicLink()) return false;
  }
  const stat = await fsApi.lstat(target);
  return file ? stat.isFile() : stat.isDirectory();
}

async function atomicWrite(fsApi, target, bytes) {
  const temporary = `${target}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  await fsApi.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  try { await fsApi.rename(temporary, target); }
  catch (error) {
    await fsApi.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function taskNotFound(error) {
  const numericCode = Number(error?.code);
  if (Number.isInteger(numericCode)) {
    const unsignedCode = numericCode >>> 0;
    if (unsignedCode === 2 || unsignedCode === 0x80070002) return true;
  }
  const material = `${commandText(error?.stdout)}\n${commandText(error?.stderr)}\n${error?.message ?? ''}`;
  return error?.code === 1 && /cannot find|not exist|introuvable|n'existe pas/iu.test(material);
}

function currentUserSid(stdout) {
  const matches = commandText(stdout).match(/S-1-5-21-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})/gu) ?? [];
  if (matches.length !== 1) fail('AUTOSTART_USER_INVALID', 'The current Windows user SID is unavailable.');
  return matches[0];
}

function currentWindowsUser(stdout) {
  const row = commandText(stdout).trim();
  const match = row.match(/^"((?:[^"]|"")*)","(S-1-5-21-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9}))"$/u);
  const accountName = match?.[1].replaceAll('""', '"');
  if (!match || !accountName
    || !/^[^\\/\x00-\x1f\x7f]{1,255}\\[^\\/\x00-\x1f\x7f]{1,255}$/u.test(accountName)) {
    fail('AUTOSTART_USER_INVALID', 'The current Windows account identity is unavailable.');
  }
  return Object.freeze({ accountName, sid: match[2] });
}

function expandWindowsEnvironmentPath(value, environment) {
  const lookup = new Map(Object.entries(environment)
    .map(([key, entry]) => [key.toLocaleUpperCase('en-US'), String(entry)]));
  let unknown = false;
  const expanded = value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/gu, (_match, name) => {
    const replacement = lookup.get(name.toLocaleUpperCase('en-US'));
    if (replacement === undefined) { unknown = true; return ''; }
    return replacement;
  });
  if (unknown || expanded.includes('%')) return null;
  return expanded;
}

async function verifyLocalAppDataKnownFolder(commandRunner, environment, expected) {
  const result = await commandRunner('reg.exe', [
    'query', String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`,
    '/v', 'Local AppData',
  ]);
  const matches = [...commandText(result.stdout)
    .matchAll(/^[^\r\n]*Local AppData\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/gimu)];
  if (matches.length !== 1) return false;
  const expanded = expandWindowsEnvironmentPath(matches[0][1], environment);
  if (!expanded || !path.win32.isAbsolute(expanded)) return false;
  return path.win32.resolve(expanded).toLocaleLowerCase('en-US')
    === expected.toLocaleLowerCase('en-US');
}

export async function readWindowsVolumeIdentitySha256(commandRunner, root) {
  const result = await commandRunner('mountvol.exe', [path.win32.parse(root).root, '/L']);
  const value = commandText(result.stdout).trim();
  if (!VOLUME_GUID.test(value)) fail('AUTOSTART_PACKAGE_INVALID', 'The package volume identity is unavailable.');
  return sha256Bytes(Buffer.from(`windows-volume-guid-v1:${value.toLocaleLowerCase('en-US')}`, 'utf8'));
}

export async function enumerateWindowsDriveRoots(commandRunner) {
  const result = await commandRunner('mountvol.exe', []);
  return [...new Set((commandText(result.stdout).match(/(?:^|\r?\n)\s*([A-Za-z]:\\)\s*(?=\r?\n|$)/gu) ?? [])
    .map((line) => line.trim().toUpperCase()))].sort();
}

/**
 * Native Windows boundary for the pure enrollment controller. Every child
 * executable is invoked directly with windowsHide; no shell or PowerShell is
 * used. The returned adapter is inert until one of its methods is called.
 */
export function createWindowsAutostartNativeAdapter({
  environment = process.env,
  fsApi = fs,
  commandRunner = defaultCommandRunner,
  platform = process.platform,
} = {}) {
  if (platform !== 'win32') fail('AUTOSTART_PLATFORM_UNSUPPORTED', 'Windows autostart is available only on Windows.');
  const localAppDataInput = String(environment.LOCALAPPDATA ?? '');
  const localAppData = path.win32.resolve(localAppDataInput);
  if (!path.win32.isAbsolute(localAppDataInput) || !/^[A-Za-z]:\\/u.test(localAppData)
    || localAppDataInput.includes('/')) {
    fail('AUTOSTART_HOST_INVALID', 'The Windows LocalAppData known folder is unavailable.');
  }
  const hostRoot = path.win32.join(localAppData, WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT);
  const launcherPath = path.win32.join(hostRoot, WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME);
  const configPath = path.win32.join(hostRoot, WINDOWS_NODE_HOST_CONFIG_NAME);
  const loadConfig = async () => parseWindowsNodeHostConfig(await fsApi.readFile(configPath));

  async function inspectCurrentUserIdentity() {
    const result = await commandRunner('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
    return currentWindowsUser(result.stdout);
  }

  async function inspectCurrentUser() {
    const identity = await inspectCurrentUserIdentity();
    return {
      schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
      provider: WINDOWS_AUTOSTART_USER_PROVIDER,
      sid: identity.sid,
      interactiveSession: true,
    };
  }

  async function inspectHostLauncher(request) {
    if (!exactKeys(request, ['schemaVersion', 'knownFolder', 'relativeHostRoot', 'expectedLauncherName'])
      || request.schemaVersion !== WINDOWS_AUTOSTART_SCHEMA_VERSION
      || request.knownFolder !== 'FOLDERID_LocalAppData'
      || request.relativeHostRoot !== WINDOWS_AUTOSTART_HOST_RELATIVE_ROOT
      || request.expectedLauncherName !== WINDOWS_AUTOSTART_HOST_LAUNCHER_NAME) {
      fail('AUTOSTART_HOST_INVALID', 'The host inspection request is invalid.');
    }
    const [
      config, canonicalLocal, canonicalHost, canonicalLauncher, launcherBytes, launcherStat,
      knownFolderVerified,
    ] = await Promise.all([
      loadConfig(), fsApi.realpath(localAppData), fsApi.realpath(hostRoot), fsApi.realpath(launcherPath),
      fsApi.readFile(launcherPath), fsApi.stat(launcherPath),
      verifyLocalAppDataKnownFolder(commandRunner, environment, localAppData),
    ]);
    if (!(await noReparsePath(fsApi, hostRoot)) || !(await noReparsePath(fsApi, launcherPath, { file: true }))
      || inspectPortableExecutableSubsystem(launcherBytes) !== WINDOWS_GUI_SUBSYSTEM
      || launcherStat.size !== config.hostLauncherBytes
      || sha256Bytes(launcherBytes) !== config.hostLauncherSha256
      || knownFolderVerified !== true) {
      fail('AUTOSTART_HOST_INVALID', 'The fixed LocalAppData host launcher failed validation.');
    }
    return {
      schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
      provider: WINDOWS_AUTOSTART_HOST_PROVIDER,
      hostId: config.hostId,
      localAppDataRoot: localAppData,
      canonicalLocalAppDataRoot: canonicalLocal,
      hostRoot,
      canonicalHostRoot: canonicalHost,
      launcher: {
        path: launcherPath,
        canonicalPath: canonicalLauncher,
        kind: 'file', reparsePoint: false, subsystem: 'windows-gui',
        sha256: sha256Bytes(launcherBytes), bytes: launcherStat.size,
      },
      pathProof: {
        fixedLocalVolume: true, reparsePointSeen: false,
        canonicalPathVerified: true, knownFolderVerified: true,
      },
    };
  }

  async function inspectPortablePackage(request) {
    if (!exactKeys(request, [
      'schemaVersion', 'expectedManifestName', 'requireSignedManifest', 'requireStableVolumeIdentity',
    ]) || request.schemaVersion !== WINDOWS_AUTOSTART_SCHEMA_VERSION
      || request.expectedManifestName !== WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME
      || request.requireSignedManifest !== true || request.requireStableVolumeIdentity !== true) {
      fail('AUTOSTART_PACKAGE_INVALID', 'The portable package inspection request is invalid.');
    }
    const config = await loadConfig();
    const roots = [config.package.bundleRootHint];
    for (const drive of await enumerateWindowsDriveRoots(commandRunner)) {
      const candidate = config.package.bundlePathFromVolumeRoot === '.'
        ? drive : path.win32.join(drive, config.package.bundlePathFromVolumeRoot);
      if (!roots.some((value) => value.toLocaleLowerCase('en-US') === candidate.toLocaleLowerCase('en-US'))) {
        roots.push(candidate);
      }
    }
    for (const candidate of roots) {
      try {
        if (await readWindowsVolumeIdentitySha256(commandRunner, candidate) !== config.package.volumeIdentitySha256
          || !(await noReparsePath(fsApi, candidate))) continue;
        const manifestPath = path.win32.join(candidate, WINDOWS_AUTOSTART_PACKAGE_MANIFEST_NAME);
        if (!(await noReparsePath(fsApi, manifestPath, { file: true }))) continue;
        const [canonicalBundle, canonicalManifest, manifestBytes, manifestStat] = await Promise.all([
          fsApi.realpath(candidate), fsApi.realpath(manifestPath), fsApi.readFile(manifestPath), fsApi.stat(manifestPath),
        ]);
        const verified = parseAndVerifyWindowsNodePackageManifest(manifestBytes, {
          expectedManifestSha256: config.package.manifestSha256,
          expectedPublicKeySha256: config.package.manifestPublicKeySha256,
        });
        const payload = verified.payload;
        if (payload.packageId !== config.package.packageId
          || payload.packageDigestSha256 !== config.package.packageDigestSha256
          || payload.packageBytes !== config.package.packageBytes
          || payload.volumeIdentitySha256 !== config.package.volumeIdentitySha256) continue;
        const supervisorPath = path.win32.join(candidate, payload.supervisorRelativePath);
        if (!(await noReparsePath(fsApi, supervisorPath, { file: true }))) continue;
        const [supervisorBytes, supervisorStat] = await Promise.all([
          fsApi.readFile(supervisorPath), fsApi.stat(supervisorPath),
        ]);
        if (supervisorStat.size !== payload.supervisorBytes
          || sha256Bytes(supervisorBytes) !== payload.supervisorSha256) continue;
        return {
          schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
          provider: WINDOWS_AUTOSTART_BUNDLE_PROVIDER,
          packageId: payload.packageId,
          packageDigestSha256: payload.packageDigestSha256,
          packageBytes: payload.packageBytes,
          volumeIdentitySha256: payload.volumeIdentitySha256,
          bundleRoot: candidate,
          canonicalBundleRoot: canonicalBundle,
          manifest: {
            path: manifestPath, canonicalPath: canonicalManifest, kind: 'file', reparsePoint: false,
            sha256: verified.manifestSha256, bytes: manifestStat.size, signatureVerified: true,
          },
          pathProof: {
            localVolume: true, reparsePointSeen: false,
            canonicalPathVerified: true, volumeIdentityVerified: true,
          },
        };
      } catch {
        // A missing, stale, copied, or malformed candidate is not authority.
      }
    }
    fail('AUTOSTART_PACKAGE_INVALID', 'No exact signed Mastermind portable package is available.');
  }

  async function readTask(identity) {
    const name = taskPath(identity);
    let result;
    try { result = await commandRunner('schtasks.exe', ['/Query', '/TN', name, '/XML', '/HResult']); }
    catch (error) {
      if (taskNotFound(error)) return null;
      throw error;
    }
    const currentUser = await inspectCurrentUserIdentity();
    const parsed = parseWindowsAutostartTaskXml(commandText(result.stdout), { currentUser });
    return {
      schemaVersion: WINDOWS_AUTOSTART_SCHEMA_VERSION,
      folder: WINDOWS_AUTOSTART_TASK_FOLDER,
      name: WINDOWS_AUTOSTART_TASK_NAME,
      enabled: parsed.enabled,
      registrationData: parsed.registrationData,
      definition: parsed.definition,
    };
  }

  async function registerTask(operation) {
    if (!exactKeys(operation, ['schemaVersion', 'replaceOwned', 'enabled', 'plan'])
      || operation.schemaVersion !== WINDOWS_AUTOSTART_SCHEMA_VERSION
      || typeof operation.replaceOwned !== 'boolean' || typeof operation.enabled !== 'boolean') {
      fail('AUTOSTART_TASK_XML_INVALID', 'The managed task registration operation is invalid.');
    }
    const xml = renderWindowsAutostartTaskXml(operation.plan, { enabled: operation.enabled });
    const temporaryRoot = path.win32.join(hostRoot, 'install-tmp');
    await fsApi.mkdir(temporaryRoot, { recursive: true });
    const temporary = path.win32.join(temporaryRoot, `task-${crypto.randomBytes(8).toString('hex')}.xml`);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
    await fsApi.writeFile(temporary, utf16, { flag: 'wx', mode: 0o600 });
    try {
      await commandRunner('schtasks.exe', [
        '/Create', '/TN', taskPath(operation.plan.task), '/XML', temporary,
        ...(operation.replaceOwned ? ['/F'] : []),
      ]);
    } finally {
      await fsApi.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async function setTaskEnabled(operation) {
    if (!exactKeys(operation, ['schemaVersion', 'task', 'ownershipId', 'enabled'])
      || operation.schemaVersion !== WINDOWS_AUTOSTART_SCHEMA_VERSION
      || typeof operation.ownershipId !== 'string' || !/^[a-f0-9]{64}$/u.test(operation.ownershipId)
      || typeof operation.enabled !== 'boolean') {
      fail('AUTOSTART_TASK_IDENTITY_INVALID', 'The managed task toggle operation is invalid.');
    }
    const current = await readTask(operation.task);
    if (!current || current.registrationData?.ownershipId !== operation.ownershipId) {
      fail('AUTOSTART_TASK_IDENTITY_INVALID', 'The reserved task ownership changed before it could be toggled.');
    }
    await commandRunner('schtasks.exe', [
      '/Change', '/TN', taskPath(operation.task), operation.enabled ? '/ENABLE' : '/DISABLE',
    ]);
  }

  return Object.freeze({
    inspectCurrentUser,
    inspectHostLauncher,
    inspectPortablePackage,
    readTask,
    registerTask,
    setTaskEnabled,
    paths: Object.freeze({ localAppData, hostRoot, launcherPath, configPath }),
  });
}

export const __test = Object.freeze({
  TASK_DESCRIPTION_PREFIX,
  commandText,
  atomicWrite,
  currentUserSid,
  currentWindowsUser,
  driveRoots: enumerateWindowsDriveRoots,
  taskNotFound,
  qualifiedTaskPath,
  verifyLocalAppDataKnownFolder,
  volumeIdentity: readWindowsVolumeIdentitySha256,
});
