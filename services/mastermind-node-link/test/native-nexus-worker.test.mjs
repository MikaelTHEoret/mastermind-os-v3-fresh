import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {NEXUS,nexusDigest,nexusReceipt,freshNexusReceipt,validateNexusInput,validateNexusReceipt,sameNexusDisclosure} from '../../../protocol/mastermind-node-exchange/native-nexus.mjs';
import {createMastermindCoreOnlyWorker} from '../src/core-worker.mjs';
import {createMastermindCoreWorkerFromEnvironment} from '../src/run-core-worker.mjs';
import {NativeTaskClient} from '../src/native-task-client.mjs';
import {FileMastermindNodeEffectJournal} from '../src/effect-journal.mjs';
import * as v2 from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import * as v1 from '../../../protocol/mastermind-node-exchange/contract.mjs';
import {NODE_ID,NODE_CREDENTIAL,PAIRING_ID,BOOT_ID,JOB_ID,command,lease} from './fixtures.mjs';
const AT='2026-08-15T04:00:02.000Z';
const samples=JSON.parse(await fs.readFile(new URL('./runtime-nexus-fixture.json',import.meta.url),'utf8'));
const sample=action=>structuredClone(samples.find(v=>v.request.action===action));
const profiles={enableNativeTasks:true,enableNativeSpecifications:true,enableNativeReviews:true,enableReviewReuse:true,
 enableDevelopmentWork:true,enableLosslessReviews:true,enableBuildDispatch:true,enableReviewRecovery:true,enableContributions:true,enableLifecycle:true};

