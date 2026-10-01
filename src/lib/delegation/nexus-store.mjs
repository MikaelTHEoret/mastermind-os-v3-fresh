import {ContributionError,canonical,validateRecord,validateParent,taskRef} from './contract.mjs';
import {ContributionStore,digest} from './store.mjs';
const fail=(code,status=409)=>{throw new ContributionError(code,status);};

export class NexusProposalStore extends ContributionStore{
 constructor(query,owner,{enabled=false,verifyReferences=null}={}){
  super(query,owner);this.enabled=enabled===true;this.verifyReferences=verifyReferences;
 }
 async recover(ref,operationId){
  taskRef(ref);
  if(typeof operationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(operationId))fail('CONTRIBUTION_INVALID',400);
  const rows=await this.list(ref);
  return rows.find(row=>row.record.kind==='nexus-proposal'&&row.record.operationId===operationId)??null;
 }
 async save(raw){
  const record=validateRecord(raw);
  if(record.kind!=='nexus-proposal')fail('CONTRIBUTION_INVALID',400);
  const id=digest(record),ref=record.taskRef;
  // Recovery is authorized now, but does not require the old task basis to still
  // be current or the creation flag/worker to remain available.
  const existing=await this.recover(ref,record.operationId);
  if(existing){
   if(existing.artifactId!==id)fail('CONTRIBUTION_OPERATION_CONFLICT');
   return {status:'duplicate',artifact:existing,executionAuthorized:false};
  }
  if(!this.enabled)fail('NEXUS_PROPOSAL_SAVE_DISABLED');
  if(typeof this.verifyReferences!=='function')fail('NEXUS_REFERENCE_READER_UNAVAILABLE',503);
  await this.assertTask(ref,true);
  validateParent(record,record.parentId===null?null:await this.get(ref,record.parentId));
  for(const reviewId of record.reviewIds){
   const review=await this.get(ref,reviewId);
   if(review.record.kind!=='review'||review.record.decision!=='accepted-as-advice')fail('NEXUS_REVIEW_REQUIRED');
  }
  // Host configured verifier must resolve exact immutable plans/specifications
  // and their source references under current owner/task permissions. Never
  // accept a verifier result, grant or worker snapshot supplied by the client.
  const proof=await this.verifyReferences(structuredClone(record));
  if(!proof||Object.keys(proof).sort().join(',')!=='proposalSha256,verified'||proof.verified!==true||proof.proposalSha256!==id)fail('NEXUS_REFERENCES_UNVERIFIED');
  const rows=await this.query(`SELECT status,"artifactId" FROM public.save_mastermind_nexus_proposal_v1(
   $1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::text,$7::text)`,
   [...this.ownerArgs(ref),this.owner.clerkSubject??null,id,canonical(record)]);
  if(rows.length!==1)fail('NEXUS_SAVE_UNCERTAIN',503);
  const {status,artifactId}=rows[0];
  if(status==='conflict')fail('CONTRIBUTION_OPERATION_CONFLICT');
  if(!['created','duplicate'].includes(status))fail(status==='denied'?'CONTRIBUTION_TASK_ACCESS_DENIED':'NEXUS_'+String(status).toUpperCase(),status==='denied'?403:409);
  if(artifactId!==id)fail('NEXUS_SAVE_UNCERTAIN',503);
  const artifact=await this.get(ref,id);
  await this.assertTask(ref);
  return {status,artifact,executionAuthorized:false};
 }
}
