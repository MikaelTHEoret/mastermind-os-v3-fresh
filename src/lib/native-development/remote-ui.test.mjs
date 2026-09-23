import * as contribution from '../../../protocol/mastermind-node-exchange/native-contribution.mjs';
import {developmentFixtureReceipt} from '../../../protocol/mastermind-node-exchange/development-fixture.mjs';
import * as coding from '../../../protocol/mastermind-node-exchange/native-build-dispatch.mjs';
import * as development from '../../../protocol/mastermind-node-exchange/native-development-work.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import ts from 'typescript';
import * as React from 'react';import * as jsx from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';
import crypto from 'node:crypto';import * as workflow from './remote-workflow.mjs';
import * as controls from '../../components/node-control-contract.mjs';
import * as reviewReuse from '../../../protocol/mastermind-node-exchange/native-review-reuse.mjs';
import {reuseReceipt,reuseOperation} from '../../../protocol/mastermind-node-exchange/review-reuse-fixture.mjs';
import * as review from '../../../protocol/mastermind-node-exchange/native-review-contract.mjs';
import * as catalog from '../../../protocol/mastermind-node-exchange/native-catalog.mjs';
import {specificationRequestHash} from '../../../protocol/mastermind-node-exchange/native-specification.mjs';
import {reviewInput} from '../../../protocol/mastermind-node-exchange/review-fixture.mjs';
const TASK='99999999-9999-4999-8999-999999999999',NODE='22222222-2222-4222-8222-222222222222',AT='2026-09-11T04:00:00.000Z';
const contributionExamples=JSON.parse(fs.readFileSync(new URL('../../../services/mastermind-node-link/test/contribution-receipts.json',import.meta.url),'utf8'));
function contributionFixture(input){
 const original=contributionExamples.find(c=>c.input.action===input.action).receipt;
 return contribution.validateContributionReceipt({...original,...input},input);
}
const page={kind:workflow.CATALOG,ok:true,schemaVersion:1,taskRef:{taskId:TASK,project:'mastermind'},snapshotId:'a'.repeat(64),entry:{specificationId:'b'.repeat(64),candidateId:'c'.repeat(64),requirementsHash:'d'.repeat(64),capability:'release-inventory.diff',title:'Compare releases',version:'1.0.0',effectClass:'READ_ONLY',inputSchema:{type:'object',properties:{before:{type:'array'},after:{type:'array'}}}},nextCursor:null,observedAt:AT,executionAuthorized:false};
const computer={nodeId:NODE,displayName:'My PC',state:'active',connectivity:'online',agentVersion:'0.4.0',pairedAt:AT,lastExchangeAt:AT,lastJobReceiptAt:null,status:null,worker:{protocolVersion:2,capabilities:[{id:workflow.CATALOG,version:1},{id:workflow.REUSE,version:1}]}};
const compiled=ts.transpileModule(fs.readFileSync(new URL('../../components/RemoteNativeWork.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
export function fixture(saved=new Map(),history=saved,options_={}) {
 const initialHistory=Array.from(history.values());const slots=[],effects=[],calls=[];let index=0,tree,denied=false,lost=false;const jobs=new Map();
 const selectedComputer=options_.computer??computer;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={...React,useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useCallback(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,fn};return slots[i].fn;},useEffect(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}}};
 function Inputs(){return jsx.jsx('p',{children:'Generated capability inputs'});}
 function ReviewEditor(){return null;}
 function ReuseResult(){return null;}
 function DevelopmentResult(){return null;}
 function CodingResult(){return null;}
 function ContributionResult(){return null;}
 async function api(url,options={}) {
   calls.push({url,options});if(denied)throw Error('permission revoked');
   if(url==='/api/nodes')return {ok:true,nodes:[selectedComputer]};
   if(url==='/api/native/tasks')return {ok:true,tasks:[{taskId:TASK,project:'mastermind',title:'Finish Mastermind'}]};
   if(url.includes('/native-history/')){const job=Array.from(jobs.values()).filter(j=>!url.endsWith('/review')||j.capability===review.NATIVE_REVIEW_CAPABILITY).at(-1);const pointer=[...history.values(),...initialHistory].map(v=>JSON.parse(v)).find(v=>v.operationId===job?.jobId);return {ok:true,saved:job&&pointer?{job,request:pointer}:null};}
   const id=options.body?JSON.parse(options.body).operationId:url.split('/').at(-1);
   if(options.method==='POST'){
     const body=JSON.parse(options.body),isCatalog=url.endsWith('native-catalog'),isWizard=url.endsWith('native-specification'),isReview=url.endsWith('native-review'),isLink=url.endsWith('review-reuse'),isContribution=url.endsWith('native-contribution'),isCoding=url.endsWith('review-build-dispatch'),developmentKind=url.endsWith('review-artifacts')?development.REVIEW_ARTIFACTS:url.endsWith('review-build-plan')?development.REVIEW_BUILD_PLAN:null;
     const result=isContribution?contributionFixture(body.input):isCoding?codingFixture(body.input):developmentKind?developmentFixtureReceipt(developmentKind,body.input):isLink?reuseReceipt(body.input):isReview?reviewResult(body.input):isCatalog?page:isWizard?{kind:workflow.SPECIFICATION,ok:true,schemaVersion:1,taskRef:body.input.taskRef,operationId:id,requestHash:specificationRequestHash(body.input),savedAt:AT,replayed:false,executionAuthorized:false,
       specification:{specificationId:'e'.repeat(64),title:'Saved development request',decision:'inspect_existing',stage:'needs_specification',requirementsHash:null,missingCount:2,...(options_.detailed?{missing:['Confirm inputs and expected outputs.','Review matching capabilities.']}: {})}}:
       {kind:workflow.REUSE,operationId:id,specificationId:body.specificationId,taskRef:body.taskRef,candidateId:body.candidateId,capability:body.capability,inputSha256:body.inputSha256,resultSha256:'f'.repeat(64),replayed:false,result:{added:['new artifact']}};
     const job={jobId:id,nodeId:NODE,capability:isContribution?contribution.CONTRIBUTION:isCoding?coding.BUILD_DISPATCH:developmentKind??(isLink?reviewReuse.REVIEW_REUSE:isReview?review.NATIVE_REVIEW_CAPABILITY:isCatalog?workflow.CATALOG:isWizard?workflow.SPECIFICATION:workflow.REUSE),capabilityVersion:isReview?body.input.schemaVersion:1,policyClass:'routine',state:options_.queued?'queued':'succeeded',createdAt:AT,expiresAt:'2026-09-11T04:30:00.000Z',lease:null,terminal:options_.queued?null:{code:'desired-state-reached',finishedAt:AT,result}};
     const existing=jobs.get(id);if(!existing)jobs.set(id,job);if(lost){lost=false;throw Error('reply lost');}return {ok:true,status:existing?'duplicate':'created',job:existing??job};
   }
   if(jobs.has(id))return {ok:true,job:jobs.get(id)};
   throw Error('not found');
 }
 const plain=value=>JSON.parse(JSON.stringify(value));
 // Job validation includes real WebCrypto work; event-loop turns alone do not wait for it.
 const validations=new Set();
 function verifyJob(v,p,e){
   const work=(async()=>{if(options_.validationGate)await options_.validationGate;return workflow.checkedRemoteJob(plain(v),plain(p),e);})();
   validations.add(work);work.then(()=>validations.delete(work),()=>validations.delete(work));return work;
 }
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,console,AbortController,crypto:crypto.webcrypto,location:{origin:'https://mastermind-core.com'},setTimeout:()=>1,clearTimeout(){},localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>{if(options_.storageDenied)throw Error('storage denied');saved.set(k,v);},removeItem:k=>saved.delete(k)},require(name){
   if(name==='./NativeContributionResult')return {default:ContributionResult,__esModule:true};if(name.includes('native-contribution'))return contribution;
   if(name==='./NativeCodingResult')return {default:CodingResult,__esModule:true};if(name.includes('native-build-dispatch'))return coding;
   if(name==='./NativeDevelopmentResult')return {default:DevelopmentResult,__esModule:true};if(name.includes('native-development-work'))return development;
   if(name==='./NativeReviewReuseResult')return {default:ReuseResult,__esModule:true};if(name.includes('native-review-reuse'))return {...reviewReuse,validateReviewReuseInput:v=>reviewReuse.validateReviewReuseInput(plain(v))};
   if(name==='./NativeReviewEditor')return {default:ReviewEditor,__esModule:true};if(name.includes('native-review-contract'))return {...review,nativeReviewContent:v=>review.nativeReviewContent(JSON.parse(JSON.stringify(v))),encodeNativeReviewRecovery:(v,id)=>review.encodeNativeReviewRecovery(plain(v),id),encodeNativeReviewInput:v=>review.encodeNativeReviewInput(JSON.parse(JSON.stringify(v))),validateNativeReviewInput:v=>review.validateNativeReviewInput(plain(v))};
   if(name==='react')return hooks;if(name==='react/jsx-runtime')return jsx;if(name==='./NativeCapabilityInputs')return {default:Inputs,__esModule:true};
   if(name==='./node-control-contract.mjs')return controls;if(name.includes('remote-workflow'))return {...workflow,remoteJson:api,contributionRequest:(p,j,a)=>workflow.contributionRequest(plain(p),plain(j),a),codingRequest:(p,j,a)=>workflow.codingRequest(plain(p),plain(j),a),developmentRequest:(p,j,k,a)=>workflow.developmentRequest(plain(p),plain(j),k,a),specificationRequest:(t,r,o,parent)=>workflow.specificationRequest(plain(t),r,o,parent?plain(parent):undefined),checkedRemoteJob:verifyJob};if(name.includes('native-catalog'))return {...catalog,validateNativeCatalogReceipt:(v,r)=>catalog.validateNativeCatalogReceipt(plain(v),r===undefined?r:plain(r))};throw Error(name);
 }});
 const Component=module.exports.default;
 const render=()=>{index=0;tree=Component();return tree;};
 const settle=async()=>{for(let i=0;i<6;i++){render();while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));await Promise.allSettled([...validations]);}render();};
 function all(node=tree){if(!node||typeof node!=='object')return [];return [node,...React.Children.toArray(node.props?.children).flatMap(all)];}
 return {saved,jobs,calls,settle,render,deny:()=>{denied=true;},loseReply:()=>{lost=true;},html:()=>renderToStaticMarkup(tree),button:text=>all().find(n=>n.type==='button'&&n.props.children===text),inputs:()=>all().find(n=>n.type===Inputs),reviewEditor:()=>all().find(n=>n.type===ReviewEditor),codingResult:()=>all().find(n=>n.type===CodingResult),contributionResult:()=>all().find(n=>n.type===ContributionResult),developmentResult:()=>all().find(n=>n.type===DevelopmentResult),reuseResult:()=>all().find(n=>n.type===ReuseResult),textarea:()=>all().find(n=>n.type==='textarea'),form:()=>all().find(n=>n.type==='form')};
}

