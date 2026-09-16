import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {createHash} from 'node:crypto';
import {createMastermindCoreOnlyWorker} from '../src/core-worker.mjs';
import {validateCoreWorkerEnvironment} from '../src/run-core-worker.mjs';
import {NativeTaskClient} from '../src/native-task-client.mjs';
import {FileMastermindNodeEffectJournal} from '../src/effect-journal.mjs';
import * as v2 from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import * as v1 from '../../../protocol/mastermind-node-exchange/contract.mjs';
import {REVIEW_ARTIFACTS as ART,REVIEW_BUILD_PLAN as BUILD,validateDevelopmentInput,validateDevelopmentReceipt,developmentLocalRequest} from '../../../protocol/mastermind-node-exchange/native-development-work.mjs';
import {sameNativeDisclosure} from '../../../protocol/mastermind-node-exchange/native-catalog.mjs';
import {reviewCanonical} from '../../../protocol/mastermind-node-exchange/native-review-contract.mjs';
import {NODE_ID,NODE_CREDENTIAL,PAIRING_ID,BOOT_ID,JOB_ID,command,lease} from './fixtures.mjs';
const AT='2026-08-15T04:00:02.000Z';
const artifactId='00000000-0000-4000-8000-000000000081',buildId='00000000-0000-4000-8000-000000000082';
const input=(kind=ART,action='prepare')=>({schemaVersion:1,action,taskRef:{taskId:BOOT_ID,project:'mastermind'},
 operationId:JOB_ID,artifactOperationId:artifactId,specificationId:'a'.repeat(64),reviewId:'b'.repeat(64),...(kind===BUILD?{buildOperationId:buildId}:{})});
