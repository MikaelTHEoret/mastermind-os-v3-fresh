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
import {NATIVE_CATALOG_CAPABILITY,validateNativeCatalogReceipt} from '../../../protocol/mastermind-node-exchange/native-catalog.mjs';
import {NODE_ID,NODE_CREDENTIAL,PAIRING_ID,BOOT_ID,JOB_ID,command,lease} from './fixtures.mjs';

const AT='2026-08-15T04:00:02.000Z';
const request=()=>({schemaVersion:1,taskRef:{taskId:'99999999-9999-4999-8999-999999999999',project:'mastermind'},snapshotId:null,cursor:null});
const nativeCommand=()=>command({capability:NATIVE_CATALOG_CAPABILITY,input:request()});
const nativeLease=()=>{const c=nativeCommand();return lease({...c,commandDigest:v2.digestMastermindNodeCommand(c)});};
const reply=input=>({ok:true,schemaVersion:1,taskRef:input.taskRef,snapshotId:'a'.repeat(64),
 entry:{specificationId:'b'.repeat(64),candidateId:'c'.repeat(64),requirementsHash:'d'.repeat(64),capability:'release-inventory.diff',title:'Compare releases',version:'1.0.0',effectClass:'READ_ONLY',inputSchema:{type:'object',properties:{before:{type:'array'},after:{type:'array'}},required:['before','after']}},
 nextCursor:null,observedAt:AT,executionAuthorized:false});
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


test('catalog worker saves bounded receipts, restores original observation and rechecks disclosure after restart',async t=>{
 const f=await setup(t,(input,count)=>Response.json({...reply(input),observedAt:count===1?AT:'2026-08-15T04:00:03.000Z'}));
 const first=f.make();const response=await first.worker.runOnce();assert.equal(response.execution.receipt.state,'succeeded');
 const original=response.execution.receipt.result;assert.equal(original.kind,NATIVE_CATALOG_CAPABILITY);
 assert(Buffer.byteLength(JSON.stringify(response.execution.receipt))<=2048);assert(Buffer.byteLength(JSON.stringify(response.execution.receipt,null,2))<=4096);
 await first.worker.stop();const resumed=f.make();const recovered=await resumed.worker.runOnce();
 assert.equal(recovered.execution.replayed,true);assert.deepEqual(recovered.execution.receipt.result,original);
 assert.equal(f.calls.length,3);await resumed.worker.stop();
});
test('changed catalog or revoked read withholds the entire successful pending outbox',async t=>{
 for(const mode of ['changed','revoked']) {
   let changed=false;
   const f=await setup(t,input=>changed?(mode==='revoked'?Response.json({error:'private'},{status:403}):Response.json({...reply(input),snapshotId:'e'.repeat(64)})):Response.json(reply(input)));
   const first=f.make();await first.worker.runOnce();const before=await first.journal.listPendingReceipts();await first.worker.stop();changed=true;
   const resumed=f.make();await assert.rejects(resumed.worker.runOnce());
   assert.deepEqual(await resumed.journal.listPendingReceipts(),before);assert.equal(f.sent.length,1);await resumed.worker.stop();
 }
});
test('unavailable or oversized catalog fails without code execution or partial metadata',async t=>{
 const f=await setup(t,input=>Response.json({...reply(input),entry:{...reply(input).entry,inputSchema:{type:'object',description:'x'.repeat(2000)}}}));
 const first=f.make();const outcome=await first.worker.runOnce();assert.equal(outcome.execution.receipt.state,'failed');
 assert.equal(outcome.execution.receipt.result,null);assert.equal(f.calls.length,1);await first.worker.stop();
});
