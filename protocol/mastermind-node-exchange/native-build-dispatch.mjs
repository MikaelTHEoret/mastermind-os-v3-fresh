// Source-only coding transport. Defining a contract does not advertise it.
import {NativeTaskError} from './native-task.mjs';
import {validateNativeCatalogInput} from './native-catalog.mjs';
import {reviewCanonical} from './native-review-contract.mjs';

export const BUILD_DISPATCH='mastermind.native.review-build-dispatch';
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=ok=>{if(!ok)throw new NativeTaskError('TASK_BUILD_DISPATCH_INVALID');};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const base=['schemaVersion','action','taskRef','operationId','parentOperationId','artifactOperationId','buildOperationId','specificationId','reviewId','planId'];
const localBase=base.filter(k=>!['operationId','parentOperationId'].includes(k));
const summary=['ok','state','holds','candidateId','sourceReady','replayed','startAccepted','historicalSnapshot','mayAutomaticallyRerun','executionAuthorized'];
const states=['prepared','started','held','awaiting_independent_tests','ready_for_separate_dispatch'];

export function validateBuildDispatchInput(v){
 need(exact(v,base)&&v.schemaVersion===1&&['preflight','start','status','recover'].includes(v.action)
  &&['operationId','parentOperationId','artifactOperationId','buildOperationId'].every(k=>uuid(v[k]))
  &&new Set(['operationId','parentOperationId','artifactOperationId','buildOperationId'].map(k=>v[k])).size===4
  &&['specificationId','reviewId','planId'].every(k=>hash(v[k]))&&exact(v.taskRef,['taskId','project'])&&bytes(v)<=2048);
 validateNativeCatalogInput({schemaVersion:1,taskRef:v.taskRef,snapshotId:null,cursor:null});
 return structuredClone(v);
}

export function buildDispatchLocalRequest(input,recoverOnly=false){
 const v=validateBuildDispatchInput(input);
 need(typeof recoverOnly==='boolean');
 // Preflight/status are already read-only. A lost start can only reconcile.
 return {...Object.fromEntries(localBase.map(k=>[k,v[k]])),
  action:recoverOnly&&v.action==='start'?'recover':v.action};
}

function validSummary(v,action){
 need(typeof v.ok==='boolean'&&states.includes(v.state)&&Array.isArray(v.holds)&&v.holds.length<=16
  &&new Set(v.holds).size===v.holds.length&&v.holds.every(x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{1,95}$/.test(x))
  &&(v.candidateId===null||hash(v.candidateId))&&typeof v.sourceReady==='boolean'
  &&typeof v.replayed==='boolean'&&typeof v.startAccepted==='boolean'
  &&v.historicalSnapshot===true&&v.mayAutomaticallyRerun===false&&v.executionAuthorized===false
  &&(!v.startAccepted||action==='start'&&v.ok&&!v.replayed)
  &&(!v.sourceReady||v.state==='awaiting_independent_tests')
  &&(action!=='preflight'||!v.startAccepted&&!v.sourceReady));
}

export function buildDispatchReceipt(result,input,recoverOnly=false){
 const v=validateBuildDispatchInput(input),local=buildDispatchLocalRequest(v,recoverOnly);
 need(exact(result,[...localBase,...summary])&&bytes(result)<=8192);
 for(const key of localBase)need(reviewCanonical(result[key])===reviewCanonical(local[key]));
 validSummary(result,local.action);
 const receipt={...v,kind:BUILD_DISPATCH,observedAction:local.action,recoveryOnly:recoverOnly,
  ...Object.fromEntries(summary.map(k=>[k,result[k]]))};
 return validateBuildDispatchReceipt(receipt,v);
}

export function validateBuildDispatchReceipt(v,input){
 need(exact(v,[...base,...summary,'kind','observedAction','recoveryOnly'])&&v.kind===BUILD_DISPATCH&&typeof v.recoveryOnly==='boolean');
 const request=validateBuildDispatchInput(Object.fromEntries(base.map(k=>[k,v[k]])));
 if(input)need(reviewCanonical(request)===reviewCanonical(validateBuildDispatchInput(input)));
 const local=buildDispatchLocalRequest(request,v.recoveryOnly);
 need(v.observedAction===local.action&&bytes(v)<=2400&&new TextEncoder().encode(JSON.stringify(v,null,2)).length<=3800);
 validSummary(v,v.observedAction);
 return structuredClone(v);
}
