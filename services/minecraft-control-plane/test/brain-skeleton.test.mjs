import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BEHAVIOR_MODES,
  BrainContractError,
  ConversationIntake,
  ConversationRouter,
  FakeModelBroker,
  FakeReasoningModel,
  ModeRegistry,
  MastermindModelBroker,
  NarrationPolicy,
  PermissionPolicy,
  SkillCatalog,
  createDigestBoundApproval,
  createFamilyCompanionSkeleton,
  validateConversationInput,
  validateProfileClaim,
} from '../src/brain/index.mjs';

const IDs = Object.freeze({
  message: '01919a62-8e84-7c6b-8eb0-4f79592f3abe',
  response: '01919a62-8e84-7c6b-8eb0-4f79592f3abd',
  player: '01919a62-8e84-7c6b-8eb0-4f79592f3abf',
  request: '01919a62-8e84-7c6b-8eb0-4f79592f3ac0',
  claim: '01919a62-8e84-7c6b-8eb0-4f79592f3ac1',
  evidence: '01919a62-8e84-7c6b-8eb0-4f79592f3ac2',
});

function conversation(overrides = {}) {
  return {
    messageId: IDs.message,
    occurredAt: '2026-08-21T12:00:00.000Z',
    minecraftUuid: IDs.player,
    displayName: 'Mik',
    channel: 'public',
    text: 'Hello there',
    directedAt: null,
    ...overrides,
  };
}

test('brain contracts reject unknown fields, unsafe text, and non-canonical timestamps', () => {
  assert.throws(
    () => validateConversationInput({ ...conversation(), surprise: true }),
    (error) => error instanceof BrainContractError && error.code === 'UNKNOWN_FIELD',
  );
  assert.throws(
    () => validateConversationInput(conversation({ text: 'unsafe\u202etext' })),
    (error) => error instanceof BrainContractError && error.code === 'INVALID_CONTRACT',
  );
  assert.throws(
    () => validateConversationInput(conversation({ occurredAt: '2026-08-21T12:00:00Z' })),
    (error) => error instanceof BrainContractError && error.code === 'INVALID_CONTRACT',
  );
});

test('conversation routing keeps Computer and companion identities separate', () => {
  const router = new ConversationRouter({ flags: { computerChat: true, companionConversation: true } });
  assert.equal(router.route(conversation({ channel: 'computer-command', text: 'status', directedAt: 'COMPUTER' })).actor, 'COMPUTER');
  assert.equal(router.route(conversation({ text: 'Alchemist, come with me', directedAt: 'COMPANION' })).actor, 'COMPANION');
  assert.equal(router.route(conversation()).actor, null);
});

test('conversation attention requires an explicit name, reply, or bounded active session', () => {
  const router = new ConversationRouter({
    flags: { computerChat: true, companionConversation: true },
    attentionWindowMs: 5_000,
  });
  assert.equal(router.classify(conversation({ text: 'Alchemist, come with me' })).reason, 'companion-name');
  assert.equal(router.classify(conversation({ text: 'A palechemist is not the companion' })).actor, null);
  assert.deepEqual(router.markResponse({
    messageId: IDs.response,
    occurredAt: '2026-08-21T12:00:00.000Z',
    minecraftUuid: IDs.player,
    actor: 'COMPANION',
  }).tracked, true);
  assert.equal(router.classify(conversation({
    occurredAt: '2026-08-21T12:00:01.000Z',
    replyToMessageId: IDs.response,
  })).reason, 'reply-to-companion');
  assert.equal(router.classify(conversation({ occurredAt: '2026-08-21T12:00:02.000Z' })).reason, 'active-conversation');
  assert.equal(router.classify(conversation({ occurredAt: '2026-08-21T12:00:05.000Z' })).actor, null);
  assert.equal(router.markResponse({
    messageId: IDs.response,
    occurredAt: '2026-08-21T12:00:06.000Z',
    minecraftUuid: IDs.player,
    actor: 'COMPUTER',
  }).tracked, false);
});

test('conversation intake records only redacted routing evidence while execution stays disabled', () => {
  const intake = new ConversationIntake();
  const text = 'Alchemist, this private test phrase must not be retained';
  const result = intake.ingest({ role: 'parent', ...conversation({ text }) });
  assert.equal(result.actor, 'COMPANION');
  assert.equal(result.authorization.allowed, true);
  assert.equal(result.execution.code, 'FEATURE_DISABLED');
  assert.deepEqual(intake.status(), {
    schemaVersion: 1,
    received: 1,
    addressed: 1,
    ignored: 0,
    lastReceivedAt: '2026-08-21T12:00:00.000Z',
    lastActor: 'COMPANION',
    lastReason: 'companion-name',
    lastExecutionCode: 'FEATURE_DISABLED',
    activeCompanionSessions: 0,
    storesChatContent: false,
  });
  const serialized = JSON.stringify(intake.status());
  assert.equal(serialized.includes(text), false);
  assert.equal(serialized.includes(IDs.player), false);

  assert.equal(intake.ingest({ role: 'guest', ...conversation({ text: 'ordinary ambient chat' }) }).actor, null);
  assert.equal(intake.status().ignored, 1);
});

test('disabled routes return structured feature results instead of pretending to succeed', () => {
  const router = new ConversationRouter();
  assert.deepEqual(
    router.route(conversation({ channel: 'computer-command', text: 'status', directedAt: 'COMPUTER' })),
    {
      ok: false,
      code: 'FEATURE_DISABLED',
      feature: 'computerChat',
      state: 'stubbed',
      message: "The 'computerChat' capability is present as a disabled foundation stub.",
    },
  );
});

