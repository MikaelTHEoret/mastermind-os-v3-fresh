import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import * as React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';
import {randomUUID} from 'node:crypto';import {NexusOwnerSession} from './nexus-owner-workflow.mjs';import {proposalHeads} from './nexus-proposal.mjs';import {digest} from './store.mjs';
const ref={taskId:randomUUID(),project:'mastermind'};
const review={schemaVersion:1,kind:'review',operationId:randomUUID(),taskRef:ref,parentId:'a'.repeat(64),decision:'accepted-as-advice',assessment:'Reviewed comparison behavior',evidenceRefs:['fixture/source']};
const row=r=>({record:r,artifactId:digest(r),recordedAt:'2026-10-01T00:00:00Z'});
const material={ok:true,viewState:'available',executionAuthorized:false,taskRef:ref,basis:{checkpointId:randomUUID(),revision:'294',permissionRevision:'2',permissionScopeSha256:'a'.repeat(64)},plans:[{specificationId:'b'.repeat(64),planId:'c'.repeat(64),title:'Compare release manifests',sourceRefs:['mastermind/build-plan/'+'c'.repeat(64),'mastermind/source-evidence/'+'d'.repeat(64)]}]};
const compiled=ts.transpileModule(fs.readFileSync(new URL('../../components/NexusProposalOwner.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const plain=v=>JSON.parse(JSON.stringify(v));
function fixture(saved=new Map(),rows=[row(review)],connected=true){
 const slots=[],effects=[],calls=[],pending=new Set();let index=0,tree,lost=false;
 function tracked(p){const result=p.finally(()=>pending.delete(result));pending.add(result);return result;}
 const storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 class Session extends NexusOwnerSession{constructor(opts){super({...opts,ref:plain(opts.ref)});}prepare(v){return super.prepare(plain(v));}async load(){return tracked(super.load());}async save(){return tracked(super.save());}async recover(){return tracked(super.recover());}}
 const hooks={...React,useState(init){const i=index++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(init){const i=index++;return slots[i]??(slots[i]={current:init});},useEffect(fn){const i=index++;if(!slots[i]){slots[i]=true;effects.push(fn);}}};
 const transport={async load(){calls.push('load');return {material,artifacts:rows};},async save(record){calls.push('save');const artifact=row(record);rows.push(artifact);if(lost)throw Error('Reply lost');return {status:'created',artifact,executionAuthorized:false};},async recover(_,id){calls.push('recover');return rows.find(r=>r.record.operationId===id)??null;}};
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,console,Error,window:{localStorage:storage},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return jsx;if(name.includes('nexus-owner-workflow'))return {NexusOwnerSession:Session};if(name.includes('nexus-proposal'))return {proposalHeads};throw Error(name);}});
 const props={ownerKey:'fixture-owner',task:{...ref,title:'Develop Mastermind'},transport:connected?transport:undefined};
 const render=()=>{index=0;const root=module.exports.default(props);tree=typeof root.type==='function'?root.type(root.props):root;};
 const all=(n=tree)=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(all)];
 async function settle(){for(let i=0;i<8;i++){render();while(effects.length)effects.shift()();await Promise.allSettled([...pending]);await new Promise(r=>setImmediate(r));}render();}
 return {saved,rows,calls,settle,all,lose:()=>lost=true,html:()=>renderToStaticMarkup(tree),button:text=>all().find(n=>n.type==='button'&&n.props.children===text)};
}
test('owner chooses readable plans/advice, prepares without send and recovers a lost save after reload',async()=>{
 const f=fixture();await f.settle();assert.deepEqual(f.calls,[]);f.button('Load saved plans and history').props.onClick();await f.settle();
 assert.match(f.html(),/Compare release manifests/);assert.match(f.html(),/Reviewed comparison behavior/);
 const title=f.all().find(n=>n.type==='input'&&n.props.required);title.props.onChange({target:{value:'Prepare release comparison'}});await f.settle();
 for(let i=0;i<2;i++){f.all().filter(n=>n.type==='input'&&n.props.type==='checkbox')[i].props.onChange();await f.settle();}
 assert.equal(f.button('Prepare proposal for saving').props.disabled,false);
 f.all().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await f.settle();assert.deepEqual(f.calls,['load']);assert.equal(f.saved.size,1);
 f.lose();f.button('Save the retained proposal').props.onClick();await f.settle();assert.match(f.html(),/Reply lost/);
 const reload=fixture(f.saved,f.rows);await reload.settle();assert.deepEqual(reload.calls,[]);assert.match(reload.html(),/Unfinished proposal/);
 reload.button('Check existing save').props.onClick();await reload.settle();assert.deepEqual(reload.calls,['recover']);assert.equal(reload.saved.size,0);assert.match(reload.html(),/saved and verified/);
});
test('uninstalled transport exposes no submission controls',async()=>{
 const f=fixture(new Map(),[],false);await f.settle();assert.match(f.html(),/No proposal can be submitted yet/);assert.equal(f.all().filter(n=>n.type==='button').length,0);assert.deepEqual(f.calls,[]);
});
