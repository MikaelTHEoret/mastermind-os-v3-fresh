import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as policy from '../capture-policy.mjs';
import {inspectApiBoundary} from '../../auth/api-boundary.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',secret='a'.repeat(43),origin='chrome-extension://'+'a'.repeat(32),foreign='chrome-extension://'+'b'.repeat(32);
const hash=crypto.createHash('sha256').update(secret).digest('hex');
const baseHeaders={host:'localhost:3000',origin,'sec-fetch-site':'cross-site','x-mastermind-capture-client':id,'x-mastermind-capture-secret':secret};
function request(path='acquisition',method='GET',headers={},query=method==='GET'?'?clientId='+id:''){
 const req=new Request('http://localhost:3000/api/genealogy/'+path+query,{method,headers:{...baseHeaders,...headers}});Object.defineProperty(req,'nextUrl',{value:new URL(req.url)});return req;
}
const compiled=new Map();
function load(path,dependencies,env={}){
 if(!compiled.has(path))compiled.set(path,ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText);
 const module={exports:{}};class NextResponse extends Response{static json(body,init){return new NextResponse(JSON.stringify(body),{...init,headers:{'content-type':'application/json',...init?.headers}});}}
 const context={module,exports:module.exports,Buffer,File,URL,console,process:{env},fetch(){throw Error('NO_PROVIDER_EXECUTION');},require(key){if(key==='next/server')return{NextResponse};if(key==='node:crypto')return crypto;if(key.endsWith('capture-policy.mjs'))return policy;if(key==='sharp')return()=>{throw Error('NO_IMAGE_EXECUTION');};if(key in dependencies)return dependencies[key];throw Error(key);}};
 vm.runInNewContext(compiled.get(path),context);return module.exports;
}
function system({status='approved',storedOrigin=origin,storedHash=hash,exists=true,env={}}={}){
 const queries=[];let bodies=0;
 async function sql(strings,...values){const text=strings.join('?');queries.push({text,values});
  if(text.includes('SELECT client_id,extension_origin,secret_sha256,status'))return exists?[{client_id:id,extension_origin:storedOrigin,secret_sha256:storedHash,status}]:[];
  if(text.includes('SELECT status,label,approved_at'))return[{status,label:'Fixture'}];
  if(text.includes('FROM genealogy_crawl_jobs'))return[{id:7,objective:'Fixture job'}];
  if(text.includes('INSERT INTO genealogy_capture_clients'))return[{status:'pending',label:'Fixture'}];
  return[];
 }
 const dependencies={'@/lib/db':{getMemoryDb:()=>sql},'./archive-store.mjs':{captureSecretMatches:(value,digest)=>typeof digest==='string'&&crypto.createHash('sha256').update(value).digest('hex')===digest},'@/lib/genealogy/archive-store.mjs':{archiveStoreContract:{maxImageBytes:1024},persistArchiveImage(){throw Error('NO_FILES');},readArchiveImage(){throw Error('NO_FILES');}},'@/lib/trading/auth':{ownerGateConfigured:()=>true,requireOwner:async()=>({ok:false,reason:'OWNER_REQUIRED',status:403})}};
 const auth=load('../capture-access.ts',dependencies,env);dependencies['@/lib/genealogy/capture-access']=auth;
 const handlers={};for(const lane of ['acquisition','index','extract'])handlers[lane]=load(`../../../app/api/genealogy/${lane}/route.ts`,dependencies,{OPENAI_API_KEY:'fixture-only',...env});
 return{auth,handlers,queries,bodies:()=>bodies,body(req){req.formData=async()=>{bodies++;return new FormData();};return req;}};
}
test('exact local protocol admits the extension real GET/JSON/multipart operations only',()=>{
 const dev={NODE_ENV:'development'};
 for(const req of [request(),request('acquisition','POST',{'content-type':'application/json'}),...['acquisition','index','extract'].map(lane=>request(lane,'POST',{'content-type':'multipart/form-data; boundary=fixture'}))]){
  assert.equal(policy.captureRequestAllowed(req),true);assert.equal(inspectApiBoundary(req,dev).kind,'local-capture-protocol');assert.equal(inspectApiBoundary(req,{...dev,VERCEL:'1'}).kind,'denied');
 }
 for(const req of [request('index'),request('extract','PUT'),request('other','POST',{'content-type':'multipart/form-data'}),request('index','POST',{'content-type':'application/json'}),request('index','POST',{'content-type':'multipart/form-data','x-mastermind-capture-secret':''}),request('acquisition','GET',{},'?clientId='+other),request('acquisition','GET',{},'?clientId='+id+'&clientId='+id),request('acquisition','GET',{origin:'https://foreign.example'}),request('acquisition','GET',{host:'evil.example'})])assert.equal(inspectApiBoundary(req,dev).kind,'denied');
});
test('preflight binds exact paths, methods and header allowlist; never grants another API',async()=>{
 for(const lane of ['acquisition','index','extract']){
  const headers={'access-control-request-method':'POST','access-control-request-headers':'content-type,x-mastermind-capture-client,x-mastermind-capture-secret'};
  const req=request(lane,'OPTIONS',headers);assert.equal(policy.captureRequestAllowed(req),true);
  const response=await system().handlers[lane].OPTIONS(req);assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),origin);
  for(const change of [{'access-control-request-method':'DELETE'},{'access-control-request-headers':'content-type,authorization'},{origin:'null'},{host:'other.example'}])assert.equal((await system().handlers[lane].OPTIONS(request(lane,'OPTIONS',{...headers,...change}))).status,403);
 }
 assert.equal(policy.captureRequestAllowed(request('index','OPTIONS',{'access-control-request-method':'POST','access-control-request-headers':'content-type'})),false);
 assert.equal(policy.captureRequestAllowed(request('acquisition','OPTIONS',{'access-control-request-method':'POST','access-control-request-headers':'content-type'})),true);
});
test('shared verifier binds UUID, status, exact stored origin and matching secret',async()=>{
 for(const options of [{exists:false},{status:'pending'},{status:'revoked'},{storedOrigin:foreign},{storedHash:'0'.repeat(64)}])assert.equal(await system(options).auth.authenticateCaptureClient(request()),null);
 const s=system();assert.equal((await s.auth.authenticateCaptureClient(request())).clientId,id);
 for(const headers of [{'x-mastermind-capture-secret':''},{'x-mastermind-capture-client':'bad'},{origin:'https://foreign.example'}]){const f=system();assert.equal(await f.auth.authenticateCaptureClient(request('acquisition','GET',headers)),null);assert.equal(f.queries.length,0);}
});
test('acquisition GET never returns jobs for missing/wrong credentials or a different query client',async()=>{
 for(const headers of [{'x-mastermind-capture-secret':''},{'x-mastermind-capture-secret':'b'.repeat(43)},{origin:foreign}]){
  const s=system(),r=await s.handlers.acquisition.GET(request('acquisition','GET',headers));assert.equal(r.status,401);assert.ok(!s.queries.some(q=>q.text.includes('FROM genealogy_crawl_jobs')));
 }
 const s=system();assert.equal((await s.handlers.acquisition.GET(request('acquisition','GET',{},'?clientId='+other))).status,401);assert.equal(s.queries.length,0);
});
test('only authenticated approved polling receives jobs; pending/revoked receives bounded status',async()=>{
 for(const status of ['approved','pending','revoked']){
  const s=system({status}),response=await s.handlers.acquisition.GET(request()),result=await response.json();assert.equal(response.status,200);assert.equal(result.pairing.status,status);assert.equal(result.jobs.length,status==='approved'?1:0);assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.ok(s.queries.some(q=>q.text.includes('AND extension_origin=')&&q.values.includes(origin)));
 }
});
test('index/extract deny before reading image bodies or invoking any provider',async()=>{
 for(const lane of ['index','extract'])for(const status of ['pending','revoked','approved']){
  const s=system({status}),req=s.body(request(lane,'POST',{'content-type':'multipart/form-data; boundary=fixture','x-mastermind-capture-secret':status==='approved'?'b'.repeat(43):secret}));
  assert.equal((await s.handlers[lane].POST(req)).status,401);assert.equal(s.bodies(),0);
 }
});
test('approved exact extension credentials reach input validation with readable CORS, not model execution',async()=>{
 for(const lane of ['index','extract']){const s=system(),response=await s.handlers[lane].POST(s.body(request(lane,'POST',{'content-type':'multipart/form-data; boundary=fixture'})));assert.equal(response.status,400);assert.equal(s.bodies(),1);assert.equal(response.headers.get('access-control-allow-origin'),origin);}
});
test('hosted, foreign origins and sibling ports cannot invoke direct local handlers',async()=>{
 for(const lane of ['acquisition','index','extract']){
  assert.equal((await system({env:{VERCEL:'1'}}).handlers[lane].POST(request(lane,'POST',{'content-type':'application/json'}))).status,403);
  for(const originValue of ['https://foreign.example','http://localhost:3001','chrome-extension://invalid']){
   const s=system();assert.equal((await s.handlers[lane].POST(request(lane,'POST',{origin:originValue,'content-type':'application/json'}))).status,403);assert.equal(s.queries.length,0);
  }
 }
 for(const originValue of ['https://foreign.example','http://localhost:3001'])assert.equal((await system().handlers.acquisition.GET(request('acquisition','GET',{origin:originValue},''))).status,403);
});
test('registration only creates a pending identity and cannot act as owner approval',async()=>{
 const s=system(),req=request('acquisition','POST',{'content-type':'application/json'});req.json=async()=>({action:'register_client',clientId:id,secretSha256:hash,label:'Fixture'});
 const response=await s.handlers.acquisition.POST(req);assert.equal(response.status,202);assert.equal((await response.json()).pairing.status,'pending');assert.ok(!s.queries.some(q=>q.text.includes('UPDATE genealogy_capture_clients SET status=')));
 const denied=request('acquisition','POST',{'content-type':'application/json'});denied.json=async()=>({action:'approve_client',clientId:id});assert.equal((await s.handlers.acquisition.POST(denied)).status,403);
});
