"""Shared permission DDL guards: pure rendering, no database or filesystem effects.

Canonical callers supply a separately verified preflight. The disposable adapter
uses only a transaction-local catalog snapshot from an empty fixture database.
Neither rendering mode authorizes dispatch or a permission grant.
"""
import hashlib
import json
import re

MIGRATION_SHA = '35a4487d7a444b73d870d29ddfbe45cf2ec6d72571d5b990cbaa150f6fa471f6'
TABLES_SQL = "ARRAY['mastermind_context_tasks_v1','mastermind_context_checkpoints_v1']"
SIGNATURES = [
    'public.verify_mastermind_memory_operator_v1(text,uuid)',
    'public.append_mastermind_context_checkpoint_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb,jsonb)',
    'public.append_mastermind_context_checkpoint_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint)',
    'public.set_mastermind_context_task_permissions_v1(uuid,text,uuid,text,uuid,text,bigint,bigint,text,text)',
]
FIXTURE_SETTING = 'mastermind_fixture.permission_guard_context'

def sha(raw): return hashlib.sha256(raw).hexdigest()
def literal(value): return "'" + value.replace("'", "''") + "'"
def json_literal(value): return literal(json.dumps(value, sort_keys=True, separators=(',', ':'))) + '::jsonb'


def snapshot_query(signatures):
    names = 'ARRAY[' + ','.join(literal(value) for value in signatures) + ']'
    return f"""SELECT jsonb_build_object(
      'functions',(SELECT jsonb_agg(jsonb_build_object('signature',s.signature,
        'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
        'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) ORDER BY s.position)
        FROM unnest({names}) WITH ORDINALITY s(signature,position)
        LEFT JOIN pg_proc p ON p.oid=to_regprocedure(s.signature)),
      'tables',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (
        SELECT c.relname AS name,c.relkind::text AS kind,pg_get_userbyid(c.relowner) AS owner,
          c.relacl::text AS acl,c.relrowsecurity AS row_security,c.relforcerowsecurity AS force_row_security,
          has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
          has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
          has_table_privilege(current_user,c.oid,'UPDATE') AS can_update
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY({TABLES_SQL})) x),
      'columns',(SELECT jsonb_agg(to_jsonb(x)-'position' ORDER BY x.table_name,x.position) FROM (
        SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS type,
          a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression,
          a.attidentity::text AS identity_kind,a.attgenerated::text AS generated_kind,a.attnum AS position
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relname=ANY({TABLES_SQL})) x),
      'constraints',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.name) FROM (
        SELECT c.relname AS table_name,k.conname AS name,k.contype::text AS type,k.convalidated AS validated,
          pg_get_constraintdef(k.oid,true) AS definition
        FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY({TABLES_SQL})) x),
      'rules',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.name) FROM (
        SELECT c.relname AS table_name,r.rulename AS name,r.ev_enabled::text AS enabled,
          pg_get_ruledef(r.oid,true) AS definition
        FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY({TABLES_SQL})) x),
      'triggers',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.name) FROM (
        SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled::text AS enabled,
          pg_get_triggerdef(t.oid,true) AS definition
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY({TABLES_SQL}) AND NOT t.tgisinternal) x),'[]'::jsonb))"""


def new_functions(source, owner):
    pattern = (r'(CREATE OR REPLACE FUNCTION public\.(\w+)\((.*?)\)\s*RETURNS\s+(.*?)\s+'
               r'LANGUAGE plpgsql (IMMUTABLE|VOLATILE) SET search_path\s*=\s*public,\s*pg_temp AS \$\$(.*?)\$\$;)')
    result = []
    for match in re.finditer(pattern, source, re.DOTALL):
        statement, name, arguments, returns, volatility, body = match.groups()
        args = [' '.join(value.split()) for value in arguments.split(',')]
        types = [value.split()[-1] for value in args]
        signature = 'public.' + name + '(' + ','.join(types) + ')'
        returns = ' '.join(returns.split())
        is_table = returns.startswith('TABLE(')
        expected = {'signature':signature,'owner':owner,'language':'plpgsql','kind':'f',
            'volatility':'i' if volatility=='IMMUTABLE' else 'v','security_definer':False,
            'strict':False,'parallel':'u','leakproof':False,'configuration':['search_path=public, pg_temp'],
            'acl':None,'argument_type_oids':' '.join({'uuid':'2950','text':'25','bigint':'20','jsonb':'3802'}[value] for value in types),
            'return_type_oid':'2249' if is_table else '2278','returns_set':is_table,
            'identity_arguments':', '.join(args),'result_type':returns,'body_sha256':sha(body.encode())}
        result.append({'statement':statement,'expected':expected})
    if [row['expected']['signature'] for row in result] != [
        'public.validate_mastermind_coding_sources_v2(jsonb)',
        'public.set_mastermind_context_task_permissions_v2(uuid,text,uuid,text,uuid,text,bigint,bigint,text,text)']:
        raise ValueError('REVIEWED_FUNCTION_EXTRACTION_CHANGED')
    remainder = source
    for row in result: remainder = remainder.replace(row['statement'], '', 1)
    remainder = re.sub(r'--[^\n]*', '', remainder)
    if re.sub(r'\s+', '', remainder) != 'BEGIN;COMMIT;':
        raise ValueError('UNREVIEWED_MIGRATION_STATEMENT')
    return result


