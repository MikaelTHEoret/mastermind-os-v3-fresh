// Typed transport only. Publication authority and coding configuration stay local.
import {NativeTaskError} from './native-task.mjs';
import {validateNativeCatalogInput} from './native-catalog.mjs';
import {reviewCanonical} from './native-review-contract.mjs';
export const REVIEW_ARTIFACTS='mastermind.native.review-artifacts';
export const REVIEW_BUILD_PLAN='mastermind.native.review-build-plan';
export const DEVELOPMENT_CAPABILITIES=Object.freeze([REVIEW_ARTIFACTS,REVIEW_BUILD_PLAN]);
const SHA=/^[a-f0-9]{64}$/, UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=ok=>{if(!ok)throw new NativeTaskError('TASK_DEVELOPMENT_INVALID');};
const hash=v=>typeof v==='string'&&SHA.test(v);
const uuid=v=>typeof v==='string'&&UUID.test(v);
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const base=['schemaVersion','action','taskRef','operationId','parentOperationId','artifactOperationId','specificationId','reviewId'];
const holds=v=>Array.isArray(v)&&v.length<=16&&new Set(v).size===v.length&&v.every(x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{1,95}$/.test(x));
export function validateDevelopmentInput(kind,v){
 need(DEVELOPMENT_CAPABILITIES.includes(kind)&&exact(v,[...base,...(kind===REVIEW_BUILD_PLAN?['buildOperationId']:[])])
  &&v.schemaVersion===1&&uuid(v.operationId)&&uuid(v.artifactOperationId)&&uuid(v.parentOperationId)
  &&new Set([v.operationId,v.artifactOperationId,v.parentOperationId]).size===3&&exact(v.taskRef,['taskId','project'])
  &&hash(v.specificationId)&&hash(v.reviewId)&&bytes(v)<=2048);
 validateNativeCatalogInput({schemaVersion:1,taskRef:v.taskRef,snapshotId:null,cursor:null});
 if(kind===REVIEW_BUILD_PLAN)need(['prepare','recover'].includes(v.action)&&uuid(v.buildOperationId)
  &&new Set([v.operationId,v.artifactOperationId,v.buildOperationId,v.parentOperationId]).size===4);
 else need(['prepare','recover','publish','reconcile','resume'].includes(v.action));
 return structuredClone(v);
}
export function developmentLocalRequest(kind,input,recoverOnly=false){
 const v=validateDevelopmentInput(kind,input);
 return {schemaVersion:1,action:recoverOnly?'recover':v.action,taskRef:v.taskRef,
  specificationId:v.specificationId,reviewId:v.reviewId,
  operationId:kind===REVIEW_ARTIFACTS?v.artifactOperationId:v.buildOperationId,
  ...(kind===REVIEW_BUILD_PLAN?{artifactOperationId:v.artifactOperationId}:{})};
}
export function validateDevelopmentReceipt(v,input){
 need(obj(v)&&DEVELOPMENT_CAPABILITIES.includes(v.kind));
 const artifact=v.kind===REVIEW_ARTIFACTS;
 const fields=artifact?['artifactState','bindingSha256','commit','fileCount','requirementsHash','testSpecHash',
  'gitVerified','gitVerifiedAt','historicalSnapshot','holds','mayAutomaticallyRerun','candidateAcceptance']:
  ['buildOperationId','requestHash','planId','state','holds','current','historicalSnapshot','decision','moduleId',
   'requirementsHash','jobState','candidateId','hasSourceReceipt','workerInvoked'];
 need(exact(v,[...base,'kind','replayed','executionAuthorized',...fields])&&v.executionAuthorized===false&&typeof v.replayed==='boolean'
  &&typeof v.historicalSnapshot==='boolean'&&holds(v.holds)&&bytes(v)<=1450
  &&new TextEncoder().encode(JSON.stringify(v,null,2)).length<=2900);
 const request=Object.fromEntries([...base,...(!artifact?['buildOperationId']:[])].map(k=>[k,v[k]]));
 validateDevelopmentInput(v.kind,request);
 if(input)need(reviewCanonical(validateDevelopmentInput(v.kind,input))===reviewCanonical(request));
 if(artifact){
  need(['proposed','prepared','published'].includes(v.artifactState)&&hash(v.bindingSha256)
   &&typeof v.commit==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v.commit)
   &&Number.isSafeInteger(v.fileCount)&&v.fileCount>=1&&v.fileCount<=64&&hash(v.requirementsHash)&&hash(v.testSpecHash)
   &&typeof v.gitVerified==='boolean'&&v.historicalSnapshot===!v.gitVerified
   &&(v.gitVerified?typeof v.gitVerifiedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.gitVerifiedAt)
      &&Number.isFinite(Date.parse(v.gitVerifiedAt))&&new Date(v.gitVerifiedAt).toISOString()===v.gitVerifiedAt:v.gitVerifiedAt===null)
   &&(!v.gitVerified||v.artifactState==='published'&&v.holds.length===0)
   &&v.mayAutomaticallyRerun===false&&v.candidateAcceptance==='not-run');
 }else{
  need(hash(v.requestHash)&&hash(v.planId)&&hash(v.requirementsHash)&&typeof v.current==='boolean'
   &&['held','awaiting_coding_authority'].includes(v.state)&&['create','extend'].includes(v.decision)
   &&typeof v.moduleId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(v.moduleId)
   &&(v.jobState===null||typeof v.jobState==='string'&&/^[a-z_]{1,48}$/.test(v.jobState))
   &&(v.candidateId===null||hash(v.candidateId))&&typeof v.hasSourceReceipt==='boolean'&&v.workerInvoked===false
   &&(v.current||v.state==='held')&&(v.state!=='awaiting_coding_authority'||v.current&&v.holds.length===0));
 }
 return structuredClone(v);
}
