"""Pure contract/guard composition; actual SQL runs only in disposable CI."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guards = load('coding_permission_schema_guards.py')
extension = load('coding_permission_profile_extension.py')
fixture_helper = load('coding_permission_profile_fixture.py')
runner = load('verify-coding-permissions-sql.py')


def preflight():
    return {'readOnly': True, 'extensionSha256': extension.EXTENSION_SHA, 'context': {
        'mode': 'canonical-preflight', 'server': {'database': 'mastermind_fixture_pure',
            'current_role': 'fixture_operator', 'session_role': 'fixture_operator', 'server_version_num': '170011'},
        'protected': {'functions': [{'signature': name, 'definition_sha256': str(index+1)*64,
            'owner': 'fixture_operator', 'acl': None} for index, name in enumerate(extension.signatures(guards))],
            'tables': [], 'columns': [], 'constraints': [], 'rules': [], 'triggers': []}}}


class ProfileExtension(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch('subprocess.run', side_effect=AssertionError('No process')))
        self.enterContext(patch('subprocess.Popen', side_effect=AssertionError('No process')))
        self.base = (ROOT/'migrations'/'task-permissions-v2.sql').read_bytes()
        self.raw = (ROOT/'migrations'/'task-permissions-v2-suppressed-profile.sql').read_bytes()

    def test_original_migration_and_all_nonbody_attributes_are_preserved(self):
        self.assertEqual(hashlib.sha256(self.base).hexdigest(), guards.MIGRATION_SHA)
        old, new = extension.reviewed_pair(guards, self.base, self.raw)
        self.assertNotEqual(old['expected']['body_sha256'], new['expected']['body_sha256'])
        self.assertEqual({k:v for k,v in old['expected'].items() if k!='body_sha256'},
                         {k:v for k,v in new['expected'].items() if k!='body_sha256'})
        before = "      OR v_entry->'runtime'->>'cliProfile' IS DISTINCT FROM 'codex-approve-for-me-workspace-write-v1'"
        after = """      OR jsonb_typeof(v_entry->'runtime'->'cliProfile') IS DISTINCT FROM 'string'
      OR NOT (v_entry->'runtime'->>'cliProfile' = 'codex-approve-for-me-workspace-write-v1'
        OR (v_entry->'runtime'->>'cliProfile' = 'codex-approve-for-me-workspace-write-suppressed-v2'
          AND v_entry->'runtime'->>'codexSha256' = 'dacb96688b155e20dbbbc0bfd18bba7ce7920f1b239ab08a1627917f23b8d9cd'))"""
        self.assertEqual(old['statement'].replace(before, after), new['statement'])

    def test_changed_executable_or_unreviewed_sql_is_rejected_before_rendering(self):
        for changed in (self.raw+b'\n', self.raw.replace(extension.CLI_SHA.encode(), b'0'*64),
                        self.raw+b'\nDROP TABLE source;', self.raw.decode()):
            with self.subTest(kind=type(changed).__name__), self.assertRaisesRegex(ValueError, 'EXTENSION_PIN_CHANGED'):
                extension.render_disposable(guards, self.base, changed, 'apply')
        with self.assertRaisesRegex(ValueError, 'MIGRATION_PIN_CHANGED'):
            extension.render_disposable(guards, self.base+b'\n', self.raw, 'apply')

    def test_live_and_fixture_modes_share_identical_effects_and_catalog_guards(self):
        value = preflight()
        context = guards.json_literal(extension.canonical_context(guards, value))
        fixture = f"current_setting('{extension.SETTING}',false)::jsonb"
        for action in ('apply', 'rollback'):
            actual = extension.render_canonical(guards, value, self.base, self.raw, action)
            expected = extension.render_disposable(guards, self.base, self.raw, action)
            self.assertEqual(actual.replace('v_expected jsonb:='+context+';',
                'v_expected jsonb:='+fixture+';', 1), expected)

    def test_unverified_context_cannot_become_a_canonical_target(self):
        for mutate in (lambda x:x.update(readOnly=1), lambda x:x.update(extensionSha256='0'*64),
                       lambda x:x['context'].update(mode='disposable-fixture'),
                       lambda x:x['context']['protected']['functions'][0].update(definition_sha256=None),
                       lambda x:x['context']['protected']['functions'].pop(),
                       lambda x:x['context']['protected']['triggers'].append({'unreviewed': True}),
                       lambda x:x['context']['server'].update(current_role=None)):
            value = preflight(); mutate(value)
            with self.assertRaises(ValueError):
                extension.render_canonical(guards, value, self.base, self.raw, 'apply')

    def test_rollback_checks_current_use_before_restoring_only_the_validator(self):
        sql = extension.render_disposable(guards, self.base, self.raw, 'rollback')
        self.assertLess(sql.index('RESTORE_CURRENT_SUPPRESSED_SCOPES_BEFORE_PROFILE_ROLLBACK'), sql.index('EXECUTE '))
        self.assertIn('PROFILE_EXTENSION_VALIDATOR_PREIMAGE_CHANGED', sql)
        self.assertIn('PROFILE_EXTENSION_VALIDATOR_POSTCONDITION_CHANGED', sql)
        for effect in ('INSERT INTO public.', 'UPDATE public.', 'DELETE FROM public.', 'DROP FUNCTION', 'DROP TABLE'):
            self.assertNotIn(effect, sql)
        self.assertEqual(sql.count('EXECUTE '), 1)
        self.assertIn(extension.SETTER, sql)
        self.assertNotIn('CREATE OR REPLACE FUNCTION public.set_mastermind_context_task_permissions_v2', sql)

    def test_guards_cover_owner_locks_schema_acl_and_exact_function_attributes(self):
        sql = extension.render_disposable(guards, self.base, self.raw, 'apply')
        for required in ("statement_timeout='10000'", "lock_timeout='2000'", 'IN SHARE MODE NOWAIT',
            'pg_try_advisory_xact_lock', 'current_database() IS DISTINCT FROM', 'session_user::text IS DISTINCT FROM',
            'PROFILE_EXTENSION_EVENT_TRIGGER_REVIEW_REQUIRED', 'PROFILE_EXTENSION_DEFAULT_ACL_CHANGED',
            'PROFILE_EXTENSION_PROTECTED_SCHEMA_CHANGED', 'PROFILE_EXTENSION_VALIDATOR_ABSENT_OR_OVERLOADED',
            "'security_definer',p.prosecdef", "'acl',p.proacl::text", "'body_sha256',encode(sha256"):
            self.assertIn(required, sql)
        capture = extension.fixture_context_capture(guards)
        self.assertIn("::text,true)", capture)
        self.assertIn("current_database() !~ '^mastermind_fixture_", capture)

    def test_extension_fixture_executes_real_setter_and_restores_synthetic_grant_and_schema(self):
        data = json.loads((ROOT/'test'/'fixtures'/'coding-source-permissions-v2.json').read_bytes())
        sql = fixture_helper.compose(guards, extension, data, self.base, self.raw)
        for required in ('SUPPRESSED_SCOPE_NOT_APPLIED', 'SUPPRESSED_SCOPE_REPLAY_CHANGED',
            'HISTORICAL_PROFILE_REBOUND', 'CURRENT_SUPPRESSED_SCOPE_ROLLBACK_ACCEPTED',
            'ROLLBACK_SUCCESSFUL_SYNTHETIC_PROFILE_GRANT', 'PROFILE_FIXTURE_PROGRESS_NOT_RESTORED',
            'PROFILE_ROLLBACK_DID_NOT_RESTORE_OLD_VALIDATOR', 'INVALID_SUPPRESSED_PROFILE_ACCEPTED'):
            self.assertIn(required, sql)
        self.assertIn('EXCEPTION WHEN SQLSTATE \'P0002\'', sql)
        self.assertNotIn('\nCOMMIT;', sql)
        self.assertNotIn('\nROLLBACK;', sql)

    def test_combined_fixture_uses_supplied_buffers_and_one_outer_rollback(self):
        data = json.loads((ROOT/'test'/'fixtures'/'coding-source-permissions-v2.json').read_bytes())
        v1 = (ROOT/'migrations'/'task-permissions-v1.sql').read_text()
        shared = (ROOT/'scripts'/'coding_permission_schema_guards.py').read_bytes()
        ext = (ROOT/'scripts'/'coding_permission_profile_extension.py').read_bytes()
        helper = (ROOT/'scripts'/'coding_permission_profile_fixture.py').read_bytes()
        base = runner.compose_sql(data, v1, self.base.decode(), guard_source=shared)
        with patch.object(Path, 'open', side_effect=AssertionError('No source reread')):
            sql, controls = runner.compose_profile_sql(base, data, self.base, self.raw,
                guard_source=shared, extension_source=ext, fixture_source=helper)
        self.assertEqual(sql.count('\nROLLBACK;'), 1)
        self.assertEqual(sql.count("SELECT 'CODING_PERMISSION_SQL_ROLLBACK_ACCEPTED';"), 1)
        self.assertNotIn('\nCOMMIT;', sql)
        self.assertLess(sql.index('DO $profile_contract$'), sql.index('CREATE FUNCTION pg_temp.fixture_canonical'))
        self.assertEqual(controls, fixture_helper.CONTROLS)
        with self.assertRaisesRegex(ValueError, 'INSERTION_BOUNDARY_CHANGED'):
            fixture_helper.insert_before_legacy_checks(base+base, '')
        with self.assertRaisesRegex(ValueError, 'SOURCE_LIMIT'):
            runner.compose_profile_sql(base, data, self.base, self.raw,
                guard_source=shared, extension_source=b'x'*65537, fixture_source=helper)

    def test_unknown_action_and_source_name_hold(self):
        with self.assertRaisesRegex(ValueError, 'ACTION_INVALID'):
            extension.render_disposable(guards, self.base, self.raw, 'grant')
        with self.assertRaisesRegex(ValueError, 'SOURCE_NAME_CHANGED'):
            runner.read_profile_source('../outside.py')


if __name__ == '__main__':
    unittest.main()
