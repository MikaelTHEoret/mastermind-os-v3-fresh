'use client';
// ResidentConsole.tsx -- the RESIDENT tab: chat with the resident orchestrator (hermes3),
// decision cards with the labeling gate (Approve / Hold / Reject / Correct -> gold labels),
// trace history + trainset counter, and a file dropbox (gated: saved, never auto-ingested).
import { useEffect, useRef, useState, useCallback } from 'react';

const C = { cyan:'#00ffff', magenta:'#ff00ff', violet:'#8a2be2', gold:'#ffaa00',
            green:'#00ffaa', red:'#ff4444', dim:'rgba(0,255,255,0.35)', card:'rgba(0,15,35,0.75)' };
const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';

type Trace = { id:number; ts:string; task:string; verb:string; valid:boolean;
               outcome:number|null; corrected:boolean; action:any; gold_action:any };
type Msg = { who:'you'|'resident'|'system'; text:string; trace?:any };

const VERB_COLOR: Record<string,string> = {
  SPAWN:C.magenta, GENERATE_TABLE:C.violet, FLAG:C.gold, REUSE:C.green,
  ROUTE:C.cyan, PERSIST:C.cyan, ALLOCATE:C.gold, ENQUEUE_CANDIDATE:C.violet, BLOCK:C.red };

function api(path:string, post?:any, qs?:string){
  const u = `/api/resident?path=${encodeURIComponent(path)}${qs?`&qs=${encodeURIComponent(qs)}`:''}`;
  return post ? fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(post)}).then(r=>r.json())
              : fetch(u,{cache:'no-store'}).then(r=>r.json());
}

function Btn({label,color,onClick}:{label:string;color:string;onClick:()=>void}){
  return <span onClick={onClick} style={{cursor:'pointer',color,border:`1px solid ${color}55`,
    borderRadius:4,padding:'2px 8px',marginRight:6,fontFamily:mono,fontSize:9,letterSpacing:1,
    textShadow:`0 0 5px ${color}`}}>{label}</span>;
}

