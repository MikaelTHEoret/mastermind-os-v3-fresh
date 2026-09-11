BEGIN;
-- Preserve the legacy result bound; typed native envelopes use their accepted broker limit.
-- Wire receipts remain bounded to2048 bytes and local durable receipts to4096 bytes.
ALTER TABLE public.mastermind_node_job_receipts_v1
 DROP CONSTRAINT mastermind_node_job_receipts_v1_result_check;
ALTER TABLE public.mastermind_node_job_receipts_v1
 ADD CONSTRAINT mastermind_node_job_receipts_v1_result_check CHECK (
  result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <=
   CASE WHEN result->>'kind' IN ('mastermind.native.catalog','mastermind.native.reuse') THEN 2048 ELSE 1024 END)
 );
COMMIT;
