import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const specId='a'.repeat(64),planId='b'.repeat(64),candidateId='c'.repeat(64),activeId='d'.repeat(64),previousId='e'.repeat(64);
const operationId='10000000-0000-4000-8000-000000000001',secondOperation='20000000-0000-4000-8000-000000000002';
const root=new URL('../../../../',import.meta.url);
function compile(path){return ts.transpileModule(fs.readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;}
function load(compiled,require,extra={}){const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,URLSearchParams,AbortController,TextDecoder,TextEncoder,setTimeout,clearTimeout,console,require,...extra});return module.exports;}
const workflow=load(compile('lib/native-development/workflow.ts'),name=>{throw Error(name);});
const plain=value=>JSON.parse(JSON.stringify(value));
const contract={name:'actual.read',inputSchema:{type:'object',properties:{},additionalProperties:false}};
const requirements={requirements:['Preserve the requested result'],contracts:[contract],tests:{cases:[{id:'valid',capability:'actual.read',input:{},expected:'result'}]}};
const candidate=()=>({candidateId,status:'awaiting_tests',identity:{expectedActiveRevision:activeId,manifest:{id:'actual.module',name:'Actual',version:'2'},contracts:[contract]},testReceipts:[],testRuns:[]});
const plan=(changes={})=>({viewState:'available',planId,operationId,state:'awaiting_coding_authority',jobState:'prepared',current:true,holds:[],candidateId:null,hasSourceReceipt:false,
  executionAuthorized:false,createdAt:'2026-09-06T00:00:00Z',details:{review:{requirements}},...changes});
const specification=(changes={})=>({viewState:'available',specificationId:specId,holderId:'request.provisional',candidateId:null,activeRevision:null,
  identity:{request:'Keep this original request',stage:'needs_specification',decision:'create',moduleId:null,missing:['Review examples'],catalogMatches:[],requirements:null,sourceRef:null},
  revisions:[],reuseRuns:[],events:[],buildPlans:[],...changes});
const projection=(changes={})=>({viewState:'available',specificationId:specId,planId,operationId,moduleId:'actual.module',candidateId,activeRevision:activeId,
  candidate:candidate(),requirements,revisions:[{candidateId:previousId,acceptedAt:'2026-09-05T00:00:00Z'}],sourceStatus:'verified',executionAuthorized:false,...changes});
const envelope=(data,ok=true)=>({ok,held:!ok,...data});
function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}

test('held and malformed specification views never retain historical private fields',()=>{
  for(const value of [{viewState:'held',specificationId:specId,holds:['BUILD_CURRENT_OWNER_PROOF_UNAVAILABLE'],identity:{request:'do not disclose'}},
    {specificationId:specId,identity:null},specification({buildPlans:[{planId:'bad'}]})]){
    const result=workflow.normalizeSpecification(value,specId);assert.equal(result.viewState,'held');assert.equal(result.identity,undefined);
  }
  assert.equal(workflow.normalizeSpecification(specification(),specId).viewState,'available');
});

test('actual candidate projection binds all action coordinates and accepts later active revisions',()=>{
  const accepted=workflow.normalizeProjection(projection(),specId,planId);
  assert.equal(accepted.moduleId,'actual.module');assert.equal(accepted.activeRevision,activeId);assert.equal(accepted.candidateId,candidateId);
  for(const value of [projection({specificationId:'f'.repeat(64)}),projection({planId:'f'.repeat(64)}),projection({candidate:{...candidate(),candidateId:activeId}}),projection({viewState:'held',holds:['BUILD_SOURCE_CHANGED']})]) {
    assert.equal(workflow.normalizeProjection(value,specId,planId).viewState,'held');
  }
  assert.equal(workflow.normalizeProjection(projection({activeRevision:candidateId}),specId,planId).activeRevision,candidateId);
  const changed=workflow.normalizeBuildPlan(plan({state:'held',current:false,holds:['BUILD_ACTIVE_REVISION_CHANGED'],candidateId,hasSourceReceipt:true}));
  assert.equal(changed.viewState,'available');assert.equal(changed.candidateId,candidateId);
});

