// A read-only discovery view. Entries never authorize later execution.
import {NativeTaskError} from './native-task.mjs';
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(ok)=>{if(!ok)throw new NativeTaskError('TASK_CATALOG_INVALID');};
const identifier=v=>typeof v==='string'&&ID.test(v);
const digest=v=>typeof v==='string'&&SHA.test(v);
function clone(value,maxBytes) {
  let nodes=0;
  function check(v,depth=0) {
    need(++nodes<=8192&&depth<=16);
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){need(Number.isSafeInteger(v)&&!Object.is(v,-0));return;}
    if(typeof v==='string'){need(v.isWellFormed());return;}
    need(Array.isArray(v)||object(v));
    for(const [k,item] of Object.entries(v)){check(k,depth+1);check(item,depth+1);}
  }
  check(value);const serialized=JSON.stringify(value);
  need(new TextEncoder().encode(serialized).length<=maxBytes);
  return JSON.parse(serialized);
}
export function validateNativeCatalogRequest(value) {
  need(exact(value,['schemaVersion','taskRef','snapshotId','cursor'])&&value.schemaVersion===1);
  need(object(value.taskRef)&&Object.keys(value.taskRef).every(k=>['taskId','project','checkpointId'].includes(k))
    &&identifier(value.taskRef.taskId)&&identifier(value.taskRef.project)
    &&(!Object.hasOwn(value.taskRef,'checkpointId')||identifier(value.taskRef.checkpointId)));
  need(value.snapshotId===null?value.cursor===null:digest(value.snapshotId));
  need(value.cursor===null||digest(value.cursor));
  return clone(value,1024);
}
export function validateNativeCatalogResult(value,rawRequest) {
  const request=validateNativeCatalogRequest(rawRequest);
  need(exact(value,['ok','schemaVersion','taskRef','snapshotId','entry','nextCursor','observedAt','executionAuthorized'])
    &&value.ok===true&&value.schemaVersion===1&&value.executionAuthorized===false);
  validateNativeCatalogRequest({schemaVersion:1,taskRef:value.taskRef,snapshotId:value.snapshotId,cursor:null});
  need(Object.keys(value.taskRef).length===Object.keys(request.taskRef).length
    &&Object.keys(request.taskRef).every(k=>value.taskRef[k]===request.taskRef[k]));
  need(digest(value.snapshotId)&&(request.snapshotId===null||request.snapshotId===value.snapshotId));
  need(value.nextCursor===null||digest(value.nextCursor)&&value.nextCursor!==request.cursor);
  need(typeof value.observedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value.observedAt)&&Number.isFinite(Date.parse(value.observedAt)));
  if(value.entry===null)need(value.nextCursor===null);
  else {
    const e=value.entry;
    need(exact(e,['specificationId','candidateId','requirementsHash','capability','title','version','effectClass','inputSchema']));
    for(const field of ['specificationId','candidateId','requirementsHash'])need(digest(e[field]));
    need(identifier(e.capability)&&typeof e.title==='string'&&e.title.length>0&&e.title.length<=120
      &&typeof e.version==='string'&&e.version.length>0&&e.version.length<=128&&e.effectClass==='READ_ONLY'
      &&object(e.inputSchema)&&e.inputSchema.type==='object');
  }
  return clone(value,65536);
}
