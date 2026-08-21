import assert from 'node:assert/strict';
import test from 'node:test';

import { LOCAL_AGENT_DRAIN_TIMEOUT_MS } from '../lib/local-control-drain.mjs';
import {
  LOCAL_CONTROL_TAKEOVER_TIMEOUT_MS,
  LOCAL_NODE_LINK_STOP_TIMEOUT_MS,
  prepareLocalControlShutdown,
} from '../lib/local-control-shutdown.mjs';

function options(events, overrides = {}) {
  return {
    stopNodeLink: async () => { events.push('node-link-stopped'); },
    drainMinecraft: async () => { events.push('minecraft-drained'); },
    minecraftAgentManaged: true,
    alreadyDrained: false,
    ...overrides,
  };
}

test('shutdown stops and awaits lease intake before authenticated Minecraft drain', async () => {
  const events = [];
  const result = await prepareLocalControlShutdown(options(events));
  assert.deepEqual(events, ['node-link-stopped', 'minecraft-drained']);
  assert.deepEqual(result, { nodeLinkStopped: true, minecraftDrained: true });
});

test('a node-link stop failure cancels shutdown before Minecraft drain', async () => {
  const events = [];
  await assert.rejects(
    prepareLocalControlShutdown(options(events, {
      stopNodeLink: async () => {
        events.push('node-link-stop-failed');
        throw new Error('still alive');
      },
    })),
    (error) => error?.code === 'NODE_LINK_STOP_FAILED' && error?.cause?.message === 'still alive',
  );
  assert.deepEqual(events, ['node-link-stop-failed']);
});

test('a failed Minecraft drain occurs only after the node link is stopped', async () => {
  const events = [];
  await assert.rejects(
    prepareLocalControlShutdown(options(events, {
      drainMinecraft: async () => {
        events.push('minecraft-drain-failed');
        throw new Error('server busy');
      },
    })),
    (error) => error?.code === 'MINECRAFT_DRAIN_FAILED' && error?.cause?.message === 'server busy',
  );
  assert.deepEqual(events, ['node-link-stopped', 'minecraft-drain-failed']);
});

test('an offline Minecraft agent needs no drain but still prepares node-link stop first', async () => {
  const events = [];
  const result = await prepareLocalControlShutdown(options(events, { minecraftAgentManaged: false }));
  assert.deepEqual(events, ['node-link-stopped']);
  assert.deepEqual(result, { nodeLinkStopped: true, minecraftDrained: false });
});

test('launcher source keeps node link non-blocking and outside browser restart authority', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('../run-local-control.mjs', import.meta.url),
    'utf8',
  ));
  const nextStart = source.indexOf("await spawnManaged('next-web'");
  const nodeStart = source.indexOf("await spawnManaged('mastermind-node-link'");
  assert.ok(nextStart >= 0 && nodeStart > nextStart, 'the portless node link must start only after Next');
  assert.match(source, /spawnManaged\('mastermind-node-link', nodeLinkEntrypoint, \[\], null\)/);
  assert.match(source, /port === undefined \? \{\} : \{ port \}/, 'an explicit null port must survive identity capture');
  const nodeExitStart = source.indexOf("if (role === 'mastermind-node-link')");
  const genericExitStart = source.indexOf('\n    if (!closing) {', nodeExitStart + 1);
  const nodeExitPolicy = source.slice(nodeExitStart, genericExitStart);
  assert.match(nodeExitPolicy, /dashboard and Minecraft backend remain online/);
  assert.doesNotMatch(nodeExitPolicy, /\bclose\s*\(/, 'a node-link exit must not shut down other children');
  assert.doesNotMatch(source, /restartMinecraftNodeLink|restartNodeLink/);
  assert.match(source, /setTimeout\(\(\) => finish\(false\), LOCAL_CONTROL_TAKEOVER_TIMEOUT_MS\)/);
});

test('takeover timeout covers sequential node stop, Minecraft drain, and bounded response overhead', () => {
  assert.equal(LOCAL_NODE_LINK_STOP_TIMEOUT_MS, 12_000);
  assert.ok(LOCAL_CONTROL_TAKEOVER_TIMEOUT_MS >= 90_000);
  assert.ok(
    LOCAL_CONTROL_TAKEOVER_TIMEOUT_MS
      >= LOCAL_NODE_LINK_STOP_TIMEOUT_MS + LOCAL_AGENT_DRAIN_TIMEOUT_MS + 10_000,
  );
});
