BEGIN;
-- PREPARED ONLY. Requires the reviewed owner-replay-v1.sql; no startup applies this.
-- Extend the existing canonical task/checkpoint aggregate, never a parallel grant store.
ALTER TABLE public.mastermind_context_tasks_v1
  ADD COLUMN IF NOT EXISTS permission_scope jsonb,
  ADD COLUMN IF NOT EXISTS permission_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS permission_scope_sha256 text;
ALTER TABLE public.mastermind_context_checkpoints_v1
  ADD COLUMN IF NOT EXISTS permission_scope jsonb,
  ADD COLUMN IF NOT EXISTS permission_revision bigint,
  ADD COLUMN IF NOT EXISTS permission_scope_sha256 text;

CREATE OR REPLACE FUNCTION public.set_mastermind_context_task_permissions_v1(
  p_checkpoint_id uuid, p_command_digest text, p_task_id uuid, p_household_id text,
  p_actor_player_id uuid, p_project_id text, p_expected_revision bigint,
  p_expected_permission_revision bigint, p_scope_canonical text, p_scope_sha256 text
)
RETURNS TABLE(result_status text, result_task_id uuid, result_checkpoint_id uuid,
  result_revision bigint, result_permission_revision bigint,
  result_current_permission_revision bigint, result_scope_sha256 text)
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
DECLARE
  v_task public.mastermind_context_tasks_v1%ROWTYPE;
  v_existing public.mastermind_context_checkpoints_v1%ROWTYPE;
  v_latest public.mastermind_context_checkpoints_v1%ROWTYPE;
  v_scope jsonb; v_entry jsonb; v_item jsonb; v_permission_revision bigint;
  v_summary text; v_note text;
