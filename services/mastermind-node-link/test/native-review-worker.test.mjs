import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createMastermindCoreOnlyWorker} from '../src/core-worker.mjs';
import {createMastermindCoreWorkerFromEnvironment} from '../src/run-core-worker.mjs';
import {NativeTaskClient,NATIVE_REVIEW_ENDPOINT} from '../src/native-task-client.mjs';
import {FileMastermindNodeEffectJournal} from '../src/effect-journal.mjs';
import * as legacy from '../../../protocol/mastermind-node-exchange/contract.mjs';
import * as v2 from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import {NATIVE_REVIEW_CAPABILITY as CAP,validateNativeReviewReceipt,validateNativeReviewInput,reviewContentHash,reviewCanonical,encodeNativeReviewInput,encodeNativeReviewRecovery,nativeReviewContent} from '../../../protocol/mastermind-node-exchange/native-review.mjs';
import {reviewInput,reviewReply,reviewText} from '../../../protocol/mastermind-node-exchange/review-fixture.mjs';
import {NODE_ID,NODE_CREDENTIAL,PAIRING_ID,BOOT_ID,JOB_ID,command,lease} from './fixtures.mjs';
const AT='2026-08-15T04:00:02.000Z';
const inventory=JSON.parse(await fs.readFile(new URL('../../../protocol/mastermind-node-exchange/review-inventory-fixture.json',import.meta.url),'utf8'));
const request=()=>reviewInput(JOB_ID);
const reviewCommand=(input=request())=>command({capability:CAP,capabilityVersion:input.schemaVersion,input});
const reviewLease=(input=request())=>{const c=reviewCommand(input);return lease({...c,commandDigest:v2.digestMastermindNodeCommand(c)});};
async function setup(t,behavior,input=request()) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mm-review-worker-'));
 t.after(async()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const calls=[],sent=[];
 const native=new NativeTaskClient({now:()=>1,fetchImpl:async(url,init)=>{
  assert.equal(url,NATIVE_REVIEW_ENDPOINT);assert.equal(init.redirect,'error');const body=JSON.parse(init.body);calls.push(body.action);
  assert.deepEqual(Object.keys(body).sort(),['schemaVersion','action','operationId','specificationId','content'].sort());
  if(behavior)return behavior(body,calls.length);const reply=reviewReply(body,body.action==='recover');reply.review.originalRequest=input.originalRequest;return Response.json(reply);
 }});
 const make=(enabled=true,lossless=input.schemaVersion>=2,recovery=input.schemaVersion===3)=>{const journal=new FileMastermindNodeEffectJournal(root,{now:()=>Date.parse(AT)});return {journal,
  worker:createMastermindCoreOnlyWorker({journalRoot:root,journal,enableNativeTasks:true,enableNativeSpecifications:true,enableNativeReviews:enabled,enableReviewReuse:input.schemaVersion>=2&&enabled,enableDevelopmentWork:input.schemaVersion>=2&&enabled,enableLosslessReviews:lossless&&enabled,enableBuildDispatch:recovery&&enabled,enableReviewRecovery:recovery&&enabled,
   nativeTaskClient:native,bootId:BOOT_ID,now:()=>Date.parse(AT),monotonicNow:()=>1,
   credentialStore:{async load(){return {schemaVersion:1,state:'paired',nodeId:NODE_ID,nodeCredential:NODE_CREDENTIAL,pairingId:PAIRING_ID,pairingCredential:null,displayName:'Fixture',createdAt:AT,pairedAt:AT};}},
   exchangeTransport:{async pair(){throw Error('must not pair');},async exchange(req){sent.push(req);return {schemaVersion:2,exchangeId:req.exchangeId,serverTime:AT,nextPollAfterMs:5000,
    acceptedWorker:enabled?(recovery?v2.REVIEW_RECOVERY_CORE_WORKER:input.schemaVersion>=2?(lossless?v2.LOSSLESS_DEVELOPMENT_CORE_WORKER:v2.DEVELOPMENT_CORE_WORKER):v2.REVIEW_CORE_WORKER):v2.WIZARD_CORE_WORKER,acknowledgedReceiptIds:req.receipts.map(r=>r.receiptId),lease:reviewLease(input)};}}
  })};};return {make,calls,sent};
}
test('review is opt-in, task-bound, size-bounded and carries no caller authority',()=>{
 assert.throws(()=>legacy.validateMastermindNodeCommand(reviewCommand()));
 assert.deepEqual(v2.validateMastermindNodeCommand(reviewCommand()),reviewCommand());
 assert.equal(v2.WIZARD_CORE_WORKER.capabilities.some(c=>c.id===CAP),false);
 for(const change of [{source:{path:'private'}},{accepted:true},{operationId:BOOT_ID},{action:'recover'},
  {taskRef:{taskId:'generic',project:'mastermind'}},{parentOperationId:JOB_ID}])assert.throws(()=>v2.validateMastermindNodeCommand(reviewCommand({...request(),...change})));
 const floats=request();floats.content.requirements.tests.cases[0].expected=1.5;assert.throws(()=>validateNativeReviewInput(floats));
 const large=request();large.content.requirements.requirements=['💡'.repeat(3900),'x'.repeat(2000)];assert.throws(()=>validateNativeReviewInput(large));
 const source=request();source.content.source={path:'foreign'};assert.throws(()=>validateNativeReviewInput(source));
 assert.equal(reviewCanonical({'\u{10000}':1,'\ue000':2}),'{'+'"\ue000":2,"\u{10000}":1}');
});
test('review prepares once and reauthorizes its private receipt after real journal reload',async t=>{
 const f=await setup(t),first=f.make();const outcome=await first.worker.runOnce();assert.equal(outcome.execution.receipt.state,'succeeded');
 assert.equal(outcome.execution.receipt.result.accepted,false);assert.equal(outcome.execution.receipt.result.content,undefined);await first.worker.stop();
 const next=f.make();assert.equal((await next.worker.runOnce()).execution.replayed,true);assert.deepEqual(f.calls,['prepare','recover','recover']);await next.worker.stop();
});
for(const failure of ['lost','http','altered','fresh-recovery'])test(`${failure} reply cannot repeat preparation`,async t=>{
 const f=await setup(t,(input,count)=>{if(count===1){if(failure==='lost')throw Error('private');if(failure==='http')return Response.json({}, {status:503});
  const r=reviewReply(input);r.review.contentSha256='f'.repeat(64);return Response.json(r);}
  return Response.json(reviewReply(input,failure!=='fresh-recovery'));});
 const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await first.worker.stop();const next=f.make();
 if(failure==='fresh-recovery')await assert.rejects(next.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});else assert.equal((await next.worker.runOnce()).execution.receipt.state,'succeeded');
 assert.deepEqual(f.calls,['prepare','recover']);await next.worker.stop();
});
for(const reason of ['revoked','changed'])test(`${reason} review context blocks cached outbox disclosure`,async t=>{
 const f=await setup(t,(input,count)=>{if(count===1)return Response.json(reviewReply(input));if(reason==='revoked')return Response.json({}, {status:403});
  const r=reviewReply(input,true);r.review.state='held';r.review.holds=['SPEC_REVIEW_TASK_SNAPSHOT_CHANGED'];return Response.json(r);});
 const first=f.make();await first.worker.runOnce();await first.worker.stop();const next=f.make();await assert.rejects(next.worker.runOnce());assert.equal(f.sent.length,1);await next.worker.stop();
});
test('large complete review survives ledger wire and real journal restart without truncation',async t=>{
 const input=request();input.content.requirements.requirements=Array.from({length:3},()=> 'é'.repeat(1500));
 const f=await setup(t,undefined,input),first=f.make();await first.worker.runOnce();await first.worker.stop();const next=f.make();assert.equal((await next.worker.runOnce()).execution.replayed,true);await next.worker.stop();
});
test('unenrolled review capability never calls local intake',async t=>{const f=await setup(t),{worker}=f.make(false);await assert.rejects(worker.runOnce());assert.equal(f.calls.length,0);await worker.stop();});
test('invalid review activation fails before credential access',()=>{for(const setting of ['yes',true,'true']){let calls=0;assert.throws(()=>createMastermindCoreWorkerFromEnvironment({environment:{LOCALAPPDATA:'C:\\Fixture',MASTERMIND_NODE_WORKER_PROFILE:'core-only',MASTERMIND_LOCAL_CHILD_ROLE:'mastermind-node-link-core',MASTERMIND_NODE_NATIVE_REVIEW_ENABLED:setting},credentialStoreFactory(){calls++;}}),{code:'NODE_NATIVE_PROFILE_INVALID'});assert.equal(calls,0);}});
test('receipt rejects changed content, request, authority and paths',async()=>{
 const input=request(),client=new NativeTaskClient({now:()=>1,fetchImpl:async()=>Response.json(reviewReply(input))});
 const result=await client.review(input,{deadlineMs:1000});validateNativeReviewReceipt(result,input);
 for(const changed of [{contentSha256:'f'.repeat(64)},{operationId:BOOT_ID},{source:'private'},{accepted:true},{executionAuthorized:true},{state:'held'}])assert.throws(()=>validateNativeReviewReceipt({...result,...changed},input));
 for(const changed of [{originalRequest:reviewText+' changed'},{content:{...input.content,mode:'extend'}}]){
  const other=new NativeTaskClient({now:()=>1,fetchImpl:async()=>{const r=reviewReply(input);Object.assign(r.review,changed);return Response.json(r);}});
  await assert.rejects(other.review(input,{deadlineMs:1000}),{code:'TASK_REVIEW_INVALID'});
 }
 assert.equal(result.contentSha256,reviewContentHash(input.content));
});

