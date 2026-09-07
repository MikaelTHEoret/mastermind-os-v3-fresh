import crypto from 'node:crypto';

import { neon } from '@neondatabase/serverless';

import { reciprocalRankFusion, diversifyByDocument } from './ranking.mjs';
import { ContextGatewayError, requiredString, patterns, uuid } from './validation.mjs';
import { archiveSourceTime, SOURCE_TIME_QUERY, unavailableSourceTime } from './source-time.mjs';
import { permissionGrantRef, canonicalJson } from './task-permissions.mjs';

function asRows(value) {
  if (!Array.isArray(value)) throw new Error('The memory store returned an invalid result.');
  return value;
}

function missingRelation(error) {
  return error?.code === '42P01' || /does not exist/i.test(String(error?.message ?? ''));
}

const MEMORY_COLUMNS = `id::text, content, layer, project, tags, priority, source, updated_at AS "updatedAt",
  COALESCE(memory_status, 'active') AS "memoryStatus", canonical_key AS "canonicalKey",
  superseded_by_memory_id AS "supersededByMemoryId",
  COALESCE(supersedes_memory_ids, '{}'::text[]) AS "supersedesMemoryIds",
  valid_from AS "validFrom", valid_to AS "validTo", COALESCE(row_version, 0)::text AS "rowVersion"`;

function taskOwner(identity) {
  if (!identity?.householdId || !identity?.actorPlayerId) {
    throw new ContextGatewayError('IDENTITY_NOT_CONFIGURED', 'Task reads require an explicit canonical operator.', 503);
  }
  return [requiredString(identity.householdId, 'householdId', 128, patterns.SAFE_ID), uuid(identity.actorPlayerId, 'actorPlayerId')];
}

const QUERY_STOP_WORDS = new Set(('a an and are as at be been by can could did do does for from how i in is it its me my of on or our please should that the their there these they this to was we were what when where which who why will with would you your '
  + 'au aux avec ce ces comment dans de des du elle en est et il je la le les ma mes mon nous ou par pas pour que quel quelle qui sa se ses son sur un une vous').split(' '));

