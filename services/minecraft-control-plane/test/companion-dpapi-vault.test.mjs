import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { PassThrough, Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DpapiMinecraftAccountVault,
  DpapiVaultError,
  MINECRAFT_ACCOUNT_DPAPI_SCRIPT,
} from '../src/companion/dpapi-vault.mjs';

function fakeDpapiSpawner(invocations, { mutateOutput } = {}) {
  return (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.kill = () => true;
    const chunks = [];
    child.stdin = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    child.stdin.on('finish', () => {
      const stdin = Buffer.concat(chunks).toString('utf8');
      invocations.push({ executable, args: [...args], options, stdin });
      const input = JSON.parse(stdin);
      const action = args.at(-1);
      let payload = Buffer.from(input.payloadBase64, 'base64');
      if (action === 'Protect') payload = Buffer.concat([Buffer.from('dpapi:'), payload]);
      else payload = payload.subarray(Buffer.byteLength('dpapi:'));
      let output = { schemaVersion: 1, payloadBase64: payload.toString('base64') };
      if (mutateOutput) output = mutateOutput(output, action);
      child.stdout.end(JSON.stringify(output));
      queueMicrotask(() => child.emit('exit', 0, null));
    });
    return child;
  };
}

test('uses only the fixed CurrentUser DPAPI script/action and sends secret JSON through stdin', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-dpapi-vault-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const vaultFile = path.join(directory, 'minecraft-account.dpapi.json');
  const invocations = [];
  const vault = new DpapiMinecraftAccountVault({
    vaultFile,
    platform: 'win32',
    windowsRoot: 'C:\\Windows',
    spawnProcess: fakeDpapiSpawner(invocations),
  });
  const secret = {
    schemaVersion: 1, provider: 'microsoft', refreshToken: 'private-refresh-token-1234567890',
    account: { id: '0123456789abcdef0123456789abcdef', name: 'FamilyAgent' },
    authenticatedAt: '2026-08-13T00:00:00.000Z',
  };
  await vault.save(secret);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].executable.toLowerCase(), 'c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe');
  assert.deepEqual(invocations[0].args, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', MINECRAFT_ACCOUNT_DPAPI_SCRIPT, '-Action', 'Protect',
  ]);
  assert.equal(JSON.stringify(invocations[0].args).includes(secret.refreshToken), false);
  assert.equal(JSON.stringify(invocations[0].options.env).includes(secret.refreshToken), false);
  assert.equal(invocations[0].stdin.includes(secret.refreshToken), false, 'secret JSON is base64-wrapped within stdin, never CLI/env');
  assert.equal(Buffer.from(JSON.parse(invocations[0].stdin).payloadBase64, 'base64').toString('utf8').includes(secret.refreshToken), true);

  const persisted = await fs.readFile(vaultFile, 'utf8');
  assert.equal(persisted.includes(secret.refreshToken), false);
  assert.equal(persisted.includes(secret.account.id), false);
  if (process.platform !== 'win32') assert.equal((await fs.stat(vaultFile)).mode & 0o777, 0o600);
  assert.deepEqual(await vault.load(), secret);
  assert.equal(invocations.at(-1).args.at(-1), 'Unprotect');
  assert.deepEqual(await vault.clear(), { removed: true });
  await assert.rejects(() => fs.stat(vaultFile), (error) => error.code === 'ENOENT');
  assert.deepEqual(await vault.clear(), { removed: false });
});

test('fixed PowerShell helper hard-codes CurrentUser protection and exact actions', async () => {
  const script = await fs.readFile(MINECRAFT_ACCOUNT_DPAPI_SCRIPT, 'utf8');
  assert.match(script, /\[ValidateSet\('Protect', 'Unprotect'\)\]/);
  assert.match(script, /DataProtectionScope\]::CurrentUser/);
  assert.match(script, /Add-Type -AssemblyName System\.Security/);
  assert.match(script, /\[Console\]::In\.ReadToEnd\(\)/);
  assert.doesNotMatch(script, /Read-Host|Get-Credential|ConvertTo-SecureString/u);
});

test('fails closed on non-Windows, malformed helper output, symlink vaults, and never spawns an arbitrary script', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-dpapi-adversarial-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const vaultFile = path.join(directory, 'account.json');
  let spawned = false;
  const unavailable = new DpapiMinecraftAccountVault({
    vaultFile, platform: 'linux', spawnProcess() { spawned = true; throw new Error('must not spawn'); },
  });
  await assert.rejects(() => unavailable.save({ refreshToken: 'private' }), (error) => (
    error instanceof DpapiVaultError && error.code === 'DPAPI_UNAVAILABLE'
  ));
  assert.equal(spawned, false);

  const malformed = new DpapiMinecraftAccountVault({
    vaultFile, platform: 'win32', windowsRoot: 'C:\\Windows',
    spawnProcess: fakeDpapiSpawner([], { mutateOutput: (output) => ({ ...output, injected: 'field' }) }),
  });
  await assert.rejects(() => malformed.save({ refreshToken: 'private' }), (error) => error.code === 'MINECRAFT_ACCOUNT_VAULT_INVALID');
  await assert.rejects(() => fs.stat(vaultFile), (error) => error.code === 'ENOENT');

  const target = path.join(directory, 'target.json');
  await fs.writeFile(target, '{}');
  try {
    await fs.symlink(target, vaultFile);
    const exact = new DpapiMinecraftAccountVault({
      vaultFile, platform: 'win32', windowsRoot: 'C:\\Windows', spawnProcess: fakeDpapiSpawner([]),
    });
    await assert.rejects(() => exact.load(), (error) => error.code === 'MINECRAFT_ACCOUNT_VAULT_INVALID');
    await assert.rejects(() => exact.clear(), (error) => error.code === 'MINECRAFT_ACCOUNT_VAULT_INVALID');
    assert.equal(await fs.readFile(target, 'utf8'), '{}');
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error?.code)) throw error;
  }
});

test('real Windows CurrentUser DPAPI protects, unprotects, and clears only a generated dummy vault', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-dpapi-real-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const vaultFile = path.join(directory, 'generated-dummy.dpapi.json');
  const dummy = {
    schemaVersion: 1,
    provider: 'microsoft',
    refreshToken: 'generated-non-secret-dummy-token-1234567890',
    account: { id: '0123456789abcdef0123456789abcdef', name: 'DummyAgent' },
    authenticatedAt: '2026-08-13T00:00:00.000Z',
  };
  const vault = new DpapiMinecraftAccountVault({ vaultFile });
  await vault.save(dummy);
  const persisted = await fs.readFile(vaultFile, 'utf8');
  assert.equal(persisted.includes(dummy.refreshToken), false);
  assert.equal(persisted.includes(dummy.account.id), false);
  assert.deepEqual(await vault.load(), dummy);
  assert.deepEqual(await vault.clear(), { removed: true });
  await assert.rejects(() => fs.stat(vaultFile), (error) => error.code === 'ENOENT');
});
