"""Actual030 in the parent's disposable schema and rollback transaction."""
def verify(ctx,parent,parent_result,old_worker):
    import copy,hashlib,json
    from datetime import datetime,timedelta,timezone
    cur,schema,uid=ctx['cursor'],ctx['SCHEMA'],ctx['uid']
    actor,node=ctx['ACTOR'],ctx['NODE']
    reject,exchange,submit=ctx['expected_error'],ctx['exchange'],ctx['submit']
    for name in ['029_mastermind_review_lease_bound_v1.sql','030_mastermind_review_reuse_v1.sql']:
        path=ctx['ROOT']/'memory-system/migrations'/name
        cur.execute(ctx['isolated'](path.read_text(encoding='utf-8')))
        ctx['receipt']['sourceHashes'][path.relative_to(ctx['ROOT']).as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
    cap='mastermind.native.review-reuse'
    worker={'protocolVersion':2,'capabilities':old_worker['capabilities']+[{'id':cap,'version':1}]}
    def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    assessment={'schemaVersion':1,'action':'assess','taskRef':parent['taskRef'],'operationId':uid(),'parentOperationId':parent['operationId'],
        'specificationId':parent['specificationId'],'reviewId':parent_result['reviewId'],'acceptedSpecificationId':None,'qualificationId':None,'decisions':[]}
    def enqueue(v,who=actor,computer=node):
        cur.execute(f'SELECT * FROM {schema}.enqueue_mastermind_review_reuse_job_v1('+','.join(['%s']*7)+')',
            (v['operationId'],digest(v),computer,'fixture',who,datetime.now(timezone.utc)+timedelta(minutes=30),json.dumps(v)))
        return cur.fetchone()
    def authorized(v,r=None,who=actor):
        cur.execute(f'SELECT {schema}.mastermind_review_reuse_authorized_v1(%s,%s,%s,%s)',('fixture',who,json.dumps(v),None if r is None else json.dumps(r)))
        return cur.fetchone()[0]
    for edit in [{'source':'private'},{'action':'recover'},{'decisions':[{}]},{'acceptedSpecificationId':'f'*64}]:
        reject('22023',lambda edit=edit:enqueue({**assessment,**edit}))
    for edit in [{'reviewId':'f'*64},{'parentOperationId':uid()},{'specificationId':'f'*64}]:
        reject('42501',lambda edit=edit:enqueue({**assessment,**edit}))
    reject('42501',lambda:enqueue(assessment,who=ctx['FOREIGN']))
    reject('42501',lambda:enqueue(assessment,computer=ctx['OTHER']))
    assert enqueue(assessment)[0]=='applied' and enqueue(assessment)[0]=='duplicate'
    assert enqueue({**assessment,'operationId':uid()})[0]=='busy'
    assert ctx['enqueue_catalog'](job=uid())[0]=='busy'
    assert exchange(worker=old_worker)[4] is None
    leased=exchange(worker=worker)[4];assert leased['input']==assessment
    common={k:assessment[k] for k in ['action','taskRef','operationId','specificationId','reviewId']}
    result={**common,'kind':cap,'schemaVersion':1,'acceptedSpecificationId':'d'*64,'qualificationId':'e'*64,'candidateId':'c'*64,
        'replayed':False,'executionAuthorized':False,'differences':['acceptanceWorkflow','authority','examples','tests'],'holds':[],
        'exampleCount':8,'coveredCount':8,'suiteCaseCount':14,'existingOperationId':uid(),'existingLinkId':'f'*64}
    r=ctx['make_receipt'](leased,result=result)
    for edit in [{'candidateId':'f'*64},{'coveredCount':7},{'executionAuthorized':True},{'source':'private'},{'differences':['requirements']}]:
        reject('42501',lambda edit=edit:submit({**r,'result':{**result,**edit}},worker=worker))
    assert r['receiptId'] in submit(r,worker=worker)[3]
    assert r['receiptId'] in submit(r,worker=worker)[3]
    assert authorized(assessment,result) and not authorized(assessment,result,ctx['FOREIGN'])
    accept={**assessment,'action':'accept','operationId':result['existingOperationId'],'parentOperationId':assessment['operationId'],
        'acceptedSpecificationId':result['acceptedSpecificationId'],'qualificationId':result['qualificationId'],
        'decisions':[{'field':f,'disposition':'retain-full-suite-and-add-evidence' if f=='tests' else 'retain-accepted-baseline'} for f in result['differences']]}
    for edit in [{'qualificationId':'0'*64},{'decisions':accept['decisions'][:-1]},{'operationId':uid()},{'parentOperationId':parent['operationId']}]:
        reject('42501',lambda edit=edit:enqueue({**accept,**edit}))
    assert enqueue(accept)[0]=='applied' and enqueue(accept)[0]=='duplicate'
    leased=exchange(worker=worker)[4];assert leased['input']==accept
    linked={k:result[k] for k in ['kind','schemaVersion','taskRef','specificationId','reviewId','acceptedSpecificationId','qualificationId','candidateId','executionAuthorized']}
    linked.update(action='accept',operationId=accept['operationId'],linkId=result['existingLinkId'],replayed=True,reuseLinkAccepted=True,reviewAccepted=False)
    r=ctx['make_receipt'](leased,result=linked)
    for edit in [{'linkId':'0'*64},{'candidateId':'0'*64},{'reviewAccepted':True}]:
        reject('42501',lambda edit=edit:submit({**r,'result':{**linked,**edit}},worker=worker))
    cur.execute(f"UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=jsonb_set(permission_scope,'{{status}}','\"revoked\"') WHERE task_id=%s",(parent['taskRef']['taskId'],))
    assert not authorized(assessment,result) and not authorized(accept,linked)
    reject('42501',lambda:submit(r,worker=worker));assert exchange(worker=worker)[4] is None
    cur.execute(f'UPDATE {schema}.mastermind_context_tasks_v1 SET permission_scope=%s WHERE task_id=%s',(json.dumps(ctx['scope']),parent['taskRef']['taskId']))
    assert r['receiptId'] in submit(r,worker=worker)[3]
    assert r['receiptId'] in submit(r,worker=worker)[3]
    assert authorized(accept,linked)
    cur.execute(f'SELECT terminal_result FROM {schema}.mastermind_node_jobs_v1 WHERE job_id=%s',(parent['operationId'],))
    assert cur.fetchone()[0]==parent_result
    ctx['receipt']['checks'].append('030: assessment and existing-link recovery traverse enqueue/lease/receipt; six-capability negotiation; duplicate and busy handling; exact decisions, parent, candidate, qualification and existing link binding; revoked/foreign access denied; original review preserved')
