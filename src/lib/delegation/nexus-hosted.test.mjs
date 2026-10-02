import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {NexusHostedService} from './nexus-hosted-service.mjs';import {NexusHostedTransport} from './nexus-hosted-transport.mjs';
import {NexusOwnerSession} from './nexus-owner-workflow.mjs';import {digest} from './store.mjs';
const ref={taskId:randomUUID(),project:'mastermind'},node=randomUUID(),owner={householdId:'fixture',actorPlayerId:randomUUID()};
const basis={checkpointId:randomUUID(),revision:'1',permissionRevision:'1',permissionScopeSha256:'a'.repeat(64)};
const advice={schemaVersion:1,kind:'review',operationId:randomUUID(),taskRef:ref,parentId:'c'.repeat(64),decision:'accepted-as-advice',assessment:'Original accepted advice',evidenceRefs:['fixture/source']};
const choice={specificationId:'b'.repeat(64),planId:'c'.repeat(64),title:'Compare releases',sourceRefs:['mastermind/build-plan/'+'c'.repeat(64),'mastermind/source-evidence/'+'d'.repeat(64)],taskRevision:'1',historicalSnapshot:true};
const row=r=>({artifactId:digest(r),record:structuredClone(r),recordedAt:'2026-10-02T20:00:00.000Z'});
const proposal=()=>({schemaVersion:1,kind:'nexus-proposal',operationId:randomUUID(),taskRef:ref,seriesId:randomUUID(),parentId:null,basis,title:'Develop comparison',dependencyMeaning:'source-ready-for-review',nodes:[{specificationId:choice.specificationId,planId:choice.planId,dependsOn:[]}],sourceRefs:[choice.sourceRefs[1]],reviewIds:[digest(advice)]});
const input=(p=null)=>({schemaVersion:1,operationId:randomUUID(),taskRef:ref,action:p?'verify':'catalog',proposal:p,snapshotId:null,cursor:null});
function fixture(){
 const rows=[row(advice)],jobs=new Map(),calls=[],storageMap=new Map();let allowed=true,enabled=true,lost=null,now=Date.now(),writes=0;
 const query=async(sql,args)=>{
  if(sql.includes('SELECT t.task_id::text'))return allowed?[{taskId:ref.taskId}]:[];
  if(!allowed)return [];
  if(sql.includes('save_mastermind_nexus_proposal_v1')){const p=JSON.parse(args[6]);rows.push(row(p));writes++;return [{status:'created',artifactId:digest(p)}];}
  if(sql.includes('a.artifact_id=$5'))return rows.filter(r=>r.artifactId===args[4]);return structuredClone(rows);
 };
 const ledger={async read(n,id,r){calls.push(['read',id]);assert.equal(n,node);assert.deepEqual(r,ref);return structuredClone(jobs.get(id)??null);},async enqueue(n,i){calls.push(['enqueue',i.operationId]);assert.equal(n,node);if(!jobs.has(i.operationId))jobs.set(i.operationId,{input:structuredClone(i),job:{jobId:i.operationId,nodeId:node,capability:'mastermind.native.nexus',state:'queued',terminal:null}});return structuredClone(jobs.get(i.operationId));}};
 const service=()=>new NexusHostedService(query,owner,{enabled,ledger,now:()=>now});
 const request=async(url,options={})=>{
  const u=new URL(url,'https://fixture.invalid');assert.equal(u.pathname,'/api/nexus/'+ref.taskId);
  if(options.method==='POST'){const body=JSON.parse(options.body);calls.push(['post',body.action]);const r=await service().write(ref,body);if(lost===body.action){lost=null;throw Error('Reply lost');}return {ok:true,...r};}
  return {ok:true,...await service().read(ref,{operationId:u.searchParams.get('operationId'),nodeId:u.searchParams.get('nodeId'),jobId:u.searchParams.get('jobId')})};
 };
 const storage={getItem:k=>storageMap.get(k)??null,setItem:(k,v)=>storageMap.set(k,v),removeItem:k=>storageMap.delete(k)};
 const transport=()=>new NexusHostedTransport({ownerKey:'fixture-owner',nodeId:node,ref,storage,request});
 const session=()=>new NexusOwnerSession({ownerKey:'fixture-owner',ref,storage,transport:transport()});
 const complete=(id,data=null)=>{const t=jobs.get(id),i=t.input;t.job.state='succeeded';t.job.terminal={result:{schemaVersion:1,kind:'mastermind.native.nexus',operationId:id,taskRef:ref,action:i.action,requestSha256:digest(i),observedAt:new Date(now).toISOString(),executionAuthorized:false,data:data??(i.action==='verify'?{verified:true,proposalSha256:digest(i.proposal)}:{basis,snapshotId:'e'.repeat(64),choice,nextCursor:null})}};};
 return {rows,jobs,calls,storage,storageMap,transport,session,service,complete,lose:x=>lost=x,deny:()=>allowed=false,off:()=>enabled=false,age:()=>now+=61000,get writes(){return writes;}};
}
const latest=f=>[...f.jobs.keys()].at(-1);
async function loaded(f){const s=f.session();await assert.rejects(s.load(),/Waiting/);f.complete(latest(f));await s.load();return s;}
const draft={title:'Develop comparison',planIds:[choice.planId],reviewIds:[digest(advice)]};