function reviewResult(input){return {kind:review.NATIVE_REVIEW_CAPABILITY,ok:true,schemaVersion:1,taskRef:input.taskRef,operationId:input.operationId,specificationId:input.specificationId,contentSha256:crypto.createHash('sha256').update(review.reviewCanonical(review.nativeReviewContent(input))).digest('hex'),reviewId:'f'.repeat(64),state:'held',holds:['ACCEPTED_REUSE_EVIDENCE_REQUIRED'],replayed:input.schemaVersion===3,accepted:false,executionAuthorized:false};}

test('reviewed contribution selection, preview and stage survive lost reply, reload and shared history without restaging',async()=>{
 const options={computer:{...computer,worker:{protocolVersion:2,capabilities:[...computer.worker.capabilities,{id:workflow.SPECIFICATION,version:1},{id:contribution.CONTRIBUTION,version:1}]}}};
 const f=fixture(new Map(),undefined,options);await f.settle();
 f.textarea().props.onChange({target:{value:'Import the reviewed browser contribution'}});await f.settle();f.form().props.onSubmit({preventDefault(){}});await f.settle();
 const find=f.button('Find reviewed contributions').props.onClick;find();find();await f.settle();
 assert.equal(f.contributionResult().props.value.action,'catalog');
 f.contributionResult().props.onAction('prepare');await f.settle();assert.equal(f.contributionResult().props.value.data.phase,'preview');
 const stage=f.contributionResult().props.onAction;f.loseReply();stage('stage');stage('stage');await f.settle();
 assert.match(f.html(),/could not be confirmed/);
 const posts=f.calls.filter(c=>c.url.endsWith('/native-contribution')&&c.options.method==='POST');assert.equal(posts.length,3);
 const preview=JSON.parse(posts[1].options.body).input,staged=JSON.parse(posts[2].options.body).input;
 assert.equal(staged.importOperationId,preview.importOperationId);assert.notEqual(staged.operationId,preview.operationId);
 const resumed=fixture(f.saved,f.saved,options);for(const [id,j] of f.jobs)resumed.jobs.set(id,j);await resumed.settle();
 assert.equal(resumed.calls.filter(c=>c.options.method==='POST').length,0);assert.equal(resumed.contributionResult().props.value.data.phase,'staged');
 resumed.contributionResult().props.onAction('recover');await resumed.settle();
 assert.equal(resumed.contributionResult().props.value.importOperationId,staged.importOperationId);
 const fresh=fixture(new Map(),resumed.saved,options);for(const [id,j] of resumed.jobs)fresh.jobs.set(id,j);await fresh.settle();
 fresh.button('Resume saved work').props.onClick();await fresh.settle();assert.equal(fresh.contributionResult().props.value.importOperationId,staged.importOperationId);
 assert.equal(fresh.calls.filter(c=>c.options.method==='POST').length,0);
 fresh.deny();fresh.button('Refresh saved status').props.onClick();await fresh.settle();assert.equal(fresh.contributionResult(),undefined);
});

