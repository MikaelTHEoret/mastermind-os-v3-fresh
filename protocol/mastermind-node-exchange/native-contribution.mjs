// Prepared transport only; this module does not register or advertise a worker.
import {NativeTaskError} from './native-task.mjs';
import {validateNativeCatalogInput} from './native-catalog.mjs';
import {reviewCanonical} from './native-review-contract.mjs';

export const CONTRIBUTION='mastermind.native.contribution';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(ok,code='TASK_CONTRIBUTION_INVALID')=>{if(!ok)throw new NativeTaskError(code);};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const commit=v=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const same=(a,b)=>reviewCanonical(a)===reviewCanonical(b);
const pick=(v,keys)=>Object.fromEntries(keys.map(k=>[k,v[k]]));
const base=['schemaVersion','action','taskRef','operationId','specificationId','importOperationId','snapshotId','cursor'];
const localBase=['schemaVersion','action','taskRef','specificationId','importOperationId'];
const common=['kind','observedAt','executionAuthorized','mayAutomaticallyRerun','historicalSnapshot'];
const recordKeys=['assignmentId','responseId','reviewId'];
const records=v=>exact(v,recordKeys)&&recordKeys.every(k=>hash(v[k]));
const moduleId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(v);
const version=v=>typeof v==='string'&&v.length>=1&&v.length<=128&&v.isWellFormed()&&!/[\x00-\x1f]/.test(v);
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const held=['CONTRIBUTION_CANDIDATE_NOT_STAGED'];
const packetHeld=['CONTRIBUTION_PACKET_NOT_PREPARED'];

export function validateContributionInput(v){
 need(exact(v,base)&&v.schemaVersion===1&&['catalog','prepare','stage','recover'].includes(v.action)
  &&uuid(v.operationId)&&hash(v.specificationId)&&exact(v.taskRef,['taskId','project'])&&bytes(v)<=1024);
 validateNativeCatalogInput({schemaVersion:1,taskRef:v.taskRef,snapshotId:null,cursor:null});
 if(v.action==='catalog')need(v.importOperationId===null&&(v.snapshotId===null?v.cursor===null:hash(v.snapshotId)&&(v.cursor===null||uuid(v.cursor))));
 else need(uuid(v.importOperationId)&&v.importOperationId!==v.operationId&&v.snapshotId===null&&v.cursor===null);
 return structuredClone(v);
}

export function contributionLocalRequest(input,recoverOnly=false){
 const v=validateContributionInput(input);need(typeof recoverOnly==='boolean');
 return {...pick(v,localBase),action:recoverOnly&&v.action==='stage'?'recover':v.action};
}

function choice(v,withRecords){
 const keys=['importOperationId','packetId','moduleId','version','packetAvailable','holds','sourceAndAuthorityVerifiedNow'];
 need(exact(v,withRecords?[...keys,'recordIds']:keys)&&uuid(v.importOperationId)&&hash(v.packetId)
  &&typeof v.packetAvailable==='boolean'&&v.sourceAndAuthorityVerifiedNow===false);
 if(withRecords)need(records(v.recordIds));
 need(v.packetAvailable?moduleId(v.moduleId)&&version(v.version)&&same(v.holds,[]):
  v.moduleId===null&&v.version===null&&same(v.holds,packetHeld));
 return pick(v,keys);
}

const stageFields=['ok','schemaVersion','operationId','specificationId','phase','candidateId','moduleId','version',
 'sourceCommit','sourceSha256','requirementsHash','testSpecHash','recordIds','currentActiveRevision','candidateStaged',
 'replayed','holds','behavioralTests','executionAuthorized','activationPerformed','currentlyActive'];
const dataFields=['phase','candidateId','sourceCommit','sourceSha256','recordIds','currentActiveRevision','replayed'];
function stageResult(v,local){
 need(exact(v,stageFields)&&v.ok===true&&v.schemaVersion===1&&v.operationId===local.importOperationId
  &&v.specificationId===local.specificationId&&moduleId(v.moduleId)&&version(v.version)
  &&hash(v.requirementsHash)&&hash(v.testSpecHash)&&typeof v.candidateStaged==='boolean'
  &&v.behavioralTests==='separate-native-workflow'&&v.executionAuthorized===false&&v.activationPerformed===false
  &&typeof v.currentlyActive==='boolean'&&v.currentlyActive===(v.currentActiveRevision===v.candidateId)
  &&v.candidateStaged===(v.phase==='staged')&&same(v.holds,v.candidateStaged?[]:held));
 const data=pick(v,dataFields);validateStageData(data,local.action);return data;
}
function validateStageData(v,action){
 need(exact(v,dataFields)&&['preview','prepared','staged'].includes(v.phase)&&hash(v.candidateId)
  &&commit(v.sourceCommit)&&hash(v.sourceSha256)&&records(v.recordIds)
  &&(v.currentActiveRevision===null||hash(v.currentActiveRevision))&&typeof v.replayed==='boolean'
  &&(v.phase!=='preview'||action==='prepare'&&!v.replayed)
  &&(action!=='stage'||v.phase==='staged')&&(action!=='recover'||v.replayed));
}

