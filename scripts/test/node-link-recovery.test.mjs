import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  LOCAL_NODE_LINK_RECOVERY_BASE_DELAY_MS,
  LOCAL_NODE_LINK_RECOVERY_MAX_DELAY_MS,
  LOCAL_NODE_LINK_RECOVERY_STABLE_AFTER_MS,
  createMastermindNodeLinkRecoveryController,
} from '../lib/local-service-control.mjs';

function fakeTimers() {
  let sequence = 0;
  const timers = [];
  return {
    schedule(callback, delayMs) {
      const timer = {
        callback,
        delayMs,
        sequence: ++sequence,
        cancelled: false,
        fired: false,
        unrefCalled: false,
        unref() { this.unrefCalled = true; },
      };
      timers.push(timer);
      return timer;
    },
    clearSchedule(timer) { timer.cancelled = true; },
    pending() {
      return timers.filter((timer) => !timer.cancelled && !timer.fired);
    },
    fireDelay(delayMs) {
      const timer = timers.find((candidate) => (
        !candidate.cancelled && !candidate.fired && candidate.delayMs === delayMs
      ));
      assert.ok(timer, `expected a pending ${delayMs}ms timer`);
      timer.fired = true;
      timer.callback();
      return timer;
    },
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function fixture(overrides = {}) {
  const timers = fakeTimers();
  const spawnCalls = [];
  const runningGenerations = [];
  const failures = [];
  let closing = false;
  let generation = 1;
  let active = { generation: 1, child: 'initial' };
  const spawn = overrides.spawn ?? (async (nextGeneration) => {
    const record = { generation: nextGeneration, child: `child-${nextGeneration}` };
    active = record;
    return record;
  });
  const controller = createMastermindNodeLinkRecoveryController({
    isClosing: () => closing,
    isPresent: () => active !== null,
    getGeneration: () => generation,
    spawn: async (nextGeneration) => {
      spawnCalls.push(nextGeneration);
      return spawn(nextGeneration);
    },
    isActive: (record) => active === record,
    markRunning: (nextGeneration) => {
      generation = nextGeneration;
      runningGenerations.push(nextGeneration);
    },
    reportFailure: (error) => failures.push(error),
    schedule: timers.schedule,
    clearSchedule: timers.clearSchedule,
    baseDelayMs: 100,
    maximumDelayMs: 800,
    stableAfterMs: 1_000,
  });
  return {
    controller,
    timers,
    spawnCalls,
    runningGenerations,
    failures,
    active: () => active,
    setActive: (record) => { active = record; },
    setClosing: (value) => { closing = value; },
  };
}

function noteUnexpectedExit(value) {
  const exited = value.active();
  value.setActive(null);
  value.controller.noteExit(exited);
  return exited;
}

test('one unexpected node-link exit schedules exactly one base-delay retry with the next exact generation', async () => {
  const value = fixture();
  noteUnexpectedExit(value);

  assert.deepEqual(value.timers.pending().map(({ delayMs }) => delayMs), [100]);
  assert.equal(value.timers.pending()[0].unrefCalled, true);
  value.timers.fireDelay(100);
  await settle();

  assert.deepEqual(value.spawnCalls, [2]);
  assert.deepEqual(value.runningGenerations, [2]);
  assert.deepEqual(value.timers.pending().map(({ delayMs }) => delayMs), [1_000]);
  assert.equal(value.timers.pending()[0].unrefCalled, true);
});

test('repeated pre-stability exits use bounded exponential backoff without overlapping spawns', async () => {
  const value = fixture();
  noteUnexpectedExit(value);
  value.timers.fireDelay(100);
  await settle();

  noteUnexpectedExit(value);
  assert.deepEqual(value.timers.pending().map(({ delayMs }) => delayMs), [200]);
  value.timers.fireDelay(200);
  await settle();

  noteUnexpectedExit(value);
  assert.deepEqual(value.timers.pending().map(({ delayMs }) => delayMs), [400]);
  value.timers.fireDelay(400);
  await settle();

  noteUnexpectedExit(value);
  assert.deepEqual(value.timers.pending().map(({ delayMs }) => delayMs), [800]);
  value.timers.fireDelay(800);
  await settle();

  noteUnexpectedExit(value);
  assert.deepEqual(value.timers.pending().map(({ delayMs }) => delayMs), [800]);
  assert.deepEqual(value.spawnCalls, [2, 3, 4, 5]);
  assert.deepEqual(value.runningGenerations, [2, 3, 4, 5]);
});

test('closing suspension cancels retry and stability timers and suppresses new work', async () => {
  const value = fixture();
  noteUnexpectedExit(value);
  assert.equal(value.controller.snapshot().retryScheduled, true);

  value.setClosing(true);
  assert.equal(value.controller.suspend(), true);
  assert.equal(value.controller.ensureRunning({ immediate: true }), false);
  assert.equal(value.controller.noteExit(), false);
  assert.deepEqual(value.timers.pending(), []);
  await settle();
  assert.deepEqual(value.spawnCalls, []);
});

test('a canceled drain resumes immediately and the singleton latch prevents overlapping replacements', async () => {
  let releaseSpawn;
  const value = fixture({
    spawn: (generation) => new Promise((resolve) => {
      releaseSpawn = () => {
        const record = { generation, child: `child-${generation}` };
        value.setActive(record);
        resolve(record);
      };
    }),
  });

  value.setClosing(true);
  value.controller.suspend();
  value.setActive(null);
  value.setClosing(false);
  assert.equal(value.controller.resume(), true);
  assert.equal(value.controller.ensureRunning({ immediate: true }), true);
  assert.equal(value.controller.ensureRunning({ immediate: true }), false);
  assert.deepEqual(value.spawnCalls, [2]);

  releaseSpawn();
  await settle();
  assert.deepEqual(value.spawnCalls, [2]);
  assert.deepEqual(value.runningGenerations, [2]);
});

test('a canceled close adopts one exact generation that was already starting when recovery was suspended', async () => {
  let releaseSpawn;
  const value = fixture({
    spawn: (generation) => new Promise((resolve) => {
      releaseSpawn = () => {
        const record = { generation, child: `child-${generation}` };
        value.setActive(record);
        resolve(record);
      };
    }),
  });
  value.setActive(null);
  assert.equal(value.controller.ensureRunning({ immediate: true }), true);
  value.setActive({ generation: 2, child: 'starting' });

  value.setClosing(true);
  value.controller.suspend();
  value.setClosing(false);
  value.controller.resume();
  assert.equal(value.controller.ensureRunning({ immediate: true }), false);

  releaseSpawn();
  await settle();
  assert.deepEqual(value.spawnCalls, [2]);
  assert.deepEqual(value.runningGenerations, [2]);
  assert.equal(value.controller.snapshot().stableScheduled, true);
});

test('backoff resets only after the same exact generation remains stable for the full window', async () => {
  const value = fixture();
  noteUnexpectedExit(value);
  value.timers.fireDelay(100);
  await settle();

  assert.equal(value.controller.snapshot().failureCount, 1);
  value.timers.fireDelay(1_000);
  assert.equal(value.controller.snapshot().failureCount, 0);

  noteUnexpectedExit(value);
  assert.deepEqual(value.timers.pending().map(({ delayMs }) => delayMs), [100]);
});

test('default recovery policy is bounded, stable for 60 seconds, and wired only inside the supervisor', async () => {
  assert.equal(LOCAL_NODE_LINK_RECOVERY_BASE_DELAY_MS, 1_000);
  assert.equal(LOCAL_NODE_LINK_RECOVERY_MAX_DELAY_MS, 30_000);
  assert.equal(LOCAL_NODE_LINK_RECOVERY_STABLE_AFTER_MS, 60_000);

  const source = await fs.readFile(new URL('../run-local-control.mjs', import.meta.url), 'utf8');
  assert.equal(source.match(/createMastermindNodeLinkRecoveryController\(/gu)?.length, 1);
  assert.match(source, /nodeLinkRecovery\.noteExit\(active\)/u);
  assert.ok((source.match(/nodeLinkRecovery\.suspend\(\)/gu)?.length ?? 0) >= 2);
  assert.ok((source.match(/nodeLinkRecovery\.resume\(\)/gu)?.length ?? 0) >= 2);
  assert.ok((source.match(/nodeLinkRecovery\.ensureRunning\(\{ immediate: true \}\)/gu)?.length ?? 0) >= 2);
  assert.match(source, /spawn: \(generation\) => spawnManaged\([\s\S]*nodeLinkEntrypoint, \[\], null, generation/u);
  assert.doesNotMatch(source, /restartMinecraftNodeLink|restartNodeLink/u);
});
