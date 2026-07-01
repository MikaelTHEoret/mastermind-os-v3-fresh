'use client';
import { useEffect, useState, useCallback, useRef, type CSSProperties } from 'react';
import EnhancedNexusBackground from '@/components/EnhancedNexusBackground';
import StrategicHUDLayout from '@/components/StrategicHUDLayout';
import NexusCore from '@/components/NexusCore';
import NexusCoreHero from '@/components/NexusCoreHero';
import { DataTable, LogStream, ConversationView, LiveFeed } from '@/components/views/DataViews';
import OperationsMap from '@/components/OperationsMap';
import ForgeConsole from '@/components/ForgeConsole';
import ModuleExplorer from '@/components/ModuleExplorer';
import ModuleLoader from '@/components/ModuleLoader';
import OrchestratorConsole from '@/components/OrchestratorConsole';
import ChatConsole from '@/components/ChatConsole';
import AutonomicConsole from '@/components/AutonomicConsole';
import NexusGraph3D from '@/components/NexusGraph3D';
import SettingsConsole from '@/components/SettingsConsole';
import TradingConsole from '@/components/TradingConsole';
import { registry } from '@/lib/modules/registry';
import { useModules } from '@/lib/modules/useModules';
import { seedModules } from '@/lib/modules/seed';

