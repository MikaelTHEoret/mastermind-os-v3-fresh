import {NativeTaskError} from './native-task.mjs';
import {validateNativeCatalogInput} from './native-catalog.mjs';
import {reviewCanonical,MAX_NATIVE_TEST_CASES} from './native-review-contract.mjs';
export const LIFECYCLE='mastermind.native.contribution-lifecycle';
const fields=['schemaVersion','action','taskRef','specificationId','importOperationId','candidateId','operation','lifecycleOperationId','expectedActiveRevision'];
const dataFields=['operationState','moduleId','version','activeRevision','currentlyActive','activeProxyAvailable','recordedOutcome','test','rollbackRevision','rollbackAccepted','holds'];
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=v=>{if(!v)throw new NativeTaskError('TASK_LIFECYCLE_INVALID');};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const same=(a,b)=>reviewCanonical(a)===reviewCanonical(b);
const pick=(v,keys)=>Object.fromEntries(keys.map(k=>[k,v[k]]));
const size=v=>new TextEncoder().encode(JSON.stringify(v)).length;
export function validateLifecycleInput(v){
 need(exact(v,[...fields,'operationId'])&&v.schemaVersion===1&&['inspect','execute','recover'].includes(v.action));
 validateNativeCatalogInput({schemaVersion:1,taskRef:v.taskRef,snapshotId:null,cursor:null});
 need(exact(v.taskRef,['taskId','project'])&&hash(v.specificationId)&&hash(v.candidateId)&&uuid(v.importOperationId)&&uuid(v.operationId)
  &&v.operationId!==v.importOperationId&&(v.expectedActiveRevision===null||hash(v.expectedActiveRevision))&&size(v)<=1536);
 if(v.action==='inspect')need(v.operation===null&&v.lifecycleOperationId===null&&v.expectedActiveRevision===null);
 else need(['test','promote','rollback'].includes(v.operation)&&uuid(v.lifecycleOperationId)
  &&v.lifecycleOperationId!==v.operationId&&v.lifecycleOperationId!==v.importOperationId);
 return structuredClone(v);
}
export function lifecycleLocalRequest(raw,recoverOnly=false){
 const v=validateLifecycleInput(raw);need(typeof recoverOnly==='boolean');
 return {...pick(v,fields),action:recoverOnly&&v.action==='execute'?'recover':v.action};
}
function validateData(d,input){
 need(exact(d,dataFields)&&['inspection','uncertain','running','passed','failed','held','interrupted','completed'].includes(d.operationState)
  &&typeof d.moduleId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(d.moduleId)
  &&typeof d.version==='string'&&d.version.length>0&&d.version.length<=128&&!/[\x00-\x1f]/.test(d.version)
  &&[d.activeRevision,d.rollbackRevision].every(v=>v===null||hash(v))
  &&typeof d.currentlyActive==='boolean'&&d.currentlyActive===(d.activeRevision===input.candidateId)
  &&typeof d.activeProxyAvailable==='boolean'&&(!d.activeProxyAvailable||d.currentlyActive)
  &&typeof d.rollbackAccepted==='boolean'&&(!d.rollbackAccepted||d.rollbackRevision!==null)
  &&[null,'passed','failed'].includes(d.recordedOutcome));
 need(Array.isArray(d.holds)&&d.holds.length<=4&&new Set(d.holds).size===d.holds.length&&d.holds.every(x=>[
  'NATIVE_ACTIVE_PROXY_UNAVAILABLE','NATIVE_TEST_RECONCILIATION_REQUIRED','NATIVE_TEST_FAILED','NATIVE_TEST_OPERATION_NOT_RECORDED','NATIVE_TESTS_NOT_STARTED'].includes(x)));
 if(d.test!==null){const t=d.test;need(exact(t,['operationId','status','caseCount','completedCases','failedCaseId'])&&uuid(t.operationId)
  &&['running','passed','failed','held','interrupted'].includes(t.status)&&Number.isSafeInteger(t.caseCount)&&t.caseCount>=1&&t.caseCount<=MAX_NATIVE_TEST_CASES
  &&Number.isSafeInteger(t.completedCases)&&t.completedCases>=0&&t.completedCases<=t.caseCount
  &&(t.failedCaseId===null||typeof t.failedCaseId==='string'&&t.failedCaseId.length<=120)
  &&(t.status!=='passed'||t.completedCases===t.caseCount&&d.recordedOutcome==='passed'));
  if(input.operation==='test')need(t.operationId===input.lifecycleOperationId);
 }
 if(input.action==='inspect')need(d.operationState==='inspection');
 else if(input.operation==='test')need(d.operationState!=='completed'&&d.operationState!=='inspection'&&(d.test===null?['running','uncertain'].includes(d.operationState):d.operationState===d.test.status));
 else need(['completed','uncertain'].includes(d.operationState));
 return d;
}
export function lifecycleReceipt(result,raw,recoverOnly=false){
 const input=validateLifecycleInput(raw),local=lifecycleLocalRequest(input,recoverOnly);
 need(exact(result,[...fields,'kind','observedAt','executionAuthorized','mayAutomaticallyRerun','historicalSnapshot',...dataFields])
  &&fields.every(k=>same(result[k],local[k]))&&result.kind===LIFECYCLE&&result.executionAuthorized===false
  &&result.mayAutomaticallyRerun===false&&result.historicalSnapshot===true);
 return validateLifecycleReceipt({...input,kind:LIFECYCLE,observedAction:local.action,observedAt:result.observedAt,recoveryOnly:recoverOnly,data:pick(result,dataFields)},input);
}
export function validateLifecycleReceipt(v,raw){
 need(exact(v,[...fields,'operationId','kind','observedAction','observedAt','recoveryOnly','data'])&&v.kind===LIFECYCLE&&typeof v.recoveryOnly==='boolean');
 const input=validateLifecycleInput(pick(v,[...fields,'operationId']));if(raw)need(same(input,validateLifecycleInput(raw)));
 need(v.observedAction===lifecycleLocalRequest(input,v.recoveryOnly).action&&typeof v.observedAt==='string'
  &&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.observedAt)&&Number.isFinite(Date.parse(v.observedAt))&&new Date(v.observedAt).toISOString()===v.observedAt);
 validateData(v.data,input);need(size(v)<=1800&&new TextEncoder().encode(JSON.stringify(v,null,2)).length<=3600);
 return structuredClone(v);
}
export function sameLifecycleDisclosure(current,saved){
 try{validateLifecycleReceipt(saved);validateLifecycleReceipt(current,pick(saved,[...fields,'operationId']));
  if(!current.recoveryOnly||current.data.moduleId!==saved.data.moduleId||current.data.version!==saved.data.version
   ||current.data.rollbackRevision!==saved.data.rollbackRevision)return false;
  if(saved.action!=='inspect'){
   if(['completed','passed','failed'].includes(saved.data.operationState)&&current.data.operationState!==saved.data.operationState)return false;
   if(saved.data.test){const a=current.data.test,b=saved.data.test;
    if(!a||a.operationId!==b.operationId||a.caseCount!==b.caseCount||a.completedCases<b.completedCases)return false;
   }
  }
  return true;
 }catch{return false;}
}