test('owner form → hosted service → queue → verification → existing save survives two lost replies and reload',async()=>{
 const f=fixture(),s=await loaded(f),p=s.prepare(draft);f.lose('verify');await assert.rejects(s.save(),/Reply lost/);const id=latest(f),count=f.calls.length;
 const reload=f.session();assert.equal(f.calls.length,count);await reload.recover();assert.equal(f.writes,0);assert.deepEqual(reload.snapshot().pending,p);
 await assert.rejects(reload.save(),/Waiting/);assert.equal(f.jobs.size,2);f.complete(id);f.lose('save');await assert.rejects(reload.save(),/Reply lost/);assert.equal(f.writes,1);
 f.off();const fresh=f.session();const before=f.calls.filter(c=>c[0]==='enqueue').length;await fresh.recover();assert.equal(fresh.snapshot().pending,null);assert.equal(f.writes,1);assert.equal(f.calls.filter(c=>c[0]==='enqueue').length,before);
 assert.equal(f.transport().read().verify,null);
});
test('expired verification is held; explicit fresh check changes worker ID only',async()=>{
 const f=fixture(),s=await loaded(f),p=s.prepare(draft);await assert.rejects(s.save(),/Waiting/);const old=latest(f);f.complete(old);f.age();await assert.rejects(s.save(),{code:'NEXUS_VERIFICATION_EXPIRED_OR_INVALID'});assert.equal(f.writes,0);
 await s.renewVerification();assert.equal(f.jobs.size,2);await assert.rejects(s.save(),/Waiting/);const fresh=latest(f);assert.notEqual(fresh,old);assert.deepEqual(f.jobs.get(fresh).input.proposal,p);f.complete(fresh);await s.save();assert.equal(f.writes,1);
});
test('pending renewal cannot repeat an unfinished worker request',async()=>{
 const f=fixture(),s=await loaded(f);s.prepare(draft);await assert.rejects(s.save(),/Waiting/);const id=latest(f);await assert.rejects(s.renewVerification(),/unfinished/);assert.equal(f.transport().read().verify.operationId,id);assert.equal(f.jobs.size,2);
});
test('catalog pages resume by exact snapshot, cursor and task basis',async()=>{
 const f=fixture(),t=f.transport();await assert.rejects(t.load(ref),/Waiting/);const first=latest(f);f.complete(first,{basis,snapshotId:'e'.repeat(64),choice,nextCursor:choice.planId});await assert.rejects(t.load(ref),/More saved/);
 const reload=f.transport();await assert.rejects(reload.load(ref),/Waiting/);const second=latest(f);assert.equal(f.jobs.get(second).input.cursor,choice.planId);assert.equal(f.jobs.get(second).input.snapshotId,'e'.repeat(64));
 const c={...choice,planId:'f'.repeat(64),sourceRefs:['mastermind/build-plan/'+'f'.repeat(64),choice.sourceRefs[1]]};f.complete(second,{basis,snapshotId:'e'.repeat(64),choice:c,nextCursor:null});const out=await reload.load(ref);assert.equal(out.material.plans.length,2);assert.equal(f.jobs.size,2);
});
test('changed page basis and cyclic pagination do not yield material',async()=>{
 for(const change of ['basis','cycle']){const f=fixture(),t=f.transport();await assert.rejects(t.load(ref));f.complete(latest(f),{basis,snapshotId:'e'.repeat(64),choice,nextCursor:choice.planId});await assert.rejects(t.load(ref));await assert.rejects(t.load(ref));
 const c={...choice,planId:'f'.repeat(64),sourceRefs:['mastermind/build-plan/'+'f'.repeat(64),choice.sourceRefs[1]]};f.complete(latest(f),{basis:change==='basis'?{...basis,revision:'2'}:basis,snapshotId:'e'.repeat(64),choice:change==='cycle'?choice:c,nextCursor:null});await assert.rejects(t.load(ref));}
});
test('forged request proof, receipt hash, wrong node and failed result never save',async()=>{
 const f=fixture(),p=proposal(),i=input(p),service=f.service();
 await assert.rejects(service.write(ref,{action:'save',nodeId:node,operationId:i.operationId,record:p,proof:{verified:true}}),{code:'NEXUS_REQUEST_INVALID'});
 await assert.rejects(service.write(ref,{action:'save',nodeId:node,operationId:i.operationId,record:p}),{code:'NEXUS_REFERENCES_UNVERIFIED'});
 await service.write(ref,{action:'verify',nodeId:node,operationId:i.operationId,record:p});f.complete(i.operationId);f.jobs.get(i.operationId).job.terminal.result.requestSha256='0'.repeat(64);
 await assert.rejects(service.write(ref,{action:'save',nodeId:node,operationId:i.operationId,record:p}),{code:'NEXUS_VERIFICATION_EXPIRED_OR_INVALID'});assert.equal(f.writes,0);
 f.complete(i.operationId);f.jobs.get(i.operationId).job.nodeId=randomUUID();await assert.rejects(service.write(ref,{action:'save',nodeId:node,operationId:i.operationId,record:p}),{code:'NEXUS_REFERENCES_UNVERIFIED'});
 f.jobs.get(i.operationId).job.nodeId=node;f.jobs.get(i.operationId).job.state='failed';await assert.rejects(service.write(ref,{action:'save',nodeId:node,operationId:i.operationId,record:p}),{code:'NEXUS_VERIFICATION_PENDING'});assert.equal(f.writes,0);
});
test('current task denial clears views and keeps exact pending request',async()=>{
 const f=fixture(),s=await loaded(f),p=s.prepare(draft);f.deny();await assert.rejects(s.save(),{code:'CONTRIBUTION_TASK_ACCESS_DENIED'});assert.equal(s.snapshot().material,null);assert.deepEqual(s.snapshot().pending,p);assert.equal(f.jobs.size,1);assert.equal(f.writes,0);
});
test('feature disabled forbids queue and new save but preserves completed recovery',async()=>{
 const f=fixture(),p=proposal(),i=input(p);f.off();await assert.rejects(f.service().write(ref,{action:'catalog',nodeId:node,input:input()}),{code:'NEXUS_PROPOSAL_SAVE_DISABLED'});
 await assert.rejects(f.service().write(ref,{action:'verify',nodeId:node,operationId:i.operationId,record:p}),{code:'NEXUS_PROPOSAL_SAVE_DISABLED'});
 f.rows.push(row(p));const r=await f.service().write(ref,{action:'save',nodeId:node,operationId:i.operationId,record:p});assert.equal(r.status,'duplicate');assert.equal(f.jobs.size,0);
});
test('corrupt recovery and storage failure cannot enqueue, other owners do not inherit it',async()=>{
 const f=fixture(),t=f.transport();f.storageMap.set(t.key,'broken');await assert.rejects(t.load(ref));assert.equal(f.jobs.size,0);
 const other=new NexusHostedTransport({ownerKey:'other',nodeId:node,ref,storage:f.storage,request:async()=>{throw Error('not sent');}});assert.equal(other.read().verify,null);
 f.storageMap.clear();f.storage.setItem=()=>{throw Error('disk full');};await assert.rejects(t.load(ref),/disk full/);assert.equal(f.jobs.size,0);
});
test('completed saved-plan read can reset explicitly; queued read cannot be replaced',async()=>{
 const f=fixture(),t=f.transport();await assert.rejects(t.load(ref));await assert.rejects(t.restart(),/unfinished/);f.complete(latest(f));await t.restart();assert.equal(t.read().catalog,null);assert.equal(f.jobs.size,1);
});
