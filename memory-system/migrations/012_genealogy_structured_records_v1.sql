BEGIN;

CREATE TABLE IF NOT EXISTS public.genealogy_record_extraction_runs (
  id bigserial PRIMARY KEY,
  page_id bigint NOT NULL REFERENCES public.genealogy_pages(id) ON DELETE CASCADE,
  engine text NOT NULL,
  engine_version text NULL,
  prompt_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('complete', 'failed', 'needs_review')),
  source_asset_sha256 char(64) NULL,
  source_url text NOT NULL CHECK (char_length(source_url) BETWEEN 8 AND 4096),
  image_discarded boolean NOT NULL DEFAULT false,
  page_type text NOT NULL,
  language text NULL,
  visible_years integer[] NOT NULL DEFAULT '{}',
  mean_confidence double precision NULL CHECK (mean_confidence IS NULL OR mean_confidence BETWEEN 0 AND 1),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS genealogy_record_extraction_runs_idempotency_idx
  ON public.genealogy_record_extraction_runs (page_id, prompt_version, source_asset_sha256) NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS public.genealogy_records (
  id bigserial PRIMARY KEY,
  extraction_run_id bigint NOT NULL REFERENCES public.genealogy_record_extraction_runs(id) ON DELETE CASCADE,
  page_id bigint NOT NULL REFERENCES public.genealogy_pages(id) ON DELETE CASCADE,
  record_index integer NOT NULL CHECK (record_index BETWEEN 0 AND 10000),
  event_type text NOT NULL,
  event_date_text text NULL,
  event_year integer NULL CHECK (event_year IS NULL OR event_year BETWEEN 100 AND 3000),
  location_text text NULL,
  subject_text text NULL,
  excerpt text NULL,
  confidence double precision NULL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  bbox_x integer NULL,
  bbox_y integer NULL,
  bbox_width integer NULL,
  bbox_height integer NULL,
  review_status text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'confirmed', 'rejected')),
  evidence_class text NOT NULL DEFAULT 'lead' CHECK (evidence_class IN ('lead', 'corroborating', 'direct')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (extraction_run_id, record_index)
);

CREATE INDEX IF NOT EXISTS genealogy_records_page_idx
  ON public.genealogy_records (page_id, record_index);
CREATE INDEX IF NOT EXISTS genealogy_records_year_location_idx
  ON public.genealogy_records (event_year, location_text);

CREATE TABLE IF NOT EXISTS public.genealogy_record_people (
  id bigserial PRIMARY KEY,
  record_id bigint NOT NULL REFERENCES public.genealogy_records(id) ON DELETE CASCADE,
  person_index integer NOT NULL CHECK (person_index BETWEEN 0 AND 1000),
  role text NOT NULL,
  name_raw text NOT NULL,
  given_names text NULL,
  surname text NULL,
  normalized_name text NOT NULL,
  gender text NULL,
  residence text NULL,
  occupation text NULL,
  confidence double precision NULL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, person_index)
);

CREATE INDEX IF NOT EXISTS genealogy_record_people_surname_idx
  ON public.genealogy_record_people (lower(surname));
CREATE INDEX IF NOT EXISTS genealogy_record_people_name_trgm_idx
  ON public.genealogy_record_people USING gin (normalized_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.genealogy_record_relationships (
  id bigserial PRIMARY KEY,
  record_id bigint NOT NULL REFERENCES public.genealogy_records(id) ON DELETE CASCADE,
  relationship_index integer NOT NULL CHECK (relationship_index BETWEEN 0 AND 1000),
  relationship_type text NOT NULL,
  from_person_index integer NULL,
  to_person_index integer NULL,
  from_name text NULL,
  to_name text NULL,
  confidence double precision NULL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, relationship_index)
);

COMMENT ON TABLE public.genealogy_records IS
  'Spreadsheet-like row index of every visible archive event. Source images may be transient; the archive retrieval link remains on the page.';
COMMENT ON TABLE public.genealogy_record_people IS
  'Every named participant, including collateral families, witnesses, sponsors, officiants, spouses, and neighbors.';

COMMIT;
