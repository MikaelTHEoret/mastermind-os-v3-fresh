BEGIN;
-- Never remove readers needed by recorded jobs/proposals. Disable new recovery reads instead.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 WHERE capability='mastermind.native.nexus' AND
 (command_input->'schemaVersion'='2'::jsonb OR command_input->'proposal'->'nodes' @> '[{"kind":"native-candidate-v1"}]'::jsonb))
 OR EXISTS(SELECT 1 FROM public.mastermind_task_contributions_v1 WHERE kind='nexus-proposal' AND document->'nodes' @> '[{"kind":"native-candidate-v1"}]'::jsonb)
 THEN RAISE EXCEPTION 'NEXUS_RECOVERY_HISTORY_REQUIRES_COMPATIBLE_READER'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.mastermind_nexus_proposal_valid_v1(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE k text; n jsonb; d jsonb; ids text[]:=ARRAY[]::text[];
 u text:='^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$';
BEGIN
 IF NOT public.mastermind_contribution_exact_v1(p,ARRAY['schemaVersion','kind','operationId','taskRef','seriesId','parentId','basis','title','dependencyMeaning','nodes','sourceRefs','reviewIds'])
 OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR p->>'kind' IS DISTINCT FROM 'nexus-proposal'
 OR p->>'dependencyMeaning' IS DISTINCT FROM 'source-ready-for-review'
 OR NOT public.mastermind_nexus_basis_valid_v1(p->'basis')
 OR NOT public.mastermind_contribution_exact_v1(p->'taskRef',ARRAY['taskId','project'])
 OR NOT public.mastermind_catalog_input_valid_v1(jsonb_build_object('schemaVersion',1,'taskRef',p->'taskRef','snapshotId',NULL,'cursor',NULL))
 OR NOT public.mastermind_contribution_string_v1(p->'taskRef'->'taskId',u)
 OR (p->'parentId'<>'null'::jsonb AND NOT public.mastermind_contribution_string_v1(p->'parentId','^[a-f0-9]{64}$'))
 OR jsonb_typeof(p->'title') IS DISTINCT FROM 'string' OR octet_length(p->>'title') NOT BETWEEN 1 AND 240
 OR btrim(p->>'title')='' OR p->>'title' ~ '[[:cntrl:]]'
 OR jsonb_typeof(p->'nodes') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'nodes') NOT BETWEEN 1 AND 32 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['operationId','seriesId'] LOOP IF NOT public.mastermind_contribution_string_v1(p->k,u) THEN RETURN false; END IF; END LOOP;
 FOREACH k IN ARRAY ARRAY['reviewIds','sourceRefs'] LOOP
  IF jsonb_typeof(p->k) IS DISTINCT FROM 'array' OR jsonb_array_length(p->k) NOT BETWEEN 1 AND 12
  OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p->k)) THEN RETURN false; END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(p->k) LOOP
   IF k='reviewIds' THEN IF NOT public.mastermind_contribution_string_v1(d,'^[a-f0-9]{64}$') THEN RETURN false; END IF;
   ELSE IF jsonb_typeof(d) IS DISTINCT FROM 'string' OR octet_length(d#>>'{}') NOT BETWEEN 1 AND 512 OR btrim(d#>>'{}')='' OR d#>>'{}' ~ '[[:cntrl:]]' THEN RETURN false; END IF; END IF;
  END LOOP;
 END LOOP;
 FOR n IN SELECT value FROM jsonb_array_elements(p->'nodes') LOOP
  IF NOT public.mastermind_contribution_exact_v1(n,ARRAY['specificationId','planId','dependsOn'])
  OR NOT public.mastermind_contribution_string_v1(n->'specificationId','^[a-f0-9]{64}$') OR NOT public.mastermind_contribution_string_v1(n->'planId','^[a-f0-9]{64}$')
  OR n->>'planId'=ANY(ids) OR jsonb_typeof(n->'dependsOn') IS DISTINCT FROM 'array' OR jsonb_array_length(n->'dependsOn')>32
  OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(n->'dependsOn')) THEN RETURN false; END IF;
  ids:=array_append(ids,n->>'planId');
 END LOOP;
 FOR n IN SELECT value FROM jsonb_array_elements(p->'nodes') LOOP
  FOR d IN SELECT value FROM jsonb_array_elements(n->'dependsOn') LOOP
   IF NOT public.mastermind_contribution_string_v1(d,'^[a-f0-9]{64}$') OR NOT(d#>>'{}'=ANY(ids)) THEN RETURN false; END IF;
  END LOOP;
 END LOOP; RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false; END; $$;
CREATE OR REPLACE FUNCTION public.mastermind_nexus_input_valid_v1(i jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.mastermind_contribution_exact_v1(i,ARRAY['schemaVersion','operationId','taskRef','action','proposal','snapshotId','cursor'])
 OR i->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR COALESCE(i->>'action','') NOT IN ('catalog','verify')
 OR octet_length(public.mastermind_review_canonical_v1(i))>16384
 OR NOT public.mastermind_contribution_string_v1(i->'operationId','^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
 OR NOT public.mastermind_contribution_exact_v1(i->'taskRef',ARRAY['taskId','project'])
 OR NOT public.mastermind_contribution_string_v1(i->'taskRef'->'taskId','^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
 OR NOT public.mastermind_catalog_input_valid_v1(jsonb_build_object('schemaVersion',1,'taskRef',i->'taskRef','snapshotId',i->'snapshotId','cursor',i->'cursor')) THEN RETURN false; END IF;
 IF i->>'action'='catalog' THEN RETURN i->'proposal'='null'::jsonb; END IF;
 RETURN i->'snapshotId'='null'::jsonb AND i->'cursor'='null'::jsonb AND public.mastermind_nexus_proposal_valid_v1(i->'proposal')
 AND i->'proposal'->'taskRef'=i->'taskRef' AND i->'proposal'->'operationId'<>i->'operationId';
EXCEPTION WHEN data_exception THEN RETURN false; END; $$;
CREATE OR REPLACE FUNCTION public.mastermind_nexus_result_valid_v1(r jsonb,i jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE d jsonb;c jsonb;k text;
BEGIN
 IF NOT public.mastermind_nexus_input_valid_v1(i)
 OR NOT public.mastermind_contribution_exact_v1(r,ARRAY['schemaVersion','kind','operationId','taskRef','action','requestSha256','observedAt','executionAuthorized','data'])
 OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'kind' IS DISTINCT FROM 'mastermind.native.nexus'
 OR r->'executionAuthorized' IS DISTINCT FROM 'false'::jsonb OR octet_length(public.mastermind_review_canonical_v1(r))>3072
 OR r->>'requestSha256' IS DISTINCT FROM encode(sha256(convert_to(public.mastermind_review_canonical_v1(i),'UTF8')),'hex')
 OR NOT public.mastermind_contribution_string_v1(r->'observedAt','^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
 OR to_char((r->>'observedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>r->>'observedAt' THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['operationId','taskRef','action'] LOOP IF r->k IS DISTINCT FROM i->k THEN RETURN false; END IF; END LOOP;
 d:=r->'data';
 IF i->>'action'='verify' THEN RETURN public.mastermind_contribution_exact_v1(d,ARRAY['verified','proposalSha256']) AND d->'verified'='true'::jsonb
  AND d->>'proposalSha256'=encode(sha256(convert_to(public.mastermind_review_canonical_v1(i->'proposal'),'UTF8')),'hex'); END IF;
 IF NOT public.mastermind_contribution_exact_v1(d,ARRAY['basis','snapshotId','choice','nextCursor']) OR NOT public.mastermind_nexus_basis_valid_v1(d->'basis')
 OR NOT public.mastermind_contribution_string_v1(d->'snapshotId','^[a-f0-9]{64}$')
 OR (i->'snapshotId'<>'null'::jsonb AND d->'snapshotId'<>i->'snapshotId') THEN RETURN false; END IF;
 c:=d->'choice';IF c='null'::jsonb THEN RETURN d->'nextCursor'='null'::jsonb; END IF;
 IF NOT public.mastermind_contribution_exact_v1(c,ARRAY['specificationId','planId','title','sourceRefs','taskRevision','historicalSnapshot'])
 OR NOT public.mastermind_contribution_string_v1(c->'specificationId','^[a-f0-9]{64}$') OR NOT public.mastermind_contribution_string_v1(c->'planId','^[a-f0-9]{64}$')
 OR NOT public.mastermind_contribution_string_v1(c->'taskRevision','^(0|[1-9][0-9]{0,14})$') OR c->'historicalSnapshot' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(c->'title') IS DISTINCT FROM 'string' OR octet_length(c->>'title') NOT BETWEEN 1 AND 480 OR btrim(c->>'title')='' OR c->>'title' ~ '[[:cntrl:]]'
 OR jsonb_typeof(c->'sourceRefs') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'sourceRefs')<>2
 OR c->'sourceRefs'->>0 IS DISTINCT FROM 'mastermind/build-plan/'||(c->>'planId')
 OR NOT public.mastermind_contribution_string_v1(c->'sourceRefs'->1,'^mastermind/source-evidence/[a-f0-9]{64}$') THEN RETURN false; END IF;
 RETURN (d->'nextCursor'='null'::jsonb OR d->'nextCursor'=c->'planId') AND (i->'cursor'='null'::jsonb OR i->'cursor'<>c->'planId');
EXCEPTION WHEN data_exception THEN RETURN false; END; $$;
DROP FUNCTION public.mastermind_nexus_native_choice_valid_v1(jsonb);
DROP FUNCTION public.mastermind_nexus_native_node_valid_v1(jsonb);
COMMIT;