def function_check(row):
    signature = literal(row['expected']['signature'])
    return f"""SELECT jsonb_build_object('signature',{signature},'owner',pg_get_userbyid(p.proowner),
        'language',l.lanname,'kind',p.prokind::text,'volatility',p.provolatile::text,
        'security_definer',p.prosecdef,'strict',p.proisstrict,'parallel',p.proparallel::text,
        'leakproof',p.proleakproof,'configuration',p.proconfig,'acl',p.proacl::text,
        'argument_type_oids',p.proargtypes::text,'return_type_oid',p.prorettype::text,
        'returns_set',p.proretset,'identity_arguments',pg_get_function_identity_arguments(p.oid),
        'result_type',pg_get_function_result(p.oid),
        'body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) INTO v_function
        FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure({signature});
      IF v_function IS DISTINCT FROM ({json_literal(row['expected'])} ||
          jsonb_build_object('owner',v_expected#>>'{{server,current_role}}')) THEN
        RAISE EXCEPTION USING MESSAGE='CODING_PERMISSION_V2_FUNCTION_CHANGED';
      END IF;"""


def reviewed_functions(raw_source):
    if not isinstance(raw_source, bytes) or sha(raw_source) != MIGRATION_SHA:
        raise ValueError('REVIEWED_MIGRATION_PIN_CHANGED')
    return new_functions(raw_source.decode('utf-8').replace('\r\n','\n'), None)


def canonical_context(preflight):
    if not isinstance(preflight,dict) or preflight.get('readOnly') is not True:
        raise ValueError('VERIFIED_READ_ONLY_PREFLIGHT_REQUIRED')
    metadata=preflight['metadata']
    if preflight.get('migrationSha256')!=MIGRATION_SHA or len(metadata['functions'])!=6:
        raise ValueError('PREFLIGHT_MIGRATION_CONTEXT_CHANGED')
    if [row['signature'] for row in metadata['functions'][:4]]!=SIGNATURES:
        raise ValueError('PREFLIGHT_REQUIRED_FUNCTIONS_CHANGED')
    if not all(row.get('absent') is True for row in metadata['functions'][4:]):
        raise ValueError('FIRST_INSTALLATION_PREFLIGHT_REQUIRED')
    protected={key:metadata[key] for key in ('tables','columns','constraints','rules','triggers')}
    protected['functions']=[{key:row[key] for key in ('signature','definition_sha256','owner','acl')}
                             for row in metadata['functions'][:4]]
    if any(not isinstance(row['definition_sha256'],str) or
           not re.fullmatch('[a-f0-9]{64}',row['definition_sha256']) for row in protected['functions']):
        raise ValueError('PREFLIGHT_REQUIRED_FUNCTIONS_CHANGED')
    if metadata['functionDefaultPrivileges'] or metadata['triggers']:
        raise ValueError('ADDITIONAL_SCHEMA_REVIEW_REQUIRED')
    return {'mode':'canonical-preflight','server':{key:metadata['server'][key]
        for key in ('database','current_role','session_role','server_version_num')},'protected':protected}


def fixture_context_capture():
    """SQL only: capture the actual synthetic catalog inside its rollback transaction."""
    query=snapshot_query(SIGNATURES)
    return f"""DO $fixture_guard_context$
DECLARE v_protected jsonb;
BEGIN
  IF current_database() !~ '^mastermind_fixture_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'DISPOSABLE_GUARD_DATABASE_REQUIRED';
  END IF;
  {query} INTO v_protected;
  PERFORM set_config('{FIXTURE_SETTING}',jsonb_build_object('mode','disposable-fixture',
    'server',jsonb_build_object('database',current_database(),'current_role',current_user,
      'session_role',session_user,'server_version_num',current_setting('server_version_num')),
    'protected',v_protected)::text,true);
END;
$fixture_guard_context$;
"""


