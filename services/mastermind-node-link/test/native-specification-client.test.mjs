import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NativeTaskClient,NATIVE_SPECIFICATION_ENDPOINT} from '../src/native-task-client.mjs';
import {specificationBindingCanonical} from '../../../protocol/mastermind-node-exchange/native-specification.mjs';
const request=()=>({schemaVersion:1,action:'prepare',taskRef:{taskId:'fixture-task',project:'fixture-project'},
  operationId:'65c82f35-7ba3-4eb7-8906-c6bb527fb4a5',request:'Preserve every field',recipeId:null});
const success=input=>({ok:true,schemaVersion:1,taskRef:input.taskRef,operationId:input.operationId,
  requestHash:createHash('sha256').update(specificationBindingCanonical(input)).digest('hex'),
  specification:{specificationId:'a'.repeat(64),title:'Preserve every field',decision:'create',stage:'needs_specification',requirementsHash:null,missingCount:3},
  savedAt:'2026-09-11T00:00:00+00:00',replayed:input.action==='recover',executionAuthorized:false});

test('Wizard broker binds prepare and explicit recovery to one fixed local endpoint',async()=>{
  const calls=[];const client=new NativeTaskClient({now:()=>0,fetchImpl:async(url,init)=>{
    calls.push({url,init});return Response.json(success(JSON.parse(init.body)));
  }});
  const first=await client.specification(request(),{deadlineMs:1000});
  const second=await client.specification({...request(),action:'recover'},{deadlineMs:1000});
  assert.equal(first.requestHash,second.requestHash);assert.equal(second.replayed,true);
  assert.equal(calls.length,2);
  for(const {url,init} of calls){assert.equal(url,NATIVE_SPECIFICATION_ENDPOINT);assert.equal(init.redirect,'error');}
});

test('invalid request and expired admission never call the broker',async()=>{
  let count=0;const client=new NativeTaskClient({now:()=>5,fetchImpl:async()=>{count++;}});
  for(const change of [{action:'build'},{schemaVersion:true},{grantRef:'caller'},{request:' x '},
    {request:'x'.repeat(4001)},{request:'\ud800'},{operationId:'not-uuid'},{recipeId:'../escape'}]){
    await assert.rejects(client.specification({...request(),...change},{deadlineMs:1000}));
  }
  await assert.rejects(client.specification(request(),{deadlineMs:5}),{code:'TASK_NOT_STARTED'});
  assert.equal(count,0);
});

test('altered bindings, invented execution authority and fresh recovery are rejected',async()=>{
  for(const change of [{requestHash:'f'.repeat(64)},{operationId:'other'},{executionAuthorized:true},
    {taskRef:{taskId:'other',project:'fixture-project'}},{replayed:false},{privateSource:'should not be exposed'}]){
    const input={...request(),action:'recover'};
    const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>Response.json({...success(input),...change})});
    await assert.rejects(client.specification(input,{deadlineMs:1000}),{code:'TASK_SPECIFICATION_INVALID'});
  }
});

test('lost reply never sends an automatic retry or discloses private transport errors',async()=>{
  let count=0;const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{count++;throw Error('private path');}});
  await assert.rejects(client.specification(request(),{deadlineMs:1000}),{code:'TASK_LOCAL_UNCERTAIN'});
  assert.equal(count,1);
});

test('cancellation bounds an unresponsive broker and late result stays uncertain',async()=>{
  const controller=new AbortController();let count=0;
  const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{count++;return new Promise(()=>{});}});
  const pending=client.specification(request(),{deadlineMs:1000,signal:controller.signal});
  controller.abort();await assert.rejects(pending,{code:'TASK_LOCAL_UNCERTAIN'});assert.equal(count,1);
  let now=0;const late=new NativeTaskClient({now:()=>now,fetchImpl:async()=>{now=1001;return Response.json(success(request()));}});
  await assert.rejects(late.specification(request(),{deadlineMs:1000}),{code:'TASK_LOCAL_UNCERTAIN'});
});
