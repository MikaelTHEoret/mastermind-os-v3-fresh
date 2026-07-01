// src/app/api/trading/status/route.ts — the trading cockpit's data source.
// OWNER-GATED server-side (requireOwner) — returns gate verdicts + module state.
// Everyone else gets the denial status; no trading data ever leaves the server ungated.
import { NextResponse } from 'next/server';
import { getPrimaryDb } from '@/lib/db';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOwner();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, authorized: false, configured: ownerGateConfigured(), reason: gate.reason },
      { status: gate.status }
    );
  }
  try {
    const sql = getPrimaryDb();
    const gateResults = await sql`
      SELECT run_id, ts, dataset, strategy, verdict, wfe, dsr, pbo, sr_hat, sr0, n_trials, seed, details
      FROM trading_gate_results ORDER BY ts DESC, id DESC LIMIT 50`;
    const positions = await sql`
      SELECT count(*)::int AS n FROM trading_positions WHERE status = 'open'`;
    return NextResponse.json({
      ok: true,
      authorized: true,
      owner: gate.userId,
      gateResults,
      openPositions: (positions as any[])[0]?.n ?? 0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, authorized: true, error: e.message }, { status: 500 });
  }
}
