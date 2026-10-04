BEGIN;
-- Additive, read-only native observations; original tables, ownership and execution rules unchanged.
CREATE OR REPLACE FUNCTION public.mastermind_nexus_native_node_valid_v1(n jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE k text;
BEGIN
 IF NOT public.mastermind_contribution_exact_v1(n,ARRAY['kind','specificationId','recoveryId','candidateId','importOperationId','observationSha256','dependsOn'])
 OR n->>'kind' IS DISTINCT FROM 'native-candidate-v1' OR n->'dependsOn' IS DISTINCT FROM '[]'::jsonb
 OR NOT public.mastermind_contribution_string_v1(n->'importOperationId','^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['specificationId','recoveryId','candidateId','observationSha256'] LOOP
 IF NOT public.mastermind_contribution_string_v1(n->k,'^[a-f0-9]{64}$') THEN RETURN false; END IF; END LOOP;
 RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false; END; $$;
CREATE OR REPLACE FUNCTION public.mastermind_nexus_native_choice_valid_v1(c jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE r jsonb;k text;h jsonb;
BEGIN
 IF NOT public.mastermind_contribution_exact_v1(c,ARRAY['kind','specificationId','recoveryId','candidateId','importOperationId','observationSha256','title','sourceRefs','recovery'])
 OR NOT public.mastermind_nexus_native_node_valid_v1((c-'title'-'sourceRefs'-'recovery')||'{"dependsOn":[]}'::jsonb)
 OR jsonb_typeof(c->'title') IS DISTINCT FROM 'string' OR octet_length(c->>'title') NOT BETWEEN 1 AND 480 OR btrim(c->>'title')='' OR c->>'title' ~ '[[:cntrl:]]'
 OR c->'sourceRefs' IS DISTINCT FROM jsonb_build_array('mastermind/native-candidate/'||(c->>'candidateId'),'mastermind/native-observation/'||(c->>'observationSha256')) THEN RETURN false; END IF;
 r:=c->'recovery';
 IF NOT public.mastermind_contribution_exact_v1(r,ARRAY['moduleId','version','sourceState','sourceVerifiedNow','recordedAccepted','hostReceiptsVerifiedNow','currentlyActive','activeProxyAvailable','recordedTestOutcome','activeRevision','holds','continuation'])
 OR jsonb_typeof(r->'moduleId') IS DISTINCT FROM 'string' OR length(r->>'moduleId')>160
 OR jsonb_typeof(r->'version') IS DISTINCT FROM 'string' OR length(r->>'version')>80
 OR COALESCE(r->>'sourceState','') NOT IN ('import_prepared','candidate_recorded_import_unreconciled','candidate_recorded')
 OR (r->'recordedTestOutcome'<>'null'::jsonb AND COALESCE(r->>'recordedTestOutcome','') NOT IN ('passed','failed','running','interrupted','held','uncertain','not_started'))
 OR (r->'activeRevision'<>'null'::jsonb AND NOT public.mastermind_contribution_string_v1(r->'activeRevision','^[a-f0-9]{64}$'))
 OR COALESCE(r->>'continuation','') NOT IN ('recover_existing_import','inspect_existing_candidate')
 OR jsonb_typeof(r->'holds') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'holds')>24 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['sourceVerifiedNow','recordedAccepted','hostReceiptsVerifiedNow','currentlyActive','activeProxyAvailable'] LOOP
 IF jsonb_typeof(r->k) IS DISTINCT FROM 'boolean' THEN RETURN false; END IF; END LOOP;
 FOR h IN SELECT value FROM jsonb_array_elements(r->'holds') LOOP
 IF NOT public.mastermind_contribution_string_v1(h,'^[A-Z][A-Z0-9_]{0,99}$') THEN RETURN false; END IF; END LOOP;
 RETURN (r->'hostReceiptsVerifiedNow'='false'::jsonb OR r->'recordedAccepted'='true'::jsonb)
 AND (r->'activeProxyAvailable'='false'::jsonb OR r->'currentlyActive'='true'::jsonb)
 AND (r->'currentlyActive'='false'::jsonb OR r->'activeRevision'=c->'candidateId');
EXCEPTION WHEN data_exception THEN RETURN false; END; $$;
CREATE OR REPLACE FUNCTION public.mastermind_nexus_proposal_valid_v1(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE k text; n jsonb; d jsonb; ids text[]:=ARRAY[]::text[]; coding_ids text[]:=ARRAY[]::text[];
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
  IF n->>'kind'='native-candidate-v1' THEN
   IF NOT public.mastermind_nexus_native_node_valid_v1(n) OR n->>'recoveryId'=ANY(ids) THEN RETURN false; END IF;
   ids:=array_append(ids,n->>'recoveryId');CONTINUE;
  END IF;
  IF NOT public.mastermind_contribution_exact_v1(n,ARRAY['specificationId','planId','dependsOn'])
  OR NOT public.mastermind_contribution_string_v1(n->'specificationId','^[a-f0-9]{64}$') OR NOT public.mastermind_contribution_string_v1(n->'planId','^[a-f0-9]{64}$')
  OR n->>'planId'=ANY(ids) OR jsonb_typeof(n->'dependsOn') IS DISTINCT FROM 'array' OR jsonb_array_length(n->'dependsOn')>32
  OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(n->'dependsOn')) THEN RETURN false; END IF;
  ids:=array_append(ids,n->>'planId');coding_ids:=array_append(coding_ids,n->>'planId');
 END LOOP;
 FOR n IN SELECT value FROM jsonb_array_elements(p->'nodes') LOOP
  FOR d IN SELECT value FROM jsonb_array_elements(n->'dependsOn') LOOP
   IF NOT public.mastermind_contribution_string_v1(d,'^[a-f0-9]{64}$') OR NOT(d#>>'{}'=ANY(coding_ids)) THEN RETURN false; END IF;
  END LOOP;
 END LOOP; RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false; END; $$;
CREATE OR REPLACE FUNCTION public.mastermind_nexus_input_valid_v1(i jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.mastermind_contribution_exact_v1(i,ARRAY['schemaVersion','operationId','taskRef','action','proposal','snapshotId','cursor'])
 OR i->'schemaVersion' NOT IN ('1'::jsonb,'2'::jsonb) OR COALESCE(i->>'action','') NOT IN ('catalog','verify')
 OR octet_length(public.mastermind_review_canonical_v1(i))>16384
 OR NOT public.mastermind_contribution_string_v1(i->'operationId','^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
 OR NOT public.mastermind_contribution_exact_v1(i->'taskRef',ARRAY['taskId','project'])
 OR NOT public.mastermind_contribution_string_v1(i->'taskRef'->'taskId','^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
 OR NOT public.mastermind_catalog_input_valid_v1(jsonb_build_object('schemaVersion',1,'taskRef',i->'taskRef','snapshotId',i->'snapshotId','cursor',i->'cursor')) THEN RETURN false; END IF;
 IF i->'schemaVersion'='2'::jsonb AND i->>'action'<>'catalog' THEN RETURN false; END IF;
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
 OR r->'schemaVersion' IS DISTINCT FROM i->'schemaVersion' OR r->>'kind' IS DISTINCT FROM 'mastermind.native.nexus'
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
 IF c->>'kind'='native-candidate-v1' THEN
 RETURN i->'schemaVersion'='2'::jsonb AND public.mastermind_nexus_native_choice_valid_v1(c)
 AND (d->'nextCursor'='null'::jsonb OR d->'nextCursor'=c->'recoveryId')
 AND (i->'cursor'='null'::jsonb OR i->'cursor'<>c->'recoveryId'); END IF;
 IF NOT public.mastermind_contribution_exact_v1(c,ARRAY['specificationId','planId','title','sourceRefs','taskRevision','historicalSnapshot'])
 OR NOT public.mastermind_contribution_string_v1(c->'specificationId','^[a-f0-9]{64}$') OR NOT public.mastermind_contribution_string_v1(c->'planId','^[a-f0-9]{64}$')
 OR NOT public.mastermind_contribution_string_v1(c->'taskRevision','^(0|[1-9][0-9]{0,14})$') OR c->'historicalSnapshot' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(c->'title') IS DISTINCT FROM 'string' OR octet_length(c->>'title') NOT BETWEEN 1 AND 480 OR btrim(c->>'title')='' OR c->>'title' ~ '[[:cntrl:]]'
 OR jsonb_typeof(c->'sourceRefs') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'sourceRefs')<>2
 OR c->'sourceRefs'->>0 IS DISTINCT FROM 'mastermind/build-plan/'||(c->>'planId')
 OR NOT public.mastermind_contribution_string_v1(c->'sourceRefs'->1,'^mastermind/source-evidence/[a-f0-9]{64}$') THEN RETURN false; END IF;
 RETURN (d->'nextCursor'='null'::jsonb OR d->'nextCursor'=c->'planId') AND (i->'cursor'='null'::jsonb OR i->'cursor'<>c->'planId');
EXCEPTION WHEN data_exception THEN RETURN false; END; $$;
REVOKE ALL ON FUNCTION public.mastermind_nexus_native_node_valid_v1(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mastermind_nexus_native_choice_valid_v1(jsonb) FROM PUBLIC;
COMMIT;