function fullReview(){const v=request();v.content.mode='extend';v.content.expectedActiveRevision='c'.repeat(64);
 v.content.requirements={...structuredClone(inventory),taskRef:v.taskRef};return v;}
test('lossless review retains all 18 cases including NUL through actual worker and journal restart',async t=>{
 const original=fullReview(),input=encodeNativeReviewInput(original);
 assert.deepEqual(nativeReviewContent(input),original.content);
 assert.throws(()=>validateNativeReviewInput(original));
 const f=await setup(t,undefined,input),first=f.make();
 assert.equal((await first.worker.runOnce()).execution.receipt.state,'succeeded');await first.worker.stop();
 const next=f.make();assert.equal((await next.worker.runOnce()).execution.replayed,true);await next.worker.stop();
 assert.deepEqual(f.calls,['prepare','recover','recover']);
 assert.equal(nativeReviewContent(input).requirements.tests.cases.length,18);
 assert.equal(nativeReviewContent(input).requirements.tests.cases.find(c=>c.id==='nul-path').input.before[0].path,'src/\0.py');
});
test('lossless transport rejects altered canonical encoding, bad numbers and NUL outside example values',()=>{
 const input=encodeNativeReviewInput(fullReview());
 for(const content of [input.content+' ',input.content.replace('"schemaVersion":1','"schemaVersion":1.0'),'not JSON'])assert.throws(()=>validateNativeReviewInput({...input,content}));
 for(const field of ['moduleId','version']){const v=fullReview();v.content.requirements[field]+='\0';assert.throws(()=>encodeNativeReviewInput(v));}
 const key=fullReview();key.content.requirements.tests.cases[0].input['\0']='x';assert.throws(()=>encodeNativeReviewInput(key));
 const float=fullReview();float.content.requirements.tests.cases[0].input={n:1.5};assert.throws(()=>encodeNativeReviewInput(float));
 const large=fullReview();large.content.requirements.requirements.push('x'.repeat(20000));assert.throws(()=>encodeNativeReviewInput(large));
 const mismatch=reviewCommand(input);mismatch.capabilityVersion=1;assert.throws(()=>v2.validateMastermindNodeCommand(mismatch));
});
test('lossless review does not treat escaped text as a NUL and verifies native receipt content',async()=>{
 const v=fullReview(),testCase=v.content.requirements.tests.cases.find(c=>c.id==='nul-path');testCase.input.before[0].path='src/\\u0000.py';
 const input=encodeNativeReviewInput(v);assert.equal(nativeReviewContent(input).requirements.tests.cases.find(c=>c.id==='nul-path').input.before[0].path,'src/\\u0000.py');
 const client=new NativeTaskClient({now:()=>1,fetchImpl:async(_url,init)=>{const body=JSON.parse(init.body),reply=reviewReply(body);reply.review.originalRequest=input.originalRequest;reply.review.content.requirements.tests.cases[0].input={changed:true};return Response.json(reply);}});
 await assert.rejects(client.review(input,{deadlineMs:1000}),{code:'TASK_REVIEW_INVALID'});
});

