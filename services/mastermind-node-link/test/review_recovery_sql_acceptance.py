"""034 acceptance using synthetic identities in the rollback-only fixture."""
def verify(ctx, saved, saved_result, old_worker):
    import copy, hashlib, json
    from datetime import datetime, timedelta, timezone
    cur, schema, uid = ctx['cursor'], ctx['SCHEMA'], ctx['uid']
    reject, exchange, submit = ctx['expected_error'], ctx['exchange'], ctx['submit']
    def canonical(v): return json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    def digest(v): return hashlib.sha256(canonical(v).encode()).hexdigest()
    path = ctx['ROOT']/'memory-system/migrations/034_mastermind_review_recovery_v3.sql'
    rollback = ctx['ROOT']/'memory-system/rollback/034_mastermind_review_recovery_v3.sql'
    for p in (path, rollback):
        ctx['receipt']['sourceHashes'][p.relative_to(ctx['ROOT']).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    def snapshot():
        cur.execute("SELECT proname,pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace=%s::regnamespace ORDER BY proname,oid", (schema,))
        return cur.fetchall()
    before = snapshot()
    migration, undo = [ctx['isolated'](p.read_text(encoding='utf-8')) for p in (path, rollback)]
    cur.execute(migration); after = snapshot(); assert before != after
    cur.execute(migration); assert snapshot() == after
    cur.execute(undo); assert snapshot() == before, 'ROLLBACK_PREIMAGES_DIFFER'
    cur.execute(migration)
    worker = copy.deepcopy(old_worker)
    for cap in worker['capabilities']:
        if cap['id'] == 'mastermind.native.review': cap['version'] = 3
    cur.execute(f'SELECT {schema}.mastermind_node_worker_valid_v2(%s)', (canonical(worker),)); assert cur.fetchone()[0]
    value = {**saved, 'schemaVersion': 3, 'action': 'recover', 'operationId': uid(), 'savedOperationId': saved['operationId']}
    def valid(v):
        cur.execute(f'SELECT {schema}.mastermind_review_input_valid_v1(%s)', (canonical(v),)); return cur.fetchone()[0]
    def authorized(v, result=None):
        cur.execute(f'SELECT {schema}.mastermind_review_authorized_v1(%s,%s,%s,%s)', ('fixture',ctx['ACTOR'],canonical(v),None if result is None else canonical(result)))
        return cur.fetchone()[0]
    def enqueue(v, actor=None, node=None):
        cur.execute(f'SELECT * FROM {schema}.enqueue_mastermind_review_job_v1('+','.join(['%s']*7)+')',
            (v['operationId'],digest(v),node or ctx['NODE'],'fixture',actor or ctx['ACTOR'],datetime.now(timezone.utc)+timedelta(minutes=30),canonical(v)))
        return cur.fetchone()
    assert valid(saved) and valid(value) and authorized(value)
    for edit in [{'action':'prepare'}, {'savedOperationId':value['operationId']}, {'savedOperationId':value['parentOperationId']}, {'savedOperationId':None}, {'unexpected':True}]:
        assert not valid({**value, **edit})
    for edit in [{'savedOperationId':uid()}, {'originalRequest':'unrelated'}, {'specificationId':'0'*64}]:
        assert not authorized({**value, **edit})
    content = json.loads(saved['content']); changed = copy.deepcopy(content); changed['mode'] = 'create'
    assert not authorized({**value,'content':canonical(changed)})
    reject('42501', lambda: enqueue(value,actor=ctx['FOREIGN']))
    reject('42501', lambda: enqueue(value,node=ctx['OTHER']))
    result = {**saved_result,'operationId':value['operationId'],'replayed':True}
    assert authorized(value,result)
    assert not authorized(value,{**result,'reviewId':'0'*64})
    assert not authorized(value,{**result,'replayed':False})
    # Model a failed delivery without editing any production history. Native
    # recovery is still required; the new transport ID never authorizes prepare.
    cur.execute('SAVEPOINT original_success')
    cur.execute(f"UPDATE {schema}.mastermind_node_jobs_v1 SET state='failed',terminal_result=NULL WHERE job_id=%s", (saved['operationId'],))
    cur.execute(f'SELECT to_jsonb(j) FROM {schema}.mastermind_node_jobs_v1 j WHERE job_id=%s', (saved['operationId'],)); original = cur.fetchone()[0]
    assert authorized(value,result)
    assert enqueue(value)[0] == 'applied' and enqueue(value)[0] == 'duplicate'
    assert exchange(worker=old_worker)[4] is None
    leased = exchange(worker=worker)[4]; assert leased['input'] == value and leased['capabilityVersion'] == 3
    receipt = ctx['make_receipt'](leased,result=result)
    reject('42501', lambda: submit(receipt,worker=old_worker))
    for edit in [{'replayed':False}, {'contentSha256':'0'*64}, {'operationId':saved['operationId']}]:
        reject('42501', lambda edit=edit: submit({**receipt,'result':{**result,**edit}},worker=worker))
    cur.execute(f"UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=jsonb_set(permission_scope,'{{status}}','\"revoked\"') WHERE task_id=%s", (saved['taskRef']['taskId'],))
    assert not authorized(value)
    reject('42501',lambda:submit(receipt,worker=worker))
    cur.execute(f'UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=%s WHERE task_id=%s', (canonical(ctx['scope']),saved['taskRef']['taskId']))
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert not authorized({**value,'operationId':uid(),'savedOperationId':value['operationId']}), 'RECOVERY_CHAIN_ACCEPTED'
    cur.execute(f'SELECT to_jsonb(j) FROM {schema}.mastermind_node_jobs_v1 j WHERE job_id=%s',(saved['operationId'],)); assert cur.fetchone()[0] == original
    reject('P0001',lambda:cur.execute(undo))
    # The new successful delivery is a valid parent for the already-published
    # artifact's read-only recovery, with identical native IDs and content hashes.
    art = {'schemaVersion':1,'action':'recover','taskRef':value['taskRef'],'operationId':uid(),
        'parentOperationId':value['operationId'],'artifactOperationId':uid(),'specificationId':value['specificationId'],'reviewId':result['reviewId']}
    cur.execute(f'SELECT {schema}.mastermind_development_authorized_v1(%s,%s,%s,%s)',
        ('mastermind.native.review-artifacts','fixture',ctx['ACTOR'],canonical(art)))
    assert cur.fetchone()[0], 'RECOVERED_REVIEW_PARENT_DENIED'
    cur.execute('ROLLBACK TO SAVEPOINT original_success'); cur.execute('RELEASE SAVEPOINT original_success')
    cur.execute(f'SELECT command_input,terminal_result FROM {schema}.mastermind_node_jobs_v1 WHERE job_id=%s',(saved['operationId'],)); assert cur.fetchone() == (saved,saved_result)
    ctx['receipt']['checks'].append('034: exact saved review recovery; failed delivery/history preserved; new delivery ID; v3 negotiation and old-worker exclusion; forced replay, duplicate, foreign and revoked denial; no recovery chains; artifact recovery parent; idempotent migration and guarded exact rollback; no execution grant')
    if '--contribution' in __import__('sys').argv:
        from contribution_sql_acceptance import verify as verify_contribution
        verify_contribution(ctx,saved,worker)
