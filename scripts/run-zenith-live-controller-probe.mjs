import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { MinecraftAccountRegistrationStore } from '../services/minecraft-control-plane/src/companion/account-registration.mjs';
import { DpapiMinecraftAccountVault } from '../services/minecraft-control-plane/src/companion/dpapi-vault.mjs';
import { MicrosoftMinecraftAuth } from '../services/minecraft-control-plane/src/companion/microsoft-auth.mjs';

const CONTROLLER_SHA256 = 'E1C397C69A4B1C6545E459F80CD464063F1D86F256A2CD3F42853B27B6DB3581';
const COMPANION_UUID = '996a56dd-fb3c-4f90-9158-1a608652ec77';
const LIVE_PORT = 25568;
const HOLD_MILLIS = 300_000;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function canonicalUuid(value) {
  const compact = value.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(compact)) fail('LIVE_CONTROLLER_ACCOUNT_MISMATCH');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

async function assertArtifact(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 29_479_224) fail('LIVE_CONTROLLER_ARTIFACT_INVALID');
  const bytes = await fs.readFile(file);
  try {
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
    if (hash !== CONTROLLER_SHA256) fail('LIVE_CONTROLLER_ARTIFACT_INVALID');
  } finally {
    bytes.fill(0);
  }
}

function publishSafeLines(stream, onInvalid) {
  let buffered = '';
  let invalid = false;
  const rejectOutput = () => {
    if (invalid) return;
    invalid = true;
    buffered = '';
    onInvalid(Object.assign(new Error('LIVE_CONTROLLER_OUTPUT_INVALID'), { code: 'LIVE_CONTROLLER_OUTPUT_INVALID' }));
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    if (invalid) return;
    buffered += chunk;
    if (buffered.length > 16 * 1024) {
      rejectOutput();
      return;
    }
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        rejectOutput();
        return;
      }
      const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
      if (JSON.stringify(keys) !== JSON.stringify(['at', 'code', 'schemaVersion', 'state'])
        || value.schemaVersion !== 1 || typeof value.at !== 'string'
        || typeof value.state !== 'string' || !/^[A-Z0-9_]{2,64}$/u.test(value.state)
        || typeof value.code !== 'string' || !/^[A-Z0-9_]{2,64}$/u.test(value.code)) {
        rejectOutput();
        return;
      }
      process.stdout.write(`${JSON.stringify(value)}\n`);
    }
  });
}

async function main() {
  if (process.argv.length !== 2 || process.platform !== 'win32') fail('LIVE_CONTROLLER_LAUNCH_FORBIDDEN');
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData !== 'string' || !path.win32.isAbsolute(localAppData)) fail('LIVE_CONTROLLER_ROOT_INVALID');

  const familyRoot = path.resolve(localAppData, 'Mastermind', 'minecraft', 'projects', 'family-server');
  const stagingRoot = path.resolve(localAppData, 'Mastermind', 'staging', 'minecraft', 'zenith', '3.5.8+26.2.0-mastermind-secure.1');
  const java = path.join(familyRoot, 'runtimes', 'java-runtime-epsilon', '25.0.1', 'windows-x64', 'bin', 'java.exe');
  const controllerJar = path.join(stagingRoot, 'controller', 'mastermind-zenith-headless-controller-0.1.0-all.jar');
  await assertArtifact(controllerJar);

  const privateRoot = path.join(familyRoot, 'private');
  const registration = await new MinecraftAccountRegistrationStore(
    path.join(privateRoot, 'minecraft-account-registration.json'),
  ).load();
  const vault = new DpapiMinecraftAccountVault({
    vaultFile: path.join(privateRoot, 'minecraft-account.dpapi.json'),
  });
  const auth = new MicrosoftMinecraftAuth({ config: registration, vault });
  await auth.initialize();
  await auth.silentRefresh();
  const session = auth.minecraftSession();
  const uuid = canonicalUuid(session.uuid);
  if (session.username !== 'The_AlChemist___' || uuid !== COMPANION_UUID) fail('LIVE_CONTROLLER_ACCOUNT_MISMATCH');

  const envelope = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    host: '127.0.0.1',
    port: LIVE_PORT,
    mode: 'online',
    profile: { name: session.username, uuid },
    accessToken: session.accessToken,
    holdMillis: HOLD_MILLIS,
  })}\n`, 'utf8');
  if (envelope.length > 16 * 1024) {
    envelope.fill(0);
    fail('LIVE_CONTROLLER_ENVELOPE_INVALID');
  }

  const child = spawn(java, ['-Xms32M', '-Xmx128M', '-jar', controllerJar], {
    cwd: stagingRoot,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => (
      ['LOCALAPPDATA', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'WINDIR'].includes(key.toUpperCase())
      && typeof value === 'string'
    ))),
  });
  child.stdin.on('error', () => {});
  child.stdin.end(envelope, () => envelope.fill(0));

  const result = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    publishSafeLines(child.stdout, (error) => {
      child.kill();
      finish(reject, error);
    });
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => finish(resolve, { code, signal }));
  });
  envelope.fill(0);
  if (result.signal !== null || ![0, 7].includes(result.code)) fail('LIVE_CONTROLLER_PROCESS_FAILED');
  process.stdout.write(`${JSON.stringify({ ok: true, state: result.code === 7 ? 'preempted-or-disconnected' : 'probe-complete' })}\n`);
}

main().catch((error) => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/u.test(error.code)
    ? error.code
    : 'LIVE_CONTROLLER_START_FAILED';
  process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
  process.exitCode = 1;
});
