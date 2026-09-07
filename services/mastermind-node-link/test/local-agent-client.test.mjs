import assert from 'node:assert/strict';
import test from 'node:test';

import { FamilyEcosystemEnsureRunningExecutor } from '../src/executor.mjs';
import { MastermindLocalAgentClient } from '../src/local-agent-client.mjs';
import { lease } from './fixtures.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function partialCompanionFixture(failedPath) {
  let familyRunning = false;
  let serverPosts = 0;
  let companionPosts = 0;
  let clientReads = 0;
  const fetchImpl = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/v1/client/status') clientReads += 1;
    if (pathname === '/v1/overview') {
      return json({
        ok: true,
        overview: {
          backupRecovery: { manualRecoveryRequired: 0, globalRecoveryRequired: 0 },
          updateRecovery: { manualRecoveryRequired: 0 },
          worldRecovery: { manualRecoveryRequired: 0 },
        },
      });
    }
    if (pathname === '/v1/instances') {
      return json({
        ok: true,
        instances: [{ id: 'family-server', status: familyRunning ? 'running' : 'stopped' }],
      });
    }
    if (pathname === failedPath) {
      return json({ ok: false, code: 'LOCAL_STATUS_FAILED' }, 503);
    }
    if (pathname === '/v1/companion/status') {
      return json({
        ok: true,
        companion: {
          lifecycle: { state: 'stopped' },
          // Even a successful bridge read cannot be promoted to ready while a
          // required companion/account read is unavailable.
          bridge: { state: 'ready', killSwitch: false },
        },
      });
    }
    if (pathname === '/v1/client/status') return json({ ok: true, client: { installed: true } });
    if (pathname === '/v1/account') return json({ ok: true, account: { signedIn: true } });
    if (pathname === '/v1/instances/family-server/ensure-running' && options.method === 'POST') {
      serverPosts += 1;
      familyRunning = true;
      return json({
        ok: true,
        action: 'started',
        instance: { id: 'family-server', status: 'running' },
      });
    }
    if (pathname === '/v1/companion/start' && options.method === 'POST') {
      companionPosts += 1;
      return json({ ok: true, companion: { lifecycle: { state: 'starting' } } });
    }
    throw new Error(`unexpected local path ${pathname}`);
  };
  return {
    fetchImpl,
    counts: () => ({ serverPosts, companionPosts }),
    clientReads: () => clientReads,
  };
}

test('heartbeat status omits full managed-client verification while action status remains authoritative', async () => {
  const fixture = partialCompanionFixture(null);
  const localAgent = new MastermindLocalAgentClient({
    token: 'local-node-test-token-0123456789abcdef',
    fetchImpl: fixture.fetchImpl,
    now: () => Date.parse('2026-08-15T04:00:02.000Z'),
  });

  const heartbeat = await localAgent.observeStatus({ includeClientStatus: false });
  assert.equal(heartbeat.controlAgent, 'online');
  assert.equal(heartbeat.familyServer, 'stopped');
  assert.equal(heartbeat.companion, 'stopped');
  assert.deepEqual(heartbeat.attentionCodes, []);
  assert.equal(fixture.clientReads(), 0);

  const authoritative = await localAgent.observeStatus();
  assert.equal(authoritative.companion, 'stopped');
  assert.equal(fixture.clientReads(), 1);
});

for (const failedPath of ['/v1/companion/status', '/v1/client/status', '/v1/account']) {
  test(`partial ${failedPath} failure preserves server authority and blocks only companion mutation`, async () => {
    const fixture = partialCompanionFixture(failedPath);
    let clock = 1_000;
    const localAgent = new MastermindLocalAgentClient({
      token: 'local-node-test-token-0123456789abcdef',
      fetchImpl: fixture.fetchImpl,
      now: () => Date.parse('2026-08-15T04:00:02.000Z'),
    });
    const partial = await localAgent.observeStatus();
    assert.equal(partial.controlAgent, 'online');
    assert.equal(partial.recovery, 'clear');
    assert.equal(partial.familyServer, 'stopped');
    assert.equal(partial.companion, 'unknown');
    assert.equal(partial.companionBridge, 'unknown');
    assert.equal(partial.localKillSwitch, null);
    assert.deepEqual(partial.attentionCodes, ['local-response-invalid']);

    const executor = new FamilyEcosystemEnsureRunningExecutor({
      localAgent,
      now: () => clock,
      delay: async (milliseconds) => { clock += milliseconds; },
      pollIntervalMs: 100,
    });
    await assert.rejects(
      executor.execute(lease(), { deadlineMs: 10_000, emit: async () => undefined }),
      (error) => error?.code === 'local-response-invalid'
        && error?.result?.familyServer === 'running'
        && error?.result?.companion === 'unknown',
    );
    assert.deepEqual(fixture.counts(), { serverPosts: 1, companionPosts: 0 });
  });
}
