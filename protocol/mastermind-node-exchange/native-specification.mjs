// Local Wizard broker contract. This does not advertise a hosted job capability.
import {NativeTaskError} from './native-task.mjs';
import {validateNativeCatalogRequest} from './native-catalog.mjs';
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=ok=>{if(!ok)throw new NativeTaskError('TASK_SPECIFICATION_INVALID');};
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const text=(v,max)=>typeof v==='string'&&v.isWellFormed()&&[...v].length>0&&[...v].length<=max;

export function validateNativeSpecificationRequest(value) {
  need(exact(value,['schemaVersion','action','taskRef','operationId','request','recipeId'])&&value.schemaVersion===1
    &&['prepare','recover'].includes(value.action));
  validateNativeCatalogRequest({schemaVersion:1,taskRef:value.taskRef,snapshotId:null,cursor:null});
  need(typeof value.operationId==='string'&&UUID.test(value.operationId));
  need(text(value.request,4000)&&value.request===value.request.trim()&&!/[\x00-\x08\x0b-\x1f]/.test(value.request));
  need(value.recipeId===null||typeof value.recipeId==='string'&&ID.test(value.recipeId));
  need(bytes(value)<=8192);
  return structuredClone(value);
}

export function specificationBindingCanonical(raw) {
  const {action,...binding}=validateNativeSpecificationRequest(raw);
  const sorted=v=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
  return JSON.stringify(sorted(binding));
}

export function validateNativeSpecificationResult(value,raw,requestHash) {
  const request=validateNativeSpecificationRequest(raw);
  need(typeof requestHash==='string'&&SHA.test(requestHash));
  need(exact(value,['ok','schemaVersion','taskRef','operationId','requestHash','specification','savedAt','replayed','executionAuthorized'])
    &&value.ok===true&&value.schemaVersion===1&&value.executionAuthorized===false);
  need(object(value.taskRef)&&Object.keys(value.taskRef).length===Object.keys(request.taskRef).length
    &&Object.keys(request.taskRef).every(k=>value.taskRef[k]===request.taskRef[k]));
  need(value.operationId===request.operationId&&value.requestHash===requestHash&&typeof value.replayed==='boolean'
    &&(request.action!=='recover'||value.replayed===true));
  need(typeof value.savedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value.savedAt)
    &&Number.isFinite(Date.parse(value.savedAt)));
  const s=value.specification;
  need(exact(s,['specificationId','title','decision','stage','requirementsHash','missingCount'])
    &&typeof s.specificationId==='string'&&SHA.test(s.specificationId)&&text(s.title,80)
    &&['reuse','extend','assimilate','create','inspect_existing'].includes(s.decision)
    &&['needs_specification','specified','reuse_available'].includes(s.stage)
    &&(s.requirementsHash===null||typeof s.requirementsHash==='string'&&SHA.test(s.requirementsHash))
    &&Number.isSafeInteger(s.missingCount)&&s.missingCount>=0&&s.missingCount<=100);
  need(s.stage==='needs_specification'?s.requirementsHash===null&&s.missingCount>0:s.requirementsHash!==null&&s.missingCount===0);
  need(s.stage!=='reuse_available'||s.decision==='reuse');
  need(bytes(value)<=2048);
  return structuredClone(value);
}
