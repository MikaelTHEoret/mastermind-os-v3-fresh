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
 return {saved,rows,calls,settle,field,loseReply:()=>lost=true,deny:()=>denied=true,html:()=>renderToStaticMarkup(tree),button:t=>all().find(n=>n.type==='button'&&n.props.children===t),form:(index=0)=>all().filter(n=>n.type==='form')[index]};
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

function contributionRows(){
 const ref={taskId:TASK,project:'mastermind'};
 const a={schemaVersion:1,operationId:randomUUID(),kind:'assignment',taskRef:ref,title:'First assignment',request:'Review source',context:'Source',sourceRefs:['source/one'],criteria:['Find defects'],providers:['chatgpt','zai'],disclosure:'selected-material'};
 const b={...a,operationId:randomUUID(),title:'Second assignment'};
 const r={schemaVersion:1,operationId:randomUUID(),kind:'response',taskRef:ref,parentId:digest(a),provider:'zai',model:'GLM',conversationUrl:null,captureMode:'manual',text:'Original source advice'};
 const s={...r,operationId:randomUUID(),provider:'chatgpt',model:null,text:'Independent review'};
 return [a,b,r,s].map(record=>({record,artifactId:digest(record),recordedAt:'2026-09-22T00:00:00Z'}));
}
async function change(f,label,value){f.field(label).props.onChange({target:{value}});await f.settle();}
async function fillResponse(f){
 for(const [label,value] of [['Contributor','zai'],['Model shown by the provider, if known','GLM'],['Conversation link, if available','https://chat.z.ai/c/example'],['Original response','Old draft']])await change(f,label,value);
}
async function fillReview(f,responseId){
 for(const [label,value] of [['Response',responseId],['Outcome','accepted-as-advice'],['Assessment','Old assessment'],['Evidence or test references, one per line','source/old']])await change(f,label,value);
}
function assertBlankResponse(f){
 for(const label of ['Model shown by the provider, if known','Conversation link, if available','Original response'])assert.equal(f.field(label).props.value,'');
 assert.equal(f.button('Save original response').props.disabled,true);
}
function assertBlankReview(f){
 assert.equal(f.field('Outcome').props.value,'needs-revision');
 assert.equal(f.field('Assessment').props.value,'');assert.equal(f.field('Evidence or test references, one per line').props.value,'');
 assert.equal(f.button('Save review').props.disabled,true);
}

test('switching contributor clears the old response identity and text without erasing saved history or review',async()=>{
 const rows=contributionRows(),f=fixture(new Map(),rows);await f.settle();await change(f,'Saved assignment',rows[0].artifactId);
 await fillResponse(f);await fillReview(f,rows[2].artifactId);await change(f,'Contributor','chatgpt');
 assertBlankResponse(f);assert.equal(f.field('Assessment').props.value,'Old assessment');
 assert.match(f.html(),/Original source advice/);assert.equal(rows.length,4);assert.equal(f.calls.filter(c=>c.opt.method==='POST').length,0);
});

test('switching assignment clears response and review drafts; switching response cannot reuse an accepted review',async()=>{
 const rows=contributionRows(),f=fixture(new Map(),rows);await f.settle();await change(f,'Saved assignment',rows[0].artifactId);
 await fillResponse(f);await fillReview(f,rows[2].artifactId);await change(f,'Response',rows[3].artifactId);
 assert.equal(f.field('Response').props.value,rows[3].artifactId);assertBlankReview(f);
 assert.equal(f.field('Original response').props.value,'Old draft');
 await fillReview(f,rows[2].artifactId);await change(f,'Saved assignment',rows[1].artifactId);
 assertBlankResponse(f);assertBlankReview(f);assert.equal(f.field('Response').props.value,'');
 assert.equal(f.calls.filter(c=>c.opt.method==='POST').length,0);
});

test('saving a new assignment selects it with clean drafts after same-ID reconciliation of a lost reply',async()=>{
 const rows=contributionRows(),f=fixture(new Map(),rows);await f.settle();await change(f,'Saved assignment',rows[0].artifactId);
 await fillResponse(f);await fillReview(f,rows[2].artifactId);
 for(const [label,value] of [['Title','New work'],['What should the contributor do?','Review new source'],['Source references, one per line','source/new'],['Acceptance criteria, one per line','Find errors']])await change(f,label,value);
 f.loseReply();f.form().props.onSubmit({preventDefault(){}});await f.settle();
 const retained=f.saved.get(KEY);assert.ok(retained);assert.equal(rows.length,5);
 for(const label of ['Saved assignment','Contributor','Response'])assert.equal(f.field(label).props.disabled,true);
 assert.equal(f.field('Original response').props.value,'Old draft');
 f.button('Reconcile the same submission').props.onClick();await f.settle();
 const posts=f.calls.filter(c=>c.opt.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].opt.body,posts[1].opt.body);
 assert.equal(rows.length,5);assert.equal(f.saved.has(KEY),false);assert.equal(f.field('Saved assignment').props.value,rows[4].artifactId);
 assertBlankResponse(f);assertBlankReview(f);assert.equal(f.field('Response').props.value,'');
});

test('changing response draft context never rewrites an uncertain response submission',async()=>{
 const rows=contributionRows(),f=fixture(new Map(),rows);await f.settle();await change(f,'Saved assignment',rows[0].artifactId);await fillResponse(f);
 f.loseReply();f.form(1).props.onSubmit({preventDefault(){}});await f.settle();const retained=f.saved.get(KEY);
 assert.equal(f.field('Contributor').props.disabled,true);assert.equal(f.field('Saved assignment').props.disabled,true);
 await change(f,'Original response','An unsent edit');assert.equal(f.saved.get(KEY),retained);
 f.button('Reconcile the same submission').props.onClick();await f.settle();
 const posts=f.calls.filter(c=>c.opt.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].opt.body,posts[1].opt.body);
 assert.equal(rows.length,5);assert.equal(rows[4].record.text,'Old draft');assert.equal(rows[4].record.provider,'zai');
});

test('saved remote responses render their original and distinguish authenticated submission from model identity',async()=>{
 const ref={taskId:TASK,project:'mastermind'},submission={transport:'oauth-mcp',subject:'user_fixture',clientId:'fixture-codex'};
 const a={schemaVersion:1,operationId:randomUUID(),kind:'assignment',taskRef:ref,title:'Shared review',request:'Review evidence',context:'Source',sourceRefs:['gpt/fixture'],criteria:['Cite source'],providers:['other'],disclosure:'selected-material',submission};
 const r={schemaVersion:1,operationId:randomUUID(),kind:'response',taskRef:ref,parentId:digest(a),provider:'other',model:'Reported Codex',conversationUrl:null,captureMode:'mcp',text:'Original remote finding',submission};
 const f=fixture(new Map(),[a,r].map(record=>({record,artifactId:digest(record),recordedAt:'2026-09-14T00:00:00Z'})));
 await f.settle();f.field('Saved assignment').props.onChange({target:{value:digest(a)}});await f.settle();
 assert.match(f.html(),/Original remote finding/);assert.match(f.html(),/Submitted through an authenticated connected client/);
 assert.match(f.html(),/Model and machine identity are reported, not independently verified/);assert.doesNotMatch(f.html(),/Manually imported/);
});
