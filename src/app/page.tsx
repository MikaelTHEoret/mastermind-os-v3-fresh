'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import EnhancedNexusBackground from '@/components/EnhancedNexusBackground';
import StrategicHUDLayout from '@/components/StrategicHUDLayout';

// ── Types ─────────────────────────────────────────────────────────────────
type Status = { online: boolean; tps: number|null; ping: number|null; chunks_5min: number; ac_count_10min: number; position: {x:number|null,z:number|null}; session_id: string|null; ts: string; };
type Intel  = { chat: ChatMsg[]; ac_count: number; session: {id:string;created_at:string}|null; };
type ChatMsg= { ts: string; username: string; message: string; is_bot_response: boolean; account_type: string; };
type TpsPt  = { ts: string; tps: number; };
type Chunk  = { event_type: string; world_x: number; world_z: number; ts: string; };

// Local state server — only accessible when running dashboard locally
const LOCAL = typeof window !== 'undefined' && window.location.hostname === 'localhost';
const LOCAL_BASE = 'http://localhost:3001';

const C = { cyan:'#00ffff', magenta:'#ff00ff', gold:'#ffaa00', green:'#00ffaa', red:'#ff4444', dim:'rgba(0,255,255,0.35)', card:'rgba(0,15,35,0.75)' };
const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';

function Glow({ children, color=C.cyan }: { children:React.ReactNode; color?:string }) {
    return <span style={{color, textShadow:`0 0 8px ${color}`}}>{children}</span>;
}
function Panel({ title, children, color=C.cyan, nopad }: { title:string; children:React.ReactNode; color?:string; nopad?:boolean }) {
    return (
        <div style={{background:C.card,border:`1px solid ${color}35`,borderRadius:8,marginBottom:8,backdropFilter:'blur(8px)',overflow:'hidden'}}>
            <div style={{padding:'8px 12px',borderBottom:`1px solid ${color}25`,color,fontFamily:mono,fontSize:10,letterSpacing:2,textTransform:'uppercase',textShadow:`0 0 6px ${color}`}}>◈ {title}</div>
            <div style={{padding:nopad?0:'10px 12px'}}>{children}</div>
        </div>
    );
}
function StatRow({ label, value, color=C.cyan }: { label:string; value:string|number; color?:string }) {
    return (
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:5,fontFamily:body}}>
            <span style={{color:'rgba(255,255,255,0.45)'}}>{label}</span>
            <Glow color={color}>{value}</Glow>
        </div>
    );
}

