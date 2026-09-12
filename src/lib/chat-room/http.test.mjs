import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {roomHandlers} from './http.mjs';
import * as protocol from '../../../protocol/mastermind-node-exchange/contract.mjs';

function compiled(relative,imports){
 const source=fs.readFileSync(new URL(relative,import.meta.url),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(output,{module,exports:module.exports,Error,Object,Response,Request,URL,Set,Buffer,TextDecoder,
  require:name=>{assert.ok(Object.hasOwn(imports,name),name);return imports[name];}});
 return module.exports;
}
const local=compiled('../memory/local-service-auth.ts',{'node:crypto':await import('node:crypto')});
const http=compiled('../node-exchange/http.ts',{'@/lib/memory/local-service-auth':local,
 '../../../protocol/mastermind-node-exchange/contract.mjs':protocol,'./store':{NodeExchangeServiceError:class extends Error{}}});
const params={taskId:'30000000-1111-4111-8111-111111111111',session:'room-session-001'};
const path=`/api/chat/rooms/${params.taskId}/${params.session}`;
function request(method='GET',headers={},body){return new Request('https://mastermind-core.com'+path,
 {method,headers,...(body!==undefined?{body}: {})});}
test('room HTTP denies cross-origin writes before authentication or storage',async()=>{
 let touched=false;
 const h=roomHandlers({authorizeRequest:http.authorizeOwnerRequest,authenticate:async()=>{touched=true;},storeFor:async()=>{touched=true;},readJson:http.readNodeJson});
 for(const headers of [{},{origin:'https://foreign.example','sec-fetch-site':'cross-site'},{origin:'https://mastermind-core.com'}]){
  assert.equal((await h.POST(request('POST',headers,'{}'),{params:Promise.resolve(params)})).status,403);
 }
 assert.equal(touched,false);
});
test('unauthenticated reads cannot access the room store',async()=>{
 let touched=false;
 const h=roomHandlers({authorizeRequest:http.authorizeOwnerRequest,authenticate:async()=>({ok:false,status:401}),storeFor:async()=>{touched=true;},readJson:http.readNodeJson});
 assert.equal((await h.GET(request(),{params})).status,401);assert.equal(touched,false);
});
test('authenticated reads and bounded writes use the resolved subject and no cache',async()=>{
 const seen=[];
 const h=roomHandlers({enabled:true,authorizeRequest:http.authorizeOwnerRequest,authenticate:async()=>({ok:true,userId:'user_owner'}),
  storeFor:async subject=>{seen.push(subject);return {read:async ref=>({ok:true,session:ref.session}),command:async(ref,c)=>{seen.push(c);return {ok:true,executionAuthorized:false};}};},readJson:http.readNodeJson});
 const response=await h.GET(request(),{params});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 const headers={origin:'https://mastermind-core.com','sec-fetch-site':'same-origin','content-type':'application/json'};
 assert.equal((await h.POST(request('POST',headers,'{"action":"pause"}'),{params})).status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(seen)),['user_owner','user_owner',{action:'pause'}]);
 assert.equal((await h.POST(request('POST',headers,JSON.stringify({text:'x'.repeat(66000)})),{params})).status,413);
});
test('database failures return a generic error without connection details',async()=>{
 const h=roomHandlers({enabled:true,authorizeRequest:http.authorizeOwnerRequest,authenticate:async()=>({ok:true,userId:'user_owner'}),
  storeFor:async()=>{throw Error('private connection details');},readJson:http.readNodeJson});
 const response=await h.GET(request(),{params});assert.equal(response.status,503);
 assert.equal((await response.json()).error,'ROOM_UNAVAILABLE');
});
test('the room service is disabled until the matching runtime guard is accepted',async()=>{
 let touched=false;
 const h=roomHandlers({authorizeRequest:http.authorizeOwnerRequest,authenticate:async()=>({ok:true,userId:'user_owner'}),
  storeFor:async()=>{touched=true;},readJson:http.readNodeJson});
 const response=await h.GET(request(),{params});assert.equal(response.status,503);
 assert.equal((await response.json()).error,'ROOM_SERVICE_NOT_ACTIVATED');assert.equal(touched,false);
});
