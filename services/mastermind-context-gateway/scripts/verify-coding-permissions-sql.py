"""Explicit disposable PostgreSQL acceptance; never reads a canonical DB setting.

Import is pure. Running requires an explicit loopback DSN whose database name
begins mastermind_fixture_. The entire schema/fixture transaction rolls back.
This is separate from normal source-only CI and has not been executed locally.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import types
from urllib.parse import unquote, urlsplit


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)


def literal(value):
    return "'"+value.replace("'","''")+"'"


def migration_body(text):
    # Keep every function statement intact; remove only the outer transaction.
    match=re.search(r'(?m)^BEGIN;\s*$',text)
    end=re.search(r'(?m)^COMMIT;\s*\Z',text)
    if not match or not end or match.end()>=end.start(): raise ValueError('FIXTURE_MIGRATION_BOUNDARY_CHANGED')
    return text[:match.start()]+text[match.end():end.start()]


def fixture_environment(dsn):
    if not isinstance(dsn,str) or re.search(r'[\x00-\x20\x7f]',dsn): raise ValueError('DISPOSABLE_FIXTURE_DSN_REQUIRED')
    parsed=urlsplit(dsn)
    if (parsed.scheme not in ('postgresql','postgres') or parsed.hostname not in ('127.0.0.1','localhost','::1')
            or parsed.query or parsed.fragment or not parsed.username
            or not re.fullmatch(r'/mastermind_fixture_[a-z0-9_]{1,64}',parsed.path)):
        raise ValueError('DISPOSABLE_FIXTURE_DSN_REQUIRED')
    env={key:value for key,value in os.environ.items() if not key.upper().startswith('PG')}
    env.update(PGHOST=parsed.hostname,PGPORT=str(parsed.port or 5432),PGDATABASE=parsed.path[1:],
        PGUSER=unquote(parsed.username,errors='strict'),PGPASSWORD=unquote(parsed.password or '',errors='strict'),
        PGCONNECT_TIMEOUT='5',PGAPPNAME='mastermind-disposable-permission-fixture')
    return env


def failure_diagnostic(stderr, sensitive_values=()):
    """Bounded synthetic error text; redact before cutting a possible secret."""
    text=stderr.decode('utf-8',errors='replace')
    original=text
    values=set()
    for value in sensitive_values:
        if isinstance(value,str) and value:
            values.add(value)
            values.add(json.dumps(value,ensure_ascii=True)[1:-1])
    # Recognize whole URIs before a short protected value can alter their scheme.
    text=re.sub(r'''(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?)://[^\s'"<>]+''',
                '[redacted-connection-uri]',text)
    for value in sorted(values,key=len,reverse=True):
        text=text.replace(value,'[redacted]')
    redacted=text!=original
    text=re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]','?',text)
    return {'kind':'synthetic-postgres-stderr','message':text[:4096],
            'truncated':len(text)>4096,'redacted':redacted,'limitCharacters':4096}


def process_metadata(stdout,stderr,returncode,*,sensitive_values=(),timed_out=False):
    accepted=(not timed_out and returncode==0
              and stdout.strip()==b'CODING_PERMISSION_SQL_ROLLBACK_ACCEPTED')
    return {'state':'passed' if accepted else 'held' if timed_out else 'failed',
        'scope':'disposable-sql-rollback-only','returncode':returncode,'timedOut':timed_out,
        'stdoutSha256':hashlib.sha256(stdout).hexdigest(),'stderrSha256':hashlib.sha256(stderr).hexdigest(),
        'stdoutBytes':len(stdout),'stderrBytes':len(stderr),'canonicalDatabaseAccess':False,
        'failureDiagnostic':None if accepted else failure_diagnostic(stderr,sensitive_values)}


def read_guard_source():
    with Path(__file__).with_name('coding_permission_schema_guards.py').open('rb') as source:
        raw=source.read(65537)
    if len(raw)>65536: raise ValueError('SHARED_GUARD_SOURCE_LIMIT')
    return raw


def compose_sql(fixture,v1_source,v2_source,*,guard_source=None):
    # Compile the same trusted byte buffer recorded by main, without .pyc/cache
    # reuse or a later source reread. Diagnostic-only import remains effect-free.
    guard_path=Path(__file__).with_name('coding_permission_schema_guards.py')
    if guard_source is None: guard_source=read_guard_source()
    if not isinstance(guard_source,bytes) or len(guard_source)>65536:
        raise ValueError('SHARED_GUARD_SOURCE_LIMIT')
    guards=types.ModuleType('coding_permission_schema_guards')
    guards.__file__=str(guard_path)
    exec(compile(guard_source,str(guard_path),'exec'),guards.__dict__)
    raw_v2=v2_source.encode('utf-8')
    apply_guard=guards.transaction_body(guards.render_disposable(raw_v2,'apply'))
    rollback_guard=guards.transaction_body(guards.render_disposable(raw_v2,'rollback'))
    def negative_guard(change,expected):
        return f"""DO $negative_guard$ BEGIN
          BEGIN
            {change}
            EXECUTE {literal(apply_guard)};
            RAISE EXCEPTION 'GUARD_NEGATIVE_FIXTURE_UNEXPECTEDLY_ACCEPTED';
          EXCEPTION WHEN SQLSTATE 'P0001' THEN
            IF SQLERRM<>{literal(expected)} THEN RAISE; END IF;
          END;
        END $negative_guard$;
