"""Additive migration021 activation support, selected only by the canonical owner.
No import-time I/O. Prepare is read-only; apply/rollback require hash-reviewed
preimages and are never called by this module automatically.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time
import uuid

ROOT=Path(__file__).resolve().parents[3]
MIGRATION='memory-system/migrations/021_mastermind_node_core_status_v2.sql'
REVIEWED_SHA256='bfed0f212de9427eaa416335a10d1903ce7380be35e48bd38f6cbe7f24474043'
SCOPE='stargate021'
SIGNATURES=[
 'public.mastermind_node_worker_valid_v2(jsonb)',
 'public.mastermind_node_worker_supports_v2(jsonb,text,smallint)',
 'public.exchange_mastermind_node_negotiated_v2(uuid,text,uuid,text,uuid,timestamp with time zone,text,jsonb,jsonb,text[],uuid,jsonb)',
 'public.exchange_mastermind_node_v1(uuid,text,uuid,text,uuid,timestamp with time zone,text,jsonb,jsonb,text[],uuid)',
 'public.enqueue_mastermind_node_job_v1(uuid,text,uuid,text,uuid,timestamp with time zone)',
 'public.enqueue_mastermind_core_status_job_v2(uuid,text,uuid,text,uuid,timestamp with time zone)',
 'public.exchange_mastermind_node_v2(uuid,text,uuid,text,uuid,timestamp with time zone,text,jsonb,jsonb,text[],uuid,jsonb)']
LEGACY=set(SIGNATURES[3:5])
TABLES=[('mastermind_context_tasks_v1','task_id'),('mastermind_context_checkpoints_v1','checkpoint_id'),
 ('mastermind_nodes_v1','node_id'),('mastermind_node_pairings_v1','pairing_id'),('mastermind_node_jobs_v1','job_id'),
 ('mastermind_node_job_receipts_v1','receipt_id'),('mastermind_node_exchanges_v1','exchange_id')]
CONSTRAINT='mastermind_node_jobs_v1_capability_check'
MAX_ROWS_PER_TABLE=1000000
PRESERVATION_BATCH_ROWS=5000
PRESERVATION_SECONDS=45

def now():return datetime.now(timezone.utc).isoformat()
def sha(value):return hashlib.sha256(value).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)

def reviewed_migration():
    path=ROOT/MIGRATION;data=path.read_bytes()
    if sha(data)!=REVIEWED_SHA256:raise ValueError('Migration021 differs from its independently reviewed hash')
    source=data.decode('utf-8-sig')
    if not source.startswith('BEGIN;') or not source.rstrip().endswith('COMMIT;'):raise ValueError('Migration transaction boundary mismatch')
    bodies={name:sha(body.encode()) for name,body in re.findall(r'CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\([\s\S]*?\bAS \$\$([\s\S]*?)\$\$;',source)}
    if set(bodies)!={sig.split('(')[0].split('.')[1] for sig in SIGNATURES}:raise ValueError('Managed function census mismatch')
    return source,bodies

def structures(cursor,helpers):
    functions={}
    for signature in SIGNATURES:
        cursor.execute('SELECT pg_get_functiondef(p.oid),p.prosrc FROM pg_proc p WHERE p.oid=to_regprocedure(%s)',(signature,))
        row=cursor.fetchone()
        functions[signature]={'source':row[0] if row else None,'sha256':sha(row[0].encode()) if row else None,'bodySha256':sha(row[1].encode()) if row else None}
    cursor.execute("SELECT column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='mastermind_nodes_v1' AND column_name='last_worker'")
    column=[list(row) for row in cursor.fetchall()]
    cursor.execute("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.mastermind_node_jobs_v1'::regclass AND conname=%s",(CONSTRAINT,))
    row=cursor.fetchone()
    return {'functions':functions,'workerColumn':column,'jobConstraint':row[0] if row else None,'context':helpers.structures(cursor)}

def progress(cursor):
    result={};deadline=time.monotonic()+PRESERVATION_SECONDS
    for table,key in TABLES:
        # A transaction-scoped server cursor keeps old exchange history out of
        # client memory. Only bounded batches of opaque row hashes are retained.
        expression="to_jsonb(t)-'last_worker'" if table=='mastermind_nodes_v1' else 'to_jsonb(t)'
        count=0;stream=hashlib.sha256()
        with cursor.connection.cursor(name='mm_preservation_'+uuid.uuid4().hex) as census:
            census.itersize=PRESERVATION_BATCH_ROWS
            census.execute(f"SELECT {key}::text,encode(sha256(convert_to(({expression})::text,'UTF8')),'hex') FROM public.{table} t ORDER BY {key}")
            while True:
                if time.monotonic()>deadline:raise ValueError('Preservation census exceeded its total read budget')
                rows=census.fetchmany(PRESERVATION_BATCH_ROWS)
                if not rows:break
                count+=len(rows)
                if count>MAX_ROWS_PER_TABLE:raise ValueError('Preservation census exceeds the reviewed bounded row limit for '+table)
                for row in rows:stream.update(canonical(list(row)).encode()+b'\n')
        result[table]={'count':count,'rowsSha256':stream.hexdigest()}
    cursor.execute('SELECT (SELECT count(*) FROM public.harmonic_memories),(SELECT count(*) FROM public.transcript_archive),(SELECT count(*) FROM public.mirror_core_sessions)')
    result['substrateCounts']=list(cursor.fetchone())
    return result

def metadata(cursor):
    cursor.execute("""SELECT count(*),count(*) FILTER(WHERE state='active'),count(*) FILTER(WHERE state='revoked'),
      count(*) FILTER(WHERE state='active' AND last_exchange_at>clock_timestamp()-interval '30 seconds'),
      max(last_exchange_at),count(*) FILTER(WHERE to_jsonb(n)->'last_worker'->'protocolVersion'='2'::jsonb),
      count(*) FILTER(WHERE state='active' AND to_jsonb(n)->'last_worker' @> '{"protocolVersion":2,"capabilities":[{"id":"mastermind.core.status","version":1}]}'::jsonb),
      count(*) FILTER(WHERE state='active' AND last_exchange_at>clock_timestamp()-interval '30 seconds'
        AND to_jsonb(n)->'last_worker' @> '{"protocolVersion":2,"capabilities":[{"id":"mastermind.core.status","version":1}]}'::jsonb)
      FROM public.mastermind_nodes_v1 n""")
    row=cursor.fetchone();nodes=dict(zip(['total','active','revoked','online30s','latestExchangeAt','advertisedV2','activeCoreCompatible','onlineCoreCompatible'],row))
    if nodes['latestExchangeAt']:nodes['latestExchangeAt']=nodes['latestExchangeAt'].isoformat()
    cursor.execute('SELECT capability,state,count(*) FROM public.mastermind_node_jobs_v1 GROUP BY capability,state ORDER BY capability,state')
    jobs=[{'capability':cap,'state':state,'count':count} for cap,state,count in cursor.fetchall()]
    cursor.execute('SELECT state,count(*) FROM public.mastermind_node_job_receipts_v1 GROUP BY state ORDER BY state')
    receipts=[{'state':state,'count':count} for state,count in cursor.fetchall()]
    cursor.execute("SELECT count(*),count(*) FILTER(WHERE state='pending' AND expires_at>clock_timestamp()),count(*) FILTER(WHERE state='claimed') FROM public.mastermind_node_pairings_v1")
    pairings=dict(zip(['total','pendingUnexpired','claimed'],cursor.fetchone()))
    cursor.execute('SELECT count(*) FROM public.mastermind_node_exchanges_v1')
    exchanges=cursor.fetchone()[0]
    return {'nodes':nodes,'jobs':jobs,'receipts':receipts,'pairings':pairings,'exchanges':{'count':exchanges},'privateInputsReturned':False}

def precondition(snapshot):
    if any(not snapshot['functions'][sig]['source'] for sig in LEGACY):raise ValueError('Existing canonical legacy node functions are required')
    if any(snapshot['functions'][sig]['source'] for sig in SIGNATURES if sig not in LEGACY) or snapshot['workerColumn']:
        raise ValueError('Node schema already has021 structures; inspect state instead of repeating activation')
    if not snapshot['jobConstraint'] or 'mastermind.core.status' in snapshot['jobConstraint']:raise ValueError('Legacy job capability constraint preimage is not supported')
    context=snapshot['context']
    if len(context['columns'])!=6 or any(not row['source'] for row in context['functions'].values()) or not context['immutableRules']:
        raise ValueError('Accepted019/020 context protections must already be present and preserved')

def postcondition(before,after,bodies):
    if before['context']!=after['context']:raise ValueError('Canonical019/020 functions, columns or immutable rules changed')
    if after['workerColumn']!=[['last_worker','jsonb',None,'YES']]:raise ValueError('Worker advertisement column postcondition failed')
    if not after['jobConstraint'] or any(cap not in after['jobConstraint'] for cap in ['family-ecosystem.ensure-running','mastermind.core.status']):raise ValueError('Typed job constraint postcondition failed')
    for sig,value in after['functions'].items():
        if not value['source'] or value['bodySha256']!=bodies[sig.split('(')[0].split('.')[1]]:raise ValueError('Applied function body differs from reviewed migration')

def unused_node_extension(cursor):
    cursor.execute("SELECT NOT EXISTS(SELECT 1 FROM public.mastermind_node_jobs_v1 WHERE capability='mastermind.core.status') AND NOT EXISTS(SELECT 1 FROM public.mastermind_nodes_v1 n WHERE to_jsonb(n)->'last_worker' IS NOT NULL AND to_jsonb(n)->'last_worker'<>'null'::jsonb)")
    return cursor.fetchone()[0]

def run(args,helpers):
    receipt={'observedAt':now(),'scope':SCOPE,'action':args.action,'committed':False,'grantsWritten':0,'canonicalProgressWritten':0,'nodesPaired':0}
    connection=None
    try:
        source,bodies=reviewed_migration()
        migrations=[{'file':MIGRATION,'sha256':REVIEWED_SHA256}]
        code_pin=sha(Path(__file__).read_bytes())
        dsn=helpers.resolve_memory_dsn();target=helpers.dsn_fingerprint(dsn)
        connection=helpers.psycopg2.connect(dsn,connect_timeout=8)
        connection.set_session(readonly=args.action=='prepare',**({'isolation_level':'REPEATABLE READ'} if args.action=='prepare' else {}))
        cursor=connection.cursor();cursor.execute("SET LOCAL statement_timeout='15000';SET LOCAL lock_timeout='3000'")
        helpers.inspect_memory_target(cursor)
        if args.action=='prepare':
            snapshot=structures(cursor,helpers);precondition(snapshot)
            current_metadata=metadata(cursor);receipt['metadata']=current_metadata
            manifest={'schemaVersion':1,'scope':SCOPE,'createdAt':now(),'target':target,'migrations':migrations,'activationSourceSha256':code_pin,
              'preimage':snapshot,'progressObserved':progress(cursor),'metadata':current_metadata,
              'rollbackLimit':'Rollback refuses any new progress since apply, any core job, or any stored worker advertisement. Retain all history and roll forward once used.'}
            helpers.write_new(args.output,manifest)
            receipt.update(ok=True,manifestPath=str(Path(args.output).resolve()),manifestSha256=sha(Path(args.output).read_bytes()),target=target,metadata=manifest['metadata'],state='READY_FOR_REVIEW_NOT_APPLIED')
            return receipt
        manifest=helpers.read_reviewed(args.manifest,args.manifest_sha256)
        if (manifest.get('schemaVersion')!=1 or manifest.get('scope')!=SCOPE or manifest.get('target')!=target
            or manifest.get('migrations')!=migrations or manifest.get('activationSourceSha256')!=code_pin):raise ValueError('Reviewed scope, target, source or activation code mismatch')
        if Path(args.output).exists():raise ValueError('Receipt path exists; inspect the existing result')
        cursor.execute('LOCK TABLE '+','.join('public.'+table for table,_ in TABLES)+' IN ACCESS EXCLUSIVE MODE')
        current=structures(cursor,helpers);before=progress(cursor)
        if args.action=='apply':
            if current!=manifest['preimage']:raise ValueError('Reviewed structural preimage changed; no migration attempted')
            precondition(current)
            cursor.execute(re.sub(r'^(?:BEGIN|COMMIT);\s*$', '',source,flags=re.MULTILINE))
            after=structures(cursor,helpers);postcondition(current,after,bodies)
            if progress(cursor)!=before:raise ValueError('Node or canonical checkpoint/grant history changed during migration')
            if not unused_node_extension(cursor):raise ValueError('Unexpected extension data appeared during migration')
            receipt.update(manifestSha256=args.manifest_sha256,target=target,progressPreserved=before,postimage=after,migrations=migrations)
        elif args.action=='rollback':
            applied=helpers.read_reviewed(args.apply_receipt,args.receipt_sha256)
            if (applied.get('ok') is not True or applied.get('committed') is not True or applied.get('scope')!=SCOPE
                or applied.get('action')!='apply' or applied.get('manifestSha256')!=args.manifest_sha256 or applied.get('target')!=target):raise ValueError('Matching verified apply receipt required')
            if current!=applied.get('postimage') or before!=applied.get('progressPreserved') or not unused_node_extension(cursor):
                raise ValueError('Extension or canonical history changed since apply; retain history and roll forward')
            # Drop dependent wrappers before shared helpers, then restore exact old functions.
            for sig in reversed(SIGNATURES):
                original=manifest['preimage']['functions'][sig]['source']
                if original:cursor.execute(original)
                else:cursor.execute('DROP FUNCTION '+sig)
            cursor.execute('ALTER TABLE public.mastermind_node_jobs_v1 DROP CONSTRAINT '+CONSTRAINT)
            cursor.execute('ALTER TABLE public.mastermind_node_jobs_v1 ADD CONSTRAINT '+CONSTRAINT+' '+manifest['preimage']['jobConstraint'])
            cursor.execute('ALTER TABLE public.mastermind_nodes_v1 DROP COLUMN last_worker')
            if structures(cursor,helpers)!=manifest['preimage'] or progress(cursor)!=before:raise ValueError('Rollback preservation check failed')
            receipt.update(manifestSha256=args.manifest_sha256,target=target,progressPreserved=before,originalSchemaRestored=True)
        else:raise ValueError('Unsupported activation action')
        connection.commit();receipt.update(committed=True,ok=True);helpers.write_new(args.output,receipt)
        return receipt
    except Exception as error:
        receipt.update(ok=False,error={'type':type(error).__name__,'sqlstate':getattr(error,'pgcode',None),
          'message':str(error) if isinstance(error,ValueError) else 'Canonical node schema operation failed; inspect reviewed state.'})
        return receipt
    finally:
        if connection is not None:connection.rollback();connection.close()