async function digest(value){
 const data=new TextEncoder().encode(reviewCanonical(value));
 return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export async function contributionReceipt(result,input,recoverOnly=false){
 const request=validateContributionInput(input),local=contributionLocalRequest(request,recoverOnly);
 need(exact(result,[...localBase,...common,request.action==='catalog'?'choices':'result'])&&bytes(result)<=8192
  &&localBase.every(k=>same(local[k],result[k]))&&result.kind===CONTRIBUTION&&timestamp(result.observedAt)
  &&result.executionAuthorized===false&&result.mayAutomaticallyRerun===false&&result.historicalSnapshot===true);
 let data;
 if(request.action==='catalog'){
  need(Array.isArray(result.choices)&&result.choices.length<=8);
  result.choices.forEach(v=>choice(v,true));
  const choices=structuredClone(result.choices).sort((a,b)=>a.importOperationId<b.importOperationId?-1:a.importOperationId>b.importOperationId?1:0);
  need(new Set(choices.map(v=>v.importOperationId)).size===choices.length);
  const snapshotId=await digest({taskRef:local.taskRef,specificationId:local.specificationId,choices});
  need(request.snapshotId===null||request.snapshotId===snapshotId,'TASK_CONTRIBUTION_CATALOG_CHANGED');
  const previous=request.cursor===null?-1:choices.findIndex(v=>v.importOperationId===request.cursor);
  need(request.cursor===null||previous>=0,'TASK_CONTRIBUTION_CURSOR_INVALID');
  const selected=choices[previous+1]??null;
  data={snapshotId,choice:selected?choice(selected,true):null,
   nextCursor:selected&&previous+2<choices.length?selected.importOperationId:null};
 }else data=stageResult(result.result,local);
 return validateContributionReceipt({...request,kind:CONTRIBUTION,observedAction:local.action,
  recoveryOnly:recoverOnly,observedAt:result.observedAt,executionAuthorized:false,data},request);
}

export function validateContributionReceipt(v,input){
 need(exact(v,[...base,'kind','observedAction','recoveryOnly','observedAt','executionAuthorized','data'])
  &&v.kind===CONTRIBUTION&&typeof v.recoveryOnly==='boolean'&&timestamp(v.observedAt)&&v.executionAuthorized===false);
 const request=validateContributionInput(pick(v,base));
 if(input)need(same(request,validateContributionInput(input)));
 need(v.observedAction===contributionLocalRequest(request,v.recoveryOnly).action);
 if(v.action==='catalog'){
  need(exact(v.data,['snapshotId','choice','nextCursor'])&&hash(v.data.snapshotId)
   &&(v.snapshotId===null||v.snapshotId===v.data.snapshotId)
   &&(v.data.nextCursor===null||uuid(v.data.nextCursor)&&v.data.nextCursor!==v.cursor));
  if(v.data.choice===null)need(v.data.nextCursor===null);
  else {choice(v.data.choice,false);need(v.data.choice.importOperationId!==v.cursor
   &&(v.data.nextCursor===null||v.data.nextCursor===v.data.choice.importOperationId));}
 }else validateStageData(v.data,v.observedAction);
 need(bytes(v)<=1450&&new TextEncoder().encode(JSON.stringify(v,null,2)).length<=2900,'TASK_CONTRIBUTION_RECEIPT_LIMIT');
 return structuredClone(v);
}

// Only refresh an already saved receipt after current ownership/source checks.
// A newer staged state may verify an older prepared/preview observation, but
// immutable identity cannot change and progress cannot move backwards.
export function sameContributionDisclosure(current,saved){
 try{
  validateContributionReceipt(saved);validateContributionReceipt(current,pick(saved,base));
  if(!current.recoveryOnly)return false;
  if(saved.action==='catalog')return same(current.data,saved.data);
  const {phase:a,replayed:ar,currentActiveRevision:aa,...identityA}=current.data;
  const {phase:b,replayed:br,currentActiveRevision:ba,...identityB}=saved.data;
  return same(identityA,identityB)&&['preview','prepared','staged'].indexOf(a)>=['preview','prepared','staged'].indexOf(b);
 }catch{return false;}
}
