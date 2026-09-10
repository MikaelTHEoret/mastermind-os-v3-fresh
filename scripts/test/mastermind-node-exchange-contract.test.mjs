import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MASTERMIND_NODE_CAPABILITY,
  MASTERMIND_NODE_CAPABILITY_REGISTRY,
  MASTERMIND_NODE_EXCHANGE_MAX_BYTES,
  MASTERMIND_NODE_MAX_RECEIPTS,
  MASTERMIND_NODE_POLICY_CLASS,
  MASTERMIND_NODE_RECEIPT_MAX_BYTES,
  MASTERMIND_NODE_RESPONSE_MAX_BYTES,
  MASTERMIND_NODE_STATUS_MAX_BYTES,
  MastermindNodeContractError,
  canonicalMastermindNodeCommand,
  canonicalMastermindNodeExchangeRequest,
  canonicalMastermindNodeExchangeResponse,
  canonicalMastermindNodePairRequest,
  canonicalMastermindNodePairResponse,
  canonicalMastermindNodeReceipt,
  digestMastermindNodeCommand,
  digestMastermindNodeCredential,
  digestMastermindNodeReceipt,
  parseMastermindNodeCredential,
  parseMastermindNodePairingCredential,
  validateMastermindNodeCapabilityRegistry,
  validateMastermindNodeCommand,
  validateMastermindNodeExchangeRequest,
  validateMastermindNodeExchangeResponse,
  validateMastermindNodeLease,
  validateMastermindNodePairRequest,
  validateMastermindNodePairResponse,
  validateMastermindNodeReceipt,
  validateMastermindNodeStatus,
} from '../../protocol/mastermind-node-exchange/contract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const protocolRoot = path.resolve(here, '../../protocol/mastermind-node-exchange');
const fixtureRoot = path.join(protocolRoot, 'fixtures');
const KNOWN_COMMAND_DIGEST = '831c162d3acc2504156f4f9929184270c6f1939aad273430537ea6ec416419eb';

async function json(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function fixture(name) {
  return json(path.join(fixtureRoot, name));
}

function contractError(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof MastermindNodeContractError);
    if (code) assert.equal(error.code, code);
    return true;
  });
}

function terminalResult(overrides = {}) {
  return {
    familyServer: 'running',
    companion: 'running',
    companionBridge: 'ready',
    ...overrides,
  };
}

async function acceptedReceipt(overrides = {}) {
  const request = await fixture('exchange-request.valid.json');
  return { ...request.receipts[0], ...overrides };
}

