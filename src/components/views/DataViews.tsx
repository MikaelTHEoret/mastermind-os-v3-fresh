'use client'
// Reusable, source-agnostic VIEW PRIMITIVES (spec section 9). Each takes a data contract,
// not an endpoint — so any feed/source can be rendered through any fitting form ("many forms").
import React, { useState, useMemo, useRef, useEffect } from 'react'

const mono = 'Orbitron, monospace'
const body = 'Rajdhani, sans-serif'
const C = { cyan: '#00ffff', magenta: '#ff00ff', gold: '#ffaa00', green: '#00ffaa', red: '#ff4444', dim: 'rgba(0,255,255,0.35)' }
const fmtTime = (ts?: string) => (ts ? new Date(ts).toLocaleTimeString() : '')

export interface Column { key: string; label: string; color?: string }
export function DataTable({ columns, rows, maxHeight = 440 }:
  { columns: Column[]; rows: Record<string, string | number>[]; maxHeight?: number }) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [dir, setDir] = useState<1 | -1>(1)
  const sorted = useMemo(() => {
    if (!sortKey) return rows
    return [...rows].sort((a, b) => (a[sortKey] === b[sortKey] ? 0 : (a[sortKey] > b[sortKey] ? 1 : -1) * dir))
  }, [rows, sortKey, dir])
  const click = (k: string) => { if (sortKey === k) setDir(d => (d === 1 ? -1 : 1)); else { setSortKey(k); setDir(1) } }
  return (
    <div style={{ maxHeight, overflow: 'auto', border: `1px solid ${C.cyan}22`, borderRadius: 6 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: body, fontSize: 12 }}>
        <thead><tr>{columns.map(c => (
          <th key={c.key} onClick={() => click(c.key)} style={{ position: 'sticky', top: 0, background: 'rgba(0,10,25,0.95)', color: c.color || C.cyan, fontFamily: mono, fontSize: 10, letterSpacing: 1, textAlign: 'left', padding: '6px 10px', borderBottom: `1px solid ${C.cyan}33`, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {c.label}{sortKey === c.key ? (dir === 1 ? ' \u25B2' : ' \u25BC') : ''}
          </th>))}</tr></thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(0,255,255,0.06)' }}>
              {columns.map(c => <td key={c.key} style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.8)', whiteSpace: 'nowrap' }}>{String(r[c.key] ?? '')}</td>)}
            </tr>
          ))}
          {!sorted.length && <tr><td colSpan={columns.length} style={{ padding: 16, color: C.dim, fontSize: 11 }}>No rows.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export interface LogItem { ts?: string; text: string; level?: string; color?: string }
export function LogStream({ items, maxHeight = 440 }: { items: LogItem[]; maxHeight?: number }) {
  const lvl = (l?: string) => (l === 'error' ? C.red : l === 'warn' ? C.gold : l === 'ok' ? C.green : C.cyan)
  return (
    <div style={{ maxHeight, overflow: 'auto', border: `1px solid ${C.cyan}22`, borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {[...items].reverse().map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, borderBottom: '1px solid rgba(0,255,255,0.05)', paddingBottom: 2 }}>
          <span style={{ color: C.dim, flexShrink: 0 }}>{fmtTime(it.ts)}</span>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: it.color || lvl(it.level), flexShrink: 0, marginTop: 3, boxShadow: `0 0 5px ${it.color || lvl(it.level)}` }} />
          <span style={{ color: 'rgba(255,255,255,0.8)' }}>{it.text}</span>
        </div>
      ))}
      {!items.length && <span style={{ color: C.dim }}>No events.</span>}
    </div>
  )
}

export interface ConvItem { ts?: string; who: string; text: string; kind?: string }
export function ConversationView({ items, maxHeight = 480 }: { items: ConvItem[]; maxHeight?: number }) {
  const col = (k?: string) => (k === 'bot' ? C.red : k === 'auto' ? C.gold : k === 'assistant' ? C.magenta : C.green)
  const ic = (k?: string) => (k === 'bot' ? '\u{1F916}' : k === 'auto' ? '\u26A1' : k === 'assistant' ? '\u2756' : '\u{1F464}')
  return (
    <div style={{ maxHeight, overflow: 'auto', border: `1px solid ${C.cyan}22`, borderRadius: 6, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((m, i) => (
        <div key={i} style={{ fontFamily: body, fontSize: 12, lineHeight: 1.35 }}>
          <span style={{ color: C.dim, fontSize: 10, marginRight: 6 }}>{fmtTime(m.ts)}</span>
          <span style={{ color: col(m.kind), fontWeight: 600 }}>{ic(m.kind)} {m.who}</span>
          <span style={{ color: 'rgba(255,255,255,0.78)' }}> {m.text}</span>
        </div>
      ))}
      {!items.length && <span style={{ color: C.dim, fontSize: 11 }}>No messages.</span>}
    </div>
  )
}

export interface FeedItem { ts?: string; text: string; color?: string }
export function LiveFeed({ items, maxHeight = 440 }: { items: FeedItem[]; maxHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [items.length])
  return (
    <div ref={ref} style={{ maxHeight, overflow: 'auto', border: `1px solid ${C.cyan}22`, borderRadius: 6, padding: '8px 10px', fontFamily: body, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ color: C.dim, fontSize: 10, flexShrink: 0 }}>{fmtTime(it.ts)}</span>
          <span style={{ color: it.color || 'rgba(255,255,255,0.8)' }}>{it.text}</span>
        </div>
      ))}
      {!items.length && <span style={{ color: C.dim, fontSize: 11 }}>Waiting for data\u2026</span>}
    </div>
  )
}