export function lexicalFallback(query) {
  // Explicit phrases, exclusions, and OR expressions keep their original meaning.
  if (/["“”]/u.test(query) || /(^|\s)-\S/u.test(query) || /\bOR\b/u.test(query)) return null;
  const terms = [...new Set((query.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((term) => term.length > 1 && !QUERY_STOP_WORDS.has(term)))].slice(0, 12);
  if (terms.length < 2) return null;
  return { query: terms.map((term) => `"${term}"`).join(' OR '), terms };
}

async function lexicalCandidates(sql, statement, parameters) {
  const rows = asRows(await sql.query(statement, parameters));
  const fallback = rows.length === 0 ? lexicalFallback(parameters[0]) : null;
  if (!fallback) return { rows, lexical: 'strict' };
  return {
    rows: asRows(await sql.query(statement, [fallback.query, ...parameters.slice(1)])),
    lexical: 'term-or-fallback', fallbackTerms: fallback.terms,
  };
}

function withRetrievalDetails(rows, lexical, embedding) {
  // Preserve the existing array API; the gateway exposes this metadata separately.
  Object.defineProperty(rows, 'retrievalDetails', { value: {
    lexical: lexical.lexical,
    embeddingUsed: Boolean(embedding),
    ...(lexical.fallbackTerms ? { fallbackTerms: lexical.fallbackTerms } : {}),
  } });
  return rows;
}

export class NeonMemoryStore {
  constructor(url) {
    if (typeof url !== 'string' || url.length === 0) throw new Error('NEON_MEMORY_URL is not configured.');
    this.sql = neon(url);
  }

  async authorizeOperator(householdId, actorPlayerId) {
    const rows = asRows(await this.sql.query(
      'SELECT public.verify_mastermind_memory_operator_v1($1::text, $2::uuid) AS allowed',
      [householdId, actorPlayerId],
    ));
    return rows.length === 1 && rows[0].allowed === true;
  }

  async resolveClerkOperator(subject, identity) {
    const [householdId, actorPlayerId] = taskOwner(identity);
    requiredString(subject, 'Clerk subject', 128, /^user_[A-Za-z0-9_-]{1,123}$/);
    const rows = asRows(await this.sql.query(
      `SELECT household_id AS "householdId", player_id::text AS "actorPlayerId"
       FROM public.mastermind_player_external_identities_v1
       WHERE provider = 'clerk' AND provider_subject = $1::text
         AND household_id = $2::text AND player_id = $3::uuid
         AND public.verify_mastermind_memory_operator_v1(household_id, player_id)
       LIMIT 2`,
      [subject, householdId, actorPlayerId],
    ));
    if (rows.length !== 1 || rows[0].householdId !== householdId || rows[0].actorPlayerId !== actorPlayerId) {
      throw new ContextGatewayError('OWNER_BINDING_REQUIRED', 'The authenticated owner must be bound to the configured canonical operator.', 403);
    }
    return Object.freeze({ householdId, actorPlayerId });
  }

  async pinnedMemories(project, limits = { identity: 8, toolbox: 8, project: 12 }) {
    const rows = asRows(await this.sql.query(
      `SELECT ${MEMORY_COLUMNS}
       FROM public.harmonic_memories
       WHERE COALESCE(memory_status, 'active') = 'active'
         AND (layer IN ('identity', 'toolbox')
          OR (layer = 'project' AND lower(project) = lower($1::text)))
       ORDER BY
         CASE layer WHEN 'identity' THEN 0 WHEN 'toolbox' THEN 1 ELSE 2 END,
         priority DESC NULLS LAST,
         updated_at DESC NULLS LAST,
         id ASC`,
      [project],
    ));
    const counts = { identity: 0, toolbox: 0, project: 0 };
    return rows.filter((row) => {
      const layer = row.layer;
      if (!Object.hasOwn(counts, layer) || counts[layer] >= limits[layer]) return false;
      counts[layer] += 1;
      return true;
    });
  }

  async searchMemories(query, { project = null, limit = 10, embedding = null, includeInactive = false } = {}) {
    if (typeof includeInactive !== 'boolean') throw new ContextGatewayError('INVALID_ARGUMENT', 'includeInactive must be a boolean.');
    const candidateLimit = Math.min(80, Math.max(limit * 5, 25));
    const lexical = await lexicalCandidates(this.sql,
      `SELECT ${MEMORY_COLUMNS},
              ts_rank_cd(to_tsvector('simple', content), websearch_to_tsquery('simple', $1::text)) AS "lexicalScore"
       FROM public.harmonic_memories
       WHERE ($2::text IS NULL OR lower(project) = lower($2::text))
         AND ($4::boolean OR COALESCE(memory_status, 'active') = 'active')
         AND to_tsvector('simple', content) @@ websearch_to_tsquery('simple', $1::text)
       ORDER BY "lexicalScore" DESC, priority DESC NULLS LAST, updated_at DESC NULLS LAST
       LIMIT $3::integer`,
      [query, project, candidateLimit, includeInactive],
    );
    let semantic = [];
    if (embedding) {
      semantic = asRows(await this.sql.query(
        `SELECT ${MEMORY_COLUMNS},
                1 - (embedding <=> $1::vector) AS "semanticScore"
         FROM public.harmonic_memories
         WHERE embedding IS NOT NULL
           AND ($4::boolean OR COALESCE(memory_status, 'active') = 'active')
           AND ($2::text IS NULL OR lower(project) = lower($2::text))
         ORDER BY embedding <=> $1::vector, priority DESC NULLS LAST
         LIMIT $3::integer`,
        [JSON.stringify(embedding), project, candidateLimit, includeInactive],
      ));
    }
    return withRetrievalDetails(reciprocalRankFusion([lexical.rows, semantic], { key: 'id', limit, weights: [1.15, 1] }), lexical, embedding);
  }

  async searchArchive(query, { sourceType = null, limit = 10, embedding = null } = {}) {
    const candidateLimit = Math.min(100, Math.max(limit * 6, 30));
    const lexical = await lexicalCandidates(this.sql,
      `SELECT address, source_type AS "sourceType", doc_id AS "docId", title, topic_tags AS "topicTags",
              evidence_class AS "evidenceClass", subject, core_hash AS "coreHash", chunk_index AS "chunkIndex",
              char_count AS "charCount", content,
              ts_rank_cd(to_tsvector('simple', content), websearch_to_tsquery('simple', $1::text)) AS "lexicalScore"
       FROM public.transcript_archive
       WHERE ($2::text IS NULL OR source_type = $2::text)
         AND to_tsvector('simple', content) @@ websearch_to_tsquery('simple', $1::text)
       ORDER BY "lexicalScore" DESC, char_count DESC NULLS LAST, address ASC
       LIMIT $3::integer`,
      [query, sourceType, candidateLimit],
    );
    let semantic = [];
    if (embedding) {
      semantic = asRows(await this.sql.query(
        `SELECT address, source_type AS "sourceType", doc_id AS "docId", title, topic_tags AS "topicTags",
                evidence_class AS "evidenceClass", subject, core_hash AS "coreHash", chunk_index AS "chunkIndex",
                char_count AS "charCount", content, 1 - (embedding <=> $1::vector) AS "semanticScore"
         FROM public.transcript_archive
         WHERE embedding IS NOT NULL AND ($2::text IS NULL OR source_type = $2::text)
         ORDER BY embedding <=> $1::vector, char_count DESC NULLS LAST
         LIMIT $3::integer`,
        [JSON.stringify(embedding), sourceType, candidateLimit],
      ));
    }
    const fused = reciprocalRankFusion([lexical.rows, semantic], {
      key: 'address',
      limit: Math.min(candidateLimit, limit * 3),
      weights: [1.1, 1],
    });
    return withRetrievalDetails(diversifyByDocument(fused, limit, 2), lexical, embedding);
  }

  async fetchArchive(address, contextWindow = 1) {
    const exact = asRows(await this.sql.query(
      `SELECT address, source_type AS "sourceType", doc_id AS "docId", title, topic_tags AS "topicTags",
              evidence_class AS "evidenceClass", subject, core_hash AS "coreHash", chunk_index AS "chunkIndex",
              char_count AS "charCount", content, source_path AS "_sourcePath"
       FROM public.transcript_archive WHERE address = $1::text LIMIT 1`,
      [address],
    ));
    if (exact.length === 0) return null;
    const { _sourcePath: sourcePath, ...row } = exact[0];
    const neighbors = asRows(await this.sql.query(
      `SELECT address, source_type AS "sourceType", doc_id AS "docId", title, topic_tags AS "topicTags",
              evidence_class AS "evidenceClass", subject, core_hash AS "coreHash", chunk_index AS "chunkIndex",
              char_count AS "charCount", content
       FROM public.transcript_archive
       WHERE doc_id = $1::text AND chunk_index BETWEEN $2::integer AND $3::integer
       ORDER BY chunk_index ASC`,
      [row.docId, Math.max(0, Number(row.chunkIndex) - contextWindow), Number(row.chunkIndex) + contextWindow],
    ));
    let sourceTime = unavailableSourceTime();
    try {
      const projections = asRows(await this.sql.query(SOURCE_TIME_QUERY, [sourcePath, row.docId]));
      sourceTime = archiveSourceTime(projections, { sourcePath, docId: row.docId });
    } catch {
      // Optional derived metadata must not make original archive evidence unreadable.
    }
    return { exact: { ...row, sourceTime }, neighbors };
  }

  async searchMinecraftMemories(householdId, actorPlayerId, query, limit = 10) {
    const rows = asRows(await this.sql.query(
      `SELECT memory_key AS "memoryKey", revision::text, summary, namespace, visibility,
              player_id AS "playerId", world_ref AS "worldRef", session_id::text AS "sessionId",
              occurred_at AS "occurredAt", lifecycle_state AS "lifecycleState"
       FROM public.search_mastermind_operator_memories_v1(
         $1::text, $2::uuid, $3::text, 'active'::text, $4::integer
       )`,
      [householdId, actorPlayerId, query, limit],
    ));
    return rows;
  }

  async projectState(project, limit = 20, identity) {
    const [householdId, actorPlayerId] = taskOwner(identity);
    try {
      const tasks = asRows(await this.sql.query(
        `SELECT task_id::text AS "taskId", project_id AS project, intent, state, revision::text,
                created_at AS "createdAt", updated_at AS "updatedAt", last_checkpoint_at AS "lastCheckpointAt"
         FROM public.mastermind_context_tasks_v1
         WHERE project_id = $1::text AND household_id = $3::text AND actor_player_id = $4::uuid
         ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
                  updated_at DESC, task_id ASC
         LIMIT $2::integer`,
        [project, limit, householdId, actorPlayerId],
      ));
      const taskIds = tasks.map((task) => task.taskId);
      let checkpoints = [];
      if (taskIds.length > 0) {
        checkpoints = asRows(await this.sql.query(
          `SELECT DISTINCT ON (task_id) task_id::text AS "taskId", checkpoint_id::text AS "checkpointId",
                  sequence::text, state, summary, completed_items AS "completedItems", open_items AS "openItems",
                  blockers, created_at AS "createdAt"
           FROM public.mastermind_context_checkpoints_v1 checkpoints
           WHERE task_id = ANY($1::uuid[])
           ORDER BY task_id, checkpoints.sequence DESC`,
          [taskIds],
        ));
      }
      const latestByTask = new Map(checkpoints.map((checkpoint) => [checkpoint.taskId, checkpoint]));
      return { migrationRequired: false, tasks: tasks.map((task) => ({ ...task, checkpoint: latestByTask.get(task.taskId) ?? null })) };
    } catch (error) {
      if (missingRelation(error)) return { migrationRequired: true, tasks: [] };
      throw error;
    }
  }

  async taskById(taskId, project, householdId, actorPlayerId) {
    const rows = asRows(await this.sql.query(
      `SELECT t.task_id::text AS "taskId", t.project_id AS project, t.intent, t.state,
              t.revision::text, t.updated_at AS "updatedAt",
              to_jsonb(t)->'permission_scope' AS "permissionScope",
              COALESCE(to_jsonb(t)->>'permission_revision', '0') AS "permissionRevision",
              to_jsonb(t)->>'permission_scope_sha256' AS "permissionScopeSha256",
              c.checkpoint_id::text AS "checkpointId", c.summary AS "checkpointSummary",
              c.state AS "checkpointState", c.created_at AS "checkpointCreatedAt",
              COALESCE(c.completed_items, '[]'::jsonb) AS "completedItems",
              COALESCE(c.open_items, '[]'::jsonb) AS "openItems", COALESCE(c.blockers, '[]'::jsonb) AS blockers
       FROM public.mastermind_context_tasks_v1 t
       LEFT JOIN LATERAL (
         SELECT checkpoint_id, summary, state, created_at, completed_items, open_items, blockers
         FROM public.mastermind_context_checkpoints_v1
         WHERE task_id=t.task_id ORDER BY sequence DESC LIMIT 1
       ) c ON true
       WHERE t.task_id=$1::uuid AND t.project_id=$2::text
         AND t.household_id=$3::text AND t.actor_player_id=$4::uuid LIMIT 1`,
      [taskId, project, householdId, actorPlayerId],
    ));
    return rows[0] ?? null;
  }

  async setTaskPermissions(input) {
    const commandDigest = crypto.createHash('sha256').update(canonicalJson(input)).digest('hex');
    try {
      const rows = asRows(await this.sql.query(`SELECT result_status AS status,
        result_task_id::text AS "taskId", result_checkpoint_id::text AS "checkpointId",
        result_revision::text AS revision, result_permission_revision::text AS "permissionRevision",
        result_current_permission_revision::text AS "currentPermissionRevision", result_scope_sha256 AS "scopeSha256"
        FROM public.set_mastermind_context_task_permissions_v1(
          $1::uuid,$2::text,$3::uuid,$4::text,$5::uuid,$6::text,$7::bigint,$8::bigint,$9::text,$10::text)`,
      [input.checkpointId, commandDigest, input.taskId, input.householdId, input.actorPlayerId, input.project,
        input.expectedRevision, input.expectedPermissionRevision, input.scopeCanonical, input.scopeSha256]));
      if (rows.length !== 1) throw new Error('Invalid permission receipt.');
      if (rows[0].status === 'conflict') throw new ContextGatewayError('PERMISSION_COMMAND_CONFLICT', 'The permission checkpoint ID is bound to another command.', 409);
      return { ...rows[0], grantRef: permissionGrantRef(rows[0].taskId, rows[0].permissionRevision, rows[0].scopeSha256) };
    } catch (error) {
      if (missingRelation(error)) throw new ContextGatewayError('TASK_PERMISSIONS_UNAVAILABLE', 'The reviewed task permission migration must be installed first.', 503);
      if (error?.code === '42501') throw new ContextGatewayError('MEMORY_ACCESS_DENIED', 'This operator cannot change that task permission scope.', 403);
      if (error?.code === '40001') throw new ContextGatewayError('TASK_REVISION_CONFLICT', 'Read the current task and permission revision before reconciling this command.', 409);
      if (error?.code === '22023') throw new ContextGatewayError('INVALID_PERMISSION_SCOPE', 'The permission command failed canonical validation.');
      throw error;
    }
  }

  async appendCheckpoint(input) {
    const digest = crypto.createHash('sha256').update(JSON.stringify({
      checkpointId: input.checkpointId,
      taskId: input.taskId,
      householdId: input.householdId,
      actorPlayerId: input.actorPlayerId,
      project: input.project,
      intent: input.intent,
      summary: input.summary,
      state: input.state,
      completedItems: input.completedItems,
      openItems: input.openItems,
      blockers: input.blockers,
      ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
    })).digest('hex');
    const revisionChecked = input.expectedRevision !== undefined;
    try {
      const rows = asRows(await this.sql.query(
        `SELECT result_status AS status, result_task_id::text AS "taskId",
                result_checkpoint_id::text AS "checkpointId",
                result_sequence::text AS sequence, result_revision::text AS revision
         FROM public.${revisionChecked ? 'append_mastermind_context_checkpoint_v2' : 'append_mastermind_context_checkpoint_v1'}(
           $1::uuid, $2::text, $3::uuid, $4::text, $5::uuid,
           $6::text, $7::text, $8::text, $9::text, $10::jsonb, $11::jsonb, $12::jsonb${revisionChecked ? ', $13::bigint' : ''}
         )`,
        [
          input.checkpointId, digest, input.taskId, input.householdId, input.actorPlayerId,
          input.project, input.intent, input.summary, input.state,
          JSON.stringify(input.completedItems), JSON.stringify(input.openItems), JSON.stringify(input.blockers),
          ...(revisionChecked ? [input.expectedRevision] : []),
        ],
      ));
      if (rows.length !== 1) throw new Error('The checkpoint store returned an invalid result.');
      if (rows[0].status === 'conflict') {
        throw new ContextGatewayError('CHECKPOINT_CONFLICT', 'The checkpoint ID is already bound to different content.', 409);
      }
      return rows[0];
    } catch (error) {
      if (missingRelation(error)) {
        if (revisionChecked) throw new ContextGatewayError('CHECKPOINT_REVISION_UNAVAILABLE', 'The reviewed owner/replay migration is required for revision-checked checkpoints.', 503);
        throw new ContextGatewayError('MIGRATION_REQUIRED', 'Memory migration 007 must be applied before checkpoints can be written.', 503);
      }
      if (error?.code === '22023' && /context task identity is immutable/.test(String(error.message))) {
        throw new ContextGatewayError('TASK_IDENTITY_CONFLICT', 'The task belongs to a different operator, project, or immutable intent. Read the owned task before retrying.', 409);
      }
      if (error?.code === '42501') {
        throw new ContextGatewayError('MEMORY_ACCESS_DENIED', 'The checkpoint operator is not authorized.', 403);
      }
      if (error?.code === '40001') {
        throw new ContextGatewayError('TASK_REVISION_CONFLICT', 'The task changed after this checkpoint was prepared. Read and reconcile the latest owned task before preparing a new checkpoint.', 409);
      }
      throw error;
    }
  }

  async projectionData(project, memoryLimit = 200, taskLimit = 100, identity) {
    taskOwner(identity);
    const memories = asRows(await this.sql.query(
      `SELECT ${MEMORY_COLUMNS}
       FROM public.harmonic_memories
       WHERE lower(project) = lower($1::text)
         AND COALESCE(memory_status, 'active') = 'active'
       ORDER BY priority DESC NULLS LAST, updated_at DESC NULLS LAST, id ASC
       LIMIT $2::integer`,
      [project, memoryLimit],
    ));
    const state = await this.projectState(project, taskLimit, identity);
    return { memories, tasks: state.tasks, migrationRequired: state.migrationRequired };
  }

  async status() {
    const [row] = asRows(await this.sql.query(
      `SELECT
         (SELECT count(*)::text FROM public.harmonic_memories) AS "harmonicMemories",
         (SELECT count(*)::text FROM public.transcript_archive) AS "archiveChunks",
         (SELECT count(DISTINCT doc_id)::text FROM public.transcript_archive) AS "archiveDocuments",
         (SELECT count(*)::text FROM public.fractal_nodes) AS "fractalNodes",
         to_regclass('public.mastermind_context_tasks_v1') IS NOT NULL AS "contextTasksReady"`,
      [],
    ));
    return row;
  }
}
