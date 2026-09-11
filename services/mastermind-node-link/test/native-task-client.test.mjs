import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeTaskClient, NativeTaskError, NATIVE_TASK_ENDPOINT} from '../src/native-task-client.mjs';

const request = () => ({schemaVersion:1, action:'execute', taskRef:{taskId:'task-1',project:'mastermind'},
  specificationId:'a'.repeat(64),operationId:'operation-1',capability:'release-inventory.diff',
  candidateId:'b'.repeat(64),requirementsHash:'c'.repeat(64),inputSha256:'d'.repeat(64),arguments:{before:{},after:{}}});
const success = (input, replayed=false) => ({ok:true,reuse:{operationId:input.operationId,candidateId:input.candidateId,
  capability:input.capability,inputSha256:input.inputSha256,requestHash:'e'.repeat(64),resultSha256:'f'.repeat(64),
  result:{added:['new-file'],removed:[],changed:[]},status:'completed',replayed}});
const options = {deadlineMs:1000};

test('fixed task broker carries exact request and recovers only the saved operation', async () => {
  const calls=[]; const client = new NativeTaskClient({now:()=>0,fetchImpl:async(url,init)=>{
    calls.push({url,init}); const input=JSON.parse(init.body);
    return Response.json(success(input,input.action==='recover'));
  }});
  await client.execute(request(),options);
  await client.execute({...request(),action:'recover'},options);
  assert.equal(calls.length,2);
  for(const call of calls) {
    assert.equal(call.url,NATIVE_TASK_ENDPOINT);assert.equal(call.init.redirect,'error');
    assert.equal(call.init.method,'POST');assert.equal(Object.keys(call.init.headers).length,2);
  }
  assert.deepEqual(JSON.parse(calls[0].init.body),request());
});

test('invalid inputs, caller authority and expired admission never dispatch', async () => {
  let count=0; const client=new NativeTaskClient({now:()=>10,fetchImpl:async()=>{count++;throw Error();}});
  for(const change of [{url:'https://foreign.invalid'},{grantRef:'caller'},{schemaVersion:true},
    {action:'generate'},{taskRef:{taskId:'x'}},{arguments:{_mastermind_context:{}}},
    {arguments:{value:NaN}},{arguments:{value:'x'.repeat(65536)}},{arguments:{value:1.5}}]) {
    await assert.rejects(client.execute({...request(),...change},options),NativeTaskError);
  }
  await assert.rejects(client.execute(request(),{deadlineMs:10}),{code:'TASK_NOT_STARTED'});
  const control=new AbortController();control.abort();
  await assert.rejects(client.execute(request(),{...options,signal:control.signal}),{code:'TASK_NOT_STARTED'});
  assert.equal(count,0);
});

test('uncertain transport outcome is surfaced without automatic retry', async () => {
  let count=0;const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{count++;throw Error('private server details');}});
  await assert.rejects(client.execute(request(),options),error=>error.code==='TASK_LOCAL_UNCERTAIN'&&!error.message.includes('private'));
  assert.equal(count,1);
});

test('mismatched receipts and fresh execution disguised as recovery fail', async () => {
  for(const change of [{operationId:'other'},{candidateId:'a'.repeat(64)},{inputSha256:'a'.repeat(64)},
    {capability:'shell.execute'},{status:'started'},{resultSha256:'invalid'}]) {
    const response=success(request());Object.assign(response.reuse,change);
    const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>Response.json(response)});
    await assert.rejects(client.execute(request(),options),{code:'TASK_RESULT_INVALID'});
  }
  const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>Response.json(success(request()))});
  await assert.rejects(client.execute({...request(),action:'recover'},options),{code:'TASK_RESULT_INVALID'});
});

test('held operation remains held; it is never presented as success', async () => {
  const held={ok:false,reuse:{operationId:'operation-1',candidateId:'b'.repeat(64),status:'held',holdCode:'REUSE_RECONCILIATION_REQUIRED'}};
  const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>Response.json(held,{status:409})});
  assert.deepEqual(await client.execute(request(),options),held);
});

test('oversized and non-JSON responses are rejected', async () => {
  for(const response of [new Response('x',{headers:{'content-type':'text/html'}}),
    new Response('x'.repeat(73729),{headers:{'content-type':'application/json'}})]) {
    const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>response});
    await assert.rejects(client.execute(request(),options),{code:'TASK_RESULT_INVALID'});
  }
});

test('response received after the execution deadline remains uncertain', async () => {
  let now=0;
  const client=new NativeTaskClient({now:()=>now,fetchImpl:async()=>{now=1001;return Response.json(success(request()));}});
  await assert.rejects(client.execute(request(),options),{code:'TASK_LOCAL_UNCERTAIN'});
});


test('cancellation bounds an unresponsive fetch and body reader without retry', async () => {
  for(const stage of ['fetch','body']) {
    const controller=new AbortController();let count=0;
    const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{
      count++;
      if(stage==='fetch')return new Promise(()=>{});
      return new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
    }});
    const timer=setTimeout(()=>controller.abort(),15);
    try { await assert.rejects(client.execute(request(),{...options,signal:controller.signal}),{code:'TASK_LOCAL_UNCERTAIN'}); }
    finally { clearTimeout(timer); }
    assert.equal(count,1);
  }
});
