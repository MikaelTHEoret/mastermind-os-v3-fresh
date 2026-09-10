import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as contract from '../../../components/node-control-contract.mjs';

const NODE='11111111-1111-4111-8111-111111111111', JOB='22222222-2222-4222-8222-222222222222';
const NOW='2026-09-06T18:00:00.000Z', LATER='2026-09-06T18:30:00.000Z';
const core=contract.NODE_CORE_STATUS_CAPABILITY, family=contract.NODE_ENSURE_RUNNING_CAPABILITY;
function observation(complete=true) { return { kind:core, observedAt:NOW,
  services:{mcpHost:'online',memory:complete?'online':'unreachable',modules:'online'},
  capabilities:{count:43,sha256:'a'.repeat(64)},activeTurns:0,complete }; }
function job(capability=core,result=observation()) { return {jobId:JOB,nodeId:NODE,capability,capabilityVersion:1,policyClass:'routine',state:'succeeded',
  createdAt:NOW,expiresAt:LATER,lease:{leaseId:'33333333-3333-4333-8333-333333333333',leasedAt:NOW,leaseExpiresAt:LATER},
  terminal:{code:'desired-state-reached',result,finishedAt:NOW}}; }
function node(worker=null,connectivity='online') { return {nodeId:NODE,displayName:'Fixture workstation',state:'active',connectivity,
  agentVersion:'0.1.0',pairedAt:NOW,lastExchangeAt:NOW,lastJobReceiptAt:null,status:null,worker}; }
