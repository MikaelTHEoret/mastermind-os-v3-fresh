import {NativeTaskError} from './native-task.mjs';
import {validateNativeCatalogInput} from './native-catalog.mjs';
import {reviewCanonical,MAX_NATIVE_TEST_CASES} from './native-review-contract.mjs';
export const REVIEW_REUSE='mastermind.native.review-reuse';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=ok=>{if(!ok)throw new NativeTaskError('TASK_REVIEW_REUSE_INVALID');};
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=25;
export const disposition=field=>field==='tests'?'retain-full-suite-and-add-evidence':['authority','acceptanceWorkflow','examples'].includes(field)?'retain-accepted-baseline':null;
export function validateReviewReuseInput(v){
 need(exact(v,['schemaVersion','action','taskRef','operationId','parentOperationId','specificationId','reviewId','acceptedSpecificationId','qualificationId','decisions'])
  &&v.schemaVersion===1&&['assess','accept'].includes(v.action)&&typeof v.operationId==='string'&&UUID.test(v.operationId)&&typeof v.parentOperationId==='string'&&UUID.test(v.parentOperationId)
  &&v.operationId!==v.parentOperationId&&[v.specificationId,v.reviewId].every(x=>typeof x==='string'&&SHA.test(x))&&bytes(v)<=2048);
 validateNativeCatalogInput({schemaVersion:1,taskRef:v.taskRef,snapshotId:null,cursor:null});
 need(Array.isArray(v.decisions));
 if(v.action==='assess')need(v.acceptedSpecificationId===null&&v.qualificationId===null&&v.decisions.length===0);
 else {need([v.acceptedSpecificationId,v.qualificationId].every(x=>typeof x==='string'&&SHA.test(x))&&v.decisions.length<=4);
  need(v.decisions.every(x=>exact(x,['field','disposition'])&&disposition(x.field)!==null&&x.disposition===disposition(x.field))
   &&new Set(v.decisions.map(x=>x.field)).size===v.decisions.length);}
 return structuredClone(v);
}
export function validateReviewReuseReceipt(v,input){
 const common=['kind','schemaVersion','action','taskRef','operationId','specificationId','reviewId','acceptedSpecificationId','qualificationId','candidateId','replayed','executionAuthorized'];
 need(obj(v)&&exact(v,[...common,...(v.action==='assess'?['differences','holds','exampleCount','coveredCount','suiteCaseCount','existingOperationId','existingLinkId']:['linkId','reuseLinkAccepted','reviewAccepted'])])
  &&v.kind===REVIEW_REUSE&&v.schemaVersion===1&&['assess','accept'].includes(v.action)&&typeof v.operationId==='string'&&UUID.test(v.operationId)
  &&[v.specificationId,v.reviewId,v.acceptedSpecificationId,v.qualificationId,v.candidateId].every(x=>typeof x==='string'&&SHA.test(x))
  &&typeof v.replayed==='boolean'&&v.executionAuthorized===false&&bytes(v)<=1450
  &&new TextEncoder().encode(JSON.stringify(v,null,2)).length<=2900);
 validateNativeCatalogInput({schemaVersion:1,taskRef:v.taskRef,snapshotId:null,cursor:null});
 if(v.action==='assess'){
  need(Array.isArray(v.differences)&&v.differences.length<=8&&v.differences.every(x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(x))&&new Set(v.differences).size===v.differences.length);
  need(Array.isArray(v.holds)&&v.holds.length<=4&&v.holds.every(x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{1,95}$/.test(x)));
  need([v.exampleCount,v.coveredCount].every(count)&&Number.isSafeInteger(v.suiteCaseCount)&&v.suiteCaseCount>=0&&v.suiteCaseCount<=MAX_NATIVE_TEST_CASES&&v.exampleCount>=1&&v.coveredCount<=v.exampleCount
   &&(v.holds.length!==0||v.coveredCount===v.exampleCount&&v.differences.every(f=>disposition(f)!==null)));
  need(v.existingOperationId===null&&v.existingLinkId===null||typeof v.existingOperationId==='string'&&UUID.test(v.existingOperationId)&&typeof v.existingLinkId==='string'&&SHA.test(v.existingLinkId));
 } else need(v.reuseLinkAccepted===true&&v.reviewAccepted===false&&typeof v.linkId==='string'&&SHA.test(v.linkId));
 if(input){const i=validateReviewReuseInput(input);need(i.operationId===v.operationId&&i.action===v.action&&i.specificationId===v.specificationId&&i.reviewId===v.reviewId&&reviewCanonical(i.taskRef)===reviewCanonical(v.taskRef));
  if(i.action==='accept')need(i.acceptedSpecificationId===v.acceptedSpecificationId&&i.qualificationId===v.qualificationId);}
 return structuredClone(v);
}
