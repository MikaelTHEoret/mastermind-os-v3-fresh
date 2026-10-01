BEGIN;
-- Additive advisory records in the existing owner/task aggregate. No job or grant.
ALTER TABLE public.mastermind_task_contributions_v1
 DROP CONSTRAINT mastermind_task_contributions_v1_kind_check,
 DROP CONSTRAINT mastermind_task_contributions_v1_check;
ALTER TABLE public.mastermind_task_contributions_v1
 ADD CONSTRAINT mastermind_task_contributions_v1_kind_check
 CHECK(kind IN ('assignment','response','review','nexus-proposal')),
 ADD CONSTRAINT mastermind_task_contributions_v1_check
 CHECK((kind IN ('assignment','nexus-proposal') AND parent_id IS NULL)
   OR (kind<>'assignment' AND parent_id IS NOT NULL)),
 ADD CONSTRAINT mastermind_nexus_proposal_shape_v1 CHECK(kind<>'nexus-proposal' OR COALESCE(
   document->>'seriesId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   AND document ? 'parentId' AND (document->>'parentId') IS NOT DISTINCT FROM parent_id
   AND document->>'dependencyMeaning'='source-ready-for-review'
   AND jsonb_typeof(document->'basis')='object'
   AND jsonb_typeof(document->'nodes')='array' AND jsonb_array_length(document->'nodes') BETWEEN 1 AND 32
   AND jsonb_typeof(document->'reviewIds')='array' AND jsonb_array_length(document->'reviewIds') BETWEEN 1 AND 12
   AND jsonb_typeof(document->'sourceRefs')='array' AND jsonb_array_length(document->'sourceRefs') BETWEEN 1 AND 12
   AND NOT (document ?| ARRAY['submission','grant','executionAuthorized','worker']),false));
CREATE UNIQUE INDEX mastermind_nexus_root_v1 ON public.mastermind_task_contributions_v1(task_id,(document->>'seriesId'))
 WHERE kind='nexus-proposal' AND parent_id IS NULL;
CREATE UNIQUE INDEX mastermind_nexus_successor_v1 ON public.mastermind_task_contributions_v1(task_id,parent_id)
 WHERE kind='nexus-proposal' AND parent_id IS NOT NULL;

-- Runs on direct INSERTs too. The task-row lock serializes permission/checkpoint
-- changes and proposal saves. Unique indexes also fence competing lineage heads.
CREATE FUNCTION public.check_mastermind_nexus_proposal_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t public.mastermind_context_tasks_v1; p public.mastermind_task_contributions_v1; r text;
BEGIN
 IF NEW.kind<>'nexus-proposal' THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.mastermind_context_tasks_v1 WHERE task_id=NEW.task_id FOR UPDATE;
 IF t.state IS DISTINCT FROM 'active' OR NOT public.verify_mastermind_memory_operator_v1(t.household_id,t.actor_player_id)
   OR t.project_id IS DISTINCT FROM NEW.document->'taskRef'->>'project'
   OR t.revision::text IS DISTINCT FROM NEW.document->'basis'->>'revision'
   OR t.permission_revision::text IS DISTINCT FROM NEW.document->'basis'->>'permissionRevision'
   OR t.permission_scope_sha256 IS DISTINCT FROM NEW.document->'basis'->>'permissionScopeSha256'
   OR t.permission_scope->>'status' IS DISTINCT FROM 'active'
   OR NOT EXISTS(SELECT 1 FROM public.mastermind_context_checkpoints_v1 c WHERE c.task_id=t.task_id
     AND c.sequence=t.revision AND c.checkpoint_id::text=NEW.document->'basis'->>'checkpointId')
 THEN RAISE EXCEPTION 'NEXUS_BASIS_CHANGED'; END IF;
 IF NEW.parent_id IS NOT NULL THEN
  SELECT * INTO p FROM public.mastermind_task_contributions_v1 WHERE artifact_id=NEW.parent_id AND task_id=NEW.task_id;
  IF NOT FOUND OR p.kind<>'nexus-proposal' OR (p.document->>'seriesId') IS DISTINCT FROM (NEW.document->>'seriesId')
   THEN RAISE EXCEPTION 'NEXUS_PARENT_CHANGED'; END IF;
 END IF;
 FOR r IN SELECT jsonb_array_elements_text(NEW.document->'reviewIds') LOOP
  IF NOT EXISTS(SELECT 1 FROM public.mastermind_task_contributions_v1 a WHERE a.task_id=NEW.task_id
    AND a.artifact_id=r AND a.kind='review' AND a.document->>'decision'='accepted-as-advice')
   THEN RAISE EXCEPTION 'NEXUS_REVIEW_REQUIRED'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.check_mastermind_nexus_proposal_v1() FROM PUBLIC;
CREATE TRIGGER check_mastermind_nexus_proposal_v1 BEFORE INSERT ON public.mastermind_task_contributions_v1
 FOR EACH ROW EXECUTE FUNCTION public.check_mastermind_nexus_proposal_v1();

