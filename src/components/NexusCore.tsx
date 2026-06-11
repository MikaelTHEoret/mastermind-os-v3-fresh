'use client';
import { useEffect, useState, useCallback, useRef } from 'react';

const C = { cyan:'#00ffff', magenta:'#ff00ff', gold:'#ffaa00', green:'#00ffaa', red:'#ff4444', dim:'rgba(0,255,255,0.35)', card:'rgba(0,15,35,0.75)' };
const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';

type Pulse = { ts:string; online:boolean; status:string };
type Proposal = { id:number; key:string; kind:string; severity:string; summary:string; detail:string; status:string };
type State = { latest:{ status:string; online:boolean; assessment:string; ts:string; directive?:string|null; archivist_model?:string|null }|null; recent:Pulse[]; proposals:Proposal[] };

const sevColor = (s:string) => s==='watch'?C.gold : s==='todo'?C.cyan : s==='alert'?C.red : C.dim;
const statusColor = (s?:string) => s==='ONLINE'?C.green : s==='IDLE'?C.gold : C.red;

function ageOf(ts?:string){ if(!ts) return '—'; const d=(Date.now()-new Date(ts).getTime())/1000;
    return d<90?`${Math.round(d)}s`:d<5400?`${Math.round(d/60)}m`:d<172800?`${(d/3600).toFixed(1)}h`:`${(d/86400).toFixed(1)}d`; }

export default function NexusCore() {
    const [s, setS] = useState<State|null>(null);
    const [beating, setBeating] = useState(false);
    const busy = useRef(false);

    const pollState = useCallback(async () => {
        try { const r = await fetch('/api/nexus/state', {cache:'no-store'}).then(r=>r.json()); if(r.ok) setS(r); } catch {}
    }, []);
    const beat = useCallback(async () => {
        if (busy.current) return; busy.current = true; setBeating(true);
        try { await fetch('/api/nexus/tick', {method:'POST',cache:'no-store'}); await pollState(); }
        catch {} finally { busy.current = false; setTimeout(()=>setBeating(false), 600); }
    }, [pollState]);

    useEffect(() => {
        beat();                                   // first breath on mount
        const b = setInterval(beat, 20000);       // GUI heartbeat
        const p = setInterval(pollState, 5000);   // readout refresh
        return () => { clearInterval(b); clearInterval(p); };
    }, [beat, pollState]);

    const gate = async (id:number, action:'approve'|'dismiss') => {
        try { await fetch('/api/nexus/proposal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action})}); await pollState(); } catch {}
    };

    const st = s?.latest?.status ?? '—';
    const sc = statusColor(s?.latest?.status);
    const recent = s?.recent ?? [];
    const proposals = s?.proposals ?? [];

    return (
        <div style={{background:C.card,border:`1px solid ${sc}55`,borderRadius:8,marginBottom:8,backdropFilter:'blur(8px)',overflow:'hidden',boxShadow:`0 0 14px ${sc}22`}}>
            <div style={{padding:'8px 12px',borderBottom:`1px solid ${sc}30`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{color:sc,fontFamily:mono,fontSize:10,letterSpacing:2,textTransform:'uppercase',textShadow:`0 0 6px ${sc}`}}>◆ Nexus Core</span>
                <span style={{width:8,height:8,borderRadius:'50%',background:sc,boxShadow:`0 0 ${beating?10:5}px ${sc}`,transition:'box-shadow .3s',opacity:beating?1:0.7}}/>
            </div>
            <div style={{padding:'10px 12px'}}>
                <div style={{display:'flex',justifyContent:'space-between',fontFamily:mono,fontSize:11,marginBottom:8}}>
                    <span style={{color:sc,textShadow:`0 0 6px ${sc}`}}>{st}</span>
                    <span style={{color:C.dim}}>pulse {ageOf(s?.latest?.ts)}</span>
                </div>

                {/* heartbeat strip */}
                <div style={{display:'flex',gap:1,height:18,alignItems:'flex-end',marginBottom:8}}>
                    {recent.length===0 && <span style={{color:C.dim,fontSize:10,fontFamily:body}}>awaiting first pulse…</span>}
                    {recent.map((p,i)=>(
                        <span key={i} title={`${new Date(p.ts).toLocaleTimeString()} · ${p.status}`}
                            style={{flex:1,minWidth:1,height:p.online?16:6,background:p.online?C.green:C.red,opacity:0.35+0.65*(i/Math.max(recent.length-1,1)),borderRadius:1}}/>
                    ))}
                </div>

                {/* the archivist's directive — the resident interpreter's voice */}
                <div style={{borderLeft:`2px solid ${C.magenta}`,paddingLeft:8,marginBottom:8}}>
                    <div style={{fontFamily:mono,fontSize:8,letterSpacing:2,color:C.magenta,textShadow:`0 0 6px ${C.magenta}`,marginBottom:3}}>
                        ❖ ARCHIVIST {s?.latest?.archivist_model ? `· ${s.latest.archivist_model}` : '· offline (laws only)'}
                    </div>
                    <div style={{fontFamily:body,fontSize:12,color:s?.latest?.directive?'rgba(255,210,255,0.9)':C.dim,lineHeight:1.35,fontStyle:s?.latest?.directive?'normal':'italic'}}>
                        {s?.latest?.directive ?? 'No resident mind yet — running on deterministic laws. Pull a model or set a key to wake the Archivist.'}
                    </div>
                </div>

                <div style={{fontFamily:body,fontSize:12,color:'rgba(255,255,255,0.8)',lineHeight:1.35,marginBottom:proposals.length?10:0}}>
                    {s?.latest?.assessment ?? 'Nexus initializing…'}
                </div>

                {/* the gate */}
                {proposals.map(pr=>(
                    <div key={pr.id} style={{borderTop:`1px solid ${sevColor(pr.severity)}22`,paddingTop:8,marginTop:8}}>
                        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                            <span style={{width:6,height:6,borderRadius:'50%',background:sevColor(pr.severity),boxShadow:`0 0 5px ${sevColor(pr.severity)}`}}/>
                            <span style={{fontFamily:mono,fontSize:10,color:sevColor(pr.severity),letterSpacing:1,flex:1}}>{pr.summary}</span>
                            {pr.status==='approved' && <span style={{fontSize:9,color:C.green,fontFamily:mono}}>✓ APPROVED</span>}
                        </div>
                        <div style={{fontFamily:body,fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.3,marginBottom:6}}>{pr.detail}</div>
                        {pr.status!=='approved' && (
                            <div style={{display:'flex',gap:6}}>
                                <button onClick={()=>gate(pr.id,'approve')} style={btn(C.green)}>✓ approve</button>
                                <button onClick={()=>gate(pr.id,'dismiss')} style={btn(C.dim)}>✕ dismiss</button>
                            </div>
                        )}
                    </div>
                ))}
                {proposals.length===0 && s?.latest && (
                    <div style={{fontFamily:body,fontSize:11,color:C.dim,marginTop:6}}>No open proposals — core nominal.</div>
                )}
            </div>
        </div>
    );
}

function btn(color:string): React.CSSProperties {
    return { flex:1,background:`${color}15`,border:`1px solid ${color}55`,color,fontFamily:mono,fontSize:9,letterSpacing:1,
        padding:'5px 0',borderRadius:4,cursor:'pointer',textTransform:'uppercase' };
}
