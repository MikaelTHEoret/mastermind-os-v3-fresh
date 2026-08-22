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
  assert.doesNotMatch(body.instructions, /embodied Minecraft family companion/u);
  assert.match(captured.init.headers.authorization, /^Bearer sk-test-/u);
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

test('production brain falls back to the all-disabled skeleton unless both gates are enabled', () => {
  const disabled = createFamilyCompanionBrain({ environment: {}, sendChat: () => {} });
  assert.ok(Object.values(disabled.status().flags).every((value) => value === false));
});