test('lossless encoder rejects values that JSON serialization would silently change',()=>{
 for(const n of [-0,NaN,Infinity,-Infinity,undefined]){const v=fullReview();v.content.requirements.tests.cases[0].input={n};assert.throws(()=>encodeNativeReviewInput(v));}
});

function recoveryInput(){const old=fullReview();old.operationId=BOOT_ID;return encodeNativeReviewRecovery(encodeNativeReviewInput(old),JOB_ID);}
test('fresh review delivery always recovers the original native operation and survives restart',async t=>{
 const input=recoveryInput(),operations=[];
 const f=await setup(t,body=>{operations.push(body.operationId);assert.equal(body.action,'recover');
  const r=reviewReply(body,true);r.review.originalRequest=input.originalRequest;return Response.json(r);},input);
 const first=f.make(),result=await first.worker.runOnce();await first.worker.stop();
 assert.equal(result.execution.receipt.result.operationId,JOB_ID);
 assert.equal(result.execution.receipt.result.replayed,true);
 assert.equal(nativeReviewContent(input).requirements.tests.cases.length,18);
 const next=f.make();assert.equal((await next.worker.runOnce()).execution.replayed,true);await next.worker.stop();
 assert.deepEqual(operations,[BOOT_ID,BOOT_ID,BOOT_ID]);assert.deepEqual(f.calls,['recover','recover','recover']);
});
test('review recovery cannot prepare, select another response ID or claim a fresh effect',async()=>{
 const input=recoveryInput();
 for(const change of [{action:'prepare'},{savedOperationId:JOB_ID},{savedOperationId:input.parentOperationId},
  {savedOperationId:null},{schemaVersion:2},{permissionScope:{}}])assert.throws(()=>validateNativeReviewInput({...input,...change}));
 assert.throws(()=>encodeNativeReviewRecovery(input,PAIRING_ID));
 for(const change of [{operationId:JOB_ID},{replayed:false}]){
  const client=new NativeTaskClient({now:()=>1,fetchImpl:async(_url,init)=>{
   const body=JSON.parse(init.body);assert.equal(body.operationId,BOOT_ID);assert.equal(body.action,'recover');
   const r=reviewReply(body,true);r.review.originalRequest=input.originalRequest;return Response.json({...r,...change});}});
  await assert.rejects(client.review(input,{deadlineMs:1000}),{code:'TASK_REVIEW_INVALID'});
 }
});
test('a downgraded worker preserves v3 outbox until an explicitly enabled reader resumes',async t=>{
 const input=recoveryInput(),f=await setup(t,undefined,input),first=f.make();await first.worker.runOnce();await first.worker.stop();
 const old=f.make(true,true,false);await assert.rejects(old.worker.runOnce(),{code:'NODE_RECEIPT_CAPABILITY_RECONCILIATION_REQUIRED'});await old.worker.stop();
 assert.equal(f.sent.length,1);const next=f.make();await next.worker.runOnce();await next.worker.stop();
});

test('lossless uncertain preparation recovers after restart without repeating the effect',async t=>{
 const input=encodeNativeReviewInput(fullReview());
 const f=await setup(t,(body,count)=>{if(count===1)throw Error('lost reply');const r=reviewReply(body,true);r.review.originalRequest=input.originalRequest;return Response.json(r);},input);
 const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await first.worker.stop();
 const next=f.make();assert.equal((await next.worker.runOnce()).execution.receipt.state,'succeeded');await next.worker.stop();assert.deepEqual(f.calls,['prepare','recover']);
});
test('downgraded worker keeps lossless receipts private and leaves them recoverable',async t=>{
 const f=await setup(t,undefined,encodeNativeReviewInput(fullReview())),first=f.make();await first.worker.runOnce();await first.worker.stop();
 const old=f.make(true,false);await assert.rejects(old.worker.runOnce(),{code:'NODE_RECEIPT_CAPABILITY_RECONCILIATION_REQUIRED'});await old.worker.stop();
 assert.equal(f.sent.length,1);const resumed=f.make();assert.equal((await resumed.worker.runOnce()).execution.replayed,true);await resumed.worker.stop();
});
