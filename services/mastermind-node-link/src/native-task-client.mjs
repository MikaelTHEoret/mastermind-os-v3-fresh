import {validateNativeCatalogRequest,validateNativeCatalogResult} from '../../../protocol/mastermind-node-exchange/native-catalog.mjs';
export const NATIVE_CATALOG_ENDPOINT = 'http://127.0.0.1:8770/task_catalog';
// A fixed local broker for accepted native reuse. Not a shell, URL or tool proxy.
// The caller retains this exact request for recovery; uncertain calls are never retried here.
export const NATIVE_TASK_ENDPOINT = 'http://127.0.0.1:8770/task_execution';
import {NativeTaskError, validateNativeTaskRequest} from '../../../protocol/mastermind-node-exchange/native-task.mjs';
export {NativeTaskError, validateNativeTaskRequest};
const SHA=/^[a-f0-9]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(ok,code)=>{if(!ok)throw new NativeTaskError(code);};

function abortable(promise, signal, discard = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) { if (!error) discard(value); return; }
      settled = true; signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', abort, {once:true});
    Promise.resolve(promise).then(value => finish(null,value), error => finish(error));
    if (signal.aborted) abort();
  });
}

async function readResponse(response, signal) {
  need(!response.redirected && response.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'TASK_RESULT_INVALID');
  const reader = response.body?.getReader(); need(reader, 'TASK_RESULT_INVALID');
  const chunks = []; let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const {done,value} = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength; need(bytes <= 73728, 'TASK_RESULT_INVALID'); chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class NativeTaskClient {
  constructor({fetchImpl = fetch, now = () => performance.now(), timeoutMs = 30000} = {}) {
    need(typeof fetchImpl === 'function' && typeof now === 'function' && Number.isSafeInteger(timeoutMs)
      && timeoutMs >= 100 && timeoutMs <= 60000);
    this.fetchImpl = fetchImpl; this.now = now; this.timeoutMs = timeoutMs;
  }
  async catalog(request, {signal,deadlineMs} = {}) {
    const body=validateNativeCatalogRequest(request);
    need(Number.isFinite(deadlineMs),'TASK_DEADLINE_REQUIRED');
    const remaining=Math.floor(Math.min(this.timeoutMs,deadlineMs-this.now()));
    if(signal?.aborted||remaining<=0)throw new NativeTaskError('TASK_NOT_STARTED');
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(remaining)]):AbortSignal.timeout(remaining);
    try {
      combined.throwIfAborted();
      const response=await abortable(this.fetchImpl(NATIVE_CATALOG_ENDPOINT,{method:'POST',redirect:'error',signal:combined,
        headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)}),combined,
        response=>response?.body?.cancel().catch(()=>{}));
      combined.throwIfAborted();
      const result=await readResponse(response,combined);
      need(response.status===200,'TASK_CATALOG_UNAVAILABLE');
      need(this.now()<deadlineMs,'TASK_CATALOG_UNAVAILABLE');
      return validateNativeCatalogResult(result,body);
    } catch(error) {
      if(error instanceof NativeTaskError)throw error;
      throw new NativeTaskError('TASK_CATALOG_UNAVAILABLE');
    }
  }
  async execute(request, {signal, deadlineMs} = {}) {
    const body = validateNativeTaskRequest(request);
    need(Number.isFinite(deadlineMs), 'TASK_DEADLINE_REQUIRED');
    const remaining = Math.floor(Math.min(this.timeoutMs, deadlineMs - this.now()));
    if (signal?.aborted || remaining <= 0) throw new NativeTaskError('TASK_NOT_STARTED');
    const combined = signal ? AbortSignal.any([signal,AbortSignal.timeout(remaining)]) : AbortSignal.timeout(remaining);
    try {
      combined.throwIfAborted();
      const response = await abortable(this.fetchImpl(NATIVE_TASK_ENDPOINT, {method:'POST', redirect:'error', signal:combined,
        headers:{'content-type':'application/json',accept:'application/json'}, body:JSON.stringify(body)}), combined, response => response?.body?.cancel().catch(() => {}));
      combined.throwIfAborted();
      const result = await readResponse(response, combined);
      if (this.now() >= deadlineMs) throw new NativeTaskError('TASK_LOCAL_UNCERTAIN');
      need(response.status === 200 || response.status === 409, 'TASK_LOCAL_REJECTED');
      need(object(result) && typeof result.ok === 'boolean' && object(result.reuse), 'TASK_RESULT_INVALID');
      const reuse = result.reuse;
      need(reuse.operationId === body.operationId && reuse.candidateId === body.candidateId, 'TASK_RESULT_INVALID');
      if (result.ok) {
        need(response.status === 200 && reuse.status === 'completed' && reuse.capability === body.capability
          && reuse.inputSha256 === body.inputSha256 && typeof reuse.requestHash === 'string' && SHA.test(reuse.requestHash)
          && typeof reuse.resultSha256 === 'string' && SHA.test(reuse.resultSha256)
          && typeof reuse.replayed === 'boolean' && Object.hasOwn(reuse,'result')
          && (body.action !== 'recover' || reuse.replayed === true), 'TASK_RESULT_INVALID');
      } else need(response.status === 409 && reuse.status === 'held', 'TASK_RESULT_INVALID');
      return result;
    } catch (error) {
      if (error instanceof NativeTaskError) throw error;
      throw new NativeTaskError('TASK_LOCAL_UNCERTAIN');
    }
  }
}
