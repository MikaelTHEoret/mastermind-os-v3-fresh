"""Actual captured projectState query against disposable rows; always roll back.

Only the fixed checkpoint SELECT can execute. Its one public table is replaced by
a uniquely named pg_temp table; this fixture never applies schema migrations.
"""
import hashlib,json,os,re,sys,uuid
from datetime import datetime,timezone

def prepare(payload):
    if not isinstance(payload,dict) or set(payload)!={'schemaVersion','statement','parameters','storeSha256'} or payload['schemaVersion']!=1:raise ValueError('invalid fixture envelope')
    statement=payload['statement']
    expected='''SELECT DISTINCT ON (task_id) task_id::text AS "taskId", checkpoint_id::text AS "checkpointId",
        sequence::text, state, summary, completed_items AS "completedItems", open_items AS "openItems",
        blockers, created_at AS "createdAt" FROM public.mastermind_context_checkpoints_v1 checkpoints
        WHERE task_id = ANY($1::uuid[]) ORDER BY task_id, checkpoints.sequence DESC'''
    if not isinstance(statement,str) or len(statement)>10000 or ';' in statement or '--' in statement or '/*' in statement:raise ValueError('invalid fixture statement')
    if ' '.join(statement.split())!=' '.join(expected.split()):raise ValueError('not the exact captured checkpoint projection')
    if not re.fullmatch(r'[0-9a-f]{64}',payload['storeSha256']):raise ValueError('invalid source pin')
    if not re.match(r'^\s*SELECT DISTINCT ON \(task_id\)',statement) or re.search(r'\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|COPY|CALL|DO|WITH|UNION|JOIN)\b',statement,re.I):raise ValueError('not the checkpoint read')
    if statement.count('public.mastermind_context_checkpoints_v1')!=1 or re.findall(r'\$\d+',statement)!=['$1']:raise ValueError('invalid table or parameter')
    if not re.search(r'ORDER BY task_id, checkpoints\.sequence DESC\s*$',statement):raise ValueError('qualified numeric order required')
    if not re.search(r'FROM public\.mastermind_context_checkpoints_v1 checkpoints\s+WHERE task_id = ANY\(\$1::uuid\[\]\)',statement):raise ValueError('unexpected query shape')
    params=payload['parameters']
    if not isinstance(params,list) or len(params)!=1 or not isinstance(params[0],list) or len(params[0])!=3:raise ValueError('invalid scope')
    ids=[str(uuid.UUID(value)) for value in params[0]]
    if len(set(ids))!=3:raise ValueError('duplicate fixture task')
    return statement,ids

def run(payload):
    statement,ids=prepare(payload);name='mm_checkpoint_order_'+uuid.uuid4().hex
    import psycopg2
    from psycopg2.extras import RealDictCursor
    query=statement.replace('public.mastermind_context_checkpoints_v1','pg_temp.'+name).replace('$1','%s')
    if 'public.' in query:raise ValueError('fixture target escaped')
    prior=query.replace('ORDER BY task_id, checkpoints.sequence DESC','ORDER BY task_id, sequence DESC')
    report={'observedAt':datetime.now(timezone.utc).isoformat(),'storeSha256':payload['storeSha256'],'capturedQuerySha256':hashlib.sha256(statement.encode()).hexdigest(),'fixtureSha256':hashlib.sha256(open(__file__,'rb').read()).hexdigest(),'mode':'actual projectState SELECT; disposable pg_temp rows; transaction rollback','canonicalWrites':0,'migrationApplied':False}
    connection=psycopg2.connect(os.environ['NEON_MEMORY_DSN'],connect_timeout=8)
    try:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SET LOCAL statement_timeout='5000'; SET LOCAL lock_timeout='1000'")
            cursor.execute("SELECT to_regclass('public.harmonic_memories') IS NOT NULL AND to_regclass('public.transcript_archive') IS NOT NULL AND to_regclass('public.mirror_core_sessions') IS NOT NULL AS canonical")
            if cursor.fetchone()['canonical'] is not True:raise ValueError('canonical memory target missing')
            cursor.execute(f'CREATE TEMP TABLE {name}(task_id uuid,checkpoint_id uuid,sequence bigint,state text,summary text,completed_items jsonb,open_items jsonb,blockers jsonb,created_at timestamptz) ON COMMIT DROP')
            samples={ids[0]:[9,10,40,100],ids[1]:[9,10],ids[2]:[1,2],str(uuid.uuid4()):[999]}
            for task,sequences in samples.items():
                for seq in sequences:cursor.execute(f"INSERT INTO {name} VALUES (%s,%s,%s,'active','fixture', '[]','[]','[]','2026-01-01T00:00:00Z')",(task,str(uuid.uuid4()),seq))
            cursor.execute(query,(ids,));correct=cursor.fetchall()
            cursor.execute(prior,(ids,));old=cursor.fetchall()
            actual={row['taskId']:row['sequence'] for row in correct};old_values={row['taskId']:row['sequence'] for row in old}
            if actual!={ids[0]:'100',ids[1]:'10',ids[2]:'2'} or old_values!={ids[0]:'9',ids[1]:'9',ids[2]:'2'}:raise AssertionError('numeric regression mismatch')
            report.update(ok=True,taskCount=len(correct),insertedFixtureRows=sum(map(len,samples.values())),wireSequenceType='string',numericSequences=[actual[x] for x in ids],oldAliasSequences=[old_values[x] for x in ids],checks=['actual captured SELECT picks numeric100 rather than lexicographic9','multiple tasks each receive their own latest checkpoint','unrequested fixture task is not returned','sequence wire remains decimal string'])
        connection.rollback()
        with connection.cursor() as cursor:
            cursor.execute('SELECT to_regclass(%s)',('pg_temp.'+name,))
            if cursor.fetchone()[0] is not None:raise AssertionError('fixture table remains')
        connection.rollback();report['rollbackVerified']=True
        return report
    finally:connection.rollback();connection.close()

if __name__=='__main__':
    try:
        raw=sys.stdin.buffer.read(65537)
        if len(raw)>65536:raise ValueError('input exceeds bound')
        print(json.dumps(run(json.loads(raw))))
    except Exception as error:
        print(json.dumps({'ok':False,'canonicalWrites':0,'error':{'code':'CHECKPOINT_SQL_FIXTURE_FAILED','type':type(error).__name__,'sqlstate':getattr(error,'pgcode',None)}}));sys.exit(1)
