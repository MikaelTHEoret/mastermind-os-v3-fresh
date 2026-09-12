"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {checkedTasks} from '../lib/delegation/browser-workflow.mjs';
import {RoomBrowserClient,roomJson,roomErrorMessage,roomText} from '../lib/chat-room/browser-workflow.mjs';
import {roomPrompt} from '../lib/chat-room/prompt.mjs';
import styles from './SharedRoomConsole.module.css';

type Task={taskId:string;project:string;title:string};
type Ref={taskId:string;session:string};
type Participant={id:string;label:string;model:string;transport:string};
type Message={messageId:string;who:string;participantId:string;text:string;at:string;capture?:string;evidence?:string};
type View={session:string;taskId:string;project:string;taskState:string;transcript:Message[];room:any};
type Summary={session:string;preview:string;updatedAt:string;participants:Participant[];paused:boolean};
type Pending={version:number;ref:Ref;command:any};
const SELECTION='mastermind.room.selection.v1';
const labelFor=(view:View,id:string)=>id==='user_owner'?'You':view.room.participants.find((p:Participant)=>p.id===id)?.label??'Participant';
function remember(ref:Ref){try{localStorage.setItem(SELECTION,JSON.stringify(ref));}catch{/* A selection preference cannot invalidate a confirmed save. */}}
const turnLabels:Record<string,string>={prepared:'Prompt ready for review',dispatching:'Ready for manual transfer', 'awaiting-reply':'Waiting for a pasted response',unknown:'Transfer outcome needs checking'};

function MessageText({text}:{text:string}){
 // Render text and fenced code through React; provider HTML never becomes page HTML.
 const chunks=text.split(/(```[\s\S]*?```)/g);
 return <>{chunks.map((chunk,i)=>chunk.startsWith('```')&&chunk.endsWith('```')
  ?<pre className={styles.code} key={i}><code>{chunk.slice(3,-3).replace(/^[^\n]*\n/,'')}</code></pre>
  :<span className={styles.messageText} key={i}>{chunk}</span>)}</>;
}

