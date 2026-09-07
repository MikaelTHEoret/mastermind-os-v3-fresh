"""Pure shared-renderer tests. No PostgreSQL, process, network or canonical read."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


ROOT=Path(__file__).resolve().parents[1]


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


guards=load('fixture_shared_schema_guards',ROOT/'scripts'/'coding_permission_schema_guards.py')
runner=load('fixture_shared_schema_runner',ROOT/'scripts'/'verify-coding-permissions-sql.py')


def preflight():
    functions=[{'signature':name,'definition_sha256':str(index+1)*64,
        'owner':'fixture_owner','acl':None} for index,name in enumerate(guards.SIGNATURES)]
    functions.extend({'absent':True} for _ in range(2))
    return {'readOnly':True,'migrationSha256':guards.MIGRATION_SHA,'metadata':{
        'server':{'database':'mastermind_fixture_pure','current_role':'fixture_owner',
                  'session_role':'fixture_owner','server_version_num':'170011'},
        'functions':functions,'tables':[],'columns':[],'constraints':[],
        'rules':[],'triggers':[],'functionDefaultPrivileges':[]}}


class SharedSchemaGuards(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch('subprocess.run',side_effect=AssertionError('No process')))
        self.enterContext(patch('subprocess.Popen',side_effect=AssertionError('No process')))
        self.raw=(ROOT/'migrations'/'task-permissions-v2.sql').read_bytes()

    def test_reviewed_bytes_extract_only_exact_two_function_bodies(self):
        self.assertEqual(hashlib.sha256(self.raw).hexdigest(),guards.MIGRATION_SHA)
        rows=guards.reviewed_functions(self.raw)
        self.assertEqual([row['expected']['body_sha256'] for row in rows],[
            '0742ee088ae8321535b960cb8af26ef0f3cb484627bf969c1cd01bf5bb4fea75',
            '9e3289479a57d0f7b4a8d57ccee47fb6e7fb6c47711d44a55268ba6774933aca'])
        self.assertEqual(len(rows),2)

    def test_tampered_migration_rejected_before_any_sql_is_returned(self):
        for raw in (self.raw+b'\n',self.raw.replace(b'IMMUTABLE',b'VOLATILE',1),
                    self.raw+b'\nDROP TABLE example;',self.raw.decode()):
            with self.subTest(raw_type=type(raw).__name__),self.assertRaisesRegex(ValueError,'MIGRATION_PIN_CHANGED'):
                guards.render_disposable(raw,'apply')

    def test_extractor_rejects_extra_statements_even_without_pin_wrapper(self):
        source=self.raw.decode().replace('\r\n','\n')
        with self.assertRaisesRegex(ValueError,'UNREVIEWED_MIGRATION_STATEMENT'):
            guards.new_functions(source+'\nSELECT 1;',None)

    def test_canonical_and_disposable_modes_have_identical_effect_and_guards(self):
        value=preflight();literal=guards.json_literal(guards.canonical_context(value))
        fixed="current_setting('"+guards.FIXTURE_SETTING+"',false)::jsonb"
        for action in ('apply','rollback'):
            canonical=guards.render_canonical(value,self.raw,action)
            disposable=guards.render_disposable(self.raw,action)
            self.assertEqual(canonical.replace('v_expected jsonb:='+literal+';',
                'v_expected jsonb:='+fixed+';',1),disposable)
            self.assertNotIn('fixture_owner',disposable)

    def test_canonical_preflight_requires_literal_readonly_and_exact_source(self):
        for field,value in (('readOnly',1),('readOnly',False),('migrationSha256','f'*64)):
            item=preflight();item[field]=value
            with self.subTest(field=field,value=value),self.assertRaises(ValueError):
                guards.render_canonical(item,self.raw,'apply')

    def test_preflight_cannot_silently_adopt_changed_or_present_functions(self):
        baseline=preflight()
        changes=[lambda x:x['metadata']['functions'][0].update(signature='public.other()'),
                 lambda x:x['metadata']['functions'][0].update(definition_sha256=None),
                 lambda x:x['metadata']['functions'][4].update(absent=False),
                 lambda x:x['metadata']['functionDefaultPrivileges'].append({'changed':True}),
                 lambda x:x['metadata']['triggers'].append({'changed':True})]
        for change in changes:
            item=copy.deepcopy(baseline);change(item)
            with self.assertRaises(ValueError):
                guards.render_canonical(item,self.raw,'apply')

    def test_context_text_is_quoted_as_data_and_not_a_sql_expression(self):
        value=preflight();value['metadata']['server']['database']="name'; SELECT 'private-marker"
        sql=guards.render_canonical(value,self.raw,'apply')
        self.assertIn("name''; SELECT ''private-marker",sql)
        self.assertNotIn("name'; SELECT 'private-marker",sql)
        self.assertEqual(value['metadata']['server']['current_role'],'fixture_owner')

    def test_shared_guards_retain_lock_limits_catalog_owner_and_function_attributes(self):
        sql=guards.render_disposable(self.raw,'apply')
        for required in ("statement_timeout='10000'","lock_timeout='2000'",
            "idle_in_transaction_session_timeout='15000'",'IN SHARE MODE NOWAIT',
            'pg_try_advisory_xact_lock','current_database() IS DISTINCT FROM',
            'session_user::text IS DISTINCT FROM','server_version_num',
            'CODING_PERMISSION_EVENT_TRIGGER_REVIEW_REQUIRED',
            'CODING_PERMISSION_FUNCTION_DEFAULT_ACL_CHANGED',
            'CODING_PERMISSION_V1_OR_SCHEMA_PREIMAGE_CHANGED',
            'CODING_PERMISSION_PROTECTED_SCHEMA_CHANGED',
            'CODING_PERMISSION_V2_PARTIAL_OR_OVERLOADED_STATE',
            "'security_definer',p.prosecdef","'acl',p.proacl::text",
            "'body_sha256',encode(sha256"):
            self.assertIn(required,sql)

    def test_rollback_refuses_current_v2_before_restrict_drops_in_dependency_order(self):
        sql=guards.render_disposable(self.raw,'rollback')
        hold=sql.index('RESTORE_CURRENT_TASK_SCOPES_WITH_EXISTING_OWNER_CAS_BEFORE_SCHEMA_ROLLBACK')
        setter=sql.index('DROP FUNCTION public.set_mastermind_context_task_permissions_v2')
        validator=sql.index('DROP FUNCTION public.validate_mastermind_coding_sources_v2')
        self.assertLess(hold,setter);self.assertLess(setter,validator)
        self.assertEqual(sql.count(' RESTRICT;'),2)
        self.assertNotIn(' CASCADE',sql)
        for mutation in ('UPDATE public.','DELETE FROM public.','INSERT INTO public.'):
            self.assertNotIn(mutation,sql)

    def test_fixture_snapshot_is_server_owned_transaction_local_and_database_limited(self):
        sql=guards.fixture_context_capture()
        self.assertIn("current_database() !~ '^mastermind_fixture_",sql)
        self.assertIn("::text,true)",sql)
        self.assertIn("current_role',current_user",sql)
        self.assertIn("'protected',v_protected",sql)
        self.assertNotIn('neondb',sql)

    def test_absent_function_pair_does_not_bypass_current_scope_hold(self):
        sql=guards.render_disposable(self.raw,'rollback')
        scope_check=sql.index('IF EXISTS(SELECT 1 FROM public.mastermind_context_tasks_v1')
        function_branch=sql.index('IF (SELECT count(*) FROM pg_proc')
        self.assertLess(scope_check,function_branch)

    def test_transaction_embed_removes_only_outer_boundaries(self):
        sql=guards.render_disposable(self.raw,'apply');body=guards.transaction_body(sql)
        self.assertNotIn('\nBEGIN READ WRITE;',body);self.assertFalse(body.rstrip().endswith('COMMIT;'))
        self.assertIn('DO $coding_permission_v2$',body)
        self.assertIn('IN SHARE MODE NOWAIT',body)
        with self.assertRaisesRegex(ValueError,'TRANSACTION_BOUNDARY_CHANGED'):
            guards.transaction_body(sql+'SELECT 1;')
        with self.assertRaisesRegex(ValueError,'GUARD_ACTION_INVALID'):
            guards.render_disposable(self.raw,'grant')

    def test_disposable_composition_exercises_same_guard_and_preserves_one_outer_rollback(self):
        fixture=json.loads((ROOT/'test'/'fixtures'/'coding-source-permissions-v2.json').read_bytes())
        v1=(ROOT/'migrations'/'task-permissions-v1.sql').read_bytes().decode('utf-8')
        sql=runner.compose_sql(fixture,v1,self.raw.decode('utf-8'))
        self.assertIn(guards.fixture_context_capture(),sql)
        self.assertIn(guards.transaction_body(guards.render_disposable(self.raw,'apply')),sql)
        self.assertIn(guards.transaction_body(guards.render_disposable(self.raw,'rollback')),sql)
        for control in ('GUARD_NEGATIVE_FIXTURE_UNEXPECTEDLY_ACCEPTED','fixture_unexpected_column',
            'REVOKE EXECUTE ON FUNCTION','CURRENT_V2_SCOPE_ROLLBACK_WAS_ACCEPTED',
            'ABSENT_FUNCTIONS_CURRENT_V2_SCOPE_ROLLBACK_WAS_ACCEPTED',
            'Guarded rollback changed v1 or history','Fixture rollback left schema behind'):
            self.assertIn(control,sql)
        self.assertEqual(sql.count('\nROLLBACK;'),1)
        self.assertEqual(sql.count("SELECT 'CODING_PERMISSION_SQL_ROLLBACK_ACCEPTED';"),1)
        self.assertNotIn('\nCOMMIT;',sql)
        self.assertNotIn('neondb_owner',sql)

    def test_composition_uses_supplied_source_buffer_without_reread_or_cached_module(self):
        fixture=json.loads((ROOT/'test'/'fixtures'/'coding-source-permissions-v2.json').read_bytes())
        v1=(ROOT/'migrations'/'task-permissions-v1.sql').read_bytes().decode('utf-8')
        source=(ROOT/'scripts'/'coding_permission_schema_guards.py').read_bytes()
        baseline=runner.compose_sql(fixture,v1,self.raw.decode(),guard_source=source)
        cached=types.ModuleType('coding_permission_schema_guards')
        cached.render_disposable=lambda *_:(_ for _ in ()).throw(AssertionError('Cached helper used'))
        with patch.object(Path,'open',side_effect=AssertionError('No source reread')), \
             patch.dict(sys.modules,{'coding_permission_schema_guards':cached}):
            self.assertEqual(runner.compose_sql(fixture,v1,self.raw.decode(),guard_source=source),baseline)
        with self.assertRaisesRegex(ValueError,'SHARED_GUARD_SOURCE_LIMIT'):
            runner.compose_sql(fixture,v1,self.raw.decode(),guard_source=b'x'*65537)

    def test_guard_source_read_is_capped_before_compilation(self):
        class Capped(io.BytesIO):
            requested=[]
            def read(self,amount=-1):
                self.requested.append(amount)
                return super().read(amount)
        stream=Capped(b'x'*70000)
        with patch.object(Path,'open',return_value=stream), \
             self.assertRaisesRegex(ValueError,'SHARED_GUARD_SOURCE_LIMIT'):
            runner.read_guard_source()
        self.assertEqual(stream.requested,[65537])


if __name__=='__main__':unittest.main()
