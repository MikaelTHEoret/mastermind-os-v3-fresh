BEGIN;

ALTER TABLE public.genealogy_pages
  ADD COLUMN IF NOT EXISTS sequence_index integer NULL,
  ADD COLUMN IF NOT EXISTS archive_label text NULL,
  ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS index_status text NOT NULL DEFAULT 'unindexed',
  ADD COLUMN IF NOT EXISTS index_year_from integer NULL,
  ADD COLUMN IF NOT EXISTS index_year_to integer NULL,
  ADD COLUMN IF NOT EXISTS index_names text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS index_terms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS index_confidence double precision NULL,
  ADD COLUMN IF NOT EXISTS handwriting_cluster text NULL,
  ADD COLUMN IF NOT EXISTS indexed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(archive_label, '') || ' ' || coalesce(search_text, ''))) STORED;

CREATE INDEX IF NOT EXISTS genealogy_pages_job_sequence_idx
  ON public.genealogy_pages (job_id, sequence_index);

CREATE INDEX IF NOT EXISTS genealogy_pages_search_vector_idx
  ON public.genealogy_pages USING gin (search_vector);

CREATE INDEX IF NOT EXISTS genealogy_pages_index_year_idx
  ON public.genealogy_pages (job_id, index_year_from, index_year_to);

CREATE INDEX IF NOT EXISTS genealogy_pages_index_names_idx
  ON public.genealogy_pages USING gin (index_names);

CREATE INDEX IF NOT EXISTS genealogy_pages_metadata_idx
  ON public.genealogy_pages USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS public.genealogy_archive_catalogues (
  job_id bigint PRIMARY KEY REFERENCES public.genealogy_crawl_jobs(id) ON DELETE CASCADE,
  archive_id text NOT NULL CHECK (archive_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  manifest_url text NOT NULL CHECK (char_length(manifest_url) BETWEEN 8 AND 4096),
  label text NULL,
  total_pages integer NOT NULL CHECK (total_pages BETWEEN 1 AND 10000000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.genealogy_page_index_runs (
  id bigserial PRIMARY KEY,
  page_id bigint NOT NULL REFERENCES public.genealogy_pages(id) ON DELETE CASCADE,
  engine text NOT NULL,
  engine_version text NULL,
  prompt_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('complete', 'failed', 'needs_review')),
  page_type text NOT NULL,
  year_from integer NULL,
  year_to integer NULL,
  names text[] NOT NULL DEFAULT '{}',
  terms text[] NOT NULL DEFAULT '{}',
  handwriting_cluster text NULL,
  confidence double precision NULL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  source_asset_sha256 char(64) NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS genealogy_page_index_runs_page_idx
  ON public.genealogy_page_index_runs (page_id, created_at DESC);

CREATE INDEX IF NOT EXISTS genealogy_page_index_runs_names_idx
  ON public.genealogy_page_index_runs USING gin (names);

COMMENT ON TABLE public.genealogy_archive_catalogues IS
  'Manifest-level catalogue metadata. A complete page index is stored before selective image acquisition or OCR.';
COMMENT ON COLUMN public.genealogy_pages.search_text IS
  'Searchable derived text assembled from manifest metadata and reviewed or unreviewed transcription output.';

COMMIT;
