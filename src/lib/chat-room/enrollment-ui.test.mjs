import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
function load(request){
 const states=[],refs=[];let index=0,refIndex=0;
 const hooks={...React,useState(initial){const at=index++;if(at>=states.length)states[at]=initial;return [states[at],value=>states[at]=value];},useRef(value){const at=refIndex++;return refs[at]??(refs[at]={current:value});}};
 const source=fs.readFileSync(new URL('../../components/ModelConnectionSetup.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,fetch:request,AbortController,setTimeout,clearTimeout,
  require:name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:name.endsWith('.module.css')?{default:{}}:null});
 return {render(){index=0;refIndex=0;return module.exports.default();},states};
}
function flatten(e,out=[]){if(e==null||typeof e!=='object')return out;if(Array.isArray(e)){e.forEach(x=>flatten(x,out));return out;}out.push(e);flatten(e.props?.children,out);return out;}
const inputs=ui=>flatten(ui.render()).filter(e=>e.type==='input');
const button=ui=>flatten(ui.render()).find(e=>e.type==='button');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Gemini requires explicit free-tier confirmation; changing selection clears a prepared policy',async()=>{
 const calls=[];const ui=load(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({status:'prepared',activated:false,providerRequests:0,policy:{allowPaid:false}});});
 inputs(ui)[1].props.onChange({target:{checked:true}});assert.equal(button(ui).props.disabled,true);
 inputs(ui)[2].props.onChange({target:{checked:true}});assert.equal(button(ui).props.disabled,false);
 button(ui).props.onClick();await tick();assert.equal(calls.length,1);assert.equal(calls[0].body.geminiFreeTierConfirmed,true);
 assert.equal(flatten(ui.render()).find(e=>e.type==='textarea').props.readOnly,true);
 inputs(ui)[1].props.onChange({target:{checked:false}});assert.equal(flatten(ui.render()).find(e=>e.type==='textarea'),undefined);
 inputs(ui)[1].props.onChange({target:{checked:true}});assert.equal(button(ui).props.disabled,true);
});
test('duplicate clicks coalesce and a network failure does not retry or expose raw details',async()=>{
 let calls=0,reject;const ui=load(()=>{calls++;return new Promise((_,r)=>reject=r);});
 const action=button(ui).props.onClick;action();action();assert.equal(calls,1);assert.equal(button(ui).props.disabled,true);
 reject(Error('private provider secret'));await tick();assert.equal(calls,1);
 const alert=flatten(ui.render()).find(e=>e.props?.role==='alert');assert.ok(alert);assert.equal(JSON.stringify(alert).includes('private provider secret'),false);
 assert.equal(button(ui).props.disabled,false);
});
