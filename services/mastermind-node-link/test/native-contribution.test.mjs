import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeTaskClient,CONTRIBUTION_ENDPOINT} from '../src/native-task-client.mjs';
import {CONTRIBUTION,validateContributionInput,contributionLocalRequest,contributionReceipt,
 validateContributionReceipt,sameContributionDisclosure} from '../../../protocol/mastermind-node-exchange/native-contribution.mjs';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sha=c=>c.repeat(64);
const input=(action='catalog')=>({schemaVersion:1,action,taskRef:{taskId:uuid(1),project:'mastermind'},
 operationId:uuid(2),specificationId:sha('a'),importOperationId:action==='catalog'?null:uuid(3),snapshotId:null,cursor:null});
const records={assignmentId:sha('b'),responseId:sha('c'),reviewId:sha('d')};
const choice=(n=3)=>({importOperationId:uuid(n),packetId:sha('e'),recordIds:records,moduleId:'module-fixture',
 version:'1.0.0',packetAvailable:true,holds:[],sourceAndAuthorityVerifiedNow:false});
const local=(request=input(),recoverOnly=false)=>({...contributionLocalRequest(request,recoverOnly),kind:CONTRIBUTION,
 observedAt:'2026-09-23T06:00:00.000Z',executionAuthorized:false,mayAutomaticallyRerun:false,historicalSnapshot:true,
 ...(request.action==='catalog'?{choices:[choice()]}:{result:{ok:true,schemaVersion:1,operationId:request.importOperationId,
 specificationId:request.specificationId,phase:request.action==='prepare'?'preview':'staged',candidateId:sha('f'),
 moduleId:'module-fixture',version:'1.0.0',sourceCommit:'a'.repeat(40),sourceSha256:sha('b'),requirementsHash:sha('c'),
 testSpecHash:sha('d'),recordIds:records,currentActiveRevision:null,candidateStaged:request.action!=='prepare',
 replayed:request.action==='recover'||recoverOnly&&request.action!=='prepare',holds:request.action==='prepare'?['CONTRIBUTION_CANDIDATE_NOT_STAGED']:[],
 behavioralTests:'separate-native-workflow',executionAuthorized:false,activationPerformed:false,currentlyActive:false}})});

test('catalog pages stay within existing receipt limits and preserve stable exact snapshot',async()=>{
 let request=input();const result=local();result.choices=Array.from({length:8},(_,i)=>choice(i+3)).reverse();
 const seen=[];let snapshot;
 for(let i=0;i<8;i++){
  const receipt=await contributionReceipt(result,request);
  assert.equal(JSON.stringify(receipt).length<=1450,true);
  assert.equal(receipt.data.choice.sourceAndAuthorityVerifiedNow,false);
  assert.equal(Object.hasOwn(receipt.data.choice,'recordIds'),false);
  snapshot??=receipt.data.snapshotId;assert.equal(snapshot,receipt.data.snapshotId);
  seen.push(receipt.data.choice.importOperationId);
  request={...request,snapshotId:snapshot,cursor:receipt.data.nextCursor};
  assert.equal(receipt.data.nextCursor===null,i===7);
 }
 assert.equal(new Set(seen).size,8);
 const ordered=await contributionReceipt({...result,choices:[...result.choices].reverse()},input());
 assert.equal(ordered.data.snapshotId,snapshot);
});

test('catalog detects changed original records, missing cursor and ambiguous operation',async()=>{
 const first=await contributionReceipt(local(),input());
 const next={...input(),snapshotId:first.data.snapshotId,cursor:uuid(3)};
 const modified=local();modified.choices[0].recordIds={...records,reviewId:sha('f')};
 await assert.rejects(contributionReceipt(modified,next),{code:'TASK_CONTRIBUTION_CATALOG_CHANGED'});
 await assert.rejects(contributionReceipt(local(),{...next,cursor:uuid(90)}),{code:'TASK_CONTRIBUTION_CURSOR_INVALID'});
 const duplicate=local();duplicate.choices.push(choice());
 await assert.rejects(contributionReceipt(duplicate,input()));
});