export default function Dashboard() {
    const [status, setStatus]   = useState<Status|null>(null);
    const [intel,  setIntel]    = useState<Intel|null>(null);
    const [tpsHistory, setTps]  = useState<TpsPt[]>([]);
    const [chunks, setChunks]   = useState<Chunk[]>([]);
    const [lastUpdate, setLast] = useState('');
    const chatRef = useRef<HTMLDivElement>(null);

    // ── Local state server (TPS, chunks, position) ────────────────────────
    const fetchLocal = useCallback(async () => {
        if (!LOCAL) return;
        try {
            const [s, t, c] = await Promise.all([
                fetch(`${LOCAL_BASE}/status`,{cache:'no-store'}).then(r=>r.json()),
                fetch(`${LOCAL_BASE}/tps`,   {cache:'no-store'}).then(r=>r.json()),
                fetch(`${LOCAL_BASE}/chunks?minutes=15`,{cache:'no-store'}).then(r=>r.json()),
            ]);
            if (s.ok)  setStatus(s);
            if (t.ok)  setTps(t.timeline ?? []);
            if (c.ok)  setChunks(c.events ?? []);
            setLast(new Date().toLocaleTimeString());
        } catch { /* local server not running */ }
    }, []);

    // ── Neon intelligence (chat, AC — stays small forever) ────────────────
    const fetchIntel = useCallback(async () => {
        try {
            const r = await fetch('/api/dashboard/intelligence', {cache:'no-store'});
            const d = await r.json();
            if (d.ok) setIntel(d);
        } catch {}
    }, []);

    useEffect(() => {
        fetchLocal();
        fetchIntel();
        const t1 = setInterval(fetchLocal, 3000);
        const t2 = setInterval(fetchIntel, 8000); // chat doesn't need to be as fast
        return () => { clearInterval(t1); clearInterval(t2); };
    }, [fetchLocal, fetchIntel]);

    useEffect(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }, [intel?.chat?.length]);

    const online     = status?.online ?? false;
    const tps        = status?.tps?.toFixed(1) ?? '—';
    const tpsColor   = !status?.tps ? C.dim : status.tps > 18 ? C.green : status.tps > 12 ? C.gold : C.red;
    const chunks5m   = status?.chunks_5min ?? 0;
    const acCount    = (intel?.ac_count ?? 0) + (status?.ac_count_10min ?? 0);
    const chatMsgs   = [...(intel?.chat ?? [])].reverse();

    // ── Vercel notice when not local ────────────────────────────────────── 
    const notLocalBanner = !LOCAL ? (
        <div style={{background:'rgba(255,170,0,0.1)',border:'1px solid rgba(255,170,0,0.3)',borderRadius:6,padding:'6px 12px',marginBottom:8,fontSize:11,color:C.gold,fontFamily:body}}>
            ⚡ Live stream (TPS/chunks/radar) requires local access. Chat & AC intelligence from cloud.
            &nbsp;Run dev: <code style={{background:'rgba(0,0,0,0.4)',padding:'1px 6px',borderRadius:3}}>npm run dev</code>
        </div>
    ) : null;

    // ── TOP BAR ───────────────────────────────────────────────────────────
    const topBar = (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontFamily:mono,fontSize:11}}>
            <div style={{display:'flex',alignItems:'center',gap:16}}>
                <Glow color={C.cyan}>ⵐ MASTERMIND</Glow>
                <span style={{color:C.dim}}>v3.0 — 2b2t COMMAND CENTER</span>
            </div>
            <div style={{display:'flex',gap:24,fontSize:12}}>
                <span>TPS <Glow color={tpsColor}>{tps}</Glow></span>
                <span>CHUNKS/5m <Glow color={chunks5m>100?C.green:C.dim}>{chunks5m}</Glow></span>
                <span>AC <Glow color={acCount?C.red:C.dim}>{acCount}</Glow></span>
                <span style={{color:online?C.green:C.red,textShadow:`0 0 6px ${online?C.green:C.red}`}}>
                    {online?'● LIVE':'○ OFFLINE'}
                </span>
                <span style={{color:C.dim}}>↺ {lastUpdate}</span>
            </div>
        </div>
    );

    // ── LEFT ──────────────────────────────────────────────────────────────
    const leftSidebar = (
        <div>
            {notLocalBanner}
            <Panel title="Session" color={C.magenta}>
                {intel?.session
                    ? <><StatRow label="ID"      value={intel.session.id.slice(-8)}  color={C.magenta}/>
                          <StatRow label="Started" value={new Date(intel.session.created_at).toLocaleTimeString()}/></>
                    : <span style={{color:C.dim,fontSize:12}}>No session in cloud</span>}
                {status?.position?.x != null &&
                    <StatRow label="Position" value={`${Math.round(status.position.x).toLocaleString()}, ${Math.round(status.position.z).toLocaleString()}`} color={C.cyan}/>}
            </Panel>
            <Panel title="Travel (5m)" color={C.gold}>
                <StatRow label="Chunk loads"  value={chunks5m}           color={C.green}/>
                <StatRow label="Load rate"    value={chunks5m>0?`${(chunks5m/300).toFixed(1)}/s`:'—'} color={C.cyan}/>
                <StatRow label="AC hits (10m)"value={acCount}            color={acCount?C.red:C.dim}/>
            </Panel>
        </div>
    );

    // ── MAIN ──────────────────────────────────────────────────────────────
    const mainContent = (
        <div style={{height:'100%',display:'flex',flexDirection:'column',gap:10}}>
            <div style={{background:C.card,border:`1px solid ${C.cyan}35`,borderRadius:8,padding:14,flex:'0 0 auto'}}>
                <div style={{fontFamily:mono,color:C.cyan,fontSize:10,marginBottom:10,letterSpacing:2}}>◈ TPS TIMELINE — BACKEND SIGNATURE</div>
                <TPSChart data={tpsHistory} local={LOCAL}/>
            </div>
            <div style={{background:C.card,border:`1px solid ${C.gold}35`,borderRadius:8,padding:14,flex:1}}>
                <div style={{fontFamily:mono,color:C.gold,fontSize:10,marginBottom:10,letterSpacing:2}}>◈ CHUNK RADAR — MOVEMENT TRACE</div>
                <ChunkRadar data={chunks} local={LOCAL}/>
            </div>
        </div>
    );

    // ── RIGHT — Chat ───────────────────────────────────────────────────────
    const rightSidebar = (
        <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
            <Panel title="Chat Intelligence" color={C.green} nopad>
                <div ref={chatRef} style={{maxHeight:520,overflowY:'auto',padding:'8px 12px',display:'flex',flexDirection:'column',gap:4}}>
                    {chatMsgs.map((m,i)=>(
                        <div key={i} style={{fontSize:11,fontFamily:'monospace',borderBottom:`1px solid rgba(0,255,255,0.06)`,paddingBottom:4}}>
                            <span style={{color:C.dim}}>{new Date(m.ts).toLocaleTimeString()} </span>
                            <span style={{color:m.account_type==='pure_bot'?C.red:m.account_type==='auto_reply'?C.gold:C.green,fontWeight:'bold'}}>
                                {m.account_type==='pure_bot'?'🤖':m.account_type==='auto_reply'?'⚡':'👤'}{m.username}
                            </span>
                            <span style={{color:'rgba(255,255,255,0.75)'}}> {m.message}</span>
                        </div>
                    ))}
                    {!chatMsgs.length && <span style={{color:C.dim,fontSize:11}}>Monitoring chat...</span>}
                </div>
            </Panel>
        </div>
    );

    return (
        <EnhancedNexusBackground>
            <div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
                <StrategicHUDLayout topBar={topBar} leftSidebar={leftSidebar} mainContent={mainContent} rightSidebar={rightSidebar}/>
            </div>
        </EnhancedNexusBackground>
    );
}

