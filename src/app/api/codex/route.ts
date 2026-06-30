import { NextRequest, NextResponse } from 'next/server';
import { getMemoryDb } from '@/lib/db';

// Codex navigator backend — a Neon-direct port of mastermind-client/codex_data.py.
// Serves the living knowledge navigator over transcript_archive (the research archive on
// NEON_MEMORY_URL). Browse ops are always-on (no query embed needed, neighbors uses the
// node's STORED embedding). `search` needs an embedder and is added in a later pass.
export const dynamic = 'force-dynamic';

// Web-export boilerplate that got ingested as content (noise attractors). Drop at query time.
const JUNK = [
  'To view keyboard shortcuts', 'https://x.com/i/grok/share',
  'Skip to content', 'You said:', 'ChatGPT said:',
];

type Row = {
  address: string; source_type: string | null; doc_id: string | null;
  title: string | null; topic_tags: string[] | null; evidence_class: string | null;
  subject: string | null; core_hash: string | null; char_count: number | null;
  content: string | null; sim?: number | string | null;
};

function node(r: Row, full = false): Record<string, unknown> {
  const content = r.content || '';
  const o: Record<string, unknown> = {
    address: r.address, source_type: r.source_type, doc_id: r.doc_id,
    title: r.title, tags: r.topic_tags, evidence_class: r.evidence_class,
    subject: r.subject, core_hash: r.core_hash, chars: r.char_count,
  };
  if (full) o.content = content; else o.snippet = content.slice(0, 280);
  if (r.sim != null) o.sim = Math.round(Number(r.sim) * 10000) / 10000;
  return o;
}

// Resonant-links cleaning: drop export boilerplate + dedup by content prefix (parity with codex_data).
function clean(rows: Row[], k: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const c = (r.content || '').trim();
    const ttl = r.title ? String(r.title) : '';
    if (JUNK.some((pfx) => c.startsWith(pfx) || ttl.startsWith(pfx))) continue;
    const h = c.slice(0, 400);
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(node(r));
    if (out.length >= k) break;
  }
  return out;
}

function ok(obj: unknown, code = 200): NextResponse {
  return NextResponse.json(obj, {
    status: code,
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
  });
}

// Query embedding via the SAME model that produced the stored vectors (Ollama nomic-embed-text, 768d).
// A different model would land in a different space -> meaningless similarity. URL is env-configurable so a
// deployed instance can point at the box via the tunnel; defaults to localhost for dev.
const OLLAMA_EMBED = process.env.OLLAMA_EMBED_URL || 'http://localhost:11434/api/embed';