test('plan creation persists one operation before POST and reconnect replays exactly it',async()=>{
  const saved=storage(),calls=[];let creates=0,lose=true;
  const request=async(action,body)=>{
    calls.push({action,body:plain(body)});
    if(action==='specification')return envelope({specification:specification()});
    assert.equal(workflow.pendingPreparation(saved,specId).operationId,operationId);
    if(lose){lose=false;throw Error('lost acknowledgement');}return envelope({buildPlan:plan()});
  };
  await assert.rejects(workflow.prepareSavedBuild(saved,specId,request,()=>{creates++;return operationId;}));
  const result=await workflow.prepareSavedBuild(saved,specId,request,()=>{creates++;return secondOperation;});
  assert.equal(creates,1);assert.equal(result.plan.planId,planId);
  assert.deepEqual(calls.filter(row=>row.action==='specification_build_plan').map(row=>row.body.operationId),[operationId,operationId]);
  assert.equal(workflow.pendingPreparation(saved,specId),null);
  assert.equal(workflow.readSelection(saved).planId,planId);
  assert.ok(calls.every(row=>!row.action.includes('_start')));
});

test('read-first preparation recovery uses already saved operation without another POST',async()=>{
  const saved=storage();let lose=true;const calls=[];
  const request=async(action)=>{calls.push(action);if(action==='specification')return envelope({specification:specification({buildPlans:lose?[]:[plan()]})});lose=false;throw Error('lost reply');};
  await assert.rejects(workflow.prepareSavedBuild(saved,specId,request,()=>operationId));
  const restored=await workflow.prepareSavedBuild(saved,specId,request,()=>{throw Error('must retain identity');});
  assert.equal(restored.plan.planId,planId);assert.equal(calls.filter(action=>action==='specification_build_plan').length,1);
});

test('switching saved requests cannot erase an uncertain preparation',async()=>{
  const saved=storage(),request=async action=>{if(action==='specification')return envelope({specification:specification()});throw Error('lost reply');};
  await assert.rejects(workflow.prepareSavedBuild(saved,specId,request,()=>operationId));
  workflow.saveSelection(saved,{version:1,specificationId:'e'.repeat(64),planId:'f'.repeat(64),operationId:secondOperation});
  assert.equal(workflow.pendingPreparation(saved,specId).operationId,operationId);
});

test('unavailable/corrupt storage and active uncertain source work cannot create new work',async()=>{
  let calls=0;const request=async()=>{calls++;return envelope({specification:specification()});};
  await assert.rejects(workflow.prepareSavedBuild({getItem:()=>null,setItem:()=>{throw Error('unavailable');}},specId,request,()=>operationId));
  const corrupt=storage();corrupt.setItem(workflow.PREPARATIONS_KEY,'broken');
  await assert.rejects(workflow.prepareSavedBuild(corrupt,specId,request,()=>{throw Error('must not mint');}));assert.equal(calls,0);
  const result=await workflow.prepareSavedBuild(storage(),specId,async(action)=>{assert.equal(action,'specification');return envelope({specification:specification({buildPlans:[plan({jobState:'held'})]})});},()=>secondOperation);
  assert.equal(result.plan,null);assert.match(result.holds.join(),/RECONCILIATION/);
});

test('transport preserves structured409 holds and GET plan/projection selectors without retry',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return Response.json({ok:false,preflight:{planId,state:'held',holds:['BUILD_RESOURCE_ADMISSION_HELD']}},{status:409});};
  const held=await workflow.nativeApi('specification_build_preflight',{specificationId:specId,planId},undefined,fetcher);
  assert.equal(held.ok,false);assert.equal(held.held,true);assert.equal(held.preflight.holds[0],'BUILD_RESOURCE_ADMISSION_HELD');assert.equal(calls.length,1);
  await workflow.nativeApi('specification_build_candidate',{specificationId:specId,planId},undefined,async(url,options)=>{assert.match(url,/action=specification_build_candidate/);assert.equal(options.method,undefined);assert.equal(options.body,undefined);return Response.json({ok:true,candidateProjection:projection()});});
});

