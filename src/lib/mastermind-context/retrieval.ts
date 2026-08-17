// src/lib/mastermind-context/retrieval.ts — authorized curated-memory and source-archive retrieval.
import { getMemoryDb } from '@/lib/db';
import { GatewayPrincipal, safeError } from './security';
import {
  ArchiveRow,
  MemoryRow,
  archiveResult,
  embedQuery,
  limitValue,
  memoryResult,
  projectId,
  queryText,
  reciprocalRankFusion,
  requireScope,
} from './common';

async function lexicalMemories(query: string, project: string, layer: string | null, limit: number): Promise<MemoryRow[]> {
  const sql = getMemoryDb();
  return await sql`
    SELECT id::text, content, layer, project, tags, priority, updated_at,
      ts_rank_cd(to_tsvector('simple', COALESCE(content, '')), websearch_to_tsquery('simple', ${query})) AS lexical_score
    FROM harmonic_memories
    WHERE (
      to_tsvector('simple', COALESCE(content, '')) @@ websearch_to_tsquery('simple', ${query})
      OR content ILIKE ${`%${query}%`}
    )
      AND (${layer}::text IS NULL OR layer = ${layer})
      AND (project = ${project} OR project IS NULL OR layer IN ('identity', 'toolbox'))
    ORDER BY lexical_score DESC, priority DESC NULLS LAST, updated_at DESC NULLS LAST
    LIMIT ${limit}
  ` as MemoryRow[];
}

async function denseMemories(vector: number[], project: string, layer: string | null, limit: number): Promise<MemoryRow[]> {
  const sql = getMemoryDb();
  const encoded = `[${vector.map((value) => Number(value).toString()).join(',')}]`;
  return await sql`
    SELECT id::text, content, layer, project, tags, priority, updated_at,
      1 - (embedding <=> ${encoded}::vector) AS vector_score
    FROM harmonic_memories
    WHERE embedding IS NOT NULL
      AND (${layer}::text IS NULL OR layer = ${layer})
      AND (project = ${project} OR project IS NULL OR layer IN ('identity', 'toolbox'))
    ORDER BY embedding <=> ${encoded}::vector
    LIMIT ${limit}
  ` as MemoryRow[];
}

export async function searchMemory(principal: GatewayPrincipal, input: { query: string; project?: string; layer?: string | null; limit?: number }) {
  requireScope(principal, 'memory');
  const query = queryText(input.query);
  const project = projectId(input.project);
  const layer = input.layer || null;
  if (layer && !['identity', 'toolbox', 'project', 'session'].includes(layer)) throw new Error('Unsupported memory layer.');
  const limit = limitValue(input.limit);
  const candidateLimit = Math.min(50, limit * 4);
  const lexical = await lexicalMemories(query, project, layer, candidateLimit);
  const vector = await embedQuery(query);
  let dense: MemoryRow[] = [];
  const warnings: string[] = [];
  if (vector) {
    try { dense = await denseMemories(vector, project, layer, candidateLimit); }
    catch (error) { warnings.push(`Dense memory retrieval degraded to lexical: ${safeError(error)}`); }
  } else {
    warnings.push('Dense memory retrieval unavailable; lexical retrieval remained active.');
  }
  const results = reciprocalRankFusion(lexical, dense, (row) => String(row.id), limit)
    .map((item) => memoryResult(item.row, [...new Set(item.channels)], item.score));
  return { available: true, project, query, retrievalMode: dense.length ? 'hybrid-rrf' : 'lexical', resultCount: results.length, results, warnings };
}

async function lexicalArchive(query: string, sourceType: string | null, limit: number): Promise<ArchiveRow[]> {
  const sql = getMemoryDb();
  return await sql`
    SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject,
      core_hash, char_count, chunk_index, content,
      ts_rank_cd(
        to_tsvector('simple', concat_ws(' ', COALESCE(title, ''), COALESCE(subject, ''), COALESCE(content, ''))),
        websearch_to_tsquery('simple', ${query})
      ) AS lexical_score
    FROM transcript_archive
    WHERE to_tsvector('simple', concat_ws(' ', COALESCE(title, ''), COALESCE(subject, ''), COALESCE(content, '')))
        @@ websearch_to_tsquery('simple', ${query})
      AND (${sourceType}::text IS NULL OR source_type = ${sourceType})
    ORDER BY lexical_score DESC, char_count DESC NULLS LAST
    LIMIT ${limit}
  ` as ArchiveRow[];
}

async function denseArchive(vector: number[], sourceType: string | null, limit: number): Promise<ArchiveRow[]> {
  const sql = getMemoryDb();
  const encoded = `[${vector.map((value) => Number(value).toString()).join(',')}]`;
  return await sql`
    SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject,
      core_hash, char_count, chunk_index, content,
      1 - (embedding <=> ${encoded}::vector) AS vector_score
    FROM transcript_archive
    WHERE embedding IS NOT NULL
      AND (${sourceType}::text IS NULL OR source_type = ${sourceType})
    ORDER BY embedding <=> ${encoded}::vector
    LIMIT ${limit}
  ` as ArchiveRow[];
}

