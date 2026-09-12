import assert from 'node:assert/strict';
import test from 'node:test';
import {newDocument,roomCommand,RoomError} from './contract.mjs';
import {RoomStore,ROOM_READ_SQL,ROOM_CREATE_SQL,ROOM_UPDATE_SQL} from './store.mjs';
export const owner={householdId:'fixture',actorPlayerId:'20000000-1111-4111-8111-111111111111',subject:'user_fixture'};
export const ref={session:'room-session-001',taskId:'30000000-1111-4111-8111-111111111111',project:'mastermind'};
const participant={id:'model_alpha',label:'Alpha',model:'owner-selected',transport:'manual'};
const create={operationId:'operation-0001',expectedRevision:0,action:'create',participants:[participant],maxTurns:6};
function sequence(){
 const doc=newDocument(ref.session),commands=[];
 const send=(action,extra={})=>{
  const c={operationId:`operation-${String(commands.length+1).padStart(4,'0')}`,expectedRevision:doc.room?.revision??0,action,...extra};
  const result=roomCommand(doc,c,()=> '2026-09-12T00:00:00+00:00');commands.push(c);return result;
 };
 send('create',{participants:[participant],maxTurns:6});
 const prepare=()=>{send('message',{text:'Discuss exact evidence. É 🧭',disposition:'queue'});
  send('prepare',{participantId:'model_alpha',contextIds:[commands.at(-1).operationId]});
  const turnId=commands.at(-1).operationId;return {turnId,promptSha256:doc.room.turns[turnId].promptSha256};};
 return {doc,commands,send,prepare};
}
test('uncertain send survives reload and identical replay never becomes a new dispatch',()=>{
 const s=sequence(),r=s.prepare();s.send('dispatch',r);const dispatch=s.commands.at(-1);
 s.send('uncertain',r);const restored=JSON.parse(JSON.stringify(s.doc)),before=structuredClone(restored);
 assert.equal(roomCommand(restored,dispatch).replayed,true);assert.deepEqual(restored,before);
 assert.throws(()=>s.send('dispatch',r),RoomError);
 s.send('reply',{...r,text:'Recovered answer',capture:'manual-complete',evidence:'Owner copy from original conversation'});
 assert.equal(s.doc.room.activeTurn,null);
});
test('steering preserves sent prompt, keeps authors distinct and must enter next context',()=>{
 const s=sequence(),r=s.prepare(),prompt=s.doc.room.turns[r.turnId].prompt;
 s.send('dispatch',r);s.send('message',{text:'Use revised scope',disposition:'steer'});const steer=s.commands.at(-1).operationId;
 s.send('reply',{...r,text:'Earlier answer',capture:'manual-complete',evidence:'Manual source'});const reply=s.commands.at(-1).operationId;
 assert.equal(s.doc.room.turns[r.turnId].prompt,prompt);
 assert.throws(()=>s.send('prepare',{participantId:'model_alpha',contextIds:[reply]}));
 s.send('prepare',{participantId:'model_alpha',contextIds:[steer,reply]});
 assert.match(s.doc.room.turns[s.doc.room.activeTurn].prompt,/user_owner/);
});
test('cancel, incomplete response and capacity preserve trustworthy unresolved state',()=>{
 const s=sequence(),r=s.prepare();s.send('dispatch',r);s.send('cancel');assert.equal(s.doc.room.activeTurn,r.turnId);
 s.send('reply',{...r,text:'Partial',capture:'incomplete',evidence:'Stopped midway'});
 assert.equal(s.doc.room.completedTurns,0);assert.equal(s.doc.room.paused,true);
 const b=sequence(),br=b.prepare();b.send('dispatch',br);
 while(Object.keys(b.doc.room.operations).length<240)b.send('pause');
 assert.throws(()=>b.send('message',{text:'More',disposition:'queue'}));
 b.send('uncertain',br);assert.throws(()=>b.send('uncertain',br));
 b.send('reply',{...br,text:'Late answer',capture:'manual-complete',evidence:'source'});assert.equal(b.doc.room.activeTurn,null);
});
test('invalid and changed commands are atomic; special object-key IDs are ordinary IDs',()=>{
 const s=sequence();const before=structuredClone(s.doc);
 assert.throws(()=>roomCommand(s.doc,{...create,maxTurns:2}));assert.deepEqual(s.doc,before);
 assert.throws(()=>s.send('message',{text:'\ud800',disposition:'queue'}));assert.deepEqual(s.doc,before);
 roomCommand(s.doc,{operationId:'constructor',expectedRevision:1,action:'message',text:'Kept',disposition:'queue'});
 assert.equal(Object.hasOwn(s.doc.room.operations,'constructor'),true);
});

