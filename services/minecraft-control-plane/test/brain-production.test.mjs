import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CompanionConversationCoordinator,
  OpenAIResponsesProvider,
  companionFlagsFromEnvironment,
  createFamilyCompanionBrain,
  isCompanionSelfMessage,
} from '../src/brain/index.mjs';

const PLAYER = '01919a62-8e84-7c6b-8eb0-4f79592f3abf';
const MESSAGE = '01919a62-8e84-7c6b-8eb0-4f79592f3abe';

function chat(overrides = {}) {
  return {
    role: 'parent',
    playerId: PLAYER,
    messageId: MESSAGE,
    occurredAt: '2026-08-22T12:00:00.000Z',
    minecraftUuid: PLAYER,
    displayName: 'Mik',
    channel: 'public',
    text: 'Alchemist, hello there',
    directedAt: null,
    ...overrides,
  };
}

test('production feature activation is explicit and credential-gated', () => {
  assert.equal(companionFlagsFromEnvironment({}).companionConversation, false);
  assert.equal(companionFlagsFromEnvironment({
    OPENAI_API_KEY: 'sk-test-abcdefghijklmnopqrstuvwxyz',
    MASTERMIND_MINECRAFT_COMPANION_CONVERSATION_ENABLED: 'true',
    MASTERMIND_MINECRAFT_MODEL_REASONING_ENABLED: 'false',
  }).companionConversation, false);
  const enabled = companionFlagsFromEnvironment({
    OPENAI_API_KEY: 'sk-test-abcdefghijklmnopqrstuvwxyz',
    MASTERMIND_MINECRAFT_COMPANION_CONVERSATION_ENABLED: 'true',
    MASTERMIND_MINECRAFT_MODEL_REASONING_ENABLED: 'true',
  });
  assert.equal(enabled.companionConversation, true);
  assert.equal(enabled.modelReasoning, true);
  assert.equal(enabled.physicalTaskPlanning, false);
  assert.equal(companionFlagsFromEnvironment({
    MASTERMIND_MINECRAFT_PHYSICAL_TASK_PLANNING_ENABLED: 'true',
  }).physicalTaskPlanning, true);
  assert.equal(companionFlagsFromEnvironment({
    MASTERMIND_MINECRAFT_SURVIVAL_AUTOMATION_ENABLED: 'true',
  }).survivalAutomation, true);
});

test('OpenAI provider sends a non-stored structured request and validates the bounded reply', async () => {
  let captured;
  const provider = new OpenAIResponsesProvider({
    apiKey: 'sk-test-abcdefghijklmnopqrstuvwxyz',
    fetcher: async (url, init) => {
      captured = { url, init };
      return {
        ok: true,
        async json() {
          return { output: [{ content: [{ type: 'output_text', text: '{"text":"Hello Mik! Ready to explore?"}' }] }] };
        },
      };
    },
  });
  const result = await provider.reason({
    requestId: '01919a62-8e84-7c6b-8eb0-4f79592f3ac0',
    kind: 'converse',
    actor: 'COMPANION',
    playerId: PLAYER,
    input: { player: { displayName: 'Mik', role: 'parent' }, message: 'hello' },
    authorizedTools: [],
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.text, 'Hello Mik! Ready to explore?');
  const body = JSON.parse(captured.init.body);
  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.tools, undefined);
  assert.match(body.instructions, /relaxed, genuine friend/u);
  assert.match(body.instructions, /silent behavior constraints/u);
  assert.match(body.instructions, /without advertising them/u);
  assert.match(body.instructions, /capabilities object is authoritative/u);
  assert.match(body.instructions, /you can move through the Minecraft world/u);
  assert.doesNotMatch(body.instructions, /embodied Minecraft family companion/u);
  assert.match(captured.init.headers.authorization, /^Bearer sk-test-/u);
});

