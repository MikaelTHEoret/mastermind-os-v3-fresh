// Bridge: the command center (host) <-> the live Module Core kernel (mastermind-client/module_server.py).
// GET  -> the live manifest + status the host mirrors.
// POST -> drive the kernel: assimilate / generate / approve / dismiss / call / reload / discover.
// Server-side fetch keeps the localhost kernel URL off the client and avoids CORS.
import { NextResponse } from 'next/server';

const CORE = process.env.MODULE_CORE_URL || 'http://127.0.0.1:8770';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [m, s, n] = await Promise.all([
      fetch(`${CORE}/modules`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`${CORE}/status`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`${CORE}/nodes`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ nodes: [] })),
    ]);
    return NextResponse.json({ ok: true, modules: m.modules ?? [], status: s, nodes: n.nodes ?? [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, modules: [], status: null, nodes: [] });
  }
}

const ROUTES: Record<string, string> = {
  call: '/call', assimilate: '/assimilate', generate: '/generate', build_node: '/build_node',
  approve: '/approve', dismiss: '/dismiss', reload: '/reload',
  discover: '/discover', integrate_file: '/integrate_file',
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { action, ...rest } = (body || {}) as { action?: string } & Record<string, unknown>;
  const path = action ? ROUTES[action] : undefined;
  if (!path) return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  try {
    const r = await fetch(`${CORE}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rest), cache: 'no-store',
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg });
  }
}
