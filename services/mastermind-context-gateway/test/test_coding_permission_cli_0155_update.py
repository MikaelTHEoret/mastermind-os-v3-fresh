"""Third-pin compatibility, current-scope rollback and unchanged authority boundaries."""
import json
import unittest
import contextlib
import io
import subprocess
from unittest.mock import patch
from test_coding_permission_profile_extension import ROOT,load,preflight,guards,extension,fixture_helper
previous=load('coding_permission_cli_update.py')
update=load('coding_permission_cli_0155_update.py')

class Cli0155UpdateTests(unittest.TestCase):
    def setUp(self):
        self.base=(ROOT/'migrations/task-permissions-v2.sql').read_bytes()
        self.profile=(ROOT/'migrations/task-permissions-v2-suppressed-profile.sql').read_bytes()
        self.prior=(ROOT/'migrations/task-permissions-v2-cli-0154.sql').read_bytes()
        self.updated=(ROOT/'migrations/task-permissions-v2-cli-0155.sql').read_bytes()
        self.args=(guards,extension,previous,self.base,self.profile,self.prior,self.updated)

    def test_previous_pins_retained_and_only_exact_new_pin_changes(self):
        before,after,digest,_=update.transition(*self.args)
        self.assertEqual(digest,update.UPDATE_SHA)
        self.assertEqual({k:v for k,v in before['expected'].items() if k!='body_sha256'},
                         {k:v for k,v in after['expected'].items() if k!='body_sha256'})
        for pin in (extension.CLI_SHA,previous.CLI_SHA,update.CLI_SHA):self.assertIn(pin,after['statement'])
        self.assertNotEqual(before['expected']['body_sha256'],after['expected']['body_sha256'])
        for raw in (self.updated+b' ',self.prior):
            with self.assertRaises(ValueError):update.transition(*self.args[:-1],raw)

    def test_apply_rollback_keep_catalog_owner_setters_and_scope_hold(self):
        for action in ('apply','rollback'):
            sql=update.render_disposable(*self.args,action)
            self.assertEqual(sql.count('EXECUTE '),1)
            for token in ('pg_try_advisory_xact_lock','LOCK TABLE','PROFILE_EXTENSION_VALIDATOR_PREIMAGE_CHANGED',
                          'PROFILE_EXTENSION_PROTECTED_SCHEMA_CHANGED','PROFILE_EXTENSION_VALIDATOR_POSTCONDITION_CHANGED'):
                self.assertIn(token,sql)
            for effect in ('UPDATE public.','DELETE FROM public.','INSERT INTO public.','DROP TABLE','CREATE OR REPLACE FUNCTION public.set_'):
                self.assertNotIn(effect,sql)
        rollback=update.render_disposable(*self.args,'rollback')
        self.assertIn("s->'runtime'->>'codexSha256'='"+update.CLI_SHA+"'",rollback)
        self.assertNotIn("s->'runtime'->>'codexSha256'='"+previous.CLI_SHA+"'",rollback)

    def test_canonical_context_and_previous_source_are_required(self):
        value=preflight();value['extensionSha256']=update.UPDATE_SHA
        sql=update.render_canonical(guards,extension,previous,value,*self.args[3:],'apply')
        self.assertIn(guards.json_literal(value['context']),sql)
        for bad in (preflight(),{**value,'readOnly':False}):
            with self.assertRaises(ValueError):update.render_canonical(guards,extension,previous,bad,*self.args[3:],'apply')
        with self.assertRaises(ValueError):
            update.transition(guards,extension,previous,self.base,self.profile,self.prior+b' ',self.updated)

    def test_all_real_fixture_generations_keep_nested_rollback_order(self):
        fixture=json.loads((ROOT/'test/fixtures/coding-source-permissions-v2.json').read_text(encoding='utf-8-sig'))
        sql=fixture_helper.compose(guards,extension,fixture,self.base,self.profile)
        sql=previous.insert_fixture(sql,guards,extension,fixture_helper,fixture,self.base,self.profile,self.prior)
        new=update.insert_fixture(sql,guards,extension,previous,fixture_helper,fixture,*self.args[3:])
        self.assertGreater(len(new),len(sql))
        self.assertIn('CURRENT_SUPPRESSED_SCOPE_ROLLBACK_ACCEPTED',new)
        self.assertIn('PROFILE_FIXTURE_PROGRESS_NOT_RESTORED',new)
        with self.assertRaises(ValueError):
            update.insert_fixture('changed',guards,extension,previous,fixture_helper,fixture,*self.args[3:])

    def test_ci_runner_rejects_nonlocal_targets_before_starting_psql(self):
        runner=load('verify-coding-cli-0155-sql.py')
        with patch('sys.argv',['fixture','--dsn','postgresql://fixture:x@db.example/mastermind_fixture_test']), \
             patch.object(runner.subprocess,'run') as execute:
            with self.assertRaises(ValueError):runner.main()
        execute.assert_not_called()

    def test_ci_runner_requires_database_acceptance_marker_and_bounds_timeout(self):
        runner=load('verify-coding-cli-0155-sql.py')
        argv=['fixture','--dsn','postgresql://fixture:synthetic-only@127.0.0.1/mastermind_fixture_test','--psql','fixture-psql']
        for output,expected in ((b'CODING_PERMISSION_SQL_ROLLBACK_ACCEPTED\n',0),(b'',1)):
            stream=io.StringIO()
            with patch('sys.argv',argv), patch.object(runner.subprocess,'run',return_value=subprocess.CompletedProcess([],0,output,b'')) as execute, contextlib.redirect_stdout(stream):
                self.assertEqual(runner.main(),expected)
            self.assertEqual(execute.call_args.args[0][0],'fixture-psql')
            self.assertEqual(execute.call_args.kwargs['timeout'],60)
            self.assertEqual(json.loads(stream.getvalue())['cliGenerations'],['original-suppressed','0.154','0.155'])
        stream=io.StringIO()
        with patch('sys.argv',argv), patch.object(runner.subprocess,'run',side_effect=subprocess.TimeoutExpired('fixture-psql',60,stderr=b'synthetic-only')), contextlib.redirect_stdout(stream):
            self.assertEqual(runner.main(),1)
        receipt=json.loads(stream.getvalue())
        self.assertTrue(receipt['timedOut'])
        self.assertNotIn('synthetic-only',stream.getvalue())

if __name__=='__main__':unittest.main()