test('OpenAI provider requests a strict physical plan without exposing executable tools', async () => {
  let captured;
  const provider = new OpenAIResponsesProvider({
    apiKey: 'sk-test-abcdefghijklmnopqrstuvwxyz',
    fetcher: async (url, init) => {
      captured = { url, init };
      return {
        ok: true,
        async json() {
          return { output: [{ content: [{ type: 'output_text', text: JSON.stringify({
            decision: 'action', actionsJson: '[{"kind":"direct.swingHand","args":{"hand":"main"}}]', acknowledgement: 'Okay.', message: '',
          }) }] }] };
        },
      };
    },
  });
  const result = await provider.reason({
    requestId: '01919a62-8e84-7c6b-8eb0-4f79592f3ac1', kind: 'plan', actor: 'COMPANION', playerId: PLAYER,
    input: { currentMessage: 'punch air' }, authorizedTools: ['direct.swingHand'],
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
  });
  assert.equal(result.status, 'succeeded');
  assert.match(result.output.actionsJson, /direct\.swingHand/u);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.text.format.name, 'minecraft_physical_plan');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.tools, undefined);
  assert.match(body.instructions, /Never narrate, promise, role-play/u);
});

test('conversation coordinator does not spend a model call when embodiment output is unavailable', async () => {
  let modelCalls = 0;
  const coordinator = new CompanionConversationCoordinator({
    flags: { companionConversation: true, modelReasoning: true },
    provider: { async reason() { modelCalls += 1; throw new Error('must not run'); } },
    canSendChat: () => false,
    sendChat: async () => { throw new Error('must not run'); },
  });
  const result = await coordinator.ingest(chat());
  assert.equal(result.execution.code, 'COMPANION_OUTPUT_UNAVAILABLE');
  assert.equal(modelCalls, 0);
  assert.equal(coordinator.status().storesChatContent, false);
});

test('companion self messages are ignored before routing or model use', async () => {
  let modelCalls = 0;
  let chatDispatches = 0;
  const coordinator = new CompanionConversationCoordinator({
    flags: { companionConversation: true, modelReasoning: true },
    provider: { async reason() { modelCalls += 1; throw new Error('must not run'); } },
    canSendChat: () => true,
    sendChat: async () => { chatDispatches += 1; },
  });

  for (const self of [
    chat({ minecraftUuid: '996a56dd-fb3c-4f90-9158-1a608652ec77', displayName: 'RenamedCompanion' }),
    chat({ minecraftUuid: PLAYER, displayName: 'THE_ALCHEMIST___' }),
  ]) {
    const result = await coordinator.ingest(self);
    assert.equal(result.reason, 'companion-self-message');
    assert.equal(result.execution.code, 'IGNORED_COMPANION_SELF_MESSAGE');
  }

  assert.equal(modelCalls, 0);
  assert.equal(chatDispatches, 0);
  assert.equal(coordinator.status().received, 0);
  assert.equal(isCompanionSelfMessage(chat()), false);
});

test('conversation coordinator dispatches a real-account chat action and opens bounded attention', async () => {
  const sent = [];
  const coordinator = new CompanionConversationCoordinator({
    flags: { companionConversation: true, modelReasoning: true },
    provider: {
      async reason(request) {
        return {
          requestId: request.requestId,
          status: 'succeeded',
          output: { text: 'Hi Mik! What should we build today?' },
          model: 'fixture',
          completedAt: new Date().toISOString(),
        };
      },
    },
    canSendChat: () => true,
    sendChat: async (text) => sent.push(text),
  });
  const result = await coordinator.ingest(chat());
  assert.equal(result.execution.code, 'REPLY_DISPATCHED');
  assert.deepEqual(sent, ['Hi Mik! What should we build today?']);
  assert.equal(coordinator.status().replies, 1);
  assert.equal(coordinator.status().activeCompanionSessions, 1);
});

test('conversation context describes the companion identity and exact enabled physical skills', async () => {
  let request;
  const coordinator = new CompanionConversationCoordinator({
    flags: {
      companionConversation: true, modelReasoning: true, physicalTaskPlanning: true, survivalAutomation: true,
    },
    provider: {
      async reason(value) {
        request = value;
        return {
          requestId: value.requestId,
          status: 'succeeded',
          output: { text: 'I can follow, explore, and gather while we chat.' },
          model: 'fixture',
          completedAt: new Date().toISOString(),
        };
      },
    },
    canSendChat: () => true,
    sendChat: async () => {},
  });
  await coordinator.ingest(chat({ text: 'Alchemist, tell me about yourself' }));
  assert.deepEqual(request.input.identity, {
    character: 'The_AlChemist___', embodiment: 'Minecraft player account in the Family world',
  });
  assert.equal(request.input.capabilities.physicalActions, true);
  assert.equal(request.input.capabilities.survivalAutomation, true);
  assert.deepEqual(request.input.capabilities.enabledPhysicalSkills, [
    'follow the requesting player',
    'walk to supplied coordinates',
    'explore a bounded nearby radius',
    'gather supported blocks',
    'look at supplied coordinates',
    'move briefly forward, backward, or sideways',
    'select a numbered hotbar slot',
    'use the item or object under the crosshair',
    'interact with an exact nearby observed block or entity',
    'place a supported hotbar block at nearby coordinates',
    'place one supported hotbar block on nearby ground',
    'drop the selected item or stack',
    'cook raw chicken with coal in a nearby furnace and collect it',
    'select a named item already in the hotbar',
    'swing either hand, including punching air',
    'stop the current physical task',
  ]);
  assert.ok(request.input.capabilities.limitations.includes('sleeping'));
});