const compiledMain=compile('components/NativeDevelopment.tsx'),compiledPanel=compile('components/NativeBuildPanel.tsx');
function fixture(which,fetcher,props={},saved=storage()) {
  const slots=[],queued=[],timers=[];let index=0,tree,buildProps;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
  const hooks={...React,
    useState(initial){const at=index++;if(!(at in slots))slots[at]=typeof initial==='function'?initial():initial;return [slots[at],value=>{slots[at]=typeof value==='function'?value(slots[at]):value;}];},
    useRef(initial){const at=index++;if(!(at in slots))slots[at]={current:initial};return slots[at];},
    useCallback(fn,deps){const at=index++;if(!slots[at]||!same(slots[at].deps,deps))slots[at]={deps,fn};return slots[at].fn;},
    useEffect(fn,deps){const at=index++;if(!slots[at]||!same(slots[at].deps,deps)){slots[at]?.cleanup?.();slots[at]={deps};queued.push(()=>{slots[at].cleanup=fn();});}},
  };
  const bound={...workflow,nativeApi:(action,body,signal)=>workflow.nativeApi(action,body,signal,fetcher),browserSelection:()=>workflow.readSelection(saved)};
  const component=load(which==='main'?compiledMain:compiledPanel,name=>{
    if(name==='react')return hooks;if(name==='react/jsx-runtime')return jsx;
    if(name.includes('native-development/workflow'))return bound;
    if(name==='./NativeCapabilityInputs')return {__esModule:true,default:()=>null};
    if(name==='./NativeBuildPanel')return {__esModule:true,default:value=>{buildProps=value;return null;}};
    throw Error(name);
  },{window:{localStorage:saved},document:{visibilityState:'visible'},crypto:{randomUUID:()=>operationId},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){}}).default;
  return {saved,timers,props:()=>buildProps,
    render(){index=0;tree=component(props);return renderToStaticMarkup(tree);},
    async settle(){for(const effect of queued.splice(0))effect();for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));},
    find(text,type='button') {let found;const walk=node=>{if(!node||found)return;if(Array.isArray(node)){node.forEach(walk);return;}if(typeof node==='object'&&node.props){if(node.type===type&&renderToStaticMarkup(node).includes(text))found=node;else walk(node.props.children);}};walk(tree);assert.ok(found,`Missing ${type} ${text}`);return found;},
  };
}
const catalog={ok:true,available:true,holds:[],recipes:[]};
function mainFetch(detail,effects=[]) {return async(url,options)=>{
  const action=new URL(url,'http://localhost').searchParams.get('action');
  if(action==='wizard_catalog')return Response.json(catalog);
  if(action==='specifications')return Response.json({ok:true,specifications:[{specificationId:specId,title:'Saved request',createdAt:'2026-09-06T00:00:00Z'}]});
  if(action==='specification')return Response.json({ok:true,specification:detail});
  const body=JSON.parse(options.body);effects.push(body);
  return Response.json(body.action==='candidate_preflight'?{ok:true,preflight:{ready:true,reasons:[]}}:{ok:true});
};}

test('real development screen renders a minimal held specification without identity or historical controls',async()=>{
  const f=fixture('main',mainFetch({viewState:'held',specificationId:specId,holds:['BUILD_CURRENT_OWNER_PROOF_UNAVAILABLE'],buildPlans:[]}));
  f.render();await f.settle();const html=f.render();assert.match(html,/Saved request access is held/);assert.doesNotMatch(html,/Run isolated tests|Activate tested version|undefined/);
});

test('reading a different saved request and its default plan persists that exact reconnect selection',async()=>{
  const saved=storage(),other='f'.repeat(64),otherPlan='1'.repeat(64);
  workflow.saveSelection(saved,{version:1,specificationId:specId,planId,operationId});
  const f=fixture('main',async url=>{
    const query=new URL(url,'http://localhost').searchParams;
    if(query.get('action')==='wizard_catalog')return Response.json(catalog);
    if(query.get('action')==='specifications')return Response.json({ok:true,specifications:[{specificationId:specId,title:'Request A'},{specificationId:other,title:'Request B'}]});
    return Response.json({ok:true,specification:specification({specificationId:query.get('specificationId')})});
  },{},saved);
  f.render();await f.settle();f.render();f.find('Request B','select').props.onChange({target:{value:other}});await f.settle();f.render();
  assert.equal(workflow.readSelection(saved).specificationId,other);
  const otherSaved=specification({specificationId:other,buildPlans:[plan({planId:otherPlan,operationId:secondOperation})]});
  const panel=fixture('panel',async()=>Response.json({ok:true,buildPlan:otherSaved.buildPlans[0]}),
    {specification:otherSaved,canStart:false,disabled:false,onProjection(){},onChanged:async()=>{},onBusyChange(){}},saved);
  panel.render();await panel.settle();panel.render();
  assert.deepEqual(plain(workflow.readSelection(saved)),{version:1,specificationId:other,planId:otherPlan,operationId:secondOperation});
});

