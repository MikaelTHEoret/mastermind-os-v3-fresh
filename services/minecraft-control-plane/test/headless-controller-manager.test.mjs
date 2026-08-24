import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MineflayerZenithControllerManager } from '../src/companion/headless-controller-manager.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONTROLLER_ROOT = path.join(ROOT, 'minecraft', 'mineflayer-zenith-controller');
const CONTROLLER_MAIN = path.join(CONTROLLER_ROOT, 'src', 'controller.mjs');
const PROFILE = Object.freeze({
  username: 'The_AlChemist___',
  uuid: '996a56ddfb3c4f9091581a608652ec77',
  accessToken: 'private-access-token-value',
});

function output(value) {
  return `${JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), ...value })}\n`;
}

function fakeController() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  const exit = (code, signal) => {
    child.stdin.destroy();
    child.stdout.end();
    child.emit('exit', code, signal);
  };
  child.kill = (signal = 'SIGTERM') => {
    queueMicrotask(() => exit(signal === 'SIGKILL' ? null : 0, signal === 'SIGKILL' ? signal : null));
    return true;
  };
  let launchAccepted = false;
  let buffered = '';
  const commands = [];
  child.stdin.setEncoding('utf8');
  child.stdin.on('data', (chunk) => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const value = JSON.parse(line);
      if (!launchAccepted) {
        launchAccepted = true;
        assert.equal(value.host, '127.0.0.1');
        assert.equal(value.port, 25568);
        assert.equal(value.profile.name, PROFILE.username);
        assert.equal(value.accessToken, PROFILE.accessToken);
        child.stdout.write(output({
          type: 'controller.status', state: 'ready', code: 'PLAY_READY',
          capabilities: ['observe.snapshot', 'direct.say', 'skill.navigateTo', 'container.open', 'action.cancel', 'controller.stop'],
        }));
        continue;
      }
      commands.push(value);
      if (value.kind === 'observe.snapshot') {
        child.stdout.write(output({
          type: 'command.result', commandId: value.commandId, kind: value.kind, ok: true,
          result: { observation: { phase: 'in-world', player: { position: { x: 1, y: 64, z: 2 } }, inventory: { items: [] }, container: null } },
        }));
      } else if (value.kind === 'direct.say') {
        child.stdout.write(output({ type: 'command.result', commandId: value.commandId, kind: value.kind, ok: true, result: { spoken: true } }));
      } else if (value.kind === 'skill.navigateTo') {
        child.stdout.write(output({ type: 'action.status', actionId: value.commandId, kind: value.kind, status: 'started' }));
        setTimeout(() => child.stdout.write(output({
          type: 'action.status', actionId: value.commandId, kind: value.kind, status: 'succeeded',
          evidence: { kind: 'position.within', observedDistance: 0 },
        })), 10);
      } else if (value.kind === 'controller.stop') {
        child.stdout.write(output({ type: 'command.result', commandId: value.commandId, kind: value.kind, ok: true, result: { stopping: true } }));
        queueMicrotask(() => exit(0, null));
      }
    }
  });
  return { child, commands };
}

function manager(fake, options = {}) {
  return new MineflayerZenithControllerManager({
    controllerMain: CONTROLLER_MAIN,
    controllerRoot: CONTROLLER_ROOT,
    executable: process.execPath,
    getSession: async () => ({ ...PROFILE }),
    expectedProfileName: PROFILE.username,
    expectedProfileUuid: PROFILE.uuid,
    spawnProcess: () => {
      queueMicrotask(() => fake.child.emit('spawn'));
      return fake.child;
    },
    startTimeoutMs: 1_000,
    stopTimeoutMs: 1_000,
    ...options,
  });
}

test('manages a headless controller and exposes only brain-compatible proven capabilities', async () => {
  const fake = fakeController();
  const body = manager(fake);
  await body.initialize();
  const started = await body.start();
  assert.equal(started.state, 'ready');
  assert.deepEqual(started.capabilities, ['action.cancel', 'direct.say', 'skill.navigateTo']);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(body.status().latestSnapshot.phase, 'in-world');

  const spoken = await body.dispatchAction({ kind: 'direct.say', args: { text: 'Hello there' } });
  assert.equal(spoken.status, 'succeeded');
  const navigation = await body.dispatchAction({
    kind: 'skill.navigateTo', args: { x: 10, y: 64, z: 20, tolerance: 2 },
  }, { timeoutMs: 10_000 });
  assert.equal(navigation.status, 'queued');
  assert.equal((await body.waitForActionActivation(navigation.actionId)).status, 'started');
  assert.equal((await body.waitForPhysicalIdle(navigation.actionId, { timeoutMs: 1_000 })).status, 'succeeded');
  assert.equal(body.status().activeAction, null);

  assert.throws(() => body.dispatchAction({ kind: 'direct.jump', args: {} }), { code: 'CAPABILITY_UNAVAILABLE' });
  const stopped = await body.stop();
  assert.equal(stopped.state, 'disconnected');
  assert.equal(body.pendingResults.size, 0);
  assert.equal(fake.commands.at(-1).kind, 'controller.stop');
});

test('rejects non-loopback launch mutation and stops the exact child when startup never becomes ready', async () => {
  assert.throws(() => new MineflayerZenithControllerManager({
    controllerMain: CONTROLLER_MAIN, controllerRoot: CONTROLLER_ROOT, executable: process.execPath,
    getSession: async () => PROFILE, expectedProfileName: PROFILE.username, expectedProfileUuid: PROFILE.uuid, port: 80,
  }), /port/u);

  const fake = fakeController();
  fake.child.stdin.removeAllListeners('data');
  const body = manager(fake, { startTimeoutMs: 50 });
  await body.initialize();
  await assert.rejects(() => body.start(), { code: 'CONTROLLER_START_TIMEOUT' });
  assert.equal(body.isActive(), false);
});
