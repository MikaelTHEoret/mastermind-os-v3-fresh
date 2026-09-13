"""Wizard cases inside catalog-sql-fixture's existing disposable transaction."""
def verify(context):
    # Reuse the fixture's fake identities, original constraints and rollback.
    import hashlib
    import json
    from datetime import datetime, timedelta, timezone
    cursor, schema = context['cursor'], context['SCHEMA']
    actor, task, node = context['ACTOR'], context['task'], context['NODE']
    uid, expected_error, exchange = (context[k] for k in ('uid','expected_error','exchange'))
    submit, make_receipt = context['submit'], context['make_receipt']
    migration = context['ROOT']/'memory-system/migrations/026_mastermind_native_specification_v1.sql'
    cursor.execute(context['isolated'](migration.read_text(encoding='utf-8')))
    context['receipt']['sourceHashes'][migration.relative_to(context['ROOT']).as_posix()] = hashlib.sha256(migration.read_bytes()).hexdigest()
    cursor.execute(f'UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=%s WHERE task_id=%s', (json.dumps(context['scope']),task))
    cap='mastermind.native.specification'
    worker={'protocolVersion':2,'capabilities':[{'id':c,'version':1} for c in [context['CORE'],context['NATIVE'],context['CATALOG'],cap]]}
    request={'schemaVersion':1,'action':'prepare','taskRef':{'taskId':task,'project':'mastermind'},
             'operationId':uid(),'request':'Preserve accents é, emoji 💡, spaces    and "quotes"\nNext line','recipeId':None}
    def enqueue(value=None, **changes):
        value=request if value is None else value
        args=[changes.get('job',value['operationId']),context['sha'](value),changes.get('node',node),'fixture',changes.get('actor',actor),
              datetime.now(timezone.utc)+timedelta(minutes=30),json.dumps(value,ensure_ascii=False)]
        cursor.execute(f'SELECT * FROM {schema}.enqueue_mastermind_specification_job_v1('+','.join(['%s']*7)+')',args)
        return cursor.fetchone()
    def authorized(value, result=None):
        cursor.execute(f'SELECT {schema}.mastermind_specification_authorized_v1(%s,%s,%s,%s)',
                       ('fixture',actor,json.dumps(value),None if result is None else json.dumps(result)))
        return cursor.fetchone()[0]
    binding={k:v for k,v in request.items() if k!='action'}
    digest=hashlib.sha256(json.dumps(binding,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    cursor.execute(f'SELECT {schema}.mastermind_specification_hash_v1(%s)',(json.dumps(request),))
    assert cursor.fetchone()[0]==digest
    for edit in [{'action':'recover'},{'grantRef':'caller'},{'request':''},{'request':' padded '},{'request':'bad\x01'},
                 {'recipeId':'../escape'},{'taskRef':{'taskId':'generic','project':'mastermind'}},{'request':'💡'*1100}]:
        expected_error('22023',lambda edit=edit:enqueue({**request,**edit}))
    expected_error('22023',lambda:enqueue(job=uid()))
    for edit in [{'taskRef':{'taskId':uid(),'project':'mastermind'}},{'taskRef':{'taskId':task,'project':'wrong'}}]:
        expected_error('42501',lambda edit=edit:enqueue({**request,**edit}))
    expected_error('42501',lambda:enqueue(actor=context['FOREIGN']))
    expected_error('42501',lambda:enqueue(node=context['OTHER']))
    assert enqueue()[0]=='applied' and enqueue()[0]=='duplicate'
    assert enqueue({**request,'request':'Changed request'})[0]=='conflict'
    assert enqueue({**request,'operationId':uid()})[0]=='busy'
    assert context['enqueue_native']({**context['native_input'],'operationId':uid()})[0]=='busy'
    assert context['enqueue_catalog'](job=uid())[0]=='busy'
    assert exchange(worker=context['catalog_worker'])[4] is None
    assert exchange(1)[4] is None
    exchange_id=uid(); leased=exchange(worker=worker,exchange_id=exchange_id)[4]
    assert leased['jobId']==request['operationId'] and leased['input']==request
    result={'kind':cap,'ok':True,'schemaVersion':1,'taskRef':request['taskRef'],'operationId':request['operationId'],
            'requestHash':digest,'specification':{'specificationId':'a'*64,'title':'💡'*80,'decision':'create',
            'stage':'needs_specification','requirementsHash':None,'missingCount':3},'savedAt':datetime.now(timezone.utc).isoformat(),
            'replayed':False,'executionAuthorized':False}
    success=make_receipt(leased,result=result)
    for edit in [{'requestHash':'f'*64},{'operationId':uid()},{'executionAuthorized':True},{'privateSource':'private'},
                 {'savedAt':'2026-99-99T00:00:00Z'},{'specification':{**result['specification'],'stage':'specified'}},
                 {'specification':{**result['specification'],'missingCount':None}}]:
        expected_error('42501',lambda edit=edit:submit({**success,'result':{**result,**edit}},worker=worker))
    cursor.execute(f"UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=jsonb_set(permission_scope,'{{status}}','\"revoked\"') WHERE task_id=%s",(task,))
    assert not authorized(request,result)
    expected_error('42501',lambda:enqueue())
    expected_error('42501',lambda:submit(success,worker=worker))
    assert exchange(worker=worker)[4] is None
    assert exchange(worker=worker,exchange_id=exchange_id)[4] is None
    cursor.execute(f'UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=%s WHERE task_id=%s',(json.dumps(context['scope']),task))
    assert success['receiptId'] in submit(success,worker=worker)[3]
    assert success['receiptId'] in submit(success,worker=worker)[3]
    assert authorized(request,result)
    cursor.execute(f'SELECT state,terminal_result FROM {schema}.mastermind_node_jobs_v1 WHERE job_id=%s',(request['operationId'],))
    assert cursor.fetchone()==('succeeded',result)
    context['receipt']['checks'].append('026 Wizard: Unicode canonical hashes, exact intent/job binding, no caller grants, owner/current-scope checks, shared busy limit, legacy worker exclusion, revoked lease/upload/read denial, exact durable terminal replay')
