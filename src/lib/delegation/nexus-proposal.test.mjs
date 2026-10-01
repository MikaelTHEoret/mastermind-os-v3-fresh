import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRecord,validateParent} from './contract.mjs';
import {ContributionStore,digest} from './store.mjs';
import {NexusProposalStore} from './nexus-store.mjs';
import {proposalHeads,readinessInput} from './nexus-proposal.mjs';
import {checkedAcknowledgement} from './browser-workflow.mjs';
const ref={taskId:randomUUID(),project:'mastermind'},owner={householdId:'fixture',actorPlayerId:randomUUID()};
const review={schemaVersion:1,kind:'review',operationId:randomUUID(),taskRef:ref,parentId:'c'.repeat(64),decision:'accepted-as-advice',assessment:'Reviewed original plan.',evidenceRefs:['fixture/source']};
const row=r=>({artifactId:digest(r),record:structuredClone(r),recordedAt:'2026-10-01T00:00:00.000Z'});
const make=()=>({schemaVersion:1,kind:'nexus-proposal',operationId:randomUUID(),taskRef:ref,seriesId:randomUUID(),parentId:null,
 basis:{checkpointId:randomUUID(),revision:'293',permissionRevision:'2',permissionScopeSha256:'a'.repeat(64)},title:'Compare and integrate',dependencyMeaning:'source-ready-for-review',
 nodes:[{specificationId:'b'.repeat(64),planId:'d'.repeat(64),dependsOn:[]}],sourceRefs:['gpt/original#m0001-c00'],reviewIds:[digest(review)]});
