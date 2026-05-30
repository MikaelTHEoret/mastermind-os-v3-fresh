'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import EnhancedNexusBackground from '@/components/EnhancedNexusBackground';
import StrategicHUDLayout from '@/components/StrategicHUDLayout';

type ChatMsg = { ts: string; username: string; message: string; is_bot_response: boolean; account_type: string; };
type TpsPt   = { ts: string; tps: number; };
type Chunk   = { event_type: string; world_x: number; world_z: number; ts: string; };

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
    const [chat,     setChat]     = useState<ChatMsg[]>([]);
    const [tpsHist,  setTpsHist]  = useState<TpsPt[]>([]);
    const [chunks,   setChunks]   = useState<Chunk[]>([]);
    const [acCount,  setAcCount]  = useState(0);
    const [chunks5m, setChunks5m] = useState(0);
    const [online,   setOnline]   = useState(false);
    const [lastUpd,  setLastUpd]  = useState('');
    const chatRef = useRef<HTMLDivElement>(null);

    const fetchAll = useCallback(async () => {
        try {
            const [intel, tpsRes, chunkRes] = await Promise.all([
                fetch('/api/dashboard/intelligence', {cache:'no-store'}).then(r=>r.json()),
                fetch('/api/tps/timeline',           {cache:'no-store'}).then(r=>r.json()),
                fetch('/api/radar/chunks?minutes=15',{cache:'no-store'}).then(r=>r.json()),
            ]);

            if (intel.ok) {
                setChat(intel.chat ?? []);
                setAcCount(intel.ac_count ?? 0);
            }
            if (tpsRes.ok)   setTpsHist(tpsRes.timeline ?? []);
            if (chunkRes.ok) {
                const evts: Chunk[] = chunkRes.events ?? [];
                setChunks(evts);
                const cut = Date.now() - 5 * 60 * 1000;
                setChunks5m(evts.filter(e => new Date(e.ts).getTime() > cut).length);
            }

            // Online = TPS data in last 5 min OR chunks in last 5 min
            const recentTps = (tpsRes.timeline ?? []).filter((t: TpsPt) =>
                Date.now() - new Date(t.ts).getTime() < 300000
            );
            setOnline(recentTps.length > 0 || chunks5m > 0);
            setLastUpd(new Date().toLocaleTimeString());
        } catch { /* silent */ }
    }, [chunks5m]);

    useEffect(() => {
        fetchAll();
        const t = setInterval(fetchAll, 5000);
        return () => clearInterval(t);
    }, [fetchAll]);

    useEffect(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }, [chat.length]);

    const chatAsc    = [...chat].reverse();
    const recentTps  = tpsHist.slice(-1)[0]?.tps ?? null;
    const tpsStr     = recentTps !== null ? recentTps.toFixed(1) : '—';
    const tpsColor   = recentTps === null ? C.dim : recentTps > 18 ? C.green : recentTps > 12 ? C.gold : C.red;

    // ── TOP BAR ──────────────────────────────────────────────────────────
    const topBar = (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontFamily:mono,fontSize:11}}>
            <div style={{display:'flex',alignItems:'center',gap:16}}>
                <Glow>ⵐ MASTERMIND</Glow>
                <span style={{color:C.dim}}>v3.0 — 2b2t COMMAND CENTER</span>
            </div>
            <div style={{display:'flex',gap:24,fontSize:12}}>
                <span>TPS <Glow color={tpsColor}>{tpsStr}</Glow></span>
                <span>CHUNKS/5m <Glow color={chunks5m>50?C.green:C.dim}>{chunks5m}</Glow></span>
                <span>AC <Glow color={acCount?C.red:C.dim}>{acCount}</Glow></span>
                <span style={{color:online?C.green:C.red, textShadow:`0 0 6px ${online?C.green:C.red}`}}>
                    {online ? '● LIVE' : '○ OFFLINE'}
                </span>
                <span style={{color:C.dim}}>↺ {lastUpd}</span>
            </div>
        </div>
    );

    // ── LEFT ─────────────────────────────────────────────────────────────
    const leftSidebar = (
        <div>
            <Panel title="Travel (5m)" color={C.gold}>
                <StatRow label="Chunk loads"  value={chunks5m} color={C.green}/>
                <StatRow label="Load rate"    value={chunks5m > 0 ? `${(chunks5m/300).toFixed(1)}/s` : '—'} color={C.cyan}/>
                <StatRow label="AC hits (10m)"value={acCount}  color={acCount ? C.red : C.dim}/>
            </Panel>
            <Panel title="TPS History">
                {tpsHist.length > 0 ? (
                    <>
                        <StatRow label="Current" value={tpsStr}                                                color={tpsColor}/>
                        <StatRow label="Min (1h)" value={Math.min(...tpsHist.slice(-360).map(t=>t.tps)).toFixed(1)} color={C.gold}/>
                        <StatRow label="Avg (1h)" value={(tpsHist.slice(-360).reduce((a,t)=>a+t.tps,0)/Math.max(tpsHist.slice(-360).length,1)).toFixed(1)}/>
                        <StatRow label="Samples"  value={tpsHist.length}/>
                    </>
                ) : <span style={{color:C.dim,fontSize:11}}>No TPS data yet</span>}
            </Panel>
        </div>
    );

    // ── MAIN ─────────────────────────────────────────────────────────────
    const mainContent = (
        <div style={{height:'100%',display:'flex',flexDirection:'column',gap:10}}>
            <div style={{background:C.card,border:`1px solid ${C.cyan}35`,borderRadius:8,padding:14,flex:'0 0 auto'}}>
                <div style={{fontFamily:mono,color:C.cyan,fontSize:10,marginBottom:10,letterSpacing:2}}>◈ TPS TIMELINE — BACKEND SIGNATURE</div>
                <TPSChart data={tpsHist}/>
            </div>
            <div style={{background:C.card,border:`1px solid ${C.gold}35`,borderRadius:8,padding:14,flex:1}}>
                <div style={{fontFamily:mono,color:C.gold,fontSize:10,marginBottom:10,letterSpacing:2}}>◈ CHUNK RADAR — MOVEMENT TRACE</div>
                <ChunkRadar data={chunks}/>
            </div>
        </div>
    );

    // ── RIGHT — Chat newest at bottom ─────────────────────────────────────
    const rightSidebar = (
        <div style={{height:'100%'}}>
            <Panel title="Chat Intelligence" color={C.green} nopad>
                <div ref={chatRef} style={{maxHeight:520,overflowY:'auto',padding:'8px 12px',display:'flex',flexDirection:'column',gap:4}}>
                    {chatAsc.map((m,i)=>(
                        <div key={i} style={{fontSize:11,fontFamily:'monospace',borderBottom:`1px solid rgba(0,255,255,0.06)`,paddingBottom:4}}>
                            <span style={{color:C.dim}}>{new Date(m.ts).toLocaleTimeString()} </span>
                            <span style={{color:m.account_type==='pure_bot'?C.red:m.account_type==='auto_reply'?C.gold:C.green,fontWeight:'bold'}}>
                                {m.account_type==='pure_bot'?'🤖':m.account_type==='auto_reply'?'⚡':'👤'}{m.username}
                            </span>
                            <span style={{color:'rgba(255,255,255,0.75)'}}> {m.message}</span>
                        </div>
                    ))}
                    {!chatAsc.length && <span style={{color:C.dim,fontSize:11}}>Monitoring chat...</span>}
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
function TPSChart({ data }: { data: TpsPt[] }) {
    const recent = data.slice(-120);
    const H=110, MAX=21, W=500;
    if (!recent.length) return <div style={{color:C.dim,fontSize:11,fontFamily:body}}>Waiting for TPS data — connect to 2b2t</div>;
    const pts = recent.map((t,i)=>`${(i/Math.max(recent.length-1,1))*W},${H-(t.tps/MAX)*H}`).join(' ');
    const cur = recent[recent.length-1].tps;
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
                {recent.length} samples · {Math.min(...recent.map(t=>t.tps)).toFixed(1)}–{Math.max(...recent.map(t=>t.tps)).toFixed(1)} TPS
            </div>
        </div>
    );
}