const hash=v=>createHash('sha256').update(reviewCanonical(v)).digest('hex');
function reply(kind,body,original){
 const common={ok:true,schemaVersion:1,taskRef:body.taskRef,operationId:body.operationId,specificationId:body.specificationId,
  reviewId:body.reviewId,replayed:body.action==='recover',executionAuthorized:false};
 if(kind===ART){const published=['publish','resume','reconcile'].includes(original.action),verified=published&&body.action!=='recover';return {...common,action:body.action,
  artifactState:published?'published':'proposed',bindingSha256:'c'.repeat(64),commit:'d'.repeat(40),fileCount:3,
  requirementsHash:'e'.repeat(64),testSpecHash:'f'.repeat(64),gitVerified:verified,historicalSnapshot:!verified,holds:[],mayAutomaticallyRerun:false,candidateAcceptance:'not-run'};}
 const {action,...binding}=body;
 return {...common,requestHash:hash(binding),workerInvoked:false,buildPlan:{planId:'c'.repeat(64),operationId:body.operationId,
  state:'awaiting_coding_authority',holds:[],current:true,historicalSnapshot:false,decision:'create',moduleId:'release-inventory',
  requirementsHash:'e'.repeat(64),jobState:null,candidateId:null,hasSourceReceipt:false,executionAuthorized:false}};
}
async function setup(t,kind=ART,action='publish',behavior){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mm-development-worker-'));
 t.after(async()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const request=input(kind,action),calls=[],sent=[];
 const native=new NativeTaskClient({now:()=>1,fetchImpl:async(url,init)=>{
  assert.equal(url,`http://127.0.0.1:8770/${kind===ART?'task_review_artifacts':'task_build_plan'}`);
  assert.equal(init.redirect,'error');const body=JSON.parse(init.body);calls.push(body.action);
  assert.equal(body.operationId,kind===ART?artifactId:buildId);
  return behavior?behavior(body,calls.length,request):Response.json(reply(kind,body,request));
 }});
 const cmd=command({capability:kind,input:request}),leased=lease({...cmd,commandDigest:v2.digestMastermindNodeCommand(cmd)});
 const make=(enabled=true)=>{const journal=new FileMastermindNodeEffectJournal(root,{now:()=>Date.parse(AT)});return {journal,
  worker:createMastermindCoreOnlyWorker({journalRoot:root,journal,enableNativeTasks:true,enableNativeSpecifications:true,enableNativeReviews:true,enableReviewReuse:true,enableDevelopmentWork:enabled,
   nativeTaskClient:native,bootId:BOOT_ID,now:()=>Date.parse(AT),monotonicNow:()=>1,
   credentialStore:{async load(){return {schemaVersion:1,state:'paired',nodeId:NODE_ID,nodeCredential:NODE_CREDENTIAL,pairingId:PAIRING_ID,pairingCredential:null,displayName:'Fixture',createdAt:AT,pairedAt:AT};}},
   exchangeTransport:{async pair(){throw Error('must not pair');},async exchange(req){sent.push(req);return {schemaVersion:2,exchangeId:req.exchangeId,serverTime:AT,nextPollAfterMs:5000,
    acceptedWorker:enabled?v2.DEVELOPMENT_CORE_WORKER:v2.REVIEW_REUSE_CORE_WORKER,acknowledgedReceiptIds:req.receipts.map(r=>r.receiptId),lease:leased};}}
  })};};return {make,calls,sent,request};
}
test('all bounded operations preserve separate job/artifact/build identities and unchanged receipt limits',async()=>{
 for(const kind of [ART,BUILD])for(const action of kind===ART?['prepare','recover','publish','reconcile','resume']:['prepare','recover']){
  const request=input(kind,action),body=developmentLocalRequest(kind,request);
  const client=new NativeTaskClient({now:()=>1,fetchImpl:async()=>Response.json(reply(kind,body,request))});
  const result=await client.development(kind,request,{deadlineMs:1000});validateDevelopmentReceipt(result,request);
  assert.equal(result.operationId,JOB_ID);assert.equal(result.executionAuthorized,false);
  assert(Buffer.byteLength(JSON.stringify(result))<=1450);assert(Buffer.byteLength(JSON.stringify(result,null,2))<=2900);
 }
});
test('reject extra authority, malformed identifiers, mismatched jobs, and legacy protocol dispatch',()=>{
 for(const kind of [ART,BUILD]){
  const request=input(kind),cmd=command({capability:kind,input:request});v2.validateMastermindNodeCommand(cmd);
  assert.throws(()=>v1.validateMastermindNodeCommand(cmd));
  for(const edit of [{permit:'private'},{action:'execute'},{artifactOperationId:JOB_ID},{operationId:[JOB_ID]},{taskRef:{taskId:NODE_ID,project:'mastermind',owner:'x'}}])assert.throws(()=>validateDevelopmentInput(kind,{...request,...edit}));
  assert.throws(()=>v2.validateMastermindNodeCommand({...cmd,jobId:NODE_ID}));
 }
 assert.throws(()=>validateDevelopmentInput(BUILD,{...input(BUILD),buildOperationId:artifactId}));
});
for(const kind of [ART,BUILD])test(`${kind} durable restart recovers without repeating its effect`,async t=>{
 const f=await setup(t,kind,kind===ART?'publish':'prepare'),first=f.make();const saved=(await first.worker.runOnce()).execution.receipt;
 assert.equal(saved.state,'succeeded');await first.worker.stop();
 const next=f.make();const replay=(await next.worker.runOnce()).execution;assert.equal(replay.replayed,true);
 if(kind===ART){assert.match(saved.result.gitVerifiedAt,/Z$/);assert.equal(replay.receipt.result.gitVerifiedAt,saved.result.gitVerifiedAt);}
 assert.deepEqual(f.calls,[kind===ART?'publish':'prepare','recover','recover']);await next.worker.stop();
});
for(const kind of [ART,BUILD])for(const failure of ['lost','http','altered'])test(`${kind} ${failure} reply is recovered without automatic rerun`,async t=>{
 const f=await setup(t,kind,kind===ART?'publish':'prepare',(body,n,request)=>{
  if(n===1){if(failure==='lost')throw Error('private');if(failure==='http')return Response.json({}, {status:503});return Response.json({...reply(kind,body,request),specificationId:'0'.repeat(64)});}
  return Response.json(reply(kind,body,request));});
 const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await first.worker.stop();
 const next=f.make();assert.equal((await next.worker.runOnce()).execution.receipt.state,'succeeded');assert.deepEqual(f.calls,[kind===ART?'publish':'prepare','recover']);await next.worker.stop();
});
test('a retained proposal cannot falsely complete an uncertain publication',async t=>{
 const f=await setup(t,ART,'publish',(body,n,request)=>{if(n===1)throw Error('lost');return Response.json({...reply(ART,body,request),artifactState:'proposed'});});
 for(let n=0;n<2;n++){const next=f.make();await assert.rejects(next.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await next.worker.stop();}
 assert.deepEqual(f.calls,['publish','recover']);
});
for(const reason of ['revoked','changed'])test(`${reason} source binding blocks saved outbox disclosure`,async t=>{
 const f=await setup(t,ART,'publish',(body,n,request)=>n===1?Response.json(reply(ART,body,request)):reason==='revoked'?Response.json({}, {status:403}):Response.json({...reply(ART,body,request),bindingSha256:'0'.repeat(64)}));
 const first=f.make();await first.worker.runOnce();await first.worker.stop();const next=f.make();await assert.rejects(next.worker.runOnce());assert.equal(f.sent.length,1);await next.worker.stop();
});
test('unnegotiated capabilities never call the broker and cannot be enabled without prerequisites',async t=>{
 const f=await setup(t),{worker}=f.make(false);await assert.rejects(worker.runOnce());assert.equal(f.calls.length,0);await worker.stop();
 assert.throws(()=>createMastermindCoreOnlyWorker({enableDevelopmentWork:true}),/requires explicit/);
 assert.throws(()=>validateCoreWorkerEnvironment({MASTERMIND_NODE_WORKER_PROFILE:'core-only',MASTERMIND_LOCAL_CHILD_ROLE:'mastermind-node-link-core',MASTERMIND_NODE_DEVELOPMENT_WORK_ENABLED:'true'}),{code:'NODE_NATIVE_PROFILE_INVALID'});
});
test('expired and cancelled calls never contact local services',async()=>{
 let calls=0;const client=new NativeTaskClient({now:()=>100,fetchImpl:async()=>{calls++;}});
 await assert.rejects(client.development(ART,input(),{deadlineMs:90}));
 await assert.rejects(client.development(ART,input(),{deadlineMs:1000,signal:AbortSignal.abort()}));assert.equal(calls,0);
});
test('malformed or substituted build proof never creates a valid receipt',async()=>{
 const request=input(BUILD),body=developmentLocalRequest(BUILD,request);
 for(const edit of [{requestHash:'0'.repeat(64)},{workerInvoked:true},{executionAuthorized:true},{operationId:JOB_ID}]){
  const client=new NativeTaskClient({now:()=>1,fetchImpl:async()=>Response.json({...reply(BUILD,body,request),...edit})});
  await assert.rejects(client.development(BUILD,request,{deadlineMs:1000}));
 }
});

test('Python 7eed235 synthetic host output round-trips without losing source/test bindings',async()=>{
 const fixture=JSON.parse(await fs.readFile(new URL('./runtime-development-fixture.json',import.meta.url),'utf8'));
 let published;
 for(const [kind,key,recoverOnly] of [[ART,'prepared',false],[ART,'published',false],[ART,'recovered',true],[BUILD,'planned',false],[BUILD,'recoveredPlan',true]]){
  const local=fixture[kind===ART?'artifactRequest':'buildRequest'];
  const request={...local,operationId:JOB_ID,artifactOperationId:kind===ART?local.operationId:local.artifactOperationId,
   action:kind===ART&&key!=='prepared'?'publish':'prepare',...(kind===BUILD?{buildOperationId:local.operationId}:{})};
  const client=new NativeTaskClient({now:()=>1,fetchImpl:async(_url,init)=>{
   assert.deepEqual(JSON.parse(init.body),developmentLocalRequest(kind,request,recoverOnly));return Response.json(fixture[key]);}});
  const result=await client.development(kind,request,{deadlineMs:1000,recoverOnly});
  assert.equal(result.requirementsHash,fixture.published.requirementsHash);
  if(kind===ART)assert.equal(result.testSpecHash,fixture.published.testSpecHash);
  else assert.equal(result.planId,fixture.planned.buildPlan.planId);
  if(key==='published')published=result;
  if(key==='recovered')assert(sameNativeDisclosure(result,published));
 }
});
