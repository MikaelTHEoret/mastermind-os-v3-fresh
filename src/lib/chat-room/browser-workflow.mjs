// Browser-only journal and view validation. Provider dispatch is never performed here.
const PREFIX='mastermind.room.pending.v1.';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/;
export function roomRef(ref){
 if(!ref||typeof ref.taskId!=='string'||!UUID.test(ref.taskId)||typeof ref.session!=='string'||!ID.test(ref.session))throw Error('Invalid saved room reference.');
 return {taskId:ref.taskId,session:ref.session};
}
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
async function digest(v){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export function roomText(value,limit){
 if(typeof value!=='string'||!value.trim()||!value.isWellFormed()||new TextEncoder().encode(value).length>limit)throw Error('This text is empty or too long. Shorten it before saving.');
 return value;
}
function participants(values){
 if(!Array.isArray(values)||!values.length||values.length>6)throw Error('Invalid participant list.');
 const ids=new Set();
 for(const p of values){if(!p||typeof p.id!=='string'||!ID.test(p.id)||p.id==='user_owner'||ids.has(p.id))throw Error('Invalid participant identity.');
  ids.add(p.id);roomText(p.label,120);roomText(p.model,160);if(!['manual','browser','subscription-cli','local'].includes(p.transport))throw Error('Invalid participant connection.');}
 return values;
}
export function checkedRoom(value,ref){
 roomRef(ref);
 const room=value?.room;
 if(value?.ok!==true||value.executionAuthorized!==false||value.taskId!==ref.taskId||value.session!==ref.session||value.project!=='mastermind'
  ||!['active','blocked','completed'].includes(value.taskState)||room?.format!=='mastermind-room-v1'
  ||!Number.isSafeInteger(room.revision)||room.revision<1||!Array.isArray(value.transcript)||value.transcript.length>256
  ||typeof room.paused!=='boolean'||!Array.isArray(room.pendingMessages)||!room.turns||!room.operations
  ||value.capabilities?.automaticDispatch!==false||value.capabilities?.manualTransfer!==true||value.capabilities?.midTurnSteering!==false)throw Error('The saved room response is incomplete or belongs to different work.');
 const known=new Set(participants(room.participants).map(p=>p.id));
 const messageIds=new Set();
 for(const m of value.transcript){
  if(!m||!ID.test(m.messageId)||messageIds.has(m.messageId)||typeof m.text!=='string'||!Number.isFinite(Date.parse(m.at))
   ||!(m.who==='you'&&m.participantId==='user_owner'||m.who==='assistant'&&known.has(m.participantId)))throw Error('Invalid saved message.');
  if(m.who==='assistant'&&!['manual-complete','adapter-complete','incomplete'].includes(m.capture))throw Error('Invalid response provenance.');
  messageIds.add(m.messageId);
 }
 if(!room.pendingMessages.every(id=>messageIds.has(id)))throw Error('Invalid pending context.');
 if(room.activeTurn!==null){const t=room.turns[room.activeTurn];
  if(!t||!known.has(t.participantId)||!['prepared','dispatching','awaiting-reply','unknown'].includes(t.status)
   ||typeof t.prompt!=='string'||!/^[a-f0-9]{64}$/.test(t.promptSha256))throw Error('Invalid active turn.');}
 return value;
}
async function checkedIntegrity(value,ref){
 const view=checkedRoom(value,ref),turn=view.room.activeTurn&&view.room.turns[view.room.activeTurn];
 if(turn&&await digest(turn.prompt)!==turn.promptSha256)throw Error('The prepared prompt failed its integrity check.');
 return view;
}
export function checkedRoomList(value,taskId){
 if(value?.ok!==true||value.executionAuthorized!==false||value.taskId!==taskId||value.project!=='mastermind'
  ||!Array.isArray(value.rooms)||value.rooms.length>50||typeof value.truncated!=='boolean')throw Error('The room list is unavailable.');
 for(const row of value.rooms){roomRef({taskId,session:row.session});participants(row.participants);
  if(typeof row.preview!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))throw Error('Invalid room summary.');}
 return value;
}
export const roomErrorMessage=error=>{
 const code=error instanceof Error?error.message:String(error);
 const known={ROOM_SERVICE_NOT_ACTIVATED:'Shared rooms are not activated on this installation yet.',
  OWNER_REQUIRED:'Sign in as the Mastermind owner to use shared rooms.',OWNER_SESSION_REQUIRED:'Sign in to recover your rooms.',
  OWNER_GATE_NOT_CONFIGURED:'Owner sign-in is not configured on this installation.',ROOM_TASK_ACCESS_DENIED:'This account no longer has access to the selected task.',
  ROOM_REVISION_CONFLICT:'This room changed in another session. Recover the pending save and review the latest messages.',
  ROOM_TASK_READ_ONLY:'This task is read-only. Its conversation is still saved.',ROOM_TURN_LIMIT:'This room has reached its turn limit. Start a new room to continue.',
  ROOM_PENDING_CONTEXT_REQUIRED:'Include the pending user messages in the next turn.',ROOM_AUTOMATIC_TRANSPORT_UNAVAILABLE:'This connection is not available for automatic transfers yet.'};
 return known[code]??code;
};
export async function roomJson(url,init,request=fetch){
 const response=await request(url,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.body)throw Error('The room service returned no response.');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4400000)throw Error('The room response is too large.');parts.push(value);}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.byteLength;}
 const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!response.ok||body?.ok!==true){const e=new Error(typeof body?.error==='string'?body.error:body?.error?.code??'The room could not be loaded.');e.status=response.status;throw e;}
 return body;
}
export class RoomBrowserClient {
 constructor(storage,request=fetch){this.storage=storage;this.request=request;}
 pending(){
  const rows=[];
  for(let n=0;n<this.storage.length;n++){const key=this.storage.key(n);if(!key?.startsWith(PREFIX))continue;
   const raw=this.storage.getItem(key);if(!raw||raw.length>100000)throw Error('A pending room save is malformed.');
   const value=JSON.parse(raw);roomRef(value.ref);
   if(value.version!==1||!UUID.test(value.command?.operationId)||key!==PREFIX+value.command.operationId)throw Error('A pending room save is malformed.');
   rows.push(value);if(rows.length>32)throw Error('Too many pending room saves. Recover them before starting more.');
  }return rows;
 }
 endpoint(ref){roomRef(ref);return `/api/chat/rooms/${ref.taskId}/${ref.session}`;}
 async list(taskId){return checkedRoomList(await roomJson('/api/chat/rooms/'+taskId,undefined,this.request),taskId);}
 async load(ref){return checkedIntegrity(await roomJson(this.endpoint(ref),undefined,this.request),ref);}
 async submit(ref,command){
  roomRef(ref);if(!UUID.test(command?.operationId))throw Error('Invalid save identifier.');
  const record={version:1,ref:roomRef(ref),command},key=PREFIX+command.operationId,serialized=JSON.stringify(record);
  if(serialized.length>100000||new TextEncoder().encode(JSON.stringify(command)).length>65536)throw Error('This change is too large to save.');
  const previous=this.storage.getItem(key);
  if(previous&&previous!==serialized)throw Error('A saved operation cannot be replaced.');
  if(!previous&&this.pending().length>=32)throw Error('Too many pending room saves. Recover them before starting more.');
  this.storage.setItem(key,serialized); // Must succeed before network access.
  const value=await checkedIntegrity(await roomJson(this.endpoint(ref),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)},this.request),ref);
  if(value.room.operations[command.operationId]?.digest!==await digest(command))throw Error('The server did not confirm this exact change.');
  this.storage.removeItem(key);return value;
 }
 async recover(record){
  const {ref,command}=record;let view;
  try{view=await this.load(ref);}catch(e){if(e.status!==404)throw e;}
  const operation=view?.room.operations[command.operationId];
  if(operation){if(operation.digest!==await digest(command))throw Error('The saved operation contains different input.');
   this.storage.removeItem(PREFIX+command.operationId);return {view,state:'saved'};}
  // A newer revision fences this old command even if the original request is still arriving.
  if(view&&view.room.revision>command.expectedRevision){this.storage.removeItem(PREFIX+command.operationId);return {view,state:'superseded'};}
  return {view:await this.submit(ref,command),state:'saved'};
 }
}
