import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLiveStatusPoller,
  emptyLiveResource,
  liveResourceFailed,
  liveResourcePresentation,
  liveResourceSucceeded,
  liveStatusPollDelay,
  parseMinecraftInstanceSummary,
} from '../live-status.mjs';

test('Minecraft summary accepts the bounded public projection and rejects duplicate identities', () => {
  const parsed = parseMinecraftInstanceSummary({
    ok: true,
    instances: [{
      id: 'family-server',
      displayName: 'Family Server',
      status: 'running',
      minecraftVersion: '26.2',
      pid: 42,
    }],
  });
  assert.deepEqual(parsed.instances, [{ id: 'family-server', displayName: 'Family Server', status: 'running' }]);
  assert.throws(() => parseMinecraftInstanceSummary({
    ok: true,
    instances: [
      { id: 'family-server', displayName: 'Family Server', status: 'running' },
      { id: 'family-server', displayName: 'Duplicate', status: 'stopped' },
    ],
  }));
  assert.throws(() => parseMinecraftInstanceSummary({ ok: true, instances: [], secret: 'nope' }));
});

test('failure metadata preserves the last-good value and becomes stale without erasing it', () => {
  const initial = emptyLiveResource();
  const good = liveResourceSucceeded(initial, { status: 'running' }, 1_000);
  const failed = liveResourceFailed(good, 'Temporarily unavailable.', 6_000);
  assert.deepEqual(failed.value, { status: 'running' });
  assert.equal(failed.lastGoodAt, 1_000);
  assert.equal(failed.errorCount, 1);
  assert.deepEqual(liveResourcePresentation(failed, 17_000, 'visible'), {
    hasValue: true,
    stale: true,
    failed: true,
    errorCount: 1,
  });
  assert.equal(liveStatusPollDelay('visible'), 5_000);
  assert.equal(liveStatusPollDelay('visible', true), 2_000);
  assert.equal(liveStatusPollDelay('hidden'), 30_000);
  assert.equal(liveStatusPollDelay('hidden', true), 30_000);
});

test('poller never overlaps, coalesces refreshes, adapts delay, and aborts on teardown', async () => {
  const timers = [];
  const runs = [];
  let visible = true;
  let resolveRun;
  const poller = createLiveStatusPoller({
    run(signal) {
      runs.push(signal);
      return new Promise((resolve) => { resolveRun = resolve; });
    },
    getDelay: () => visible ? 5_000 : 30_000,
    setTimer(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { timer.cleared = true; },
  });

  poller.start();
  await Promise.resolve();
  assert.equal(runs.length, 1);
  poller.refresh();
  poller.refresh();
  assert.equal(runs.length, 1);
  resolveRun();
  await Promise.resolve();
  await Promise.resolve();
  const immediate = timers.find((timer) => timer.delay === 0 && !timer.cleared);
  assert.ok(immediate);
  immediate.callback();
  await Promise.resolve();
  assert.equal(runs.length, 2);

  visible = false;
  resolveRun();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(timers.some((timer) => timer.delay === 30_000 && !timer.cleared));
  poller.stop();
  assert.equal(runs[1].aborted, false);

  const abortPoller = createLiveStatusPoller({
    run(signal) {
      runs.push(signal);
      return new Promise(() => {});
    },
    getDelay: () => 5_000,
  });
  abortPoller.start();
  await Promise.resolve();
  abortPoller.stop();
  assert.equal(runs.at(-1).aborted, true);
});