test('real development screen sends test/promote/rollback to the projected actual module and active revision',async()=>{
  const effects=[],f=fixture('main',mainFetch(specification({buildPlans:[plan({candidateId})]}),effects));
  f.render();await f.settle();f.render();
  f.props().onProjection(planId,workflow.normalizeProjection(projection({candidate:{...candidate(),testReceipts:[{outcome:'passed'}]}}),specId,planId));
  f.render();await f.find('Run isolated tests').props.onClick();await f.settle();f.render();
  await f.find('Check activation').props.onClick();await f.settle();f.render();
  await f.find('Activate tested version').props.onClick();await f.settle();f.render();
  f.find('Choose a saved version','select').props.onChange({target:{value:previousId}});f.render();
  await f.find('Restore selected version').props.onClick();await f.settle();
  for(const action of ['candidate_test','candidate_promote','candidate_rollback'])assert.equal(effects.find(row=>row.action===action).id,'actual.module');
  assert.equal(effects.find(row=>row.action==='candidate_promote').expectedActiveRevision,activeId);
  assert.equal(effects.find(row=>row.action==='candidate_rollback').expectedActiveRevision,activeId);
  assert.equal(effects.find(row=>row.action==='candidate_rollback').candidateId,previousId);
});

test('parent candidate actions keep structured409 holds visible after their immediate status refresh',async()=>{
  const reads=mainFetch(specification({buildPlans:[plan({candidateId})]}));
  const f=fixture('main',async(url,options)=>options.method==='POST'
    ?Response.json({ok:false,buildJob:{holds:['BUILD_RESOURCE_ADMISSION_HELD']}},{status:409}):reads(url,options));
  f.render();await f.settle();f.render();f.props().onProjection(planId,workflow.normalizeProjection(projection(),specId,planId));
  f.render();f.find('Run isolated tests').props.onClick();await f.settle();const html=f.render();
  assert.match(html,/This step is held/);assert.match(html,/build resource admission held/);assert.doesNotMatch(html,/Tests were submitted/);
});

test('refresh/reconnect only reads saved build status; reconciliation remains visible when starts are held',async()=>{
  const saved=storage();workflow.saveSelection(saved,{version:1,specificationId:specId,planId,operationId});const calls=[];
  const f=fixture('panel',async(url,options)=>{
    calls.push({url,options});if(options.method==='POST')return Response.json({ok:false,buildJob:{planId,operationId,state:'held',holds:['BUILD_RESOURCE_ADMISSION_HELD'],executionAuthorized:false}},{status:409});
    return Response.json({ok:true,buildPlan:plan({jobState:'started'})});
  },{specification:specification({buildPlans:[plan({jobState:'started'})]}),canStart:false,disabled:false,onProjection(){},onChanged:async()=>{},onBusyChange(){}},saved);
  f.render();await f.settle();f.render();assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);
  assert.equal(f.find('Reconcile saved operation').props.disabled,false);assert.equal(f.find('Start saved source work').props.disabled,true);
  await f.find('Reconcile saved operation').props.onClick();await f.settle();const html=f.render();assert.match(html,/This step is held/);assert.doesNotMatch(html,/checks pass/);
  const effects=calls.filter(row=>row.options.method==='POST');assert.equal(effects.length,1);
  assert.deepEqual(JSON.parse(effects[0].options.body),{action:'specification_build_reconcile',specificationId:specId,planId});
});

test('a lost start acknowledgement cannot arm another start or dispatch during refresh',async()=>{
  const saved=storage();workflow.saveSelection(saved,{version:1,specificationId:specId,planId,operationId});const effects=[];
  const f=fixture('panel',async(url,options)=>{
    if(options.method!=='POST')return Response.json({ok:true,buildPlan:plan()});
    const body=JSON.parse(options.body);effects.push(body);
    if(body.action==='specification_build_preflight')return Response.json({ok:true,preflight:{planId,state:'ready_for_separate_dispatch',holds:[],workerInvoked:false,executionAuthorized:false}});
    throw Error('lost reply');
  },{specification:specification({buildPlans:[plan()]}),canStart:true,disabled:false,onProjection(){},onChanged:async()=>{},onBusyChange(){}},saved);
  f.render();await f.settle();f.render();await f.find('Check source-work readiness').props.onClick();await f.settle();f.render();
  assert.equal(f.find('Start saved source work').props.disabled,false);await f.find('Start saved source work').props.onClick();await f.settle();f.render();
  assert.equal(f.find('Start saved source work').props.disabled,true);assert.match(f.render(),/original outcome is uncertain/);
  for(const tick of f.timers)tick();await f.settle();f.render();assert.equal(effects.filter(row=>row.action==='specification_build_start').length,1);
});
