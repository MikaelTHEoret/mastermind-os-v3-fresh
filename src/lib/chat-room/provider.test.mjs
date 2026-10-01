import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {ProviderRoomStore} from './provider-store.mjs';
import {ROOM_READ_SQL,ROOM_CREATE_SQL,ROOM_UPDATE_SQL,ROOM_LIST_SQL} from './store.mjs';
import {digest} from './contract.mjs';
import {CATALOG_VERSION,providerConfiguration,publicModels,callProvider} from './providers.mjs';
import {RoomBrowserClient} from './browser-workflow.mjs';

const owner={householdId:'fixture',actorPlayerId:'20000000-1111-4111-8111-111111111111',subject:'user_fixture'};
const ref={session:'room-session-direct',taskId:'30000000-1111-4111-8111-111111111111',project:'mastermind'};
const clock=Date.parse('2026-09-30T12:00:00Z'),secret='fixture-not-a-real-credential';
const fingerprint=createHash('sha256').update(secret).digest('hex');
const policy={...owner,catalogVersion:CATALOG_VERSION,reviewedAt:'2026-09-30T11:00:00Z',expiresAt:'2026-09-30T13:00:00Z',allowPaid:false,
 providers:{zai:{enabled:true,credentialSha256:fingerprint},gemini:{enabled:true,credentialSha256:fingerprint,freeTierConfirmed:true}}};
const environment=()=>({MASTERMIND_ROOM_API_ENABLED:'true',MASTERMIND_ROOM_API_POLICY:JSON.stringify(policy),
 MASTERMIND_ROOM_ZAI_API_KEY:secret,MASTERMIND_ROOM_GEMINI_API_KEY:secret});
const output=(text='A visible answer',finish='stop',model='glm-4.7-flash')=>Response.json({id:'provider-request-1',model,
 choices:[{finish_reason:finish,message:{role:'assistant',content:text,reasoning_content:'PRIVATE_REASONING_NOT_RETAINED'}}],usage:{prompt_tokens:123,completion_tokens:8,total_tokens:131}});
