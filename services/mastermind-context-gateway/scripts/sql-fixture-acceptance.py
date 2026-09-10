"""Existing PostgreSQL acceptance in an uncommitted isolated schema; always rollback.

Only fake identities/tasks are used. No production migration, grant or checkpoint is applied.
The host runner provides the existing DSN in the child environment, never in arguments/logs.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import traceback
import uuid
from datetime import datetime, timezone
import psycopg2

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = 'mm_context_fixture_' + uuid.uuid4().hex
ACTOR = '00000000-0000-8000-8000-000000000001'
FOREIGN = '00000000-0000-8000-8000-000000000009'
TASK = str(uuid.uuid4())
SCOPE = {'schemaVersion': 1, 'status': 'active', 'executionPolicy': {
    'isolationProfile': 'windows-lpac-pure-json-v1', 'effectClass': 'READ_ONLY', 'network': False,
    'childProcesses': False, 'filesystem': 'staged-inputs-only', 'codingAgent': False},
    'modules': [{'moduleId': 'core.fixture', 'repositoryRoot': 'C:/fixture/core',
                 'candidateRoot': 'C:/fixture/candidates', 'operations': ['module.call', 'module.promote', 'module.test'],
                 'capabilities': ['core.fixture.inspect']}]}
def canonical(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()

receipt = {'observedAt': datetime.now(timezone.utc).isoformat(), 'mode': 'isolated fake schema, uncommitted transaction',
           'canonicalWrites': 0, 'liveMigrationApplied': False, 'checks': [], 'migrationHashes': {}}
connection = None
try:
    connection = psycopg2.connect(os.environ['NEON_MEMORY_DSN'], connect_timeout=8)
    cursor = connection.cursor()
    cursor.execute("SET LOCAL statement_timeout='15000'; SET LOCAL lock_timeout='3000'")
    cursor.execute("SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.append_mastermind_context_checkpoint_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb,jsonb)')")
    original_function = cursor.fetchone()
    cursor.execute(f'CREATE SCHEMA {SCHEMA}')
    cursor.execute(f'CREATE TABLE {SCHEMA}.mastermind_players_v1 (household_id text, player_id uuid, PRIMARY KEY(household_id,player_id))')
    cursor.execute(f"INSERT INTO {SCHEMA}.mastermind_players_v1 VALUES ('fixture',%s),('foreign',%s)", (ACTOR,FOREIGN))
    cursor.execute(f"CREATE FUNCTION {SCHEMA}.verify_mastermind_memory_operator_v1(text,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true'")
    for relative in ['memory-system/migrations/007_mastermind_context_gateway_v1.sql',
                     'services/mastermind-context-gateway/migrations/owner-replay-v1.sql',
                     'services/mastermind-context-gateway/migrations/task-permissions-v1.sql']:
        source=(ROOT/relative).read_text(encoding='utf-8-sig')
        receipt['migrationHashes'][relative]=hashlib.sha256((ROOT/relative).read_bytes()).hexdigest()
        fixture=re.sub(r'^(?:BEGIN|COMMIT);\s*$', '', source, flags=re.MULTILINE)
        fixture=fixture.replace('public.', SCHEMA+'.').replace('search_path = public, pg_temp',f'search_path = {SCHEMA}, pg_temp')
        if re.search(r'\bpublic\b|^\s*COMMIT\b',fixture,re.MULTILINE): raise ValueError('Fixture escaped isolated schema')
        cursor.execute(fixture)
    receipt['checks'].append('all reviewed DDL and functions compile in PostgreSQL')

    def checkpoint(cp, revision=None, actor=ACTOR, household='fixture', task=TASK, command_hash=None, summary='fixture progress'):
        arguments=[cp,command_hash or digest({'checkpoint':cp}),task,household,actor,'mastermind','fixture original intent',summary,'active',
                   json.dumps(['keep completed']),json.dumps(['keep open']),json.dumps(['keep blocker'])]
        version=1 if revision is None else 2
        if revision is not None: arguments.append(revision)
        cursor.execute(f'SELECT * FROM {SCHEMA}.append_mastermind_context_checkpoint_v{version}('+','.join(['%s']*len(arguments))+')',arguments)
        return cursor.fetchone()

    def expected_error(code, operation):
        cursor.execute('SAVEPOINT negative_fixture')
        try: operation()
        except psycopg2.Error as error:
            cursor.execute('ROLLBACK TO SAVEPOINT negative_fixture')
            if error.pgcode != code: raise AssertionError('Unexpected SQLSTATE '+str(error.pgcode)) from None
        else: raise AssertionError('Expected SQLSTATE '+code)
        finally: cursor.execute('RELEASE SAVEPOINT negative_fixture')

    cp1=str(uuid.uuid4()); assert checkpoint(cp1)[0]=='applied'
    assert checkpoint(cp1)[0]=='duplicate'
    expected_error('42501',lambda: checkpoint(cp1,actor=FOREIGN,household='foreign'))
    expected_error('42501',lambda: checkpoint(cp1,task=str(uuid.uuid4())))
    assert checkpoint(cp1,command_hash='f'*64)[0]=='conflict'
    receipt['checks'].append('v1 exact replay; foreign owner/task denied; content conflict retained')
    cp2=str(uuid.uuid4()); assert checkpoint(cp2,1)[4]==2
    assert checkpoint(cp2,1)[0]=='duplicate'
    expected_error('40001',lambda: checkpoint(str(uuid.uuid4()),1))
    expected_error('42501',lambda: checkpoint(str(uuid.uuid4()),2,actor=FOREIGN,household='foreign'))
    receipt['checks'].append('v2 compare-and-append; uncertain retry; stale and foreign writes rejected')

    def permission(cp, task_revision, permission_revision, scope=SCOPE, actor=ACTOR, household='fixture', scope_hash=None):
        args=[cp,digest({'checkpoint':cp,'scope':scope,'taskRevision':task_revision,'permissionRevision':permission_revision}),
              TASK,household,actor,'mastermind',task_revision,permission_revision,canonical(scope),scope_hash or digest(scope)]
        cursor.execute(f'SELECT * FROM {SCHEMA}.set_mastermind_context_task_permissions_v1('+','.join(['%s']*10)+')',args)
        return cursor.fetchone()

    grant_cp=str(uuid.uuid4()); applied=permission(grant_cp,2,0)
    assert applied[0]=='applied' and applied[3:6]==(3,1,1)
    first_replay=permission(grant_cp,2,0)
    if first_replay[0]!='duplicate':
        cursor.execute(f'SELECT checkpoint_digest=%s,permission_scope=%s::jsonb,permission_scope_sha256=%s FROM {SCHEMA}.mastermind_context_checkpoints_v1 WHERE checkpoint_id=%s',
            (digest({'checkpoint':grant_cp,'scope':SCOPE,'taskRevision':2,'permissionRevision':0}),canonical(SCOPE),digest(SCOPE),grant_cp))
        receipt['fixtureReplayComparison']=cursor.fetchone()
        receipt['fixtureReplayStatus']=first_replay[0]
    assert first_replay[0]=='duplicate'
    cursor.execute(f'SELECT completed_items,open_items,blockers,summary,permission_scope FROM {SCHEMA}.mastermind_context_checkpoints_v1 WHERE checkpoint_id=%s',(grant_cp,))
    saved=cursor.fetchone()
    assert saved[:3]==(['keep completed'],['keep open'],['keep blocker']) and saved[3].startswith('fixture progress') and saved[4]==SCOPE
    cursor.execute(f'UPDATE {SCHEMA}.mastermind_context_checkpoints_v1 SET permission_scope=NULL WHERE checkpoint_id=%s',(grant_cp,))
    cursor.execute(f'DELETE FROM {SCHEMA}.mastermind_context_checkpoints_v1 WHERE checkpoint_id=%s',(grant_cp,))
    cursor.execute(f'SELECT permission_scope FROM {SCHEMA}.mastermind_context_checkpoints_v1 WHERE checkpoint_id=%s',(grant_cp,))
    assert cursor.fetchone()[0]==SCOPE
    receipt['checks'].append('permission snapshot is inserted once; existing immutable checkpoint update/delete rules remain enforced')
    cp4=str(uuid.uuid4()); assert checkpoint(cp4,3)[4]==4
    assert permission(grant_cp,2,0)[0]=='duplicate'
    expected_error('40001',lambda:permission(str(uuid.uuid4()),3,1))
    expected_error('40001',lambda:permission(str(uuid.uuid4()),4,0))
    expected_error('42501',lambda:permission(str(uuid.uuid4()),4,1,actor=FOREIGN,household='foreign'))
    bad=json.loads(canonical(SCOPE));bad['executionPolicy']['network']=True
    expected_error('22023',lambda:permission(str(uuid.uuid4()),4,1,bad))
    expected_error('22023',lambda:permission(str(uuid.uuid4()),4,1,scope_hash='0'*64))
    receipt['checks'].append('permission CAS, exact snapshot/hash, prior progress preservation, stale/foreign/widened scope denial')
    revoked={**SCOPE,'status':'revoked'}
    revoke_cp=str(uuid.uuid4());assert permission(revoke_cp,4,1,revoked)[3:6]==(5,2,2)
    replay=permission(grant_cp,2,0);assert replay[0]=='duplicate' and replay[4:6]==(1,2)
    cursor.execute(f'SELECT permission_scope,permission_revision,revision FROM {SCHEMA}.mastermind_context_tasks_v1 WHERE task_id=%s',(TASK,))
    assert cursor.fetchone()==(revoked,2,5)
    cursor.execute(f'SELECT count(*) FROM {SCHEMA}.mastermind_context_checkpoints_v1');assert cursor.fetchone()[0]==5
    receipt['checks'].append('revocation persists; replay of historical grant does not reactivate it or append duplicates')
    # A second connection need not see uncommitted fixtures to verify lock ownership.
    with psycopg2.connect(os.environ['NEON_MEMORY_DSN'],connect_timeout=8) as observer:
        with observer.cursor() as check:
            check.execute("SET LOCAL statement_timeout='5000'")
            for key in [TASK,'context-checkpoint/'+grant_cp]:
                check.execute('SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0))',(key,))
                assert check.fetchone()[0] is False
        observer.rollback()
    receipt['checks'].append('task and receipt advisory locks held against a second connection')
    receipt['concurrencyLimit']='Lock exclusion verified; simultaneous committing publishers are not exercised by these uncommitted fixtures.'
    connection.rollback()
    cursor.execute('SELECT to_regnamespace(%s)',(SCHEMA,));assert cursor.fetchone()[0] is None
    cursor.execute("SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.append_mastermind_context_checkpoint_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb,jsonb)')")
    assert cursor.fetchone()==original_function
    receipt['rollbackVerified']=True
    receipt['canonicalFunctionUnchanged']=True
    receipt['ok']=True
except Exception as error:
    receipt['ok']=False
    receipt['error']={'type':type(error).__name__,'sqlstate':getattr(error,'pgcode',None),
                      'fixtureLine':traceback.extract_tb(error.__traceback__)[-1].lineno}
    sys.exitcode=1
finally:
    if connection is not None:
        connection.rollback()
        try:
            with connection.cursor() as cleanup:
                cleanup.execute('SELECT to_regnamespace(%s)',(SCHEMA,))
                receipt['rollbackVerified']=cleanup.fetchone()[0] is None
        finally:
            connection.rollback();connection.close()
    if len(sys.argv)>1: Path(sys.argv[1]).write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps(receipt,indent=2))
if not receipt['ok']: raise SystemExit(1)
