"""Lossless review v2 through actual SQL; uses the parent's rollback-only schema."""
def verify(ctx,parent,parent_result,old_worker):
    import copy,hashlib,json
    from datetime import datetime,timedelta,timezone
    cur,schema,uid=ctx['cursor'],ctx['SCHEMA'],ctx['uid']
    actor,node=ctx['ACTOR'],ctx['NODE'];reject=ctx['expected_error'];exchange=ctx['exchange'];submit=ctx['submit']
    path=ctx['ROOT']/'memory-system/migrations/032_mastermind_lossless_review_v2.sql'
    cur.execute(ctx['isolated'](path.read_text(encoding='utf-8')))
    ctx['receipt']['sourceHashes'][path.relative_to(ctx['ROOT']).as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
    canonical=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
    digest=lambda v:hashlib.sha256(canonical(v).encode()).hexdigest()
    worker=copy.deepcopy(old_worker)
    for c in worker['capabilities']:
        if c['id']=='mastermind.native.review':c['version']=2
    for version in [None,True,'2',3]:
        invalid=copy.deepcopy(worker);invalid['capabilities'][0]['version']=version
        cur.execute(f'SELECT {schema}.mastermind_node_worker_valid_v2(%s)',(json.dumps(invalid),));assert cur.fetchone()[0] is False
    invalid=copy.deepcopy(worker);del invalid['capabilities'][0]['version']
    cur.execute(f'SELECT {schema}.mastermind_node_worker_valid_v2(%s)',(json.dumps(invalid),));assert cur.fetchone()[0] is False
    content=copy.deepcopy(parent['content'])
    content['requirements']=json.loads((ctx['ROOT']/'protocol/mastermind-node-exchange/review-inventory-fixture.json').read_text(encoding='utf-8'))
    content['requirements']['taskRef']=parent['taskRef'];content['mode']='extend';content['expectedActiveRevision']='c'*64
    value={**parent,'operationId':uid(),'schemaVersion':2,'content':canonical(content)}
    def valid(v):
        cur.execute(f'SELECT {schema}.mastermind_review_input_valid_v1(%s)',(json.dumps(v,ensure_ascii=False),));return cur.fetchone()[0]
    cur.execute(f'SELECT {schema}.mastermind_review_part_text_v2(%s::jsonb,ARRAY[]::text[])',(json.dumps(value,ensure_ascii=False),))
    assert cur.fetchone()[0]==value['content'],'SQL_CANONICAL_CONTENT_DIFFERS'
    assert valid(value)
    for p in [[],['requirements'],['requirements','tests']]:
        expected=content
        for k in p:expected=expected[k]
        cur.execute(f'SELECT {schema}.mastermind_review_part_text_v2(%s,%s::text[])',(json.dumps(value,ensure_ascii=False),p))
        assert cur.fetchone()[0]==canonical(expected)
    # Both the original NUL and the distinct literal escape retain their identity.
    for example in ['\0','\\u0000','\u0001','\t','\n','\x7f','é','💡','说明']:
        sample=copy.deepcopy(content);sample['requirements']['tests']['cases'][0]['input']={'path':example}
        assert valid({**value,'content':canonical(sample)})
    for text in [value['content']+' ',value['content'].replace('"schemaVersion":1','"schemaVersion":1.0'),'{broken']:
        assert not valid({**value,'content':text})
    for field in ['moduleId','version']:
        bad=copy.deepcopy(content);bad['requirements'][field]+='\0';assert not valid({**value,'content':canonical(bad)})
    bad=copy.deepcopy(content);bad['requirements']['tests']['cases'][0]['input']={'\0':'x'};assert not valid({**value,'content':canonical(bad)})
    assert not valid({**value,'schemaVersion':'2'}) and not valid({**value,'content':'x'*24577})
    def enqueue(v,who=actor):
        cur.execute(f'SELECT * FROM {schema}.enqueue_mastermind_review_job_v1('+','.join(['%s']*7)+')',
          (v['operationId'],digest(v),node,'fixture',who,datetime.now(timezone.utc)+timedelta(minutes=30),json.dumps(v,ensure_ascii=False)))
        return cur.fetchone()
    reject('42501',lambda:enqueue(value,ctx['FOREIGN']))
    assert enqueue(value)[0]=='applied' and enqueue(value)[0]=='duplicate'
    assert enqueue({**value,'content':canonical({**content,'mode':'create'})})[0]=='conflict'
    assert exchange(worker=old_worker)[4] is None
    leased=exchange(worker=worker)[4];assert leased['input']==value and leased['capabilityVersion']==2
    assert len(canonical(leased).encode())<32768
    result={**parent_result,'operationId':value['operationId'],'contentSha256':digest(content),'reviewId':'f'*64}
    receipt=ctx['make_receipt'](leased,result=result)
    reject('42501',lambda:submit({**receipt,'result':{**result,'contentSha256':'0'*64}},worker=worker))
    reject('42501',lambda:submit(receipt,worker=old_worker))
    cur.execute(f"UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=jsonb_set(permission_scope,'{{status}}','\"revoked\"') WHERE task_id=%s",(parent['taskRef']['taskId'],))
    reject('42501',lambda:submit(receipt,worker=worker))
    cur.execute(f'UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=%s WHERE task_id=%s',(json.dumps(ctx['scope']),parent['taskRef']['taskId']))
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    # A v2 worker can still recover/lease legacy v1 reviews.
    legacy={**parent,'operationId':uid()};assert enqueue(legacy)[0]=='applied'
    leased_legacy=exchange(worker=worker)[4];assert leased_legacy['input']==legacy and leased_legacy['capabilityVersion']==1
    old_result={**parent_result,'operationId':legacy['operationId']}
    old_receipt=ctx['make_receipt'](leased_legacy,result=old_result);assert old_receipt['receiptId'] in submit(old_receipt,worker=worker)[3]
    # Source packages still check exact decoded requirement and independent-test hashes.
    art='mastermind.native.review-artifacts'
    a={'schemaVersion':1,'action':'prepare','taskRef':value['taskRef'],'operationId':uid(),'parentOperationId':value['operationId'],
       'artifactOperationId':uid(),'specificationId':value['specificationId'],'reviewId':result['reviewId']}
    out={**a,'kind':art,'artifactState':'proposed','bindingSha256':'c'*64,'commit':'d'*40,'fileCount':3,
         'requirementsHash':digest(content['requirements']),'testSpecHash':digest(content['requirements']['tests']),
         'gitVerified':False,'gitVerifiedAt':None,'historicalSnapshot':True,'holds':[],'candidateAcceptance':'not-run','mayAutomaticallyRerun':False,'replayed':False,'executionAuthorized':False}
    cur.execute(f'SELECT {schema}.mastermind_development_authorized_v1(%s,%s,%s,%s,%s)',(art,'fixture',actor,json.dumps(a),json.dumps(out)));assert cur.fetchone()[0]
    for field in ['requirementsHash','testSpecHash']:
        cur.execute(f'SELECT {schema}.mastermind_development_authorized_v1(%s,%s,%s,%s,%s)',(art,'fixture',actor,json.dumps(a),json.dumps({**out,field:'0'*64})));assert not cur.fetchone()[0]
    cur.execute(f'SELECT command_input,terminal_result FROM {schema}.mastermind_node_jobs_v1 WHERE job_id=%s',(parent['operationId'],));saved=cur.fetchone();assert saved==(parent,parent_result)
    ctx['receipt']['checks'].append('032: lossless18cases; NUL/literal/Unicode hash parity; explicit v2 lease and old-worker denial; legacy v1 recovery; duplicate/conflict/revoked denial; decoded source/test hashes; unchanged old review; no execution grant')

    from development_sql_acceptance import verify as verify_development
    review_worker={**worker,'capabilities':[c for c in worker['capabilities'] if c['id'] not in ['mastermind.native.review-reuse','mastermind.native.review-artifacts','mastermind.native.review-build-plan']]}
    verify_development(ctx,value,result,review_worker,preinstalled=True)
