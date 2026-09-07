BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.mastermind_domain_event_receipts_v1 (
  event_id uuid PRIMARY KEY,
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  event_digest text NOT NULL CHECK (event_digest ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  producer text NOT NULL CHECK (producer ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$' AND char_length(producer) <= 64),
  domain text NOT NULL CHECK (domain IN ('world', 'backup', 'mod', 'companion', 'player', 'workshop', 'system')),
  kind text NOT NULL CHECK (char_length(kind) BETWEEN 3 AND 96),
  namespace text NOT NULL CHECK (char_length(namespace) BETWEEN 3 AND 180),
  household_id text NOT NULL CHECK (char_length(household_id) BETWEEN 1 AND 128),
  player_id text NULL CHECK (player_id IS NULL OR char_length(player_id) BETWEEN 1 AND 128),
  world_ref text NULL CHECK (world_ref IS NULL OR world_ref ~ '^world-[a-f0-9]{64}$'),
  session_id uuid NULL,
  correlation_id uuid NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'family', 'system')),
  known_kind boolean NOT NULL,
  sanitized_payload jsonb NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (sanitized_payload IS NULL OR jsonb_typeof(sanitized_payload) = 'object'),
  CHECK (known_kind = (sanitized_payload IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS mastermind_domain_event_receipts_scope_v1_idx
  ON public.mastermind_domain_event_receipts_v1 (household_id, namespace, occurred_at DESC, event_id);

CREATE INDEX IF NOT EXISTS mastermind_domain_event_receipts_kind_v1_idx
  ON public.mastermind_domain_event_receipts_v1 (domain, kind, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.mastermind_companion_sessions_v1 (
  household_id text NOT NULL,
  session_id uuid NOT NULL,
  namespace text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'family', 'system')),
  player_id text NULL,
  world_ref text NULL,
  state text NOT NULL CHECK (state IN ('observed', 'active', 'ended')),
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  started_at timestamptz NULL,
  ended_at timestamptz NULL,
  start_event_id uuid NULL REFERENCES public.mastermind_domain_event_receipts_v1(event_id),
  end_event_id uuid NULL REFERENCES public.mastermind_domain_event_receipts_v1(event_id),
  close_code integer NULL CHECK (close_code IS NULL OR close_code BETWEEN 1000 AND 4999),
  close_reason text NULL CHECK (close_reason IS NULL OR close_reason ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (household_id, session_id),
  CHECK (namespace = 'session/' || session_id::text),
  CHECK (first_observed_at <= last_observed_at)
);

CREATE INDEX IF NOT EXISTS mastermind_companion_sessions_scope_v1_idx
  ON public.mastermind_companion_sessions_v1 (household_id, visibility, last_observed_at DESC);

CREATE TABLE IF NOT EXISTS public.mastermind_companion_actions_v1 (
  household_id text NOT NULL,
  session_id uuid NOT NULL,
  action_id uuid NOT NULL,
  namespace text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'family', 'system')),
  player_id text NULL,
  world_ref text NULL,
  action_kind text NOT NULL CHECK (char_length(action_kind) BETWEEN 3 AND 64),
  status text NOT NULL CHECK (status IN ('dispatched', 'succeeded', 'failed', 'cancelled')),
  requested_at timestamptz NULL,
  deadline_at timestamptz NULL,
  terminal_at timestamptz NULL,
  request_event_id uuid NULL REFERENCES public.mastermind_domain_event_receipts_v1(event_id),
  terminal_event_id uuid NULL REFERENCES public.mastermind_domain_event_receipts_v1(event_id),
  result_code text NULL CHECK (result_code IS NULL OR result_code ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  error_code text NULL CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  cancellation_reason text NULL CHECK (cancellation_reason IS NULL OR cancellation_reason ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  last_event_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (household_id, session_id, action_id),
  FOREIGN KEY (household_id, session_id)
    REFERENCES public.mastermind_companion_sessions_v1(household_id, session_id),
  CHECK (namespace = 'session/' || session_id::text)
);

CREATE INDEX IF NOT EXISTS mastermind_companion_actions_session_v1_idx
  ON public.mastermind_companion_actions_v1 (household_id, session_id, status, last_event_at);

CREATE TABLE IF NOT EXISTS public.mastermind_memory_projection_jobs_v1 (
  memory_key text PRIMARY KEY CHECK (memory_key ~ '^companion-session/v1/[a-z0-9][a-z0-9._:-]{0,127}/[0-9a-f-]{36}$'),
  source_event_id uuid NOT NULL UNIQUE REFERENCES public.mastermind_domain_event_receipts_v1(event_id),
  source_occurred_at timestamptz NOT NULL,
  projection_kind text NOT NULL CHECK (projection_kind = 'companion.session.rollup'),
  projection_version smallint NOT NULL DEFAULT 1 CHECK (projection_version = 1),
  household_id text NOT NULL,
  namespace text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'family', 'system')),
  player_id text NULL,
  world_ref text NULL,
  session_id uuid NOT NULL,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2048),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  embedding vector(768) NULL,
  embedding_status text NOT NULL DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'ready', 'failed')),
  embedding_attempts smallint NOT NULL DEFAULT 0 CHECK (embedding_attempts BETWEEN 0 AND 100),
  last_error_code text NULL CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  embedded_at timestamptz NULL,
  CHECK (namespace = 'session/' || session_id::text),
  CHECK ((embedding_status = 'ready') = (embedding IS NOT NULL)),
  CHECK ((embedding_status = 'ready') = (embedded_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS mastermind_memory_projection_jobs_pending_v1_idx
  ON public.mastermind_memory_projection_jobs_v1 (created_at, source_event_id)
  WHERE embedding_status = 'pending';

CREATE INDEX IF NOT EXISTS mastermind_memory_projection_jobs_scope_v1_idx
  ON public.mastermind_memory_projection_jobs_v1 (household_id, namespace, visibility, created_at DESC);

CREATE OR REPLACE FUNCTION public.ingest_mastermind_domain_event_v1(
  p_event_id uuid,
  p_schema_version smallint,
  p_event_digest text,
  p_occurred_at timestamptz,
  p_producer text,
  p_domain text,
  p_kind text,
  p_namespace text,
  p_household_id text,
  p_player_id text,
  p_world_ref text,
  p_session_id uuid,
  p_correlation_id uuid,
  p_visibility text,
  p_sanitized_payload jsonb
)
RETURNS TABLE (status text, event_id uuid)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_digest text;
  v_inserted integer;
  v_known_kind boolean;
  v_existing_namespace text;
  v_existing_visibility text;
  v_existing_player_id text;
  v_existing_world_ref text;
  v_existing_action_kind text;
  v_action_id uuid;
  v_action_kind text;
  v_action_status text;
  v_requested integer;
  v_actions integer;
  v_succeeded integer;
  v_failed integer;
  v_cancelled integer;
  v_close_code integer;
  v_close_reason text;
  v_end_event_id uuid;
  v_ended_at timestamptz;
  v_session_state text;
  v_projection_source_event_id uuid;
  v_projection_source_occurred_at timestamptz;
  v_action_breakdown text;
  v_memory_key text;
BEGIN
  IF p_event_digest !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid domain event digest';
  END IF;

  -- Serialize only equal event IDs so concurrent retries cannot observe an
  -- ambiguous ON CONFLICT snapshot. Hash collisions merely serialize briefly.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 0));

  SELECT receipt.event_digest
    INTO v_existing_digest
    FROM public.mastermind_domain_event_receipts_v1 AS receipt
    WHERE receipt.event_id = p_event_id;
  IF FOUND THEN
    RETURN QUERY SELECT
      CASE WHEN v_existing_digest = p_event_digest THEN 'duplicate' ELSE 'conflict' END,
      p_event_id;
    RETURN;
  END IF;

  v_known_kind := p_domain = 'companion'
    AND p_kind IN ('session.started', 'session.ended', 'action.requested', 'action.completed', 'action.blocked');
  IF v_known_kind <> (p_sanitized_payload IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid sanitized payload presence';
  END IF;
  IF p_sanitized_payload IS NOT NULL AND jsonb_typeof(p_sanitized_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid sanitized payload type';
  END IF;

  IF v_known_kind THEN
    IF p_session_id IS NULL OR p_namespace <> 'session/' || p_session_id::text THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid companion session scope';
    END IF;

    IF p_kind = 'session.started' THEN
      IF p_sanitized_payload <> '{"state":"ready"}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid session.started payload';
      END IF;
    ELSIF p_kind = 'session.ended' THEN
      IF NOT (p_sanitized_payload ?& ARRAY['code', 'reason'])
        OR p_sanitized_payload - ARRAY['code', 'reason'] <> '{}'::jsonb
        OR jsonb_typeof(p_sanitized_payload -> 'code') <> 'number'
        OR jsonb_typeof(p_sanitized_payload -> 'reason') <> 'string'
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid session.ended payload';
      END IF;
      v_close_code := (p_sanitized_payload ->> 'code')::integer;
      v_close_reason := p_sanitized_payload ->> 'reason';
      IF v_close_code NOT BETWEEN 1000 AND 4999 OR v_close_reason !~ '^[a-z0-9][a-z0-9._-]{0,63}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid session.ended values';
      END IF;
    ELSE
      IF NOT (p_sanitized_payload ?& ARRAY['actionId', 'actionKind', 'status'])
        OR p_sanitized_payload - ARRAY[
          'actionId', 'actionKind', 'status', 'deadlineAt', 'resultCode', 'errorCode', 'cancellationReason'
        ] <> '{}'::jsonb
        OR jsonb_typeof(p_sanitized_payload -> 'actionId') <> 'string'
        OR jsonb_typeof(p_sanitized_payload -> 'actionKind') <> 'string'
        OR jsonb_typeof(p_sanitized_payload -> 'status') <> 'string'
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid companion action payload';
      END IF;
      v_action_id := (p_sanitized_payload ->> 'actionId')::uuid;
      v_action_kind := p_sanitized_payload ->> 'actionKind';
      v_action_status := p_sanitized_payload ->> 'status';
      IF p_correlation_id IS NULL OR p_correlation_id <> v_action_id
        OR char_length(v_action_kind) NOT BETWEEN 3 AND 64
        OR v_action_kind !~ '^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$'
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid companion action identity';
      END IF;
      IF p_kind = 'action.requested' AND (
        v_action_status <> 'dispatched'
        OR p_sanitized_payload - ARRAY['actionId', 'actionKind', 'status', 'deadlineAt'] <> '{}'::jsonb
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid action.requested payload';
      ELSIF p_kind = 'action.completed' AND (
        v_action_status <> 'succeeded'
        OR p_sanitized_payload - ARRAY['actionId', 'actionKind', 'status', 'resultCode'] <> '{}'::jsonb
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid action.completed payload';
      ELSIF p_kind = 'action.blocked' THEN
        IF v_action_status = 'failed' THEN
          IF p_sanitized_payload - ARRAY['actionId', 'actionKind', 'status', 'errorCode'] <> '{}'::jsonb THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid failed action.blocked payload';
          END IF;
        ELSIF v_action_status = 'cancelled' THEN
          IF p_sanitized_payload - ARRAY['actionId', 'actionKind', 'status', 'cancellationReason'] <> '{}'::jsonb THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid cancelled action.blocked payload';
          END IF;
        ELSE
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid action.blocked status';
        END IF;
      END IF;
      IF (p_sanitized_payload ? 'deadlineAt') AND (
        jsonb_typeof(p_sanitized_payload -> 'deadlineAt') <> 'string'
        OR (p_sanitized_payload ->> 'deadlineAt')::timestamptz IS NULL
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid action deadline';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM jsonb_each(p_sanitized_payload) AS item(key, value)
        WHERE item.key IN ('resultCode', 'errorCode', 'cancellationReason')
          AND (
            jsonb_typeof(item.value) <> 'string'
            OR item.value #>> '{}' !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid companion action result code';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.mastermind_domain_event_receipts_v1 (
    event_id, schema_version, event_digest, occurred_at, producer, domain, kind, namespace,
    household_id, player_id, world_ref, session_id, correlation_id, visibility,
    known_kind, sanitized_payload
  ) VALUES (
    p_event_id, p_schema_version, p_event_digest, p_occurred_at, p_producer, p_domain, p_kind, p_namespace,
    p_household_id, p_player_id, p_world_ref, p_session_id, p_correlation_id, p_visibility,
    v_known_kind, p_sanitized_payload
  ) ON CONFLICT ON CONSTRAINT mastermind_domain_event_receipts_v1_pkey DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT receipt.event_digest
      INTO v_existing_digest
      FROM public.mastermind_domain_event_receipts_v1 AS receipt
      WHERE receipt.event_id = p_event_id;
    RETURN QUERY SELECT
      CASE WHEN v_existing_digest = p_event_digest THEN 'duplicate' ELSE 'conflict' END,
      p_event_id;
    RETURN;
  END IF;

  IF NOT v_known_kind THEN
    RETURN QUERY SELECT 'applied'::text, p_event_id;
    RETURN;
  END IF;

  -- Different event IDs can mutate the same session concurrently. Serialize
  -- that structured state so end/action arrival order always converges.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_household_id || chr(31) || p_session_id::text, 1)
  );

  SELECT session.namespace, session.visibility, session.player_id, session.world_ref
    INTO v_existing_namespace, v_existing_visibility, v_existing_player_id, v_existing_world_ref
    FROM public.mastermind_companion_sessions_v1 AS session
    WHERE session.household_id = p_household_id AND session.session_id = p_session_id;
  IF FOUND AND (
    v_existing_namespace <> p_namespace
    OR v_existing_visibility <> p_visibility
    OR v_existing_player_id IS DISTINCT FROM p_player_id
    OR v_existing_world_ref IS DISTINCT FROM p_world_ref
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'companion session scope conflict';
  END IF;

  INSERT INTO public.mastermind_companion_sessions_v1 (
    household_id, session_id, namespace, visibility, player_id, world_ref, state,
    first_observed_at, last_observed_at
  ) VALUES (
    p_household_id, p_session_id, p_namespace, p_visibility, p_player_id, p_world_ref, 'observed',
    p_occurred_at, p_occurred_at
  ) ON CONFLICT (household_id, session_id) DO UPDATE SET
    first_observed_at = LEAST(mastermind_companion_sessions_v1.first_observed_at, EXCLUDED.first_observed_at),
    last_observed_at = GREATEST(mastermind_companion_sessions_v1.last_observed_at, EXCLUDED.last_observed_at),
    updated_at = clock_timestamp();

  IF p_kind = 'session.started' THEN
    UPDATE public.mastermind_companion_sessions_v1
      SET started_at = GREATEST(COALESCE(started_at, '-infinity'::timestamptz), p_occurred_at),
          start_event_id = CASE
            WHEN started_at IS NULL
              OR p_occurred_at > started_at
              OR (
                p_occurred_at = started_at
                AND p_event_id::text >= COALESCE(start_event_id::text, '')
              )
            THEN p_event_id
            ELSE start_event_id
          END,
          last_observed_at = GREATEST(last_observed_at, p_occurred_at),
          updated_at = clock_timestamp()
      WHERE household_id = p_household_id AND session_id = p_session_id;

  ELSIF p_kind = 'session.ended' THEN
    UPDATE public.mastermind_companion_sessions_v1
      SET ended_at = GREATEST(COALESCE(ended_at, '-infinity'::timestamptz), p_occurred_at),
          end_event_id = CASE
            WHEN ended_at IS NULL
              OR p_occurred_at > ended_at
              OR (
                p_occurred_at = ended_at
                AND p_event_id::text >= COALESCE(end_event_id::text, '')
              )
            THEN p_event_id
            ELSE end_event_id
          END,
          close_code = CASE
            WHEN ended_at IS NULL
              OR p_occurred_at > ended_at
              OR (
                p_occurred_at = ended_at
                AND p_event_id::text >= COALESCE(end_event_id::text, '')
              )
            THEN v_close_code
            ELSE close_code
          END,
          close_reason = CASE
            WHEN ended_at IS NULL
              OR p_occurred_at > ended_at
              OR (
                p_occurred_at = ended_at
                AND p_event_id::text >= COALESCE(end_event_id::text, '')
              )
            THEN v_close_reason
            ELSE close_reason
          END,
          last_observed_at = GREATEST(last_observed_at, p_occurred_at),
          updated_at = clock_timestamp()
      WHERE household_id = p_household_id AND session_id = p_session_id;

  ELSE
    SELECT action.action_kind, action.namespace, action.visibility, action.player_id, action.world_ref
      INTO v_existing_action_kind, v_existing_namespace, v_existing_visibility, v_existing_player_id, v_existing_world_ref
      FROM public.mastermind_companion_actions_v1 AS action
      WHERE action.household_id = p_household_id
        AND action.session_id = p_session_id
        AND action.action_id = v_action_id;
    IF FOUND AND (
      v_existing_action_kind <> v_action_kind
      OR v_existing_namespace <> p_namespace
      OR v_existing_visibility <> p_visibility
      OR v_existing_player_id IS DISTINCT FROM p_player_id
      OR v_existing_world_ref IS DISTINCT FROM p_world_ref
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'companion action identity or scope conflict';
    END IF;

    IF p_kind = 'action.requested' THEN
      INSERT INTO public.mastermind_companion_actions_v1 (
        household_id, session_id, action_id, namespace, visibility, player_id, world_ref,
        action_kind, status, requested_at, deadline_at, request_event_id, last_event_at
      ) VALUES (
        p_household_id, p_session_id, v_action_id, p_namespace, p_visibility, p_player_id, p_world_ref,
        v_action_kind, 'dispatched', p_occurred_at,
        CASE WHEN p_sanitized_payload ? 'deadlineAt' THEN (p_sanitized_payload ->> 'deadlineAt')::timestamptz ELSE NULL END,
        p_event_id, p_occurred_at
      ) ON CONFLICT (household_id, session_id, action_id) DO UPDATE SET
        requested_at = COALESCE(mastermind_companion_actions_v1.requested_at, EXCLUDED.requested_at),
        deadline_at = COALESCE(mastermind_companion_actions_v1.deadline_at, EXCLUDED.deadline_at),
        request_event_id = COALESCE(mastermind_companion_actions_v1.request_event_id, EXCLUDED.request_event_id),
        status = CASE
          WHEN mastermind_companion_actions_v1.terminal_at IS NULL THEN 'dispatched'
          ELSE mastermind_companion_actions_v1.status
        END,
        last_event_at = GREATEST(mastermind_companion_actions_v1.last_event_at, EXCLUDED.last_event_at),
        updated_at = clock_timestamp();
    ELSE
      INSERT INTO public.mastermind_companion_actions_v1 (
        household_id, session_id, action_id, namespace, visibility, player_id, world_ref,
        action_kind, status, terminal_at, terminal_event_id, result_code, error_code,
        cancellation_reason, last_event_at
      ) VALUES (
        p_household_id, p_session_id, v_action_id, p_namespace, p_visibility, p_player_id, p_world_ref,
        v_action_kind, v_action_status, p_occurred_at, p_event_id,
        p_sanitized_payload ->> 'resultCode',
        p_sanitized_payload ->> 'errorCode',
        p_sanitized_payload ->> 'cancellationReason',
        p_occurred_at
      ) ON CONFLICT (household_id, session_id, action_id) DO UPDATE SET
        status = CASE
          WHEN EXCLUDED.last_event_at >= mastermind_companion_actions_v1.last_event_at THEN EXCLUDED.status
          ELSE mastermind_companion_actions_v1.status
        END,
        terminal_at = CASE
          WHEN EXCLUDED.last_event_at >= mastermind_companion_actions_v1.last_event_at THEN EXCLUDED.terminal_at
          ELSE mastermind_companion_actions_v1.terminal_at
        END,
        terminal_event_id = CASE
          WHEN EXCLUDED.last_event_at >= mastermind_companion_actions_v1.last_event_at THEN EXCLUDED.terminal_event_id
          ELSE mastermind_companion_actions_v1.terminal_event_id
        END,
        result_code = CASE
          WHEN EXCLUDED.last_event_at >= mastermind_companion_actions_v1.last_event_at THEN EXCLUDED.result_code
          ELSE mastermind_companion_actions_v1.result_code
        END,
        error_code = CASE
          WHEN EXCLUDED.last_event_at >= mastermind_companion_actions_v1.last_event_at THEN EXCLUDED.error_code
          ELSE mastermind_companion_actions_v1.error_code
        END,
        cancellation_reason = CASE
          WHEN EXCLUDED.last_event_at >= mastermind_companion_actions_v1.last_event_at THEN EXCLUDED.cancellation_reason
          ELSE mastermind_companion_actions_v1.cancellation_reason
        END,
        last_event_at = GREATEST(mastermind_companion_actions_v1.last_event_at, EXCLUDED.last_event_at),
        updated_at = clock_timestamp();
    END IF;
  END IF;

  IF p_kind IN ('session.started', 'session.ended') THEN
    UPDATE public.mastermind_companion_sessions_v1
      SET state = CASE
            WHEN ended_at IS NOT NULL AND (started_at IS NULL OR ended_at >= started_at) THEN 'ended'
            WHEN started_at IS NOT NULL THEN 'active'
            ELSE 'observed'
          END,
          updated_at = clock_timestamp()
      WHERE household_id = p_household_id AND session_id = p_session_id;
  END IF;

  -- A disconnect can record session.ended just before it emits a cancelled
  -- action. Refresh the same session memory after either side arrives so the
  -- projection converges independently of durable outbox ordering.
  IF p_kind = 'session.ended' OR p_kind IN ('action.requested', 'action.completed', 'action.blocked') THEN
    SELECT session.end_event_id, session.ended_at, session.close_code, session.close_reason, session.state
      INTO v_end_event_id, v_ended_at, v_close_code, v_close_reason, v_session_state
      FROM public.mastermind_companion_sessions_v1 AS session
      WHERE session.household_id = p_household_id AND session.session_id = p_session_id;

    IF v_session_state = 'ended' AND v_end_event_id IS NOT NULL AND v_ended_at IS NOT NULL THEN
      SELECT
        count(*)::integer,
        count(*) FILTER (WHERE action.requested_at IS NOT NULL)::integer,
        count(*) FILTER (WHERE action.status = 'succeeded')::integer,
        count(*) FILTER (WHERE action.status = 'failed')::integer,
        count(*) FILTER (WHERE action.status = 'cancelled')::integer
        INTO v_actions, v_requested, v_succeeded, v_failed, v_cancelled
        FROM public.mastermind_companion_actions_v1 AS action
        WHERE action.household_id = p_household_id AND action.session_id = p_session_id;

      IF v_actions > 0 THEN
        SELECT string_agg(
          format('%s %s=%s', summary.action_kind, summary.status, summary.action_count),
          ', ' ORDER BY summary.action_kind, summary.status
        )
          INTO v_action_breakdown
          FROM (
            SELECT action.action_kind, action.status, count(*)::integer AS action_count
            FROM public.mastermind_companion_actions_v1 AS action
            WHERE action.household_id = p_household_id AND action.session_id = p_session_id
            GROUP BY action.action_kind, action.status
          ) AS summary;

        -- Select the latest contributor across the stored end and every
        -- request/terminal state, not merely the event that triggered this
        -- refresh. A late older event can therefore change content while
        -- retaining equal latest provenance and still update the projection.
        SELECT contributor.event_id, contributor.occurred_at
          INTO v_projection_source_event_id, v_projection_source_occurred_at
          FROM (
            SELECT v_end_event_id AS event_id, v_ended_at AS occurred_at
            UNION ALL
            SELECT action.request_event_id, action.requested_at
            FROM public.mastermind_companion_actions_v1 AS action
            WHERE action.household_id = p_household_id
              AND action.session_id = p_session_id
              AND action.request_event_id IS NOT NULL
              AND action.requested_at IS NOT NULL
            UNION ALL
            SELECT action.terminal_event_id, action.terminal_at
            FROM public.mastermind_companion_actions_v1 AS action
            WHERE action.household_id = p_household_id
              AND action.session_id = p_session_id
              AND action.terminal_event_id IS NOT NULL
              AND action.terminal_at IS NOT NULL
          ) AS contributor
          ORDER BY contributor.occurred_at DESC, contributor.event_id::text DESC
          LIMIT 1;

        v_memory_key := format('companion-session/v1/%s/%s', p_household_id, p_session_id);
        INSERT INTO public.mastermind_memory_projection_jobs_v1 (
          memory_key, source_event_id, source_occurred_at, projection_kind, household_id, namespace,
          visibility, player_id, world_ref, session_id, content, metadata, embedding, embedding_status
        ) VALUES (
          v_memory_key,
          v_projection_source_event_id,
          v_projection_source_occurred_at,
          'companion.session.rollup',
          p_household_id,
          p_namespace,
          p_visibility,
          p_player_id,
          p_world_ref,
          p_session_id,
          format(
            'Minecraft companion session actions: %s. Totals: %s actions, %s requested, %s succeeded, %s failed, %s cancelled.',
            v_action_breakdown, v_actions, v_requested, v_succeeded, v_failed, v_cancelled
          ),
          jsonb_build_object(
            'schemaVersion', 1,
            'sessionId', p_session_id::text,
            'actionCount', v_actions,
            'requestedActions', v_requested,
            'succeededActions', v_succeeded,
            'failedActions', v_failed,
            'cancelledActions', v_cancelled,
            'closeCode', v_close_code,
            'closeReason', v_close_reason
          ),
          NULL,
          'pending'
        ) ON CONFLICT (memory_key) DO UPDATE SET
          source_event_id = EXCLUDED.source_event_id,
          source_occurred_at = EXCLUDED.source_occurred_at,
          namespace = EXCLUDED.namespace,
          visibility = EXCLUDED.visibility,
          player_id = EXCLUDED.player_id,
          world_ref = EXCLUDED.world_ref,
          content = EXCLUDED.content,
          metadata = EXCLUDED.metadata,
          embedding = NULL,
          embedding_status = 'pending',
          embedding_attempts = 0,
          last_error_code = NULL,
          created_at = clock_timestamp(),
          embedded_at = NULL
        WHERE (EXCLUDED.source_occurred_at, EXCLUDED.source_event_id::text)
          >= (
            mastermind_memory_projection_jobs_v1.source_occurred_at,
            mastermind_memory_projection_jobs_v1.source_event_id::text
          );
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT 'applied'::text, p_event_id;
END;
$$;

COMMENT ON TABLE public.mastermind_domain_event_receipts_v1 IS
  'Effect-once receipt ledger. Unknown event kinds intentionally retain metadata and digest only.';
COMMENT ON TABLE public.mastermind_memory_projection_jobs_v1 IS
  'Scoped, sanitized session rollups awaiting asynchronous 768-dimension embedding; routine events do not create vectors.';
COMMENT ON FUNCTION public.ingest_mastermind_domain_event_v1(
  uuid, smallint, text, timestamptz, text, text, text, text, text, text, text, uuid, uuid, text, jsonb
) IS 'Atomically deduplicates one canonical event, updates companion state, and schedules at most one session rollup.';

COMMIT;