test('frozen capability registry has only status and routine no-PIN ensure-running', async () => {
  const registry = await json(path.join(protocolRoot, 'capabilities.v1.json'));
  assert.deepEqual(registry, MASTERMIND_NODE_CAPABILITY_REGISTRY);
  assert.deepEqual(validateMastermindNodeCapabilityRegistry(registry), registry);
  assert.deepEqual(registry.capabilities.map(({ id, kind, policyClass, hardGate }) => ({
    id, kind, policyClass, hardGate,
  })), [
    { id: 'node.status.read', kind: 'query', policyClass: 'routine', hardGate: false },
    { id: MASTERMIND_NODE_CAPABILITY, kind: 'command', policyClass: MASTERMIND_NODE_POLICY_CLASS, hardGate: false },
  ]);
  contractError(() => validateMastermindNodeCapabilityRegistry({
    ...registry,
    capabilities: [...registry.capabilities, {
      ...registry.capabilities[1], id: 'terminal.execute', kind: 'command',
    }],
  }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeCapabilityRegistry({
    ...registry,
    capabilities: [registry.capabilities[0], { ...registry.capabilities[1], hardGate: true }],
  }), 'NODE_INVALID');
});

test('JSON Schema exposes strict v1 definitions and mirrors the low-friction policy', async () => {
  const schema = await json(path.join(protocolRoot, 'schema.v1.json'));
  assert.match(schema.$schema, /2020-12/);
  assert.equal(schema.$id, 'https://mastermind-core.com/protocol/mastermind-node-exchange/schema.v1.json');
  assert.equal(schema.$defs.exchangeRequest.additionalProperties, false);
  assert.equal(schema.$defs.exchangeResponse.additionalProperties, false);
  assert.equal(schema.$defs.status.additionalProperties, false);
  assert.equal(schema.$defs.command.properties.input.$ref, '#/$defs/emptyInput');
  assert.equal(schema.$defs.ensureRunningCapability.properties.policyClass.const, 'routine');
  assert.equal(schema.$defs.ensureRunningCapability.properties.hardGate.const, false);
  assert.equal(schema.$defs.exchangeRequest.properties.receipts.maxItems, MASTERMIND_NODE_MAX_RECEIPTS);
  assert.match(schema.$comment, /strictly increasing per-job receipt sequences/);
});

test('all published fixtures validate with the runtime contract', async () => {
  const [command, request, response, pairRequest, pairResponse] = await Promise.all([
    fixture('command.valid.json'),
    fixture('exchange-request.valid.json'),
    fixture('exchange-response.valid.json'),
    fixture('pair-request.valid.json'),
    fixture('pair-response.valid.json'),
  ]);
  assert.deepEqual(validateMastermindNodeCommand(command), command);
  assert.deepEqual(validateMastermindNodeExchangeRequest(request), request);
  assert.deepEqual(validateMastermindNodeExchangeResponse(response, {
    expectedExchangeId: request.exchangeId,
    expectedNodeId: request.nodeId,
    expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId),
  }), response);
  assert.deepEqual(validateMastermindNodeLease(response.lease), response.lease);
  assert.deepEqual(validateMastermindNodePairRequest(pairRequest), pairRequest);
  assert.deepEqual(validateMastermindNodePairResponse(pairResponse), pairResponse);
});

test('canonical command encoding and digest are stable across property order', async () => {
  const command = await fixture('command.valid.json');
  const reordered = {
    input: {},
    policyClass: command.policyClass,
    capabilityVersion: command.capabilityVersion,
    capability: command.capability,
    nodeId: command.nodeId,
    jobId: command.jobId,
  };
  assert.equal(canonicalMastermindNodeCommand(command), canonicalMastermindNodeCommand(reordered));
  assert.equal(digestMastermindNodeCommand(command), KNOWN_COMMAND_DIGEST);
  assert.equal(digestMastermindNodeCommand(reordered), KNOWN_COMMAND_DIGEST);
});

test('command capability is closed and cannot carry paths, commands, URLs, or other input', async () => {
  const command = await fixture('command.valid.json');
  contractError(() => validateMastermindNodeCommand({ ...command, input: { executable: 'powershell.exe' } }), 'NODE_UNKNOWN_FIELD');
  contractError(() => validateMastermindNodeCommand({ ...command, path: 'C:\\world' }), 'NODE_UNKNOWN_FIELD');
  contractError(() => validateMastermindNodeCommand({ ...command, capability: 'minecraft.console.execute' }), 'NODE_UNSUPPORTED_CAPABILITY');
  contractError(() => validateMastermindNodeCommand({ ...command, capabilityVersion: 2 }), 'NODE_UNSUPPORTED_CAPABILITY');
  contractError(() => validateMastermindNodeCommand({ ...command, policyClass: 'local-admin' }), 'NODE_UNSUPPORTED_CAPABILITY');
  contractError(() => validateMastermindNodeCommand({
    ...command, jobId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  }), 'NODE_INVALID');
});

