'use client';
// AutonomicConsole.tsx -- the AUTONOMIC tab: the organism's homeostasis surface.
// Live vitals (resource_monitor) + a HEARTBEAT (slow auto-tick daemon, :8773) that accumulates HELD proposals
// into orchestrator_traces, shown as a live FEED. RUN TICK = a manual beat. Each pending proposal is actionable:
// APPROVE & EXECUTE -> the EXISTING gated /execute; DENY -> /approve outcome -1. CRITICAL vitals halt cognition.
// Everything routes through the existing /api/orchestrator proxy (:8771) -- no parallel mechanism.
import { useEffect, useRef, useState, useCallback } from 'react';

const C = { cyan:'#00ffff', magenta:'#ff00ff', violet:'#8a2be2', gold:'#ffaa00',
            green:'#00ffaa', red:'#ff4444', dim:'rgba(0,255,255,0.35)', card:'rgba(0,15,35,0.75)' };
const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';

type Verdict = { verdict:string; level:number; reasons:string[]; safe_to_act:boolean;
                 vitals:{ cpu:number; ram:number; disk:number; ram_avail_gb:number;
                          fleet:Record<string,boolean>; fleet_up:number; fleet_total:number } };
type HB = { beats:number; skips:number; last_ts:number|null; last_verdict:string|null;
            last_trace_id:number|null; paused:boolean; interval:number; last_skip_reason:string|null; note?:string;
            last_intent?:string|null; last_salient?:boolean|null };
type Trace = { id:number; ts:string; task:string; verb:string; valid:boolean; outcome:number|null; action:any };

function api(path:string, post?:any){
  const u = `/api/orchestrator?path=${encodeURIComponent(path)}`;
  return post!==undefined
    ? fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(post)}).then(r=>r.json())
    : fetch(u,{cache:'no-store'}).then(r=>r.json());
}

const vColor = (lvl:number)=> lvl>=2 ? C.red : lvl>=1 ? C.gold : C.green;
const barColor = (p:number)=> p>=95 ? C.red : p>=80 ? C.gold : C.green;
const ago = (ts:number|null)=> ts==null ? '—' : `${Math.max(0,Math.round(Date.now()/1000-ts))}s ago`;

function Btn({label,color,onClick,disabled}:{label:string;color:string;onClick:()=>void;disabled?:boolean}){
  return <span onClick={disabled?undefined:onClick} style={{cursor:disabled?'default':'pointer',
    color:disabled?C.dim:color, border:`1px solid ${disabled?C.dim:color}55`, borderRadius:4,
    padding:'2px 9px', marginRight:6, fontFamily:mono, fontSize:9, letterSpacing:1,
    textShadow:disabled?'none':`0 0 5px ${color}`, opacity:disabled?0.5:1}}>{label}</span>;
}

function VBar({label,pct,suffix}:{label:string;pct:number;suffix?:string}){
  const c = barColor(pct);
  return (
    <div style={{marginBottom:7}}>
      <div style={{display:'flex',justifyContent:'space-between',fontFamily:mono,fontSize:9,letterSpacing:1,marginBottom:3}}>
        <span style={{color:C.dim}}>{label}</span>
        <span style={{color:c,textShadow:`0 0 5px ${c}`}}>{pct.toFixed(0)}%{suffix||''}</span>
      </div>
      <div style={{height:6,background:'rgba(0,255,255,0.08)',borderRadius:3,overflow:'hidden'}}>
        <div style={{width:`${Math.min(pct,100)}%`,height:'100%',background:c,boxShadow:`0 0 8px ${c}`}}/>
      </div>
    </div>
  );
}

