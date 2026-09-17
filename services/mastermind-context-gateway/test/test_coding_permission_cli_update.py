"""Exact second-pin transition and retained safety guards; no database calls."""
import copy
import unittest
from test_coding_permission_profile_extension import ROOT,load,preflight,guards,extension,fixture_helper,runner
import json
update=load('coding_permission_cli_update.py')

class CliUpdateTests(unittest.TestCase):
    def setUp(self):
        self.base=(ROOT/'migrations/task-permissions-v2.sql').read_bytes()
        self.prior=(ROOT/'migrations/task-permissions-v2-suppressed-profile.sql').read_bytes()
        self.updated=(ROOT/'migrations/task-permissions-v2-cli-0154.sql').read_bytes()

    def test_only_exact_executable_allowlist_changes(self):
        before,after,digest,_=update.transition(guards,extension,self.base,self.prior,self.updated)
        self.assertEqual(digest,update.UPDATE_SHA)
        self.assertEqual({k:v for k,v in before['expected'].items() if k!='body_sha256'},
                         {k:v for k,v in after['expected'].items() if k!='body_sha256'})
        self.assertIn(extension.CLI_SHA,after['statement'])
        self.assertIn(update.CLI_SHA,after['statement'])
        self.assertNotEqual(before['expected']['body_sha256'],after['expected']['body_sha256'])

    def test_guarded_apply_and_rollback_preserve_setters_owner_and_catalog(self):
        for action in ('apply','rollback'):
            sql=update.render_disposable(guards,extension,self.base,self.prior,self.updated,action)
            self.assertEqual(sql.count('EXECUTE '),1)
            for guard in ('pg_try_advisory_xact_lock','LOCK TABLE','PROFILE_EXTENSION_VALIDATOR_PREIMAGE_CHANGED',
                          'PROFILE_EXTENSION_PROTECTED_SCHEMA_CHANGED','PROFILE_EXTENSION_VALIDATOR_POSTCONDITION_CHANGED'):
                self.assertIn(guard,sql)
            for effect in ('UPDATE public.','DELETE FROM public.','INSERT INTO public.','DROP TABLE','CREATE OR REPLACE FUNCTION public.set_'):
                self.assertNotIn(effect,sql)
        rollback=update.render_disposable(guards,extension,self.base,self.prior,self.updated,'rollback')
        self.assertIn("s->'runtime'->>'codexSha256'='"+update.CLI_SHA+"'",rollback)
        self.assertNotIn("s->'runtime'->>'codexSha256'='"+extension.CLI_SHA+"'",rollback)

    def test_canonical_context_and_source_pins_are_required(self):
        value=preflight();value['extensionSha256']=update.UPDATE_SHA
        sql=update.render_canonical(guards,extension,value,self.base,self.prior,self.updated,'apply')
        self.assertIn(guards.json_literal(value['context']),sql)
        for bad in (preflight(),{**value,'readOnly':False}):
            with self.assertRaises(ValueError):update.render_canonical(guards,extension,bad,self.base,self.prior,self.updated,'apply')
        with self.assertRaises(ValueError):update.transition(guards,extension,self.base,self.prior,self.updated+b' ')

    def test_real_sql_controls_embed_between_prior_apply_and_prior_rollback(self):
        fixture=json.loads((ROOT/'test/fixtures/coding-source-permissions-v2.json').read_text(encoding='utf-8-sig'))
        original=fixture_helper.compose(guards,extension,fixture,self.base,self.prior)
        combined=update.insert_fixture(original,guards,extension,fixture_helper,fixture,self.base,self.prior,self.updated)
        self.assertIn(update.CLI_SHA,combined)
        self.assertIn('CURRENT_SUPPRESSED_SCOPE_ROLLBACK_ACCEPTED',combined)
        self.assertIn('PROFILE_FIXTURE_PROGRESS_NOT_RESTORED',combined)
        self.assertGreater(len(combined),len(original))
        with self.assertRaises(ValueError):update.insert_fixture('changed',guards,extension,fixture_helper,fixture,self.base,self.prior,self.updated)

if __name__=='__main__':unittest.main()
