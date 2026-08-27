import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalControlChildEnvironment,
  createSharedLocalControlEnvironment,
} from '../lib/local-control-environment.mjs';

const CONTROL_TOKEN = 'a'.repeat(64);
const SUPERVISOR_ID = 'b'.repeat(32);

function shared(parentEnvironment = {}, args = []) {
  return createSharedLocalControlEnvironment({
    parentEnvironment,
    args,
    controlToken: CONTROL_TOKEN,
    supervisorId: SUPERVISOR_ID,
  });
}

test('memory event sync reaches spawned children only through the exact opt-in flag or process environment', () => {
  assert.equal(shared().MASTERMIND_MEMORY_EVENT_SYNC_ENABLED, 'false');
  assert.equal(shared({}, ['--memory-event-sync']).MASTERMIND_MEMORY_EVENT_SYNC_ENABLED, 'true');
  assert.equal(shared({ MASTERMIND_MEMORY_EVENT_SYNC_ENABLED: 'true' }).MASTERMIND_MEMORY_EVENT_SYNC_ENABLED, 'true');

  for (const value of ['TRUE', '1', 'yes', 'false', ' true ', '']) {
    assert.equal(
      shared({ MASTERMIND_MEMORY_EVENT_SYNC_ENABLED: value }).MASTERMIND_MEMORY_EVENT_SYNC_ENABLED,
      'false',
    );
  }
});

test('the pure shared environment replaces inherited control values and normalizes key casing', () => {
  const environment = shared({
    PATH: 'test-path',
    mastermind_memory_event_sync_enabled: 'true',
    MASTERMIND_CONTROL_TOKEN: 'untrusted-parent-token',
    MASTERMIND_LOCAL_SUPERVISOR_ID: 'untrusted-parent-supervisor',
    mastermind_memory_operator_pin_scrypt: 'must-not-reach-managed-children',
  });
  assert.deepEqual(environment, {
    PATH: 'test-path',
    MASTERMIND_CONTROL_TOKEN: CONTROL_TOKEN,
    MASTERMIND_LOCAL_SUPERVISOR_ID: SUPERVISOR_ID,
    MASTERMIND_LOCAL_CONTROL_ENABLED: 'true',
    MASTERMIND_CONTROL_URL: 'http://127.0.0.1:43100',
    MASTERMIND_MEMORY_EVENT_SYNC_ENABLED: 'false',
  });
});

test('invalid launch inputs fail before any process could be spawned', () => {
  assert.throws(() => createSharedLocalControlEnvironment({
    parentEnvironment: {}, args: [], controlToken: 'short', supervisorId: SUPERVISOR_ID,
  }), /control token/i);
  assert.throws(() => createSharedLocalControlEnvironment({
    parentEnvironment: {}, args: [true], controlToken: CONTROL_TOKEN, supervisorId: SUPERVISOR_ID,
  }), /arguments/i);
});

test('the random service pipe is available only to the Next child environment', () => {
  const pipeName = String.raw`\\.\pipe\mastermind-local-control-${'c'.repeat(32)}`;
  const common = shared({
    MASTERMIND_LOCAL_SERVICE_PIPE: String.raw`\\.\pipe\mastermind-local-control-${'d'.repeat(32)}`,
    MASTERMIND_LOCAL_CHILD_ROLE: 'untrusted-parent-role',
  });
  const next = createLocalControlChildEnvironment({
    sharedEnvironment: common, role: 'next-web', pipeName, platform: 'win32',
  });
  const agent = createLocalControlChildEnvironment({
    sharedEnvironment: common, role: 'minecraft-control-agent', pipeName, platform: 'win32',
  });
  const nodeLink = createLocalControlChildEnvironment({
    sharedEnvironment: {
      ...common,
      MASTERMIND_MINECRAFT_DATA_DIR: 'D:\\MastermindPortableData',
      MASTERMIND_NODE_CREDENTIAL: 'must-not-reach-node-link',
      MASTERMIND_NODE_EXCHANGE_URL: 'https://untrusted.invalid/exchange',
      NODE_DEBUG: 'https',
      NODE_OPTIONS: '--require C:\\untrusted-hook.cjs',
      NODE_EXTRA_CA_CERTS: 'C:\\untrusted-ca.pem',
      SSLKEYLOGFILE: 'C:\\tls-keys.log',
    },
    role: 'mastermind-node-link',
    pipeName,
    platform: 'win32',
  });
  assert.equal(next.MASTERMIND_LOCAL_SERVICE_PIPE, pipeName);
  assert.equal(next.MASTERMIND_LOCAL_CHILD_ROLE, 'next-web');
  assert.equal(agent.MASTERMIND_LOCAL_SERVICE_PIPE, undefined);
  assert.equal(agent.MASTERMIND_LOCAL_CHILD_ROLE, 'minecraft-control-agent');
  assert.equal(nodeLink.MASTERMIND_LOCAL_SERVICE_PIPE, undefined);
  assert.equal(nodeLink.MASTERMIND_LOCAL_CHILD_ROLE, 'mastermind-node-link');
  assert.equal(nodeLink.MASTERMIND_CONTROL_TOKEN, CONTROL_TOKEN);
  assert.equal(nodeLink.MASTERMIND_MINECRAFT_DATA_DIR, 'D:\\MastermindPortableData');
  assert.equal(nodeLink.MASTERMIND_NODE_CREDENTIAL, undefined);
  assert.equal(nodeLink.MASTERMIND_NODE_EXCHANGE_URL, undefined);
  assert.equal(nodeLink.NODE_DEBUG, undefined);
  assert.equal(nodeLink.NODE_OPTIONS, undefined);
  assert.equal(nodeLink.NODE_EXTRA_CA_CERTS, undefined);
  assert.equal(nodeLink.SSLKEYLOGFILE, undefined);
  assert.throws(() => createLocalControlChildEnvironment({
    sharedEnvironment: common,
    role: 'next-web',
    pipeName: String.raw`\\.\pipe\arbitrary-${'c'.repeat(32)}`,
    platform: 'win32',
  }), /child environment/i);
});
