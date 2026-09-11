"""Actual contribution queries against an isolated schema; always rolled back."""
from pathlib import Path
import hashlib,json,os,re,sys,uuid
import psycopg2
ROOT=Path(__file__).resolve().parents[3]
SCHEMA='mm_contribution_fixture_'+uuid.uuid4().hex
T,A,OTHER=[str(uuid.uuid4()) for _ in range(3)]
receipt={'status':'FAIL','productionWrites':0,'checks':[]}
cx=None
try:
 cx=psycopg2.connect(os.environ['NEON_MEMORY_DSN'],connect_timeout=8)
 cur=cx.cursor()
 cur.execute("SET LOCAL statement_timeout='15000'; SET LOCAL lock_timeout='3000'")
 cur.execute("SELECT to_regclass('public.mastermind_task_contributions_v1')::text")
 before=cur.fetchone()[0]
 cur.execute(f'CREATE SCHEMA {SCHEMA}')
 cur.execute(f'CREATE TABLE {SCHEMA}.owners(household_id text,actor uuid,allowed boolean)')
 cur.execute(f"INSERT INTO {SCHEMA}.owners VALUES ('fixture',%s,true)",(A,))
 cur.execute(f"CREATE FUNCTION {SCHEMA}.verify_mastermind_memory_operator_v1(text,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM {SCHEMA}.owners WHERE household_id=$1 AND actor=$2 AND allowed) $$")
 cur.execute(f'CREATE TABLE {SCHEMA}.mastermind_context_tasks_v1(task_id uuid PRIMARY KEY,project_id text,household_id text,actor_player_id uuid,state text)')
 cur.execute(f"INSERT INTO {SCHEMA}.mastermind_context_tasks_v1 VALUES (%s,'mastermind','fixture',%s,'active'),(%s,'mastermind','other',%s,'active')",(T,A,OTHER,str(uuid.uuid4())))
 migration=(ROOT/'memory-system/migrations/025_mastermind_task_contributions_v1.sql').read_text(encoding='utf-8')
 isolated=re.sub(r'^(BEGIN|COMMIT);\s*$','',migration,flags=re.M).replace('public.',SCHEMA+'.')
 assert 'public.' not in isolated and not re.search(r'^\s*COMMIT\b',isolated,re.M)
 cur.execute(isolated)
 source=(ROOT/'src/lib/delegation/store.mjs').read_text(encoding='utf-8')
 queries=re.findall(r'this\.query\(\x60([\s\S]*?)\x60',source)
 assert len(queries)==5
 def run(index,params):
  sql=queries[index].replace('public.',SCHEMA+'.')
  sql=re.sub(r'\$(\d+)',lambda m:'%(p'+m[1]+')s',sql)
  cur.execute(sql,{'p'+str(i+1):v for i,v in enumerate(params)})
  return cur.fetchall()
 ref=[T,'mastermind','fixture',A]
 def insert(kind,op,aid,parent=None,task=T):
  doc={'schemaVersion':1,'kind':kind,'operationId':op,'taskRef':{'taskId':task,'project':'mastermind'}}
  return run(3,[task,'mastermind','fixture',A,aid,kind,op,parent,json.dumps(doc),'assignment' if kind=='response' else 'response'])
 op=str(uuid.uuid4());aid='a'*64
 assert len(insert('assignment',op,aid))==1
 assert insert('assignment',op,aid)==[]
 assert len(run(4,[*ref,'assignment',op]))==1
 receipt['checks'].append('same-operation insert is idempotent')
 assert insert('assignment',op,'b'*64)==[]
 assert run(4,[*ref,'assignment',op])[0][0]==aid
 receipt['checks'].append('changed operation binding retains original artifact')
 assert insert('response',str(uuid.uuid4()),'b'*64,'c'*64)==[]
 assert len(insert('response',str(uuid.uuid4()),'b'*64,aid))==1
 assert insert('review',str(uuid.uuid4()),'c'*64,aid)==[]
 assert len(insert('review',str(uuid.uuid4()),'c'*64,'b'*64))==1
 receipt['checks'].append('parent presence and kind checked by actual insertion query')
 assert run(2,[T,'mastermind','foreign',A])==[]
 cur.execute(f'UPDATE {SCHEMA}.owners SET allowed=false')
 assert run(0,[*ref,False])==[] and run(1,[*ref,aid])==[] and run(2,ref)==[]
 assert insert('assignment',str(uuid.uuid4()),'d'*64)==[]
 cur.execute(f'UPDATE {SCHEMA}.owners SET allowed=true')
 cur.execute(f"UPDATE {SCHEMA}.mastermind_context_tasks_v1 SET state='completed' WHERE task_id=%s",(T,))
 assert run(0,[*ref,True])==[] and len(run(0,[*ref,False]))==1
 assert insert('assignment',str(uuid.uuid4()),'d'*64)==[]
 cur.execute(f"UPDATE {SCHEMA}.mastermind_context_tasks_v1 SET state='active' WHERE task_id=%s",(T,))
 receipt['checks'].append('foreign/revoked owners denied; completed tasks read-only')
 def rejected(statement):
  cur.execute('SAVEPOINT negative')
  try:cur.execute(statement)
  except psycopg2.Error as e:
   cur.execute('ROLLBACK TO SAVEPOINT negative')
   assert e.pgcode=='P0001'
  else:raise AssertionError('immutable write succeeded')
 for action in ('UPDATE '+SCHEMA+".mastermind_task_contributions_v1 SET kind='assignment'",'DELETE FROM '+SCHEMA+'.mastermind_task_contributions_v1','TRUNCATE '+SCHEMA+'.mastermind_task_contributions_v1'):rejected(action)
 receipt['checks'].append('update/delete/truncate cannot erase originals')
 for i in range(61):
  assert len(insert('assignment',str(uuid.uuid4()),hashlib.sha256(str(i).encode()).hexdigest()))==1
 assert insert('assignment',str(uuid.uuid4()),'d'*64)==[]
 assert len(run(2,ref))==64
 receipt['checks'].append('64 unique bounded slots preserve readable complete history')
 cx.rollback()
 cur.execute('SELECT to_regnamespace(%s)',(SCHEMA,));assert cur.fetchone()[0] is None
 cur.execute("SELECT to_regclass('public.mastermind_task_contributions_v1')::text");assert cur.fetchone()[0]==before
 receipt.update(status='PASS',rollbackVerified=True,publicTableUnchanged=True,sourceHashes={'migration':hashlib.sha256(migration.encode()).hexdigest(),'store':hashlib.sha256(source.encode()).hexdigest()})
except Exception as error:
 if cx:cx.rollback()
 receipt['errorType']=type(error).__name__
 # No database messages, credentials or server details are printed.
finally:
 if cx:cx.close()
 output=Path(sys.argv[1]);output.parent.mkdir(parents=True,exist_ok=True)
 with output.open('x',encoding='utf-8') as f:json.dump(receipt,f,indent=2)
 print(json.dumps(receipt))
sys.exit(0 if receipt['status']=='PASS' else 1)
