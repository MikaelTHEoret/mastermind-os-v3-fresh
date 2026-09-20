BEGIN;
-- Extend existing ledger; no new task/worker tables, grants or data rewrites.
CREATE OR REPLACE FUNCTION public.mastermind_build_dispatch_input_valid_v1(v jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE keys text[]:=ARRAY['schemaVersion','action','taskRef','operationId','parentOperationId','artifactOperationId','buildOperationId','specificationId','reviewId','planId']; k text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT(v ?& keys) OR v-keys<>'{}'::jsonb
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR octet_length(public.mastermind_review_canonical_v1(v))>2048
 OR COALESCE(v->>'action','') NOT IN ('preflight','start','status','recover')
 OR jsonb_typeof(v->'taskRef') IS DISTINCT FROM 'object' OR (v->'taskRef')-ARRAY['taskId','project']<>'{}'::jsonb
 OR NOT public.mastermind_catalog_input_valid_v1(jsonb_build_object('schemaVersion',1,'taskRef',v->'taskRef','snapshotId',NULL,'cursor',NULL)) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['specificationId','reviewId','planId'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR v->>k !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['operationId','parentOperationId','artifactOperationId','buildOperationId'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR v->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN RETURN false; END IF;
 END LOOP;
 RETURN (SELECT count(DISTINCT v->>key)=4 FROM unnest(ARRAY['operationId','parentOperationId','artifactOperationId','buildOperationId']) key);
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_build_dispatch_result_valid_v1(v jsonb,i jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE keys text[]; k text; item jsonb; observed text;
BEGIN
 IF NOT public.mastermind_build_dispatch_input_valid_v1(i) THEN RETURN false; END IF;
 SELECT array_agg(key) INTO keys FROM jsonb_object_keys(i) key;
 keys:=keys||ARRAY['kind','ok','state','holds','candidateId','sourceReady','replayed','startAccepted','historicalSnapshot','mayAutomaticallyRerun','executionAuthorized','observedAction','recoveryOnly'];
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT(v ?& keys) OR v-keys<>'{}'::jsonb
 OR octet_length(public.mastermind_review_canonical_v1(v))>1450 OR octet_length(jsonb_pretty(v))>3800
 OR v->>'kind' IS DISTINCT FROM 'mastermind.native.review-build-dispatch'
 OR v->'executionAuthorized' IS DISTINCT FROM 'false'::jsonb OR v->'mayAutomaticallyRerun' IS DISTINCT FROM 'false'::jsonb
 OR v->'historicalSnapshot' IS DISTINCT FROM 'true'::jsonb
 OR COALESCE(v->>'state','') NOT IN ('prepared','started','held','awaiting_independent_tests','ready_for_separate_dispatch')
 OR jsonb_typeof(v->'observedAction') IS DISTINCT FROM 'string'
 OR jsonb_typeof(v->'holds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 FOR k IN SELECT jsonb_object_keys(i) LOOP IF v->k IS DISTINCT FROM i->k THEN RETURN false; END IF; END LOOP;
 FOREACH k IN ARRAY ARRAY['ok','sourceReady','replayed','startAccepted','recoveryOnly'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_array_length(v->'holds')>16 OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(v->'holds')) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v->'holds') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR item#>>'{}' !~ '^[A-Z][A-Z0-9_]{1,95}$' THEN RETURN false; END IF;
 END LOOP;
 IF v->'candidateId'<>'null'::jsonb AND (jsonb_typeof(v->'candidateId')<>'string' OR v->>'candidateId' !~ '^[a-f0-9]{64}$') THEN RETURN false; END IF;
 observed:=CASE WHEN v->'recoveryOnly'='true'::jsonb AND i->>'action'='start' THEN 'recover' ELSE i->>'action' END;
 RETURN v->>'observedAction'=observed
 AND (v->'startAccepted'='false'::jsonb OR observed='start' AND v->'ok'='true'::jsonb AND v->'replayed'='false'::jsonb)
 AND (v->'sourceReady'='false'::jsonb OR v->>'state'='awaiting_independent_tests')
 AND (observed<>'preflight' OR v->'startAccepted'='false'::jsonb AND v->'sourceReady'='false'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_build_dispatch_authorized_v1(h text,a uuid,i jsonb,r jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE saved public.mastermind_node_jobs_v1%ROWTYPE; k text;
BEGIN
 IF NOT public.mastermind_build_dispatch_input_valid_v1(i) THEN RETURN false; END IF;
 SELECT * INTO saved FROM public.mastermind_node_jobs_v1 j WHERE j.household_id=h AND j.created_by_player_id=a
 AND j.capability='mastermind.native.review-build-plan' AND j.state='succeeded'
 AND j.command_input->'taskRef'=i->'taskRef' AND j.command_input->'parentOperationId'=i->'parentOperationId'
 AND j.command_input->'artifactOperationId'=i->'artifactOperationId' AND j.command_input->'buildOperationId'=i->'buildOperationId'
 AND j.command_input->'specificationId'=i->'specificationId' AND j.command_input->'reviewId'=i->'reviewId'
 AND j.terminal_result->'planId'=i->'planId'
 AND public.mastermind_development_authorized_v1(j.capability,h,a,j.command_input,j.terminal_result)
 ORDER BY j.created_at DESC LIMIT 1;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Saved preparation is not permission to invoke the coding worker. Current
 -- per-operation coding authority, resource and source fences remain local.
 -- A stale plan may be inspected/recovered, but cannot become a fresh start.
 IF i->>'action'='start' AND (saved.terminal_result->'current' IS DISTINCT FROM 'true'::jsonb
  OR saved.terminal_result->'holds' IS DISTINCT FROM '[]'::jsonb) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.capability='mastermind.native.review-build-dispatch'
  AND j.command_input->'buildOperationId'=i->'buildOperationId'
  AND (j.household_id<>h OR j.created_by_player_id<>a OR j.node_id<>saved.node_id
   OR (j.command_input-ARRAY['action','operationId'])<>(i-ARRAY['action','operationId']))) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=(i->>'operationId')::uuid
  AND (j.household_id<>h OR j.created_by_player_id<>a OR j.node_id<>saved.node_id
   OR j.capability<>'mastermind.native.review-build-dispatch' OR j.command_input<>i)) THEN RETURN false; END IF;
 IF r IS NOT NULL AND public.mastermind_build_dispatch_result_valid_v1(r,i) IS DISTINCT FROM true THEN RETURN false; END IF;
 RETURN true;
END; $$;


-- Existing definitions retained with the additional typed capability.
CREATE OR REPLACE FUNCTION public.mastermind_development_input_valid_v1(cap text,v jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE keys text[]:=ARRAY['schemaVersion','action','taskRef','operationId','parentOperationId','artifactOperationId','specificationId','reviewId']; k text; ids text[];
BEGIN
 IF cap='mastermind.native.review-build-dispatch' THEN RETURN public.mastermind_build_dispatch_input_valid_v1(v); END IF;
 IF cap NOT IN ('mastermind.native.review-artifacts','mastermind.native.review-build-plan') OR cap IS NULL THEN RETURN false; END IF;
 IF cap='mastermind.native.review-build-plan' THEN keys:=keys||ARRAY['buildOperationId']; END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT(v ?& keys) OR v-keys<>'{}'::jsonb
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR octet_length(public.mastermind_review_canonical_v1(v))>2048
 OR jsonb_typeof(v->'taskRef') IS DISTINCT FROM 'object' OR (v->'taskRef')-ARRAY['taskId','project']<>'{}'::jsonb
 OR NOT public.mastermind_catalog_input_valid_v1(jsonb_build_object('schemaVersion',1,'taskRef',v->'taskRef','snapshotId',NULL,'cursor',NULL)) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['specificationId','reviewId'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR COALESCE(v->>k,'') !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 END LOOP;
 ids:=ARRAY['operationId','parentOperationId','artifactOperationId'];
 IF cap='mastermind.native.review-build-plan' THEN ids:=ids||ARRAY['buildOperationId']; END IF;
 FOREACH k IN ARRAY ids LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR COALESCE(v->>k,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN RETURN false; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT v->>key) FROM unnest(ids) key)<>cardinality(ids) THEN RETURN false; END IF;
 RETURN COALESCE(v->>'action','')=ANY(CASE WHEN cap='mastermind.native.review-artifacts' THEN ARRAY['prepare','recover','publish','reconcile','resume'] ELSE ARRAY['prepare','recover'] END);
EXCEPTION WHEN invalid_parameter_value THEN RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_development_result_valid_v1(cap text,v jsonb,i jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE keys text[]; k text; item jsonb; request jsonb; stamp timestamptz;
BEGIN
 IF cap='mastermind.native.review-build-dispatch' THEN RETURN public.mastermind_build_dispatch_result_valid_v1(v,i); END IF;
 IF NOT public.mastermind_development_input_valid_v1(cap,i) THEN RETURN false; END IF;
 SELECT array_agg(key) INTO keys FROM jsonb_object_keys(i) key;
 keys:=keys||ARRAY['kind','replayed','executionAuthorized','requirementsHash','historicalSnapshot','holds'];
 keys:=keys||CASE WHEN cap='mastermind.native.review-artifacts' THEN
 ARRAY['artifactState','bindingSha256','commit','fileCount','testSpecHash','gitVerified','gitVerifiedAt','mayAutomaticallyRerun','candidateAcceptance'] ELSE
 ARRAY['requestHash','planId','state','current','decision','moduleId','jobState','candidateId','hasSourceReceipt','workerInvoked'] END;
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT(v ?& keys) OR v-keys<>'{}'::jsonb
 OR octet_length(public.mastermind_review_canonical_v1(v))>1450 OR octet_length(jsonb_pretty(v))>3800
 OR v->>'kind' IS DISTINCT FROM cap OR v->'executionAuthorized' IS DISTINCT FROM 'false'::jsonb
 OR jsonb_typeof(v->'replayed') IS DISTINCT FROM 'boolean' OR jsonb_typeof(v->'historicalSnapshot') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(v->'holds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 FOR k IN SELECT jsonb_object_keys(i) LOOP IF v->k IS DISTINCT FROM i->k THEN RETURN false; END IF; END LOOP;
 IF jsonb_array_length(v->'holds')>16 OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(v->'holds')) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v->'holds') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR item#>>'{}' !~ '^[A-Z][A-Z0-9_]{1,95}$' THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY CASE WHEN cap='mastermind.native.review-artifacts' THEN ARRAY['requirementsHash','bindingSha256','testSpecHash'] ELSE ARRAY['requirementsHash','requestHash','planId'] END LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR COALESCE(v->>k,'') !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 END LOOP;
 IF cap='mastermind.native.review-artifacts' THEN
  IF COALESCE(v->>'artifactState','') NOT IN ('proposed','prepared','published') OR jsonb_typeof(v->'commit') IS DISTINCT FROM 'string'
  OR COALESCE(v->>'commit','') !~ '^([a-f0-9]{40}|[a-f0-9]{64})$' OR jsonb_typeof(v->'fileCount') IS DISTINCT FROM 'number'
  OR COALESCE(v->>'fileCount','') !~ '^[1-9][0-9]?$' OR (v->>'fileCount')::integer>64
  OR jsonb_typeof(v->'gitVerified') IS DISTINCT FROM 'boolean' OR v->'gitVerified'=v->'historicalSnapshot'
  OR v->'mayAutomaticallyRerun' IS DISTINCT FROM 'false'::jsonb OR v->>'candidateAcceptance' IS DISTINCT FROM 'not-run' THEN RETURN false; END IF;
  IF v->'gitVerified'='true'::jsonb THEN
   IF v->>'artifactState'<>'published' OR v->'holds'<>'[]'::jsonb OR jsonb_typeof(v->'gitVerifiedAt') IS DISTINCT FROM 'string'
   OR v->>'gitVerifiedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN RETURN false; END IF;
   stamp:=(v->>'gitVerifiedAt')::timestamptz;
   IF to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>v->>'gitVerifiedAt' THEN RETURN false; END IF;
  ELSIF v->'gitVerifiedAt'<>'null'::jsonb THEN RETURN false; END IF;
 ELSE
  IF jsonb_typeof(v->'current') IS DISTINCT FROM 'boolean' OR jsonb_typeof(v->'hasSourceReceipt') IS DISTINCT FROM 'boolean'
  OR v->'workerInvoked' IS DISTINCT FROM 'false'::jsonb OR COALESCE(v->>'state','') NOT IN ('held','awaiting_coding_authority')
  OR COALESCE(v->>'decision','') NOT IN ('create','extend') OR jsonb_typeof(v->'moduleId') IS DISTINCT FROM 'string'
  OR COALESCE(v->>'moduleId','') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$'
  OR (v->'candidateId'<>'null'::jsonb AND (jsonb_typeof(v->'candidateId')<>'string' OR v->>'candidateId' !~ '^[a-f0-9]{64}$'))
  OR (v->'jobState'<>'null'::jsonb AND (jsonb_typeof(v->'jobState')<>'string' OR v->>'jobState' !~ '^[a-z_]{1,48}$'))
  OR (v->'current'='false'::jsonb AND v->>'state'<>'held')
  OR (v->>'state'='awaiting_coding_authority' AND (v->'current'<>'true'::jsonb OR v->'holds'<>'[]'::jsonb)) THEN RETURN false; END IF;
  request:=jsonb_build_object('schemaVersion',1,'taskRef',i->'taskRef','operationId',i->'buildOperationId',
    'artifactOperationId',i->'artifactOperationId','specificationId',i->'specificationId','reviewId',i->'reviewId');
  IF v->>'requestHash'<>encode(sha256(convert_to(public.mastermind_review_canonical_v1(request),'UTF8')),'hex') THEN RETURN false; END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN invalid_parameter_value OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_development_authorized_v1(cap text,h text,a uuid,i jsonb,r jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE parent public.mastermind_node_jobs_v1%ROWTYPE; requirement json;
BEGIN
 IF cap='mastermind.native.review-build-dispatch' THEN RETURN public.mastermind_build_dispatch_authorized_v1(h,a,i,r); END IF;
 IF NOT public.mastermind_development_input_valid_v1(cap,i) THEN RETURN false; END IF;
 SELECT * INTO parent FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=(i->>'parentOperationId')::uuid
  AND j.household_id=h AND j.created_by_player_id=a AND j.capability='mastermind.native.review' AND j.state='succeeded'
  AND j.command_input->'taskRef'=i->'taskRef' AND j.terminal_result->'specificationId'=i->'specificationId'
  AND j.terminal_result->'reviewId'=i->'reviewId';
 IF NOT FOUND OR NOT public.mastermind_review_authorized_v1(h,a,parent.command_input,parent.terminal_result)
 OR public.mastermind_review_content_json_v2(parent.command_input)->>'mode' NOT IN ('create','extend') THEN RETURN false; END IF;
 requirement:=public.mastermind_review_content_json_v2(parent.command_input)->'requirements';
 -- A local operation identity cannot be reassigned by a new network job.
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.capability IN ('mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch')
  AND (j.command_input->'artifactOperationId'=i->'artifactOperationId' OR cap='mastermind.native.review-build-plan' AND j.command_input->'buildOperationId'=i->'buildOperationId')
  AND (j.node_id<>parent.node_id OR j.household_id<>h OR j.created_by_player_id<>a
    OR j.command_input->'taskRef'<>i->'taskRef' OR j.command_input->'parentOperationId'<>i->'parentOperationId'
    OR j.command_input->'specificationId'<>i->'specificationId' OR j.command_input->'reviewId'<>i->'reviewId'
    OR j.command_input->'artifactOperationId'<>i->'artifactOperationId')) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=(i->>'operationId')::uuid
  AND (j.node_id<>parent.node_id OR j.household_id<>h OR j.created_by_player_id<>a OR j.capability<>cap OR j.command_input<>i)) THEN RETURN false; END IF;
 IF cap='mastermind.native.review-build-plan' AND NOT EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j
  WHERE j.capability='mastermind.native.review-artifacts' AND j.state='succeeded' AND j.node_id=parent.node_id
  AND j.household_id=h AND j.created_by_player_id=a AND j.command_input->'parentOperationId'=i->'parentOperationId'
  AND j.command_input->'artifactOperationId'=i->'artifactOperationId' AND j.command_input->'specificationId'=i->'specificationId'
  AND j.command_input->'reviewId'=i->'reviewId' AND j.command_input->'taskRef'=i->'taskRef'
  AND j.terminal_result->>'artifactState'='published' AND j.terminal_result->'holds'='[]'::jsonb
  AND public.mastermind_development_result_valid_v1(j.capability,j.terminal_result,j.command_input)) THEN RETURN false; END IF;
 IF r IS NOT NULL THEN
  IF NOT public.mastermind_development_result_valid_v1(cap,r,i)
  OR r->>'requirementsHash'<>encode(sha256(convert_to(public.mastermind_review_part_text_v2(parent.command_input,ARRAY['requirements']),'UTF8')),'hex') THEN RETURN false; END IF;
  IF cap='mastermind.native.review-artifacts' THEN
   IF r->>'testSpecHash'<>encode(sha256(convert_to(public.mastermind_review_part_text_v2(parent.command_input,ARRAY['requirements','tests']),'UTF8')),'hex') THEN RETURN false; END IF;
   IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.capability=cap AND j.state='succeeded'
    AND j.command_input->'artifactOperationId'=i->'artifactOperationId'
    AND (j.terminal_result->'bindingSha256'<>r->'bindingSha256' OR j.terminal_result->'commit'<>r->'commit')) THEN RETURN false; END IF;
  ELSE
   IF r->'moduleId' IS DISTINCT FROM (requirement->'moduleId')::jsonb OR r->'decision' IS DISTINCT FROM (public.mastermind_review_content_json_v2(parent.command_input)->'mode')::jsonb THEN RETURN false; END IF;
   IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.capability=cap AND j.state='succeeded'
    AND j.command_input->'buildOperationId'=i->'buildOperationId' AND j.terminal_result->'planId'<>r->'planId') THEN RETURN false; END IF;
  END IF;
 END IF;
 RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_review_family_authorized_v1(cap text,h text,a uuid,i jsonb,r jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT CASE cap WHEN 'mastermind.native.review' THEN public.mastermind_review_authorized_v1(h,a,i,r)
 WHEN 'mastermind.native.review-reuse' THEN public.mastermind_review_reuse_authorized_v1(h,a,i,r)
 WHEN 'mastermind.native.review-artifacts' THEN public.mastermind_development_authorized_v1(cap,h,a,i,r)
 WHEN 'mastermind.native.review-build-plan' THEN public.mastermind_development_authorized_v1(cap,h,a,i,r) WHEN 'mastermind.native.review-build-dispatch' THEN public.mastermind_build_dispatch_authorized_v1(h,a,i,r) ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_mastermind_development_job_v1(
 p_job_id uuid,p_command_sha256 text,p_node_id uuid,p_household_id text,p_parent_player_id uuid,
 p_expires_at timestamptz,p_capability text,p_input jsonb)
RETURNS TABLE(status text,job_id uuid,household_id text,created_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE v_now timestamptz:=clock_timestamp(); v_existing public.mastermind_node_jobs_v1%ROWTYPE;
BEGIN
 IF p_job_id IS NULL OR p_node_id IS NULL OR COALESCE(p_command_sha256,'') !~ '^[a-f0-9]{64}$'
 OR p_household_id IS NULL OR p_parent_player_id IS NULL OR p_expires_at IS NULL
 OR p_expires_at<=v_now+interval '5 seconds' OR p_expires_at>v_now+interval '1 day'
 OR NOT public.mastermind_development_input_valid_v1(p_capability,p_input)
 OR p_input->>'operationId' IS DISTINCT FROM p_job_id::text THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid development job'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_input->'taskRef'->>'taskId',0));
 IF NOT EXISTS(SELECT 1 FROM public.mastermind_active_parent_profile_v1(p_household_id,p_parent_player_id))
 OR NOT EXISTS(SELECT 1 FROM public.mastermind_nodes_v1 n WHERE n.node_id=p_node_id AND n.household_id=p_household_id AND n.state='active')
 OR NOT EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 p WHERE p.job_id=(p_input->>'parentOperationId')::uuid AND p.node_id=p_node_id)
 OR NOT public.mastermind_development_authorized_v1(p_capability,p_household_id,p_parent_player_id,p_input) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='development task authority denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-job/'||p_job_id::text,41));
 SELECT * INTO v_existing FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=p_job_id;
 IF FOUND THEN
  IF v_existing.command_sha256=p_command_sha256 AND v_existing.node_id=p_node_id
  AND v_existing.household_id=p_household_id AND v_existing.created_by_player_id=p_parent_player_id
  AND v_existing.capability=p_capability AND v_existing.command_input=p_input THEN
   RETURN QUERY SELECT 'duplicate'::text,v_existing.job_id,v_existing.household_id,v_existing.created_at,v_existing.expires_at;RETURN;
  END IF;
  RETURN QUERY SELECT 'conflict'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 UPDATE public.mastermind_node_jobs_v1 j SET state='expired' WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch')
 AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state IN ('queued','leased','running')) THEN
 RETURN QUERY SELECT 'busy'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN; END IF;
 INSERT INTO public.mastermind_node_jobs_v1(job_id,household_id,node_id,command_sha256,capability,capability_version,
 policy_class,command_input,created_by_player_id,created_at,expires_at)
 VALUES(p_job_id,p_household_id,p_node_id,p_command_sha256,p_capability,1,'routine',p_input,p_parent_player_id,v_now,p_expires_at);
 RETURN QUERY SELECT 'applied'::text,p_job_id,p_household_id,v_now,p_expires_at;
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_node_worker_valid_v2(p_worker jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE item jsonb; seen text[] := ARRAY[]::text[];
BEGIN
 IF p_worker IS NULL OR jsonb_typeof(p_worker) <> 'object'
   OR (p_worker - 'protocolVersion' - 'capabilities') <> '{}'::jsonb
   OR p_worker -> 'protocolVersion' IS NULL OR p_worker -> 'capabilities' IS NULL
   OR p_worker ->> 'protocolVersion' NOT IN ('1','2')
   OR jsonb_typeof(p_worker -> 'capabilities') <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p_worker -> 'capabilities') NOT BETWEEN 1 AND 9 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_worker -> 'capabilities') LOOP
   IF jsonb_typeof(item) <> 'object' OR (item - 'id' - 'version') <> '{}'::jsonb
     OR item ->> 'id' IS NULL OR (item -> 'version'='1'::jsonb OR item->>'id'='mastermind.native.review' AND item->'version'='2'::jsonb) IS NOT TRUE
     OR item ->> 'id' NOT IN ('family-ecosystem.ensure-running','mastermind.core.status','mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch')
     OR item ->> 'id' = ANY(seen) THEN RETURN false; END IF;
   seen := array_append(seen,item ->> 'id');
 END LOOP;
 IF p_worker -> 'protocolVersion' = '1'::jsonb THEN RETURN seen = ARRAY['family-ecosystem.ensure-running']; END IF;
 RETURN p_worker -> 'protocolVersion' = '2'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.exchange_mastermind_node_negotiated_v2(
  p_exchange_id uuid,
  p_request_sha256 text,
  p_node_id uuid,
  p_credential_sha256 text,
  p_boot_id uuid,
  p_sent_at timestamptz,
  p_agent_version text,
  p_status jsonb,
  p_receipts jsonb,
  p_receipt_sha256s text[],
  p_candidate_lease_id uuid,
  p_worker jsonb
)
RETURNS TABLE (
  status text,
  exchange_id uuid,
  server_time timestamptz,
  acknowledged_receipt_ids uuid[],
  lease jsonb
)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_node public.mastermind_nodes_v1%ROWTYPE;
  v_exchange public.mastermind_node_exchanges_v1%ROWTYPE;
  v_job public.mastermind_node_jobs_v1%ROWTYPE;
  v_existing_receipt public.mastermind_node_job_receipts_v1%ROWTYPE;
  v_receipt jsonb;
  v_receipt_sha text;
  v_receipt_id uuid;
  v_job_id uuid;
  v_lease_id uuid;
  v_boot_id uuid;
  v_sequence integer;
  v_ack uuid[] := ARRAY[]::uuid[];
  v_lease jsonb := NULL;
  v_index integer := 0;
