// src/app/api/chat/route.ts -- server-side bridge to the Stargate portal (:8767).
// GET -> /models (selector list); POST -> /chat (start a gated agentic turn).
import { NextRequest, NextResponse } from 'next/server';
import { chatAccessError } from './_boundary';
const PORTAL = 'http://127.0.0.1:8767';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req:NextRequest) {
  const denied = await chatAccessError(req);
  if(denied) return denied;
  try {
    const r = await fetch(`${PORTAL}/models`, { cache: 'no-store' });
    return NextResponse.json(await r.json(), { status:r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'portal :8767 unreachable - ' + e.message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await chatAccessError(req);
  if(denied) return denied;
  try {
    const body = await req.json();
    const r = await fetch(`${PORTAL}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return NextResponse.json(await r.json(), { status:r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'portal :8767 unreachable - ' + e.message }, { status: 502 });
  }
}
