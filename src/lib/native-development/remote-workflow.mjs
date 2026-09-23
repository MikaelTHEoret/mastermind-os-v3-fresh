import {CONTRIBUTION,validateContributionInput,validateContributionReceipt} from '../../../protocol/mastermind-node-exchange/native-contribution.mjs';
import {BUILD_DISPATCH,validateBuildDispatchInput,validateBuildDispatchReceipt} from '../../../protocol/mastermind-node-exchange/native-build-dispatch.mjs';
import {DEVELOPMENT_CAPABILITIES,REVIEW_ARTIFACTS,REVIEW_BUILD_PLAN,developmentLocalRequest,validateDevelopmentInput,validateDevelopmentReceipt} from '../../../protocol/mastermind-node-exchange/native-development-work.mjs';
import {REVIEW_REUSE,validateReviewReuseInput,validateReviewReuseReceipt} from '../../../protocol/mastermind-node-exchange/native-review-reuse.mjs';
import {NATIVE_REVIEW_CAPABILITY,validateNativeReviewInput,validateNativeReviewReceipt,reviewCanonical,nativeReviewContent} from '../../../protocol/mastermind-node-exchange/native-review-contract.mjs';
import {validateNativeCommandInput} from '../../../protocol/mastermind-node-exchange/native-task.mjs';
import {validateNativeCatalogReceipt} from '../../../protocol/mastermind-node-exchange/native-catalog.mjs';
import {parseNodeJob,parseNodeJobEnqueue} from '../../components/node-control-contract.mjs';
import {NATIVE_SPECIFICATION_CAPABILITY,validateNativeSpecificationInput,specificationBindingCanonical,validateNativeSpecificationReceiptFields} from '../../../protocol/mastermind-node-exchange/native-specification-contract.mjs';
export const CATALOG='mastermind.native.catalog',REUSE='mastermind.native.reuse';
export const SPECIFICATION=NATIVE_SPECIFICATION_CAPABILITY;
export function specificationRequest(taskRef,request,operationId,revisionOf) {
  return {operationId,input:validateNativeSpecificationInput({schemaVersion:1,action:'prepare',taskRef,operationId,request,recipeId:null,...(revisionOf?{revisionOf}: {})})};
}
export async function checkedRemoteJob(envelope,pending,enqueue=false,subtle=crypto.subtle) {
  if(pending.capability===CONTRIBUTION){
    const input=validateContributionInput(pending.body.input);
    if(input.operationId!==pending.operationId||input.taskRef.taskId!==pending.taskId||pending.body.operationId!==pending.operationId)throw Error('Saved contribution binding changed.');
    const job=enqueue?parseNodeJobEnqueue(envelope,pending.nodeId,pending.operationId,CONTRIBUTION).job:parseNodeJob(envelope,pending.nodeId,pending.operationId,CONTRIBUTION).job;
    if(job.state==='succeeded')validateContributionReceipt(job.terminal.result,input);
    return job;
  }
  if(pending.capability===BUILD_DISPATCH){
    const input=validateBuildDispatchInput(pending.body.input);
    if(input.operationId!==pending.operationId||input.taskRef.taskId!==pending.taskId||pending.body.operationId!==pending.operationId)throw Error('Saved coding binding changed.');
    const job=enqueue?parseNodeJobEnqueue(envelope,pending.nodeId,pending.operationId,BUILD_DISPATCH).job:parseNodeJob(envelope,pending.nodeId,pending.operationId,BUILD_DISPATCH).job;
    if(job.state==='succeeded')validateBuildDispatchReceipt(job.terminal.result,input);
    return job;
  }
  if(DEVELOPMENT_CAPABILITIES.includes(pending.capability)){
    const input=validateDevelopmentInput(pending.capability,pending.body.input);
    if(input.operationId!==pending.operationId||input.taskRef.taskId!==pending.taskId||pending.body.operationId!==pending.operationId)throw Error('Saved development binding changed.');
    const job=enqueue?parseNodeJobEnqueue(envelope,pending.nodeId,pending.operationId,pending.capability).job:parseNodeJob(envelope,pending.nodeId,pending.operationId,pending.capability).job;
    if(job.state==='succeeded'){
      const receipt=validateDevelopmentReceipt(job.terminal.result,input);
      if(pending.capability===REVIEW_BUILD_PLAN){
        const {action,...binding}=developmentLocalRequest(pending.capability,input);
        const bytes=await subtle.digest('SHA-256',new TextEncoder().encode(reviewCanonical(binding)));
        const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
        if(hash!==receipt.requestHash)throw Error('Saved build plan changed.');
      }
    }
    return job;
  }
  if(pending.capability===REVIEW_REUSE){
    const input=validateReviewReuseInput(pending.body.input);
    if(input.operationId!==pending.operationId||input.taskRef.taskId!==pending.taskId||pending.body.operationId!==pending.operationId)throw Error('Saved link binding changed.');
    const job=enqueue?parseNodeJobEnqueue(envelope,pending.nodeId,pending.operationId,REVIEW_REUSE).job:parseNodeJob(envelope,pending.nodeId,pending.operationId,REVIEW_REUSE).job;
    if(job.state==='succeeded')validateReviewReuseReceipt(job.terminal.result,input);return job;
  }
  if(pending.capability===NATIVE_REVIEW_CAPABILITY){
    const input=validateNativeReviewInput(pending.body.input);
    if(input.operationId!==pending.operationId||pending.body.operationId!==pending.operationId||input.taskRef.taskId!==pending.taskId)throw Error('Saved review binding changed.');
    const job=enqueue?parseNodeJobEnqueue(envelope,pending.nodeId,pending.operationId,NATIVE_REVIEW_CAPABILITY).job:parseNodeJob(envelope,pending.nodeId,pending.operationId,NATIVE_REVIEW_CAPABILITY).job;
    if(job.capabilityVersion!==input.schemaVersion)throw Error('Saved review transport version changed.');
    if(job.state==='succeeded'){
      validateNativeReviewReceipt(job.terminal.result,input);
      const bytes=await subtle.digest('SHA-256',new TextEncoder().encode(reviewCanonical(nativeReviewContent(input))));
      const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==job.terminal.result.contentSha256)throw Error('Saved review content changed.');
    }
    return job;
  }
  if(pending.capability!==SPECIFICATION)return checkedJob(envelope,pending,enqueue);
  const input=validateNativeSpecificationInput(pending.body.input);
  if(input.operationId!==pending.operationId||pending.body.operationId!==pending.operationId||input.taskRef.taskId!==pending.taskId)throw Error('Saved Wizard binding changed.');
  const job=enqueue?parseNodeJobEnqueue(envelope,pending.nodeId,pending.operationId,SPECIFICATION).job:
    parseNodeJob(envelope,pending.nodeId,pending.operationId,SPECIFICATION).job;
  if(job.jobId!==pending.operationId)throw Error('The saved operation changed.');
  if(job.state==='succeeded') {
    const bytes=await subtle.digest('SHA-256',new TextEncoder().encode(specificationBindingCanonical(input)));
    const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    validateNativeSpecificationReceiptFields(job.terminal.result,input,hash);
  }
  return job;
}
export function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}

