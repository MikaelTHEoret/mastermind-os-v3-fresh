// Read-only readiness checks. This module never creates tables, binds identities, or imports legacy tasks.
export const CANONICAL_COLUMNS = Object.freeze({
  harmonic_memories: ['id', 'memory_status', 'canonical_key', 'superseded_by_memory_id', 'supersedes_memory_ids', 'valid_from', 'valid_to', 'row_version'],
  mastermind_context_tasks_v1: ['task_id', 'household_id', 'actor_player_id', 'project_id', 'intent', 'state', 'revision'],
  mastermind_context_checkpoints_v1: ['checkpoint_id', 'checkpoint_digest', 'task_id', 'sequence', 'summary'],
  mastermind_player_external_identities_v1: ['household_id', 'player_id', 'provider', 'provider_subject'],
});

export async function inspectCanonicalSchema(sql) {
  const rows = await sql.query(`SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
  [[...Object.keys(CANONICAL_COLUMNS), 'mastermind_tasks', 'mastermind_task_checkpoints']]);
  if (!Array.isArray(rows)) throw new TypeError('Invalid schema inspection result.');
  const columns = new Map();
  for (const row of rows) {
    if (!columns.has(row.tableName)) columns.set(row.tableName, new Set());
    columns.get(row.tableName).add(row.columnName);
  }
  const missing = Object.entries(CANONICAL_COLUMNS).flatMap(([table, required]) =>
    required.filter((column) => !columns.get(table)?.has(column)).map((column) => `${table}.${column}`));
  return { readOnly: true, ready: missing.length === 0, missing,
    canonicalTaskStore: 'mastermind_context_tasks_v1',
    legacyTaskTablesPresent: ['mastermind_tasks', 'mastermind_task_checkpoints'].filter((name) => columns.has(name)),
    migrationApplied: false,
    nextStep: missing.length ? 'Review missing canonical schema before enabling this adapter.' : 'Verify the exact existing Clerk-to-operator binding before hosted private reads.',
  };
}
