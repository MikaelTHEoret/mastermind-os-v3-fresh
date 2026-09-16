import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';
import ts from 'typescript';import * as React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';
import {reuseInput,reuseReceipt} from '../../../protocol/mastermind-node-exchange/review-reuse-fixture.mjs';
const compiled=ts.transpileModule(fs.readFileSync(new URL('../../components/NativeReviewReuseResult.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(value,disabled=false){
 let state=[],tree,accepted=0;const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,require(name){if(name==='react/jsx-runtime')return jsx;if(name==='react')return {useState(){return [state,v=>{state=typeof v==='function'?v(state):v;}];}};throw Error(name);}});
 const update=()=>tree=module.exports.default({value,disabled,onAccept:()=>{accepted++;}});
 const all=(n=tree)=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(all)];update();
 return {update,all,accepted:()=>accepted,html:()=>renderToStaticMarkup(tree)};
}
test('reuse decision requires every visible difference confirmation and exposes no internal IDs',()=>{
 const value=reuseReceipt(reuseInput()),f=render(value);
 assert.match(f.html(),/8 of 8/);assert.match(f.html(),/14-case/);assert.doesNotMatch(f.html(),new RegExp(value.qualificationId));
 let button=()=>f.all().find(n=>n.type==='button');assert.equal(button().props.disabled,true);
 for(let i=0;i<4;i++){f.all().filter(n=>n.type==='input')[i].props.onChange({target:{checked:true}});f.update();assert.equal(button().props.disabled,i!==3);}
 assert.equal(button().props.children,'Recover verified reuse decision');button().props.onClick();assert.equal(f.accepted(),1);
 f.all().filter(n=>n.type==='input')[0].props.onChange({target:{checked:false}});f.update();assert.equal(button().props.disabled,true);
 for(const changed of [{holds:['REVIEW_REUSE_EXAMPLE_EVIDENCE_REQUIRED'],coveredCount:7},{differences:['requirements']}]){
  const held=render({...value,...changed}),b=held.all().find(n=>n.type==='button');assert.ok(!b||b.props.disabled);
 }
 const busy=render({...value,differences:[]},true);assert.equal(busy.all().find(n=>n.type==='button').props.disabled,true);
 const linked=render(reuseReceipt(reuseInput(undefined,'accept')));assert.match(linked.html(),/No code was run or activated/);assert.equal(linked.all().filter(n=>n.type==='input').length,0);
});
