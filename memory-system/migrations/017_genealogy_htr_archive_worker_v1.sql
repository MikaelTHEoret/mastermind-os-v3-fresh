BEGIN;

CREATE TABLE IF NOT EXISTS public.genealogy_htr_archive_workers (
  job_id bigint PRIMARY KEY REFERENCES public.genealogy_crawl_jobs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','starting','running','pausing','paused','complete','failed','stopped')),
  process_id integer NULL,
  current_page integer NULL,
  stage text NOT NULL DEFAULT 'idle' CHECK (stage IN ('idle','selecting','segmenting','recognizing','saving','paused','complete','failed')),
  total_pages integer NOT NULL DEFAULT 0 CHECK (total_pages >= 0),
  completed_pages integer NOT NULL DEFAULT 0 CHECK (completed_pages >= 0),
  failed_pages integer NOT NULL DEFAULT 0 CHECK (failed_pages >= 0),
  lines_detected integer NOT NULL DEFAULT 0 CHECK (lines_detected >= 0),
  stop_requested boolean NOT NULL DEFAULT false,
  last_message text NULL,
  last_error text NULL,
  started_at timestamptz NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS genealogy_htr_archive_workers_status_idx
  ON public.genealogy_htr_archive_workers (status, heartbeat_at DESC);

COMMENT ON TABLE public.genealogy_htr_archive_workers IS
  'Persistent archive-wide local HTR worker state. Pause requests are honored after the current page so page evidence is never left half-written.';

COMMIT;
