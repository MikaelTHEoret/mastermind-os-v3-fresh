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
type TraceItem = { tool:string; held?:boolean; approved?:boolean; denied?:boolean; text?:string };
type Msg = { who:Who; text:string; trace?:TraceItem[] };
type Pending = { tool:string; args:any; server:string; policy:string };

const selStyle:React.CSSProperties = { background:'rgba(0,8,20,0.8)', color:C.cyan, border:`1px solid ${C.dim}`,
  borderRadius:4, fontFamily:body, fontSize:11, padding:'3px 6px', outline:'none', maxWidth:260 };

function Btn({label,color,onClick,disabled}:{label:string;color:string;onClick:()=>void;disabled?:boolean}){
  return <span onClick={disabled?undefined:onClick} style={{cursor:disabled?'default':'pointer',
    color:disabled?C.dim:color, border:`1px solid ${disabled?C.dim:color}55`, borderRadius:4,
    padding:'3px 10px', marginRight:6, fontFamily:mono, fontSize:9, letterSpacing:1,
    textShadow:disabled?'none':`0 0 5px ${color}`, opacity:disabled?0.5:1}}>{label}</span>;
}

function providerOf(spec:string){
  if(spec.startsWith('anthropic:')) return {label:'ANTHROPIC', color:C.gold};
  if(spec.startsWith('cloudflare:')) return {label:'CLOUDFLARE', color:C.violet};
  return {label:'LOCAL', color:C.green};
}

function TraceList({trace}:{trace:TraceItem[]}){
  return <div style={{marginTop:5,display:'flex',flexDirection:'column',gap:3}}>
    {trace.map((t,i)=>{
      const c = t.denied?C.red:t.held?C.gold:C.green;
      const tag = t.denied?'DENIED':t.approved?'APPROVED':t.held?'HELD':'OK';
      return <div key={i} style={{display:'flex',gap:6,alignItems:'center',fontFamily:mono,fontSize:8}}>
        <span style={{color:c,border:`1px solid ${c}55`,borderRadius:3,padding:'0px 5px'}}>{tag}</span>
        <span style={{color:C.dim,fontFamily:body,fontSize:11}}>{t.tool}{t.text?` \u2014 ${t.text.slice(0,80)}`:''}</span>
      </div>;
    })}
  </div>;
}

