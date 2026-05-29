'use client';
import { useEffect, useState, useCallback } from 'react';
import EnhancedNexusBackground from '@/components/EnhancedNexusBackground';
import StrategicHUDLayout from '@/components/StrategicHUDLayout';

type LiveData = {
    ok: boolean;
    ts: string;
    packets: Array<{ packet_type: string; category: string; direction: string; n: number }>;
    ac_count: number;
    chunk_counts: Record<string, number>;
    chat: Array<{ ts: string; username: string; message: string; is_bot_response: boolean; account_type: string }>;
    tps: { avg_tps: number; min_tps: number };
    ping: number;
    session: { id: string; context: Record<string, unknown>; created_at: string } | null;
};

const C = {
    cyan:    '#00ffff',
    magenta: '#ff00ff',
    gold:    '#ffaa00',
    green:   '#00ffaa',
    red:     '#ff4444',
    dim:     'rgba(0,255,255,0.4)',
    card:    'rgba(0,20,40,0.7)',
    border:  'rgba(0,255,255,0.25)',
};

function Glow({ children, color = C.cyan }: { children: React.ReactNode; color?: string }) {
    return <span style={{ color, textShadow: `0 0 8px ${color}` }}>{children}</span>;
}

function Panel({ title, children, color = C.cyan }: { title: string; children: React.ReactNode; color?: string }) {
    return (
        <div style={{ background: C.card, border: `1px solid ${color}40`, borderRadius: 8, padding: 12, backdropFilter: 'blur(8px)', marginBottom: 8 }}>
            <div style={{ color, fontFamily: 'Orbitron, monospace', fontSize: 11, letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase', textShadow: `0 0 6px ${color}` }}>
                ◈ {title}
            </div>
            {children}
        </div>
    );
}

function StatRow({ label, value, color = C.cyan }: { label: string; value: string | number; color?: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, fontFamily: 'Rajdhani, monospace' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</span>
            <Glow color={color}>{value}</Glow>
        </div>
    );
}

export default function Dashboard() {
    const [data, setData] = useState<LiveData | null>(null);
    const [lastUpdate, setLastUpdate] = useState<string>('');
    const [online, setOnline] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const res = await fetch('/api/dashboard/live', { cache: 'no-store' });
            const json = await res.json();
            setData(json);
            setLastUpdate(new Date().toLocaleTimeString());
            const fresh = json.packets?.length > 0;
            setOnline(fresh);
        } catch { setOnline(false); }
    }, []);

    useEffect(() => {
        fetchData();
        const t = setInterval(fetchData, 5000);
        return () => clearInterval(t);
    }, [fetchData]);

    const tps  = data?.tps?.avg_tps ? data.tps.avg_tps.toFixed(1) : '—';
    const tpsColor = !data?.tps?.avg_tps ? C.dim : data.tps.avg_tps > 18 ? C.green : data.tps.avg_tps > 12 ? C.gold : C.red;
    const ping = data?.ping ? `${Math.round(data.ping)}ms` : '—';
    const loads   = data?.chunk_counts?.LOAD   ?? 0;
    const unloads = data?.chunk_counts?.UNLOAD ?? 0;

    const topBar = (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'Orbitron, monospace', fontSize: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Glow color={C.cyan}>ⵐ MASTERMIND</Glow>
                <span style={{ color: C.dim }}>v3.0 — 2b2t COMMAND CENTER</span>
            </div>
            <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
                <span>TPS: <Glow color={tpsColor}>{tps}</Glow></span>
                <span>PING: <Glow color={C.cyan}>{ping}</Glow></span>
                <span>STATUS: <Glow color={online ? C.green : C.red}>{online ? '● LIVE' : '○ OFFLINE'}</Glow></span>
                <span style={{ color: C.dim }}>↺ {lastUpdate}</span>
            </div>
        </div>
    );

    // LEFT: session + packet stats
    const leftSidebar = (
        <div>
            <Panel title="Session" color={C.magenta}>
                {data?.session ? (
                    <>
                        <StatRow label="ID" value={data.session.id.slice(-8)} color={C.magenta} />
                        <StatRow label="Started" value={new Date(data.session.created_at).toLocaleTimeString()} />
                    </>
                ) : <span style={{ color: C.dim, fontSize: 12 }}>No active session</span>}
            </Panel>

            <Panel title="Packet Stats (5m)">
                {(data?.packets ?? []).slice(0, 12).map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3, fontFamily: 'monospace' }}>
                        <span style={{ color: 'rgba(0,255,255,0.6)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.packet_type.replace('S2CPacket','').replace('C2SPacket','')}
                        </span>
                        <Glow>{p.n}</Glow>
                    </div>
                ))}
            </Panel>

            <Panel title="Chunk Activity" color={C.gold}>
                <StatRow label="LOADs (5m)"   value={loads}   color={C.green} />
                <StatRow label="UNLOADs (5m)" value={unloads} color={C.gold} />
                <StatRow label="AC hits (10m)" value={data?.ac_count ?? 0} color={data?.ac_count ? C.red : C.dim} />
            </Panel>
        </div>
    );

    // MAIN: TPS chart area (placeholder for now)
    const mainContent = (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: C.card, border: `1px solid ${C.cyan}40`, borderRadius: 8, padding: 16, flex: 1 }}>
                <div style={{ fontFamily: 'Orbitron, monospace', color: C.cyan, fontSize: 12, marginBottom: 12, letterSpacing: 2 }}>
                    ◈ TPS TIMELINE — BACKEND SIGNATURE
                </div>
                <TPSChart />
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.cyan}40`, borderRadius: 8, padding: 16, flex: 1 }}>
                <div style={{ fontFamily: 'Orbitron, monospace', color: C.gold, fontSize: 12, marginBottom: 12, letterSpacing: 2 }}>
                    ◈ CHUNK RADAR — MOVEMENT TRACE
                </div>
                <ChunkRadar />
            </div>
        </div>
    );

    // RIGHT: chat feed
    const rightSidebar = (
        <div>
            <Panel title="Chat Intelligence" color={C.green}>
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    {(data?.chat ?? []).map((m, i) => (
                        <div key={i} style={{ marginBottom: 6, fontSize: 11, fontFamily: 'monospace', borderBottom: `1px solid rgba(0,255,255,0.08)`, paddingBottom: 4 }}>
                            <span style={{ color: C.dim }}>{new Date(m.ts).toLocaleTimeString()} </span>
                            <span style={{
                                color: m.account_type === 'pure_bot' ? C.red :
                                       m.account_type === 'auto_reply' ? C.gold : C.green,
                                fontWeight: 'bold'
                            }}>
                                {m.account_type === 'pure_bot' ? '🤖' : m.account_type === 'auto_reply' ? '⚡' : '👤'}
                                {m.username}
                            </span>
                            <span style={{ color: 'rgba(255,255,255,0.7)' }}> {m.message}</span>
                        </div>
                    ))}
                    {!data?.chat?.length && <span style={{ color: C.dim, fontSize: 11 }}>No chat captured yet</span>}
                </div>
            </Panel>
        </div>
    );

    return (
        <EnhancedNexusBackground>
            <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
                <StrategicHUDLayout topBar={topBar} leftSidebar={leftSidebar} mainContent={mainContent} rightSidebar={rightSidebar} />
            </div>
        </EnhancedNexusBackground>
    );
}

// TPS Chart component
function TPSChart() {
    const [timeline, setTimeline] = useState<Array<{ ts: string; tps: number }>>([]);
    useEffect(() => {
        fetch('/api/tps/timeline').then(r => r.json()).then(d => setTimeline(d.timeline ?? []));
        const t = setInterval(() => fetch('/api/tps/timeline').then(r => r.json()).then(d => setTimeline(d.timeline ?? [])), 10000);
        return () => clearInterval(t);
    }, []);

    if (!timeline.length) return <div style={{ color: C.dim, fontSize: 12 }}>Waiting for TPS data...</div>;

    const max = 21, h = 120;
    const w = Math.min(timeline.length, 200);
    const pts = timeline.slice(-w).map((t, i) => `${(i / (w-1)) * 100}%,${h - (t.tps / max) * h}`);

    return (
        <div>
            <svg width="100%" height={h} style={{ overflow: 'visible' }}>
                {/* 20 TPS line */}
                <line x1="0" y1={h - (20/max)*h} x2="100%" y2={h - (20/max)*h} stroke={`${C.green}40`} strokeDasharray="4 4" />
                {/* TPS line */}
                <polyline points={pts.join(' ')} fill="none" stroke={C.cyan} strokeWidth="1.5"
                    style={{ filter: `drop-shadow(0 0 4px ${C.cyan})` }} />
                {/* Current value */}
                {timeline.length > 0 && (
                    <text x="98%" y={h - (timeline[timeline.length-1].tps / max) * h - 6}
                        fill={C.cyan} fontSize="10" textAnchor="end" fontFamily="Orbitron, monospace">
                        {timeline[timeline.length-1].tps.toFixed(1)}
                    </text>
                )}
            </svg>
        </div>
    );
}

// Chunk Radar component  
function ChunkRadar() {
    const [events, setEvents] = useState<Array<{ event_type: string; world_x: number; world_z: number }>>([]);
    useEffect(() => {
        fetch('/api/radar/chunks?minutes=10').then(r => r.json()).then(d => setEvents(d.events ?? []));
    }, []);

    if (!events.length) return <div style={{ color: C.dim, fontSize: 12 }}>No chunk data yet...</div>;

    // Normalize coords to canvas
    const loads = events.filter(e => e.event_type === 'LOAD');
    if (!loads.length) return <div style={{ color: C.dim, fontSize: 12 }}>No chunk loads yet</div>;

    const xs = loads.map(e => e.world_x), zs = loads.map(e => e.world_z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const rangeX = maxX - minX || 1, rangeZ = maxZ - minZ || 1;

    const W = 400, H = 120;
    const toX = (x: number) => ((x - minX) / rangeX) * (W-4) + 2;
    const toY = (z: number) => ((z - minZ) / rangeZ) * (H-4) + 2;

    return (
        <div>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 4 }}>
                {loads.slice(-500).map((e, i) => (
                    <circle key={i} cx={toX(e.world_x)} cy={toY(e.world_z)} r="1.5"
                        fill={C.cyan} opacity={0.4 + (i / loads.length) * 0.6} />
                ))}
                {/* Most recent position */}
                {loads.length > 0 && (
                    <circle cx={toX(loads[0].world_x)} cy={toY(loads[0].world_z)} r="4"
                        fill="none" stroke={C.magenta} strokeWidth="1.5"
                        style={{ filter: `drop-shadow(0 0 4px ${C.magenta})` }} />
                )}
            </svg>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 4, fontFamily: 'monospace' }}>
                X: {Math.round(minX)} → {Math.round(maxX)} | Z: {Math.round(minZ)} → {Math.round(maxZ)} | {loads.length} points
            </div>
        </div>
    );
}
