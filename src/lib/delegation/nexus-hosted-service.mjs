import {canonical,taskRef,validateRecord,ContributionError} from './contract.mjs';
import {NexusProposalStore} from './nexus-store.mjs';
import {NEXUS,validateNexusInput,freshNexusReceipt} from '../../../protocol/mastermind-node-exchange/native-nexus.mjs';
const deny=(code,status=409)=>{throw new ContributionError(code,status);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);

/** Construct only after route authentication. Ledger callbacks use the mapped
 * owner, never a client-supplied owner or receipt. Save rechecks current task
 * basis transactionally in the existing immutable contribution aggregate. */
export class NexusHostedService{
 /** @param {any} query @param {any} owner @param {{enabled?:boolean,ledger?:any,now?:()=>number}} options */
 constructor(query,owner,{enabled=false,ledger,now=Date.now}={}){this.enabled=enabled===true;this.ledger=ledger;this.now=now;this.query=query;this.owner=owner;this.store=new NexusProposalStore(query,owner);}
 /** @param {any} rawRef @param {{operationId?:string|null,nodeId?:string|null,jobId?:string|null}} selection */
 async read(rawRef,{operationId=null,nodeId=null,jobId=null}={}){
  const ref=taskRef(rawRef);await this.store.assertTask(ref);
  if(operationId!==null){if(nodeId!==null||jobId!==null)deny('NEXUS_REQUEST_INVALID',400);return {artifact:await this.store.recover(ref,operationId),executionAuthorized:false};}
  if(jobId!==null||nodeId!==null){if(!uuid(nodeId)||!uuid(jobId))deny('NEXUS_REQUEST_INVALID',400);await this.store.assertTask(ref,true);return {transfer:await this.ledger.read(nodeId,jobId,ref),executionAuthorized:false};}
  return {artifacts:await this.store.list(ref),executionAuthorized:false};
 }
 async write(rawRef,body){
  const ref=taskRef(rawRef);await this.store.assertTask(ref);
  if(!body||!uuid(body.nodeId))deny('NEXUS_REQUEST_INVALID',400);
  if(body.action==='catalog'){
   if(!exact(body,['action','nodeId','input']))deny('NEXUS_REQUEST_INVALID',400);
   let input;try{input=validateNexusInput(body.input);}catch{deny('NEXUS_REQUEST_INVALID',400);}
   if(input.action!=='catalog'||canonical(input.taskRef)!==canonical(ref))deny('NEXUS_REQUEST_INVALID',400);
   if(!this.enabled)deny('NEXUS_PROPOSAL_SAVE_DISABLED');await this.store.assertTask(ref,true);
   return {transfer:await this.ledger.enqueue(body.nodeId,input),executionAuthorized:false};
  }
  if(!['verify','save'].includes(body.action)||!exact(body,['action','nodeId','operationId','record'])||!uuid(body.operationId))deny('NEXUS_REQUEST_INVALID',400);
  const record=validateRecord(body.record);
  if(record.kind!=='nexus-proposal'||canonical(record.taskRef)!==canonical(ref))deny('NEXUS_REQUEST_INVALID',400);
  const input=validateNexusInput({schemaVersion:1,operationId:body.operationId,taskRef:ref,action:'verify',proposal:record,snapshotId:null,cursor:null});
  // Completed saves remain recoverable with creation disabled and no worker.
  const existing=await this.store.recover(ref,record.operationId);
  if(existing){if(canonical(existing.record)!==canonical(record))deny('CONTRIBUTION_OPERATION_CONFLICT');return {status:'duplicate',artifact:existing,executionAuthorized:false};}
  if(!this.enabled)deny('NEXUS_PROPOSAL_SAVE_DISABLED');await this.store.assertTask(ref,true);
  if(body.action==='verify')return {transfer:await this.ledger.enqueue(body.nodeId,input),executionAuthorized:false};
  const store=new NexusProposalStore(this.query,this.owner,{enabled:true,verifyReferences:async()=>{
   const transfer=await this.ledger.read(body.nodeId,input.operationId,ref);
   if(!transfer||canonical(transfer.input)!==canonical(input)||transfer.job?.nodeId!==body.nodeId||transfer.job?.jobId!==input.operationId||transfer.job?.capability!==NEXUS)deny('NEXUS_REFERENCES_UNVERIFIED');
   if(transfer.job.state!=='succeeded')deny('NEXUS_VERIFICATION_PENDING');
   let proof;try{proof=await freshNexusReceipt(transfer.job.terminal?.result,input,{now:this.now()});}catch{deny('NEXUS_VERIFICATION_EXPIRED_OR_INVALID');}
   return proof.data;
  }});
  return store.save(record);
 }
}
