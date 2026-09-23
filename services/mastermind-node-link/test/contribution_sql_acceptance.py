"""035: disposable ledger acceptance. Called inside the rollback-only SQL fixture."""
def verify(ctx, saved_review, old_worker):
    import copy, hashlib, json
    from datetime import datetime, timedelta, timezone
    cur, schema, uid = ctx['cursor'], ctx['SCHEMA'], ctx['uid']
    actor, node = ctx['ACTOR'], ctx['NODE']
    reject, exchange, submit = ctx['expected_error'], ctx['exchange'], ctx['submit']
    def canonical(v): return json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    def digest(v): return hashlib.sha256(canonical(v).encode()).hexdigest()
    path=ctx['ROOT']/'memory-system/migrations/035_mastermind_contribution_jobs_v1.sql'
    rollback=ctx['ROOT']/'memory-system/rollback/035_mastermind_contribution_jobs_v1.sql'
    fixtures=ctx['ROOT']/'services/mastermind-node-link/test/contribution-receipts.json'
    for p in (path,rollback,fixtures):
        ctx['receipt']['sourceHashes'][p.relative_to(ctx['ROOT']).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
    def snapshot():
        cur.execute('SELECT proname,pg_get_functiondef(oid),proacl FROM pg_proc WHERE pronamespace=%s::regnamespace ORDER BY proname,oid',(schema,))
        return cur.fetchall()
    before=snapshot();migration,undo=[ctx['isolated'](p.read_text()) for p in (path,rollback)]
    cur.execute(migration);after=snapshot();cur.execute(migration);assert snapshot()==after
    cur.execute(undo);assert snapshot()==before,'035_ROLLBACK_PREIMAGES_DIFFER';cur.execute(migration)
    cap='mastermind.native.contribution'
    worker=copy.deepcopy(old_worker)
    worker['capabilities'].append({'id':cap,'version':1})
    def input_valid(v):
        cur.execute(f'SELECT {schema}.mastermind_contribution_input_valid_v1(%s)',(canonical(v),));return cur.fetchone()[0]
    def result_valid(r,i):
        cur.execute(f'SELECT {schema}.mastermind_contribution_result_valid_v1(%s,%s)',(canonical(r),canonical(i)));return cur.fetchone()[0]
    def authorized(i,r=None,who=actor,computer=node):
        try:
            cur.execute(f'SELECT {schema}.mastermind_contribution_authorized_v1(%s,%s,%s,%s,%s)',('fixture',who,computer,canonical(i),None if r is None else canonical(r)));return cur.fetchone()[0]
        except Exception as error:
            if hasattr(error,'diag'):
                ctx['receipt']['contributionFailure']={'message':error.diag.message_primary,'context':error.diag.context}
            raise
    def enqueue(i,who=actor,computer=node):
        cur.execute(f'SELECT * FROM {schema}.enqueue_mastermind_contribution_job_v1('+','.join(['%s']*7)+')',
            (i['operationId'],digest(i),computer,'fixture',who,datetime.now(timezone.utc)+timedelta(minutes=30),canonical(i)));return cur.fetchone()
    # Exact Python adapter -> JavaScript transport outputs, without executing any candidate.
    examples=json.loads(fixtures.read_text());assert len(examples)==4
    for pair in examples:
        i,r=pair['input'],pair['receipt'];assert input_valid(i) and result_valid(r,i)
        for key in i:
            if key not in ('snapshotId','cursor','importOperationId'):assert not input_valid({**i,key:None}),key
            missing=copy.deepcopy(i);del missing[key];assert not input_valid(missing)
        for key in r:
            missing=copy.deepcopy(r);del missing[key];assert not result_valid(missing,i)
        for edit in [{'executionAuthorized':True},{'observedAt':'2026-02-30T00:00:00.000Z'},
                     {'observedAt':'2026-09-23T00:00:60.000Z'},{'data':None},{'extra':True}]:
            assert not result_valid({**r,**edit},i),edit
    ctx['receipt']['checks'].append('035: four real Python/JavaScript transport fixture receipts; exact fields, invalid/null inputs, date normalization, forged execution and extra-field denial')
    base=examples[0]['input'];request={**base,'operationId':uid(),'taskRef':saved_review['taskRef'],'specificationId':saved_review['specificationId']}
    reply={**examples[0]['receipt'],**request}
    assert authorized(request,reply)
    assert not authorized(request,who=ctx['FOREIGN']) and not authorized(request,computer=ctx['OTHER'])
    assert not authorized({**request,'specificationId':'0'*64})
    second=uid();cur.execute(f'INSERT INTO {schema}.mastermind_nodes_v1(node_id,household_id,display_name,credential_sha256,agent_version,created_by_player_id) VALUES (%s,%s,%s,%s,%s,%s)',(second,'fixture','Other fixture computer','f'*64,'fixture.1',actor))
    assert not authorized(request,computer=second),'SAME_OWNER_WRONG_NODE_ALLOWED'
    cur.execute(f'SELECT {schema}.mastermind_node_worker_valid_v2(%s)',(canonical(worker),));assert cur.fetchone()[0]
    assert enqueue(request)[0]=='applied' and enqueue(request)[0]=='duplicate'
    assert exchange(worker=old_worker)[4] is None
    assert enqueue({**request,'operationId':uid()})[0]=='busy'
    # Every prior enqueue must respect a queued contribution on this same node.
    names={'mastermind.native.reuse':'enqueue_mastermind_native_task_job_v1','mastermind.native.catalog':'enqueue_mastermind_catalog_job_v1',
        'mastermind.native.specification':'enqueue_mastermind_specification_job_v1','mastermind.native.review':'enqueue_mastermind_review_job_v1',
        'mastermind.native.review-reuse':'enqueue_mastermind_review_reuse_job_v1',
        'mastermind.native.review-artifacts':'enqueue_mastermind_development_job_v1',
        'mastermind.native.review-build-plan':'enqueue_mastermind_development_job_v1',
        'mastermind.native.review-build-dispatch':'enqueue_mastermind_development_job_v1'}
    tested=[]
    for family,function in names.items():
        cur.execute(f"SELECT command_input FROM {schema}.mastermind_node_jobs_v1 WHERE node_id=%s AND capability=%s AND state='succeeded' ORDER BY created_at DESC LIMIT 1",(node,family));row=cur.fetchone()
        if not row:continue
        value=copy.deepcopy(row[0]);op=uid()
        if 'operationId' in value:value['operationId']=op
        args=[op,digest(value),node,'fixture',actor,datetime.now(timezone.utc)+timedelta(minutes=30)]
        if function=='enqueue_mastermind_development_job_v1':args.append(family)
        args.append(canonical(value))
        cur.execute(f'SELECT * FROM {schema}.{function}('+','.join(['%s']*len(args))+')',args)
        assert cur.fetchone()[0]=='busy',family;tested.append(family)
    assert len(tested)>=6,('INSUFFICIENT_BUSY_CASES',tested)
    lease=exchange(worker=worker)[4];assert lease['jobId']==request['operationId']
    receipt=ctx['make_receipt'](lease,result=reply)
    ctx['active_case']='035 forged success execution authority'
    reject('42501',lambda:submit({**receipt,'result':{**reply,'executionAuthorized':True}},worker=worker))
    ctx['active_case']='035 non-success must not disclose result'
    reject('42501',lambda:submit({**receipt,'state':'failed','stage':'terminal','result':reply},worker=worker))
    ctx['active_case']='035 success requires result'
    reject('42501',lambda:submit({**receipt,'result':None},worker=worker))
    cur.execute(f"UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=jsonb_set(permission_scope,'{{status}}','\"revoked\"') WHERE task_id=%s",(request['taskRef']['taskId'],))
    assert not authorized(request,reply);reject('42501',lambda:submit(receipt,worker=worker))
    assert exchange(worker=worker)[4] is None
    cur.execute(f'UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=%s WHERE task_id=%s',(canonical(ctx['scope']),request['taskRef']['taskId']))
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    reject('P0001',lambda:cur.execute(undo))
    # Stage delivered after lost reply must use the same import in recover mode.
    staged=next(x for x in examples if x['input']['action']=='stage')
    req={**staged['input'],'taskRef':request['taskRef'],'specificationId':request['specificationId'],'operationId':uid()}
    out={**staged['receipt'],**req,'recoveryOnly':True,'observedAction':'recover','data':{**staged['receipt']['data'],'replayed':True}}
    assert result_valid(out,req) and enqueue(req)[0]=='applied'
    leased=exchange(worker=worker)[4];assert leased['jobId']==req['operationId']
    delivered=ctx['make_receipt'](leased,result=out);assert delivered['receiptId'] in submit(delivered,worker=worker)[3]
    recovered={**req,'operationId':uid(),'action':'recover'};recovered_out={**out,**recovered}
    assert authorized(recovered,recovered_out)
    changed={**recovered_out,'data':{**recovered_out['data'],'sourceSha256':'0'*64}}
    assert not authorized(recovered,changed)
    assert not authorized({**recovered,'specificationId':'0'*64})
    assert not authorized(recovered,computer=second)
    assert enqueue(recovered)[0]=='applied';last=exchange(worker=worker)[4]
    received=ctx['make_receipt'](last,result=recovered_out);assert received['receiptId'] in submit(received,worker=worker)[3]
    cur.execute(f'SELECT terminal_result FROM {schema}.mastermind_node_jobs_v1 WHERE job_id=%s',(req['operationId'],));assert cur.fetchone()[0]==out
    ctx['receipt']['checks'].append('035: existing ledger, same owner/task/specification/node proof; ten-capability negotiation preserving review-v3; eight-family busy exclusion; duplicate delivery and revoked reads/receipts; recovered stage and fresh delivery preserve import/source identity; exact guarded rollback; original terminal history preserved')
