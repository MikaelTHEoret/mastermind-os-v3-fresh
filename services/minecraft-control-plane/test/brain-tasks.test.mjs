import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CompanionPhysicalTaskSupervisor,
  compileDeterministicCompanionTask,
} from '../src/brain/index.mjs';

const PLAYER_UUID = '01919a62-8e84-7c6b-8eb0-4f79592f3abf';

test('deterministic task compiler accepts only bounded explicit task phrases', () => {
  assert.deepEqual(compileDeterministicCompanionTask('Alchemist, follow me').action, {
    kind: 'skill.followPlayer', args: { playerUuid: null, distance: 4 },
  });
  assert.deepEqual(compileDeterministicCompanionTask('are you sure ? follow me').action, {
    kind: 'skill.followPlayer', args: { playerUuid: null, distance: 4 },
  });
  assert.deepEqual(compileDeterministicCompanionTask('Okay, could you please follow me?').action, {
    kind: 'skill.followPlayer', args: { playerUuid: null, distance: 4 },
  });
  assert.equal(compileDeterministicCompanionTask('follow me ?').action.kind, 'skill.followPlayer');
  assert.equal(compileDeterministicCompanionTask('come').action.kind, 'skill.followPlayer');
  assert.equal(compileDeterministicCompanionTask('can you jump ?').action.kind, 'direct.jump');
  assert.deepEqual(compileDeterministicCompanionTask('move 5 blocks back').action, {
    kind: 'direct.moveFor', args: { forward: -1, strafe: 0, durationMs: 1750, sprint: false, sneak: false },
  });
  assert.equal(compileDeterministicCompanionTask('stop and follow me').replaceCurrent, true);
  assert.equal(compileDeterministicCompanionTask('cancel that then explore 32 blocks').replaceCurrent, true);
  assert.deepEqual(compileDeterministicCompanionTask('go to 10 64 -20').action, {
    kind: 'skill.navigateTo', args: { x: 10, y: 64, z: -20, tolerance: 2 },
  });
  assert.deepEqual(compileDeterministicCompanionTask('go to coordinates x=10, y=64, z=-20').action, {
    kind: 'skill.navigateTo', args: { x: 10, y: 64, z: -20, tolerance: 2 },
  });
  assert.deepEqual(compileDeterministicCompanionTask('look at x=12 y=65 z=-18').action, {
    kind: 'direct.lookAt', args: { x: 12, y: 65, z: -18, durationMs: 250 },
  });
  assert.deepEqual(compileDeterministicCompanionTask('use it').action, {
    kind: 'direct.use', args: { hand: 'main' },
  });
  assert.deepEqual(compileDeterministicCompanionTask('select hotbar slot 3').action, {
    kind: 'direct.selectSlot', args: { slot: 2 },
  });
  assert.deepEqual(compileDeterministicCompanionTask('place oak planks at x=12 y=64 z=-18').action, {
    kind: 'direct.placeBlock', args: { blockId: 'minecraft:oak_planks', x: 12, y: 64, z: -18 },
  });
  assert.deepEqual(compileDeterministicCompanionTask('can you place a wood plank on the floor ?').action, {
    kind: 'direct.placeNearbyBlock', args: { blockId: 'minecraft:oak_planks' },
  });
  assert.deepEqual(compileDeterministicCompanionTask('place a single plank on the ground anywhere').action, {
    kind: 'direct.placeNearbyBlock', args: { blockId: 'minecraft:oak_planks' },
  });
  assert.deepEqual(compileDeterministicCompanionTask('can you throw the steak thats in your hand on the floor ?').action, {
    kind: 'direct.dropItem', args: { all: false },
  });
  assert.equal(compileDeterministicCompanionTask('go to x:158 z:62 y:-644').intent, 'clarify-coordinates');
  assert.equal(compileDeterministicCompanionTask('go to x:158 z:-644 y:62').action.args.y, 62);
  assert.deepEqual(compileDeterministicCompanionTask('chop 12 oak logs').action, {
    kind: 'skill.gatherBlock', args: { blockId: 'minecraft:oak_log', count: 12, maxDistance: 64 },
  });
  assert.deepEqual(compileDeterministicCompanionTask('scout 80 blocks').action, {
    kind: 'skill.explore', args: { radius: 80 },
  });
  assert.equal(compileDeterministicCompanionTask('stop').intent, 'cancel-current');
  assert.equal(compileDeterministicCompanionTask('sleep now').unavailable, true);
  assert.deepEqual(compileDeterministicCompanionTask('can you cook me some chicken in one of the furnaces').action, {
    kind: 'skill.smelt',
    args: {
      blockId: 'minecraft:furnace', inputItemId: 'minecraft:chicken', outputItemId: 'minecraft:cooked_chicken',
      fuelItemId: 'minecraft:coal', count: null, maxDistance: 16,
    },
  });
  assert.equal(compileDeterministicCompanionTask('cook 3 raw chicken').action.args.count, 3);
  assert.equal(compileDeterministicCompanionTask('any furnace will do').intent, 'smelt-chicken');
  assert.equal(compileDeterministicCompanionTask('enter the boat with me'), null);
  assert.equal(compileDeterministicCompanionTask('take the first item in the chest').intent, 'container-management-unavailable');
  assert.equal(compileDeterministicCompanionTask('get me something useful'), null);
  assert.equal(compileDeterministicCompanionTask('explore 999 blocks'), null);
  assert.equal(compileDeterministicCompanionTask('mine 65 coal'), null);
  assert.equal(compileDeterministicCompanionTask('place a castle over there'), null);
  assert.equal(compileDeterministicCompanionTask("don't follow me"), null);
  assert.equal(compileDeterministicCompanionTask('why did you say follow me'), null);
  assert.equal(compileDeterministicCompanionTask('are you sure you can follow me'), null);
});

