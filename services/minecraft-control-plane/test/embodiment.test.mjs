import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EmbodimentContractError,
  SessionEmbodimentAdapter,
  validateEmbodimentStep,
  verifyExpectedEffects,
} from '../src/companion/embodiment.mjs';

test('embodiment steps bind actions to observable effects and a failure policy', () => {
  const step = {
    stepId: 'collect-oak',
    action: { kind: 'skill.gatherBlock', args: { blockId: 'minecraft:oak_log', count: 4, maxDistance: 32 } },
    expectedEffects: [{ kind: 'inventory.delta', itemId: 'minecraft:oak_log', count: 4 }],
    timeoutMs: 120_000,
    failurePolicy: 'replan',
  };
  assert.equal(validateEmbodimentStep(step), step);
  assert.throws(
    () => validateEmbodimentStep({ ...step, expectedEffects: [] }),
    (error) => error instanceof EmbodimentContractError && error.code === 'INVALID_EMBODIMENT_CONTRACT',
  );
});

test('effect verification uses observed state rather than an executor success claim', () => {
  const before = {
    phase: 'in-world',
    player: { position: { x: 0, y: 64, z: 0 } },
    inventory: { items: [{ itemId: 'minecraft:oak_log', count: 1 }] },
  };
  const after = {
    phase: 'in-world',
    player: { position: { x: 10, y: 64, z: 10 } },
    inventory: { items: [{ itemId: 'minecraft:oak_log', count: 5 }] },
  };
  assert.deepEqual(verifyExpectedEffects([
    { kind: 'inventory.delta', itemId: 'minecraft:oak_log', count: 4 },
    { kind: 'position.within', x: 10, y: 64, z: 10, tolerance: 1 },
  ], before, after), {
    verified: true,
    results: [
      { kind: 'inventory.delta', verified: true, observed: 4 },
      { kind: 'position.within', verified: true, observed: 0 },
    ],
  });
  assert.equal(verifyExpectedEffects([
    { kind: 'inventory.delta', itemId: 'minecraft:oak_log', count: 5 },
  ], before, after).verified, false);
});

test('session adapter keeps the brain independent from the current body', async () => {
  const calls = [];
  const session = {
    status: () => ({
      state: 'ready', killSwitch: false,
      client: { capabilities: ['direct.say', 'skill.navigateTo'] },
      activeAction: null, lastAction: null, latestSnapshot: { phase: 'in-world' },
    }),
    dispatchAction: (action, options) => { calls.push(['dispatch', action, options]); return { actionId: 'action-1' }; },
    cancelAction: (actionId, reason) => { calls.push(['cancel', actionId, reason]); return { actionId }; },
    waitForActionActivation: async (actionId, options) => { calls.push(['wait', actionId, options]); },
  };
  const adapter = new SessionEmbodimentAdapter(session, { kind: 'mineflayer-via-zenith' });
  const bindings = adapter.brainBindings();
  assert.equal(bindings.canSendChat(), true);
  bindings.sendChat('hello');
  await bindings.waitForActionActivation('action-1', { timeoutMs: 1000 });
  assert.equal(adapter.status().kind, 'mineflayer-via-zenith');
  assert.deepEqual(calls, [
    ['dispatch', { kind: 'direct.say', args: { text: 'hello' } }, { timeoutMs: 15_000 }],
    ['wait', 'action-1', { timeoutMs: 1000 }],
  ]);
});
