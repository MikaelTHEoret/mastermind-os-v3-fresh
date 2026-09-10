import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Ajv from 'ajv';
import * as v1 from '../../../protocol/mastermind-node-exchange/contract.mjs';
import * as v2 from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import { MastermindCoreStatusClient, NegotiatedCoreExecutor, CORE_STATUS_ENDPOINTS } from '../src/core-status-client.mjs';
import { MastermindNodeLink } from '../src/node-link.mjs';
import { MastermindNodeExecutionError } from '../src/executor.mjs';
import { FileMastermindNodeEffectJournal } from '../src/effect-journal.mjs';
import { command, lease, status, NODE_ID, BOOT_ID, EXCHANGE_ID, NODE_CREDENTIAL, uuidSequence } from './fixtures.mjs';

const observedAt = '2026-08-15T04:00:02.000Z';
const snapshot = () => ({ kind: v2.CORE_STATUS_CAPABILITY, observedAt,
  services: { mcpHost: 'online', memory: 'online', modules: 'online' },
  capabilities: { count: 1, sha256: 'a'.repeat(64) }, activeTurns: 0, complete: true });
function coreLease() {
  const value = command({ capability: v2.CORE_STATUS_CAPABILITY });
  return lease({ ...value, commandDigest: v2.digestMastermindNodeCommand(value) });
}
function payloads() {
  return {
    [CORE_STATUS_ENDPOINTS.mcpHost]: { ok: true, service: 'mcp_host', activeTurns: 0, secretFixture: 'never-emit' },
    [CORE_STATUS_ENDPOINTS.memory]: { ok: true, retrieval_backend: 'canonical_pgvector', canonical: { available: true } },
    [CORE_STATUS_ENDPOINTS.modules]: { ok: true, service: 'module_core' },
    [CORE_STATUS_ENDPOINTS.catalog]: { ok: true, tools: [{ name: 'recall', server: 'memory', description: 'never-emit' }] },
  };
}

test('published v2 schema common-keyword subset accepts core shapes while v1 rejects them', async () => {
  const legacy = JSON.parse(await fs.readFile(new URL('../../../protocol/mastermind-node-exchange/schema.v1.json', import.meta.url)));
  const modern = JSON.parse(await fs.readFile(new URL('../../../protocol/mastermind-node-exchange/schema.v2.json', import.meta.url)));
  // The existing dependency is AJV6. These documents use only shared validation
  // keywords; use its supported meta-schema without claiming a2020-12 engine.
  legacy.$schema = modern.$schema = 'http://json-schema.org/draft-07/schema#';
  const ajv = new Ajv({ schemaId: 'auto' });
  const oldSchema = ajv.compile(legacy); const newSchema = ajv.compile(modern);
  const value = command({ capability: v2.CORE_STATUS_CAPABILITY });
  assert.equal(oldSchema(value), false); assert.equal(newSchema(value), true);
  assert.equal(newSchema(snapshot()), true);
  assert.equal(newSchema({ ...value, input: { command: 'arbitrary' } }), false);
  assert.equal(newSchema({ ...snapshot(), extra: 'not allowed' }), false);
  const registry = JSON.parse(await fs.readFile(new URL('../../../protocol/mastermind-node-exchange/capabilities.v2.json', import.meta.url)));
  assert.equal(registry.schemaVersion, 2);
  assert.equal(registry.capabilities.filter((item) => item.id === v2.CORE_STATUS_CAPABILITY && item.version === 1 && item.kind === 'query').length, 1);
});

test('v1 remains closed; core requires explicit v2 and exact capability version/empty input', () => {
  assert.throws(() => v1.validateMastermindNodeCommand(command({ capability: v2.CORE_STATUS_CAPABILITY })));
  assert.equal(v2.validateMastermindNodeLease(coreLease()).capability, v2.CORE_STATUS_CAPABILITY);
  for (const change of [{ capabilityVersion: 2 }, { input: { url: 'https://example.test' } }, { capability: 'shell.exec' }]) {
    assert.throws(() => v2.validateMastermindNodeCommand({ ...command({ capability: v2.CORE_STATUS_CAPABILITY }), ...change }));
  }
  assert.throws(() => v1.validateMastermindNodeWorker({ protocolVersion: 2, capabilities: [{ id: v2.CORE_STATUS_CAPABILITY, version: 2 }] }));
});

test('v2 response must echo negotiated worker and cannot lease an undeclared operation', () => {
  const worker = { protocolVersion: 2, capabilities: [{ id: v1.MASTERMIND_NODE_CAPABILITY, version: 1 }] };
  const response = { schemaVersion: 2, exchangeId: EXCHANGE_ID, serverTime: observedAt,
    nextPollAfterMs: 5000, acknowledgedReceiptIds: [], acceptedWorker: worker, lease: coreLease() };
  assert.throws(() => v1.validateMastermindNodeExchangeResponse(response, { core: true, expectedWorker: worker, expectedReceiptIds: [] }), /not negotiated/);
  assert.throws(() => v1.validateMastermindNodeExchangeResponse({ ...response, lease: null }, { core: true, expectedWorker: v2.CORE_WORKER }), /negotiation differs/);
  assert.throws(() => v1.validateMastermindNodeExchangeResponse(response), /unsupported field/);
});

test('core status reads only four fixed GET endpoints and emits bounded facts without raw catalog/secret text', async () => {
  const calls = []; const values = payloads();
  const client = new MastermindCoreStatusClient({ now: () => Date.parse(observedAt), fetchImpl: async (url, options) => {
    calls.push([url, options.method, options.redirect, Object.keys(options.headers)]);
    return Response.json(values[url]);
  } });
  const result = await client.observeStatus();
  assert.equal(result.complete, true); assert.equal(result.capabilities.count, 1);
  assert.equal(calls.length, 4);
  assert(calls.every(([url, method, redirect, headers]) => Object.values(CORE_STATUS_ENDPOINTS).includes(url)
    && method === 'GET' && redirect === 'error' && headers.join() === 'accept'));
  assert(!JSON.stringify(result).includes('never-emit'));
  assert(Buffer.byteLength(JSON.stringify(result)) < 1024);
});

