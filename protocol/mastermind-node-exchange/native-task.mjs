const byteLength=value=>new TextEncoder().encode(value).length;
const FIELDS = ['schemaVersion','action','taskRef','specificationId','operationId','capability',
  'candidateId','requirementsHash','inputSha256','arguments'];
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => object(value) && Object.keys(value).length === fields.length
  && fields.every(key => Object.hasOwn(value, key));
export class NativeTaskError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'NativeTaskError'; }
}
const need = (condition, code = 'TASK_INPUT_INVALID') => { if (!condition) throw new NativeTaskError(code); };

export function validateNativeTaskRequest(value) {
  need(exact(value, FIELDS) && value.schemaVersion === 1 && ['execute','recover'].includes(value.action));
  need(object(value.taskRef) && Object.keys(value.taskRef).every(k => ['taskId','project','checkpointId'].includes(k))
    && ['taskId','project'].every(k => typeof value.taskRef[k] === 'string' && ID.test(value.taskRef[k]))
    && (!Object.hasOwn(value.taskRef,'checkpointId') || typeof value.taskRef.checkpointId === 'string' && ID.test(value.taskRef.checkpointId)));
  for (const field of ['specificationId','candidateId','requirementsHash','inputSha256']) need(typeof value[field] === 'string' && SHA.test(value[field]));
  need(typeof value.operationId === 'string' && value.operationId.length <= 96 && ID.test(value.operationId)
    && typeof value.capability === 'string' && ID.test(value.capability));
  need(object(value.arguments) && Object.keys(value.arguments).every(k => !k.startsWith('_mastermind_')));
  let count = 0;
  const json = (item, depth = 0) => {
    need(++count <= 8192 && depth <= 16);
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { need(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item)); return; }
    if (typeof item === 'number') { need(Number.isSafeInteger(item) && !Object.is(item, -0)); return; }
    need(Array.isArray(item) || object(item));
    for (const [key, child] of Object.entries(item)) { if (!Array.isArray(item)) json(key,depth+1); json(child,depth+1); }
  };
  json(value);
  const bytes = JSON.stringify(value);
  need(byteLength(bytes) <= 65536);
  return JSON.parse(bytes);
}


export const NATIVE_REUSE_CAPABILITY = 'mastermind.native.reuse';
export function validateNativeCommandInput(value) {
  const request=validateNativeTaskRequest(value);
  need(byteLength(JSON.stringify(request))<=4096
    && byteLength(JSON.stringify(request,null,2))<=3072);
  need(request.action==='execute');
  need(UUID.test(request.operationId) && UUID.test(request.taskRef.taskId)
    && (!request.taskRef.checkpointId || UUID.test(request.taskRef.checkpointId))
    && /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(request.taskRef.project)
    && /^[a-z][a-z0-9_.-]{1,179}$/.test(request.capability));
  return request;
}
export function validateNativeTaskResult(value) {
  need(exact(value,['kind','operationId','specificationId','taskRef','candidateId','capability',
    'inputSha256','resultSha256','result','replayed']), 'TASK_RESULT_INVALID');
  need(value.kind===NATIVE_REUSE_CAPABILITY && typeof value.replayed==='boolean','TASK_RESULT_INVALID');
  validateNativeTaskRequest({schemaVersion:1,action:'recover',taskRef:value.taskRef,
    specificationId:value.specificationId,operationId:value.operationId,capability:value.capability,
    candidateId:value.candidateId,requirementsHash:'a'.repeat(64),inputSha256:value.inputSha256,arguments:{}});
  need(typeof value.resultSha256==='string' && SHA.test(value.resultSha256),'TASK_RESULT_INVALID');
  // Preserve the existing 2 KiB wire receipt and 4 KiB on-disk receipt limits.
  // Larger module outputs require a separately accepted artifact-reference lane.
  need(object(value.result), 'TASK_RESULT_INVALID');
  validateNativeTaskRequest({schemaVersion:1,action:'recover',taskRef:value.taskRef,
    specificationId:value.specificationId,operationId:value.operationId,capability:value.capability,
    candidateId:value.candidateId,requirementsHash:'a'.repeat(64),inputSha256:value.inputSha256,arguments:value.result});
  need(byteLength(JSON.stringify(value.result))<=768,'TASK_RESULT_INVALID');
  need(byteLength(JSON.stringify(value))<=1500
    && byteLength(JSON.stringify(value,null,2))<=2048,'TASK_RESULT_INVALID');
  return structuredClone(value);
}
