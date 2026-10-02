"""Compose reviewed replacement bodies without reverting migration037 validators."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
source=(root/'memory-system/migrations/036_mastermind_lifecycle_jobs_v1.sql').read_text()
functions=re.findall(r'CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\([\s\S]*?\$\$;',source)
def body(name):
 start=source.index('CREATE OR REPLACE FUNCTION public.'+name+'(')
 return source[start:source.index('$$;',source.index('AS $$',start))+3]
names=[n for n in functions if n.startswith('enqueue_')]+['mastermind_node_worker_valid_v2','exchange_mastermind_node_negotiated_v2']
old=[body(n) for n in names]
new=[]
for name,text in zip(names,old):
 if name=='mastermind_node_worker_valid_v2':text=text.replace('BETWEEN 1 AND 11','BETWEEN 1 AND 12')
 text=text.replace("'mastermind.native.contribution-lifecycle')","'mastermind.native.contribution-lifecycle','mastermind.native.nexus')")
 if name=='exchange_mastermind_node_negotiated_v2':
  anchor="      AND (mastermind_node_jobs_v1.capability <> 'mastermind.native.contribution-lifecycle'"
  lines=text.splitlines();text='\n'.join(line+'\n      AND (mastermind_node_jobs_v1.capability <> \'mastermind.native.nexus\' OR public.mastermind_nexus_authorized_v1(mastermind_node_jobs_v1.household_id,mastermind_node_jobs_v1.created_by_player_id,mastermind_node_jobs_v1.node_id,mastermind_node_jobs_v1.command_input,mastermind_node_jobs_v1.terminal_result))' if line.startswith(anchor) else line for line in lines)
  needle="    IF v_job.capability='mastermind.native.contribution-lifecycle' THEN"
  nexus="""    IF v_job.capability='mastermind.native.nexus' THEN
      IF NOT public.mastermind_nexus_authorized_v1(v_job.household_id,v_job.created_by_player_id,v_job.node_id,v_job.command_input,CASE WHEN v_receipt->>'state'='succeeded' THEN NULLIF(v_receipt->'result','null'::jsonb) ELSE NULL END)
        OR (v_receipt->>'state'='succeeded' AND NULLIF(v_receipt->'result','null'::jsonb) IS NULL)
        OR (v_receipt->>'state'<>'succeeded' AND NULLIF(v_receipt->'result','null'::jsonb) IS NOT NULL)
        OR octet_length(public.mastermind_review_canonical_v1(v_receipt))>4096
      THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Nexus receipt authority or binding denied'; END IF;
    END IF;
"""
  assert text.count(needle)==1;text=text.replace(needle,nexus+needle)
 new.append(text)
enqueue=body('enqueue_mastermind_lifecycle_job_v1')
enqueue=enqueue.replace('enqueue_mastermind_lifecycle_job_v1','enqueue_mastermind_nexus_job_v1').replace('mastermind_lifecycle_','mastermind_nexus_').replace('mastermind.native.contribution-lifecycle','mastermind.native.nexus')
enqueue='\n'.join(line for line in enqueue.splitlines() if "IF p_input->>'action'<>'inspect' THEN PERFORM" not in line)
enqueue=enqueue.replace("'mastermind.native.contribution','mastermind.native.nexus')","'mastermind.native.contribution','mastermind.native.contribution-lifecycle','mastermind.native.nexus')")
constraint=source[source.index('ALTER TABLE public.mastermind_node_jobs_v1 DROP CONSTRAINT'):source.index('COMMIT;')].strip()
next_constraint=constraint.replace("OR (capability='mastermind.native.specification'", "OR (capability='mastermind.native.nexus' AND public.mastermind_nexus_input_valid_v1(command_input) AND command_input->>'operationId'=job_id::text)\nOR (capability='mastermind.native.specification'")
next_constraint=next_constraint.replace("CASE WHEN result->>'kind' IN", "CASE WHEN result->>'kind'='mastermind.native.nexus' THEN 4096 WHEN result->>'kind' IN")
helpers=(root/'scripts/nexus-ledger-helpers.sql').read_text()
revoke='\n'.join('REVOKE ALL ON FUNCTION public.'+signature+' FROM PUBLIC;' for signature in [
 'mastermind_nexus_basis_valid_v1(jsonb)','mastermind_nexus_proposal_valid_v1(jsonb)','mastermind_nexus_input_valid_v1(jsonb)',
 'mastermind_nexus_result_valid_v1(jsonb,jsonb)','mastermind_nexus_authorized_v1(text,uuid,uuid,jsonb,jsonb)',
 'enqueue_mastermind_nexus_job_v1(uuid,text,uuid,text,uuid,timestamptz,jsonb)'])
migration='BEGIN;\n-- Source-only until coupled owner/worker rollout. Reuses the existing ledger.\n'+helpers+'\n'+enqueue+'\n'+'\n'.join(new)+'\n'+next_constraint+'\n'+revoke+'\nCOMMIT;\n'
(root/'memory-system/migrations/039_mastermind_nexus_jobs_v1.sql').write_text(migration,encoding='utf-8',newline='\n')
undo="""BEGIN;
-- Preserve every recorded effect. Once Nexus jobs exist, retain compatible readers.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 WHERE capability='mastermind.native.nexus')
 OR EXISTS(SELECT 1 FROM public.mastermind_node_job_receipts_v1 WHERE result->>'kind'='mastermind.native.nexus')
 THEN RAISE EXCEPTION 'NEXUS_HISTORY_REQUIRES_COMPATIBLE_READER'; END IF; END $$;
"""+'\n'.join(old)+'\n'+constraint+'\n'
undo+='\n'.join('DROP FUNCTION public.'+sig+';' for sig in ['enqueue_mastermind_nexus_job_v1(uuid,text,uuid,text,uuid,timestamptz,jsonb)',
 'mastermind_nexus_authorized_v1(text,uuid,uuid,jsonb,jsonb)','mastermind_nexus_result_valid_v1(jsonb,jsonb)',
 'mastermind_nexus_input_valid_v1(jsonb)','mastermind_nexus_proposal_valid_v1(jsonb)','mastermind_nexus_basis_valid_v1(jsonb)'])+'\nCOMMIT;\n'
(root/'memory-system/rollback/039_mastermind_nexus_jobs_v1.sql').write_text(undo,encoding='utf-8',newline='\n')
print({'replacedFunctions':names,'newCapability':'mastermind.native.nexus','validators037Preserved':True})
