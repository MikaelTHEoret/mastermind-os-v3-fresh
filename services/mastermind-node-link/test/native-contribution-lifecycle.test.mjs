import test from 'node:test';
import assert from 'node:assert/strict';
import {LIFECYCLE,validateLifecycleInput,lifecycleLocalRequest,lifecycleReceipt,validateLifecycleReceipt,sameLifecycleDisclosure} from '../../../protocol/mastermind-node-exchange/native-contribution-lifecycle.mjs';
import {NativeTaskClient} from '../src/native-task-client.mjs';
import {validateMastermindNodeCommand,validateMastermindNodeWorker} from '../../../protocol/mastermind-node-exchange/contract.mjs';
import {LIFECYCLE_CORE_WORKER} from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import {lifecycleRequest} from '../../../src/lib/native-development/remote-workflow.mjs';
import {id,input,data,local} from './lifecycle-fixture.mjs';
test('strict request rejects inline authority, malformed identities and confused IDs',()=>{
 for(const changes of [{grantRef:'forged'},{schemaVersion:true},{action:'promote'},{candidateId:'bad'},{operationId:id(2)},{operation:'test'},{taskRef:{...input.taskRef,actor:'other'}}])assert.throws(()=>validateLifecycleInput({...input,...changes}));
 assert.deepEqual(validateLifecycleInput(input),input);
});
test('eleven-capability profile is explicit and validates unchanged task origin',()=>{
 assert.equal(validateMastermindNodeWorker(LIFECYCLE_CORE_WORKER).capabilities.length,11);
 const command={jobId:input.operationId,nodeId:id(4),capability:LIFECYCLE,capabilityVersion:1,policyClass:'routine',input};
 assert.equal(validateMastermindNodeCommand(command,{core:true}).capability,LIFECYCLE);
 assert.throws(()=>validateMastermindNodeCommand(command));
 assert.throws(()=>validateMastermindNodeCommand({...command,jobId:id(8)},{core:true}));
});
test('local response strips private evidence and requires exact request binding',()=>{
 const result=lifecycleReceipt(local(),input);assert.equal(result.data.moduleId,'development.packet');
 assert.throws(()=>lifecycleReceipt({...local(),permissionScope:{}},input));
 assert.throws(()=>lifecycleReceipt({...local(),candidateId:'e'.repeat(64)},input));
 assert.throws(()=>validateLifecycleReceipt({...result,observedAt:'2026-02-30T00:00:00.000Z'}));
});
test('progress, active proxy and rollback consistency are validated',()=>{
 for(const change of [{currentlyActive:true},{activeProxyAvailable:true},{rollbackRevision:null},{test:{operationId:id(8),status:'passed',completedCases:0,caseCount:25,failedCaseId:null}},{holds:['PRIVATE']}])assert.throws(()=>lifecycleReceipt(local(input,{...data,...change}),input));
});
test('uncertain execution recovers the same operation and never changes its effect',()=>{
 const i={...input,action:'execute',operation:'promote',lifecycleOperationId:id(5),expectedActiveRevision:data.activeRevision};
 assert.equal(lifecycleLocalRequest(i,true).action,'recover');
 assert.equal(lifecycleLocalRequest(i,true).lifecycleOperationId,id(5));
 const saved=lifecycleReceipt(local(i,{...data,operationState:'uncertain'}),i);
 const current=lifecycleReceipt(local(i,{...data,operationState:'completed',activeRevision:i.candidateId,currentlyActive:true,activeProxyAvailable:true},true),i,true);
 assert(sameLifecycleDisclosure(current,saved));assert(!sameLifecycleDisclosure(saved,current));
 assert(!sameLifecycleDisclosure({...current,candidateId:'f'.repeat(64)},saved));
});
test('fixed broker recovers once, without retries or arbitrary URLs',async()=>{
 const i={...input,action:'execute',operation:'test',lifecycleOperationId:id(5)};const calls=[];
 const client=new NativeTaskClient({now:()=>0,fetchImpl:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return new Response(JSON.stringify(local(i,{...data,operationState:'uncertain'},true)),{headers:{'content-type':'application/json'}});}});
 const receipt=await client.lifecycle(i,{deadlineMs:1000,recoverOnly:true});assert.equal(receipt.data.operationState,'uncertain');assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:8770/task_contribution_lifecycle');assert.equal(calls[0].body.action,'recover');
});
test('lost local response is uncertain and never retried',async()=>{
 let calls=0;const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{calls++;throw Error('private');}});
 await assert.rejects(client.lifecycle(input,{deadlineMs:1000}),e=>e.code==='TASK_LOCAL_UNCERTAIN');assert.equal(calls,1);
});
test('expired request never reaches broker',async()=>{
 const client=new NativeTaskClient({now:()=>100,fetchImpl:async()=>{throw Error('must not call');}});
 await assert.rejects(client.lifecycle(input,{deadlineMs:50}),e=>e.code==='TASK_NOT_STARTED');
});
