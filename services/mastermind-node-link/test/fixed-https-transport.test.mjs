import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { digestMastermindNodeCredential } from '../../../protocol/mastermind-node-exchange/contract.mjs';
import {
  MASTERMIND_CORE_NODE_EXCHANGE_PATH,
  MASTERMIND_CORE_NODE_PAIR_PATH,
  MastermindCoreNodeFixedHttpsTransport,
} from '../src/fixed-https-transport.mjs';
import {
  BOOT_ID,
  EXCHANGE_ID,
  NODE_CREDENTIAL,
  NODE_ID,
  PAIRING_CREDENTIAL,
  PAIRING_ID,
  status,
} from './fixtures.mjs';

function credentialRecord(state) {
  return {
    schemaVersion: 1,
    state,
    nodeId: NODE_ID,
    nodeCredential: NODE_CREDENTIAL,
    pairingId: PAIRING_ID,
    pairingCredential: state === 'pending' ? PAIRING_CREDENTIAL : null,
    displayName: 'Family Laptop',
    createdAt: '2026-08-15T04:00:00.000Z',
    pairedAt: state === 'paired' ? '2026-08-15T04:00:01.000Z' : null,
  };
}

function responseBody(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function requestHarness(reply) {
  const calls = [];
  const requestImpl = (options, callback) => {
    const request = new EventEmitter();
    request.destroyed = false;
    request.destroy = (error) => {
      request.destroyed = true;
      queueMicrotask(() => request.emit('error', error ?? new Error('destroyed')));
    };
    request.end = (body) => {
      calls.push({ options: structuredClone(options), body: Buffer.from(body) });
      queueMicrotask(() => {
        const spec = typeof reply === 'function' ? reply(options, body) : reply;
        const incoming = new PassThrough();
        incoming.statusCode = spec.statusCode ?? 200;
        incoming.headers = spec.headers ?? {
          'content-type': 'application/json',
          'content-length': String(spec.body.length),
        };
        incoming.rawHeaders = spec.rawHeaders ?? Object.entries(incoming.headers).flatMap(([key, value]) => [key, value]);
        callback(incoming);
        if (spec.hang !== true) incoming.end(spec.body);
        else if (spec.body.length > 0) incoming.write(spec.body);
      });
    };
    return request;
  };
  return { calls, requestImpl };
}

function pairRequest() {
  return {
    schemaVersion: 1,
    pairingId: PAIRING_ID,
    node: {
      nodeId: NODE_ID,
      credentialSha256: digestMastermindNodeCredential(NODE_CREDENTIAL),
      displayName: 'Family Laptop',
      agentVersion: '0.1.0',
    },
  };
}

function exchangeRequest() {
  return {
    schemaVersion: 1,
    exchangeId: EXCHANGE_ID,
    nodeId: NODE_ID,
    bootId: BOOT_ID,
    sentAt: '2026-08-15T04:00:02.000Z',
    agentVersion: '0.1.0',
    status: status(),
    receipts: [],
  };
}

test('fixed pair transport sends only the one-time bearer and digest claim to the pinned HTTPS route', async () => {
  const body = responseBody({
    schemaVersion: 1,
    nodeId: NODE_ID,
    pairedAt: '2026-08-15T04:00:03.000Z',
    nextPollAfterMs: 5_000,
  });
  const harness = requestHarness({ body });
  const transport = new MastermindCoreNodeFixedHttpsTransport({
    credentialStore: { async load() { return credentialRecord('pending'); } },
    requestImpl: harness.requestImpl,
  });
  const result = await transport.pair(pairRequest());
  assert.equal(result.nodeId, NODE_ID);
  assert.equal(harness.calls.length, 1);
  const call = harness.calls[0];
  assert.equal(call.options.protocol, 'https:');
  assert.equal(call.options.hostname, 'mastermind-core.com');
  assert.equal(call.options.servername, 'mastermind-core.com');
  assert.equal(call.options.port, 443);
  assert.equal(call.options.path, MASTERMIND_CORE_NODE_PAIR_PATH);
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.rejectUnauthorized, true);
  assert.equal(call.options.minVersion, 'TLSv1.2');
  assert.deepEqual(Object.keys(call.options.headers).sort(), [
    'Accept', 'Authorization', 'Content-Length', 'Content-Type',
  ]);
  assert.equal(call.options.headers.Authorization, `Bearer ${PAIRING_CREDENTIAL}`);
  const sent = call.body.toString('utf8');
  assert.equal(sent.includes(PAIRING_CREDENTIAL), false);
  assert.equal(sent.includes(NODE_CREDENTIAL), false);
  assert.equal(sent.includes(digestMastermindNodeCredential(NODE_CREDENTIAL)), true);
});

