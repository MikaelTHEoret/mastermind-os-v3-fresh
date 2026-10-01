import {canonical,taskRef,validateRecord} from './contract.mjs';
import {checkedArtifact,checkedAcknowledgement} from './browser-workflow.mjs';
import {proposalHeads} from './nexus-proposal.mjs';

const copy=v=>JSON.parse(JSON.stringify(v));
const fail=message=>{throw Error(message);};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
// Host source labels are derived pins, never claims about an archive excerpt.
export function checkedMaterial(value,ref){
 if(!value||value.ok!==true||value.viewState!=='available'||value.executionAuthorized!==false
  ||canonical(value.taskRef)!==canonical(ref)||!Array.isArray(value.plans)||value.plans.length<1||value.plans.length>32)fail('Saved plan choices are unavailable.');
 const ids=new Set();
 for(const plan of value.plans){
  if(!sha(plan.specificationId)||!sha(plan.planId)||ids.has(plan.planId)||typeof plan.title!=='string'||!plan.title.trim()||plan.title.length>240
   ||!Array.isArray(plan.sourceRefs)||plan.sourceRefs.length!==2||plan.sourceRefs[0]!==`mastermind/build-plan/${plan.planId}`
   ||!/^mastermind\/source-evidence\/[a-f0-9]{64}$/.test(plan.sourceRefs[1]))fail('Invalid saved plan choice.');
  ids.add(plan.planId);
 }
 // Reuse the authoritative proposal validator for the checkpoint/permission basis.
 validateRecord({schemaVersion:1,kind:'nexus-proposal',operationId:'4196249c-dcbd-41cc-9e6f-8b87b7b2cdda',seriesId:'4196249c-dcbd-41cc-9e6f-8b87b7b2cddb',parentId:null,
  taskRef:ref,basis:value.basis,title:'Validate basis',dependencyMeaning:'source-ready-for-review',
  nodes:[{specificationId:value.plans[0].specificationId,planId:value.plans[0].planId,dependsOn:[]}],sourceRefs:value.plans[0].sourceRefs,reviewIds:['a'.repeat(64)]});
 return copy(value);
}

/** Host installs an owner-authenticated transport. This module defines no URL,
 * browser relay or worker request, and a client proof cannot authorize storage.
 * Pending data is namespaced by the authenticated owner, contains no credentials,
 * and survives an uncertain save. Construction and reload never send anything.
 */
