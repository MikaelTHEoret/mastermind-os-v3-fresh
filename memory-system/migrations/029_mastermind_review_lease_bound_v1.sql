BEGIN;
-- Reviews already have bounded input validation in 028. The exchange replay
-- journal must also hold their lease envelope; the original 4 KiB limit remains
-- unchanged for every other capability. This changes no ownership or grants.
ALTER TABLE public.mastermind_node_exchanges_v1
  DROP CONSTRAINT mastermind_node_exchanges_v1_lease_check;
ALTER TABLE public.mastermind_node_exchanges_v1
  ADD CONSTRAINT mastermind_node_exchanges_v1_lease_check CHECK (
    response_lease IS NULL OR (
      jsonb_typeof(response_lease) = 'object' AND (
        octet_length(response_lease::text) <= 4096 OR (
          (response_lease ->> 'capability') IS NOT DISTINCT FROM 'mastermind.native.review'
          AND octet_length(response_lease::text) <= 32768
          AND public.mastermind_review_input_valid_v1(response_lease -> 'input') IS TRUE
        )
      )
    )
  );
COMMIT;
