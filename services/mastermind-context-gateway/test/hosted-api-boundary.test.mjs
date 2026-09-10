import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiOwnerConfigured, inspectApiBoundary, authorizeApiBoundary, apiBoundaryDenial } from '../../../src/lib/auth/api-boundary.mjs';

const configured = { NODE_ENV: 'production', VERCEL: '1', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'fixture', CLERK_SECRET_KEY: 'fixture', OWNER_CLERK_USER_ID: 'user_owner' };
const dev = { NODE_ENV: 'development' };
const request = (path, headers = {}, origin = 'https://mastermind.example') => new Request(origin + path, { headers });

test('every discovered API defaults to private, apart from three exact authenticated protocols', () => {
  const root = fileURLToPath(new URL('../../../src/app/api/', import.meta.url));
  const routes = fs.readdirSync(root, { recursive: true }).filter((name) => String(name).replaceAll('\\', '/').endsWith('route.ts'));
  // Require load-bearing routes explicitly, then inspect every route discovered in
  // this source tree. Domain breadth is not an authorization assertion.
  const inventory = new Set(routes.map((name) => String(name).replaceAll('\\', '/')));
  for (const required of [
    'node/v1/pair/route.ts', 'node/v1/exchange/route.ts', 'mcp/route.ts',
    'chat/route.ts', 'modules/route.ts', 'codex/route.ts', 'keys/route.ts',
  ]) assert.ok(inventory.has(required), `missing required boundary route: ${required}`);
  const expected = new Map([['/api/node/v1/pair', 'node-protocol'], ['/api/node/v1/exchange', 'node-protocol'], ['/api/mcp', 'mcp-oauth']]);
  for (const route of routes) {
    const path = '/api/' + String(route).replaceAll('\\', '/').replace(/\/?route.ts$/, '');
    assert.equal(inspectApiBoundary(request(path), configured).kind, expected.get(path) ?? 'owner', path);
    if (!expected.has(path)) assert.equal(inspectApiBoundary(request(path), {}).code, 'OWNER_GATE_NOT_CONFIGURED', path);
  }
  assert.equal(inspectApiBoundary(request('/api/future-private-reader'), configured).kind, 'owner');
});

test('exact owner required; missing, foreign and failed auth stop before the handler', async () => {
  assert.equal((await authorizeApiBoundary(request('/api/codex'), configured, async () => null)).status, 401);
  assert.equal((await authorizeApiBoundary(request('/api/keys'), configured, async () => 'user_foreign')).status, 403);
  assert.equal((await authorizeApiBoundary(request('/api/memory/identity'), configured, async () => { throw Error('secret'); })).code, 'OWNER_AUTH_UNAVAILABLE');
  assert.deepEqual(await authorizeApiBoundary(request('/api/codex'), configured, async () => 'user_owner'), { kind: 'owner', subject: 'user_owner' });
  assert.equal(apiOwnerConfigured({ ...configured, OWNER_CLERK_USER_ID: 'owner@example.com' }), false);
});

test('public origins and sibling sites cannot read or change private owner data', async () => {
  let checked = false;
  for (const headers of [{ origin: 'https://foreign.example' }, { origin: 'null' }, { 'sec-fetch-site': 'same-site' }]) {
    const admission = await authorizeApiBoundary(request('/api/chat/session', headers), configured, async () => { checked = true; return 'user_owner'; });
    assert.equal(admission.code, 'API_ORIGIN_REQUIRED');
  }
  assert.equal(checked, false);
  assert.equal(inspectApiBoundary(request('/api/chat/session', { origin: 'https://mastermind.example', 'sec-fetch-site': 'same-origin' }), configured).kind, 'owner');
});

test('local dev is a bounded outer admission, not a replacement for route auth', () => {
  const local = request('/api/local-control/core-health', { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }, 'http://localhost:3000');
  assert.equal(inspectApiBoundary(local, dev).kind, 'local-development');
  assert.equal(inspectApiBoundary(local, { ...dev, ...configured, NODE_ENV: 'development' }).kind, 'owner');
  assert.equal(inspectApiBoundary(local, { NODE_ENV: 'production' }).code, 'OWNER_GATE_NOT_CONFIGURED');
  assert.equal(inspectApiBoundary(request('/api/chat', { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }, 'http://localhost:3000'), dev).kind, 'local-development');
  for (const host of ['evil.example:3000', 'localhost:3001', 'user@localhost:3000', 'localhost:3000/path', '']) {
    assert.equal(inspectApiBoundary(request('/api/codex', { host }, 'http://localhost:3000'), dev).kind, 'denied');
  }
  assert.equal(inspectApiBoundary(request('/api/keys', { host: 'mastermind.example', 'x-forwarded-host': 'localhost:3000', 'x-forwarded-for': '127.0.0.1' }), dev).kind, 'denied');
});

test('paired node and MCP exceptions are exact and never authenticate other API paths', async () => {
  const mustNotRun = async () => { throw Error('browser session must not replace protocol auth'); };
  for (const [path, kind] of [['/api/node/v1/pair', 'node-protocol'], ['/api/node/v1/exchange', 'node-protocol'], ['/api/mcp', 'mcp-oauth']]) {
    assert.equal((await authorizeApiBoundary(request(path), configured, mustNotRun)).kind, kind);
  }
  for (const path of ['/api/nodes', '/api/node/pair-local', '/api/node/v1/exchange/extra', '/api/mcp/extra']) {
    assert.equal(inspectApiBoundary(request(path, { authorization: 'Bearer fixture' }), configured).kind, 'owner');
  }
});

test('capture extension retains only its exact local credential protocol', () => {
  const clientId='11111111-1111-4111-8111-111111111111';
  const headers = { host: 'localhost:3000', origin: 'chrome-extension://' + 'a'.repeat(32), 'sec-fetch-site': 'cross-site', 'x-mastermind-capture-client':clientId, 'x-mastermind-capture-secret':'a'.repeat(43) };
  assert.equal(inspectApiBoundary(request('/api/genealogy/acquisition?clientId='+clientId, headers, 'http://localhost:3000'), dev).kind, 'local-capture-protocol');
  assert.equal(inspectApiBoundary(request('/api/keys', headers, 'http://localhost:3000'), dev).kind, 'denied');
  assert.equal(inspectApiBoundary(request('/api/genealogy/acquisition', headers), configured).kind, 'denied');
});

test('public site and metadata discovery stay outside private API admission', () => {
  for (const path of ['/', '/sign-in', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp']) {
    assert.equal(inspectApiBoundary(request(path), {}).kind, 'public');
  }
});

test('denials are bounded generic no-store JSON without cross-origin access', async () => {
  const response = apiBoundaryDenial({ status: 403, code: 'OWNER_REQUIRED' });
  assert.equal(response.status, 403);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.has('access-control-allow-origin'), false);
  assert.equal((await response.json()).error.code, 'OWNER_REQUIRED');
});
