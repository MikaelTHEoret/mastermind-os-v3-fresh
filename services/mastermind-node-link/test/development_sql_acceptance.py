"""Actual031 against the existing rollback-only fake schema, never production DDL."""
def verify(ctx,parent,parent_result,old_worker,preinstalled=False):
    import copy,hashlib,json
    from datetime import datetime,timedelta,timezone
    cur,schema,uid=ctx['cursor'],ctx['SCHEMA'],ctx['uid']
    actor,node=ctx['ACTOR'],ctx['NODE']
    reject,exchange,submit=ctx['expected_error'],ctx['exchange'],ctx['submit']
    for name in ([] if preinstalled else ['029_mastermind_review_lease_bound_v1.sql','030_mastermind_review_reuse_v1.sql','031_mastermind_development_work_v1.sql']):
        path=ctx['ROOT']/'memory-system/migrations'/name
        cur.execute(ctx['isolated'](path.read_text(encoding='utf-8')))
        ctx['receipt']['sourceHashes'][path.relative_to(ctx['ROOT']).as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
    art,build='mastermind.native.review-artifacts','mastermind.native.review-build-plan'
    worker={'protocolVersion':2,'capabilities':old_worker['capabilities']+[{'id':c,'version':1} for c in ['mastermind.native.review-reuse',art,build]]}
    def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    artifact={'schemaVersion':1,'action':'prepare','taskRef':parent['taskRef'],'operationId':uid(),'parentOperationId':parent['operationId'],
        'artifactOperationId':uid(),'specificationId':parent['specificationId'],'reviewId':parent_result['reviewId']}
    content=json.loads(parent['content']) if parent['schemaVersion']==2 else parent['content'];requirement=content['requirements']
    def enqueue(v,cap=art,who=actor,computer=node):
        cur.execute(f'SELECT * FROM {schema}.enqueue_mastermind_development_job_v1('+','.join(['%s']*8)+')',
            (v['operationId'],digest(v),computer,'fixture',who,datetime.now(timezone.utc)+timedelta(minutes=30),cap,json.dumps(v)))
        return cur.fetchone()
    def authorized(v,r=None,cap=art,who=actor):
        cur.execute(f'SELECT {schema}.mastermind_development_authorized_v1(%s,%s,%s,%s,%s)',(cap,'fixture',who,json.dumps(v),None if r is None else json.dumps(r)))
        return cur.fetchone()[0]
    def art_result(v,published=False):
        return {**v,'kind':art,'artifactState':'published' if published else 'proposed','bindingSha256':'c'*64,'commit':'d'*40,'fileCount':3,
            'requirementsHash':digest(requirement),'testSpecHash':digest(requirement['tests']),'gitVerified':published,
            'gitVerifiedAt':'2026-09-16T00:00:00.000Z' if published else None,'historicalSnapshot':not published,'holds':[],
            'mayAutomaticallyRerun':False,'candidateAcceptance':'not-run','replayed':False,'executionAuthorized':False}
    for edit in [{'permit':'private'},{'action':'execute'},{'artifactOperationId':artifact['operationId']},{'parentOperationId':artifact['operationId']},{'taskRef':{**parent['taskRef'],'checkpointId':uid()}}]:
        reject('22023',lambda edit=edit:enqueue({**artifact,**edit}))
    for edit in [{'reviewId':'0'*64},{'parentOperationId':uid()},{'specificationId':'0'*64}]:
        reject('42501',lambda edit=edit:enqueue({**artifact,**edit}))
    reject('42501',lambda:enqueue(artifact,who=ctx['FOREIGN']))
    reject('42501',lambda:enqueue(artifact,computer=ctx['OTHER']))
    newnode=uid()
    cur.execute(f'INSERT INTO {schema}.mastermind_nodes_v1(node_id,household_id,display_name,credential_sha256,agent_version,created_by_player_id) VALUES (%s,%s,%s,%s,%s,%s)',(newnode,'fixture','Other owned fixture',digest(newnode),'fixture.1',actor))
    reject('42501',lambda:enqueue(artifact,computer=newnode))
    assert enqueue(artifact)[0]=='applied' and enqueue(artifact)[0]=='duplicate'
    assert enqueue({**artifact,'operationId':uid()})[0]=='busy'
    assert ctx['enqueue_catalog'](job=uid())[0]=='busy'
    assert exchange(worker=old_worker)[4] is None
    leased=exchange(worker=worker)[4];assert leased['input']==artifact
    result=art_result(artifact);receipt=ctx['make_receipt'](leased,result=result)
    for edit in [{'requirementsHash':'0'*64},{'testSpecHash':'0'*64},{'executionAuthorized':True},{'source':'private'},
                 {'artifactOperationId':uid()},{'gitVerified':True},{'candidateAcceptance':'passed'},{'fileCount':True}]:
        reject('42501',lambda edit=edit:submit({**receipt,'result':{**result,**edit}},worker=worker))
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    planned={**artifact,'action':'prepare','operationId':uid(),'buildOperationId':uid()}
    reject('42501',lambda:enqueue(planned,build))
    publish={**artifact,'action':'publish','operationId':uid()};assert enqueue(publish)[0]=='applied'
    leased=exchange(worker=worker)[4];result=art_result(publish,True);receipt=ctx['make_receipt'](leased,result=result)
    for edit in [{'bindingSha256':'0'*64},{'commit':'0'*40},{'gitVerifiedAt':'2026-02-31T00:00:00.000Z'}]:
        reject('42501',lambda edit=edit:submit({**receipt,'result':{**result,**edit}},worker=worker))
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert enqueue(planned,build)[0]=='applied' and enqueue(planned,build)[0]=='duplicate'
    leased=exchange(worker=worker)[4];assert leased['capability']==build
    binding={k:planned[k] for k in ['schemaVersion','taskRef','artifactOperationId','specificationId','reviewId']};binding['operationId']=planned['buildOperationId']
    plan={**planned,'kind':build,'requestHash':digest(binding),'planId':'e'*64,'state':'awaiting_coding_authority','holds':[],
        'current':True,'historicalSnapshot':True,'decision':content['mode'],'moduleId':requirement['moduleId'],'requirementsHash':digest(requirement),
        'jobState':'prepared','candidateId':None,'hasSourceReceipt':False,'workerInvoked':False,'replayed':False,'executionAuthorized':False}
    receipt=ctx['make_receipt'](leased,result=plan)
    for edit in [{'requestHash':'0'*64},{'moduleId':'different'},{'decision':'create' if content['mode']=='extend' else 'extend'},{'workerInvoked':True},{'holds':['NO_AUTHORITY']}]:
        reject('42501',lambda edit=edit:submit({**receipt,'result':{**plan,**edit}},worker=worker))
    cur.execute(f"UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=jsonb_set(permission_scope,'{{status}}','\"revoked\"') WHERE task_id=%s",(parent['taskRef']['taskId'],))
    assert not authorized(artifact) and not authorized(planned,plan,build)
    reject('42501',lambda:submit(receipt,worker=worker));assert exchange(worker=worker)[4] is None
    cur.execute(f'UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=%s WHERE task_id=%s',(json.dumps(ctx['scope']),parent['taskRef']['taskId']))
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert receipt['receiptId'] in submit(receipt,worker=worker)[3]
    assert authorized(planned,plan,build) and not authorized(planned,plan,build,ctx['FOREIGN'])
    reject('42501',lambda:enqueue({**planned,'operationId':uid(),'artifactOperationId':uid()},build))
    cur.execute(f'SELECT terminal_result FROM {schema}.mastermind_node_jobs_v1 WHERE job_id=%s',(parent['operationId'],));assert cur.fetchone()[0]==parent_result
    ctx['receipt']['checks'].append('031: original review preserved; exact parent/node ownership; artifact and build enqueue/lease/receipt round trip; eight-capability negotiation and old worker exclusion; source/test hashes and fixed build binding; busy/duplicate/revoked and substituted result denial; no execution grant')
    if not preinstalled and '--lossless-review' in __import__('sys').argv:
        from lossless_review_sql_acceptance import verify as verify_lossless
        verify_lossless(ctx,parent,parent_result,worker)
