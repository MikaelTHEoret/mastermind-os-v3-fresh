BEGIN;

CREATE TABLE IF NOT EXISTS public.genealogy_crawl_jobs (
  id bigserial PRIMARY KEY,
  frontier_id text NULL,
  archive text NOT NULL,
  source_url text NOT NULL,
  register_id text NULL,
  page_hint integer NULL,
  status text NOT NULL DEFAULT 'proposed',
  objective text NOT NULL,
  target_names text[] NOT NULL DEFAULT '{}',
  year_from integer NULL,
  year_to integer NULL,
  pages_discovered integer NOT NULL DEFAULT 0,
  pages_downloaded integer NOT NULL DEFAULT 0,
  pages_scanned integer NOT NULL DEFAULT 0,
  last_error text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_url, frontier_id)
);

CREATE TABLE IF NOT EXISTS public.genealogy_pages (
  id bigserial PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES public.genealogy_crawl_jobs(id) ON DELETE CASCADE,
  page_number integer NULL,
  source_url text NOT NULL,
  original_path text NULL,
  sha256 text NULL,
  width integer NULL,
  height integer NULL,
  status text NOT NULL DEFAULT 'discovered',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, source_url)
);

CREATE TABLE IF NOT EXISTS public.genealogy_capture_clients (
  client_id uuid PRIMARY KEY,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  extension_origin text NOT NULL CHECK (extension_origin ~ '^chrome-extension://[a-p]{32}$'),
  secret_sha256 char(64) NOT NULL CHECK (secret_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revoked')),
  approved_at timestamptz NULL,
  last_seen_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS genealogy_capture_clients_status_idx
  ON public.genealogy_capture_clients (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.genealogy_archive_assets (
  sha256 char(64) PRIMARY KEY CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  media_type text NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 12 AND 25165824),
  width integer NULL CHECK (width IS NULL OR width BETWEEN 1 AND 200000),
  height integer NULL CHECK (height IS NULL OR height BETWEEN 1 AND 200000),
  storage_key text NOT NULL UNIQUE CHECK (storage_key ~ '^objects/sha256/[a-f0-9]{2}/[a-f0-9]{64}\.(jpg|png)$'),
  first_source_url text NOT NULL CHECK (char_length(first_source_url) BETWEEN 8 AND 4096),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.genealogy_page_assets (
  page_id bigint NOT NULL REFERENCES public.genealogy_pages(id) ON DELETE CASCADE,
  asset_sha256 char(64) NOT NULL REFERENCES public.genealogy_archive_assets(sha256) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'original' CHECK (role IN ('original', 'enhanced', 'crop')),
  source_url text NOT NULL CHECK (char_length(source_url) BETWEEN 8 AND 4096),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, asset_sha256, role)
);

CREATE INDEX IF NOT EXISTS genealogy_page_assets_asset_idx
  ON public.genealogy_page_assets (asset_sha256, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.genealogy_acquisition_events (
  event_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.genealogy_capture_clients(client_id) ON DELETE RESTRICT,
  page_id bigint NOT NULL REFERENCES public.genealogy_pages(id) ON DELETE CASCADE,
  asset_sha256 char(64) NOT NULL REFERENCES public.genealogy_archive_assets(sha256) ON DELETE RESTRICT,
  source_url text NOT NULL CHECK (char_length(source_url) BETWEEN 8 AND 4096),
  register_id text NULL CHECK (register_id IS NULL OR register_id ~ '^[0-9]{6,18}$'),
  page_number integer NULL CHECK (page_number IS NULL OR page_number BETWEEN 0 AND 10000000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, source_url, asset_sha256)
);

CREATE INDEX IF NOT EXISTS genealogy_acquisition_events_page_idx
  ON public.genealogy_acquisition_events (page_id, captured_at DESC);

COMMENT ON TABLE public.genealogy_archive_assets IS
  'Immutable content-addressed metadata for original genealogy evidence images. Bytes remain in the private managed artifact store.';
COMMENT ON TABLE public.genealogy_acquisition_events IS
  'Append-only receipts for browser-extension evidence acquisition; OCR and graph assertions are separate derived layers.';

COMMIT;
