import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';

const PAINTING_PATH = process.env.PAINTING_PATH || 'C:\\Users\\Mik\\Documents\\claude-system\\MASTERMIND-PAINTING.json';
export const dynamic = 'force-dynamic';

interface RawPart { id: string; name: string; faculty: string; phase: string | number; status: string; status_note?: string; dependencies?: string[]; }

export async function GET() {
  try {
    const raw = await fs.readFile(PAINTING_PATH, 'utf-8');
    const d = JSON.parse(raw);
    const parts: RawPart[] = d.parts ?? [];
    const nodes = parts.map((p) => ({ id: p.id, name: p.name, faculty: p.faculty, phase: String(p.phase), status: p.status, note: p.status_note ?? '' }));
    const ids = new Set(nodes.map((n) => n.id));
    const edges: { from: string; to: string }[] = [];
    for (const p of parts) for (const dep of p.dependencies ?? []) {
      if (typeof dep === 'string' && ids.has(dep) && dep !== p.id) edges.push({ from: p.id, to: dep });
    }
    return NextResponse.json({ ok: true, nodes, edges, legend: d.legend ?? {}, generated: d.generated ?? null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, nodes: [], edges: [], legend: {} });
  }
}
