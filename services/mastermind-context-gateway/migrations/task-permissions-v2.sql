-- Authoritative v2 permission source. PREPARED ONLY; no startup applies this.
-- Requires task-permissions-v1.sql and its owner/checkpoint prerequisites.
-- No new table or column. The v1 function and historical scope bytes stay intact.
BEGIN;
CREATE OR REPLACE FUNCTION public.validate_mastermind_coding_sources_v2(p_scope jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE
  v_entry jsonb; v_item jsonb; v_other jsonb; v_field text; v_limit record;
  v_root text; v_roots text[]; v_paths text[]; v_key text;
BEGIN
  IF jsonb_typeof(p_scope->'codingSources') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_scope->'codingSources')>8 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid coding source count';
  END IF;
  IF (SELECT count(*)<>count(DISTINCT value->>'operationId') FROM jsonb_array_elements(p_scope->'codingSources')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ambiguous coding operation';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_scope->'codingSources') LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
      OR v_entry - ARRAY['operationId','specificationId','requestSha256','reviewContentSha256','sourceManifestSha256',
        'moduleId','repositoryRoot','baseCommit','allowedTargets','immutableSources','requirementsHash','testSpecHash',
        'taskBinding','hostProfile','runtime','executionPolicy','limits'] <> '{}'::jsonb
      OR (SELECT count(*) FROM jsonb_object_keys(v_entry))<>17
      OR COALESCE(v_entry->>'operationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      OR jsonb_typeof(v_entry->'moduleId') IS DISTINCT FROM 'string'
      OR COALESCE(v_entry->>'moduleId','') !~ '^[a-z][a-z0-9_.-]{1,127}$'
      OR jsonb_typeof(v_entry->'baseCommit') IS DISTINCT FROM 'string'
      OR COALESCE(v_entry->>'baseCommit','') !~ '^([a-f0-9]{40}|[a-f0-9]{64})$'
      OR v_entry->'executionPolicy' IS DISTINCT FROM '{"action":"coding.source-work","codingAgent":true,"delivery":"private-local-branch-no-push","sandbox":"workspace-write","approval":"approve-for-me","targetEnforcement":"post-execution-acceptance","activate":false,"push":false,"deploy":false}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid exact coding source entry';
    END IF;
    FOREACH v_field IN ARRAY ARRAY['specificationId','requestSha256','reviewContentSha256','sourceManifestSha256','requirementsHash','testSpecHash'] LOOP
      IF jsonb_typeof(v_entry->v_field) IS DISTINCT FROM 'string' OR (v_entry->>v_field) !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid coding content digest';
      END IF;
    END LOOP;
    IF jsonb_typeof(v_entry->'hostProfile') IS DISTINCT FROM 'object'
      OR (v_entry->'hostProfile') - ARRAY['profileId','profileSha256','accountEvidenceSha256'] <> '{}'::jsonb
      OR jsonb_typeof(v_entry->'hostProfile'->'profileId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_entry->'hostProfile'->'profileSha256') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_entry->'hostProfile'->'accountEvidenceSha256') IS DISTINCT FROM 'string'
      OR COALESCE(v_entry->'hostProfile'->>'profileId','') !~ '^[a-z][a-z0-9_.-]{1,127}$'
      OR COALESCE(v_entry->'hostProfile'->>'profileSha256','') !~ '^[a-f0-9]{64}$'
      OR COALESCE(v_entry->'hostProfile'->>'accountEvidenceSha256','') !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(v_entry->'runtime') IS DISTINCT FROM 'object'
      OR (v_entry->'runtime') - ARRAY['codexSha256','cliProfile','worktreeRoot','artifactRoot'] <> '{}'::jsonb
      OR jsonb_typeof(v_entry->'runtime'->'codexSha256') IS DISTINCT FROM 'string'
      OR COALESCE(v_entry->'runtime'->>'codexSha256','') !~ '^[a-f0-9]{64}$'
      OR v_entry->'runtime'->>'cliProfile' IS DISTINCT FROM 'codex-approve-for-me-workspace-write-v1'
      OR jsonb_typeof(v_entry->'taskBinding') IS DISTINCT FROM 'object'
      OR (v_entry->'taskBinding') - ARRAY['checkpointId','revision'] <> '{}'::jsonb
      OR COALESCE(v_entry->'taskBinding'->>'checkpointId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      OR jsonb_typeof(v_entry->'taskBinding'->'revision') IS DISTINCT FROM 'string'
      OR COALESCE(v_entry->'taskBinding'->>'revision','') !~ '^[1-9][0-9]{0,15}$' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid coding task or host profile binding';
    END IF;
    IF (v_entry->'taskBinding'->>'revision')::numeric>9007199254740991 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='coding revision exceeds interoperable bound';
    END IF;
    v_roots:=ARRAY[v_entry->>'repositoryRoot',v_entry->'runtime'->>'worktreeRoot',v_entry->'runtime'->>'artifactRoot'];
    FOREACH v_root IN ARRAY v_roots LOOP
      IF v_root IS NULL OR length(v_root) NOT BETWEEN 4 AND 2048 OR v_root !~ '^[A-Z]:/'
        OR v_root ~ '[<>"|?*[:cntrl:]\\]' OR strpos(substr(v_root,3),':')>0
        OR right(v_root,1)='/' OR EXISTS(SELECT 1 FROM unnest(string_to_array(substr(v_root,4),'/')) s
          WHERE s IN ('','.','..') OR s ~ '[. ]$') THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid coding runtime root';
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM unnest(v_roots) WITH ORDINALITY a(path,i),unnest(v_roots) WITH ORDINALITY b(path,i)
      WHERE a.i<>b.i AND (lower(a.path)=lower(b.path) OR left(lower(a.path),length(b.path)+1)=lower(b.path)||'/')) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='overlapping coding roots';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_scope->'modules') m
      WHERE m->>'moduleId'=v_entry->>'moduleId' AND lower(m->>'repositoryRoot')=lower(v_entry->>'repositoryRoot')) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='coding source outside retained module scope';
    END IF;
    IF jsonb_typeof(v_entry->'limits') IS DISTINCT FROM 'object'
      OR (v_entry->'limits') - ARRAY['wall_seconds','stdout_bytes','stderr_bytes','memory_bytes','active_processes','max_files','max_file_bytes','max_inventory_bytes','diff_bytes'] <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid coding resource fields';
    END IF;
    FOR v_limit IN SELECT * FROM (VALUES ('wall_seconds',1::numeric,300::numeric),('stdout_bytes',1024,2097152),
      ('stderr_bytes',1024,262144),('memory_bytes',268435456,2147483648),('active_processes',2,32),
      ('max_files',1,4096),('max_file_bytes',1,8388608),('max_inventory_bytes',1,67108864),('diff_bytes',1024,2097152)) x(key,minimum,maximum) LOOP
      IF jsonb_typeof(v_entry->'limits'->v_limit.key) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='coding resource value must be integer';
      END IF;
      IF (v_entry->'limits'->>v_limit.key)::numeric NOT BETWEEN v_limit.minimum AND v_limit.maximum
        OR trunc((v_entry->'limits'->>v_limit.key)::numeric)<>(v_entry->'limits'->>v_limit.key)::numeric THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='coding resource policy exceeded';
      END IF;
    END LOOP;
    IF jsonb_typeof(v_entry->'allowedTargets') IS DISTINCT FROM 'array' OR jsonb_array_length(v_entry->'allowedTargets')<>1
      OR jsonb_typeof(v_entry->'immutableSources') IS DISTINCT FROM 'array' OR jsonb_array_length(v_entry->'immutableSources') NOT BETWEEN 2 AND 32 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='single Python source and immutable cases required';
    END IF;
    v_item:=v_entry->'allowedTargets'->0;
    IF v_item - ARRAY['path','kind'] <> '{}'::jsonb OR v_item->>'kind' IS DISTINCT FROM 'file' OR right(COALESCE(v_item->>'path',''),3)<>'.py' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unsupported coding target';
    END IF;
    v_paths:=ARRAY[]::text[];
    FOR v_item IN SELECT value FROM jsonb_array_elements((v_entry->'allowedTargets')||(v_entry->'immutableSources')) LOOP
      v_key:=v_item->>'path';
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR jsonb_typeof(v_item->'path') IS DISTINCT FROM 'string'
        OR length(v_key) NOT BETWEEN 1 AND 512 OR left(v_key,1)='/' OR v_key ~ '[<>:"|?*[:cntrl:]\\]'
        OR cardinality(string_to_array(v_key,'/'))>16 OR v_key IN ('','.','..')
        OR EXISTS(SELECT 1 FROM unnest(string_to_array(v_key,'/')) s WHERE s IN ('','.','..') OR s ~ '[. ]$'
          OR s ~* '^(\.git|\.codex|\.env|agents\.md$|(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$))')
        OR lower(v_key)=ANY(v_paths) THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid or ambiguous coding source path';
      END IF;
      IF EXISTS(SELECT 1 FROM unnest(v_paths) p WHERE left(lower(v_key),length(p)+1)=p||'/' OR left(p,length(v_key)+1)=lower(v_key)||'/') THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='coding file path ancestor conflict';
      END IF;
      v_paths:=array_append(v_paths,lower(v_key));
    END LOOP;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_entry->'immutableSources') LOOP
      IF v_item - ARRAY['role','path','sha256'] <> '{}'::jsonb OR COALESCE(v_item->>'role','') NOT IN ('requirements','tests','reference')
        OR jsonb_typeof(v_item->'sha256') IS DISTINCT FROM 'string' OR COALESCE(v_item->>'sha256','') !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid immutable source descriptor';
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM jsonb_array_elements(v_entry->'immutableSources') x WHERE x->>'role'='requirements')<>1
      OR (SELECT count(*) FROM jsonb_array_elements(v_entry->'immutableSources') x WHERE x->>'role'='tests')<>1 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='distinct immutable requirements and cases required';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_mastermind_context_task_permissions_v2(
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
  v_summary text; v_note text; v_root text;
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
    OR v_scope->'schemaVersion' IS DISTINCT FROM '2'::jsonb
    OR COALESCE(v_scope->>'status','') NOT IN ('active','revoked')
    OR v_scope->'executionPolicy' IS DISTINCT FROM '{"isolationProfile":"windows-lpac-pure-json-v1","effectClass":"READ_ONLY","network":false,"childProcesses":false,"filesystem":"staged-inputs-only","codingAgent":false}'::jsonb
    OR jsonb_typeof(v_scope->'modules') IS DISTINCT FROM 'array'
    OR v_scope - ARRAY['schemaVersion','status','executionPolicy','modules','codingSources'] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid task permission scope';
  END IF;
  IF jsonb_array_length(v_scope->'modules') > 16
    OR (v_scope->>'status'='active' AND jsonb_array_length(v_scope->'modules')=0) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid module permission count';
  END IF;
  IF (SELECT count(*)<>count(DISTINCT value->>'moduleId') FROM jsonb_array_elements(v_scope->'modules')) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='ambiguous module identity';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_scope->'modules') LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_entry->'moduleId') IS DISTINCT FROM 'string'
      OR COALESCE(v_entry->>'moduleId','') !~ '^[a-z][a-z0-9_.-]{1,127}$'
      OR jsonb_typeof(v_entry->'repositoryRoot') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_entry->'candidateRoot') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_entry->'operations') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_entry->'capabilities') IS DISTINCT FROM 'array'
      OR v_entry - ARRAY['moduleId','repositoryRoot','candidateRoot','operations','capabilities'] <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid exact module scope';
    END IF;
    FOREACH v_root IN ARRAY ARRAY[v_entry->>'repositoryRoot',v_entry->>'candidateRoot'] LOOP
      IF length(v_root) NOT BETWEEN 4 AND 2048 OR v_root !~ '^[A-Z]:/'
        OR v_root ~ '[<>"|?*[:cntrl:]\\]' OR strpos(substr(v_root,3),':')>0
        OR right(v_root,1)='/' OR EXISTS(SELECT 1 FROM unnest(string_to_array(substr(v_root,4),'/')) s
          WHERE s IN ('','.','..') OR s ~ '[. ]$') THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid module root segments';
      END IF;
    END LOOP;
    IF jsonb_array_length(v_entry->'operations') NOT BETWEEN 1 AND 6
      OR jsonb_array_length(v_entry->'capabilities') NOT BETWEEN 1 AND 64 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid module capability count';
    END IF;
    IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(v_entry->'operations'))
      OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(v_entry->'capabilities')) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ambiguous module operation or capability';
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

  PERFORM public.validate_mastermind_coding_sources_v2(v_scope);
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
  -- Historical operation IDs cannot be rebound, even after removal from the current scope.
  -- New entries bind this command's resulting checkpoint; retained exact entries may stay historical.
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_scope->'codingSources') LOOP
    IF EXISTS(SELECT 1 FROM public.mastermind_context_checkpoints_v1 cp
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN cp.permission_scope->'schemaVersion'='2'::jsonb
        THEN cp.permission_scope->'codingSources' ELSE '[]'::jsonb END) prior
      WHERE cp.task_id=p_task_id AND prior->>'operationId'=v_entry->>'operationId' AND prior<>v_entry) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='coding operation already bound to another source scope';
    END IF;
    IF (v_entry->'taskBinding'->>'checkpointId'<>p_checkpoint_id::text
       OR v_entry->'taskBinding'->>'revision'<>(p_expected_revision+1)::text)
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN v_task.permission_scope->'schemaVersion'='2'::jsonb
         THEN v_task.permission_scope->'codingSources' ELSE '[]'::jsonb END) prior WHERE prior=v_entry) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='new coding scope must bind resulting permission checkpoint';
    END IF;
  END LOOP;
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
