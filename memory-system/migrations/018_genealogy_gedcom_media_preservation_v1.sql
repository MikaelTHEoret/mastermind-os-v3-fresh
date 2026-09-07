BEGIN;

CREATE TABLE IF NOT EXISTS public.genealogy_gedcom_media_items (
  id bigserial PRIMARY KEY,
  import_id bigint NOT NULL REFERENCES public.genealogy_graph_imports(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('person','family','source','other')),
  owner_gedcom_id text NOT NULL CHECK (char_length(owner_gedcom_id) BETWEEN 1 AND 240),
  node_id text NULL REFERENCES public.genealogy_graph_nodes(id) ON DELETE SET NULL,
  media_index integer NOT NULL CHECK (media_index BETWEEN 0 AND 100000),
  title text NULL,
  media_format text NULL,
  remote_url text NOT NULL CHECK (char_length(remote_url) BETWEEN 8 AND 8192),
  remote_expires_at timestamptz NULL,
  asset_sha256 char(64) NULL REFERENCES public.genealogy_archive_assets(sha256) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','downloading','preserved','failed','expired','unsupported')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1000),
  http_status integer NULL CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  last_error text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  preserved_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, owner_type, owner_gedcom_id, media_index)
);

CREATE INDEX IF NOT EXISTS genealogy_gedcom_media_status_idx
  ON public.genealogy_gedcom_media_items (import_id, status, id);

CREATE INDEX IF NOT EXISTS genealogy_gedcom_media_node_idx
  ON public.genealogy_gedcom_media_items (node_id, status, media_index)
  WHERE node_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS genealogy_gedcom_media_asset_idx
  ON public.genealogy_gedcom_media_items (asset_sha256)
  WHERE asset_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS genealogy_gedcom_media_remote_idx
  ON public.genealogy_gedcom_media_items (import_id, md5(remote_url));

COMMENT ON TABLE public.genealogy_gedcom_media_items IS
  'Resumable preservation manifest for media links carried by a GEDCOM export. Remote references and immutable local assets remain distinct.';

COMMENT ON COLUMN public.genealogy_gedcom_media_items.remote_expires_at IS
  'Best-effort expiry decoded from a signed media URL; local content-addressed preservation is permanent.';

COMMIT;
