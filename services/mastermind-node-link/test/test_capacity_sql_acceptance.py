"""037: bounded validators and history-aware rollback in the disposable schema."""
def verify(ctx):
 import copy,hashlib,json
 cur,schema=ctx['cursor'],ctx['SCHEMA']
 def snapshot():
  cur.execute('SELECT proname,pg_get_functiondef(oid),proacl FROM pg_proc WHERE pronamespace=%s::regnamespace ORDER BY proname,oid',(schema,));return cur.fetchall()
 paths=[ctx['ROOT']/('memory-system/'+folder+'/037_mastermind_native_test_capacity_v1.sql') for folder in ('migrations','rollback')]
 fixtures=ctx['ROOT']/'services/mastermind-node-link/test/test-capacity-fixtures.json'
 for p in paths+[fixtures]:ctx['receipt']['sourceHashes'][p.relative_to(ctx['ROOT']).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
 apply,undo=[ctx['isolated'](p.read_text()) for p in paths]
 before=snapshot();cur.execute(apply);after=snapshot();cur.execute(apply);assert snapshot()==after
 cur.execute(undo);assert snapshot()==before,'037 rollback changed function definitions/ACLs';cur.execute(apply)
 def valid(fn,*args):
  cur.execute(f'SELECT {schema}.{fn}('+','.join(['%s']*len(args))+')',tuple(json.dumps(a) for a in args));return cur.fetchone()[0]
 f=json.loads(fixtures.read_text())
 for row in f['reviews']:
  assert valid('mastermind_review_input_valid_v1',row['input'])==row['valid'],('review',row['name'])
 for row in f['reuse']:
  assert valid('mastermind_review_reuse_result_valid_v1',row['result'],row['input'])==row['valid'],('reuse',row['name'])
 for row in f['lifecycle']:
  assert valid('mastermind_lifecycle_result_valid_v1',row['result'],row['input'])==row['valid'],('lifecycle',row['name'])
 # Old histories still read and downgrade exactly; new histories forbid downgrade.
 for kind,rows in [('mastermind.native.review',f['reviews']),('mastermind.native.review-reuse',f['reuse']),('mastermind.native.contribution-lifecycle',f['lifecycle'])]:
  row=next(r for r in rows if r['name']=='count-39')
  cur.execute('SAVEPOINT capacity_history')
  # This is a rollback-guard fixture; the earlier suite has no review-reuse job.
  # Temporarily turn a synthetic terminal row into each supported history shape.
  cur.execute(f"SELECT job_id FROM {schema}.mastermind_node_jobs_v1 WHERE state='succeeded' LIMIT 1");job=cur.fetchone();assert job
  bound=copy.deepcopy(row['input']);bound['operationId']=str(job[0])
  if kind=='mastermind.native.review':
   cur.execute(f'UPDATE {schema}.mastermind_node_jobs_v1 SET capability=%s,command_input=%s::jsonb,capability_version=2 WHERE job_id=%s',(kind,json.dumps(bound),job[0]))
  else:
   result=copy.deepcopy(row['result']);result['operationId']=str(job[0])
   cur.execute(f'UPDATE {schema}.mastermind_node_jobs_v1 SET capability=%s,capability_version=1,command_input=%s::jsonb,terminal_result=%s::jsonb WHERE job_id=%s',(kind,json.dumps(bound),json.dumps(result),job[0]))
  ctx['expected_error']('P0001',lambda:cur.execute(undo))
  cur.execute('ROLLBACK TO SAVEPOINT capacity_history')
 cur.execute('SAVEPOINT capacity_pending')
 cur.execute(f"UPDATE {schema}.mastermind_node_jobs_v1 SET state='queued',lease_id=NULL,leased_at=NULL,lease_expires_at=NULL,terminal_code=NULL,terminal_result=NULL,finished_at=NULL WHERE job_id=(SELECT job_id FROM {schema}.mastermind_node_jobs_v1 WHERE capability='mastermind.native.contribution-lifecycle' LIMIT 1)")
 ctx['expected_error']('P0001',lambda:cur.execute(undo));cur.execute('ROLLBACK TO SAVEPOINT capacity_pending')
 assert snapshot()==after
 ctx['receipt']['checks'].append('037: review/reuse/lifecycle25/26/39/64/65 boundaries, integer/type checks, byte limits preserved, prior function ACLs/history retained, idempotent upgrade, exact prehistory downgrade, three expanded-history downgrade refusals and in-flight drain refusal')