const worker={protocolVersion:2,capabilities:[{id:core,version:1}]};
function load({nodes=[],runs={},fetchImpl=async()=>{throw new Error('No network fixture');},stale=null}={}) {
  const effects=[]; const timers=new Map(); let timerId=0;
  const states=['hosted',{ok:true,nodes},stale,0,0,runs,false,null]; let index=0;
  const hooks={...React,useState(initial){const i=index++; if(i>=states.length)states[i]=initial; return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useEffect(callback){effects.push(callback);},useCallback(value){return value;},useRef(value){return {current:value};}};
  const source=fs.readFileSync(new URL('../../../components/NodeControlConsole.tsx',import.meta.url),'utf8')
    +'\nexport const fixtureMethods={enqueueJob,reconcileExactRequest,jobMessage};\n';
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(compiled,{exports:module.exports,module,Response,Date,Object,Map,Set,URL,Uint8Array,TextDecoder,AbortController,DOMException,
    crypto:{randomUUID:()=>JOB},fetch:fetchImpl,console,
    window:{location:{origin:'https://mastermind-core.com'},setTimeout(callback){timers.set(++timerId,callback);return timerId;}},
    clearTimeout(id){timers.delete(id);},
    require(id){if(id==='react')return hooks;if(id==='react/jsx-runtime')return jsx;if(id==='./node-control-contract.mjs')return contract;throw new Error(id);}});
  return {ui:module.exports,states,effects,timers};
}
function flatten(element,output=[]) {
  if(element==null||typeof element==='boolean')return output;
  if(Array.isArray(element)){for(const child of element)flatten(child,output);return output;}
  if(typeof element==='string'||typeof element==='number')return output;
  if(typeof element.type==='function')return flatten(element.type(element.props),output);
  output.push(element);flatten(element.props?.children,output);return output;
}
function label(element){const value=element.props?.children;return Array.isArray(value)?value.join(''):String(value??'');}

test('Nodes UI hides unsupported core action, labels offline queue, and disables stale advertisement', () => {
  for(const [nodes,expected,stale] of [[[node()],null,null],[[node(worker)],'CHECK CORE STATUS',null],[[node(worker,'offline')],'QUEUE CORE STATUS',null],[[node(worker)],'CHECK CORE STATUS','stale']]) {
    const {ui}=load({nodes,stale});const tree=ui.default();const buttons=flatten(tree).filter(e=>e.type==='button');
    const coreButtons=buttons.filter(e=>label(e).includes('CORE STATUS'));
    assert.equal(coreButtons.length,expected?1:0);
    if(expected){assert.equal(label(coreButtons[0]),expected);assert.equal(Boolean(coreButtons[0].props.disabled),stale!==null);}
    const familyButton=buttons.find(e=>label(e)==='START ECOSYSTEM');assert(familyButton,'existing family action retained');
    assert.equal(Boolean(familyButton.props.disabled),nodes[0].worker !== null || stale !== null);
  }
});

test('core action submits exactly one fixed read-only intent and renders its incomplete receipt truthfully', async () => {
  const calls=[];let release;const gate=new Promise(resolve=>{release=resolve;});
  const {ui,states}=load({nodes:[node(worker)],fetchImpl:async(path,options)=>{calls.push([path,options]);await gate;return Response.json({ok:true,status:'created',job:job(core,observation(false))});}});
  const button=flatten(ui.default()).find(e=>e.type==='button'&&label(e)==='CHECK CORE STATUS');
  button.props.onClick();button.props.onClick();assert.equal(calls.length,1);release();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(JSON.parse(calls[0][1].body),{capability:core,requestId:JOB});
  assert.equal(calls[0][0],`/api/nodes/${NODE}/jobs`);
  assert.equal(states[5][NODE].capability,core);assert.equal(states[5][NODE].message,'Core status observed · incomplete');
  const html=renderToStaticMarkup(React.createElement(ui.NodeJobResult,{job:states[5][NODE].job}));
  assert.match(html,/INCOMPLETE/);assert.match(html,/UNREACHABLE/);assert.match(html,/Available tools/);assert.doesNotMatch(html,/Family result|Family ecosystem is ready/);
});

test('uncertain core reconciliation reuses the exact capability and request ID; family response is rejected', async () => {
  const calls=[];const {ui}=load({fetchImpl:async(path,options)=>{calls.push([path,options]);
    return options.method==='GET'?Response.json({ok:false,error:{code:'NODE_JOB_NOT_FOUND',message:'Missing fixture'}},{status:404}):Response.json({ok:true,status:'created',job:job()});}});
  const response=await ui.fixtureMethods.reconcileExactRequest(NODE,JOB,new AbortController().signal,core);
  assert.equal(response.capability,core);assert.equal(calls[0][0],`/api/nodes/${NODE}/jobs/${JOB}`);
  assert.deepEqual(JSON.parse(calls[1][1].body),{capability:core,requestId:JOB});
  const wrong=load({fetchImpl:async()=>Response.json({ok:true,status:'created',job:job(family,{familyServer:'running',companion:'running',companionBridge:'ready'})})});
  await assert.rejects(wrong.ui.fixtureMethods.enqueueJob(NODE,JOB,new AbortController().signal,core),/another capability/);
});

test('family terminal rendering stays separate from core observation rendering', () => {
  const {ui}=load();const value=job(family,{familyServer:'running',companion:'running',companionBridge:'ready'});
  const html=renderToStaticMarkup(React.createElement(ui.NodeJobResult,{job:value}));
  assert.match(html,/Family result/);assert.doesNotMatch(html,/MCP host|Available tools|Core observed/);
  assert.equal(ui.fixtureMethods.jobMessage(value),'Family ecosystem is ready');
});


test('uncertain core request remains inspectable after revoked, absent or stale advertisement without re-enqueue', async () => {
  for (const [currentNode,stale] of [[node(),null],[{...node(worker),state:'revoked'},null],[node(worker),'stale']]) {
    const calls=[];const run={requestId:JOB,capability:core,job:null,busy:false,needsReconciliation:true,message:'Uncertain',error:true};
    const {ui,states}=load({nodes:[currentNode],stale,runs:{[NODE]:run},fetchImpl:async(path,options)=>{
      calls.push([path,options]);return Response.json({ok:false,error:{code:'NODE_JOB_NOT_FOUND',message:'Missing fixture'}},{status:404});
    }});
    const button=flatten(ui.default()).find(e=>e.type==='button'&&label(e)==='RECONCILE CORE REQUEST');
    assert(button);assert.equal(Boolean(button.props.disabled),false);button.props.onClick();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls.length,1);assert.equal(calls[0][1].method,'GET');
    assert.equal(calls[0][0],`/api/nodes/${NODE}/jobs/${JOB}`);
    assert.equal(states[5][NODE].requestId,JOB);assert.equal(states[5][NODE].capability,core);
    assert.equal(states[5][NODE].needsReconciliation,true);assert.match(states[5][NODE].message,/no new request was sent/);
  }
});

test('read-first recovery returns an existing core receipt after withdrawal and rechecks support immediately before retry POST', async () => {
  const existing=load({fetchImpl:async()=>Response.json({ok:true,job:job()})});
  assert.equal((await existing.ui.fixtureMethods.reconcileExactRequest(NODE,JOB,new AbortController().signal,core,false)).jobId,JOB);
  let allowed=true;const calls=[];
  const withdrawn=load({fetchImpl:async(path,options)=>{calls.push(options.method);allowed=false;
    return Response.json({ok:false,error:{code:'NODE_JOB_NOT_FOUND',message:'Missing fixture'}},{status:404});}});
  await assert.rejects(withdrawn.ui.fixtureMethods.reconcileExactRequest(NODE,JOB,new AbortController().signal,core,()=>allowed),{code:'NODE_RECONCILIATION_HELD'});
  assert.deepEqual(calls,['GET']);
});


