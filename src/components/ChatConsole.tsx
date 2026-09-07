'use client';
// ChatConsole.tsx -- the CHAT tab: a Claude-Desktop-grade chat box wired through the Stargate (:8767).
// Pick any model (local Ollama / Anthropic / Cloudflare); the model wields the full gated MCP suite.
// Gated tools PAUSE for human Approve/Deny (the resume handshake). Read/auto tools run inline.
import { useEffect, useRef, useState, useCallback } from 'react';

const C = { cyan:'#00ffff', magenta:'#ff00ff', violet:'#8a2be2', gold:'#ffaa00',
            green:'#00ffaa', red:'#ff4444', dim:'rgba(0,255,255,0.35)', card:'rgba(0,15,35,0.75)' };
const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';

type Who = 'you'|'assistant'|'system';
type TraceItem = { tool:string; held?:boolean; approved?:boolean; denied?:boolean; error?:boolean; text?:string };
type Msg = { who:Who; text:string; trace?:TraceItem[] };
type Pending = { tool:string; args:any; server:string; policy:string };
type SessionStatus = 'new'|'active'|'closed'|'running'|'awaiting_approval'|'interrupted';
type TurnRequest = { model:string; message:string; session:string; mode:string; context:string; project:string; turnId:string };
type SavedSession = {session:string;model:string;status:string;updatedAt:string;project:string;preview:string};
const SESSION_KEY = 'mastermind.chat.session.v1';
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function chatRequest(url:string, payload?:object) {
  const response = await fetch(url, payload === undefined ? { cache:'no-store' } : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || 'The conversation could not be saved or loaded.');
  return data;
}

const selStyle:React.CSSProperties = { background:'rgba(0,8,20,0.8)', color:C.cyan, border:`1px solid ${C.dim}`,
  borderRadius:4, fontFamily:body, fontSize:11, padding:'3px 6px', outline:'none', maxWidth:260 };

function Btn({label,color,onClick,disabled}:{label:string;color:string;onClick:()=>void;disabled?:boolean}){
  return <button type="button" onClick={onClick} disabled={disabled} style={{cursor:disabled?'default':'pointer',background:'transparent',
    color:disabled?C.dim:color, border:`1px solid ${disabled?C.dim:color}55`, borderRadius:4,
    padding:'3px 10px', marginRight:6, fontFamily:mono, fontSize:9, letterSpacing:1,
    textShadow:disabled?'none':`0 0 5px ${color}`, opacity:disabled?0.5:1}}>{label}</button>;
}

function providerOf(spec:string){
  if(spec.startsWith('anthropic:')) return {label:'ANTHROPIC', color:C.gold};
  if(spec.startsWith('cloudflare:')) return {label:'CLOUDFLARE', color:C.violet};
  return {label:'LOCAL', color:C.green};
}

