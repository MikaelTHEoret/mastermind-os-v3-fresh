// src/lib/mastermind-context/state.ts — provider-independent task continuity and gateway health.
import { getMemoryDb } from '@/lib/db';
import { GatewayPrincipal, safeError } from './security';
import { limitValue, projectId, requireScope, text, timestamp } from './common';

export type TaskCheckpointResult = {
  id: string;
  revision: number;
  requestKey: string;
  summary: string;
  completed: unknown;
  unresolved: unknown;
  recovery: string;
  metadata: unknown;
  createdAt: string | null;
};

export type ProjectTaskResult = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  revision: number;
  metadata: unknown;
  createdAt: string | null;
  updatedAt: string | null;
  checkpoints: TaskCheckpointResult[];
};

export type ProjectStateResult = {
  available: boolean;
  project: string;
  taskCount: number;
  tasks: ProjectTaskResult[];
  warnings?: string[];
};

export async function projectState(
  principal: GatewayPrincipal,
  input: { project?: string; taskId?: string; limit?: number },
): Promise<ProjectStateResult> {
  requireScope(principal, 'task');
  const project = projectId(input.project);
  const parentId = (process.env.MASTERMIND_PARENT_ID || process.env.MASTERMIND_OWNER_ID || '').trim();
  if (!parentId) return { available: false, project, taskCount: 0, tasks: [], warnings: ['MASTERMIND_PARENT_ID is not configured; persistent task recovery is fail-closed.'] };
  const limit = limitValue(input.limit);
  const taskId = (input.taskId || '').trim();
  const sql = getMemoryDb();
  try {
    const tasks = await sql`
      SELECT id::text, project_id::text, title, status, revision, metadata, created_at, updated_at
      FROM mastermind_tasks
      WHERE parent_id::text = ${parentId}
        AND project_id::text = ${project}
        AND (${taskId}::text = '' OR id::text = ${taskId})
      ORDER BY updated_at DESC
      LIMIT ${limit}
    ` as Array<{ id: string; project_id: string; title: string; status: string; revision: number; metadata: unknown; created_at: Date | string; updated_at: Date | string }>;

    const hydrated = await Promise.all(tasks.map(async (task) => {
      const checkpoints = await sql`
        SELECT id::text, revision, request_key, summary, completed, unresolved, recovery, metadata, created_at
        FROM mastermind_task_checkpoints
        WHERE task_id = ${task.id}::uuid
        ORDER BY revision DESC
        LIMIT 10
      ` as Array<{ id: string; revision: number; request_key: string; summary: string; completed: unknown; unresolved: unknown; recovery: string; metadata: unknown; created_at: Date | string }>;
      return {
        id: task.id,
        projectId: task.project_id,
        title: text(task.title, 500),
        status: task.status,
        revision: Number(task.revision),
        metadata: task.metadata,
        createdAt: timestamp(task.created_at),
        updatedAt: timestamp(task.updated_at),
        checkpoints: checkpoints.map((checkpoint) => ({
          id: checkpoint.id,
          revision: Number(checkpoint.revision),
          requestKey: checkpoint.request_key,
          summary: text(checkpoint.summary, 4_000),
          completed: checkpoint.completed,
          unresolved: checkpoint.unresolved,
          recovery: text(checkpoint.recovery, 4_000),
          metadata: checkpoint.metadata,
          createdAt: timestamp(checkpoint.created_at),
        })),
      };
    }));
    return { available: true, project, taskCount: hydrated.length, tasks: hydrated };
  } catch (error) {
    return { available: false, project, taskCount: 0, tasks: [], warnings: [`Persistent task state unavailable: ${safeError(error)}`] };
  }
}

export function capabilityManifest(principal: GatewayPrincipal) {
  return [
    { name: 'system_status', risk: 'read', available: true },
    { name: 'bootstrap', risk: 'read', available: true },
    { name: 'context_pack', risk: 'read', available: true },
    { name: 'memory_search', risk: 'read', available: principal.scopes.includes('memory') },
    { name: 'archive_search', risk: 'read', available: principal.scopes.includes('archive') },
    { name: 'archive_fetch', risk: 'read', available: principal.scopes.includes('archive') },
    { name: 'project_state', risk: 'read', available: principal.scopes.includes('task') },
    { name: 'task_checkpoint', risk: 'write', available: false, reason: 'Read path must pass cross-host acceptance before enabling writes.' },
    { name: 'minecraft_action', risk: 'consequential', available: false, reason: 'Minecraft security and M2 acceptance gates remain closed.' },
    { name: 'shell', risk: 'consequential', available: false },
    { name: 'raw_sql', risk: 'consequential', available: false },
  ];
}

export async function systemStatus(principal: GatewayPrincipal) {
  requireScope(principal, 'identity');
  const sql = getMemoryDb();
  try {
    const [archive, memories, fractal] = await Promise.all([
      sql`SELECT count(*)::int AS chunks, count(DISTINCT doc_id)::int AS documents, count(embedding)::int AS embedded FROM transcript_archive` as Promise<Array<{ chunks: number; documents: number; embedded: number }>>,
      sql`SELECT count(*)::int AS memories, count(embedding)::int AS embedded FROM harmonic_memories` as Promise<Array<{ memories: number; embedded: number }>>,
      sql`SELECT count(*)::int AS nodes FROM fractal_nodes` as Promise<Array<{ nodes: number }>>,
    ]);
    return {
      gateway: { name: 'mastermind-embodiment-gateway', version: '0.1.0', transport: ['internal-service', 'rest', 'streamable-http-mcp'] },
      identity: { authorized: true, actorResolved: true, authMode: principal.authMode, host: principal.host },
      database: { connected: true, provider: 'existing-neon-memory-substrate' },
      corpus: { ...archive[0], ...memories[0], ...fractal[0] },
      retrieval: { lexicalAvailable: true, denseConfigured: Boolean(process.env.OLLAMA_EMBED_URL), fusion: 'reciprocal-rank-fusion' },
      capabilities: capabilityManifest(principal),
      safety: { rawSqlExposed: false, shellExposed: false, arbitraryUrlExposed: false, actionsExposed: false, responseBoundaryBytes: 65_536 },
    };
  } catch (error) {
    return {
      gateway: { name: 'mastermind-embodiment-gateway', version: '0.1.0' },
      identity: { authorized: true, actorResolved: true, authMode: principal.authMode, host: principal.host },
      database: { connected: false, error: safeError(error) },
      capabilities: capabilityManifest(principal),
    };
  }
}