// ── TPS Chart ─────────────────────────────────────────────────────────────
function TPSChart({ data, local }: { data: TpsPt[]; local: boolean }) {
    // Fallback to Neon when not local
    const [neonData, setNeon] = useState<TpsPt[]>([]);
    useEffect(() => {
        if (local) return;
        const load = () => fetch('/api/tps/timeline').then(r=>r.json()).then(d=>setNeon(d.timeline??[])).catch(()=>{});
        load(); const t=setInterval(load,10000); return ()=>clearInterval(t);
    }, [local]);

    const timeline = local ? data : neonData;
    const recent   = timeline.slice(-120);
    const H=110, MAX=21, W=500;

    if (!recent.length) return (
        <div style={{color:C.dim,fontSize:11,fontFamily:body}}>
            {local ? 'Waiting for TPS data — connect to 2b2t' : 'TPS data requires local dashboard (npm run dev)'}
        </div>
    );

    const pts = recent.map((t,i)=>`${(i/Math.max(recent.length-1,1))*W},${H-(t.tps/MAX)*H}`).join(' ');
    const cur = recent[recent.length-1]?.tps ?? 0;
    const cc  = cur>18?C.green:cur>12?C.gold:C.red;

    return (
        <div>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:'visible'}}>
                {[20,15,10,5].map(v=>(
                    <g key={v}>
                        <line x1={0} y1={H-(v/MAX)*H} x2={W} y2={H-(v/MAX)*H} stroke="rgba(0,255,255,0.07)" strokeDasharray="3 6"/>
                        <text x={W+4} y={H-(v/MAX)*H+4} fill={C.dim} fontSize={8} fontFamily={mono}>{v}</text>
                    </g>
                ))}
                <polyline points={pts} fill="none" stroke={cc} strokeWidth="1.5" style={{filter:`drop-shadow(0 0 3px ${cc})`}}/>
                <polyline points={`0,${H} ${pts} ${W},${H}`} fill={`${cc}18`} stroke="none"/>
                <text x={W-2} y={H-(cur/MAX)*H-6} fill={cc} fontSize={10} textAnchor="end" fontFamily={mono}>{cur.toFixed(1)}</text>
            </svg>
            <div style={{fontSize:10,color:C.dim,marginTop:4,fontFamily:mono}}>
                {recent.length} samples · {Math.min(...recent.map(t=>t.tps)).toFixed(1)} – {Math.max(...recent.map(t=>t.tps)).toFixed(1)} TPS
            </div>
        </div>
    );
}

