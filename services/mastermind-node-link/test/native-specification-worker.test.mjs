import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createMastermindCoreOnlyWorker} from '../src/core-worker.mjs';
import {createMastermindCoreWorkerFromEnvironment} from '../src/run-core-worker.mjs';
import {NativeTaskClient,NATIVE_SPECIFICATION_ENDPOINT} from '../src/native-task-client.mjs';
import {FileMastermindNodeEffectJournal} from '../src/effect-journal.mjs';
import * as legacy from '../../../protocol/mastermind-node-exchange/contract.mjs';
import * as v2 from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import {NATIVE_SPECIFICATION_CAPABILITY as CAP,specificationRequestHash,validateNativeSpecificationReceipt} from '../../../protocol/mastermind-node-exchange/native-specification.mjs';
import {NODE_ID,NODE_CREDENTIAL,PAIRING_ID,BOOT_ID,JOB_ID,command,lease} from './fixtures.mjs';

const AT='2026-08-15T04:00:02.000Z';
const request=()=>({schemaVersion:1,action:'prepare',taskRef:{taskId:'99999999-9999-4999-8999-999999999999',project:'mastermind'},
  operationId:JOB_ID,request:'Compare release inventories',recipeId:null});
const wizardCommand=(input=request())=>command({capability:CAP,input});
const wizardLease=(input=request())=>{const c=wizardCommand(input);return lease({...c,commandDigest:v2.digestMastermindNodeCommand(c)});};
const reply=input=>({ok:true,schemaVersion:1,taskRef:input.taskRef,operationId:input.operationId,
  requestHash:specificationRequestHash(input),specification:{specificationId:'a'.repeat(64),title:'Compare release inventories',
    decision:'create',stage:'needs_specification',requirementsHash:null,missingCount:3},
  savedAt:AT,replayed:input.action==='recover',executionAuthorized:false});
async function setup(t,behavior,input=request()) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mm-wizard-worker-'));
  t.after(async()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
  const calls=[],sent=[];
  const native=new NativeTaskClient({now:()=>1,fetchImpl:async(url,init)=>{
    assert.equal(url,NATIVE_SPECIFICATION_ENDPOINT);const body=JSON.parse(init.body);calls.push(body.action);
    return behavior?behavior(body,calls.length):Response.json(reply(body));
  }});
  const make=(enabled=true)=>{
    const journal=new FileMastermindNodeEffectJournal(root,{now:()=>Date.parse(AT)});
    return {journal,worker:createMastermindCoreOnlyWorker({journalRoot:root,journal,enableNativeTasks:true,enableNativeSpecifications:enabled,
      nativeTaskClient:native,bootId:BOOT_ID,now:()=>Date.parse(AT),monotonicNow:()=>1,
      credentialStore:{async load(){return {schemaVersion:1,state:'paired',nodeId:NODE_ID,nodeCredential:NODE_CREDENTIAL,
        pairingId:PAIRING_ID,pairingCredential:null,displayName:'Fixture',createdAt:AT,pairedAt:AT};}},
      exchangeTransport:{async pair(){throw Error('must not pair');},async exchange(req){sent.push(req);return {
        schemaVersion:2,exchangeId:req.exchangeId,serverTime:AT,nextPollAfterMs:5000,
        acceptedWorker:enabled?v2.WIZARD_CORE_WORKER:v2.NATIVE_CORE_WORKER,
        acknowledgedReceiptIds:req.receipts.map(r=>r.receiptId),lease:wizardLease(input)};}}
    })};
  };
  return {make,calls,sent};
}

