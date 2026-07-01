'use client';
// src/components/SettingsConsole.tsx -- the Settings tab (top-right). Industry-standard config surface
// for Mastermind/Nexus Core + a Vercel-style provider-credential manager. The operator types raw values
// into THIS app; values are encrypted/placed server-side and never pass through the assistant.
import { useEffect, useState } from 'react';
import { PROVIDERS, CATEGORY_LABELS, getProvider, validateField } from '@/lib/integrations/providerCatalog';
import type { IntegrationCategory } from '@/lib/integrations/providerCatalog';

const C = { cyan:'#00ffff', magenta:'#ff00ff', gold:'#ffaa00', green:'#00ffaa', red:'#ff4444',
            dim:'rgba(0,255,255,0.35)', card:'rgba(0,15,35,0.75)', sub:'rgba(255,255,255,0.45)' };
const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';

const inp: React.CSSProperties = { background:'rgba(0,0,0,0.4)', border:`1px solid ${C.dim}`, color:'#cffcff',
  fontFamily:body, fontSize:13, padding:'7px 10px', borderRadius:5, width:'100%', outline:'none', boxSizing:'border-box' };
const lbl: React.CSSProperties = { fontFamily:mono, fontSize:9, letterSpacing:1.5, color:C.sub,
  textTransform:'uppercase', marginBottom:4, display:'block' };

function Btn({ children, onClick, color=C.cyan, disabled }:{children:any;onClick?:()=>void;color?:string;disabled?:boolean}) {
  return <button onClick={onClick} disabled={disabled} style={{ fontFamily:mono, fontSize:10, letterSpacing:1.5,
    padding:'7px 14px', borderRadius:5, cursor:disabled?'default':'pointer', border:`1px solid ${color}`,
    color:disabled?C.dim:color, background:`${color}12`, opacity:disabled?0.55:1 }}>{children}</button>;
}
function Badge({ children, color=C.cyan }:{children:any;color?:string}) {
  return <span style={{ fontFamily:mono, fontSize:8, letterSpacing:1, padding:'2px 6px', borderRadius:3,
    border:`1px solid ${color}55`, color, background:`${color}10`, whiteSpace:'nowrap' }}>{children}</span>;
}
function previewLine(envKey:string, value:string, secret:boolean) {
  if (!value) return envKey + '=';
  const shown = secret ? ('****' + (value.length>4 ? value.slice(-4) : '')) : value;
  return envKey + '=' + shown;
}

