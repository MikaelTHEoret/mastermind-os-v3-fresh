import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import ts from 'typescript';
import * as React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';
import crypto from 'node:crypto';import * as workflow from './remote-workflow.mjs';
import * as controls from '../../components/node-control-contract.mjs';
import * as catalog from '../../../protocol/mastermind-node-exchange/native-catalog.mjs';
const TASK='99999999-9999-4999-8999-999999999999',NODE='22222222-2222-4222-8222-222222222222',AT='2026-09-11T04:00:00.000Z';
const page={kind:workflow.CATALOG,ok:true,schemaVersion:1,taskRef:{taskId:TASK,project:'mastermind'},snapshotId:'a'.repeat(64),entry:{specificationId:'b'.repeat(64),candidateId:'c'.repeat(64),requirementsHash:'d'.repeat(64),capability:'release-inventory.diff',title:'Compare releases',version:'1.0.0',effectClass:'READ_ONLY',inputSchema:{type:'object',properties:{before:{type:'array'},after:{type:'array'}}}},nextCursor:null,observedAt:AT,executionAuthorized:false};
const computer={nodeId:NODE,displayName:'My PC',state:'active',connectivity:'online',agentVersion:'0.4.0',pairedAt:AT,lastExchangeAt:AT,lastJobReceiptAt:null,status:null,worker:{protocolVersion:2,capabilities:[{id:workflow.CATALOG,version:1},{id:workflow.REUSE,version:1}]}};
const compiled=ts.transpileModule(fs.readFileSync(new URL('../../components/RemoteNativeWork.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
function fixture(saved=new Map(),history=saved) {
 const slots=[],effects=[],calls=[];let index=0,tree,denied=false;const jobs=new Map();
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={...React,useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useCallback(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,fn};return slots[i].fn;},useEffect(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}}};
 function Inputs(){return jsx.jsx('p',{children:'Generated capability inputs'});}
 async function api(url,options={}) {
   calls.push({url,options});if(denied)throw Error('permission revoked');
   if(url==='/api/nodes')return {ok:true,nodes:[computer]};
   if(url==='/api/native/tasks')return {ok:true,tasks:[{taskId:TASK,project:'mastermind',title:'Finish Mastermind'}]};
   if(url.includes('/native-history/')){const job=Array.from(jobs.values()).at(-1);const pointer=Array.from(history.values()).map(v=>JSON.parse(v)).find(v=>v.operationId===job?.jobId);return {ok:true,saved:job&&pointer?{job,request:pointer}:null};}
   const id=options.body?JSON.parse(options.body).operationId:url.split('/').at(-1);
   if(options.method==='POST'){
     const body=JSON.parse(options.body),isCatalog=url.endsWith('native-catalog');
     const result=isCatalog?page:{kind:workflow.REUSE,operationId:id,specificationId:body.specificationId,taskRef:body.taskRef,candidateId:body.candidateId,capability:body.capability,inputSha256:body.inputSha256,resultSha256:'f'.repeat(64),replayed:false,result:{added:['new artifact']}};
     const job={jobId:id,nodeId:NODE,capability:isCatalog?workflow.CATALOG:workflow.REUSE,capabilityVersion:1,policyClass:'routine',state:'succeeded',createdAt:AT,expiresAt:'2026-09-11T04:30:00.000Z',lease:null,terminal:{code:'desired-state-reached',finishedAt:AT,result}};
     jobs.set(id,job);return {ok:true,status:'created',job};
   }
   if(jobs.has(id))return {ok:true,job:jobs.get(id)};
   throw Error('not found');
 }
 const plain=value=>JSON.parse(JSON.stringify(value));
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,console,AbortController,crypto:crypto.webcrypto,location:{origin:'https://mastermind-core.com'},setTimeout:()=>1,clearTimeout(){},localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},require(name){
   if(name==='react')return hooks;if(name==='react/jsx-runtime')return jsx;if(name==='./NativeCapabilityInputs')return {default:Inputs,__esModule:true};
   if(name==='./node-control-contract.mjs')return controls;if(name.includes('remote-workflow'))return {...workflow,remoteJson:api,checkedJob:(v,p,e)=>workflow.checkedJob(plain(v),plain(p),e)};if(name.includes('native-catalog'))return {...catalog,validateNativeCatalogReceipt:(v,r)=>catalog.validateNativeCatalogReceipt(plain(v),r===undefined?r:plain(r))};throw Error(name);
 }});
 const Component=module.exports.default;
 const render=()=>{index=0;tree=Component();return tree;};
 const settle=async()=>{for(let i=0;i<6;i++){render();while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));}render();};
 function all(node=tree){if(!node||typeof node!=='object')return [];return [node,...React.Children.toArray(node.props?.children).flatMap(all)];}
 return {saved,jobs,calls,settle,render,deny:()=>{denied=true;},html:()=>renderToStaticMarkup(tree),button:text=>all().find(n=>n.type==='button'&&n.props.children===text),inputs:()=>all().find(n=>n.type===Inputs)};
}
test('owner selects capabilities and submits bound inputs without entering IDs; duplicate clicks submit once',async()=>{
 const f=fixture();await f.settle();assert.match(f.html(),/Finish Mastermind/);assert.match(f.html(),/My PC/);
 const discover=f.button('Find capabilities');discover.props.onClick();discover.props.onClick();await f.settle();
 assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(f.inputs().props.contracts[0].name,page.entry.capability);
 f.inputs().props.onRun(page.entry.capability,{before:[],after:[]});await f.settle();
 const posts=f.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,2);
 const input=JSON.parse(posts[1].options.body);assert.equal(input.specificationId,page.entry.specificationId);assert.equal(input.candidateId,page.entry.candidateId);
 assert.match(f.html(),/new artifact/);assert.doesNotMatch(f.html().replace(/<[^>]*>/g,''),new RegExp(TASK));
 const resumed=fixture(f.saved);for(const [id,job] of f.jobs)resumed.jobs.set(id,job);await resumed.settle();
 assert.match(resumed.html(),/new artifact/);assert.equal(resumed.calls.filter(c=>c.options.method==='POST').length,0);
 const other=fixture(new Map(),f.saved);for(const [id,job] of f.jobs)other.jobs.set(id,job);await other.settle();other.button('Resume saved work').props.onClick();await other.settle();assert.match(other.html(),/new artifact/);assert.equal(other.calls.filter(c=>c.options.method==='POST').length,0);
 resumed.deny();resumed.button('Refresh saved status').props.onClick();await resumed.settle();assert.doesNotMatch(resumed.html(),/new artifact/);assert.match(resumed.html(),/saved status is unavailable/);
});