test('physical task supervisor dispatches one typed action and narrates briefly', async () => {
  const calls = [];
  const supervisor = new CompanionPhysicalTaskSupervisor({
    dispatchAction: async (action, options) => {
      calls.push(['dispatch', action, options]);
      return { actionId: '11111111-1111-4111-8111-111111111111', kind: action.kind, status: 'dispatched' };
    },
    waitForActionActivation: async (actionId, options) => calls.push(['activated', actionId, options]),
    cancelAction: async () => { throw new Error('must not cancel'); },
    sessionStatus: () => ({ activeAction: null }),
    sendChat: async (text) => calls.push(['say', text]),
  });
  const result = await supervisor.handle({ role: 'child', minecraftUuid: PLAYER_UUID, text: 'Alchemist, follow me' });
  assert.equal(result.code, 'PHYSICAL_TASK_DISPATCHED');
  assert.deepEqual(calls, [
    ['dispatch', { kind: 'skill.followPlayer', args: { playerUuid: PLAYER_UUID, distance: 4 } }, { timeoutMs: 1_800_000 }],
    ['activated', '11111111-1111-4111-8111-111111111111', { timeoutMs: 3_000, settleMs: 100 }],
    ['say', "Okay, I'll follow you."],
  ]);
  assert.equal(supervisor.status().accepted, 1);
});

test('chicken cooking resolves bounded inventory counts before dispatch', async () => {
  const calls = [];
  const supervisor = new CompanionPhysicalTaskSupervisor({
    dispatchAction: async (action, options) => {
      calls.push(['dispatch', action, options]);
      return { actionId: '11111111-1111-4111-8111-111111111111', kind: action.kind, status: 'dispatched' };
    },
    waitForActionActivation: async () => {},
    cancelAction: async () => { throw new Error('must not cancel'); },
    sessionStatus: () => ({
      activeAction: null,
      latestSnapshot: { inventory: { items: [
        { itemId: 'minecraft:chicken', count: 4 }, { itemId: 'minecraft:coal', count: 14 },
      ] } },
    }),
    sendChat: async (text) => calls.push(['say', text]),
  });
  const result = await supervisor.handle({ role: 'parent', minecraftUuid: PLAYER_UUID, text: 'cook my chicken' });
  assert.equal(result.code, 'PHYSICAL_TASK_DISPATCHED');
  assert.deepEqual(calls[0], ['dispatch', {
    kind: 'skill.smelt',
    args: {
      blockId: 'minecraft:furnace', inputItemId: 'minecraft:chicken', outputItemId: 'minecraft:cooked_chicken',
      fuelItemId: 'minecraft:coal', count: 4, maxDistance: 16,
    },
  }, { timeoutMs: 600_000 }]);
  assert.match(calls[1][1], /cook the chicken/u);
});

