BEGIN;
-- Source for the review-reuse additions in migration030. No new tables or grants.
CREATE OR REPLACE FUNCTION public.mastermind_review_reuse_input_valid_v1(v jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE d jsonb;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR octet_length(v::text)>3072
 OR NOT(v ?& ARRAY['schemaVersion','action','taskRef','operationId','parentOperationId','specificationId','reviewId','acceptedSpecificationId','qualificationId','decisions'])
 OR v-ARRAY['schemaVersion','action','taskRef','operationId','parentOperationId','specificationId','reviewId','acceptedSpecificationId','qualificationId','decisions']<>'{}'::jsonb
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR COALESCE(v->>'action','') NOT IN ('assess','accept')
 OR COALESCE(v->>'operationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR COALESCE(v->>'parentOperationId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR v->'operationId'=v->'parentOperationId'
 OR COALESCE(v->>'specificationId','') !~ '^[a-f0-9]{64}$' OR COALESCE(v->>'reviewId','') !~ '^[a-f0-9]{64}$'
 OR NOT public.mastermind_catalog_input_valid_v1(jsonb_build_object('schemaVersion',1,'taskRef',v->'taskRef','snapshotId',NULL,'cursor',NULL))
 OR jsonb_typeof(v->'decisions') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF octet_length(public.mastermind_review_canonical_v1(v))>2048 THEN RETURN false; END IF;
 IF v->>'action'='assess' THEN RETURN v->'acceptedSpecificationId'='null'::jsonb AND v->'qualificationId'='null'::jsonb AND v->'decisions'='[]'::jsonb; END IF;
 IF COALESCE(v->>'acceptedSpecificationId','') !~ '^[a-f0-9]{64}$' OR COALESCE(v->>'qualificationId','') !~ '^[a-f0-9]{64}$'
 OR jsonb_array_length(v->'decisions')>4 THEN RETURN false; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(v->'decisions') LOOP
  IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR NOT(d ?& ARRAY['field','disposition']) OR d-ARRAY['field','disposition']<>'{}'::jsonb
   OR COALESCE(d->>'field','') NOT IN ('authority','acceptanceWorkflow','examples','tests')
   OR d->>'disposition' IS DISTINCT FROM (CASE WHEN d->>'field'='tests' THEN 'retain-full-suite-and-add-evidence' ELSE 'retain-accepted-baseline' END)
  THEN RETURN false; END IF;
 END LOOP;
 RETURN (SELECT count(*)=count(DISTINCT value->>'field') FROM jsonb_array_elements(v->'decisions'));
EXCEPTION WHEN invalid_parameter_value THEN RETURN false;
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
  IF p_input->>'action'='assess' AND parent.command_input->'content'->'expectedActiveRevision' IS DISTINCT FROM p_result->'candidateId' THEN RETURN false; END IF;
  IF p_input->>'action'='accept' AND (parent.terminal_result->'candidateId' IS DISTINCT FROM p_result->'candidateId'
    OR parent.terminal_result->'existingLinkId'<>'null'::jsonb AND parent.terminal_result->'existingLinkId' IS DISTINCT FROM p_result->'linkId') THEN RETURN false; END IF;
 END IF;
 RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.mastermind_review_family_authorized_v1(cap text,h text,a uuid,i jsonb,r jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT CASE cap WHEN 'mastermind.native.review' THEN public.mastermind_review_authorized_v1(h,a,i,r)
 WHEN 'mastermind.native.review-reuse' THEN public.mastermind_review_reuse_authorized_v1(h,a,i,r) ELSE false END;
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
 IF jsonb_array_length(p_worker -> 'capabilities') NOT BETWEEN 1 AND 6 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_worker -> 'capabilities') LOOP
   IF jsonb_typeof(item) <> 'object' OR (item - 'id' - 'version') <> '{}'::jsonb
     OR item ->> 'id' IS NULL OR item -> 'version' IS DISTINCT FROM '1'::jsonb
     OR item ->> 'id' NOT IN ('family-ecosystem.ensure-running','mastermind.core.status','mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse')
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
      AND (mastermind_node_jobs_v1.capability NOT IN ('mastermind.native.review','mastermind.native.review-reuse') OR public.mastermind_review_family_authorized_v1(mastermind_node_jobs_v1.capability,mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
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
      AND (mastermind_node_jobs_v1.capability NOT IN ('mastermind.native.review','mastermind.native.review-reuse') OR public.mastermind_review_family_authorized_v1(mastermind_node_jobs_v1.capability,mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
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

    IF v_job.capability IN ('mastermind.native.review','mastermind.native.review-reuse') THEN
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
      AND (mastermind_node_jobs_v1.capability NOT IN ('mastermind.native.review','mastermind.native.review-reuse') OR public.mastermind_review_family_authorized_v1(mastermind_node_jobs_v1.capability,mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
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
      AND (mastermind_node_jobs_v1.capability NOT IN ('mastermind.native.review','mastermind.native.review-reuse') OR public.mastermind_review_family_authorized_v1(mastermind_node_jobs_v1.capability,mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))
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
ALTER TABLE public.mastermind_node_jobs_v1 DROP CONSTRAINT mastermind_node_jobs_v1_capability_check;
ALTER TABLE public.mastermind_node_jobs_v1 ADD CONSTRAINT mastermind_node_jobs_v1_capability_check CHECK (
 capability_version=1 AND policy_class='routine' AND (
 (capability IN ('family-ecosystem.ensure-running','mastermind.core.status') AND command_input='{}'::jsonb)
 OR (capability='mastermind.native.reuse' AND public.mastermind_native_input_valid_v1(command_input)
 AND command_input->>'operationId'=job_id::text)
 OR (capability='mastermind.native.catalog' AND public.mastermind_catalog_input_valid_v1(command_input))
 OR (capability='mastermind.native.review' AND public.mastermind_review_input_valid_v1(command_input) AND command_input->>'operationId'=job_id::text)
 OR (capability='mastermind.native.review-reuse' AND public.mastermind_review_reuse_input_valid_v1(command_input) AND command_input->>'operationId'=job_id::text)
OR (capability='mastermind.native.specification' AND public.mastermind_specification_input_valid_v1(command_input)
 AND command_input->>'operationId'=job_id::text)));
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
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') AND j.state IN ('queued','leased','running')) THEN
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
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') AND j.state IN ('queued','leased','running')) THEN
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
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') AND j.state IN ('queued','leased','running')) THEN
 RETURN QUERY SELECT 'busy'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 INSERT INTO public.mastermind_node_jobs_v1(job_id,household_id,node_id,command_sha256,capability,capability_version,
 policy_class,command_input,created_by_player_id,created_at,expires_at)
 VALUES(p_job_id,p_household_id,p_node_id,p_command_sha256,'mastermind.native.specification',1,'routine',p_input,p_parent_player_id,v_now,p_expires_at);
 RETURN QUERY SELECT 'applied'::text,p_job_id,p_household_id,v_now,p_expires_at;
END;
$$;


-- Preserve the legacy result bound; typed native envelopes use their accepted broker limit.
-- Wire receipts remain bounded to2048 bytes and local durable receipts to4096 bytes.
ALTER TABLE public.mastermind_node_job_receipts_v1
 DROP CONSTRAINT mastermind_node_job_receipts_v1_result_check;
ALTER TABLE public.mastermind_node_job_receipts_v1
 ADD CONSTRAINT mastermind_node_job_receipts_v1_result_check CHECK (
  result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <=
   CASE WHEN result->>'kind' IN ('mastermind.native.catalog','mastermind.native.reuse','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') THEN 2048 ELSE 1024 END)
 );


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
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') AND j.state IN ('queued','leased','running')) THEN
 RETURN QUERY SELECT 'busy'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 INSERT INTO public.mastermind_node_jobs_v1(job_id,household_id,node_id,command_sha256,capability,capability_version,
 policy_class,command_input,created_by_player_id,created_at,expires_at)
 VALUES(p_job_id,p_household_id,p_node_id,p_command_sha256,'mastermind.native.review',1,'routine',p_input,p_parent_player_id,v_now,p_expires_at);
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
 WHERE j.node_id=p_node_id AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') AND j.state='queued' AND j.expires_at<=v_now;
 IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 j WHERE j.node_id=p_node_id
 AND j.capability IN ('mastermind.native.reuse','mastermind.native.catalog','mastermind.native.specification','mastermind.native.review','mastermind.native.review-reuse') AND j.state IN ('queued','leased','running')) THEN
 RETURN QUERY SELECT 'busy'::text,p_job_id,NULL::text,NULL::timestamptz,NULL::timestamptz;RETURN;
 END IF;
 INSERT INTO public.mastermind_node_jobs_v1(job_id,household_id,node_id,command_sha256,capability,capability_version,
 policy_class,command_input,created_by_player_id,created_at,expires_at)
 VALUES(p_job_id,p_household_id,p_node_id,p_command_sha256,'mastermind.native.review-reuse',1,'routine',p_input,p_parent_player_id,v_now,p_expires_at);
 RETURN QUERY SELECT 'applied'::text,p_job_id,p_household_id,v_now,p_expires_at;
END;
$$;


COMMIT;