seedModules();

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
            <div style={{padding:'8px 12px',borderBottom:`1px solid ${color}25`,color,fontFamily:mono,fontSize:10,letterSpacing:2,textTransform:'uppercase',textShadow:`0 0 6px ${color}`}}>â—ˆ {title}</div>
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
    useModules(); // subscribe: module toggles re-render the dashboard
    const [chat,     setChat]     = useState<ChatMsg[]>([]);
    const [tpsHist,  setTpsHist]  = useState<TpsPt[]>([]);
    const [chunks,   setChunks]   = useState<Chunk[]>([]);
    const [acCount,  setAcCount]  = useState(0);
    const [chunks5m, setChunks5m] = useState(0);
    const [online,   setOnline]   = useState(false);
    const [lastUpd,  setLastUpd]  = useState('');
    const [tab,      setTab]      = useState<'command'|'operations'|'forge'|'modules'|'data'|'orchestrator'|'chat'|'autonomic'|'cymatics'|'graph'|'codex'|'trading'|'settings'>('command');
    const [dataSource, setDataSource] = useState<'chat'|'chunks'>('chat');
    const [dataForm,   setDataForm]   = useState<'conversation'|'table'|'log'|'feed'>('conversation');
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
            // Use freshly fetched data, not stale state
            const cut5m = Date.now() - 5 * 60 * 1000;
            const freshChunks5m = (chunkRes.events ?? []).filter((e: Chunk) =>
                new Date(e.ts).getTime() > cut5m
            ).length;
            const recentTps = (tpsRes.timeline ?? []).filter((t: TpsPt) =>
                new Date(t.ts).getTime() > cut5m
            );
            setOnline(recentTps.length > 0 || freshChunks5m > 0);
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
    const tpsStr     = recentTps !== null ? recentTps.toFixed(1) : 'â€”';
    const tpsColor   = recentTps === null ? C.dim : recentTps > 18 ? C.green : recentTps > 12 ? C.gold : C.red;

    // â”€â”€ TOP BAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const topBar = (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontFamily:mono,fontSize:11}}>
            <div style={{display:'flex',alignItems:'center',gap:16}}>
                <Glow>âµ MASTERMIND</Glow>
                <span style={{color:C.dim}}>v3.0 â€” 2b2t COMMAND CENTER</span>
            </div>
            <div style={{display:'flex',gap:24,fontSize:12}}>
                <span>TPS <Glow color={tpsColor}>{tpsStr}</Glow></span>
                <span>CHUNKS/5m <Glow color={chunks5m>50?C.green:C.dim}>{chunks5m}</Glow></span>
                <span>AC <Glow color={acCount?C.red:C.dim}>{acCount}</Glow></span>
                <span style={{color:online?C.green:C.red, textShadow:`0 0 6px ${online?C.green:C.red}`}}>
                    {online ? 'â— LIVE' : 'â—‹ OFFLINE'}
                </span>
                <span style={{color:C.dim}}>â†º {lastUpd}</span>
            </div>
        </div>
    );

    // â”€â”€ LEFT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const leftSidebar = (
        <div>
            <ModuleExplorer/>
            <ModuleLoader/>
            {registry.isEnabled('nexus-core') && <NexusCore/>}
            {registry.isEnabled('travel-telemetry') && <Panel title="Travel (5m)" color={C.gold}>
                <StatRow label="Chunk loads"  value={chunks5m} color={C.green}/>
                <StatRow label="Load rate"    value={chunks5m > 0 ? `${(chunks5m/300).toFixed(1)}/s` : 'â€”'} color={C.cyan}/>
                <StatRow label="AC hits (10m)"value={acCount}  color={acCount ? C.red : C.dim}/>
            </Panel>}
            {registry.isEnabled('tps-history') && <Panel title="TPS History">
                {tpsHist.length > 0 ? (
                    <>
                        <StatRow label="Current" value={tpsStr}                                                color={tpsColor}/>
                        <StatRow label="Min (1h)" value={Math.min(...tpsHist.slice(-360).map(t=>t.tps)).toFixed(1)} color={C.gold}/>
                        <StatRow label="Avg (1h)" value={(tpsHist.slice(-360).reduce((a,t)=>a+t.tps,0)/Math.max(tpsHist.slice(-360).length,1)).toFixed(1)}/>
                        <StatRow label="Samples"  value={tpsHist.length}/>
                    </>
                ) : <span style={{color:C.dim,fontSize:11}}>No TPS data yet</span>}
            </Panel>}
        </div>
    );

    // â”€â”€ MAIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const mainContent = (
        <div style={{height:'100%',display:'flex',flexDirection:'column',gap:10}}>
            {registry.isEnabled('nexus-core-hero') && (
            <div style={{background:C.card,border:`1px solid ${C.cyan}35`,borderRadius:8,flex:'0 0 auto',overflow:'hidden'}}>
                <NexusCoreHero size={260}/>
            </div>)}
            {registry.isEnabled('tps-timeline') && (
            <div style={{background:C.card,border:`1px solid ${C.cyan}35`,borderRadius:8,padding:14,flex:'0 0 auto'}}>
                <div style={{fontFamily:mono,color:C.cyan,fontSize:10,marginBottom:10,letterSpacing:2}}>â—ˆ TPS TIMELINE â€” BACKEND SIGNATURE</div>
                <TPSChart data={tpsHist}/>
            </div>)}
            {registry.isEnabled('chunk-radar') && (
            <div style={{background:C.card,border:`1px solid ${C.gold}35`,borderRadius:8,padding:14,flex:1}}>
                <div style={{fontFamily:mono,color:C.gold,fontSize:10,marginBottom:10,letterSpacing:2}}>â—ˆ CHUNK RADAR â€” MOVEMENT TRACE</div>
                <ChunkRadar data={chunks}/>
            </div>)}
        </div>
    );

    // â”€â”€ RIGHT â€” Chat newest at bottom â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const rightSidebar = (
        <div style={{height:'100%'}}>
            {registry.isEnabled('chat-intelligence') && <Panel title="Chat Intelligence" color={C.green} nopad>
                <div ref={chatRef} style={{maxHeight:520,overflowY:'auto',padding:'8px 12px',display:'flex',flexDirection:'column',gap:4}}>
                    {chatAsc.map((m,i)=>(
                        <div key={i} style={{fontSize:11,fontFamily:'monospace',borderBottom:`1px solid rgba(0,255,255,0.06)`,paddingBottom:4}}>
                            <span style={{color:C.dim}}>{new Date(m.ts).toLocaleTimeString()} </span>
                            <span style={{color:m.account_type==='pure_bot'?C.red:m.account_type==='auto_reply'?C.gold:C.green,fontWeight:'bold'}}>
                                {m.account_type==='pure_bot'?'ðŸ¤–':m.account_type==='auto_reply'?'âš¡':'ðŸ‘¤'}{m.username}
                            </span>
                            <span style={{color:'rgba(255,255,255,0.75)'}}> {m.message}</span>
                        </div>
                    ))}
                    {!chatAsc.length && <span style={{color:C.dim,fontSize:11}}>Monitoring chat...</span>}
                </div>
            </Panel>}
        </div>
    );

    // â”€â”€ TAB SHELL (dual-surface: COMMAND home + full-view tabs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const tabStyle = (id:string): CSSProperties => ({
        fontFamily:mono, fontSize:11, letterSpacing:2, padding:'4px 12px', cursor:'pointer',
        color: tab===id ? C.cyan : C.dim,
        borderBottom:`2px solid ${tab===id ? C.cyan : 'transparent'}`,
        textShadow: tab===id ? `0 0 6px ${C.cyan}` : 'none'
    });
    const tabBar = (
        <div style={{display:'flex',gap:6,alignItems:'center',borderBottom:`1px solid ${C.cyan}22`,paddingBottom:6}}>
            <span onClick={()=>setTab('command')} style={tabStyle('command')}>â—ˆ COMMAND</span>
            <span onClick={()=>setTab('codex')} style={tabStyle('codex')}>CODEX</span>
            <span onClick={()=>setTab('operations')} style={tabStyle('operations')}>â—‰ OPERATIONS</span>
            <span onClick={()=>setTab('forge')}    style={tabStyle('forge')}>âš’ FORGE</span>
            <span onClick={()=>setTab('modules')}  style={tabStyle('modules')}>â–¤ MODULES</span>
            <span onClick={()=>setTab('data')}     style={tabStyle('data')}>â–¦ DATA</span>
            <span onClick={()=>setTab('orchestrator')} style={tabStyle('orchestrator')}>â—‰ ORCHESTRATOR</span>
            <span onClick={()=>setTab('cymatics')} style={tabStyle('cymatics')}>≈ CYMATICS</span>
            <span onClick={()=>setTab('chat')} style={tabStyle('chat')}>CHAT</span>
            <span onClick={()=>setTab('autonomic')} style={tabStyle('autonomic')}>AUTONOMIC</span>
            <span onClick={()=>setTab('graph')} style={tabStyle('graph')}>◬ GRAPH</span>
            <span onClick={()=>setTab('trading')} style={{...tabStyle('trading'),marginLeft:'auto'}}>TRADING</span>
            <span onClick={()=>setTab('settings')} style={tabStyle('settings')}>SETTINGS</span>
        </div>
    );
    const modulesView = (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div style={{fontFamily:mono,color:C.cyan,fontSize:12,letterSpacing:2}}>â—ˆ MODULES â€” INFRASTRUCTURE REGISTRY</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,alignItems:'start'}}>
                <div><ModuleExplorer/></div>
                <div><ModuleLoader/></div>
            </div>
        </div>
    );

    const cymaticsView = (
        <div style={{display:'flex',flexDirection:'column',gap:10,height:'100%'}}>
            <div style={{fontFamily:mono,color:'#e8b265',fontSize:12,letterSpacing:2}}>◈ FIELD EXPLORER — 3D STANDING-WAVE INTERFERENCE <span style={{color:C.dim}}>· raymarched live from formula</span></div>
            <iframe src="/field_explorer.html" style={{flex:1,minHeight:640,width:'100%',border:`1px solid #e8b26535`,borderRadius:8,background:'#05060a'}}/>
        </div>
    );

    const codexView = (
        <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
            <iframe src="/codex" style={{flex:1,minHeight:640,width:'100%',border:'none',borderRadius:8,background:'#0a0a14'}}/>
        </div>
    );

    const isCmd = tab === 'command';

    // â”€â”€ DATA EXPLORER (one source, many forms) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const dataPill = (on:boolean): CSSProperties => ({
        fontFamily:mono, fontSize:10, letterSpacing:1, padding:'4px 10px', borderRadius:4, cursor:'pointer',
        border:`1px solid ${on?C.cyan:C.dim}`, color:on?C.cyan:C.dim, background:on?`${C.cyan}12`:'transparent'
    });
    const chatKind = (t:string)=> t==='pure_bot'?'bot' : t==='auto_reply'?'auto' : 'user';
    let dataBody: React.ReactNode = null;
    if (dataSource==='chat') {
        if (dataForm==='conversation') dataBody = <ConversationView items={chatAsc.map(m=>({ts:m.ts,who:m.username,text:m.message,kind:chatKind(m.account_type)}))}/>;
        else if (dataForm==='table')   dataBody = <DataTable columns={[{key:'time',label:'TIME'},{key:'user',label:'USER',color:C.green},{key:'type',label:'TYPE',color:C.gold},{key:'message',label:'MESSAGE'}]} rows={chatAsc.map(m=>({time:new Date(m.ts).toLocaleTimeString(),user:m.username,type:m.account_type,message:m.message}))}/>;
        else if (dataForm==='log')     dataBody = <LogStream items={chatAsc.map(m=>({ts:m.ts,text:`${m.username}: ${m.message}`,color:m.account_type==='pure_bot'?C.red:m.account_type==='auto_reply'?C.gold:C.green}))}/>;
        else                            dataBody = <LiveFeed items={chatAsc.map(m=>({ts:m.ts,text:`${m.username}  â€”  ${m.message}`}))}/>;
    } else {
        if (dataForm==='table')        dataBody = <DataTable columns={[{key:'event',label:'EVENT',color:C.gold},{key:'x',label:'X'},{key:'z',label:'Z'},{key:'time',label:'TIME'}]} rows={chunks.map(c=>({event:c.event_type,x:c.world_x,z:c.world_z,time:new Date(c.ts).toLocaleTimeString()}))}/>;
        else if (dataForm==='log')     dataBody = <LogStream items={chunks.map(c=>({ts:c.ts,text:`${c.event_type}  (${c.world_x}, ${c.world_z})`,level:c.event_type==='LOAD'?'ok':'info'}))}/>;
        else if (dataForm==='feed')    dataBody = <LiveFeed items={chunks.map(c=>({ts:c.ts,text:`${c.event_type} @ ${c.world_x}, ${c.world_z}`}))}/>;
        else                            dataBody = <div style={{color:C.dim,fontSize:11,fontFamily:body,padding:12}}>Conversation is a chat form â€” switch source to <span style={{color:C.green}}>chat</span>, or pick Table / Log / Feed for chunks.</div>;
    }
    const dataView = (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div style={{fontFamily:mono,color:C.cyan,fontSize:12,letterSpacing:2}}>â—ˆ DATA EXPLORER â€” <span style={{color:C.dim}}>same source, many forms</span></div>
            <div style={{display:'flex',gap:18,flexWrap:'wrap'}}>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    <span style={{fontFamily:mono,fontSize:9,color:C.dim,letterSpacing:1,marginRight:2}}>SOURCE</span>
                    <span onClick={()=>setDataSource('chat')}   style={dataPill(dataSource==='chat')}>chat</span>
                    <span onClick={()=>setDataSource('chunks')} style={dataPill(dataSource==='chunks')}>chunks</span>
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    <span style={{fontFamily:mono,fontSize:9,color:C.dim,letterSpacing:1,marginRight:2}}>FORM</span>
                    {(['conversation','table','log','feed'] as const).map(f=>(
                        <span key={f} onClick={()=>setDataForm(f)} style={dataPill(dataForm===f)}>{f}</span>
                    ))}
                </div>
            </div>
            {dataBody}
        </div>
    );

    const mainByTab = isCmd ? mainContent : tab==='codex' ? codexView : tab==='operations' ? <OperationsMap/> : tab==='orchestrator' ? <OrchestratorConsole/> : tab==='chat' ? <ChatConsole/> : tab==='autonomic' ? <AutonomicConsole/> : tab==='graph' ? <NexusGraph3D/> : tab==='forge' ? <ForgeConsole/> : tab==='modules' ? modulesView : tab==='cymatics' ? cymaticsView : tab==='trading' ? <TradingConsole/> : tab==='settings' ? <SettingsConsole/> : dataView;
    return (
        <EnhancedNexusBackground>
            <div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
                <StrategicHUDLayout
                    topBar={<div style={{display:'flex',flexDirection:'column',gap:8}}>{tabBar}{topBar}</div>}
                    leftSidebar={isCmd ? leftSidebar : undefined}
                    mainContent={mainByTab}
                    rightSidebar={isCmd ? rightSidebar : undefined}
                />
            </div>
        </EnhancedNexusBackground>
    );
}

// â”€â”€ TPS Chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TPSChart({ data }: { data: TpsPt[] }) {
    const recent = data.slice(-120);
    const H=110, MAX=21, W=500;
    if (!recent.length) return <div style={{color:C.dim,fontSize:11,fontFamily:body}}>Waiting for TPS data â€” connect to 2b2t</div>;
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
                {recent.length} samples Â· {Math.min(...recent.map(t=>t.tps)).toFixed(1)}â€“{Math.max(...recent.map(t=>t.tps)).toFixed(1)} TPS
            </div>
        </div>
    );
}

// â”€â”€ Chunk Radar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ChunkRadar({ data }: { data: Chunk[] }) {
    const loads = data.filter(e=>e.event_type==='LOAD');
    if (!loads.length) return <div style={{color:C.dim,fontSize:11,fontFamily:body}}>No chunk data â€” movement will populate this</div>;
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
                <span>X {Math.round(minX).toLocaleString()} â†’ {Math.round(maxX).toLocaleString()}</span>
                <span>{loads.length} chunks Â· 15m</span>
                <span>Z {Math.round(minZ).toLocaleString()} â†’ {Math.round(maxZ).toLocaleString()}</span>
            </div>
        </div>
    );
}
