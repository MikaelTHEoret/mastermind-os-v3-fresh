import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';import ts from 'typescript';
import * as lifecycle from '../../../protocol/mastermind-node-exchange/native-contribution-lifecycle.mjs';
import {lifecycleRequest,checkedRemoteJob} from './remote-workflow.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={schemaVersion:1,action:'inspect',taskRef:{taskId:id(1),project:'mastermind'},specificationId:'a'.repeat(64),importOperationId:id(2),candidateId:'b'.repeat(64),operation:null,lifecycleOperationId:null,expectedActiveRevision:null,operationId:id(3)};
const data={operationState:'inspection',moduleId:'development.packet',version:'1.1.0',activeRevision:'c'.repeat(64),currentlyActive:false,activeProxyAvailable:false,recordedOutcome:null,test:null,rollbackRevision:'c'.repeat(64),rollbackAccepted:true,holds:['NATIVE_TESTS_NOT_STARTED']};
const AT='2026-09-24T18:00:00.000Z';
function fixture(i=input,d=data){
 const receipt=lifecycle.validateLifecycleReceipt({...i,kind:lifecycle.LIFECYCLE,observedAction:i.action,observedAt:AT,recoveryOnly:false,data:d});
 const pending={nodeId:id(4),taskId:i.taskRef.taskId,operationId:i.operationId,capability:lifecycle.LIFECYCLE,body:{operationId:i.operationId,input:i}};
 const job={jobId:i.operationId,nodeId:pending.nodeId,capability:pending.capability,capabilityVersion:1,policyClass:'routine',state:'succeeded',createdAt:AT,expiresAt:'2026-09-24T18:30:00.000Z',lease:null,terminal:{code:'desired-state-reached',finishedAt:AT,result:receipt}};
 return {pending,job,receipt};
}
const compiled=ts.transpileModule(fs.readFileSync(new URL('../../components/NativeLifecycleResult.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(value,disabled=false){const calls=[],module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,require(name){if(name==='react/jsx-runtime')return jsx;if(name.includes('native-contribution-lifecycle'))return lifecycle;throw Error(name);}});
 const tree=module.exports.default({value,disabled,onAction:a=>calls.push(a)});
 const all=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(all)];
 return {calls,html:renderToStaticMarkup(tree),buttons:all(tree).filter(n=>n.type==='button')};}
test('saved candidate offers tests but no premature activation; no internal ID entry',()=>{
 const r=render(fixture().receipt);assert.doesNotMatch(r.html,/<input|<textarea/);
 const run=r.buttons.find(b=>b.props.children==='Run isolated tests');assert.equal(run.props.disabled,false);run.props.onClick();assert.deepEqual(r.calls,['test']);
 assert(r.buttons.find(b=>b.props.children==='Activate tested version').props.disabled);
 assert(render(fixture().receipt,true).buttons.every(b=>b.props.disabled));
});
test('passing result offers activation and an active version offers rollback',()=>{
 const d={...data,recordedOutcome:'passed',holds:[],test:{operationId:id(8),status:'passed',completedCases:25,caseCount:25,failedCaseId:null}};
 const r=render(fixture(input,d).receipt);assert.equal(r.buttons.find(b=>b.props.children==='Activate tested version').props.disabled,false);
 const active=render(fixture(input,{...d,activeRevision:input.candidateId,currentlyActive:true,activeProxyAvailable:true}).receipt);
 assert.equal(active.buttons.find(b=>b.props.children==='Restore previous version').props.disabled,false);
 assert(active.buttons.find(b=>b.props.children==='Run isolated tests').props.disabled);
});
test('interrupted progress offers recovery and blocks new effects',async()=>{
 const i={...input,action:'execute',operation:'test',lifecycleOperationId:id(8)},d={...data,operationState:'interrupted',test:{operationId:id(8),status:'interrupted',caseCount:25,completedCases:3,failedCaseId:null},holds:['NATIVE_TEST_RECONCILIATION_REQUIRED']};
 const f=fixture(i,d),r=render(f.receipt);assert.match(r.html,/3 of 25/);assert(r.buttons.filter(b=>!String(b.props.children).startsWith('Refresh')).every(b=>b.props.disabled));
 await assert.rejects(lifecycleRequest(f.pending,f.job,'test'));
 const recovered=await lifecycleRequest(f.pending,f.job,'recover',()=>id(9));assert.equal(recovered.body.input.lifecycleOperationId,id(8));assert.equal(recovered.operationId,id(9));
});
test('background start reports pending case progress without implying recovery or permitting replay',async()=>{
 const i={...input,action:'execute',operation:'test',lifecycleOperationId:id(8)};
 const d={...data,operationState:'running',holds:['NATIVE_TEST_OPERATION_NOT_RECORDED']};
 const f=fixture(i,d),r=render(f.receipt);
 assert.match(r.html,/Tests are starting/);assert.match(r.html,/at this observation/);
 assert.doesNotMatch(r.html,/needs recovery|No test run is recorded|Details to resolve/);
 assert(r.buttons.filter(b=>!String(b.props.children).startsWith('Refresh')).every(b=>b.props.disabled));
 r.buttons.find(b=>b.props.children==='Refresh saved progress').props.onClick();assert.deepEqual(r.calls,['recover']);
 await assert.rejects(lifecycleRequest(f.pending,f.job,'test'));
 const recovered=await lifecycleRequest(f.pending,f.job,'recover',()=>id(9));
 assert.equal(recovered.body.input.lifecycleOperationId,id(8));assert.equal(recovered.body.input.action,'recover');
});
test('running case counts remain a dated observation and preserve unrelated holds',()=>{
 const i={...input,action:'recover',operation:'test',lifecycleOperationId:id(8)};
 const d={...data,operationState:'running',test:{operationId:id(8),status:'running',caseCount:37,completedCases:17,failedCaseId:null},holds:[]};
 const r=render(fixture(i,d).receipt);assert.match(r.html,/17 of 37 completed/);assert.match(r.html,/was running at this observation/);assert.doesNotMatch(r.html,/needs recovery/);
 const extra=render(fixture(i,{...d,test:null,holds:['NATIVE_TEST_OPERATION_NOT_RECORDED','NATIVE_ACTIVE_PROXY_UNAVAILABLE']}).receipt);
 assert.match(extra.html,/native active proxy unavailable/);assert.doesNotMatch(extra.html,/native test operation not recorded/);
});
test('missing or interrupted evidence never becomes a running claim',()=>{
 const i={...input,action:'recover',operation:'test',lifecycleOperationId:id(8)};
 for(const status of ['uncertain','interrupted','held']){
  const testRun=status==='uncertain'?null:{operationId:id(8),status,caseCount:37,completedCases:3,failedCaseId:null};
  const r=render(fixture(i,{...data,operationState:status,test:testRun,holds:['NATIVE_TEST_OPERATION_NOT_RECORDED']}).receipt);
  assert.match(r.html,/needs recovery/);assert.match(r.html,/native test operation not recorded/);assert.doesNotMatch(r.html,/Tests are starting|was running/);
  assert(r.buttons.filter(b=>!String(b.props.children).startsWith('Refresh')).every(b=>b.props.disabled));
 }
});
test('reload restores original IDs; new effects get separate delivery and operation IDs',async()=>{
 const f=fixture();assert.equal((await checkedRemoteJob({ok:true,job:f.job},JSON.parse(JSON.stringify(f.pending)))).jobId,input.operationId);
 let n=20;const next=await lifecycleRequest(f.pending,f.job,'test',()=>id(n++));assert.equal(next.body.input.action,'execute');assert.notEqual(next.operationId,next.body.input.lifecycleOperationId);
 assert.equal(next.body.input.expectedActiveRevision,data.activeRevision);
 await assert.rejects(lifecycleRequest({...f.pending,taskId:id(99)},f.job,'test'));
 const forged={...f.job,terminal:{...f.job.terminal,result:{...f.receipt,candidateId:'f'.repeat(64)}}};await assert.rejects(lifecycleRequest(f.pending,forged,'test'));
});