"""
    negative_guards=''.join([
        negative_guard('DROP FUNCTION public.validate_mastermind_coding_sources_v2(jsonb) RESTRICT;',
                       'CODING_PERMISSION_V2_PARTIAL_OR_OVERLOADED_STATE'),
        negative_guard("""CREATE OR REPLACE FUNCTION public.validate_mastermind_coding_sources_v2(p_scope jsonb)
          RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp
          AS $changed_body$ BEGIN NULL; END; $changed_body$;""",'CODING_PERMISSION_V2_FUNCTION_CHANGED'),
        negative_guard('REVOKE EXECUTE ON FUNCTION public.validate_mastermind_coding_sources_v2(jsonb) FROM PUBLIC;',
                       'CODING_PERMISSION_V2_FUNCTION_CHANGED'),
        negative_guard('ALTER TABLE public.mastermind_context_tasks_v1 ADD COLUMN fixture_unexpected_column text;',
                       'CODING_PERMISSION_V1_OR_SCHEMA_PREIMAGE_CHANGED'),
    ])
    task=fixture['taskId'];actor=fixture['actorId'];project=fixture['project']
    checkpoint=fixture['codingEntry']['taskBinding']['checkpointId']
    v1=canonical(fixture['v1'])
    v2=canonical({**fixture['v1'],'schemaVersion':2,'codingSources':[fixture['codingEntry']]})
    for value in (task,actor,checkpoint):
        if not re.fullmatch(r'[a-f0-9-]{36}',value): raise ValueError('FIXTURE_ID_CHANGED')
    setup=f"""
BEGIN;
SET LOCAL statement_timeout='20s';
DO $$ BEGIN
  IF current_database() !~ '^mastermind_fixture_[a-z0-9_]+$'
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast'
        AND c.relkind IN ('r','p','v','m','f'))
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') THEN
    RAISE EXCEPTION 'FIXTURE_DATABASE_MUST_BE_EMPTY';
  END IF;
END $$;
CREATE TABLE public.mastermind_context_tasks_v1(
 task_id uuid PRIMARY KEY,household_id text NOT NULL,actor_player_id uuid NOT NULL,project_id text NOT NULL,
 intent text NOT NULL,state text NOT NULL,revision bigint NOT NULL,updated_at timestamptz,last_checkpoint_at timestamptz);
CREATE TABLE public.mastermind_context_checkpoints_v1(
 checkpoint_id uuid PRIMARY KEY,checkpoint_digest text NOT NULL,task_id uuid NOT NULL,sequence bigint NOT NULL,
 state text NOT NULL,summary text,completed_items jsonb,open_items jsonb,blockers jsonb,UNIQUE(task_id,sequence));
CREATE RULE fixture_no_checkpoint_update AS ON UPDATE TO public.mastermind_context_checkpoints_v1 DO INSTEAD NOTHING;
CREATE RULE fixture_no_checkpoint_delete AS ON DELETE TO public.mastermind_context_checkpoints_v1 DO INSTEAD NOTHING;
CREATE FUNCTION public.verify_mastermind_memory_operator_v1(h text,a uuid) RETURNS boolean
 LANGUAGE sql IMMUTABLE AS $owner$ SELECT h='fixture' AND a='{actor}'::uuid $owner$;
INSERT INTO public.mastermind_context_tasks_v1 VALUES
 ('{task}','fixture','{actor}',{literal(project)},'Immutable fixture intent','active',6,NULL,NULL);
INSERT INTO public.mastermind_context_checkpoints_v1 VALUES
 ('00000000-0000-4000-8000-000000000006',repeat('6',64),'{task}',6,'active','Preserved prior progress',
 '["earlier complete"]','["earlier open"]','["earlier blocker"]');
