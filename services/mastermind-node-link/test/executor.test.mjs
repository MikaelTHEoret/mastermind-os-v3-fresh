import assert from 'node:assert/strict';
import test from 'node:test';

import { FamilyEcosystemEnsureRunningExecutor } from '../src/executor.mjs';
import { MastermindLocalAgentError } from '../src/local-agent-client.mjs';
import { lease, status } from './fixtures.mjs';

function sequenceAgent(statuses, options = {}) {
  let index = 0;
  return {
    ensureCalls: 0,
    companionCalls: 0,
    observeCalls: 0,
    observeOptions: [],
    async observeStatus(observeOptions = {}) {
      this.observeCalls += 1;
      this.observeOptions.push(observeOptions);
      const value = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      options.afterObserve?.(this.observeCalls);
      return structuredClone(value);
    },
    async ensureFamilyServerRunning() {
      this.ensureCalls += 1;
      if (options.ensureError) throw options.ensureError;
      options.afterEnsure?.(this.ensureCalls);
      return { action: 'started' };
    },
    async startCompanion() {
      this.companionCalls += 1;
      if (options.companionError) throw options.companionError;
      options.afterCompanion?.(this.companionCalls);
      return { state: 'starting' };
    },
  };
}

function executor(agent, clock) {
  return new FamilyEcosystemEnsureRunningExecutor({
    localAgent: agent,
    now: () => clock.value,
    delay: async (milliseconds) => { clock.value += milliseconds; },
    pollIntervalMs: 100,
  });
}

test('a companion attention state does not prevent the Family Server from starting', async () => {
  const clock = { value: 1_000 };
  const agent = sequenceAgent([
    status({ familyServer: 'stopped', companion: 'sign-in-required', attentionCodes: ['companion-sign-in-required'] }),
    status({ familyServer: 'running', companion: 'sign-in-required', attentionCodes: ['companion-sign-in-required'] }),
  ]);
  const run = executor(agent, clock);
  await assert.rejects(
    run.execute(lease(), { deadlineMs: 10_000, emit: async () => undefined }),
    (error) => error?.code === 'companion-sign-in-required'
      && error?.result?.familyServer === 'running',
  );
  assert.equal(agent.ensureCalls, 1);
  assert.equal(agent.companionCalls, 0);
  assert.deepEqual(agent.observeOptions.map((value) => value.includeClientStatus), [false, false, undefined]);
});

test('a companion already starting is observed without another start POST', async () => {
  const clock = { value: 1_000 };
  const agent = sequenceAgent([
    status({ familyServer: 'running', companion: 'starting', companionBridge: 'handshaking' }),
    status({ familyServer: 'running', companion: 'starting', companionBridge: 'handshaking' }),
    status({ familyServer: 'running', companion: 'running', companionBridge: 'ready' }),
  ]);
  const result = await executor(agent, clock).execute(lease(), {
    deadlineMs: 10_000,
    emit: async () => undefined,
  });
  assert.deepEqual(result, { familyServer: 'running', companion: 'running', companionBridge: 'ready' });
  assert.equal(agent.ensureCalls, 0);
  assert.equal(agent.companionCalls, 0);
});

test('an ambiguous server POST is reconciled by GET and never reissued', async () => {
  const clock = { value: 1_000 };
  const ambiguous = new MastermindLocalAgentError('CONTROL_AGENT_UNREACHABLE', 'lost response', { retryable: true });
  const agent = sequenceAgent([
    status({ familyServer: 'stopped', companion: 'running', companionBridge: 'ready' }),
    status({
      controlAgent: 'unreachable', recovery: 'unknown', familyServer: 'unknown', companion: 'unknown',
      companionBridge: 'unknown', localKillSwitch: null, attentionCodes: ['control-agent-unreachable'],
    }),
    status({ familyServer: 'running', companion: 'running', companionBridge: 'ready' }),
  ], { ensureError: ambiguous });
  const result = await executor(agent, clock).execute(lease(), {
    deadlineMs: 10_000,
    emit: async () => undefined,
  });
  assert.equal(result.familyServer, 'running');
  assert.equal(agent.ensureCalls, 1);
  assert.equal(agent.observeCalls, 4);
});