function MsgRow({m}:{m:Msg}){
  if(m.who==='system') return <div>{m.trace && <TraceList trace={m.trace}/>}</div>;
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
  const [model,setModel] = useState<string>('local:hermes3:8b');
  const [mode,setMode] = useState<'gated'|'auto'|'readonly'>('gated');
  const [msgs,setMsgs] = useState<Msg[]>([]);
  const [pending,setPending] = useState<Pending|null>(null);
  const [input,setInput] = useState('');
  const [busy,setBusy] = useState(false);
  const [err,setErr] = useState('');
  const session = useRef('chat-'+Math.random().toString(36).slice(2,9));
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ fetch('/api/chat',{cache:'no-store'}).then(r=>r.json()).then(d=>{
    const sug:string[] = d.suggested||[];
    setModels(sug);
    if(sug.length) setModel(sug[0]);
  }).catch(()=>{}); },[]);

  useEffect(()=>{ scrollRef.current?.scrollTo(0,scrollRef.current.scrollHeight); },[msgs,pending,busy]);

  const handleRes = useCallback((d:any)=>{
    if(!d || d.ok===false){ setErr(d?.error||'request failed'); setBusy(false); return; }
    setErr('');
    const trace:TraceItem[] = d.trace||[];
    if(d.status==='awaiting_approval'){
      if(trace.length) setMsgs(m=>[...m,{who:'system',text:'tools',trace}]);
      setPending(d.pending);
      setBusy(false);
    } else {
      setMsgs(m=>[...m,{who:'assistant',text:d.answer||'(no answer)',trace}]);
      setPending(null);
      setBusy(false);
    }
  },[]);

  const send = useCallback(()=>{
    const text = input.trim(); if(!text||busy) return;
    setMsgs(m=>[...m,{who:'you',text}]);
    setInput(''); setBusy(true); setErr('');
    fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model, message:text, session:session.current, mode, context:text})})
      .then(r=>r.json()).then(handleRes).catch(e=>{setErr(String(e));setBusy(false);});
  },[input,busy,model,mode,handleRes]);

  const decide = useCallback((decision:'approve'|'deny')=>{
    setBusy(true); setPending(null);
    fetch('/api/chat/resume',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({session:session.current, decision})})
      .then(r=>r.json()).then(handleRes).catch(e=>{setErr(String(e));setBusy(false);});
  },[handleRes]);

  const prov = providerOf(model);

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0,fontFamily:body}}>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',padding:'4px 2px 10px'}}>
        <span style={{fontFamily:mono,fontSize:11,color:C.cyan,textShadow:`0 0 6px ${C.cyan}`,letterSpacing:1}}>STARGATE CHAT</span>
        <span style={{fontFamily:mono,fontSize:8,color:prov.color,border:`1px solid ${prov.color}55`,borderRadius:3,padding:'1px 6px',textShadow:`0 0 5px ${prov.color}`}}>{prov.label}</span>
        <select value={model} onChange={e=>setModel(e.target.value)} style={selStyle}>
          {models.length===0 && <option value={model}>{model}</option>}
          {models.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{display:'flex',gap:4}}>
          {(['gated','auto','readonly'] as const).map(md=>(
            <span key={md} onClick={()=>setMode(md)} style={{cursor:'pointer',fontFamily:mono,fontSize:8,
              letterSpacing:1, padding:'2px 7px', borderRadius:3,
              color: mode===md ? (md==='auto'?C.red:md==='readonly'?C.gold:C.green) : C.dim,
              border:`1px solid ${mode===md ? (md==='auto'?C.red:md==='readonly'?C.gold:C.green) : 'transparent'}55`}}>{md.toUpperCase()}</span>
          ))}
        </div>
        <span style={{marginLeft:'auto',fontFamily:mono,fontSize:8,color:C.dim}}>sess {session.current.slice(-5)}</span>
      </div>

      <div ref={scrollRef} style={{flex:1,minHeight:0,overflow:'auto',display:'flex',flexDirection:'column',gap:8,padding:'4px 2px'}}>
        {msgs.length===0 && <div style={{color:C.dim,fontSize:12,padding:12}}>Ask anything. The model can read files, search memory, and run tools &mdash; writes &amp; exec pause for your approval.</div>}
        {msgs.map((m,i)=><MsgRow key={i} m={m}/>)}
        {pending && <ApprovalCard p={pending} onApprove={()=>decide('approve')} onDeny={()=>decide('deny')}/>}
        {busy && <div style={{color:C.cyan,fontFamily:mono,fontSize:10,opacity:0.7,padding:'2px 8px'}}>{'\u00B7 \u00B7 \u00B7'} working</div>}
        {err && <div style={{color:C.red,fontFamily:body,fontSize:12,padding:'4px 8px'}}>{err}</div>}
      </div>

      <div style={{display:'flex',gap:8,paddingTop:8,alignItems:'flex-end'}}>
        <textarea value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } }}
          placeholder={pending?'approve or deny the pending tool first\u2026':'message\u2026'}
          disabled={!!pending} rows={2}
          style={{flex:1,background:'rgba(0,8,20,0.6)',border:`1px solid ${C.dim}`,borderRadius:6,
            color:'#cfe',fontFamily:body,fontSize:13,padding:'8px 10px',resize:'none',outline:'none',opacity:pending?0.5:1}}/>
        <Btn label="SEND" color={C.cyan} onClick={send} disabled={busy||!!pending}/>
      </div>
    </div>
  );
}
