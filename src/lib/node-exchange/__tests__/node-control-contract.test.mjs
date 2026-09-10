import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  HOSTED_NODE_CONTROL_URL,
  LOCAL_NODE_PAIRING_ORIGIN,
  LOCAL_NODE_PAIRING_PATH,
  NODE_CONTROL_TAB_HASH,
  NODE_ENSURE_RUNNING_CAPABILITY,
  NODE_CORE_STATUS_CAPABILITY,
  nodeSupportsCoreStatus,
  NodeControlContractError,
  buildLocalNodePairingHandoffUrl,
  isLocalNodeControlOrigin,
  isTerminalNodeJob,
  parseNodeApiError,
  parseNodeInventory,
  parseNodeJob,
  parseNodeJobEnqueue,
  parseNodePairing,
} from '../../../components/node-control-contract.mjs';

const NODE_ID = '123e4567-e89b-42d3-a456-426614174000';
const JOB_ID = '223e4567-e89b-42d3-a456-426614174000';
const OTHER_JOB_ID = '323e4567-e89b-42d3-a456-426614174000';
const LEASE_ID = '423e4567-e89b-42d3-a456-426614174000';
const PAIRING_ID = '523e4567-e89b-42d3-a456-426614174000';
const NOW = '2026-08-15T12:00:00.000Z';
const LATER = '2026-08-15T12:30:00.000Z';

function status() {
  return {
    observedAt: NOW,
    controlAgent: 'online',
    recovery: 'clear',
    familyServer: 'running',
    companion: 'running',
    companionBridge: 'ready',
    localKillSwitch: false,
    attentionCodes: [],
  };
}

function node(overrides = {}) {
  return {
    nodeId: NODE_ID,
    displayName: 'Family PC',
    state: 'active',
    connectivity: 'online',
    agentVersion: '1.0.0',
    pairedAt: NOW,
    lastExchangeAt: NOW,
    lastJobReceiptAt: null,
    status: status(),
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    jobId: JOB_ID,
    nodeId: NODE_ID,
    capability: NODE_ENSURE_RUNNING_CAPABILITY,
    capabilityVersion: 1,
    policyClass: 'routine',
    state: 'queued',
    createdAt: NOW,
    expiresAt: LATER,
    lease: null,
    terminal: null,
    ...overrides,
  };
}

test('node inventory accepts only the exact redacted public status shape', () => {
  const value = { ok: true, nodes: [node()] };
  assert.deepEqual(parseNodeInventory(value), value);

  const neverSeen = node({ connectivity: 'never-seen', lastExchangeAt: null, status: null });
  assert.equal(parseNodeInventory({ ok: true, nodes: [neverSeen] }).nodes[0].connectivity, 'never-seen');
});

test('node inventory rejects injected fields, duplicate identities, and inconsistent connectivity', () => {
  assert.throws(
    () => parseNodeInventory({ ok: true, nodes: [node({ path: 'C:\\private' })] }),
    NodeControlContractError,
  );
  assert.throws(
    () => parseNodeInventory({ ok: true, nodes: [node(), node()] }),
    NodeControlContractError,
  );
  assert.throws(
    () => parseNodeInventory({ ok: true, nodes: [node({ connectivity: 'offline', lastExchangeAt: null })] }),
    NodeControlContractError,
  );
  assert.throws(
    () => parseNodeInventory({ ok: true, nodes: [node({ status: { ...status(), processId: 1234 } })] }),
    NodeControlContractError,
  );
  assert.throws(
    () => parseNodeInventory({ ok: true, nodes: [node({ status: { ...status(), attentionCodes: ['companion-failed', 'companion-failed'] } })] }),
    NodeControlContractError,
  );
});

test('job parsers bind node, job, capability, and idempotency outcome', () => {
  assert.deepEqual(parseNodeJob({ ok: true, job: job() }, NODE_ID, JOB_ID), { ok: true, job: job() });
  assert.deepEqual(
    parseNodeJobEnqueue({ ok: true, status: 'created', job: job() }, NODE_ID, JOB_ID),
    { ok: true, status: 'created', job: job() },
  );
  const coalesced = job({ jobId: OTHER_JOB_ID });
  assert.deepEqual(
    parseNodeJobEnqueue({ ok: true, status: 'coalesced', job: coalesced }, NODE_ID, JOB_ID),
    { ok: true, status: 'coalesced', job: coalesced },
  );
  assert.throws(
    () => parseNodeJobEnqueue({ ok: true, status: 'created', job: coalesced }, NODE_ID, JOB_ID),
    NodeControlContractError,
  );
  assert.throws(
    () => parseNodeJobEnqueue({ ok: true, status: 'coalesced', job: job() }, NODE_ID, JOB_ID),
    NodeControlContractError,
  );
  assert.throws(
    () => parseNodeJob({ ok: true, job: job({ nodeId: PAIRING_ID }) }, NODE_ID, JOB_ID),
    NodeControlContractError,
  );
  assert.throws(
    () => parseNodeJob({ ok: true, job: job({ state: 'running' }) }, NODE_ID, JOB_ID),
    NodeControlContractError,
  );
  assert.throws(
    () => parseNodeJob({
      ok: true,
      job: job({ lease: { leaseId: LEASE_ID, leasedAt: NOW, leaseExpiresAt: LATER } }),
    }, NODE_ID, JOB_ID),
    NodeControlContractError,
  );
});

