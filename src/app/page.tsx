'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import EnhancedNexusBackground from '@/components/EnhancedNexusBackground';
import StrategicHUDLayout from '@/components/StrategicHUDLayout';

type LiveData = {
    ok: boolean;
    ts: string;
    packets: Array<{ packet_type: string; direction: string; n: number }>;
    ac_count: number;
    chunk_counts: Record<string, number>;
    chat: Array<{ ts: string; username: string; message: string; is_bot_response: boolean; account_type: string }>;
    tps: { avg_tps: number; min_tps: number };
    ping: number;
    session: { id: string; created_at: string } | null;
};

const C = {
    cyan:    '#00ffff',
    magenta: '#ff00ff',
    gold:    '#ffaa00',
    green:   '#00ffaa',
    red:     '#ff4444',
    dim:     'rgba(0,255,255,0.35)',
    card:    'rgba(0,15,35,0.75)',
};

const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';

function Glow({ children, color = C.cyan }: { children: React.ReactNode; color?: string }) {
    return <span style={{ color, textShadow: `0 0 8px ${color}` }}>{children}</span>;
}

function Panel({ title, children, color = C.cyan, nopad }: { title: string; children: React.ReactNode; color?: string; nopad?: boolean }) {
    return (
        <div style={{ background: C.card, border: `1px solid ${color}35`, borderRadius: 8, marginBottom: 8, backdropFilter: 'blur(8px)', overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${color}25`, color, fontFamily: mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', textShadow: `0 0 6px ${color}` }}>
                ◈ {title}
            </div>
            <div style={{ padding: nopad ? 0 : '10px 12px' }}>{children}</div>
        </div>
    );
}

function StatRow({ label, value, color = C.cyan }: { label: string; value: string | number; color?: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5, fontFamily: body }}>
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</span>
            <Glow color={color}>{value}</Glow>
        </div>
    );
}

export default function Dashboard() {
    const [data, setData]         = useState<LiveData | null>(null);
    const [lastUpdate, setLast]   = useState('');
    const [online, setOnline]     = useState(false);
    const chatRef                  = useRef<HTMLDivElement>(null);

    const fetchData = useCallback(async () => {
        try {
            const res  = await fetch('/api/dashboard/live', { cache: 'no-store' });
            const json = await res.json();
            setData(json);
            setLast(new Date().toLocaleTimeString());
            // Online = chunks or tps data in last 5 min
            const loads = json.chunk_counts?.LOAD ?? 0;
            const tps   = json.tps?.avg_tps;
            setOnline(loads > 0 || !!tps);
        } catch { setOnline(false); }
    }, []);

    useEffect(() => { fetchData(); const t = setInterval(fetchData, 5000); return () => clearInterval(t); }, [fetchData]);

    // Auto-scroll chat to bottom when new messages arrive
    useEffect(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }, [data?.chat?.length]);

    const tps      = data?.tps?.avg_tps ? data.tps.avg_tps.toFixed(1) : '—';
    const tpsColor = !data?.tps?.avg_tps ? C.dim : data.tps.avg_tps > 18 ? C.green : data.tps.avg_tps > 12 ? C.gold : C.red;
    const ping     = data?.ping ? `${Math.round(data.ping)}ms` : '—';
    const loads    = data?.chunk_counts?.LOAD   ?? 0;
    const unloads  = data?.chunk_counts?.UNLOAD ?? 0;

    // ── TOP BAR ──────────────────────────────────────────────────────────────
    const topBar = (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: mono, fontSize: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Glow color={C.cyan}>ⵐ MASTERMIND</Glow>
                <span style={{ color: C.dim }}>v3.0 — 2b2t COMMAND CENTER</span>
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 12 }}>
                <span>TPS <Glow color={tpsColor}>{tps}</Glow></span>
                <span>PING <Glow color={C.cyan}>{ping}</Glow></span>
                <span>CHUNKS/5m <Glow color={loads > 100 ? C.green : C.dim}>{loads}</Glow></span>
                <span>AC <Glow color={data?.ac_count ? C.red : C.dim}>{data?.ac_count ?? 0}</Glow></span>
                <span style={{ color: online ? C.green : C.red, textShadow: `0 0 6px ${online ? C.green : C.red}` }}>
                    {online ? '● LIVE' : '○ OFFLINE'}
                </span>
                <span style={{ color: C.dim }}>↺ {lastUpdate}</span>
            </div>
        </div>
    );

    // ── LEFT SIDEBAR ──────────────────────────────────────────────────────────
    const leftSidebar = (
        <div>
            <Panel title="Session" color={C.magenta}>
                {data?.session
                    ? <>
                        <StatRow label="ID"      value={data.session.id.slice(-8)} color={C.magenta} />
                        <StatRow label="Started" value={new Date(data.session.created_at).toLocaleTimeString()} />
                      </>
                    : <span style={{ color: C.dim, fontSize: 12 }}>No active session</span>}
            </Panel>

            <Panel title="Travel (5m)" color={C.gold}>
                <StatRow label="Chunk LOADs"   value={loads}          color={C.green} />
                <StatRow label="Chunk UNLOADs" value={unloads}        color={C.gold} />
                <StatRow label="Load rate"     value={loads > 0 ? `${(loads / 300).toFixed(1)}/s` : '—'} color={C.cyan} />
            </Panel>

            <Panel title="Signal (5m)">
                {(data?.packets ?? []).slice(0, 10).map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3, fontFamily: 'monospace' }}>
                        <span style={{ color: 'rgba(0,255,255,0.55)', maxWidth: 155, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.packet_type.replace(/S2CPacket|C2SPacket/g, '')}
                        </span>
                        <Glow>{p.n}</Glow>
                    </div>
                ))}
                {!data?.packets?.length && <span style={{ color: C.dim, fontSize: 11 }}>No signal packets yet</span>}
            </Panel>
        </div>
    );

    // ── MAIN ──────────────────────────────────────────────────────────────────
    const mainContent = (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: C.card, border: `1px solid ${C.cyan}35`, borderRadius: 8, padding: 14, flex: '0 0 auto' }}>
                <div style={{ fontFamily: mono, color: C.cyan, fontSize: 10, marginBottom: 10, letterSpacing: 2 }}>
                    ◈ TPS TIMELINE — BACKEND SIGNATURE
                </div>
                <TPSChart />
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.gold}35`, borderRadius: 8, padding: 14, flex: 1 }}>
                <div style={{ fontFamily: mono, color: C.gold, fontSize: 10, marginBottom: 10, letterSpacing: 2 }}>
                    ◈ CHUNK RADAR — MOVEMENT TRACE
                </div>
                <ChunkRadar />
            </div>
        </div>
    );

    // ── RIGHT SIDEBAR — Chat newest at BOTTOM ─────────────────────────────────
    const chatMessages = [...(data?.chat ?? [])].reverse(); // API returns DESC, reverse for oldest-first display

    const rightSidebar = (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Panel title="Chat Intelligence" color={C.green} nopad>
                <div
                    ref={chatRef}
                    style={{ maxHeight: 500, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                    {chatMessages.map((m, i) => (
                        <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', borderBottom: `1px solid rgba(0,255,255,0.06)`, paddingBottom: 4 }}>
                            <span style={{ color: C.dim }}>{new Date(m.ts).toLocaleTimeString()} </span>
                            <span style={{
                                color: m.account_type === 'pure_bot'   ? C.red  :
                                       m.account_type === 'auto_reply' ? C.gold : C.green,
                                fontWeight: 'bold'
                            }}>
                                {m.account_type === 'pure_bot' ? '🤖' : m.account_type === 'auto_reply' ? '⚡' : '👤'}
                                {m.username}
                            </span>
                            <span style={{ color: 'rgba(255,255,255,0.75)' }}> {m.message}</span>
                        </div>
                    ))}
                    {!chatMessages.length && <span style={{ color: C.dim, fontSize: 11 }}>Monitoring chat...</span>}
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

// ── TPS Chart ────────────────────────────────────────────────────────────────
function TPSChart() {
    const [timeline, setTimeline] = useState<Array<{ ts: string; tps: number }>>([]);

    useEffect(() => {
        const load = () => fetch('/api/tps/timeline').then(r => r.json()).then(d => setTimeline(d.timeline ?? [])).catch(() => {});
        load();
        const t = setInterval(load, 8000);
        return () => clearInterval(t);
    }, []);

    const H = 110, MAX = 21;
    const recent = timeline.slice(-120);

    if (!recent.length) return (
        <div style={{ color: C.dim, fontSize: 11, fontFamily: body }}>
            Waiting for TPS data — move around in-game to generate ticks
        </div>
    );

    const W = 500;
    const pts = recent.map((t, i) =>
        `${(i / Math.max(recent.length - 1, 1)) * W},${H - (t.tps / MAX) * H}`
    ).join(' ');

    const current = recent[recent.length - 1]?.tps ?? 0;
    const curColor = current > 18 ? C.green : current > 12 ? C.gold : C.red;

    return (
        <div>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
                {/* Grid lines */}
                {[20, 15, 10, 5].map(v => (
                    <g key={v}>
                        <line x1={0} y1={H-(v/MAX)*H} x2={W} y2={H-(v/MAX)*H}
                            stroke={`rgba(0,255,255,0.08)`} strokeDasharray="3 6" />
                        <text x={W+4} y={H-(v/MAX)*H+4} fill={C.dim} fontSize={8} fontFamily={mono}>{v}</text>
                    </g>
                ))}
                {/* TPS line */}
                <polyline points={pts} fill="none" stroke={curColor} strokeWidth="1.5"
                    style={{ filter: `drop-shadow(0 0 3px ${curColor})` }} />
                {/* Fill area */}
                <polyline points={`0,${H} ${pts} ${W},${H}`} fill={`${curColor}18`} stroke="none" />
                {/* Current label */}
                <text x={W-2} y={H-(current/MAX)*H - 6} fill={curColor} fontSize={10} textAnchor="end" fontFamily={mono}>
                    {current.toFixed(1)}
                </text>
            </svg>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 4, fontFamily: mono }}>
                {recent.length} samples · range {Math.min(...recent.map(t => t.tps)).toFixed(1)} – {Math.max(...recent.map(t => t.tps)).toFixed(1)} TPS
            </div>
        </div>
    );
}

// ── Chunk Radar ───────────────────────────────────────────────────────────────
function ChunkRadar() {
    const [events, setEvents] = useState<Array<{ event_type: string; world_x: number; world_z: number; ts: string }>>([]);

    useEffect(() => {
        const load = () => fetch('/api/radar/chunks?minutes=15').then(r => r.json()).then(d => setEvents(d.events ?? [])).catch(() => {});
        load();
        const t = setInterval(load, 6000);
        return () => clearInterval(t);
    }, []);

    const loads = events.filter(e => e.event_type === 'LOAD');

    if (!loads.length) return (
        <div style={{ color: C.dim, fontSize: 11, fontFamily: body }}>
            No chunk data — elytra flight or movement will populate this
        </div>
    );

    const xs = loads.map(e => e.world_x);
    const zs = loads.map(e => e.world_z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const rangeX = maxX - minX || 512;
    const rangeZ = maxZ - minZ || 512;

    const W = 480, H = 140;
    const pad = 8;
    const toX = (x: number) => pad + ((x - minX) / rangeX) * (W - pad*2);
    const toY = (z: number) => pad + ((z - minZ) / rangeZ) * (H - pad*2);

    // Color by age — recent = bright
    const now = Date.now();
    const oldest = Math.min(...loads.map(e => new Date(e.ts).getTime()));
    const span = now - oldest || 1;

    return (
        <div>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 4 }}>
                {loads.map((e, i) => {
                    const age = (new Date(e.ts).getTime() - oldest) / span;
                    const opacity = 0.2 + age * 0.8;
                    return <circle key={i} cx={toX(e.world_x)} cy={toY(e.world_z)} r="1.2"
                        fill={C.cyan} opacity={opacity} />;
                })}
                {/* Current position — most recent load */}
                {(() => {
                    const latest = loads[0];
                    return <g>
                        <circle cx={toX(latest.world_x)} cy={toY(latest.world_z)} r="5"
                            fill="none" stroke={C.magenta} strokeWidth="1.5"
                            style={{ filter: `drop-shadow(0 0 4px ${C.magenta})` }} />
                        <circle cx={toX(latest.world_x)} cy={toY(latest.world_z)} r="2"
                            fill={C.magenta} opacity={0.8} />
                    </g>;
                })()}
                {/* Cardinal labels */}
                <text x={W/2} y={12}    fill={C.dim} fontSize={7} textAnchor="middle" fontFamily={mono}>N</text>
                <text x={W/2} y={H-2}   fill={C.dim} fontSize={7} textAnchor="middle" fontFamily={mono}>S</text>
                <text x={8}   y={H/2+3} fill={C.dim} fontSize={7} textAnchor="middle" fontFamily={mono}>W</text>
                <text x={W-6} y={H/2+3} fill={C.dim} fontSize={7} textAnchor="middle" fontFamily={mono}>E</text>
            </svg>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 4, fontFamily: mono, display: 'flex', justifyContent: 'space-between' }}>
                <span>X {Math.round(minX*16).toLocaleString()} → {Math.round(maxX*16).toLocaleString()}</span>
                <span>{loads.length} chunks · 15m window</span>
                <span>Z {Math.round(minZ*16).toLocaleString()} → {Math.round(maxZ*16).toLocaleString()}</span>
            </div>
        </div>
    );
}
