// src/app/api/trading/btcc/status/route.ts -- BTCC connectivity rung (owner-gated).
// Proves the stored creds + signing + session flow work against the live exchange:
// creds present -> login -> getAccountInfo. Read-only; no order capability exists here.
import { NextResponse } from 'next/server';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';
import { getBtccCreds, btccGetAccountInfo } from '@/lib/trading/btcc';

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
    const creds = await getBtccCreds();
    if (!creds) {
      return NextResponse.json({ ok: false, authorized: true, credsPresent: false,
        error: 'No active BTCC credentials -- enter them in Settings -> BTCC Exchange.' });
    }
    const info = await btccGetAccountInfo(creds);
    return NextResponse.json({ ok: true, authorized: true, credsPresent: true,
      connected: true, account: info.account ?? info.accounts ?? info });
  } catch (e: any) {
    return NextResponse.json({ ok: false, authorized: true, credsPresent: true,
      connected: false, error: e.message }, { status: 502 });
  }
}
