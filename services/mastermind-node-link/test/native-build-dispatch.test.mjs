import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {NativeTaskClient} from '../src/native-task-client.mjs';
import {BUILD_DISPATCH,validateBuildDispatchInput,buildDispatchLocalRequest,buildDispatchReceipt,validateBuildDispatchReceipt} from '../../../protocol/mastermind-node-exchange/native-build-dispatch.mjs';
import {LOSSLESS_DEVELOPMENT_CORE_WORKER} from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';

const fixture=JSON.parse(readFileSync(new URL('./runtime-build-dispatch-fixture.json',import.meta.url)));
const input=action=>({...fixture.request,action,operationId:'00000000-0000-4000-8000-000000000096',parentOperationId:'00000000-0000-4000-8000-000000000097'});
const options={deadlineMs:5000};

test('runtime outputs round-trip exactly through typed transport',()=>{
 for(const action of ['preflight','start','status','recover']){
  const result=fixture.results[action],request=input(action),receipt=buildDispatchReceipt(result,request);
  assert.equal(receipt.kind,BUILD_DISPATCH);assert.equal(receipt.planId,result.planId);
  assert.equal(receipt.buildOperationId,result.buildOperationId);
  assert.deepEqual(validateBuildDispatchReceipt(receipt,request),receipt);
  assert.equal(receipt.executionAuthorized,false);assert.equal(receipt.mayAutomaticallyRerun,false);
 }
});

test('network operation never replaces the durable coding operation',()=>{
 const request=input('start'),local=buildDispatchLocalRequest(request);
 assert.equal(local.buildOperationId,request.buildOperationId);
 assert.equal(local.operationId,undefined);assert.equal(local.parentOperationId,undefined);
 assert.equal(buildDispatchLocalRequest(request,true).action,'recover');
 for(const action of ['preflight','status','recover'])assert.equal(buildDispatchLocalRequest(input(action),true).action,action);
});

test('substituted identity, inline authority and unsupported operations are rejected',()=>{
 for(const bad of [{...input('start'),grant:{}},{...input('start'),instructions:'run'},
  {...input('start'),planId:'bad'},{...input('start'),schemaVersion:true},input('cancel'),input('stage'),
  {...input('start'),operationId:fixture.request.buildOperationId}])assert.throws(()=>validateBuildDispatchInput(bad));
 for(const key of ['planId','reviewId','specificationId']){
  const result={...fixture.results.status,[key]:'f'.repeat(64)};
  assert.throws(()=>buildDispatchReceipt(result,input('status')));
 }
});

test('held runtime preflight is a valid outcome, never a transport success claim',async()=>{
 const held={...fixture.results.preflight,ok:false,state:'held',holds:['BUILD_DISTINCT_CODING_AUTHORITY_REQUIRED']};
 const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>Response.json(held,{status:409})});
 const receipt=await client.buildDispatch(input('preflight'),options);
 assert.equal(receipt.ok,false);assert.equal(receipt.startAccepted,false);
 assert.deepEqual(receipt.holds,held.holds);
});

test('explicit start uses the fixed loopback endpoint once and keeps result bounded',async()=>{
 const calls=[];
 const client=new NativeTaskClient({now:()=>0,fetchImpl:async(url,opts)=>{
  calls.push({url,opts});return Response.json(fixture.results.start);
 }});
 const receipt=await client.buildDispatch(input('start'),options);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:8770/task_build_dispatch');
 assert.equal(calls[0].opts.redirect,'error');assert.equal(receipt.startAccepted,true);
 assert.equal(JSON.parse(calls[0].opts.body).buildOperationId,fixture.request.buildOperationId);
 assert.equal(Object.hasOwn(receipt,'source'),false);
});

test('uncertain start recovery sends only recover with the same identity',async()=>{
 const calls=[];
 const client=new NativeTaskClient({now:()=>0,fetchImpl:async(url,opts)=>{
  calls.push(JSON.parse(opts.body));return Response.json(fixture.results.recover);
 }});
 const receipt=await client.buildDispatch(input('start'),{...options,recoverOnly:true});
 assert.equal(calls[0].action,'recover');assert.equal(calls[0].buildOperationId,fixture.request.buildOperationId);
 assert.equal(receipt.action,'start');assert.equal(receipt.observedAction,'recover');
 assert.equal(receipt.recoveryOnly,true);assert.equal(receipt.startAccepted,false);
 assert.equal(receipt.sourceReady,true);assert.equal(calls.length,1);
});

test('aborted or expired work cannot make a local request',async()=>{
 let calls=0;const client=new NativeTaskClient({now:()=>100,fetchImpl:async()=>{calls++;throw Error('unexpected');}});
 await assert.rejects(client.buildDispatch(input('start'),{deadlineMs:99}),{code:'TASK_NOT_STARTED'});
 const controller=new AbortController();controller.abort();
 await assert.rejects(client.buildDispatch(input('start'),{...options,signal:controller.signal}),{code:'TASK_NOT_STARTED'});
 assert.equal(calls,0);
});

test('lost reply is uncertain and never retried by the client',async()=>{
 let calls=0;const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{calls++;throw Error('PRIVATE connection data');}});
 await assert.rejects(client.buildDispatch(input('start'),options),{code:'TASK_LOCAL_UNCERTAIN'});
 assert.equal(calls,1);
});

test('wrong status, malformed source truth, private fields and forged recovery are denied',async()=>{
 for(const result of [{...fixture.results.status,sourceReady:'yes'},
  {...fixture.results.status,privateSource:'secret'},
  {...fixture.results.status,holds:['private/path']},
  {...fixture.results.status,state:'activated'},
  {...fixture.results.status,executionAuthorized:true}]){
  const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>Response.json(result)});
  await assert.rejects(client.buildDispatch(input('status'),options));
 }
 const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>Response.json(fixture.results.start)});
 await assert.rejects(client.buildDispatch(input('start'),{...options,recoverOnly:true}));
});

test('receipt binds every transport identifier and observation mode',()=>{
 const valid=buildDispatchReceipt(fixture.results.status,input('status'));
 for(const key of ['operationId','parentOperationId','artifactOperationId','buildOperationId'])
  assert.throws(()=>validateBuildDispatchReceipt({...valid,[key]:'00000000-0000-4000-8000-000000000099'},input('status')));
 assert.throws(()=>validateBuildDispatchReceipt({...valid,observedAction:'start'}));
 assert.throws(()=>validateBuildDispatchReceipt({...valid,startAccepted:true}));
});

test('new source contract is not advertised before coupled ledger activation',()=>{
 assert.equal(LOSSLESS_DEVELOPMENT_CORE_WORKER.capabilities.some(c=>c.id===BUILD_DISPATCH),false);
 assert.equal(LOSSLESS_DEVELOPMENT_CORE_WORKER.capabilities.length,8);
});