BEGIN
  IF p_exchange_id IS NULL OR p_node_id IS NULL OR p_boot_id IS NULL OR p_candidate_lease_id IS NULL
    OR p_request_sha256 IS NULL OR p_credential_sha256 IS NULL OR p_sent_at IS NULL
    OR p_agent_version IS NULL OR p_status IS NULL OR p_receipts IS NULL OR p_receipt_sha256s IS NULL
    OR p_request_sha256 !~ '^[a-f0-9]{64}$' OR p_credential_sha256 !~ '^[a-f0-9]{64}$'
    OR p_agent_version !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$'
    OR jsonb_typeof(p_status) <> 'object' OR octet_length(p_status::text) > 8192
    OR jsonb_typeof(p_receipts) <> 'array' OR jsonb_array_length(p_receipts) > 32
    OR cardinality(p_receipt_sha256s) <> jsonb_array_length(p_receipts)
    OR EXISTS (SELECT 1 FROM unnest(p_receipt_sha256s) AS digest WHERE digest IS NULL OR digest !~ '^[a-f0-9]{64}$')
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid node exchange';
  END IF;

  IF NOT COALESCE(public.mastermind_node_worker_valid_v2(p_worker), false) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported worker capabilities';
  END IF;
  SELECT * INTO v_node FROM public.mastermind_nodes_v1
  WHERE mastermind_nodes_v1.node_id = p_node_id
  FOR UPDATE;
  IF NOT FOUND OR v_node.state <> 'active' OR v_node.credential_sha256 IS DISTINCT FROM p_credential_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'node credential is invalid';
  END IF;

  SELECT * INTO v_exchange FROM public.mastermind_node_exchanges_v1
  WHERE mastermind_node_exchanges_v1.exchange_id = p_exchange_id;
  IF FOUND THEN
    IF v_exchange.node_id <> p_node_id OR v_exchange.request_sha256 <> p_request_sha256 THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'node exchange id conflict';
    END IF;
    -- An exchange replay repeats its acknowledgements, never its old authority.
    -- Rebuild only the same lease when it is still the node's live lease; an
    -- expired, reissued, or terminal lease becomes null at the current time.
    v_lease := NULL;
    IF v_exchange.response_lease IS NOT NULL THEN
      SELECT * INTO v_job
      FROM public.mastermind_node_jobs_v1
      WHERE mastermind_node_jobs_v1.job_id = (v_exchange.response_lease ->> 'jobId')::uuid
      AND public.mastermind_node_worker_supports_v2(p_worker, mastermind_node_jobs_v1.capability, mastermind_node_jobs_v1.capability_version)
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.reuse' OR public.mastermind_native_task_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input))
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.catalog' OR public.mastermind_catalog_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.specification' OR public.mastermind_specification_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
      AND (mastermind_node_jobs_v1.capability NOT IN ('mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') OR public.mastermind_review_family_authorized_v1(mastermind_node_jobs_v1.capability,mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
        AND mastermind_node_jobs_v1.node_id = p_node_id
        AND mastermind_node_jobs_v1.lease_id = (v_exchange.response_lease ->> 'leaseId')::uuid
        AND mastermind_node_jobs_v1.state IN ('leased', 'running')
        AND mastermind_node_jobs_v1.lease_expires_at > v_now
        AND mastermind_node_jobs_v1.expires_at > v_now
      FOR UPDATE;
      IF FOUND THEN
        v_lease := jsonb_build_object(
          'jobId', v_job.job_id::text,
          'nodeId', v_job.node_id::text,
          'commandDigest', v_job.command_sha256,
          'capability', v_job.capability,
          'capabilityVersion', v_job.capability_version,
          'policyClass', v_job.policy_class,
          'input', v_job.command_input,
          'createdAt', to_char(v_job.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'expiresAt', to_char(v_job.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'leaseId', v_job.lease_id::text,
          'leasedAt', to_char(v_job.leased_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'leaseExpiresAt', to_char(v_job.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        );
      END IF;
    END IF;
    RETURN QUERY SELECT 'duplicate'::text, v_exchange.exchange_id, v_now,
      v_exchange.acknowledged_receipt_ids, v_lease;
    RETURN;
  END IF;

  UPDATE public.mastermind_nodes_v1
  SET agent_version = p_agent_version,
      last_exchange_at = v_now,
      last_exchange_id = p_exchange_id,
      last_boot_id = p_boot_id,
      last_status = p_status,
      last_worker = p_worker
  WHERE mastermind_nodes_v1.node_id = p_node_id;

  FOR v_receipt IN SELECT value FROM jsonb_array_elements(p_receipts)
  LOOP
    v_index := v_index + 1;
    v_receipt_sha := p_receipt_sha256s[v_index];
    BEGIN
      v_receipt_id := (v_receipt ->> 'receiptId')::uuid;
      v_job_id := (v_receipt ->> 'jobId')::uuid;
      v_lease_id := (v_receipt ->> 'leaseId')::uuid;
      v_boot_id := (v_receipt ->> 'bootId')::uuid;
      v_sequence := (v_receipt ->> 'sequence')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid node receipt identity';
    END;
    IF v_receipt_id IS NULL OR v_job_id IS NULL OR v_lease_id IS NULL OR v_boot_id IS NULL OR v_sequence IS NULL
      OR v_receipt ->> 'commandDigest' IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid node receipt identity';
    END IF;
    SELECT * INTO v_existing_receipt
    FROM public.mastermind_node_job_receipts_v1
    WHERE mastermind_node_job_receipts_v1.receipt_id = v_receipt_id;
    IF FOUND THEN
      IF v_existing_receipt.receipt_sha256 <> v_receipt_sha
        OR v_existing_receipt.node_id <> p_node_id
      THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'node receipt id conflict';
      END IF;
      v_ack := array_append(v_ack, v_receipt_id);
      CONTINUE;
    END IF;

    SELECT * INTO v_job FROM public.mastermind_node_jobs_v1
    WHERE mastermind_node_jobs_v1.job_id = v_job_id
      AND public.mastermind_node_worker_supports_v2(p_worker, mastermind_node_jobs_v1.capability, mastermind_node_jobs_v1.capability_version)
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.reuse' OR public.mastermind_native_task_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input))
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.catalog' OR public.mastermind_catalog_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.specification' OR public.mastermind_specification_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
      AND (mastermind_node_jobs_v1.capability NOT IN ('mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') OR public.mastermind_review_family_authorized_v1(mastermind_node_jobs_v1.capability,mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
      AND mastermind_node_jobs_v1.node_id = p_node_id
    FOR UPDATE;
    IF NOT FOUND OR v_job.lease_id IS NULL OR v_job.lease_id IS DISTINCT FROM v_lease_id
      OR v_job.command_sha256 IS DISTINCT FROM (v_receipt ->> 'commandDigest')
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'node receipt does not belong to its lease';
    END IF;
    IF (v_job.capability = 'mastermind.core.status' AND (
      (v_receipt ->> 'state' = 'succeeded' AND v_receipt -> 'result' ->> 'kind' IS DISTINCT FROM 'mastermind.core.status')
      OR (v_receipt ->> 'state' <> 'succeeded' AND NULLIF(v_receipt -> 'result', 'null'::jsonb) IS NOT NULL)
    )) OR (v_job.capability = 'family-ecosystem.ensure-running' AND v_receipt -> 'result' ? 'kind') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'receipt result does not match its typed capability';
    END IF;
    IF v_sequence <= COALESCE((
      SELECT max(existing.sequence)
      FROM public.mastermind_node_job_receipts_v1 AS existing
      WHERE existing.job_id = v_job_id
    ), 0) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'node receipt sequence did not advance';
    END IF;
    IF v_job.state IN ('succeeded', 'failed')
      AND v_receipt ->> 'state' NOT IN ('succeeded', 'failed')
    THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'node receipt followed a terminal outcome';
    END IF;
    IF v_job.state = 'running' AND v_receipt ->> 'state' = 'accepted' THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'node receipt regressed job progress';
    END IF;

    IF v_job.capability IN ('mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') THEN
      IF (v_receipt->>'state'='succeeded' AND (NULLIF(v_receipt->'result','null'::jsonb) IS NULL
          OR NOT public.mastermind_review_family_authorized_v1(v_job.capability,v_job.household_id,v_job.created_by_player_id,v_job.command_input,v_receipt->'result')))
        OR (v_receipt->>'state'<>'succeeded' AND NULLIF(v_receipt->'result','null'::jsonb) IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='specification result authority or binding denied';
      END IF;
    END IF;
    IF v_job.capability='mastermind.native.specification' THEN
      IF (v_receipt->>'state'='succeeded' AND (NULLIF(v_receipt->'result','null'::jsonb) IS NULL
          OR NOT public.mastermind_specification_authorized_v1(v_job.household_id,v_job.created_by_player_id,v_job.command_input,v_receipt->'result')))
        OR (v_receipt->>'state'<>'succeeded' AND NULLIF(v_receipt->'result','null'::jsonb) IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='specification result authority or binding denied';
      END IF;
    END IF;
    IF v_job.capability='mastermind.native.catalog' THEN
      IF (v_receipt->>'state'='succeeded' AND (NULLIF(v_receipt->'result','null'::jsonb) IS NULL
          OR NOT public.mastermind_catalog_authorized_v1(v_job.household_id,v_job.created_by_player_id,v_job.command_input,v_receipt->'result')))
        OR (v_receipt->>'state'<>'succeeded' AND NULLIF(v_receipt->'result','null'::jsonb) IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='catalog result authority or binding denied';
      END IF;
    END IF;

    IF v_job.capability = 'mastermind.native.reuse' AND v_receipt ->> 'state' = 'succeeded' THEN
      IF v_receipt->'result'->>'kind' IS DISTINCT FROM 'mastermind.native.reuse'
        OR v_receipt->'result'->>'operationId' IS DISTINCT FROM v_job.job_id::text
        OR v_receipt->'result'->'taskRef' IS DISTINCT FROM v_job.command_input->'taskRef'
        OR v_receipt->'result'->>'specificationId' IS DISTINCT FROM v_job.command_input->>'specificationId'
        OR v_receipt->'result'->>'candidateId' IS DISTINCT FROM v_job.command_input->>'candidateId'
        OR v_receipt->'result'->>'capability' IS DISTINCT FROM v_job.command_input->>'capability'
        OR v_receipt->'result'->>'inputSha256' IS DISTINCT FROM v_job.command_input->>'inputSha256' THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='native result binding changed';
      END IF;
    ELSIF v_job.capability = 'mastermind.native.reuse' AND NULLIF(v_receipt->'result','null'::jsonb) IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='native failure result is invalid';
    END IF;

    INSERT INTO public.mastermind_node_job_receipts_v1 (
      receipt_id, job_id, node_id, lease_id, boot_id, receipt_sha256, command_sha256,
      sequence, state, stage, observed_at, code, retryable, result, received_at
    ) VALUES (
      v_receipt_id, v_job_id, p_node_id, v_lease_id, v_boot_id, v_receipt_sha,
      v_receipt ->> 'commandDigest', v_sequence, v_receipt ->> 'state',
      v_receipt ->> 'stage', (v_receipt ->> 'observedAt')::timestamptz,
      v_receipt ->> 'code', (v_receipt ->> 'retryable')::boolean,
      NULLIF(v_receipt -> 'result', 'null'::jsonb), v_now
    );

    IF v_receipt ->> 'state' = 'running' AND v_job.state IN ('leased', 'running') THEN
      UPDATE public.mastermind_node_jobs_v1
      SET state = 'running'
      WHERE mastermind_node_jobs_v1.job_id = v_job_id;
    ELSIF v_receipt ->> 'state' IN ('succeeded', 'failed') THEN
      IF v_job.state IN ('succeeded', 'failed') THEN
        IF v_job.state <> v_receipt ->> 'state'
          OR v_job.terminal_code IS DISTINCT FROM v_receipt ->> 'code'
          OR v_job.terminal_result IS DISTINCT FROM NULLIF(v_receipt -> 'result', 'null'::jsonb)
        THEN
          RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'node job terminal outcome conflict';
        END IF;
        -- First terminal outcome wins. A semantically identical later receipt is
        -- retained for idempotent acknowledgement but cannot rewrite the job.
      ELSE
        UPDATE public.mastermind_node_jobs_v1
        SET state = v_receipt ->> 'state',
            terminal_code = v_receipt ->> 'code',
            terminal_result = NULLIF(v_receipt -> 'result', 'null'::jsonb),
            finished_at = v_now
        WHERE mastermind_node_jobs_v1.job_id = v_job_id;
      END IF;
    END IF;
    v_ack := array_append(v_ack, v_receipt_id);
  END LOOP;

  IF cardinality(v_ack) > 0 THEN
    UPDATE public.mastermind_nodes_v1 SET last_job_receipt_at = v_now
    WHERE mastermind_nodes_v1.node_id = p_node_id;
  END IF;

  UPDATE public.mastermind_node_jobs_v1
  SET state = 'expired'
  WHERE mastermind_node_jobs_v1.node_id = p_node_id
    AND state = 'queued' AND expires_at <= v_now;

  UPDATE public.mastermind_node_jobs_v1
  SET state = 'failed', terminal_code = 'execution-timeout', terminal_result = NULL,
      finished_at = v_now
  WHERE mastermind_node_jobs_v1.node_id = p_node_id
    AND state IN ('leased', 'running') AND expires_at <= v_now;

  -- A lease which was not renewed is no longer authority to execute. Requeue it
  -- with no lease identity so the next dispatch receives a fresh candidate ID.
  UPDATE public.mastermind_node_jobs_v1
  SET state = 'queued', lease_id = NULL, leased_at = NULL, lease_expires_at = NULL
  WHERE mastermind_node_jobs_v1.node_id = p_node_id
    AND state IN ('leased', 'running')
    AND lease_expires_at <= v_now
    AND expires_at > v_now + interval '1 second';

  SELECT * INTO v_job FROM public.mastermind_node_jobs_v1
  WHERE mastermind_node_jobs_v1.node_id = p_node_id
      AND public.mastermind_node_worker_supports_v2(p_worker, mastermind_node_jobs_v1.capability, mastermind_node_jobs_v1.capability_version)
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.reuse' OR public.mastermind_native_task_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input))
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.catalog' OR public.mastermind_catalog_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.specification' OR public.mastermind_specification_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
      AND (mastermind_node_jobs_v1.capability NOT IN ('mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') OR public.mastermind_review_family_authorized_v1(mastermind_node_jobs_v1.capability,mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
    AND state IN ('leased', 'running')
    AND lease_expires_at > v_now
  ORDER BY created_at, job_id
  LIMIT 1
  FOR UPDATE;

  IF v_job.job_id IS NULL THEN
    SELECT * INTO v_job FROM public.mastermind_node_jobs_v1
    WHERE mastermind_node_jobs_v1.node_id = p_node_id
      AND public.mastermind_node_worker_supports_v2(p_worker, mastermind_node_jobs_v1.capability, mastermind_node_jobs_v1.capability_version)
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.reuse' OR public.mastermind_native_task_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input))
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.catalog' OR public.mastermind_catalog_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.specification' OR public.mastermind_specification_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
      AND (mastermind_node_jobs_v1.capability NOT IN ('mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') OR public.mastermind_review_family_authorized_v1(mastermind_node_jobs_v1.capability,mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
      AND state = 'queued' AND expires_at > v_now + interval '1 second'
    ORDER BY created_at, job_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      UPDATE public.mastermind_node_jobs_v1
      SET state = 'leased', lease_id = p_candidate_lease_id, leased_at = v_now,
          expires_at = CASE WHEN capability = 'family-ecosystem.ensure-running' THEN GREATEST(expires_at, created_at + interval '2 hours') ELSE expires_at END,
          lease_expires_at = CASE WHEN capability = 'family-ecosystem.ensure-running' THEN GREATEST(expires_at, created_at + interval '2 hours') ELSE LEAST(expires_at, v_now + interval '30 seconds') END
      WHERE mastermind_node_jobs_v1.job_id = v_job.job_id
      RETURNING * INTO v_job;
    END IF;
  ELSE
    UPDATE public.mastermind_node_jobs_v1
    SET expires_at = CASE WHEN capability = 'family-ecosystem.ensure-running' THEN GREATEST(expires_at, created_at + interval '2 hours') ELSE expires_at END,
        lease_expires_at = CASE WHEN capability = 'family-ecosystem.ensure-running' THEN GREATEST(expires_at, created_at + interval '2 hours') ELSE LEAST(expires_at, v_now + interval '30 seconds') END
    WHERE mastermind_node_jobs_v1.job_id = v_job.job_id
    RETURNING * INTO v_job;
  END IF;

  IF v_job.job_id IS NOT NULL AND v_job.state IN ('leased', 'running') THEN
    v_lease := jsonb_build_object(
      'jobId', v_job.job_id::text,
      'nodeId', v_job.node_id::text,
      'commandDigest', v_job.command_sha256,
      'capability', v_job.capability,
      'capabilityVersion', v_job.capability_version,
      'policyClass', v_job.policy_class,
      'input', v_job.command_input,
      'createdAt', to_char(v_job.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt', to_char(v_job.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'leaseId', v_job.lease_id::text,
      'leasedAt', to_char(v_job.leased_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'leaseExpiresAt', to_char(v_job.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  END IF;

  INSERT INTO public.mastermind_node_exchanges_v1 (
    exchange_id, node_id, request_sha256, boot_id, sent_at, received_at,
    acknowledged_receipt_ids, response_lease
  ) VALUES (
    p_exchange_id, p_node_id, p_request_sha256, p_boot_id, p_sent_at, v_now, v_ack, v_lease
  );
  RETURN QUERY SELECT 'applied'::text, p_exchange_id, v_now, v_ack, v_lease;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_mastermind_native_task_job_v1(
 p_job_id uuid,p_command_sha256 text,p_node_id uuid,p_household_id text,p_parent_player_id uuid,
 p_expires_at timestamptz,p_input jsonb)
RETURNS TABLE(status text,job_id uuid,household_id text,created_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE v_now timestamptz:=clock_timestamp(); v_existing public.mastermind_node_jobs_v1%ROWTYPE;
BEGIN
 IF p_job_id IS NULL OR p_node_id IS NULL OR COALESCE(p_command_sha256,'') !~ '^[a-f0-9]{64}$'
 OR p_household_id IS NULL OR p_parent_player_id IS NULL
 OR p_input->>'operationId' IS DISTINCT FROM p_job_id::text OR p_expires_at IS NULL
 OR p_expires_at<=v_now+interval '5 seconds' OR p_expires_at>v_now+interval '1 day'
 OR NOT public.mastermind_native_input_valid_v1(p_input) THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid native task job'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_input->'taskRef'->>'taskId',0));
 IF NOT EXISTS(SELECT 1 FROM public.mastermind_active_parent_profile_v1(p_household_id,p_parent_player_id))
 OR NOT EXISTS(SELECT 1 FROM public.mastermind_nodes_v1 n WHERE n.node_id=p_node_id AND n.household_id=p_household_id AND n.state='active')
 OR NOT public.mastermind_native_task_authorized_v1(p_household_id,p_parent_player_id,p_input) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native task authority denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-job/'||p_job_id::text,41));
 SELECT * INTO v_existing FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=p_job_id;
 IF FOUND THEN
 IF v_existing.command_sha256=p_command_sha256 AND v_existing.node_id=p_node_id
 AND v_existing.household_id=p_household_id AND v_existing.created_by_player_id=p_parent_player_id
 AND v_existing.capability='mastermind.native.reuse' AND v_existing.command_input=p_input THEN
 RETURN QUERY SELECT 'duplicate'::text,v_existing.job_id,v_existing.household_id,v_existing.created_at,v_existing.expires_at;RETURN;
 END IF;
 RETURN QUERY SELECT 'conflict'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 UPDATE public.mastermind_node_jobs_v1 j SET state='expired'
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state IN ('queued','leased','running')) THEN
 RETURN QUERY SELECT 'busy'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 INSERT INTO public.mastermind_node_jobs_v1(job_id,household_id,node_id,command_sha256,capability,capability_version,
 policy_class,command_input,created_by_player_id,created_at,expires_at)
 VALUES(p_job_id,p_household_id,p_node_id,p_command_sha256,'mastermind.native.reuse',1,'routine',p_input,p_parent_player_id,v_now,p_expires_at);
 RETURN QUERY SELECT 'applied'::text,p_job_id,p_household_id,v_now,p_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_mastermind_catalog_job_v1(
 p_job_id uuid,p_command_sha256 text,p_node_id uuid,p_household_id text,p_parent_player_id uuid,
 p_expires_at timestamptz,p_input jsonb)
RETURNS TABLE(status text,job_id uuid,household_id text,created_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE v_now timestamptz:=clock_timestamp(); v_existing public.mastermind_node_jobs_v1%ROWTYPE;
BEGIN
 IF p_job_id IS NULL OR p_node_id IS NULL OR COALESCE(p_command_sha256,'') !~ '^[a-f0-9]{64}$'
 OR p_household_id IS NULL OR p_parent_player_id IS NULL
 OR p_expires_at IS NULL
 OR p_expires_at<=v_now+interval '5 seconds' OR p_expires_at>v_now+interval '1 day'
 OR NOT public.mastermind_catalog_input_valid_v1(p_input) THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid native task job'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_input->'taskRef'->>'taskId',0));
 IF NOT EXISTS(SELECT 1 FROM public.mastermind_active_parent_profile_v1(p_household_id,p_parent_player_id))
 OR NOT EXISTS(SELECT 1 FROM public.mastermind_nodes_v1 n WHERE n.node_id=p_node_id AND n.household_id=p_household_id AND n.state='active')
 OR NOT public.mastermind_catalog_authorized_v1(p_household_id,p_parent_player_id,p_input) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native task authority denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-job/'||p_job_id::text,41));
 SELECT * INTO v_existing FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=p_job_id;
 IF FOUND THEN
 IF v_existing.command_sha256=p_command_sha256 AND v_existing.node_id=p_node_id
 AND v_existing.household_id=p_household_id AND v_existing.created_by_player_id=p_parent_player_id
 AND v_existing.capability='mastermind.native.catalog' AND v_existing.command_input=p_input THEN
 RETURN QUERY SELECT 'duplicate'::text,v_existing.job_id,v_existing.household_id,v_existing.created_at,v_existing.expires_at;RETURN;
 END IF;
 RETURN QUERY SELECT 'conflict'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 UPDATE public.mastermind_node_jobs_v1 j SET state='expired'
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state IN ('queued','leased','running')) THEN
 RETURN QUERY SELECT 'busy'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 INSERT INTO public.mastermind_node_jobs_v1(job_id,household_id,node_id,command_sha256,capability,capability_version,
 policy_class,command_input,created_by_player_id,created_at,expires_at)
 VALUES(p_job_id,p_household_id,p_node_id,p_command_sha256,'mastermind.native.catalog',1,'routine',p_input,p_parent_player_id,v_now,p_expires_at);
 RETURN QUERY SELECT 'applied'::text,p_job_id,p_household_id,v_now,p_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_mastermind_specification_job_v1(
 p_job_id uuid,p_command_sha256 text,p_node_id uuid,p_household_id text,p_parent_player_id uuid,
 p_expires_at timestamptz,p_input jsonb)
RETURNS TABLE(status text,job_id uuid,household_id text,created_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE v_now timestamptz:=clock_timestamp(); v_existing public.mastermind_node_jobs_v1%ROWTYPE;
BEGIN
 IF p_job_id IS NULL OR p_node_id IS NULL OR COALESCE(p_command_sha256,'') !~ '^[a-f0-9]{64}$'
 OR p_household_id IS NULL OR p_parent_player_id IS NULL
 OR p_expires_at IS NULL
 OR p_expires_at<=v_now+interval '5 seconds' OR p_expires_at>v_now+interval '1 day'
 OR NOT public.mastermind_specification_input_valid_v1(p_input) OR p_input->>'operationId' IS DISTINCT FROM p_job_id::text THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid native task job'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_input->'taskRef'->>'taskId',0));
 IF NOT EXISTS(SELECT 1 FROM public.mastermind_active_parent_profile_v1(p_household_id,p_parent_player_id))
 OR NOT EXISTS(SELECT 1 FROM public.mastermind_nodes_v1 n WHERE n.node_id=p_node_id AND n.household_id=p_household_id AND n.state='active')
 OR NOT public.mastermind_specification_authorized_v1(p_household_id,p_parent_player_id,p_input) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native task authority denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-job/'||p_job_id::text,41));
 SELECT * INTO v_existing FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=p_job_id;
 IF FOUND THEN
 IF v_existing.command_sha256=p_command_sha256 AND v_existing.node_id=p_node_id
 AND v_existing.household_id=p_household_id AND v_existing.created_by_player_id=p_parent_player_id
 AND v_existing.capability='mastermind.native.specification' AND v_existing.command_input=p_input THEN
 RETURN QUERY SELECT 'duplicate'::text,v_existing.job_id,v_existing.household_id,v_existing.created_at,v_existing.expires_at;RETURN;
 END IF;
 RETURN QUERY SELECT 'conflict'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 UPDATE public.mastermind_node_jobs_v1 j SET state='expired'
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state IN ('queued','leased','running')) THEN
 RETURN QUERY SELECT 'busy'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 INSERT INTO public.mastermind_node_jobs_v1(job_id,household_id,node_id,command_sha256,capability,capability_version,
 policy_class,command_input,created_by_player_id,created_at,expires_at)
 VALUES(p_job_id,p_household_id,p_node_id,p_command_sha256,'mastermind.native.specification',1,'routine',p_input,p_parent_player_id,v_now,p_expires_at);
 RETURN QUERY SELECT 'applied'::text,p_job_id,p_household_id,v_now,p_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_mastermind_review_job_v1(
 p_job_id uuid,p_command_sha256 text,p_node_id uuid,p_household_id text,p_parent_player_id uuid,
 p_expires_at timestamptz,p_input jsonb)
RETURNS TABLE(status text,job_id uuid,household_id text,created_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE v_now timestamptz:=clock_timestamp(); v_existing public.mastermind_node_jobs_v1%ROWTYPE;
BEGIN
 IF p_job_id IS NULL OR p_node_id IS NULL OR COALESCE(p_command_sha256,'') !~ '^[a-f0-9]{64}$'
 OR p_household_id IS NULL OR p_parent_player_id IS NULL
 OR p_expires_at IS NULL
 OR p_expires_at<=v_now+interval '5 seconds' OR p_expires_at>v_now+interval '1 day'
 OR NOT public.mastermind_review_input_valid_v1(p_input) OR p_input->>'operationId' IS DISTINCT FROM p_job_id::text THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid native task job'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_input->'taskRef'->>'taskId',0));
 IF NOT EXISTS(SELECT 1 FROM public.mastermind_active_parent_profile_v1(p_household_id,p_parent_player_id))
 OR NOT EXISTS(SELECT 1 FROM public.mastermind_nodes_v1 n WHERE n.node_id=p_node_id AND n.household_id=p_household_id AND n.state='active')
 OR NOT EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 p WHERE p.job_id=(p_input->>'parentOperationId')::uuid AND p.node_id=p_node_id)
 OR NOT public.mastermind_review_authorized_v1(p_household_id,p_parent_player_id,p_input) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native task authority denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-job/'||p_job_id::text,41));
 SELECT * INTO v_existing FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=p_job_id;
 IF FOUND THEN
 IF v_existing.command_sha256=p_command_sha256 AND v_existing.node_id=p_node_id
 AND v_existing.household_id=p_household_id AND v_existing.created_by_player_id=p_parent_player_id
 AND v_existing.capability='mastermind.native.review' AND v_existing.command_input=p_input THEN
 RETURN QUERY SELECT 'duplicate'::text,v_existing.job_id,v_existing.household_id,v_existing.created_at,v_existing.expires_at;RETURN;
 END IF;
 RETURN QUERY SELECT 'conflict'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 UPDATE public.mastermind_node_jobs_v1 j SET state='expired'
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state IN ('queued','leased','running')) THEN
 RETURN QUERY SELECT 'busy'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 INSERT INTO public.mastermind_node_jobs_v1(job_id,household_id,node_id,command_sha256,capability,capability_version,
 policy_class,command_input,created_by_player_id,created_at,expires_at)
 VALUES(p_job_id,p_household_id,p_node_id,p_command_sha256,'mastermind.native.review',(p_input->>'schemaVersion')::smallint,'routine',p_input,p_parent_player_id,v_now,p_expires_at);
 RETURN QUERY SELECT 'applied'::text,p_job_id,p_household_id,v_now,p_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_mastermind_review_reuse_job_v1(
 p_job_id uuid,p_command_sha256 text,p_node_id uuid,p_household_id text,p_parent_player_id uuid,
 p_expires_at timestamptz,p_input jsonb)
RETURNS TABLE(status text,job_id uuid,household_id text,created_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE v_now timestamptz:=clock_timestamp(); v_existing public.mastermind_node_jobs_v1%ROWTYPE;
BEGIN
 IF p_job_id IS NULL OR p_node_id IS NULL OR COALESCE(p_command_sha256,'') !~ '^[a-f0-9]{64}$'
 OR p_household_id IS NULL OR p_parent_player_id IS NULL
 OR p_expires_at IS NULL
 OR p_expires_at<=v_now+interval '5 seconds' OR p_expires_at>v_now+interval '1 day'
 OR NOT public.mastermind_review_reuse_input_valid_v1(p_input) OR p_input->>'operationId' IS DISTINCT FROM p_job_id::text THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid native task job'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_input->'taskRef'->>'taskId',0));
 IF NOT EXISTS(SELECT 1 FROM public.mastermind_active_parent_profile_v1(p_household_id,p_parent_player_id))
 OR NOT EXISTS(SELECT 1 FROM public.mastermind_nodes_v1 n WHERE n.node_id=p_node_id AND n.household_id=p_household_id AND n.state='active')
 OR NOT EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 p WHERE p.job_id=(p_input->>'parentOperationId')::uuid AND p.node_id=p_node_id)
 OR NOT public.mastermind_review_reuse_authorized_v1(p_household_id,p_parent_player_id,p_input) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native task authority denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-job/'||p_job_id::text,41));
 SELECT * INTO v_existing FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=p_job_id;
 IF FOUND THEN
 IF v_existing.command_sha256=p_command_sha256 AND v_existing.node_id=p_node_id
 AND v_existing.household_id=p_household_id AND v_existing.created_by_player_id=p_parent_player_id
 AND v_existing.capability='mastermind.native.review-reuse' AND v_existing.command_input=p_input THEN
 RETURN QUERY SELECT 'duplicate'::text,v_existing.job_id,v_existing.household_id,v_existing.created_at,v_existing.expires_at;RETURN;
 END IF;
 RETURN QUERY SELECT 'conflict'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 UPDATE public.mastermind_node_jobs_v1 j SET state='expired'
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND j.state IN ('queued','leased','running')) THEN
 RETURN QUERY SELECT 'busy'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 INSERT INTO public.mastermind_node_jobs_v1(job_id,household_id,node_id,command_sha256,capability,capability_version,
 policy_class,command_input,created_by_player_id,created_at,expires_at)
 VALUES(p_job_id,p_household_id,p_node_id,p_command_sha256,'mastermind.native.review-reuse',1,'routine',p_input,p_parent_player_id,v_now,p_expires_at);
 RETURN QUERY SELECT 'applied'::text,p_job_id,p_household_id,v_now,p_expires_at;
END;
$$;

ALTER TABLE public.mastermind_node_jobs_v1 DROP CONSTRAINT mastermind_node_jobs_v1_capability_check;
ALTER TABLE public.mastermind_node_jobs_v1 ADD CONSTRAINT mastermind_node_jobs_v1_capability_check CHECK (
 ((capability<>'mastermind.native.review' AND capability_version=1) OR (capability='mastermind.native.review' AND capability_version=(command_input->>'schemaVersion')::smallint)) AND policy_class='routine' AND (
 (capability IN ('family-ecosystem.ensure-running','mastermind.core.status') AND command_input='{}'::jsonb)
 OR (capability='mastermind.native.reuse' AND public.mastermind_native_input_valid_v1(command_input)
 AND command_input->>'operationId'=job_id::text)
 OR (capability='mastermind.native.catalog' AND public.mastermind_catalog_input_valid_v1(command_input))
 OR (capability='mastermind.native.review' AND public.mastermind_review_input_valid_v1(command_input) AND command_input->>'operationId'=job_id::text)
 OR (capability='mastermind.native.review-reuse' AND public.mastermind_review_reuse_input_valid_v1(command_input) AND command_input->>'operationId'=job_id::text)
OR (capability IN ('mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') AND public.mastermind_development_input_valid_v1(capability,command_input) AND command_input->>'operationId'=job_id::text)
OR (capability='mastermind.native.specification' AND public.mastermind_specification_input_valid_v1(command_input)
 AND command_input->>'operationId'=job_id::text)));

ALTER TABLE public.mastermind_node_job_receipts_v1
 DROP CONSTRAINT mastermind_node_job_receipts_v1_result_check;
ALTER TABLE public.mastermind_node_job_receipts_v1
 ADD CONSTRAINT mastermind_node_job_receipts_v1_result_check CHECK (
  result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <=
   CASE WHEN result->>'kind' IN ('mastermind.native.catalog','mastermind.native.reuse','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch') THEN 2048 ELSE 1024 END)
 );

COMMIT;
