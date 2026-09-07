/** Read-only admission for the historical001-018 bootstrap runner. */
export async function assertLegacyBootstrapTarget(sql) {
  const rows = await sql`
    SELECT
      to_regprocedure('public.append_mastermind_context_checkpoint_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint)') IS NOT NULL AS owner_replay,
      to_regprocedure('public.set_mastermind_context_task_permissions_v1(uuid,text,uuid,text,uuid,text,bigint,bigint,text,text)') IS NOT NULL AS task_permissions,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name IN ('mastermind_context_tasks_v1','mastermind_context_checkpoints_v1')
        AND column_name IN ('permission_scope','permission_revision','permission_scope_sha256')) AS permission_columns,
      to_regprocedure('public.mastermind_node_worker_valid_v2(jsonb)') IS NOT NULL
        OR to_regprocedure('public.exchange_mastermind_node_v2(uuid,text,uuid,text,uuid,timestamp with time zone,text,jsonb,jsonb,text[],uuid,jsonb)') IS NOT NULL AS negotiated_nodes,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='mastermind_nodes_v1' AND column_name='last_worker') AS worker_column
  `;
  const keys = ['owner_replay', 'task_permissions', 'permission_columns', 'negotiated_nodes', 'worker_column'];
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]
    || keys.some((key) => typeof rows[0][key] !== 'boolean')) {
    throw Object.assign(new Error('Canonical migration compatibility could not be verified; no bootstrap writes are allowed.'), {
      code: 'MEMORY_MIGRATION_TARGET_UNVERIFIED',
    });
  }
  if (keys.some((key) => rows[0][key])) {
    throw Object.assign(new Error('Newer canonical contracts are installed. Use services/mastermind-context-gateway/scripts/run-canonical-schema.mjs with an explicit scope and reviewed manifest; the legacy bootstrap cannot replace them.'), {
      code: 'MEMORY_MIGRATION_SCOPED_OWNER_REQUIRED',
    });
  }
}