export class NexusOwnerSession{
 constructor({ownerKey,ref,storage,transport}){
  taskRef(ref);
  if(typeof ownerKey!=='string'||!ownerKey||ownerKey.length>200)fail('Owner connection required.');
  this.ref=copy(ref);this.storage=storage;this.transport=transport;
  this.key=`mastermind-nexus-pending-v1:${encodeURIComponent(ownerKey)}:${ref.taskId}:${ref.project}`;
  this.state={material:null,artifacts:[],pending:null,message:'Load saved plans to prepare a proposal.',busy:false};
  this.invalid=false;
  try{
   const raw=storage.getItem(this.key);
   if(raw){
    if(raw.length>65536)fail('Oversized recovery record.');
    const envelope=JSON.parse(raw);
    if(envelope.version!==1||Object.keys(envelope).sort().join(',')!=='record,version')fail('Invalid recovery version.');
    const record=validateRecord(envelope.record);
    if(record.kind!=='nexus-proposal'||canonical(record.taskRef)!==canonical(this.ref))fail('Wrong recovery task.');
    this.state.pending=copy(record);this.state.message='An unfinished save is retained. Check its existing result before continuing.';
   }
  }catch{this.invalid=true;this.state.message='Stored recovery cannot be read safely. Keep it for recovery; no new save is allowed.';}
 }
 snapshot(){return copy(this.state);}
 async action(fn){
  if(this.state.busy)fail('A request is already in progress.');
  if(this.invalid)fail(this.state.message);
  if(!this.transport)fail('This connection is not installed yet.');
  this.state.busy=true;
  try{return await fn();}catch(error){
   // Failed/revoked reads must not leave previously authorized private views visible.
   this.state.material=null;this.state.artifacts=[];
   this.state.message=error instanceof Error?error.message:'The connection is unavailable.';throw error;
  }finally{this.state.busy=false;}
 }
 async load(){return this.action(async()=>{
  const result=await this.transport.load(copy(this.ref));
  const material=checkedMaterial(result.material,this.ref);
  if(!Array.isArray(result.artifacts)||result.artifacts.length>64)fail('Saved history is unavailable.');
  const artifacts=await Promise.all(result.artifacts.map(row=>checkedArtifact(row,this.ref)));
  this.state.material=material;this.state.artifacts=artifacts;
  this.state.message=this.state.pending?'An unfinished save is retained. Check its existing result.':'Saved plans and current proposal history loaded.';
 });}
 /** @param {{title:string,planIds:string[],dependencies?:Record<string,string[]>,reviewIds:string[],parentId?:string|null}} input */
 prepare({title,planIds,dependencies={},reviewIds,parentId=null}){
  if(this.invalid||this.state.busy||this.state.pending)fail('Recover the existing save first.');
  const {material,artifacts}=this.state;if(!material)fail('Load current saved plans first.');
  if(!Array.isArray(planIds)||new Set(planIds).size!==planIds.length)fail('Choose unique plans.');
  const selected=planIds.map(id=>material.plans.find(p=>p.planId===id)??fail('Plan is not in the current choices.'));
  const accepted=new Set(artifacts.filter(a=>a.record.kind==='review'&&a.record.decision==='accepted-as-advice').map(a=>a.artifactId));
  if(!Array.isArray(reviewIds)||reviewIds.some(id=>!accepted.has(id)))fail('Choose saved accepted advice.');
  const parent=parentId===null?null:proposalHeads(artifacts).find(a=>a.artifactId===parentId)??fail('Reload the current proposal before revising it.');
  const sourceRefs=[...new Set(selected.map(p=>p.sourceRefs[1]))];
  if(sourceRefs.length>12)fail('This proposal can cite up to 12 distinct source sets. Split the selection into smaller proposals.');
  const record=validateRecord({schemaVersion:1,kind:'nexus-proposal',operationId:crypto.randomUUID(),taskRef:this.ref,
   seriesId:parent?.record.seriesId??crypto.randomUUID(),parentId,basis:material.basis,title,
   dependencyMeaning:'source-ready-for-review',nodes:selected.map(p=>({specificationId:p.specificationId,planId:p.planId,dependsOn:dependencies[p.planId]??[]})),
   sourceRefs,reviewIds});
  // Persist before the first possible send. A storage error leaves no operation in flight.
  if(this.storage.getItem(this.key)!==null)fail('Another unfinished save is retained. Reload to recover it.');
  this.storage.setItem(this.key,JSON.stringify({version:1,record}));
  this.state.pending=copy(record);this.state.message='Proposal prepared locally. Saving records advice; it does not run a build.';
  return copy(record);
 }
 async complete(row){
  if(canonical(row.record)!==canonical(this.state.pending))fail('The saved operation does not match the retained proposal.');
  const raw=this.storage.getItem(this.key);
  if(raw!==null&&canonical(JSON.parse(raw))!==canonical({version:1,record:this.state.pending}))fail('Another retained operation must be recovered separately.');
  this.storage.removeItem(this.key);
  this.state.pending=null;this.state.material=null;this.state.artifacts=[row];
  this.state.message='Proposal saved and verified. No build or model was started.';
 }
 async save(){return this.action(async()=>{
  if(!this.state.pending)fail('Prepare a proposal first.');
  const record=copy(this.state.pending);
  const result=await this.transport.save(record);
  await this.complete(await checkedAcknowledgement(result,record));
 });}
 async recover(){return this.action(async()=>{
  if(!this.state.pending)fail('No unfinished save.');
  const row=await this.transport.recover(copy(this.ref),this.state.pending.operationId);
  if(row===null){this.state.message='No saved result was found. The exact proposal is retained; retrying uses the same operation.';return;}
  await this.complete(await checkedArtifact(row,this.ref));
 });}
}