"""
    preserve_v1="""
CREATE TEMP TABLE fixture_v1_definition AS SELECT pg_get_functiondef(
 'public.set_mastermind_context_task_permissions_v1(uuid,text,uuid,text,uuid,text,bigint,bigint,text,text)'::regprocedure) AS definition;
"""
    checks=f"""
CREATE FUNCTION pg_temp.fixture_canonical(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN
  SELECT '{{'||COALESCE(string_agg(to_json(key)::text||':'||pg_temp.fixture_canonical(value),',' ORDER BY key COLLATE "C"),'')||'}}'
   INTO result FROM jsonb_each(v);
 WHEN 'array' THEN
  SELECT '['||COALESCE(string_agg(pg_temp.fixture_canonical(value),',' ORDER BY ord),'')||']'
   INTO result FROM jsonb_array_elements(v) WITH ORDINALITY x(value,ord);
 ELSE result:=v::text;
 END CASE;
 RETURN result;
END $$;
CREATE FUNCTION pg_temp.command_scope(s jsonb,cp uuid,rev bigint,pr bigint,version integer DEFAULT 2,digest_override text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE body text:=pg_temp.fixture_canonical(s); h text; result text;
BEGIN
 h:=encode(sha256(convert_to(body,'UTF8')),'hex');
 IF version=1 THEN
  SELECT result_status INTO result FROM public.set_mastermind_context_task_permissions_v1(
   cp,COALESCE(digest_override,h),'{task}','fixture','{actor}',{literal(project)},rev,pr,body,h);
 ELSE
  SELECT result_status INTO result FROM public.set_mastermind_context_task_permissions_v2(
   cp,COALESCE(digest_override,h),'{task}','fixture','{actor}',{literal(project)},rev,pr,body,h);
 END IF;
 RETURN result;
END $$;
DO $$
DECLARE s jsonb:={literal(v2)}::jsonb; old_scope jsonb:={literal(v1)}::jsonb; bad jsonb; result text;
 cp uuid:='{checkpoint}'; before_task jsonb; before_checkpoints jsonb; function_before text;
BEGIN
 SELECT definition INTO function_before FROM fixture_v1_definition;
 IF pg_temp.fixture_canonical(old_scope)<>{literal(fixture['v1Canonical'])}
 THEN RAISE EXCEPTION 'Cross-language canonical fixture differs'; END IF;
 IF pg_temp.command_scope(old_scope,'00000000-0000-4000-8000-000000000007',6,0,1)<>'applied' THEN RAISE EXCEPTION 'v1 apply'; END IF;
 IF pg_temp.command_scope(old_scope,'00000000-0000-4000-8000-000000000007',6,0,1)<>'duplicate' THEN RAISE EXCEPTION 'v1 replay'; END IF;
 SELECT to_jsonb(t) INTO before_task FROM public.mastermind_context_tasks_v1 t;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY sequence) INTO before_checkpoints FROM public.mastermind_context_checkpoints_v1 t;
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
   jsonb_set(s,'{{modules}}',(s->'modules')||(s->'modules')),
   jsonb_set(s,'{{modules,0,operations}}',(s#>'{{modules,0,operations}}')||jsonb_build_array(s#>'{{modules,0,operations,0}}')),
   jsonb_set(s,'{{modules,0,capabilities}}',(s#>'{{modules,0,capabilities}}')||jsonb_build_array(s#>'{{modules,0,capabilities,0}}')),
   jsonb_set(s,'{{modules,0,repositoryRoot}}','"C:/source/../outside"'),
   jsonb_set(s,'{{modules,0,candidateRoot}}','"C:/candidates//outside"'),
   jsonb_set(s,'{{modules,0,candidateRoot}}','"C:/candidates./outside"'),
   jsonb_set(s,'{{modules,0,candidateRoot}}','"C:/candidates:stream/outside"'),
   jsonb_set(s,'{{executionPolicy,codingAgent}}','true'),
   jsonb_set(s,'{{codingSources,0,executionPolicy,push}}','true'),
   jsonb_set(s,'{{codingSources,0,limits,wall_seconds}}','301'),
   jsonb_set(s,'{{codingSources,0,allowedTargets,0,path}}','"../outside.py"'),
   jsonb_set(s,'{{codingSources,0,taskBinding,revision}}','"9"')
 )) LOOP
  BEGIN
   PERFORM pg_temp.command_scope(bad,cp,7,1);
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Invalid scope was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 END LOOP;
 IF (SELECT to_jsonb(t) FROM public.mastermind_context_tasks_v1 t)<>before_task
  OR (SELECT jsonb_agg(to_jsonb(t) ORDER BY sequence) FROM public.mastermind_context_checkpoints_v1 t)<>before_checkpoints
 THEN RAISE EXCEPTION 'Invalid commands changed stored progress'; END IF;
 BEGIN
  PERFORM public.set_mastermind_context_task_permissions_v2(cp,repeat('a',64),'{task}','fixture',
   '00000000-0000-4000-8000-000000000099',{literal(project)},7,1,s::text,encode(sha256(convert_to(s::text,'UTF8')),'hex'));
  RAISE EXCEPTION 'Foreign operator accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM pg_temp.command_scope(s,cp,6,1);
  RAISE EXCEPTION 'Stale task revision accepted';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
 BEGIN
  PERFORM pg_temp.command_scope(s,cp,7,0);
  RAISE EXCEPTION 'Stale permission revision accepted';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
 IF pg_temp.command_scope(s,cp,7,1)<>'applied' THEN RAISE EXCEPTION 'v2 apply'; END IF;
 BEGIN
  EXECUTE {literal(rollback_guard)};
  RAISE EXCEPTION 'CURRENT_V2_SCOPE_ROLLBACK_WAS_ACCEPTED';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'RESTORE_CURRENT_TASK_SCOPES_WITH_EXISTING_OWNER_CAS_BEFORE_SCHEMA_ROLLBACK' THEN RAISE; END IF;
 END;
 BEGIN
  DROP FUNCTION public.set_mastermind_context_task_permissions_v2(uuid,text,uuid,text,uuid,text,bigint,bigint,text,text) RESTRICT;
  DROP FUNCTION public.validate_mastermind_coding_sources_v2(jsonb) RESTRICT;
  EXECUTE {literal(rollback_guard)};
  RAISE EXCEPTION 'ABSENT_FUNCTIONS_CURRENT_V2_SCOPE_ROLLBACK_WAS_ACCEPTED';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'RESTORE_CURRENT_TASK_SCOPES_WITH_EXISTING_OWNER_CAS_BEFORE_SCHEMA_ROLLBACK' THEN RAISE; END IF;
 END;
 SELECT to_jsonb(t) INTO before_task FROM public.mastermind_context_tasks_v1 t;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY sequence) INTO before_checkpoints FROM public.mastermind_context_checkpoints_v1 t;
 IF pg_temp.command_scope(s,cp,7,1)<>'duplicate' THEN RAISE EXCEPTION 'v2 replay'; END IF;
 IF pg_temp.command_scope(s,cp,7,1,2,repeat('0',64))<>'conflict' THEN RAISE EXCEPTION 'v2 conflict'; END IF;
 IF (SELECT to_jsonb(t) FROM public.mastermind_context_tasks_v1 t)<>before_task
  OR (SELECT jsonb_agg(to_jsonb(t) ORDER BY sequence) FROM public.mastermind_context_checkpoints_v1 t)<>before_checkpoints
 THEN RAISE EXCEPTION 'Replay changed retained state'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mastermind_context_checkpoints_v1 WHERE checkpoint_id=cp
  AND permission_scope=s AND permission_revision=2 AND completed_items='["earlier complete"]'::jsonb
  AND open_items='["earlier open"]'::jsonb AND blockers='["earlier blocker"]'::jsonb
  AND summary LIKE 'Preserved prior progress%') THEN RAISE EXCEPTION 'Checkpoint/progress preservation failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mastermind_context_tasks_v1 WHERE revision=8 AND permission_revision=2
  AND intent='Immutable fixture intent' AND permission_scope=s) THEN RAISE EXCEPTION 'Task identity changed'; END IF;
 bad:=jsonb_set(s,'{{codingSources,0,reviewContentSha256}}',to_jsonb(repeat('0',64)));
 BEGIN
  PERFORM pg_temp.command_scope(bad,'00000000-0000-4000-8000-000000000009',8,2);
  RAISE EXCEPTION 'Historical operation rebound';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 IF pg_temp.command_scope(jsonb_set(s,'{{status}}','"revoked"'),'00000000-0000-4000-8000-000000000009',8,2)<>'applied'
 THEN RAISE EXCEPTION 'Revocation failed'; END IF;
 IF pg_temp.command_scope(old_scope,'00000000-0000-4000-8000-000000000010',9,3,1)<>'applied'
 THEN RAISE EXCEPTION 'Explicit v1 rollback failed'; END IF;
 IF (SELECT permission_scope FROM public.mastermind_context_tasks_v1)<>old_scope
  OR (SELECT permission_scope FROM public.mastermind_context_checkpoints_v1 WHERE checkpoint_id=cp)<>s
 THEN RAISE EXCEPTION 'Rollback erased v2 history'; END IF;
 IF pg_get_functiondef('public.set_mastermind_context_task_permissions_v1(uuid,text,uuid,text,uuid,text,bigint,bigint,text,text)'::regprocedure)<>function_before
 THEN RAISE EXCEPTION 'V1 definition changed'; END IF;