BEGIN
  IF p_checkpoint_id IS NULL OR p_task_id IS NULL OR p_actor_player_id IS NULL
    OR p_household_id IS NULL OR p_project_id IS NULL OR p_command_digest IS NULL
    OR p_command_digest !~ '^[a-f0-9]{64}$' OR p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_expected_permission_revision IS NULL OR p_expected_permission_revision < 0
    OR p_scope_canonical IS NULL OR octet_length(p_scope_canonical) > 32768
    OR p_scope_sha256 IS NULL OR p_scope_sha256 !~ '^[a-f0-9]{64}$'
    OR encode(sha256(convert_to(p_scope_canonical, 'UTF8')), 'hex') <> p_scope_sha256 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid task permission command';
  END IF;
  IF NOT public.verify_mastermind_memory_operator_v1(p_household_id, p_actor_player_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='task permission operator denied';
  END IF;
  v_scope := p_scope_canonical::jsonb;
  IF jsonb_typeof(v_scope) IS DISTINCT FROM 'object'
    OR v_scope->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR COALESCE(v_scope->>'status','') NOT IN ('active','revoked')
    OR v_scope->'executionPolicy' IS DISTINCT FROM '{"isolationProfile":"windows-lpac-pure-json-v1","effectClass":"READ_ONLY","network":false,"childProcesses":false,"filesystem":"staged-inputs-only","codingAgent":false}'::jsonb
    OR jsonb_typeof(v_scope->'modules') IS DISTINCT FROM 'array'
    OR v_scope - ARRAY['schemaVersion','status','executionPolicy','modules'] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid task permission scope';
  END IF;
  IF jsonb_array_length(v_scope->'modules') > 16
    OR (v_scope->>'status'='active' AND jsonb_array_length(v_scope->'modules')=0) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid module permission count';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_scope->'modules') LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
      OR COALESCE(v_entry->>'moduleId','') !~ '^[a-z][a-z0-9_.-]{1,127}$'
      OR COALESCE(v_entry->>'repositoryRoot','') !~ '^[A-Z]:/[^[:cntrl:]]+$'
      OR char_length(v_entry->>'repositoryRoot') NOT BETWEEN 4 AND 2048
      OR COALESCE(v_entry->>'candidateRoot','') !~ '^[A-Z]:/[^[:cntrl:]]+$'
      OR char_length(v_entry->>'candidateRoot') NOT BETWEEN 4 AND 2048
      OR jsonb_typeof(v_entry->'operations') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_entry->'capabilities') IS DISTINCT FROM 'array'
      OR v_entry - ARRAY['moduleId','repositoryRoot','candidateRoot','operations','capabilities'] <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid exact module scope';
    END IF;
    IF jsonb_array_length(v_entry->'operations') NOT BETWEEN 1 AND 6
      OR jsonb_array_length(v_entry->'capabilities') NOT BETWEEN 1 AND 64 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid module capability count';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_entry->'operations') LOOP
      IF jsonb_typeof(v_item) <> 'string' OR (v_item #>> '{}') NOT IN
        ('module.generate','module.reconstruct','module.test','module.promote','module.rollback','module.call') THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='unsupported module operation';
      END IF;
    END LOOP;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_entry->'capabilities') LOOP
      IF jsonb_typeof(v_item) <> 'string' OR (v_item #>> '{}') !~ '^[a-z][a-z0-9_.-]{1,179}$'
        OR left(v_item #>> '{}',length(v_entry->>'moduleId')+1) <> (v_entry->>'moduleId')||'.' THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='capability outside exact module namespace';
      END IF;
    END LOOP;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtextextended('context-checkpoint/'||p_checkpoint_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_task_id::text,0));
  SELECT * INTO v_task FROM public.mastermind_context_tasks_v1 WHERE task_id=p_task_id;
  IF NOT FOUND OR v_task.household_id<>p_household_id OR v_task.actor_player_id<>p_actor_player_id
    OR v_task.project_id<>p_project_id THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='task permission identity denied';
  END IF;
  SELECT * INTO v_existing FROM public.mastermind_context_checkpoints_v1 WHERE checkpoint_id=p_checkpoint_id;
  IF FOUND THEN
    IF v_existing.task_id<>p_task_id THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='permission receipt belongs to another task';
    END IF;
    RETURN QUERY SELECT CASE WHEN v_existing.checkpoint_digest=p_command_digest
        AND v_existing.permission_scope=v_scope AND v_existing.permission_scope_sha256=p_scope_sha256
        THEN 'duplicate' ELSE 'conflict' END,
      p_task_id,p_checkpoint_id,v_task.revision,v_existing.permission_revision,
      v_task.permission_revision,v_existing.permission_scope_sha256;
    RETURN;
  END IF;
  IF v_task.revision<>p_expected_revision OR v_task.permission_revision<>p_expected_permission_revision THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='task or permission revision changed';
  END IF;
  IF v_scope->>'status'='active' AND v_task.state<>'active' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='active task required for a new permission grant';
  END IF;
  SELECT * INTO v_latest FROM public.mastermind_context_checkpoints_v1
    WHERE task_id=p_task_id ORDER BY sequence DESC LIMIT 1;
  v_permission_revision := v_task.permission_revision+1;
  v_note := 'Task permission '||(v_scope->>'status')||'; revision '||v_permission_revision::text||'; scope SHA256 '||p_scope_sha256||'.';
  v_summary := COALESCE(v_latest.summary,'');
  IF length(v_summary)+length(v_note)+3 <= 4096 THEN
    v_summary := CASE WHEN v_summary='' THEN v_note ELSE v_summary||' | '||v_note END;
  END IF;
  -- The existing checkpoint rule intentionally ignores UPDATE. Insert its complete
  -- permission snapshot at creation; never weaken or bypass append-only history.
  INSERT INTO public.mastermind_context_checkpoints_v1 (
    checkpoint_id,checkpoint_digest,task_id,sequence,state,summary,completed_items,open_items,blockers,
    permission_scope,permission_revision,permission_scope_sha256
  ) VALUES (
    p_checkpoint_id,p_command_digest,p_task_id,p_expected_revision+1,v_task.state,v_summary,
    COALESCE(v_latest.completed_items,'[]'::jsonb),COALESCE(v_latest.open_items,'[]'::jsonb),
    COALESCE(v_latest.blockers,'[]'::jsonb),v_scope,v_permission_revision,p_scope_sha256
  );
  UPDATE public.mastermind_context_tasks_v1 SET permission_scope=v_scope,
    permission_revision=v_permission_revision,permission_scope_sha256=p_scope_sha256,
    revision=p_expected_revision+1,updated_at=clock_timestamp(),last_checkpoint_at=clock_timestamp()
    WHERE task_id=p_task_id;
  RETURN QUERY SELECT 'applied'::text,p_task_id,p_checkpoint_id,p_expected_revision+1,
    v_permission_revision,v_permission_revision,p_scope_sha256;
END;
$$;
COMMIT;