test('headless embodiment capabilities restrict both self-description and model planning tools', async () => {
  const requests = [];
  const coordinator = new CompanionConversationCoordinator({
    flags: {
      companionConversation: true, modelReasoning: true, physicalTaskPlanning: true, survivalAutomation: false,
    },
    provider: {
      async reason(value) {
        requests.push(value);
        if (value.kind === 'plan') {
          return {
            requestId: value.requestId, status: 'succeeded',
            output: { decision: 'conversation', actionsJson: '[]', acknowledgement: '', message: '' },
            model: 'fixture', completedAt: new Date().toISOString(),
          };
        }
        return {
          requestId: value.requestId, status: 'succeeded', output: { text: 'I can walk to coordinates.' },
          model: 'fixture', completedAt: new Date().toISOString(),
        };
      },
    },
    canSendChat: () => true,
    sendChat: async () => {},
    sessionStatus: () => ({
      state: 'ready', client: { capabilities: ['action.cancel', 'direct.say', 'skill.navigateTo'] }, latestSnapshot: null,
    }),
    taskSupervisor: { async handle() { return { handled: false }; }, async handlePlanned() { return { handled: false }; } },
  });
  await coordinator.ingest(chat({ text: 'Alchemist, tell me about yourself' }));
  assert.deepEqual(requests[0].input.capabilities.enabledPhysicalSkills, [
    'walk to supplied coordinates', 'stop the current physical task',
  ]);
  await coordinator.ingest(chat({ text: 'Alchemist, find the kitchen' }));
  assert.deepEqual(requests[1].authorizedTools, ['skill.navigateTo']);
});