test('an ambiguous companion POST is reconciled by GET and never reissued', async () => {
  const clock = { value: 1_000 };
  const ambiguous = new MastermindLocalAgentError('CONTROL_AGENT_UNREACHABLE', 'lost response', { retryable: true });
  const agent = sequenceAgent([
    status({ familyServer: 'running', companion: 'stopped', companionBridge: 'disconnected' }),
    status({ familyServer: 'running', companion: 'stopped', companionBridge: 'disconnected' }),
    status({
      controlAgent: 'unreachable', recovery: 'unknown', familyServer: 'unknown', companion: 'unknown',
      companionBridge: 'unknown', localKillSwitch: null, attentionCodes: ['control-agent-unreachable'],
    }),
    status({ familyServer: 'running', companion: 'running', companionBridge: 'ready' }),
  ], { companionError: ambiguous });
  const result = await executor(agent, clock).execute(lease(), {
    deadlineMs: 10_000,
    emit: async () => undefined,
  });
  assert.equal(result.companionBridge, 'ready');
  assert.equal(agent.companionCalls, 1);
  assert.equal(agent.observeCalls, 4);
});

test('managed recovery rejections retain their authoritative failure code', async (t) => {
  for (const localCode of ['MOD_MANUAL_RECOVERY_REQUIRED', 'WORLD_RECOVERY_REQUIRED', 'UPDATE_RECOVERY_REQUIRED']) {
    await t.test(localCode, async () => {
      const clock = { value: 1_000 };
      const agent = sequenceAgent([status()], {
        ensureError: new MastermindLocalAgentError(localCode, 'manual recovery', { retryable: false }),
      });
      await assert.rejects(
        executor(agent, clock).execute(lease(), { deadlineMs: 10_000, emit: async () => undefined }),
        (error) => error?.code === 'recovery-manual-repair' && error?.retryable === false,
      );
      assert.equal(agent.ensureCalls, 1);
    });
  }
});

test('deadline crossing during observation prevents every later mutation', async () => {
  const clock = { value: 1_000 };
  const agent = sequenceAgent([status()], { afterObserve: () => { clock.value = 2_000; } });
  await assert.rejects(
    executor(agent, clock).execute(lease(), { deadlineMs: 2_000, emit: async () => undefined }),
    (error) => error?.code === 'lease-lost',
  );
  assert.equal(agent.ensureCalls, 0);
  assert.equal(agent.companionCalls, 0);
});

test('deadline is checked at the exact early desired-state success boundary', async () => {
  let clockReads = 0;
  const agent = sequenceAgent([
    status({ familyServer: 'running', companion: 'running', companionBridge: 'ready' }),
  ]);
  const run = new FamilyEcosystemEnsureRunningExecutor({
    localAgent: agent,
    now: () => {
      clockReads += 1;
      return clockReads >= 5 ? 2_000 : 1_000;
    },
    delay: async () => undefined,
    pollIntervalMs: 100,
  });
  await assert.rejects(
    run.execute(lease(), { deadlineMs: 2_000, emit: async () => undefined }),
    (error) => error?.code === 'lease-lost',
  );
  assert.equal(agent.ensureCalls, 0);
  assert.equal(agent.companionCalls, 0);
});

test('a server POST that returns after the deadline cannot produce success or a companion mutation', async () => {
  const clock = { value: 1_000 };
  const agent = sequenceAgent([status()], { afterEnsure: () => { clock.value = 2_000; } });
  await assert.rejects(
    executor(agent, clock).execute(lease(), { deadlineMs: 2_000, emit: async () => undefined }),
    (error) => error?.code === 'lease-lost',
  );
  assert.equal(agent.ensureCalls, 1);
  assert.equal(agent.companionCalls, 0);
});

test('deadline is rechecked after a waiting delay before accepting success', async () => {
  const clock = { value: 1_000 };
  const agent = sequenceAgent([
    status({ familyServer: 'running', companion: 'starting', companionBridge: 'handshaking' }),
    status({ familyServer: 'running', companion: 'starting', companionBridge: 'handshaking' }),
    status({ familyServer: 'running', companion: 'running', companionBridge: 'ready' }),
  ]);
  const run = new FamilyEcosystemEnsureRunningExecutor({
    localAgent: agent,
    now: () => clock.value,
    delay: async () => { clock.value = 2_000; },
    pollIntervalMs: 100,
  });
  await assert.rejects(
    run.execute(lease(), { deadlineMs: 2_000, emit: async () => undefined }),
    (error) => error?.code === 'lease-lost',
  );
  assert.equal(agent.observeCalls, 2);
  assert.equal(agent.companionCalls, 0);
});

test('deadline is rechecked after stage emission immediately before companion POST', async () => {
  const clock = { value: 1_000 };
  const agent = sequenceAgent([
    status({ familyServer: 'running', companion: 'stopped', companionBridge: 'disconnected' }),
  ]);
  await assert.rejects(
    executor(agent, clock).execute(lease(), {
      deadlineMs: 2_000,
      emit: async (stage) => { if (stage === 'starting-companion') clock.value = 2_000; },
    }),
    (error) => error?.code === 'lease-lost',
  );
  assert.equal(agent.companionCalls, 0);
});
