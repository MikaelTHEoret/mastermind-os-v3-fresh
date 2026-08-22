import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FamilyCoreCredentialManager } from '../src/family-core/credential-manager.mjs';

const KEY = Buffer.alloc(32, 0x5a);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_INSTANCE_ID = '22222222-2222-4222-8222-222222222222';

async function absent(file) {
  try { await fs.lstat(file); return false; }
  catch (error) { if (error?.code === 'ENOENT') return true; throw error; }
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-family-core-credential-'));
  const managedRoot = path.join(root, 'managed');
  const directory = path.join(root, 'family-server');
  await fs.mkdir(directory, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const uuids = [SESSION_ID, SERVER_INSTANCE_ID];
  let integrityReleases = 0;
  const options = {
    acquireIntegrityKey: async () => ({
      key: Buffer.from(KEY),
      release: async () => { integrityReleases += 1; },
    }),
    randomBytes: () => Buffer.alloc(48, 0x2a),
    randomUUID: () => uuids.shift(),
    now: () => Date.parse('2026-08-22T12:00:00.000Z'),
  };
  const manager = new FamilyCoreCredentialManager(managedRoot, options);
  const instance = { id: 'family-server', directory };
  return {
    root,
    managedRoot,
    directory,
    instance,
    manager,
    options,
    get integrityReleases() { return integrityReleases; },
    tokenFile: path.join(managedRoot, 'state', 'family-core-bridge', 'server.token'),
    manifestFile: path.join(managedRoot, 'state', 'family-core-bridge', 'credential.v1.json'),
    configFile: path.join(directory, 'config', 'mastermind-family-core.properties'),
  };
}

test('provisions a bounded per-launch token without exposing it through config, manifest, or status', async (t) => {
  const setup = await fixture(t);
  assert.deepEqual(await setup.manager.initialize(), {
    state: 'disabled', generation: null, createdAt: null, computerCommandEnabled: false, identityEventsEnabled: false,
  });
  assert.equal(setup.integrityReleases, 1);

  const lease = await setup.manager.prepareLaunch(setup.instance);
  const token = (await fs.readFile(setup.tokenFile, 'ascii')).trim();
  const config = await fs.readFile(setup.configFile, 'utf8');
  const manifest = await fs.readFile(setup.manifestFile, 'utf8');
  const status = setup.manager.status();

  assert.match(lease.generation, /^[a-f0-9]{64}$/);
  assert.equal(token.length, 64);
  assert.equal(config.includes(token), false);
  assert.equal(manifest.includes(token), false);
  assert.equal(JSON.stringify(status).includes(token), false);
  assert.match(config, /serverBridge\.enabled=true/);
  assert.match(config, /computerCommand\.enabled=false/);
  assert.match(config, /identityEvents\.enabled=false/);
  assert.match(config, /companionTelemetry\.enabled=false/);
  assert.match(config, new RegExp(`serverBridge\\.tokenFile=${setup.tokenFile.replaceAll('\\', '\\\\').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  assert.deepEqual(await setup.manager.authenticate({ token }), { sessionId: SESSION_ID });
  assert.equal(await setup.manager.authenticate({ token: `${token}x` }), null);
  assert.equal(setup.manager.verifyHello({
    instanceId: SERVER_INSTANCE_ID,
    commandEnabled: false,
    capabilities: [],
  }, { sessionId: SESSION_ID }), true);
  assert.equal(setup.manager.verifyHello({
    instanceId: '33333333-3333-4333-8333-333333333333',
    commandEnabled: false,
    capabilities: [],
  }, { sessionId: SESSION_ID }), false);

  await lease.assertHeld();
  await lease.release();
  assert.equal(await absent(setup.tokenFile), true);
  assert.equal(await absent(setup.configFile), true);
  assert.equal(await absent(setup.manifestFile), true);
  assert.equal(setup.manager.status().state, 'disabled');
});

test('retains an authenticated credential only for the exact active server and removes it after stop', async (t) => {
  const setup = await fixture(t);
  await setup.manager.initialize();
  await setup.manager.prepareLaunch(setup.instance);
  const token = (await fs.readFile(setup.tokenFile, 'ascii')).trim();

  const recovered = new FamilyCoreCredentialManager(setup.managedRoot, {
    ...setup.options,
    randomUUID: () => { throw new Error('rotation was not expected'); },
  });
  await recovered.initialize();
  assert.deepEqual(await recovered.reconcile(setup.instance, { active: true }), {
    action: 'retained-active', generation: recovered.status().generation,
  });
  assert.deepEqual(await recovered.authenticate({ token }), { sessionId: SESSION_ID });
  assert.deepEqual(await recovered.reconcile(setup.instance, { active: false }), { action: 'removed-stale' });
  assert.equal(await absent(setup.tokenFile), true);
  assert.equal(await absent(setup.configFile), true);
  assert.equal(await absent(setup.manifestFile), true);
});

test('binds deterministic Computer command activation into the launch credential and hello', async (t) => {
  const setup = await fixture(t);
  await setup.manager.initialize();
  const lease = await setup.manager.prepareLaunch(setup.instance, { computerCommandEnabled: true, identityEventsEnabled: true });
  const config = await fs.readFile(setup.configFile, 'utf8');

  assert.match(config, /computerCommand\.enabled=true/);
  assert.match(config, /identityEvents\.enabled=true/);
  assert.equal(setup.manager.status().computerCommandEnabled, true);
  assert.equal(setup.manager.status().identityEventsEnabled, true);
  assert.equal(setup.manager.verifyHello({
    instanceId: SERVER_INSTANCE_ID,
    commandEnabled: true,
    capabilities: ['computer.request', 'identity.events'],
  }, { sessionId: SESSION_ID }), true);
  assert.equal(setup.manager.verifyHello({
    instanceId: SERVER_INSTANCE_ID,
    commandEnabled: false,
    capabilities: ['computer.request', 'identity.events'],
  }, { sessionId: SESSION_ID }), false);

  await lease.release();
});

test('fails closed when any held credential file is changed', async (t) => {
  const setup = await fixture(t);
  await setup.manager.initialize();
  const lease = await setup.manager.prepareLaunch(setup.instance);
  await fs.appendFile(setup.configFile, 'computerCommand.enabled=true\n');

  await assert.rejects(lease.assertHeld(), (error) => error?.code === 'FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED');
  await assert.rejects(lease.release(), (error) => error?.code === 'FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED');
  assert.equal(await absent(setup.tokenFile), false);
});

test('refuses orphaned token or configuration state instead of replacing it', async (t) => {
  const setup = await fixture(t);
  await fs.mkdir(path.dirname(setup.tokenFile), { recursive: true });
  await fs.writeFile(setup.tokenFile, 'orphaned_token_that_is_long_enough_1234567890\n');
  await assert.rejects(setup.manager.initialize(), (error) => error?.code === 'FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED');

  await fs.rm(setup.tokenFile);
  const clean = new FamilyCoreCredentialManager(setup.managedRoot, setup.options);
  await clean.initialize();
  await fs.mkdir(path.dirname(setup.configFile), { recursive: true });
  await fs.writeFile(setup.configFile, 'serverBridge.enabled=true\n');
  await assert.rejects(
    clean.reconcile(setup.instance, { active: false }),
    (error) => error?.code === 'FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED',
  );
});

test('reuses an already verified process-pinned integrity key without acquiring another Windows guard', async (t) => {
  const setup = await fixture(t);
  const manager = new FamilyCoreCredentialManager(setup.managedRoot, {
    integrityKey: KEY,
    acquireIntegrityKey: async () => { throw new Error('a duplicate integrity-key acquisition was attempted'); },
  });
  await manager.initialize();
  assert.equal(manager.status().state, 'disabled');
});
