import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {LIFECYCLE} from '../../../protocol/mastermind-node-exchange/native-contribution-lifecycle.mjs';
import {id,input,data,local} from './lifecycle-fixture.mjs';
import {createMastermindCoreOnlyWorker} from '../src/core-worker.mjs';
import {NativeTaskClient} from '../src/native-task-client.mjs';
import {FileMastermindNodeEffectJournal} from '../src/effect-journal.mjs';
import * as v2 from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import {NODE_ID,NODE_CREDENTIAL,PAIRING_ID,BOOT_ID,JOB_ID,command,lease} from './fixtures.mjs';
const AT='2026-08-15T04:00:02.000Z';
const profiles={enableNativeTasks:true,enableNativeSpecifications:true,enableNativeReviews:true,enableReviewReuse:true,enableDevelopmentWork:true,enableLosslessReviews:true,enableBuildDispatch:true,enableReviewRecovery:true,enableContributions:true};
async function setup(t,lose=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mm-lifecycle-worker-'));
 t.after(async()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const request={...input,operationId:JOB_ID,action:'execute',operation:'promote',lifecycleOperationId:id(88),expectedActiveRevision:data.activeRevision};
 const calls=[],sent=[];let reject=false;
 const native=new NativeTaskClient({now:()=>1,fetchImpl:async(url,init)=>{
  assert.equal(url,'http://127.0.0.1:8770/task_contribution_lifecycle');const body=JSON.parse(init.body);calls.push(body.action);
  if(reject)return Response.json({error:'private'},{status:403});
  if(lose&&calls.length===1)throw Error('Lost reply after durable activation');
  return Response.json(local(request,{...data,operationState:'completed',activeRevision:request.candidateId,currentlyActive:true,activeProxyAvailable:true},body.action==='recover'));
 }});
 const cmd=command({capability:LIFECYCLE,input:request}),leased=lease({...cmd,commandDigest:v2.digestMastermindNodeCommand(cmd)});
 const make=(enabled=true)=>{const journal=new FileMastermindNodeEffectJournal(root,{now:()=>Date.parse(AT)});return {journal,worker:createMastermindCoreOnlyWorker({journalRoot:root,journal,...profiles,enableLifecycle:enabled,nativeTaskClient:native,bootId:BOOT_ID,now:()=>Date.parse(AT),monotonicNow:()=>1,
  credentialStore:{async load(){return {schemaVersion:1,state:'paired',nodeId:NODE_ID,nodeCredential:NODE_CREDENTIAL,pairingId:PAIRING_ID,pairingCredential:null,displayName:'Fixture',createdAt:AT,pairedAt:AT};}},
  exchangeTransport:{async pair(){throw Error('No pairing');},async exchange(req){sent.push(req);return {schemaVersion:2,exchangeId:req.exchangeId,serverTime:AT,nextPollAfterMs:5000,acceptedWorker:enabled?v2.LIFECYCLE_CORE_WORKER:v2.CONTRIBUTION_CORE_WORKER,acknowledgedReceiptIds:req.receipts.map(r=>r.receiptId),lease:leased};}}
 })};};return {make,calls,sent,revoke:()=>{reject=true;}};
}
test('lifecycle requires explicit worker opt-in and cannot pair a new node',async t=>{
 const f=await setup(t),old=f.make(false);await assert.rejects(old.worker.runOnce());assert.equal(f.calls.length,0);await old.worker.stop();
 assert.throws(()=>createMastermindCoreOnlyWorker({...profiles,enableContributions:false,enableLifecycle:true}),/Lifecycle/);
});
test('durable lifecycle result survives real journal restart without another execution',async t=>{
 const f=await setup(t);const first=f.make();await first.worker.runOnce();await first.worker.stop();
 const next=f.make();await next.worker.runOnce();await next.worker.stop();
 assert.equal(f.calls.filter(x=>x==='execute').length,1);assert(f.calls.includes('recover'));
 assert(f.sent.some(x=>x.receipts.some(r=>r.result?.kind===LIFECYCLE)));
});
test('lost activation reply is recovered after journal restart without resend',async t=>{
 const f=await setup(t,true);const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await first.worker.stop();
 const next=f.make();await next.worker.runOnce();await next.worker.stop();
 assert.deepEqual(f.calls,['execute','recover']);
});
test('revoked access blocks saved lifecycle outbox disclosure',async t=>{
 const f=await setup(t);const first=f.make();await first.worker.runOnce();await first.worker.stop();f.revoke();
 const before=f.sent.length,next=f.make();await assert.rejects(next.worker.runOnce());await next.worker.stop();assert.equal(f.sent.length,before);
});