test('failed review delivery recovers the original saved review once and survives a lost reply and reload',async()=>{
 const {f:prior,job,input,options}=savedReviewFixture(true);
 options.computer.worker.capabilities.find(c=>c.id===review.NATIVE_REVIEW_CAPABILITY).version=3;
 job.state='failed';job.terminal={code:'execution-timeout',finishedAt:AT,result:null};
 const f=fixture(prior.saved,prior.saved,options);f.jobs.set(job.jobId,job);await f.settle();
 const recover=f.button('Recover saved review').props.onClick;
 f.loseReply();recover();recover();await f.settle();
 const posts=f.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,1);
 const request=JSON.parse(posts[0].options.body).input;
 assert.equal(request.schemaVersion,3);assert.equal(request.action,'recover');assert.equal(request.savedOperationId,input.operationId);
 assert.notEqual(request.operationId,input.operationId);assert.equal(request.content,input.content);assert.deepEqual(f.jobs.get(job.jobId),job);
 const resumed=fixture(f.saved,f.saved,options);for(const [id,j] of f.jobs)resumed.jobs.set(id,j);await resumed.settle();
 assert.equal(resumed.calls.filter(c=>c.options.method==='POST').length,0);assert.match(resumed.html(),/Review saved with unresolved items/);
 resumed.button('Revise review proposal').props.onClick();await resumed.settle();assert.equal(resumed.reviewEditor().props.wireVersion,2);
 assert.deepEqual(JSON.parse(JSON.stringify(resumed.reviewEditor().props.initialContent)),review.nativeReviewContent(input));
});