test('core-only advertisement hides stale family readiness and preserves read-first family recovery', async () => {
  const active=node(worker);active.status={observedAt:NOW,controlAgent:'online',familyServer:'running',companion:'running',companionBridge:'ready',localKillSwitch:false,recovery:'clear',attentionCodes:[]};
  const first=load({nodes:[active]});const html=renderToStaticMarkup(first.ui.default());
  assert.match(html,/NOT AVAILABLE TO THIS PROFILE/);assert.match(html,/CORE STATUS PROFILE/);assert.doesNotMatch(html,/DESIRED STATE REACHED|ENSURE ECOSYSTEM RUNNING/);
  const both=node({protocolVersion:2,capabilities:[{id:core,version:1},{id:family,version:1}]});
  assert.equal(flatten(load({nodes:[both]}).ui.default()).find(e=>e.type==='button'&&label(e)==='START ECOSYSTEM').props.disabled,false);
  const calls=[];const previous={requestId:JOB,capability:family,job:null,busy:false,needsReconciliation:true,message:'Uncertain',error:true};
  const {ui,states}=load({nodes:[{...active,state:'revoked'}],stale:'inventory unavailable',runs:{[NODE]:previous},fetchImpl:async(url,options)=>{calls.push(options.method);return Response.json({ok:false,error:{code:'NODE_JOB_NOT_FOUND',message:'Missing fixture'}},{status:404});}});
  const reconcile=flatten(ui.default()).find(e=>e.type==='button'&&label(e)==='RECONCILE SAME REQUEST');assert(reconcile);assert.equal(Boolean(reconcile.props.disabled),false);reconcile.props.onClick();
  await new Promise(r=>setTimeout(r,10));assert.deepEqual(calls,['GET']);assert.equal(states[5][NODE].requestId,JOB);assert.equal(states[5][NODE].capability,family);assert.equal(states[5][NODE].needsReconciliation,true);
});

test('fresh panel recovers the saved terminal result using reads only', async () => {
  const calls=[];
  const app=load({nodes:[node(worker)],fetchImpl:async(path,options)=>{
    calls.push([path,options.method]);
    return Response.json(path==='/api/nodes'?{ok:true,nodes:[node(worker)]}:{ok:true,job:job()});
  }});
  app.ui.default(); const cleanup=app.effects.map(effect=>effect());
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(app.states[5][NODE].job.jobId,JOB);
  assert.equal(app.states[5][NODE].message,'Core status observed · all sources available');
  assert.deepEqual(calls,[['/api/nodes','GET'],[`/api/nodes/${NODE}/core-status`,'GET']]);
  for(const stop of cleanup)stop?.();
});

test('late recovery cannot overwrite a new request and unmounted recovery cannot restore state', async () => {
  for(const unmount of [false,true]) {
    let release; const gate=new Promise(resolve=>{release=resolve;}); const calls=[];
    const app=load({nodes:[node(worker)],fetchImpl:async(path,options)=>{
      calls.push([path,options.method]);
      if(path==='/api/nodes')return Response.json({ok:true,nodes:[node(worker)]});
      await gate;return Response.json({ok:true,job:job()});
    }});
    app.ui.default();const cleanup=app.effects.map(effect=>effect());
    const newer={requestId:'newer-request',busy:true,job:null,capability:core};
    if(unmount)for(const stop of cleanup)stop?.();else app.states[5]={[NODE]:newer};
    release();await new Promise(resolve=>setTimeout(resolve,10));
    if(unmount)assert.equal(app.states[5][NODE],undefined);else assert.equal(app.states[5][NODE],newer);
    assert(calls.every(([,method])=>method==='GET'));
    if(!unmount)for(const stop of cleanup)stop?.();
  }
});

test('unavailable saved history is reported without silently creating another request', async () => {
  const calls=[];const app=load({nodes:[node(worker)],fetchImpl:async(path,options)=>{
    calls.push(options.method);return path==='/api/nodes'?Response.json({ok:true,nodes:[node(worker)]}):Response.json({ok:false,error:{code:'NODE_STORE_UNAVAILABLE',message:'Unavailable'}},{status:503});
  }});
  app.ui.default();const cleanup=app.effects.map(effect=>effect());
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(app.states[5][NODE],undefined);assert.match(app.states[8],/could not be recovered/);
  assert(calls.every(method=>method==='GET'));for(const stop of cleanup)stop?.();
});

test('recovered queued work resumes exact-job polling without another submission', async () => {
  const pending={...job(),state:'queued',lease:null,terminal:null};
  const run={requestId:JOB,capability:core,job:pending,busy:false,needsReconciliation:false,message:null,error:false};
  const calls=[];const app=load({nodes:[node(worker)],runs:{[NODE]:run},fetchImpl:async(path,options)=>{
    calls.push([path,options.method]);
    return Response.json(path==='/api/nodes'?{ok:true,nodes:[node(worker)]}:{ok:true,job:path.endsWith('/core-status')?pending:job()});
  }});
  app.ui.default();const cleanup=app.effects.map(effect=>effect());
  const tick=app.timers.values().next().value;assert.equal(typeof tick,'function');tick();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(app.states[5][NODE].job.state,'succeeded');
  assert(calls.some(([path])=>path===`/api/nodes/${NODE}/jobs/${JOB}`));
  assert(calls.every(([,method])=>method==='GET'));for(const stop of cleanup)stop?.();
});
