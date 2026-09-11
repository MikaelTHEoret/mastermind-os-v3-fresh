import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createMastermindCoreOnlyWorker} from '../src/core-worker.mjs';
import {NativeTaskClient} from '../src/native-task-client.mjs';
import {NativeTaskExecutor} from '../src/native-task-executor.mjs';
import {FileMastermindNodeEffectJournal} from '../src/effect-journal.mjs';
import * as legacy from '../../../protocol/mastermind-node-exchange/contract.mjs';
import * as v2 from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import {NATIVE_REUSE_CAPABILITY,validateNativeCommandInput,validateNativeTaskResult} from '../../../protocol/mastermind-node-exchange/native-task.mjs';
import {NODE_ID,NODE_CREDENTIAL,PAIRING_ID,BOOT_ID,JOB_ID,command,lease} from './fixtures.mjs';

const AT='2026-08-15T04:00:02.000Z';
const request=()=>({schemaVersion:1,action:'execute',taskRef:{taskId:'99999999-9999-4999-8999-999999999999',project:'mastermind'},
  specificationId:'a'.repeat(64),operationId:JOB_ID,capability:'release-inventory.diff',candidateId:'b'.repeat(64),
  requirementsHash:'c'.repeat(64),inputSha256:'d'.repeat(64),arguments:{before:[],after:[]}});
const nativeCommand=()=>command({capability:NATIVE_REUSE_CAPABILITY,input:request()});
const nativeLease=()=>{const c=nativeCommand();return lease({...c,commandDigest:v2.digestMastermindNodeCommand(c)});};
const reply=(input)=>({ok:true,reuse:{operationId:input.operationId,candidateId:input.candidateId,capability:input.capability,
  inputSha256:input.inputSha256,requestHash:'e'.repeat(64),resultSha256:'f'.repeat(64),status:'completed',
  result:{added:[],removed:[],changed:[],unchangedCount:0},replayed:input.action==='recover'}});
async function setup(t,behavior) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mm-native-worker-'));
  t.after(async()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
  const calls=[],sent=[];
  const native=new NativeTaskClient({now:()=>1,fetchImpl:async(url,init)=>{
    const input=JSON.parse(init.body);calls.push(input.action);
    return behavior ? behavior(input,calls.length) : Response.json(reply(input));
  }});
  const make=()=>{
    const journal=new FileMastermindNodeEffectJournal(root,{now:()=>Date.parse(AT)});
    return {journal,worker:createMastermindCoreOnlyWorker({journalRoot:root,journal,enableNativeTasks:true,
      nativeTaskClient:native,bootId:BOOT_ID,now:()=>Date.parse(AT),monotonicNow:()=>1,
      credentialStore:{async load(){return {schemaVersion:1,state:'paired',nodeId:NODE_ID,nodeCredential:NODE_CREDENTIAL,
        pairingId:PAIRING_ID,pairingCredential:null,displayName:'Fixture',createdAt:AT,pairedAt:AT};}},
      exchangeTransport:{async pair(){throw Error('must not pair');},async exchange(req){sent.push(req);return {
        schemaVersion:2,exchangeId:req.exchangeId,serverTime:AT,nextPollAfterMs:5000,
        acceptedWorker:v2.NATIVE_CORE_WORKER,acknowledgedReceiptIds:req.receipts.map(r=>r.receiptId),lease:nativeLease()};}}
    })};
  };
  return {make,calls,sent};
}

test('native commands require explicit v2 negotiation and exact task/operation binding',()=>{
  assert.throws(()=>legacy.validateMastermindNodeCommand(nativeCommand()));
  assert.deepEqual(v2.validateMastermindNodeCommand(nativeCommand()),nativeCommand());
  for(const edit of [{action:'recover'},{operationId:BOOT_ID},{taskRef:{taskId:'generic',project:'mastermind'}},
    {taskRef:{taskId:request().taskRef.taskId,project:'UPPER'}},{grantRef:'caller'},{arguments:{blob:'x'.repeat(4096)}}]) {
    assert.throws(()=>v2.validateMastermindNodeCommand({...nativeCommand(),input:{...request(),...edit}}));
  }
  assert.throws(()=>legacy.validateMastermindNodeWorker({...v2.NATIVE_CORE_WORKER,protocolVersion:1}));
});