test('terminal job semantics are strict and remain redacted', () => {
  const succeeded = job({
    state: 'succeeded',
    lease: { leaseId: LEASE_ID, leasedAt: NOW, leaseExpiresAt: LATER },
    terminal: {
      code: 'desired-state-reached',
      result: { familyServer: 'running', companion: 'running', companionBridge: 'ready' },
      finishedAt: LATER,
    },
  });
  const parsed = parseNodeJob({ ok: true, job: succeeded }, NODE_ID, JOB_ID).job;
  assert.equal(isTerminalNodeJob(parsed), true);
  assert.equal(JSON.stringify(parsed).includes('path'), false);

  assert.throws(
    () => parseNodeJob({ ok: true, job: job({ state: 'succeeded', terminal: null }) }, NODE_ID, JOB_ID),
    NodeControlContractError,
  );
  assert.throws(
    () => parseNodeJob({
      ok: true,
      job: {
        ...succeeded,
        terminal: { ...succeeded.terminal, result: { ...succeeded.terminal.result, account: 'player' } },
      },
    }, NODE_ID, JOB_ID),
    NodeControlContractError,
  );
});

test('pairing is response-bound and the one-click handoff keeps the credential in the fragment only', () => {
  const pairingCredential = `mnp1.${PAIRING_ID}.${'A'.repeat(43)}`;
  const response = { ok: true, pairingId: PAIRING_ID, pairingCredential, expiresAt: LATER };
  assert.deepEqual(parseNodePairing(response), response);

  const handoff = new URL(buildLocalNodePairingHandoffUrl(pairingCredential));
  assert.equal(handoff.origin, LOCAL_NODE_PAIRING_ORIGIN);
  assert.equal(handoff.pathname, LOCAL_NODE_PAIRING_PATH);
  assert.equal(handoff.search, '');
  assert.equal(handoff.hash, `#pairing=${pairingCredential}`);
  assert.equal(handoff.href.slice(0, handoff.href.indexOf('#')).includes(pairingCredential), false);

  assert.throws(
    () => parseNodePairing({ ...response, pairingId: NODE_ID }),
    NodeControlContractError,
  );
});

test('local Nodes control hands off only from the fixed local dashboard origins', () => {
  assert.equal(isLocalNodeControlOrigin('http://127.0.0.1:3000'), true);
  assert.equal(isLocalNodeControlOrigin('http://localhost:3000'), true);
  assert.equal(isLocalNodeControlOrigin('https://mastermind-core.com'), false);
  assert.equal(isLocalNodeControlOrigin('http://127.0.0.1:3001'), false);
  assert.equal(isLocalNodeControlOrigin('http://localhost.example:3000'), false);

  const hosted = new URL(HOSTED_NODE_CONTROL_URL);
  assert.equal(hosted.origin, 'https://mastermind-core.com');
  assert.equal(hosted.pathname, '/');
  assert.equal(hosted.search, '');
  assert.equal(hosted.hash, NODE_CONTROL_TAB_HASH);
});

test('public errors are exact, bounded, and cannot carry hidden diagnostics', () => {
  assert.deepEqual(parseNodeApiError({
    ok: false,
    error: { code: 'NODE_JOB_NOT_FOUND', message: 'The node job was not found.' },
  }), {
    ok: false,
    error: { code: 'NODE_JOB_NOT_FOUND', message: 'The node job was not found.' },
  });
  assert.throws(
    () => parseNodeApiError({
      ok: false,
      error: { code: 'NODE_INTERNAL_ERROR', message: 'failed', stack: 'private' },
    }),
    NodeControlContractError,
  );
  assert.throws(
    () => parseNodeApiError({
      ok: false,
      error: { code: 'NODE_INTERNAL_ERROR', message: 'failed\nC:\\private' },
    }),
    NodeControlContractError,
  );
});

