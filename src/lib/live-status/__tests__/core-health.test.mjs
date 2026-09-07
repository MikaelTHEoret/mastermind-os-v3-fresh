import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { CORE_HEALTH_SERVICES,parseCoreHealth } from '../core-health-contract.mjs';
import { readCoreHealth } from '../core-health.mjs';
import { emptyLiveResource,liveResourceSucceeded,liveResourceFailed,liveResourcePresentation } from '../live-status.mjs';

function sample(port) {
  const common={ok:true,password:'never expose',apiKey:'never expose',raw:{credentials:'never expose'}};
  if(port===11434) return {...common,models:[{name:'private model name'}]};
  if(port===11435) return {...common,configured:true};
  if(port===8765) return {...common,wired:true,count:174096,content_cache:100};
  if(port===8766) return {...common,pulses:42};
  if(port===8767) return {...common,downstream:{mem_server:true,nexus_state:true,mcp_host:true}};
  if(port===8770) return {...common,modules:15,live:['one'],pending_gate:[],capabilities:['private tool name']};
  if(port===8772) return {...common,servers_up:['session-logger'],failed:{},tools:43,runs:0,activeTurns:0,per_server:{'private name':{}}};
  if(port===8793) return {...common,service:'derived_refresh',lastCycle:{status:'partial',mode:'apply',startedAt:'2026-09-06T08:00:00Z',error:'never expose',layers:{bloom_paths:{written:0},core_affinity:{written:25},intent_quality_act_descriptors:{status:'paused',written:0}},resourceGate:{reason:'CHEAP_STEPS_ALLOWED_DESCRIPTOR_RESOURCE_HOLD',dsn:'never expose'}}};
  return {...common,model:'private model name',trainset:{private:'never expose'}};
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});}

test('core health probes eight fixed core endpoints and one separate optional refresh endpoint',async()=>{
  const calls=[];
  const result=await readCoreHealth({fetcher:async(url,options)=>{calls.push({url,options});return json(sample(Number(new URL(url).port)));}});
  assert.deepEqual(calls.map(call=>call.url),[
    'http://127.0.0.1:11434/api/tags','http://127.0.0.1:11435/health','http://127.0.0.1:8765/health','http://127.0.0.1:8766/health',
    'http://127.0.0.1:8767/health','http://127.0.0.1:8770/health','http://127.0.0.1:8771/health','http://127.0.0.1:8772/health',
    'http://127.0.0.1:8793/health',
  ]);
  assert.ok(calls.every(call=>call.options.method==='GET' && call.options.redirect==='error' && !call.options.body));
  assert.ok(result.services.every(service=>service.state==='healthy'));
  assert.doesNotMatch(JSON.stringify(result),/never expose|private|credentials|password|apiKey|per_server|capabilities/);
  assert.equal(result.services.find(service=>service.id==='mcp_host').metrics.tools,43);
  assert.equal(result.services.length,8);
  assert.equal(result.backgroundRefresh.cycle.rowsWritten,25);
  assert.equal(result.backgroundRefresh.cycle.descriptorPaused,true);
});

test('optional worker failure does not degrade core8 and cached cycle metadata is strictly allowlisted',async()=>{
  const result=await readCoreHealth({fetcher:async(url)=>{
    const port=Number(new URL(url).port);
    if(port===8793) throw new Error('private DSN must not escape');
    return json(sample(port));
  }});
  assert.equal(result.services.filter(row=>row.state==='healthy').length,8);
  assert.equal(result.backgroundRefresh.state,'unavailable');
  assert.equal(result.backgroundRefresh.cycle,null);
  assert.doesNotMatch(JSON.stringify(result),/private|DSN/);
  const healthy=await readCoreHealth({fetcher:async(url)=>json(sample(Number(new URL(url).port)))});
  const invalid=structuredClone(healthy);invalid.backgroundRefresh.cycle.gateReason='private raw error';
  assert.throws(()=>parseCoreHealth(invalid));
  const badIdentity=structuredClone(healthy);badIdentity.backgroundRefresh.id='untrusted';
  assert.throws(()=>parseCoreHealth(badIdentity));
});

test('background worker timeout, oversized reports and paused status remain bounded without changing core8',async()=>{
  for(const kind of ['timeout','oversized','paused']) {
    const result=await readCoreHealth({timeoutMs:20,fetcher:async(url)=>{
      const port=Number(new URL(url).port);
      if(port!==8793) return json(sample(port));
      if(kind==='timeout') return new Promise(()=>{});
      if(kind==='oversized') return json({...sample(port),raw:'x'.repeat(65537)});
      return json({ok:true,service:'derived_refresh',lastCycle:{status:'paused',resourceGate:{reason:'CHAT_ACTIVE_OR_IDLE_STATE_UNAVAILABLE'}}});
    }});
    assert.equal(result.services.filter(row=>row.state==='healthy').length,8);
    if(kind==='paused') {assert.equal(result.backgroundRefresh.state,'healthy');assert.equal(result.backgroundRefresh.cycle.status,'paused');assert.equal(result.backgroundRefresh.cycle.rowsWritten,null);}
    else assert.equal(result.backgroundRefresh.reason,kind==='timeout'?'TIMEOUT':'RESPONSE_TOO_LARGE');
  }
});