async function setup(t,action='catalog',behavior){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mm-nexus-worker-'));
 t.after(async()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const {request,result}=sample(action),calls=[],sent=[];
 const native=new NativeTaskClient({now:()=>1,fetchImpl:async(url,init)=>{
  assert.equal(url,'http://127.0.0.1:8770/task_nexus');assert.equal(init.redirect,'error');
  const body=JSON.parse(init.body);calls.push(body);assert.deepEqual(body,request);
  return behavior?behavior(body,calls.length,structuredClone(result)):Response.json({...result,observedAt:new Date(Date.parse(AT)+calls.length).toISOString()});
 }});
 const cmd=command({capability:NEXUS,input:request}),leased=lease({...cmd,commandDigest:v2.digestMastermindNodeCommand(cmd)});
 const make=(enabled=true)=>{const journal=new FileMastermindNodeEffectJournal(root,{now:()=>Date.parse(AT)});return {journal,
  worker:createMastermindCoreOnlyWorker({journalRoot:root,journal,...profiles,enableNexus:enabled,
   nativeTaskClient:native,bootId:BOOT_ID,now:()=>Date.parse(AT),monotonicNow:()=>1,
   credentialStore:{async load(){return {schemaVersion:1,state:'paired',nodeId:NODE_ID,nodeCredential:NODE_CREDENTIAL,pairingId:PAIRING_ID,pairingCredential:null,displayName:'Fixture',createdAt:AT,pairedAt:AT};}},
   exchangeTransport:{async pair(){throw Error('No pairing');},async exchange(req){sent.push(req);return {schemaVersion:2,
    exchangeId:req.exchangeId,serverTime:AT,nextPollAfterMs:5000,acceptedWorker:enabled?v2.NEXUS_CORE_WORKER:v2.LIFECYCLE_CORE_WORKER,
    acknowledgedReceiptIds:req.receipts.map(r=>r.receiptId),lease:leased};}}
  })};};return {make,calls,sent,request,result,root};
}

test('Python receipts share exact canonical hashes with worker contract',async()=>{
 for(const {request,result} of samples){assert.deepEqual(await nexusReceipt(result,request),result);assert.equal(result.requestSha256,await nexusDigest(request));}
});
test('Nexus is an explicit twelfth capability with exact job binding; v1 stays strict',async t=>{
 const f=await setup(t),old=f.make(false);await assert.rejects(old.worker.runOnce());assert.equal(f.calls.length,0);await old.worker.stop();
 const cmd=command({capability:NEXUS,input:f.request});v2.validateMastermindNodeCommand(cmd);
 assert.throws(()=>v1.validateMastermindNodeCommand(cmd));
 assert.throws(()=>v2.validateMastermindNodeCommand({...cmd,input:{...cmd.input,operationId:NODE_ID}}));
 assert.equal(v2.LIFECYCLE_CORE_WORKER.capabilities.length,11);assert.equal(v2.NEXUS_CORE_WORKER.capabilities.length,12);
 assert.throws(()=>createMastermindCoreOnlyWorker({enableNexus:true}),/requires explicit/);
});
test('invalid Nexus settings fail before any credential access',()=>{
 for(const setting of ['yes','TRUE','true']){
  let credentials=0;assert.throws(()=>createMastermindCoreWorkerFromEnvironment({environment:{MASTERMIND_NODE_NEXUS_ENABLED:setting},
   credentialStoreFactory:()=>{credentials++;return {};}}),{code:'NODE_NATIVE_PROFILE_INVALID'});assert.equal(credentials,0);
 }
});
test('valid explicit settings preserve existing pairing and journal',()=>{
 const environment={LOCALAPPDATA:'C:\\Users\\Fixture\\AppData\\Local',MASTERMIND_MINECRAFT_DATA_DIR:'E:\\RetainedPortable',
  MASTERMIND_NODE_WORKER_PROFILE:'core-only',MASTERMIND_LOCAL_CHILD_ROLE:'mastermind-node-link-core'};
 for(const suffix of ['NATIVE_REUSE','NATIVE_SPECIFICATION','NATIVE_REVIEW','REVIEW_REUSE','DEVELOPMENT_WORK','LOSSLESS_REVIEW','BUILD_DISPATCH','REVIEW_RECOVERY','CONTRIBUTIONS','LIFECYCLE','NEXUS'])environment[`MASTERMIND_NODE_${suffix}_ENABLED`]='true';
 const credential={},result=createMastermindCoreWorkerFromEnvironment({environment,credentialStoreFactory:()=>credential,transportFactory:()=>({}),workerFactory:o=>o});
 assert.equal(result.enableNexus,true);assert.equal(result.credentialStore,credential);assert(result.journalRoot.endsWith(path.join('state','node-exchange','v1')));
});
for(const action of ['catalog','verify'])test(`${action}: restart rechecks source and retains original saved timestamp`,async t=>{
 const f=await setup(t,action),first=f.make(),saved=(await first.worker.runOnce()).execution.receipt;await first.worker.stop();
 const next=f.make(),replay=(await next.worker.runOnce()).execution;assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt.result,saved.result);
 assert.equal(f.calls.length,3);assert(f.calls.every(r=>r.action===action));await next.worker.stop();
 assert.equal(saved.result.observedAt,'2026-08-15T04:00:02.001Z');
});
for(const failure of ['lost','http','altered','oversized'])test(`${failure} reply only repeats the same read after journal recovery`,async t=>{
 const f=await setup(t,'verify',(body,n,result)=>{if(n===1){if(failure==='lost')throw Error('private');if(failure==='http')return Response.json({},{status:503});
  if(failure==='oversized')return Response.json({...result,extra:'x'.repeat(73728)});return Response.json({...result,requestSha256:'0'.repeat(64)});}return Response.json(result);});
 const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});await first.worker.stop();
 const next=f.make();assert.equal((await next.worker.runOnce()).execution.receipt.state,'succeeded');assert.equal(f.calls.length,2);await next.worker.stop();
});
for(const reason of ['revoked','source-changed','basis-changed'])test(`${reason} withholds saved private outbox before exchange`,async t=>{
 const f=await setup(t,'catalog',(body,n,result)=>{if(n>1){if(reason==='revoked')return Response.json({},{status:403});
  if(reason==='source-changed')result.data.snapshotId='0'.repeat(64);else result.data.basis.revision='99';}return Response.json(result);});
 const first=f.make();await first.worker.runOnce();await first.worker.stop();
 const next=f.make();await assert.rejects(next.worker.runOnce());assert.equal(f.sent.length,1);assert.equal(f.calls.length,2);await next.worker.stop();
});
test('downgrade retains pending Nexus receipt for later compatible recovery',async t=>{
 const f=await setup(t),first=f.make(),saved=(await first.worker.runOnce()).execution.receipt;await first.worker.stop();
 const old=f.make(false);await assert.rejects(old.worker.runOnce(),{code:'NODE_RECEIPT_CAPABILITY_RECONCILIATION_REQUIRED'});await old.worker.stop();
 assert.equal(f.calls.length,1);const next=f.make();assert.deepEqual((await next.worker.runOnce()).execution.receipt.result,saved.result);await next.worker.stop();
});
test('fresh proof rejects old/future observations and never upgrades a saved timestamp',async()=>{
 const {request,result}=sample('verify');await freshNexusReceipt(result,request,{now:Date.parse(AT)+60000});
 await assert.rejects(freshNexusReceipt(result,request,{now:Date.parse(AT)+60001}),{code:'TASK_NEXUS_OBSERVATION_EXPIRED'});
 await assert.rejects(freshNexusReceipt(result,request,{now:Date.parse(AT)-5001}),{code:'TASK_NEXUS_OBSERVATION_EXPIRED'});
 assert(sameNexusDisclosure({...result,observedAt:'2026-08-16T04:00:02.000Z'},result));
 assert(!sameNexusDisclosure({...result,data:{verified:true,proposalSha256:'0'.repeat(64)}},result));
});
test('caller authority, mismatched task, save identity, unknown fields and malformed cursor are rejected',()=>{
 const {request}=sample('verify');for(const changed of [{...request,authorized:true},{...request,operationId:request.proposal.operationId},
  {...request,taskRef:{...request.taskRef,project:'foreign'}},{...request,snapshotId:'a'.repeat(64)}])assert.throws(()=>validateNexusInput(changed));
 const {result}=sample('catalog');assert.throws(()=>validateNexusReceipt({...result,executionAuthorized:true}));
 assert.throws(()=>validateNexusReceipt({...result,data:{...result.data,nextCursor:'0'.repeat(64)}}));
});
test('aborted or expired calls never contact local host; late responses do not succeed',async()=>{
 let calls=0;const {request,result}=sample('catalog'),controller=new AbortController();controller.abort();
 const client=new NativeTaskClient({now:()=>1,fetchImpl:()=>{calls++;return Response.json(result);}});
 await assert.rejects(client.nexus(request,{signal:controller.signal,deadlineMs:100}),{code:'TASK_NOT_STARTED'});
 await assert.rejects(client.nexus(request,{deadlineMs:1}),{code:'TASK_NOT_STARTED'});assert.equal(calls,0);
 let now=1;const late=new NativeTaskClient({now:()=>now,fetchImpl:async()=>{now=101;return Response.json(result);}});
 await assert.rejects(late.nexus(request,{deadlineMs:100}),{code:'TASK_LOCAL_UNCERTAIN'});
});
test('maximum Unicode label survives wire and disk limits through real journal recovery',async t=>{
 const f=await setup(t,'catalog',(body,n,result)=>{result.data.choice.title='\ud83d\ude00'.repeat(120);return Response.json(result);});
 const first=f.make(),saved=(await first.worker.runOnce()).execution.receipt;await first.worker.stop();
 assert(Buffer.byteLength(JSON.stringify(saved,null,2)+'\n')<=4096);v2.validateMastermindNodeReceipt(saved);
 assert.throws(()=>v2.validateMastermindNodeReceipt({...saved,jobId:NODE_ID}));
 const next=f.make();assert.deepEqual((await next.worker.runOnce()).execution.receipt.result,saved.result);await next.worker.stop();
});
test('verification binds proposal hash as well as transport request hash',async()=>{
 const {request,result}=sample('verify');await assert.rejects(nexusReceipt({...result,data:{verified:true,proposalSha256:'0'.repeat(64)}},request));
});
