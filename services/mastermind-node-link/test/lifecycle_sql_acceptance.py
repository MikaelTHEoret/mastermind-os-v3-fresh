"""036 exercised in the existing rollback-only PostgreSQL fixture schema."""
def verify(ctx,old_worker):
 import copy,json,hashlib
 from datetime import datetime,timedelta,timezone
 cur,schema,uid=ctx['cursor'],ctx['SCHEMA'],ctx['uid'];node,actor=ctx['NODE'],ctx['ACTOR']
 canonical=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'))
 digest=lambda v:hashlib.sha256(canonical(v).encode()).hexdigest()
 def snapshot():
  cur.execute('SELECT proname,pg_get_functiondef(oid),proacl FROM pg_proc WHERE pronamespace=%s::regnamespace ORDER BY proname,oid',(schema,));return cur.fetchall()
 paths=[ctx['ROOT']/('memory-system/'+folder+'/036_mastermind_lifecycle_jobs_v1.sql') for folder in ('migrations','rollback')]
 for p in paths:ctx['receipt']['sourceHashes'][p.relative_to(ctx['ROOT']).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
 migration,undo=[ctx['isolated'](p.read_text()) for p in paths]
 before=snapshot();cur.execute(migration);after=snapshot();cur.execute(migration);assert snapshot()==after
 cur.execute(undo);assert snapshot()==before,'036 rollback changed earlier function definitions or ACLs';cur.execute(migration)
 cap='mastermind.native.contribution-lifecycle';worker=copy.deepcopy(old_worker);worker['capabilities'].append({'id':cap,'version':1})
 cur.execute(f"SELECT command_input,terminal_result FROM {schema}.mastermind_node_jobs_v1 WHERE node_id=%s AND capability='mastermind.native.contribution' AND state='succeeded' AND terminal_result->'data'->>'phase'='staged' LIMIT 1",(node,));parent,pr=cur.fetchone()
 i={'schemaVersion':1,'action':'inspect','taskRef':parent['taskRef'],'specificationId':parent['specificationId'],'importOperationId':parent['importOperationId'],'candidateId':pr['data']['candidateId'],'operation':None,'lifecycleOperationId':None,'expectedActiveRevision':None,'operationId':uid()}
 data={'operationState':'inspection','moduleId':'development.packet','version':'1.1.0','activeRevision':None,'currentlyActive':False,'activeProxyAvailable':False,'recordedOutcome':None,'test':None,'rollbackRevision':None,'rollbackAccepted':False,'holds':['NATIVE_TESTS_NOT_STARTED']}
 r={**i,'kind':cap,'observedAction':'inspect','observedAt':'2026-09-24T18:00:00.000Z','recoveryOnly':False,'data':data}
 def valid(v,result=None):
  cur.execute(f'SELECT {schema}.mastermind_lifecycle_input_valid_v1(%s)',(canonical(v),));a=cur.fetchone()[0]
  if result is None:return a
  cur.execute(f'SELECT {schema}.mastermind_lifecycle_result_valid_v1(%s,%s)',(canonical(result),canonical(v)));return a and cur.fetchone()[0]
 def auth(v,result=None,who=actor,computer=node):
  cur.execute(f'SELECT {schema}.mastermind_lifecycle_authorized_v1(%s,%s,%s,%s,%s)',('fixture',who,computer,canonical(v),None if result is None else canonical(result)));return cur.fetchone()[0]
 def enqueue(v):
  cur.execute(f'SELECT * FROM {schema}.enqueue_mastermind_lifecycle_job_v1('+','.join(['%s']*7)+')',(v['operationId'],digest(v),node,'fixture',actor,datetime.now(timezone.utc)+timedelta(minutes=30),canonical(v)));return cur.fetchone()
 assert valid(i,r) and auth(i,r)
 for key in i:
  broken=copy.deepcopy(i);del broken[key];assert not valid(broken),key
 for key in r:
  broken=copy.deepcopy(r);del broken[key];assert not valid(i,broken),key
 for changes in ({'currentlyActive':True},{'activeProxyAvailable':True},{'rollbackAccepted':True},{'holds':['PRIVATE']},{'operationState':'completed'}):assert not valid(i,{**r,'data':{**data,**changes}})
 assert not auth({**i,'candidateId':'0'*64}) and not auth(i,who=ctx['FOREIGN']) and not auth(i,computer=ctx['OTHER'])
 assert enqueue(i)[0]=='applied' and enqueue(i)[0]=='duplicate'
 assert ctx['exchange'](worker=old_worker)[4] is None
 assert enqueue({**i,'operationId':uid()})[0]=='busy'
 lease=ctx['exchange'](worker=worker)[4];assert lease['jobId']==i['operationId']
 receipt=ctx['make_receipt'](lease,result=r)
 ctx['expected_error']('42501',lambda:ctx['submit']({**receipt,'result':{**r,'data':{**data,'currentlyActive':True}}},worker=worker))
 assert receipt['receiptId'] in ctx['submit'](receipt,worker=worker)[3]
 assert receipt['receiptId'] in ctx['submit'](receipt,worker=worker)[3]
 execute={**i,'action':'execute','operation':'test','lifecycleOperationId':uid(),'operationId':uid()}
 running={**r,**execute,'observedAction':'execute','data':{**data,'operationState':'running','test':{'operationId':execute['lifecycleOperationId'],'status':'running','caseCount':25,'completedCases':3,'failedCaseId':None},'holds':[]}}
 assert valid(execute,running) and enqueue(execute)[0]=='applied'
 lease=ctx['exchange'](worker=worker)[4];rr=ctx['make_receipt'](lease,result=running);assert rr['receiptId'] in ctx['submit'](rr,worker=worker)[3]
 recover={**execute,'action':'recover','operationId':uid()};assert auth(recover)
 assert not auth({**recover,'expectedActiveRevision':'0'*64})
 ctx['expected_error']('P0001',lambda:cur.execute(undo))
 ctx['receipt']['checks'].append('036: strict lifecycle input/result, original node/owner/task/import binding, lost-reply ID binding, eleven-capability negotiation, busy exclusion, duplicate enqueue/receipts, exact prehistory rollback and history-preserving rollback refusal')
