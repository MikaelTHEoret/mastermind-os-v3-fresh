import {RoomStore,ROOM_UPDATE_SQL} from './store.mjs';
import {RoomError,digest,exact,identifier,roomCommand} from './contract.mjs';
import {providerConfiguration,publicModels,quoteFor,validateApproval,callProvider} from './providers.mjs';
import {roomEnvironment,renewalOffer,prepareRoomRenewal} from './renewal.mjs';

const fail=(code,status=409)=>{throw new RoomError(code,status);};
const common=['operationId','expectedRevision','action','turnId','promptSha256'];
export class ProviderRoomStore extends RoomStore {
 constructor(query,owner,{environment=()=>process.env,request=fetch,now=()=>Date.now()}={}){
  super(query,owner);this.environment=environment;this.request=request;this.now=now;
 }
 configuration(doc){
  const env=this.environment(),now=this.now();
  return providerConfiguration(doc?roomEnvironment(env,this.owner,doc.room.participants,doc.room.connectionRenewal,now):env,this.owner,now);
 }
 async list(ref){return {...await super.list(ref),providers:publicModels(this.configuration())};}
 view(doc,state){
  const view=super.view(doc,state),config=this.configuration(doc);
  view.providers=publicModels(config);
  view.connection={expiresAt:config.expiresAt,source:doc.room.connectionRenewal?'room':'server',checkedAt:new Date(this.now()).toISOString(),
   renewal:renewalOffer(this.environment(),this.owner,doc.room.participants,this.now())};
  const active=doc.room.activeTurn&&doc.room.turns[doc.room.activeTurn];
  const participant=doc.room.participants.find(p=>p.id===active?.participantId);
  view.providerQuote=participant?.transport==='api'&&active?.status==='prepared'?quoteFor(config,participant.model,active.prompt):null;
  return view;
 }
 async command(ref,command){
  if(command?.action==='renew-connection')return this.renew(ref,command);
  if(command?.action==='provider-send')return this.send(ref,command);
  if(command?.action==='provider-review')return this.review(ref,command);
  return super.command(ref,command);
 }
 async renew(ref,command){
  exact(command,['operationId','expectedRevision','action','scopeDigest','reviewConfirmed','geminiFreeTierConfirmed']);
  identifier(command.operationId);
  const before=await this.load(ref);
  if(!before.document)fail('ROOM_NOT_FOUND',404);
  if(this.replay(before.document,command))return this.view(before.document,before.state);
  if(before.state!=='active')fail('ROOM_TASK_READ_ONLY');
  if(['closed','running','awaiting_approval'].includes(before.document.status))fail('ROOM_CONVERSATION_BUSY');
  const room=before.document.room;
  if(!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision!==room.revision)fail('ROOM_REVISION_CONFLICT');
  if(Object.keys(room.operations).length>=240)fail('ROOM_COMMAND_LIMIT');
  if(room.activeTurn&&room.turns[room.activeTurn]?.status!=='prepared')fail('ROOM_RENEWAL_TURN_PENDING');
  const doc=structuredClone(before.document);
  doc.room.connectionRenewal=prepareRoomRenewal(this.environment(),this.owner,room.participants,command,this.now());
  doc.room.revision++;doc.updatedAt=new Date(this.now()).toISOString();
  Object.defineProperty(doc.room.operations,command.operationId,{value:{digest:digest(command),result:{ok:true,revision:doc.room.revision,
   activeTurn:doc.room.activeTurn,executionAuthorized:false,replayed:false,connectionRenewal:structuredClone(doc.room.connectionRenewal)}},enumerable:true});
  await this.replace(ref,before.document,doc);
  const after=await this.load(ref);
  if(!this.replay(after.document,command))fail('ROOM_SAVE_CONFLICT');
  return this.view(after.document,after.state);
 }
 replay(doc,command){
  const prior=doc?.room?.operations?.[command.operationId];
  if(!Object.hasOwn(doc?.room?.operations??{},command.operationId))return false;
  if(prior.digest!==digest(command))fail('ROOM_OPERATION_CONFLICT');
  return true;
 }
 turn(doc,command){
  const turn=doc?.room?.turns?.[command.turnId];
  if(!turn||doc.room.activeTurn!==command.turnId||turn.promptSha256!==command.promptSha256
   ||digest(turn.prompt)!==turn.promptSha256)fail('ROOM_RECEIPT_MISMATCH');
  const participant=doc.room.participants.find(p=>p.id===turn.participantId);
  if(participant?.transport!=='api')fail('ROOM_PROVIDER_PARTICIPANT_REQUIRED');
  return {turn,participant};
 }
 async replace(ref,before,after){
  // Reserve space for the bounded provider draft and subsequent review receipt.
  if(Buffer.byteLength(JSON.stringify(after))>1900000)fail('ROOM_DOCUMENT_LIMIT');
  return this.query(ROOM_UPDATE_SQL,[...this.args(ref),JSON.stringify(after),JSON.stringify(before)]);
 }
 async send(ref,command){
  exact(command,[...common,'approval']);
  if(typeof command.operationId!=='string'||command.operationId.length>64)fail('ROOM_INVALID_ID',400);
  const before=await this.load(ref);
  if(!before.document)fail('ROOM_NOT_FOUND',404);
  if(this.replay(before.document,command))return this.view(before.document,before.state);
  if(before.state!=='active')fail('ROOM_TASK_READ_ONLY');
  const {turn,participant}=this.turn(before.document,command);
  const {quote}=validateApproval(this.configuration(before.document),participant.model,turn.prompt,command.approval);
  const doc=structuredClone(before.document);
  roomCommand(doc,{operationId:command.operationId,expectedRevision:command.expectedRevision,action:'dispatch',turnId:command.turnId,promptSha256:command.promptSha256});
  doc.room.operations[command.operationId].digest=digest(command);
  doc.room.turns[command.turnId].provider={operationId:command.operationId,modelId:participant.model,
   state:'reserved',quote,shareApproved:true,paidApproved:quote.paid,at:new Date(this.now()).toISOString()};
  if(Buffer.byteLength(JSON.stringify(doc))>1500000)fail('ROOM_DOCUMENT_LIMIT');
  // Only the caller that receives a successful CAS may progress. A lost DB acknowledgement
  // leaves a recoverable reservation but must NEVER authorize another provider call.
  const saved=await this.replace(ref,before.document,doc);
  if(saved.length!==1){const current=await this.load(ref);
   if(this.replay(current.document,command))return this.view(current.document,current.state);
   fail('ROOM_SAVE_CONFLICT');}
  const current=await this.load(ref),active=current.document?.room?.turns?.[command.turnId];
  if(current.state!=='active'||current.document.room.paused||active?.steeringPending||active?.cancelRequested
   ||active?.provider?.operationId!==command.operationId||active.provider.state!=='reserved'){
   await this.settle(ref,command,{state:'unknown',code:'STOPPED_BEFORE_REQUEST'});return this.read(ref);
  }
  // Re-check the credential/owner/policy after reservation and before the send fence.
  let model;
  try{({model}=validateApproval(this.configuration(current.document),participant.model,turn.prompt,command.approval));}
  catch{await this.settle(ref,command,{state:'unknown',code:'CONNECTION_CHANGED_BEFORE_REQUEST'});return this.read(ref);}
  const sending=structuredClone(current.document);
  sending.room.turns[command.turnId].status='awaiting-reply';
  Object.assign(sending.room.turns[command.turnId].provider,{state:'sending',at:new Date(this.now()).toISOString()});
  sending.room.revision++;
  // Concurrent pause, steering or owner revocation prevents this CAS. No model call follows.
  if((await this.replace(ref,current.document,sending)).length!==1){
   await this.settle(ref,command,{state:'unknown',code:'ROOM_CHANGED_BEFORE_REQUEST'});return this.read(ref);
  }
  const result=await callProvider(model,turn.prompt,command.operationId,{request:this.request});
  await this.settle(ref,command,result);
  return this.read(ref);
 }
 async settle(ref,command,result){
  // These bounded retries save a known result only. They never repeat network generation.
  for(let attempt=0;attempt<3;attempt++){
   const current=await this.load(ref),turn=current.document?.room?.turns?.[command.turnId];
   if(current.state!=='active')fail('ROOM_TASK_READ_ONLY');
   if(turn?.provider?.operationId!==command.operationId)fail('ROOM_RECEIPT_MISMATCH');
   if(!['reserved','sending'].includes(turn.provider.state))return;
   const doc=structuredClone(current.document),target=doc.room.turns[command.turnId];
   Object.assign(target.provider,result,{observedAt:new Date(this.now()).toISOString()});
   target.status=result.state==='draft'?'awaiting-reply':'unknown';
   doc.room.revision++;doc.updatedAt=new Date(this.now()).toISOString();
   if((await this.replace(ref,current.document,doc)).length===1)return;
  }
  fail('ROOM_PROVIDER_RESULT_SAVE_UNCERTAIN',503);
 }
 async review(ref,command){
  exact(command,[...common,'responseSha256','reviewed']);
  const before=await this.load(ref);
  if(this.replay(before.document,command))return this.view(before.document,before.state);
  if(before.state!=='active')fail('ROOM_TASK_READ_ONLY');
  const {turn}=this.turn(before.document,command),draft=turn.provider;
  if(command.reviewed!==true||draft?.state!=='draft'||draft.textSha256!==command.responseSha256
   ||digest(draft.text)!==command.responseSha256)fail('ROOM_PROVIDER_REVIEW_REQUIRED');
  const doc=structuredClone(before.document);
  roomCommand(doc,{operationId:command.operationId,expectedRevision:command.expectedRevision,action:'reply',turnId:command.turnId,
   promptSha256:command.promptSha256,text:draft.text,capture:draft.complete?'adapter-complete':'incomplete',
   evidence:`Official API: ${draft.modelId}; reported model: ${draft.reportedModel}; request: ${draft.providerId??'not supplied'}; operation: ${draft.operationId}. Original visible text reviewed by owner.`});
  doc.room.operations[command.operationId].digest=digest(command);
  doc.room.turns[command.turnId].provider.state='saved';
  // Retain the response hash/receipt, with text stored once in the existing transcript.
  delete doc.room.turns[command.turnId].provider.text;
  await this.replace(ref,before.document,doc);
  const after=await this.load(ref);
  if(!this.replay(after.document,command))fail('ROOM_SAVE_CONFLICT');
  return this.view(after.document,after.state);
 }
}