END $$;
{rollback_guard}
{rollback_guard}
DO $guard_rollback_preserved$ BEGIN
 IF to_regprocedure('public.validate_mastermind_coding_sources_v2(jsonb)') IS NOT NULL
  OR to_regprocedure('public.set_mastermind_context_task_permissions_v2(uuid,text,uuid,text,uuid,text,bigint,bigint,text,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'Guarded rollback left v2 functions'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mastermind_context_checkpoints_v1
   WHERE checkpoint_id='{checkpoint}'::uuid AND permission_scope={literal(v2)}::jsonb)
  OR pg_get_functiondef('public.set_mastermind_context_task_permissions_v1(uuid,text,uuid,text,uuid,text,bigint,bigint,text,text)'::regprocedure)
     IS DISTINCT FROM (SELECT definition FROM fixture_v1_definition)
 THEN RAISE EXCEPTION 'Guarded rollback changed v1 or history'; END IF;
END $guard_rollback_preserved$;
ROLLBACK;
DO $$ BEGIN
 IF to_regclass('public.mastermind_context_tasks_v1') IS NOT NULL
  OR to_regclass('public.mastermind_context_checkpoints_v1') IS NOT NULL
  OR to_regprocedure('public.validate_mastermind_coding_sources_v2(jsonb)') IS NOT NULL
 THEN RAISE EXCEPTION 'Fixture rollback left schema behind'; END IF;