test('review reuse uses the existing decision ID, survives a lost reply and resumes without resubmission',async()=>{
 const {f:prior,job,options}=savedReviewFixture();
 options.computer.worker.capabilities.push({id:reviewReuse.REVIEW_REUSE,version:1});
 const f=fixture(prior.saved,prior.saved,options);f.jobs.set(job.jobId,job);await f.settle();
 f.button('Check accepted reuse evidence').props.onClick();await f.settle();
 const assessed=f.reuseResult().props.value;assert.equal(assessed.coveredCount,8);assert.equal(assessed.existingOperationId,reuseOperation);
 const accept=f.reuseResult().props.onAccept;f.loseReply();accept();accept();await f.settle();
 const posts=f.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,2);
 const body=JSON.parse(posts[1].options.body);assert.equal(body.operationId,reuseOperation);assert.equal(body.input.qualificationId,assessed.qualificationId);
 assert.equal(body.input.decisions.length,4);assert.equal(body.input.decisions[0].acceptedSha256,undefined);
 assert.deepEqual(f.jobs.get(job.jobId),job);assert.equal(f.jobs.size,3);
 const resumed=fixture(f.saved,f.saved,options);for(const [id,j] of f.jobs)resumed.jobs.set(id,j);await resumed.settle();
 assert.equal(resumed.reuseResult().props.value.action,'accept');assert.equal(resumed.calls.filter(c=>c.options.method==='POST').length,0);
 const fresh=fixture(new Map(),f.saved,options);for(const [id,j] of f.jobs)fresh.jobs.set(id,j);await fresh.settle();
 fresh.button('Resume saved work').props.onClick();await fresh.settle();assert.equal(fresh.reuseResult().props.value.operationId,reuseOperation);
 assert.equal(fresh.calls.filter(c=>c.options.method==='POST').length,0);
 resumed.deny();resumed.button('Refresh saved status').props.onClick();await resumed.settle();assert.equal(resumed.reuseResult(),undefined);
});

