BEGIN;

CREATE TABLE IF NOT EXISTS public.mastermind_nodes_v1 (
  node_id uuid NOT NULL,
  household_id text NOT NULL,
  display_name text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  credential_sha256 text NOT NULL,
  agent_version text NOT NULL,
  created_by_player_id uuid NOT NULL,
  paired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz NULL,
  last_exchange_at timestamptz NULL,
  last_exchange_id uuid NULL,
  last_boot_id uuid NULL,
  last_status jsonb NULL,
  last_job_receipt_at timestamptz NULL,
  CONSTRAINT mastermind_nodes_v1_pkey PRIMARY KEY (node_id),
  CONSTRAINT mastermind_nodes_v1_household_node_key UNIQUE (household_id, node_id),
  CONSTRAINT mastermind_nodes_v1_credential_key UNIQUE (credential_sha256),
  CONSTRAINT mastermind_nodes_v1_household_fkey FOREIGN KEY (household_id)
    REFERENCES public.mastermind_households_v1(household_id),
  CONSTRAINT mastermind_nodes_v1_creator_fkey FOREIGN KEY (household_id, created_by_player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_nodes_v1_name_check CHECK (
    char_length(display_name) BETWEEN 1 AND 64
    AND display_name = btrim(display_name)
    AND display_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mastermind_nodes_v1_state_check CHECK (state IN ('active', 'revoked')),
  CONSTRAINT mastermind_nodes_v1_credential_check CHECK (credential_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT mastermind_nodes_v1_agent_version_check CHECK (
    agent_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$'
  ),
  CONSTRAINT mastermind_nodes_v1_revocation_check CHECK (
    (state = 'active' AND revoked_at IS NULL)
    OR (state = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT mastermind_nodes_v1_status_check CHECK (
    last_status IS NULL
    OR (jsonb_typeof(last_status) = 'object' AND octet_length(last_status::text) <= 8192)
  )
);

CREATE INDEX IF NOT EXISTS mastermind_nodes_v1_household_state_idx
  ON public.mastermind_nodes_v1 (household_id, state, paired_at DESC, node_id);

CREATE TABLE IF NOT EXISTS public.mastermind_node_pairings_v1 (
  pairing_id uuid NOT NULL,
  pairing_sha256 text NOT NULL,
  household_id text NOT NULL,
  created_by_player_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz NULL,
  node_id uuid NULL,
  CONSTRAINT mastermind_node_pairings_v1_pkey PRIMARY KEY (pairing_id),
  CONSTRAINT mastermind_node_pairings_v1_token_key UNIQUE (pairing_sha256),
  CONSTRAINT mastermind_node_pairings_v1_household_fkey FOREIGN KEY (household_id)
    REFERENCES public.mastermind_households_v1(household_id),
  CONSTRAINT mastermind_node_pairings_v1_creator_fkey FOREIGN KEY (household_id, created_by_player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_node_pairings_v1_node_fkey FOREIGN KEY (household_id, node_id)
    REFERENCES public.mastermind_nodes_v1(household_id, node_id),
  CONSTRAINT mastermind_node_pairings_v1_sha_check CHECK (pairing_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT mastermind_node_pairings_v1_state_check CHECK (state IN ('pending', 'claimed')),
  CONSTRAINT mastermind_node_pairings_v1_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT mastermind_node_pairings_v1_claim_check CHECK (
    (state = 'pending' AND claimed_at IS NULL AND node_id IS NULL)
    OR (state = 'claimed' AND claimed_at IS NOT NULL AND node_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS mastermind_node_pairings_v1_pending_expiry_idx
  ON public.mastermind_node_pairings_v1 (expires_at, pairing_id)
  WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS public.mastermind_node_jobs_v1 (
  job_id uuid NOT NULL,
  household_id text NOT NULL,
  node_id uuid NOT NULL,
  command_sha256 text NOT NULL,
  capability text NOT NULL,
  capability_version smallint NOT NULL,
  policy_class text NOT NULL,
  command_input jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  created_by_player_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  lease_id uuid NULL,
  leased_at timestamptz NULL,
  lease_expires_at timestamptz NULL,
  terminal_code text NULL,
  terminal_result jsonb NULL,
  finished_at timestamptz NULL,
  CONSTRAINT mastermind_node_jobs_v1_pkey PRIMARY KEY (job_id),
  CONSTRAINT mastermind_node_jobs_v1_job_node_key UNIQUE (job_id, node_id),
  CONSTRAINT mastermind_node_jobs_v1_household_node_fkey FOREIGN KEY (household_id, node_id)
    REFERENCES public.mastermind_nodes_v1(household_id, node_id),
  CONSTRAINT mastermind_node_jobs_v1_creator_fkey FOREIGN KEY (household_id, created_by_player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_node_jobs_v1_digest_check CHECK (command_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT mastermind_node_jobs_v1_capability_check CHECK (
    capability = 'family-ecosystem.ensure-running'
    AND capability_version = 1
    AND policy_class = 'routine'
    AND command_input = '{}'::jsonb
  ),
  CONSTRAINT mastermind_node_jobs_v1_state_check CHECK (
    state IN ('queued', 'leased', 'running', 'succeeded', 'failed', 'expired')
  ),
  CONSTRAINT mastermind_node_jobs_v1_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT mastermind_node_jobs_v1_lease_check CHECK (
    (state = 'queued' AND lease_id IS NULL AND leased_at IS NULL AND lease_expires_at IS NULL)
    OR (state = 'expired' AND lease_id IS NULL AND leased_at IS NULL AND lease_expires_at IS NULL)
    OR (state IN ('leased', 'running', 'succeeded', 'failed')
      AND lease_id IS NOT NULL AND leased_at IS NOT NULL AND lease_expires_at IS NOT NULL
      AND lease_expires_at > leased_at AND lease_expires_at <= expires_at)
  ),
  CONSTRAINT mastermind_node_jobs_v1_terminal_check CHECK (
    (state IN ('queued', 'leased', 'running', 'expired')
      AND terminal_code IS NULL AND terminal_result IS NULL AND finished_at IS NULL)
    OR (state IN ('succeeded', 'failed')
      AND terminal_code IS NOT NULL AND finished_at IS NOT NULL
      AND (terminal_result IS NULL OR jsonb_typeof(terminal_result) = 'object'))
  )
);

CREATE INDEX IF NOT EXISTS mastermind_node_jobs_v1_dispatch_idx
  ON public.mastermind_node_jobs_v1 (node_id, state, created_at, job_id);

CREATE UNIQUE INDEX IF NOT EXISTS mastermind_node_jobs_v1_one_active_capability_idx
  ON public.mastermind_node_jobs_v1 (node_id, capability)
  WHERE state IN ('queued', 'leased', 'running');

CREATE TABLE IF NOT EXISTS public.mastermind_node_job_receipts_v1 (
  receipt_id uuid NOT NULL,
  job_id uuid NOT NULL,
  node_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  boot_id uuid NOT NULL,
  receipt_sha256 text NOT NULL,
  command_sha256 text NOT NULL,
  sequence integer NOT NULL,
  state text NOT NULL,
  stage text NOT NULL,
  observed_at timestamptz NOT NULL,
  code text NOT NULL,
  retryable boolean NOT NULL,
  result jsonb NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mastermind_node_job_receipts_v1_pkey PRIMARY KEY (receipt_id),
  CONSTRAINT mastermind_node_job_receipts_v1_job_sequence_key UNIQUE (job_id, sequence),
  CONSTRAINT mastermind_node_job_receipts_v1_job_fkey FOREIGN KEY (job_id, node_id)
    REFERENCES public.mastermind_node_jobs_v1(job_id, node_id),
  CONSTRAINT mastermind_node_job_receipts_v1_sha_check CHECK (
    receipt_sha256 ~ '^[a-f0-9]{64}$' AND command_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT mastermind_node_job_receipts_v1_sequence_check CHECK (sequence BETWEEN 1 AND 65535),
  CONSTRAINT mastermind_node_job_receipts_v1_state_check CHECK (
    state IN ('accepted', 'running', 'succeeded', 'failed')
  ),
  CONSTRAINT mastermind_node_job_receipts_v1_stage_check CHECK (
    stage IN (
      'journaled', 'checking-local-state', 'starting-family-server', 'waiting-family-server',
      'starting-companion', 'waiting-companion', 'desired-state-reached', 'terminal'
    )
  ),
  CONSTRAINT mastermind_node_job_receipts_v1_result_check CHECK (
    result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 1024)
  )
);

CREATE INDEX IF NOT EXISTS mastermind_node_job_receipts_v1_job_received_idx
  ON public.mastermind_node_job_receipts_v1 (job_id, received_at, receipt_id);

CREATE TABLE IF NOT EXISTS public.mastermind_node_exchanges_v1 (
  exchange_id uuid NOT NULL,
  node_id uuid NOT NULL,
  request_sha256 text NOT NULL,
  boot_id uuid NOT NULL,
  sent_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  acknowledged_receipt_ids uuid[] NOT NULL,
  response_lease jsonb NULL,
  CONSTRAINT mastermind_node_exchanges_v1_pkey PRIMARY KEY (exchange_id),
  CONSTRAINT mastermind_node_exchanges_v1_node_fkey FOREIGN KEY (node_id)
    REFERENCES public.mastermind_nodes_v1(node_id),
  CONSTRAINT mastermind_node_exchanges_v1_sha_check CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT mastermind_node_exchanges_v1_ack_check CHECK (
    cardinality(acknowledged_receipt_ids) <= 32
  ),
  CONSTRAINT mastermind_node_exchanges_v1_lease_check CHECK (
    response_lease IS NULL
    OR (jsonb_typeof(response_lease) = 'object' AND octet_length(response_lease::text) <= 4096)
  )
);

CREATE INDEX IF NOT EXISTS mastermind_node_exchanges_v1_node_received_idx
  ON public.mastermind_node_exchanges_v1 (node_id, received_at DESC, exchange_id);

CREATE OR REPLACE FUNCTION public.mastermind_active_parent_profile_v1(
  p_household_id text,
  p_parent_player_id uuid
)
RETURNS TABLE (household_id text, player_id uuid)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT player.household_id, player.player_id
  FROM public.mastermind_players_v1 AS player
  JOIN public.mastermind_households_v1 AS household
    ON household.household_id = player.household_id
    AND household.state = 'active'
  WHERE player.household_id = p_household_id
    AND player.player_id = p_parent_player_id
    AND player.role = 'parent'
    AND player.state = 'active'
$$;

CREATE OR REPLACE FUNCTION public.create_mastermind_node_pairing_v1(
  p_pairing_id uuid,
  p_pairing_sha256 text,
  p_household_id text,
  p_parent_player_id uuid,
  p_expires_at timestamptz
)
RETURNS TABLE (status text, pairing_id uuid, household_id text, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_actor record;
  v_existing public.mastermind_node_pairings_v1%ROWTYPE;
BEGIN
  IF p_pairing_id IS NULL OR p_pairing_sha256 !~ '^[a-f0-9]{64}$'
    OR p_household_id !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR p_parent_player_id IS NULL
    OR p_expires_at <= v_now OR p_expires_at > v_now + interval '30 minutes'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid node pairing request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id, 0));
  SELECT * INTO v_actor FROM public.mastermind_active_parent_profile_v1(
    p_household_id, p_parent_player_id
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'node pairing requires an active parent';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_pairing_id::text, 40));
  SELECT * INTO v_existing
  FROM public.mastermind_node_pairings_v1
  WHERE mastermind_node_pairings_v1.pairing_id = p_pairing_id;
  IF FOUND THEN
    IF v_existing.pairing_sha256 = p_pairing_sha256
      AND v_existing.household_id = v_actor.household_id
      AND v_existing.created_by_player_id = v_actor.player_id
    THEN
      RETURN QUERY SELECT 'duplicate'::text, v_existing.pairing_id,
        v_existing.household_id, v_existing.expires_at;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'conflict'::text, p_pairing_id, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO public.mastermind_node_pairings_v1 (
    pairing_id, pairing_sha256, household_id, created_by_player_id, created_at, expires_at
  ) VALUES (
    p_pairing_id, p_pairing_sha256, v_actor.household_id, v_actor.player_id, v_now, p_expires_at
  );
  RETURN QUERY SELECT 'applied'::text, p_pairing_id, v_actor.household_id, p_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_mastermind_node_pairing_v1(
  p_pairing_id uuid,
  p_pairing_sha256 text,
  p_node_id uuid,
  p_credential_sha256 text,
  p_display_name text,
  p_agent_version text
)
RETURNS TABLE (node_id uuid, paired_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_pairing public.mastermind_node_pairings_v1%ROWTYPE;
  v_existing_node public.mastermind_nodes_v1%ROWTYPE;
BEGIN
  IF p_pairing_id IS NULL OR p_node_id IS NULL
    OR p_pairing_sha256 !~ '^[a-f0-9]{64}$' OR p_credential_sha256 !~ '^[a-f0-9]{64}$'
    OR char_length(p_display_name) NOT BETWEEN 1 AND 64 OR p_display_name <> btrim(p_display_name)
    OR p_display_name ~ '[[:cntrl:]]'
    OR p_agent_version !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid node pairing claim';
  END IF;

  SELECT * INTO v_pairing
  FROM public.mastermind_node_pairings_v1
  WHERE mastermind_node_pairings_v1.pairing_id = p_pairing_id
  FOR UPDATE;
  IF NOT FOUND OR v_pairing.pairing_sha256 <> p_pairing_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'node pairing credential is invalid';
  END IF;
  IF v_pairing.state = 'claimed' THEN
    SELECT * INTO v_existing_node
    FROM public.mastermind_nodes_v1
    WHERE mastermind_nodes_v1.node_id = v_pairing.node_id;
    IF FOUND
      AND v_pairing.node_id = p_node_id
      AND v_existing_node.household_id = v_pairing.household_id
      AND v_existing_node.credential_sha256 = p_credential_sha256
      AND v_existing_node.display_name = p_display_name
      AND v_existing_node.agent_version = p_agent_version
    THEN
      RETURN QUERY SELECT v_existing_node.node_id, v_existing_node.paired_at;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'node pairing claim conflicts with its first use';
  END IF;
  IF v_pairing.expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = '57014', MESSAGE = 'node pairing credential expired';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_pairing.household_id, 0));
  PERFORM 1 FROM public.mastermind_active_parent_profile_v1(
    v_pairing.household_id, v_pairing.created_by_player_id
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'node pairing parent is no longer active';
  END IF;

  INSERT INTO public.mastermind_nodes_v1 (
    node_id, household_id, display_name, credential_sha256, agent_version,
    created_by_player_id, paired_at
  ) VALUES (
    p_node_id, v_pairing.household_id, p_display_name, p_credential_sha256, p_agent_version,
    v_pairing.created_by_player_id, v_now
  );
  UPDATE public.mastermind_node_pairings_v1
  SET state = 'claimed', claimed_at = v_now, node_id = p_node_id
  WHERE mastermind_node_pairings_v1.pairing_id = p_pairing_id;

  RETURN QUERY SELECT p_node_id, v_now;
END;
$$;

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
  IF p_job_id IS NULL OR p_node_id IS NULL OR p_command_sha256 !~ '^[a-f0-9]{64}$'
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
    OR p_request_sha256 !~ '^[a-f0-9]{64}$' OR p_credential_sha256 !~ '^[a-f0-9]{64}$'
    OR p_agent_version !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$'
    OR jsonb_typeof(p_status) <> 'object' OR octet_length(p_status::text) > 8192
    OR jsonb_typeof(p_receipts) <> 'array' OR jsonb_array_length(p_receipts) > 32
    OR cardinality(p_receipt_sha256s) <> jsonb_array_length(p_receipts)
    OR EXISTS (SELECT 1 FROM unnest(p_receipt_sha256s) AS digest WHERE digest !~ '^[a-f0-9]{64}$')
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid node exchange';
  END IF;

  SELECT * INTO v_node FROM public.mastermind_nodes_v1
  WHERE mastermind_nodes_v1.node_id = p_node_id
  FOR UPDATE;
  IF NOT FOUND OR v_node.state <> 'active' OR v_node.credential_sha256 <> p_credential_sha256 THEN
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
      last_status = p_status
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
      AND mastermind_node_jobs_v1.node_id = p_node_id
    FOR UPDATE;
    IF NOT FOUND OR v_job.lease_id IS NULL OR v_job.lease_id <> v_lease_id
      OR v_job.command_sha256 <> (v_receipt ->> 'commandDigest')
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'node receipt does not belong to its lease';
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
    AND state IN ('leased', 'running')
    AND lease_expires_at > v_now
  ORDER BY created_at, job_id
  LIMIT 1
  FOR UPDATE;

  IF v_job IS NULL THEN
    SELECT * INTO v_job FROM public.mastermind_node_jobs_v1
    WHERE mastermind_node_jobs_v1.node_id = p_node_id
      AND state = 'queued' AND expires_at > v_now + interval '1 second'
    ORDER BY created_at, job_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      UPDATE public.mastermind_node_jobs_v1
      SET state = 'leased', lease_id = p_candidate_lease_id, leased_at = v_now,
          lease_expires_at = LEAST(expires_at, v_now + interval '15 minutes')
      WHERE mastermind_node_jobs_v1.job_id = v_job.job_id
      RETURNING * INTO v_job;
    END IF;
  ELSE
    UPDATE public.mastermind_node_jobs_v1
    SET lease_expires_at = LEAST(expires_at, v_now + interval '15 minutes')
    WHERE mastermind_node_jobs_v1.job_id = v_job.job_id
    RETURNING * INTO v_job;
  END IF;

  IF v_job IS NOT NULL AND v_job.state IN ('leased', 'running') THEN
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

COMMENT ON TABLE public.mastermind_nodes_v1 IS
  'Paired portable Mastermind nodes. Cloud storage contains only credential hashes and redacted status.';
COMMENT ON TABLE public.mastermind_node_jobs_v1 IS
  'Typed expiring remote intents. The local control plane remains authoritative for machine and game state.';
COMMENT ON TABLE public.mastermind_node_job_receipts_v1 IS
  'Effect-once progress and terminal receipts from the paired node execution journal.';

COMMIT;
