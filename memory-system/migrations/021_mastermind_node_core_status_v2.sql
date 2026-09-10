BEGIN;
-- Prepared only; no production application is authorized by this file.
-- Capability filtering is installed before the jobs constraint is broadened.
ALTER TABLE public.mastermind_nodes_v1 ADD COLUMN IF NOT EXISTS last_worker jsonb NULL;

CREATE OR REPLACE FUNCTION public.mastermind_node_worker_valid_v2(p_worker jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE item jsonb; seen text[] := ARRAY[]::text[];
BEGIN
 IF p_worker IS NULL OR jsonb_typeof(p_worker) <> 'object'
   OR (p_worker - 'protocolVersion' - 'capabilities') <> '{}'::jsonb
   OR p_worker -> 'protocolVersion' IS NULL OR p_worker -> 'capabilities' IS NULL
   OR p_worker ->> 'protocolVersion' NOT IN ('1','2')
   OR jsonb_typeof(p_worker -> 'capabilities') <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p_worker -> 'capabilities') NOT BETWEEN 1 AND 2 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_worker -> 'capabilities') LOOP
   IF jsonb_typeof(item) <> 'object' OR (item - 'id' - 'version') <> '{}'::jsonb
     OR item ->> 'id' IS NULL OR item -> 'version' IS DISTINCT FROM '1'::jsonb
     OR item ->> 'id' NOT IN ('family-ecosystem.ensure-running','mastermind.core.status')
     OR item ->> 'id' = ANY(seen) THEN RETURN false; END IF;
   seen := array_append(seen,item ->> 'id');
 END LOOP;
 IF p_worker -> 'protocolVersion' = '1'::jsonb THEN RETURN seen = ARRAY['family-ecosystem.ensure-running']; END IF;
 RETURN p_worker -> 'protocolVersion' = '2'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.mastermind_node_worker_supports_v2(p_worker jsonb,p_capability text,p_version smallint)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
 SELECT p_version = 1 AND EXISTS (
   SELECT 1 FROM jsonb_array_elements(p_worker -> 'capabilities') AS item
   WHERE item ->> 'id' = p_capability AND item -> 'version' = '1'::jsonb
 );
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
    AND state IN ('leased', 'running')
    AND lease_expires_at > v_now
  ORDER BY created_at, job_id
  LIMIT 1
  FOR UPDATE;

  IF v_job.job_id IS NULL THEN
    SELECT * INTO v_job FROM public.mastermind_node_jobs_v1
    WHERE mastermind_node_jobs_v1.node_id = p_node_id
      AND public.mastermind_node_worker_supports_v2(p_worker, mastermind_node_jobs_v1.capability, mastermind_node_jobs_v1.capability_version)
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

CREATE OR REPLACE FUNCTION public.exchange_mastermind_node_v1(
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
  p_candidate_lease_id uuid
)
RETURNS TABLE (
  status text,
  exchange_id uuid,
  server_time timestamptz,
  acknowledged_receipt_ids uuid[],
  lease jsonb
)
LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $$
 SELECT * FROM public.exchange_mastermind_node_negotiated_v2(p_exchange_id,p_request_sha256,p_node_id,p_credential_sha256,p_boot_id,p_sent_at,p_agent_version,p_status,p_receipts,p_receipt_sha256s,p_candidate_lease_id, '{"protocolVersion":1,"capabilities":[{"id":"family-ecosystem.ensure-running","version":1}]}'::jsonb);
$$;

-- The v1 API above is now hardwired to family-only leasing, including replay/renewal.
ALTER TABLE public.mastermind_node_jobs_v1 DROP CONSTRAINT mastermind_node_jobs_v1_capability_check;
ALTER TABLE public.mastermind_node_jobs_v1 ADD CONSTRAINT mastermind_node_jobs_v1_capability_check CHECK (
 capability IN ('family-ecosystem.ensure-running','mastermind.core.status')
 AND capability_version = 1 AND policy_class = 'routine' AND command_input = '{}'::jsonb
);

