BEGIN;

-- Lifecycle state is deliberately separate from the rebuildable projection.
-- A missing row means an active memory at baseline revision 1. Once changed,
-- this row survives projection refresh/rebuild and carries every later CAS.
CREATE TABLE IF NOT EXISTS public.mastermind_memory_lifecycle_v1 (
  memory_key text NOT NULL,
  household_id text NOT NULL,
  revision bigint NOT NULL,
  lifecycle_state text NOT NULL,
  changed_by_player_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  forgotten_at timestamptz NULL,
  CONSTRAINT mastermind_memory_lifecycle_v1_pkey PRIMARY KEY (memory_key),
  CONSTRAINT mastermind_memory_lifecycle_v1_actor_fkey
    FOREIGN KEY (household_id, changed_by_player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_memory_lifecycle_v1_memory_key_check CHECK (
    char_length(memory_key) BETWEEN 1 AND 256 AND memory_key !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mastermind_memory_lifecycle_v1_household_check CHECK (
    household_id ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  ),
  CONSTRAINT mastermind_memory_lifecycle_v1_revision_check CHECK (revision >= 2),
  CONSTRAINT mastermind_memory_lifecycle_v1_state_check CHECK (
    lifecycle_state IN ('active', 'forgotten')
  ),
  CONSTRAINT mastermind_memory_lifecycle_v1_forgotten_check CHECK (
    (lifecycle_state = 'forgotten' AND forgotten_at IS NOT NULL)
    OR (lifecycle_state = 'active' AND forgotten_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS mastermind_memory_lifecycle_v1_household_state_idx
  ON public.mastermind_memory_lifecycle_v1
  (household_id, lifecycle_state, changed_at DESC, memory_key);

-- Plans are immutable, short-lived approvals. They contain no memory content.
CREATE TABLE IF NOT EXISTS public.mastermind_memory_forget_plans_v1 (
  plan_id uuid NOT NULL,
  plan_digest text NOT NULL,
  household_id text NOT NULL,
  actor_player_id uuid NOT NULL,
  memory_key text NOT NULL,
  expected_revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  not_before timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT mastermind_memory_forget_plans_v1_pkey PRIMARY KEY (plan_id),
  CONSTRAINT mastermind_memory_forget_plans_v1_actor_fkey
    FOREIGN KEY (household_id, actor_player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_memory_forget_plans_v1_digest_check CHECK (
    plan_digest ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT mastermind_memory_forget_plans_v1_memory_key_check CHECK (
    char_length(memory_key) BETWEEN 1 AND 256 AND memory_key !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mastermind_memory_forget_plans_v1_household_check CHECK (
    household_id ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  ),
  CONSTRAINT mastermind_memory_forget_plans_v1_revision_check CHECK (expected_revision >= 1),
  CONSTRAINT mastermind_memory_forget_plans_v1_window_check CHECK (
    created_at < not_before AND not_before < expires_at
  )
);

CREATE INDEX IF NOT EXISTS mastermind_memory_forget_plans_v1_target_idx
  ON public.mastermind_memory_forget_plans_v1
  (household_id, memory_key, expires_at DESC, plan_id);

-- This is both the effect-once ledger and the payload-free lifecycle audit.
CREATE TABLE IF NOT EXISTS public.mastermind_memory_action_receipts_v1 (
  action_id uuid NOT NULL,
  action_digest text NOT NULL,
  action text NOT NULL,
  household_id text NOT NULL,
  actor_player_id uuid NOT NULL,
  memory_key text NOT NULL,
  plan_id uuid NULL,
  prior_revision bigint NOT NULL,
  resulting_revision bigint NOT NULL,
  resulting_lifecycle_state text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mastermind_memory_action_receipts_v1_pkey PRIMARY KEY (action_id),
  CONSTRAINT mastermind_memory_action_receipts_v1_actor_fkey
    FOREIGN KEY (household_id, actor_player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_memory_action_receipts_v1_plan_fkey
    FOREIGN KEY (plan_id)
    REFERENCES public.mastermind_memory_forget_plans_v1(plan_id),
  CONSTRAINT mastermind_memory_action_receipts_v1_digest_check CHECK (
    action_digest ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT mastermind_memory_action_receipts_v1_action_check CHECK (
    action IN ('forget', 'restore')
  ),
  CONSTRAINT mastermind_memory_action_receipts_v1_memory_key_check CHECK (
    char_length(memory_key) BETWEEN 1 AND 256 AND memory_key !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mastermind_memory_action_receipts_v1_revision_check CHECK (
    prior_revision >= 1 AND resulting_revision = prior_revision + 1
  ),
  CONSTRAINT mastermind_memory_action_receipts_v1_result_check CHECK (
    (action = 'forget' AND plan_id IS NOT NULL AND resulting_lifecycle_state = 'forgotten')
    OR (action = 'restore' AND plan_id IS NULL AND resulting_lifecycle_state = 'active')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS mastermind_memory_action_receipts_v1_forget_plan_idx
  ON public.mastermind_memory_action_receipts_v1 (plan_id)
  WHERE action = 'forget';

CREATE INDEX IF NOT EXISTS mastermind_memory_action_receipts_v1_target_idx
  ON public.mastermind_memory_action_receipts_v1
  (household_id, memory_key, committed_at DESC, action_id);

COMMENT ON TABLE public.mastermind_memory_lifecycle_v1 IS
  'Rebuild-stable reversible memory state. Missing row is active revision 1; no content or vector is stored here.';
COMMENT ON TABLE public.mastermind_memory_forget_plans_v1 IS
  'Immutable, bounded-lifetime parent approval for one exact soft-forget target and lifecycle revision.';
COMMENT ON TABLE public.mastermind_memory_action_receipts_v1 IS
  'Immutable effect-once, payload-free audit of successful soft-forget and restore transitions.';

REVOKE UPDATE, DELETE, TRUNCATE ON public.mastermind_memory_forget_plans_v1 FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON public.mastermind_memory_action_receipts_v1 FROM PUBLIC;
CREATE OR REPLACE RULE mastermind_memory_forget_plans_v1_no_update AS
  ON UPDATE TO public.mastermind_memory_forget_plans_v1 DO INSTEAD NOTHING;
CREATE OR REPLACE RULE mastermind_memory_forget_plans_v1_no_delete AS
  ON DELETE TO public.mastermind_memory_forget_plans_v1 DO INSTEAD NOTHING;
CREATE OR REPLACE RULE mastermind_memory_action_receipts_v1_no_update AS
  ON UPDATE TO public.mastermind_memory_action_receipts_v1 DO INSTEAD NOTHING;
CREATE OR REPLACE RULE mastermind_memory_action_receipts_v1_no_delete AS
  ON DELETE TO public.mastermind_memory_action_receipts_v1 DO INSTEAD NOTHING;

-- This is intentionally narrower than general recall authorization: it proves
-- only that the supplied canonical actor is an active parent in the household.
-- It must only gate sanitized operator projections, never raw event/archive data.
CREATE OR REPLACE FUNCTION public.verify_mastermind_memory_operator_v1(
  p_household_id text,
  p_actor_player_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mastermind_households_v1 AS operator_household
    JOIN public.mastermind_players_v1 AS operator_player
      ON operator_player.household_id = operator_household.household_id
      AND operator_player.player_id = p_actor_player_id
      AND operator_player.role = 'parent'
      AND operator_player.state = 'active'
    WHERE operator_household.household_id = p_household_id
      AND operator_household.state = 'active'
  );
$$;

CREATE INDEX IF NOT EXISTS mastermind_memory_projection_jobs_v1_text_idx
  ON public.mastermind_memory_projection_jobs_v1
  USING gin (to_tsvector('simple', content));

CREATE OR REPLACE FUNCTION public.search_mastermind_operator_memories_v1(
  p_household_id text,
  p_actor_player_id uuid,
  p_query text,
  p_mode text,
  p_limit integer
)
RETURNS TABLE (
  memory_key text,
  revision bigint,
  summary text,
  namespace text,
  visibility text,
  player_id text,
  world_ref text,
  session_id uuid,
  occurred_at timestamptz,
  lifecycle_state text
)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_household_id IS NULL
    OR p_household_id !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR p_actor_player_id IS NULL
    OR p_query IS NULL
    OR char_length(p_query) > 512
    OR p_query ~ '[[:cntrl:]]'
    OR p_query <> btrim(p_query)
    OR (p_query <> '' AND p_query !~ '[[:alnum:]]')
    OR p_mode IS NULL
    OR p_mode NOT IN ('active', 'forgotten')
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 20
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid memory operator search';
  END IF;

  -- Serialize the authorization snapshot with player archive and household
  -- identity changes. The candidate statement takes a fresh READ COMMITTED
  -- snapshot after this lock if it had to wait.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id, 0));

  RETURN QUERY
  WITH authorized_candidates AS MATERIALIZED (
    SELECT
      projection.memory_key,
      COALESCE(lifecycle.revision, 1::bigint) AS revision,
      projection.content AS summary,
      projection.namespace,
      projection.visibility,
      projection.player_id,
      projection.world_ref,
      projection.session_id,
      projection.source_occurred_at AS occurred_at,
      COALESCE(lifecycle.lifecycle_state, 'active'::text) AS lifecycle_state
    FROM public.mastermind_memory_projection_jobs_v1 AS projection
    LEFT JOIN public.mastermind_memory_lifecycle_v1 AS lifecycle
      ON lifecycle.memory_key = projection.memory_key
    WHERE projection.household_id = p_household_id
      AND projection.projection_kind = 'companion.session.rollup'
      AND public.verify_mastermind_memory_operator_v1(
        projection.household_id,
        p_actor_player_id
      )
      -- A lifecycle row for another household is corruption and fails closed.
      AND (lifecycle.memory_key IS NULL OR lifecycle.household_id = projection.household_id)
      AND COALESCE(lifecycle.lifecycle_state, 'active'::text) = p_mode
  )
  SELECT
    candidate.memory_key,
    candidate.revision,
    candidate.summary,
    candidate.namespace,
    candidate.visibility,
    candidate.player_id,
    candidate.world_ref,
    candidate.session_id,
    candidate.occurred_at,
    candidate.lifecycle_state
  FROM authorized_candidates AS candidate
  WHERE p_query = ''
    OR to_tsvector('simple', candidate.summary) @@ websearch_to_tsquery('simple', p_query)
  ORDER BY
    CASE
      WHEN p_query = '' THEN NULL::real
      ELSE ts_rank_cd(
        to_tsvector('simple', candidate.summary),
        websearch_to_tsquery('simple', p_query)
      )
    END DESC NULLS LAST,
    candidate.occurred_at DESC,
    candidate.memory_key ASC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_mastermind_memory_forget_plan_v1(
  p_plan_id uuid,
  p_plan_digest text,
  p_household_id text,
  p_actor_player_id uuid,
  p_memory_key text,
  p_expected_revision bigint
)
RETURNS TABLE (
  status text,
  plan_id uuid,
  plan_digest text,
  memory_key text,
  expected_revision bigint,
  not_before timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_digest text;
  v_existing_household_id text;
  v_existing_actor_player_id uuid;
  v_existing_memory_key text;
  v_existing_expected_revision bigint;
  v_existing_not_before timestamptz;
  v_existing_expires_at timestamptz;
  v_current_revision bigint;
  v_current_state text;
  v_now timestamptz;
BEGIN
  IF p_plan_id IS NULL
    OR p_plan_digest IS NULL
    OR p_plan_digest !~ '^[a-f0-9]{64}$'
    OR p_household_id IS NULL
    OR p_household_id !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR p_actor_player_id IS NULL
    OR p_memory_key IS NULL
    OR char_length(p_memory_key) NOT BETWEEN 1 AND 256
    OR p_memory_key ~ '[[:cntrl:]]'
    OR p_expected_revision IS NULL
    OR p_expected_revision NOT BETWEEN 1 AND 9223372036854775806
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid memory forget plan';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_plan_id::text, 30));

  SELECT
    stored_plan.plan_digest,
    stored_plan.household_id,
    stored_plan.actor_player_id,
    stored_plan.memory_key,
    stored_plan.expected_revision,
    stored_plan.not_before,
    stored_plan.expires_at
  INTO
    v_existing_digest,
    v_existing_household_id,
    v_existing_actor_player_id,
    v_existing_memory_key,
    v_existing_expected_revision,
    v_existing_not_before,
    v_existing_expires_at
  FROM public.mastermind_memory_forget_plans_v1 AS stored_plan
  WHERE stored_plan.plan_id = p_plan_id;

  IF FOUND THEN
    IF v_existing_digest = p_plan_digest
      AND v_existing_household_id = p_household_id
      AND v_existing_actor_player_id = p_actor_player_id
      AND v_existing_memory_key = p_memory_key
      AND v_existing_expected_revision = p_expected_revision
    THEN
      RETURN QUERY SELECT
        'duplicate'::text,
        p_plan_id,
        v_existing_digest,
        v_existing_memory_key,
        v_existing_expected_revision,
        v_existing_not_before,
        v_existing_expires_at;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'MM003', MESSAGE = 'memory plan id is already bound to different content';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id, 0));
  IF NOT public.verify_mastermind_memory_operator_v1(p_household_id, p_actor_player_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'MM004', MESSAGE = 'memory operator is not authorized';
  END IF;

  SELECT
    COALESCE(lifecycle.revision, 1::bigint),
    COALESCE(lifecycle.lifecycle_state, 'active'::text)
  INTO v_current_revision, v_current_state
  FROM public.mastermind_memory_projection_jobs_v1 AS projection
  LEFT JOIN public.mastermind_memory_lifecycle_v1 AS lifecycle
    ON lifecycle.memory_key = projection.memory_key
  WHERE projection.memory_key = p_memory_key
    AND projection.household_id = p_household_id
    AND projection.projection_kind = 'companion.session.rollup'
    AND (lifecycle.memory_key IS NULL OR lifecycle.household_id = projection.household_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'MM005', MESSAGE = 'memory target is invalid';
  END IF;
  IF v_current_state <> 'active' OR v_current_revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'MM003', MESSAGE = 'memory lifecycle revision or state changed';
  END IF;

  v_now := clock_timestamp();
  INSERT INTO public.mastermind_memory_forget_plans_v1 (
    plan_id, plan_digest, household_id, actor_player_id, memory_key,
    expected_revision, created_at, not_before, expires_at
  ) VALUES (
    p_plan_id, p_plan_digest, p_household_id, p_actor_player_id, p_memory_key,
    p_expected_revision, v_now, v_now + interval '1500 milliseconds', v_now + interval '5 minutes'
  );

  RETURN QUERY SELECT
    'planned'::text,
    p_plan_id,
    p_plan_digest,
    p_memory_key,
    p_expected_revision,
    v_now + interval '1500 milliseconds',
    v_now + interval '5 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_mastermind_memory_forget_v1(
  p_action_id uuid,
  p_action_digest text,
  p_household_id text,
  p_actor_player_id uuid,
  p_plan_id uuid,
  p_plan_digest text
)
RETURNS TABLE (
  status text,
  action_id uuid,
  memory_key text,
  revision bigint,
  lifecycle_state text
)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt_digest text;
  v_receipt_action text;
  v_receipt_household_id text;
  v_receipt_actor_player_id uuid;
  v_receipt_memory_key text;
  v_receipt_plan_id uuid;
  v_receipt_revision bigint;
  v_receipt_state text;
  v_plan_memory_key text;
  v_plan_expected_revision bigint;
  v_plan_not_before timestamptz;
  v_plan_expires_at timestamptz;
  v_lifecycle_household_id text;
  v_current_revision bigint;
  v_current_state text;
  v_result_revision bigint;
  v_now timestamptz;
BEGIN
  IF p_action_id IS NULL
    OR p_action_digest IS NULL
    OR p_action_digest !~ '^[a-f0-9]{64}$'
    OR p_household_id IS NULL
    OR p_household_id !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR p_actor_player_id IS NULL
    OR p_plan_id IS NULL
    OR p_plan_digest IS NULL
    OR p_plan_digest !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid memory forget action';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_action_id::text, 31));

  SELECT
    receipt.action_digest,
    receipt.action,
    receipt.household_id,
    receipt.actor_player_id,
    receipt.memory_key,
    receipt.plan_id,
    receipt.resulting_revision,
    receipt.resulting_lifecycle_state
  INTO
    v_receipt_digest,
    v_receipt_action,
    v_receipt_household_id,
    v_receipt_actor_player_id,
    v_receipt_memory_key,
    v_receipt_plan_id,
    v_receipt_revision,
    v_receipt_state
  FROM public.mastermind_memory_action_receipts_v1 AS receipt
  WHERE receipt.action_id = p_action_id;

  IF FOUND THEN
    IF v_receipt_digest = p_action_digest
      AND v_receipt_action = 'forget'
      AND v_receipt_household_id = p_household_id
      AND v_receipt_actor_player_id = p_actor_player_id
      AND v_receipt_plan_id = p_plan_id
    THEN
      RETURN QUERY SELECT
        'duplicate'::text,
        p_action_id,
        v_receipt_memory_key,
        v_receipt_revision,
        v_receipt_state;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'MM003', MESSAGE = 'memory action id is already bound to different content';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id, 0));
  IF NOT public.verify_mastermind_memory_operator_v1(p_household_id, p_actor_player_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'MM004', MESSAGE = 'memory operator is not authorized';
  END IF;

  SELECT
    stored_plan.memory_key,
    stored_plan.expected_revision,
    stored_plan.not_before,
    stored_plan.expires_at
  INTO
    v_plan_memory_key,
    v_plan_expected_revision,
    v_plan_not_before,
    v_plan_expires_at
  FROM public.mastermind_memory_forget_plans_v1 AS stored_plan
  WHERE stored_plan.plan_id = p_plan_id
    AND stored_plan.plan_digest = p_plan_digest
    AND stored_plan.household_id = p_household_id
    AND stored_plan.actor_player_id = p_actor_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'MM005', MESSAGE = 'memory forget plan is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.mastermind_memory_action_receipts_v1 AS consumed
    WHERE consumed.plan_id = p_plan_id
      AND consumed.action = 'forget'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'MM002', MESSAGE = 'memory forget plan is expired or consumed';
  END IF;

  v_now := clock_timestamp();
  IF v_now < v_plan_not_before THEN
    RAISE EXCEPTION USING ERRCODE = 'MM001', MESSAGE = 'memory forget plan is not ready';
  END IF;
  IF v_now >= v_plan_expires_at THEN
    RAISE EXCEPTION USING ERRCODE = 'MM002', MESSAGE = 'memory forget plan is expired or consumed';
  END IF;

  PERFORM 1
  FROM public.mastermind_memory_projection_jobs_v1 AS projection
  WHERE projection.memory_key = v_plan_memory_key
    AND projection.household_id = p_household_id
    AND projection.projection_kind = 'companion.session.rollup'
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'MM005', MESSAGE = 'memory target is invalid';
  END IF;

  SELECT
    lifecycle.household_id,
    lifecycle.revision,
    lifecycle.lifecycle_state
  INTO
    v_lifecycle_household_id,
    v_current_revision,
    v_current_state
  FROM public.mastermind_memory_lifecycle_v1 AS lifecycle
  WHERE lifecycle.memory_key = v_plan_memory_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_lifecycle_household_id <> p_household_id THEN
      RAISE EXCEPTION USING ERRCODE = 'MM005', MESSAGE = 'memory target is invalid';
    END IF;
  ELSE
    v_current_revision := 1;
    v_current_state := 'active';
  END IF;

  IF v_current_state <> 'active' OR v_current_revision <> v_plan_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'MM003', MESSAGE = 'memory lifecycle revision or state changed';
  END IF;

  v_result_revision := v_current_revision + 1;
  IF v_current_revision = 1 THEN
    INSERT INTO public.mastermind_memory_lifecycle_v1 (
      memory_key, household_id, revision, lifecycle_state,
      changed_by_player_id, changed_at, forgotten_at
    ) VALUES (
      v_plan_memory_key, p_household_id, v_result_revision, 'forgotten',
      p_actor_player_id, v_now, v_now
    );
  ELSE
    UPDATE public.mastermind_memory_lifecycle_v1 AS lifecycle
      SET revision = v_result_revision,
          lifecycle_state = 'forgotten',
          changed_by_player_id = p_actor_player_id,
          changed_at = v_now,
          forgotten_at = v_now
      WHERE lifecycle.memory_key = v_plan_memory_key
        AND lifecycle.household_id = p_household_id
        AND lifecycle.revision = v_current_revision
        AND lifecycle.lifecycle_state = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'MM003', MESSAGE = 'memory lifecycle revision or state changed';
    END IF;
  END IF;

  INSERT INTO public.mastermind_memory_action_receipts_v1 (
    action_id, action_digest, action, household_id, actor_player_id,
    memory_key, plan_id, prior_revision, resulting_revision,
    resulting_lifecycle_state, committed_at
  ) VALUES (
    p_action_id, p_action_digest, 'forget', p_household_id, p_actor_player_id,
    v_plan_memory_key, p_plan_id, v_current_revision, v_result_revision,
    'forgotten', v_now
  );

  RETURN QUERY SELECT
    'applied'::text,
    p_action_id,
    v_plan_memory_key,
    v_result_revision,
    'forgotten'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_mastermind_memory_restore_v1(
  p_action_id uuid,
  p_action_digest text,
  p_household_id text,
  p_actor_player_id uuid,
  p_memory_key text,
  p_expected_revision bigint
)
RETURNS TABLE (
  status text,
  action_id uuid,
  memory_key text,
  revision bigint,
  lifecycle_state text
)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt_digest text;
  v_receipt_action text;
  v_receipt_household_id text;
  v_receipt_actor_player_id uuid;
  v_receipt_memory_key text;
  v_receipt_revision bigint;
  v_receipt_state text;
  v_lifecycle_household_id text;
  v_current_revision bigint;
  v_current_state text;
  v_result_revision bigint;
  v_now timestamptz;
BEGIN
  IF p_action_id IS NULL
    OR p_action_digest IS NULL
    OR p_action_digest !~ '^[a-f0-9]{64}$'
    OR p_household_id IS NULL
    OR p_household_id !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR p_actor_player_id IS NULL
    OR p_memory_key IS NULL
    OR char_length(p_memory_key) NOT BETWEEN 1 AND 256
    OR p_memory_key ~ '[[:cntrl:]]'
    OR p_expected_revision IS NULL
    OR p_expected_revision NOT BETWEEN 2 AND 9223372036854775806
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid memory restore action';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_action_id::text, 31));

  SELECT
    receipt.action_digest,
    receipt.action,
    receipt.household_id,
    receipt.actor_player_id,
    receipt.memory_key,
    receipt.resulting_revision,
    receipt.resulting_lifecycle_state
  INTO
    v_receipt_digest,
    v_receipt_action,
    v_receipt_household_id,
    v_receipt_actor_player_id,
    v_receipt_memory_key,
    v_receipt_revision,
    v_receipt_state
  FROM public.mastermind_memory_action_receipts_v1 AS receipt
  WHERE receipt.action_id = p_action_id;

  IF FOUND THEN
    IF v_receipt_digest = p_action_digest
      AND v_receipt_action = 'restore'
      AND v_receipt_household_id = p_household_id
      AND v_receipt_actor_player_id = p_actor_player_id
      AND v_receipt_memory_key = p_memory_key
    THEN
      RETURN QUERY SELECT
        'duplicate'::text,
        p_action_id,
        v_receipt_memory_key,
        v_receipt_revision,
        v_receipt_state;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'MM003', MESSAGE = 'memory action id is already bound to different content';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id, 0));
  IF NOT public.verify_mastermind_memory_operator_v1(p_household_id, p_actor_player_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'MM004', MESSAGE = 'memory operator is not authorized';
  END IF;

  PERFORM 1
  FROM public.mastermind_memory_projection_jobs_v1 AS projection
  WHERE projection.memory_key = p_memory_key
    AND projection.household_id = p_household_id
    AND projection.projection_kind = 'companion.session.rollup'
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'MM005', MESSAGE = 'memory target is invalid';
  END IF;

  SELECT
    lifecycle.household_id,
    lifecycle.revision,
    lifecycle.lifecycle_state
  INTO
    v_lifecycle_household_id,
    v_current_revision,
    v_current_state
  FROM public.mastermind_memory_lifecycle_v1 AS lifecycle
  WHERE lifecycle.memory_key = p_memory_key
  FOR UPDATE;

  IF NOT FOUND
    OR v_lifecycle_household_id <> p_household_id
    OR v_current_state <> 'forgotten'
    OR v_current_revision <> p_expected_revision
  THEN
    RAISE EXCEPTION USING ERRCODE = 'MM003', MESSAGE = 'memory lifecycle revision or state changed';
  END IF;

  v_now := clock_timestamp();
  v_result_revision := v_current_revision + 1;
  UPDATE public.mastermind_memory_lifecycle_v1 AS lifecycle
    SET revision = v_result_revision,
        lifecycle_state = 'active',
        changed_by_player_id = p_actor_player_id,
        changed_at = v_now,
        forgotten_at = NULL
    WHERE lifecycle.memory_key = p_memory_key
      AND lifecycle.household_id = p_household_id
      AND lifecycle.revision = p_expected_revision
      AND lifecycle.lifecycle_state = 'forgotten';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'MM003', MESSAGE = 'memory lifecycle revision or state changed';
  END IF;

  INSERT INTO public.mastermind_memory_action_receipts_v1 (
    action_id, action_digest, action, household_id, actor_player_id,
    memory_key, plan_id, prior_revision, resulting_revision,
    resulting_lifecycle_state, committed_at
  ) VALUES (
    p_action_id, p_action_digest, 'restore', p_household_id, p_actor_player_id,
    p_memory_key, NULL, v_current_revision, v_result_revision,
    'active', v_now
  );

  RETURN QUERY SELECT
    'applied'::text,
    p_action_id,
    p_memory_key,
    v_result_revision,
    'active'::text;
END;
$$;

COMMENT ON FUNCTION public.verify_mastermind_memory_operator_v1(text, uuid) IS
  'Active-parent administrative predicate for sanitized household projections only; it is not general recall authorization.';
COMMENT ON FUNCTION public.search_mastermind_operator_memories_v1(text, uuid, text, text, integer) IS
  'Parent-authorized pre-ranking search over sanitized session rollups. Empty query is recent-first; mode selects active or forgotten.';
COMMENT ON FUNCTION public.create_mastermind_memory_forget_plan_v1(uuid, text, text, uuid, text, bigint) IS
  'Creates one immutable 1500-millisecond-delayed, five-minute soft-forget plan at an exact lifecycle revision.';
COMMENT ON FUNCTION public.apply_mastermind_memory_forget_v1(uuid, text, text, uuid, uuid, text) IS
  'Effect-once application of one matching, ready, unexpired forget plan; content and projection remain intact.';
COMMENT ON FUNCTION public.apply_mastermind_memory_restore_v1(uuid, text, text, uuid, text, bigint) IS
  'Effect-once active-parent restore of an exact forgotten lifecycle revision.';

COMMIT;
