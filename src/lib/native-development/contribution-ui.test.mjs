import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import ts from 'typescript';import * as React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';
import * as contribution from '../../../protocol/mastermind-node-exchange/native-contribution.mjs';
import {contributionRequest,checkedRemoteJob} from './remote-workflow.mjs';
const examples=JSON.parse(fs.readFileSync(new URL('../../../services/mastermind-node-link/test/contribution-receipts.json',import.meta.url),'utf8'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const compiled=ts.transpileModule(fs.readFileSync(new URL('../../components/NativeContributionResult.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(value,disabled=false){
 const calls=[],module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,require(name){if(name==='react/jsx-runtime')return jsx;if(name.includes('native-contribution'))return contribution;throw Error(name);}});
 const tree=module.exports.default({value,disabled,onAction:a=>calls.push(a)});
 const all=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(all)];
 return {calls,html:renderToStaticMarkup(tree),buttons:all(tree).filter(n=>n.type==='button')};
}
function fixture(action){
 const {input,receipt}=examples.find(v=>v.input.action===action),at='2026-09-23T00:00:00.000Z';
 const pending={nodeId:id(998),taskId:input.taskRef.taskId,operationId:input.operationId,capability:contribution.CONTRIBUTION,body:{operationId:input.operationId,input}};
 const job={jobId:input.operationId,nodeId:pending.nodeId,capability:pending.capability,capabilityVersion:1,policyClass:'routine',state:'succeeded',createdAt:at,expiresAt:'2026-09-23T00:30:00.000Z',lease:null,terminal:{code:'desired-state-reached',finishedAt:at,result:receipt}};
 return {pending,job,receipt};
}
test('contribution view separates selection, preview, staging and later tests',()=>{
 const catalog=render(fixture('catalog').receipt);assert.match(catalog.html,/does not verify the source/);catalog.buttons[0].props.onClick();assert.deepEqual(catalog.calls,['prepare']);
 const preview=render(fixture('prepare').receipt);assert.ok(preview.buttons.some(b=>b.props.children==='Stage reviewed candidate'));
 const staged=render(fixture('stage').receipt);assert.match(staged.html,/Behavioral tests and activation remain separate/);assert.deepEqual(staged.buttons.map(b=>b.props.children),['Recover saved import','Back to contributions']);
 assert.ok(render(fixture('prepare').receipt,true).buttons.every(b=>b.props.disabled));
 assert.doesNotMatch(preview.html,/<textarea|<input|Activate|Run tests/);
});
test('contribution transitions retain host-bound import and reject forged source, skipped preview and mismatched task',async()=>{
 const catalog=fixture('catalog'),preview=await contributionRequest(catalog.pending,catalog.job,'prepare',()=>id(9011));
 assert.equal(preview.body.input.importOperationId,catalog.receipt.data.choice.importOperationId);
 await assert.rejects(contributionRequest(catalog.pending,catalog.job,'stage'));
 const prepared=fixture('prepare'),stage=await contributionRequest(prepared.pending,prepared.job,'stage',()=>id(9012));
 assert.equal(stage.body.input.importOperationId,prepared.pending.body.input.importOperationId);
 const partial=fixture('recover');partial.job.terminal.result={...partial.receipt,data:{...partial.receipt.data,phase:'prepared'}};
 const resume=await contributionRequest(partial.pending,partial.job,'stage',()=>id(9015));assert.equal(resume.body.input.importOperationId,partial.pending.body.input.importOperationId);
 assert.ok(render(partial.job.terminal.result).buttons.some(b=>b.props.children==='Finish staging reviewed candidate'));
 const restart=await contributionRequest(prepared.pending,prepared.job,'catalog-start',()=>id(9016));assert.equal(restart.body.input.action,'catalog');assert.equal(restart.body.input.importOperationId,null);assert.equal(restart.body.input.snapshotId,null);
 for(const action of ['stage','recover']){
  const f=fixture(action);assert.equal((await checkedRemoteJob({ok:true,job:f.job},f.pending)).jobId,f.job.jobId);
  await assert.rejects(contributionRequest(f.pending,f.job,'stage'));
  await assert.rejects(checkedRemoteJob({ok:true,job:{...f.job,terminal:{...f.job.terminal,result:{...f.receipt,executionAuthorized:true}}}},f.pending));
  await assert.rejects(contributionRequest({...f.pending,taskId:id(9013)},f.job,'recover'));
  for(const state of ['queued','running','leased'])await assert.rejects(contributionRequest(f.pending,{...f.job,state,terminal:null},'recover'));
  const lost={...f.job,state:'failed',terminal:{...f.job.terminal,result:null,code:'execution-timeout'}};
  const recovery=await contributionRequest(f.pending,lost,'recover',()=>id(9014));assert.equal(recovery.body.input.importOperationId,f.pending.body.input.importOperationId);
 }
});