function savedReviewFixture(lossless=false){
 let input=reviewInput();input.taskRef={taskId:TASK,project:'mastermind'};input.content.requirements.taskRef=input.taskRef;
 if(lossless){input.content.requirements={...JSON.parse(fs.readFileSync(new URL('../../../protocol/mastermind-node-exchange/review-inventory-fixture.json',import.meta.url),'utf8')),taskRef:input.taskRef};input=review.encodeNativeReviewInput(input);}
 const pending={nodeId:NODE,taskId:TASK,capability:review.NATIVE_REVIEW_CAPABILITY,operationId:input.operationId,body:{operationId:input.operationId,input}};
 const saved=new Map([['mastermind.remote-native.pending.v1',JSON.stringify(pending)]]);
 const job={jobId:input.operationId,nodeId:NODE,capability:pending.capability,capabilityVersion:input.schemaVersion,policyClass:'routine',state:'succeeded',createdAt:AT,expiresAt:'2026-09-11T04:30:00.000Z',lease:null,terminal:{code:'desired-state-reached',finishedAt:AT,result:reviewResult(input)}};
 const options={computer:{...computer,worker:{...computer.worker,capabilities:[...computer.worker.capabilities,{id:review.NATIVE_REVIEW_CAPABILITY,version:input.schemaVersion}]}}};
 const f=fixture(saved,saved,options);f.jobs.set(job.jobId,job);return {f,input,job,options};
}

test('review correction seeds saved content, preserves original Wizard parent and submits once',async()=>{
 const {f,input,job}=savedReviewFixture();await f.settle();const original=structuredClone(job);
 f.button('Revise review proposal').props.onClick();await f.settle();
 assert.deepEqual(JSON.parse(JSON.stringify(f.reviewEditor().props.initialContent)),input.content);assert.equal(f.reviewEditor().props.draftId,input.operationId);
 assert.equal(f.button('Find capabilities').props.disabled,true);
 const content=structuredClone(input.content);content.requirements.requirements[0]='Corrected requirement.';
 const save=f.reviewEditor().props.onSave;save(content);save(content);await f.settle();
 const posts=f.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,1);
 const revised=JSON.parse(posts[0].options.body).input;
 assert.equal(revised.parentOperationId,input.parentOperationId);assert.notEqual(revised.operationId,input.operationId);
 assert.deepEqual(revised.content,content);assert.deepEqual(f.jobs.get(job.jobId),original);
 assert.match(f.html(),/Review saved with unresolved items/);assert.equal(f.reviewEditor(),undefined);
});

test('unsent review editing survives reload without sending and discard retains the saved proposal',async()=>{
 const {f,job,options}=savedReviewFixture();await f.settle();f.button('Revise review proposal').props.onClick();await f.settle();
 const next=fixture(f.saved,f.saved,options);next.jobs.set(job.jobId,job);await next.settle();
 assert.ok(next.reviewEditor());assert.equal(next.calls.filter(c=>c.options.method==='POST').length,0);
 next.button('Discard unsent review edits').props.onClick();await next.settle();
 assert.equal(next.reviewEditor(),undefined);assert.match(next.html(),/Review saved with unresolved items/);
 assert.deepEqual(next.jobs.get(job.jobId),job);
});
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

const wizardComputer={...computer,worker:{...computer.worker,capabilities:[...computer.worker.capabilities,{id:'mastermind.core.status',version:1},{id:workflow.SPECIFICATION,version:1}]}};
test('Wizard keeps the exact request across lost reply and fresh-client history, without automatic preparation replay',async()=>{
 const f=fixture(new Map(),undefined,{computer:wizardComputer});await f.settle();
 const request='Compare release manifests\nPreserve source references.';
 f.textarea().props.onChange({target:{value:request}});await f.settle();f.loseReply();
 f.form().props.onSubmit({preventDefault(){}});f.form().props.onSubmit({preventDefault(){}});await f.settle();
 assert.equal(f.jobs.size,1);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);assert.match(f.html(),/could not be confirmed/);
 const restored=fixture(f.saved,f.saved,{computer:wizardComputer});for(const [k,j] of f.jobs)restored.jobs.set(k,j);await restored.settle();
 assert.equal(restored.textarea().props.value,request);assert.match(restored.html(),/More specification is needed/);
 assert.equal(restored.calls.filter(c=>c.options.method==='POST').length,0);
 const fresh=fixture(new Map(),f.saved,{computer:wizardComputer});for(const [k,j] of f.jobs)fresh.jobs.set(k,j);await fresh.settle();fresh.button('Resume saved work').props.onClick();await fresh.settle();
 assert.equal(fresh.textarea().props.value,request);assert.match(fresh.html(),/More specification is needed/);assert.equal(fresh.calls.filter(c=>c.options.method==='POST').length,0);
 const bad=fixture(f.saved,f.saved,{computer:wizardComputer});for(const [k,j] of f.jobs)bad.jobs.set(k,{...j,terminal:{...j.terminal,result:{...j.terminal.result,requestHash:'f'.repeat(64)}}});await bad.settle();
 assert.doesNotMatch(bad.html(),/More specification is needed/);assert.match(bad.html(),/saved status is unavailable/);
});

