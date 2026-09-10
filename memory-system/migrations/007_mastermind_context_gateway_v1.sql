BEGIN;

CREATE TABLE IF NOT EXISTS public.mastermind_context_tasks_v1 (
  task_id uuid PRIMARY KEY,
  household_id text NOT NULL,
  actor_player_id uuid NOT NULL,
  project_id text NOT NULL,
  intent text NOT NULL,
  state text NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_checkpoint_at timestamptz NULL,
  CONSTRAINT mastermind_context_tasks_v1_actor_fkey
    FOREIGN KEY (household_id, actor_player_id)
    REFERENCES public.mastermind_players_v1(household_id, player_id),
  CONSTRAINT mastermind_context_tasks_v1_household_check CHECK (
    household_id ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  ),
  CONSTRAINT mastermind_context_tasks_v1_project_check CHECK (
    project_id ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  ),
  CONSTRAINT mastermind_context_tasks_v1_intent_check CHECK (
    char_length(intent) BETWEEN 1 AND 2000 AND intent !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mastermind_context_tasks_v1_state_check CHECK (
    state IN ('active', 'blocked', 'completed')
  ),
  CONSTRAINT mastermind_context_tasks_v1_revision_check CHECK (revision >= 0),
  CONSTRAINT mastermind_context_tasks_v1_checkpoint_time_check CHECK (
    (revision = 0 AND last_checkpoint_at IS NULL)
    OR (revision > 0 AND last_checkpoint_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS mastermind_context_tasks_v1_project_state_idx
  ON public.mastermind_context_tasks_v1
  (household_id, project_id, state, updated_at DESC, task_id);

CREATE TABLE IF NOT EXISTS public.mastermind_context_checkpoints_v1 (
  checkpoint_id uuid PRIMARY KEY,
  checkpoint_digest text NOT NULL,
  task_id uuid NOT NULL REFERENCES public.mastermind_context_tasks_v1(task_id),
  sequence bigint NOT NULL,
  state text NOT NULL,
  summary text NOT NULL,
  completed_items jsonb NOT NULL,
  open_items jsonb NOT NULL,
  blockers jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mastermind_context_checkpoints_v1_task_sequence_key UNIQUE (task_id, sequence),
  CONSTRAINT mastermind_context_checkpoints_v1_digest_check CHECK (
    checkpoint_digest ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT mastermind_context_checkpoints_v1_sequence_check CHECK (sequence >= 1),
  CONSTRAINT mastermind_context_checkpoints_v1_state_check CHECK (
    state IN ('active', 'blocked', 'completed')
  ),
  CONSTRAINT mastermind_context_checkpoints_v1_summary_check CHECK (
    char_length(summary) BETWEEN 1 AND 4096 AND summary !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mastermind_context_checkpoints_v1_arrays_check CHECK (
    jsonb_typeof(completed_items) = 'array'
    AND jsonb_typeof(open_items) = 'array'
    AND jsonb_typeof(blockers) = 'array'
    AND jsonb_array_length(completed_items) <= 32
    AND jsonb_array_length(open_items) <= 32
    AND jsonb_array_length(blockers) <= 32
  )
);

CREATE INDEX IF NOT EXISTS mastermind_context_checkpoints_v1_task_idx
  ON public.mastermind_context_checkpoints_v1 (task_id, sequence DESC, checkpoint_id);

COMMENT ON TABLE public.mastermind_context_tasks_v1 IS
  'Canonical provider-independent task state for persistent Mastermind context.';
COMMENT ON TABLE public.mastermind_context_checkpoints_v1 IS
  'Immutable idempotent recovery checkpoints. Contains bounded summaries, not raw prompt transcripts.';

REVOKE UPDATE, DELETE, TRUNCATE ON public.mastermind_context_checkpoints_v1 FROM PUBLIC;
CREATE OR REPLACE RULE mastermind_context_checkpoints_v1_no_update AS
  ON UPDATE TO public.mastermind_context_checkpoints_v1 DO INSTEAD NOTHING;
CREATE OR REPLACE RULE mastermind_context_checkpoints_v1_no_delete AS
  ON DELETE TO public.mastermind_context_checkpoints_v1 DO INSTEAD NOTHING;

CREATE OR REPLACE FUNCTION public.append_mastermind_context_checkpoint_v1(
  p_checkpoint_id uuid,
  p_checkpoint_digest text,
  p_task_id uuid,
  p_household_id text,
  p_actor_player_id uuid,
  p_project_id text,
  p_intent text,
  p_summary text,
  p_state text,
  p_completed_items jsonb,
  p_open_items jsonb,
  p_blockers jsonb
)
RETURNS TABLE (
  result_status text,
  result_task_id uuid,
  result_checkpoint_id uuid,
  result_sequence bigint,
  result_revision bigint
)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_digest text;
  v_existing_task_id uuid;
  v_existing_sequence bigint;
  v_task public.mastermind_context_tasks_v1%ROWTYPE;
  v_next_revision bigint;
  v_item jsonb;
BEGIN
  IF p_checkpoint_id IS NULL
    OR p_task_id IS NULL
    OR p_actor_player_id IS NULL
    OR p_checkpoint_digest !~ '^[a-f0-9]{64}$'
    OR p_household_id !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR p_project_id !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR char_length(p_intent) NOT BETWEEN 1 AND 2000
    OR p_intent ~ '[[:cntrl:]]'
    OR char_length(p_summary) NOT BETWEEN 1 AND 4096
    OR p_summary ~ '[[:cntrl:]]'
    OR p_state NOT IN ('active', 'blocked', 'completed')
    OR jsonb_typeof(p_completed_items) <> 'array'
    OR jsonb_typeof(p_open_items) <> 'array'
    OR jsonb_typeof(p_blockers) <> 'array'
    OR jsonb_array_length(p_completed_items) > 32
    OR jsonb_array_length(p_open_items) > 32
    OR jsonb_array_length(p_blockers) > 32
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid context checkpoint';
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_completed_items || p_open_items || p_blockers)
  LOOP
    IF jsonb_typeof(v_item) <> 'string'
      OR char_length(v_item #>> '{}') NOT BETWEEN 1 AND 512
      OR (v_item #>> '{}') ~ '[[:cntrl:]]'
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid context checkpoint item';
    END IF;
  END LOOP;

  IF NOT public.verify_mastermind_memory_operator_v1(p_household_id, p_actor_player_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'context checkpoint actor is not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_task_id::text, 0));

  SELECT checkpoint_digest, task_id, sequence
    INTO v_existing_digest, v_existing_task_id, v_existing_sequence
    FROM public.mastermind_context_checkpoints_v1
    WHERE checkpoint_id = p_checkpoint_id;
  IF FOUND THEN
    SELECT revision INTO v_next_revision
      FROM public.mastermind_context_tasks_v1
      WHERE task_id = v_existing_task_id;
    RETURN QUERY SELECT
      CASE WHEN v_existing_digest = p_checkpoint_digest THEN 'duplicate' ELSE 'conflict' END,
      v_existing_task_id,
      p_checkpoint_id,
      v_existing_sequence,
      v_next_revision;
    RETURN;
  END IF;

  SELECT * INTO v_task
    FROM public.mastermind_context_tasks_v1
    WHERE task_id = p_task_id;
  IF NOT FOUND THEN
    INSERT INTO public.mastermind_context_tasks_v1 (
      task_id, household_id, actor_player_id, project_id, intent, state
    ) VALUES (
      p_task_id, p_household_id, p_actor_player_id, p_project_id, p_intent, p_state
    )
    RETURNING * INTO v_task;
  ELSIF v_task.household_id <> p_household_id
    OR v_task.actor_player_id <> p_actor_player_id
    OR v_task.project_id <> p_project_id
    OR v_task.intent <> p_intent
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'context task identity is immutable';
  END IF;

  v_next_revision := v_task.revision + 1;
  INSERT INTO public.mastermind_context_checkpoints_v1 (
    checkpoint_id, checkpoint_digest, task_id, sequence, state, summary,
    completed_items, open_items, blockers
  ) VALUES (
    p_checkpoint_id, p_checkpoint_digest, p_task_id, v_next_revision, p_state, p_summary,
    p_completed_items, p_open_items, p_blockers
  );

  UPDATE public.mastermind_context_tasks_v1
    SET state = p_state,
        revision = v_next_revision,
        updated_at = clock_timestamp(),
        last_checkpoint_at = clock_timestamp()
    WHERE task_id = p_task_id;

  RETURN QUERY SELECT 'applied'::text, p_task_id, p_checkpoint_id, v_next_revision, v_next_revision;
END;
$$;

COMMIT;
