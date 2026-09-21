BEGIN;
-- Additive readers only. Existing IDs, terminal jobs, receipts and grants are never rewritten.
CREATE OR REPLACE FUNCTION public.mastermind_review_content_json_v2(i jsonb)
RETURNS json LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE raw text; marker text;
BEGIN
 IF i->'schemaVersion' IN ('2'::jsonb,'3'::jsonb) THEN
  raw:=i->>'content';marker:=public.mastermind_review_marker_v2(raw);
  RETURN replace(raw,E'\\u0000',E'\\u'||to_hex(ascii(marker)))::json;
 END IF;
 RETURN public.mastermind_review_canonical_v1(i->'content')::json;
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_review_part_text_v2(i jsonb,p text[])
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE raw text; marker text; escaped text; inspected text; restored text; part text;
BEGIN
 IF i->'schemaVersion' IN ('2'::jsonb,'3'::jsonb) THEN
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
DECLARE c json; r json; encoded boolean; canonical text; recovery boolean; fields text[];
BEGIN
 recovery:=p_input->'schemaVersion'='3'::jsonb;
 encoded:=p_input->'schemaVersion' IN ('2'::jsonb,'3'::jsonb);
 fields:=ARRAY['schemaVersion','action','taskRef','operationId','specificationId','parentOperationId','originalRequest','content'];
 IF recovery THEN fields:=fields||'savedOperationId'::text; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
 OR octet_length(p_input::text)>(CASE WHEN encoded THEN 28672 ELSE 24576 END)
 OR NOT(p_input ?& fields)
 OR p_input-fields<>'{}'::jsonb
 OR jsonb_typeof(p_input->'originalRequest') IS DISTINCT FROM 'string' OR length(p_input->>'originalRequest') NOT BETWEEN 1 AND 4000
 OR p_input->'schemaVersion' NOT IN ('1'::jsonb,'2'::jsonb,'3'::jsonb) OR p_input->>'action' IS DISTINCT FROM (CASE WHEN recovery THEN 'recover' ELSE 'prepare' END)
 OR COALESCE(p_input->>'operationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR COALESCE(p_input->>'parentOperationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR p_input->>'operationId'=p_input->>'parentOperationId'
 OR COALESCE(p_input->>'specificationId','') !~ '^[a-f0-9]{64}$'
 OR NOT public.mastermind_catalog_input_valid_v1(jsonb_build_object('schemaVersion',1,'taskRef',p_input->'taskRef','snapshotId',NULL,'cursor',NULL))
 THEN RETURN false; END IF;
 IF recovery AND (COALESCE(p_input->>'savedOperationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR p_input->>'savedOperationId' IN (p_input->>'operationId',p_input->>'parentOperationId')) THEN RETURN false; END IF;
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

CREATE OR REPLACE FUNCTION public.mastermind_review_authorized_v1(p_household text,p_actor uuid,p_input jsonb,p_result jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE parent public.mastermind_node_jobs_v1%ROWTYPE; saved public.mastermind_node_jobs_v1%ROWTYPE; item jsonb;
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
 IF p_input->'schemaVersion'='3'::jsonb THEN
  SELECT * INTO saved FROM public.mastermind_node_jobs_v1 j WHERE j.job_id=(p_input->>'savedOperationId')::uuid
   AND j.household_id=p_household AND j.created_by_player_id=p_actor AND j.node_id=parent.node_id
   AND j.capability='mastermind.native.review' AND j.state IN ('succeeded','failed','expired')
   AND j.command_input->'schemaVersion' IN ('1'::jsonb,'2'::jsonb)
   AND j.command_input->'operationId'=p_input->'savedOperationId';
  IF NOT FOUND OR NOT public.mastermind_review_input_valid_v1(saved.command_input)
   OR saved.command_input->'taskRef' IS DISTINCT FROM p_input->'taskRef'
   OR saved.command_input->'parentOperationId' IS DISTINCT FROM p_input->'parentOperationId'
   OR saved.command_input->'specificationId' IS DISTINCT FROM p_input->'specificationId'
   OR saved.command_input->'originalRequest' IS DISTINCT FROM p_input->'originalRequest'
   OR public.mastermind_review_part_text_v2(saved.command_input,ARRAY[]::text[]) IS DISTINCT FROM p_input->>'content'
   OR (p_result IS NOT NULL AND p_result->'replayed' IS DISTINCT FROM 'true'::jsonb)
   OR (p_result IS NOT NULL AND saved.state='succeeded' AND saved.terminal_result->'reviewId' IS DISTINCT FROM p_result->'reviewId')
  THEN RETURN false; END IF;
 END IF;
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
     OR item ->> 'id' IS NULL OR (item -> 'version'='1'::jsonb OR item->>'id'='mastermind.native.review' AND item->'version' IN ('2'::jsonb,'3'::jsonb)) IS NOT TRUE
     OR item ->> 'id' NOT IN ('family-ecosystem.ensure-running','mastermind.core.status','mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan','mastermind.native.review-build-dispatch')
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
   WHERE item ->> 'id' = p_capability AND ((p_version=1 AND item->'version'='1'::jsonb) OR (p_capability='mastermind.native.review' AND p_version IN (1,2,3) AND item->'version' IN ('2'::jsonb,'3'::jsonb) AND p_version<=(item->>'version')::smallint))
 );
$$;
COMMIT;