test('native result rejects oversized/nonfinite data within existing receipt bounds',()=>{
  const r=reply(request()).reuse;
  const result={kind:NATIVE_REUSE_CAPABILITY,operationId:JOB_ID,specificationId:request().specificationId,
    taskRef:request().taskRef,candidateId:r.candidateId,capability:r.capability,inputSha256:r.inputSha256,
    resultSha256:r.resultSha256,result:r.result,replayed:false};
  assert.deepEqual(validateNativeTaskResult(result),result);
  for(const change of [{result:{blob:'x'.repeat(769)}},{result:{x:NaN}},{result:null},{callerGrant:'x'}])
    assert.throws(()=>validateNativeTaskResult({...result,...change}));
});

test('real worker/journal composition executes once, reloads, and reauthorizes outbox and replay',async(t)=>{
  const f=await setup(t);const first=f.make();
  assert.equal((await first.worker.runOnce()).execution.receipt.state,'succeeded');
  await first.worker.stop();
  const resumed=f.make();
  const response=await resumed.worker.runOnce();
  assert.equal(response.execution.replayed,true);
  assert.deepEqual(f.calls,['execute','recover','recover']);
  assert.deepEqual(f.sent[0].worker,v2.NATIVE_CORE_WORKER);
  assert.equal(f.sent[1].receipts.length,3);
  await resumed.worker.stop();
});

test('lost local reply leaves nonterminal journal and subsequent delivery only recovers',async(t)=>{
  const f=await setup(t,(input,count)=>{if(count===1)throw Error('lost after host completion');return Response.json(reply(input));});
  const first=f.make();
  await assert.rejects(first.worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});
  assert.equal((await first.journal.get(nativeLease())).terminal,null);
  await first.worker.stop();const resumed=f.make();
  assert.equal((await resumed.worker.runOnce()).execution.receipt.state,'succeeded');
  assert.deepEqual(f.calls,['execute','recover']);
  await resumed.worker.stop();
});

test('revoked task cannot disclose successful pending results after restart',async(t)=>{
  let revoked=false;
  const f=await setup(t,input=>revoked?Response.json({error:'denied'},{status:403}):Response.json(reply(input)));
  const first=f.make();await first.worker.runOnce();const before=await first.journal.listPendingReceipts();
  await first.worker.stop();revoked=true;const resumed=f.make();
  await assert.rejects(resumed.worker.runOnce());
  assert.equal(f.sent.length,1);assert.deepEqual(await resumed.journal.listPendingReceipts(),before);
  assert.deepEqual(f.calls,['execute','recover']);await resumed.worker.stop();
});

test('held recovery never repeats execution or becomes successful',async(t)=>{
  const f=await setup(t,(input,count)=>count===1?Promise.reject(Error('lost')):Response.json({ok:false,reuse:{
    operationId:JOB_ID,candidateId:request().candidateId,status:'held',holdCode:'REUSE_RECONCILIATION_REQUIRED'}},{status:409}));
  const {worker}=f.make();await assert.rejects(worker.runOnce());
  const recovered=await worker.runOnce();assert.equal(recovered.execution.receipt.state,'failed');
  assert.equal(recovered.execution.receipt.code,'recovery-manual-repair');
  assert.equal(recovered.execution.receipt.result,null);assert.deepEqual(f.calls,['execute','recover']);await worker.stop();
});

test('native admission rejects expired budget before host dispatch',async()=>{
  let calls=0;const executor=new NativeTaskExecutor({now:()=>10,core:{observeStatus(){}},native:{execute(){calls++;}}});
  await assert.rejects(executor.execute(nativeLease(),{deadlineMs:10,emit(){}}));assert.equal(calls,0);
});

test('formatting expansion cannot create records that exceed recovery read limits',()=>{
  const nested={};let cursor=nested;
  for(let i=0;i<10;i++){cursor.next={};cursor=cursor.next;}
  cursor.items=Array.from({length:100},()=>0);
  const input={...request(),arguments:nested};
  assert(Buffer.byteLength(JSON.stringify(input))<4096);
  assert.throws(()=>validateNativeCommandInput(input));
});

test('host HTTP failure after dispatch cannot be mistaken for proof of no execution',async(t)=>{
  const f=await setup(t,(input,count)=>count===1?Response.json({error:'temporary'},{status:503}):Response.json(reply(input)));
  const {worker,journal}=f.make();await assert.rejects(worker.runOnce(),{code:'NODE_NATIVE_RECOVERY_REQUIRED'});
  assert.equal((await journal.get(nativeLease())).terminal,null);
  assert.equal((await worker.runOnce()).execution.receipt.state,'succeeded');
  assert.deepEqual(f.calls,['execute','recover']);await worker.stop();
});
