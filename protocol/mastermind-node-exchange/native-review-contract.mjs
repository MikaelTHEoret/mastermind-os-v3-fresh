// Advisory review transport. Source pins and execution authority remain host-owned.
import {NativeTaskError} from './native-task.mjs';
import {validateNativeCatalogInput} from './native-catalog.mjs';
export const NATIVE_REVIEW_CAPABILITY='mastermind.native.review';
export const NATIVE_REVIEW_INPUT_BYTES=16384;
export const NATIVE_REVIEW_V2_INPUT_BYTES=24576;
export const NATIVE_REVIEW_V2_CONTENT_BYTES=20480;
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=ok=>{if(!ok)throw new NativeTaskError('TASK_REVIEW_INVALID');};
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(v);
const codepointOrder=(a,b)=>{const x=Array.from(a,c=>c.codePointAt(0)),y=Array.from(b,c=>c.codePointAt(0));for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
export function reviewCanonical(v) {
  if(Array.isArray(v))return '['+v.map(reviewCanonical).join(',')+']';
  if(object(v))return '{'+Object.keys(v).sort(codepointOrder).map(k=>JSON.stringify(k)+':'+reviewCanonical(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
// Python's canonical review hashes distinguish floats from integers. This first
// wire profile accepts safe integers only; it never rounds a test's numbers.
function json(value,depth=0,path=[],testData=false) {
  need(depth<=20);
  const nulData=testData&&path[0]==='requirements'&&path[1]==='tests'&&path[2]==='cases'
    &&Number.isInteger(path[3])&&['input','expected'].includes(path[4]);
  if(typeof value==='number')need(Number.isSafeInteger(value)&&!Object.is(value,-0));
  else if(typeof value==='string')need(value.isWellFormed()&&(nulData||!value.includes('\0')));
  else if(Array.isArray(value))value.forEach((v,i)=>json(v,depth+1,[...path,i],testData));
  else if(object(value))for(const [k,v] of Object.entries(value)){json(k,depth+1);json(v,depth+1,[...path,k],testData);}
  else need(value===null||typeof value==='boolean');
}
function schema(s,depth=0) {
  need(object(s)&&depth<=12);
  for(const key of ['title','description'])if(Object.hasOwn(s,key))need(typeof s[key]==='string');
  if(Object.hasOwn(s,'type'))need(typeof s.type==='string'||Array.isArray(s.type)&&s.type.every(t=>typeof t==='string'));
  if(Object.hasOwn(s,'required'))need(Array.isArray(s.required)&&s.required.every(k=>typeof k==='string'));
  if(Object.hasOwn(s,'enum'))need(Array.isArray(s.enum)&&s.enum.length>0);
  if(Object.hasOwn(s,'properties')){need(object(s.properties));for(const child of Object.values(s.properties))schema(child,depth+1);}
  if(Object.hasOwn(s,'items'))schema(s.items,depth+1);
}
export function validateNativeReviewInput(value) {
  const recovery=value?.schemaVersion===3;
  need(exact(value,['schemaVersion','action','taskRef','operationId','specificationId','parentOperationId','originalRequest','content',...(recovery?['savedOperationId']:[])])
    &&[1,2,3].includes(value.schemaVersion)&&value.action===(recovery?'recover':'prepare')&&UUID.test(value.operationId)
    &&UUID.test(value.parentOperationId)&&value.operationId!==value.parentOperationId&&SHA.test(value.specificationId));
  if(recovery)need(UUID.test(value.savedOperationId)&&![value.operationId,value.parentOperationId].includes(value.savedOperationId));
  need(typeof value.originalRequest==='string'&&value.originalRequest===value.originalRequest.trim()
    &&Array.from(value.originalRequest).length>0&&Array.from(value.originalRequest).length<=4000);
  // Check the serialized bound before recursive schema work.
  const encoded=value.schemaVersion>=2;
  need(bytes(value)<=(encoded?NATIVE_REVIEW_V2_INPUT_BYTES:NATIVE_REVIEW_INPUT_BYTES)
    &&new TextEncoder().encode(JSON.stringify(value,null,2)).length<=(encoded?28672:24576));
  json(value);
  validateNativeCatalogInput({schemaVersion:1,taskRef:value.taskRef,snapshotId:null,cursor:null});
  let c=value.content;
  if(encoded){
    need(typeof c==='string'&&new TextEncoder().encode(c).length<=NATIVE_REVIEW_V2_CONTENT_BYTES);
    try{c=JSON.parse(c);}catch{need(false);}
    json(c,0,[],true);
    need(reviewCanonical(c)===value.content);
  }
  need(exact(c,['schemaVersion','specificationId','requestSha256','mode','requirements','coverage','expectedActiveRevision','reuseEvidence'])
    &&c.schemaVersion===1&&c.specificationId===value.specificationId&&SHA.test(c.requestSha256)
    &&['create','extend','reuse','assimilate'].includes(c.mode)
    &&(c.expectedActiveRevision===null||SHA.test(c.expectedActiveRevision)));
  const r=c.requirements;
  need(object(r)&&r.schemaVersion===1&&r.kind==='mastermind.module-requirements'&&identifier(r.moduleId)&&identifier(r.version)
    &&reviewCanonical(r.taskRef)===reviewCanonical({taskId:value.taskRef.taskId,project:value.taskRef.project})
    &&Array.isArray(r.requirements)&&r.requirements.length>=1&&r.requirements.length<=64
    &&r.requirements.every(x=>typeof x==='string'&&x.trim().length>0&&[...x].length<=4000)
    &&Array.isArray(r.contracts)&&r.contracts.length>=1&&r.contracts.length<=8
    &&exact(r.tests,['schemaVersion','cases'])&&r.tests.schemaVersion===1
    &&Array.isArray(r.tests.cases)&&r.tests.cases.length>=1&&r.tests.cases.length<=25
    &&Array.isArray(c.coverage)&&c.coverage.length<=128);
  need(r.contracts.every(x=>object(x)&&identifier(x.name)&&typeof x.effectClass==='string'&&object(x.inputSchema)&&object(x.outputSchema))
    &&new Set(r.contracts.map(x=>x.name)).size===r.contracts.length);
  r.contracts.forEach(c=>{schema(c.inputSchema);schema(c.outputSchema);});
  need(r.tests.cases.every(x=>(exact(x,['id','capability','input','expected'])
    ||exact(x,['id','capability','input','expectedError'])&&exact(x.expectedError,['type','message'])
      &&typeof x.expectedError.type==='string'&&typeof x.expectedError.message==='string')
    &&identifier(x.id)&&r.contracts.some(c=>c.name===x.capability)&&object(x.input))
    &&new Set(r.tests.cases.map(x=>x.id)).size===r.tests.cases.length);
  need(c.coverage.every(s=>exact(s,['start','end','text','requirements','status'])&&Number.isSafeInteger(s.start)&&s.start>=0
    &&Number.isSafeInteger(s.end)&&s.end>s.start&&typeof s.text==='string'&&Array.from(s.text).length===s.end-s.start
    &&['covered','uncertain'].includes(s.status)&&Array.isArray(s.requirements)&&s.requirements.length>0
    &&s.requirements.every(n=>Number.isSafeInteger(n)&&n>=0&&n<r.requirements.length)));
  return structuredClone(value);
}
/** V2 encodes data, not authority. Decoding must follow full validation. */
export function nativeReviewContent(input){const v=validateNativeReviewInput(input);return v.schemaVersion>=2?JSON.parse(v.content):v.content;}
export function encodeNativeReviewInput(input){json(input.content,0,[],true);return validateNativeReviewInput({...input,schemaVersion:2,content:reviewCanonical(input.content)});}
/** New delivery, same saved native operation. Always read-only, never prepare. */
export function encodeNativeReviewRecovery(original,operationId){
  const old=validateNativeReviewInput(original);
  need(old.schemaVersion!==3);
  return validateNativeReviewInput({...old,schemaVersion:3,action:'recover',operationId,
    savedOperationId:old.operationId,content:reviewCanonical(nativeReviewContent(old))});
}
export function validateNativeReviewReceipt(value,input) {
  need(exact(value,['kind','ok','schemaVersion','taskRef','operationId','specificationId','contentSha256','reviewId','state','holds','replayed','accepted','executionAuthorized'])
    &&value.kind===NATIVE_REVIEW_CAPABILITY&&value.ok===true&&value.schemaVersion===1
    &&value.accepted===false&&value.executionAuthorized===false&&UUID.test(value.operationId)
    &&[value.specificationId,value.contentSha256,value.reviewId].every(v=>typeof v==='string'&&SHA.test(v))
    &&['held','proposed'].includes(value.state)&&Array.isArray(value.holds)&&value.holds.length<=16
    &&value.holds.every(x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{1,95}$/.test(x))
    &&new Set(value.holds).size===value.holds.length&&typeof value.replayed==='boolean'
    &&(value.state==='held')===(value.holds.length>0)&&bytes(value)<=1450
    &&new TextEncoder().encode(JSON.stringify(value,null,2)).length<=2900);
  validateNativeCatalogInput({schemaVersion:1,taskRef:value.taskRef,snapshotId:null,cursor:null});
  if(input){const raw=validateNativeReviewInput(input);need(raw.operationId===value.operationId
    &&raw.specificationId===value.specificationId&&reviewCanonical(raw.taskRef)===reviewCanonical(value.taskRef)
    &&(raw.schemaVersion!==3||value.replayed===true));}
  return structuredClone(value);
}
