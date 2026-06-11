// src/app/api/resident/route.ts -- server-side bridge to resident_server :8771
// (same pattern as /api/modules -> :8770). Avoids CORS; the panel talks to this route.
import { NextRequest, NextResponse } from 'next/server';
const BASE = 'http://127.0.0.1:8771';

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path') || '/health';
  const qs = req.nextUrl.searchParams.get('qs') || '';
  try {
    const r = await fetch(`${BASE}${path}${qs ? '?' + qs : ''}`, { cache: 'no-store' });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ error: 'resident_server :8771 unreachable - ' + e.message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path') || '/decide';
  try {
    const body = await req.json();
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ error: 'resident_server :8771 unreachable - ' + e.message }, { status: 502 });
  }
}
