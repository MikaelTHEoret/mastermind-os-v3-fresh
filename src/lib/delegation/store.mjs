import {createHash} from 'node:crypto';
import {ContributionError,canonical,validateRecord,validateParent,taskRef,digestId} from './contract.mjs';
export const digest=record=>createHash('sha256').update(canonical(record)).digest('hex');
const fail=(code,status=409)=>{throw new ContributionError(code,status);};
function envelope(row){
 const record=validateRecord(typeof row.record==='string'?JSON.parse(row.record):row.record);
 if(digest(record)!==row.artifactId)fail('CONTRIBUTION_STORED_HASH_MISMATCH',503);
 return {artifactId:row.artifactId,record,recordedAt:row.recordedAt};
}
export class ContributionStore{
 constructor(query,owner){this.query=query;this.owner=owner;}
 ownerArgs(ref){taskRef(ref);return [ref.taskId,ref.project,this.owner.householdId,this.owner.actorPlayerId];}
 async assertTask(ref,write=false){
  const rows=await this.query(`SELECT t.task_id::text AS "taskId" FROM public.mastermind_context_tasks_v1 t
   WHERE t.task_id=$1::uuid AND t.project_id=$2::text AND t.household_id=$3::text AND t.actor_player_id=$4::uuid
   AND public.verify_mastermind_memory_operator_v1(t.household_id,t.actor_player_id)
   AND ($5::boolean=false OR t.state='active')`,[...this.ownerArgs(ref),write]);
  if(rows.length!==1)fail('CONTRIBUTION_TASK_ACCESS_DENIED',403);
 }
 async get(ref,id){
  digestId(id);
  const rows=await this.query(`SELECT a.artifact_id AS "artifactId",a.document AS record,a.created_at AS "recordedAt"
   FROM public.mastermind_task_contributions_v1 a JOIN public.mastermind_context_tasks_v1 t USING(task_id)
   WHERE t.task_id=$1::uuid AND t.project_id=$2::text AND t.household_id=$3::text AND t.actor_player_id=$4::uuid
   AND public.verify_mastermind_memory_operator_v1(t.household_id,t.actor_player_id) AND a.artifact_id=$5::text`,[...this.ownerArgs(ref),id]);
  if(rows.length!==1)fail('CONTRIBUTION_UNAVAILABLE',404);
  const row=envelope(rows[0]);if(canonical(row.record.taskRef)!==canonical(ref))fail('CONTRIBUTION_TASK_MISMATCH',503);return row;
 }
 async list(ref){
  await this.assertTask(ref);
  const rows=await this.query(`SELECT a.artifact_id AS "artifactId",a.document AS record,a.created_at AS "recordedAt"
   FROM public.mastermind_task_contributions_v1 a JOIN public.mastermind_context_tasks_v1 t USING(task_id)
   WHERE t.task_id=$1::uuid AND t.project_id=$2::text AND t.household_id=$3::text AND t.actor_player_id=$4::uuid
   AND public.verify_mastermind_memory_operator_v1(t.household_id,t.actor_player_id)
   ORDER BY a.created_at DESC,a.artifact_id DESC LIMIT 65`,this.ownerArgs(ref));
  // No silent partial history: caller must archive/reconcile before exceeding this first profile.
  if(rows.length>64)fail('CONTRIBUTION_HISTORY_LIMIT',409);
  await this.assertTask(ref);
  return rows.map(envelope);
 }
 async save(raw){
  const record=validateRecord(raw),ref=record.taskRef,id=digest(record);
  await this.assertTask(ref,true);
  const parent=record.kind==='assignment'?null:await this.get(ref,record.parentId);
  validateParent(record,parent);
  const rows=await this.query(`WITH owned AS MATERIALIZED (
    SELECT t.task_id FROM public.mastermind_context_tasks_v1 t WHERE t.task_id=$1::uuid
    AND t.project_id=$2::text AND t.household_id=$3::text AND t.actor_player_id=$4::uuid AND t.state='active'
    AND public.verify_mastermind_memory_operator_v1(t.household_id,t.actor_player_id) FOR UPDATE),
   inserted AS (
    INSERT INTO public.mastermind_task_contributions_v1(artifact_id,task_id,slot,kind,operation_id,parent_id,document)
    SELECT $5::text,o.task_id,(SELECT n FROM generate_series(1,64) n WHERE NOT EXISTS(SELECT 1 FROM public.mastermind_task_contributions_v1 used WHERE used.task_id=o.task_id AND used.slot=n) ORDER BY n LIMIT 1),$6::text,$7::uuid,$8::text,$9::jsonb FROM owned o
    WHERE (SELECT count(*) FROM public.mastermind_task_contributions_v1 a WHERE a.task_id=o.task_id)<64
    AND ($8::text IS NULL OR EXISTS(SELECT 1 FROM public.mastermind_task_contributions_v1 p
      WHERE p.artifact_id=$8::text AND p.task_id=o.task_id AND p.kind=$10::text))
    ON CONFLICT DO NOTHING RETURNING artifact_id)
   SELECT artifact_id AS "artifactId" FROM inserted`,
   [...this.ownerArgs(ref),id,record.kind,record.operationId,record.parentId??null,canonical(record),record.kind==='response'?'assignment':'response']);
  await this.assertTask(ref,true);
  // Resolve duplicates after the INSERT statement so concurrent commits are visible.
  const saved=await this.query(`SELECT a.artifact_id AS "artifactId",a.document AS record,a.created_at AS "recordedAt"
    FROM public.mastermind_task_contributions_v1 a JOIN public.mastermind_context_tasks_v1 t USING(task_id)
    WHERE t.task_id=$1::uuid AND t.project_id=$2::text AND t.household_id=$3::text AND t.actor_player_id=$4::uuid
    AND public.verify_mastermind_memory_operator_v1(t.household_id,t.actor_player_id)
    AND a.kind=$5::text AND a.operation_id=$6::uuid`,[...this.ownerArgs(ref),record.kind,record.operationId]);
  if(saved.length!==1)fail('CONTRIBUTION_NOT_SAVED_OR_CAPACITY_REACHED');
  if(saved[0].artifactId!==id)fail('CONTRIBUTION_OPERATION_CONFLICT');
  const result=envelope(saved[0]);await this.assertTask(ref,true);
  return {status:rows.length?'created':'duplicate',artifact:result,executionAuthorized:false};
 }
}