CREATE OR REPLACE FUNCTION public.enqueue_mastermind_node_job_v1(
  p_job_id uuid,
  p_command_sha256 text,
  p_node_id uuid,
  p_household_id text,
  p_parent_player_id uuid,
  p_expires_at timestamptz
)
RETURNS TABLE (status text, job_id uuid, household_id text, created_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_actor record;
  v_node public.mastermind_nodes_v1%ROWTYPE;
  v_existing public.mastermind_node_jobs_v1%ROWTYPE;
BEGIN
  IF p_job_id IS NULL OR p_node_id IS NULL OR p_command_sha256 IS NULL OR p_household_id IS NULL OR p_expires_at IS NULL
    OR p_command_sha256 !~ '^[a-f0-9]{64}$'
    OR p_household_id !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR p_parent_player_id IS NULL
    OR p_expires_at <= v_now + interval '5 seconds' OR p_expires_at > v_now + interval '7 days'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid node job request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id, 0));
  SELECT * INTO v_actor FROM public.mastermind_active_parent_profile_v1(
    p_household_id, p_parent_player_id
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'node job requires an active parent';
  END IF;
  SELECT * INTO v_node FROM public.mastermind_nodes_v1
  WHERE mastermind_nodes_v1.node_id = p_node_id
    AND mastermind_nodes_v1.household_id = v_actor.household_id
    AND mastermind_nodes_v1.state = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'node is not available to this parent';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_node_id::text || ':family-ecosystem.ensure-running', 41));
  UPDATE public.mastermind_node_jobs_v1
  SET state = 'expired'
  WHERE mastermind_node_jobs_v1.node_id = p_node_id
    AND mastermind_node_jobs_v1.state = 'queued'
    AND mastermind_node_jobs_v1.expires_at <= v_now;
  UPDATE public.mastermind_node_jobs_v1
  SET state = 'failed', terminal_code = 'execution-timeout', terminal_result = NULL,
      finished_at = v_now
  WHERE mastermind_node_jobs_v1.node_id = p_node_id
    AND mastermind_node_jobs_v1.state IN ('leased', 'running')
    AND mastermind_node_jobs_v1.expires_at <= v_now;
  SELECT * INTO v_existing FROM public.mastermind_node_jobs_v1
  WHERE mastermind_node_jobs_v1.job_id = p_job_id;
  IF FOUND THEN
    IF v_existing.command_sha256 = p_command_sha256
      AND v_existing.capability = 'family-ecosystem.ensure-running'
      AND v_existing.node_id = p_node_id
      AND v_existing.created_by_player_id = v_actor.player_id
    THEN
      RETURN QUERY SELECT 'duplicate'::text, v_existing.job_id, v_existing.household_id,
        v_existing.created_at, v_existing.expires_at;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'conflict'::text, p_job_id, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.mastermind_node_jobs_v1
  WHERE mastermind_node_jobs_v1.node_id = p_node_id
    AND mastermind_node_jobs_v1.capability = 'family-ecosystem.ensure-running'
    AND mastermind_node_jobs_v1.state IN ('queued', 'leased', 'running')
  ORDER BY mastermind_node_jobs_v1.created_at, mastermind_node_jobs_v1.job_id
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT 'coalesced'::text, v_existing.job_id, v_existing.household_id,
      v_existing.created_at, v_existing.expires_at;
    RETURN;
  END IF;

  INSERT INTO public.mastermind_node_jobs_v1 (
    job_id, household_id, node_id, command_sha256, capability, capability_version,
    policy_class, command_input, created_by_player_id, created_at, expires_at
  ) VALUES (
    p_job_id, v_actor.household_id, p_node_id, p_command_sha256,
    'family-ecosystem.ensure-running', 1, 'routine', '{}'::jsonb,
    v_actor.player_id, v_now, p_expires_at
  );
  RETURN QUERY SELECT 'applied'::text, p_job_id, v_actor.household_id, v_now, p_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_mastermind_core_status_job_v2(
  p_job_id uuid,
  p_command_sha256 text,
  p_node_id uuid,
  p_household_id text,
  p_parent_player_id uuid,
  p_expires_at timestamptz
)
RETURNS TABLE (status text, job_id uuid, household_id text, created_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_actor record;
  v_node public.mastermind_nodes_v1%ROWTYPE;
  v_existing public.mastermind_node_jobs_v1%ROWTYPE;
BEGIN
  IF p_job_id IS NULL OR p_node_id IS NULL OR p_command_sha256 IS NULL OR p_household_id IS NULL OR p_expires_at IS NULL
    OR p_command_sha256 !~ '^[a-f0-9]{64}$'
    OR p_household_id !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR p_parent_player_id IS NULL
    OR p_expires_at <= v_now + interval '5 seconds' OR p_expires_at > v_now + interval '7 days'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid node job request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id, 0));
  SELECT * INTO v_actor FROM public.mastermind_active_parent_profile_v1(
    p_household_id, p_parent_player_id
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'node job requires an active parent';
  END IF;
  SELECT * INTO v_node FROM public.mastermind_nodes_v1
  WHERE mastermind_nodes_v1.node_id = p_node_id
    AND mastermind_nodes_v1.household_id = v_actor.household_id
    AND mastermind_nodes_v1.state = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'node is not available to this parent';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_node_id::text || ':mastermind.core.status', 41));
  UPDATE public.mastermind_node_jobs_v1
  SET state = 'expired'
  WHERE mastermind_node_jobs_v1.node_id = p_node_id
    AND mastermind_node_jobs_v1.state = 'queued'
    AND mastermind_node_jobs_v1.expires_at <= v_now;
  UPDATE public.mastermind_node_jobs_v1
  SET state = 'failed', terminal_code = 'execution-timeout', terminal_result = NULL,
      finished_at = v_now
  WHERE mastermind_node_jobs_v1.node_id = p_node_id
    AND mastermind_node_jobs_v1.state IN ('leased', 'running')
    AND mastermind_node_jobs_v1.expires_at <= v_now;
  SELECT * INTO v_existing FROM public.mastermind_node_jobs_v1
  WHERE mastermind_node_jobs_v1.job_id = p_job_id;
  IF FOUND THEN
    IF v_existing.command_sha256 = p_command_sha256
      AND v_existing.capability = 'mastermind.core.status'
      AND v_existing.node_id = p_node_id
      AND v_existing.created_by_player_id = v_actor.player_id
    THEN
      RETURN QUERY SELECT 'duplicate'::text, v_existing.job_id, v_existing.household_id,
        v_existing.created_at, v_existing.expires_at;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'conflict'::text, p_job_id, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.mastermind_node_jobs_v1
  WHERE mastermind_node_jobs_v1.node_id = p_node_id
    AND mastermind_node_jobs_v1.capability = 'mastermind.core.status'
    AND mastermind_node_jobs_v1.state IN ('queued', 'leased', 'running')
  ORDER BY mastermind_node_jobs_v1.created_at, mastermind_node_jobs_v1.job_id
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT 'coalesced'::text, v_existing.job_id, v_existing.household_id,
      v_existing.created_at, v_existing.expires_at;
    RETURN;
  END IF;

  INSERT INTO public.mastermind_node_jobs_v1 (
    job_id, household_id, node_id, command_sha256, capability, capability_version,
    policy_class, command_input, created_by_player_id, created_at, expires_at
  ) VALUES (
    p_job_id, v_actor.household_id, p_node_id, p_command_sha256,
    'mastermind.core.status', 1, 'routine', '{}'::jsonb,
    v_actor.player_id, v_now, p_expires_at
  );
  RETURN QUERY SELECT 'applied'::text, p_job_id, v_actor.household_id, v_now, p_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.exchange_mastermind_node_v2(
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
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
BEGIN
 IF p_worker -> 'protocolVersion' IS DISTINCT FROM '2'::jsonb THEN
   RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'v2 worker negotiation required';
 END IF;
 RETURN QUERY SELECT * FROM public.exchange_mastermind_node_negotiated_v2(p_exchange_id,p_request_sha256,p_node_id,p_credential_sha256,p_boot_id,p_sent_at,p_agent_version,p_status,p_receipts,p_receipt_sha256s,p_candidate_lease_id,p_worker);
END;
$$;
COMMIT;
