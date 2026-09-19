import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as contract from '../../../../protocol/mastermind-node-exchange/contract.mjs';

const nodeId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const base = 'https://mastermind-core.com';
test('reuse link route is opt-in and enforces same-origin owner access before enqueue',async()=>{
 for(const [owner,enabled,headers,expected] of [[{ok:true},false,{},503],[{ok:false,status:403,reason:'Owner required'},true,{},403],[{ok:true},true,{origin:'https://foreign.invalid'},403]]){
  const f=harness(owner,'created','review-reuse',enabled);assert.equal((await f.post({},{headers})).status,expected);assert.equal(f.calls.length,0);
 }
 const f=harness({ok:true},'created','review-reuse');assert.equal((await f.post({operationId:requestId,input:{fixture:'bounded'}})).status,201);assert.equal(f.calls[0].kind,'review-reuse');
});
test('review route requires enabled deployment, same-origin owner and bounded input',async()=>{
 const off=harness({ok:true},'created','native-review',false);assert.equal((await off.post({})).status,503);assert.equal(off.calls.length,0);
 const denied=harness({ok:false,status:403,reason:'Owner required'},'created','native-review');assert.equal((await denied.post({})).status,403);assert.equal(denied.calls.length,0);
 const foreign=harness({ok:true},'created','native-review');assert.equal((await foreign.post({},{headers:{origin:'https://foreign.invalid'}})).status,403);assert.equal(foreign.calls.length,0);
 const yes=harness({ok:true},'created','native-review');assert.equal((await yes.post({operationId:requestId,input:{fixture:'bounded'}})).status,201);assert.equal(yes.calls[0].kind,'review');
});
function load(source, imports, env={}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { Error, Object, Response, URL, process:{env},exports: module.exports, module,
    require(id) { if (!(id in imports)) throw new Error('Unexpected import: ' + id); return imports[id]; } });
  return module.exports;
}
function harness(owner = { ok: true }, status = 'created', routeName = 'jobs', reviewEnabled=true,losslessEnabled=false) {
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
  const route = load(fs.readFileSync(new URL(`../../../app/api/nodes/[nodeId]/${routeName}/route.ts`, import.meta.url), 'utf8'), {
    '@/lib/db': { getMemoryDb: () => database }, '@/lib/node-exchange/http': http,
    '@/lib/node-exchange/store': { enqueueCoreStatusJob: enqueue('core'), enqueueEnsureRunningJob: enqueue('family'), enqueueOwnerNativeCatalogJob:enqueue('catalog'),enqueueOwnerNativeSpecificationJob:enqueue('wizard'),enqueueOwnerNativeReviewJob:enqueue('review'),enqueueOwnerReviewReuseJob:enqueue('review-reuse'),enqueueOwnerDevelopmentJob:async(db,node,body,capability)=>{assert.equal(capability,'mastermind.native.'+routeName);return enqueue('development')(db,node,body);} },
    '../../../../../../protocol/mastermind-node-exchange/contract.mjs': contract,
    '@/lib/trading/auth': { async requireOwner() { authCalls++; return owner; } },
  },{MASTERMIND_LOSSLESS_REVIEW_ENABLED:losslessEnabled?'true':'false',MASTERMIND_DEVELOPMENT_WORK_ENABLED:reviewEnabled?'true':'false',MASTERMIND_NATIVE_REVIEW_ENABLED:reviewEnabled?'true':'false',MASTERMIND_REVIEW_REUSE_ENABLED:reviewEnabled?'true':'false'});
  return { calls, authCalls: () => authCalls, async post(body, options = {}) {
    return route.POST(new Request(base + (options.path ?? `/api/nodes/${nodeId}/${routeName}`), {
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

test('Wizard submission requires owner and same-origin route before opening the database',async()=>{
  const body={operationId:requestId,input:{request:'Prepare intent'}};
  const allowed=harness({ok:true},'created','native-specification');
  assert.equal((await allowed.post(body)).status,201);assert.equal(allowed.calls[0].kind,'wizard');
  assert.deepEqual(JSON.parse(JSON.stringify(allowed.calls[0].id)),body);
  const denied=harness({ok:false,status:403,reason:'Owner required'},'created','native-specification');
  assert.equal((await denied.post(body)).status,403);assert.equal(denied.calls.length,0);
  const foreign=harness({ok:true},'created','native-specification');
  assert.equal((await foreign.post(body,{headers:{origin:'https://foreign.example'}})).status,403);assert.equal(foreign.calls.length,0);
  const wrong=harness({ok:true},'created','native-specification');
  assert.equal((await wrong.post(body,{path:`/api/nodes/${requestId}/native-specification`})).status,404);assert.equal(wrong.calls.length,0);
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

function nativeHarness(owner={ok:true}) {
  let enqueueCalls=0, authCalls=0;
  const http=load(fs.readFileSync(new URL('../http.ts',import.meta.url),'utf8'),{
    '@/lib/memory/local-service-auth':{LocalServiceRequestBodyError:class extends Error{},
      async readBoundedJsonRequestBody(request,{maxBytes}){assert.equal(maxBytes,4096);return request.text();}},
    '../../../protocol/mastermind-node-exchange/contract.mjs':contract,'./store':{NodeExchangeServiceError:class extends Error{}}
  });
  const route=load(fs.readFileSync(new URL('../../../app/api/nodes/[nodeId]/native-tasks/route.ts',import.meta.url),'utf8'),{
    '@/lib/db':{getMemoryDb:()=>null},'@/lib/node-exchange/http':http,
    '@/lib/node-exchange/store':{async enqueueOwnerNativeTaskJob(db,id,input){enqueueCalls++;assert.equal(id,nodeId);
      assert.equal(input.operationId,requestId);return {status:'duplicate',job:{jobId:requestId}};}},
    '@/lib/trading/auth':{async requireOwner(){authCalls++;return owner;}}
  });
  return {counts:()=>[authCalls,enqueueCalls],post:(headers={},path=`/api/nodes/${nodeId}/native-tasks`)=>route.POST(new Request(base+path,{
    method:'POST',headers:{origin:base,'sec-fetch-site':'same-origin','content-type':'application/json',...headers},
    body:JSON.stringify({operationId:requestId})}),{params:Promise.resolve({nodeId})})};
}

test('native route uses owner and same-origin checks before reading inputs or accessing the ledger',async()=>{
  const allowed=nativeHarness();assert.equal((await allowed.post()).status,200);assert.deepEqual(allowed.counts(),[1,1]);
  const denied=nativeHarness({ok:false,status:403,reason:'Owner required'});
  assert.equal((await denied.post()).status,403);assert.deepEqual(denied.counts(),[1,0]);
  const foreign=nativeHarness();assert.equal((await foreign.post({origin:'https://foreign.invalid','sec-fetch-site':'cross-site'})).status,403);
  assert.deepEqual(foreign.counts(),[0,0]);
  const wrong=nativeHarness();assert.equal((await wrong.post({},'/api/nodes/other/native-tasks')).status,404);assert.deepEqual(wrong.counts(),[0,0]);
});


test('catalog route denies unrelated identities and cross-origin requests before queue access',async()=>{
 const input={operationId:requestId,input:{schemaVersion:1,taskRef:{taskId:requestId,project:'mastermind'},snapshotId:null,cursor:null}};
 const accepted=harness({ok:true},'created','native-catalog');assert.equal((await accepted.post(input)).status,201);assert.equal(accepted.calls.length,1);assert.equal(accepted.calls[0].kind,'catalog');
 const denied=harness({ok:false,status:403,reason:'Owner required'},'created','native-catalog');assert.equal((await denied.post(input)).status,403);assert.equal(denied.calls.length,0);
 const foreign=harness({ok:true},'created','native-catalog');assert.equal((await foreign.post(input,{headers:{origin:'https://foreign.invalid'}})).status,403);assert.equal(foreign.calls.length,0);
});

function reviewHistoryHarness(owner={ok:true},saved=null) {
  const calls=[];
  class ServiceError extends Error {}
  class BodyError extends Error {}
  const http=load(fs.readFileSync(new URL('../http.ts',import.meta.url),'utf8'),{
    '@/lib/memory/local-service-auth':{LocalServiceRequestBodyError:BodyError},
    '../../../protocol/mastermind-node-exchange/contract.mjs':contract,
    './store':{NodeExchangeServiceError:ServiceError},
  });
  const route=load(fs.readFileSync(new URL('../../../app/api/nodes/[nodeId]/native-history/[taskId]/review/route.ts',import.meta.url),'utf8'),{
    '@/lib/db':{getMemoryDb(){calls.push('database');return 'database';}},
    '@/lib/node-exchange/http':http,
    '@/lib/node-exchange/store':{async getLatestOwnerNativeJob(db,id,task,profile,only){calls.push(['read',db,id,task,profile,only]);return saved;}},
    '@/lib/trading/auth':{async requireOwner(){calls.push('owner');return owner;}},
  });
  return {calls,get(options={}){return route.GET(new Request(base+(options.path??`/api/nodes/${nodeId}/native-history/${requestId}/review`),{
    method:options.method??'GET',headers:{'sec-fetch-site':'same-origin',...options.headers},
  }),{params:Promise.resolve({nodeId,taskId:requestId})});}};
}


test('latest review route keeps owner, origin and fixed-path boundaries before database access',async()=>{
 for(const status of [401,403]){const f=reviewHistoryHarness({ok:false,status,reason:'Owner required.'});assert.equal((await f.get()).status,status);assert.deepEqual(f.calls,['owner']);}
 for(const [options,status] of [[{headers:{'sec-fetch-site':'cross-site'}},403],[{path:'/api/nodes/wrong/native-history/task/review'},404],[{method:'POST'},405]]){const f=reviewHistoryHarness();assert.equal((await f.get(options)).status,status);assert.deepEqual(f.calls,[]);}
 const f=reviewHistoryHarness();const response=await f.get();assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,saved:null});assert.match(response.headers.get('cache-control'),/no-store/);
 assert.deepEqual(f.calls,['owner','database',['read','database',nodeId,requestId,undefined,true]]);
});

for(const route of ['review-artifacts','review-build-plan'])test(route+' requires opt-in, owner, same origin and fixed capability',async()=>{
 for(const [owner,enabled,headers,expected] of [[{ok:true},false,{},503],[{ok:false,status:403,reason:'Owner required'},true,{},403],[{ok:true},true,{origin:'https://foreign.invalid'},403]]){
  const f=harness(owner,'created',route,enabled);assert.equal((await f.post({},{headers})).status,expected);assert.equal(f.calls.length,0);
 }
 const f=harness({ok:true},'created',route);const body={operationId:requestId,input:{fixture:'bounded'}};
 assert.equal((await f.post(body)).status,201);assert.equal(f.calls[0].kind,'development');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].id)),body);
 const duplicate=harness({ok:true},'duplicate',route);assert.equal((await duplicate.post(body)).status,200);
});

test('lossless review writes require independent opt-in and owner; legacy remains available',async()=>{
 const body={operationId:requestId,input:{schemaVersion:2,content:'encoded'}};
 for(const [owner,enabled,expected] of [[{ok:true},false,503],[{ok:false,status:403,reason:'Owner required'},true,403]]){
  const f=harness(owner,'created','native-review',true,enabled);assert.equal((await f.post(body)).status,expected);assert.equal(f.calls.length,0);
 }
 const allowed=harness({ok:true},'created','native-review',true,true);assert.equal((await allowed.post(body)).status,201);assert.equal(allowed.calls.length,1);
 const legacy=harness({ok:true},'created','native-review',true,false);assert.equal((await legacy.post({...body,input:{schemaVersion:1}})).status,201);
});
