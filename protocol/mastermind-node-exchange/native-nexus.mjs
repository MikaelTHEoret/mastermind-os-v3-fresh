import {NativeTaskError} from './native-task.mjs';
import {reviewCanonical} from './native-review-contract.mjs';
import {validNexusProposal,validNativeNode,choiceId} from './nexus-proposal-record.mjs';
export const NEXUS='mastermind.native.nexus';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const revision=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(v);
const bytes=v=>new TextEncoder().encode(reviewCanonical(v)).length;
const same=(a,b)=>reviewCanonical(a)===reviewCanonical(b);
const need=(ok,code='TASK_NEXUS_INVALID')=>{if(!ok)throw new NativeTaskError(code);};
const ref=v=>exact(v,['taskId','project'])&&uuid(v.taskId)&&typeof v.project==='string'&&/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(v.project);
export function validNexusBasis(v){return exact(v,['checkpointId','revision','permissionRevision','permissionScopeSha256'])&&uuid(v.checkpointId)&&revision(v.revision)&&revision(v.permissionRevision)&&sha(v.permissionScopeSha256);}
export function validNativeChoice(c){
 if(!exact(c,['kind','specificationId','recoveryId','candidateId','importOperationId','observationSha256','title','sourceRefs','recovery']))return false;
 const {title,sourceRefs,recovery,...link}=c;
 if(!validNativeNode({...link,dependsOn:[]})||typeof title!=='string'||!title.trim()||!title.isWellFormed()||new TextEncoder().encode(title).length>480||/[\x00-\x1f\x7f]/.test(title)
  ||!Array.isArray(sourceRefs)||sourceRefs.length!==2||sourceRefs[0]!==`mastermind/native-candidate/${c.candidateId}`||sourceRefs[1]!==`mastermind/native-observation/${c.observationSha256}`)return false;
 const booleans=['sourceVerifiedNow','recordedAccepted','hostReceiptsVerifiedNow','currentlyActive','activeProxyAvailable'];
 return exact(recovery,['moduleId','version','sourceState',...booleans,'recordedTestOutcome','activeRevision','holds','continuation'])
  &&typeof recovery.moduleId==='string'&&recovery.moduleId.length<=160&&typeof recovery.version==='string'&&recovery.version.length<=80
  &&['import_prepared','candidate_recorded_import_unreconciled','candidate_recorded'].includes(recovery.sourceState)
  &&booleans.every(k=>typeof recovery[k]==='boolean')&&(recovery.activeRevision===null||sha(recovery.activeRevision))
  &&(recovery.recordedTestOutcome===null||['passed','failed','running','interrupted','held','uncertain','not_started'].includes(recovery.recordedTestOutcome))
  &&Array.isArray(recovery.holds)&&recovery.holds.length<=24&&recovery.holds.every(s=>typeof s==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(s))
  &&['recover_existing_import','inspect_existing_candidate'].includes(recovery.continuation)
  &&(!recovery.hostReceiptsVerifiedNow||recovery.recordedAccepted)&&(!recovery.activeProxyAvailable||recovery.currentlyActive)
  &&(!recovery.currentlyActive||recovery.activeRevision===c.candidateId);
}
const INPUT=['schemaVersion','operationId','taskRef','action','proposal','snapshotId','cursor'];
export function validateNexusInput(v){
 need(exact(v,INPUT)&&[1,2].includes(v.schemaVersion)&&uuid(v.operationId)&&ref(v.taskRef)&&['catalog','verify'].includes(v.action)&&bytes(v)<=16384);
 need(v.schemaVersion!==2||v.action==='catalog');
 if(v.action==='catalog')need(v.proposal===null&&(v.snapshotId===null?v.cursor===null:sha(v.snapshotId)&&(v.cursor===null||sha(v.cursor))));
 else need(v.snapshotId===null&&v.cursor===null&&validNexusProposal(v.proposal,['schemaVersion','kind','operationId','taskRef'])&&same(v.taskRef,v.proposal.taskRef)&&v.operationId!==v.proposal.operationId);
 return structuredClone(v);
}
export async function nexusDigest(v){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(reviewCanonical(v))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function validateNexusReceipt(v,input){
 need(exact(v,['schemaVersion','kind','operationId','taskRef','action','requestSha256','observedAt','executionAuthorized','data'])&&[1,2].includes(v.schemaVersion)&&v.kind===NEXUS&&uuid(v.operationId)&&ref(v.taskRef)
  &&['catalog','verify'].includes(v.action)&&sha(v.requestSha256)&&typeof v.observedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.observedAt)&&Number.isFinite(Date.parse(v.observedAt))&&new Date(v.observedAt).toISOString()===v.observedAt&&v.executionAuthorized===false&&bytes(v)<=3072);
 need(v.schemaVersion!==2||v.action==='catalog');
 if(input){const r=validateNexusInput(input);need(v.schemaVersion===r.schemaVersion&&v.operationId===r.operationId&&v.action===r.action&&same(v.taskRef,r.taskRef));}
 const d=v.data;
 if(v.action==='verify')need(exact(d,['verified','proposalSha256'])&&d.verified===true&&sha(d.proposalSha256));
 else {
  need(exact(d,['basis','snapshotId','choice','nextCursor'])&&validNexusBasis(d.basis)&&sha(d.snapshotId)&&(d.nextCursor===null||sha(d.nextCursor)));
  const c=d.choice;
  if(c===null)need(d.nextCursor===null);
  else if(c.kind==='native-candidate-v1')need(v.schemaVersion===2&&validNativeChoice(c)&&(d.nextCursor===null||d.nextCursor===c.recoveryId));
  else need(exact(c,['specificationId','planId','title','sourceRefs','taskRevision','historicalSnapshot'])&&sha(c.specificationId)&&sha(c.planId)
   &&typeof c.title==='string'&&c.title.trim().length>0&&c.title.isWellFormed()&&new TextEncoder().encode(c.title).length<=480&&!/[\x00-\x1f\x7f]/.test(c.title)
   &&Array.isArray(c.sourceRefs)&&c.sourceRefs.length===2&&c.sourceRefs[0]===`mastermind/build-plan/${c.planId}`&&/^mastermind\/source-evidence\/[a-f0-9]{64}$/.test(c.sourceRefs[1])
   &&revision(c.taskRevision)&&c.historicalSnapshot===true&&(d.nextCursor===null||d.nextCursor===c.planId));
  if(input){need(input.snapshotId===null||input.snapshotId===d.snapshotId,'TASK_NEXUS_SNAPSHOT_CHANGED');need(c===null||choiceId(c)!==input.cursor);}
 }
 return structuredClone(v);
}
export async function nexusReceipt(raw,input){
 const r=validateNexusInput(input),result=validateNexusReceipt(raw,r);
 need(result.requestSha256===await nexusDigest(r));
 if(r.action==='verify')need(result.data.proposalSha256===await nexusDigest(r.proposal));
 return result;
}
// Server-side consumer of a result recovered through the authenticated ledger.
// Never call this with a browser-supplied receipt as a substitute for that read.
export async function freshNexusReceipt(raw,input,{now=Date.now(),maxAgeMs=60000}={}){
 need(Number.isFinite(now)&&Number.isSafeInteger(maxAgeMs)&&maxAgeMs>0&&maxAgeMs<=60000);
 const result=await nexusReceipt(raw,input),age=now-Date.parse(result.observedAt);
 need(age>=-5000&&age<=maxAgeMs,'TASK_NEXUS_OBSERVATION_EXPIRED');return result;
}
export function sameNexusDisclosure(current,saved){
 try{validateNexusReceipt(current);validateNexusReceipt(saved);const {observedAt:a,...x}=current,{observedAt:b,...y}=saved;return same(x,y);}catch{return false;}
}
