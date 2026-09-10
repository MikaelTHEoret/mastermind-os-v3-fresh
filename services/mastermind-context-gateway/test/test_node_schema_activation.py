"""Activation-owner guards only; no database or migration is executed by these fixtures."""
import copy,hashlib,importlib.util,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest import mock

def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
BASE=Path(__file__).parents[1]/'scripts'
driver=types.ModuleType('psycopg2');driver.connect=mock.Mock()
# These guards cannot resolve or inspect a real target, even in a clean checkout.
# The operator utility itself retains its private canonical-companion prerequisite.
target=types.ModuleType('db_target')
def no_real_target(*args,**kwargs):raise AssertionError('REAL_DATABASE_TARGET_FORBIDDEN_IN_PURE_GUARDS')
for name in ['resolve_memory_dsn','dsn_fingerprint','inspect_memory_target']:setattr(target,name,no_real_target)

with mock.patch.dict(sys.modules,{'psycopg2':driver,'db_target':target}):helpers=load('node_activation_context_helpers',BASE/'canonical-schema-activation.py')
activation=load('node_activation_fixture',BASE/'canonical-node-schema-activation.py')

class NodeActivationGuards(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  self.target={'target_digest':'fixture'};self.progress={'tasks':{'count':2,'rowsSha256':'full-grant-history'},'nodes':{'count':1,'rowsSha256':'full-node-history'}}
  self.pre={'functions':{sig:{'source':'old exact function' if sig in activation.LEGACY else None,'sha256':'old' if sig in activation.LEGACY else None,'bodySha256':'old' if sig in activation.LEGACY else None} for sig in activation.SIGNATURES},
    'workerColumn':[],'jobConstraint':"CHECK (capability = 'family-ecosystem.ensure-running')",'context':{'functions':{'old':{'source':'protected019/020'}},'columns':[['column']]*6,'immutableRules':[['append-only','fixed']]}}
  self.after=copy.deepcopy(self.pre);self.after['workerColumn']=[['last_worker','jsonb',None,'YES']]
  self.after['jobConstraint']="CHECK (capability IN ('family-ecosystem.ensure-running','mastermind.core.status'))"
  _,bodies=activation.reviewed_migration()
  for sig,value in self.after['functions'].items():value.update(source='reviewed new function',sha256='new',bodySha256=bodies[sig.split('(')[0].split('.')[1]])
  self.manifest={'schemaVersion':1,'scope':activation.SCOPE,'target':self.target,'migrations':[{'file':activation.MIGRATION,'sha256':activation.REVIEWED_SHA256}],
    'activationSourceSha256':hashlib.sha256(Path(activation.__file__).read_bytes()).hexdigest(),'preimage':self.pre,'progressObserved':self.progress}
  self.manifest_file=self.root/'manifest.json';self.manifest_file.write_text(json.dumps(self.manifest))
  self.connection=mock.MagicMock();helpers.psycopg2.connect=mock.Mock(return_value=self.connection)
  self.patches=[mock.patch.object(helpers,'resolve_memory_dsn',return_value='fixture'),mock.patch.object(helpers,'dsn_fingerprint',return_value=self.target),
   mock.patch.object(helpers,'inspect_memory_target'),mock.patch.object(activation,'structures',return_value=self.pre),mock.patch.object(activation,'progress',return_value=self.progress),
   mock.patch.object(activation,'metadata',return_value={'nodes':{'total':1},'privateInputsReturned':False}),mock.patch.object(activation,'unused_node_extension',return_value=True)]
  for patch in self.patches:patch.start();self.addCleanup(patch.stop)
 def args(self,action='apply'):
  return types.SimpleNamespace(action=action,scope='stargate021',output=str(self.root/'receipt.json'),manifest=str(self.manifest_file),
   manifest_sha256=hashlib.sha256(self.manifest_file.read_bytes()).hexdigest(),apply_receipt=None,receipt_sha256=None)
 def sql(self):return [str(call.args[0]) for call in self.connection.cursor.return_value.execute.call_args_list]
 def applied(self,args):
  value={'ok':True,'committed':True,'scope':'stargate021','action':'apply','manifestSha256':args.manifest_sha256,'target':self.target,'postimage':self.after,'progressPreserved':self.progress}
  path=self.root/'applied.json';path.write_text(json.dumps(value));args.apply_receipt=str(path);args.receipt_sha256=hashlib.sha256(path.read_bytes()).hexdigest()
 def test_import_and_source_census_are_bounded_and_exact(self):
  _,bodies=activation.reviewed_migration();self.assertEqual(len(bodies),7);self.assertEqual(len(activation.LEGACY),2)
  helpers.psycopg2.connect.assert_not_called()
 def test_prepare_is_read_only_without_locks_or_commit(self):
  result=activation.run(self.args('prepare'),helpers);self.assertTrue(result['ok']);self.assertFalse(result['committed'])
  self.connection.set_session.assert_called_once_with(readonly=True,isolation_level='REPEATABLE READ');self.connection.commit.assert_not_called()
  self.assertFalse(any('LOCK TABLE' in sql or 'ALTER TABLE' in sql for sql in self.sql()))
 def test_prepare_rejects_missing019020_or_already_modified_node_schema(self):
  for change in ['context','workerColumn']:
   pre=copy.deepcopy(self.pre)
   if change=='context':pre['context']['immutableRules']=[]
   else:pre['workerColumn']=[['last_worker','jsonb',None,'YES']]
   with mock.patch.object(activation,'structures',return_value=pre):self.assertFalse(activation.run(self.args('prepare'),helpers)['ok'])
  self.connection.commit.assert_not_called()
 def test_unreviewed_source_denies_before_connect(self):
  with mock.patch.object(activation,'reviewed_migration',side_effect=ValueError('changed source')):self.assertFalse(activation.run(self.args(),helpers)['ok'])
  helpers.psycopg2.connect.assert_not_called()
 def test_modified_manifest_and_output_collision_deny_before_table_lock(self):
  args=self.args();args.manifest_sha256='0'*64;self.assertFalse(activation.run(args,helpers)['ok'])
  args=self.args();Path(args.output).write_text('{}');self.assertFalse(activation.run(args,helpers)['ok'])
  self.assertFalse(any('LOCK TABLE' in sql for sql in self.sql()));self.connection.commit.assert_not_called()
 def test_changed_reviewed_preimage_denies_before_ddl(self):
  current=copy.deepcopy(self.pre);current['context']['immutableRules']=[]
  with mock.patch.object(activation,'structures',return_value=current):self.assertFalse(activation.run(self.args(),helpers)['ok'])
  self.assertFalse(any('CREATE OR REPLACE' in sql for sql in self.sql()));self.connection.commit.assert_not_called()
 def test_apply_requires_exact_function_bodies_and_unchanged_checkpoint_grant_history(self):
  invalid=copy.deepcopy(self.after);invalid['functions'][activation.SIGNATURES[0]]['bodySha256']='wrong'
  with mock.patch.object(activation,'structures',side_effect=[self.pre,invalid]):self.assertFalse(activation.run(self.args(),helpers)['ok'])
  with mock.patch.object(activation,'structures',side_effect=[self.pre,self.after]),mock.patch.object(activation,'progress',side_effect=[self.progress,{'grant':'changed'}]):
   self.assertFalse(activation.run(self.args(),helpers)['ok'])
  self.connection.commit.assert_not_called();self.connection.rollback.assert_called()
 def test_apply_preserves_existing_history_without_requiring_stale_prepare_counts(self):
  # Live heartbeat/progress may advance before the locked apply snapshot. The
  # transaction must preserve that newer snapshot and rollback later protects it.
  self.manifest['progressObserved']={'tasks':{'count':1,'rowsSha256':'older-prepare-history'}}
  self.manifest_file.write_text(json.dumps(self.manifest),encoding='utf-8')
  self.assertNotEqual(self.manifest['progressObserved'],self.progress)
  with mock.patch.object(activation,'structures',side_effect=[self.pre,self.after]):result=activation.run(self.args(),helpers)
  self.assertTrue(result['ok']);self.connection.commit.assert_called_once();self.assertEqual(result['progressPreserved'],self.progress)
  self.assertFalse(any('DROP TABLE' in sql or 'TRUNCATE' in sql for sql in self.sql()))
 def test_rollback_refuses_new_core_usage_or_new_grant_history(self):
  args=self.args('rollback');self.applied(args)
  with mock.patch.object(activation,'structures',return_value=self.after),mock.patch.object(activation,'unused_node_extension',return_value=False):
   self.assertFalse(activation.run(args,helpers)['ok'])
  with mock.patch.object(activation,'structures',return_value=self.after),mock.patch.object(activation,'progress',return_value={'grant':'new'}):
   self.assertFalse(activation.run(args,helpers)['ok'])
  self.assertFalse(any(sql.startswith('DROP') or sql.startswith('ALTER') for sql in self.sql()));self.connection.commit.assert_not_called()
 def test_unused_rollback_restores_only_exact_node_preimages(self):
  args=self.args('rollback');self.applied(args)
  with mock.patch.object(activation,'structures',side_effect=[self.after,self.pre]):result=activation.run(args,helpers)
  self.assertTrue(result['ok']);self.connection.commit.assert_called_once()
  self.assertFalse(any('DROP COLUMN permission' in sql or 'DROP FUNCTION public.append_mastermind_context' in sql for sql in self.sql()))
 def test_existing_context_owner_run_function_is_unchanged(self):
  current=(BASE/'canonical-schema-activation.py').read_text(encoding='utf-8')
  segment=current.split('def run(args):')[1].split("if __name__")[0]
  self.assertEqual(hashlib.sha256(segment.encode()).hexdigest(),'75bb1e0e6f99409f85b1a4cb037e61463284954ebf76bfc16b2474f2eb763b7a')

class PreservationCensus(unittest.TestCase):
 def cursor(self,batches):
  cursor=mock.MagicMock();census=cursor.connection.cursor.return_value.__enter__.return_value
  census.fetchmany.side_effect=batches;cursor.fetchone.return_value=(10,20,30)
  return cursor,census
 def test_streamed_hashes_include_exact_opaque_rows_and_exclude_only_node_ad(self):
  rows=[('id1','a'*64),('id2','b'*64)]
  cursor,census=self.cursor([rows,[]])
  with mock.patch.object(activation,'TABLES',[('mastermind_nodes_v1','node_id')]):result=activation.progress(cursor)
  expected=hashlib.sha256(b''.join((activation.canonical(list(row))+'\n').encode() for row in rows)).hexdigest()
  self.assertEqual(result,{'mastermind_nodes_v1':{'count':2,'rowsSha256':expected},'substrateCounts':[10,20,30]})
  self.assertIn("to_jsonb(t)-'last_worker'",census.execute.call_args.args[0])
  self.assertTrue(cursor.connection.cursor.call_args.kwargs['name'].startswith('mm_preservation_'))
  self.assertEqual(census.fetchmany.call_args_list,[mock.call(5000),mock.call(5000)])
  self.assertNotIn('id1',json.dumps(result));self.assertNotIn('a'*64,json.dumps(result))
 def test_row_limit_fails_before_accumulating_or_returning_history(self):
  cursor,census=self.cursor([[('id','digest'),('id2','digest2')]])
  with mock.patch.object(activation,'TABLES',[('mastermind_node_exchanges_v1','exchange_id')]),mock.patch.object(activation,'MAX_ROWS_PER_TABLE',1):
   with self.assertRaisesRegex(ValueError,'row limit'):activation.progress(cursor)
  self.assertEqual(census.fetchmany.call_count,1)
  cursor.connection.cursor.return_value.__exit__.assert_called_once()
 def test_total_deadline_closes_cursor_before_another_fetch(self):
  cursor,census=self.cursor([])
  with mock.patch.object(activation,'TABLES',[('mastermind_node_jobs_v1','job_id')]),mock.patch.object(activation.time,'monotonic',side_effect=[0,46]):
   with self.assertRaisesRegex(ValueError,'total read budget'):activation.progress(cursor)
  census.fetchmany.assert_not_called();cursor.connection.cursor.return_value.__exit__.assert_called_once()

if __name__=='__main__':unittest.main()
