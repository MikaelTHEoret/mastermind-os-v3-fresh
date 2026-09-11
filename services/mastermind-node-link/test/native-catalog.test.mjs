import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeTaskClient,NATIVE_CATALOG_ENDPOINT} from '../src/native-task-client.mjs';
import {validateNativeCatalogRequest,validateNativeCatalogResult} from '../../../protocol/mastermind-node-exchange/native-catalog.mjs';
const request=()=>({schemaVersion:1,taskRef:{taskId:'task-1',project:'mastermind'},snapshotId:null,cursor:null});
const result=()=>({ok:true,schemaVersion:1,taskRef:request().taskRef,snapshotId:'a'.repeat(64),
  entry:{specificationId:'b'.repeat(64),candidateId:'c'.repeat(64),requirementsHash:'d'.repeat(64),
    capability:'release-inventory.diff',title:'Compare releases',version:'1.0.0',effectClass:'READ_ONLY',
    inputSchema:{type:'object',properties:{before:{type:'object'},after:{type:'object'}},additionalProperties:false}},
  nextCursor:null,observedAt:'2026-09-11T04:00:00.123456+00:00',executionAuthorized:false});
const options={deadlineMs:1000};
test('catalog broker uses fixed read endpoint and returns only checked task-bound metadata',async()=>{
  const calls=[];
  const client=new NativeTaskClient({now:()=>0,fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json(result());}});
  assert.deepEqual(await client.catalog(request(),options),result());
  assert.equal(calls.length,1);assert.equal(calls[0].url,NATIVE_CATALOG_ENDPOINT);
  assert.equal(calls[0].init.redirect,'error');assert.deepEqual(JSON.parse(calls[0].init.body),request());
  assert.equal(calls[0].init.headers.authorization,undefined);
});
test('malformed requests, caller destinations, grants and invalid pagination never dispatch',async()=>{
  let calls=0;const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{calls++;throw Error();}});
  for(const update of [{url:'https://foreign.invalid'},{grantRef:'forged'},{snapshotId:undefined},{schemaVersion:true},
      {cursor:'b'.repeat(64)},{snapshotId:'bad'},{taskRef:{taskId:'foreign'}},{taskRef:{...request().taskRef,scope:'all'}}])
    await assert.rejects(client.catalog({...request(),...update},options));
  await assert.rejects(client.catalog(request(),{deadlineMs:0}));assert.equal(calls,0);
});
test('changed task, snapshot, unsafe entry, claimed authority and private extra fields fail closed',()=>{
  const value=result();
  for(const update of [{taskRef:{...value.taskRef,taskId:'other'}},{grantRef:'secret'},{executionAuthorized:true},
      {observedAt:'yesterday'},{snapshotId:'bad'},{entry:{...value.entry,sourcePath:'C:/private'}},
      {entry:{...value.entry,effectClass:'WRITE'}},{entry:{...value.entry,inputSchema:{type:'string'}}},
      {entry:{...value.entry,inputSchema:{type:'object',maximum:Infinity}}}])
    assert.throws(()=>validateNativeCatalogResult({...value,...update},request()));
  assert.throws(()=>validateNativeCatalogResult(value,{...request(),snapshotId:'e'.repeat(64)}));
});
test('empty catalogs remain empty; next pages retain snapshot without cursor loops',()=>{
  const empty={...result(),entry:null};assert.deepEqual(validateNativeCatalogResult(empty,request()),empty);
  assert.throws(()=>validateNativeCatalogResult({...empty,nextCursor:'b'.repeat(64)},request()));
  const next={...request(),snapshotId:'a'.repeat(64),cursor:'b'.repeat(64)};
  assert.deepEqual(validateNativeCatalogRequest(next),next);
  assert.throws(()=>validateNativeCatalogResult({...result(),nextCursor:next.cursor},next));
});
test('failed reads never retry or disclose local diagnostics',async()=>{
  for(const response of [()=>Response.json({error:'private path'},{status:409}),()=>{throw Error('private path');},
      ()=>new Response('x'.repeat(73729),{headers:{'content-type':'application/json'}})]) {
    let calls=0;const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{calls++;return response();}});
    await assert.rejects(client.catalog(request(),options),e=>!e.message.includes('private path'));
    assert.equal(calls,1);
  }
});
test('catalog cancellation bounds stalled fetch and body without invocation retry',async()=>{
  for(const stage of ['fetch','body']) {
    const control=new AbortController();let calls=0;
    const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{calls++;
      return stage==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
    }});
    const timer=setTimeout(()=>control.abort(),10);
    try{await assert.rejects(client.catalog(request(),{...options,signal:control.signal}),{code:'TASK_CATALOG_UNAVAILABLE'});}
    finally{clearTimeout(timer);}
    assert.equal(calls,1);
  }
});
