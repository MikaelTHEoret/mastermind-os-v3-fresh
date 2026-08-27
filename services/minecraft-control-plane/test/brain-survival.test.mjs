import assert from 'node:assert/strict';
import test from 'node:test';

import { DeterministicSurvivalController } from '../src/brain/index.mjs';

function snapshot(overrides = {}) {
  return {
    phase: 'in-world',
    serverAlias: 'family-server',
    player: { health: 20, maxHealth: 20, hunger: 20, ...overrides },
  };
}

function controller(options = {}) {
  const calls = [];
  let current = options.snapshot ?? snapshot();
  const value = new DeterministicSurvivalController({
    mode: options.mode ?? 'stay_alive',
    now: options.now ?? (() => 100_000),
    cooldownMs: options.cooldownMs ?? 30_000,
    sessionStatus: () => ({
      state: 'ready', killSwitch: false, activeAction: null, latestSnapshot: current, ...(options.status ?? {}),
    }),
    cancelAction: async (actionId, reason) => {
      calls.push(['cancel', actionId, reason]);
      return { alreadyTerminal: false };
    },
    dispatchAction: async (action, dispatchOptions) => {
      calls.push([action, dispatchOptions]);
      return { actionId: '55555555-5555-4555-8555-555555555555', kind: action.kind, status: 'dispatched' };
    },
  });
  return { value, calls, setSnapshot(next) { current = next; } };
}

test('stay-alive remains idle on a healthy snapshot without a model dependency', async () => {
  const { value, calls } = controller();
  assert.deepEqual(value.selectIntent(snapshot()), { kind: 'none', reason: 'stable', action: null });
  assert.equal((await value.tick()).code, 'SURVIVAL_STABLE');
  assert.equal(calls.length, 0);
});

test('stay-alive dispatches the typed escape skill for critically low health', async () => {
  const { value, calls } = controller({ snapshot: snapshot({ health: 7 }) });
  const result = await value.tick();
  assert.equal(result.code, 'SURVIVAL_ACTION_DISPATCHED');
  assert.equal(result.intent, 'emergency.escape');
  assert.deepEqual(calls, [[{ kind: 'skill.escapeDanger', args: {} }, { timeoutMs: 60_000 }]]);
});

test('a large recent health loss triggers deterministic escape before health becomes critical', () => {
  const { value } = controller();
  value.observe(snapshot({ health: 20 }));
  value.observe(snapshot({ health: 15 }));
  assert.equal(value.selectIntent().kind, 'emergency.escape');
  assert.equal(value.selectIntent().reason, 'recent-damage');
});

test('low air preempts follow before drowning without a model call', async () => {
  const drowning = controller({
    snapshot: snapshot({ air: 220, inWater: true }),
    status: { activeAction: { actionId: '77777777-7777-4777-8777-777777777777' } },
  });
  const result = await drowning.value.tick();
  assert.equal(result.code, 'SURVIVAL_PREEMPTION_REQUESTED');
  assert.deepEqual(drowning.calls, [[
    'cancel', '77777777-7777-4777-8777-777777777777', 'survival-emergency',
  ]]);
});

test('death selects bounded respawn while low hunger fails visibly until eat exists', async () => {
  const dead = controller({ snapshot: snapshot({ health: 0 }) });
  assert.equal((await dead.value.tick()).intent, 'recovery.respawn');
  assert.deepEqual(dead.calls[0], [{ kind: 'direct.respawn', args: {} }, { timeoutMs: 45_000 }]);

  const hungry = controller({ snapshot: snapshot({ hunger: 6 }) });
  const unavailable = await hungry.value.tick();
  assert.equal(unavailable.code, 'SURVIVAL_CAPABILITY_UNAVAILABLE');
  assert.equal(unavailable.intent, 'needs.food');
  assert.equal(hungry.calls.length, 0);
});

test('kill switch, active work, disabled mode, and cooldown prevent duplicate actions', async () => {
  const disabled = controller({ mode: 'disabled', snapshot: snapshot({ health: 4 }) });
  assert.equal((await disabled.value.tick()).code, 'SURVIVAL_DISABLED');

  const killed = controller({ snapshot: snapshot({ health: 4 }), status: { killSwitch: true } });
  assert.equal((await killed.value.tick()).code, 'SURVIVAL_NOT_READY');
  assert.equal(killed.calls.length, 0);

  const occupied = controller({
    snapshot: snapshot({ health: 4 }), status: { activeAction: { actionId: '66666666-6666-4666-8666-666666666666' } },
  });
  assert.equal((await occupied.value.tick()).code, 'SURVIVAL_PREEMPTION_REQUESTED');
  assert.deepEqual(occupied.calls, [['cancel', '66666666-6666-4666-8666-666666666666', 'survival-emergency']]);

  const times = [100_000, 100_100];
  const active = controller({ snapshot: snapshot({ health: 4 }), now: () => times.shift() });
  assert.equal((await active.value.tick()).code, 'SURVIVAL_ACTION_DISPATCHED');
  assert.equal((await active.value.tick()).code, 'SURVIVAL_ACTION_COOLDOWN');
  assert.equal(active.calls.length, 1);
});

test('invalid or stale-shaped observations fail closed', async () => {
  const { value, setSnapshot } = controller();
  assert.equal(value.observe({ phase: 'disconnected' }).code, 'SURVIVAL_OBSERVATION_UNAVAILABLE');
  setSnapshot({ phase: 'disconnected' });
  assert.equal((await value.tick()).code, 'SURVIVAL_NOT_READY');
  assert.equal(value.status().lastTick.code, 'SURVIVAL_NOT_READY');
});