test('skill catalog never advertises stubbed or planned capabilities', () => {
  const catalog = new SkillCatalog([
    { id: 'direct.use', availability: 'stubbed', cancellable: true, physical: true, roles: ['parent', 'child'] },
    { id: 'direct.say', availability: 'live-verified', cancellable: false, physical: false, roles: ['parent', 'child'] },
  ]);
  assert.deepEqual(catalog.list().map((skill) => skill.id), ['direct.say']);
  assert.equal(catalog.list({ includeUnavailable: true }).length, 2);
  assert.equal(catalog.execute('direct.use').code, 'FEATURE_NOT_IMPLEMENTED');
});

test('mode registry exposes every required preset with model escalation off', () => {
  const registry = new ModeRegistry();
  assert.deepEqual(registry.list(), [...BEHAVIOR_MODES]);
  for (const mode of BEHAVIOR_MODES) assert.equal(registry.resolve(mode).modelEscalationEnabled, false);
});

test('role policy gives guests conversation only and binds privileged work to parent approval', () => {
  const policy = new PermissionPolicy();
  assert.equal(policy.authorize({ role: 'guest', capability: 'conversation' }).allowed, true);
  assert.equal(policy.authorize({ role: 'guest', capability: 'physical-task' }).allowed, false);
  assert.equal(policy.authorize({ role: 'child', capability: 'physical-task' }).allowed, true);
  const childPromotion = policy.authorize({ role: 'child', capability: 'mod-promotion' });
  assert.deepEqual([childPromotion.allowed, childPromotion.requiresApproval], [false, true]);
  const parentPromotion = policy.authorize({ role: 'parent', capability: 'mod-promotion' });
  assert.deepEqual([parentPromotion.allowed, parentPromotion.requiresApproval], [true, true]);
});

test('narration policy ignores routine work and enforces a cooldown', () => {
  const policy = new NarrationPolicy({ cooldownMs: 10_000 });
  assert.equal(policy.shouldSpeak('block-broken', 20_000), false);
  assert.equal(policy.shouldSpeak('task-started', 20_000), true);
  assert.equal(policy.shouldSpeak('major-discovery', 25_000), false);
  assert.equal(policy.shouldSpeak('task-completed', 30_000), true);
});

test('approval digests are deterministic, bounded, and expire after creation', () => {
  const options = {
    createdAt: '2026-08-21T12:00:00.000Z',
    expiresAt: '2026-08-21T12:05:00.000Z',
    planId: '01919a62-8e84-7c6b-8eb0-4f79592f3ac3',
  };
  const input = { requestId: IDs.request, operation: 'server.promoteMod', arguments: { projectId: 'safe-mod' } };
  const first = createDigestBoundApproval(input, options);
  const second = createDigestBoundApproval(input, options);
  assert.equal(first.digest, second.digest);
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(first.expiresAt) > Date.parse(first.createdAt));
});

test('profile claims retain provenance and reject reversed observation dates', () => {
  const claim = {
    claimId: IDs.claim,
    playerId: IDs.player,
    category: 'favorite_activity',
    summary: 'Likes building tree houses.',
    status: 'observed',
    confidence: 0.8,
    evidenceInteractionIds: [IDs.evidence],
    firstObservedAt: '2026-08-21T12:00:00.000Z',
    lastObservedAt: '2026-08-21T12:01:00.000Z',
  };
  assert.deepEqual(validateProfileClaim(claim).evidenceInteractionIds, [IDs.evidence]);
  assert.throws(() => validateProfileClaim({
    ...claim,
    lastObservedAt: '2026-08-21T11:59:00.000Z',
  }), BrainContractError);
});

test('fake model and broker are deterministic and contract-validated', async () => {
  const model = new FakeReasoningModel({ converse: { text: 'Fixture response.' } });
  assert.deepEqual(model.converse({ text: 'hello' }), { text: 'Fixture response.' });
  assert.equal(model.calls[0].method, 'converse');

  const broker = new FakeModelBroker(async (request) => ({
    requestId: request.requestId,
    status: 'succeeded',
    output: { text: 'bounded' },
    model: 'fake-v1',
    completedAt: '2026-08-21T12:00:01.000Z',
  }));
  const result = await broker.reason({
    requestId: IDs.request,
    kind: 'converse',
    actor: 'COMPANION',
    playerId: IDs.player,
    input: { text: 'hello' },
    authorizedTools: [],
    deadlineAt: '2026-08-21T12:00:05.000Z',
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(broker.requests.length, 1);
});

test('provider-neutral production broker validates requests but remains disabled', async () => {
  const broker = new MastermindModelBroker({ providers: { fixture: {} } });
  assert.deepEqual(broker.listProviders(), ['fixture']);
  const result = await broker.reason({
    requestId: IDs.request,
    kind: 'converse',
    actor: 'COMPUTER',
    playerId: IDs.player,
    input: { text: 'status' },
    authorizedTools: [],
    deadlineAt: '2026-08-21T12:00:05.000Z',
  });
  assert.equal(result.code, 'FEATURE_DISABLED');
});

test('the complete skeleton starts with every feature flag off', () => {
  const skeleton = createFamilyCompanionSkeleton();
  const status = skeleton.status();
  assert.ok(Object.values(status.flags).every((value) => value === false));
  assert.equal(skeleton.skillCatalog.list().length, 0);
  assert.equal(skeleton.reasoningModel.inspectImage().code, 'FEATURE_NOT_IMPLEMENTED');
});
