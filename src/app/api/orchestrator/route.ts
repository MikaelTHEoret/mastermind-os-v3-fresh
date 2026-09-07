// Bounded local operator bridge. Remote execution belongs to the Stargate ledger.
import { NextResponse } from 'next/server';
import { chatAccessError } from '../chat/_boundary';
import { LocalServiceRequestBodyError, readBoundedJsonRequestBody } from '@/lib/memory/local-service-auth';

export const dynamic = 'force-dynamic';
const READS = new Set(['/health', '/traces', '/dropbox', '/autonomic', '/heartbeat']);
const ACTIONS = new Set(['/decide', '/approve', '/correct', '/execute', '/autonomic/tick', '/autonomic/tick_tool', '/heartbeat/pause', '/upload']);
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

async function forward(path: string, body?: string) {
  const response = await fetch(`http://127.0.0.1:8771${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(body === undefined ? 15000 : 180000),
  });
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Response limit'); }
      text += decoder.decode(value, { stream: true });
    }
    return json(JSON.parse(text + decoder.decode()), response.status);
  } finally { reader.releaseLock(); }
}

export async function GET(request: Request) {
  const denied = await chatAccessError(request); if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const path = query.get('path') || '/health';
  if (!READS.has(path) || [...query.keys()].some(key => !['path', 'qs'].includes(key))
      || query.getAll('path').length > 1 || query.getAll('qs').length > 1) return json({ ok: false, code: 'INVALID_ROUTE' }, 400);
  const values = new URLSearchParams(query.get('qs') || '');
  let suffix = '';
  if (values.size) {
    const n = values.get('n');
    if (path !== '/traces' || values.size !== 1 || !n || !/^[1-9][0-9]?$|^100$/.test(n)) return json({ ok: false, code: 'INVALID_QUERY' }, 400);
    suffix = `?n=${n}`;
  }
  try { return await forward(path + suffix); }
  catch { return json({ ok: false, code: 'ORCHESTRATOR_UNAVAILABLE' }, 502); }
}

export async function POST(request: Request) {
  const denied = await chatAccessError(request); if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const path = query.get('path') || '/decide';
  if (!ACTIONS.has(path) || [...query.keys()].some(key => key !== 'path') || query.getAll('path').length > 1) return json({ ok: false, code: 'INVALID_ROUTE' }, 400);
  let body: string;
  try {
    body = await readBoundedJsonRequestBody(request, { maxBytes: 2 * 1024 * 1024 });
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object required');
  } catch (error) {
    return json({ ok: false, code: 'INVALID_OR_OVERSIZED_REQUEST' }, error instanceof LocalServiceRequestBodyError ? error.status : 400);
  }
  try { return await forward(path, body); }
  catch { return json({ ok: false, code: 'ORCHESTRATOR_RESULT_UNCONFIRMED', retryable: false }, 502); }
}
