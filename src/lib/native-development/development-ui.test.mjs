import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import ts from 'typescript';import * as React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';
import * as development from '../../../protocol/mastermind-node-exchange/native-development-work.mjs';
import {developmentFixtureReceipt} from '../../../protocol/mastermind-node-exchange/development-fixture.mjs';
const compiled=ts.transpileModule(fs.readFileSync(new URL('../../components/NativeDevelopmentResult.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(kind,action,change={},disabled=false,buildSupported=true){
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const input={schemaVersion:1,action,operationId:id(1),parentOperationId:id(2),artifactOperationId:id(3),specificationId:'a'.repeat(64),reviewId:'b'.repeat(64),taskRef:{taskId:id(4),project:'mastermind'},...(kind===development.REVIEW_BUILD_PLAN?{buildOperationId:id(5)}:{})};
 const value={...developmentFixtureReceipt(kind,input),...change},calls=[],module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,require(name){if(name==='react/jsx-runtime')return jsx;if(name.includes('native-development-work'))return development;throw Error(name);}});
 const tree=module.exports.default({value,disabled,buildSupported,onAction:(...args)=>calls.push(args)});
 const all=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(all)];
 return {value,calls,html:renderToStaticMarkup(tree),buttons:all(tree).filter(n=>n.type==='button')};
}
test('source and build results expose only valid actions and distinguish saved status from verification',()=>{
 const art=development.REVIEW_ARTIFACTS,build=development.REVIEW_BUILD_PLAN;
 const proposal=render(art,'prepare');assert.match(proposal.html,/Candidate tests have not run/);assert.doesNotMatch(proposal.html,new RegExp(proposal.value.reviewId));
 assert.deepEqual(proposal.buttons.map(b=>b.props.children),['Publish source package','Check publication']);
 const uncertain=render(art,'recover',{artifactState:'prepared'});assert.equal(uncertain.buttons.length,1);
 const absent=render(art,'reconcile',{artifactState:'prepared',gitVerified:false,gitVerifiedAt:null,historicalSnapshot:true,holds:['MATERIALIZER_REF_NOT_PUBLISHED']});
 absent.buttons.find(b=>b.props.children==='Resume publication').props.onClick();assert.deepEqual(absent.calls,[[art,'resume']]);
 const published=render(art,'publish',{},false,false);assert.match(published.html,/Publication verified/);assert.equal(published.buttons.find(b=>b.props.children==='Prepare build plan').props.disabled,true);
 const plan=render(build,'prepare',{},true);assert.match(plan.html,/Coding has not started/);assert.ok(plan.buttons.every(b=>b.props.disabled));
});
