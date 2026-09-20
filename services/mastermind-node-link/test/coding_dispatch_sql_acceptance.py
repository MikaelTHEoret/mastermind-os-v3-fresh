"""033 acceptance in the rollback-only fixture; no production schema changes."""
def verify(ctx, planned, plan, old_worker):
    import hashlib, json
    from datetime import datetime, timedelta, timezone
    cur, schema, uid = ctx['cursor'], ctx['SCHEMA'], ctx['uid']
    actor, node = ctx['ACTOR'], ctx['NODE']
    reject, exchange, submit = ctx['expected_error'], ctx['exchange'], ctx['submit']
    path = ctx['ROOT']/'memory-system/migrations/033_mastermind_coding_handoff_v1.sql'
    cur.execute(ctx['isolated'](path.read_text(encoding='utf-8')))
    ctx['receipt']['sourceHashes'][path.relative_to(ctx['ROOT']).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    cap = 'mastermind.native.review-build-dispatch'
    worker = {**old_worker, 'capabilities': old_worker['capabilities']+[{'id': cap, 'version': 1}]}
    request = {**planned, 'action': 'preflight', 'operationId': uid(), 'planId': plan['planId']}

    def enqueue(v, who=actor, computer=node):
        digest = hashlib.sha256(json.dumps(v, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        cur.execute(f'SELECT * FROM {schema}.enqueue_mastermind_development_job_v1('+','.join(['%s']*8)+')',
            (v['operationId'], digest, computer, 'fixture', who, datetime.now(timezone.utc)+timedelta(minutes=30), cap, json.dumps(v)))
        return cur.fetchone()

    def valid(v, i=request):
        cur.execute(f'SELECT {schema}.mastermind_build_dispatch_result_valid_v1(%s,%s)', (json.dumps(v),json.dumps(i)))
        return cur.fetchone()[0]

    def result(v, **changes):
        return {**v, 'kind': cap, 'observedAction': v['action'], 'recoveryOnly': False,
            'ok': False, 'state': 'held', 'holds': ['BUILD_DISTINCT_CODING_AUTHORITY_REQUIRED'],
            'candidateId': None, 'sourceReady': False, 'replayed': False, 'startAccepted': False,
            'historicalSnapshot': True, 'mayAutomaticallyRerun': False, 'executionAuthorized': False, **changes}

    for key in request:
        reject('22023', lambda key=key: enqueue({**request, key: None}))
    for edit in [{'taskRef': {**request['taskRef'], 'checkpointId': uid()}}, {'grant': {}}, {'action': 'stage'}, {'buildOperationId': request['operationId']}]:
        reject('22023', lambda edit=edit: enqueue({**request, **edit}))
    for key in ['planId', 'specificationId', 'reviewId']:
        reject('42501', lambda key=key: enqueue({**request, key: '0'*64}))
    reject('42501', lambda: enqueue(request, who=ctx['FOREIGN']))
    reject('42501', lambda: enqueue(request, computer=ctx['OTHER']))
    assert enqueue(request)[0] == 'applied' and enqueue(request)[0] == 'duplicate'
    assert enqueue({**request, 'operationId': uid()})[0] == 'busy'
    assert ctx['enqueue_catalog'](job=uid())[0] == 'busy'
    assert exchange(worker=old_worker)[4] is None
    leased = exchange(worker=worker)[4]
    assert leased['input'] == request and leased['capability'] == cap
    out = result(request)
    assert valid(out) is True
    for key in out:
        if key != 'candidateId':
            assert valid({**out, key: None}) is False, key
    for edit in [{'source': 'private'}, {'sourceReady': True}, {'startAccepted': True},
                 {'observedAction': 'recover'}, {'holds': ['BAD', 'BAD']}, {'holds': ['private/path']},
                 {'candidateId': 'bad'}, {'historicalSnapshot': False}, {'executionAuthorized': True}]:
        assert valid({**out, **edit}) is False
    receipt = ctx['make_receipt'](leased, result=out)
    reject('42501', lambda: submit({**receipt, 'result': {**out, 'planId': '0'*64}}, worker=worker))
    task = request['taskRef']['taskId']
    cur.execute(f"UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=jsonb_set(permission_scope,'{{status}}','\"revoked\"') WHERE task_id=%s", (task,))
    reject('42501', lambda: submit(receipt, worker=worker))
    assert exchange(worker=worker)[4] is None
    cur.execute(f'UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=%s WHERE task_id=%s', (json.dumps(ctx['scope']), task))
    assert receipt['receiptId'] in submit(receipt, worker=worker)[3]
    assert receipt['receiptId'] in submit(receipt, worker=worker)[3]
    # A later explicit start retains the saved build ID; transport success only
    # records local acceptance, not source completion or candidate acceptance.
    start = {**request, 'action': 'start', 'operationId': uid()}
    assert enqueue(start)[0] == 'applied'
    leased = exchange(worker=worker)[4]
    started = result(start, ok=True, state='started', holds=[], startAccepted=True)
    assert valid(started, start) is True
    recovered = {**started, 'recoveryOnly': True, 'observedAction': 'recover', 'startAccepted': False,
                 'state': 'awaiting_independent_tests', 'sourceReady': True, 'candidateId': 'f'*64, 'replayed': True}
    assert valid(recovered, start) is True
    assert valid({**recovered, 'startAccepted': True}, start) is False
    receipt = ctx['make_receipt'](leased, result=recovered)
    assert receipt['receiptId'] in submit(receipt, worker=worker)[3]
    cur.execute(f'SELECT terminal_result FROM {schema}.mastermind_node_jobs_v1 WHERE job_id=%s', (planned['operationId'],))
    assert cur.fetchone()[0] == plan
    ctx['receipt']['checks'].append('033: nine-capability negotiation; old-worker exclusion; exact saved plan/owner/node; held and recovered-start receipts; null and forged-result denial; busy, duplicate and revoked access; original plan preserved; no model or activation')
