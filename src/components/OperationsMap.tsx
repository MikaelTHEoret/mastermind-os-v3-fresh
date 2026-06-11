'use client'
import { useEffect, useMemo, useState } from 'react'

type PNode = { id: string; name: string; faculty: string; phase: string; status: string; note: string }
type PEdge = { from: string; to: string }
type Painting = { ok: boolean; nodes: PNode[]; edges: PEdge[]; legend: Record<string, string>; generated?: string | null; error?: string }

const STATUS: Record<string, { c: string; label: string }> = {
  LIVE: { c: '#00ffaa', label: 'built + working' },
  PROVEN: { c: '#00ffff', label: 'survived falsification' },
  SPEC: { c: '#ffaa00', label: 'designed, not built' },
  CANDIDATE: { c: '#8a2be2', label: 'reproduces known' },
  VISION: { c: '#ff5edb', label: 'recovered intent' },
  DRIFT: { c: '#ff4444', label: 'deflated' },
  GAP: { c: '#666666', label: 'known missing' },
}
const statusColor = (s: string) => STATUS[s]?.c ?? '#888888'
const FAC_ORDER = ['memory', 'cortex', 'law', 'identity', 'body', 'hands', 'orch', 'homeo', 'perf', 'auto', 'meta', 'side']
const mono = 'Orbitron, monospace'
const body = 'Rajdhani, sans-serif'
const phaseFrac = (ph: string) => { const n = Number(ph); return Number.isNaN(n) ? 1 : Math.min(n, 6) / 6 }