// ── Chunk Radar ───────────────────────────────────────────────────────────
function ChunkRadar({ data }: { data: Chunk[] }) {
    const loads = data.filter(e=>e.event_type==='LOAD');
    if (!loads.length) return <div style={{color:C.dim,fontSize:11,fontFamily:body}}>No chunk data — movement will populate this</div>;
    const xs=loads.map(e=>e.world_x), zs=loads.map(e=>e.world_z);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    const rX=maxX-minX||512, rZ=maxZ-minZ||512;
    const W=480, H=140, pad=8;
    const toX=(x:number)=>pad+((x-minX)/rX)*(W-pad*2);
    const toY=(z:number)=>pad+((z-minZ)/rZ)*(H-pad*2);
    const oldest=Math.min(...loads.map(e=>new Date(e.ts).getTime()));
    const span=Date.now()-oldest||1;
    const latest=loads[0];
    return (
        <div>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{background:'rgba(0,0,0,0.4)',borderRadius:4}}>
                {loads.map((e,i)=>{
                    const age=(new Date(e.ts).getTime()-oldest)/span;
                    return <circle key={i} cx={toX(e.world_x)} cy={toY(e.world_z)} r="1.2" fill={C.cyan} opacity={0.15+age*0.85}/>;
                })}
                <circle cx={toX(latest.world_x)} cy={toY(latest.world_z)} r="5" fill="none" stroke={C.magenta} strokeWidth="1.5" style={{filter:`drop-shadow(0 0 4px ${C.magenta})`}}/>
                <circle cx={toX(latest.world_x)} cy={toY(latest.world_z)} r="2" fill={C.magenta} opacity={0.9}/>
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
