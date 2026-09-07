"""Control-flow fixtures; actual SQL is covered by the rollback-only PostgreSQL receipt."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

# These tests require no driver or connection, including in a restricted test sandbox.
driver=types.ModuleType('psycopg2');driver.connect=mock.Mock()
# These guards cannot resolve or inspect a real target, even in a clean checkout.
# The operator utility itself retains its private canonical-companion prerequisite.
target=types.ModuleType('db_target')
def no_real_target(*args,**kwargs):raise AssertionError('REAL_DATABASE_TARGET_FORBIDDEN_IN_PURE_GUARDS')
for name in ['resolve_memory_dsn','dsn_fingerprint','inspect_memory_target']:setattr(target,name,no_real_target)

with mock.patch.dict(sys.modules,{'psycopg2':driver,'db_target':target}):
    spec=importlib.util.spec_from_file_location('schema_activation_fixture',Path(__file__).parents[1]/'scripts/canonical-schema-activation.py')
    activation=importlib.util.module_from_spec(spec);spec.loader.exec_module(activation)

class ActivationGuards(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.target={'target_digest':'fixture'}
        self.progress={'tasks':{'count':2,'rowsSha256':'fixture'},'substrateCounts':[10,20,30]}
        self.pre={'functions':{name:{'source':'fixture base function' if i==0 else None,'sha256':'fixture' if i==0 else None}
                    for i,name in enumerate(activation.SIGNATURES)},'columns':[],'immutableRules':[['immutable','fixture']]}
        self.manifest={'schemaVersion':1,'target':self.target,'migrations':activation.migration_sources(),'preimage':self.pre,'progress':self.progress}
        self.manifest_file=self.root/'manifest.json';self.manifest_file.write_text(json.dumps(self.manifest))
        self.connection=mock.MagicMock();activation.psycopg2.connect=mock.Mock(return_value=self.connection)
        self.patches=[mock.patch.object(activation,'resolve_memory_dsn',return_value='fixture'),
                      mock.patch.object(activation,'dsn_fingerprint',return_value=self.target),
                      mock.patch.object(activation,'inspect_memory_target'),
                      mock.patch.object(activation,'structures',return_value=self.pre),
                      mock.patch.object(activation,'progress',return_value=self.progress)]
        for patch in self.patches:patch.start();self.addCleanup(patch.stop)
    def args(self,action='apply'):
        return types.SimpleNamespace(action=action,output=str(self.root/'receipt.json'),manifest=str(self.manifest_file),
            manifest_sha256=hashlib.sha256(self.manifest_file.read_bytes()).hexdigest(),apply_receipt=None,receipt_sha256=None)
    def statements(self):return [str(call.args[0]) for call in self.connection.cursor.return_value.execute.call_args_list]

    def test_prepare_uses_read_only_connection_and_does_not_lock_or_mutate(self):
        args=self.args('prepare');result=activation.run(args)
        self.assertTrue(result['ok']);self.assertFalse(result['committed'])
        self.connection.set_session.assert_called_once_with(readonly=True)
        self.connection.commit.assert_not_called()
        self.assertFalse(any('LOCK TABLE' in sql or 'ALTER TABLE' in sql for sql in self.statements()))
    def test_changed_reviewed_manifest_denies_before_any_table_lock(self):
        args=self.args();args.manifest_sha256='0'*64
        self.assertFalse(activation.run(args)['ok'])
        self.assertFalse(any('LOCK TABLE' in sql for sql in self.statements()))
        self.connection.commit.assert_not_called();self.connection.rollback.assert_called()
    def test_new_progress_denies_before_migration_ddl(self):
        with mock.patch.object(activation,'progress',return_value={'changed':True}):result=activation.run(self.args())
        self.assertFalse(result['ok']);self.assertFalse(any('CREATE OR REPLACE FUNCTION' in sql for sql in self.statements()))
        self.connection.commit.assert_not_called()
    def test_failed_postcondition_rolls_back_without_success_receipt(self):
        changed=copy.deepcopy(self.pre);changed['immutableRules']=[]
        with mock.patch.object(activation,'structures',side_effect=[self.pre,changed]):result=activation.run(self.args())
        self.assertFalse(result['ok']);self.assertFalse(result['committed'])
        self.connection.commit.assert_not_called();self.connection.rollback.assert_called()
        self.assertFalse((self.root/'receipt.json').exists())
    def test_successful_apply_requires_preserved_progress_and_full_postimage(self):
        after=copy.deepcopy(self.pre);after['columns']=[['fixture']]*6
        for function in after['functions'].values():function['source']='fixture applied function'
        with mock.patch.object(activation,'structures',side_effect=[self.pre,after]):result=activation.run(self.args())
        self.assertTrue(result['ok']);self.assertTrue(result['committed'])
        self.connection.commit.assert_called_once();self.assertTrue((self.root/'receipt.json').exists())
    def test_rollback_refuses_a_used_grant_even_with_matching_function_receipt(self):
        args=self.args('rollback')
        applied={'ok':True,'committed':True,'action':'apply','manifestSha256':args.manifest_sha256,'target':self.target,'postimage':self.pre}
        path=self.root/'apply.json';path.write_text(json.dumps(applied))
        args.apply_receipt=str(path);args.receipt_sha256=hashlib.sha256(path.read_bytes()).hexdigest()
        with mock.patch.object(activation,'unused_permissions',return_value=False):result=activation.run(args)
        self.assertFalse(result['ok']);self.assertFalse(any('DROP ' in sql for sql in self.statements()))
        self.connection.commit.assert_not_called()

if __name__=='__main__':unittest.main()
