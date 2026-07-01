import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';

// The concept graph = the 11 phenomenon signatures (Louvain communities) + their family-composition,
// with attraction edges = cosine over family-weight profiles. Source: mastermind-client/_signatures.txt
// (the real computed community structure). This is the Unity-free reframe of body.unity_cockpit.
const SIG_PATH = process.env.SIGNATURES_PATH || 'C:\\Users\\Mik\\Documents\\mastermind-client\\_signatures.txt';
export const dynamic = 'force-dynamic';

type Fam = { name: string; weight: number };
type Node = { id: string; n: number; label: string; clusters: number; links: number; families: Fam[]; dom: string };

function parseSignatures(txt: string): Node[] {
  const nodes: Node[] = [];
  const re = /===\s*SIGNATURE\s+(\d+)\s*:\s*(\d+)\s+clusters,\s*(\d+)\s+internal links\s*\|\s*families:\s*([^=]+?)\s*===/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt)) !== null) {
    const n = parseInt(m[1], 10), clusters = parseInt(m[2], 10), links = parseInt(m[3], 10);
    const families: Fam[] = [];
    for (const f of m[4].split(',')) {
      const fm = f.trim().match(/^([a-z0-9-]+)\((\d+)\)$/i);
      if (fm) families.push({ name: fm[1], weight: parseInt(fm[2], 10) });
    }
    families.sort((a, b) => b.weight - a.weight);
    const dom = families[0]?.name ?? 'misc';
    const label = families.slice(0, 2).map((f) => f.name).join(' · ') || `signature ${n}`;
    nodes.push({ id: `sig${n}`, n, label, clusters, links, families, dom });
  }
  return nodes;
}

function cosine(a: Node, b: Node): number {
  const va = new Map(a.families.map((f) => [f.name, f.weight] as const));
  const vb = new Map(b.families.map((f) => [f.name, f.weight] as const));
  let dot = 0, na = 0, nb = 0;
  for (const [, w] of va) na += w * w;
  for (const [, w] of vb) nb += w * w;
  for (const [k, w] of va) { const wb = vb.get(k); if (wb) dot += w * wb; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function GET() {
  try {
    const txt = await fs.readFile(SIG_PATH, 'utf-8');
    const nodes = parseSignatures(txt);
    const edges: { a: string; b: string; w: number }[] = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const w = cosine(nodes[i], nodes[j]);
        if (w >= 0.25) edges.push({ a: nodes[i].id, b: nodes[j].id, w: Math.round(w * 1000) / 1000 });
      }
    const domains = Array.from(new Set(nodes.map((n) => n.dom)));
    return NextResponse.json({ ok: true, core: { label: 'NEXUS' }, nodes, edges, domains });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, nodes: [], edges: [], domains: [] });
  }
}
