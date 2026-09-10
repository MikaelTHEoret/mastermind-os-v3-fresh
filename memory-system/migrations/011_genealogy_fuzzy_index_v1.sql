BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DELETE FROM public.genealogy_page_index_runs older
USING public.genealogy_page_index_runs newer
WHERE older.id < newer.id
  AND older.page_id = newer.page_id
  AND older.prompt_version = newer.prompt_version
  AND older.source_asset_sha256 IS NOT DISTINCT FROM newer.source_asset_sha256;

CREATE UNIQUE INDEX IF NOT EXISTS genealogy_page_index_runs_idempotency_idx
  ON public.genealogy_page_index_runs (page_id, prompt_version, source_asset_sha256) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS genealogy_pages_search_text_trgm_idx
  ON public.genealogy_pages USING gin (search_text gin_trgm_ops);

COMMIT;