test('hosted Pair this PC is bodyless, duplicate-guarded, and navigates only after strict parsing', async () => {
  const source = await fs.readFile(path.resolve('src/components/NodeControlConsole.tsx'), 'utf8');
  const actionStart = source.indexOf('const pairThisPc = useCallback');
  const actionEnd = source.indexOf('const watchJob = useCallback');
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  const action = source.slice(actionStart, actionEnd);

  assert.match(action, /if \(pairingInFlightRef\.current\) return;/u);
  assert.match(action, /requestJson\(NODE_PAIRINGS_PATH, MAX_PAIRING_BYTES/u);
  assert.doesNotMatch(action, /\bbody\s*:/u);
  const parsed = action.indexOf('parseNodePairing(payload)');
  const built = action.indexOf('buildLocalNodePairingHandoffUrl(pairing.pairingCredential)');
  const navigated = action.indexOf('window.location.assign(handoffUrl)');
  assert.ok(parsed >= 0 && built > parsed && navigated > built);
  assert.doesNotMatch(action, /localStorage|sessionStorage|console\.|window\.open|setPairingCredential/u);
  assert.match(source, /No credential was stored locally; try again\./u);
});

test('the local Nodes surface does not poll owner APIs and links directly to the hosted Nodes tab', async () => {
  const source = await fs.readFile(path.resolve('src/components/NodeControlConsole.tsx'), 'utf8');
  assert.match(source, /setControlSurface\(isLocalNodeControlOrigin\(window\.location\.origin\) \? 'local' : 'hosted'\)/u);
  assert.match(source, /if \(controlSurface !== 'hosted'\) return;/u);
  assert.match(source, /if \(controlSurface === 'local'\)/u);
  assert.match(source, /href=\{HOSTED_NODE_CONTROL_URL\}/u);

  const pageSource = await fs.readFile(path.resolve('src/app/page.tsx'), 'utf8');
  assert.match(pageSource, /window\.location\.hash === NODE_CONTROL_TAB_HASH/u);
});


test('core action requires an explicit compatible worker advertisement; legacy nodes remain parseable', () => {
  assert.equal(nodeSupportsCoreStatus(parseNodeInventory({ ok: true, nodes: [node()] }).nodes[0]), false);
  const compatible = node({ worker: { protocolVersion: 2, capabilities: [{ id: NODE_CORE_STATUS_CAPABILITY, version: 1 }] } });
  assert.equal(nodeSupportsCoreStatus(parseNodeInventory({ ok: true, nodes: [compatible] }).nodes[0]), true);
  assert.equal(nodeSupportsCoreStatus({ ...compatible, state: 'revoked' }), false);
  assert.equal(nodeSupportsCoreStatus(node({ worker: null })), false);
  for (const worker of [
    { protocolVersion: 1, capabilities: [{ id: NODE_CORE_STATUS_CAPABILITY, version: 1 }] },
    { protocolVersion: 2, capabilities: [{ id: NODE_CORE_STATUS_CAPABILITY, version: 2 }] },
    { protocolVersion: 2, capabilities: [{ id: NODE_CORE_STATUS_CAPABILITY, version: 1 }], url: 'https://example.test' },
  ]) assert.throws(() => parseNodeInventory({ ok: true, nodes: [node({ worker })] }), NodeControlContractError);
});

test('core job parsing is explicitly operation-bound and preserves incomplete observations without claiming family readiness', () => {
  const observation = { kind: NODE_CORE_STATUS_CAPABILITY, observedAt: NOW,
    services: { mcpHost: 'online', memory: 'unreachable', modules: 'online' },
    capabilities: { count: 43, sha256: 'a'.repeat(64) }, activeTurns: 0, complete: false };
  const core = job({ capability: NODE_CORE_STATUS_CAPABILITY, state: 'succeeded',
    lease: { leaseId: LEASE_ID, leasedAt: NOW, leaseExpiresAt: LATER },
    terminal: { code: 'desired-state-reached', result: observation, finishedAt: LATER } });
  assert.throws(() => parseNodeJob({ ok: true, job: core }, NODE_ID, JOB_ID), NodeControlContractError);
  assert.deepEqual(parseNodeJob({ ok: true, job: core }, NODE_ID, JOB_ID, NODE_CORE_STATUS_CAPABILITY).job, core);
  assert.equal(parseNodeJobEnqueue({ ok: true, status: 'created', job: core }, NODE_ID, JOB_ID, NODE_CORE_STATUS_CAPABILITY).job.capability, NODE_CORE_STATUS_CAPABILITY);
  assert.throws(() => parseNodeJobEnqueue({ ok: true, status: 'created', job: job() }, NODE_ID, JOB_ID, NODE_CORE_STATUS_CAPABILITY), NodeControlContractError);
  for (const invalid of [
    { ...core, terminal: { ...core.terminal, result: { ...observation, complete: true } } },
    { ...core, terminal: { ...core.terminal, result: { familyServer: 'running', companion: 'running', companionBridge: 'ready' } } },
    { ...core, state: 'failed', terminal: { ...core.terminal, code: 'lease-lost' } },
  ]) assert.throws(() => parseNodeJob({ ok: true, job: invalid }, NODE_ID, JOB_ID, NODE_CORE_STATUS_CAPABILITY), NodeControlContractError);
});

test('saved core status distinguishes no history from invalid or mismatched data', async () => {
  const { parseLatestCoreStatusJob } = await import('../../../components/node-control-contract.mjs');
  assert.deepEqual(parseLatestCoreStatusJob({ ok: true, job: null }, NODE_ID), { ok: true, job: null });
  const saved = job({ capability: NODE_CORE_STATUS_CAPABILITY });
  assert.deepEqual(parseLatestCoreStatusJob({ ok: true, job: saved }, NODE_ID).job, saved);
  for (const value of [{ ok: false, job: null }, { ok: true }, { ok: true, job: null, secret: 'fixture' },
    { ok: true, job: job() }, { ok: true, job: { ...saved, nodeId: OTHER_JOB_ID } },
    { ok: true, job: { ...saved, state: 'succeeded' } }]) {
    assert.throws(() => parseLatestCoreStatusJob(value, NODE_ID));
  }
});