test('timeouts, HTTP errors, invalid health and oversized bodies remain bounded and distinguishable',async()=>{
  const result=await readCoreHealth({timeoutMs:20,fetcher:async(url)=>{
    const port=Number(new URL(url).port);
    if(port===11434) return new Promise(()=>{});
    if(port===11435) return json({error:'private detail'},503);
    if(port===8765) return json({ok:true,padding:'x'.repeat(65537)});
    if(port===8766) return json({ok:false,error:'private detail'});
    return json(sample(port));
  }});
  assert.equal(result.services[0].reason,'TIMEOUT');
  assert.equal(result.services[1].reason,'HTTP_ERROR');
  assert.equal(result.services[2].reason,'RESPONSE_TOO_LARGE');
  assert.equal(result.services[3].reason,'INVALID_HEALTH');
  assert.ok(result.services.slice(4).every(service=>service.state==='healthy'));
  assert.doesNotMatch(JSON.stringify(result),/private detail|padding/);
});

test('dependency failure and missing MCP servers do not appear healthy',async()=>{
  const result=await readCoreHealth({fetcher:async(url)=>{
    const port=Number(new URL(url).port),data=sample(port);
    if(port===8767) data.downstream.mcp_host=false;
    if(port===8772) data.servers_up=[];
    return json(data);
  }});
  assert.equal(result.services.find(service=>service.id==='portal_gateway').state,'degraded');
  assert.equal(result.services.find(service=>service.id==='mcp_host').state,'degraded');
});

test('invalid service identities/metrics are rejected and failed refreshes preserve visibly stale evidence',async()=>{
  const result=await readCoreHealth({fetcher:async(url)=>json(sample(Number(new URL(url).port)))});
  const duplicate=structuredClone(result);duplicate.services[0].id=duplicate.services[1].id;
  assert.throws(()=>parseCoreHealth(duplicate));
  const secret=structuredClone(result);secret.services[0].metrics.token='secret';
  assert.throws(()=>parseCoreHealth(secret));
  const success=liveResourceSucceeded(emptyLiveResource(),result,1000);
  assert.equal(liveResourcePresentation(success,16000,'visible').stale,true);
  const failed=liveResourceFailed(success,'Refresh unavailable',2000);
  assert.equal(failed.value,result);
  assert.equal(failed.lastGoodAt,1000);
  assert.equal(liveResourcePresentation(failed,2000,'visible').failed,true);
  assert.equal(CORE_HEALTH_SERVICES.length,8);
});

test('core health route checks access and rejects overrides before any probe',async()=>{
  const source=fs.readFileSync(new URL('../../../app/api/local-control/core-health/route.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let allowed=false,probes=0;
  const module={exports:{}};
  vm.runInNewContext(compiled,{module,exports:module.exports,require(name){
    if(name==='next/server') return {NextResponse:{json:(value,options={})=>({value,status:options.status || 200})}};
    if(name==='../../chat/_boundary') return {chatAccessError:async()=>allowed?null:{status:403}};
    if(name==='@/lib/live-status/core-health.mjs') return {cachedCoreHealth:async()=>{probes+=1;return {ok:true};}};
    throw new Error(`Unexpected import ${name}`);
  }});
  assert.equal((await module.exports.GET({nextUrl:new URL('http://localhost:3000/api/local-control/core-health')})).status,403);
  assert.equal(probes,0);
  allowed=true;
  assert.equal((await module.exports.GET({nextUrl:new URL('http://localhost:3000/api/local-control/core-health?url=http://evil.example')})).status,400);
  assert.equal(probes,0);
  assert.equal((await module.exports.GET({nextUrl:new URL('http://localhost:3000/api/local-control/core-health')})).status,200);
  assert.equal(probes,1);
});


test('memory health distinguishes canonical readiness, valid fallback degradation and unavailable startup',async()=>{
  for(const [health,state] of [
    [{ok:true,wired:true,ready:true,degraded:false,canonical:true},'healthy'],
    [{ok:true,wired:true,ready:true,degraded:true,canonical:false},'degraded'],
    [{ok:true,wired:false,ready:false,degraded:true,status:'unavailable'},'unavailable'],
    [{ok:true,wired:true,ready:false,degraded:false},'unavailable'],
    [{ok:true,wired:true},'healthy'],
  ]) {
    const result=await readCoreHealth({fetcher:async(url)=>json(Number(new URL(url).port)===8765?health:sample(Number(new URL(url).port)))});
    const memory=result.services.find(row=>row.id==='mem_server');assert.equal(memory.state,state);
    assert.equal(memory.reason,state==='healthy'?'OK':'DEPENDENCY_UNAVAILABLE');
    assert.equal(result.services.filter(row=>row.id!=='mem_server' && row.state==='healthy').length,7);
    assert.equal(Object.hasOwn(memory.metrics,'canonical'),false);
    assert.equal(Object.hasOwn(memory.metrics,'ready'),false);
  }
});
