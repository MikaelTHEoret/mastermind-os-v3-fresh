"""Pure guarded extension of the accepted v2 validator; no connection or grant.

The caller supplies the shared guard module compiled from its recorded bytes.
Only the validator can change. Both setters, task/history schema and ownership
are protected by the same catalog snapshot on apply, replay and rollback.
"""
import copy
import hashlib
import json

EXTENSION_SHA = 'd9294e9866776843ef5e7c540f659ac304a866e4dda3214d768124b48e5fc681'
PROFILE = 'codex-approve-for-me-workspace-write-suppressed-v2'
CLI_SHA = 'dacb96688b155e20dbbbc0bfd18bba7ce7920f1b239ab08a1627917f23b8d9cd'
SETTING = 'mastermind_fixture.permission_profile_extension'
SETTER = 'public.set_mastermind_context_task_permissions_v2(uuid,text,uuid,text,uuid,text,bigint,bigint,text,text)'


def reviewed_pair(guards, base, extension):
    old = guards.reviewed_functions(base)
    if not isinstance(extension, bytes) or hashlib.sha256(extension).hexdigest() != EXTENSION_SHA:
        raise ValueError('REVIEWED_PROFILE_EXTENSION_PIN_CHANGED')
    text = extension.decode('utf-8')
    if text.count('\nCOMMIT;\n') != 1 or not text.endswith('\nCOMMIT;\n'):
        raise ValueError('PROFILE_EXTENSION_BOUNDARY_CHANGED')
    # Use the existing extractor; the second function must be the untouched setter.
    combined = text[:-len('COMMIT;\n')] + old[1]['statement'] + '\nCOMMIT;\n'
    rows = guards.new_functions(combined, None)
    if rows[1] != old[1]:
        raise ValueError('PROFILE_EXTENSION_SETTER_CHANGED')
    return old[0], rows[0]


def signatures(guards):
    return [*guards.SIGNATURES, SETTER]


def fixture_context_capture(guards):
    query = guards.snapshot_query(signatures(guards))
    return f"""DO $profile_extension_context$
DECLARE v_protected jsonb;
BEGIN
  IF current_database() !~ '^mastermind_fixture_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'DISPOSABLE_PROFILE_EXTENSION_DATABASE_REQUIRED';
  END IF;
  {query} INTO v_protected;
  PERFORM set_config('{SETTING}',jsonb_build_object('mode','disposable-fixture',
    'server',jsonb_build_object('database',current_database(),'current_role',current_user,
      'session_role',session_user,'server_version_num',current_setting('server_version_num')),
    'protected',v_protected)::text,true);
END;
$profile_extension_context$;
"""


def canonical_context(guards, preflight):
    if (not isinstance(preflight, dict) or preflight.get('readOnly') is not True
            or preflight.get('extensionSha256') != EXTENSION_SHA):
        raise ValueError('READ_ONLY_PROFILE_EXTENSION_PREFLIGHT_REQUIRED')
    context = copy.deepcopy(preflight['context'])
    if context.get('mode') != 'canonical-preflight':
        raise ValueError('CANONICAL_PROFILE_EXTENSION_CONTEXT_REQUIRED')
    server = context['server']
    if (set(server) != {'database', 'current_role', 'session_role', 'server_version_num'}
            or any(not isinstance(value, str) or not value for value in server.values())):
        raise ValueError('PROFILE_EXTENSION_SERVER_CONTEXT_CHANGED')
    protected = context['protected']
    if set(protected) != {'functions', 'tables', 'columns', 'constraints', 'rules', 'triggers'}:
        raise ValueError('PROFILE_EXTENSION_PROTECTED_CONTEXT_CHANGED')
    if [row['signature'] for row in protected['functions']] != signatures(guards):
        raise ValueError('PROFILE_EXTENSION_PROTECTED_FUNCTIONS_CHANGED')
    for row in protected['functions']:
        digest = row.get('definition_sha256')
        if (not isinstance(digest, str) or len(digest) != 64
                or any(char not in '0123456789abcdef' for char in digest)
                or not isinstance(row.get('owner'), str)):
            raise ValueError('PROFILE_EXTENSION_PROTECTED_FUNCTIONS_CHANGED')
    if protected['triggers']:
        raise ValueError('PROFILE_EXTENSION_TRIGGER_REVIEW_REQUIRED')
    return context


def function_query(guards, row):
    signature = guards.literal(row['expected']['signature'])
    return f"""SELECT jsonb_build_object('signature',{signature},'owner',pg_get_userbyid(p.proowner),
      'language',l.lanname,'kind',p.prokind::text,'volatility',p.provolatile::text,
      'security_definer',p.prosecdef,'strict',p.proisstrict,'parallel',p.proparallel::text,
      'leakproof',p.proleakproof,'configuration',p.proconfig,'acl',p.proacl::text,
      'argument_type_oids',p.proargtypes::text,'return_type_oid',p.prorettype::text,
      'returns_set',p.proretset,'identity_arguments',pg_get_function_identity_arguments(p.oid),
      'result_type',pg_get_function_result(p.oid),
      'body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) INTO v_function
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure({signature});"""


