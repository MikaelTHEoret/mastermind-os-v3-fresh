BEGIN;

ALTER TABLE public.genealogy_acquisition_events
  DROP CONSTRAINT IF EXISTS genealogy_acquisition_events_register_id_check;

ALTER TABLE public.genealogy_acquisition_events
  ADD CONSTRAINT genealogy_acquisition_events_register_id_check
  CHECK (register_id IS NULL OR register_id ~ '^[A-Za-z0-9._:-]{1,120}$');

COMMENT ON COLUMN public.genealogy_acquisition_events.register_id IS
  'Archive-native register identity, including numeric NLI identifiers and safe alphanumeric ARK/IIIF identifiers.';

COMMIT;