export default function SharedRoomConsole(){
 const [tasks,setTasks]=useState<Task[]>([]),[taskId,setTaskId]=useState(''),[rooms,setRooms]=useState<Summary[]>([]);
 const [view,setView]=useState<View|null>(null),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<Pending[]>([]);
 const [creating,setCreating]=useState(false),[names,setNames]=useState([{label:'ChatGPT',model:''},{label:'Grok',model:''}]),[limit,setLimit]=useState(12);
 const [input,setInput]=useState(''),[disposition,setDisposition]=useState('queue'),[recipient,setRecipient]=useState(''),[context,setContext]=useState<string[]>([]);
 const [reply,setReply]=useState(''),[evidence,setEvidence]=useState(''),[complete,setComplete]=useState(true),[truncated,setTruncated]=useState(false);
 const client=useRef<RoomBrowserClient|null>(null),selected=useRef<Ref|null>(null),acting=useRef(false),generation=useRef(0),listGeneration=useRef(0),alive=useRef(false);
 const scroll=useRef<HTMLDivElement>(null);
 const syncPending=()=>{try{if(client.current&&alive.current)setPending(client.current.pending());}catch(e){if(alive.current)setError(roomErrorMessage(e));}};
 const adopt=useCallback((value:View)=>{
  if(!alive.current||selected.current?.taskId!==value.taskId||selected.current?.session!==value.session)return;
  setView(value);setRecipient(current=>value.room.participants.some((p:Participant)=>p.id===current)?current:value.room.participants[0].id);
  const ids=value.transcript.map(m=>m.messageId);
  setContext(previous=>previous.length?ids.filter(id=>previous.includes(id)||value.room.pendingMessages.includes(id)||id===ids.at(-1)):[...new Set([...ids.slice(-12),...value.room.pendingMessages])] as string[]);
 },[]);
 async function list(id:string){
  const ticket=++listGeneration.current;const result=await client.current!.list(id);
  if(ticket===listGeneration.current&&alive.current&&selected.current?.taskId===id){setRooms(result.rooms);setTruncated(result.truncated);setAvailable(true);}
  return result;
 }
 async function open(ref:Ref){
  const ticket=++generation.current;selected.current=ref;setTaskId(ref.taskId);setView(null);setContext([]);setError('');
  const value=await client.current!.load(ref);
  if(!alive.current||ticket!==generation.current)return;
  remember(ref);adopt(value);setCreating(false);
 }
 async function chooseTask(id:string,preferred?:string){
  if(acting.current)return;
  const ticket=++generation.current;selected.current={taskId:id,session:''};setTaskId(id);setView(null);setRooms([]);setAvailable(false);setError('');setCreating(false);
  if(!id)return;
  try{const result=await list(id);if(!alive.current||ticket!==generation.current)return;
   const session=preferred??result.rooms[0]?.session;if(session)await open({taskId:id,session});else setCreating(true);
  }catch(e){if(alive.current&&ticket===generation.current){setError(roomErrorMessage(e));setView(null);}}
 }
 useEffect(()=>{
  alive.current=true;let cancelled=false;
  void(async()=>{try{
   client.current=new RoomBrowserClient(localStorage);
   const saved=client.current.pending();
   const owned=checkedTasks((await roomJson('/api/native/tasks')).tasks);
   if(cancelled)return;setTasks(owned);setPending(saved);
   let last:Ref|null=null;try{last=JSON.parse(localStorage.getItem(SELECTION)??'null');}catch{/* Invalid selection does not affect saved rooms. */}
   const recovery=saved.find(p=>owned.some(t=>t.taskId===p.ref.taskId));
   const ref=recovery?.ref??(owned.some(t=>t.taskId===last?.taskId)?last:null);
   await chooseTask(ref?.taskId??owned[0]?.taskId??'',ref?.session);
  }catch(e){if(!cancelled)setError(roomErrorMessage(e));}})();
  return()=>{cancelled=true;alive.current=false;generation.current++;};
 // Initialization owns one client and recovers the server's task/room selection.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'});},[view?.room.revision]);
 async function refresh(){
  if(acting.current||!selected.current?.taskId)return;
  const ref={...selected.current};setError('');
  try{await list(ref.taskId);if(ref.session)await open(ref);syncPending();}
  catch(e){if(alive.current){setError(roomErrorMessage(e));setView(null);setAvailable(false);}}
 }
 async function act(action:string,fields:Record<string,unknown>={},target?:Ref){
  if(acting.current||!client.current)return null;
  const ref=target??selected.current;if(!ref?.session)return null;
  try{if(client.current.pending().some(p=>p.ref.session===ref.session)){setError('Recover the pending save for this room before changing it.');return null;}}
  catch(e){setError(roomErrorMessage(e));return null;}
  acting.current=true;setBusy(true);setError('');setNotice('');
  const command={operationId:crypto.randomUUID(),expectedRevision:action==='create'?0:view?.room.revision,action,...fields};
  try{
   if(action==='message')roomText(fields.text,24000);
   if(action==='reply'){roomText(fields.text,48000);roomText(fields.evidence,2000);}
   if(action==='prepare'){
    if(!view)throw Error('Reload the room first.');
    const p=view.room.participants.find((p:Participant)=>p.id===fields.participantId);
    const rows=view.transcript.filter(m=>(fields.contextIds as string[]).includes(m.messageId));
    roomText(roomPrompt(ref.session,command.operationId,p,rows),48000);
   }
   const value=await client.current.submit(ref,command);
   if(alive.current){selected.current=ref;setTaskId(ref.taskId);remember(ref);adopt(value);setCreating(false);setNotice('Saved to this room.');void list(ref.taskId).catch(()=>{if(alive.current)setNotice('Saved. The room list could not refresh yet.');});}
   return value as View;
  }catch(e){if(alive.current)setError(roomErrorMessage(e));return null;}
  finally{acting.current=false;if(alive.current){setBusy(false);syncPending();}}
 }
 async function create(){
  try{const participants=names.map(n=>({id:crypto.randomUUID(),label:roomText(n.label.trim(),120),model:roomText(n.model.trim()||'Not recorded',160),transport:'manual'}));
   setContext([]);await act('create',{participants,maxTurns:limit},{taskId,session:crypto.randomUUID()});
  }catch(e){setError(roomErrorMessage(e));}
 }
 async function recover(item:Pending){
  if(acting.current)return;acting.current=true;setBusy(true);setError('');
  try{const result=await client.current!.recover(item);
   if(alive.current){selected.current=item.ref;setTaskId(item.ref.taskId);remember(item.ref);adopt(result.view);void list(item.ref.taskId).catch(()=>{if(alive.current)setNotice('Recovered. The room list could not refresh yet.');});
    if(result.state==='saved'&&item.command.action==='message')setInput(current=>current===item.command.text?'':current);
    if(result.state==='saved'&&item.command.action==='reply')setReply(current=>current===item.command.text?'':current);
    if(result.state==='superseded'&&item.command.action==='message')setInput(current=>current||item.command.text);
    if(result.state==='superseded'&&item.command.action==='reply')setReply(current=>current||item.command.text);
    setNotice(result.state==='saved'?'The saved change was recovered.':'Another change arrived first. This pending change was not saved; review the latest messages before sending it again.');}
  }catch(e){if(alive.current){setError(roomErrorMessage(e));setView(null);}}
  finally{acting.current=false;if(alive.current){setBusy(false);syncPending();}}
 }
 const active=view?.room.activeTurn?view.room.turns[view.room.activeTurn]:null;
 const binding=active?{turnId:view!.room.activeTurn,promptSha256:active.promptSha256}:{};
 const ownPending=pending.filter(p=>tasks.some(t=>t.taskId===p.ref.taskId));
 const roomPending=ownPending.some(p=>p.ref.session===view?.session);
 const locked=busy||roomPending||view?.taskState!=='active';
 const selectedIds=view?.transcript.filter(m=>context.includes(m.messageId)||view.room.pendingMessages.includes(m.messageId)).map(m=>m.messageId)??[];
 async function copy(text:string){try{await navigator.clipboard.writeText(text);setNotice('Copied.');}catch{setError('Clipboard access is unavailable. Select and copy the visible text instead.');}}
 async function handoff(){
  if(!active||!view)return;
  if(active.status==='prepared'){
   const saved=await act('dispatch',binding);
   if(saved){const turn=saved.room.turns[view.room.activeTurn];if(!turn||saved.room.activeTurn!==view.room.activeTurn||turn.cancelRequested){setNotice('This turn changed elsewhere. Review the saved room before transferring it.');return;}await copy(turn.prompt);setNotice('Prompt prepared for manual transfer. Paste it into the chosen model conversation, then confirm below.');}
  }else await copy(active.prompt);
 }
 return <section className={styles.root} aria-label="Shared model room">
  <header className={styles.header}><div><h2>Shared conversation</h2><p>You and your models, with one saved history.</p></div><span className={styles.badge}>Manual transfer</span></header>
  <p className={styles.intro}>Review what each participant receives, paste its reply here, then choose who responds next. Automatic browser connections are not enabled yet.</p>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className={styles.notice}>{notice}</p>}
  {ownPending.length>0&&<aside className={styles.recovery}><strong>A save needs recovery</strong><p>Your original change is retained in this browser. Recovery checks the saved room and keeps the same operation if a retry is needed.</p>
   {ownPending.map(p=><div key={p.command.operationId}><button disabled={busy} onClick={()=>void recover(p)}>Recover save</button> <span>{tasks.find(t=>t.taskId===p.ref.taskId)?.title}</span>
    {typeof p.command.text==='string'&&<details><summary>Text in this pending save</summary><div className={styles.messageText}>{p.command.text}</div></details>}</div>)}
  </aside>}
  <div className={styles.layout}>
   <aside className={styles.sidebar}>
    <label>Shared task<select value={taskId} disabled={busy} onChange={e=>void chooseTask(e.target.value)}><option value="">Choose a task</option>{tasks.map(t=><option value={t.taskId} key={t.taskId}>{t.title}</option>)}</select></label>
    <div className={styles.actions}><button disabled={!taskId||busy} onClick={()=>void refresh()}>Refresh rooms</button><button disabled={!available||busy} onClick={()=>setCreating(true)}>New room</button></div>
    <h3>Saved rooms</h3>
    {rooms.length===0&&<p className={styles.muted}>{available?'No rooms for this task yet.':'Choose an available task to load its rooms.'}</p>}
    {rooms.map(r=><button className={styles.roomItem} aria-pressed={view?.session===r.session} disabled={busy} key={r.session} onClick={()=>void open({taskId,session:r.session}).catch(e=>setError(roomErrorMessage(e)))}>
     <strong>{r.preview||r.participants.map(p=>p.label).join(' + ')}</strong><span>{new Date(r.updatedAt).toLocaleString()}{r.paused?' · Paused':''}</span>
    </button>)}
    {truncated&&<p className={styles.muted}>Showing the 50 most recently updated rooms. Older rooms remain saved.</p>}
   </aside>
   <div className={styles.main}>
    {creating&&available?<form className={styles.setup} onSubmit={e=>{e.preventDefault();void create();}}>
     <h3>Bring participants into a room</h3><p>Use the name you want shown beside each reply. Model versions can be recorded when known.</p>
     {names.map((n,i)=><div className={styles.participantFields} key={i}><label>Participant {i+1}<input required value={n.label} maxLength={120} onChange={e=>setNames(items=>items.map((v,k)=>k===i?{...v,label:e.target.value}:v))}/></label>
      <label>Model version (optional)<input value={n.model} maxLength={160} onChange={e=>setNames(items=>items.map((v,k)=>k===i?{...v,model:e.target.value}:v))}/></label>
      <button type="button" aria-label={`Remove participant ${i+1}`} disabled={names.length===1||busy} onClick={()=>setNames(items=>items.filter((_,k)=>k!==i))}>Remove</button></div>)}
     <div className={styles.actions}><button type="button" disabled={names.length>=6||busy} onClick={()=>setNames(items=>[...items,{label:'',model:''}])}>Add participant</button>
      <label>Turn limit<select value={limit} onChange={e=>setLimit(Number(e.target.value))}>{[6,12,24].map(n=><option key={n} value={n}>{n} turns</option>)}</select></label>
      <button className={styles.primary} disabled={busy||!taskId}>Create room</button>{view&&<button type="button" onClick={()=>setCreating(false)}>Back to conversation</button>}</div>
    </form>:view?<>
     <div className={styles.roomHeader}><div className={styles.participants}>{view.room.participants.map((p:Participant)=><span className={styles.chip} key={p.id}>{p.label}<small>{p.model==='Not recorded'?'Manual transfer':p.model}</small></span>)}</div>
      <span className={styles.muted}>{view.room.paused?'Paused':'Open'} · {view.room.maxTurns-Object.keys(view.room.turns).length} turn attempts left</span>
      <button disabled={locked} onClick={()=>void act(view.room.paused?'resume':'pause')}>{view.room.paused?'Resume room':'Pause room'}</button>
     </div>
     <div className={styles.transcript} ref={scroll} aria-label="Room messages" aria-live="polite">
      {!view.transcript.length&&<div className={styles.empty}><h3>Start the conversation</h3><p>Write the question or task below. You can decide which participant responds first.</p></div>}
      {view.transcript.map(m=><article key={m.messageId} className={m.who==='you'?styles.ownerMessage:styles.peerMessage}>
       <header><strong>{labelFor(view,m.participantId)}</strong><time dateTime={m.at}>{new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time><button aria-label={`Copy message from ${labelFor(view,m.participantId)}`} onClick={()=>void copy(m.text)}>Copy</button></header>
       <MessageText text={m.text}/>{m.who==='assistant'&&<details className={styles.provenance}><summary>Pasted response · {m.capture==='incomplete'?'partial capture':'complete capture'}</summary><p>{m.evidence}</p><p>Participant and completeness were recorded by the person importing this response.</p></details>}
      </article>)}
     </div>
     {view.taskState!=='active'&&<p className={styles.recovery}>This task is read-only. Its saved conversation remains available.</p>}
     {active?<details open className={styles.turn}><summary>{labelFor(view,active.participantId)} · {turnLabels[active.status]}</summary>
      {active.steeringPending&&<p className={styles.notice}>{active.status==='prepared'?'New steering arrived before transfer. Discard this prepared turn, resume the room, and prepare it again.':'Your steering is saved for the next turn. The earlier prompt stays unchanged.'}</p>}
      <details><summary>Review the exact prompt</summary><pre className={styles.prompt}>{active.prompt}</pre></details>
      <div className={styles.actions}><button disabled={locked||(active.status==='prepared'&&(view.room.paused||active.steeringPending))} onClick={()=>void handoff()}>{active.status==='prepared'?'Copy prompt for '+labelFor(view,active.participantId):'Copy prepared prompt again'}</button>
       {active.status==='prepared'?<button disabled={locked} onClick={()=>void act('cancel')}>Discard prepared turn</button>:<>
        {active.status==='dispatching'&&<button disabled={locked} onClick={()=>void act('acknowledge',binding)}>I sent this prompt</button>}
        {['dispatching','awaiting-reply'].includes(active.status)&&<button disabled={locked} onClick={()=>void act('uncertain',binding)}>I am unsure if it was sent</button>}
        {['dispatching','unknown'].includes(active.status)&&<button disabled={locked} onClick={()=>void act('not-sent',{...binding,evidence:'Owner checked the selected model conversation and confirms this prompt was not submitted.'})}>I checked: this was not sent</button>}
       </>}</div>
      {active.status!=='prepared'&&<form onSubmit={e=>{e.preventDefault();const sent=reply;void act('reply',{...binding,text:sent,evidence,capture:complete?'manual-complete':'incomplete'}).then(saved=>{if(saved){setReply(current=>current===sent?'':current);setEvidence('');}});}}>
       <label>Original reply from {labelFor(view,active.participantId)}<textarea value={reply} onChange={e=>setReply(e.target.value)} rows={3} required/></label>
       <label>Response source (chat link or a note)<input value={evidence} onChange={e=>setEvidence(e.target.value)} required maxLength={2000}/></label>
       <label className={styles.check}><input type="checkbox" checked={complete} onChange={e=>setComplete(e.target.checked)}/>The response was captured completely</label>
       <button className={styles.primary} disabled={locked||!reply.trim()||!evidence.trim()}>Save participant reply</button>
      </form>}
     </details>:<div className={styles.nextTurn}><label>Who responds next?<select value={recipient} onChange={e=>setRecipient(e.target.value)} disabled={locked}>{view.room.participants.map((p:Participant)=><option value={p.id} key={p.id}>{p.label}</option>)}</select></label>
      <details><summary>Context to share · {selectedIds.length} messages</summary><div className={styles.contextList}>{view.transcript.map(m=><label className={styles.check} key={m.messageId}><input type="checkbox" checked={selectedIds.includes(m.messageId)} disabled={view.room.pendingMessages.includes(m.messageId)} onChange={e=>setContext(ids=>e.target.checked?[...ids,m.messageId]:ids.filter(id=>id!==m.messageId))}/><span><strong>{labelFor(view,m.participantId)}</strong>: {m.text.slice(0,160)}{view.room.pendingMessages.includes(m.messageId)?' (pending user message)':''}</span></label>)}</div></details>
      <button disabled={locked||view.room.paused||!selectedIds.length||selectedIds.length>64||!recipient} onClick={()=>void act('prepare',{participantId:recipient,contextIds:selectedIds})}>Prepare next turn</button>
     </div>}
     <form className={styles.composer} onSubmit={e=>{e.preventDefault();const sent=input;void act('message',{text:sent,disposition}).then(saved=>{if(saved)setInput(current=>current===sent?'':current);});}}>
      <label>Your message<textarea placeholder="Ask a question, add context, or steer the discussion…" value={input} onChange={e=>setInput(e.target.value)} rows={2}/></label>
      <div className={styles.actions}><label>When to apply it<select value={disposition} onChange={e=>setDisposition(e.target.value)}><option value="queue">Queue for the next turn</option><option value="steer">Steer the discussion</option></select></label>
       <button className={styles.primary} disabled={locked||!input.trim()}>Add message</button><span className={styles.muted}>Steering takes effect before the next model turn.</span></div>
     </form>
    </>:<div className={styles.empty}><h3>One place to resume the discussion</h3><p>Choose a task and a saved room, or start a new room when the service is available.</p>{!tasks.length&&<a href="/sign-in">Open Mastermind sign-in</a>}</div>}
   </div>
  </div>
 </section>;
}