test('capability questions use the authoritative manifest without a model call', async () => {
  let modelCalls = 0;
  const sent = [];
  const coordinator = new CompanionConversationCoordinator({
    flags: {
      companionConversation: true, modelReasoning: true, physicalTaskPlanning: true, survivalAutomation: true,
    },
    provider: { async reason() { modelCalls += 1; throw new Error('must not run'); } },
    canSendChat: () => true,
    sendChat: async (text) => sent.push(text),
  });
  const result = await coordinator.ingest(chat({ text: 'Alchemist, what are you capable of doing now?' }));
  assert.equal(result.execution.code, 'CAPABILITY_REPLY_DISPATCHED');
  assert.equal(modelCalls, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /follow you/u);
  assert.match(sent[0], /basic survival/u);
  assert.match(sent[0], /can't sleep/u);
  assert.ok(sent[0].length <= 220);
});

test('conversation coordinator handles deterministic physical tasks without a model call', async () => {
  let modelCalls = 0;
  const handled = [];
  const coordinator = new CompanionConversationCoordinator({
    flags: { companionConversation: true, modelReasoning: true, physicalTaskPlanning: true },
    provider: { async reason() { modelCalls += 1; throw new Error('must not run'); } },
    taskSupervisor: {
      async handle(value) {
        handled.push(value.text);
        return { handled: true, ok: true, code: 'PHYSICAL_TASK_DISPATCHED', spoke: true };
      },
    },
    canSendChat: () => true,
    sendChat: async () => { throw new Error('task supervisor owns narration'); },
  });
  const result = await coordinator.ingest(chat({ text: 'Alchemist, follow me' }));
  assert.equal(result.execution.code, 'PHYSICAL_TASK_DISPATCHED');
  assert.equal(modelCalls, 0);
  assert.deepEqual(handled, ['Alchemist, follow me']);
  assert.equal(coordinator.status().activeCompanionSessions, 1);
});

test('furnace cooking dispatches the complete typed skill without conversational role-play', async () => {
  let modelCalls = 0;
  const sent = [];
  const dispatched = [];
  const brain = createFamilyCompanionBrain({
    environment: { OPENAI_API_KEY: 'sk-test-abcdefghijklmnopqrstuvwxyz' },
    flags: { companionConversation: true, modelReasoning: true, physicalTaskPlanning: true },
    provider: { async reason() { modelCalls += 1; throw new Error('must not run'); } },
    canSendChat: () => true,
    sendChat: async (text) => sent.push(text),
    dispatchAction: async (action) => {
      dispatched.push(action);
      return { actionId: '33333333-3333-4333-8333-333333333333', kind: action.kind, status: 'dispatched' };
    },
    cancelAction: async () => { throw new Error('must not cancel'); },
    sessionStatus: () => ({
      activeAction: null,
      latestSnapshot: { inventory: { items: [
        { itemId: 'minecraft:chicken', count: 4 }, { itemId: 'minecraft:coal', count: 14 },
      ] } },
    }),
  });
  const result = await brain.ingestChat(chat({ text: 'Alchemist, can you cook me some chicken in one of the furnaces' }));
  assert.equal(result.execution.code, 'PHYSICAL_TASK_DISPATCHED');
  assert.equal(modelCalls, 0);
  assert.equal(sent.length, 1);
  assert.equal(dispatched[0].kind, 'skill.smelt');
  assert.equal(dispatched[0].args.count, 4);
  assert.match(sent[0], /cook the chicken/u);
});

test('conversation output guard blocks unverified embodied action claims', async () => {
  const sent = [];
  const coordinator = new CompanionConversationCoordinator({
    flags: { companionConversation: true, modelReasoning: true, physicalTaskPlanning: false },
    provider: {
      async reason(request) {
        return {
          requestId: request.requestId, status: 'succeeded', model: 'fixture', completedAt: new Date().toISOString(),
          output: { text: "I'll walk to the furnace now and start cooking." },
        };
      },
    },
    canSendChat: () => true,
    sendChat: async (text) => sent.push(text),
  });
  const result = await coordinator.ingest(chat({ text: 'Alchemist, tell me what happens next' }));
  assert.equal(result.execution.ok, false);
  assert.equal(result.execution.code, 'UNVERIFIED_PHYSICAL_CLAIM_BLOCKED');
  assert.deepEqual(sent, ["I can't claim a game action unless the action system actually starts and verifies it."]);
});

test('unmatched natural physical requests become validated typed actions instead of chat promises', async () => {
  const planned = [];
  const requests = [];
  const coordinator = new CompanionConversationCoordinator({
    flags: { companionConversation: true, modelReasoning: true, physicalTaskPlanning: true },
    provider: {
      async reason(request) {
        requests.push(request);
        return {
          requestId: request.requestId, status: 'succeeded', model: 'fixture', completedAt: new Date().toISOString(),
          output: { decision: 'action', actionsJson: '[{"kind":"direct.selectItem","args":{"itemId":"minecraft:oak_planks"}}]', acknowledgement: 'Okay.', message: '' },
        };
      },
    },
    taskSupervisor: {
      async handle() { return { handled: false }; },
      async handlePlanned(value, plan) {
        planned.push([value.text, plan]);
        return { handled: true, ok: true, code: 'PHYSICAL_TASK_DISPATCHED', spoke: true };
      },
    },
    sessionStatus: () => ({ latestSnapshot: { inventory: { items: [{ itemId: 'minecraft:oak_planks', count: 12 }] } } }),
    canSendChat: () => true,
    sendChat: async () => { throw new Error('ordinary chat must not narrate the action'); },
  });
  const result = await coordinator.ingest(chat({ text: 'Alchemist, can you select a wooden plank' }));
  assert.equal(result.execution.code, 'PHYSICAL_TASK_DISPATCHED');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'plan');
  assert.deepEqual(requests[0].input.companionState.inventory, [{ itemId: 'minecraft:oak_planks', count: 12 }]);
  assert.deepEqual(planned[0][1].actions, [{ kind: 'direct.selectItem', args: { itemId: 'minecraft:oak_planks' } }]);
});

