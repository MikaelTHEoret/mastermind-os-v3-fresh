"""Migration021 acceptance against fake identities in an isolated schema, always rolled back.
No production DDL, node pairing, service execution, grants or credentials are changed.
"""
from datetime import datetime, timedelta, timezone
import hashlib, json, os, re, sys, traceback, uuid
from pathlib import Path
import psycopg2

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = 'mm_node_fixture_' + uuid.uuid4().hex
FAMILY = 'family-ecosystem.ensure-running'
CORE = 'mastermind.core.status'
def uid(): return str(uuid.uuid4())
def sha(value): return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
ACTOR, FOREIGN, NODE, OTHER, BOOT = [uid() for _ in range(5)]
WORKER = {'protocolVersion':2,'capabilities':[{'id':FAMILY,'version':1},{'id':CORE,'version':1}]}
receipt = {'observedAt': datetime.now(timezone.utc).isoformat(), 'mode':'isolated fake schema; always rollback',
           'productionWrites':0,'migrationApplied':False,'checks':[],'sourceHashes':{}}
connection = None
try:
    connection = psycopg2.connect(os.environ['NEON_MEMORY_DSN'],connect_timeout=8)
    cursor = connection.cursor()
    cursor.execute("SET LOCAL statement_timeout='15000'; SET LOCAL lock_timeout='3000'")
    def public_snapshot():
        cursor.execute("SELECT p.proname, pg_get_function_identity_arguments(p.oid), md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'exchange_mastermind_node%%' OR p.proname LIKE 'enqueue_mastermind%%' OR p.proname LIKE 'mastermind_node_worker%%') ORDER BY 1,2")
        return cursor.fetchall()
    original_functions=public_snapshot()
    cursor.execute(f'CREATE SCHEMA {SCHEMA}')
    cursor.execute(f'CREATE TABLE {SCHEMA}.mastermind_households_v1(household_id text PRIMARY KEY,state text NOT NULL)')
    cursor.execute(f'CREATE TABLE {SCHEMA}.mastermind_players_v1(household_id text,player_id uuid,role text,state text,PRIMARY KEY(household_id,player_id))')
    cursor.execute(f"INSERT INTO {SCHEMA}.mastermind_households_v1 VALUES ('fixture','active'),('foreign','active')")
    cursor.execute(f"INSERT INTO {SCHEMA}.mastermind_players_v1 VALUES ('fixture',%s,'parent','active'),('foreign',%s,'parent','active')",(ACTOR,FOREIGN))
    def isolated(source):
        value=re.sub(r'^(?:BEGIN|COMMIT);\s*$', '',source,flags=re.MULTILINE)
        value=value.replace('public.',SCHEMA+'.').replace('search_path = public, pg_temp',f'search_path = {SCHEMA}, pg_temp')
        if re.search(r'\bpublic\b|^\s*COMMIT\b',value,re.MULTILINE): raise ValueError('Schema isolation rejected')
        return value
    basepath=ROOT/'memory-system/migrations/004_mastermind_node_exchange_v1.sql'
    base=basepath.read_text(encoding='utf-8-sig')
    # Original table constraints and active-parent lookup, excluding unrelated pairing procedures.
    foundation=base[:base.index('CREATE OR REPLACE FUNCTION public.create_mastermind_node_pairing_v1(')]
    cursor.execute(isolated(foundation))
    migrationpath=ROOT/'memory-system/migrations/021_mastermind_node_core_status_v2.sql'
    cursor.execute(isolated(migrationpath.read_text(encoding='utf-8-sig')))
    for p in [basepath,migrationpath]: receipt['sourceHashes'][p.relative_to(ROOT).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
    receipt['checks'].append('original table constraints and complete021 functions compile in PostgreSQL')
    for node,household,actor,digest in [(NODE,'fixture',ACTOR,'a'*64),(OTHER,'foreign',FOREIGN,'b'*64)]:
        cursor.execute(f'INSERT INTO {SCHEMA}.mastermind_nodes_v1(node_id,household_id,display_name,credential_sha256,agent_version,created_by_player_id) VALUES (%s,%s,%s,%s,%s,%s)',(node,household,'Disposable fixture',digest,'fixture.1',actor))
    def expected_error(code,operation):
        cursor.execute('SAVEPOINT negative_case')
        try: operation()
        except psycopg2.Error as error:
            cursor.execute('ROLLBACK TO SAVEPOINT negative_case')
            if error.pgcode != code:
                receipt['negativeFailure']={'expected':code,'actual':error.pgcode,'case':globals().get('active_case','unspecified')}
                raise AssertionError('Unexpected SQLSTATE') from None
        else: raise AssertionError('Expected SQLSTATE '+code)
        finally: cursor.execute('RELEASE SAVEPOINT negative_case')
    def exchange(version=2, changes=None, **kwargs):
        args=[kwargs.get('exchange_id',uid()),kwargs.get('digest','c'*64),kwargs.get('node',NODE),kwargs.get('credential','a'*64),BOOT,
              datetime.now(timezone.utc),'fixture.1',json.dumps({}),json.dumps(kwargs.get('receipts',[])),kwargs.get('receipt_hashes',[]),uid()]
        if version==2: args.append(json.dumps(kwargs.get('worker',WORKER)))
        for index,value in (changes or {}).items(): args[index]=value
        cursor.execute(f'SELECT * FROM {SCHEMA}.exchange_mastermind_node_v{version}('+','.join(['%s']*len(args))+')',args)
        return cursor.fetchone()
    def enqueue(core=True,changes=None,**kwargs):
        args=[kwargs.get('job',uid()),kwargs.get('digest','d'*64),kwargs.get('node',NODE),kwargs.get('household','fixture'),kwargs.get('actor',ACTOR),datetime.now(timezone.utc)+timedelta(minutes=30)]
        for index,value in (changes or {}).items(): args[index]=value
        function='enqueue_mastermind_core_status_job_v2' if core else 'enqueue_mastermind_node_job_v1'
        cursor.execute(f'SELECT * FROM {SCHEMA}.{function}('+','.join(['%s']*len(args))+')',args)
        return cursor.fetchone()
    for version in [1,2]:
        for index in range(11):
            active_case=f'exchange v{version} NULL argument{index}'
            expected_error('22023',lambda version=version,index=index: exchange(version,{index:None}))
        expected_error('22023',lambda version=version: exchange(version,{8:'[{}]',9:[None]}))
        expected_error('28000',lambda version=version: exchange(version,credential='f'*64))
        expected_error('28000',lambda version=version: exchange(version,node=uid()))
    expected_error('22023',lambda:exchange(2,{11:None}))
    for core in [False,True]:
        for index in range(6):
            active_case=f'enqueue core={core} NULL argument{index}'
            expected_error('22023',lambda core=core,index=index: enqueue(core,{index:None}))
        expected_error('42501',lambda core=core: enqueue(core,actor=FOREIGN))
        expected_error('42501',lambda core=core: enqueue(core,node=OTHER))
        expected_error('42501',lambda core=core: enqueue(core,actor=uid()))
    receipt['checks'].append('all required exchange/enqueue NULL fields rejected for v1/v2; NULL digest entries rejected; absent/mismatched credentials and parent/node identities rejected')
    for worker in [None,{'protocolVersion':1,'capabilities':[{'id':FAMILY,'version':1}]},
                   {'protocolVersion':2,'capabilities':[{'id':CORE,'version':2}]},
                   {'protocolVersion':2,'capabilities':[{'id':'shell.exec','version':1}]},
                   {'protocolVersion':2,'capabilities':[{'id':CORE,'version':1},{'id':CORE,'version':1}]}]:
        expected_error('22023',lambda worker=worker:exchange(worker=worker))
    receipt['checks'].append('v2 requires numeric protocol2 and unique known exact-version capabilities')
    cursor.execute('SAVEPOINT jobs_scenario')
    core_id=uid(); created=enqueue(job=core_id)
    assert created[0]=='applied'
    repeated=enqueue(job=core_id); assert repeated[0]=='duplicate' and repeated[3:]==created[3:]
    coalesced=enqueue(); assert coalesced[0]=='coalesced' and coalesced[1]==core_id
    assert enqueue(False,job=core_id)[0]=='conflict'
    # Old worker cannot lease a queued core-only operation.
    assert exchange(1)[4] is None
    family_id=uid(); assert enqueue(False,job=family_id,digest='e'*64)[0]=='applied'
    family_lease=exchange(1)[4]; assert family_lease['jobId']==family_id and family_lease['capability']==FAMILY
    cursor.execute(f"UPDATE {SCHEMA}.mastermind_node_jobs_v1 SET state='succeeded',terminal_code='desired-state-reached',terminal_result='{{}}',finished_at=clock_timestamp() WHERE job_id=%s",(family_id,))
    core_exchange=uid(); leased=exchange(exchange_id=core_exchange); core_lease=leased[4]
    assert core_lease['jobId']==core_id and core_lease['capability']==CORE
    assert datetime.fromisoformat(core_lease['expiresAt'].replace('Z','+00:00'))==created[4].replace(microsecond=(created[4].microsecond//1000)*1000)
    delta=datetime.fromisoformat(core_lease['leaseExpiresAt'].replace('Z','+00:00'))-datetime.fromisoformat(core_lease['leasedAt'].replace('Z','+00:00'))
    assert timedelta(0)<delta<=timedelta(seconds=30)
    assert exchange(1)[4] is None # active renewal exclusion
    assert exchange(1,exchange_id=core_exchange)[4] is None # replay exclusion
    family_only={'protocolVersion':2,'capabilities':[{'id':FAMILY,'version':1}]}
    assert exchange(worker=family_only)[4] is None
    before=core_lease['leaseId']; assert exchange()[4]['leaseId']==before
    receipt['checks'].append('queued core skips legacy; compatible family leases; legacy active/replay and unadvertised v2 core leases withheld; exact duplicate/coalesced timestamps retained; core30-second lease preserves original expiry')
    def make_receipt(lease,**changes):
        value={'receiptId':uid(),'jobId':lease['jobId'],'leaseId':lease['leaseId'],'bootId':BOOT,'commandDigest':lease['commandDigest'],
               'sequence':1,'state':'succeeded','stage':'desired-state-reached','observedAt':datetime.now(timezone.utc).isoformat(),
               'code':'desired-state-reached','retryable':False,'result':{'kind':CORE,'observedAt':datetime.now(timezone.utc).isoformat(),
               'services':{'mcpHost':'online','memory':'online','modules':'online'},'capabilities':{'count':0,'sha256':'f'*64},'activeTurns':0,'complete':True}}
        value.update(changes); return value
    success=make_receipt(core_lease); success_hash=sha(success)
    def submit(value,version=2,**kwargs): return exchange(version,receipts=[value],receipt_hashes=[sha(value)],**kwargs)
    expected_error('42501',lambda:submit(success,1)) # receipt capability exclusion
    expected_error('42501',lambda:submit(success,node=OTHER,credential='b'*64))
    expected_error('42501',lambda:submit({**success,'leaseId':uid()}))
    expected_error('42501',lambda:submit({**success,'commandDigest':'0'*64}))
    for key in ['receiptId','jobId','leaseId','bootId','sequence','commandDigest']:
        expected_error('22023',lambda key=key:submit({**success,key:None}))
    expected_error('22023',lambda:submit({**success,'result':{'familyServer':'running','companion':'running','player':'ready'}}))
    expected_error('22023',lambda:submit({**success,'state':'failed','stage':'terminal','code':'lease-lost','result':{'familyServer':'running','companion':'running','companionBridge':'ready'}}))
    outcome=submit(success); assert str(success['receiptId']) in outcome[3]
    assert outcome[4] is None
    assert str(success['receiptId']) in submit(success)[3]
    expected_error('23505',lambda:submit({**success,'code':'changed'}))
    expected_error('23505',lambda:submit(success,node=OTHER,credential='b'*64))
    expected_error('23505',lambda:submit({**success,'receiptId':uid(),'sequence':2,'state':'failed','stage':'terminal','code':'lease-lost','result':None}))
    cursor.execute(f'SELECT state,terminal_result FROM {SCHEMA}.mastermind_node_jobs_v1 WHERE job_id=%s',(core_id,))
    assert cursor.fetchone()==('succeeded',success['result'])
    receipt['checks'].append('receipt requires negotiated capability/node/lease/digest/non-null identity; result kind bound to capability; exact replay accepted; collisions/foreign replay/conflicting terminal outcome rejected')
    cursor.execute('ROLLBACK TO SAVEPOINT jobs_scenario'); cursor.execute('RELEASE SAVEPOINT jobs_scenario')
    connection.rollback()
    cursor.execute('SELECT to_regnamespace(%s)',(SCHEMA,)); assert cursor.fetchone()[0] is None
    assert public_snapshot()==original_functions
    receipt['rollbackVerified']=True; receipt['publicFunctionsUnchanged']=True; receipt['ok']=True
except Exception as error:
    receipt['ok']=False; receipt['error']={'type':type(error).__name__,'sqlstate':getattr(error,'pgcode',None),'fixtureLine':traceback.extract_tb(error.__traceback__)[-1].lineno}
finally:
    if connection:
        connection.rollback()
        try:
            with connection.cursor() as check:
                check.execute('SELECT to_regnamespace(%s)',(SCHEMA,)); receipt['rollbackVerified']=check.fetchone()[0] is None
        finally: connection.rollback(); connection.close()
    if len(sys.argv)>1: Path(sys.argv[1]).write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps(receipt,indent=2))
if not receipt['ok']: raise SystemExit(1)
