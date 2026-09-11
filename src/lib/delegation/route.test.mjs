import assert from 'node:assert/strict';import fs from 'node:fs';import test from 'node:test';import vm from 'node:vm';import ts from 'typescript';
import * as contract from './contract.mjs';import * as nodeContract from '../../../protocol/mastermind-node-exchange/contract.mjs';
const id='4196249c-dcbd-41cc-9e6f-8b87b7b2cdda',base='https://mastermind-core.com';
function load(file,imports){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,Error,Object,Response,URL,require:n=>{if(!(n in imports))throw Error(n);return imports[n];}});return module.exports;}
function harness(owner={ok:true}){
 const calls=[];class BodyError extends Error{}class ServiceError extends Error{}
 const http=load('../node-exchange/http.ts',{'@/lib/memory/local-service-auth':{LocalServiceRequestBodyError:BodyError,readBoundedJsonRequestBody:async r=>r.text()},'../../../protocol/mastermind-node-exchange/contract.mjs':nodeContract,'./store':{NodeExchangeServiceError:ServiceError}});
 const route=load('../../app/api/contributions/[taskId]/route.ts',{
  '@/lib/db':{getMemoryDb(){calls.push('db');return {}; }},'@/lib/trading/auth':{requireOwner:async()=>owner},'@/lib/node-exchange/http':http,
  '@/lib/memory/local-family-profile.mjs':{LOCAL_FAMILY_OPERATOR_PROFILE:{householdId:'fixture',parentPlayerId:id}},
  '@/lib/delegation/contract.mjs':{...contract,taskRef:v=>contract.taskRef(JSON.parse(JSON.stringify(v)))},
  '@/lib/delegation/store.mjs':{ContributionStore:class{async list(ref){calls.push('read');return [];}async save(record){calls.push('write');return {status:'created',artifact:{record},executionAuthorized:false};}}}
 });
 return {calls,request:async(method,body,options={})=>route[method](new Request(base+'/api/contributions/'+id+(options.suffix??''),{method,headers:{origin:base,'sec-fetch-site':'same-origin','content-type':'application/json',...options.headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),{params:Promise.resolve({taskId:id})})};
}
test('owner read and contribution write use the shared task route',async()=>{
 const f=harness();assert.equal((await f.request('GET')).status,200);
 const r=await f.request('POST',{taskRef:{taskId:id,project:'mastermind'}});assert.equal(r.status,201);assert.equal((await r.json()).executionAuthorized,false);assert.deepEqual(f.calls,['db','read','db','write']);
});
test('denied identity, foreign origin, changed task and malformed JSON cannot save',async()=>{
 const denied=harness({ok:false,status:403});assert.equal((await denied.request('GET')).status,403);assert.deepEqual(denied.calls,[]);
 const foreign=harness();assert.equal((await foreign.request('POST',{}, {headers:{origin:'https://foreign.example','sec-fetch-site':'cross-site'}})).status,403);assert.deepEqual(foreign.calls,[]);
 const f=harness();assert.equal((await f.request('POST',{taskRef:{taskId:id,project:'another'}})).status,400);
 assert.equal((await f.request('POST','{')).status,400);assert.equal((await f.request('GET',null,{suffix:'?extra=1'})).status,404);assert.ok(!f.calls.includes('write'));
});