test('Wizard command requires v2, canonical task, job binding and bounded intent without grants',()=>{
  assert.throws(()=>legacy.validateMastermindNodeCommand(wizardCommand()));
  assert.deepEqual(v2.validateMastermindNodeCommand(wizardCommand()),wizardCommand());
  for(const edit of [{action:'recover'},{operationId:BOOT_ID},{taskRef:{taskId:'generic',project:'mastermind'}},
    {taskRef:{...request().taskRef,project:'UPPER'}},{grantRef:'caller'},{request:'x'.repeat(3000)},{request:'💡'.repeat(800)}])
    assert.throws(()=>v2.validateMastermindNodeCommand(wizardCommand({...request(),...edit})));
  assert.equal(v2.NATIVE_CORE_WORKER.capabilities.some(c=>c.id===CAP),false);
});
test('receipt binds exact request and cannot invent execution permission or expose source',()=>{
  const result={kind:CAP,...reply(request())};
  assert.deepEqual(validateNativeSpecificationReceipt(result,request()),result);
  for(const edit of [{requestHash:'f'.repeat(64)},{operationId:BOOT_ID},{executionAuthorized:true},{source:'private'},
    {specification:{...result.specification,stage:'specified'}}])
    assert.throws(()=>validateNativeSpecificationReceipt({...result,...edit},request()));
});
test('worker prepares once, reloads journal, reauthorizes outbox and recovers same saved intent',async t=>{
  const f=await setup(t);const first=f.make();
  assert.equal((await first.worker.runOnce()).execution.receipt.state,'succeeded');await first.worker.stop();
  const resumed=f.make();assert.equal((await resumed.worker.runOnce()).execution.replayed,true);
  assert.deepEqual(f.calls,['prepare','recover','recover']);assert.deepEqual(f.sent[0].worker,v2.WIZARD_CORE_WORKER);
  assert.equal(f.sent[1].receipts.at(-1).result.executionAuthorized,false);await resumed.worker.stop();
});
for(const failure of ['lost','http','altered'])test(`${failure} reply preserves uncertain operation and restart only recovers`,async t=>{
  const f=await setup(t,(input,count)=>{
    if(count!==1)return Response.json(reply(input));
    if(failure==='lost')throw Error('reply lost after save');
    return failure==='http'?Response.json({}, {status:503}):Response.json({...reply(input),requestHash:'f'.repeat(64)});
  });
  const first=f.make();await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});
  assert.equal((await first.journal.get(wizardLease())).terminal,null);await first.worker.stop();
  const resumed=f.make();assert.equal((await resumed.worker.runOnce()).execution.receipt.state,'succeeded');
  assert.deepEqual(f.calls,['prepare','recover']);await resumed.worker.stop();
});
test('missing retained operation remains held without preparing again',async t=>{
  const f=await setup(t,()=>Response.json({}, {status:409}));const first=f.make();
  for(let i=0;i<2;i++)await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});
  assert.deepEqual(f.calls,['prepare','recover']);assert.equal((await first.journal.get(wizardLease())).terminal,null);await first.worker.stop();
});
for(const failure of ['revoked','changed'])test(`${failure} authority or saved intent blocks outbox disclosure`,async t=>{
  const f=await setup(t,(input,count)=>count===1?Response.json(reply(input)):
    failure==='revoked'?Response.json({}, {status:403}):Response.json({...reply(input),specification:{...reply(input).specification,title:'Changed'}}));
  const first=f.make();await first.worker.runOnce();await first.worker.stop();const resumed=f.make();
  await assert.rejects(resumed.worker.runOnce());assert.equal(f.sent.length,1);
  assert.equal((await resumed.journal.get(wizardLease())).terminal.state,'succeeded');await resumed.worker.stop();
});
test('ordinary native worker never accepts Wizard lease without opt-in',async t=>{
  const f=await setup(t);const {worker}=f.make(false);await assert.rejects(worker.runOnce());assert.equal(f.calls.length,0);await worker.stop();
});
test('large Unicode request and response survive real journal write and restart within limits',async t=>{
  const input={...request(),request:'💡'.repeat(650)};
  const f=await setup(t,body=>Response.json({...reply(body),specification:{...reply(body).specification,title:'💡'.repeat(80)}}),input);
  const first=f.make();await first.worker.runOnce();await first.worker.stop();const resumed=f.make();
  assert.equal((await resumed.worker.runOnce()).execution.replayed,true);await resumed.worker.stop();
});
test('invalid Wizard activation fails before credentials are accessed',()=>{
  for(const setting of ['yes',true,'true']){
    let calls=0;assert.throws(()=>createMastermindCoreWorkerFromEnvironment({environment:{
      LOCALAPPDATA:'C:\\Users\\Fixture\\AppData\\Local',
      MASTERMIND_NODE_WORKER_PROFILE:'core-only',MASTERMIND_LOCAL_CHILD_ROLE:'mastermind-node-link-core',
      MASTERMIND_NODE_NATIVE_SPECIFICATION_ENABLED:setting},credentialStoreFactory(){calls++;}}),{code:'NODE_NATIVE_PROFILE_INVALID'});
    assert.equal(calls,0);
  }
});
test('valid explicit Wizard activation reaches production composition unchanged',()=>{
  let received;
  createMastermindCoreWorkerFromEnvironment({environment:{LOCALAPPDATA:'C:\\Users\\Fixture\\AppData\\Local',
    MASTERMIND_MINECRAFT_DATA_DIR:'E:\\RetainedPortable',MASTERMIND_NODE_WORKER_PROFILE:'core-only',
    MASTERMIND_LOCAL_CHILD_ROLE:'mastermind-node-link-core',MASTERMIND_NODE_NATIVE_REUSE_ENABLED:'true',
    MASTERMIND_NODE_NATIVE_SPECIFICATION_ENABLED:'true'},credentialStoreFactory:()=>({}),transportFactory:()=>({}),
    workerFactory:options=>{received=options;return {};}});
  assert.equal(received.enableNativeTasks,true);assert.equal(received.enableNativeSpecifications,true);
});