test('offline/invalid health and duplicate catalogs remain explicit incomplete observations', async () => {
  const values = payloads(); values[CORE_STATUS_ENDPOINTS.modules] = { ok: true, service: 'other' };
  values[CORE_STATUS_ENDPOINTS.catalog].tools.push(values[CORE_STATUS_ENDPOINTS.catalog].tools[0]);
  const client = new MastermindCoreStatusClient({ fetchImpl: async (url) => {
    if (url === CORE_STATUS_ENDPOINTS.memory) throw new Error('disposable connection failure');
    return Response.json(values[url]);
  } });
  const result = await client.observeStatus();
  assert.equal(result.services.memory, 'unreachable'); assert.equal(result.services.modules, 'invalid');
  assert.equal(result.capabilities.count, null); assert.equal(result.complete, false);
  assert.throws(() => v1.validateMastermindCoreStatus({ ...result, complete: true }));
});

test('oversized chunked local response is cancelled before retaining excess data', async () => {
  let cancelled = 0;
  const client = new MastermindCoreStatusClient({ fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); },
    cancel() { cancelled += 1; },
  })) });
  const result = await client.observeStatus();
  assert.equal(cancelled, 4); assert.equal(result.complete, false);
  assert.equal(result.services.mcpHost, 'invalid');
});

test('expired core lease never observes or invokes a family action', async () => {
  let reads = 0; let family = 0;
  const executor = new NegotiatedCoreExecutor({ now: () => 100, family: { async execute() { family++; } },
    core: { async observeStatus() { reads++; return snapshot(); } } });
  await assert.rejects(executor.execute(coreLease(), { deadlineMs: 100, emit: async () => {} }), /lease has expired/);
  assert.equal(reads, 0); assert.equal(family, 0);
});

test('a reconnect replays the same completed core observation without performing another read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-core-exchange-'));
  try {
    let reads = 0; let exchanges = 0;
    const journal = new FileMastermindNodeEffectJournal(root);
    const paired = { schemaVersion: 1, state: 'paired', nodeId: NODE_ID, nodeCredential: NODE_CREDENTIAL,
      pairingId: '22222222-2222-4222-8222-222222222222', pairingCredential: null,
      displayName: 'Fixture', createdAt: '2026-08-15T04:00:00.000Z', pairedAt: observedAt };
    const link = new MastermindNodeLink({ credentialStore: { async load() { return paired; } }, journal,
      statusProvider: { async observeStatus() { return status(); } }, worker: v2.CORE_WORKER,
      bootId: BOOT_ID, now: () => Date.parse(observedAt), monotonicNow: () => 1, randomUUID: uuidSequence(100),
      executor: new NegotiatedCoreExecutor({ now: () => 1, family: { async execute() { throw new Error('family must not run'); } },
        core: { async observeStatus() { reads++; return snapshot(); } } }),
      exchangeTransport: { async pair() { throw new Error('not pairing'); }, async exchange(request) {
        exchanges++; assert.equal(request.schemaVersion, 2);
        v1.validateMastermindNodeExchangeRequest(request, { core: true });
        return { schemaVersion: 2, exchangeId: request.exchangeId, serverTime: observedAt,
          nextPollAfterMs: 5000, acceptedWorker: v2.CORE_WORKER,
          acknowledgedReceiptIds: request.receipts.map((r) => r.receiptId), lease: coreLease() };
      } } });
    const first = await link.runOnce(); const second = await link.runOnce();
    assert.equal(first.execution.replayed, false); assert.equal(second.execution.replayed, true);
    assert.equal(reads, 1); assert.equal(exchanges, 2);
    assert.deepEqual(second.execution.receipt.result, snapshot());
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a failed core operation never journals a family terminal result supplied by an executor error', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-core-failure-'));
  try {
    const journal = new FileMastermindNodeEffectJournal(root);
    const paired = { schemaVersion: 1, state: 'paired', nodeId: NODE_ID, nodeCredential: NODE_CREDENTIAL,
      pairingId: '22222222-2222-4222-8222-222222222222', pairingCredential: null,
      displayName: 'Fixture', createdAt: '2026-08-15T04:00:00.000Z', pairedAt: observedAt };
    const link = new MastermindNodeLink({ credentialStore: { async load() { return paired; } }, journal,
      statusProvider: { async observeStatus() { return status(); } }, worker: v2.CORE_WORKER,
      bootId: BOOT_ID, now: () => Date.parse(observedAt), monotonicNow: () => 1, randomUUID: uuidSequence(200),
      executor: { async execute() { throw new MastermindNodeExecutionError('local-response-invalid', 'Disposable failure', {
        retryable: false, result: { familyServer: 'running', companion: 'running', companionBridge: 'ready' },
      }); } },
      exchangeTransport: { async pair() { throw new Error('not pairing'); }, async exchange(request) {
        return { schemaVersion: 2, exchangeId: request.exchangeId, serverTime: observedAt,
          nextPollAfterMs: 5000, acceptedWorker: v2.CORE_WORKER,
          acknowledgedReceiptIds: request.receipts.map((r) => r.receiptId), lease: coreLease() };
      } } });
    const first = await link.runOnce();
    assert.equal(first.execution.receipt.state, 'failed'); assert.equal(first.execution.receipt.result, null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
