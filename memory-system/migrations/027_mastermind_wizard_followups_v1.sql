BEGIN;
-- Additive Wizard detail/revision readers; preserve all existing jobs and receipts.
-- Preparation grants no module execution. Existing task ownership and an active
-- permission scope are required independently at the hosted and local brokers.
CREATE OR REPLACE FUNCTION public.mastermind_specification_input_valid_v1(p_input jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>4096
 OR NOT (p_input ?& ARRAY['schemaVersion','action','taskRef','operationId','request','recipeId'])
 OR p_input-ARRAY['schemaVersion','action','taskRef','operationId','request','recipeId','revisionOf']<>'{}'::jsonb
 OR p_input->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR p_input->>'action' IS DISTINCT FROM 'prepare'
 OR jsonb_typeof(p_input->'operationId') IS DISTINCT FROM 'string'
 OR COALESCE(p_input->>'operationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR jsonb_typeof(p_input->'request') IS DISTINCT FROM 'string'
 OR length(p_input->>'request') NOT BETWEEN 1 AND 4000
 OR p_input->>'request' ~ E'[\\x01-\\x08\\x0b-\\x1f]'
 OR p_input->>'request' ~ '^[[:space:]]|[[:space:]]$'
 OR (p_input->'recipeId'<>'null'::jsonb AND (jsonb_typeof(p_input->'recipeId') IS DISTINCT FROM 'string'
   OR COALESCE(p_input->>'recipeId','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$'))
 OR NOT public.mastermind_catalog_input_valid_v1(jsonb_build_object('schemaVersion',1,'taskRef',p_input->'taskRef','snapshotId',NULL,'cursor',NULL))
 OR p_input->'taskRef'->>'taskId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR (p_input->'taskRef' ? 'checkpointId' AND p_input->'taskRef'->>'checkpointId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
 THEN RETURN false; END IF;
 IF p_input ? 'revisionOf' THEN
  IF jsonb_typeof(p_input->'revisionOf') IS DISTINCT FROM 'object'
   OR NOT (p_input->'revisionOf' ?& ARRAY['operationId','requestHash'])
   OR (p_input->'revisionOf')-ARRAY['operationId','requestHash']<>'{}'::jsonb
   OR jsonb_typeof(p_input->'revisionOf'->'operationId') IS DISTINCT FROM 'string'
   OR COALESCE(p_input->'revisionOf'->>'operationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR p_input->'revisionOf'->>'operationId'=p_input->>'operationId'
   OR jsonb_typeof(p_input->'revisionOf'->'requestHash') IS DISTINCT FROM 'string'
   OR COALESCE(p_input->'revisionOf'->>'requestHash','') !~ '^[a-f0-9]{64}$'
  THEN RETURN false; END IF;
 END IF;
 RETURN true;
END;
$$;

-- Canonical JSON for this fixed, validated shape. Preserve spaces/Unicode inside
-- strings; removing whitespace from jsonb::text would corrupt request bindings.
CREATE OR REPLACE FUNCTION public.mastermind_specification_hash_v1(p_input jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE task_text text; parent_text text; binding_text text;
BEGIN
 IF NOT public.mastermind_specification_input_valid_v1(p_input) THEN RETURN NULL; END IF;
 SELECT '{'||string_agg(to_jsonb(key)::text||':'||value::text,',' ORDER BY key COLLATE "C")||'}'
 INTO task_text FROM jsonb_each(p_input->'taskRef');
 SELECT '{'||string_agg(to_jsonb(key)::text||':'||value::text,',' ORDER BY key COLLATE "C")||'}'
 INTO parent_text FROM jsonb_each(COALESCE(p_input->'revisionOf','{}'::jsonb));
 SELECT '{'||string_agg(to_jsonb(key)::text||':'||CASE WHEN key='taskRef' THEN task_text WHEN key='revisionOf' THEN parent_text ELSE value::text END,',' ORDER BY key COLLATE "C")||'}'
 INTO binding_text FROM jsonb_each(p_input-'action');
 RETURN encode(sha256(convert_to(binding_text,'UTF8')),'hex');
END;
$$;

CREATE OR REPLACE FUNCTION public.mastermind_specification_authorized_v1(p_household text,p_actor uuid,p_input jsonb,p_result jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE s jsonb; item jsonb;
BEGIN
 IF NOT public.mastermind_specification_input_valid_v1(p_input) THEN RETURN false; END IF;
 IF p_result IS NOT NULL THEN
  s:=p_result->'specification';
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>2048
  OR NOT (p_result ?& ARRAY['kind','ok','schemaVersion','taskRef','operationId','requestHash','specification','savedAt','replayed','executionAuthorized'])
  OR p_result-ARRAY['kind','ok','schemaVersion','taskRef','operationId','requestHash','specification','savedAt','replayed','executionAuthorized']<>'{}'::jsonb
  OR p_result->>'kind' IS DISTINCT FROM 'mastermind.native.specification'
  OR p_result->'ok' IS DISTINCT FROM 'true'::jsonb OR p_result->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR p_result->'executionAuthorized' IS DISTINCT FROM 'false'::jsonb
  OR p_result->'taskRef' IS DISTINCT FROM p_input->'taskRef'
  OR p_result->'operationId' IS DISTINCT FROM p_input->'operationId'
  OR p_result->>'requestHash' IS DISTINCT FROM public.mastermind_specification_hash_v1(p_input)
  OR jsonb_typeof(p_result->'replayed') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p_result->'savedAt') IS DISTINCT FROM 'string'
  OR COALESCE(p_result->>'savedAt','') !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$'
  OR jsonb_typeof(s) IS DISTINCT FROM 'object'
  OR NOT (s ?& ARRAY['specificationId','title','decision','stage','requirementsHash','missingCount'])
  OR s-ARRAY['specificationId','title','decision','stage','requirementsHash','missingCount','missing']<>'{}'::jsonb
  OR COALESCE(s->>'specificationId','') !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(s->'title') IS DISTINCT FROM 'string' OR length(s->>'title') NOT BETWEEN 1 AND 80
  OR COALESCE(s->>'decision','') NOT IN ('reuse','extend','assimilate','create','inspect_existing')
  OR COALESCE(s->>'stage','') NOT IN ('needs_specification','specified','reuse_available')
  OR jsonb_typeof(s->'missingCount') IS DISTINCT FROM 'number' OR COALESCE(s->>'missingCount','') !~ '^(0|[1-9][0-9]?|100)$'
  THEN RETURN false; END IF;
  IF s ? 'missing' THEN
   IF jsonb_typeof(s->'missing') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
   IF jsonb_array_length(s->'missing')<>(s->>'missingCount')::integer
     OR jsonb_array_length(s->'missing')>8 THEN RETURN false; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(s->'missing') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR length(item#>>'{}') NOT BETWEEN 1 AND 160
      OR item#>>'{}' ~ E'[\\x01-\\x1f]' OR item#>>'{}' ~ '^[[:space:]]|[[:space:]]$'
    THEN RETURN false; END IF;
   END LOOP;
  END IF;
  PERFORM (p_result->>'savedAt')::timestamptz;
  IF s->>'stage'='needs_specification' THEN
   IF s->'requirementsHash'<>'null'::jsonb OR (s->>'missingCount')::integer=0 THEN RETURN false; END IF;
  ELSIF COALESCE(s->>'requirementsHash','') !~ '^[a-f0-9]{64}$' OR (s->>'missingCount')::integer<>0 THEN RETURN false;
  END IF;
  IF s->>'stage'='reuse_available' AND s->>'decision'<>'reuse' THEN RETURN false; END IF;
 END IF;
 IF p_input ? 'revisionOf' AND NOT EXISTS (
  SELECT 1 FROM public.mastermind_node_jobs_v1 parent
  WHERE parent.job_id=(p_input->'revisionOf'->>'operationId')::uuid
   AND parent.household_id=p_household AND parent.created_by_player_id=p_actor
   AND parent.capability='mastermind.native.specification' AND parent.state='succeeded'
   AND parent.command_input->'taskRef'=p_input->'taskRef'
   AND parent.terminal_result->>'requestHash'=p_input->'revisionOf'->>'requestHash'
   AND public.mastermind_specification_hash_v1(parent.command_input)=p_input->'revisionOf'->>'requestHash'
 ) THEN RETURN false; END IF;
 RETURN public.verify_mastermind_memory_operator_v1(p_household,p_actor) AND EXISTS(
 SELECT 1 FROM public.mastermind_context_tasks_v1 t
 WHERE t.task_id=(p_input->'taskRef'->>'taskId')::uuid AND t.project_id=p_input->'taskRef'->>'project'
 AND t.household_id=p_household AND t.actor_player_id=p_actor AND t.state='active'
 AND t.permission_scope->'schemaVersion' IN ('1'::jsonb,'2'::jsonb) AND t.permission_scope->>'status'='active'
 AND (NOT (p_input->'taskRef' ? 'checkpointId') OR EXISTS(SELECT 1 FROM public.mastermind_context_checkpoints_v1 c
   WHERE c.task_id=t.task_id AND c.checkpoint_id=(p_input->'taskRef'->>'checkpointId')::uuid)));
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END;
$$;

COMMIT;
