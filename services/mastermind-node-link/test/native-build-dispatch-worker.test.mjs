import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {BUILD_DISPATCH,buildDispatchReceipt} from '../../../protocol/mastermind-node-exchange/native-build-dispatch.mjs';
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
const runtime=JSON.parse(await fs.readFile(new URL('./runtime-build-dispatch-fixture.json',import.meta.url),'utf8'));
const input=(action='start')=>({...runtime.request,action,operationId:JOB_ID,parentOperationId:NODE_ID});
const reply=body=>({...runtime.results[body.action],...body});
async function setup(t,kind=BUILD_DISPATCH,action='start',behavior){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mm-development-worker-'));
 t.after(async()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const request=input(action),calls=[],sent=[];
 const native=new NativeTaskClient({now:()=>1,fetchImpl:async(url,init)=>{
  assert.equal(url,'http://127.0.0.1:8770/task_build_dispatch');
  assert.equal(init.redirect,'error');const body=JSON.parse(init.body);calls.push(body.action);
  assert.equal(body.buildOperationId,request.buildOperationId);assert.equal(body.operationId,undefined);
  return behavior?behavior(body,calls.length,request):Response.json(reply(body));
 }});
 const cmd=command({capability:kind,input:request}),leased=lease({...cmd,commandDigest:v2.digestMastermindNodeCommand(cmd)});
 const make=(enabled=true)=>{const journal=new FileMastermindNodeEffectJournal(root,{now:()=>Date.parse(AT)});return {journal,
  worker:createMastermindCoreOnlyWorker({journalRoot:root,journal,enableNativeTasks:true,enableNativeSpecifications:true,enableNativeReviews:true,enableReviewReuse:true,enableDevelopmentWork:true,enableLosslessReviews:true,enableBuildDispatch:enabled,
   nativeTaskClient:native,bootId:BOOT_ID,now:()=>Date.parse(AT),monotonicNow:()=>1,
   credentialStore:{async load(){return {schemaVersion:1,state:'paired',nodeId:NODE_ID,nodeCredential:NODE_CREDENTIAL,pairingId:PAIRING_ID,pairingCredential:null,displayName:'Fixture',createdAt:AT,pairedAt:AT};}},
   exchangeTransport:{async pair(){throw Error('must not pair');},async exchange(req){sent.push(req);return {schemaVersion:2,exchangeId:req.exchangeId,serverTime:AT,nextPollAfterMs:5000,
    acceptedWorker:enabled?v2.CODING_CORE_WORKER:v2.LOSSLESS_DEVELOPMENT_CORE_WORKER,acknowledgedReceiptIds:req.receipts.map(r=>r.receiptId),lease:leased};}}
  })};};return {make,calls,sent,request};
}

test('coding worker requires explicit coupled opt-in and never grants an older worker its capability',async t=>{
 const f=await setup(t),old=f.make(false);await assert.rejects(old.worker.runOnce());assert.equal(f.calls.length,0);await old.worker.stop();
 assert.throws(()=>createMastermindCoreOnlyWorker({enableBuildDispatch:true}),/requires explicit/);
 assert.throws(()=>validateCoreWorkerEnvironment({MASTERMIND_NODE_WORKER_PROFILE:'core-only',MASTERMIND_LOCAL_CHILD_ROLE:'mastermind-node-link-core',MASTERMIND_NODE_BUILD_DISPATCH_ENABLED:'true'}));
 assert.equal(v2.CODING_CORE_WORKER.capabilities.length,9);assert.equal(v2.LOSSLESS_DEVELOPMENT_CORE_WORKER.capabilities.length,8);
 const cmd=command({capability:BUILD_DISPATCH,input:input()});v2.validateMastermindNodeCommand(cmd);assert.throws(()=>v1.validateMastermindNodeCommand(cmd));
});
test('durable restart reauthorizes an advancing result without restarting coding',async t=>{
 const f=await setup(t),first=f.make();const saved=(await first.worker.runOnce()).execution.receipt;
 assert.equal(saved.result.startAccepted,true);await first.worker.stop();
 const next=f.make(),replay=(await next.worker.runOnce()).execution;
 assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt.result,saved.result);
 assert.deepEqual(f.calls,['start','recover','recover']);await next.worker.stop();
});
for(const failure of ['lost','http','altered'])test(`${failure} start response only recovers the original coding operation`,async t=>{
 const f=await setup(t,BUILD_DISPATCH,'start',(body,n)=>{
  if(n===1){if(failure==='lost')throw Error('private');if(failure==='http')return Response.json({}, {status:503});return Response.json({...reply(body),planId:'0'.repeat(64)});}
  return Response.json(reply(body));});
 const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await first.worker.stop();
 const next=f.make(),receipt=(await next.worker.runOnce()).execution.receipt;
 assert.equal(receipt.state,'succeeded');assert.equal(receipt.result.sourceReady,true);assert.equal(receipt.result.observedAction,'recover');
 assert.equal(receipt.result.startAccepted,false);assert.deepEqual(f.calls,['start','recover']);await next.worker.stop();
});
for(const reason of ['revoked','changed'])test(`${reason} authority blocks durable coding outbox disclosure`,async t=>{
 const f=await setup(t,BUILD_DISPATCH,'start',(body,n)=>n===1?Response.json(reply(body)):reason==='revoked'?Response.json({}, {status:403}):Response.json({...reply(body),planId:'0'.repeat(64)}));
 const first=f.make();await first.worker.runOnce();await first.worker.stop();const next=f.make();await assert.rejects(next.worker.runOnce());assert.equal(f.sent.length,1);await next.worker.stop();
});
test('disclosure keeps immutable binding and never erases previously observed source',()=>{
 const req=input(),saved=buildDispatchReceipt(runtime.results.start,req),current=buildDispatchReceipt(runtime.results.recover,req,true);
 assert(sameNativeDisclosure(current,saved));
 assert(!sameNativeDisclosure({...current,planId:'0'.repeat(64)},saved));
 assert(!sameNativeDisclosure({...current,recoveryOnly:false},saved));
 assert(!sameNativeDisclosure({...current,sourceReady:false},current));
 assert(!sameNativeDisclosure({...current,candidateId:'0'.repeat(64)},{...current,candidateId:'f'.repeat(64)}));
});
