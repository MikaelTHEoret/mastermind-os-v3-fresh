import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

import * as contract from '../../../../protocol/mastermind-node-exchange/contract.mjs';
import { inspectApiBoundary } from '../../auth/api-boundary.mjs';

const source = fs.readFileSync(new URL('../http.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'http.ts',
}).outputText;

class BodyError extends Error {}
class ServiceError extends Error {}

function loadHttp() {
  const commonJsModule = { exports: {} };
  const sandbox = {
    Error,
    Object,
    Response,
    URL,
    exports: commonJsModule.exports,
    module: commonJsModule,
    require(identifier) {
      if (identifier === '@/lib/memory/local-service-auth') {
        return { LocalServiceRequestBodyError: BodyError, readBoundedJsonRequestBody: async () => '{}' };
      }
      if (identifier === '../../../protocol/mastermind-node-exchange/contract.mjs') return contract;
      if (identifier === './store') return { NodeExchangeServiceError: ServiceError };
      throw new Error(`Unexpected test import: ${identifier}`);
    },
  };
  vm.runInNewContext(compiled, sandbox, { filename: 'http.cjs' });
  return commonJsModule.exports;
}

test('owner mutations require exact same-origin browser metadata', () => {
  const http = loadHttp();
  const path = '/api/nodes/pairings';
  const accepted = new Request(`https://mastermind-core.com${path}`, {
    method: 'POST',
    headers: { origin: 'https://mastermind-core.com', 'sec-fetch-site': 'same-origin' },
  });
  assert.doesNotThrow(() => http.authorizeOwnerRequest(accepted, path, true));
  const crossSite = new Request(`https://mastermind-core.com${path}`, {
    method: 'POST',
    headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
  });
  assert.throws(() => http.authorizeOwnerRequest(crossSite, path, true), { code: 'NODE_OWNER_ORIGIN_REQUIRED' });
});

test('owner bodyless mutations accept a non-null zero-byte request stream', async () => {
  const http = loadHttp();
  const request = new Request('https://mastermind-core.com/api/nodes/pairings', {
    method: 'POST',
    headers: { 'content-length': '0' },
    body: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    duplex: 'half',
  });
  assert.notEqual(request.body, null);
  await assert.doesNotReject(http.requireEmptyRequestBody(request));
});

test('owner bodyless mutations reject any request payload byte', async () => {
  const http = loadHttp();
  const request = new Request('https://mastermind-core.com/api/nodes/pairings', {
    method: 'POST',
    body: new Uint8Array([0]),
    duplex: 'half',
  });
  await assert.rejects(
    http.requireEmptyRequestBody(request),
    { status: 400, code: 'NODE_BODY_NOT_ALLOWED' },
  );
});

test('owner bodyless mutations reject body metadata even when its stream is empty', async () => {
  for (const [name, value] of [
    ['content-type', 'application/json'],
    ['content-encoding', 'identity'],
    ['content-length', '1'],
  ]) {
    const http = loadHttp();
    const request = new Request('https://mastermind-core.com/api/nodes/pairings', {
      method: 'POST',
      headers: { [name]: value },
    });
    await assert.rejects(
      http.requireEmptyRequestBody(request),
      { status: 400, code: 'NODE_BODY_NOT_ALLOWED' },
    );
  }
});

test('machine routes reject browser-originated requests', () => {
  const http = loadHttp();
  const path = '/api/node/v1/exchange';
  const request = new Request(`https://mastermind-core.com${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer mn1.11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`, origin: 'https://mastermind-core.com' },
  });
  assert.throws(() => http.authorizeMachineRequest(request, path), { code: 'NODE_MACHINE_REQUEST_REQUIRED' });
});

test('owner jobs accept only the two exact routine capabilities and request ID', () => {
  const http = loadHttp();
  const requestId = '22222222-2222-4222-8222-222222222222';
  assert.equal(http.readOwnerJobRequest({ capability: contract.MASTERMIND_NODE_CAPABILITY, requestId }).requestId, requestId);
  assert.equal(http.readOwnerJobRequest({ capability: contract.MASTERMIND_CORE_STATUS_CAPABILITY, requestId }).capability, contract.MASTERMIND_CORE_STATUS_CAPABILITY);
  assert.throws(
    () => http.readOwnerJobRequest({ capability: contract.MASTERMIND_NODE_CAPABILITY, requestId, force: true }),
    { code: 'NODE_REQUEST_INVALID' },
  );
  for (const body of [
    { capability: 'mastermind.core.shell', requestId },
    { capability: contract.MASTERMIND_CORE_STATUS_CAPABILITY, requestId, input: { url: 'https://example.com' } },
    { capability: contract.MASTERMIND_CORE_STATUS_CAPABILITY, requestId, capabilityVersion: 2 },
  ]) assert.throws(() => http.readOwnerJobRequest(body), { code: 'NODE_REQUEST_INVALID' });
});

test('Clerk middleware covers owner node routes but not machine bearer routes', async () => {
  const middleware = await fsp.readFile(new URL('../../../middleware.ts', import.meta.url), 'utf8');
  assert.match(middleware, /matcher: \['\/api\/:path\*'\]/);
  const env = { NODE_ENV: 'production', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'fixture', CLERK_SECRET_KEY: 'fixture', OWNER_CLERK_USER_ID: 'user_fixture' };
  assert.equal(inspectApiBoundary(new Request('https://mastermind-core.com/api/nodes/fixture/jobs'), env).kind, 'owner');
  assert.equal(inspectApiBoundary(new Request('https://mastermind-core.com/api/node/v1/exchange'), env).kind, 'node-protocol');
  assert.equal(inspectApiBoundary(new Request('https://mastermind-core.com/api/node/v1/exchange/extra'), env).kind, 'owner');
});
