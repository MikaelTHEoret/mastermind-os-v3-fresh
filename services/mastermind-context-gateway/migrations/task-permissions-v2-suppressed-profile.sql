-- Compatible suppressed CLI profile extension. PREPARED ONLY; never applied at startup.
-- Requires the exact accepted v2 validator. Use its guarded apply/rollback renderer.
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
      OR jsonb_typeof(v_entry->'runtime'->'cliProfile') IS DISTINCT FROM 'string'
      OR NOT (v_entry->'runtime'->>'cliProfile' = 'codex-approve-for-me-workspace-write-v1'
        OR (v_entry->'runtime'->>'cliProfile' = 'codex-approve-for-me-workspace-write-suppressed-v2'
          AND v_entry->'runtime'->>'codexSha256' = 'dacb96688b155e20dbbbc0bfd18bba7ce7920f1b239ab08a1627917f23b8d9cd'))
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
COMMIT;