test('Wizard blocks unsupported workers and unsaved/oversized requests, while dated offline work can remain queued',async()=>{
 const unsupported=fixture();await unsupported.settle();assert.equal(unsupported.button('Save Wizard request').props.disabled,true);assert.match(unsupported.html(),/has not enabled Wizard requests/);
 for(const options of [{storageDenied:true},{}]){
   const f=fixture(new Map(),undefined,{computer:wizardComputer,...options});await f.settle();
   f.textarea().props.onChange({target:{value:options.storageDenied?'Save this intent':'📚'.repeat(1000)}});await f.settle();f.form().props.onSubmit({preventDefault(){}});await f.settle();
   assert.equal(f.calls.filter(c=>c.options.method==='POST').length,0);assert.match(f.html(),/could not be saved/);
 }
 const queued=fixture(new Map(),undefined,{computer:{...wizardComputer,connectivity:'offline'},queued:true});await queued.settle();
 queued.textarea().props.onChange({target:{value:'Prepare a bounded review'}});await queued.settle();queued.form().props.onSubmit({preventDefault(){}});await queued.settle();
 assert.match(queued.html(),/Queued/);assert.match(queued.html(),/last contact/);assert.equal(queued.textarea().props.disabled,true);assert.equal(queued.button('Save Wizard request').props.disabled,true);
});


test('detailed Wizard revision keeps original, binds parent, restores unsent edits and saves once',async()=>{
 const f=fixture(new Map(),undefined,{computer:wizardComputer,detailed:true});await f.settle();
 f.textarea().props.onChange({target:{value:'Compare release manifests'}});await f.settle();
 f.form().props.onSubmit({preventDefault(){}});await f.settle();
 assert.match(f.html(),/Confirm inputs and expected outputs/);
 assert.equal(f.textarea().props.readOnly,true);
 const first=Array.from(f.jobs.values())[0];
 f.button('Revise saved request').props.onClick();await f.settle();
 f.textarea().props.onChange({target:{value:'Compare release manifests. Missing paths are removed; new paths are added.'}});await f.settle();
 const resumed=fixture(f.saved,f.saved,{computer:wizardComputer,detailed:true});for(const [id,job] of f.jobs)resumed.jobs.set(id,job);await resumed.settle();
 assert.match(resumed.textarea().props.value,/Missing paths/);assert.equal(resumed.textarea().props.readOnly,false);
 assert.equal(resumed.calls.filter(c=>c.options.method==='POST').length,0);
 resumed.form().props.onSubmit({preventDefault(){}});resumed.form().props.onSubmit({preventDefault(){}});await resumed.settle();
 assert.equal(resumed.jobs.size,2);assert.deepEqual(resumed.jobs.get(first.jobId),first);
 const sent=JSON.parse(resumed.calls.find(c=>c.options.method==='POST').options.body).input;
 assert.deepEqual(sent.revisionOf,{operationId:first.jobId,requestHash:first.terminal.result.requestHash});
 assert.notEqual(sent.operationId,first.jobId);assert.equal(resumed.textarea().props.readOnly,true);
 assert.equal(resumed.button('Save revised request').props.disabled,true);
});