function database(){
 const state={document:null,allowed:true,taskState:'active',writes:0,loseReply:false};
 const query=async(sql,params)=>{
  const allowed=state.allowed&&params[1]===ref.taskId&&params[3]===owner.householdId&&params[4]===owner.actorPlayerId&&params[5]===owner.subject;
  if(sql===ROOM_READ_SQL)return allowed?[{state:state.taskState,document:structuredClone(state.document)}]:[];
  if(!allowed||state.taskState!=='active')return [];
  if(sql===ROOM_CREATE_SQL&&state.document)return [];
  if(sql===ROOM_UPDATE_SQL&&JSON.stringify(state.document)!==params[7])return [];
  state.document=JSON.parse(params[6]);state.writes++;
  if(state.loseReply){state.loseReply=false;throw Error('Connection lost after commit');}
  return [{id:params[0]}];
 };return {state,query,store:()=>new RoomStore(query,owner)};
}
test('fresh hosted store recovers same room; duplicate create does not overwrite it',async()=>{
 const db=database();await db.store().command(ref,create);
 const loaded=await db.store().read(ref);assert.equal(loaded.room.revision,1);
 assert.equal((await db.store().command(ref,create)).result.replayed,true);assert.equal(db.state.writes,1);
});
test('racing different commands at one revision accept only one',async()=>{
 const db=database();await db.store().command(ref,create);
 const commands=['operation-0002','operation-0003'].map(operationId=>({operationId,expectedRevision:1,action:'message',text:operationId,disposition:'queue'}));
 const results=await Promise.allSettled(commands.map(c=>db.store().command(ref,c)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.state.document.transcript.length,1);
});
test('racing identical operations and lost replies recover without a second mutation',async()=>{
 const db=database();await db.store().command(ref,create);
 const c={operationId:'operation-0002',expectedRevision:1,action:'message',text:'One',disposition:'queue'};
 const results=await Promise.all([db.store().command(ref,c),db.store().command(ref,c)]);
 assert.equal(results.filter(r=>r.result.replayed).length,1);assert.equal(db.state.writes,2);
 db.state.loseReply=true;const next={...c,operationId:'operation-0003',expectedRevision:2,text:'Two'};
 await assert.rejects(db.store().command(ref,next));assert.equal(db.state.writes,3);
 assert.equal((await db.store().command(ref,next)).result.replayed,true);assert.equal(db.state.writes,3);
});
test('revoked or foreign identities cannot read, change or replay a room',async()=>{
 const db=database();await db.store().command(ref,create);db.state.allowed=false;
 await assert.rejects(db.store().read(ref),e=>e.status===403);
 await assert.rejects(db.store().command(ref,create),e=>e.status===403);
 db.state.allowed=true;
 await assert.rejects(new RoomStore(db.query,{...owner,subject:'user_foreign'}).read(ref),e=>e.status===403);
 db.state.taskState='completed';assert.equal((await db.store().read(ref)).taskState,'completed');
 await assert.rejects(db.store().command(ref,create),e=>e.status===409);
});
test('hosted manual profile cannot claim automatic execution or verified adapter receipts',async()=>{
 const db=database();await db.store().command(ref,create);
 const message={operationId:'operation-0002',expectedRevision:1,action:'message',text:'Hello',disposition:'queue'};
 await db.store().command(ref,message);
 await db.store().command(ref,{operationId:'operation-0003',expectedRevision:2,action:'prepare',participantId:'model_alpha',contextIds:[message.operationId]});
 const turnId='operation-0003',promptSha256=db.state.document.room.turns[turnId].promptSha256;
 await db.store().command(ref,{operationId:'operation-0004',expectedRevision:3,action:'dispatch',turnId,promptSha256});
 await assert.rejects(db.store().command(ref,{operationId:'operation-0005',expectedRevision:4,action:'reply',turnId,promptSha256,text:'Claim',capture:'adapter-complete',evidence:'Unverified assertion'}));
 assert.equal(db.state.writes,4);
});
