BEGIN;
-- Once history exists, roll back the feature flag, not the compatible reader.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.mastermind_task_contributions_v1 WHERE kind='nexus-proposal')
 THEN RAISE EXCEPTION 'NEXUS_HISTORY_REQUIRES_COMPATIBLE_READER'; END IF;
END; $$;
DROP TRIGGER check_mastermind_nexus_proposal_v1 ON public.mastermind_task_contributions_v1;
DROP FUNCTION public.check_mastermind_nexus_proposal_v1();
DROP FUNCTION public.save_mastermind_nexus_proposal_v1(uuid,text,text,uuid,text,text,text);
DROP INDEX public.mastermind_nexus_root_v1;
DROP INDEX public.mastermind_nexus_successor_v1;
ALTER TABLE public.mastermind_task_contributions_v1 DROP CONSTRAINT mastermind_nexus_proposal_shape_v1,
 DROP CONSTRAINT mastermind_task_contributions_v1_kind_check, DROP CONSTRAINT mastermind_task_contributions_v1_check;
ALTER TABLE public.mastermind_task_contributions_v1
 ADD CONSTRAINT mastermind_task_contributions_v1_kind_check CHECK(kind IN ('assignment','response','review')),
 ADD CONSTRAINT mastermind_task_contributions_v1_check CHECK((kind='assignment' AND parent_id IS NULL) OR (kind<>'assignment' AND parent_id IS NOT NULL));
COMMIT;
