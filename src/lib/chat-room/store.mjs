import {RoomError,identifier,newDocument,roomCommand,exact} from './contract.mjs';
const fail=(code,status=403)=>{throw new RoomError(code,status);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE=/^[a-z0-9][a-z0-9._:-]{0,127}$/;
// The current Clerk -> operator mapping is checked in EVERY read and mutation statement.
const OWNED=`SELECT t.task_id,t.state FROM public.mastermind_context_tasks_v1 t
 JOIN public.mastermind_player_external_identities_v1 i
 ON i.household_id=t.household_id AND i.player_id=t.actor_player_id
 WHERE t.task_id=$2::uuid AND t.project_id=$3::text AND t.household_id=$4::text
 AND t.actor_player_id=$5::uuid AND i.provider='clerk' AND i.provider_subject=$6::text
 AND public.verify_mastermind_memory_operator_v1(t.household_id,t.actor_player_id)`;
const BOUND=`s.context->'chat'->'roomAccess' = jsonb_build_object(
 'householdId',$4::text,'actorPlayerId',$5::text,'taskId',$2::text,'project',$3::text)
 AND s.context->'chat'->>'format'='mastermind-chat-v1'
 AND s.context->'chat'->'room'->>'format'='mastermind-room-v1'`;
export const ROOM_READ_SQL=`WITH owned AS (${OWNED})
 SELECT o.state, s.context->'chat' AS document FROM owned o
 LEFT JOIN public.mirror_core_sessions s ON s.id=$1::text AND ${BOUND}`;
export const ROOM_CREATE_SQL=`WITH owned AS (${OWNED} AND t.state='active' FOR UPDATE OF t)
 INSERT INTO public.mirror_core_sessions(id,context,state,created_at,updated_at)
 SELECT $1::text,jsonb_build_object('chat',$7::jsonb),jsonb_build_object('chatStatus','active'),NOW(),NOW() FROM owned
 ON CONFLICT(id) DO NOTHING RETURNING id`;
export const ROOM_UPDATE_SQL=`WITH owned AS (${OWNED} AND t.state='active' FOR UPDATE OF t)
 UPDATE public.mirror_core_sessions s SET context=COALESCE(s.context,'{}'::jsonb)||jsonb_build_object('chat',$7::jsonb),
 state=COALESCE(s.state,'{}'::jsonb)||jsonb_build_object('chatStatus','active'),updated_at=NOW()
 FROM owned WHERE s.id=$1::text AND ${BOUND} AND s.context->'chat'=$8::jsonb RETURNING s.id`;
export const ROOM_LIST_SQL=`WITH owned AS (${OWNED} AND $1::text='room-list')
 SELECT o.state AS "taskState",r.* FROM owned o LEFT JOIN LATERAL (
 SELECT s.id AS session,s.updated_at AS "updatedAt",
 LEFT(COALESCE(s.context->'chat'->'transcript'->0->>'text',''),120) AS preview,
 s.context->'chat'->'room'->'participants' AS participants,
 s.context->'chat'->'room'->>'paused' AS paused
 FROM public.mirror_core_sessions s WHERE ${BOUND}
 ORDER BY s.updated_at DESC,s.id DESC LIMIT 51) r ON true`;

export class RoomStore {
 constructor(query,{householdId,actorPlayerId,subject}) {
  if(typeof query!=='function'||!SAFE.test(householdId)||!UUID.test(actorPlayerId)
   ||typeof subject!=='string'||!/^user_[A-Za-z0-9_-]{1,123}$/.test(subject)) fail('ROOM_IDENTITY_INVALID');
  this.query=query;this.owner={householdId,actorPlayerId,subject};
 }
 args(ref){
  exact(ref,['session','taskId','project']);identifier(ref.session);
  if(typeof ref.taskId!=='string'||typeof ref.project!=='string'||!UUID.test(ref.taskId)||!SAFE.test(ref.project))fail('ROOM_REFERENCE_INVALID',400);
  return [ref.session,ref.taskId,ref.project,this.owner.householdId,this.owner.actorPlayerId,this.owner.subject];
 }
 async load(ref){
  const rows=await this.query(ROOM_READ_SQL,this.args(ref));
  if(rows.length!==1)fail('ROOM_TASK_ACCESS_DENIED');
  const {document,state}=rows[0];
  if(document && (document.session!==ref.session || document.room?.format!=='mastermind-room-v1'))fail('ROOM_STORED_INVALID',503);
  return {document,state};
 }
 async read(ref){
  const {document,state}=await this.load(ref);
  if(!document)fail('ROOM_NOT_FOUND',404);
  return this.view(document,state);
 }
 async list(ref){
  exact(ref,['taskId','project']);
  const rows=await this.query(ROOM_LIST_SQL,this.args({session:'room-list',...ref}));
  if(!rows.length)fail('ROOM_TASK_ACCESS_DENIED');
  const rooms=rows.filter(row=>row.session!==null).map(row=>({session:identifier(row.session),
   updatedAt:row.updatedAt,preview:row.preview,participants:row.participants,paused:row.paused==='true'}));
  return {ok:true,...ref,taskState:rows[0].taskState,rooms:rooms.slice(0,50),truncated:rooms.length>50,executionAuthorized:false};
 }
 view(doc,taskState){
  return {ok:true,session:doc.session,project:doc.project,taskId:doc.roomAccess.taskId,taskState,
   transcript:structuredClone(doc.transcript),room:structuredClone(doc.room),
   executionAuthorized:false,capabilities:{automaticDispatch:false,manualTransfer:true,midTurnSteering:false}};
 }
 manualProfile(doc,command){
  if(command.action==='reply'&&command.capture==='adapter-complete')fail('ROOM_ADAPTER_RECEIPT_UNSUPPORTED',409);
  if(['dispatch','acknowledge','uncertain','not-sent','reply'].includes(command.action)){
   const turn=doc.room?.turns?.[command.turnId];
   const participant=doc.room?.participants.find(p=>p.id===turn?.participantId);
   if(participant?.transport!=='manual')fail('ROOM_AUTOMATIC_TRANSPORT_UNAVAILABLE',409);
  }
 }
 async command(ref,command){
  if(!command||typeof command!=='object'||Array.isArray(command))fail('ROOM_INVALID_COMMAND',400);
  const before=await this.load(ref);
  if(before.state!=='active')fail('ROOM_TASK_READ_ONLY',409);
  const doc=before.document?structuredClone(before.document):newDocument(ref.session);
  this.manualProfile(doc,command);
  const result=roomCommand(doc,command);
  if(result.replayed)return {...this.view(doc,before.state),result};
  if(!before.document){
   doc.project=ref.project;
   doc.roomAccess={householdId:this.owner.householdId,actorPlayerId:this.owner.actorPlayerId,taskId:ref.taskId,project:ref.project};
  }
  const sql=before.document?ROOM_UPDATE_SQL:ROOM_CREATE_SQL;
  const params=[...this.args(ref),JSON.stringify(doc),...(before.document?[JSON.stringify(before.document)]:[])];
  const saved=await this.query(sql,params);
  // Re-read through current ownership. A network failure never triggers another write.
  const after=await this.load(ref);
  if(!after.document)fail('ROOM_SAVE_CONFLICT',409);
  const recovered=structuredClone(after.document);
  this.manualProfile(recovered,command);
  const replay=roomCommand(recovered,command);
  if(!replay.replayed)fail('ROOM_SAVE_CONFLICT',409);
  return {...this.view(after.document,after.state),result:saved.length?result:replay};
 }
}
