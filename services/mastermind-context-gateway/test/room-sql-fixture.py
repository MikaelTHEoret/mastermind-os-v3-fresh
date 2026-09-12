"""Exercise the actual hosted room SQL in a disposable schema; always roll back.

Explicit invocation only. Receives the existing memory DSN from the approved
runner. No production table is changed and no transcript data is read.
"""
from pathlib import Path
import json, os, re, subprocess, sys, uuid
import psycopg2

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = 'mm_room_fixture_' + uuid.uuid4().hex
ACTOR, TASK = '20000000-1111-4111-8111-111111111111', '30000000-1111-4111-8111-111111111111'
SID = 'room-session-001'
receipt = {'status':'FAIL', 'productionWrites':0, 'checks':[]}
cx = None
try:
    output = subprocess.check_output(['node','--input-type=module','-e',
        "import * as s from './src/lib/chat-room/store.mjs'; console.log(JSON.stringify([s.ROOM_READ_SQL,s.ROOM_CREATE_SQL,s.ROOM_UPDATE_SQL,s.ROOM_LIST_SQL]));"],
        cwd=ROOT, text=True, timeout=15)
    queries = json.loads(output)
    assert len(queries) == 4 and all('public.' in q for q in queries)
    cx = psycopg2.connect(os.environ['NEON_MEMORY_DSN'], connect_timeout=8)
    cur = cx.cursor()
    cur.execute("SET LOCAL statement_timeout='15000'; SET LOCAL lock_timeout='3000'")
    cur.execute(f'CREATE SCHEMA {SCHEMA}')
    cur.execute(f'CREATE TABLE {SCHEMA}.owners(household_id text,actor uuid,allowed boolean)')
    cur.execute(f"INSERT INTO {SCHEMA}.owners VALUES ('fixture',%s,true)",(ACTOR,))
    cur.execute(f"CREATE FUNCTION {SCHEMA}.verify_mastermind_memory_operator_v1(text,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM {SCHEMA}.owners WHERE household_id=$1 AND actor=$2 AND allowed) $$")
    cur.execute(f'CREATE TABLE {SCHEMA}.mastermind_player_external_identities_v1(household_id text,player_id uuid,provider text,provider_subject text)')
    cur.execute(f"INSERT INTO {SCHEMA}.mastermind_player_external_identities_v1 VALUES ('fixture',%s,'clerk','user_fixture')",(ACTOR,))
    cur.execute(f'CREATE TABLE {SCHEMA}.mastermind_context_tasks_v1(task_id uuid PRIMARY KEY,project_id text,household_id text,actor_player_id uuid,state text)')
    cur.execute(f"INSERT INTO {SCHEMA}.mastermind_context_tasks_v1 VALUES (%s,'mastermind','fixture',%s,'active')",(TASK,ACTOR))
    cur.execute(f'CREATE TABLE {SCHEMA}.mirror_core_sessions(id text PRIMARY KEY,context jsonb,state jsonb,created_at timestamptz,updated_at timestamptz)')
    def run(index, params):
        sql = queries[index].replace('public.',SCHEMA+'.')
        assert 'public.' not in sql
        sql = re.sub(r'\$(\d+)',lambda m:'%(p'+m[1]+')s',sql)
        cur.execute(sql,{'p'+str(i+1):v for i,v in enumerate(params)})
        return cur.fetchall()
    args = [SID,TASK,'mastermind','fixture',ACTOR,'user_fixture']
    access = dict(householdId='fixture',actorPlayerId=ACTOR,taskId=TASK,project='mastermind')
    doc = dict(format='mastermind-chat-v1',session=SID,project='mastermind',roomAccess=access,room=dict(format='mastermind-room-v1',revision=1,participants=[dict(id='model_alpha',label='Alpha',model='fixture',transport='manual')],paused=False),transcript=[])
    assert run(0,args) == [('active',None)]
    list_args = ['room-list',*args[1:]]
    assert run(3,list_args) == [('active',None,None,None,None,None)]
    assert run(1,args+[json.dumps(doc)]) == [(SID,)]
    assert run(1,args+[json.dumps(doc)]) == []
    assert run(0,args)[0][1] == doc
    receipt['checks'].append('create/read/duplicate create preserve the same canonical document')
    cur.execute(f"UPDATE {SCHEMA}.mirror_core_sessions SET context=context||'{{\"preserved\":true}}',state=state||'{{\"other\":7}}'")
    changed = {**doc,'room':{**doc['room'],'revision':2},'transcript':[{'text':'One exact answer'}]}
    assert run(2,args+[json.dumps(changed),json.dumps(doc)]) == [(SID,)]
    assert run(2,args+[json.dumps(changed),json.dumps(doc)]) == []
    cur.execute(f'SELECT context,state FROM {SCHEMA}.mirror_core_sessions WHERE id=%s',(SID,))
    context,state = cur.fetchone()
    assert context['preserved'] is True and state['other']==7 and context['chat']==changed
    listed = run(3,list_args)
    assert len(listed)==1 and listed[0][1]==SID and listed[0][3]=='One exact answer' and listed[0][4]==doc['room']['participants'] and listed[0][5]=='false'
    receipt['checks'].append('owned list returns canonical room metadata; empty owned task returns no room')
    receipt['checks'].append('exact-document CAS rejects stale write; unrelated context and state survive')
    for wrong in ([*args[:5],'user_foreign'],[SID,TASK,'mastermind','foreign',ACTOR,'user_fixture']):
        assert run(0,wrong)==[] and run(2,wrong+[json.dumps(doc),json.dumps(changed)])==[]
        assert run(3,['room-list',*wrong[1:]])==[]
    cur.execute(f'UPDATE {SCHEMA}.owners SET allowed=false')
    assert run(0,args)==[] and run(2,args+[json.dumps(doc),json.dumps(changed)])==[]
    assert run(3,list_args)==[]
    cur.execute(f'UPDATE {SCHEMA}.owners SET allowed=true')
    cur.execute(f"UPDATE {SCHEMA}.mastermind_context_tasks_v1 SET state='completed'")
    assert run(0,args)[0][1]==changed and run(2,args+[json.dumps(doc),json.dumps(changed)])==[]
    receipt['checks'].append('foreign/unmapped/revoked identities denied; completed tasks remain read-only')
    cur.execute(f"UPDATE {SCHEMA}.mastermind_context_tasks_v1 SET state='active'")
    cur.execute(f"UPDATE {SCHEMA}.mirror_core_sessions SET context='{{\"legacy\":true}}'")
    assert run(0,args)==[('active',None)] and run(1,args+[json.dumps(doc)])==[]
    assert run(3,list_args)==[('active',None,None,None,None,None)]
    assert run(2,args+[json.dumps(doc),'null'])==[]
    receipt['checks'].append('existing foreign or legacy session identifiers cannot be adopted or overwritten')
    cx.rollback()
    cur.execute('SELECT to_regnamespace(%s)',(SCHEMA,)); assert cur.fetchone()[0] is None
    cx.rollback()
    receipt.update(status='PASS',rollbackVerified=True)
except Exception as error:
    receipt['failureType'] = type(error).__name__
finally:
    if cx:
        cx.rollback(); cx.close()
    with open(sys.argv[1],'x',encoding='utf-8') as f: json.dump(receipt,f,indent=2)
    print(json.dumps(receipt))
    if receipt['status']!='PASS': sys.exit(1)
