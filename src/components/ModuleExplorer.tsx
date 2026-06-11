'use client';
import React from 'react';
import { useModules } from '@/lib/modules/useModules';
import { registry, ModuleInfo, Accent } from '@/lib/modules/registry';

const A: Record<Accent, string> = {
  cyan: '#00ffff', gold: '#ffaa00', green: '#00ffaa',
  magenta: '#ff00ff', violet: '#8a2be2', red: '#ff4444',
};
const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';
const statusColor: Record<string, string> = {
  live: '#00ffaa', recovered: '#ffaa00', spec: '#8a2be2',
  thin: '#ff4444', planned: 'rgba(0,255,255,0.35)',
};

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

function Row({ m }: { m: ModuleInfo }) {
  const accent = A[m.accent ?? 'cyan'];
  const sc = statusColor[m.status] || '#888';
  return (
    <div title={m.description} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, marginBottom: 2, background: m.enabled ? `${accent}0d` : 'transparent', border: `1px solid ${m.enabled ? accent + '22' : 'transparent'}` }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, boxShadow: `0 0 5px ${sc}`, flex: '0 0 auto' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: body, fontSize: 12, color: m.enabled ? '#fff' : 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
        <div style={{ fontFamily: mono, fontSize: 7, letterSpacing: 1, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>{m.kind} · {m.status}</div>
      </div>
      <button onClick={() => registry.toggle(m.id)} aria-label={`toggle ${m.name}`} style={{ cursor: 'pointer', width: 30, height: 16, borderRadius: 8, border: `1px solid ${m.enabled ? accent : 'rgba(255,255,255,0.2)'}`, background: m.enabled ? `${accent}33` : 'transparent', position: 'relative', flex: '0 0 auto', padding: 0 }}>
        <span style={{ position: 'absolute', top: 1, left: m.enabled ? 15 : 1, width: 12, height: 12, borderRadius: '50%', background: m.enabled ? accent : 'rgba(255,255,255,0.4)', transition: 'left 0.15s', boxShadow: m.enabled ? `0 0 5px ${accent}` : 'none' }} />
      </button>
    </div>
  );
}

export default function ModuleExplorer() {
  const modules = useModules();
  const byFaculty = groupBy(modules, (m) => m.faculty || 'unsorted');
  const enabledCount = modules.filter((m) => m.enabled).length;

  return (
    <div style={{ background: 'rgba(0,15,35,0.75)', border: '1px solid #8a2be235', borderRadius: 8, marginBottom: 8, backdropFilter: 'blur(8px)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #8a2be225', color: '#8a2be2', fontFamily: mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', textShadow: '0 0 6px #8a2be2', display: 'flex', justifyContent: 'space-between' }}>
        <span>◈ Module Explorer</span>
        <span style={{ color: 'rgba(255,255,255,0.4)' }}>{enabledCount}/{modules.length}</span>
      </div>
      <div style={{ padding: '8px 10px', maxHeight: 340, overflowY: 'auto' }}>
        {Object.entries(byFaculty).map(([fac, mods]) => (
          <div key={fac} style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: 2, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', marginBottom: 4 }}>{fac}</div>
            {mods.map((m) => <Row key={m.id} m={m} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
