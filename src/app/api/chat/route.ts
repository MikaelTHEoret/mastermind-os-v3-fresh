// src/app/api/chat/route.ts — web chat bridge hydrated through the canonical Mastermind embodiment gateway.
import { NextResponse } from 'next/server';
import { buildContextPack } from '@/lib/mastermind-context/gateway';
import { authorizeWebOrBearer, boundPayload, safeError } from '@/lib/mastermind-context/security';

const PORTAL = process.env.MASTERMIND_PORTAL_URL || 'http://127.0.0.1:8767';
const MAX_REQUEST_BYTES = 65_536;

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

function portalError(error: unknown) {
  return NextResponse.json(
    boundPayload({ ok: false, error: `Mastermind portal unreachable: ${safeError(error)}` }),
    { status: 502, headers: { 'cache-control': 'no-store' } },
  );
}

export async function GET() {
  try {
    const response = await fetch(`${PORTAL}/models`, { cache: 'no-store' });
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return portalError(error);
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeWebOrBearer(request);
  if (authorization.ok === false) return authorization.response;

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ ok: false, error: 'Request exceeds 64 KiB.' }, { status: 413 });
  }

  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
      return NextResponse.json({ ok: false, error: 'Request exceeds 64 KiB.' }, { status: 413 });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 4_000) {
      return NextResponse.json({ ok: false, error: 'message must contain 1-4000 characters.' }, { status: 400 });
    }
    const project = typeof body.project === 'string' ? body.project : 'mastermind';
    const contextPack = await buildContextPack(authorization.principal, {
      project,
      intent: message,
      scopes: ['identity', 'toolbox', 'project', 'task', 'memory', 'archive'],
      budget: 4_000,
    });

    const response = await fetch(`${PORTAL}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        ...body,
        project,
        context: JSON.stringify({
          embodiment: 'Mastermind',
          authority: 'canonical-gateway',
          contextPack,
        }),
      }),
    });
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return portalError(error);
  }
}