def _render(context_sql,raw_source,action):
    if action not in ('apply','rollback'): raise ValueError('GUARD_ACTION_INVALID')
    functions=reviewed_functions(raw_source)
    query=snapshot_query(SIGNATURES)
    checks='\n'.join(function_check(row) for row in functions)
    names=','.join(literal(row['expected']['signature'].split('.')[1].split('(')[0]) for row in functions)
    count=f"(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ({names}))"
    create='\n'.join('EXECUTE '+literal(row['statement'])+';' for row in functions)
    drop='\n'.join('DROP FUNCTION '+row['expected']['signature']+' RESTRICT;' for row in reversed(functions))
    if action=='apply':
        effect=f"""IF {count}=0 THEN
        {create}
      ELSIF {count}<>2 THEN
        RAISE EXCEPTION USING MESSAGE='CODING_PERMISSION_V2_PARTIAL_OR_OVERLOADED_STATE';
      END IF;
      {checks}"""
    else:
        effect=f"""IF EXISTS(SELECT 1 FROM public.mastermind_context_tasks_v1 WHERE permission_scope->'schemaVersion'='2'::jsonb) THEN
          RAISE EXCEPTION USING MESSAGE='RESTORE_CURRENT_TASK_SCOPES_WITH_EXISTING_OWNER_CAS_BEFORE_SCHEMA_ROLLBACK';
        END IF;
      IF {count}<>0 THEN
        IF {count}<>2 THEN RAISE EXCEPTION USING MESSAGE='CODING_PERMISSION_V2_PARTIAL_OR_OVERLOADED_STATE'; END IF;
        {checks}
        {drop}
      END IF;
      IF {count}<>0 THEN RAISE EXCEPTION USING MESSAGE='CODING_PERMISSION_V2_ROLLBACK_POSTCONDITION'; END IF;"""
    return f"""-- PREPARED ONLY. Canonical dispatch requires separate target fingerprint/source-pin verification.
-- Authoritative migration SHA256 {MIGRATION_SHA}; no permission setter is invoked.
BEGIN READ WRITE;
SET LOCAL statement_timeout='10000';
SET LOCAL lock_timeout='2000';
SET LOCAL idle_in_transaction_session_timeout='15000';
SET LOCAL standard_conforming_strings=on;
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.mastermind_context_tasks_v1,public.mastermind_context_checkpoints_v1 IN SHARE MODE NOWAIT;
DO $coding_permission_v2$
DECLARE v_before jsonb;v_after jsonb;v_function jsonb;v_expected jsonb:={context_sql};
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('mastermind-schema/coding-permission-v2',0)) THEN
    RAISE EXCEPTION USING MESSAGE='CODING_PERMISSION_MIGRATION_BUSY';
  END IF;
  IF (v_expected->>'mode') IS NULL OR (v_expected->>'mode') NOT IN ('canonical-preflight','disposable-fixture')
    OR ((v_expected->>'mode')='disposable-fixture' AND current_database() !~ '^mastermind_fixture_[a-z0-9_]+$')
    OR current_database() IS DISTINCT FROM (v_expected#>>'{{server,database}}')
    OR current_user::text IS DISTINCT FROM (v_expected#>>'{{server,current_role}}')
    OR session_user::text IS DISTINCT FROM (v_expected#>>'{{server,session_role}}')
    OR current_setting('server_version_num') IS DISTINCT FROM (v_expected#>>'{{server,server_version_num}}')
    OR NOT has_schema_privilege(current_user,'public','CREATE') THEN
    RAISE EXCEPTION USING MESSAGE='CODING_PERMISSION_TARGET_OR_OWNER_CHANGED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') THEN
    RAISE EXCEPTION USING MESSAGE='CODING_PERMISSION_EVENT_TRIGGER_REVIEW_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND d.defaclobjtype='f'
      AND (d.defaclnamespace=0 OR n.nspname='public')) THEN
    RAISE EXCEPTION USING MESSAGE='CODING_PERMISSION_FUNCTION_DEFAULT_ACL_CHANGED';
  END IF;
  {query} INTO v_before;
  IF v_before IS DISTINCT FROM (v_expected->'protected') THEN
    RAISE EXCEPTION USING MESSAGE='CODING_PERMISSION_V1_OR_SCHEMA_PREIMAGE_CHANGED';
  END IF;
  {effect}
  {query} INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION USING MESSAGE='CODING_PERMISSION_PROTECTED_SCHEMA_CHANGED';
  END IF;
END;
$coding_permission_v2$;
COMMIT;
"""


def render_canonical(preflight,raw_source,action):
    """Canonical mode always embeds its supplied reviewed preimage as literal JSON."""
    return _render(json_literal(canonical_context(preflight)),raw_source,action)


def render_disposable(raw_source,action):
    """Fixture mode can only reference this fixed server-side synthetic context."""
    return _render("current_setting('"+FIXTURE_SETTING+"',false)::jsonb",raw_source,action)


def transaction_body(sql):
    """Embed the same guarded body in the fixture's one outer rollback transaction."""
    start=re.search(r'(?m)^BEGIN READ WRITE;\s*$',sql)
    end=re.search(r'(?m)^COMMIT;\s*\Z',sql)
    if not start or not end or start.end()>=end.start():
        raise ValueError('GUARD_TRANSACTION_BOUNDARY_CHANGED')
    return sql[:start.start()]+sql[start.end():end.start()]
