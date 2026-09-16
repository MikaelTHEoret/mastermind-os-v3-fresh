import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {createMastermindCoreOnlyWorker} from '../src/core-worker.mjs';
import {NativeTaskClient,REVIEW_REUSE_ENDPOINT} from '../src/native-task-client.mjs';
import {FileMastermindNodeEffectJournal} from '../src/effect-journal.mjs';
import * as v2 from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import {REVIEW_REUSE as CAP,validateReviewReuseInput,validateReviewReuseReceipt} from '../../../protocol/mastermind-node-exchange/native-review-reuse.mjs';
import {reuseInput,reuseReply,reuseReceipt} from '../../../protocol/mastermind-node-exchange/review-reuse-fixture.mjs';
import {NODE_ID,NODE_CREDENTIAL,PAIRING_ID,BOOT_ID,JOB_ID,command,lease} from './fixtures.mjs';
const AT='2026-08-15T04:00:02.000Z';
const request=()=>reuseInput(JOB_ID,'accept');
const reuseCommand=(input=request())=>command({capability:CAP,input});
const reuseLease=(input=request())=>{const c=reuseCommand(input);return lease({...c,commandDigest:v2.digestMastermindNodeCommand(c)});};
async function setup(t,behavior,input=request()) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mm-review-worker-'));
 t.after(async()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const calls=[],sent=[];
 const native=new NativeTaskClient({now:()=>1,fetchImpl:async(url,init)=>{
  assert.equal(url,REVIEW_REUSE_ENDPOINT);assert.equal(init.redirect,'error');const body=JSON.parse(init.body);calls.push(body.action);
  assert.equal(body.taskRef,undefined);
  return behavior?behavior(body,calls.length):Response.json(reuseReply(body,body.action==='recover'));
 }});
 const make=(enabled=true)=>{const journal=new FileMastermindNodeEffectJournal(root,{now:()=>Date.parse(AT)});return {journal,
  worker:createMastermindCoreOnlyWorker({journalRoot:root,journal,enableNativeTasks:true,enableNativeSpecifications:true,enableNativeReviews:true,enableReviewReuse:enabled,
   nativeTaskClient:native,bootId:BOOT_ID,now:()=>Date.parse(AT),monotonicNow:()=>1,
   credentialStore:{async load(){return {schemaVersion:1,state:'paired',nodeId:NODE_ID,nodeCredential:NODE_CREDENTIAL,pairingId:PAIRING_ID,pairingCredential:null,displayName:'Fixture',createdAt:AT,pairedAt:AT};}},
   exchangeTransport:{async pair(){throw Error('must not pair');},async exchange(req){sent.push(req);return {schemaVersion:2,exchangeId:req.exchangeId,serverTime:AT,nextPollAfterMs:5000,
    acceptedWorker:enabled?v2.REVIEW_REUSE_CORE_WORKER:v2.REVIEW_CORE_WORKER,acknowledgedReceiptIds:req.receipts.map(r=>r.receiptId),lease:reuseLease(input)};}}
  })};};return {make,calls,sent};
}
test('compact assessment and accepted link fit the negotiated receipt without private evidence',async()=>{
 for(const action of ['assess','accept']){
  const input=reuseInput(JOB_ID,action),client=new NativeTaskClient({now:()=>1,fetchImpl:async()=>Response.json(reuseReply(input))});
  const result=await client.reviewReuse(input,{deadlineMs:1000});validateReviewReuseReceipt(result,input);
  assert(Buffer.byteLength(JSON.stringify(result))<=1450);assert(Buffer.byteLength(JSON.stringify(result,null,2))<=2900);
  assert.equal(result.qualification,undefined);assert.equal(result.executionAuthorized,false);
  if(action==='assess'){assert.equal(result.coveredCount,8);assert.equal(result.suiteCaseCount,14);}
 }
});
test('compact requests and receipts reject injected authority, substituted IDs and unknown differences',()=>{
 const input=request();v2.validateMastermindNodeCommand(reuseCommand());
 for(const edit of [{source:'private'},{action:'recover'},{operationId:[JOB_ID]},{parentOperationId:[BOOT_ID]},
  {decisions:[{field:'requirements',disposition:'retain-accepted-baseline'}]}])assert.throws(()=>validateReviewReuseInput({...input,...edit}));
 for(const edit of [{executionAuthorized:true},{reviewAccepted:true},{qualificationId:'e'.repeat(64)},{taskRef:{taskId:BOOT_ID,project:'mastermind'}},{source:'private'}])assert.throws(()=>validateReviewReuseReceipt({...reuseReceipt(input),...edit},input));
 const assessment=reuseReceipt(reuseInput());assert.throws(()=>validateReviewReuseReceipt({...assessment,coveredCount:7}));
 assert.throws(()=>validateReviewReuseReceipt({...assessment,differences:['requirements']}));
});
test('saving then restarting recovers the same decision, never another acceptance',async t=>{
 const f=await setup(t),first=f.make();assert.equal((await first.worker.runOnce()).execution.receipt.state,'succeeded');await first.worker.stop();
 const next=f.make();assert.equal((await next.worker.runOnce()).execution.replayed,true);assert.deepEqual(f.calls,['accept','recover','recover']);await next.worker.stop();
});
for(const failure of ['lost','http','altered','fresh-recovery'])test(`${failure} link reply requires recovery without repeating accept`,async t=>{
 const f=await setup(t,(input,count)=>{if(count===1){if(failure==='lost')throw Error('private');if(failure==='http')return Response.json({}, {status:503});
  return Response.json({...reuseReply(input),qualificationId:'e'.repeat(64)});}
 return Response.json(reuseReply(input,failure!=='fresh-recovery'));});
 const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await first.worker.stop();const next=f.make();
 if(failure==='fresh-recovery')await assert.rejects(next.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});else assert.equal((await next.worker.runOnce()).execution.receipt.state,'succeeded');
 assert.deepEqual(f.calls,['accept','recover']);await next.worker.stop();
});
for(const reason of ['revoked','changed'])test(`${reason} context prevents disclosing a saved link receipt`,async t=>{
 const f=await setup(t,(input,count)=>{if(count===1)return Response.json(reuseReply(input));if(reason==='revoked')return Response.json({}, {status:403});return Response.json({...reuseReply(input,true),linkId:'e'.repeat(64)});});
 const first=f.make();await first.worker.runOnce();await first.worker.stop();const next=f.make();await assert.rejects(next.worker.runOnce());assert.equal(f.sent.length,1);await next.worker.stop();
});
test('a worker without reuse-link opt-in never calls its local broker',async t=>{const f=await setup(t),{worker}=f.make(false);await assert.rejects(worker.runOnce());assert.equal(f.calls.length,0);await worker.stop();});