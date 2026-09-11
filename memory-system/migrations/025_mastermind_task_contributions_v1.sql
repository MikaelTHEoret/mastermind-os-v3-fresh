BEGIN;
-- Immutable advisory artifacts attached to the existing canonical tasks.
-- This adds neither a task scheduler nor an execution grant.
CREATE TABLE public.mastermind_task_contributions_v1 (
 artifact_id text PRIMARY KEY CHECK(artifact_id ~ '^[a-f0-9]{64}$'),
 task_id uuid NOT NULL REFERENCES public.mastermind_context_tasks_v1(task_id),
 slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 64),
 UNIQUE(task_id,slot),
 kind text NOT NULL CHECK(kind IN ('assignment','response','review')),
 operation_id uuid NOT NULL,
 parent_id text NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=131072),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,kind,operation_id),
 UNIQUE(artifact_id,task_id),
 FOREIGN KEY(parent_id,task_id) REFERENCES public.mastermind_task_contributions_v1(artifact_id,task_id),
 CHECK((kind='assignment' AND parent_id IS NULL) OR (kind<>'assignment' AND parent_id IS NOT NULL)),
 CHECK((document->>'schemaVersion') IS NOT DISTINCT FROM '1' AND (document->>'kind') IS NOT DISTINCT FROM kind AND (document->>'operationId') IS NOT DISTINCT FROM operation_id::text AND (document->'taskRef'->>'taskId') IS NOT DISTINCT FROM task_id::text)
);
CREATE INDEX mastermind_task_contributions_v1_task_idx ON public.mastermind_task_contributions_v1(task_id,created_at DESC,artifact_id);
REVOKE ALL ON public.mastermind_task_contributions_v1 FROM PUBLIC;
CREATE FUNCTION public.mastermind_task_contributions_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CONTRIBUTION_HISTORY_IMMUTABLE'; END; $$;
REVOKE ALL ON FUNCTION public.mastermind_task_contributions_immutable_v1() FROM PUBLIC;
CREATE TRIGGER mastermind_task_contributions_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.mastermind_task_contributions_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.mastermind_task_contributions_immutable_v1();
COMMENT ON TABLE public.mastermind_task_contributions_v1 IS 'Immutable assignments, original external responses and separate reviews; canonical ownership stays in mastermind_context_tasks_v1. No contribution authorizes execution.';
COMMIT;