function TraceList({trace}:{trace:TraceItem[]}){
  return <div style={{marginTop:5,display:'flex',flexDirection:'column',gap:3}}>
    {trace.map((t,i)=>{
      const failed = t.error === true || /^(?:TOOL_ERROR\b|MCP error\b|Error:)/i.test(t.text?.trim() ?? '');
      const c = failed || t.denied?C.red:t.held?C.gold:C.green;
      const tag = failed?'ERROR':t.denied?'DENIED':t.approved?'APPROVED':t.held?'HELD':'OK';
      return <div key={i} style={{display:'flex',gap:6,alignItems:'center',fontFamily:mono,fontSize:8}}>
        <span style={{color:c,border:`1px solid ${c}55`,borderRadius:3,padding:'0px 5px'}}>{tag}</span>
        <span style={{color:failed?C.red:C.dim,fontFamily:body,fontSize:11,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{t.tool}{t.text?` \u2014 ${failed?t.text:t.text.slice(0,80)}`:''}</span>
      </div>;
    })}
  </div>;
}

function MsgRow({m}:{m:Msg}){
  if(m.who==='system') return <div style={{color:C.gold,fontSize:12}}>{m.text !== 'tools' && m.text}{m.trace && <TraceList trace={m.trace}/>}</div>;
  const you = m.who==='you';
  const col = you ? C.green : C.cyan;
  return (
    <div style={{alignSelf:you?'flex-end':'flex-start',maxWidth:'85%'}}>
      <div style={{fontFamily:mono,fontSize:8,color:col,letterSpacing:1,marginBottom:2,textAlign:you?'right':'left',opacity:0.7}}>{you?'YOU':'ASSISTANT'}</div>
      <div style={{background:you?'rgba(0,40,30,0.5)':'rgba(0,15,35,0.75)',border:`1px solid ${col}30`,
        borderRadius:8,padding:'8px 11px',fontFamily:body,fontSize:13,color:'#def',whiteSpace:'pre-wrap',lineHeight:1.4}}>{m.text}</div>
      {m.trace && m.trace.length>0 && <TraceList trace={m.trace}/>}
    </div>
  );
}

function ApprovalCard({p,onApprove,onDeny}:{p:Pending;onApprove:()=>void;onDeny:()=>void}){
  return (
    <div style={{border:`1px solid ${C.gold}`,borderRadius:8,padding:'10px 12px',background:'rgba(30,20,0,0.5)',
      boxShadow:`0 0 14px ${C.gold}30`,alignSelf:'flex-start',maxWidth:'90%'}}>
      <div style={{fontFamily:mono,fontSize:10,color:C.gold,textShadow:`0 0 6px ${C.gold}`,letterSpacing:1,marginBottom:6}}>
        {'\u23F8'} APPROVAL REQUIRED {'\u00B7'} {p.server}
      </div>
      <div style={{fontFamily:mono,fontSize:12,color:'#fed',marginBottom:6}}>{p.tool}</div>
      <pre style={{fontFamily:body,fontSize:11,color:'rgba(255,200,120,0.85)',whiteSpace:'pre-wrap',
        maxHeight:160,overflow:'auto',margin:'0 0 8px 0',background:'rgba(0,0,0,0.3)',padding:'6px 8px',borderRadius:4}}>{JSON.stringify(p.args,null,2)}</pre>
      <div>
        <Btn label={'\u2713 APPROVE'} color={C.green} onClick={onApprove}/>
        <Btn label={'\u2715 DENY'} color={C.red} onClick={onDeny}/>
      </div>
    </div>
  );
}

export default function ChatConsole(){
  const [models,setModels] = useState<string[]>([]);
  const [model,setModel] = useState<string>('local:mastermind-hermes3:8b');
  const [mode,setMode] = useState<'gated'|'auto'|'readonly'>('gated');
  const [msgs,setMsgs] = useState<Msg[]>([]);
  const [pending,setPending] = useState<Pending|null>(null);
  const [input,setInput] = useState('');
  const [busy,setBusy] = useState(true);
  const [ready,setReady] = useState(false);
  const [status,setStatus] = useState<SessionStatus>('new');
  const [warnings,setWarnings] = useState<string[]>([]);
  const [retryAvailable,setRetryAvailable] = useState(false);
  const [savedSessions,setSavedSessions] = useState<SavedSession[]>([]);
  const [savedError,setSavedError] = useState('');
  const [err,setErr] = useState('');
  const session = useRef('');
  const inFlight = useRef(true);
  const retryTurn = useRef<TurnRequest|null>(null);
  const modelRestored = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedRequestSequence = useRef(0);

  const loadSavedSessions = useCallback(async ()=>{
    const sequence = ++savedRequestSequence.current;
    try {
      const data = await chatRequest('/api/chat/sessions?project=mastermind');
      if(sequence !== savedRequestSequence.current) return;
      if(!Array.isArray(data.sessions)) throw new Error('Invalid conversation list.');
      setSavedSessions(data.sessions.filter((item:SavedSession)=>item && SESSION_UUID.test(item.session) && typeof item.preview === 'string').slice(0,20));
      setSavedError('');
    } catch { if(sequence === savedRequestSequence.current) setSavedError('The saved conversation list could not be refreshed.'); }
  },[]);

  const restoreSession = useCallback(async (id:string,activate=false)=>{
    const data = await chatRequest(`/api/chat/session?session=${encodeURIComponent(id)}&project=mastermind`);
    if(!Array.isArray(data.transcript)) throw new Error('The saved conversation response is incomplete. Try loading it again.');
    if(activate){localStorage.setItem(SESSION_KEY,id);session.current=id;}
    if(session.current !== id) return;
    setMsgs(data.transcript.filter((m:Msg)=>m && ['you','assistant','system'].includes(m.who) && typeof m.text === 'string'));
    setStatus(data.status || 'new');
    setPending(data.status === 'awaiting_approval' && data.pending ? data.pending : null);
    if(typeof data.model === 'string' && data.model){ modelRestored.current = true; setModel(data.model); }
    if(Array.isArray(data.warnings)) setWarnings(data.warnings);
    setSavedSessions(items=>items.map(item=>item.session===id ? {...item,status:data.status || 'new',model:data.model || item.model} : item));
    if(data.status !== 'running') void loadSavedSessions();
    setReady(true);
  },[loadSavedSessions]);

  useEffect(()=>{
    let cancelled = false;
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      session.current = saved && SESSION_UUID.test(saved) ? saved : crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, session.current);
    } catch {
      session.current = '';
      setErr('Browser storage is unavailable. Allow local storage to keep this conversation across reloads.');
      setBusy(false); inFlight.current = false;
      return;
    }
    restoreSession(session.current).catch(e=>{if(!cancelled) setErr(String(e.message || e));})
      .finally(()=>{if(!cancelled){setBusy(false);inFlight.current = false;}});
    void loadSavedSessions();
    chatRequest('/api/chat').then(d=>{
      if(cancelled) return;
      const suggested:string[] = Array.isArray(d.suggested) ? d.suggested : [];
      setModels(suggested);
      if(suggested.length && !modelRestored.current) setModel(['local:mastermind-hermes3:8b','local:hermes3:8b'].find(candidate=>suggested.includes(candidate)) || suggested[0]);
    }).catch(()=>{});
    return ()=>{cancelled = true;};
  },[restoreSession,loadSavedSessions]);

  useEffect(()=>{
    if(status !== 'running' || !ready) return;
    let checking = false;
    const timer = window.setInterval(()=>{
      if(checking) return;
      checking = true;
      restoreSession(session.current).catch(e=>setErr(String(e.message || e))).finally(()=>{checking=false;});
    },2500);
    return ()=>window.clearInterval(timer);
  },[status,ready,restoreSession]);

  useEffect(()=>{ scrollRef.current?.scrollTo(0,scrollRef.current.scrollHeight); },[msgs,pending,busy]);

  const handleRes = useCallback((d:any)=>{
    setErr('');
    setWarnings(Array.isArray(d.warnings) ? d.warnings : []);
    if(d.persistence !== 'saved') setWarnings(w=>[...w,'The server did not confirm that this turn was saved. Reload the saved conversation to verify it.']);
    const trace:TraceItem[] = d.trace||[];
    setStatus(d.status === 'awaiting_approval' ? 'awaiting_approval' : d.status === 'running' ? 'running' : 'active');
    if(d.status==='awaiting_approval'){
      if(trace.length) setMsgs(m=>[...m,{who:'system',text:'tools',trace}]);
      setPending(d.pending);
    } else {
      if(d.status !== 'running') setMsgs(m=>[...m,{who:'assistant',text:d.answer||'(no answer)',trace}]);
      setPending(null);
    }
  },[]);

  const submitTurn = useCallback(async (turn:TurnRequest)=>{
    if(inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setErr(''); setRetryAvailable(false);
    try {
      handleRes(await chatRequest('/api/chat',turn));
      retryTurn.current = null;
      await restoreSession(turn.session);
    } catch(e:any) {
      setErr(String(e.message || e));
      setRetryAvailable(retryTurn.current !== null);
    } finally { setBusy(false); inFlight.current = false; }
  },[handleRes,restoreSession]);

  const send = useCallback(()=>{
    const text = input.trim();
    if(!text || inFlight.current || !ready || pending || retryTurn.current || status === 'closed' || status === 'running') return;
    const turn = { model, message:text, session:session.current, mode, context:text, project:'mastermind', turnId:crypto.randomUUID() };
    retryTurn.current = turn;
    setMsgs(m=>[...m,{who:'you',text}]);
    setInput('');
    void submitTurn(turn);
  },[input,ready,pending,status,model,mode,submitTurn]);

  const decide = useCallback(async (decision:'approve'|'deny')=>{
    if(inFlight.current || !pending) return;
    inFlight.current = true; setBusy(true); setPending(null); setErr('');
    try { handleRes(await chatRequest('/api/chat/resume',{session:session.current, decision})); }
    catch(e:any) { setErr(`${e.message || e} Reload the saved conversation before deciding again.`); }
    finally {
      try { await restoreSession(session.current); } catch(e:any) { setErr(String(e.message || e)); setReady(false); }
      setBusy(false); inFlight.current = false;
    }
  },[pending,handleRes,restoreSession]);

  const reload = useCallback(async ()=>{
    if(inFlight.current || !session.current) return;
    inFlight.current = true; setBusy(true); setErr('');
    try { await restoreSession(session.current); }
    catch(e:any) { setErr(String(e.message || e)); }
    finally { setBusy(false); inFlight.current = false; }
  },[restoreSession]);

  const switchSession = useCallback(async (id:string)=>{
    if(inFlight.current || !ready || pending || retryTurn.current || status === 'running' || !SESSION_UUID.test(id) || id === session.current) return;
    inFlight.current=true;setBusy(true);setErr('');
    try {await restoreSession(id,true);setInput('');}
    catch(e:any){setErr(String(e.message || e));}
    finally {setBusy(false);inFlight.current=false;}
  },[ready,pending,status,restoreSession]);

  const closeSession = useCallback(async (startNew:boolean)=>{
    if(inFlight.current || !ready || status === 'running') return;
    inFlight.current = true; setBusy(true); setErr('');
    try {
      let closingWarnings:string[] = [];
      if(status !== 'closed') {
        const result = await chatRequest('/api/chat/close',{session:session.current, project:'mastermind'});
        closingWarnings = Array.isArray(result.warnings) ? result.warnings : [];
        setWarnings(closingWarnings);
      }
      setPending(null); retryTurn.current = null; setRetryAvailable(false); setStatus('closed');
      if(startNew) {
        const id = crypto.randomUUID();
        localStorage.setItem(SESSION_KEY,id);
        session.current = id;
        setMsgs([]); setInput(''); setReady(false);
        await restoreSession(id);
        if(closingWarnings.length) setWarnings(w=>[...closingWarnings.map(warning=>`Previous session: ${warning}`),...w]);
      }
      void loadSavedSessions();
    } catch(e:any) { setErr(String(e.message || e)); }
    finally { setBusy(false); inFlight.current = false; }
  },[ready,status,restoreSession,loadSavedSessions]);

  const prov = providerOf(model);
  const locked = busy || !ready || !!pending || status === 'closed' || status === 'running' || retryAvailable;

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0,fontFamily:body}}>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',padding:'4px 2px 10px'}}>
        <span style={{fontFamily:mono,fontSize:11,color:C.cyan,textShadow:`0 0 6px ${C.cyan}`,letterSpacing:1}}>STARGATE CHAT</span>
        <span style={{fontFamily:mono,fontSize:8,color:prov.color,border:`1px solid ${prov.color}55`,borderRadius:3,padding:'1px 6px',textShadow:`0 0 5px ${prov.color}`}}>{prov.label}</span>
        <select aria-label="Chat model" value={model} onChange={e=>{modelRestored.current=true;setModel(e.target.value);}} disabled={locked} style={selStyle}>
          {!models.includes(model) && <option value={model}>{model}</option>}
          {models.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{display:'flex',gap:4}}>
          {(['gated','auto','readonly'] as const).map(md=>(
            <button type="button" disabled={locked} key={md} onClick={()=>setMode(md)} style={{cursor:locked?'default':'pointer',background:'transparent',fontFamily:mono,fontSize:8,
              letterSpacing:1, padding:'2px 7px', borderRadius:3,
              color: mode===md ? (md==='auto'?C.red:md==='readonly'?C.gold:C.green) : C.dim,
              border:`1px solid ${mode===md ? (md==='auto'?C.red:md==='readonly'?C.gold:C.green) : 'transparent'}55`}}>{md.toUpperCase()}</button>
          ))}
        </div>
        <span style={{marginLeft:'auto',fontFamily:body,fontSize:11,color:C.dim}}>{ready ? status : 'loading conversation'}</span>
        <select aria-label="Saved conversations" value={session.current} onChange={e=>void switchSession(e.target.value)} disabled={busy || !ready || !!pending || retryAvailable || status === 'running'} style={{...selStyle,maxWidth:320}}>
          {!savedSessions.some(item=>item.session===session.current) && <option value={session.current}>Current conversation</option>}
          {savedSessions.map(item=><option key={item.session} value={item.session}>{new Date(item.updatedAt).toLocaleDateString()} · {item.preview.slice(0,70) || 'Saved conversation'} ({item.status})</option>)}
        </select>
        <Btn label="RELOAD SAVED" color={C.cyan} onClick={reload} disabled={busy || !session.current}/>
        <Btn label="CLOSE" color={C.gold} onClick={()=>closeSession(false)} disabled={busy || !ready || status === 'closed' || status === 'running'}/>
        <Btn label="NEW SESSION" color={C.green} onClick={()=>closeSession(true)} disabled={busy || !ready || status === 'running'}/>
      </div>

      <div ref={scrollRef} style={{flex:1,minHeight:0,overflow:'auto',display:'flex',flexDirection:'column',gap:8,padding:'4px 2px'}}>
        {msgs.length===0 && <div style={{color:C.dim,fontSize:12,padding:12}}>Ask anything. The model can read files, search memory, and run tools &mdash; writes &amp; exec pause for your approval.</div>}
        {msgs.map((m,i)=><MsgRow key={i} m={m}/>)}
        {status === 'interrupted' && <div style={{color:C.gold,fontSize:12}}>This session was interrupted. Its saved conversation is restored. Previous actions will not replay automatically; give a new instruction to continue.</div>}
        {status === 'closed' && <div style={{color:C.gold,fontSize:12}}>This conversation is closed and saved. Start a new session to continue.</div>}
        {status === 'running' && !busy && <div style={{color:C.cyan,fontSize:12}}>The saved turn is still running. Checking for its response...</div>}
        {warnings.map((warning,index)=><div role="status" key={index} style={{color:C.gold,fontSize:12}}>{String(warning)}</div>)}
        {savedError && <div role="status" style={{color:C.gold,fontSize:12}}>{savedError}</div>}
        {pending && <ApprovalCard p={pending} onApprove={()=>decide('approve')} onDeny={()=>decide('deny')}/>}
        {busy && <div style={{color:C.cyan,fontFamily:mono,fontSize:10,opacity:0.7,padding:'2px 8px'}}>{'\u00B7 \u00B7 \u00B7'} working</div>}
        {err && <div role="alert" style={{color:C.red,fontFamily:body,fontSize:12,padding:'4px 8px'}}>{err}</div>}
        {retryAvailable && <div style={{color:C.gold,fontSize:12}}>The last request was not confirmed. Retrying keeps its original identifier.
          <Btn label="RETRY LAST MESSAGE" color={C.gold} disabled={busy} onClick={()=>{if(retryTurn.current) void submitTurn(retryTurn.current);}}/>
        </div>}
      </div>

      <div style={{display:'flex',gap:8,paddingTop:8,alignItems:'flex-end'}}>
        <textarea value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } }}
          aria-label="Message"
          placeholder={pending?'approve or deny the pending tool first\u2026':status === 'closed'?'start a new session to continue':'message\u2026'}
          disabled={locked} rows={2}
          style={{flex:1,background:'rgba(0,8,20,0.6)',border:`1px solid ${C.dim}`,borderRadius:6,
            color:'#cfe',fontFamily:body,fontSize:13,padding:'8px 10px',resize:'none',outline:'none',opacity:pending?0.5:1}}/>
        <Btn label="SEND" color={C.cyan} onClick={send} disabled={locked || !input.trim()}/>
      </div>
    </div>
  );
}