/** Explicit owner transitions; select host-bound choices, never invent import authority. */
export async function contributionRequest(pending,job,action,newId=()=>crypto.randomUUID()) {
 if(!pending||job?.jobId!==pending.operationId||job.nodeId!==pending.nodeId||job.capability!==pending.capability)throw Error('Recover the saved result first.');
 await checkedRemoteJob({ok:true,job},pending);
 const prior=pending.body.input,result=job.terminal?.result;
 let taskRef,specificationId,importOperationId=null,snapshotId=null,cursor=null;
 if(pending.capability===SPECIFICATION){
  validateNativeSpecificationInput(prior);
  if(job.state!=='succeeded'||action!=='catalog')throw Error('Choose a saved Wizard request first.');
  validateNativeSpecificationReceiptFields(result);
  taskRef=prior.taskRef;specificationId=result.specification.specificationId;
 }else if(pending.capability===CONTRIBUTION){
  validateContributionInput(prior);taskRef=prior.taskRef;specificationId=prior.specificationId;
  if(job.state==='succeeded'){
   validateContributionReceipt(result,prior);
   if(action==='catalog-start'){
    action='catalog';
   }else if(action==='catalog'){
    if(prior.action!=='catalog'||!result.data.nextCursor)throw Error('There are no further contributions in this selection.');
    snapshotId=result.data.snapshotId;cursor=result.data.nextCursor;
   }else if(action==='prepare'){
    if(prior.action!=='catalog'||!result.data.choice?.packetAvailable)throw Error('Choose a prepared contribution first.');
    importOperationId=result.data.choice.importOperationId;
   }else if(action==='stage'){
    if(!(prior.action==='prepare'&&result.data.phase==='preview'||prior.action==='recover'&&result.data.phase==='prepared'))throw Error('Preview or recover this contribution before staging.');
    importOperationId=prior.importOperationId;
   }else if(action==='recover'&&prior.action!=='catalog')importOperationId=prior.importOperationId;
   else throw Error('Unsupported contribution transition.');
  }else if(['failed','expired'].includes(job.state)&&action==='recover'&&['stage','recover'].includes(prior.action))importOperationId=prior.importOperationId;
  else throw Error('Refresh the original delivery before starting another.');
 }else throw Error('Choose a saved Wizard request first.');
 if(prior.operationId!==pending.operationId||pending.body.operationId!==pending.operationId||taskRef.taskId!==pending.taskId)throw Error('Saved task changed.');
 const input=validateContributionInput({schemaVersion:1,action,taskRef,specificationId,importOperationId,snapshotId,cursor,operationId:newId()});
 return {nodeId:pending.nodeId,taskId:pending.taskId,operationId:input.operationId,capability:CONTRIBUTION,body:{operationId:input.operationId,input}};
}
export async function executionRequest(page,arguments_,operationId,subtle=crypto.subtle) {
  validateNativeCatalogReceipt(page);
  if(!page.entry)throw Error('Choose an accepted capability first.');
  const entry=page.entry;
  validateNativeCommandInput({schemaVersion:1,action:'execute',taskRef:page.taskRef,specificationId:entry.specificationId,candidateId:entry.candidateId,requirementsHash:entry.requirementsHash,capability:entry.capability,operationId,inputSha256:'a'.repeat(64),arguments:arguments_});
  const bytes=new TextEncoder().encode(canonical(arguments_));
  const digest=await subtle.digest('SHA-256',bytes);
  const inputSha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return validateNativeCommandInput({schemaVersion:1,action:'execute',taskRef:page.taskRef,
    specificationId:entry.specificationId,candidateId:entry.candidateId,requirementsHash:entry.requirementsHash,
    capability:entry.capability,operationId,inputSha256,arguments:arguments_});
}
export function checkedJob(envelope,pending,enqueue=false) {
  const job=enqueue?parseNodeJobEnqueue(envelope,pending.nodeId,pending.operationId,pending.capability).job:
    parseNodeJob(envelope,pending.nodeId,pending.operationId,pending.capability).job;
  if(job.jobId!==pending.operationId)throw Error('The saved operation changed.');
  if(job.state==='succeeded') {
    const result=job.terminal.result;
    if(pending.capability===CATALOG)validateNativeCatalogReceipt(result,pending.body.input);
    else {
      const input=pending.body;
      if(result.operationId!==input.operationId||canonical(result.taskRef)!==canonical(input.taskRef)
        ||['specificationId','candidateId','capability','inputSha256'].some(k=>result[k]!==input[k]))throw Error('Saved result does not match this request.');
    }
  }
  return job;
}
export async function remoteJson(url,options={}) {
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
  const response=await fetch(url,{cache:'no-store',redirect:'error',...options,signal});
  const reader=response.body?.getReader();if(!reader)throw Error('The response was unavailable.');
  const parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('The response was too large.');parts.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!response.ok||value.ok!==true)throw Error('The request could not be confirmed. Refresh its saved status before starting another.');
  return value;
}