test('planned physical tasks execute a bounded sequence and wait between steps', async () => {
  const calls = [];
  let sequence = 0;
  const supervisor = new CompanionPhysicalTaskSupervisor({
    dispatchAction: async (action, options) => {
      sequence += 1;
      const actionId = `11111111-1111-4111-8111-11111111111${sequence}`;
      calls.push(['dispatch', action, options]);
      return { actionId, kind: action.kind, status: 'dispatched' };
    },
    waitForActionActivation: async (actionId) => calls.push(['activated', actionId]),
    waitForPhysicalIdle: async (actionId, options) => calls.push(['idle', actionId, options]),
    cancelAction: async () => { throw new Error('must not cancel'); },
    sessionStatus: () => ({ activeAction: null }),
    sendChat: async (text) => calls.push(['say', text]),
  });
  const result = await supervisor.handlePlanned({ role: 'parent', minecraftUuid: PLAYER_UUID }, {
    decision: 'action', acknowledgement: "Okay, I'll drop one.",
    actions: [
      { kind: 'direct.selectSlot', args: { slot: 0 } },
      { kind: 'direct.dropItem', args: { all: false } },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['dispatch', { kind: 'direct.selectSlot', args: { slot: 0 } }, { timeoutMs: 15_000 }],
    ['activated', '11111111-1111-4111-8111-111111111111'],
    ['idle', '11111111-1111-4111-8111-111111111111', { timeoutMs: 15_000 }],
    ['dispatch', { kind: 'direct.dropItem', args: { all: false } }, { timeoutMs: 15_000 }],
    ['activated', '11111111-1111-4111-8111-111111111112'],
    ['idle', '11111111-1111-4111-8111-111111111112', { timeoutMs: 15_000 }],
    ['say', "Okay, I'll drop one."],
  ]);
});

test('physical task supervisor never promises movement when body activation fails', async () => {
  const speech = [];
  const supervisor = new CompanionPhysicalTaskSupervisor({
    dispatchAction: async (action) => ({
      actionId: '55555555-5555-4555-8555-555555555555', kind: action.kind, status: 'dispatched',
    }),
    waitForActionActivation: async () => {
      throw Object.assign(new Error('target absent'), { code: 'ACTION_START_FAILED' });
    },
    cancelAction: async () => { throw new Error('must not cancel'); },
    sessionStatus: () => ({ activeAction: null }),
    sendChat: async (text) => speech.push(text),
  });
  const result = await supervisor.handle({ role: 'parent', minecraftUuid: PLAYER_UUID, text: 'follow me' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACTION_START_FAILED');
  assert.deepEqual(speech, ["I couldn't start that just now."]);
  assert.equal(supervisor.status().accepted, 0);
});

test('physical task supervisor enforces role authority before dispatch', async () => {
  let dispatches = 0;
  const speech = [];
  const supervisor = new CompanionPhysicalTaskSupervisor({
    dispatchAction: async () => { dispatches += 1; },
    cancelAction: async () => {},
    sessionStatus: () => ({ activeAction: null }),
    sendChat: async (text) => speech.push(text),
  });
  const result = await supervisor.handle({ role: 'guest', minecraftUuid: PLAYER_UUID, text: 'follow me' });
  assert.equal(result.code, 'PHYSICAL_TASK_NOT_AUTHORIZED');
  assert.equal(dispatches, 0);
  assert.equal(speech.length, 1);
});

test('physical task supervisor cancels only the authoritative active action', async () => {
  const calls = [];
  const supervisor = new CompanionPhysicalTaskSupervisor({
    dispatchAction: async () => { throw new Error('must not dispatch'); },
    cancelAction: async (actionId, reason) => { calls.push(['cancel', actionId, reason]); return { alreadyTerminal: false }; },
    sessionStatus: () => ({ activeAction: { actionId: '22222222-2222-4222-8222-222222222222', status: 'progress' } }),
    sendChat: async (text) => calls.push(['say', text]),
  });
  const result = await supervisor.handle({ role: 'parent', minecraftUuid: PLAYER_UUID, text: 'never mind' });
  assert.equal(result.code, 'PHYSICAL_TASK_CANCEL_REQUESTED');
  assert.deepEqual(calls, [
    ['cancel', '22222222-2222-4222-8222-222222222222', 'player-request'],
    ['say', 'Okay, stopping.'],
  ]);
});

test('physical task supervisor atomically replaces active work before starting a new request', async () => {
  const calls = [];
  let active = { actionId: '22222222-2222-4222-8222-222222222222', status: 'started' };
  const supervisor = new CompanionPhysicalTaskSupervisor({
    dispatchAction: async (action, options) => {
      calls.push(['dispatch', action, options]);
      return { actionId: '33333333-3333-4333-8333-333333333333', kind: action.kind, status: 'dispatched' };
    },
    waitForActionActivation: async () => {},
    waitForPhysicalIdle: async (actionId, options) => { calls.push(['idle', actionId, options]); active = null; },
    cancelAction: async (actionId, reason) => { calls.push(['cancel', actionId, reason]); },
    sessionStatus: () => ({ activeAction: active }),
    sendChat: async (text) => calls.push(['say', text]),
  });
  const result = await supervisor.handle({ role: 'parent', minecraftUuid: PLAYER_UUID, text: 'stop and follow me' });
  assert.equal(result.code, 'PHYSICAL_TASK_DISPATCHED');
  assert.deepEqual(calls, [
    ['cancel', '22222222-2222-4222-8222-222222222222', 'player-replacement-request'],
    ['idle', '22222222-2222-4222-8222-222222222222', { timeoutMs: 3_000, allowCancelled: true }],
    ['dispatch', { kind: 'skill.followPlayer', args: { playerUuid: PLAYER_UUID, distance: 4 } }, { timeoutMs: 1_800_000 }],
    ['say', "Okay, I'll follow you."],
  ]);
});

test('a parent planned interaction preempts a lingering follow action', async () => {
  const calls = [];
  let active = { actionId: '22222222-2222-4222-8222-222222222222', status: 'started' };
  const supervisor = new CompanionPhysicalTaskSupervisor({
    cancelAction: async (actionId, reason) => calls.push(['cancel', actionId, reason]),
    waitForPhysicalIdle: async (actionId, options) => { calls.push(['idle', actionId, options]); active = null; },
    dispatchAction: async (action) => {
      calls.push(['dispatch', action]);
      return { actionId: '33333333-3333-4333-8333-333333333333', kind: action.kind };
    },
    waitForActionActivation: async () => {},
    sessionStatus: () => ({ activeAction: active }),
    sendChat: async (text) => calls.push(['say', text]),
  });
  const result = await supervisor.handlePlanned({ role: 'parent', minecraftUuid: PLAYER_UUID }, {
    decision: 'action', acknowledgement: "Okay, getting in.",
    actions: [{
      kind: 'direct.interactEntity',
      args: { entityUuid: '44444444-4444-4444-8444-444444444444', typeId: 'minecraft:oak_boat', hand: 'main' },
    }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.slice(0, 3), [
    ['cancel', '22222222-2222-4222-8222-222222222222', 'player-replacement-request'],
    ['idle', '22222222-2222-4222-8222-222222222222', { timeoutMs: 3_000, allowCancelled: true }],
    ['dispatch', {
      kind: 'direct.interactEntity',
      args: { entityUuid: '44444444-4444-4444-8444-444444444444', typeId: 'minecraft:oak_boat', hand: 'main' },
    }],
  ]);
});

test('unsupported transcript requests fail honestly without dispatch or a model', async () => {
  const speech = [];
  const supervisor = new CompanionPhysicalTaskSupervisor({
    dispatchAction: async () => { throw new Error('must not dispatch'); },
    cancelAction: async () => { throw new Error('must not cancel'); },
    sessionStatus: () => ({ activeAction: null }),
    sendChat: async (text) => speech.push(text),
  });
  for (const text of ['sleep now', 'take the first item in the chest']) {
    const result = await supervisor.handle({ role: 'parent', minecraftUuid: PLAYER_UUID, text });
    assert.equal(result.code, 'PHYSICAL_SKILL_UNAVAILABLE');
  }
  assert.match(speech[0], /can't reliably/u);
  assert.match(speech[1], /can't inspect or move/u);
});

test('physical task supervisor asks for coordinate correction without dispatching or using a model', async () => {
  const calls = [];
  const supervisor = new CompanionPhysicalTaskSupervisor({
    dispatchAction: async () => { throw new Error('must not dispatch'); },
    cancelAction: async () => { throw new Error('must not cancel'); },
    sessionStatus: () => ({ activeAction: null }),
    sendChat: async (text) => calls.push(text),
  });
  const result = await supervisor.handle({ role: 'parent', minecraftUuid: PLAYER_UUID, text: 'go to x:158 z:62 y:-644' });
  assert.equal(result.code, 'PHYSICAL_TASK_CLARIFICATION');
  assert.match(calls[0], /Y is -644/u);
});

test('a failed acknowledgement cannot rewrite a successfully dispatched physical task', async () => {
  const supervisor = new CompanionPhysicalTaskSupervisor({
    dispatchAction: async (action) => ({
      actionId: '44444444-4444-4444-8444-444444444444', kind: action.kind, status: 'dispatched',
    }),
    cancelAction: async () => { throw new Error('must not cancel'); },
    sessionStatus: () => ({ activeAction: null }),
    sendChat: async () => { throw new Error('chat unavailable'); },
  });
  const result = await supervisor.handle({ role: 'parent', minecraftUuid: PLAYER_UUID, text: 'explore' });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'PHYSICAL_TASK_DISPATCHED');
  assert.equal(supervisor.status().accepted, 1);
  assert.equal(supervisor.status().failures, 0);
  assert.equal(supervisor.status().narrationFailures, 1);
});