test('empty and unavailable legacy choices report their actual state',async()=>{
 const empty=await contributionReceipt({...local(),choices:[]},input());
 assert.equal(empty.data.choice,null);assert.equal(empty.data.nextCursor,null);
 const result=local();Object.assign(result.choices[0],{moduleId:null,version:null,packetAvailable:false,holds:['CONTRIBUTION_PACKET_NOT_PREPARED']});
 assert.equal((await contributionReceipt(result,input())).data.choice.packetAvailable,false);
});

test('only lost staging maps to read-only recovery; preview and catalog never become stage',()=>{
 for(const action of ['catalog','prepare','stage','recover']){
  const body=contributionLocalRequest(input(action),true);
  assert.equal(body.action,action==='stage'?'recover':action);
  for(const key of ['operationId','snapshotId','cursor'])assert.equal(Object.hasOwn(body,key),false);
 }
});

test('preview, staged result and recovery retain exact candidate source and originals',async()=>{
 for(const action of ['prepare','stage','recover']){
  const request=input(action),receipt=await contributionReceipt(local(request),request);
  assert.equal(receipt.data.candidateId,sha('f'));assert.deepEqual(receipt.data.recordIds,records);
  assert.equal(receipt.executionAuthorized,false);
  assert.deepEqual(validateContributionReceipt(receipt,request),receipt);
  for(const key of ['code_text','repositoryRoot','grantRef','sourcePath'])assert.equal(JSON.stringify(receipt).includes(key),false);
 }
 const request=input('stage'),recovered=await contributionReceipt(local(request,true),request,true);
 assert.equal(recovered.action,'stage');assert.equal(recovered.observedAction,'recover');
 assert.equal(recovered.data.replayed,true);
});

test('forged fields, task/source identity, authority and incompatible phase fail closed',async()=>{
 const request=input('stage');
 for(const update of [{executionAuthorized:true},{sourcePath:'private'},{taskRef:{...request.taskRef,project:'foreign'}},
  {observedAt:'2026-02-31T00:00:00.000Z'},{action:'recover'}])
  await assert.rejects(contributionReceipt({...local(request),...update},request));
 for(const update of [{activationPerformed:true},{operationId:uuid(9)},{specificationId:sha('b')},
  {phase:'preview'},{candidateStaged:false},{currentlyActive:true},{sourceSha256:'bad'},
  {recordIds:{...records,reviewId:'bad'}},{code:'private'},{holds:['MADE_UP']}]){
  const result=local(request);Object.assign(result.result,update);
  await assert.rejects(contributionReceipt(result,request));
 }
});

test('caller cannot supply packets, permissions, destinations or collide job and import IDs',()=>{
 for(const update of [{packet:{}},{grantRef:'all'},{url:'http://foreign'},{operationId:uuid(3)},
  {schemaVersion:true},{cursor:uuid(4)},{snapshotId:sha('a')},{importOperationId:null}])
  assert.throws(()=>validateContributionInput({...input('stage'),...update}));
 assert.throws(()=>validateContributionInput({...input(),cursor:uuid(4)}));
 assert.throws(()=>contributionLocalRequest(input(),'yes'));
});

test('maximum supported names fit receipt budgets without widening journal limits',async()=>{
 const request=input();request.taskRef.project='p'.repeat(128);
 const result=local(request);result.choices[0].moduleId='m'.repeat(120);result.choices[0].version='v'.repeat(128);
 await contributionReceipt(result,request);
 const stage=input('stage');stage.taskRef.project='p'.repeat(128);
 const sr=local(stage);sr.result.sourceCommit='a'.repeat(64);sr.result.currentActiveRevision=sha('a');
 await contributionReceipt(sr,stage);
});