/** Explicit user transitions only; reconnects read the saved network operation. */
export function developmentRequest(pending,job,kind,action,newId=()=>crypto.randomUUID()) {
  if(!pending||job?.state!=='succeeded'||job.jobId!==pending.operationId||job.nodeId!==pending.nodeId)throw Error('Recover the saved result first.');
  const prior=pending.body.input, result=job.terminal?.result;
  let input;
  if(pending.capability===NATIVE_REVIEW_CAPABILITY){
    validateNativeReviewInput(prior);validateNativeReviewReceipt(result,prior);
    if(kind!==REVIEW_ARTIFACTS||action!=='prepare'||!['create','extend'].includes(nativeReviewContent(prior).mode))throw Error('This review needs a different workflow.');
    input={schemaVersion:1,action,taskRef:prior.taskRef,operationId:newId(),parentOperationId:pending.operationId,
      artifactOperationId:newId(),specificationId:prior.specificationId,reviewId:result.reviewId};
  }else{
    validateDevelopmentInput(pending.capability,prior);validateDevelopmentReceipt(result,prior);
    input={...prior,action,operationId:newId()};
    if(kind===REVIEW_BUILD_PLAN&&pending.capability===REVIEW_ARTIFACTS){
      if(action!=='prepare'||result.artifactState!=='published'||result.holds.length)throw Error('A published source package is required.');
      input.buildOperationId=newId();
    }else if(kind===REVIEW_ARTIFACTS&&pending.capability===REVIEW_ARTIFACTS){
      const allowed=action==='recover'||action==='reconcile'||action==='publish'&&result.artifactState==='proposed'
        ||action==='resume'&&result.artifactState==='prepared'&&result.holds.length===1&&result.holds[0]==='MATERIALIZER_REF_NOT_PUBLISHED';
      if(!allowed)throw Error('Check publication status before continuing.');
    }else if(kind!==REVIEW_BUILD_PLAN||pending.capability!==REVIEW_BUILD_PLAN||action!=='recover')throw Error('Invalid development transition.');
  }
  input=validateDevelopmentInput(kind,input);
  if(input.taskRef.taskId!==pending.taskId)throw Error('Saved task changed.');
  return {nodeId:pending.nodeId,taskId:pending.taskId,operationId:input.operationId,capability:kind,body:{operationId:input.operationId,input}};
}