async function embedQuery(q: string): Promise<number[] | null> {
  try {
    const r = await fetch(OLLAMA_EMBED, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', input: q.slice(0, 8000) }),
    });
    const j = await r.json();
    return j?.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sql = getMemoryDb();
  const p = new URL(req.url).searchParams;
  const op = p.get('op') || 'stats';
  const address = p.get('address') || '';
  const docId = p.get('doc_id') || '';
  const core = p.get('core_hash') || '';
  const k = Math.min(Math.max(parseInt(p.get('k') || '12', 10) || 12, 1), 50);

  try {
    if (op === 'stats') {
      const a = (await sql`SELECT count(*)::int AS chunks, count(embedding)::int AS embedded, count(DISTINCT doc_id)::int AS docs FROM transcript_archive`) as Array<{ chunks: number; embedded: number; docs: number }>;
      const s = (await sql`SELECT source_type, count(*)::int AS n FROM transcript_archive GROUP BY 1 ORDER BY 2 DESC`) as Array<{ source_type: string; n: number }>;
      const c = (await sql`SELECT count(*)::int AS n FROM transcript_archive WHERE core_hash IS NOT NULL`) as Array<{ n: number }>;
      const by_source_type: Record<string, number> = {};
      for (const r of s) by_source_type[r.source_type] = r.n;
      return ok({ ...a[0], by_source_type, addressed_core_hash: c[0].n });
    }

    if (op === 'search') {
      const q = p.get('q') || '';
      if (!q.trim()) return ok({ error: 'q required' }, 400);
      const src = p.get('source_type') || '';
      const ev = await embedQuery(q);
      if (!ev) return ok({ error: 'embed unavailable -- Ollama (nomic-embed-text) not reachable. Browse works; search needs the box up.', query: q }, 503);
      const vec = '[' + ev.join(',') + ']';
      const rows = src
        ? ((await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content, 1 - (embedding <=> ${vec}::vector) AS sim FROM transcript_archive WHERE source_type = ${src} ORDER BY embedding <=> ${vec}::vector LIMIT ${k * 5}`) as Row[])
        : ((await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content, 1 - (embedding <=> ${vec}::vector) AS sim FROM transcript_archive ORDER BY embedding <=> ${vec}::vector LIMIT ${k * 5}`) as Row[]);
      return ok({ query: q, results: clean(rows, k) });
    }

    if (op === 'node') {
      if (!address) return ok({ error: 'address required' }, 400);
      const r = (await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content FROM transcript_archive WHERE address = ${address}`) as Row[];
      return r[0] ? ok(node(r[0], true)) : ok({ error: 'not found', address }, 404);
    }

    if (op === 'neighbors') {
      if (!address) return ok({ error: 'address required' }, 400);
      const e = (await sql`SELECT embedding FROM transcript_archive WHERE address = ${address}`) as Array<{ embedding: string }>;
      if (!e[0]) return ok({ error: 'not found', address }, 404);
      const ev = e[0].embedding;
      const rows = (await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content, 1 - (embedding <=> ${ev}::vector) AS sim FROM transcript_archive WHERE address <> ${address} ORDER BY embedding <=> ${ev}::vector LIMIT ${k * 5}`) as Row[];
      return ok({ center: address, neighbors: clean(rows, k) });
    }

    if (op === 'doc') {
      if (!docId) return ok({ error: 'doc_id required' }, 400);
      const rows = (await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content FROM transcript_archive WHERE doc_id = ${docId} ORDER BY chunk_index`) as Row[];
      return ok({ doc_id: docId, chunks: rows.map((r) => node(r)) });
    }

    if (op === 'concept') {
      if (!core) return ok({ error: 'core_hash required' }, 400);
      const rows = (await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content FROM transcript_archive WHERE core_hash = ${core}`) as Row[];
      return ok({ core_hash: core, chunks: rows.map((r) => node(r)) });
    }

    if (op === 'docs') {
      const src = p.get('source_type') || '';
      const limit = Math.min(Math.max(parseInt(p.get('limit') || '400', 10) || 400, 1), 1000);
      const rows = src
        ? ((await sql`SELECT doc_id, count(*)::int AS chunks, max(source_type) AS source_type FROM transcript_archive WHERE source_type = ${src} GROUP BY doc_id ORDER BY count(*) DESC LIMIT ${limit}`) as Array<{ doc_id: string; chunks: number; source_type: string }>)
        : ((await sql`SELECT doc_id, count(*)::int AS chunks, max(source_type) AS source_type FROM transcript_archive GROUP BY doc_id ORDER BY count(*) DESC LIMIT ${limit}`) as Array<{ doc_id: string; chunks: number; source_type: string }>);
      return ok({ count: rows.length, docs: rows });
    }

    if (op === 'tree') {
      // The Golden Tree overview — the fractal_nodes clustering tree (ROOT -> 8 branches -> 227 leaves),
      // each node a "subject sun" carrying n_chunks + coherence. Always-on: structure only, no embedder, no box.
      const axis = p.get('axis') === 'source' ? 'source' : 'subject';
      const rows = (axis === 'source'
        ? await sql`SELECT path, name, parent_path, depth, is_leaf, n_chunks, coherence FROM source_nodes ORDER BY depth, path`
        : await sql`SELECT path, name, parent_path, depth, is_leaf, n_chunks, coherence FROM fractal_nodes ORDER BY depth, path`) as Array<{ path: string; name: string; parent_path: string | null; depth: number; is_leaf: boolean; n_chunks: number | null; coherence: number | null }>;
      const rootOf = (path: string, depth: number): string => (depth <= 0 ? 'ROOT' : path.split('/')[0]);
      const nodes = rows.map((r) => ({
        id: r.path, name: r.name, depth: r.depth, is_leaf: r.is_leaf,
        n_chunks: r.n_chunks || 0,
        coherence: r.coherence == null ? null : Math.round(r.coherence * 1000) / 1000,
        root: rootOf(r.path, r.depth),
      }));
      const present = new Set(rows.map((r) => r.path));
      const links: { source: string; target: string }[] = [];
      for (const r of rows) {
        if (r.parent_path && present.has(r.parent_path)) links.push({ source: r.parent_path, target: r.path });
        else if (r.depth === 1 && present.has('ROOT')) links.push({ source: 'ROOT', target: r.path });
      }
      const roots = Array.from(new Set(nodes.filter((n) => n.depth === 1).map((n) => n.root)));
      return ok({ nodes, links, roots, count: nodes.length, axis });
    }

    if (op === 'leaf') {
      // The chunks that live AT a leaf (or any) fractal node: transcript_archive.bloom_path == node.path.
      // This is what makes the orrery READ the archive — descend to a leaf, get its real content cards.
      const path = p.get('path') || '';
      if (!path) return ok({ error: 'path required' }, 400);
      const rows = (await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content FROM transcript_archive WHERE bloom_path = ${path} ORDER BY char_count DESC NULLS LAST LIMIT ${k * 3}`) as Row[];
      const total = (await sql`SELECT count(*)::int AS n FROM transcript_archive WHERE bloom_path = ${path}`) as Array<{ n: number }>;
      return ok({ path, total: total[0]?.n ?? rows.length, chunks: clean(rows, k) });
    }

    if (op === 'srcleaf') {
      // The SOURCE leaf: the conversations/files that live at a source_nodes leaf (provenance axis).
      const path = p.get('path') || '';
      if (!path) return ok({ error: 'path required' }, 400);
      const rows = (await sql`SELECT doc_id, n_chunks, source_type FROM source_doc_map WHERE src_path = ${path} ORDER BY n_chunks DESC LIMIT ${k * 4}`) as Array<{ doc_id: string; n_chunks: number; source_type: string | null }>;
      const tot = (await sql`SELECT count(*)::int AS n, COALESCE(sum(n_chunks),0)::int AS chunks FROM source_doc_map WHERE src_path = ${path}`) as Array<{ n: number; chunks: number }>;
      return ok({ path, total: tot[0]?.n ?? rows.length, chunks_total: tot[0]?.chunks ?? 0, conversations: rows });
    }

    if (op === 'docsubjects') {
      // CROSS-LINK forward: the SUBJECT leaves a conversation feeds (its chunks' bloom_paths). doc_id -> subjects.
      if (!docId) return ok({ error: 'doc_id required' }, 400);
      const rows = (await sql`SELECT bloom_path, count(*)::int AS n FROM transcript_archive WHERE doc_id = ${docId} AND bloom_path IS NOT NULL GROUP BY bloom_path ORDER BY n DESC LIMIT ${k * 2}`) as Array<{ bloom_path: string; n: number }>;
      return ok({ doc_id: docId, subjects: rows });
    }

    if (op === 'subjsources') {
      // CROSS-LINK reverse: the SOURCES feeding a subject leaf. bloom_path -> source files (via source_doc_map).
      const path = p.get('path') || '';
      if (!path) return ok({ error: 'path required' }, 400);
      const rows = (await sql`SELECT sdm.src_path, count(*)::int AS n FROM transcript_archive ta JOIN source_doc_map sdm USING(doc_id) WHERE ta.bloom_path = ${path} GROUP BY sdm.src_path ORDER BY n DESC LIMIT ${k * 2}`) as Array<{ src_path: string; n: number }>;
      return ok({ path, sources: rows });
    }

    if (op === 'children') {
      // Direct children of a node — for incremental tree descent (agents shouldn't pull the whole tree).
      // depth-1 branches have parent_path NULL by convention, so children of ROOT = (parent_path IS NULL AND depth=1).
      const axis = p.get('axis') === 'source' ? 'source' : 'subject';
      const path = p.get('path') || 'ROOT';
      const rows = (path === 'ROOT'
        ? (axis === 'source'
            ? await sql`SELECT path, name, depth, is_leaf, n_chunks, coherence FROM source_nodes WHERE parent_path IS NULL AND depth = 1 ORDER BY n_chunks DESC`
            : await sql`SELECT path, name, depth, is_leaf, n_chunks, coherence FROM fractal_nodes WHERE parent_path IS NULL AND depth = 1 ORDER BY n_chunks DESC`)
        : (axis === 'source'
            ? await sql`SELECT path, name, depth, is_leaf, n_chunks, coherence FROM source_nodes WHERE parent_path = ${path} ORDER BY n_chunks DESC`
            : await sql`SELECT path, name, depth, is_leaf, n_chunks, coherence FROM fractal_nodes WHERE parent_path = ${path} ORDER BY n_chunks DESC`)) as Array<{ path: string; name: string; depth: number; is_leaf: boolean; n_chunks: number | null; coherence: number | null }>;
      return ok({ axis, path, count: rows.length, children: rows.map((r) => ({ id: r.path, name: r.name, depth: r.depth, is_leaf: r.is_leaf, n_chunks: r.n_chunks || 0, coherence: r.coherence == null ? null : Math.round(r.coherence * 1000) / 1000 })) });
    }

    return ok({ error: 'unknown op', op, ops: ['stats', 'docs', 'search', 'node', 'neighbors', 'doc', 'concept', 'tree', 'children', 'leaf', 'srcleaf', 'docsubjects', 'subjsources'] }, 400);
  } catch (err: unknown) {
    return ok({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