def _render(guards, base, extension, action, context_sql):
    if action not in ('apply', 'rollback'):
        raise ValueError('PROFILE_EXTENSION_ACTION_INVALID')
    old, new = reviewed_pair(guards, base, extension)
    source, target = (old, new) if action == 'apply' else (new, old)
    query = guards.snapshot_query(signatures(guards))
    current = function_query(guards, old)
    before = guards.json_literal(source['expected'])
    after = guards.json_literal(target['expected'])
    scope_hold = ''
    if action == 'rollback':
        scope_hold = f"""IF EXISTS(SELECT 1 FROM public.mastermind_context_tasks_v1 t
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.permission_scope->'codingSources')='array'
          THEN t.permission_scope->'codingSources' ELSE '[]'::jsonb END) s
        WHERE s->'runtime'->>'cliProfile'='{PROFILE}') THEN
        RAISE EXCEPTION 'RESTORE_CURRENT_SUPPRESSED_SCOPES_BEFORE_PROFILE_ROLLBACK';
      END IF;"""
    return f"""-- PREPARED ONLY. No task or permission setter is invoked.
-- Exact profile extension SHA256 {EXTENSION_SHA}.
BEGIN READ WRITE;
SET LOCAL statement_timeout='10000';
SET LOCAL lock_timeout='2000';
SET LOCAL idle_in_transaction_session_timeout='15000';
SET LOCAL standard_conforming_strings=on;
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.mastermind_context_tasks_v1,public.mastermind_context_checkpoints_v1 IN SHARE MODE NOWAIT;
DO $coding_profile_extension$
DECLARE v_before jsonb;v_after jsonb;v_function jsonb;v_expected jsonb:={context_sql};
  v_source jsonb;v_target jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('mastermind-schema/coding-permission-v2',0)) THEN
    RAISE EXCEPTION 'CODING_PERMISSION_MIGRATION_BUSY';
  END IF;
  IF (v_expected->>'mode') IS NULL OR (v_expected->>'mode') NOT IN ('canonical-preflight','disposable-fixture')
    OR ((v_expected->>'mode')='disposable-fixture' AND current_database() !~ '^mastermind_fixture_[a-z0-9_]+$')
    OR current_database() IS DISTINCT FROM (v_expected#>>'{{server,database}}')
    OR current_user::text IS DISTINCT FROM (v_expected#>>'{{server,current_role}}')
    OR session_user::text IS DISTINCT FROM (v_expected#>>'{{server,session_role}}')
    OR current_setting('server_version_num') IS DISTINCT FROM (v_expected#>>'{{server,server_version_num}}')
    OR NOT has_schema_privilege(current_user,'public','CREATE') THEN
    RAISE EXCEPTION 'PROFILE_EXTENSION_TARGET_OR_OWNER_CHANGED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') THEN
    RAISE EXCEPTION 'PROFILE_EXTENSION_EVENT_TRIGGER_REVIEW_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND d.defaclobjtype='f'
      AND (d.defaclnamespace=0 OR n.nspname='public')) THEN
    RAISE EXCEPTION 'PROFILE_EXTENSION_DEFAULT_ACL_CHANGED';
  END IF;
  {query} INTO v_before;
  IF v_before IS DISTINCT FROM (v_expected->'protected') THEN
    RAISE EXCEPTION 'PROFILE_EXTENSION_PROTECTED_SCHEMA_CHANGED';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='validate_mastermind_coding_sources_v2')<>1 THEN
    RAISE EXCEPTION 'PROFILE_EXTENSION_VALIDATOR_ABSENT_OR_OVERLOADED';
  END IF;
  {scope_hold}
  v_source:={before}||jsonb_build_object('owner',v_expected#>>'{{server,current_role}}');
  v_target:={after}||jsonb_build_object('owner',v_expected#>>'{{server,current_role}}');
  {current}
  IF v_function=v_source THEN
    EXECUTE {guards.literal(target['statement'])};
  ELSIF v_function IS DISTINCT FROM v_target THEN
    RAISE EXCEPTION 'PROFILE_EXTENSION_VALIDATOR_PREIMAGE_CHANGED';
  END IF;
  {current}
  IF v_function IS DISTINCT FROM v_target THEN
    RAISE EXCEPTION 'PROFILE_EXTENSION_VALIDATOR_POSTCONDITION_CHANGED';
  END IF;
  {query} INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'PROFILE_EXTENSION_PROTECTED_SCHEMA_CHANGED';
  END IF;
END;
$coding_profile_extension$;
COMMIT;
"""


def render_disposable(guards, base, extension, action):
    return _render(guards, base, extension, action, f"current_setting('{SETTING}',false)::jsonb")


def render_canonical(guards, preflight, base, extension, action):
    context = guards.json_literal(canonical_context(guards, preflight))
    return _render(guards, base, extension, action, context)
