// src/app/api/embodiment/session/route.ts — web cockpit adapter to the same canonical embodiment service used by MCP.
import { NextResponse } from 'next/server';
import { createEmbodimentSession } from '@/lib/mastermind-context/gateway';
import { authorizeWebOrBearer, boundPayload, safeError } from '@/lib/mastermind-context/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_SCOPES = new Set(['identity', 'toolbox', 'project', 'task', 'memory', 'archive', 'minecraft-status']);

function parseInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A JSON object is required.');
  const input = value as Record<string, unknown>;
  if (typeof input.intent !== 'string' || !input.intent.trim() || input.intent.length > 4_000) throw new Error('intent must contain 1-4000 characters.');
  if (input.project !== undefined && (typeof input.project !== 'string' || !input.project.trim() || input.project.length > 120)) throw new Error('project must contain 1-120 characters.');
  if (input.budget !== undefined && (typeof input.budget !== 'number' || !Number.isInteger(input.budget) || input.budget < 1_000 || input.budget > 12_000)) throw new Error('budget must be an integer from 1000 to 12000.');
  if (input.scopes !== undefined) {
    if (!Array.isArray(input.scopes) || input.scopes.length > 7 || input.scopes.some((scope) => typeof scope !== 'string' || !VALID_SCOPES.has(scope))) {
      throw new Error('scopes contains an unsupported embodiment scope.');
    }
  }
  return {
    project: input.project as string | undefined,
    intent: input.intent,
    scopes: input.scopes as string[] | undefined,
    budget: input.budget as number | undefined,
  };
}

export async function POST(request: Request) {
  const authorization = await authorizeWebOrBearer(request);
  if (authorization.ok === false) return authorization.response;
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 65_536) return NextResponse.json({ ok: false, error: { code: 'REQUEST_TOO_LARGE', message: 'Request exceeds 64 KiB.' } }, { status: 413 });

  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 65_536) throw new Error('Request exceeds 64 KiB.');
    const input = parseInput(JSON.parse(raw));
    const session = await createEmbodimentSession(authorization.principal, input);
    return NextResponse.json(boundPayload(session), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      boundPayload({ ok: false, error: { code: 'MASTERMIND_EMBODIMENT_ERROR', message: safeError(error) } }),
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