// ── Chunk Radar ───────────────────────────────────────────────────────────
function ChunkRadar({ data, local }: { data: Chunk[]; local: boolean }) {
    const [neonData, setNeon] = useState<Chunk[]>([]);
    useEffect(() => {
        if (local) return;
        const load = ()=>fetch('/api/radar/chunks?minutes=15').then(r=>r.json()).then(d=>setNeon(d.events??[])).catch(()=>{});
        load(); const t=setInterval(load,8000); return ()=>clearInterval(t);
    }, [local]);

    const loads = (local ? data : neonData).filter(e=>e.event_type==='LOAD');

    if (!loads.length) return (
        <div style={{color:C.dim,fontSize:11,fontFamily:body}}>
            {local ? 'No chunk data — elytra or movement will populate this' : 'Chunk radar requires local dashboard (npm run dev)'}
        </div>
    );

    const xs=loads.map(e=>e.world_x), zs=loads.map(e=>e.world_z);
    const minX=Math.min(...xs), maxX=Math.max(...xs), minZ=Math.min(...zs), maxZ=Math.max(...zs);
    const rX=maxX-minX||512, rZ=maxZ-minZ||512;
    const W=480, H=140, pad=8;
    const toX=(x:number)=>pad+((x-minX)/rX)*(W-pad*2);
    const toY=(z:number)=>pad+((z-minZ)/rZ)*(H-pad*2);
    const oldest=Math.min(...loads.map(e=>new Date(e.ts).getTime()));
    const span=Date.now()-oldest||1;

    return (
        <div>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{background:'rgba(0,0,0,0.4)',borderRadius:4}}>
                {loads.map((e,i)=>{
                    const age=(new Date(e.ts).getTime()-oldest)/span;
                    return <circle key={i} cx={toX(e.world_x)} cy={toY(e.world_z)} r="1.2" fill={C.cyan} opacity={0.15+age*0.85}/>;
                })}
                {(()=>{
                    const l=loads[0];
                    return <g>
                        <circle cx={toX(l.world_x)} cy={toY(l.world_z)} r="5" fill="none" stroke={C.magenta} strokeWidth="1.5" style={{filter:`drop-shadow(0 0 4px ${C.magenta})`}}/>
                        <circle cx={toX(l.world_x)} cy={toY(l.world_z)} r="2" fill={C.magenta} opacity={0.9}/>
                    </g>;
                })()}
                {(['N','S','W','E'] as const).map((d,i)=>{
                    const pos=[[W/2,12],[W/2,H-2],[8,H/2+3],[W-6,H/2+3]][i];
                    return <text key={d} x={pos[0]} y={pos[1]} fill={C.dim} fontSize={7} textAnchor="middle" fontFamily={mono}>{d}</text>;
                })}
            </svg>
            <div style={{fontSize:10,color:C.dim,marginTop:4,fontFamily:mono,display:'flex',justifyContent:'space-between'}}>
                <span>X {Math.round(minX).toLocaleString()} → {Math.round(maxX).toLocaleString()}</span>
                <span>{loads.length} chunks · 15m</span>
                <span>Z {Math.round(minZ).toLocaleString()} → {Math.round(maxZ).toLocaleString()}</span>
            </div>
        </div>
    );
}
