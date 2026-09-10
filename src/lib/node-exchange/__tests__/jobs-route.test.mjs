import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as contract from '../../../../protocol/mastermind-node-exchange/contract.mjs';

const nodeId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const base = 'https://mastermind-core.com';
function load(source, imports) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { Error, Object, Response, URL, exports: module.exports, module,
    require(id) { if (!(id in imports)) throw new Error('Unexpected import: ' + id); return imports[id]; } });
  return module.exports;
}
function harness(owner = { ok: true }, status = 'created') {
  const calls = []; let authCalls = 0;
  class BodyError extends Error {}
  class ServiceError extends Error {}
  const http = load(fs.readFileSync(new URL('../http.ts', import.meta.url), 'utf8'), {
    '@/lib/memory/local-service-auth': { LocalServiceRequestBodyError: BodyError,
      async readBoundedJsonRequestBody(request, { maxBytes }) {
        const value = await request.text(); assert(Buffer.byteLength(value) <= maxBytes); return value;
      } },
    '../../../protocol/mastermind-node-exchange/contract.mjs': contract,
    './store': { NodeExchangeServiceError: ServiceError },
  });
  const database = {};
  const enqueue = (kind) => async (db, node, id) => {
    assert.equal(db, database); calls.push({ kind, node, id }); return { status, job: { jobId: id } };
  };
  const route = load(fs.readFileSync(new URL('../../../app/api/nodes/[nodeId]/jobs/route.ts', import.meta.url), 'utf8'), {
    '@/lib/db': { getMemoryDb: () => database }, '@/lib/node-exchange/http': http,
    '@/lib/node-exchange/store': { enqueueCoreStatusJob: enqueue('core'), enqueueEnsureRunningJob: enqueue('family') },
    '../../../../../../protocol/mastermind-node-exchange/contract.mjs': contract,
    '@/lib/trading/auth': { async requireOwner() { authCalls++; return owner; } },
  });
  return { calls, authCalls: () => authCalls, async post(body, options = {}) {
    return route.POST(new Request(base + (options.path ?? `/api/nodes/${nodeId}/jobs`), {
      method: 'POST', headers: { origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ nodeId }) });
  } };
}

test('authenticated owner dispatcher routes only the selected fixed capability with exact node and replay ID', async () => {
  for (const [capability, kind] of [[contract.MASTERMIND_NODE_CAPABILITY, 'family'], [contract.MASTERMIND_CORE_STATUS_CAPABILITY, 'core']]) {
    const api = harness(); const response = await api.post({ capability, requestId });
    assert.equal(response.status, 201); assert.equal((await response.json()).ok, true);
    assert.deepEqual(api.calls, [{ kind, node: nodeId, id: requestId }]); assert.equal(api.authCalls(), 1);
  }
  const duplicate = harness({ ok: true }, 'duplicate');
  assert.equal((await duplicate.post({ capability: contract.MASTERMIND_CORE_STATUS_CAPABILITY, requestId })).status, 200);
});

test('owner denial, foreign origin and mismatched route cannot enqueue or cross node scope', async () => {
  const body = { capability: contract.MASTERMIND_CORE_STATUS_CAPABILITY, requestId };
  const denied = harness({ ok: false, status: 403, reason: 'Owner required.' });
  assert.equal((await denied.post(body)).status, 403); assert.equal(denied.calls.length, 0);
  const cross = harness();
  assert.equal((await cross.post(body, { headers: { origin: 'https://foreign.example', 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal(cross.calls.length, 0); assert.equal(cross.authCalls(), 0);
  const wrong = harness();
  assert.equal((await wrong.post(body, { path: '/api/nodes/33333333-3333-4333-8333-333333333333/jobs' })).status, 404);
  assert.equal(wrong.calls.length, 0); assert.equal(wrong.authCalls(), 0);
});

test('dispatcher rejects extra input and arbitrary operations before any enqueue', async () => {
  for (const body of [
    { capability: 'shell.exec', requestId },
    { capability: contract.MASTERMIND_CORE_STATUS_CAPABILITY, requestId, input: { command: 'run' } },
    { capability: contract.MASTERMIND_CORE_STATUS_CAPABILITY, requestId: 'invalid' },
  ]) { const api = harness(); assert.equal((await api.post(body)).status, 400); assert.equal(api.calls.length, 0); }
});

function historyHarness(owner={ok:true},saved=null) {
  const calls=[];
  class ServiceError extends Error {}
  class BodyError extends Error {}
  const http=load(fs.readFileSync(new URL('../http.ts',import.meta.url),'utf8'),{
    '@/lib/memory/local-service-auth':{LocalServiceRequestBodyError:BodyError},
    '../../../protocol/mastermind-node-exchange/contract.mjs':contract,
    './store':{NodeExchangeServiceError:ServiceError},
  });
  const route=load(fs.readFileSync(new URL('../../../app/api/nodes/[nodeId]/core-status/route.ts',import.meta.url),'utf8'),{
    '@/lib/db':{getMemoryDb(){calls.push('database');return 'database';}},
    '@/lib/node-exchange/http':http,
    '@/lib/node-exchange/store':{async getLatestOwnerCoreStatusJob(db,id){calls.push(['read',db,id]);return saved;}},
    '@/lib/trading/auth':{async requireOwner(){calls.push('owner');return owner;}},
  });
  return {calls,get(options={}){return route.GET(new Request(base+(options.path??`/api/nodes/${nodeId}/core-status`),{
    method:options.method??'GET',headers:{'sec-fetch-site':'same-origin',...options.headers},
  }),{params:Promise.resolve({nodeId})});}};
}

test('saved core history denies unauthenticated and foreign requests before opening the database', async () => {
  for(const status of [401,403]) {
    const api=historyHarness({ok:false,status,reason:'Owner required.'});
    assert.equal((await api.get()).status,status);assert.deepEqual(api.calls,['owner']);
  }
  for(const [options,status] of [[{headers:{'sec-fetch-site':'cross-site'}},403],[{path:'/api/nodes/wrong/core-status'},404],[{method:'POST'},405]]) {
    const api=historyHarness();assert.equal((await api.get(options)).status,status);assert.deepEqual(api.calls,[]);
  }
});

test('saved core history returns existing result or explicit absence without writing or caching it', async () => {
  for(const saved of [null,{jobId:requestId}]) {
    const api=historyHarness({ok:true},saved);const response=await api.get();
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,job:saved});
    assert.match(response.headers.get('cache-control'),/no-store/);
    assert.deepEqual(api.calls,['owner','database',['read','database',nodeId]]);
  }
});
