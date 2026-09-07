"""Prepare migration021 from the preserved v1 functions. Never connects to a database."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[3]
source = (root / 'memory-system/migrations/006_mastermind_node_exchange_start_window_v1.sql').read_text()
base = re.search(r'CREATE OR REPLACE FUNCTION public\.exchange_mastermind_node_v1\([\s\S]*?\n\$\$;', source).group()
engine = base.replace('public.exchange_mastermind_node_v1(', 'public.exchange_mastermind_node_negotiated_v2(', 1)
engine = engine.replace('p_candidate_lease_id uuid\n)', 'p_candidate_lease_id uuid,\n  p_worker jsonb\n)', 1)
assert 'p_worker jsonb' in engine
engine = engine.replace('  SELECT * INTO v_node FROM public.mastermind_nodes_v1', """  IF NOT COALESCE(public.mastermind_node_worker_valid_v2(p_worker), false) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported worker capabilities';
  END IF;
  SELECT * INTO v_node FROM public.mastermind_nodes_v1""", 1)
# Reject SQL NULL explicitly before three-valued comparisons; both public exchange wrappers use this guard.
engine = engine.replace("    OR p_request_sha256 !~", "    OR p_request_sha256 IS NULL OR p_credential_sha256 IS NULL OR p_sent_at IS NULL\n    OR p_agent_version IS NULL OR p_status IS NULL OR p_receipts IS NULL OR p_receipt_sha256s IS NULL\n    OR p_request_sha256 !~", 1)
engine = engine.replace("WHERE digest !~", "WHERE digest IS NULL OR digest !~", 1)
engine = engine.replace("v_node.credential_sha256 <> p_credential_sha256", "v_node.credential_sha256 IS DISTINCT FROM p_credential_sha256", 1)
engine = engine.replace('      last_status = p_status', '      last_status = p_status,\n      last_worker = p_worker', 1)
support = 'public.mastermind_node_worker_supports_v2(p_worker, mastermind_node_jobs_v1.capability, mastermind_node_jobs_v1.capability_version)'
anchors = [
    "WHERE mastermind_node_jobs_v1.job_id = (v_exchange.response_lease ->> 'jobId')::uuid",
    'SELECT * INTO v_job FROM public.mastermind_node_jobs_v1\n    WHERE mastermind_node_jobs_v1.job_id = v_job_id',
    'SELECT * INTO v_job FROM public.mastermind_node_jobs_v1\n  WHERE mastermind_node_jobs_v1.node_id = p_node_id',
    'SELECT * INTO v_job FROM public.mastermind_node_jobs_v1\n    WHERE mastermind_node_jobs_v1.node_id = p_node_id',
]
for anchor in anchors:
    assert engine.count(anchor) == 1, anchor
    engine = engine.replace(anchor, anchor + '\n      AND ' + support, 1)
engine = engine.replace("GREATEST(expires_at, created_at + interval '2 hours')", "CASE WHEN capability = 'family-ecosystem.ensure-running' THEN GREATEST(expires_at, created_at + interval '2 hours') ELSE expires_at END")
engine = engine.replace("lease_expires_at = CASE WHEN capability = 'family-ecosystem.ensure-running' THEN GREATEST(expires_at, created_at + interval '2 hours') ELSE expires_at END", "lease_expires_at = CASE WHEN capability = 'family-ecosystem.ensure-running' THEN GREATEST(expires_at, created_at + interval '2 hours') ELSE LEAST(expires_at, v_now + interval '30 seconds') END")
engine = engine.replace('    IF v_sequence <= COALESCE((', """    IF (v_job.capability = 'mastermind.core.status' AND (
      (v_receipt ->> 'state' = 'succeeded' AND v_receipt -> 'result' ->> 'kind' IS DISTINCT FROM 'mastermind.core.status')
      OR (v_receipt ->> 'state' <> 'succeeded' AND NULLIF(v_receipt -> 'result', 'null'::jsonb) IS NOT NULL)
    )) OR (v_job.capability = 'family-ecosystem.ensure-running' AND v_receipt -> 'result' ? 'kind') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'receipt result does not match its typed capability';
    END IF;
    IF v_sequence <= COALESCE((""", 1)
engine = engine.replace("    SELECT * INTO v_existing_receipt", """    IF v_receipt_id IS NULL OR v_job_id IS NULL OR v_lease_id IS NULL OR v_boot_id IS NULL OR v_sequence IS NULL
      OR v_receipt ->> 'commandDigest' IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid node receipt identity';
    END IF;
    SELECT * INTO v_existing_receipt""", 1)
engine = engine.replace("v_job.lease_id <> v_lease_id", "v_job.lease_id IS DISTINCT FROM v_lease_id", 1)
engine = engine.replace("v_job.command_sha256 <> (v_receipt ->> 'commandDigest')", "v_job.command_sha256 IS DISTINCT FROM (v_receipt ->> 'commandDigest')", 1)
header = base.split('LANGUAGE plpgsql')[0]
args = 'p_exchange_id,p_request_sha256,p_node_id,p_credential_sha256,p_boot_id,p_sent_at,p_agent_version,p_status,p_receipts,p_receipt_sha256s,p_candidate_lease_id'
legacy = header + "LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $$\n SELECT * FROM public.exchange_mastermind_node_negotiated_v2(" + args + ", '{\"protocolVersion\":1,\"capabilities\":[{\"id\":\"family-ecosystem.ensure-running\",\"version\":1}]}'::jsonb);\n$$;"
v2header = header.replace('public.exchange_mastermind_node_v1(', 'public.exchange_mastermind_node_v2(', 1).replace('p_candidate_lease_id uuid\n)', 'p_candidate_lease_id uuid,\n  p_worker jsonb\n)', 1)
v2 = v2header + """LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
BEGIN
 IF p_worker -> 'protocolVersion' IS DISTINCT FROM '2'::jsonb THEN
   RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'v2 worker negotiation required';
 END IF;
 RETURN QUERY SELECT * FROM public.exchange_mastermind_node_negotiated_v2(""" + args + ',p_worker);\nEND;\n$$;'
enqueue_source = (root / 'memory-system/migrations/004_mastermind_node_exchange_v1.sql').read_text()
family_enqueue = re.search(r'CREATE OR REPLACE FUNCTION public\.enqueue_mastermind_node_job_v1\([\s\S]*?\n\$\$;', enqueue_source).group()
family_enqueue = family_enqueue.replace("IF v_existing.command_sha256 = p_command_sha256", "IF v_existing.command_sha256 = p_command_sha256\n      AND v_existing.capability = 'family-ecosystem.ensure-running'", 1)
family_enqueue = family_enqueue.replace("OR p_command_sha256 !~", "OR p_command_sha256 IS NULL OR p_household_id IS NULL OR p_expires_at IS NULL\n    OR p_command_sha256 !~", 1)
enqueue = family_enqueue.replace('public.enqueue_mastermind_node_job_v1(', 'public.enqueue_mastermind_core_status_job_v2(', 1).replace('family-ecosystem.ensure-running', 'mastermind.core.status')
preamble = '''BEGIN;
-- Prepared only; no production application is authorized by this file.
-- Capability filtering is installed before the jobs constraint is broadened.
ALTER TABLE public.mastermind_nodes_v1 ADD COLUMN IF NOT EXISTS last_worker jsonb NULL;

CREATE OR REPLACE FUNCTION public.mastermind_node_worker_valid_v2(p_worker jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE item jsonb; seen text[] := ARRAY[]::text[];
BEGIN
 IF p_worker IS NULL OR jsonb_typeof(p_worker) <> 'object'
   OR (p_worker - 'protocolVersion' - 'capabilities') <> '{}'::jsonb
   OR p_worker -> 'protocolVersion' IS NULL OR p_worker -> 'capabilities' IS NULL
   OR p_worker ->> 'protocolVersion' NOT IN ('1','2')
   OR jsonb_typeof(p_worker -> 'capabilities') <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p_worker -> 'capabilities') NOT BETWEEN 1 AND 2 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_worker -> 'capabilities') LOOP
   IF jsonb_typeof(item) <> 'object' OR (item - 'id' - 'version') <> '{}'::jsonb
     OR item ->> 'id' IS NULL OR item -> 'version' IS DISTINCT FROM '1'::jsonb
     OR item ->> 'id' NOT IN ('family-ecosystem.ensure-running','mastermind.core.status')
     OR item ->> 'id' = ANY(seen) THEN RETURN false; END IF;
   seen := array_append(seen,item ->> 'id');
 END LOOP;
 IF p_worker -> 'protocolVersion' = '1'::jsonb THEN RETURN seen = ARRAY['family-ecosystem.ensure-running']; END IF;
 RETURN p_worker -> 'protocolVersion' = '2'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.mastermind_node_worker_supports_v2(p_worker jsonb,p_capability text,p_version smallint)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
 SELECT p_version = 1 AND EXISTS (
   SELECT 1 FROM jsonb_array_elements(p_worker -> 'capabilities') AS item
   WHERE item ->> 'id' = p_capability AND item -> 'version' = '1'::jsonb
 );
$$;
'''
constraint = '''
-- The v1 API above is now hardwired to family-only leasing, including replay/renewal.
ALTER TABLE public.mastermind_node_jobs_v1 DROP CONSTRAINT mastermind_node_jobs_v1_capability_check;
ALTER TABLE public.mastermind_node_jobs_v1 ADD CONSTRAINT mastermind_node_jobs_v1_capability_check CHECK (
 capability IN ('family-ecosystem.ensure-running','mastermind.core.status')
 AND capability_version = 1 AND policy_class = 'routine' AND command_input = '{}'::jsonb
);
'''
text = preamble + '\n' + engine + '\n\n' + legacy + '\n' + constraint + '\n' + family_enqueue + '\n\n' + enqueue + '\n\n' + v2 + '\nCOMMIT;\n'
target = root / 'memory-system/migrations/021_mastermind_node_core_status_v2.sql'
if target.exists() and target.read_text() != text:
    import sys
    if '--reviewed-update' not in sys.argv:
        raise ValueError('Existing migration differs; review then use --reviewed-update')
target.write_text(text, encoding='utf-8', newline='\n')
print('Prepared migration021; four capability-filtered authority selection paths; no DB connection.')