test('a disconnected review feature preserves saved proposals and blocks edits or submission',async()=>{
 const {f,input,job}=savedReviewFixture();await f.settle();
 const disabled=fixture(f.saved,f.saved,{computer});disabled.jobs.set(job.jobId,job);await disabled.settle();
 assert.equal(disabled.button('Revise review proposal').props.disabled,true);
 assert.match(disabled.html(),/Review saved with unresolved items/);
 f.saved.set('mastermind.remote-native.pending.v1.review-edit',input.operationId);
 const resumed=fixture(f.saved,f.saved,{computer});resumed.jobs.set(job.jobId,job);await resumed.settle();
 assert.equal(resumed.reviewEditor().props.disabled,true);
 await resumed.reviewEditor().props.onSave(input.content);await resumed.settle();
 assert.equal(resumed.calls.filter(c=>c.options.method==='POST').length,0);
});
test('shared review recovery restores a pending correction without resubmission',async()=>{
 const {f,input,job,options}=savedReviewFixture();await f.settle();
 const local=new Map([['mastermind.remote-native.pending.v1.review-edit',input.operationId]]);
 const resumed=fixture(local,f.saved,options);resumed.jobs.set(job.jobId,job);await resumed.settle();
 resumed.button('Resume saved work').props.onClick();await resumed.settle();
 assert.ok(resumed.reviewEditor());assert.equal(resumed.textarea().props.disabled,true);
 assert.equal(resumed.calls.filter(c=>c.options.method==='POST').length,0);
});

test('review recovery waits for actual asynchronous verification before fixture assertions',{timeout:3000},async()=>{
 const {f:prior,job,options}=savedReviewFixture();await prior.settle();
 let release;options.validationGate=new Promise(resolve=>{release=resolve;});
 const resumed=fixture(prior.saved,prior.saved,options);resumed.jobs.set(job.jobId,job);
 let complete=false;const settling=resumed.settle().then(()=>{complete=true;});
 try {
   for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
   assert.equal(complete,false,'settle must await the real validation, not count loop turns');
 } finally {release();}
 await settling;assert.match(resumed.html(),/Review saved with unresolved items/);
 assert.equal(resumed.calls.filter(c=>c.options.method==='POST').length,0);
});

test('a later capability lookup cannot hide the latest saved review',async()=>{
 const {f,input,job}=savedReviewFixture();await f.settle();
 f.button('Find capabilities').props.onClick();await f.settle();assert.ok(f.inputs());
 f.button('Resume latest review').props.onClick();await f.settle();
 assert.match(f.html(),/Review saved with unresolved items/);
 assert.ok(f.button('Revise review proposal'));assert.deepEqual(f.jobs.get(job.jobId),job);
 assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
});

for(const lossless of [false,true])test(`development preparation, publication and build plan preserve identities across lost reply and fresh client (lossless=${lossless})`,async()=>{
 const {f:prior,job,options}=savedReviewFixture(lossless);
 options.computer.worker.capabilities.push(...development.DEVELOPMENT_CAPABILITIES.map(id=>({id,version:1})));
 const f=fixture(prior.saved,prior.saved,options);f.jobs.set(job.jobId,job);await f.settle();
 const prepare=f.button('Prepare source package').props.onClick;prepare();prepare();await f.settle();
 let posts=f.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,1);
 const first=JSON.parse(posts[0].options.body).input;assert.equal(first.parentOperationId,job.jobId);assert.notEqual(first.operationId,first.artifactOperationId);
 const publish=f.developmentResult().props.onAction;f.loseReply();publish(development.REVIEW_ARTIFACTS,'publish');publish(development.REVIEW_ARTIFACTS,'publish');await f.settle();
 posts=f.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,2);
 const published=JSON.parse(posts[1].options.body).input;assert.equal(published.artifactOperationId,first.artifactOperationId);assert.equal(published.parentOperationId,job.jobId);
 assert.notEqual(published.operationId,first.operationId);assert.match(f.html(),/could not be confirmed/);
 const resumed=fixture(f.saved,f.saved,options);for(const [id,j] of f.jobs)resumed.jobs.set(id,j);await resumed.settle();
 assert.equal(resumed.calls.filter(c=>c.options.method==='POST').length,0);assert.equal(resumed.developmentResult().props.value.artifactState,'published');
 resumed.developmentResult().props.onAction(development.REVIEW_BUILD_PLAN,'prepare');await resumed.settle();
 const plan=resumed.developmentResult().props.value;assert.equal(plan.artifactOperationId,first.artifactOperationId);assert.equal(plan.parentOperationId,job.jobId);assert.equal(plan.workerInvoked,false);
 const fresh=fixture(new Map(),resumed.saved,options);for(const [id,j] of resumed.jobs)fresh.jobs.set(id,j);await fresh.settle();
 fresh.button('Resume saved work').props.onClick();await fresh.settle();assert.equal(fresh.developmentResult().props.value.planId,plan.planId);
 assert.equal(fresh.calls.filter(c=>c.options.method==='POST').length,0);
 fresh.developmentResult().props.onAction(development.REVIEW_BUILD_PLAN,'recover');await fresh.settle();assert.equal(fresh.developmentResult().props.value.buildOperationId,plan.buildOperationId);
 fresh.deny();fresh.button('Refresh saved status').props.onClick();await fresh.settle();assert.equal(fresh.developmentResult(),undefined);
 assert.deepEqual(f.jobs.get(job.jobId),job);
});

