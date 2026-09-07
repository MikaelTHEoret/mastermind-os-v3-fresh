BEGIN;

CREATE TABLE IF NOT EXISTS public.genealogy_name_calibration_runs (
  id bigserial PRIMARY KEY,
  page_id bigint NOT NULL REFERENCES public.genealogy_pages(id) ON DELETE CASCADE,
  engine text NOT NULL,
  engine_version text NULL,
  prompt_version text NOT NULL,
  preprocess_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('complete', 'failed', 'needs_review')),
  source_asset_sha256 char(64) NOT NULL,
  tile_count integer NOT NULL CHECK (tile_count BETWEEN 1 AND 64),
  mean_confidence double precision NULL CHECK (mean_confidence IS NULL OR mean_confidence BETWEEN 0 AND 1),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, prompt_version, preprocess_version, source_asset_sha256)
);

CREATE TABLE IF NOT EXISTS public.genealogy_name_readings (
  id bigserial PRIMARY KEY,
  calibration_run_id bigint NOT NULL REFERENCES public.genealogy_name_calibration_runs(id) ON DELETE CASCADE,
  page_id bigint NOT NULL REFERENCES public.genealogy_pages(id) ON DELETE CASCADE,
  reading_index integer NOT NULL CHECK (reading_index BETWEEN 0 AND 10000),
  tile_id text NOT NULL,
  line_order integer NULL,
  role_hint text NOT NULL,
  reading_type text NOT NULL CHECK (reading_type IN ('given', 'surname', 'full', 'place', 'unknown')),
  name_raw text NOT NULL,
  normalized_name text NOT NULL,
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_excerpt text NULL,
  letter_evidence text NULL,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  bbox_x integer NULL,
  bbox_y integer NULL,
  bbox_width integer NULL,
  bbox_height integer NULL,
  review_status text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'confirmed', 'rejected')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calibration_run_id, reading_index)
);

CREATE INDEX IF NOT EXISTS genealogy_name_readings_page_idx
  ON public.genealogy_name_readings (page_id, reading_index);
CREATE INDEX IF NOT EXISTS genealogy_name_readings_name_trgm_idx
  ON public.genealogy_name_readings USING gin (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS genealogy_name_readings_confidence_idx
  ON public.genealogy_name_readings (confidence DESC, review_status);

CREATE TABLE IF NOT EXISTS public.genealogy_name_lexicon (
  id bigserial PRIMARY KEY,
  archive text NOT NULL,
  register_id text NOT NULL,
  handwriting_cluster text NOT NULL DEFAULT 'unclustered',
  canonical_reading text NOT NULL,
  normalized_name text NOT NULL,
  variants text[] NOT NULL DEFAULT '{}',
  supporting_pages integer[] NOT NULL DEFAULT '{}',
  support_count integer NOT NULL DEFAULT 0 CHECK (support_count >= 0),
  confidence double precision NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  review_status text NOT NULL DEFAULT 'candidate' CHECK (review_status IN ('candidate', 'confirmed', 'rejected')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (archive, register_id, handwriting_cluster, normalized_name)
);

CREATE INDEX IF NOT EXISTS genealogy_name_lexicon_name_trgm_idx
  ON public.genealogy_name_lexicon USING gin (normalized_name gin_trgm_ops);

COMMENT ON TABLE public.genealogy_name_readings IS
  'Blind visual name and place readings retained separately from proof records. Alternatives and letter evidence preserve uncertainty.';
COMMENT ON TABLE public.genealogy_name_lexicon IS
  'Repeated archive-local readings used for post-reading comparison; never supplied to the initial blind vision pass.';

COMMIT;