function FeedRow({t,busy,onApprove,onDeny}:{t:Trace;busy:boolean;onApprove:()=>void;onDeny:()=>void}){
  const pending = t.outcome==null;
  const oc = t.outcome===1?C.green:t.outcome===-1?C.red:C.gold;
  const ol = t.outcome===1?'EXECUTED':t.outcome===-1?'DENIED':'HELD';
  return (
    <div style={{border:`1px solid ${oc}30`,borderRadius:6,padding:'7px 10px',marginBottom:6,background:'rgba(0,8,20,0.55)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
        <span style={{fontFamily:mono,fontSize:9,color:C.cyan}}>#{t.id} <span style={{color:C.violet}}>{t.verb||'?'}</span></span>
        <span style={{fontFamily:mono,fontSize:8,color:oc,textShadow:`0 0 5px ${oc}`}}>{ol}</span>
      </div>
      <div style={{fontFamily:body,fontSize:11,color:'rgba(255,255,255,0.6)',marginBottom:pending?6:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{(t.task||'').slice(0,90)}</div>
      {pending && <div>
        <Btn label="✓ APPROVE & EXECUTE" color={C.green} onClick={onApprove} disabled={busy}/>
        <Btn label="✕ DENY" color={C.red} onClick={onDeny} disabled={busy}/>
      </div>}
    </div>
  );
}

export default function AutonomicConsole(){
  const [v,setV] = useState<Verdict|null>(null);
  const [hb,setHb] = useState<HB|null>(null);
  const [feed,setFeed] = useState<Trace[]>([]);
  const [busy,setBusy] = useState(false);
  const [msg,setMsg] = useState('');
  const timer = useRef<any>(null);

  const refresh = useCallback(()=>{
    api('/autonomic').then(d=>{ if(d&&d.verdict) setV(d); }).catch(()=>{});
    api('/heartbeat').then(d=>{ if(d&&typeof d.beats==='number') setHb(d); }).catch(()=>{});
    api('/traces').then(d=>{ if(d&&d.traces) setFeed(d.traces.slice(0,10)); }).catch(()=>{});
  },[]);

  useEffect(()=>{ refresh(); timer.current=setInterval(refresh,4000); return ()=>clearInterval(timer.current); },[refresh]);

  const runTick = useCallback(()=>{
    setBusy(true); setMsg('');
    api('/autonomic/tick',{intent:'survey the system and propose one small improvement'})
      .then(d=>{ setBusy(false); setMsg(d.halted?('Halted: '+(d.reason||'critical')):('Ticked → held trace #'+(d.trace_id??'?')+' (in feed)')); refresh(); })
      .catch(e=>{ setMsg(String(e)); setBusy(false); });
  },[refresh]);

  const runToolTick = useCallback(()=>{
    setBusy(true); setMsg('');
    api('/autonomic/tick_tool',{intent:'survey the system; if a change is warranted, use a tool to make it'})
      .then(d=>{ setBusy(false); setMsg(d.held?('Tool tick → held '+d.tool+' (#'+d.trace_id+') in feed'):(d.halted?('Halted: '+(d.reason||'')):('Tool tick → '+(d.note||'no gated tool proposed')))); refresh(); })
      .catch(e=>{ setMsg(String(e)); setBusy(false); });
  },[refresh]);

  const togglePause = useCallback(()=>{
    if(!hb) return;
    setBusy(true);
    api('/heartbeat/pause',{paused:!hb.paused}).then(()=>{ setBusy(false); refresh(); }).catch(e=>{ setMsg(String(e)); setBusy(false); });
  },[hb,refresh]);

  const approve = useCallback((id:number)=>{
    setBusy(true); setMsg('');
    api('/approve',{id,outcome:1}).then(()=> api('/execute',{id})).then(d=>{
      setMsg(d&&d.error ? ('execute error: '+d.error) : (d&&d.ran===false ? ('held/blocked: '+(d.reason||'')) : ('Executed trace #'+id+(d&&d.via?(' via '+d.via):'')+'.')));
    }).catch(e=>setMsg(String(e))).finally(()=>{ setBusy(false); refresh(); });
  },[refresh]);

  const deny = useCallback((id:number)=>{
    setBusy(true);
    api('/approve',{id,outcome:-1}).then(()=>{ setMsg('Denied trace #'+id+'.'); }).catch(e=>setMsg(String(e))).finally(()=>{ setBusy(false); refresh(); });
  },[refresh]);

  const lvl = v ? v.level : 0;
  const critical = v ? !v.safe_to_act : false;
  const pending = feed.filter(t=>t.outcome==null).length;

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0,fontFamily:body,gap:10}}>
      {/* header */}
      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <span style={{fontFamily:mono,fontSize:12,color:C.cyan,textShadow:`0 0 6px ${C.cyan}`,letterSpacing:2}}>AUTONOMIC</span>
        {v && <span style={{fontFamily:mono,fontSize:10,color:vColor(lvl),border:`1px solid ${vColor(lvl)}66`,
          borderRadius:4,padding:'2px 10px',textShadow:`0 0 6px ${vColor(lvl)}`,letterSpacing:1}}>{v.verdict}</span>}
        {v && <span style={{fontFamily:mono,fontSize:9,color:v.vitals.fleet_up===v.vitals.fleet_total?C.green:C.gold}}>FLEET {v.vitals.fleet_up}/{v.vitals.fleet_total}</span>}
        <span style={{marginLeft:'auto'}}>
          <Btn label={busy?'· · ·':'RUN TICK'} color={C.cyan} onClick={runTick} disabled={busy||critical}/>
          <Btn label="TOOL TICK" color={C.violet} onClick={runToolTick} disabled={busy||critical}/>
        </span>
      </div>

      {critical && <div style={{border:`1px solid ${C.red}`,borderRadius:6,padding:'8px 12px',background:'rgba(40,0,0,0.4)',
        color:C.red,fontFamily:mono,fontSize:11,textShadow:`0 0 6px ${C.red}`}}>
        ⚠ COGNITION HALTED — vitals critical{v&&v.reasons.length?` (${v.reasons.join(', ')})`:''}. Heartbeat skips beats until the body recovers.</div>}

      {/* heartbeat strip */}
      <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',background:C.card,border:`1px solid ${C.magenta}30`,
        borderRadius:8,padding:'8px 14px'}}>
        <span style={{fontFamily:mono,fontSize:10,color:hb&&hb.paused?C.dim:C.magenta,textShadow:hb&&hb.paused?'none':`0 0 7px ${C.magenta}`}}>
          {hb&&hb.paused?'♡ PAUSED':'♥ HEARTBEAT'}</span>
        {hb ? <>
          <span style={{fontFamily:body,fontSize:12,color:'rgba(255,255,255,0.7)'}}>{hb.beats} beats · {hb.skips} skips</span>
          <span style={{fontFamily:body,fontSize:12,color:C.dim}}>last {ago(hb.last_ts)} · every {hb.interval}s</span>
          {hb.last_salient!=null && <span title={hb.last_intent||''} style={{fontFamily:body,fontSize:11,
            color:hb.last_salient?C.gold:C.dim,cursor:'help'}}>{hb.last_salient?`◆ surfaced #${hb.last_trace_id??'?'}`:'· nominal — holding'}</span>}
          {hb.last_skip_reason && <span style={{fontFamily:body,fontSize:11,color:C.gold}}>↯ {hb.last_skip_reason.slice(0,46)}</span>}
          <span style={{marginLeft:'auto'}}>
            <Btn label={hb.paused?'▶ RESUME':'⏸ PAUSE'} color={hb.paused?C.green:C.gold} onClick={togglePause} disabled={busy}/>
          </span>
        </> : <span style={{color:C.dim,fontSize:11}}>heartbeat status…</span>}
      </div>

      {/* vitals + fleet */}
      <div style={{display:'flex',gap:14,flexWrap:'wrap'}}>
        <div style={{flex:'1 1 260px',background:C.card,border:`1px solid ${C.cyan}30`,borderRadius:8,padding:'12px 14px'}}>
          <div style={{fontFamily:mono,fontSize:9,color:C.cyan,letterSpacing:2,marginBottom:10}}>◈ VITALS</div>
          {v ? <>
            <VBar label="CPU"  pct={v.vitals.cpu}/>
            <VBar label="RAM"  pct={v.vitals.ram} suffix={` · ${v.vitals.ram_avail_gb}GB free`}/>
            <VBar label="DISK" pct={v.vitals.disk}/>
          </> : <span style={{color:C.dim,fontSize:11}}>reading vitals…</span>}
        </div>
        <div style={{flex:'1 1 200px',background:C.card,border:`1px solid ${C.cyan}30`,borderRadius:8,padding:'12px 14px'}}>
          <div style={{fontFamily:mono,fontSize:9,color:C.cyan,letterSpacing:2,marginBottom:10}}>◈ FLEET</div>
          {v ? <div style={{display:'flex',flexDirection:'column',gap:4}}>
            {Object.entries(v.vitals.fleet).map(([name,up])=>(
              <div key={name} style={{display:'flex',justifyContent:'space-between',fontFamily:body,fontSize:12}}>
                <span style={{color:'rgba(255,255,255,0.6)'}}>{name}</span>
                <span style={{color:up?C.green:C.red,fontFamily:mono,fontSize:9}}>{up?'● UP':'○ DOWN'}</span>
              </div>
            ))}
          </div> : <span style={{color:C.dim,fontSize:11}}>probing…</span>}
        </div>
      </div>

      {/* proposal feed */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
        <span style={{fontFamily:mono,fontSize:9,color:C.gold,letterSpacing:2}}>◈ PROPOSAL FEED</span>
        <span style={{fontFamily:mono,fontSize:8,color:pending?C.gold:C.dim}}>{pending} pending</span>
      </div>
      <div style={{flex:1,minHeight:0,overflow:'auto'}}>
        {feed.length===0 && <div style={{color:C.dim,fontSize:12,padding:12}}>
          The heartbeat senses, decides, and HOLDS proposals here on a slow cadence — nothing executes until you approve. RUN TICK beats once now.</div>}
        {feed.map(t=><FeedRow key={t.id} t={t} busy={busy} onApprove={()=>approve(t.id)} onDeny={()=>deny(t.id)}/>)}
        {msg && <div style={{color:msg.includes('error')||msg.includes('Halted')?C.gold:C.green,fontFamily:body,fontSize:12,padding:'8px 4px'}}>{msg}</div>}
      </div>
    </div>
  );
}
