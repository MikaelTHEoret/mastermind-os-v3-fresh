import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {prepareEnrollment,enrollmentHandler} from './enrollment.mjs';
import {providerConfiguration,CATALOG_VERSION} from './providers.mjs';
import * as protocol from '../../../protocol/mastermind-node-exchange/contract.mjs';

const owner={householdId:'fixture',actorPlayerId:'20000000-1111-4111-8111-111111111111',subject:'user_fixture',role:'parent'};
const env={MASTERMIND_ROOM_ZAI_API_KEY:'synthetic-zai-secret-value',MASTERMIND_ROOM_GEMINI_API_KEY:'synthetic-gemini-secret-value'};
const now=Date.parse('2026-10-01T06:00:00Z');
const input={providers:['zai','gemini'],geminiFreeTierConfirmed:true,catalogVersion:CATALOG_VERSION};
test('preparation binds exact keys and owner without activation or secret disclosure',()=>{
 const before=JSON.stringify(env),result=prepareEnrollment(env,owner,input,now);
 assert.equal(result.activated,false);assert.equal(result.providerRequests,0);assert.equal(result.policy.allowPaid,false);
 assert.equal(result.policy.subject,owner.subject);assert.equal(result.policy.actorPlayerId,owner.actorPlayerId);
 assert.equal(result.policy.providers.zai.credentialSha256,createHash('sha256').update(env.MASTERMIND_ROOM_ZAI_API_KEY).digest('hex'));
 assert.equal(Date.parse(result.policy.expiresAt)-now,86400000);
 for(const key of Object.values(env))assert.equal(JSON.stringify(result).includes(key),false);
 assert.equal(JSON.stringify(env),before);
 const configured={...env,MASTERMIND_ROOM_API_POLICY:JSON.stringify(result.policy)};
 assert.ok(providerConfiguration(configured,owner,now).entries.every(x=>!x.ready));
 configured.MASTERMIND_ROOM_API_ENABLED='true';
 assert.deepEqual(providerConfiguration(configured,owner,now).entries.map(x=>x.ready),[true,true,false]);
 assert.ok(providerConfiguration(configured,{...owner,subject:'user_other'},now).entries.every(x=>!x.ready));
 assert.ok(providerConfiguration(configured,owner,now+86400000).entries.every(x=>!x.ready));
 configured.MASTERMIND_ROOM_ZAI_API_KEY='different-synthetic-secret';
 assert.equal(providerConfiguration(configured,owner,now).entries[0].ready,false);
});
test('one-provider proposal does not enroll another provider or invent tier confirmation',()=>{
 const single={providers:['zai'],geminiFreeTierConfirmed:false,catalogVersion:CATALOG_VERSION};
 assert.deepEqual(Object.keys(prepareEnrollment({MASTERMIND_ROOM_ZAI_API_KEY:env.MASTERMIND_ROOM_ZAI_API_KEY},owner,single,now).policy.providers),['zai']);
 for(const bad of [{...input,geminiFreeTierConfirmed:false},{...single,geminiFreeTierConfirmed:true}])assert.throws(()=>prepareEnrollment(env,owner,bad,now),/FREE_TIER_REQUIRED/);
});
test('unsupported models, keys, identity overrides, paid fields and stale catalog are rejected',()=>{
 for(const bad of [{...input,allowPaid:true},{...input,subject:'user_other'},{...input,key:'injected'},
  {...input,providers:['zai','zai']},{...input,providers:['unknown']},{...input,providers:[]},
  {...input,catalogVersion:'old'},null,[],{...input,geminiFreeTierConfirmed:'true'}])assert.throws(()=>prepareEnrollment(env,owner,bad,now));
 for(const role of ['child','guest',undefined])assert.throws(()=>prepareEnrollment(env,{...owner,role},input,now),/OWNER_REQUIRED/);
 for(const key of ['', 'short', 'x'.repeat(4097), 'synthetic-secret\nvalue',' leading-synthetic-secret','trailing-synthetic-secret ','synthetic-\ud800-value'])assert.throws(()=>prepareEnrollment({...env,MASTERMIND_ROOM_ZAI_API_KEY:key},owner,input,now),/KEY_UNAVAILABLE/);
});
function compiled(relative,imports){
 const source=fs.readFileSync(new URL(relative,import.meta.url),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};vm.runInNewContext(output,{module,exports:module.exports,Error,Object,Response,Request,URL,Set,Buffer,TextDecoder,
  require:name=>{assert.ok(Object.hasOwn(imports,name),name);return imports[name];}});return module.exports;
}
const local=compiled('../memory/local-service-auth.ts',{'node:crypto':await import('node:crypto')});
const http=compiled('../node-exchange/http.ts',{'@/lib/memory/local-service-auth':local,
 '../../../protocol/mastermind-node-exchange/contract.mjs':protocol,'./store':{NodeExchangeServiceError:class extends Error{}}});
const url='https://mastermind-core.com/api/chat/connections/prepare';
const headers={origin:'https://mastermind-core.com','sec-fetch-site':'same-origin','content-type':'application/json'};
const request=(body=input,more={})=>new Request(url,{method:'POST',headers,body:JSON.stringify(body),...more});
const deps={enabled:true,authorizeRequest:http.authorizeOwnerRequest,readJson:http.readNodeJson,
 authenticate:async()=>({ok:true,userId:owner.subject}),identityFor:async()=>owner,environment:()=>env,now:()=>now};
test('real request boundary denies origin/method/path, unauthenticated and disabled requests before secret access',async()=>{
 let reads=0;const privateEnv=()=>{reads++;return env;};
 for(const req of [request(input,{headers:{}}),request(input,{headers:{...headers,origin:'https://foreign.example'}}),
  request(input,{headers:{...headers,'sec-fetch-site':'cross-site'}}),new Request(url),new Request(url+'?x=1',{method:'POST',headers,body:'{}'})]){
  const result=await enrollmentHandler({...deps,environment:privateEnv})(req);assert.ok(result.status>=400);
 }
 for(const override of [{authenticate:async()=>({ok:false,status:401})},{authenticate:async()=>({ok:false,status:403})},{enabled:false}]){
  const result=await enrollmentHandler({...deps,...override,environment:privateEnv})(request());assert.ok(result.status>=400);
 }
 assert.equal(reads,0);
});
test('body is bounded, no caching, canonical subject overrides identity metadata, errors hide internals',async()=>{
 const handler=enrollmentHandler({...deps,identityFor:async()=>({...owner,subject:'user_wrong'})});
 const response=await handler(request());assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal((await response.json()).policy.subject,owner.subject);
 const oversized=await handler(request({filler:'x'.repeat(2100)}));assert.equal(oversized.status,413);
 const failure=await enrollmentHandler({...deps,identityFor:async()=>{throw Error(env.MASTERMIND_ROOM_ZAI_API_KEY);}})(request());
 assert.equal(failure.status,503);assert.equal((await failure.text()).includes(env.MASTERMIND_ROOM_ZAI_API_KEY),false);
});