test('lossless saved review restores decoded content and resaves all cases with a new identity',async()=>{
 const {f,input,job,options}=savedReviewFixture(true);await f.settle();
 f.button('Revise review proposal').props.onClick();await f.settle();
 assert.equal(f.reviewEditor().props.wireVersion,2);
 const original=review.nativeReviewContent(input);assert.deepEqual(JSON.parse(JSON.stringify(f.reviewEditor().props.initialContent)),original);
 const content=structuredClone(original);content.requirements.requirements[0]='Corrected requirement.';
 f.reviewEditor().props.onSave(content);await f.settle();
 const posts=f.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,1);
 const sent=JSON.parse(posts[0].options.body).input;assert.equal(sent.schemaVersion,2);assert.notEqual(sent.operationId,input.operationId);
 assert.deepEqual(review.nativeReviewContent(sent),content);assert.deepEqual(f.jobs.get(job.jobId),job);
 const next=fixture(f.saved,f.saved,options);for(const [id,j] of f.jobs)next.jobs.set(id,j);await next.settle();
 assert.equal(next.calls.filter(c=>c.options.method==='POST').length,0);assert.match(next.html(),/Review saved/);
});

function codingFixture(input){
 const raw=JSON.parse(fs.readFileSync(new URL('../../../services/mastermind-node-link/test/runtime-build-dispatch-fixture.json',import.meta.url),'utf8'));
 return coding.buildDispatchReceipt({...raw.results[input.action],...coding.buildDispatchLocalRequest(input),...(input.action==='start'?{state:'started',sourceReady:false,candidateId:null}:{})},input);
}
test('owner coding controls preserve a single build through duplicate clicks, lost reply and fresh-client recovery',async()=>{
 const {f:prior,job,options}=savedReviewFixture(true);
 options.computer.worker.capabilities.push(...development.DEVELOPMENT_CAPABILITIES.map(id=>({id,version:1})),{id:coding.BUILD_DISPATCH,version:1});
 const f=fixture(prior.saved,prior.saved,options);f.jobs.set(job.jobId,job);await f.settle();
 f.button('Prepare source package').props.onClick();await f.settle();
 f.developmentResult().props.onAction(development.REVIEW_ARTIFACTS,'publish');await f.settle();
 f.developmentResult().props.onAction(development.REVIEW_BUILD_PLAN,'prepare');await f.settle();
 const plan=f.developmentResult().props.value;assert.equal(f.developmentResult().props.codingSupported,true);
 const check=f.developmentResult().props.onCoding;check();check();await f.settle();
 assert.equal(f.codingResult().props.value.observedAction,'preflight');
 const start=f.codingResult().props.onAction;f.loseReply();start('start');start('start');await f.settle();
 assert.match(f.html(),/could not be confirmed/);
 const posts=f.calls.filter(c=>c.url.endsWith('/review-build-dispatch')&&c.options.method==='POST');assert.equal(posts.length,2);
 for(const call of posts){const input=JSON.parse(call.options.body).input;assert.equal(input.buildOperationId,plan.buildOperationId);assert.equal(input.planId,plan.planId);}
 const next=fixture(f.saved,f.saved,options);for(const [id,j] of f.jobs)next.jobs.set(id,j);await next.settle();
 assert.equal(next.calls.filter(c=>c.options.method==='POST').length,0);assert.equal(next.codingResult().props.value.state,'started');assert.match(next.html(),/Coding status saved/);
 next.codingResult().props.onAction('recover');await next.settle();
 assert.equal(next.codingResult().props.value.sourceReady,true);assert.equal(next.codingResult().props.value.buildOperationId,plan.buildOperationId);
 const fresh=fixture(new Map(),next.saved,options);for(const [id,j] of next.jobs)fresh.jobs.set(id,j);await fresh.settle();
 fresh.button('Resume saved work').props.onClick();await fresh.settle();assert.equal(fresh.codingResult().props.value.planId,plan.planId);
 assert.equal(fresh.calls.filter(c=>c.options.method==='POST').length,0);
 fresh.deny();fresh.button('Refresh saved status').props.onClick();await fresh.settle();assert.equal(fresh.codingResult(),undefined);
});
