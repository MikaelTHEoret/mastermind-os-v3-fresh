import importlib.util
from pathlib import Path
import unittest

script=Path(__file__).resolve().parents[1]/'scripts'/'checkpoint-ordering-fixture.py'
spec=importlib.util.spec_from_file_location('checkpoint_fixture',script)
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
STATEMENT='''SELECT DISTINCT ON (task_id) task_id::text AS "taskId", checkpoint_id::text AS "checkpointId",
sequence::text, state, summary, completed_items AS "completedItems", open_items AS "openItems",
blockers, created_at AS "createdAt" FROM public.mastermind_context_checkpoints_v1 checkpoints
WHERE task_id = ANY($1::uuid[]) ORDER BY task_id, checkpoints.sequence DESC'''
def payload():return {'schemaVersion':1,'statement':STATEMENT,'parameters':[[f'00000000-0000-8000-8000-00000000001{i}' for i in range(1,4)]],'storeSha256':'a'*64}
class Guards(unittest.TestCase):
    def test_exact_select_and_scope_only(self):
        statement,ids=fixture.prepare(payload());self.assertEqual(statement,STATEMENT);self.assertEqual(len(ids),3)
    def test_projection_function_and_dml_injection_rejected_before_connect(self):
        for statement in [STATEMENT.replace('sequence::text','public.unreviewed()'),STATEMENT+'; DELETE FROM public.example',STATEMENT+' -- comment',STATEMENT.replace('pg_temp.','public.')+' UNION SELECT 1']:
            value=payload();value['statement']=statement
            with self.assertRaises(ValueError):fixture.run(value)
    def test_old_order_cannot_be_accepted_as_current_source(self):
        value=payload();value['statement']=STATEMENT.replace('checkpoints.sequence DESC','sequence DESC')
        with self.assertRaises(ValueError):fixture.run(value)
    def test_invalid_scope_and_oversized_statement_rejected(self):
        for change in [{'parameters':[['not-uuid']]},{'parameters':[['00000000-0000-8000-8000-000000000011']]*3},{'statement':' '*10001+STATEMENT},{'extra':True}]:
            with self.assertRaises((ValueError,TypeError)):fixture.run({**payload(),**change})
if __name__=='__main__':unittest.main()