test('short follow-ups retain dialogue and game awareness for bounded multi-step actions', async () => {
  const requests = [];
  const planned = [];
  const coordinator = new CompanionConversationCoordinator({
    flags: { companionConversation: true, modelReasoning: true, physicalTaskPlanning: true },
    provider: {
      async reason(request) {
        requests.push(request);
        const output = requests.length === 1
          ? { decision: 'clarify', actionsJson: '[]', acknowledgement: '', message: 'Which hotbar slot?' }
          : {
              decision: 'action',
              actionsJson: '[{"kind":"direct.selectSlot","args":{"slot":0}},{"kind":"direct.dropItem","args":{"all":false}}]',
              acknowledgement: 'Here you go.', message: '',
            };
        return {
          requestId: request.requestId, status: 'succeeded', model: 'fixture', completedAt: new Date().toISOString(), output,
        };
      },
    },
    taskSupervisor: {
      async handle() { return { handled: false }; },
      async handlePlanned(value, plan) {
        planned.push([value.text, plan]);
        return {
          handled: true, ok: plan.decision === 'action',
          code: plan.decision === 'action' ? 'PHYSICAL_TASK_DISPATCHED' : 'PHYSICAL_TASK_CLARIFICATION',
          spoke: true,
        };
      },
    },
    sessionStatus: () => ({
      latestSnapshot: {
        player: { position: { x: 10, y: 64, z: 20 } },
        inventory: {
          items: [{ itemId: 'minecraft:cooked_mutton', count: 2 }],
          hotbar: [{ slot: 0, itemId: 'minecraft:cooked_mutton', count: 2 }], selectedSlot: 2,
        },
        awareness: {
          blocks: [{ blockId: 'minecraft:lodestone', x: 11, y: 64, z: 20, distanceSq: 1, count: 1 }],
          players: [{ minecraftUuid: PLAYER, displayName: 'Mik', x: 12, y: 64, z: 20, distanceSq: 4, visible: true, heldItemId: null }],
          entities: [{
            entityUuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', typeId: 'minecraft:cow', displayName: 'Cow',
            category: 'passive', x: 13, y: 64, z: 20, distanceSq: 9, visible: true, alive: true, itemId: null,
          }],
          crosshairTarget: { kind: 'block', blockId: 'minecraft:lodestone', x: 11, y: 64, z: 20, distanceSq: 1 },
        },
        baritone: { state: 'idle', activeSkill: null, goal: null },
      },
      activeAction: null, lastAction: null,
    }),
    canSendChat: () => true,
    sendChat: async () => {},
  });

  const first = await coordinator.ingest(chat({ text: 'Alchemist, throw the item from a hotbar slot at me' }));
  assert.equal(first.execution.code, 'PHYSICAL_TASK_CLARIFICATION');
  const second = await coordinator.ingest(chat({
    messageId: '01919a62-8e84-7c6b-8eb0-4f79592f3ab1',
    occurredAt: '2026-08-22T12:00:01.000Z', text: '1',
  }));
  assert.equal(second.execution.code, 'PHYSICAL_TASK_DISPATCHED');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].input.recentTurns, [
    { role: 'player', text: 'Alchemist, throw the item from a hotbar slot at me' },
    { role: 'companion', text: 'Which hotbar slot?' },
    { role: 'player', text: '1' },
  ]);
  assert.equal(requests[1].input.lastPlan.decision, 'clarify');
  assert.deepEqual(requests[1].input.companionState.hotbar, [
    { slot: 0, itemId: 'minecraft:cooked_mutton', count: 2 },
  ]);
  assert.equal(requests[1].input.companionState.nearbyPlayers[0].minecraftUuid, PLAYER);
  assert.equal(requests[1].input.companionState.nearbyEntities[0].typeId, 'minecraft:cow');
  assert.equal(requests[1].input.companionState.crosshairTarget.blockId, 'minecraft:lodestone');
  assert.deepEqual(planned[1][1].actions, [
    { kind: 'direct.selectSlot', args: { slot: 0 } },
    { kind: 'direct.dropItem', args: { all: false } },
  ]);
});

test('invalid planned actions are blocked and never fall through to conversational role-play', async () => {
  let plannedCalls = 0;
  let chatDispatches = 0;
  const coordinator = new CompanionConversationCoordinator({
    flags: { companionConversation: true, modelReasoning: true, physicalTaskPlanning: true },
    provider: {
      async reason(request) {
        return {
          requestId: request.requestId, status: 'succeeded', model: 'fixture', completedAt: new Date().toISOString(),
          output: { decision: 'action', actionsJson: '[{"kind":"direct.say","args":{"text":"I did it"}}]', acknowledgement: '', message: '' },
        };
      },
    },
    taskSupervisor: {
      async handle() { return { handled: false }; },
      async handlePlanned() { plannedCalls += 1; throw new Error('must not dispatch'); },
    },
    canSendChat: () => true,
    sendChat: async () => { chatDispatches += 1; },
  });
  const result = await coordinator.ingest(chat({ text: 'Alchemist, punch the air' }));
  assert.equal(result.execution.ok, false);
  assert.equal(result.execution.code, 'MODEL_ACTION_UNAUTHORIZED');
  assert.equal(plannedCalls, 0);
  assert.equal(chatDispatches, 1);
  assert.ok(coordinator.status().replies + coordinator.status().failures <= coordinator.status().addressed);
});

