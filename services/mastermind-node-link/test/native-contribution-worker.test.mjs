import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {CONTRIBUTION} from '../../../protocol/mastermind-node-exchange/native-contribution.mjs';
import {createMastermindCoreOnlyWorker} from '../src/core-worker.mjs';
import {createMastermindCoreWorkerFromEnvironment} from '../src/run-core-worker.mjs';
import {NativeTaskClient} from '../src/native-task-client.mjs';
import {FileMastermindNodeEffectJournal} from '../src/effect-journal.mjs';
import * as v2 from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import * as v1 from '../../../protocol/mastermind-node-exchange/contract.mjs';
import {NODE_ID,NODE_CREDENTIAL,PAIRING_ID,BOOT_ID,JOB_ID,command,lease} from './fixtures.mjs';
const AT='2026-08-15T04:00:02.000Z';
const samples=JSON.parse(await fs.readFile(new URL('./runtime-contribution-fixture.json',import.meta.url),'utf8'));
const sample=action=>structuredClone(samples.find(v=>v.request.action===action));
const input=action=>({...sample(action).request,operationId:JOB_ID});
const reply=body=>({...sample(body.action).result,...body});
const profiles={enableNativeTasks:true,enableNativeSpecifications:true,enableNativeReviews:true,enableReviewReuse:true,
 enableDevelopmentWork:true,enableLosslessReviews:true,enableBuildDispatch:true,enableReviewRecovery:true};

async function setup(t,action='stage',behavior){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mm-contribution-worker-'));
 t.after(async()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const request=input(action),calls=[],sent=[];
 const native=new NativeTaskClient({now:()=>1,fetchImpl:async(url,init)=>{
  assert.equal(url,'http://127.0.0.1:8770/task_contribution_candidate');assert.equal(init.redirect,'error');
  const body=JSON.parse(init.body);calls.push(body.action);
  assert.equal(body.operationId,undefined);assert.equal(body.importOperationId,request.importOperationId);
  return behavior?behavior(body,calls.length,request):Response.json(reply(body));
 }});
 const cmd=command({capability:CONTRIBUTION,input:request}),leased=lease({...cmd,commandDigest:v2.digestMastermindNodeCommand(cmd)});
 const make=(enabled=true)=>{const journal=new FileMastermindNodeEffectJournal(root,{now:()=>Date.parse(AT)});return {journal,
  worker:createMastermindCoreOnlyWorker({journalRoot:root,journal,...profiles,enableContributions:enabled,
   nativeTaskClient:native,bootId:BOOT_ID,now:()=>Date.parse(AT),monotonicNow:()=>1,
   credentialStore:{async load(){return {schemaVersion:1,state:'paired',nodeId:NODE_ID,nodeCredential:NODE_CREDENTIAL,pairingId:PAIRING_ID,pairingCredential:null,displayName:'Fixture',createdAt:AT,pairedAt:AT};}},
   exchangeTransport:{async pair(){throw Error('No pairing');},async exchange(req){sent.push(req);return {schemaVersion:2,
    exchangeId:req.exchangeId,serverTime:AT,nextPollAfterMs:5000,acceptedWorker:enabled?v2.CONTRIBUTION_CORE_WORKER:v2.REVIEW_RECOVERY_CORE_WORKER,
    acknowledgedReceiptIds:req.receipts.map(r=>r.receiptId),lease:leased};}}
  })};};return {make,calls,sent,request,root};
}

test('contribution commands require v2, distinct job binding and explicit tenth-capability opt-in',async t=>{
 const f=await setup(t),old=f.make(false);await assert.rejects(old.worker.runOnce());assert.equal(f.calls.length,0);await old.worker.stop();
 const cmd=command({capability:CONTRIBUTION,input:input('stage')});v2.validateMastermindNodeCommand(cmd);
 assert.throws(()=>v1.validateMastermindNodeCommand(cmd));
 assert.throws(()=>v2.validateMastermindNodeCommand({...cmd,input:{...cmd.input,operationId:NODE_ID}}));
 assert.throws(()=>v2.validateMastermindNodeCommand({...cmd,input:{...cmd.input,importOperationId:JOB_ID}}));
 assert.equal(v2.REVIEW_RECOVERY_CORE_WORKER.capabilities.length,9);assert.equal(v2.CONTRIBUTION_CORE_WORKER.capabilities.length,10);
 assert.throws(()=>createMastermindCoreOnlyWorker({enableContributions:true}),/require explicit/);
});

test('invalid contribution configuration fails before credential access',()=>{
 for(const setting of ['yes','TRUE','true']){
  let credentials=0;
  assert.throws(()=>createMastermindCoreWorkerFromEnvironment({environment:{MASTERMIND_NODE_CONTRIBUTIONS_ENABLED:setting},
   credentialStoreFactory:()=>{credentials++;return {};}}),{code:'NODE_NATIVE_PROFILE_INVALID'});
  assert.equal(credentials,0);
 }
});

test('valid environment forwards explicit contribution opt-in without replacing pairing or journal',()=>{
 const environment={LOCALAPPDATA:'C:\\Users\\Fixture\\AppData\\Local',MASTERMIND_MINECRAFT_DATA_DIR:'E:\\RetainedPortable',
  MASTERMIND_NODE_WORKER_PROFILE:'core-only',MASTERMIND_LOCAL_CHILD_ROLE:'mastermind-node-link-core'};
 for(const suffix of ['NATIVE_REUSE','NATIVE_SPECIFICATION','NATIVE_REVIEW','REVIEW_REUSE','DEVELOPMENT_WORK','LOSSLESS_REVIEW','BUILD_DISPATCH','REVIEW_RECOVERY','CONTRIBUTIONS'])
  environment[`MASTERMIND_NODE_${suffix}_ENABLED`]='true';
 const credential={};
 const result=createMastermindCoreWorkerFromEnvironment({environment,credentialStoreFactory:()=>credential,
  transportFactory:()=>({}),workerFactory:options=>options});
 assert.equal(result.enableContributions,true);assert.equal(result.enableReviewRecovery,true);
 assert.equal(result.credentialStore,credential);assert(result.journalRoot.endsWith(path.join('state','node-exchange','v1')));
});

test('stage executes once, actual journal reload verifies source and replays same saved receipt',async t=>{
 const f=await setup(t),first=f.make();const saved=(await first.worker.runOnce()).execution.receipt;
 assert.equal(saved.result.data.phase,'staged');assert.equal(saved.result.executionAuthorized,false);await first.worker.stop();
 const next=f.make(),replay=(await next.worker.runOnce()).execution;
 assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt.result,saved.result);
 assert.deepEqual(f.calls,['stage','recover','recover']);await next.worker.stop();
});