function database(){
 const rows=[row(review)];let allowed=true,active=true,writes=0,result=null;
 const query=async(sql,args)=>{
  if(sql.includes('SELECT t.task_id::text'))return allowed&&(!args[4]||active)?[{taskId:ref.taskId}]:[];
  if(sql.includes('save_mastermind_nexus_proposal_v1')){
   if(result)return [{status:result,artifactId:null}];
   const r=JSON.parse(args[6]),old=rows.find(x=>x.record.kind==='nexus-proposal'&&x.record.operationId===r.operationId);
   if(!allowed)return [{status:'denied',artifactId:null}];
   if(old)return [{status:old.artifactId===args[5]?'duplicate':'conflict',artifactId:old.artifactId}];
   rows.push(row(r));writes++;return [{status:'created',artifactId:args[5]}];
  }
  if(!allowed)return [];
  if(sql.includes('a.artifact_id=$5'))return rows.filter(x=>x.artifactId===args[4]);
  return structuredClone(rows);
 };
 return {rows,query,get writes(){return writes;},deny(){allowed=false;},complete(){active=false;},result(v){result=v;}};
}
const verify=async r=>({verified:true,proposalSha256:digest(r)});
test('new records retain exact source references, revisions and advisory projection',()=>{
 const p=make();assert.deepEqual(validateRecord(p),p);const view=readinessInput(p);
 assert.deepEqual(view.references,[{specificationId:p.nodes[0].specificationId,planId:p.nodes[0].planId}]);
 assert.equal(view.proposal.taskRef.checkpointId,p.basis.checkpointId);assert.equal(view.proposal.taskRef.revision,'293');
 assert.equal(view.proposal.dependencyMeaning,'source-ready-for-review');
});
const invalid={
 'injected authority':p=>p.executionAuthorized=true,'worker snapshot':p=>p.worker={},
 'remote attribution':p=>p.submission={transport:'oauth-mcp',subject:'user_test',clientId:'test'},
 'numeric revision':p=>p.basis.revision=293,'zero padded revision':p=>p.basis.revision='0293',
 'permission omitted':p=>delete p.basis.permissionRevision,'checkpoint invalid':p=>p.basis.checkpointId='yesterday',
 'series invalid':p=>p.seriesId='new','parent invalid':p=>p.parentId='unknown',
 'empty graph':p=>p.nodes=[],'duplicate plan':p=>p.nodes.push(p.nodes[0]),
 'unknown dependency':p=>p.nodes[0].dependsOn=['e'.repeat(64)],
 'duplicate dependency':p=>p.nodes[0].dependsOn=[p.nodes[0].planId,p.nodes[0].planId],
 'extra node authority':p=>p.nodes[0].grant='yes','missing specification':p=>delete p.nodes[0].specificationId,
 'too many nodes':p=>p.nodes=Array(33).fill(p.nodes[0]),'too many sources':p=>p.sourceRefs=Array.from({length:13},(_,i)=>String(i)),
 'empty reviews':p=>p.reviewIds=[],'duplicate reviews':p=>p.reviewIds.push(p.reviewIds[0]),
 'changed dependency meaning':p=>p.dependencyMeaning='already-activated',
 'bad unicode':p=>p.title='\ud800','control title':p=>p.title='title\nwith newline',
};
for(const [name,change] of Object.entries(invalid))test('reject '+name,()=>{const p=make();change(p);assert.throws(()=>validateRecord(p));});
test('cycles are retained for a held assessment, never converted into permission',()=>{
 const p=make();p.nodes[0].dependsOn=[p.nodes[0].planId];assert.deepEqual(validateRecord(p),p);
});
test('lineage accepts only predecessor from same task and series',()=>{
 const root=make(),p={...root,operationId:randomUUID(),parentId:digest(root)};
 validateParent(root,null);validateParent(p,row(root));
 assert.throws(()=>validateParent(p,row({...root,seriesId:randomUUID()})));
 assert.throws(()=>validateParent(p,{artifactId:p.parentId,record:{...root,taskRef:{...ref,taskId:randomUUID()}}}));
 assert.throws(()=>validateParent(p,{artifactId:p.parentId,record:review}));
 assert.deepEqual(proposalHeads([row(review),row(root),row(p)]),[row(p)]);
});
test('all legacy stores can read proposals but cannot create them',async()=>{
 const db=database(),p=make();db.rows.push(row(p));const store=new ContributionStore(db.query,owner);
 assert.equal((await store.list(ref)).length,2);
 await assert.rejects(store.save(p),{code:'NEXUS_PROPOSAL_SAVE_DISABLED'});assert.equal(db.writes,0);
});
test('save, acknowledgement and fresh instance recovery preserve exact operation and content',async()=>{
 const db=database(),p=make();let verificationCalls=0;
 const store=new NexusProposalStore(db.query,owner,{enabled:true,verifyReferences:async r=>{verificationCalls++;return verify(r);}});
 const first=await store.save(p);assert.equal(first.status,'created');assert.equal(first.executionAuthorized,false);
 assert.deepEqual(await checkedAcknowledgement(first,p),first.artifact);
 db.complete();const fresh=new NexusProposalStore(db.query,owner);
 assert.equal((await fresh.save(p)).status,'duplicate');assert.deepEqual(await fresh.recover(ref,p.operationId),first.artifact);
 assert.equal(verificationCalls,1);assert.equal(db.writes,1);
 await assert.rejects(fresh.save({...p,title:'Different'}),{code:'CONTRIBUTION_OPERATION_CONFLICT'});
});
test('feature flag, missing reader and forged proof all prevent new persistence',async()=>{
 const db=database(),p=make();
 await assert.rejects(new NexusProposalStore(db.query,owner).save(p),{code:'NEXUS_PROPOSAL_SAVE_DISABLED'});
 await assert.rejects(new NexusProposalStore(db.query,owner,{enabled:true}).save(p),{code:'NEXUS_REFERENCE_READER_UNAVAILABLE'});
 for(const proof of [true,{verified:true},{verified:true,proposalSha256:'b'.repeat(64)},{verified:true,proposalSha256:digest(p),grant:true}])
  await assert.rejects(new NexusProposalStore(db.query,owner,{enabled:true,verifyReferences:async()=>proof}).save(p),{code:'NEXUS_REFERENCES_UNVERIFIED'});
 assert.equal(db.writes,0);
});
test('revoked readers cannot recover a completed operation',async()=>{
 const db=database(),p=make();db.rows.push(row(p));db.deny();
 await assert.rejects(new NexusProposalStore(db.query,owner).recover(ref,p.operationId),{code:'CONTRIBUTION_TASK_ACCESS_DENIED'});
});
test('rejected or missing reviews and foreign source plans fail before insertion',async()=>{
 const p=make();
 for(const mutation of [r=>r.record.decision='rejected',r=>r.record.taskRef={...ref,taskId:randomUUID()}]){
  const db=database();mutation(db.rows[0]);db.rows[0].artifactId=digest(db.rows[0].record);p.reviewIds=[db.rows[0].artifactId];
  await assert.rejects(new NexusProposalStore(db.query,owner,{enabled:true,verifyReferences:verify}).save(p));assert.equal(db.writes,0);
 }
 const db=database();p.reviewIds=[digest(review)];
 await assert.rejects(new NexusProposalStore(db.query,owner,{enabled:true,verifyReferences:async()=>{throw new Error('PLAN_TASK_CHANGED');}}).save(p),/PLAN_TASK_CHANGED/);
 assert.equal(db.writes,0);
});
for(const status of ['basis_changed','head_changed','capacity_reached','denied'])test('transaction '+status+' is not reported as saved',async()=>{
 const db=database();db.result(status);
 await assert.rejects(new NexusProposalStore(db.query,owner,{enabled:true,verifyReferences:verify}).save(make()));assert.equal(db.writes,0);
});
test('lost save reply is recovered without resending reference/model work',async()=>{
 const db=database(),p=make();let lose=true;
 const query=async(s,a)=>{const r=await db.query(s,a);if(lose&&s.includes('save_mastermind_nexus_proposal_v1')){lose=false;throw new Error('lost reply');}return r;};
 const store=new NexusProposalStore(query,owner,{enabled:true,verifyReferences:verify});
 await assert.rejects(store.save(p),/lost reply/);
 assert.equal((await new NexusProposalStore(db.query,owner).save(p)).status,'duplicate');assert.equal(db.writes,1);
});
