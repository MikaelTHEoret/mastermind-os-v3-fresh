// src/app/api/chat/resume/route.ts -- approve/deny a held tool, resuming the agentic run.
// POST { session, decision: 'approve' | 'deny' } -> portal /chat/resume -> mcp_host.
import { NextRequest, NextResponse } from 'next/server';
const PORTAL = 'http://127.0.0.1:8767';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const r = await fetch(`${PORTAL}/chat/resume`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return NextResponse.json(await r.json());
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'portal :8767 unreachable - ' + e.message }, { status: 502 });
  }
}