export default function OperationsMap() {
  const [data, setData] = useState<Painting | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    let on = true
    fetch('/api/painting', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (on) setData(d) })
      .catch(() => { if (on) setData({ ok: false, nodes: [], edges: [], legend: {}, error: 'fetch failed' }) })
    return () => { on = false }
  }, [])

  const W = 820, H = 640, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 72, innerR = 72

  const layout = useMemo(() => {
    const nodes = data?.nodes ?? []
    const facs = FAC_ORDER.filter(f => nodes.some(n => n.faculty === f))
    for (const n of nodes) if (!facs.includes(n.faculty)) facs.push(n.faculty)
    const F = Math.max(facs.length, 1)
    const pos: Record<string, { x: number; y: number }> = {}
    const facAngle: Record<string, number> = {}
    facs.forEach((f, fi) => {
      const a0 = -Math.PI / 2 + (fi / F) * 2 * Math.PI
      facAngle[f] = a0
      const wedge = (2 * Math.PI / F)
      const fnodes = nodes.filter(n => n.faculty === f).sort((p, q) => phaseFrac(p.phase) - phaseFrac(q.phase))
      const n = fnodes.length
      fnodes.forEach((node, k) => {
        const spread = n > 1 ? ((k / (n - 1)) - 0.5) * wedge * 0.74 : 0
        const a = a0 + spread
        const r = innerR + phaseFrac(node.phase) * (R - innerR)
        pos[node.id] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
      })
    })
    return { facs, pos, facAngle }
  }, [data, R])

  if (!data) return <div style={{ color: '#00ffff88', fontFamily: body, padding: 24 }}>Loading operations map\u2026</div>
  if (!data.ok) return <div style={{ color: '#ff4444', fontFamily: body, padding: 24 }}>Painting unavailable: {data.error}</div>

  const { facs, pos, facAngle } = layout
  const nodes = data.nodes, edges = data.edges
  const active = sel ?? hover
  const connected = new Set<string>()
  if (active) { connected.add(active); edges.forEach(e => { if (e.from === active) connected.add(e.to); if (e.to === active) connected.add(e.from) }) }
  const selNode = sel ? nodes.find(n => n.id === sel) ?? null : null
  const deps = selNode ? edges.filter(e => e.from === selNode.id).map(e => e.to) : []
  const dependents = selNode ? edges.filter(e => e.to === selNode.id).map(e => e.from) : []
  const counts: Record<string, number> = {}
  for (const n of nodes) counts[n.status] = (counts[n.status] ?? 0) + 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: mono, color: '#00ffff', fontSize: 12, letterSpacing: 2 }}>\u25C8 OPERATIONS MAP</span>
        <span style={{ fontFamily: body, color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{nodes.length} nodes \u00B7 {edges.length} links \u00B7 angle = faculty, radius = phase, colour = status</span>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ flex: '1 1 540px', minWidth: 360, maxWidth: 860 }} onClick={() => setSel(null)}>
          {[innerR, innerR + (R - innerR) / 2, R].map((rr, i) => (
            <circle key={i} cx={cx} cy={cy} r={rr} fill="none" stroke="rgba(0,255,255,0.07)" strokeDasharray="2 7" />
          ))}
          {facs.map(f => {
            const a = facAngle[f]; const lx = cx + (R + 26) * Math.cos(a); const ly = cy + (R + 26) * Math.sin(a)
            return <text key={f} x={lx} y={ly} fill="rgba(0,255,255,0.5)" fontSize={9} fontFamily={mono} letterSpacing={1} textAnchor="middle" dominantBaseline="middle">{f.toUpperCase()}</text>
          })}
          {edges.map((e, i) => {
            const a = pos[e.from], b = pos[e.to]; if (!a || !b) return null
            const on = active && (e.from === active || e.to === active)
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? '#00ffff' : 'rgba(0,255,255,0.10)'} strokeWidth={on ? 1.4 : 0.7} style={on ? { filter: 'drop-shadow(0 0 3px #00ffff)' } : undefined} />
          })}
          {nodes.map(n => {
            const p = pos[n.id]; if (!p) return null
            const c = statusColor(n.status)
            const dim = active && !connected.has(n.id)
            const isActive = active === n.id
            return (
              <g key={n.id} style={{ cursor: 'pointer', opacity: dim ? 0.25 : 1 }}
                 onClick={(ev) => { ev.stopPropagation(); setSel(s => s === n.id ? null : n.id) }}
                 onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                <circle cx={p.x} cy={p.y} r={isActive ? 11 : 8} fill={c} opacity={0.18} />
                <circle cx={p.x} cy={p.y} r={isActive ? 6 : 4.5} fill={c} style={{ filter: `drop-shadow(0 0 5px ${c})` }} />
                {(isActive || hover === n.id) && (
                  <text x={p.x} y={p.y - 13} fill="#fff" fontSize={9.5} fontFamily={body} textAnchor="middle" style={{ pointerEvents: 'none' }}>{n.name}</text>
                )}
              </g>
            )
          })}
        </svg>

        <div style={{ flex: '0 1 240px', minWidth: 200, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ border: '1px solid rgba(0,255,255,0.18)', borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2, color: 'rgba(0,255,255,0.6)', marginBottom: 8 }}>STATUS</div>
            {Object.keys(STATUS).filter(s => counts[s]).map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontFamily: body, fontSize: 12 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS[s].c, boxShadow: `0 0 6px ${STATUS[s].c}` }} />
                <span style={{ color: STATUS[s].c, minWidth: 74 }}>{s}</span>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, flex: 1 }}>{STATUS[s].label}</span>
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>{counts[s]}</span>
              </div>
            ))}
          </div>
          <div style={{ border: `1px solid ${selNode ? statusColor(selNode.status) + '55' : 'rgba(0,255,255,0.18)'}`, borderRadius: 6, padding: '10px 12px', minHeight: 120 }}>
            {selNode ? (
              <div style={{ fontFamily: body }}>
                <div style={{ fontFamily: mono, fontSize: 12, color: statusColor(selNode.status), letterSpacing: 1, marginBottom: 2 }}>{selNode.name}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>{selNode.id} \u00B7 {selNode.faculty} \u00B7 phase {selNode.phase} \u00B7 <span style={{ color: statusColor(selNode.status) }}>{selNode.status}</span></div>
                {selNode.note && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', lineHeight: 1.35, marginBottom: 8 }}>{selNode.note}</div>}
                {deps.length > 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>needs: <span style={{ color: '#00ffff' }}>{deps.join(', ')}</span></div>}
                {dependents.length > 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>feeds: <span style={{ color: '#00ffaa' }}>{dependents.join(', ')}</span></div>}
              </div>
            ) : (
              <div style={{ fontFamily: body, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Click a node to inspect it \u2014 its status, what it needs, and what it feeds.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
