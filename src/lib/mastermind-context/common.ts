// src/lib/mastermind-context/common.ts — shared validation, ranking, formatting, and embedding helpers.
import { redactText, GatewayPrincipal } from './security';

export const DEFAULT_PROJECT = process.env.MASTERMIND_DEFAULT_PROJECT || 'mastermind';
const ALLOWED_PROJECTS = new Set((process.env.MASTERMIND_ALLOWED_PROJECTS || DEFAULT_PROJECT).split(',').map((value) => value.trim()).filter(Boolean));
const ALLOWED_SCOPES = new Set(['identity', 'toolbox', 'project', 'task', 'memory', 'archive', 'minecraft-status']);
const MAX_QUERY_CHARS = 4_000;
const MAX_LIMIT = 20;
export const MAX_BUDGET_TOKENS = 12_000;

export type MemoryRow = {
  id: string | number;
  content: string | null;
  layer: string | null;
  project: string | null;
  tags: string[] | null;
  priority: number | null;
  updated_at: Date | string | null;
  lexical_score?: number | string | null;
  vector_score?: number | string | null;
};

export type ArchiveRow = {
  address: string;
  source_type: string | null;
  doc_id: string | null;
  title: string | null;
  topic_tags: string[] | null;
  evidence_class: string | null;
  subject: string | null;
  core_hash: string | null;
  char_count: number | null;
  chunk_index: number | null;
  content: string | null;
  lexical_score?: number | string | null;
  vector_score?: number | string | null;
};

export interface EmbodimentRequest {
  host?: string;
  project?: string;
  intent: string;
  scopes?: string[];
  budget?: number;
}

export function requireScope(principal: GatewayPrincipal, scope: string): void {
  if (!principal.actorId || !principal.roles.includes('owner') || !principal.scopes.includes(scope)) {
    throw new Error(`The current embodiment is not authorized for ${scope}.`);
  }
}

export function text(value: unknown, max = 2_000): string {
  const clean = redactText(value).trim();
  return clean.length > max ? `${clean.slice(0, max)}\n[…truncated…]` : clean;
}

export function timestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? text(value, 100) : date.toISOString();
}

export function projectId(value?: string): string {
  const project = (value || DEFAULT_PROJECT).trim();
  if (!/^[A-Za-z0-9._-]{1,120}$/u.test(project)) throw new Error('Invalid project identifier.');
  if (ALLOWED_PROJECTS.size && !ALLOWED_PROJECTS.has(project)) throw new Error('Project is outside the embodiment gateway allowlist.');
  return project;
}

export function queryText(value: string): string {
  const query = value.trim();
  if (!query || query.length > MAX_QUERY_CHARS) throw new Error(`Query or intent must contain 1-${MAX_QUERY_CHARS} characters.`);
  return query;
}

export function limitValue(value?: number): number {
  const parsed = Number.isFinite(value) ? Math.floor(value as number) : 8;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

export function validatedScopes(scopes?: string[]): string[] {
  const requested = scopes?.length ? scopes : ['identity', 'toolbox', 'project', 'task', 'memory', 'archive'];
  const unique = [...new Set(requested)];
  const invalid = unique.filter((scope) => !ALLOWED_SCOPES.has(scope));
  if (invalid.length) throw new Error(`Unsupported embodiment scopes: ${invalid.join(', ')}`);
  return unique;
}

export function memoryResult(row: MemoryRow, channels: string[], score: number) {
  return {
    id: String(row.id),
    sourceRef: `memory:${row.id}`,
    content: text(row.content, 2_400),
    layer: row.layer,
    project: row.project,
    tags: row.tags || [],
    priority: Number(row.priority || 0),
    updatedAt: timestamp(row.updated_at),
    retrievalChannels: channels,
    retrievalScore: Number(score.toFixed(8)),
    authority: row.layer === 'identity' || row.layer === 'toolbox' ? 'canonical-curated' : 'curated-memory',
  };
}

export function archiveResult(row: ArchiveRow, channels: string[], score: number, includeContent = false) {
  return {
    address: row.address,
    sourceRef: row.address,
    sourceType: row.source_type,
    documentId: row.doc_id,
    title: text(row.title, 400),
    tags: row.topic_tags || [],
    evidenceClass: row.evidence_class,
    subject: text(row.subject, 400),
    coreHash: row.core_hash,
    chunkIndex: row.chunk_index === null ? null : Number(row.chunk_index),
    characters: row.char_count === null ? null : Number(row.char_count),
    ...(includeContent ? { content: text(row.content, 12_000) } : { snippet: text(row.content, 2_400) }),
    retrievalChannels: channels,
    retrievalScore: Number(score.toFixed(8)),
  };
}

export function reciprocalRankFusion<T>(lexical: T[], dense: T[], key: (row: T) => string, take: number) {
  const merged = new Map<string, { row: T; score: number; channels: string[] }>();
  const apply = (rows: T[], channel: string) => rows.forEach((row, index) => {
    const id = key(row);
    const current = merged.get(id) || { row, score: 0, channels: [] };
    current.score += 1 / (60 + index + 1);
    current.channels.push(channel);
    merged.set(id, current);
  });
  apply(lexical, 'lexical');
  apply(dense, 'vector');
  return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, take);
}

export async function embedQuery(query: string): Promise<number[] | null> {
  const url = (process.env.OLLAMA_EMBED_URL || '').trim();
  if (!url) return null;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
  if (process.env.OLLAMA_EMBED_TOKEN) headers.authorization = `Bearer ${process.env.OLLAMA_EMBED_TOKEN}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text', input: query }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json() as { embeddings?: number[][]; embedding?: number[] };
    return payload.embeddings?.[0] || payload.embedding || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
