import assert from 'node:assert/strict';
import test from 'node:test';
import { readBoundedJsonRequestBody } from '../../../src/lib/memory/local-service-auth.ts';
import { createHostedMcpTransport } from '../src/hosted-mcp-transport.mjs';

function fixture() {
  const calls = [];
  const handler = createHostedMcpTransport({
    verifyToken: async (_request, token) => token === 'fixture-owner'
      ? { token, clientId: 'fixture-client', scopes: ['openid'], extra: { clerkUserId: 'user_owner', authMode: 'clerk-oauth' } } : undefined,
    gatewayForSubject: async (subject) => { calls.push(subject); return {
      searchMemories: async () => ({ results: [{ id: 'source-17', content: 'Verified fixture evidence', updatedAt: '2026-09-06T00:00:00Z' }] }),
    }; },
    readBody: (request) => readBoundedJsonRequestBody(request, { maxBytes: 65536 }),
  });
  return { handler, calls };
}
function request(payload, { token = 'fixture-owner', origin, raw } = {}) {
  return new Request('https://mastermind.example/api/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) },
    body: raw ?? JSON.stringify(payload) });
}
async function body(response) {
  const text = await response.text();
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const line = text.split('\n').find((value) => value.startsWith('data: '));
    return JSON.parse(line.slice(6));
  }
  return JSON.parse(text);
}

test('real SDK transport denies unauthenticated and cross-origin calls before canonical reads', async () => {
  const { handler, calls } = fixture();
  const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  const denied = await handler(request(payload, { token: null }));
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/);
  const cross = await handler(request(payload, { origin: 'https://untrusted.example' }));
  assert.equal(cross.status, 403);
  assert.equal(cross.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(calls, []);
});

test('real SDK initializes and exposes only the read catalog; a call receives verified auth context', async () => {
  const { handler, calls } = fixture();
  const initialized = await body(await handler(request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' },
  } })));
  assert.equal(initialized.result.serverInfo.name, 'mastermind-embodiment-gateway');
  const listed = await body(await handler(request({ jsonrpc: '2.0', id: 2, method: 'tools/list' })));
  assert.equal(listed.result.tools.length, 7);
  assert.equal(listed.result.tools.every((tool) => tool.annotations.readOnlyHint), true);
  const response = await handler(request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
    name: 'mastermind_memory_search', arguments: { query: 'hydrate' },
  } }));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = (await body(response)).result;
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.results[0].id, 'source-17');
  assert.deepEqual(calls, ['user_owner']);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
});

test('real SDK rejects unavailable writes, unknown scope arguments and over-limit bodies without canonical calls', async () => {
  const { handler, calls } = fixture();
  const write = await body(await handler(request({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
    name: 'mastermind_task_checkpoint', arguments: {},
  } })));
  assert.ok(write.error || write.result?.isError);
  const injection = await body(await handler(request({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
    name: 'mastermind_memory_search', arguments: { query: 'hydrate', householdId: 'other' },
  } })));
  assert.ok(injection.error || injection.result?.isError);
  const oversized = await handler(request(null, { raw: 'x'.repeat(65537) }));
  assert.equal(oversized.status, 413);
  assert.deepEqual(calls, []);
});
