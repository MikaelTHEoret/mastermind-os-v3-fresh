BEGIN;

ALTER TABLE public.genealogy_records
  ADD COLUMN IF NOT EXISTS entry_order integer NULL,
  ADD COLUMN IF NOT EXISTS column_index integer NULL,
  ADD COLUMN IF NOT EXISTS visual_confidence double precision NULL CHECK (visual_confidence IS NULL OR visual_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS contextual_confidence double precision NULL CHECK (contextual_confidence IS NULL OR contextual_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS boundary_confidence double precision NULL CHECK (boundary_confidence IS NULL OR boundary_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS date_visual_text text NULL,
  ADD COLUMN IF NOT EXISTS date_source text NULL CHECK (date_source IS NULL OR date_source IN ('explicit','page_heading','previous_record','next_record','adjacent_page','section_marker','unknown')),
  ADD COLUMN IF NOT EXISTS date_inferred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS formula_template text NULL;

ALTER TABLE public.genealogy_record_people
  ADD COLUMN IF NOT EXISTS name_pattern text NULL,
  ADD COLUMN IF NOT EXISTS reconstructed_name text NULL,
  ADD COLUMN IF NOT EXISTS visual_confidence double precision NULL CHECK (visual_confidence IS NULL OR visual_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS contextual_confidence double precision NULL CHECK (contextual_confidence IS NULL OR contextual_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS reconstruction_basis text NULL;

CREATE TABLE IF NOT EXISTS public.genealogy_record_formula_observations (
  id bigserial PRIMARY KEY,
  extraction_run_id bigint NOT NULL REFERENCES public.genealogy_record_extraction_runs(id) ON DELETE CASCADE,
  page_id bigint NOT NULL REFERENCES public.genealogy_pages(id) ON DELETE CASCADE,
  formula_index integer NOT NULL CHECK (formula_index BETWEEN 0 AND 10000),
  formula_kind text NOT NULL CHECK (formula_kind IN ('record_opening','baptism','marriage','burial','date_phrase','kinship','godparent','witness','residence','officiant_signature','section_heading','other')),
  text_raw text NOT NULL,
  normalized_pattern text NOT NULL,
  inferred_meaning text NULL,
  visual_confidence double precision NOT NULL CHECK (visual_confidence BETWEEN 0 AND 1),
  contextual_confidence double precision NOT NULL CHECK (contextual_confidence BETWEEN 0 AND 1),
  bbox_x integer NULL,
  bbox_y integer NULL,
  bbox_width integer NULL,
  bbox_height integer NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (extraction_run_id, formula_index)
);

CREATE INDEX IF NOT EXISTS genealogy_record_formula_page_kind_idx
  ON public.genealogy_record_formula_observations (page_id, formula_kind);
CREATE INDEX IF NOT EXISTS genealogy_record_formula_pattern_trgm_idx
  ON public.genealogy_record_formula_observations USING gin (normalized_pattern gin_trgm_ops);

COMMENT ON COLUMN public.genealogy_record_people.name_pattern IS
  'Literal partial letter pattern such as J???N; never replaced by contextual reconstruction.';
COMMENT ON COLUMN public.genealogy_record_people.reconstructed_name IS
  'Contextual name hypothesis retained separately from the literal visual reading.';
COMMENT ON TABLE public.genealogy_record_formula_observations IS
  'Recurring procedural language and signatures used to learn page structure without confusing formulas for people.';

COMMIT;
