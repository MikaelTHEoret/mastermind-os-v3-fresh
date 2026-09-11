import {validateNativeCommandInput} from '../../../protocol/mastermind-node-exchange/native-task.mjs';
import {validateNativeCatalogReceipt} from '../../../protocol/mastermind-node-exchange/native-catalog.mjs';
import {parseNodeJob,parseNodeJobEnqueue} from '../../components/node-control-contract.mjs';
export const CATALOG='mastermind.native.catalog',REUSE='mastermind.native.reuse';
export function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
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
