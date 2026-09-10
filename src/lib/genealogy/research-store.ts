import { getMemoryDb } from '@/lib/db';

export type GenealogyDb = ReturnType<typeof getMemoryDb>;

export async function ensureGenealogyResearchSchema(sql: GenealogyDb) {
  await sql`CREATE TABLE IF NOT EXISTS genealogy_research_notes (
    id BIGSERIAL PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES genealogy_graph_nodes(id) ON DELETE CASCADE,
    import_id BIGINT REFERENCES genealogy_graph_imports(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'clue',
    status TEXT NOT NULL DEFAULT 'open',
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    source_url TEXT,
    archive_page_id BIGINT,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    CHECK (kind IN ('finding','clue','hypothesis','conflict','task','proof')),
    CHECK (status IN ('open','investigating','supported','rejected','resolved')),
    CHECK (confidence >= 0 AND confidence <= 1)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS genealogy_research_notes_node_idx
    ON genealogy_research_notes(node_id, archived_at, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS genealogy_research_notes_status_idx
    ON genealogy_research_notes(status, kind, updated_at DESC) WHERE archived_at IS NULL`;
  return sql;
}