test('receipt redelivery rechecks immutable identity and allows forward progress only',async()=>{
 const request=input('stage'),saved=await contributionReceipt(local(request),request);
 const fresh=local(request,true);fresh.observedAt='2026-09-23T06:01:00.000Z';
 fresh.result.currentActiveRevision=sha('f');fresh.result.currentlyActive=true;
 const now=await contributionReceipt(fresh,request,true);
 assert.equal(sameContributionDisclosure(now,saved),true);
 assert.equal(sameContributionDisclosure(saved,saved),false);
 assert.equal(sameContributionDisclosure({...now,data:{...now.data,sourceSha256:sha('e')}},saved),false);
 const before={...saved,data:{...saved.data,phase:'prepared'},action:'recover',observedAction:'recover'};
 before.data.replayed=true;
 assert.equal(sameContributionDisclosure({...now,action:'recover'},before),true);
 assert.equal(sameContributionDisclosure({...before,recoveryOnly:true}, {...now,action:'recover'}),false);
});

test('catalog redelivery compares exact page and snapshot despite later observation time',async()=>{
 const saved=await contributionReceipt(local(),input());
 const now=await contributionReceipt({...local(),observedAt:'2026-09-23T06:02:00.000Z'},input(),true);
 assert.equal(sameContributionDisclosure(now,saved),true);
 assert.equal(sameContributionDisclosure({...now,data:{...now.data,snapshotId:sha('f')}},saved),false);
});

test('client uses fixed local endpoint and a lost stage can only recover',async()=>{
 for(const action of ['catalog','prepare','stage','recover']){
  const request=input(action),calls=[];
  const client=new NativeTaskClient({now:()=>0,fetchImpl:async(url,init)=>{
   calls.push({url,init});return Response.json(local(request,true));}});
  const receipt=await client.contribution(request,{deadlineMs:1000,recoverOnly:true});
  assert.equal(calls.length,1);assert.equal(calls[0].url,CONTRIBUTION_ENDPOINT);
  assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.headers.authorization,undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body),contributionLocalRequest(request,true));
  assert.equal(receipt.recoveryOnly,true);
 }
});

test('client rejects unsafe requests before dispatch and never retries uncertain calls',async()=>{
 let calls=0;
 const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{calls++;throw Error('PRIVATE PATH');}});
 await assert.rejects(client.contribution({...input(),url:'http://foreign'},{deadlineMs:1000}));
 await assert.rejects(client.contribution(input(),{deadlineMs:0}));
 assert.equal(calls,0);
 await assert.rejects(client.contribution(input('stage'),{deadlineMs:1000}),e=>e.code==='TASK_LOCAL_UNCERTAIN'&&!e.message.includes('PRIVATE'));
 assert.equal(calls,1);
});

test('client rejects failed, oversized and redirected replies without disclosing diagnostics',async()=>{
 for(const response of [()=>Response.json({error:'PRIVATE PATH'},{status:409}),
  ()=>new Response('x'.repeat(73729),{headers:{'content-type':'application/json'}}),
  ()=>{const r=Response.json(local());Object.defineProperty(r,'redirected',{value:true});return r;}]){
  let calls=0;const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{calls++;return response();}});
  await assert.rejects(client.contribution(input(),{deadlineMs:1000}),e=>!e.message.includes('PRIVATE'));
  assert.equal(calls,1);
 }
});

test('client cancellation bounds stalled fetch/body and checks time after hashing',async()=>{
 for(const stage of ['fetch','body']){
  const control=new AbortController();let calls=0;
  const client=new NativeTaskClient({now:()=>0,fetchImpl:async()=>{calls++;
   return stage==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});}});
  const timer=setTimeout(()=>control.abort(),10);
  try{await assert.rejects(client.contribution(input(),{deadlineMs:1000,signal:control.signal}),{code:'TASK_LOCAL_UNCERTAIN'});}
  finally{clearTimeout(timer);}
  assert.equal(calls,1);
 }
 let checks=0;const late=new NativeTaskClient({now:()=>++checks>2?1001:0,fetchImpl:async()=>Response.json(local())});
 await assert.rejects(late.contribution(input(),{deadlineMs:1000}),{code:'TASK_LOCAL_UNCERTAIN'});
});
