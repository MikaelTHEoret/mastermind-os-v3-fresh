'use client';
// The app-side face of the live Module Core kernel (via /api/modules -> module_server.py :8770).
// Shows live modules, pending proposals (approve/dismiss at the gate), and the two growth
// loops — assimilate a foreign file, or generate a module from a description.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import NativeDevelopment from './NativeDevelopment';

const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';
const CY = '#00ffff';

interface BackendModule {
  id: string; name: string; kind: string; status: string; description: string;
  faculty?: string; dependencies: string[]; capabilities: string[]; source?: string;
  enabled: boolean; gate: string; executionMode?:string; scan_safe?: boolean; scan_issues?: { severity: string; what: string; line?:number }[];
}
interface ProposalReview {proposal:BackendModule;source:string;sourceHash:string;sourceChanged:boolean;}
interface NodeInfo { id: string; faculty: string; in_registry: boolean; }
interface Payload { ok: boolean; modules: BackendModule[]; error?: string; nodes?: NodeInfo[];
  status?: { modules: number; live: string[]; pending_gate: string[]; capabilities: string[] } | null; }

// HTTP/owner denials do not have an inventory shape. Keep the shell usable and
// never turn an unverified or malformed response into live module controls.
export function normalizeModuleInventory(value: unknown, httpOk: boolean, status: number): Payload {
  const unavailable: Payload = { ok: false, modules: [], nodes: [],
    error: `The module kernel could not be verified${!httpOk && status >= 100 ? ` (HTTP ${status})` : ''}. Check its status in Services.` };
  if (!httpOk || !value || typeof value !== 'object') return unavailable;
  const result = value as Record<string, unknown>;
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every(item => typeof item === 'string');
  const moduleValid = (item: unknown): item is BackendModule => {
    if (!item || typeof item !== 'object') return false;
    const entry = item as Record<string, unknown>;
    return ['id', 'name', 'kind', 'status', 'description', 'gate'].every(key => typeof entry[key] === 'string')
      && typeof entry.enabled === 'boolean' && strings(entry.capabilities) && strings(entry.dependencies);
  };
  const nodeValid = (item: unknown): item is NodeInfo => {
    if (!item || typeof item !== 'object') return false;
    const node = item as Record<string, unknown>;
    return typeof node.id === 'string' && typeof node.faculty === 'string' && typeof node.in_registry === 'boolean';
  };
  if (result.ok !== true || !Array.isArray(result.modules) || !result.modules.every(moduleValid)
      || (result.nodes !== undefined && (!Array.isArray(result.nodes) || !result.nodes.every(nodeValid)))) return unavailable;
  return { ok: true, modules: result.modules, nodes: (result.nodes as NodeInfo[] | undefined) ?? [] };
}

const dot = (c: string) => ({ width: 7, height: 7, borderRadius: '50%', background: c, boxShadow: `0 0 5px ${c}`, flex: '0 0 auto' as const });
const gateColor = (m: BackendModule) =>
  m.enabled ? '#00ffaa' : m.gate === 'pending' ? '#ffaa00' : m.status === 'error' ? '#ff4444' : 'rgba(0,255,255,0.35)';
