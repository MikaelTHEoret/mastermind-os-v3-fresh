"""Actual028 in the existing fake schema, with the parent's transaction rollback."""
def verify(context,parent,parent_result,old_worker,history):
    import copy, hashlib, json
    from datetime import datetime,timedelta,timezone
    cursor,schema=context['cursor'],context['SCHEMA']
    actor,node,uid=context['ACTOR'],context['NODE'],context['uid']
    task=parent['taskRef']; expected_error=context['expected_error']; exchange=context['exchange']; submit=context['submit']
    path=context['ROOT']/'memory-system/migrations/028_mastermind_native_review_v1.sql'
    cursor.execute(context['isolated'](path.read_text(encoding='utf-8')))
    context['receipt']['sourceHashes'][path.relative_to(context['ROOT']).as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
    cap='mastermind.native.review'; worker={'protocolVersion':2,'capabilities':old_worker['capabilities']+[{'id':cap,'version':1}]}
    def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    sid=parent_result['specification']['specificationId']
    content={'schemaVersion':1,'specificationId':sid,'requestSha256':digest(parent['request']),'mode':'create','expectedActiveRevision':None,'reuseEvidence':None,
      'requirements':{'schemaVersion':1,'kind':'mastermind.module-requirements','moduleId':'fixture','version':'1.0.0','taskRef':task,
      'requirements':['Preserve exact supplied text.'],'contracts':[{'name':'fixture.echo','effectClass':'READ_ONLY','inputSchema':{'type':'object'},'outputSchema':{'type':'object'}}],
      'tests':{'schemaVersion':1,'cases':[{'id':'echo','capability':'fixture.echo','input':{'é':'💡'},'expected':{'é':'💡'}}]}},
      'coverage':[{'start':0,'end':len(parent['request']),'text':parent['request'],'requirements':[0],'status':'covered'}]}
    if '--review-reuse' in __import__('sys').argv:
      content.update(mode='reuse',expectedActiveRevision='c'*64)
    value={'schemaVersion':1,'action':'prepare','taskRef':task,'operationId':uid(),'specificationId':sid,'parentOperationId':parent['operationId'],'originalRequest':parent['request'],'content':content}
    def enqueue(v=value,who=actor,computer=node):
      cursor.execute(f'SELECT * FROM {schema}.enqueue_mastermind_review_job_v1('+','.join(['%s']*7)+')',
        (v['operationId'],digest(v),computer,'fixture',who,datetime.now(timezone.utc)+timedelta(minutes=30),json.dumps(v,ensure_ascii=False)))
      return cursor.fetchone()
    def authorized(v=value,result=None,who=actor):
      cursor.execute(f'SELECT {schema}.mastermind_review_authorized_v1(%s,%s,%s,%s)',('fixture',who,json.dumps(v),None if result is None else json.dumps(result)))
      return cursor.fetchone()[0]
    for raw in [content,{'\ue000':2,'\U00010000':1}, {'quotes':'"\n\t é 💡','nested':[True,None,9007199254740991]}]:
      cursor.execute(f'SELECT {schema}.mastermind_review_canonical_v1(%s)',(json.dumps(raw),))
      assert cursor.fetchone()[0]==json.dumps(raw,sort_keys=True,separators=(',',':'),ensure_ascii=False)
    for edit in [{'source':{}},{'accepted':True},{'action':'recover'},{'operationId':value['parentOperationId']},
      {'content':{**content,'requestSha256':'bad'}},{'content':{**content,'source':{}}}]:
      expected_error('22023',lambda edit=edit:enqueue({**value,**edit}))
    for edit in [{'originalRequest':'Changed request'},{'parentOperationId':uid()},{'specificationId':'f'*64,'content':{**content,'specificationId':'f'*64}},
      {'content':{**content,'requestSha256':'f'*64}}]:expected_error('42501',lambda edit=edit:enqueue({**value,**edit}))
    expected_error('42501',lambda:enqueue(who=context['FOREIGN']))
    expected_error('42501',lambda:enqueue(computer=context['OTHER']))
    assert enqueue()[0]=='applied' and enqueue()[0]=='duplicate'
    assert enqueue({**value,'content':{**content,'mode':'extend'}})[0]=='conflict'
    assert context['enqueue_native']({**context['native_input'],'operationId':uid()})[0]=='busy'
    assert context['enqueue_catalog'](job=uid())[0]=='busy'
    assert enqueue({**value,'operationId':uid()})[0]=='busy'
    assert exchange(worker=old_worker)[4] is None
    leased=exchange(worker=worker)[4];assert leased['input']==value
    result={'kind':cap,'ok':True,'schemaVersion':1,'taskRef':task,'operationId':value['operationId'],'specificationId':sid,
      'contentSha256':digest(content),'reviewId':'b'*64,'state':'proposed','holds':[],'replayed':False,'accepted':False,'executionAuthorized':False}
    receipt=context['make_receipt'](leased,result=result)
    for edit in [{'contentSha256':'f'*64},{'accepted':True},{'executionAuthorized':True},{'source':'private'},
      {'operationId':uid()},{'state':'held'},{'holds':['INVALID']}]:
      expected_error('42501',lambda edit=edit:submit({**receipt,'result':{**result,**edit}},worker=worker))
    cursor.execute(f"UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=jsonb_set(permission_scope,'{{status}}','\"revoked\"') WHERE task_id=%s",(task['taskId'],))
    assert not authorized() and not authorized(result=result)
    expected_error('42501',lambda:submit(receipt,worker=worker));assert exchange(worker=worker)[4] is None;assert history()==[]
    cursor.execute(f'UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=%s WHERE task_id=%s',(json.dumps(context['scope']),task['taskId']))
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert authorized(result=result) and not authorized(result=result,who=context['FOREIGN'])
    assert history()==[(value['operationId'],value)]
    cursor.execute(f'SELECT terminal_result FROM {schema}.mastermind_node_jobs_v1 WHERE job_id=%s',(parent['operationId'],));assert cursor.fetchone()[0]==parent_result
    context['receipt']['checks'].append('028: actual enqueue/lease/receipt/history; exact parent, Unicode content hash, unchanged Wizard history, duplicate/conflict/busy, old worker exclusion, revoked/foreign reads and receipts denied; no execution approval')
    if '--review-reuse' in __import__('sys').argv:
      from review_reuse_sql_acceptance import verify as verify_reuse
      verify_reuse(context,value,result,worker)
