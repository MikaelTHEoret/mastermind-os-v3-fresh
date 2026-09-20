import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import ts from 'typescript';import * as React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';
import * as coding from '../../../protocol/mastermind-node-exchange/native-build-dispatch.mjs';
import {codingRequest,checkedRemoteJob} from './remote-workflow.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('../../../services/mastermind-node-link/test/runtime-build-dispatch-fixture.json',import.meta.url),'utf8'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={...fixture.request,action:'preflight',operationId:id(96),parentOperationId:id(97)};
const ready=coding.buildDispatchReceipt(fixture.results.preflight,input);
const compiled=ts.transpileModule(fs.readFileSync(new URL('../../components/NativeCodingResult.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(value,disabled=false){
 const calls=[],module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,require(name){if(name==='react/jsx-runtime')return jsx;if(name.includes('native-build-dispatch'))return coding;throw Error(name);}});
 const tree=module.exports.default({value,disabled,onAction:action=>calls.push(action)});
 const all=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(all)];
 return {calls,html:renderToStaticMarkup(tree),buttons:all(tree).filter(n=>n.type==='button')};
}
test('only a successful preflight offers start; held and source-complete results remain explicit',()=>{
 const allowed=render(ready);allowed.buttons.find(b=>b.props.children==='Start coding').props.onClick();assert.deepEqual(allowed.calls,['start']);
 assert.match(allowed.html,/authorization again/);assert.doesNotMatch(allowed.html,new RegExp(input.planId));
 assert.ok(render(ready,true).buttons.every(b=>b.props.disabled));
 const held=render({...ready,ok:false,state:'held',holds:['BUILD_DISTINCT_CODING_AUTHORITY_REQUIRED']});
 assert.ok(!held.buttons.some(b=>b.props.children==='Start coding'));assert.match(held.html,/its own authorization/);
 const source=render(coding.buildDispatchReceipt(fixture.results.recover,{...input,action:'recover'}));
 assert.match(source.html,/Independent tests and activation remain separate/);
 assert.deepEqual(source.buttons.map(b=>b.props.children),['Check coding progress','Recover saved coding work']);
});
test('coding transitions and history reject changed identities and false readiness',async()=>{
 const pending={nodeId:id(98),taskId:input.taskRef.taskId,operationId:input.operationId,capability:coding.BUILD_DISPATCH,body:{operationId:input.operationId,input}};
 const at='2026-09-19T00:00:00.000Z';
 const job={jobId:input.operationId,nodeId:pending.nodeId,capability:coding.BUILD_DISPATCH,capabilityVersion:1,policyClass:'routine',state:'succeeded',createdAt:at,expiresAt:'2026-09-19T00:30:00.000Z',lease:null,terminal:{code:'desired-state-reached',finishedAt:at,result:ready}};
 assert.equal((await checkedRemoteJob({ok:true,job},pending)).jobId,input.operationId);
 const start=codingRequest(pending,job,'start',()=>id(99));assert.equal(start.body.input.buildOperationId,input.buildOperationId);assert.notEqual(start.operationId,input.operationId);
 for(const change of [{ok:false},{holds:['AUTHORITY_REQUIRED']},{state:'started'},{observedAction:'status'},{planId:'0'.repeat(64)}]){
  assert.throws(()=>codingRequest(pending,{...job,terminal:{...job.terminal,result:{...ready,...change}}},'start',()=>id(99)));
 }
 for(const key of ['planId','reviewId','specificationId'])await assert.rejects(checkedRemoteJob({ok:true,job:{...job,terminal:{...job.terminal,result:{...ready,[key]:'0'.repeat(64)}}}},pending));
 assert.throws(()=>codingRequest(pending,{...job,nodeId:id(99)},'start'));
 await assert.rejects(checkedRemoteJob({ok:true,job},{...pending,taskId:id(99)}));
});