CREATE FUNCTION public.save_mastermind_nexus_proposal_v1(
 p_task uuid,p_project text,p_household text,p_actor uuid,p_subject text,p_digest text,p_canonical text)
RETURNS TABLE(status text,"artifactId" text) LANGUAGE plpgsql AS $$
DECLARE t public.mastermind_context_tasks_v1; old public.mastermind_task_contributions_v1;
 d jsonb; op uuid; parent text; chosen_slot smallint;
BEGIN
 IF octet_length(p_canonical)>65536 OR encode(sha256(convert_to(p_canonical,'UTF8')),'hex') IS DISTINCT FROM p_digest
 THEN RAISE EXCEPTION 'NEXUS_DOCUMENT_INVALID'; END IF;
 d:=p_canonical::jsonb;
 IF d->>'kind' IS DISTINCT FROM 'nexus-proposal' OR d->>'schemaVersion' IS DISTINCT FROM '1'
  OR d->'taskRef'->>'taskId' IS DISTINCT FROM p_task::text OR d->'taskRef'->>'project' IS DISTINCT FROM p_project
 THEN RAISE EXCEPTION 'NEXUS_DOCUMENT_INVALID'; END IF;
 op:=(d->>'operationId')::uuid; parent:=d->>'parentId';
 -- Separate statements after the lock see the winner of a concurrent commit.
 SELECT * INTO t FROM public.mastermind_context_tasks_v1 WHERE task_id=p_task FOR UPDATE;
 IF NOT FOUND OR t.project_id IS DISTINCT FROM p_project OR t.household_id IS DISTINCT FROM p_household
  OR t.actor_player_id IS DISTINCT FROM p_actor OR NOT public.verify_mastermind_memory_operator_v1(t.household_id,t.actor_player_id)
  OR (p_subject IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.mastermind_player_external_identities_v1 i
    WHERE i.provider='clerk' AND i.provider_subject=p_subject AND i.household_id=t.household_id AND i.player_id=t.actor_player_id))
 THEN RETURN QUERY SELECT 'denied'::text,NULL::text; RETURN; END IF;
 SELECT * INTO old FROM public.mastermind_task_contributions_v1 WHERE task_id=p_task AND kind='nexus-proposal' AND operation_id=op;
 IF FOUND THEN
  RETURN QUERY SELECT CASE WHEN old.artifact_id=p_digest AND old.document=d THEN 'duplicate' ELSE 'conflict' END,old.artifact_id; RETURN;
 END IF;
 IF t.state<>'active' OR t.revision::text IS DISTINCT FROM d->'basis'->>'revision'
  OR t.permission_revision::text IS DISTINCT FROM d->'basis'->>'permissionRevision'
  OR t.permission_scope_sha256 IS DISTINCT FROM d->'basis'->>'permissionScopeSha256'
  OR t.permission_scope->>'status' IS DISTINCT FROM 'active'
  OR NOT EXISTS(SELECT 1 FROM public.mastermind_context_checkpoints_v1 c WHERE c.task_id=p_task AND c.sequence=t.revision AND c.checkpoint_id::text=d->'basis'->>'checkpointId')
 THEN RETURN QUERY SELECT 'basis_changed'::text,NULL::text; RETURN; END IF;
 IF parent IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.mastermind_task_contributions_v1 a WHERE a.task_id=p_task AND a.kind='nexus-proposal' AND a.document->>'seriesId'=d->>'seriesId')
  THEN RETURN QUERY SELECT 'head_changed'::text,NULL::text; RETURN; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.mastermind_task_contributions_v1 a WHERE a.task_id=p_task AND a.artifact_id=parent
    AND a.kind='nexus-proposal' AND a.document->>'seriesId'=d->>'seriesId')
   OR EXISTS(SELECT 1 FROM public.mastermind_task_contributions_v1 a WHERE a.task_id=p_task AND a.kind='nexus-proposal' AND a.parent_id=parent)
  THEN RETURN QUERY SELECT 'head_changed'::text,NULL::text; RETURN; END IF;
 END IF;
 SELECT n INTO chosen_slot FROM generate_series(1,64) n WHERE NOT EXISTS(
  SELECT 1 FROM public.mastermind_task_contributions_v1 a WHERE a.task_id=p_task AND a.slot=n) ORDER BY n LIMIT 1;
 IF chosen_slot IS NULL THEN RETURN QUERY SELECT 'capacity_reached'::text,NULL::text; RETURN; END IF;
 INSERT INTO public.mastermind_task_contributions_v1(artifact_id,task_id,slot,kind,operation_id,parent_id,document)
 VALUES(p_digest,p_task,chosen_slot,'nexus-proposal',op,parent,d);
 RETURN QUERY SELECT 'created'::text,p_digest;
END; $$;
REVOKE ALL ON FUNCTION public.save_mastermind_nexus_proposal_v1(uuid,text,text,uuid,text,text,text) FROM PUBLIC;
COMMENT ON FUNCTION public.save_mastermind_nexus_proposal_v1(uuid,text,text,uuid,text,text,text)
 IS 'Advisory proposal save only. Application must verify referenced private plans and source lineage before calling. Invoker rights; no execution grant.';
COMMIT;