const sourceLabel = (source?: string) =>
  source === 'builtin' || source === 'generated' || source === 'assimilated' ? source : 'legacy';

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
  const [review,setReview]=useState<ProposalReview|null>(null);
  const actionActive=useRef(false);

  const readProposal=useCallback(async(id:string)=>{
    const response=await fetch(`/api/modules?action=proposal&id=${encodeURIComponent(id)}`,{cache:'no-store'});
    const result=await response.json();
    if(!response.ok || result.ok!==true || typeof result.source!=='string' || !/^[0-9a-f]{64}$/.test(result.sourceHash)) throw new Error(result.error || 'Proposal source could not be verified.');
    return result as ProposalReview;
  },[]);

  const inspectProposal=useCallback(async(id:string)=>{
    if(actionActive.current) return;
    actionActive.current=true;setBusy(true);setMsg('Loading proposal source…');
    try {setReview(await readProposal(id));setMsg('Review the source and scan findings before approval.');}
    catch(error){setMsg(`✗ ${error instanceof Error?error.message:String(error)}`);}
    finally {actionActive.current=false;setBusy(false);}
  },[readProposal]);

  const load = useCallback(async () => {
    try { const r = await fetch('/api/modules', { cache: 'no-store' }); setData(normalizeModuleInventory(await r.json(), r.ok, r.status)); }
    catch { setData(normalizeModuleInventory(null, false, 0)); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const act = useCallback(async (action: string, payload: Record<string, unknown>, label: string) => {
    if(actionActive.current) return;
    actionActive.current=true;
    setBusy(true); setMsg(`${label}…`);
    try {
      const r = await fetch('/api/modules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
      const j = await r.json();
      if(!r.ok || j.ok===false) setMsg(`✗ ${j.error || 'failed'}`);
      else if(j.proposal){setReview(await readProposal(j.proposal.id));setMsg('Proposal created. Review its source and scan before approving it.');}
      else {setMsg(`✓ ${label} done`);if(action==='approve' || action==='dismiss')setReview(null);}
      await load();
    } catch (e) { setMsg(`✗ ${String(e)}`); } finally { setBusy(false);actionActive.current=false; }
  }, [load,readProposal]);

  const live = data.modules.filter((m) => m.enabled).length;

  return (
    <>
    <NativeDevelopment/>
    <div style={{ background: 'rgba(0,15,35,0.75)', border: `1px solid ${CY}35`, borderRadius: 8, marginBottom: 8, backdropFilter: 'blur(8px)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${CY}25`, color: CY, fontFamily: mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', textShadow: `0 0 6px ${CY}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={dot(data.ok ? '#00ffaa' : '#ff4444')} />◈ Module Loader · Kernel
        </span>
        <span style={{ color: 'rgba(255,255,255,0.4)' }}>{live}/{data.modules.length} live</span>
      </div>

      <div style={{ padding: '8px 10px', maxHeight: 300, overflowY: 'auto' }}>
        {!data.ok && <div role="status" style={{ fontFamily: body, fontSize: 11, color: '#ff6666' }}>{data.error || 'The module kernel could not be verified. Check its status in Services.'}</div>}
        {data.modules.map((m) => (
          <div key={m.id} title={m.description} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, marginBottom: 2, background: m.enabled ? `${CY}0d` : 'transparent', border: `1px solid ${m.enabled ? CY + '22' : 'transparent'}` }}>
            <span style={dot(gateColor(m))} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: body, fontSize: 12, color: m.enabled ? '#fff' : 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
              <div style={{ fontFamily: mono, fontSize: 7, letterSpacing: 1, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>{m.kind} · {sourceLabel(m.source)} · {m.capabilities.length} cap · {m.enabled ? 'live' : m.gate}</div>
            </div>
            {m.gate === 'pending' && m.executionMode!=='isolated' && (
              <>
                <button style={btn} disabled={busy} onClick={() => void inspectProposal(m.id)}>review source</button>
                <button style={btn} disabled={busy || review?.proposal.id!==m.id || review.sourceChanged || m.scan_safe!==true} onClick={() => act('approve', { id: m.id,expectedHash:review?.sourceHash }, `approve ${m.id}`)}>approve reviewed</button>
                <button style={{ ...btn, color: '#ff6666', borderColor: '#ff666655', background: '#ff66661a' }} disabled={busy} onClick={() => act('dismiss', { id: m.id }, `dismiss ${m.id}`)}>dismiss</button>
              </>
            )}
          </div>
        ))}
      </div>

      {review && <section aria-label="Module proposal review" style={{padding:'10px',borderTop:`1px solid ${CY}33`,color:'#def',fontFamily:body,fontSize:12}}>
        <h3 style={{margin:'0 0 6px',color:CY}}>Review {review.proposal.name}</h3>
        <div>{review.proposal.description}</div>
        <div style={{marginTop:5}}>Capabilities: {review.proposal.capabilities.join(', ')}</div>
        <div style={{marginTop:5,color:review.proposal.scan_safe?'#ffaa00':'#ff6666'}}>Static scan: {review.proposal.scan_safe?'no high-severity findings. New capabilities still require isolated tests and verified activation.':'high-severity findings block approval.'}</div>
        {review.sourceChanged && <div role="alert" style={{color:'#ff6666'}}>The staged source changed. Create a new proposal before approval.</div>}
        {!!review.proposal.scan_issues?.length && <ul>{review.proposal.scan_issues.slice(0,50).map((issue,index)=><li key={index}>{issue.severity} · line {issue.line ?? '?'}: {issue.what}</li>)}</ul>}
        <pre style={{maxHeight:300,overflow:'auto',whiteSpace:'pre-wrap',fontFamily:'monospace',fontSize:11,padding:10,background:'rgba(0,0,0,0.4)'}}>{review.source}</pre>
        <div style={{fontSize:10,color:'rgba(255,255,255,0.45)',overflowWrap:'anywhere'}}>Reviewed source: {review.sourceHash}</div>
      </section>}

      <details style={{padding:10,borderTop:`1px solid ${CY}22`,color:'#adc6ce',fontFamily:body}}>
      <summary>Existing blueprint and source intake tools</summary>
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
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
          <input aria-label="New module identifier" style={{ ...inputStyle, flex: '0 0 30%' }} placeholder="id e.g. tool.x" value={genId} onChange={(e) => setGenId(e.target.value)} />
          <input aria-label="Module description" style={inputStyle} placeholder="generate: describe the module" value={genDesc} onChange={(e) => setGenDesc(e.target.value)} />
          <button style={btn} disabled={busy || !genId || !genDesc} onClick={() => act('generate', { id: genId, description: genDesc }, 'generate')}>generate proposal</button>
        </div>
        {msg && <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: 1, color: msg.startsWith('✗') ? '#ff6666' : 'rgba(0,255,255,0.6)' }}>{msg}</div>}
      </div>
      </details>
    </div>
    </>
  );
}