test('fixed exchange transport uses only the paired bearer and strict redacted exchange body', async () => {
  const body = responseBody({
    schemaVersion: 1,
    exchangeId: EXCHANGE_ID,
    serverTime: '2026-08-15T04:00:03.000Z',
    nextPollAfterMs: 5_000,
    acknowledgedReceiptIds: [],
    lease: null,
  });
  const harness = requestHarness({ body });
  const transport = new MastermindCoreNodeFixedHttpsTransport({
    credentialStore: { async load() { return credentialRecord('paired'); } },
    requestImpl: harness.requestImpl,
  });
  const result = await transport.exchange(exchangeRequest());
  assert.equal(result.exchangeId, EXCHANGE_ID);
  const call = harness.calls[0];
  assert.equal(call.options.path, MASTERMIND_CORE_NODE_EXCHANGE_PATH);
  assert.equal(call.options.headers.Authorization, `Bearer ${NODE_CREDENTIAL}`);
  const sent = call.body.toString('utf8');
  assert.equal(sent.includes(NODE_CREDENTIAL), false);
  assert.equal(sent.includes(PAIRING_CREDENTIAL), false);
  assert.equal(sent.includes('familyServer'), true);
});

test('credential state and scope mismatches make zero HTTPS requests', async () => {
  const harness = requestHarness({ body: responseBody({}) });
  const transport = new MastermindCoreNodeFixedHttpsTransport({
    credentialStore: { async load() { return credentialRecord('paired'); } },
    requestImpl: harness.requestImpl,
  });
  await assert.rejects(transport.pair(pairRequest()), (error) => error?.code === 'NODE_TRANSPORT_REQUEST_INVALID');
  await assert.rejects(
    transport.exchange({ ...exchangeRequest(), nodeId: '99999999-9999-4999-8999-999999999999' }),
    (error) => error?.code === 'NODE_TRANSPORT_REQUEST_INVALID',
  );
  assert.equal(harness.calls.length, 0);
});

test('only an exact bounded 410 expiry response receives the terminal expiry code', async () => {
  const remoteSecret = `${PAIRING_CREDENTIAL} should never escape`;
  const exact = requestHarness({
    statusCode: 410,
    body: responseBody({ ok: false, error: { code: 'NODE_PAIRING_EXPIRED', message: remoteSecret } }),
  });
  const exactTransport = new MastermindCoreNodeFixedHttpsTransport({
    credentialStore: { async load() { return credentialRecord('pending'); } },
    requestImpl: exact.requestImpl,
  });
  await assert.rejects(exactTransport.pair(pairRequest()), (error) => {
    assert.equal(error.code, 'NODE_PAIRING_EXPIRED');
    assert.equal(error.retryable, false);
    assert.equal(`${error.message}\n${error.stack}`.includes(remoteSecret), false);
    assert.equal(`${error.message}\n${error.stack}`.includes(PAIRING_CREDENTIAL), false);
    return true;
  });

  const malformed = requestHarness({
    statusCode: 410,
    body: responseBody({ ok: false, error: { code: 'WRONG_CODE', message: 'expired' }, extra: true }),
  });
  const malformedTransport = new MastermindCoreNodeFixedHttpsTransport({
    credentialStore: { async load() { return credentialRecord('pending'); } },
    requestImpl: malformed.requestImpl,
  });
  await assert.rejects(
    malformedTransport.pair(pairRequest()),
    (error) => error?.code === 'NODE_HOSTED_RESPONSE_INVALID',
  );
});

test('whole-operation timeout remains armed through a stalled response body', async () => {
  const harness = requestHarness({ body: Buffer.from('{', 'utf8'), hang: true });
  const transport = new MastermindCoreNodeFixedHttpsTransport({
    credentialStore: { async load() { return credentialRecord('paired'); } },
    requestImpl: harness.requestImpl,
    timeoutMs: 100,
  });
  await assert.rejects(
    transport.exchange(exchangeRequest()),
    (error) => error?.code === 'NODE_HOSTED_TIMEOUT' && error.retryable === true,
  );
});
