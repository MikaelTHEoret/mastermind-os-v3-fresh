import {createHash} from 'node:crypto';
import {RoomError,digest} from './contract.mjs';

// Reviewed official price snapshot. Refresh the snapshot AND enrollment before activation.
// A free model never falls back to a paid model or another provider.
export const CATALOG_VERSION='2026-10-01-v1';
export const MODELS=Object.freeze([
 {id:'zai/glm-4.7-flash',provider:'zai',model:'glm-4.7-flash',label:'Z.ai GLM 4.7 Flash',paid:false},
 {id:'gemini/gemini-3.5-flash-lite',provider:'gemini',model:'gemini-3.5-flash-lite',label:'Gemini 3.5 Flash-Lite',paid:false},
 {id:'zai/glm-5.2',provider:'zai',model:'glm-5.2',label:'Z.ai GLM 5.2',paid:true},
]);
const fail=(code,status=409)=>{throw new RoomError(code,status);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const MAX_OUTPUT=1024;
export function providerConfiguration(env,owner,now=Date.now()){
 let policy;try{policy=JSON.parse(env.MASTERMIND_ROOM_API_POLICY??'null');}catch{/* Invalid enrollment is unavailable. */}
 const valid=env.MASTERMIND_ROOM_API_ENABLED==='true'&&policy?.catalogVersion===CATALOG_VERSION
  &&policy.householdId===owner.householdId&&policy.actorPlayerId===owner.actorPlayerId&&policy.subject===owner.subject
  &&Number.isFinite(Date.parse(policy.reviewedAt))&&Number.isFinite(Date.parse(policy.expiresAt))
  &&Date.parse(policy.reviewedAt)<=now&&Date.parse(policy.expiresAt)>now
  &&Date.parse(policy.expiresAt)-Date.parse(policy.reviewedAt)<=86400000;
 const entries=MODELS.map(model=>{
  const key=env[model.provider==='zai'?'MASTERMIND_ROOM_ZAI_API_KEY':'MASTERMIND_ROOM_GEMINI_API_KEY'];
  const enrollment=policy?.providers?.[model.provider];
  const enrolled=valid&&typeof key==='string'&&key.length>=16&&key.length<=4096&&!/[\r\n]/.test(key)
   &&enrollment?.credentialSha256===sha(key)&&enrollment?.enabled===true;
  const tier=model.provider!=='gemini'||enrollment?.freeTierConfirmed===true;
  const ready=!!(enrolled&&tier&&(!model.paid||policy.allowPaid===true));
  return {...model,ready,reason:!valid?'Connection needs owner enrollment and a current price review.':!enrolled?'This provider needs a dedicated server credential.':!tier?'Confirm this credential uses Gemini’s free tier.':model.paid&&policy.allowPaid!==true?'Paid models are disabled on this installation.':'Ready',
   privacy:model.provider==='gemini'?'Gemini free-tier inputs and outputs may be used to improve Google products.':'The selected prompt is sent to Z.ai under its API data terms.',
   ...(ready?{key,policyDigest:digest(policy)}:{})};
 });
 return {entries,expiresAt:valid?policy.expiresAt:null};
}
export const publicModels=config=>config.entries.map(({key,policyDigest,...model})=>model);
export function quoteFor(config,modelId,prompt){
 const model=config.entries.find(m=>m.id===modelId);
 if(!model?.ready)return null;
 if(typeof prompt!=='string'||!prompt.isWellFormed()||Buffer.byteLength(prompt)>48000)return null;
 // A display estimate, never a billing guarantee. The API output limit is enforced.
 const estimatedInputTokens=Math.ceil(Buffer.byteLength(prompt)/3);
 return {modelId,maxOutputTokens:MAX_OUTPUT,paid:model.paid,
  estimatedUsdMicros:model.paid?Math.ceil(estimatedInputTokens*1.4+MAX_OUTPUT*4.4):0,
  policyDigest:model.policyDigest,expiresAt:config.expiresAt};
}
export function validateApproval(config,modelId,prompt,approval){
 const quote=quoteFor(config,modelId,prompt);
 if(!quote)fail('ROOM_PROVIDER_UNAVAILABLE');
 if(!approval||Object.keys(approval).sort().join(',')!=='paidApproved,quote,shareApproved'
  ||approval.shareApproved!==true||approval.paidApproved!==quote.paid||digest(approval.quote)!==digest(quote))fail('ROOM_PROVIDER_APPROVAL_REQUIRED');
 return {model:config.entries.find(m=>m.id===modelId),quote};
}
async function boundedJson(response){
 if(!response.body)fail('ROOM_PROVIDER_RESPONSE_INVALID');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>131072)fail('ROOM_PROVIDER_RESPONSE_LIMIT');parts.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const data=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));
 try{return JSON.parse(data);}catch{fail('ROOM_PROVIDER_RESPONSE_INVALID');}
}
function safeId(value){return typeof value==='string'&&/^[A-Za-z0-9._:/-]{1,200}$/.test(value)?value:null;}
function usage(value,keys){
 const result={};for(const key of keys){if(Number.isSafeInteger(value?.[key])&&value[key]>=0)result[key]=value[key];}return result;
}
/** One bounded official request. No retry, redirects, fallback, tools or raw error output. */
export async function callProvider(model,prompt,operationId,{request=fetch,timeoutMs=20000}={}){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const zai=model.provider==='zai';
  const url=zai?'https://api.z.ai/api/paas/v4/chat/completions'
   :'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
  const body=zai?{model:model.model,messages:[{role:'user',content:prompt}],stream:false,max_tokens:MAX_OUTPUT,thinking:{type:'disabled'},request_id:operationId}
   :{contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{candidateCount:1,maxOutputTokens:MAX_OUTPUT,thinkingConfig:{thinkingLevel:'MINIMAL',includeThoughts:false}}};
  const response=await request(url,{method:'POST',redirect:'error',cache:'no-store',signal:controller.signal,
   headers:{'Content-Type':'application/json',...(zai?{Authorization:'Bearer '+model.key}:{'x-goog-api-key':model.key})},body:JSON.stringify(body)});
  if(!response.ok){await response.body?.cancel().catch(()=>{});return {state:'unknown',code:response.status===429?'RATE_LIMITED':'PROVIDER_REJECTED',httpStatus:response.status};}
  const data=await boundedJson(response);let text,complete,reportedModel,providerId,tokens;
  if(zai){
   const choice=data.choices?.[0];
   if(data.choices?.length!==1||choice?.message?.role!=='assistant'||choice?.message?.tool_calls?.length||data.model!==model.model)fail('ROOM_PROVIDER_RESPONSE_INVALID');
   text=choice.message.content;complete=choice.finish_reason==='stop';reportedModel=data.model;providerId=safeId(data.id);
   tokens=usage(data.usage,['prompt_tokens','completion_tokens','total_tokens']);
  }else{
   const candidate=data.candidates?.[0],parts=candidate?.content?.parts;
   if(data.candidates?.length!==1||candidate?.content?.role!=='model'||!Array.isArray(parts)||!parts.length
    ||parts.some(p=>typeof p.text!=='string'||p.thought===true||(p.thoughtSignature!==undefined&&typeof p.thoughtSignature!=='string')||Object.keys(p).some(k=>!['text','thought','thoughtSignature'].includes(k))))fail('ROOM_PROVIDER_RESPONSE_INVALID');
   // Version suffixes are reported separately; participant identity remains the requested model.
   reportedModel=safeId(data.modelVersion);
   if(!reportedModel||!(reportedModel===model.model||reportedModel.startsWith(model.model+'-')))fail('ROOM_PROVIDER_MODEL_MISMATCH');
   text=parts.map(p=>p.text).join('');complete=candidate.finishReason==='STOP';providerId=safeId(data.responseId);
   tokens=usage(data.usageMetadata,['promptTokenCount','candidatesTokenCount','totalTokenCount']);
  }
  if(typeof text!=='string'||!text.trim()||!text.isWellFormed()||Buffer.byteLength(text)>48000)fail('ROOM_PROVIDER_RESPONSE_INVALID');
  return {state:'draft',text,textSha256:digest(text),complete,reportedModel,providerId,usage:tokens};
 }catch{return {state:'unknown',code:controller.signal.aborted?'PROVIDER_TIMEOUT':'PROVIDER_RESPONSE_UNCERTAIN'};}
 finally{clearTimeout(timer);}
}
