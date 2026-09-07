import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled=ts.transpileModule(fs.readFileSync(new URL('../route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class BodyError extends Error {constructor(status){super('bounded body');this.status=status;}}
function route({allowed=true,fetcher=async()=>new Response('{}'),environment={}}={}) {
  const module={exports:{}};
  vm.runInNewContext(compiled,{module,exports:module.exports,URL,URLSearchParams,TextDecoder,AbortSignal,process:{env:environment},fetch:fetcher,require(name){
    if(name==='next/server') return {NextResponse:{json:(value,options={})=>({value,status:options.status || 200})}};
    if(name==='../chat/_boundary') return {chatAccessError:async()=>allowed?null:{status:403}};
    if(name==='@/lib/memory/local-service-auth') return {LocalServiceRequestBodyError:BodyError,readBoundedJsonRequestBody:async(req,{maxBytes})=>{const text=await req.text();if(Buffer.byteLength(text)>maxBytes)throw new BodyError(413);return text;}};
    throw new Error(`Unexpected import ${name}`);
  }});
  return module.exports;
}
const request=(body,url='http://localhost:3000/api/modules')=>new Request(url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

test('module reads and actions enforce the local boundary before private data or input processing',async()=>{
  let calls=0;
  const api=route({allowed:false,fetcher:()=>{calls+=1;throw new Error('must not access');}});
  assert.equal((await api.GET(request())).status,403);
  assert.equal((await api.POST({text:()=>{throw new Error('must not parse');}})).status,403);
  assert.equal(calls,0);
});

test('the generation bridge proposes once and never sends approval implicitly',async()=>{
  const calls=[];
  const api=route({fetcher:async(url,options)=>{calls.push({url,options});return json({ok:true,proposal:{id:'audit.example',gate:'pending'}});}});
  const result=await api.POST(request({action:'generate',id:'audit.example',description:'Normalize whitespace'}));
  assert.equal(result.value.proposal.gate,'pending');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'http://127.0.0.1:8770/generate');
  assert.equal(calls[0].options.redirect,'error');
});

test('nested call arguments and expected approval hashes survive forwarding',async()=>{
  const bodies=[];
  const api=route({fetcher:async(url,options)=>{bodies.push(JSON.parse(options.body));return json({ok:false,error:'fixture rejection'},409);}});
  const call={action:'call',capability:'audit.example.normalize',args:[' Mixed CASE '],kwargs:{lowercase:false,nested:{enabled:true}}};
  assert.equal((await api.POST(request(call))).status,409);
  assert.deepEqual(bodies[0],{capability:call.capability,args:call.args,kwargs:call.kwargs});
  await api.POST(request({action:'approve',id:'audit.example',expectedHash:'a'.repeat(64)}));
  assert.equal(bodies[1].expectedHash,'a'.repeat(64));
});

test('invalid/oversized objects, prototype action names, and unsafe kernel targets are rejected',async()=>{
  let calls=0;const fetcher=async()=>{calls+=1;return json({ok:true});};
  const api=route({fetcher});
  for(const body of ['{broken',[],{action:'toString'},{action:'constructor'}]) assert.equal((await api.POST(request(body))).status,400);
  assert.equal((await api.POST(request({action:'generate',description:'x'.repeat(131073)}))).status,413);
  assert.equal(calls,0);
  const unsafe=route({fetcher,environment:{MODULE_CORE_URL:'https://evil.example'}});
  assert.equal((await unsafe.POST(request({action:'call',capability:'test'}))).status,502);
  assert.equal(calls,0);
});

test('inventory does not claim success for failed upstream status; proposal reads are bounded to a module identifier',async()=>{
  const bad=route({fetcher:async()=>json({error:'unavailable'},503)});
  assert.equal((await bad.GET(request())).status,502);
  const calls=[];
  const api=route({fetcher:async(url)=>{calls.push(url);return json({ok:true,source:'fixture',sourceHash:'a'.repeat(64)});}});
  assert.equal((await api.GET(request(undefined,'http://localhost:3000/api/modules?action=proposal&id=../../file'))).status,400);
  assert.equal(calls.length,0);
  assert.equal((await api.GET(request(undefined,'http://localhost:3000/api/modules?action=proposal&id=audit.example'))).status,200);
  assert.equal(calls[0],'http://127.0.0.1:8770/proposal?id=audit.example');
});

test('native history reads reject duplicate, extra and escaping selectors before private access',async()=>{
  const calls=[];const api=route({fetcher:async(url)=>{calls.push(url);return json({ok:true});}});
  for(const query of ['action=wizard_catalog&action=wizard_catalog','action=specifications&path=private',
    'action=specification&specificationId=../secret','action=candidate&id=release-inventory&candidateId=main']) {
    assert.equal((await api.GET(request(undefined,'http://localhost:3000/api/modules?'+query))).status,400);
  }
  assert.equal(calls.length,0);
  const hash='a'.repeat(64);
  assert.equal((await api.GET(request(undefined,`http://localhost:3000/api/modules?action=specification&specificationId=${hash}`))).status,200);
  assert.equal(calls[0],`http://127.0.0.1:8770/specification?specificationId=${hash}`);
});

test('native activation retains the reviewed operation and revision and never retries uncertain effects',async()=>{
  const calls=[];const api=route({fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});throw new Error('lost reply');}});
  const command={action:'candidate_promote',id:'release-inventory',candidateId:'b'.repeat(64),expectedActiveRevision:'a'.repeat(64),operationId:'fixture-operation'};
  assert.equal((await api.POST(request(command))).status,502);
  assert.equal(calls.length,1);
  assert.equal(calls[0].body.expectedActiveRevision,command.expectedActiveRevision);
  assert.equal(calls[0].body.operationId,command.operationId);
});
