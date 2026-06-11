'use client'
// ForgeConsole - the design-from-intent surface (realizes body.forge_styling): an IDE/forge console that
// invokes the live generative faculties on the kernel (:8770) via /api/modules {action:"call"}.
import { useState } from 'react'

const mono = 'Orbitron, monospace'
const code = '"Cascadia Code", "Fira Code", ui-monospace, monospace'
const C = { cyan: '#00ffff', green: '#00ffaa', gold: '#ffaa00', red: '#ff4444', dim: 'rgba(0,255,255,0.32)', panel: 'rgba(0,10,25,0.55)' }

type Preset = { label: string; cap: string; args: string; kwargs: string }
const PRESETS: Preset[] = [
  { label: '\u03C8\u2080 ladder', cap: 'hands.pattern_forge.synthesize', args: '[{"kind":"psi0_ladder","n":12}]', kwargs: '{}' },
  { label: '\u03C6 ladder', cap: 'hands.pattern_forge.synthesize', args: '[{"kind":"phi_ladder","n":12}]', kwargs: '{}' },
  { label: 'prime gaps', cap: 'hands.pattern_forge.synthesize', args: '[{"kind":"prime_gaps","n":20}]', kwargs: '{}' },
  { label: 'calendar LCM', cap: 'hands.pattern_forge.synthesize', args: '[{"kind":"calendar_lcm","periods":[260,365]}]', kwargs: '{}' },
  { label: 'catalog', cap: 'hands.pattern_forge.catalog', args: '[]', kwargs: '{}' },
  { label: 'propose', cap: 'hands.pattern_forge.propose', args: '[]', kwargs: '{}' },
  { label: 'resonator \u00B7 ratios', cap: 'cortex.cycle_resonator.ratios', args: '[]', kwargs: '{}' },
  { label: 'recognize \u00B7 demo', cap: 'cortex.pattern_recognizer.analyze', args: '[[0,0.5,0.87,1,0.87,0.5,0,-0.5,-0.87,-1,-0.87,-0.5]]', kwargs: '{}' },
  { label: 'classify order', cap: 'cortex.pattern_recognizer.classify_order', args: '[[0,0.5,0.87,1,0.87,0.5,0,-0.5,-0.87,-1,-0.87,-0.5]]', kwargs: '{}' },
  { label: 'symmetry \u00B7 5-fold', cap: 'cortex.pattern_recognizer.symmetry', args: '[[[1,0],[0.309,0.951],[-0.809,0.588],[-0.809,-0.588],[0.309,-0.951]]]', kwargs: '{}' },
]

const inputStyle: React.CSSProperties = { background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.dim}`, borderRadius: 4, color: C.green, fontFamily: code, fontSize: 12, padding: '6px 8px', outline: 'none', width: '100%', boxSizing: 'border-box' }
const labelStyle: React.CSSProperties = { fontFamily: code, fontSize: 10, color: C.dim, letterSpacing: 1, display: 'flex', flexDirection: 'column', gap: 4 }

export default function ForgeConsole() {
  const [cap, setCap] = useState(PRESETS[0].cap)
  const [argsText, setArgsText] = useState(PRESETS[0].args)
  const [kwargsText, setKwargsText] = useState(PRESETS[0].kwargs)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadPreset = (p: Preset) => { setCap(p.cap); setArgsText(p.args); setKwargsText(p.kwargs); setResult(null); setError(null) }

  const forge = async () => {
    setError(null); setResult(null)
    let args: unknown, kwargs: unknown
    try { args = JSON.parse(argsText || '[]'); kwargs = JSON.parse(kwargsText || '{}') }
    catch (e) { setError('args / kwargs must be valid JSON: ' + (e instanceof Error ? e.message : String(e))); return }
    setBusy(true)
    try {
      const r = await fetch('/api/modules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'call', capability: cap, args, kwargs }) })
      const j = await r.json()
      if (j.ok === false) setError(j.error || 'call failed')
      else setResult(JSON.stringify(j.result ?? j, null, 2))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: mono, color: C.cyan, fontSize: 12, letterSpacing: 2 }}>{'\u2692'} FORGE \u2014 design-from-intent console</span>
        <span style={{ fontFamily: 'Rajdhani, sans-serif', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>invoke the live generative faculties on the kernel (:8770)</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map(p => {
          const on = cap === p.cap && argsText === p.args
          return <span key={p.label} onClick={() => loadPreset(p)} style={{ fontFamily: code, fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${on ? C.cyan : C.dim}`, color: on ? C.cyan : 'rgba(255,255,255,0.6)', background: C.panel }}>{p.label}</span>
        })}
      </div>

      <label style={labelStyle}>CAPABILITY
        <input value={cap} onChange={e => setCap(e.target.value)} style={inputStyle} spellCheck={false} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={labelStyle}>ARGS (json array)
          <textarea value={argsText} onChange={e => setArgsText(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} spellCheck={false} />
        </label>
        <label style={labelStyle}>KWARGS (json object)
          <textarea value={kwargsText} onChange={e => setKwargsText(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} spellCheck={false} />
        </label>
      </div>

      <div>
        <button onClick={forge} disabled={busy} style={{ fontFamily: mono, fontSize: 12, letterSpacing: 2, padding: '8px 22px', borderRadius: 6, cursor: busy ? 'wait' : 'pointer', border: `1px solid ${C.cyan}`, color: C.cyan, background: 'rgba(0,255,255,0.08)', boxShadow: `0 0 14px ${C.cyan}40`, opacity: busy ? 0.6 : 1 }}>{busy ? 'forging\u2026' : '\u2692 FORGE'}</button>
      </div>

      {error && <div style={{ fontFamily: code, fontSize: 12, color: C.red, border: `1px solid ${C.red}55`, borderRadius: 4, padding: '8px 10px', background: 'rgba(40,0,0,0.3)' }}>{error}</div>}
      {result && <pre style={{ fontFamily: code, fontSize: 12, color: C.green, border: `1px solid ${C.green}33`, borderRadius: 4, padding: '10px 12px', background: 'rgba(0,15,10,0.5)', maxHeight: 360, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>{result}</pre>}
      {!result && !error && <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 12, color: C.dim, padding: '8px 0' }}>Pick a preset or type a capability, then FORGE. The live result lands here.</div>}
    </div>
  )
}
