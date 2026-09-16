"""Wizard cases inside catalog-sql-fixture's existing disposable transaction."""
def verify(context):
    # Reuse the fixture's fake identities, original constraints and rollback.
    import hashlib
    import json
    import re
    from datetime import datetime, timedelta, timezone
    cursor, schema = context['cursor'], context['SCHEMA']
    actor, task, node = context['ACTOR'], context['task'], context['NODE']
    uid, expected_error, exchange = (context[k] for k in ('uid','expected_error','exchange'))
    submit, make_receipt = context['submit'], context['make_receipt']
    migration = context['ROOT']/'memory-system/migrations/026_mastermind_native_specification_v1.sql'
    # Execute the application's actual history query, including before migration026.
    store_path=context['ROOT']/'src/lib/node-exchange/store.ts'
    store=store_path.read_text(encoding='utf-8').split('export async function getLatestOwnerNativeJob(',1)[1]
    history_source=re.search(r'const rows=await sql`([^`]+)`',store).group(1)
    slots=re.findall(r'\$\{([^}]+)\}',history_source)
    history_query=context['isolated'](re.sub(r'\$\{[^}]+\}','%s',history_source))
    def history(reader=actor):
        values={'nodeId':node,'taskId':task,'profile.householdId':'fixture','profile.parentPlayerId':reader,'reviewOnly':False}
        cursor.execute(history_query,[values[key] for key in slots])
        return cursor.fetchall()
    history()  # Existing installations can query history without the026 functions.
    cursor.execute(context['isolated'](migration.read_text(encoding='utf-8')))
    context['receipt']['sourceHashes'][store_path.relative_to(context['ROOT']).as_posix()] = hashlib.sha256(store_path.read_bytes()).hexdigest()
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
    assert history()==[(request['operationId'],request)]
    assert history(context['FOREIGN'])==[]
    cursor.execute(f"UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=jsonb_set(permission_scope,'{{status}}','\"revoked\"') WHERE task_id=%s",(task,))
    assert history()==[]
    cursor.execute(f'UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=%s WHERE task_id=%s',(json.dumps(context['scope']),task))
    context['receipt']['checks'].append('Actual shared-history SQL: works before026; restores original Wizard input; foreign and revoked owners receive no history')
    context['receipt']['checks'].append('026 Wizard: Unicode canonical hashes, exact intent/job binding, no caller grants, owner/current-scope checks, shared busy limit, legacy worker exclusion, revoked lease/upload/read denial, exact durable terminal replay')
    followups = context['ROOT']/'memory-system/migrations/027_mastermind_wizard_followups_v1.sql'
    cursor.execute(context['isolated'](followups.read_text(encoding='utf-8')))
    context['receipt']['sourceHashes'][followups.relative_to(context['ROOT']).as_posix()] = hashlib.sha256(followups.read_bytes()).hexdigest()
    assert authorized(request, result)  # Historical count-only receipts remain readable.
    detailed = {**result, 'specification': {**result['specification'], 'missing': ['Confirm behavior.', 'Supply tests.', 'Review existing capabilities.']}}
    assert authorized(request, detailed)
    for missing in (None, 'not a list', ['too few'], ['a', 'b', 'x'*161], ['a', 'b', 'bad\nquestion'], ['a','b',{}]):
        assert not authorized(request, {**result,'specification':{**result['specification'],'missing':missing}})
    revised = {**request, 'operationId': uid(), 'request': 'Revised inputs and expected outputs: é 💡',
               'revisionOf': {'operationId': request['operationId'], 'requestHash': digest}}
    for parent in ({'operationId':uid(),'requestHash':digest}, {'operationId':request['operationId'],'requestHash':'f'*64}):
        expected_error('42501',lambda parent=parent:enqueue({**revised,'revisionOf':parent}))
    for parent in (None, {}, {'operationId':revised['operationId'],'requestHash':digest}):
        expected_error('22023',lambda parent=parent:enqueue({**revised,'revisionOf':parent}))
    binding = {key:value for key,value in revised.items() if key!='action'}
    revised_hash=hashlib.sha256(json.dumps(binding,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    cursor.execute(f'SELECT {schema}.mastermind_specification_hash_v1(%s)',(json.dumps(revised),))
    assert cursor.fetchone()[0]==revised_hash
    assert enqueue(revised)[0]=='applied' and enqueue(revised)[0]=='duplicate'
    revised_lease=exchange(worker=worker)[4]
    revised_result={**detailed,'operationId':revised['operationId'],'requestHash':revised_hash}
    receipt=make_receipt(revised_lease,result=revised_result)
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert history()==[(revised['operationId'],revised)]
    cursor.execute(f'SELECT terminal_result FROM {schema}.mastermind_node_jobs_v1 WHERE job_id=%s',(request['operationId'],))
    assert cursor.fetchone()[0]==result
    context['receipt']['checks'].append('027: old receipts readable; bounded detailed questions; linked revision hash parity, missing/altered/self parents denied; original immutable result preserved')
    if '--review' in __import__('sys').argv:
        from review_sql_acceptance import verify as verify_review
        verify_review(context,request,result,worker,history)