for(const failure of ['lost','http','altered','oversized'])test(`${failure} stage reply only recovers original candidate after journal reload`,async t=>{
 const f=await setup(t,'stage',(body,n)=>{
  if(n===1){if(failure==='lost')throw Error('private');if(failure==='http')return Response.json({}, {status:503});
   if(failure==='oversized')return Response.json({...reply(body),extra:'x'.repeat(73728)});
   return Response.json({...reply(body),specificationId:'0'.repeat(64)});}
  return Response.json(reply(body));});
 const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await first.worker.stop();
 const next=f.make(),receipt=(await next.worker.runOnce()).execution.receipt;
 assert.equal(receipt.state,'succeeded');assert.equal(receipt.result.observedAction,'recover');
 assert.equal(receipt.result.data.replayed,true);assert.deepEqual(f.calls,['stage','recover']);await next.worker.stop();
});

test('missing candidate after uncertain stage remains held without restaging',async t=>{
 const f=await setup(t,'stage',(body,n)=>{if(n===1)throw Error('No reply');return Response.json({error:'SAVED_IMPORT_REQUIRED'},{status:409});});
 const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await first.worker.stop();
 const next=f.make();await assert.rejects(next.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});
 assert.deepEqual(f.calls,['stage','recover']);await next.worker.stop();
});

for(const reason of ['revoked','source-changed','originals-changed'])test(`${reason} blocks saved outbox disclosure`,async t=>{
 const f=await setup(t,'stage',(body,n)=>{
  if(n===1)return Response.json(reply(body));
  if(reason==='revoked')return Response.json({}, {status:403});
  const changed=reply(body);
  if(reason==='source-changed')changed.result.sourceSha256='0'.repeat(64);
  else changed.result.recordIds.reviewId='0'.repeat(64);
  return Response.json(changed);
 });
 const first=f.make();await first.worker.runOnce();await first.worker.stop();
 const next=f.make();await assert.rejects(next.worker.runOnce());assert.equal(f.sent.length,1);
 assert.deepEqual(f.calls,['stage','recover']);await next.worker.stop();
});

for(const action of ['catalog','prepare'])test(`${action} redisclosure stays read-only through actual journal restart`,async t=>{
 const f=await setup(t,action),first=f.make();const saved=(await first.worker.runOnce()).execution.receipt;await first.worker.stop();
 const next=f.make(),replay=(await next.worker.runOnce()).execution;
 assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt.result,saved.result);
 assert.deepEqual(f.calls,[action,action,action]);assert(!f.calls.includes('stage'));await next.worker.stop();
});

for(const action of ['catalog','prepare'])test(`lost ${action} reply refreshes only the original read-only request`,async t=>{
 const f=await setup(t,action,(body,n)=>{if(n===1)throw Error('lost');return Response.json(reply(body));});
 const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await first.worker.stop();
 const next=f.make();assert.equal((await next.worker.runOnce()).execution.receipt.state,'succeeded');
 assert.deepEqual(f.calls,[action,action]);await next.worker.stop();
});

test('changed catalog snapshot withholds old pending page before any exchange',async t=>{
 const f=await setup(t,'catalog',(body,n)=>{
  const result=reply(body);if(n>1)result.choices[0].recordIds.reviewId='0'.repeat(64);return Response.json(result);
 });
 const first=f.make();await first.worker.runOnce();await first.worker.stop();
 const next=f.make();await assert.rejects(next.worker.runOnce());assert.equal(f.sent.length,1);await next.worker.stop();
});

test('downgraded worker preserves incompatible pending receipt for later configured recovery',async t=>{
 const f=await setup(t),first=f.make();const saved=(await first.worker.runOnce()).execution.receipt;await first.worker.stop();
 const old=f.make(false);await assert.rejects(old.worker.runOnce(),{code:'NODE_RECEIPT_CAPABILITY_RECONCILIATION_REQUIRED'});await old.worker.stop();
 assert(f.sent.slice(1).every(r=>r.receipts.every(x=>x.result?.kind!==CONTRIBUTION)));
 assert.deepEqual(f.calls,['stage']);
 const next=f.make();const replay=(await next.worker.runOnce()).execution;
 assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt.result,saved.result);
 assert.deepEqual(f.calls,['stage','recover','recover']);await next.worker.stop();
});
