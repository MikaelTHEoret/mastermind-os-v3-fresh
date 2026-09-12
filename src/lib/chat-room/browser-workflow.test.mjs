import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {RoomBrowserClient,checkedRoomList} from './browser-workflow.mjs';
import {RoomStore,ROOM_READ_SQL,ROOM_CREATE_SQL,ROOM_UPDATE_SQL,ROOM_LIST_SQL} from './store.mjs';
const owner={householdId:'fixture',actorPlayerId:'20000000-1111-4111-8111-111111111111',subject:'user_fixture'};
const ref={taskId:'30000000-1111-4111-8111-111111111111',session:'room-session-001'};
const full={...ref,project:'mastermind'};
class Storage {
 data=new Map();get length(){return this.data.size;} key(n){return [...this.data.keys()][n];}
 getItem(k){return this.data.get(k)??null;} setItem(k,v){this.data.set(k,v);} removeItem(k){this.data.delete(k);}
}
function fixture(){
 const state={doc:null,posts:0,reads:0,writes:0,allowed:true,drop:false,offline:false,alter:null};
 const query=async(sql,p)=>{
  if(!state.allowed||p[5]!==owner.subject)return [];
  if(sql===ROOM_READ_SQL)return [{state:'active',document:structuredClone(state.doc)}];
  if(sql===ROOM_LIST_SQL)return state.doc?[{taskState:'active',session:ref.session,updatedAt:'2026-09-12T00:00:00Z',preview:state.doc.transcript[0]?.text??'',participants:state.doc.room.participants,paused:String(state.doc.room.paused)}]:[{taskState:'active',session:null}];
  if(sql===ROOM_CREATE_SQL&&state.doc||sql===ROOM_UPDATE_SQL&&JSON.stringify(state.doc)!==p[7])return [];
  state.doc=JSON.parse(p[6]);state.writes++;return [{id:p[0]}];
 };
 const store=new RoomStore(query,owner),storage=new Storage();
 const request=async(url,init)=>{
  if(init?.method==='POST')state.posts++;else state.reads++;
  if(state.offline)throw Error('offline');
  try{
   const value=init?.method==='POST'?await store.command(full,JSON.parse(init.body)):url.endsWith(ref.taskId)?await store.list({taskId:ref.taskId,project:'mastermind'}):await store.read(full);
   if(init?.method==='POST'&&state.drop){state.drop=false;throw Error('lost confirmation');}
   if(state.alter)state.alter(value);
   return Response.json(value);
  }catch(e){if(!e.status)throw e;return Response.json({ok:false,error:e.code},{status:e.status});}
 };
 return {state,store,storage,client:()=>new RoomBrowserClient(storage,request)};
}
const command=(action,expectedRevision,extra={})=>({operationId:randomUUID(),action,expectedRevision,...extra});
const creation=()=>command('create',0,{participants:[{id:'model_alpha',label:'Alpha',model:'fixture',transport:'manual'}],maxTurns:6});
const message=(revision,text='One saved message')=>command('message',revision,{text,disposition:'queue'});
test('a lost confirmation survives a new client and recovers with no duplicate write or POST',async()=>{
 const f=fixture();await f.client().submit(ref,creation());f.state.drop=true;
 await assert.rejects(f.client().submit(ref,message(1)),/lost confirmation/);
 const next=f.client(),[pending]=next.pending();assert.ok(pending);const before=f.state.posts;
 assert.equal((await next.recover(pending)).state,'saved');assert.equal(next.pending().length,0);
 assert.equal(f.state.posts,before);assert.equal(f.state.writes,2);assert.equal(f.state.doc.transcript.length,1);
});
test('an unsaved operation retries its original identifier after connection recovery',async()=>{
 const f=fixture(),c=creation();f.state.offline=true;await assert.rejects(f.client().submit(ref,c));
 const [pending]=f.client().pending();f.state.offline=false;const result=await f.client().recover(pending);
 assert.equal(result.view.room.revision,1);assert.ok(result.view.room.operations[c.operationId]);assert.equal(f.state.writes,1);
});
test('a newer saved revision fences a pending old command without resubmitting it',async()=>{
 const f=fixture();await f.client().submit(ref,creation());f.state.offline=true;
 await assert.rejects(f.client().submit(ref,message(1,'Old draft')));f.state.offline=false;
 await f.store.command(full,message(1,'Other session'));const before=f.state.posts;
 assert.equal((await f.client().recover(f.client().pending()[0])).state,'superseded');
 assert.equal(f.state.posts,before);assert.equal(f.client().pending().length,0);
});
test('storage failure prevents submission and another pending operation is not overwritten',async()=>{
 const f=fixture();f.storage.setItem=()=>{throw Error('storage unavailable');};
 await assert.rejects(f.client().submit(ref,creation()),/storage unavailable/);assert.equal(f.state.posts,0);
 const g=fixture();g.state.offline=true;
 await assert.rejects(g.client().submit(ref,creation()));await assert.rejects(g.client().submit({...ref,session:'another-room'},creation()));
 assert.equal(g.client().pending().length,2);
});
test('pending capacity refuses a new operation before network and preserves all originals',async()=>{
 const f=fixture();f.state.offline=true;
 for(let n=0;n<32;n++)await assert.rejects(f.client().submit(ref,creation()));
 assert.equal(f.client().pending().length,32);const before=f.state.posts;
 await assert.rejects(f.client().submit(ref,creation()),/Too many pending/);assert.equal(f.state.posts,before);
});
test('foreign views and altered prepared prompts are rejected',async()=>{
 const f=fixture();await f.client().submit(ref,creation());
 f.state.alter=v=>{v.taskId=randomUUID();};await assert.rejects(f.client().load(ref),/different work/);
 f.state.alter=null;const c=message(1);await f.client().submit(ref,c);
 await f.client().submit(ref,command('prepare',2,{participantId:'model_alpha',contextIds:[c.operationId]}));
 f.state.alter=v=>{v.room.turns[v.room.activeTurn].prompt+=' changed';};
 await assert.rejects(f.client().load(ref),/integrity check/);
});
test('wrong acknowledgment digest retains recoverable input; revocation blocks recovery',async()=>{
 const f=fixture(),c=creation();f.state.alter=v=>{v.room.operations[c.operationId].digest='0'.repeat(64);};
 await assert.rejects(f.client().submit(ref,c),/exact change/);assert.equal(f.client().pending().length,1);
 f.state.alter=null;f.state.allowed=false;await assert.rejects(f.client().recover(f.client().pending()[0]),e=>e.status===403);
 assert.equal(f.client().pending().length,1);f.state.allowed=true;await f.client().recover(f.client().pending()[0]);assert.equal(f.state.writes,1);
});
test('owned room listing includes empty tasks and never substitutes a foreign list',async()=>{
 const f=fixture();assert.deepEqual((await f.client().list(ref.taskId)).rooms,[]);
 await f.client().submit(ref,creation());await f.client().submit(ref,message(1));
 const list=await f.client().list(ref.taskId);assert.equal(list.rooms[0].preview,'One saved message');
 assert.throws(()=>checkedRoomList({...list,taskId:randomUUID()},ref.taskId));
 f.state.allowed=false;await assert.rejects(f.client().list(ref.taskId),e=>e.status===403);
});