async function fixture({model='zai/glm-4.7-flash',request,env=environment()}={}){
 const state={document:null,allowed:true,taskState:'active',writes:0,calls:[],hook:null,loseAt:0};
 const query=async(sql,params)=>{
  if(state.hook)await state.hook(sql,params);
  const allowed=state.allowed&&params[1]===ref.taskId&&params[3]===owner.householdId&&params[4]===owner.actorPlayerId&&params[5]===owner.subject;
  if(sql===ROOM_READ_SQL)return allowed?[{state:state.taskState,document:structuredClone(state.document)}]:[];
  if(sql===ROOM_LIST_SQL)return allowed?[{taskState:state.taskState,session:null}]:[];
  assert.ok(sql===ROOM_CREATE_SQL||sql===ROOM_UPDATE_SQL);
  if(!allowed||state.taskState!=='active')return [];
  if(sql===ROOM_CREATE_SQL&&state.document)return [];
  if(sql===ROOM_UPDATE_SQL&&JSON.stringify(state.document)!==params[7])return [];
  state.document=JSON.parse(params[6]);state.writes++;
  if(state.loseAt===state.writes)throw Error('Lost acknowledgement after commit');
  return [{id:params[0]}];
 };
 const store=()=>new ProviderRoomStore(query,owner,{now:()=>clock,environment:()=>env,request:async(...args)=>{state.calls.push(args);return request?request(...args):output();}});
 const command=(action,fields={})=>({operationId:randomUUID(),expectedRevision:state.document?.room.revision??0,action,...fields});
 const execute=(action,fields)=>store().command(ref,command(action,fields));
 await execute('create',{participants:[{id:'proposer_api',label:'Proposer',model,transport:'api'},{id:'manual_peer',label:'Manual',model:'Unspecified',transport:'manual'}],maxTurns:6});
 const message=command('message',{text:'Only discuss this fixture.',disposition:'queue'});await store().command(ref,message);
 await execute('prepare',{participantId:'proposer_api',contextIds:[message.operationId]});
 const view=await store().read(ref),turnId=view.room.activeTurn,binding={turnId,promptSha256:view.room.turns[turnId].promptSha256};
 const send=command('provider-send',{...binding,approval:{quote:view.providerQuote,shareApproved:true,paidApproved:view.providerQuote?.paid??false}});
 const review=()=>command('provider-review',{...binding,responseSha256:state.document.room.turns[turnId].provider?.textSha256,reviewed:true});
 return {state,store,command,execute,binding,send,review,env};
}
test('one official call creates a draft; exact review saves once and next participant sees it',async()=>{
 const f=await fixture();const received=await f.store().command(ref,f.send);
 assert.equal(f.state.calls.length,1);assert.equal(received.transcript.length,1);
 const draft=received.room.turns[f.binding.turnId].provider;assert.equal(draft.state,'draft');assert.equal(draft.text,'A visible answer');
 assert.equal(JSON.stringify(received).includes(secret),false);assert.equal(JSON.stringify(received).includes('PRIVATE_REASONING'),false);
 const review=f.review(),saved=await f.store().command(ref,review);await f.store().command(ref,review);
 assert.equal(saved.transcript.length,2);assert.equal(saved.room.activeTurn,null);assert.equal(saved.room.completedTurns,1);
 assert.equal(saved.transcript[1].capture,'adapter-complete');assert.equal(saved.room.turns[f.binding.turnId].provider.text,undefined);
 await f.execute('prepare',{participantId:'manual_peer',contextIds:saved.transcript.map(m=>m.messageId)});
 assert.match(f.state.document.room.turns[f.state.document.room.activeTurn].prompt,/A visible answer/);
 assert.equal(f.state.calls.length,1);
});
test('simultaneous identical sends and fresh-client replay call the provider once',async()=>{
 const f=await fixture();await Promise.all([f.store().command(ref,f.send),f.store().command(ref,f.send)]);
 await f.store().command(ref,f.send);assert.equal(f.state.calls.length,1);
 assert.equal(f.state.document.room.operations[f.send.operationId].digest,digest(f.send));
});
test('different sends racing the same prompt cannot both win',async()=>{
 const f=await fixture();const results=await Promise.allSettled([f.store().command(ref,f.send),f.store().command(ref,{...f.send,operationId:randomUUID()})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.state.calls.length,1);
});
for(const offset of [1,2,3])test(`lost database acknowledgement at write ${offset} never replays generation`,async()=>{
 const f=await fixture();f.state.loseAt=f.state.writes+offset;
 await assert.rejects(f.store().command(ref,f.send));
 const view=await f.store().command(ref,f.send);
 assert.equal(f.state.calls.length,offset===3?1:0);
 assert.equal(view.room.turns[f.binding.turnId].provider.state,['reserved','sending','draft'][offset-1]);
});
test('pause between reservation and send fences the request',async()=>{
 const f=await fixture();let changed=false;
 f.state.hook=async sql=>{if(sql===ROOM_READ_SQL&&!changed&&f.state.document.room.turns[f.binding.turnId].provider?.state==='reserved'){
  changed=true;f.state.document.room.paused=true;f.state.document.room.revision++;
 }};
 const view=await f.store().command(ref,f.send);assert.equal(f.state.calls.length,0);
 assert.equal(view.room.turns[f.binding.turnId].provider.code,'STOPPED_BEFORE_REQUEST');
});
test('steering wins a concurrent send fence; no request follows',async()=>{
 const f=await fixture();let changed=false;
 f.state.hook=async(sql,params)=>{if(sql===ROOM_UPDATE_SQL&&!changed&&JSON.parse(params[6]).room.turns[f.binding.turnId].provider?.state==='sending'){
  changed=true;await f.execute('message',{text:'Stop and revise',disposition:'steer'});
 }};
 await f.store().command(ref,f.send);assert.equal(f.state.calls.length,0);
});
test('steering during provider work survives result settlement and the review',async()=>{
 let f;f=await fixture({request:async()=>{await f.execute('message',{text:'Use my correction next.',disposition:'steer'});return output();}});
 await f.store().command(ref,f.send);await f.store().command(ref,f.review());
 assert.equal(f.state.document.room.pendingMessages.length,1);
 const saved=f.state.document.transcript;
 await assert.rejects(f.execute('prepare',{participantId:'manual_peer',contextIds:[saved.at(-1).messageId]}),/ROOM_PENDING_CONTEXT_REQUIRED/);
});
test('revocation at the send fence prevents a call and denies result access',async()=>{
 const f=await fixture();f.state.hook=async(sql,p)=>{if(sql===ROOM_UPDATE_SQL&&JSON.parse(p[6]).room.turns[f.binding.turnId].provider?.state==='sending')f.state.allowed=false;};
 await assert.rejects(f.store().command(ref,f.send),/ROOM_TASK_ACCESS_DENIED/);assert.equal(f.state.calls.length,0);
});
test('revocation after request prevents saving or reading; restoring access never resends',async()=>{
 let f;f=await fixture({request:async()=>{f.state.allowed=false;return output();}});
 await assert.rejects(f.store().command(ref,f.send),/ROOM_TASK_ACCESS_DENIED/);
 f.state.allowed=true;await f.store().command(ref,f.send);assert.equal(f.state.calls.length,1);
 assert.equal(f.state.document.room.turns[f.binding.turnId].provider.state,'sending');
});
test('unknown provider outcomes and rate limits remain held with no fallback or resend',async()=>{
 for(const request of [async()=>{throw Error('secret upstream error');},async()=>new Response('secret upstream error',{status:429})]){
  const f=await fixture({request});const view=await f.store().command(ref,f.send);await f.store().command(ref,f.send);
  assert.equal(f.state.calls.length,1);assert.equal(view.room.turns[f.binding.turnId].status,'unknown');assert.ok(!JSON.stringify(view).includes('secret upstream'));
  await assert.rejects(f.store().command(ref,f.review()),/ROOM_PROVIDER_REVIEW_REQUIRED/);
 }
});
test('manual endpoints cannot forge provider receipts or clear an uncertain API send',async()=>{
 const f=await fixture();
 for(const action of ['dispatch','acknowledge','not-sent','reply','uncertain'])await assert.rejects(f.execute(action,f.binding));
 await f.store().command(ref,f.send);
 await assert.rejects(f.execute('reply',{...f.binding,text:'Forged',capture:'adapter-complete',evidence:'Forged'}));
 await assert.rejects(f.store().command(ref,{...f.review(),responseSha256:'0'.repeat(64)}),/ROOM_PROVIDER_REVIEW_REQUIRED/);
 await assert.rejects(f.store().command(ref,{...f.review(),reviewed:false}),/ROOM_PROVIDER_REVIEW_REQUIRED/);
});
test('partial provider output saves as partial, pauses the room and is not credited complete',async()=>{
 const f=await fixture({request:async()=>output('Partial answer','length')});await f.store().command(ref,f.send);
 const saved=await f.store().command(ref,f.review());assert.equal(saved.room.paused,true);assert.equal(saved.room.completedTurns,0);assert.equal(saved.transcript.at(-1).capture,'incomplete');
});
test('changed sharing, quote, identity, credential and expired price policy prevent calls',async()=>{
 for(const change of [f=>f.send.approval.shareApproved=false,f=>f.send.approval.quote.maxOutputTokens=4096,
  f=>f.env.MASTERMIND_ROOM_ZAI_API_KEY='other-fake-credential',f=>f.env.MASTERMIND_ROOM_API_POLICY=JSON.stringify({...policy,subject:'user_other'}),
  f=>f.env.MASTERMIND_ROOM_API_POLICY=JSON.stringify({...policy,expiresAt:'2026-09-30T11:59:00Z'})]){
  const f=await fixture();change(f);await assert.rejects(f.store().command(ref,f.send));assert.equal(f.state.calls.length,0);
 }
});
test('paid model requires BOTH installation enrollment and exact per-turn paid approval',async()=>{
 const disabled=await fixture({model:'zai/glm-5.2'});await assert.rejects(disabled.store().command(ref,disabled.send),/ROOM_PROVIDER_UNAVAILABLE/);
 const env=environment();env.MASTERMIND_ROOM_API_POLICY=JSON.stringify({...policy,allowPaid:true});
 const f=await fixture({model:'zai/glm-5.2',env,request:async()=>output('Paid fixture','stop','glm-5.2')});
 assert.ok(f.send.approval.quote.estimatedUsdMicros>0);
 await assert.rejects(f.store().command(ref,{...f.send,approval:{...f.send.approval,paidApproved:false}}),/ROOM_PROVIDER_APPROVAL_REQUIRED/);
 assert.equal(f.state.calls.length,0);await f.store().command(ref,f.send);assert.equal(f.state.calls.length,1);
});
test('Gemini free entitlement is credential-bound and requires explicit confirmation',async()=>{
 const env=environment();env.MASTERMIND_ROOM_API_POLICY=JSON.stringify({...policy,providers:{...policy.providers,gemini:{enabled:true,credentialSha256:fingerprint}}});
 const f=await fixture({model:'gemini/gemini-3.5-flash-lite',env});await assert.rejects(f.store().command(ref,f.send),/ROOM_PROVIDER_UNAVAILABLE/);assert.equal(f.state.calls.length,0);
});
test('configuration fails closed and public metadata contains neither key nor fingerprint',()=>{
 for(const env of [{}, {...environment(),MASTERMIND_ROOM_API_POLICY:'invalid'}, {...environment(),MASTERMIND_ROOM_API_ENABLED:'false'}])assert.equal(providerConfiguration(env,owner,clock).entries.some(m=>m.ready),false);
 const publicView=JSON.stringify(publicModels(providerConfiguration(environment(),owner,clock)));assert.ok(!publicView.includes(secret));assert.ok(!publicView.includes(fingerprint));
});
test('official request shape has no tool, redirect, paid fallback or unselected history',async()=>{
 const f=await fixture();await f.store().command(ref,f.send);const [url,init]=f.state.calls[0];
 assert.equal(url,'https://api.z.ai/api/paas/v4/chat/completions');assert.equal(init.redirect,'error');
 const body=JSON.parse(init.body);assert.equal(body.max_tokens,1024);assert.equal(body.tools,undefined);assert.equal(body.messages.length,1);
 assert.equal(body.messages[0].content,f.state.document.room.turns[f.binding.turnId].prompt);
 assert.equal(body.model,'glm-4.7-flash');assert.equal(body.request_id,f.send.operationId);
});
test('Gemini uses only visible text from the exact selected model family',async()=>{
 const f=await fixture({model:'gemini/gemini-3.5-flash-lite',request:async()=>Response.json({responseId:'google-request-1',modelVersion:'gemini-3.5-flash-lite',
 candidates:[{content:{role:'model',parts:[{text:'Visible'}]},finishReason:'STOP'}]})});
 const view=await f.store().command(ref,f.send);assert.equal(view.room.turns[f.binding.turnId].provider.text,'Visible');
 assert.match(f.state.calls[0][0],/^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/gemini-3.5-flash-lite:generateContent$/);
 assert.equal(f.state.calls[0][1].headers['x-goog-api-key'],secret);
 const body=JSON.parse(f.state.calls[0][1].body);
 assert.deepEqual(body.generationConfig,{candidateCount:1,maxOutputTokens:1024,thinkingConfig:{thinkingLevel:'MINIMAL',includeThoughts:false}});
 assert.equal(body.tools,undefined);
});

test('old Gemini participants remain readable but never silently switch to the new model',async()=>{
 const f=await fixture({model:'gemini/gemini-2.5-flash-lite'});
 const before=await f.store().read(ref);
 assert.equal(before.room.participants[0].model,'gemini/gemini-2.5-flash-lite');
 assert.equal(before.providerQuote,null);
 await assert.rejects(f.store().command(ref,f.send),/ROOM_PROVIDER_UNAVAILABLE/);
 assert.equal(f.state.calls.length,0);
 assert.deepEqual((await f.store().read(ref)).room,before.room);
});

test('prior catalog enrollment cannot authorize the new model',async()=>{
 const env=environment();env.MASTERMIND_ROOM_API_POLICY=JSON.stringify({...policy,catalogVersion:'2026-09-30-v1'});
 const f=await fixture({model:'gemini/gemini-3.5-flash-lite',env});
 await assert.rejects(f.store().command(ref,f.send),/ROOM_PROVIDER_UNAVAILABLE/);
 assert.equal(f.state.calls.length,0);
});

test('Gemini text signatures are discarded, while thought output and malformed metadata are rejected',async()=>{
 for(const [part,accepted] of [[{text:'Visible',thoughtSignature:'opaque-signature'},true],[{text:'Private',thought:true},false],[{text:'Visible',thoughtSignature:{}},false]]){
  const f=await fixture({model:'gemini/gemini-3.5-flash-lite',request:async()=>Response.json({modelVersion:'gemini-3.5-flash-lite',candidates:[{content:{role:'model',parts:[part]},finishReason:'STOP'}]})});
  const result=await f.store().command(ref,f.send),receipt=result.room.turns[f.binding.turnId].provider;
  assert.equal(receipt.state,accepted?'draft':'unknown');
  assert.equal(receipt.text,accepted?'Visible':undefined);
  assert.ok(!JSON.stringify(result).includes('opaque-signature'));
 }
});

test('Gemini 404 is preserved through recovery without another provider attempt',async()=>{
 const f=await fixture({model:'gemini/gemini-3.5-flash-lite',request:async()=>new Response('',{status:404})});
 const first=await f.store().command(ref,f.send);
 const recovered=await f.store().command(ref,f.send);
 assert.equal(recovered.room.turns[f.binding.turnId].provider.httpStatus,404);
 assert.equal(recovered.room.turns[f.binding.turnId].provider.code,'PROVIDER_REJECTED');
 assert.equal(f.state.calls.length,1);
 assert.deepEqual(recovered.room,first.room);
});
test('altered model, tool calls, excessive output and invalid responses never become a reviewable draft',async()=>{
 const bad=[()=>output('text','stop','other-model'),()=>output('x'.repeat(48001)),()=>new Response('not-json'),()=>new Response('x'.repeat(131073)),
 ()=>Response.json({model:'glm-4.7-flash',choices:[{finish_reason:'stop',message:{role:'assistant',content:'Looks valid',tool_calls:[{}]}}]})];
 for(const response of bad){const f=await fixture({request:async()=>response()});const view=await f.store().command(ref,f.send);
  assert.equal(view.room.turns[f.binding.turnId].provider.state,'unknown');assert.equal(view.transcript.length,1);}
});
test('timeout aborts a request once with a safe uncertain outcome',async()=>{
 const model=providerConfiguration(environment(),owner,clock).entries[0];let calls=0;
 const result=await callProvider(model,'fixture',randomUUID(),{timeoutMs:5,request:async(_url,init)=>{calls++;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('timeout'))));}});
 assert.equal(result.code,'PROVIDER_TIMEOUT');assert.equal(calls,1);
});
test('browser reload recovers a committed send receipt without POSTing a second request',async()=>{
 const f=await fixture(),items=new Map(),storage={get length(){return items.size;},key:n=>[...items.keys()][n],getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};
 let lose=true,posts=0;
 const request=async(_url,init)=>{if(init?.method==='POST'){posts++;const view=await f.store().command(ref,JSON.parse(init.body));if(lose){lose=false;throw Error('lost web response');}return Response.json(view);}return Response.json(await f.store().read(ref));};
 const client=new RoomBrowserClient(storage,request);
 await assert.rejects(client.submit(ref,f.send));assert.equal(client.pending().length,1);
 const fresh=new RoomBrowserClient(storage,request);const recovered=await fresh.recover(fresh.pending()[0]);
 assert.equal(recovered.state,'saved');assert.equal(posts,1);assert.equal(f.state.calls.length,1);assert.equal(fresh.pending().length,0);
});
test('a rejected stale approval can be fenced without resending and a late original request fails',async()=>{
 const f=await fixture(),items=new Map(),storage={get length(){return items.size;},key:n=>[...items.keys()][n],getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};
 f.send.approval.quote.policyDigest='0'.repeat(64);
 const request=async(_url,init)=>{
  if(init?.method==='POST'){try{return Response.json(await f.store().command(ref,JSON.parse(init.body)));}catch(e){return Response.json({ok:false,error:e.code},{status:e.status});}}
  return Response.json(await f.store().read(ref));
 };
 const client=new RoomBrowserClient(storage,request);await assert.rejects(client.submit(ref,f.send));
 const pending=client.pending()[0],result=await client.stopPendingSend(pending);
 assert.equal(result.state,'superseded');assert.equal(result.view.room.paused,true);assert.equal(client.pending().length,0);assert.equal(f.state.calls.length,0);
 const corrected={...f.send,approval:{...f.send.approval,quote:(await f.store().read(ref)).providerQuote}};
 await assert.rejects(f.store().command(ref,corrected),/ROOM_REVISION_CONFLICT/);assert.equal(f.state.calls.length,0);
});
test('missing, changed and overlong send IDs are rejected before provider dispatch',async()=>{
 const f=await fixture();await assert.rejects(f.store().command(ref,{...f.send,operationId:'a'.repeat(65)}),/ROOM_INVALID_ID/);
 await f.store().command(ref,f.send);
 await assert.rejects(f.store().command(ref,{...f.send,approval:{...f.send.approval,shareApproved:false}}),/ROOM_OPERATION_CONFLICT/);
 assert.equal(f.state.calls.length,1);
});
test('a policy change after reservation prevents the request but preserves its receipt',async()=>{
 const f=await fixture();let changed=false;
 f.state.hook=async sql=>{if(sql===ROOM_READ_SQL&&!changed&&f.state.document.room.turns[f.binding.turnId].provider?.state==='reserved'){
  changed=true;f.env.MASTERMIND_ROOM_API_ENABLED='false';
 }};
 const view=await f.store().command(ref,f.send);assert.equal(f.state.calls.length,0);
 assert.equal(view.room.turns[f.binding.turnId].provider.code,'CONNECTION_CHANGED_BEFORE_REQUEST');
});
