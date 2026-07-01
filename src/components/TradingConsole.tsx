'use client';
// TradingConsole — cockpit for the trading organism. The GATE is the engine
// (mastermind-trading/gate, PROVEN); this console only OBSERVES its verdicts.
// Owner-gated: /api/trading/status is server-enforced; this UI merely reflects
// the denial. Deliberately no order/trade controls — nothing may write until
// the whole validation ladder is green (BLUEPRINT discipline).
import { useEffect, useState } from 'react';

const C = {
  cyan: '#00ffff', magenta: '#ff00ff', gold: '#ffaa00', green: '#00ffaa',
  red: '#ff4444', dim: '#667', bg: 'rgba(0,12,16,0.72)', line: 'rgba(0,255,255,0.25)',
};
const mono: React.CSSProperties = { fontFamily: '"Courier New", monospace' };

type GateRow = {
  run_id: string; ts: string; dataset: string; strategy: string;
  verdict: 'PASS' | 'KILL' | 'WARN';
  wfe: string | number; dsr: string | number; pbo: string | number;
  sr_hat?: string | number; sr0?: string | number; n_trials?: number; seed?: number;
  details?: any;
};
type Status =
  | { state: 'loading' }
  | { state: 'locked'; configured: boolean; reason: string }
  | { state: 'error'; error: string }
  | { state: 'ready'; gateResults: GateRow[]; openPositions: number };

const num = (v: string | number | undefined) => (v === undefined || v === null ? '—' : Number(v).toFixed(3));

export default function TradingConsole() {
  const [st, setSt] = useState<Status>({ state: 'loading' });

  useEffect(() => {
    let dead = false;
    fetch('/api/trading/status')
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (dead) return;
        if (r.ok && j.ok) setSt({ state: 'ready', gateResults: j.gateResults ?? [], openPositions: j.openPositions ?? 0 });
        else if (r.status === 401 || r.status === 403) setSt({ state: 'locked', configured: !!j.configured, reason: j.reason ?? 'denied' });
        else setSt({ state: 'error', error: j.error ?? `HTTP ${r.status}` });
      })
      .catch((e) => !dead && setSt({ state: 'error', error: String(e) }));
    return () => { dead = true; };
  }, []);

  const box: React.CSSProperties = {
    ...mono, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8,
    padding: '18px 20px', color: C.cyan,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 980 }}>
      <div style={box}>
        <div style={{ fontSize: 15, letterSpacing: 2, color: C.gold }}>TRADING · OWNER-GATED</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>
          the edge is discipline, not a signal — the gate is the engine, this console is the cockpit.
          nothing trades until the whole validation ladder is green.
        </div>
      </div>

      {st.state === 'loading' && (
        <div style={box}><span style={{ color: C.dim }}>querying gate…</span></div>
      )}

      {st.state === 'locked' && (
        <div style={{ ...box, borderColor: 'rgba(255,170,0,0.4)' }}>
          <div style={{ color: C.gold, fontSize: 14, letterSpacing: 1 }}>⬢ LOCKED</div>
          <div style={{ color: C.dim, fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>
            {st.configured
              ? <>Owner gate active — this session is not the owner ({st.reason}).</>
              : <>Owner gate not configured. Server denies all trading routes (fail-closed).
                  To activate: create a Clerk app, then set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
                  CLERK_SECRET_KEY and OWNER_CLERK_USER_ID in the environment.</>}
          </div>
        </div>
      )}

      {st.state === 'error' && (
        <div style={{ ...box, borderColor: 'rgba(255,68,68,0.4)', color: C.red }}>gate query failed: {st.error}</div>
      )}

      {st.state === 'ready' && (
        <>
          <div style={box}>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>
              VALIDATION GATE — verdicts (WFE&gt;0.70 ∧ DSR&gt;0.95 ∧ PBO&lt;0.50) · open positions: {st.openPositions}
            </div>
            {st.gateResults.length === 0 && <div style={{ color: C.dim }}>no gate runs recorded yet.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {st.gateResults.map((r, i) => {
                const pass = r.verdict === 'PASS';
                const vc = pass ? C.green : r.verdict === 'KILL' ? C.red : C.gold;
                return (
                  <div key={i} style={{
                    border: `1px solid ${vc}55`, borderLeft: `4px solid ${vc}`,
                    borderRadius: 6, padding: '10px 14px', background: 'rgba(0,0,0,0.35)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ color: vc, fontSize: 14, letterSpacing: 2 }}>{r.verdict}</span>
                      <span style={{ color: C.dim, fontSize: 10 }}>{r.run_id} · seed {r.seed ?? '—'} · {new Date(r.ts).toLocaleDateString()}</span>
                    </div>
                    <div style={{ color: C.cyan, fontSize: 12, marginTop: 4 }}>{r.strategy} <span style={{ color: C.dim }}>on</span> {r.dataset}</div>
                    <div style={{ display: 'flex', gap: 18, marginTop: 8, fontSize: 11 }}>
                      <span>WFE <b style={{ color: Number(r.wfe) > 0.7 ? C.green : C.red }}>{num(r.wfe)}</b></span>
                      <span>DSR <b style={{ color: Number(r.dsr) > 0.95 ? C.green : C.red }}>{num(r.dsr)}</b></span>
                      <span>PBO <b style={{ color: Number(r.pbo) < 0.5 ? C.green : C.red }}>{num(r.pbo)}</b></span>
                      <span style={{ color: C.dim }}>SR̂ {num(r.sr_hat)} vs SR₀ {num(r.sr0)} · N={r.n_trials ?? '—'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ ...box, fontSize: 11, color: C.dim }}>
            LADDER: gate first-slice <span style={{ color: C.green }}>PROVEN</span> → real-market OHLCV through gate
            <span style={{ color: C.gold }}> NEXT</span> → paper → canary → capital. positions / signatures / calibration
            tables exist (PROVISIONAL) — no writers until their stage is reached.
          </div>
        </>
      )}
    </div>
  );
}
