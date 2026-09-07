BEGIN;

ALTER TABLE public.genealogy_record_people
  ADD COLUMN IF NOT EXISTS surname_raw text NULL,
  ADD COLUMN IF NOT EXISTS surname_pattern text NULL,
  ADD COLUMN IF NOT EXISTS reconstructed_surname text NULL,
  ADD COLUMN IF NOT EXISTS normalized_surname text NULL,
  ADD COLUMN IF NOT EXISTS surname_reconstruction_basis text NULL,
  ADD COLUMN IF NOT EXISTS surname_visual_confidence double precision NULL CHECK (surname_visual_confidence IS NULL OR surname_visual_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS surname_contextual_confidence double precision NULL CHECK (surname_contextual_confidence IS NULL OR surname_contextual_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS surname_state text NOT NULL DEFAULT 'unknown' CHECK (surname_state IN ('visible','partial','reconstructed','absent','unknown'));

UPDATE public.genealogy_record_people
SET surname_raw=COALESCE(surname_raw,surname),
    reconstructed_surname=COALESCE(reconstructed_surname,surname),
    normalized_surname=COALESCE(normalized_surname,lower(regexp_replace(COALESCE(surname,''),'[^a-zA-Z0-9]+',' ','g'))),
    surname_state=CASE WHEN COALESCE(surname,'')<>'' THEN 'visible' ELSE surname_state END
WHERE surname IS NOT NULL;

CREATE INDEX IF NOT EXISTS genealogy_record_people_surname_trgm_idx
  ON public.genealogy_record_people USING gin (normalized_surname gin_trgm_ops);
CREATE INDEX IF NOT EXISTS genealogy_record_people_surname_state_idx
  ON public.genealogy_record_people (surname_state, surname_contextual_confidence DESC);

CREATE TABLE IF NOT EXISTS public.genealogy_background_workers (
  job_id bigint NOT NULL REFERENCES public.genealogy_crawl_jobs(id) ON DELETE CASCADE,
  worker_kind text NOT NULL CHECK (worker_kind IN ('name_calibration','structured_extraction')),
  status text NOT NULL CHECK (status IN ('idle','starting','running','blocked','stalled','complete','stopped')),
  process_id integer NULL,
  current_page integer NULL,
  total_pages integer NOT NULL DEFAULT 0,
  completed_pages integer NOT NULL DEFAULT 0,
  cached_pages integer NOT NULL DEFAULT 0,
  records_found integer NOT NULL DEFAULT 0,
  people_found integer NOT NULL DEFAULT 0,
  relationships_found integer NOT NULL DEFAULT 0,
  last_message text NULL,
  last_error text NULL,
  blocked_reason text NULL,
  started_at timestamptz NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (job_id,worker_kind)
);

CREATE INDEX IF NOT EXISTS genealogy_background_workers_status_idx
  ON public.genealogy_background_workers (status,heartbeat_at DESC);

COMMENT ON COLUMN public.genealogy_record_people.surname_raw IS
  'Literal visible family-name letters, kept separately from the full personal-name reading.';
COMMENT ON COLUMN public.genealogy_record_people.reconstructed_surname IS
  'Archive-context surname hypothesis; never overwrites surname_raw or surname_pattern.';
COMMENT ON TABLE public.genealogy_background_workers IS
  'Persistent heartbeat and blocker state for local genealogy workers, displayed by the live Genealogy interface.';

COMMIT;
