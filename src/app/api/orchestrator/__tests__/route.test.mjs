import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

class BodyError extends Error { constructor(status) { super('bounded body'); this.status = status; } }
function load(relative, { allowed = true, fetcher = async () => new Response('{}'), tick = async () => ({}) } = {}) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, URL, URLSearchParams, TextDecoder, AbortSignal, fetch: fetcher,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (value, options = {}) => ({ value, status: options.status || 200, headers: options.headers }) } };
      if (name.endsWith('/chat/_boundary')) return { chatAccessError: async () => allowed ? null : { status: 403 } };
      if (name === '@/lib/nexus') return { tick };
      if (name === '@/lib/memory/local-service-auth') return { LocalServiceRequestBodyError: BodyError, readBoundedJsonRequestBody: async (request, { maxBytes }) => {
        const text = await request.text(); if (Buffer.byteLength(text) > maxBytes) throw new BodyError(413); return text;
      } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return module.exports;
}
const request = (query = '', body) => new Request(`http://localhost:3000/api/orchestrator${query}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('private reads and effectful routes deny before any input or upstream access', async () => {
  let calls = 0;
  const api = load('../route.ts', { allowed: false, fetcher: () => { calls++; throw new Error('unexpected'); } });
  const poisoned = { get url() { throw new Error('must not parse'); } };
  assert.equal((await api.GET(poisoned)).status, 403);
  assert.equal((await api.POST(poisoned)).status, 403);
  assert.equal(calls, 0);
});

test('only declared paths and bounded trace queries reach the fixed service', async () => {
  const calls = [];
  const api = load('../route.ts', { fetcher: async (url, options) => { calls.push({ url, options }); return new Response('{"ok":true}'); } });
  for (const query of ['?path=/execute', '?path=//evil.test', '?path=/health/../execute', '?path=/health&path=/traces', '?path=/traces&qs=n%3D999999', '?path=/health&qs=n%3D1']) {
    assert.equal((await api.GET(request(query))).status, 400, query);
  }
  assert.equal(calls.length, 0);
  assert.equal((await api.GET(request('?path=/traces&qs=n%3D20'))).status, 200);
  assert.equal(calls[0].url, 'http://127.0.0.1:8771/traces?n=20');
  assert.equal(calls[0].options.redirect, 'error');
});

test('an uncertain action is dispatched once and never silently retried', async () => {
  let calls = 0;
  const api = load('../route.ts', { fetcher: async () => { calls++; throw new Error('lost reply'); } });
  const result = await api.POST(request('?path=/execute', { id: 7 }));
  assert.equal(result.status, 502);
  assert.equal(result.value.code, 'ORCHESTRATOR_RESULT_UNCONFIRMED');
  assert.equal(result.value.retryable, false);
  assert.equal(calls, 1);
});

test('invalid or oversized bodies and overflowing responses return no partial result', async () => {
  let calls = 0;
  const api = load('../route.ts', { fetcher: async () => { calls++; return new Response('PRIVATE'.repeat(400000)); } });
  for (const value of ['{bad', [], null]) assert.equal((await api.POST(request('?path=/decide', value))).status, 400);
  assert.equal((await api.POST(request('?path=/upload', { payload: 'a'.repeat(2 * 1024 * 1024) }))).status, 413);
  assert.equal(calls, 0);
  const result = await api.GET(request());
  assert.equal(result.status, 502);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('Nexus reads never beat and denied writes never initialize the task', async () => {
  let calls = 0;
  const tick = async () => { calls++; return { recorded: true }; };
  const denied = load('../../nexus/tick/route.ts', { allowed: false, tick });
  assert.equal((await denied.GET()).status, 405);
  assert.equal((await denied.POST(request())).status, 403);
  assert.equal(calls, 0);
  const allowed = load('../../nexus/tick/route.ts', { tick });
  assert.equal((await allowed.POST(request('', {}))).status, 200);
  assert.equal(calls, 1);
});
