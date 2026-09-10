BEGIN;

CREATE TABLE IF NOT EXISTS public.mastermind_households_v1 (
  household_id text NOT NULL,
  display_name text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mastermind_households_v1_pkey PRIMARY KEY (household_id),
  CONSTRAINT mastermind_households_v1_id_check CHECK (
    household_id ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  ),
  CONSTRAINT mastermind_households_v1_display_name_check CHECK (
    char_length(display_name) BETWEEN 1 AND 64 AND display_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mastermind_households_v1_state_check CHECK (state IN ('active', 'archived')),
  CONSTRAINT mastermind_households_v1_revision_check CHECK (revision >= 1)
);

CREATE TABLE IF NOT EXISTS public.mastermind_players_v1 (
  household_id text NOT NULL,
  player_id uuid NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  revision bigint NOT NULL DEFAULT 1,
  created_by_player_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz NULL,
  CONSTRAINT mastermind_players_v1_pkey PRIMARY KEY (household_id, player_id),
  CONSTRAINT mastermind_players_v1_household_fkey FOREIGN KEY (household_id)
    REFERENCES public.mastermind_households_v1(household_id),
  CONSTRAINT mastermind_players_v1_creator_fkey FOREIGN KEY (household_id, created_by_player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_players_v1_role_check CHECK (role IN ('parent', 'child', 'guest', 'service')),
  CONSTRAINT mastermind_players_v1_state_check CHECK (state IN ('active', 'archived')),
  CONSTRAINT mastermind_players_v1_display_name_check CHECK (
    char_length(display_name) BETWEEN 1 AND 64 AND display_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mastermind_players_v1_revision_check CHECK (revision >= 1),
  CONSTRAINT mastermind_players_v1_archive_check CHECK (
    (state = 'active' AND archived_at IS NULL)
    OR (state = 'archived' AND archived_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS mastermind_players_v1_active_role_idx
  ON public.mastermind_players_v1 (household_id, role, player_id)
  WHERE state = 'active';

CREATE TABLE IF NOT EXISTS public.mastermind_player_external_identities_v1 (
  household_id text NOT NULL,
  player_id uuid NOT NULL,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  provider_alias text NULL,
  bound_by_player_id uuid NOT NULL,
  bound_at_player_revision bigint NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mastermind_player_external_identities_v1_pkey
    PRIMARY KEY (provider, provider_subject),
  CONSTRAINT mastermind_player_external_identities_v1_player_provider_key
    UNIQUE (household_id, player_id, provider),
  CONSTRAINT mastermind_player_external_identities_v1_player_fkey
    FOREIGN KEY (household_id, player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_player_external_identities_v1_actor_fkey
    FOREIGN KEY (household_id, bound_by_player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_player_external_identities_v1_provider_check
    CHECK (provider IN ('minecraft-java', 'clerk', 'local')),
  CONSTRAINT mastermind_player_external_identities_v1_subject_check CHECK (
    (provider = 'minecraft-java' AND provider_subject ~ '^[0-9a-f]{32}$')
    OR (provider = 'clerk' AND provider_subject ~ '^user_[A-Za-z0-9_-]{1,123}$')
    OR (provider = 'local' AND provider_subject ~ '^[a-z0-9][a-z0-9._:-]{0,127}$')
  ),
  CONSTRAINT mastermind_player_external_identities_v1_alias_check CHECK (
    provider_alias IS NULL
    OR (char_length(provider_alias) BETWEEN 1 AND 64 AND provider_alias !~ '[[:cntrl:]]')
  ),
  CONSTRAINT mastermind_player_external_identities_v1_revision_check
    CHECK (bound_at_player_revision >= 2)
);

COMMENT ON COLUMN public.mastermind_player_external_identities_v1.provider_subject IS
  'Authoritative normalized external subject. Minecraft profile names must never be stored here.';
COMMENT ON COLUMN public.mastermind_player_external_identities_v1.provider_alias IS
  'Non-authoritative display-only alias; never accepted by authorization or identity lookup.';

CREATE TABLE IF NOT EXISTS public.mastermind_player_consents_v1 (
  household_id text NOT NULL,
  player_id uuid NOT NULL,
  purpose text NOT NULL,
  decision text NOT NULL,
  revision bigint NOT NULL,
  decided_by_player_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mastermind_player_consents_v1_pkey PRIMARY KEY (household_id, player_id, purpose),
  CONSTRAINT mastermind_player_consents_v1_player_fkey FOREIGN KEY (household_id, player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_player_consents_v1_actor_fkey FOREIGN KEY (household_id, decided_by_player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_player_consents_v1_purpose_check CHECK (
    purpose IN ('capture', 'recall', 'session_summary', 'preference_learning', 'family_share', 'obsidian_export')
  ),
  CONSTRAINT mastermind_player_consents_v1_decision_check CHECK (decision IN ('allow', 'deny')),
  CONSTRAINT mastermind_player_consents_v1_revision_check CHECK (revision >= 2)
);

COMMENT ON TABLE public.mastermind_player_consents_v1 IS
  'Purpose-specific decisions. A missing row is always deny; callers must never infer consent from role.';

CREATE OR REPLACE FUNCTION public.enforce_mastermind_companion_capture_v1()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.domain = 'companion' THEN
    -- Serialize the authorization read with consent changes and player archive.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.household_id, 0));
    IF NEW.player_id IS NULL
      OR NEW.player_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR NOT EXISTS (
        SELECT 1
        FROM public.mastermind_players_v1 AS capture_player
        JOIN public.mastermind_households_v1 AS capture_household
          ON capture_household.household_id = capture_player.household_id
          AND capture_household.state = 'active'
        JOIN public.mastermind_player_consents_v1 AS capture_consent
          ON capture_consent.household_id = capture_player.household_id
          AND capture_consent.player_id = capture_player.player_id
          AND capture_consent.purpose = 'capture'
          AND capture_consent.decision = 'allow'
        WHERE capture_player.household_id = NEW.household_id
          AND capture_player.player_id::text = NEW.player_id
          AND capture_player.state = 'active'
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'companion memory capture is not authorized';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER mastermind_domain_event_receipts_v1_capture_guard
  BEFORE INSERT ON public.mastermind_domain_event_receipts_v1
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mastermind_companion_capture_v1();

CREATE OR REPLACE FUNCTION public.enforce_mastermind_session_summary_v1()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.projection_kind = 'companion.session.rollup' THEN
    -- Use the identity aggregate's exact lock before reading summary consent.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.household_id, 0));
    IF NEW.player_id IS NULL
      OR NEW.player_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR NOT EXISTS (
        SELECT 1
        FROM public.mastermind_players_v1 AS summary_player
        JOIN public.mastermind_households_v1 AS summary_household
          ON summary_household.household_id = summary_player.household_id
          AND summary_household.state = 'active'
        JOIN public.mastermind_player_consents_v1 AS summary_consent
          ON summary_consent.household_id = summary_player.household_id
          AND summary_consent.player_id = summary_player.player_id
          AND summary_consent.purpose = 'session_summary'
          AND summary_consent.decision = 'allow'
        JOIN public.mastermind_companion_sessions_v1 AS summary_session
          ON summary_session.household_id = summary_player.household_id
          AND summary_session.player_id = summary_player.player_id::text
          AND summary_session.session_id = NEW.session_id
        WHERE summary_player.household_id = NEW.household_id
          AND summary_player.player_id::text = NEW.player_id
          AND summary_player.state = 'active'
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'companion session summary is not authorized';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER mastermind_memory_projection_jobs_v1_summary_guard
  BEFORE INSERT OR UPDATE ON public.mastermind_memory_projection_jobs_v1
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mastermind_session_summary_v1();

CREATE TABLE IF NOT EXISTS public.mastermind_identity_command_receipts_v1 (
  command_id uuid NOT NULL,
  command_sha256 text NOT NULL,
  action text NOT NULL,
  household_id text NOT NULL,
  actor_player_id uuid NULL,
  subject_player_id uuid NOT NULL,
  result_status text NOT NULL,
  household_revision bigint NOT NULL,
  player_revision bigint NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mastermind_identity_command_receipts_v1_pkey PRIMARY KEY (command_id),
  CONSTRAINT mastermind_identity_command_receipts_v1_sha_check
    CHECK (command_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT mastermind_identity_command_receipts_v1_action_check CHECK (
    action IN ('household.bootstrap', 'player.register', 'identity.bind', 'consent.set', 'player.archive')
  ),
  CONSTRAINT mastermind_identity_command_receipts_v1_actor_check CHECK (
    (action = 'household.bootstrap' AND actor_player_id IS NULL)
    OR (action <> 'household.bootstrap' AND actor_player_id IS NOT NULL)
  ),
  CONSTRAINT mastermind_identity_command_receipts_v1_status_check CHECK (result_status = 'applied'),
  CONSTRAINT mastermind_identity_command_receipts_v1_revision_check CHECK (
    household_revision >= 1 AND player_revision >= 1
  )
);

CREATE TABLE IF NOT EXISTS public.mastermind_identity_audit_v1 (
  command_id uuid NOT NULL,
  command_sha256 text NOT NULL,
  action text NOT NULL,
  household_id text NOT NULL,
  actor_player_id uuid NULL,
  subject_player_id uuid NOT NULL,
  prior_household_revision bigint NOT NULL,
  resulting_household_revision bigint NOT NULL,
  prior_player_revision bigint NOT NULL,
  resulting_player_revision bigint NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mastermind_identity_audit_v1_pkey PRIMARY KEY (command_id),
  CONSTRAINT mastermind_identity_audit_v1_receipt_fkey FOREIGN KEY (command_id)
    REFERENCES public.mastermind_identity_command_receipts_v1(command_id),
  CONSTRAINT mastermind_identity_audit_v1_sha_check CHECK (command_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT mastermind_identity_audit_v1_revision_check CHECK (
    prior_household_revision >= 0
    AND resulting_household_revision >= 1
    AND prior_player_revision >= 0
    AND resulting_player_revision >= 1
  )
);

COMMENT ON TABLE public.mastermind_identity_audit_v1 IS
  'Append-only successful-command history. It intentionally stores no request payload, display name, alias, or external subject.';
REVOKE UPDATE, DELETE, TRUNCATE ON public.mastermind_identity_audit_v1 FROM PUBLIC;
CREATE OR REPLACE RULE mastermind_identity_audit_v1_no_update AS
  ON UPDATE TO public.mastermind_identity_audit_v1 DO INSTEAD NOTHING;
CREATE OR REPLACE RULE mastermind_identity_audit_v1_no_delete AS
  ON DELETE TO public.mastermind_identity_audit_v1 DO INSTEAD NOTHING;

CREATE OR REPLACE FUNCTION public.apply_mastermind_identity_command_v1(
  p_command_id uuid,
  p_command_sha256 text,
  p_action text,
  p_household_id text,
  p_actor_player_id uuid,
  p_subject_player_id uuid,
  p_expected_revision bigint,
  p_household_display_name text,
  p_player_display_name text,
  p_role text,
  p_provider text,
  p_provider_subject text,
  p_provider_alias text,
  p_purpose text,
  p_decision text
)
RETURNS TABLE (
  status text,
  command_id uuid,
  household_revision bigint,
  player_revision bigint,
  subject_player_id uuid
)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_sha256 text;
  v_existing_household_revision bigint;
  v_existing_player_revision bigint;
  v_existing_subject_player_id uuid;
  v_current_household_revision bigint;
  v_current_player_revision bigint;
  v_result_household_revision bigint;
  v_result_player_revision bigint;
  v_actor_role text;
  v_subject_role text;
  v_subject_state text;
  v_inserted integer;
  v_active_parent_count integer;
BEGIN
  IF p_command_id IS NULL
    OR p_command_sha256 IS NULL
    OR p_command_sha256 !~ '^[a-f0-9]{64}$'
    OR p_action IS NULL
    OR p_action NOT IN ('household.bootstrap', 'player.register', 'identity.bind', 'consent.set', 'player.archive')
    OR p_household_id IS NULL
    OR p_household_id !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR p_subject_player_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid identity command';
  END IF;

  -- Serialize equal command IDs before inspecting their durable receipt.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text, 20));

  SELECT receipt.command_sha256, receipt.household_revision, receipt.player_revision, receipt.subject_player_id
    INTO v_existing_sha256, v_existing_household_revision, v_existing_player_revision, v_existing_subject_player_id
    FROM public.mastermind_identity_command_receipts_v1 AS receipt
    WHERE receipt.command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_sha256 = p_command_sha256 THEN
      RETURN QUERY SELECT
        'duplicate'::text,
        p_command_id,
        v_existing_household_revision,
        v_existing_player_revision,
        v_existing_subject_player_id;
    ELSE
      RETURN QUERY SELECT
        'conflict'::text,
        p_command_id,
        NULL::bigint,
        NULL::bigint,
        NULL::uuid;
    END IF;
    RETURN;
  END IF;

  IF p_action = 'household.bootstrap' THEN
    IF p_actor_player_id IS NOT NULL
      OR p_expected_revision <> 0
      OR p_household_display_name IS NULL
      OR char_length(p_household_display_name) NOT BETWEEN 1 AND 64
      OR p_household_display_name ~ '[[:cntrl:]]'
      OR p_player_display_name IS NULL
      OR char_length(p_player_display_name) NOT BETWEEN 1 AND 64
      OR p_player_display_name ~ '[[:cntrl:]]'
      OR p_role IS DISTINCT FROM 'parent'
      OR p_provider IS NOT NULL
      OR p_provider_subject IS NOT NULL
      OR p_provider_alias IS NOT NULL
      OR p_purpose IS NOT NULL
      OR p_decision IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid household.bootstrap command';
    END IF;
  ELSIF p_action = 'player.register' THEN
    IF p_actor_player_id IS NULL
      OR p_expected_revision <> 0
      OR p_household_display_name IS NOT NULL
      OR p_player_display_name IS NULL
      OR char_length(p_player_display_name) NOT BETWEEN 1 AND 64
      OR p_player_display_name ~ '[[:cntrl:]]'
      OR p_role IS NULL
      OR p_role NOT IN ('parent', 'child', 'guest', 'service')
      OR p_provider IS NOT NULL
      OR p_provider_subject IS NOT NULL
      OR p_provider_alias IS NOT NULL
      OR p_purpose IS NOT NULL
      OR p_decision IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid player.register command';
    END IF;
  ELSIF p_action = 'identity.bind' THEN
    IF p_actor_player_id IS NULL
      OR p_expected_revision < 1
      OR p_household_display_name IS NOT NULL
      OR p_player_display_name IS NOT NULL
      OR p_role IS NOT NULL
      OR p_provider IS NULL
      OR p_provider NOT IN ('minecraft-java', 'clerk', 'local')
      OR p_provider_subject IS NULL
      OR char_length(p_provider_subject) NOT BETWEEN 1 AND 256
      OR p_provider_subject ~ '[[:cntrl:]]'
      OR (p_provider = 'minecraft-java' AND p_provider_subject !~ '^[0-9a-f]{32}$')
      OR (p_provider = 'clerk' AND p_provider_subject !~ '^user_[A-Za-z0-9_-]{1,123}$')
      OR (p_provider = 'local' AND p_provider_subject !~ '^[a-z0-9][a-z0-9._:-]{0,127}$')
      OR (
        p_provider_alias IS NOT NULL
        AND (char_length(p_provider_alias) NOT BETWEEN 1 AND 64 OR p_provider_alias ~ '[[:cntrl:]]')
      )
      OR p_purpose IS NOT NULL
      OR p_decision IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid identity.bind command';
    END IF;
  ELSIF p_action = 'consent.set' THEN
    IF p_actor_player_id IS NULL
      OR p_expected_revision < 1
      OR p_household_display_name IS NOT NULL
      OR p_player_display_name IS NOT NULL
      OR p_role IS NOT NULL
      OR p_provider IS NOT NULL
      OR p_provider_subject IS NOT NULL
      OR p_provider_alias IS NOT NULL
      OR p_purpose IS NULL
      OR p_purpose NOT IN ('capture', 'recall', 'session_summary', 'preference_learning', 'family_share', 'obsidian_export')
      OR p_decision IS NULL
      OR p_decision NOT IN ('allow', 'deny')
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid consent.set command';
    END IF;
  ELSE
    IF p_actor_player_id IS NULL
      OR p_expected_revision < 1
      OR p_household_display_name IS NOT NULL
      OR p_player_display_name IS NOT NULL
      OR p_role IS NOT NULL
      OR p_provider IS NOT NULL
      OR p_provider_subject IS NOT NULL
      OR p_provider_alias IS NOT NULL
      OR p_purpose IS NOT NULL
      OR p_decision IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid player.archive command';
    END IF;
  END IF;

  -- All commands for one household share an aggregate revision and lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id, 0));

  IF p_action = 'household.bootstrap' THEN
    SELECT household.revision
      INTO v_current_household_revision
      FROM public.mastermind_households_v1 AS household
      WHERE household.household_id = p_household_id;
    IF FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'identity revision conflict';
    END IF;

    INSERT INTO public.mastermind_households_v1 (
      household_id, display_name, state, revision
    ) VALUES (
      p_household_id, p_household_display_name, 'active', 1
    );
    INSERT INTO public.mastermind_players_v1 (
      household_id, player_id, display_name, role, state, revision, created_by_player_id
    ) VALUES (
      p_household_id, p_subject_player_id, p_player_display_name, 'parent', 'active', 1, NULL
    );
    v_current_household_revision := 0;
    v_current_player_revision := 0;
    v_result_household_revision := 1;
    v_result_player_revision := 1;
  ELSE
    SELECT household.revision
      INTO v_current_household_revision
      FROM public.mastermind_households_v1 AS household
      WHERE household.household_id = p_household_id
        AND household.state = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'identity command is not authorized';
    END IF;

    SELECT actor.role
      INTO v_actor_role
      FROM public.mastermind_players_v1 AS actor
      WHERE actor.household_id = p_household_id
        AND actor.player_id = p_actor_player_id
        AND actor.state = 'active';
    IF NOT FOUND OR v_actor_role <> 'parent' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'identity command requires an active parent';
    END IF;

    IF p_action = 'player.register' THEN
      SELECT subject.revision
        INTO v_current_player_revision
        FROM public.mastermind_players_v1 AS subject
        WHERE subject.household_id = p_household_id
          AND subject.player_id = p_subject_player_id;
      IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'identity revision conflict';
      END IF;

      INSERT INTO public.mastermind_players_v1 (
        household_id, player_id, display_name, role, state, revision, created_by_player_id
      ) VALUES (
        p_household_id, p_subject_player_id, p_player_display_name, p_role, 'active', 1, p_actor_player_id
      ) ON CONFLICT ON CONSTRAINT mastermind_players_v1_pkey DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'identity revision conflict';
      END IF;
      v_current_player_revision := 0;
      v_result_player_revision := 1;
    ELSE
      SELECT subject.revision, subject.role, subject.state
        INTO v_current_player_revision, v_subject_role, v_subject_state
        FROM public.mastermind_players_v1 AS subject
        WHERE subject.household_id = p_household_id
          AND subject.player_id = p_subject_player_id;
      IF NOT FOUND
        OR v_subject_state <> 'active'
        OR v_current_player_revision <> p_expected_revision
      THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'identity revision conflict';
      END IF;

      IF p_action = 'identity.bind' THEN
        INSERT INTO public.mastermind_player_external_identities_v1 (
          household_id, player_id, provider, provider_subject, provider_alias,
          bound_by_player_id, bound_at_player_revision
        ) VALUES (
          p_household_id, p_subject_player_id, p_provider, p_provider_subject, p_provider_alias,
          p_actor_player_id, p_expected_revision + 1
        );
      ELSIF p_action = 'consent.set' THEN
        INSERT INTO public.mastermind_player_consents_v1 (
          household_id, player_id, purpose, decision, revision, decided_by_player_id, decided_at
        ) VALUES (
          p_household_id, p_subject_player_id, p_purpose, p_decision,
          p_expected_revision + 1, p_actor_player_id, clock_timestamp()
        ) ON CONFLICT ON CONSTRAINT mastermind_player_consents_v1_pkey DO UPDATE SET
          decision = EXCLUDED.decision,
          revision = EXCLUDED.revision,
          decided_by_player_id = EXCLUDED.decided_by_player_id,
          decided_at = EXCLUDED.decided_at;
      ELSE
        IF v_subject_role = 'parent' THEN
          SELECT count(*)::integer
            INTO v_active_parent_count
            FROM public.mastermind_players_v1 AS parent_player
            WHERE parent_player.household_id = p_household_id
              AND parent_player.role = 'parent'
              AND parent_player.state = 'active';
          IF v_active_parent_count <= 1 THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'the last active parent cannot be archived';
          END IF;
        END IF;
      END IF;

      UPDATE public.mastermind_players_v1 AS subject
        SET revision = subject.revision + 1,
            state = CASE WHEN p_action = 'player.archive' THEN 'archived' ELSE subject.state END,
            archived_at = CASE WHEN p_action = 'player.archive' THEN clock_timestamp() ELSE subject.archived_at END,
            updated_at = clock_timestamp()
        WHERE subject.household_id = p_household_id
          AND subject.player_id = p_subject_player_id
          AND subject.revision = p_expected_revision
          AND subject.state = 'active'
        RETURNING subject.revision INTO v_result_player_revision;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'identity revision conflict';
      END IF;
    END IF;

    UPDATE public.mastermind_households_v1 AS household
      SET revision = household.revision + 1,
          updated_at = clock_timestamp()
      WHERE household.household_id = p_household_id
        AND household.state = 'active'
        AND household.revision = v_current_household_revision
      RETURNING household.revision INTO v_result_household_revision;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'identity revision conflict';
    END IF;
  END IF;

  INSERT INTO public.mastermind_identity_command_receipts_v1 (
    command_id, command_sha256, action, household_id, actor_player_id, subject_player_id,
    result_status, household_revision, player_revision
  ) VALUES (
    p_command_id, p_command_sha256, p_action, p_household_id, p_actor_player_id, p_subject_player_id,
    'applied', v_result_household_revision, v_result_player_revision
  ) ON CONFLICT ON CONSTRAINT mastermind_identity_command_receipts_v1_pkey DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'identity command receipt race';
  END IF;

  INSERT INTO public.mastermind_identity_audit_v1 (
    command_id, command_sha256, action, household_id, actor_player_id, subject_player_id,
    prior_household_revision, resulting_household_revision,
    prior_player_revision, resulting_player_revision
  ) VALUES (
    p_command_id, p_command_sha256, p_action, p_household_id, p_actor_player_id, p_subject_player_id,
    v_current_household_revision, v_result_household_revision,
    v_current_player_revision, v_result_player_revision
  );

  RETURN QUERY SELECT
    'applied'::text,
    p_command_id,
    v_result_household_revision,
    v_result_player_revision,
    p_subject_player_id;
END;
$$;

COMMENT ON FUNCTION public.apply_mastermind_identity_command_v1(
  uuid, text, text, text, uuid, uuid, bigint, text, text, text, text, text, text, text, text
) IS
  'Effect-once, parent-authorized identity aggregate mutation with target revision CAS and payload-free audit.';

CREATE OR REPLACE FUNCTION public.mastermind_can_read_memory_v1(
  p_household_id text,
  p_actor_player_id uuid,
  p_namespace text,
  p_visibility text,
  p_subject_player_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mastermind_households_v1 AS household
    JOIN public.mastermind_players_v1 AS actor
      ON actor.household_id = household.household_id
      AND actor.player_id = p_actor_player_id
      AND actor.state = 'active'
    JOIN public.mastermind_player_consents_v1 AS actor_recall
      ON actor_recall.household_id = actor.household_id
      AND actor_recall.player_id = actor.player_id
      AND actor_recall.purpose = 'recall'
      AND actor_recall.decision = 'allow'
    WHERE household.household_id = p_household_id
      AND household.state = 'active'
      AND p_namespace <> 'system/technical'
      AND (
        (
          p_visibility = 'private'
          AND p_subject_player_id = actor.player_id
          AND p_namespace = 'player/' || actor.player_id::text || '/private'
        )
        OR (
          p_visibility = 'family'
          AND p_subject_player_id IS NULL
          AND (
            p_namespace = 'family/shared'
            OR p_namespace ~ '^world/world-[a-f0-9]{64}$'
            OR p_namespace ~ '^project/[a-z0-9][a-z0-9._:-]{0,127}$'
          )
        )
        OR EXISTS (
          SELECT 1
          FROM public.mastermind_players_v1 AS shared_subject
          JOIN public.mastermind_player_consents_v1 AS subject_share
            ON subject_share.household_id = shared_subject.household_id
            AND subject_share.player_id = shared_subject.player_id
            AND subject_share.purpose = 'family_share'
            AND subject_share.decision = 'allow'
          WHERE shared_subject.household_id = household.household_id
            AND shared_subject.state = 'active'
            AND shared_subject.player_id = p_subject_player_id
            AND p_visibility = 'family'
            AND (
              p_namespace = 'family/shared'
              OR p_namespace ~ '^world/world-[a-f0-9]{64}$'
              OR p_namespace ~ '^project/[a-z0-9][a-z0-9._:-]{0,127}$'
              OR p_namespace = 'player/' || shared_subject.player_id::text || '/shared'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.mastermind_companion_sessions_v1 AS companion_session
          JOIN public.mastermind_players_v1 AS session_subject
            ON session_subject.household_id = companion_session.household_id
            AND session_subject.player_id::text = companion_session.player_id
            AND session_subject.state = 'active'
          LEFT JOIN public.mastermind_player_consents_v1 AS session_share
            ON session_share.household_id = session_subject.household_id
            AND session_share.player_id = session_subject.player_id
            AND session_share.purpose = 'family_share'
          WHERE companion_session.household_id = household.household_id
            AND companion_session.namespace = p_namespace
            AND companion_session.visibility = p_visibility
            AND session_subject.player_id = p_subject_player_id
            AND (
              (
                p_visibility = 'private'
                AND session_subject.player_id = actor.player_id
              )
              OR (
                p_visibility = 'family'
                AND session_share.decision = 'allow'
              )
            )
        )
      )
  );
$$;

COMMENT ON FUNCTION public.mastermind_can_read_memory_v1(text, uuid, text, text, uuid) IS
  'Default-deny pre-ranking scope predicate. Role never bypasses recall or family-share consent.';

COMMIT;
