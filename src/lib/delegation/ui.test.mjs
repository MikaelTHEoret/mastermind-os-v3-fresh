import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import * as React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';import {webcrypto,randomUUID} from 'node:crypto';
import * as contract from './contract.mjs';import * as workflow from './browser-workflow.mjs';import {digest} from './store.mjs';
const TASK='4196249c-dcbd-41cc-9e6f-8b87b7b2cdda',KEY='mastermind-contribution-pending-v1';
const compiled=ts.transpileModule(fs.readFileSync(new URL('../../components/ExternalContributions.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const plain=v=>JSON.parse(JSON.stringify(v));
function fixture(saved=new Map(),rows=[]){
 const slots=[],effects=[],calls=[];let index=0,tree,lost=false,denied=false;
 const hooks={...React,useState(init){const i=index++;if(!(i in slots))slots[i]=init;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(init){const i=index++;return slots[i]??(slots[i]={current:init});},useEffect(fn){const i=index++;if(!slots[i]){slots[i]=true;effects.push(fn);}}};
 async function api(url,opt={}){
  calls.push({url,opt});if(denied)throw Error('Access revoked');
  if(url==='/api/native/tasks')return {ok:true,tasks:[{taskId:TASK,project:'mastermind',title:'Finish Mastermind'}]};
  if(opt.method==='POST'){
   const record=JSON.parse(opt.body);let row=rows.find(x=>x.record.operationId===record.operationId),status=row?'duplicate':'created';
   if(!row){row={artifactId:digest(record),record,recordedAt:'2026-09-11T00:00:00Z'};rows.push(row);}
   if(lost){lost=false;throw Error('Reply lost');}
   return {ok:true,status,artifact:row,executionAuthorized:false};
  }
  return {ok:true,artifacts:rows,executionAuthorized:false};
 }
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,console,Error,crypto:webcrypto,localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},require(name){
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return jsx;
  if(name.includes('contract.mjs'))return {...contract,validateRecord:v=>contract.validateRecord(plain(v)),assignmentPrompt:(v,p)=>contract.assignmentPrompt(plain(v),p)};
  if(name.includes('browser-workflow'))return {...workflow,contributionJson:api,checkedArtifact:(v,r)=>workflow.checkedArtifact(plain(v),plain(r)),checkedAcknowledgement:(v,r)=>workflow.checkedAcknowledgement(plain(v),plain(r))};
  throw Error(name);
 }});
 const render=()=>{index=0;tree=module.exports.default();};
 async function settle(){for(let i=0;i<8;i++){render();while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));}render();}
 function all(n=tree){if(!n||typeof n!=='object')return [];return [n,...React.Children.toArray(n.props?.children).flatMap(all)];}
 const field=label=>all().find(n=>n.type==='label'&&React.Children.toArray(n.props.children)[0]===label)?.props.children[1];
 return {saved,rows,calls,settle,field,loseReply:()=>lost=true,deny:()=>denied=true,html:()=>renderToStaticMarkup(tree),button:t=>all().find(n=>n.type==='button'&&n.props.children===t),form:()=>all().find(n=>n.type==='form')};
}
test('owner saves a task assignment, lost reply survives reload, explicit reconciliation uses the same operation',async()=>{
 const f=fixture();await f.settle();assert.match(f.html(),/Finish Mastermind/);
 for(const [label,value] of [['Title','Find parser defects'],['What should the contributor do?','Review this public parser.'],['Selected source material','Public source'],['Source references, one per line','public/revision'],['Acceptance criteria, one per line','Give a failing input']]){f.field(label).props.onChange({target:{value}});await f.settle();}
 f.loseReply();f.form().props.onSubmit({preventDefault(){}});await f.settle();assert.equal(f.rows.length,1);assert.ok(f.saved.has(KEY));
 assert.match(f.html(),/Reply lost/);
 const resumed=fixture(f.saved,f.rows);await resumed.settle();assert.equal(resumed.calls.filter(x=>x.opt.method==='POST').length,0);
 resumed.button('Reconcile the same submission').props.onClick();await resumed.settle();assert.equal(resumed.rows.length,1);assert.equal(resumed.saved.has(KEY),false);assert.match(resumed.html(),/Saved to the shared task/);
 const fresh=fixture(new Map(),f.rows);await fresh.settle();fresh.field('Saved assignment').props.onChange({target:{value:f.rows[0].artifactId}});await fresh.settle();assert.match(fresh.html(),/Public source/);
 fresh.deny();fresh.button('Refresh saved history').props.onClick();await fresh.settle();assert.doesNotMatch(fresh.html(),/Public source/);assert.match(fresh.html(),/Access revoked/);
});