test('deterministic physical tasks remain available without conversation or a model provider', async () => {
  let modelCalls = 0;
  const coordinator = new CompanionConversationCoordinator({
    flags: { companionConversation: false, modelReasoning: false, physicalTaskPlanning: true },
    provider: { async reason() { modelCalls += 1; throw new Error('must not run'); } },
    taskSupervisor: {
      async handle() { return { handled: true, ok: true, code: 'PHYSICAL_TASK_DISPATCHED' }; },
    },
    canSendChat: () => true,
    sendChat: async () => {},
  });
  const result = await coordinator.ingest(chat({ text: 'Alchemist, follow me' }));
  assert.equal(result.execution.code, 'PHYSICAL_TASK_DISPATCHED');
  assert.equal(modelCalls, 0);
});

test('production brain wires an enabled task request to the typed companion bridge without model use', async () => {
  let modelCalls = 0;
  const calls = [];
  const brain = createFamilyCompanionBrain({
    environment: { OPENAI_API_KEY: 'sk-test-abcdefghijklmnopqrstuvwxyz' },
    flags: { companionConversation: true, modelReasoning: true, physicalTaskPlanning: true },
    provider: { async reason() { modelCalls += 1; throw new Error('must not run'); } },
    canSendChat: () => true,
    sendChat: async (text) => calls.push(['say', text]),
    dispatchAction: async (action, options) => {
      calls.push(['dispatch', action, options]);
      return { actionId: '33333333-3333-4333-8333-333333333333', kind: action.kind, status: 'dispatched' };
    },
    cancelAction: async () => { throw new Error('must not cancel'); },
    sessionStatus: () => ({ activeAction: null }),
  });
  const result = await brain.ingestChat(chat({ text: 'Alchemist, follow me' }));
  assert.equal(result.execution.code, 'PHYSICAL_TASK_DISPATCHED');
  assert.equal(modelCalls, 0);
  assert.equal(brain.status().flags.physicalTaskPlanning, true);
  assert.equal(brain.status().states.physicalTaskPlanning, 'implemented');
  assert.deepEqual(calls, [
    ['dispatch', { kind: 'skill.followPlayer', args: { playerUuid: PLAYER, distance: 4 } }, { timeoutMs: 1_800_000 }],
    ['say', "Okay, I'll follow you."],
  ]);
});

test('production brain falls back to the all-disabled skeleton unless both gates are enabled', () => {
  const disabled = createFamilyCompanionBrain({ environment: {}, sendChat: () => {} });
  assert.ok(Object.values(disabled.status().flags).every((value) => value === false));
});

test('deterministic survival remains available without conversation, a model, or a provider credential', async () => {
  const calls = [];
  const brain = createFamilyCompanionBrain({
    environment: {},
    flags: {
      companionConversation: false,
      modelReasoning: false,
      physicalTaskPlanning: false,
      survivalAutomation: true,
    },
    canSendChat: () => false,
    sendChat: async () => { throw new Error('chat must not run'); },
    dispatchAction: async (action, options) => {
      calls.push([action, options]);
      return { actionId: '77777777-7777-4777-8777-777777777777', kind: action.kind, status: 'dispatched' };
    },
    cancelAction: async () => { throw new Error('cancel must not run'); },
    sessionStatus: () => ({
      state: 'ready',
      killSwitch: false,
      activeAction: null,
      latestSnapshot: {
        phase: 'in-world',
        serverAlias: 'family-server',
        player: { health: 0, maxHealth: 20, hunger: 17 },
      },
    }),
  });

  const result = await brain.tickSurvival();
  assert.equal(result.code, 'SURVIVAL_ACTION_DISPATCHED');
  assert.equal(brain.status().flags.survivalAutomation, true);
  assert.deepEqual(calls, [[{ kind: 'direct.respawn', args: {} }, { timeoutMs: 45_000 }]]);
});
