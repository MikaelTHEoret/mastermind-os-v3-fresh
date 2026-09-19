BEGIN;
-- Reader-first, additive transport support. No task/permission/job data writes.
CREATE OR REPLACE FUNCTION public.mastermind_review_canonical_json_v2(v json, depth integer DEFAULT 0, path text[] DEFAULT ARRAY[]::text[], marker text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE result text; raw text;
BEGIN
 IF depth>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='review depth limit'; END IF;
 CASE json_typeof(v)
 WHEN 'object' THEN
  IF (SELECT count(*)<>count(DISTINCT key COLLATE "C") OR COALESCE(bool_or(marker IS NOT NULL AND strpos(key,marker)>0),false) FROM json_each(v)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate review keys'; END IF;
  SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||public.mastermind_review_canonical_json_v2(value,depth+1,path||key,marker),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM json_each(v);
 WHEN 'array' THEN
  SELECT '['||COALESCE(string_agg(public.mastermind_review_canonical_json_v2(value,depth+1,path||(ord-1)::text,marker),',' ORDER BY ord),'')||']' INTO result FROM json_array_elements(v) WITH ORDINALITY AS a(value,ord);
 WHEN 'number' THEN
  IF v::text !~ '^-?(0|[1-9][0-9]*)$' OR v::text='-0' OR abs(v::text::numeric)>9007199254740991 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='review safe integer required'; END IF;
  result:=v::text;
 WHEN 'string' THEN
  raw:=v#>>'{}';
  IF marker IS NOT NULL AND strpos(raw,marker)>0 AND NOT COALESCE(path[1:3]=ARRAY['requirements','tests','cases'] AND path[4] ~ '^[0-9]+$' AND path[5] IN ('input','expected'),false) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='NUL outside example data';
  END IF;
  result:=to_jsonb(raw)::text;
 ELSE result:=v::text;
 END CASE;
 RETURN result;
END; $$;

-- PostgreSQL's json accessors also decode nested strings. Use an absent BMP
-- marker only during structural inspection; restore the ORIGINAL escape for
-- content/requirement/test hashing. Literal backslash-u remains distinct.
CREATE OR REPLACE FUNCTION public.mastermind_review_marker_v2(raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE n integer; escaped text;
BEGIN
 IF raw IS NULL OR octet_length(raw)>20480 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='review content limit'; END IF;
 FOR n IN 57344..65533 LOOP
  escaped:=E'\\u'||to_hex(n);
  IF strpos(raw,chr(n))=0 AND strpos(lower(raw),escaped)=0 THEN RETURN chr(n); END IF;
 END LOOP;
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='review marker unavailable';
END; $$;
CREATE OR REPLACE FUNCTION public.mastermind_review_content_json_v2(i jsonb)
RETURNS json LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE raw text; marker text;
BEGIN
 IF i->'schemaVersion'='2'::jsonb THEN
  raw:=i->>'content';marker:=public.mastermind_review_marker_v2(raw);
  RETURN replace(raw,E'\\u0000',E'\\u'||to_hex(ascii(marker)))::json;
 END IF;
 RETURN public.mastermind_review_canonical_v1(i->'content')::json;
END; $$;
CREATE OR REPLACE FUNCTION public.mastermind_review_part_text_v2(i jsonb,p text[])
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE raw text; marker text; escaped text; inspected text; restored text; part text;
BEGIN
 IF i->'schemaVersion'='2'::jsonb THEN
  raw:=i->>'content';marker:=public.mastermind_review_marker_v2(raw);escaped:=E'\\u'||to_hex(ascii(marker));
  inspected:=public.mastermind_review_canonical_json_v2(replace(raw,E'\\u0000',escaped)::json,0,ARRAY[]::text[],marker);
  restored:=replace(replace(inspected,marker,E'\\u0000'),escaped,E'\\u0000');
  IF restored IS DISTINCT FROM raw THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='noncanonical review content'; END IF;
  part:=(inspected::json#>p)::text;
  RETURN replace(replace(part,marker,E'\\u0000'),escaped,E'\\u0000');
 END IF;
 RETURN public.mastermind_review_canonical_v1((i->'content')#>p);
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_review_input_valid_v1(p_input jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE c json; r json; encoded boolean; canonical text;
BEGIN
 encoded:=p_input->'schemaVersion'='2'::jsonb;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
 OR octet_length(p_input::text)>(CASE WHEN encoded THEN 28672 ELSE 24576 END)
 OR NOT(p_input ?& ARRAY['schemaVersion','action','taskRef','operationId','specificationId','parentOperationId','originalRequest','content'])
 OR p_input-ARRAY['schemaVersion','action','taskRef','operationId','specificationId','parentOperationId','originalRequest','content']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'originalRequest') IS DISTINCT FROM 'string' OR length(p_input->>'originalRequest') NOT BETWEEN 1 AND 4000
 OR p_input->'schemaVersion' NOT IN ('1'::jsonb,'2'::jsonb) OR p_input->>'action' IS DISTINCT FROM 'prepare'
 OR COALESCE(p_input->>'operationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR COALESCE(p_input->>'parentOperationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR p_input->>'operationId'=p_input->>'parentOperationId'
 OR COALESCE(p_input->>'specificationId','') !~ '^[a-f0-9]{64}$'
 OR NOT public.mastermind_catalog_input_valid_v1(jsonb_build_object('schemaVersion',1,'taskRef',p_input->'taskRef','snapshotId',NULL,'cursor',NULL))
 THEN RETURN false; END IF;
 IF octet_length(public.mastermind_review_canonical_v1(p_input))>(CASE WHEN encoded THEN 24576 ELSE 16384 END) THEN RETURN false; END IF;
 IF encoded AND (jsonb_typeof(p_input->'content') IS DISTINCT FROM 'string' OR octet_length(p_input->>'content')>20480) THEN RETURN false; END IF;
 c:=public.mastermind_review_content_json_v2(p_input);r:=c->'requirements';
 IF encoded THEN
  canonical:=public.mastermind_review_part_text_v2(p_input,ARRAY[]::text[]);
  IF canonical IS DISTINCT FROM p_input->>'content' THEN RETURN false; END IF;
 END IF;
 IF json_typeof(c) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM json_object_keys(c))<>8
 OR EXISTS(SELECT 1 FROM json_object_keys(c) k WHERE k<>ALL(ARRAY['schemaVersion','specificationId','requestSha256','mode','requirements','coverage','expectedActiveRevision','reuseEvidence']))
 OR (c->'schemaVersion')::text IS DISTINCT FROM '1' OR c->>'specificationId' IS DISTINCT FROM p_input->>'specificationId'
 OR COALESCE(c->>'requestSha256','') !~ '^[a-f0-9]{64}$' OR COALESCE(c->>'mode','') NOT IN ('create','extend','reuse','assimilate')
 OR c->'expectedActiveRevision' IS NULL OR ((c->'expectedActiveRevision')::text<>'null' AND COALESCE(c->>'expectedActiveRevision','') !~ '^[a-f0-9]{64}$')
 OR json_typeof(r) IS DISTINCT FROM 'object' OR (r->'schemaVersion')::text IS DISTINCT FROM '1'
 OR r->>'kind' IS DISTINCT FROM 'mastermind.module-requirements' OR (r->'taskRef')::jsonb IS DISTINCT FROM ((p_input->'taskRef')-'checkpointId')
 OR json_typeof(r->'requirements') IS DISTINCT FROM 'array' OR json_typeof(r->'contracts') IS DISTINCT FROM 'array'
 OR json_typeof(r->'tests') IS DISTINCT FROM 'object' OR (r->'tests'->'schemaVersion')::text IS DISTINCT FROM '1'
 OR json_typeof(r->'tests'->'cases') IS DISTINCT FROM 'array' OR json_typeof(c->'coverage') IS DISTINCT FROM 'array'
 THEN RETURN false; END IF;
 RETURN json_array_length(r->'requirements') BETWEEN 1 AND 64 AND json_array_length(r->'contracts') BETWEEN 1 AND 8
  AND json_array_length(r->'tests'->'cases') BETWEEN 1 AND 25 AND json_array_length(c->'coverage')<=128;
EXCEPTION WHEN data_exception THEN RETURN false;
END; $$;

-- Compatible owner/receipt, worker-negotiation and job readers follow below.

CREATE OR REPLACE FUNCTION public.mastermind_review_authorized_v1(p_household text,p_actor uuid,p_input jsonb,p_result jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE parent public.mastermind_node_jobs_v1%ROWTYPE; item jsonb;
BEGIN
 IF NOT public.mastermind_review_input_valid_v1(p_input) THEN RETURN false; END IF;
 SELECT * INTO parent FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=(p_input->>'parentOperationId')::uuid
  AND j.household_id=p_household AND j.created_by_player_id=p_actor AND j.capability='mastermind.native.specification'
  AND j.state='succeeded' AND j.command_input->'taskRef'=p_input->'taskRef'
  AND j.terminal_result->'specification'->'specificationId'=p_input->'specificationId';
 IF NOT FOUND OR NOT public.mastermind_specification_authorized_v1(p_household,p_actor,parent.command_input,parent.terminal_result)
  OR p_input->'originalRequest' IS DISTINCT FROM parent.command_input->'request'
  OR public.mastermind_review_content_json_v2(p_input)->>'requestSha256' IS DISTINCT FROM encode(sha256(convert_to((parent.command_input->'request')::text,'UTF8')),'hex')
 THEN RETURN false; END IF;
 IF p_result IS NOT NULL THEN
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>2048
  OR NOT(p_result ?& ARRAY['kind','ok','schemaVersion','taskRef','operationId','specificationId','contentSha256','reviewId','state','holds','replayed','accepted','executionAuthorized'])
  OR p_result-ARRAY['kind','ok','schemaVersion','taskRef','operationId','specificationId','contentSha256','reviewId','state','holds','replayed','accepted','executionAuthorized']<>'{}'::jsonb
  OR p_result->>'kind' IS DISTINCT FROM 'mastermind.native.review' OR p_result->'ok' IS DISTINCT FROM 'true'::jsonb
  OR p_result->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR p_result->'accepted' IS DISTINCT FROM 'false'::jsonb
  OR p_result->'executionAuthorized' IS DISTINCT FROM 'false'::jsonb
  OR p_result->'taskRef' IS DISTINCT FROM p_input->'taskRef' OR p_result->'operationId' IS DISTINCT FROM p_input->'operationId'
  OR p_result->'specificationId' IS DISTINCT FROM p_input->'specificationId'
  OR p_result->>'contentSha256' IS DISTINCT FROM encode(sha256(convert_to(public.mastermind_review_part_text_v2(p_input,ARRAY[]::text[]),'UTF8')),'hex')
  OR COALESCE(p_result->>'reviewId','') !~ '^[a-f0-9]{64}$' OR COALESCE(p_result->>'state','') NOT IN ('held','proposed')
  OR jsonb_typeof(p_result->'replayed') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_result->'holds') IS DISTINCT FROM 'array'
  THEN RETURN false; END IF;
  IF jsonb_array_length(p_result->'holds')>16 OR (p_result->>'state'='held')<>(jsonb_array_length(p_result->'holds')>0) THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'holds') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR item#>>'{}' !~ '^[A-Z][A-Z0-9_]{1,95}$' THEN RETURN false; END IF;
  END LOOP;
 END IF;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mastermind_review_reuse_authorized_v1(p_household text,p_actor uuid,p_input jsonb,p_result jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE parent public.mastermind_node_jobs_v1%ROWTYPE; expected jsonb;
BEGIN
 IF NOT public.mastermind_review_reuse_input_valid_v1(p_input) THEN RETURN false; END IF;
 SELECT * INTO parent FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=(p_input->>'parentOperationId')::uuid
  AND j.household_id=p_household AND j.created_by_player_id=p_actor AND j.state='succeeded' AND j.command_input->'taskRef'=p_input->'taskRef';
 IF NOT FOUND OR parent.terminal_result->'specificationId' IS DISTINCT FROM p_input->'specificationId'
  OR parent.terminal_result->'reviewId' IS DISTINCT FROM p_input->'reviewId' THEN RETURN false; END IF;
 IF p_input->>'action'='assess' THEN
  IF parent.capability<>'mastermind.native.review' OR NOT public.mastermind_review_authorized_v1(p_household,p_actor,parent.command_input,parent.terminal_result) THEN RETURN false; END IF;
 ELSE
  IF parent.capability<>'mastermind.native.review-reuse' OR parent.command_input->>'action'<>'assess'
   OR NOT public.mastermind_review_reuse_authorized_v1(p_household,p_actor,parent.command_input,parent.terminal_result)
   OR parent.terminal_result->'holds'<>'[]'::jsonb
   OR parent.terminal_result->'qualificationId' IS DISTINCT FROM p_input->'qualificationId'
   OR parent.terminal_result->'acceptedSpecificationId' IS DISTINCT FROM p_input->'acceptedSpecificationId' THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('field',value,'disposition',CASE WHEN value='tests' THEN 'retain-full-suite-and-add-evidence' ELSE 'retain-accepted-baseline' END) ORDER BY ord),'[]'::jsonb) INTO expected
   FROM jsonb_array_elements_text(parent.terminal_result->'differences') WITH ORDINALITY AS d(value,ord);
  IF expected IS DISTINCT FROM p_input->'decisions' THEN RETURN false; END IF;
  IF parent.terminal_result->'existingOperationId'<>'null'::jsonb AND parent.terminal_result->'existingOperationId' IS DISTINCT FROM p_input->'operationId' THEN RETURN false; END IF;
 END IF;
 IF p_result IS NOT NULL THEN
  IF NOT public.mastermind_review_reuse_result_valid_v1(p_result,p_input) THEN RETURN false; END IF;
  IF p_input->>'action'='assess' AND (public.mastermind_review_content_json_v2(parent.command_input)->'expectedActiveRevision')::jsonb IS DISTINCT FROM p_result->'candidateId' THEN RETURN false; END IF;
  IF p_input->>'action'='accept' AND (parent.terminal_result->'candidateId' IS DISTINCT FROM p_result->'candidateId'
    OR parent.terminal_result->'existingLinkId'<>'null'::jsonb AND parent.terminal_result->'existingLinkId' IS DISTINCT FROM p_result->'linkId') THEN RETURN false; END IF;
 END IF;
 RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_development_authorized_v1(cap text,h text,a uuid,i jsonb,r jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE parent public.mastermind_node_jobs_v1%ROWTYPE; requirement json;
BEGIN
 IF NOT public.mastermind_development_input_valid_v1(cap,i) THEN RETURN false; END IF;
 SELECT * INTO parent FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=(i->>'parentOperationId')::uuid
  AND j.household_id=h AND j.created_by_player_id=a AND j.capability='mastermind.native.review' AND j.state='succeeded'
  AND j.command_input->'taskRef'=i->'taskRef' AND j.terminal_result->'specificationId'=i->'specificationId'
  AND j.terminal_result->'reviewId'=i->'reviewId';
 IF NOT FOUND OR NOT public.mastermind_review_authorized_v1(h,a,parent.command_input,parent.terminal_result)
 OR public.mastermind_review_content_json_v2(parent.command_input)->>'mode' NOT IN ('create','extend') THEN RETURN false; END IF;
 requirement:=public.mastermind_review_content_json_v2(parent.command_input)->'requirements';
 -- A local operation identity cannot be reassigned by a new network job.
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.capability IN ('mastermind.native.review-artifacts','mastermind.native.review-build-plan')
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

CREATE OR REPLACE FUNCTION public.mastermind_node_worker_valid_v2(p_worker jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE item jsonb; seen text[] := ARRAY[]::text[];
BEGIN
 IF p_worker IS NULL OR jsonb_typeof(p_worker) <> 'object'
   OR (p_worker - 'protocolVersion' - 'capabilities') <> '{}'::jsonb
   OR p_worker -> 'protocolVersion' IS NULL OR p_worker -> 'capabilities' IS NULL
   OR p_worker ->> 'protocolVersion' NOT IN ('1','2')
   OR jsonb_typeof(p_worker -> 'capabilities') <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p_worker -> 'capabilities') NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_worker -> 'capabilities') LOOP
   IF jsonb_typeof(item) <> 'object' OR (item - 'id' - 'version') <> '{}'::jsonb
     OR item ->> 'id' IS NULL OR (item -> 'version'='1'::jsonb OR item->>'id'='mastermind.native.review' AND item->'version'='2'::jsonb) IS NOT TRUE
     OR item ->> 'id' NOT IN ('family-ecosystem.ensure-running','mastermind.core.status','mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan')
     OR item ->> 'id' = ANY(seen) THEN RETURN false; END IF;
   seen := array_append(seen,item ->> 'id');
 END LOOP;
 IF p_worker -> 'protocolVersion' = '1'::jsonb THEN RETURN seen = ARRAY['family-ecosystem.ensure-running']; END IF;
 RETURN p_worker -> 'protocolVersion' = '2'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.mastermind_node_worker_supports_v2(p_worker jsonb,p_capability text,p_version smallint)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM jsonb_array_elements(p_worker -> 'capabilities') AS item
   WHERE item ->> 'id' = p_capability AND ((p_version=1 AND item->'version'='1'::jsonb) OR (p_capability='mastermind.native.review' AND p_version IN (1,2) AND item->'version'='2'::jsonb))
 );
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
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan') AND j.state IN ('queued','leased','running')) THEN
 RETURN QUERY SELECT 'busy'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 INSERT INTO public.mastermind_node_jobs_v1(job_id,household_id,node_id,command_sha256,capability,capability_version,
 policy_class,command_input,created_by_player_id,created_at,expires_at)
 VALUES(p_job_id,p_household_id,p_node_id,p_command_sha256,'mastermind.native.review',(p_input->>'schemaVersion')::smallint,'routine',p_input,p_parent_player_id,v_now,p_expires_at);
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
OR (capability IN ('mastermind.native.review-artifacts','mastermind.native.review-build-plan') AND public.mastermind_development_input_valid_v1(capability,command_input) AND command_input->>'operationId'=job_id::text)
OR (capability='mastermind.native.specification' AND public.mastermind_specification_input_valid_v1(command_input)
 AND command_input->>'operationId'=job_id::text)));

COMMIT;
