BEGIN;

CREATE TABLE IF NOT EXISTS public.genealogy_htr_models (
  id bigserial PRIMARY KEY,
  model_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  engine text NOT NULL DEFAULT 'kraken',
  architecture text NOT NULL DEFAULT 'ppocrv6-small',
  base_model text NULL,
  weights_path text NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ready','training','failed','retired')),
  training_line_count integer NOT NULL DEFAULT 0 CHECK (training_line_count >= 0),
  validation_line_count integer NOT NULL DEFAULT 0 CHECK (validation_line_count >= 0),
  character_error_rate double precision NULL CHECK (character_error_rate IS NULL OR character_error_rate BETWEEN 0 AND 1),
  word_error_rate double precision NULL CHECK (word_error_rate IS NULL OR word_error_rate BETWEEN 0 AND 1),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.genealogy_htr_page_runs (
  id bigserial PRIMARY KEY,
  page_id bigint NOT NULL REFERENCES public.genealogy_pages(id) ON DELETE CASCADE,
  model_id bigint NULL REFERENCES public.genealogy_htr_models(id) ON DELETE SET NULL,
  engine_version text NOT NULL,
  segmentation_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','segmenting','recognizing','needs_review','complete','failed')),
  line_count integer NOT NULL DEFAULT 0 CHECK (line_count >= 0),
  mean_confidence double precision NULL CHECK (mean_confidence IS NULL OR mean_confidence BETWEEN 0 AND 1),
  literal_text text NULL,
  page_xml_path text NULL,
  error text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  UNIQUE (page_id, engine_version, segmentation_version, model_id)
);

CREATE INDEX IF NOT EXISTS genealogy_htr_page_runs_status_idx
  ON public.genealogy_htr_page_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.genealogy_htr_lines (
  id bigserial PRIMARY KEY,
  page_run_id bigint NOT NULL REFERENCES public.genealogy_htr_page_runs(id) ON DELETE CASCADE,
  page_id bigint NOT NULL REFERENCES public.genealogy_pages(id) ON DELETE CASCADE,
  line_index integer NOT NULL CHECK (line_index BETWEEN 0 AND 100000),
  region_index integer NULL,
  bbox_x integer NOT NULL CHECK (bbox_x >= 0),
  bbox_y integer NOT NULL CHECK (bbox_y >= 0),
  bbox_width integer NOT NULL CHECK (bbox_width > 0),
  bbox_height integer NOT NULL CHECK (bbox_height > 0),
  baseline jsonb NULL,
  predicted_text text NULL,
  corrected_text text NULL,
  confidence double precision NULL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  character_confidences jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','corrected','confirmed','rejected')),
  training_split text NOT NULL DEFAULT 'none' CHECK (training_split IN ('none','train','validation','test')),
  priority_score double precision NOT NULL DEFAULT 0 CHECK (priority_score BETWEEN 0 AND 1),
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_run_id, line_index)
);

CREATE INDEX IF NOT EXISTS genealogy_htr_lines_review_idx
  ON public.genealogy_htr_lines (review_status, priority_score DESC, id);
CREATE INDEX IF NOT EXISTS genealogy_htr_lines_page_idx
  ON public.genealogy_htr_lines (page_id, line_index);
CREATE INDEX IF NOT EXISTS genealogy_htr_lines_gold_idx
  ON public.genealogy_htr_lines (training_split, updated_at DESC)
  WHERE review_status IN ('corrected','confirmed') AND corrected_text IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.genealogy_htr_corrections (
  id bigserial PRIMARY KEY,
  line_id bigint NOT NULL REFERENCES public.genealogy_htr_lines(id) ON DELETE CASCADE,
  prior_text text NULL,
  corrected_text text NOT NULL,
  correction_kind text NOT NULL DEFAULT 'human' CHECK (correction_kind IN ('human','imported','adjudicated')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS genealogy_htr_corrections_line_idx
  ON public.genealogy_htr_corrections (line_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.genealogy_htr_training_runs (
  id bigserial PRIMARY KEY,
  model_id bigint NOT NULL REFERENCES public.genealogy_htr_models(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued','preparing','training','evaluating','complete','failed','stopped')),
  training_line_count integer NOT NULL DEFAULT 0,
  validation_line_count integer NOT NULL DEFAULT 0,
  checkpoint_path text NULL,
  output_weights_path text NULL,
  character_error_rate double precision NULL CHECK (character_error_rate IS NULL OR character_error_rate BETWEEN 0 AND 1),
  word_error_rate double precision NULL CHECK (word_error_rate IS NULL OR word_error_rate BETWEEN 0 AND 1),
  last_message text NULL,
  error text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL
);

INSERT INTO public.genealogy_htr_models (model_key, display_name, engine, architecture, status, metadata)
VALUES ('brittany-parish-v1', 'Brittany Parish HTR v1', 'kraken', 'ppocrv6-small', 'planned',
  '{"purpose":"literal historical handwriting recognition","language":"French and Latin","region":"Brittany","period":"sixteenth to nineteenth century"}'::jsonb)
ON CONFLICT (model_key) DO NOTHING;

COMMENT ON TABLE public.genealogy_htr_lines IS
  'Literal line-level handwriting recognition. Predicted text remains separate from human correction and downstream genealogy interpretation.';
COMMENT ON COLUMN public.genealogy_htr_lines.corrected_text IS
  'Human-verified diplomatic transcription used as gold training data; never silently replaced by contextual name reconstruction.';

COMMIT;
