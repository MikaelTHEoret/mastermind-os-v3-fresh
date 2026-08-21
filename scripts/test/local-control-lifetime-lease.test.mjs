import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { localControlLifetimeLeaseName } from '../lib/local-control-lifetime-lease.mjs';

const leaseModuleUrl = pathToFileURL(path.resolve('scripts/lib/local-control-lifetime-lease.mjs')).href;
const childSource = String.raw`
import { acquireLocalControlLifetimeLease } from ${JSON.stringify(leaseModuleUrl)};
const options = JSON.parse(process.env.MASTERMIND_LEASE_TEST_OPTIONS);
try {
  const lease = await acquireLocalControlLifetimeLease({
    ...options,
    requestIncumbentRelease: options.expectedIncumbentOwnerId ? async (ownerId) => {
      process.send({ type: 'release-request', ownerId });
    } : undefined,
  });
  process.send({ type: 'acquired', ownerId: lease.ownerId, replacedOwnerId: lease.replacedOwnerId });
  process.on('message', (message) => {
    if (message?.action === 'exit') process.exit(0);
  });
} catch (error) {
  process.send(
    { type: 'error', code: error?.code, message: error?.message },
    () => process.exit(0),
  );
}
`;

function ownerId() {
  return crypto.randomBytes(16).toString('hex');
}

function launchLeaseChild(options) {
  return spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
    env: { ...process.env, MASTERMIND_LEASE_TEST_OPTIONS: JSON.stringify(options) },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  });
}

function nextMessage(child, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for lease fixture')), timeoutMs);
    child.once('message', (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Lease fixture exited with ${code}`));
      }
    });
  });
}

async function exitChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.send({ action: 'exit' });
  await new Promise((resolve) => child.once('exit', resolve));
}

async function waitForExit(child, timeoutMs = 2_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Lease fixture did not exit')), timeoutMs)),
  ]);
}

async function temporaryWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-lease-test-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  return workspace;
}

test('lease name is fixed per canonical workspace and workspace-specific', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const other = await temporaryWorkspace(t);
  assert.equal(localControlLifetimeLeaseName(workspace), localControlLifetimeLeaseName(path.resolve(workspace)));
  assert.notEqual(localControlLifetimeLeaseName(workspace), localControlLifetimeLeaseName(other));
  if (process.platform === 'win32') assert.match(localControlLifetimeLeaseName(workspace), /^\\\\\.\\pipe\\mastermind-local-control-lifetime-/);
});

test('lease is exclusive and becomes available only after its owner exits', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const firstOwnerId = ownerId();
  const first = launchLeaseChild({ workspace, ownerId: firstOwnerId, contenderStartedAtMs: Date.now() });
  t.after(() => exitChild(first));
  assert.deepEqual(await nextMessage(first), { type: 'acquired', ownerId: firstOwnerId, replacedOwnerId: null });

  const rejected = launchLeaseChild({ workspace, ownerId: ownerId(), contenderStartedAtMs: Date.now() });
  const rejection = await nextMessage(rejected);
  assert.equal(rejection.type, 'error');
  assert.match(rejection.code, /^(CONCURRENT_LAUNCH_WON|LEASE_OWNER_UNVERIFIED)$/);
  await waitForExit(rejected);

  await exitChild(first);
  const successorId = ownerId();
  const successor = launchLeaseChild({ workspace, ownerId: successorId, contenderStartedAtMs: Date.now() });
  t.after(() => exitChild(successor));
  assert.deepEqual(await nextMessage(successor), { type: 'acquired', ownerId: successorId, replacedOwnerId: null });
});

test('an unreferenced lease does not keep a completed one-shot process alive', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const source = String.raw`
import { acquireLocalControlLifetimeLease } from ${JSON.stringify(leaseModuleUrl)};
await acquireLocalControlLifetimeLease({
  workspace: process.env.MASTERMIND_LEASE_TEST_WORKSPACE,
  ownerId: ${JSON.stringify(ownerId())},
  contenderStartedAtMs: Date.now(),
  unref: true,
});
process.stdout.write('acquired\n');
`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    env: { ...process.env, MASTERMIND_LEASE_TEST_WORKSPACE: workspace },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  await waitForExit(child);
  assert.equal(child.exitCode, 0);
  assert.equal(stdout, 'acquired\n');
});

test('two authenticated successors race atomically and exactly one wins', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const incumbentId = ownerId();
  const incumbent = launchLeaseChild({ workspace, ownerId: incumbentId, contenderStartedAtMs: Date.now() });
  t.after(() => exitChild(incumbent));
  assert.equal((await nextMessage(incumbent)).type, 'acquired');

  const startedAt = Date.now();
  const contenders = [ownerId(), ownerId()].map((id) => launchLeaseChild({
    workspace,
    ownerId: id,
    contenderStartedAtMs: startedAt,
    expectedIncumbentOwnerId: incumbentId,
    handoffTimeoutMs: 5_000,
    retryIntervalMs: 10,
  }));
  for (const contender of contenders) {
    t.after(() => exitChild(contender));
    contender.on('message', (message) => {
      if (message?.type === 'release-request' && incumbent.exitCode === null) incumbent.send({ action: 'exit' });
    });
  }
  const terminalMessage = async (child) => {
    do {
      const message = await nextMessage(child);
      if (message.type === 'acquired' || message.type === 'error') return message;
    } while (true);
  };
  const results = await Promise.all(contenders.map(terminalMessage));
  assert.equal(results.filter((result) => result.type === 'acquired').length, 1);
  assert.equal(results.filter((result) => result.code === 'CONCURRENT_LAUNCH_WON').length, 1);
  assert.equal(results.find((result) => result.type === 'acquired').replacedOwnerId, incumbentId);
  const rejectedIndex = results.findIndex((result) => result.type === 'error');
  await waitForExit(contenders[rejectedIndex]);
});