export async function searchArchive(principal: GatewayPrincipal, input: { query: string; sourceType?: string | null; limit?: number }) {
  requireScope(principal, 'archive');
  const query = queryText(input.query);
  const sourceType = input.sourceType || null;
  const limit = limitValue(input.limit);
  const candidateLimit = Math.min(60, limit * 5);
  const lexical = await lexicalArchive(query, sourceType, candidateLimit);
  const vector = await embedQuery(query);
  let dense: ArchiveRow[] = [];
  const warnings: string[] = [];
  if (vector) {
    try { dense = await denseArchive(vector, sourceType, candidateLimit); }
    catch (error) { warnings.push(`Dense archive retrieval degraded to lexical: ${safeError(error)}`); }
  } else {
    warnings.push('Dense archive retrieval unavailable; lexical retrieval remained active.');
  }
  const perDocument = new Map<string, number>();
  const results = reciprocalRankFusion(lexical, dense, (row) => row.address, candidateLimit)
    .filter((item) => {
      const key = item.row.doc_id || item.row.address;
      const count = perDocument.get(key) || 0;
      if (count >= 2) return false;
      perDocument.set(key, count + 1);
      return true;
    })
    .slice(0, limit)
    .map((item) => archiveResult(item.row, [...new Set(item.channels)], item.score));
  return { available: true, query, retrievalMode: dense.length ? 'hybrid-rrf' : 'lexical', resultCount: results.length, results, warnings };
}

export async function fetchArchive(principal: GatewayPrincipal, input: { address: string; contextWindow?: number }) {
  requireScope(principal, 'archive');
  const address = input.address.trim();
  if (!address || address.length > 512) throw new Error('Invalid archive address.');
  const contextWindow = Math.max(0, Math.min(5, Math.floor(input.contextWindow ?? 2)));
  const sql = getMemoryDb();
  const center = await sql`
    SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject,
      core_hash, char_count, chunk_index, content
    FROM transcript_archive
    WHERE address = ${address}
    LIMIT 1
  ` as ArchiveRow[];
  if (!center.length) return { available: true, found: false, address, passages: [] };

  let passages = center;
  const row = center[0];
  if (row.doc_id && row.chunk_index !== null) {
    passages = await sql`
      SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject,
        core_hash, char_count, chunk_index, content
      FROM transcript_archive
      WHERE doc_id = ${row.doc_id}
        AND chunk_index BETWEEN ${Number(row.chunk_index) - contextWindow} AND ${Number(row.chunk_index) + contextWindow}
      ORDER BY chunk_index ASC
    ` as ArchiveRow[];
  }
  return {
    available: true,
    found: true,
    address,
    centerAddress: row.address,
    passages: passages.map((passage) => archiveResult(passage, ['exact-address'], 1, true)),
  };
}

export async function pinnedContext(
  principal: GatewayPrincipal,
  projectInput?: string,
  requestedScopes: string[] = ['identity', 'toolbox', 'project'],
) {
  const includeIdentity = requestedScopes.includes('identity');
  const includeToolbox = requestedScopes.includes('toolbox');
  const includeProject = requestedScopes.includes('project');
  if (!includeIdentity && !includeToolbox && !includeProject) return [];
  if (includeIdentity) requireScope(principal, 'identity');
  if (includeToolbox) requireScope(principal, 'toolbox');
  if (includeProject) requireScope(principal, 'project');
  const project = projectId(projectInput);
  const sql = getMemoryDb();
  const rows = await sql`
    WITH ranked AS (
      SELECT id::text, content, layer, project, tags, priority, updated_at,
        row_number() OVER (
          PARTITION BY layer
          ORDER BY priority DESC NULLS LAST, updated_at DESC NULLS LAST
        ) AS layer_rank
      FROM harmonic_memories
      WHERE (${includeIdentity}::boolean AND layer = 'identity')
         OR (${includeToolbox}::boolean AND layer = 'toolbox')
         OR (${includeProject}::boolean AND layer = 'project' AND project = ${project})
    )
    SELECT id, content, layer, project, tags, priority, updated_at
    FROM ranked
    WHERE (layer = 'identity' AND layer_rank <= 8)
       OR (layer = 'toolbox' AND layer_rank <= 8)
       OR (layer = 'project' AND layer_rank <= 12)
    ORDER BY
      CASE layer WHEN 'identity' THEN 0 WHEN 'toolbox' THEN 1 ELSE 2 END,
      priority DESC NULLS LAST,
      updated_at DESC NULLS LAST
  ` as MemoryRow[];
  return rows.map((row) => memoryResult(row, ['pinned'], 1));
}
