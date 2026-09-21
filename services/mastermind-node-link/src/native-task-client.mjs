import {validateNativeCatalogRequest,validateNativeCatalogResult} from '../../../protocol/mastermind-node-exchange/native-catalog.mjs';
import {validateBuildDispatchInput,buildDispatchLocalRequest,buildDispatchReceipt} from '../../../protocol/mastermind-node-exchange/native-build-dispatch.mjs';
import {REVIEW_REUSE,validateReviewReuseInput,validateReviewReuseReceipt} from '../../../protocol/mastermind-node-exchange/native-review-reuse.mjs';
export const REVIEW_REUSE_ENDPOINT='http://127.0.0.1:8770/specification_review_reuse';
import {createHash} from 'node:crypto';
import {REVIEW_ARTIFACTS,REVIEW_BUILD_PLAN,validateDevelopmentInput,developmentLocalRequest,validateDevelopmentReceipt} from '../../../protocol/mastermind-node-exchange/native-development-work.mjs';
const DEVELOPMENT_ENDPOINTS=Object.freeze({[REVIEW_ARTIFACTS]:'http://127.0.0.1:8770/task_review_artifacts',[REVIEW_BUILD_PLAN]:'http://127.0.0.1:8770/task_build_plan'});
import {NATIVE_REVIEW_CAPABILITY,validateNativeReviewInput,validateNativeReviewReceipt,reviewCanonical,reviewContentHash,nativeReviewContent} from '../../../protocol/mastermind-node-exchange/native-review.mjs';
export const NATIVE_REVIEW_ENDPOINT='http://127.0.0.1:8770/specification_review';
import {validateNativeSpecificationRequest,validateNativeSpecificationResult,specificationBindingCanonical} from '../../../protocol/mastermind-node-exchange/native-specification.mjs';
export const NATIVE_SPECIFICATION_ENDPOINT = 'http://127.0.0.1:8770/task_specification';
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
  async buildDispatch(request,{signal,deadlineMs,recoverOnly=false}={}) {
    const input=validateBuildDispatchInput(request),body=buildDispatchLocalRequest(input,recoverOnly);
    need(Number.isFinite(deadlineMs),'TASK_DEADLINE_REQUIRED');
    const remaining=Math.floor(Math.min(this.timeoutMs,deadlineMs-this.now()));
    if(signal?.aborted||remaining<=0)throw new NativeTaskError('TASK_NOT_STARTED');
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(remaining)]):AbortSignal.timeout(remaining);
    try {
      combined.throwIfAborted();
      const response=await abortable(this.fetchImpl('http://127.0.0.1:8770/task_build_dispatch',{
        method:'POST',redirect:'error',signal:combined,headers:{'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify(body)}),combined,response=>response?.body?.cancel().catch(()=>{}));
      const result=await readResponse(response,combined);combined.throwIfAborted();
      need(this.now()<deadlineMs,'TASK_LOCAL_UNCERTAIN');
      need(response.status===(result?.ok===true?200:409),'TASK_BUILD_DISPATCH_UNAVAILABLE');
      return buildDispatchReceipt(result,input,recoverOnly);
    }catch(error){if(error instanceof NativeTaskError)throw error;throw new NativeTaskError('TASK_LOCAL_UNCERTAIN');}
  }
  async development(kind,request,{signal,deadlineMs,recoverOnly=false}={}) {
    const input=validateDevelopmentInput(kind,request),body=developmentLocalRequest(kind,input,recoverOnly);
    need(Number.isFinite(deadlineMs),'TASK_DEADLINE_REQUIRED');
    const remaining=Math.floor(Math.min(this.timeoutMs,deadlineMs-this.now()));
    if(signal?.aborted||remaining<=0)throw new NativeTaskError('TASK_NOT_STARTED');
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(remaining)]):AbortSignal.timeout(remaining);
    try {
      combined.throwIfAborted();
      const response=await abortable(this.fetchImpl(DEVELOPMENT_ENDPOINTS[kind],{method:'POST',redirect:'error',signal:combined,
        headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)}),combined,
        response=>response?.body?.cancel().catch(()=>{}));
      const result=await readResponse(response,combined);combined.throwIfAborted();
      need(this.now()<deadlineMs,'TASK_LOCAL_UNCERTAIN');
      need(response.status===200&&result?.ok===true,'TASK_DEVELOPMENT_UNAVAILABLE');
      need(result.schemaVersion===1&&result.operationId===body.operationId&&result.specificationId===input.specificationId
        &&result.reviewId===input.reviewId&&reviewCanonical(result.taskRef)===reviewCanonical(input.taskRef)
        &&result.executionAuthorized===false&&typeof result.replayed==='boolean'&&(!recoverOnly||result.replayed),'TASK_DEVELOPMENT_INVALID');
      const common={...input,kind,replayed:result.replayed,executionAuthorized:false};
      if(kind===REVIEW_ARTIFACTS){
        need(result.action===body.action,'TASK_DEVELOPMENT_INVALID');
        // A historical proposed/prepared record cannot confirm an uncertain publication.
        if(recoverOnly&&['publish','resume'].includes(input.action))need(result.artifactState==='published','TASK_DEVELOPMENT_RECOVERY_REQUIRED');
        const keys=['artifactState','bindingSha256','commit','fileCount','requirementsHash','testSpecHash','gitVerified',
          'historicalSnapshot','holds','mayAutomaticallyRerun','candidateAcceptance'];
        return validateDevelopmentReceipt({...common,...Object.fromEntries(keys.map(k=>[k,result[k]])),
          gitVerifiedAt:result.gitVerified===true?new Date().toISOString():null},input);
      }
      const {action:ignored,...binding}=body;
      need(result.requestHash===createHash('sha256').update(reviewCanonical(binding)).digest('hex')
        &&result.workerInvoked===false&&object(result.buildPlan)&&result.buildPlan.operationId===body.operationId
        &&result.buildPlan.executionAuthorized===false,'TASK_DEVELOPMENT_INVALID');
      const keys=['planId','state','holds','current','historicalSnapshot','decision','moduleId','requirementsHash',
        'jobState','candidateId','hasSourceReceipt'];
      return validateDevelopmentReceipt({...common,requestHash:result.requestHash,workerInvoked:false,
        ...Object.fromEntries(keys.map(k=>[k,result.buildPlan[k]]))},input);
    }catch(error){if(error instanceof NativeTaskError)throw error;throw new NativeTaskError('TASK_LOCAL_UNCERTAIN');}
  }
  async specification(request, {signal,deadlineMs} = {}) {
    const body=validateNativeSpecificationRequest(request);
    const requestHash=createHash('sha256').update(specificationBindingCanonical(body)).digest('hex');
    need(Number.isFinite(deadlineMs),'TASK_DEADLINE_REQUIRED');
    const remaining=Math.floor(Math.min(this.timeoutMs,deadlineMs-this.now()));
    if(signal?.aborted||remaining<=0)throw new NativeTaskError('TASK_NOT_STARTED');
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(remaining)]):AbortSignal.timeout(remaining);
    try {
      combined.throwIfAborted();
      const response=await abortable(this.fetchImpl(NATIVE_SPECIFICATION_ENDPOINT,{method:'POST',redirect:'error',signal:combined,
        headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)}),combined,
        response=>response?.body?.cancel().catch(()=>{}));
      combined.throwIfAborted();
      const result=await readResponse(response,combined);
      need(this.now()<deadlineMs,'TASK_LOCAL_UNCERTAIN');
      need(response.status===200,'TASK_SPECIFICATION_UNAVAILABLE');
      return validateNativeSpecificationResult(result,body,requestHash);
    } catch(error) {
      if(error instanceof NativeTaskError)throw error;
      throw new NativeTaskError('TASK_LOCAL_UNCERTAIN');
    }
  }
  async reviewReuse(request,{signal,deadlineMs,recoverOnly=false}={}) {
    const input=validateReviewReuseInput(request);
    need(Number.isFinite(deadlineMs),'TASK_DEADLINE_REQUIRED');
    const remaining=Math.floor(Math.min(this.timeoutMs,deadlineMs-this.now()));
    if(signal?.aborted||remaining<=0)throw new NativeTaskError('TASK_NOT_STARTED');
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(remaining)]):AbortSignal.timeout(remaining);
    const body={schemaVersion:1,action:input.action==='assess'?'assess':recoverOnly?'recover':'accept',
      specificationId:input.specificationId,reviewId:input.reviewId,acceptedSpecificationId:input.acceptedSpecificationId,
      ...(input.action==='accept'?{operationId:input.operationId,expectedQualificationId:input.qualificationId,decisions:input.decisions}:{})};
    try {
      combined.throwIfAborted();
      const response=await abortable(this.fetchImpl(REVIEW_REUSE_ENDPOINT,{method:'POST',redirect:'error',signal:combined,
        headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)}),combined,
        response=>response?.body?.cancel().catch(()=>{}));
      const result=await readResponse(response,combined);combined.throwIfAborted();
      need(this.now()<deadlineMs,'TASK_LOCAL_UNCERTAIN');
      need(response.status===200&&result?.ok===true&&result.executionAuthorized===false,'TASK_REVIEW_REUSE_UNAVAILABLE');
      const common={kind:REVIEW_REUSE,schemaVersion:1,action:input.action,taskRef:input.taskRef,
        operationId:input.operationId,specificationId:input.specificationId,reviewId:input.reviewId,executionAuthorized:false};
      if(input.action==='assess') {
        const q=result.qualification,e=q?.evidence?.assessment;
        need(object(q)&&reviewContentHash(q)===result.qualificationId&&object(e)&&reviewContentHash(e)===q.evidence.assessmentId
          &&q.specificationId===input.specificationId&&q.reviewId===input.reviewId&&q.executionAuthorized===false&&q.reviewAccepted===false
          &&e.specificationId===input.specificationId&&e.reviewId===input.reviewId&&e.executionAuthorized===false&&e.accepted===false
          &&reviewCanonical(e.taskRef)===reviewCanonical({taskId:input.taskRef.taskId,project:input.taskRef.project}), 'TASK_REVIEW_REUSE_INVALID');
        return validateReviewReuseReceipt({...common,acceptedSpecificationId:q.acceptedSpecificationId,
          qualificationId:result.qualificationId,candidateId:e.candidateId,differences:q.differences.map(d=>d.field),holds:q.holds,
          exampleCount:e.cases.length,coveredCount:e.cases.filter(c=>c.evidence!=='missing').length,suiteCaseCount:e.acceptedSuiteCaseCount,
          existingOperationId:result.existingLink?.operationId??null,existingLinkId:result.existingLink?.linkId??null,replayed:recoverOnly},input);
      }
      need(result.operationId===input.operationId&&result.specificationId===input.specificationId&&result.reviewId===input.reviewId
        &&(!recoverOnly||result.replayed===true),'TASK_REVIEW_REUSE_INVALID');
      return validateReviewReuseReceipt({...common,acceptedSpecificationId:result.acceptedSpecificationId,
        qualificationId:result.qualificationId,candidateId:result.candidateId,linkId:result.linkId,
        replayed:result.replayed,reuseLinkAccepted:result.reuseLinkAccepted,reviewAccepted:result.reviewAccepted},input);
    } catch(error) {if(error instanceof NativeTaskError)throw error;throw new NativeTaskError('TASK_LOCAL_UNCERTAIN');}
  }
  async review(request,{signal,deadlineMs,recoverOnly=false}={}) {
    const input=validateNativeReviewInput(request);
    const readSaved=recoverOnly||input.schemaVersion===3;
    const nativeOperation=input.schemaVersion===3?input.savedOperationId:input.operationId;
    const content=nativeReviewContent(input);
    need(Number.isFinite(deadlineMs),'TASK_DEADLINE_REQUIRED');
    const remaining=Math.floor(Math.min(this.timeoutMs,deadlineMs-this.now()));
    if(signal?.aborted||remaining<=0)throw new NativeTaskError('TASK_NOT_STARTED');
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(remaining)]):AbortSignal.timeout(remaining);
    const body={schemaVersion:1,action:readSaved?'recover':'prepare',specificationId:input.specificationId,
      operationId:nativeOperation,content};
    try {
      combined.throwIfAborted();
      const response=await abortable(this.fetchImpl(NATIVE_REVIEW_ENDPOINT,{method:'POST',redirect:'error',signal:combined,
        headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)}),combined,
        response=>response?.body?.cancel().catch(()=>{}));
      combined.throwIfAborted();
      const result=await readResponse(response,combined);
      need(this.now()<deadlineMs,'TASK_LOCAL_UNCERTAIN');
      need(response.status===200,'TASK_REVIEW_UNAVAILABLE');
      need(object(result)&&result.ok===true&&result.schemaVersion===1&&result.accepted===false&&result.executionAuthorized===false
        &&result.operationId===nativeOperation&&result.specificationId===input.specificationId
        &&typeof result.replayed==='boolean'&&(!readSaved||result.replayed),'TASK_REVIEW_INVALID');
      const r=result.review;
      need(object(r)&&r.accepted===false&&r.executionAuthorized===false&&r.originalRequest===input.originalRequest
        &&reviewContentHash(r.originalRequest)===content.requestSha256
        &&reviewCanonical(r.content)===reviewCanonical(content)&&r.contentSha256===reviewContentHash(content),'TASK_REVIEW_INVALID');
      return validateNativeReviewReceipt({kind:NATIVE_REVIEW_CAPABILITY,ok:true,schemaVersion:1,taskRef:input.taskRef,
        operationId:input.operationId,specificationId:input.specificationId,contentSha256:r.contentSha256,
        reviewId:r.reviewId,state:r.state,holds:r.holds,replayed:result.replayed,accepted:false,executionAuthorized:false},input);
    } catch(error) {
      if(error instanceof NativeTaskError)throw error;
      throw new NativeTaskError('TASK_LOCAL_UNCERTAIN');
    }
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
