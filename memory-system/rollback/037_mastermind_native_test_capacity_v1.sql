BEGIN;
-- Refuse incompatible downgrade once larger-suite ledger history exists.
LOCK TABLE public.mastermind_node_jobs_v1 IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 WHERE
  capability IN ('mastermind.native.review','mastermind.native.review-reuse','mastermind.native.contribution-lifecycle')
  AND state IN ('queued','leased','running'))
 THEN RAISE EXCEPTION 'NATIVE_TEST_CAPACITY_DRAIN_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE
  (j.capability='mastermind.native.contribution-lifecycle' AND (j.terminal_result->'data'->'test'->>'caseCount')::numeric>25)
  OR (j.capability='mastermind.native.review-reuse' AND (j.terminal_result->>'suiteCaseCount')::numeric>25)
  OR (j.capability='mastermind.native.review' AND
      json_array_length(public.mastermind_review_content_json_v2(j.command_input)->'requirements'->'tests'->'cases')>25))
 THEN RAISE EXCEPTION 'NATIVE_TEST_CAPACITY_HISTORY_REQUIRES_COMPATIBLE_READERS'; END IF;
END;
$guard$;
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

CREATE OR REPLACE FUNCTION public.mastermind_review_reuse_result_valid_v1(v jsonb,i jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE common text[]:=ARRAY['kind','schemaVersion','action','taskRef','operationId','specificationId','reviewId','acceptedSpecificationId','qualificationId','candidateId','replayed','executionAuthorized']; extra text[]; k text; item jsonb;
BEGIN
 extra:=CASE WHEN i->>'action'='assess' THEN ARRAY['differences','holds','exampleCount','coveredCount','suiteCaseCount','existingOperationId','existingLinkId'] ELSE ARRAY['linkId','reuseLinkAccepted','reviewAccepted'] END;
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR octet_length(v::text)>2048 OR NOT(v ?& (common||extra)) OR v-(common||extra)<>'{}'::jsonb
 OR v->>'kind' IS DISTINCT FROM 'mastermind.native.review-reuse' OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR v->'executionAuthorized' IS DISTINCT FROM 'false'::jsonb OR jsonb_typeof(v->'replayed') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['action','taskRef','operationId','specificationId','reviewId'] LOOP
  IF v->k IS DISTINCT FROM i->k THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['acceptedSpecificationId','qualificationId','candidateId'] LOOP
  IF COALESCE(v->>k,'') !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 END LOOP;
 IF i->>'action'='accept' THEN
  RETURN v->'acceptedSpecificationId'=i->'acceptedSpecificationId' AND v->'qualificationId'=i->'qualificationId'
   AND COALESCE(v->>'linkId','') ~ '^[a-f0-9]{64}$' AND v->'reuseLinkAccepted'='true'::jsonb AND v->'reviewAccepted'='false'::jsonb;
 END IF;
 IF jsonb_typeof(v->'differences') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'holds') IS DISTINCT FROM 'array'
 OR jsonb_array_length(v->'differences')>8 OR jsonb_array_length(v->'holds')>4 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v->'differences') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR item#>>'{}' !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' THEN RETURN false; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(v->'holds') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR item#>>'{}' !~ '^[A-Z][A-Z0-9_]{1,95}$' THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['exampleCount','coveredCount','suiteCaseCount'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' OR v->>k !~ '^(0|[1-9][0-9]*)$' OR (v->>k)::integer>25 THEN RETURN false; END IF;
 END LOOP;
 IF (v->>'exampleCount')::integer<1 OR (v->>'coveredCount')::integer>(v->>'exampleCount')::integer THEN RETURN false; END IF;
 IF v->'holds'='[]'::jsonb AND (v->'coveredCount'<>v->'exampleCount' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v->'differences') d WHERE d NOT IN ('authority','acceptanceWorkflow','examples','tests'))) THEN RETURN false; END IF;
 IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(v->'differences')) THEN RETURN false; END IF;
 RETURN (v->'existingOperationId'='null'::jsonb AND v->'existingLinkId'='null'::jsonb) OR
 (COALESCE(v->>'existingOperationId','') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' AND COALESCE(v->>'existingLinkId','') ~ '^[a-f0-9]{64}$');
EXCEPTION WHEN invalid_parameter_value OR numeric_value_out_of_range THEN RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_lifecycle_result_valid_v1(r jsonb,i jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE d jsonb; t jsonb; k text; u text:='^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$';
BEGIN
 IF NOT public.mastermind_lifecycle_input_valid_v1(i)
 OR NOT public.mastermind_contribution_exact_v1(r,ARRAY['schemaVersion','action','taskRef','specificationId','importOperationId','candidateId','operation','lifecycleOperationId','expectedActiveRevision','operationId','kind','observedAction','observedAt','recoveryOnly','data'])
 OR r-ARRAY['kind','observedAction','observedAt','recoveryOnly','data'] IS DISTINCT FROM i
 OR r->>'kind' IS DISTINCT FROM 'mastermind.native.contribution-lifecycle'
 OR jsonb_typeof(r->'recoveryOnly') IS DISTINCT FROM 'boolean'
 OR r->>'observedAction' IS DISTINCT FROM (CASE WHEN r->'recoveryOnly'='true'::jsonb AND i->>'action'='execute' THEN 'recover' ELSE i->>'action' END)
 OR NOT public.mastermind_contribution_string_v1(r->'observedAt','^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
 OR to_char((r->>'observedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>r->>'observedAt'
 OR octet_length(public.mastermind_review_canonical_v1(r))>1800 OR octet_length(r::text)>2048 THEN RETURN false; END IF;
 d:=r->'data';t:=d->'test';
 IF NOT public.mastermind_contribution_exact_v1(d,ARRAY['operationState','moduleId','version','activeRevision','currentlyActive','activeProxyAvailable','recordedOutcome','test','rollbackRevision','rollbackAccepted','holds'])
 OR COALESCE(d->>'operationState','') NOT IN ('inspection','uncertain','running','passed','failed','held','interrupted','completed')
 OR NOT public.mastermind_contribution_string_v1(d->'moduleId','^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$')
 OR jsonb_typeof(d->'version') IS DISTINCT FROM 'string' OR length(d->>'version') NOT BETWEEN 1 AND 128
 OR d->>'version' ~ E'[\\x01-\\x1f]'
 OR d->'recordedOutcome' NOT IN ('null'::jsonb,'"passed"'::jsonb,'"failed"'::jsonb) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['activeRevision','rollbackRevision'] LOOP
  IF d->k<>'null'::jsonb AND NOT public.mastermind_contribution_string_v1(d->k,'^[a-f0-9]{64}$') THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['currentlyActive','activeProxyAvailable','rollbackAccepted'] LOOP
  IF jsonb_typeof(d->k) IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 END LOOP;
 IF (d->>'currentlyActive')::boolean IS DISTINCT FROM (d->'activeRevision'=i->'candidateId')
 OR (d->'activeProxyAvailable'='true'::jsonb AND d->'currentlyActive'<>'true'::jsonb)
 OR (d->'rollbackAccepted'='true'::jsonb AND d->'rollbackRevision'='null'::jsonb)
 OR jsonb_typeof(d->'holds') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'holds')>4 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(d->'holds') h WHERE h NOT IN ('"NATIVE_ACTIVE_PROXY_UNAVAILABLE"'::jsonb,'"NATIVE_TEST_RECONCILIATION_REQUIRED"'::jsonb,'"NATIVE_TEST_FAILED"'::jsonb,'"NATIVE_TEST_OPERATION_NOT_RECORDED"'::jsonb,'"NATIVE_TESTS_NOT_STARTED"'::jsonb))
 OR (SELECT count(*)<>count(DISTINCT h) FROM jsonb_array_elements(d->'holds') h) THEN RETURN false; END IF;
 IF t<>'null'::jsonb THEN
  IF NOT public.mastermind_contribution_exact_v1(t,ARRAY['operationId','status','caseCount','completedCases','failedCaseId'])
  OR NOT public.mastermind_contribution_string_v1(t->'operationId',u)
  OR COALESCE(t->>'status','') NOT IN ('running','passed','failed','held','interrupted')
  OR jsonb_typeof(t->'caseCount') IS DISTINCT FROM 'number' OR jsonb_typeof(t->'completedCases') IS DISTINCT FROM 'number'
  OR (t->>'caseCount')::numeric<>trunc((t->>'caseCount')::numeric) OR (t->>'completedCases')::numeric<>trunc((t->>'completedCases')::numeric)
  OR (t->>'caseCount')::numeric NOT BETWEEN 1 AND 25 OR (t->>'completedCases')::numeric NOT BETWEEN 0 AND (t->>'caseCount')::numeric
  OR (t->'failedCaseId'<>'null'::jsonb AND (jsonb_typeof(t->'failedCaseId') IS DISTINCT FROM 'string' OR length(t->>'failedCaseId')>120))
  OR (t->>'status'='passed' AND (t->'caseCount'<>t->'completedCases' OR d->>'recordedOutcome' IS DISTINCT FROM 'passed'))
  OR (i->>'operation'='test' AND t->'operationId'<>i->'lifecycleOperationId') THEN RETURN false; END IF;
 END IF;
 IF i->>'action'='inspect' THEN RETURN d->>'operationState'='inspection'; END IF;
 IF i->>'operation'='test' THEN
  RETURN CASE WHEN t='null'::jsonb THEN d->>'operationState' IN ('running','uncertain') ELSE d->>'operationState'=t->>'status' END;
 END IF;
 RETURN d->>'operationState' IN ('completed','uncertain');
EXCEPTION WHEN data_exception THEN RETURN false; END; $$;
COMMIT;
