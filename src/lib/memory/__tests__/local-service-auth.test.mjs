import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalServiceRequestAuthError,
  LocalServiceRequestBodyError,
  authorizeLocalServiceRequest,
  readBoundedJsonRequestBody,
} from '../local-service-auth.ts';

const TOKEN = 'a'.repeat(32);
const ENV = Object.freeze({
  MASTERMIND_LOCAL_CONTROL_ENABLED: 'true',
  MASTERMIND_CONTROL_TOKEN: TOKEN,
});
const POLICY = Object.freeze({
  method: 'POST',
  path: '/api/memory/events',
  messages: Object.freeze({
    disabled: 'The local service is disabled.',
    loopbackRequired: 'Direct loopback is required.',
    unauthorized: 'The service token is required.',
  }),
});

function request(overrides = {}) {
  return new Request(overrides.url ?? 'http://127.0.0.1:3000/api/memory/events', {
    method: overrides.method ?? 'POST',
    headers: {
      host: '127.0.0.1:3000',
      authorization: `Bearer ${TOKEN}`,
      ...overrides.headers,
    },
  });
}

function authFailure(status, code, message) {
  return (error) => error instanceof LocalServiceRequestAuthError
    && error.status === status && error.code === code && error.message === message;
}

function bodyFailure(status, code) {
  return (error) => error instanceof LocalServiceRequestBodyError
    && error.status === status && error.code === code;
}

test('authorizes only the exact originless loopback POST, host, path, and bearer', () => {
  assert.doesNotThrow(() => authorizeLocalServiceRequest(request(), ENV, POLICY));
  assert.doesNotThrow(() => authorizeLocalServiceRequest(request({
    url: 'http://localhost:3000/api/memory/events',
  }), ENV, POLICY));

  const loopbackFailures = [
    request({ url: 'http://localhost:3000/api/memory/events', headers: { host: 'localhost:3000' } }),
    request({ url: 'http://localhost:3001/api/memory/events' }),
    request({ url: 'https://127.0.0.1:3000/api/memory/events' }),
    request({ url: 'http://127.0.0.1:3000/api/memory/other' }),
    request({ url: 'http://127.0.0.1:3000/api/memory/events?extra=1' }),
    request({ url: 'http://127.0.0.1:3000/api/memory/events#fragment' }),
    request({ headers: { host: '127.0.0.1:3001' } }),
    request({ headers: { origin: 'http://127.0.0.1:3000' } }),
    request({ headers: { 'sec-fetch-site': 'same-origin' } }),
    {
      method: 'POST',
      url: 'http://user@127.0.0.1:3000/api/memory/events',
      headers: new Headers({ host: '127.0.0.1:3000', authorization: `Bearer ${TOKEN}` }),
    },
  ];
  for (const candidate of loopbackFailures) {
    assert.throws(
      () => authorizeLocalServiceRequest(candidate, ENV, POLICY),
      authFailure(403, 'LOOPBACK_REQUEST_REQUIRED', POLICY.messages.loopbackRequired),
    );
  }

  assert.throws(
    () => authorizeLocalServiceRequest(request({ method: 'PUT' }), ENV, POLICY),
    authFailure(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.'),
  );
  for (const authorization of ['', `bearer ${TOKEN}`, `Bearer  ${TOKEN}`, `Bearer ${TOKEN}x`]) {
    assert.throws(
      () => authorizeLocalServiceRequest(request({ headers: { authorization } }), ENV, POLICY),
      authFailure(401, 'UNAUTHORIZED', POLICY.messages.unauthorized),
    );
  }
});

test('fails closed unless local control and a bounded token are configured exactly', () => {
  for (const enabled of [undefined, '', 'false', 'TRUE', '1']) {
    assert.throws(
      () => authorizeLocalServiceRequest(request(), {
        ...ENV,
        MASTERMIND_LOCAL_CONTROL_ENABLED: enabled,
      }, POLICY),
      authFailure(403, 'LOCAL_CONTROL_DISABLED', POLICY.messages.disabled),
    );
  }
  assert.throws(
    () => authorizeLocalServiceRequest(request(), { ...ENV, VERCEL: '1' }, POLICY),
    authFailure(403, 'LOCAL_CONTROL_DISABLED', POLICY.messages.disabled),
  );
  for (const configuredToken of ['a'.repeat(31), 'a'.repeat(513)]) {
    assert.throws(
      () => authorizeLocalServiceRequest(request(), {
        ...ENV,
        MASTERMIND_CONTROL_TOKEN: configuredToken,
      }, POLICY),
      authFailure(503, 'CONTROL_CONFIGURATION_INVALID', 'The local control token is not configured correctly.'),
    );
  }

  for (const length of [32, 512]) {
    const configuredToken = 'z'.repeat(length);
    assert.doesNotThrow(() => authorizeLocalServiceRequest(request({
      headers: { authorization: `Bearer ${configuredToken}` },
    }), { ...ENV, MASTERMIND_CONTROL_TOKEN: configuredToken }, POLICY));
  }
});

test('reads a bounded UTF-8 JSON body without parsing or recoding it', async () => {
  const body = '{"message":"café"}';
  const encodedLength = Buffer.byteLength(body, 'utf8');
  const req = new Request('http://127.0.0.1:3000/api/example', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(encodedLength),
    },
    body,
  });
  assert.equal(await readBoundedJsonRequestBody(req, { maxBytes: encodedLength }), body);
});

test('bounded JSON reader rejects unsupported metadata, size, length mismatch, and invalid UTF-8', async () => {
  const make = (body, headers = {}) => new Request('http://127.0.0.1:3000/api/example', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
  await assert.rejects(
    readBoundedJsonRequestBody(make('{}', { 'content-type': 'text/plain' }), { maxBytes: 16 }),
    bodyFailure(415, 'UNSUPPORTED_CONTENT_TYPE'),
  );
  await assert.rejects(
    readBoundedJsonRequestBody(make('{}', { 'content-encoding': 'gzip' }), { maxBytes: 16 }),
    bodyFailure(415, 'UNSUPPORTED_CONTENT_ENCODING'),
  );
  await assert.rejects(
    readBoundedJsonRequestBody(make('{}', { 'content-length': '01' }), { maxBytes: 16 }),
    bodyFailure(400, 'INVALID_CONTENT_LENGTH'),
  );
  await assert.rejects(
    readBoundedJsonRequestBody(make('{}', { 'content-length': '17' }), { maxBytes: 16 }),
    bodyFailure(413, 'BODY_TOO_LARGE'),
  );
  await assert.rejects(
    readBoundedJsonRequestBody(make('{}', { 'content-length': '3' }), { maxBytes: 16 }),
    bodyFailure(400, 'CONTENT_LENGTH_MISMATCH'),
  );
  const invalidUtf8 = make(new Uint8Array([0xc3, 0x28]));
  await assert.rejects(
    readBoundedJsonRequestBody(invalidUtf8, { maxBytes: 16 }),
    bodyFailure(400, 'INVALID_UTF8'),
  );
});