END $$;
SELECT 'CODING_PERMISSION_SQL_ROLLBACK_ACCEPTED';
"""
    return (setup+migration_body(v1_source)+preserve_v1+guards.fixture_context_capture()
            +apply_guard+apply_guard+negative_guards+checks)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn',required=True,help='Explicit empty loopback mastermind_fixture_* database only')
    parser.add_argument('--psql',default='psql')
    args=parser.parse_args();env=fixture_environment(args.dsn)
    root=Path(__file__).resolve().parents[1]
    paths=[root/'test'/'fixtures'/'coding-source-permissions-v2.json',
        root/'migrations'/'task-permissions-v1.sql',root/'migrations'/'task-permissions-v2.sql']
    bodies=[path.read_bytes() for path in paths]
    guard_path=root/'scripts'/'coding_permission_schema_guards.py'
    guard_source=read_guard_source()
    fixture=json.loads(bodies[0].decode('utf-8-sig'))
    sql=compose_sql(fixture,*[body.decode('utf-8-sig') for body in bodies[1:]],guard_source=guard_source)
    sensitive=(args.dsn,env['PGPASSWORD'],urlsplit(args.dsn).password or '')
    try:
        result=subprocess.run([args.psql,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],input=sql.encode(),
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=45,check=False)
        record=process_metadata(result.stdout,result.stderr,result.returncode,sensitive_values=sensitive)
    except subprocess.TimeoutExpired as error:
        record=process_metadata(error.stdout or b'',error.stderr or b'',None,sensitive_values=sensitive,timed_out=True)
    sources={str(path.relative_to(root)):hashlib.sha256(body).hexdigest() for path,body in zip(paths,bodies)}
    sources[str(guard_path.relative_to(root))]=hashlib.sha256(guard_source).hexdigest()
    record.update(sqlSha256=hashlib.sha256(sql.encode()).hexdigest(),sources=sources,
        guardedMigrationControls=['first_apply','same_source_replay','partial_installation_hold',
          'changed_function_hold','changed_acl_hold','protected_schema_change_hold',
          'current_v2_scope_rollback_hold','absent_functions_current_v2_scope_rollback_hold',
          'guarded_rollback','rollback_replay','v1_and_history_preserved'])
    print(json.dumps(record))
    return 0 if record['state']=='passed' else 1


if __name__=='__main__':
    try: raise SystemExit(main())
    except (ValueError,OSError,subprocess.TimeoutExpired):
        print(json.dumps({'state':'held','reason':'DISPOSABLE_SQL_FIXTURE_UNAVAILABLE','canonicalDatabaseAccess':False}))
        raise SystemExit(1)