test('redacted status supports unknown first-boot state and rejects information-bearing fields', async () => {
  const request = await fixture('exchange-request.valid.json');
  const firstBoot = {
    observedAt: request.status.observedAt,
    controlAgent: 'unreachable',
    recovery: 'unknown',
    familyServer: 'unknown',
    companion: 'unknown',
    companionBridge: 'unknown',
    localKillSwitch: null,
    attentionCodes: ['control-agent-unreachable'],
  };
  assert.deepEqual(validateMastermindNodeStatus(firstBoot), firstBoot);
  for (const [field, value] of [
    ['pid', 1234],
    ['path', 'C:\\private'],
    ['ipAddress', '192.168.0.2'],
    ['profileName', 'child'],
    ['snapshot', { player: [1, 2, 3] }],
    ['token', 'secret'],
    ['log', 'raw error'],
  ]) {
    contractError(() => validateMastermindNodeStatus({ ...firstBoot, [field]: value }), 'NODE_UNKNOWN_FIELD');
  }
  contractError(() => validateMastermindNodeStatus({ ...firstBoot, attentionCodes: ['made-up-code'] }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeStatus({
    ...firstBoot, attentionCodes: ['control-agent-unreachable', 'control-agent-unreachable'],
  }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeStatus({ ...firstBoot, observedAt: '2026-08-15T12:01:04Z' }), 'NODE_INVALID');
});

test('receipt state machine accepts exact monotonic shapes and produces stable digests', async () => {
  const accepted = await acceptedReceipt();
  const running = {
    ...accepted,
    receiptId: '77777777-7777-4777-8777-777777777777',
    sequence: 2,
    state: 'running',
    stage: 'starting-family-server',
    observedAt: '2026-08-15T12:01:04.000Z',
    code: 'in-progress',
  };
  const succeeded = {
    ...accepted,
    receiptId: '88888888-8888-4888-8888-888888888888',
    sequence: 3,
    state: 'succeeded',
    stage: 'desired-state-reached',
    observedAt: '2026-08-15T12:02:00.000Z',
    code: 'desired-state-reached',
    result: terminalResult(),
  };
  const failed = {
    ...accepted,
    receiptId: '99999999-9999-4999-8999-999999999999',
    sequence: 3,
    state: 'failed',
    stage: 'terminal',
    observedAt: '2026-08-15T12:02:00.000Z',
    code: 'companion-sign-in-required',
    retryable: true,
    result: terminalResult({ companion: 'sign-in-required', companionBridge: 'disconnected' }),
  };
  for (const receipt of [accepted, running, succeeded, failed]) {
    assert.deepEqual(validateMastermindNodeReceipt(receipt), receipt);
    assert.match(digestMastermindNodeReceipt(receipt), /^[a-f0-9]{64}$/);
    assert.equal(canonicalMastermindNodeReceipt(receipt), canonicalMastermindNodeReceipt({ ...receipt }));
  }
  assert.notEqual(digestMastermindNodeReceipt(accepted), digestMastermindNodeReceipt(running));
});

test('receipt state machine rejects ambiguous or misleading outcomes', async () => {
  const accepted = await acceptedReceipt();
  contractError(() => validateMastermindNodeReceipt({ ...accepted, retryable: true }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeReceipt({ ...accepted, stage: 'starting-family-server' }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeReceipt({ ...accepted, code: 'raw local exception text' }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeReceipt({
    ...accepted,
    state: 'running',
    stage: 'waiting-family-server',
    code: 'in-progress',
    result: terminalResult(),
  }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeReceipt({
    ...accepted,
    state: 'succeeded',
    stage: 'desired-state-reached',
    code: 'desired-state-reached',
    result: terminalResult({ companionBridge: 'syncing' }),
  }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeReceipt({
    ...accepted,
    state: 'failed',
    stage: 'terminal',
    code: 'arbitrary-error-message',
    retryable: true,
  }), 'NODE_INVALID');
});

test('exchange request replays durable prior-boot receipts and deduplicates IDs and sequences', async () => {
  const request = await fixture('exchange-request.valid.json');
  assert.deepEqual(validateMastermindNodeExchangeRequest(request), request);
  contractError(() => validateMastermindNodeExchangeRequest({ ...request, debug: true }), 'NODE_UNKNOWN_FIELD');
  contractError(() => validateMastermindNodeExchangeRequest({ ...request, schemaVersion: 2 }), 'NODE_UNSUPPORTED_VERSION');
  const priorBootReplay = validateMastermindNodeExchangeRequest({
    ...request,
    receipts: [{ ...request.receipts[0], bootId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
  });
  assert.equal(priorBootReplay.bootId, request.bootId);
  assert.equal(priorBootReplay.receipts[0].bootId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  contractError(() => validateMastermindNodeExchangeRequest({
    ...request,
    receipts: [request.receipts[0], request.receipts[0]],
  }), 'NODE_INVALID');
  const sequenceTwo = {
    ...request.receipts[0],
    receiptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sequence: 2,
    state: 'running',
    stage: 'checking-local-state',
    code: 'in-progress',
  };
  const sequenceOneAgain = {
    ...request.receipts[0],
    receiptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  };
  contractError(() => validateMastermindNodeExchangeRequest({
    ...request,
    receipts: [sequenceTwo, sequenceOneAgain],
  }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeExchangeRequest({
    ...request,
    receipts: Array.from({ length: MASTERMIND_NODE_MAX_RECEIPTS + 1 }, () => request.receipts[0]),
  }), 'NODE_INVALID');
});

test('lease is bound to its canonical command digest and a valid time interval', async () => {
  const response = await fixture('exchange-response.valid.json');
  const lease = response.lease;
  assert.deepEqual(validateMastermindNodeLease(lease), lease);
  contractError(() => validateMastermindNodeLease({ ...lease, commandDigest: '0'.repeat(64) }), 'NODE_DIGEST_MISMATCH');
  contractError(() => validateMastermindNodeLease({ ...lease, input: { url: 'https://example.invalid' } }), 'NODE_UNKNOWN_FIELD');
  contractError(() => validateMastermindNodeLease({ ...lease, leaseExpiresAt: lease.leasedAt }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeLease({ ...lease, leasedAt: lease.expiresAt }), 'NODE_INVALID');
});

test('exchange response is bound to request/node, has one lease, and acknowledges unique receipts', async () => {
  const [request, response] = await Promise.all([
    fixture('exchange-request.valid.json'), fixture('exchange-response.valid.json'),
  ]);
  assert.deepEqual(validateMastermindNodeExchangeResponse(response, {
    expectedExchangeId: request.exchangeId,
    expectedNodeId: request.nodeId,
    expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId),
  }), response);
  assert.deepEqual(validateMastermindNodeExchangeResponse({ ...response, lease: null }, {
    expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId),
  }).lease, null);
  contractError(() => validateMastermindNodeExchangeResponse(response, {
    expectedExchangeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId),
  }), 'NODE_SCOPE_MISMATCH');
  contractError(() => validateMastermindNodeExchangeResponse(response, {
    expectedNodeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId),
  }), 'NODE_SCOPE_MISMATCH');
  contractError(() => validateMastermindNodeExchangeResponse(response), 'NODE_EXPECTATION_REQUIRED');
  contractError(() => validateMastermindNodeExchangeResponse(response, {
    expectedReceiptIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
  }), 'NODE_SCOPE_MISMATCH');
  assert.deepEqual(validateMastermindNodeExchangeResponse({
    ...response,
    acknowledgedReceiptIds: [],
  }, {
    expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId),
  }).acknowledgedReceiptIds, []);
  contractError(() => validateMastermindNodeExchangeResponse({
    ...response,
    acknowledgedReceiptIds: [response.acknowledgedReceiptIds[0], response.acknowledgedReceiptIds[0]],
  }, { expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId) }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeExchangeResponse({ ...response, nextPollAfterMs: 999 }, {
    expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId),
  }), 'NODE_INVALID');
  contractError(() => validateMastermindNodeExchangeResponse({
    ...response,
    serverTime: response.lease.leaseExpiresAt,
  }, { expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId) }), 'NODE_INVALID');
});

test('pairing is effect-once with a locally retained generated credential', async () => {
  const [request, response] = await Promise.all([
    fixture('pair-request.valid.json'), fixture('pair-response.valid.json'),
  ]);
  const localCredential = `mn1.${request.node.nodeId}.${'A'.repeat(43)}`;
  assert.deepEqual(validateMastermindNodePairRequest(request), request);
  assert.equal(digestMastermindNodeCredential(localCredential), request.node.credentialSha256);
  assert.deepEqual(validateMastermindNodePairResponse(response, {
    expectedNodeId: request.node.nodeId,
  }), response);
  assert.deepEqual(parseMastermindNodeCredential(localCredential), {
    nodeId: request.node.nodeId,
    secret: 'A'.repeat(43),
  });
  assert.deepEqual(parseMastermindNodePairingCredential(
    `mnp1.${request.pairingId}.${'B'.repeat(43)}`,
  ), { pairingId: request.pairingId, secret: 'B'.repeat(43) });
  contractError(() => validateMastermindNodePairRequest({
    ...request, node: { ...request.node, displayName: ' Family Laptop' },
  }), 'NODE_INVALID');
  contractError(() => validateMastermindNodePairRequest({
    ...request, node: { ...request.node, credentialSha256: '0'.repeat(63) },
  }), 'NODE_INVALID');
  contractError(() => validateMastermindNodePairResponse({
    ...response, nodeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }, { expectedNodeId: request.node.nodeId }), 'NODE_SCOPE_MISMATCH');
  contractError(() => validateMastermindNodePairResponse({
    ...response, credential: localCredential,
  }), 'NODE_UNKNOWN_FIELD');
  contractError(() => parseMastermindNodeCredential('mn1.not-a-uuid.short'), 'NODE_INVALID_CREDENTIAL');
  contractError(() => parseMastermindNodePairingCredential(
    `mn1.${request.pairingId}.${'B'.repeat(43)}`,
  ), 'NODE_INVALID_CREDENTIAL');
});

test('canonicalizers return stable wire data and validators do not mutate caller values', async () => {
  const [request, response, pairRequest, pairResponse] = await Promise.all([
    fixture('exchange-request.valid.json'),
    fixture('exchange-response.valid.json'),
    fixture('pair-request.valid.json'),
    fixture('pair-response.valid.json'),
  ]);
  const originals = [request, response, pairRequest, pairResponse].map((value) => structuredClone(value));
  const encoded = [
    canonicalMastermindNodeExchangeRequest(request),
    canonicalMastermindNodeExchangeResponse(response, {
      expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId),
    }),
    canonicalMastermindNodePairRequest(pairRequest),
    canonicalMastermindNodePairResponse(pairResponse),
  ];
  assert.ok(encoded.every((value) => typeof value === 'string' && value.startsWith('{')));
  assert.deepEqual([request, response, pairRequest, pairResponse], originals);
});

test('runtime byte budgets are explicit and tighter for redacted subdocuments', () => {
  assert.equal(MASTERMIND_NODE_EXCHANGE_MAX_BYTES, 64 * 1024);
  assert.equal(MASTERMIND_NODE_RESPONSE_MAX_BYTES, 32 * 1024);
  assert.equal(MASTERMIND_NODE_STATUS_MAX_BYTES, 8 * 1024);
  assert.equal(MASTERMIND_NODE_RECEIPT_MAX_BYTES, 2 * 1024);
  assert.ok(MASTERMIND_NODE_RECEIPT_MAX_BYTES < MASTERMIND_NODE_STATUS_MAX_BYTES);
  assert.ok(MASTERMIND_NODE_STATUS_MAX_BYTES < MASTERMIND_NODE_EXCHANGE_MAX_BYTES);
});
