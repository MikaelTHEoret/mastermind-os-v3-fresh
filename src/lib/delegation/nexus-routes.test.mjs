import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {randomUUID} from 'node:crypto';
import * as contract from './contract.mjs';import * as protocol from '../../../protocol/mastermind-node-exchange/contract.mjs';
const taskId=randomUUID(),base='https://mastermind-core.com',path='/api/nexus/'+taskId,nodeId=randomUUID();
const plain=v=>JSON.parse(JSON.stringify(v));
function load(file,imports,env={}){
 const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,Error,Object,Response,URL,process:{env},require:id=>{if(!(id in imports))throw Error(id);return imports[id];}});return module.exports;
}
function fixture({allowed=true,enabled=true,fail=false}={}){
 const calls=[];class BodyError extends Error{status=413;code='BODY_TOO_LARGE';}class ServiceError extends Error{};
 const http=load('../node-exchange/http.ts',{
  '@/lib/memory/local-service-auth':{LocalServiceRequestBodyError:BodyError,async readBoundedJsonRequestBody(request,{maxBytes}){const s=await request.text();if(Buffer.byteLength(s)>maxBytes)throw new BodyError('too large');return s;}},
  '../../../protocol/mastermind-node-exchange/contract.mjs':protocol,'./store':{NodeExchangeServiceError:ServiceError}});
 const sql={query(){throw Error('unused');}};
 class Service{constructor(q,owner,opts){calls.push(['construct',plain(owner),opts.enabled]);this.opts=opts;}async read(ref,args){calls.push(['read',plain(ref),plain(args)]);if(fail)throw Error('private database path');return {artifact:null,executionAuthorized:false};}async write(ref,body){calls.push(['write',plain(ref),plain(body)]);return {executionAuthorized:false};}}
 const route=load('../../app/api/nexus/[taskId]/route.ts',{
  '@/lib/db':{getMemoryDb:()=>sql},'@/lib/trading/auth':{requireOwner:async()=>allowed?{ok:true,userId:'user_fixture'}:{ok:false,status:403}},
  '@/lib/node-exchange/http':http,'@/lib/node-exchange/store':{OWNER_NODE_PROFILE:{householdId:'fixture',parentPlayerId:randomUUID()},NodeExchangeServiceError:ServiceError},
  '@/lib/delegation/contract.mjs':{...contract,taskRef:r=>contract.taskRef(plain(r))},'@/lib/delegation/nexus-hosted-service.mjs':{NexusHostedService:Service},
  '../../../../../protocol/mastermind-node-exchange/native-nexus.mjs':{NEXUS:'mastermind.native.nexus'}},{MASTERMIND_NEXUS_ENABLED:enabled?'1':'0'});
 const send=(method,body=null,headers={},suffix='')=>route[method](new Request(base+path+suffix,{method,headers:{origin:base,'sec-fetch-site':'same-origin','content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({taskId})});
 return {calls,send};
}
test('Nexus routes authenticate and reject cross-origin before touching private services',async()=>{
 for(const method of ['GET','POST']){const no=fixture({allowed:false});assert.equal((await no.send(method)).status,403);assert.equal(no.calls.length,0);
 const cross=fixture();assert.equal((await cross.send(method,null,{origin:'https://foreign.invalid','sec-fetch-site':'cross-site'})).status,403);assert.equal(cross.calls.length,0);}
});
test('owner mapping is server supplied; bounded input and exact recovery selection enforced',async()=>{
 const f=fixture();assert.equal((await f.send('GET',null,{},'?operationId='+randomUUID())).status,200);assert.equal(f.calls[0][1].clerkSubject,'user_fixture');assert.equal(f.calls[1][1].taskId,taskId);
 for(const suffix of ['?proof=true','?jobId='+randomUUID()+'&jobId='+randomUUID()])assert.equal((await fixture().send('GET',null,{},suffix)).status,404);
 const huge=fixture();assert.notEqual((await huge.send('POST',{source:'x'.repeat(19000)})).status,200);assert.equal(huge.calls.filter(c=>c[0]==='write').length,0);
});
test('disabled creation is conveyed to service, recovery stays accessible and internal errors are hidden',async()=>{
 const off=fixture({enabled:false});assert.equal((await off.send('GET')).status,200);assert.equal(off.calls[0][2],false);
 const bad=fixture({fail:true}),response=await bad.send('GET');assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private database/);
});
