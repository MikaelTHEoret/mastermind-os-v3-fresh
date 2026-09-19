import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {webcrypto} from 'node:crypto';
import * as review from '../../../protocol/mastermind-node-exchange/native-review-contract.mjs';
import {reviewInput,reviewText} from '../../../protocol/mastermind-node-exchange/review-fixture.mjs';
const compiled=ts.transpileModule(fs.readFileSync(new URL('../../components/NativeReviewEditor.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
function fixture(saved=new Map(),options={}){
 const input=reviewInput(),slots=[],effects=[],calls=[];let index=0,tree;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={...React,useCallback(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,fn};return slots[i].fn;},useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(v){const i=index++;return slots[i]??(slots[i]={current:v});},useEffect(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>slots[i].cleanup=fn());}}};
 function ValueField(){return jsx.jsx('span',{children:'Schema-generated example fields'});}
 let digestCalls=0;const crypto={subtle:{async digest(...args){if(++digestCalls===1&&options.restoreWait)await options.restoreWait;return webcrypto.subtle.digest(...args);}}};
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,TextEncoder,crypto,structuredClone,
 localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return jsx;if(name==='./NativeCapabilityInputs')return {ValueField};if(name.includes('native-review-contract'))return {...review,nativeReviewContent:v=>review.nativeReviewContent(JSON.parse(JSON.stringify(v))),encodeNativeReviewInput:v=>review.encodeNativeReviewInput(JSON.parse(JSON.stringify(v))),validateNativeReviewInput:v=>review.validateNativeReviewInput(JSON.parse(JSON.stringify(v)))};throw Error(name);}});
 const props={specificationId:input.specificationId,parentOperationId:input.parentOperationId,taskRef:input.taskRef,request:reviewText,disabled:false,
 onSave:async c=>{calls.push(c);await options.wait;}};
 const render=()=>{index=0;tree=module.exports.default(props);};
 const settle=async()=>{for(let n=0;n<6;n++){render();while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));}render();};
 const all=(n=tree)=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(all)];
 const file=()=>all().find(n=>n.type==='input'&&n.props.type==='file');
 return {calls,saved,props,settle,all,html:()=>renderToStaticMarkup(tree),load:async c=>{file().props.onChange({currentTarget:{files:[{size:JSON.stringify(c).length,text:async()=>JSON.stringify(c)}]}});await settle();},save:()=>all().find(n=>n.type==='button'&&n.props.children==='Save review proposal')};
}
test('review editor preserves source and restores edited ordinary fields without accepting the proposal',async()=>{
 const f=fixture();await f.settle();assert.match(f.html(),/Prepared review file/);await f.load(reviewInput().content);
 assert.match(f.html(),/Coverage of the saved request/);assert.match(f.html(),/Schema-generated example fields/);
 const field=f.all().find(n=>n.type==='textarea');assert.equal(field.props.style.color,'#172b35');assert.equal(field.props.style.background,'#fff');
 field.props.onChange({target:{value:'Add integers deterministically.'}});await f.settle();
 const restored=fixture(f.saved);await restored.settle();assert.match(restored.html(),/Add integers deterministically/);
 restored.save().props.onClick();await restored.settle();assert.equal(restored.calls.length,1);assert.equal(restored.calls[0].requirements.requirements[0],'Add integers deterministically.');
 assert.equal(restored.calls[0].requestSha256,reviewInput().content.requestSha256);assert.equal(restored.calls[0].accepted,undefined);
});
test('review load refuses wrong source, extra authority and malformed examples',async()=>{
 for(const changes of [{requestSha256:'f'.repeat(64)},{source:{path:'foreign'}},{coverage:[{start:0,end:7,text:'changed',requirements:[0],status:'covered'}]}]){
  const f=fixture();await f.settle();await f.load({...reviewInput().content,...changes});assert.equal(f.save(),undefined);assert.match(f.html(),/role="alert"/);assert.equal(f.saved.size,0);
 }
});
test('double click cannot create a second review while save is pending',async()=>{
 let release;const wait=new Promise(r=>release=r);const f=fixture(new Map(),{wait});await f.settle();await f.load(reviewInput().content);
 const button=f.save();button.props.onClick();button.props.onClick();await f.settle();assert.equal(f.calls.length,1);assert.equal(f.save().props.disabled,true);release();await f.settle();
});
test('a late restored draft cannot overwrite a newly loaded review',async()=>{
 const original=fixture();await original.settle();await original.load(reviewInput().content);
 let release;const restoreWait=new Promise(r=>release=r);const next=fixture(original.saved,{restoreWait});await next.settle();
 const changed=reviewInput().content;changed.requirements.requirements[0]='Newly loaded requirement.';await next.load(changed);
 release();await next.settle();assert.match(next.html(),/Newly loaded requirement/);
});
test('an unfinished requirement survives draft reload but cannot be submitted',async()=>{
 const f=fixture();await f.settle();await f.load(reviewInput().content);f.all().find(n=>n.type==='textarea').props.onChange({target:{value:''}});await f.settle();
 const next=fixture(f.saved);await next.settle();assert.equal(next.all().find(n=>n.type==='textarea').props.value,'');
 next.save().props.onClick();await next.settle();assert.equal(next.calls.length,0);assert.match(next.html(),/role="alert"/);
});

test('a revision opens from saved content without upload and has its own recoverable draft',async()=>{
 const initial=reviewInput().content,original=structuredClone(initial);const f=fixture();
 f.props.initialContent=initial;f.props.draftId='saved-review-operation';await f.settle();
 assert.ok(f.save());f.all().find(n=>n.type==='textarea').props.onChange({target:{value:'Corrected text.'}});await f.settle();
 assert.deepEqual(initial,original);
 const resumed=fixture(f.saved);resumed.props.initialContent=initial;resumed.props.draftId='saved-review-operation';await resumed.settle();
 assert.match(resumed.html(),/Corrected text/);
 const other=fixture(f.saved);other.props.initialContent=initial;other.props.draftId='different-review-operation';await other.settle();
 assert.doesNotMatch(other.html(),/Corrected text/);
});

test('lossless editor loads, saves and restores the full 18-case inventory review unchanged',async()=>{
 const c=reviewInput().content;
 c.requirements={...JSON.parse(fs.readFileSync(new URL('../../../protocol/mastermind-node-exchange/review-inventory-fixture.json',import.meta.url),'utf8')),taskRef:c.requirements.taskRef};
 const f=fixture();f.props.wireVersion=2;await f.settle();await f.load(c);
 assert.ok(f.save());f.save().props.onClick();await f.settle();assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[c]);
 const restored=fixture(f.saved);restored.props.wireVersion=2;await restored.settle();assert.ok(restored.save());
 restored.save().props.onClick();await restored.settle();assert.deepEqual(JSON.parse(JSON.stringify(restored.calls)),[c]);
 const legacy=fixture();await legacy.settle();await legacy.load(c);assert.equal(legacy.save(),undefined);
 assert.match(legacy.html(),/Keep all test cases/);
});