// ============================ Vercel-style key manager ============================
function KeyManager() {
  const [list, setList] = useState<any[]>([]);
  const [pid, setPid]   = useState('openai');
  const [env, setEnv]   = useState('all');
  const [vals, setVals] = useState<Record<string,string>>({});
  const [msg, setMsg]   = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const prov = getProvider(pid);

  const load = async () => {
    try { const r = await fetch('/api/keys'); const j = await r.json(); if (j.ok) setList(j.integrations||[]); }
    catch { /* offline ok */ }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { setVals({}); setMsg(null); }, [pid]);
  const setVal = (k:string, v:string) => setVals(s => ({ ...s, [k]: v }));

  const save = async () => {
    if (!prov) return;
    // format is advisory only -- never blocks a save
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/keys', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ provider_id: pid, environment: env, values: vals }) });
      const j = await r.json();
      if (j.ok) {
        let m = 'Saved.';
        if (j.placement && j.placement.placed) m += ' Placed at ' + j.placement.placed.join(', ');
        if (j.placement && j.placement.error) m += ' (' + j.placement.error + ')';
        setMsg(m); setVals({}); load();
      } else setMsg('Error: ' + j.error);
    } catch (e:any) { setMsg('Error: ' + e.message); }
    finally { setBusy(false); }
  };
  const toggle = async (id:number, active:boolean) => {
    await fetch('/api/keys', { method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id, is_active: active }) }); load();
  };
  const del = async (id:number) => {
    await fetch('/api/keys?id=' + id, { method:'DELETE' }); load();
  };

  const targetColor = (t:string) => t==='app'?C.cyan : t==='local'?C.gold : C.magenta;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ fontFamily:body, fontSize:12, color:C.sub, lineHeight:1.5 }}>
        Pick a provider and paste only the raw value. Mastermind builds the exact env-var line around it,
        validates the format, and stores it encrypted (AES-256-GCM). Local-deploy creds (Kaggle / SSH) are
        written to their standard location on this machine. Values are never shown back in full.
      </div>

      {/* add / edit form */}
      <div style={{ background:'rgba(0,0,0,0.25)', border:`1px solid ${C.cyan}22`, borderRadius:8, padding:14 }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:12 }}>
          <div style={{ flex:'1 1 260px' }}>
            <label style={lbl}>Provider</label>
            <select value={pid} onChange={e=>setPid(e.target.value)} style={inp}>
              {(Object.keys(CATEGORY_LABELS) as IntegrationCategory[]).map(cat => {
                const ps = PROVIDERS.filter(p => p.category===cat);
                if (!ps.length) return null;
                return <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                  {ps.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </optgroup>;
              })}
            </select>
          </div>
          <div style={{ flex:'0 0 160px' }}>
            <label style={lbl}>Environment</label>
            <select value={env} onChange={e=>setEnv(e.target.value)} style={inp}>
              <option value="all">All</option><option value="development">Development</option><option value="production">Production</option>
            </select>
          </div>
          <div style={{ flex:'0 0 auto', display:'flex', alignItems:'flex-end' }}>
            <Badge color={targetColor(prov?.target||'app')}>{(prov?.target||'app').toUpperCase()}</Badge>
          </div>
        </div>

        {prov?.note && <div style={{ fontFamily:body, fontSize:11, color:C.gold, marginBottom:10 }}>{prov.note}</div>}

        {prov?.fields.map(f => {
          const v = vals[f.envKey] || '';
          const err = v ? validateField(f, v) : null;
          return (
            <div key={f.envKey} style={{ marginBottom:10 }}>
              <label style={lbl}>{f.label} <span style={{ color:C.dim, textTransform:'none' }}>({f.envKey})</span></label>
              <input type={f.secret?'password':'text'} value={v} placeholder={f.placeholder||''} autoComplete="off" spellCheck={false}
                onChange={e=>setVal(f.envKey, e.target.value)} style={{ ...inp, borderColor: err?C.red:C.dim }} />
              <div style={{ fontFamily:body, fontSize:11, color: C.green, marginTop:3 }}>
                {'-> ' + previewLine(f.envKey, v, f.secret)}
              </div>
              {err && <div style={{ fontFamily:body, fontSize:11, color: C.gold, marginTop:2 }}>format hint: {err} (you can still save)</div>}
            </div>
          );
        })}

        <div style={{ display:'flex', gap:10, alignItems:'center', marginTop:6 }}>
          <Btn onClick={save} disabled={busy}>{busy?'SAVING...':'SAVE CREDENTIAL'}</Btn>
          {msg && <span style={{ fontFamily:body, fontSize:12, color: msg.startsWith('Error')?C.red:C.green }}>{msg}</span>}
        </div>
      </div>

      {/* stored credentials */}
      <div>
        <div style={{ fontFamily:mono, fontSize:10, letterSpacing:1.5, color:C.cyan, marginBottom:8 }}>STORED CREDENTIALS ({list.length})</div>
        {list.length===0 && <div style={{ fontFamily:body, fontSize:12, color:C.dim }}>None yet.</div>}
        {list.map(it => (
          <div key={it.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', marginBottom:6,
            background:'rgba(0,0,0,0.25)', border:`1px solid ${C.dim}`, borderRadius:6, opacity: it.is_active?1:0.5 }}>
            <Badge color={targetColor(it.target)}>{it.target}</Badge>
            <span style={{ fontFamily:mono, fontSize:11, color:C.cyan, minWidth:170 }}>{it.env_key}</span>
            <span style={{ fontFamily:body, fontSize:12, color:C.sub, flex:1 }}>{it.is_secret ? it.value_masked : (it.value_plain||it.value_masked)}</span>
            <Badge color={C.sub}>{it.environment}</Badge>
            <Btn color={it.is_active?C.gold:C.green} onClick={()=>toggle(it.id, !it.is_active)}>{it.is_active?'DISABLE':'ENABLE'}</Btn>
            <Btn color={C.red} onClick={()=>del(it.id)}>DELETE</Btn>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================ declarative schema (every other section) ============================
type FieldType = 'text'|'password'|'number'|'toggle'|'select'|'textarea'|'info';
interface SField { key:string; label:string; type:FieldType; options?:string[]; placeholder?:string; help?:string; def?:any; unit?:string; }
interface SSection { id:string; label:string; fields?:SField[]; special?:string; }

const SCHEMA: SSection[] = [
  { id:'general', label:'General', fields:[
    { key:'appName', label:'Workspace name', type:'text', def:'Mastermind / Nexus Core' },
    { key:'environment', label:'Environment', type:'select', options:['development','production'], def:'development' },
    { key:'defaultTab', label:'Default landing tab', type:'select', options:['command','operations','forge','modules','data','orchestrator','settings'], def:'command' },
    { key:'timezone', label:'Timezone', type:'text', def:'America/Toronto' },
    { key:'locale', label:'Locale', type:'select', options:['en','fr'], def:'en' },
  ]},
  { id:'appearance', label:'Appearance', fields:[
    { key:'accent', label:'Accent color', type:'select', options:['cyan','magenta','gold','green'], def:'cyan' },
    { key:'glowIntensity', label:'Glow intensity', type:'number', unit:'px', def:6 },
    { key:'fontScale', label:'Font scale', type:'number', unit:'%', def:100 },
    { key:'reduceMotion', label:'Reduce motion', type:'toggle', def:false },
    { key:'background', label:'Background', type:'select', options:['enhanced','plain'], def:'enhanced' },
  ]},
  { id:'integrations', label:'Integrations & API Keys', special:'keymanager' },
  { id:'issuedKeys', label:'Issued API Keys', fields:[
    { key:'_info', label:'Keys Mastermind ISSUES to external callers live in table mastermind_api_keys (separate from the provider credentials above). These defaults apply to newly issued keys.', type:'info' },
    { key:'defaultUsageLimit', label:'Default usage limit', type:'number', unit:'calls', def:10000 },
    { key:'requireSecret', label:'Require api_secret', type:'toggle', def:true },
    { key:'autoExpireDays', label:'Auto-expire after', type:'number', unit:'days (0=never)', def:0 },
  ]},
  { id:'models', label:'Models & Routing', fields:[
    { key:'llmProvider', label:'Default LLM provider (NEXUS_LLM_PROVIDER)', type:'select', options:['ollama','openai','anthropic','google','groq','deepseek'], def:'ollama' },
    { key:'llmModel', label:'Default model (NEXUS_LLM_MODEL)', type:'text', def:'qwen2.5', placeholder:'model name' },
    { key:'ollamaHost', label:'Ollama host', type:'text', def:'http://127.0.0.1:11434' },
    { key:'embeddingModel', label:'Embedding model', type:'text', def:'nomic-embed-text' },
    { key:'temperature', label:'Temperature', type:'number', def:0.7 },
    { key:'maxTokens', label:'Max tokens', type:'number', def:2048 },
    { key:'routeLocalThreshold', label:'Local-route threshold', type:'number', def:0.4, help:'Johnny: below this, route to the local model.' },
    { key:'routeApiThreshold', label:'API-route threshold', type:'number', def:0.7, help:'Above this, route to API; between the two, free-external.' },
  ]},
  { id:'orchestration', label:'Orchestration & Gates', fields:[
    { key:'requireApproval', label:'Require approval for side-effects', type:'toggle', def:true, help:'Gate dispatch of actions that change state.' },
    { key:'confabGuard', label:'Confabulation guard', type:'toggle', def:true },
    { key:'snanEnabled', label:'SNAN enabled', type:'toggle', def:true },
    { key:'surpriseWeight', label:'Surprise-weight multiplier', type:'number', def:1.0 },
    { key:'defaultTimeout', label:'Default worker timeout', type:'number', unit:'s', def:120 },
    { key:'memCapGiB', label:'Memory soft cap', type:'number', unit:'GiB', def:2 },
    { key:'memCapHardGiB', label:'Memory hard cap', type:'number', unit:'GiB', def:3 },
    { key:'maxRetries', label:'Max retries', type:'number', def:2 },
  ]},
  { id:'compute', label:'Compute & Deployment', fields:[
    { key:'_info', label:'Outward pillar resource catalog. Entitled resources only; auto-acquire stays OFF (the assistant never creates accounts). Toggle a resource ON after its crossing is complete.', type:'info' },
    { key:'enableLocal', label:'local_pc', type:'toggle', def:true },
    { key:'enableKaggle', label:'kaggle (free GPU)', type:'toggle', def:false, help:'Enable after the Kaggle crossing + kaggle.json placed.' },
    { key:'enableOracleVps', label:'oracle_vps', type:'toggle', def:false },
    { key:'enableCfWorkers', label:'cf_workers (serverless)', type:'toggle', def:false },
    { key:'scoutEnabled', label:'Scouting (read-only web search)', type:'toggle', def:true },
    { key:'autoAcquire', label:'Auto-acquire resources', type:'toggle', def:false, help:'Always OFF: never auto-create accounts or accept terms.' },
  ]},
  { id:'memory', label:'Memory System', fields:[
    { key:'recallLimit', label:'Default recall limit', type:'number', def:8 },
    { key:'archiveContextWindow', label:'Archive context window', type:'number', unit:'chunks', def:1 },
    { key:'consolidationCadence', label:'Consolidation cadence', type:'select', options:['session-end','daily','manual'], def:'session-end' },
    { key:'embeddingCachePath', label:'Embedding cache', type:'text', def:'_emb_cache.npy' },
    { key:'layers', label:'Active layers', type:'select', options:['identity+toolbox+project+session','project-only'], def:'identity+toolbox+project+session' },
  ]},
  { id:'database', label:'Database', fields:[
    { key:'_info', label:'Neon connection strings live in .env.local (NEON_PRIMARY_URL / NEON_MEMORY_URL) and are never displayed here.', type:'info' },
    { key:'connectTimeout', label:'Connect timeout', type:'number', unit:'s', def:15 },
    { key:'preferDirect', label:'Prefer direct (non-pooler) endpoint', type:'toggle', def:false, help:'Pooler: no sustained COPY/named cursors. Direct: longer ops, cold-starts.' },
    { key:'copyBatchSize', label:'COPY batch size', type:'number', unit:'rows', def:5000 },
  ]},
  { id:'servers', label:'Servers & Ports', fields:[
    { key:'_info', label:'Canonical Mastermind service ports. The Next.js app proxies to these via /api/* routes.', type:'info' },
    { key:'memServer', label:'mem_server', type:'number', def:8765 },
    { key:'stateServer', label:'state_server', type:'number', def:8766 },
    { key:'portalGateway', label:'portal_gateway (inward)', type:'number', def:8767 },
    { key:'moduleServer', label:'module_server', type:'number', def:8770 },
    { key:'orchestratorServer', label:'orchestrator_server', type:'number', def:8771 },
  ]},
  { id:'notifications', label:'Notifications', fields:[
    { key:'desktopToasts', label:'Desktop toasts', type:'toggle', def:true },
    { key:'gateAlerts', label:'Gate / approval alerts', type:'toggle', def:true },
    { key:'errorAlerts', label:'Error alerts', type:'toggle', def:true },
    { key:'soundEnabled', label:'Sound', type:'toggle', def:false },
  ]},
  { id:'account', label:'Account & Auth', fields:[
    { key:'_info', label:'Authentication is handled by Clerk. Manage your profile, sessions, and sign-out in the Clerk user menu.', type:'info' },
    { key:'sessionTimeout', label:'Session timeout', type:'number', unit:'min (0=default)', def:0 },
  ]},
  { id:'advanced', label:'Advanced', fields:[
    { key:'_info', label:'Export your configuration (settings only -- no secrets are ever included). Debug logging increases console verbosity.', type:'info' },
    { key:'debugLogging', label:'Debug logging', type:'toggle', def:false },
  ]},
];

function GenericField({ f, value, onChange }:{ f:SField; value:any; onChange:(v:any)=>void }) {
  if (f.type==='info') return <div style={{ fontFamily:body, fontSize:12, color:C.gold, background:`${C.gold}10`,
    border:`1px solid ${C.gold}33`, borderRadius:6, padding:'8px 10px', lineHeight:1.5, marginBottom:14 }}>{f.label}</div>;
  const v = value ?? f.def;
  return (
    <div style={{ marginBottom:12 }}>
      <label style={lbl}>{f.label}{f.unit?` (${f.unit})`:''}</label>
      {f.type==='toggle'
        ? <div onClick={()=>onChange(!v)} style={{ cursor:'pointer', display:'inline-flex', alignItems:'center', gap:8 }}>
            <div style={{ width:38, height:20, borderRadius:10, background:v?`${C.green}55`:'rgba(255,255,255,0.1)',
              border:`1px solid ${v?C.green:C.dim}`, position:'relative' }}>
              <div style={{ width:14, height:14, borderRadius:7, background:v?C.green:C.dim, position:'absolute', top:2, left:v?20:3 }}/>
            </div>
            <span style={{ fontFamily:body, fontSize:12, color:v?C.green:C.sub }}>{v?'ON':'OFF'}</span>
          </div>
        : f.type==='select'
        ? <select value={String(v)} onChange={e=>onChange(e.target.value)} style={inp}>{(f.options||[]).map(o=><option key={o} value={o}>{o}</option>)}</select>
        : f.type==='textarea'
        ? <textarea value={String(v??'')} placeholder={f.placeholder||''} onChange={e=>onChange(e.target.value)} style={{ ...inp, minHeight:60, resize:'vertical' }}/>
        : f.type==='number'
        ? <input type="number" value={v??''} placeholder={f.placeholder||''} onChange={e=>onChange(e.target.value===''?'':Number(e.target.value))} style={inp}/>
        : <input type={f.type==='password'?'password':'text'} value={String(v??'')} placeholder={f.placeholder||''} autoComplete="off" onChange={e=>onChange(e.target.value)} style={inp}/>
      }
      {f.help && <div style={{ fontFamily:body, fontSize:11, color:C.dim, marginTop:3 }}>{f.help}</div>}
    </div>
  );
}

export default function SettingsConsole() {
  const [active, setActive] = useState('general');
  const [settings, setSettings] = useState<Record<string,Record<string,any>>>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string|null>(null);

  useEffect(() => { (async () => {
    try { const r = await fetch('/api/settings'); const j = await r.json(); if (j.ok) setSettings(j.settings||{}); } catch {}
  })(); }, []);

  const val = (sec:string, k:string, def:any) => (settings[sec] && settings[sec][k]!==undefined) ? settings[sec][k] : def;
  const setField = (sec:string, k:string, v:any) => { setSettings(s => ({ ...s, [sec]: { ...(s[sec]||{}), [k]: v } })); setDirty(true); setMsg(null); };

  const saveAll = async () => {
    const items:any[] = [];
    for (const s of SCHEMA) { if (!s.fields) continue; for (const f of s.fields) { if (f.type==='info') continue; items.push({ section:s.id, key:f.key, value: val(s.id, f.key, f.def) }); } }
    try {
      const r = await fetch('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ settings: items }) });
      const j = await r.json();
      setMsg(j.ok ? ('Saved ' + j.saved + ' settings') : ('Error: ' + j.error)); if (j.ok) setDirty(false);
    } catch (e:any) { setMsg('Error: ' + e.message); }
  };
  const exportCfg = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type:'application/json' });
    const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'mastermind-settings.json'; a.click(); URL.revokeObjectURL(u);
  };

  const sec = SCHEMA.find(s => s.id===active) || SCHEMA[0];
  return (
    <div style={{ display:'flex', gap:16, height:'100%', minHeight:0 }}>
      <div style={{ flex:'0 0 200px', display:'flex', flexDirection:'column', gap:2, borderRight:`1px solid ${C.cyan}22`, paddingRight:10, overflowY:'auto' }}>
        <div style={{ fontFamily:mono, fontSize:12, letterSpacing:2, color:C.cyan, padding:'4px 8px 10px', textShadow:`0 0 6px ${C.cyan}` }}>SETTINGS</div>
        {SCHEMA.map(s => (
          <div key={s.id} onClick={()=>setActive(s.id)} style={{ fontFamily:mono, fontSize:10, letterSpacing:1, padding:'8px 10px', borderRadius:5, cursor:'pointer',
            color: active===s.id?C.cyan:C.sub, background: active===s.id?`${C.cyan}12`:'transparent', borderLeft:`2px solid ${active===s.id?C.cyan:'transparent'}` }}>{s.label}</div>
        ))}
      </div>
      <div style={{ flex:1, minWidth:0, overflowY:'auto', paddingRight:6 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, gap:12 }}>
          <div style={{ fontFamily:mono, fontSize:14, letterSpacing:2, color:C.cyan, textShadow:`0 0 6px ${C.cyan}` }}>{sec.label}</div>
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            {sec.id==='advanced' && <Btn color={C.gold} onClick={exportCfg}>EXPORT CONFIG</Btn>}
            {msg && <span style={{ fontFamily:body, fontSize:12, color: msg.startsWith('Error')?C.red:C.green }}>{msg}</span>}
            {sec.special!=='keymanager' && <Btn onClick={saveAll} disabled={!dirty} color={dirty?C.green:C.dim}>{dirty?'SAVE CHANGES':'SAVED'}</Btn>}
          </div>
        </div>
        {sec.special==='keymanager'
          ? <KeyManager/>
          : <div style={{ maxWidth:560 }}>{sec.fields?.map(f => <GenericField key={f.key} f={f} value={val(sec.id, f.key, f.def)} onChange={v=>setField(sec.id, f.key, v)} />)}</div>}
      </div>
    </div>
  );
}