function DecisionCard({t, onLabel}:{t:Trace; onLabel:(id:number,what:string,payload?:any)=>void}){
  const [editing,setEditing] = useState(false);
  const [draft,setDraft] = useState('');
  const vc = VERB_COLOR[t.verb] || C.cyan;
  const oc = t.outcome===1?C.green:t.outcome===-1?C.red:C.gold;
  const ol = t.outcome===1?'APPROVED':t.outcome===-1?'REJECTED':'HELD';
  return (
    <div style={{border:`1px solid ${vc}35`,borderRadius:6,padding:'8px 10px',marginBottom:8,background:'rgba(0,8,20,0.6)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <span style={{fontFamily:mono,fontSize:10,color:vc,textShadow:`0 0 6px ${vc}`}}>#{t.id} {t.verb}</span>
        <span style={{fontFamily:mono,fontSize:9,color:oc}}>{ol}{t.corrected?' · GOLD(corrected)':t.gold_action?' · GOLD':''}</span>
      </div>
      <div style={{fontFamily:body,fontSize:12,color:'rgba(255,255,255,0.7)',marginBottom:6}}>{t.task?.slice(0,160)}</div>
      <pre style={{fontFamily:body,fontSize:11,color:'rgba(0,255,255,0.75)',whiteSpace:'pre-wrap',
        maxHeight:140,overflow:'auto',margin:'0 0 6px 0'}}>{JSON.stringify(t.action,null,1)}</pre>
      {editing ? (<div>
        <textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={6}
          style={{width:'100%',background:'rgba(0,0,0,0.5)',color:C.gold,border:`1px solid ${C.gold}45`,
                  borderRadius:4,fontFamily:body,fontSize:11,padding:6}}/>
        <div style={{marginTop:4}}>
          <Btn label="SAVE AS GOLD" color={C.gold} onClick={()=>{try{onLabel(t.id,'correct',JSON.parse(draft));setEditing(false);}catch{alert('invalid JSON');}}}/>
          <Btn label="CANCEL" color={C.dim} onClick={()=>setEditing(false)}/>
        </div></div>
      ) : (<div>
        <Btn label="APPROVE" color={C.green} onClick={()=>onLabel(t.id,'approve',1)}/>
        <Btn label="HOLD" color={C.gold} onClick={()=>onLabel(t.id,'approve',0)}/>
        <Btn label="REJECT" color={C.red} onClick={()=>onLabel(t.id,'approve',-1)}/>
        <Btn label="CORRECT" color={C.magenta} onClick={()=>{setDraft(JSON.stringify(t.action,null,1));setEditing(true);}}/>
      </div>)}
    </div>);
}

export default function ResidentConsole(){
  const [msgs,setMsgs] = useState<Msg[]>([]);
  const [input,setInput] = useState('');
  const [busy,setBusy] = useState(false);
  const [traces,setTraces] = useState<Trace[]>([]);
  const [trainset,setTrainset] = useState<any>(null);
  const [health,setHealth] = useState<any>(null);
  const [drop,setDrop] = useState<any[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async ()=>{
    const [h,tr,db] = await Promise.all([api('/health'),api('/traces','' as any,'n=15'),api('/dropbox')]);
    if(h?.ok){setHealth(h);setTrainset(h.trainset);}
    if(tr?.traces) setTraces(tr.traces);
    if(db?.files) setDrop(db.files);
  },[]);
  useEffect(()=>{refresh(); const t=setInterval(refresh,15000); return ()=>clearInterval(t);},[refresh]);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth'});},[msgs]);

  const send = async ()=>{
    const intent = input.trim(); if(!intent||busy) return;
    setInput(''); setBusy(true);
    setMsgs(m=>[...m,{who:'you',text:intent}]);
    const r = await api('/decide',{intent});
    if(r?.error){ setMsgs(m=>[...m,{who:'system',text:'resident error: '+r.error}]); }
    else { setMsgs(m=>[...m,{who:'resident',
      text:`trace#${r.trace_id_db} -> ${r.verb} (${r.valid?'schema ok':'INVALID: '+r.validation}) - PENDING_APPROVAL`,trace:r.action}]); }
    setBusy(false); refresh();
  };

  const onLabel = async (id:number,what:string,payload?:any)=>{
    if(what==='approve') await api('/approve',{id,outcome:payload});
    else if(what==='correct') await api('/correct',{id,action:payload});
    refresh();
  };

  const onFile = async (e:React.ChangeEvent<HTMLInputElement>)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const b64:string = await new Promise((res,rej)=>{const r=new FileReader();
      r.onload=()=>res((r.result as string).split(',')[1]); r.onerror=()=>rej(new Error('read failed')); r.readAsDataURL(f);});
    const r = await api('/upload',{filename:f.name,content_b64:b64});
    setMsgs(m=>[...m,{who:'system',text:r?.saved?`file saved to dropbox: ${r.saved} (${r.bytes} bytes) - assimilate via Modules when ready`:`upload error: ${r?.error}`}]);
    e.target.value=''; refresh();
  };

  const pTitle = (t:string,c:string)=>(<div style={{padding:'6px 10px',borderBottom:`1px solid ${c}25`,
    color:c,fontFamily:mono,fontSize:10,letterSpacing:2,textTransform:'uppercase' as const,textShadow:`0 0 6px ${c}`}}>{t}</div>);
  const panel = (c:string):React.CSSProperties=>({background:C.card,border:`1px solid ${c}35`,borderRadius:8,
    backdropFilter:'blur(8px)',overflow:'hidden',marginBottom:8});

  return (
    <div style={{display:'grid',gridTemplateColumns:'1.4fr 1fr',gap:10}}>
      <div>
        <div style={panel(C.cyan)}>
          {pTitle(`Resident · ${health?.model ?? 'offline'} ${health?.ok?'· ONLINE':''}`,C.cyan)}
          <div style={{height:340,overflowY:'auto',padding:'10px 12px'}}>
            {msgs.length===0 && <div style={{fontFamily:body,fontSize:12,color:'rgba(255,255,255,0.4)'}}>
              Give the resident an intent. It retrieves context, emits one gated action, and waits at the gate.</div>}
            {msgs.map((m,i)=>(<div key={i} style={{marginBottom:8}}>
              <span style={{fontFamily:mono,fontSize:9,color:m.who==='you'?C.gold:m.who==='resident'?C.magenta:C.red}}>
                {m.who.toUpperCase()}</span>
              <div style={{fontFamily:body,fontSize:13,color:'rgba(255,255,255,0.85)'}}>{m.text}</div>
              {m.trace && <pre style={{fontFamily:body,fontSize:11,color:'rgba(255,0,255,0.7)',whiteSpace:'pre-wrap',margin:'2px 0 0 0'}}>{JSON.stringify(m.trace,null,1)}</pre>}
            </div>))}
            {busy && <div style={{fontFamily:mono,fontSize:10,color:C.cyan}}>RESIDENT DECIDING…</div>}
            <div ref={endRef}/>
          </div>

          <div style={{display:'flex',gap:6,padding:'8px 10px',borderTop:`1px solid ${C.cyan}25`}}>
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')send();}}
              placeholder="intent for the resident…" style={{flex:1,background:'rgba(0,0,0,0.5)',
              color:C.cyan,border:`1px solid ${C.cyan}35`,borderRadius:4,fontFamily:body,fontSize:13,padding:'6px 8px',outline:'none'}}/>
            <Btn label={busy?'…':'SEND'} color={C.cyan} onClick={send}/>
          </div>
        </div>
        <div style={panel(C.gold)}>
          {pTitle('File dropbox (gated - saved, never auto-ingested)',C.gold)}
          <div style={{padding:'8px 12px'}}>
            <input type="file" onChange={onFile} style={{fontFamily:body,fontSize:12,color:C.gold}}/>
            <div style={{marginTop:6}}>
              {drop.slice(-6).map((f,i)=>(<div key={i} style={{fontFamily:body,fontSize:11,color:'rgba(255,255,255,0.55)'}}>{f.name} · {f.bytes}b</div>))}
              {drop.length===0 && <span style={{fontFamily:body,fontSize:11,color:'rgba(255,255,255,0.35)'}}>dropbox empty</span>}
            </div>
          </div>
        </div>
      </div>
      <div>
        <div style={panel(C.magenta)}>
          {pTitle(`Decision gate · gold ${trainset?.gold_labels ?? '–'}/${trainset?.total_traces ?? '–'} (${trainset?.from_corrections ?? 0} corrected)`,C.magenta)}
          <div style={{maxHeight:520,overflowY:'auto',padding:'8px 10px'}}>
            {traces.map(t=>(<DecisionCard key={t.id} t={t} onLabel={onLabel}/>))}
            {traces.length===0 && <span style={{fontFamily:body,fontSize:11,color:'rgba(255,255,255,0.35)'}}>no traces yet</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