/** Explicit coding transitions. Network IDs change; the saved build ID does not. */
export function codingRequest(pending,job,action,newId=()=>crypto.randomUUID()) {
 if(!pending||job?.state!=='succeeded'||job.jobId!==pending.operationId||job.nodeId!==pending.nodeId)throw Error('Recover the saved result first.');
 const prior=pending.body.input,result=job.terminal?.result;
 let input;
 if(pending.capability===REVIEW_BUILD_PLAN){
  validateDevelopmentInput(REVIEW_BUILD_PLAN,prior);validateDevelopmentReceipt(result,prior);
  if(action!=='preflight')throw Error('Check coding readiness first.');
  input={...prior,action,operationId:newId(),planId:result.planId};
 }else if(pending.capability===BUILD_DISPATCH){
  validateBuildDispatchInput(prior);validateBuildDispatchReceipt(result,prior);
  if(!['preflight','start','status','recover'].includes(action))throw Error('Unsupported coding step.');
  if(action==='start'&&!(result.observedAction==='preflight'&&result.ok&&result.state==='ready_for_separate_dispatch'&&result.holds.length===0))throw Error('A fresh successful readiness check is required.');
  if(action==='preflight'&&['started','awaiting_independent_tests'].includes(result.state))throw Error('Recover existing source work first.');
  input={...prior,action,operationId:newId()};
 }else throw Error('A saved build plan is required.');
 input=validateBuildDispatchInput(input);
 if(input.taskRef.taskId!==pending.taskId)throw Error('Saved task changed.');
 return {nodeId:pending.nodeId,taskId:pending.taskId,operationId:input.operationId,capability:BUILD_DISPATCH,body:{operationId:input.operationId,input}};
}
