'use client';
// The app-side face of the live Module Core kernel (via /api/modules -> module_server.py :8770).
// Shows live modules, pending proposals (approve/dismiss at the gate), and the two growth
// loops — assimilate a foreign file, or generate a module from a description.
import React, { useCallback, useEffect, useState } from 'react';

const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';
const CY = '#00ffff';

interface BackendModule {
  id: string; name: string; kind: string; status: string; description: string;
  faculty?: string; dependencies: string[]; capabilities: string[]; source?: string;
  enabled: boolean; gate: string; scan_safe?: boolean; scan_issues?: { severity: string; what: string }[];
}
interface NodeInfo { id: string; faculty: string; in_registry: boolean; }
interface Payload { ok: boolean; modules: BackendModule[]; error?: string; nodes?: NodeInfo[];
  status?: { modules: number; live: string[]; pending_gate: string[]; capabilities: string[] } | null; }

const dot = (c: string) => ({ width: 7, height: 7, borderRadius: '50%', background: c, boxShadow: `0 0 5px ${c}`, flex: '0 0 auto' as const });
const gateColor = (m: BackendModule) =>
  m.enabled ? '#00ffaa' : m.gate === 'pending' ? '#ffaa00' : m.status === 'error' ? '#ff4444' : 'rgba(0,255,255,0.35)';

const inputStyle: React.CSSProperties = { flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.35)', border: `1px solid ${CY}33`, color: '#fff', fontFamily: body, fontSize: 11, padding: '3px 6px', borderRadius: 3 };
const btn: React.CSSProperties = { cursor: 'pointer', fontFamily: mono, fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', background: `${CY}1a`, color: CY, border: `1px solid ${CY}55`, borderRadius: 3, padding: '3px 7px' };

export default function ModuleLoader() {
  const [data, setData] = useState<Payload>({ ok: false, modules: [] });
  const [path, setPath] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [genId, setGenId] = useState('');
  const [genDesc, setGenDesc] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch('/api/modules', { cache: 'no-store' }); setData(await r.json()); }
    catch (e) { setData({ ok: false, modules: [], error: String(e) }); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const act = useCallback(async (action: string, payload: Record<string, unknown>, label: string) => {
    setBusy(true); setMsg(`${label}…`);
    try {
      const r = await fetch('/api/modules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
      const j = await r.json();
      setMsg(j.ok === false ? `✗ ${j.error || 'failed'}` : `✓ ${label} done`);
      await load();
    } catch (e) { setMsg(`✗ ${String(e)}`); } finally { setBusy(false); }
  }, [load]);

  const live = data.modules.filter((m) => m.enabled).length;

  return (
    <div style={{ background: 'rgba(0,15,35,0.75)', border: `1px solid ${CY}35`, borderRadius: 8, marginBottom: 8, backdropFilter: 'blur(8px)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${CY}25`, color: CY, fontFamily: mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', textShadow: `0 0 6px ${CY}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={dot(data.ok ? '#00ffaa' : '#ff4444')} />◈ Module Loader · Kernel
        </span>
        <span style={{ color: 'rgba(255,255,255,0.4)' }}>{live}/{data.modules.length} live</span>
      </div>

      <div style={{ padding: '8px 10px', maxHeight: 300, overflowY: 'auto' }}>
        {!data.ok && <div style={{ fontFamily: body, fontSize: 11, color: '#ff6666' }}>kernel offline — start <code>module_server.py</code> on :8770</div>}
        {data.modules.map((m) => (
          <div key={m.id} title={m.description} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, marginBottom: 2, background: m.enabled ? `${CY}0d` : 'transparent', border: `1px solid ${m.enabled ? CY + '22' : 'transparent'}` }}>
            <span style={dot(gateColor(m))} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: body, fontSize: 12, color: m.enabled ? '#fff' : 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
              <div style={{ fontFamily: mono, fontSize: 7, letterSpacing: 1, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>{m.kind} · {m.source} · {m.capabilities.length} cap · {m.enabled ? 'live' : m.gate}</div>
            </div>
            {m.gate === 'pending' && (
              <>
                <button style={btn} disabled={busy} onClick={() => act('approve', { id: m.id }, `approve ${m.id}`)}>approve</button>
                <button style={{ ...btn, color: '#ff6666', borderColor: '#ff666655', background: '#ff66661a' }} disabled={busy} onClick={() => act('dismiss', { id: m.id }, `dismiss ${m.id}`)}>dismiss</button>
              </>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 10px', borderTop: `1px solid ${CY}22`, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={nodeId} onChange={(e) => setNodeId(e.target.value)} title="absorb one of the 52 node blueprints">
            <option value="">absorb a node — pick a blueprint…</option>
            {(data.nodes ?? []).filter((n) => !n.in_registry).map((n) => (
              <option key={n.id} value={n.id} style={{ background: '#001023' }}>{n.id}</option>
            ))}
          </select>
          <button style={btn} disabled={busy || !nodeId} onClick={() => act('build_node', { id: nodeId }, `absorb ${nodeId}`).then(() => setNodeId(''))}>absorb node</button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={inputStyle} placeholder="assimilate: file / folder / .zip / URL (any language)" value={path} onChange={(e) => setPath(e.target.value)} />
          <button style={btn} disabled={busy || !path} onClick={() => act('assimilate', { path }, 'assimilate')}>absorb</button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...inputStyle, flex: '0 0 30%' }} placeholder="id e.g. tool.x" value={genId} onChange={(e) => setGenId(e.target.value)} />
          <input style={inputStyle} placeholder="generate: describe the module" value={genDesc} onChange={(e) => setGenDesc(e.target.value)} />
          <button style={btn} disabled={busy || !genId || !genDesc} onClick={() => act('generate', { id: genId, description: genDesc }, 'generate')}>make</button>
        </div>
        {msg && <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: 1, color: msg.startsWith('✗') ? '#ff6666' : 'rgba(0,255,255,0.6)' }}>{msg}</div>}
      </div>
    </div>
  );
}
