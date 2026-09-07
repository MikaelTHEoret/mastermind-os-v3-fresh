"""Canonical activation owner; context019/020 is the unchanged default scope.

An explicit stargate021 selection delegates only the reviewed node extension to
its sibling helper. Neither scope runs on import.

No import-time database work. The existing canonical resolver and migration files
are reused. No new ledger, task store, account binding or permission grant is created.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import psycopg2

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT.parent/'mastermind-client'))
from db_target import resolve_memory_dsn,dsn_fingerprint,inspect_memory_target

FILES=['memory-system/migrations/019_mastermind_context_owner_replay_v1.sql',
       'memory-system/migrations/020_mastermind_context_task_permissions_v1.sql']
SIGNATURES=[
 'public.append_mastermind_context_checkpoint_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb,jsonb)',
 'public.append_mastermind_context_checkpoint_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint)',
 'public.set_mastermind_context_task_permissions_v1(uuid,text,uuid,text,uuid,text,bigint,bigint,text,text)']
TABLES=['mastermind_context_tasks_v1','mastermind_context_checkpoints_v1']
COLUMNS=['permission_scope','permission_revision','permission_scope_sha256']

def now():return datetime.now(timezone.utc).isoformat()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def digest_bytes(value):return hashlib.sha256(value).hexdigest()
def digest(value):return digest_bytes(canonical(value).encode())
def write_new(path,value):
    with Path(path).open('x',encoding='utf-8') as output:json.dump(value,output,indent=2)
def read_reviewed(path,expected):
    data=Path(path).read_bytes()
    if len(data)>262144 or not expected or digest_bytes(data)!=expected:raise ValueError('Reviewed file hash mismatch')
    return json.loads(data)

def structures(cursor):
    functions={}
    for signature in SIGNATURES:
        cursor.execute('SELECT pg_get_functiondef(to_regprocedure(%s))',(signature,))
        source=cursor.fetchone()[0]
        functions[signature]={'source':source,'sha256':digest_bytes(source.encode()) if source else None}
    cursor.execute("SELECT table_name,column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(%s) AND column_name=ANY(%s) ORDER BY table_name,column_name",(TABLES,COLUMNS))
    columns=[list(row) for row in cursor.fetchall()]
    cursor.execute("SELECT rulename,md5(definition) FROM pg_rules WHERE schemaname='public' AND tablename='mastermind_context_checkpoints_v1' ORDER BY rulename")
    return {'functions':functions,'columns':columns,'immutableRules':[list(row) for row in cursor.fetchall()]}

def progress(cursor):
    result={}
    for table,id_column in [(TABLES[0],'task_id'),(TABLES[1],'checkpoint_id')]:
        cursor.execute(f"SELECT {id_column}::text,encode(sha256(convert_to((to_jsonb(t)-%s::text[])::text,'UTF8')),'hex') FROM public.{table} t ORDER BY {id_column}",(COLUMNS,))
        rows=cursor.fetchall()
        result[table]={'count':len(rows),'rowsSha256':digest(rows)}
    cursor.execute("SELECT (SELECT count(*) FROM public.harmonic_memories),(SELECT count(*) FROM public.transcript_archive),(SELECT count(*) FROM public.mirror_core_sessions)")
    result['substrateCounts']=list(cursor.fetchone())
    return result

def unused_permissions(cursor):
    cursor.execute("SELECT NOT EXISTS(SELECT 1 FROM public.mastermind_context_tasks_v1 t WHERE COALESCE((to_jsonb(t)->>'permission_revision')::bigint,0)<>0 OR to_jsonb(t)->'permission_scope' IS NOT NULL AND to_jsonb(t)->'permission_scope'<>'null'::jsonb)")
    return cursor.fetchone()[0]

def migration_sources():
    return [{'file':name,'sha256':digest_bytes((ROOT/name).read_bytes())} for name in FILES]

def run(args):
    receipt={'observedAt':now(),'action':args.action,'committed':False,'grantsWritten':0,'canonicalProgressWritten':0}
    connection=None
    try:
        dsn=resolve_memory_dsn()
        target=dsn_fingerprint(dsn)
        connection=psycopg2.connect(dsn,connect_timeout=8)
        connection.set_session(readonly=args.action=='prepare')
        cursor=connection.cursor()
        cursor.execute("SET LOCAL statement_timeout='15000';SET LOCAL lock_timeout='3000'")
        inspect_memory_target(cursor)
        if args.action=='prepare':
            manifest={'schemaVersion':1,'createdAt':now(),'target':target,'migrations':migration_sources(),
                      'preimage':structures(cursor),'progress':progress(cursor),'scope':'existing canonical context aggregate only',
                      'rollbackLimit':'Rollback requires no new canonical progress or permission grant since apply. Otherwise revoke/roll forward; never discard history.'}
            if not manifest['preimage']['functions'][SIGNATURES[0]]['source']:raise ValueError('Canonical base checkpoint function is missing')
            if manifest['preimage']['functions'][SIGNATURES[1]]['source'] or manifest['preimage']['functions'][SIGNATURES[2]]['source'] or manifest['preimage']['columns']:
                raise ValueError('This activation expects the reviewed pre-permission schema; inspect an already modified target')
            write_new(args.output,manifest)
            receipt.update(ok=True,manifestPath=str(Path(args.output).resolve()),manifestSha256=digest_bytes(Path(args.output).read_bytes()),target=target)
            return receipt
        manifest=read_reviewed(args.manifest,args.manifest_sha256)
        if manifest.get('schemaVersion')!=1 or manifest.get('target')!=target or manifest.get('migrations')!=migration_sources():
            raise ValueError('Reviewed target or migration source mismatch')
        if Path(args.output).exists():raise ValueError('Receipt path exists; inspect prior result instead of overwriting it')
        cursor.execute('LOCK TABLE public.mastermind_context_tasks_v1,public.mastermind_context_checkpoints_v1 IN ACCESS EXCLUSIVE MODE')
        before=progress(cursor)
        if before!=manifest['progress']:raise ValueError('Canonical progress or substrate counts changed; prepare and review a new manifest')
        current=structures(cursor)
        if args.action=='apply':
            if current!=manifest['preimage']:raise ValueError('Schema preimage changed; no mutation attempted')
            for migration in manifest['migrations']:
                source=(ROOT/migration['file']).read_text(encoding='utf-8-sig')
                statements=re.sub(r'^(?:BEGIN|COMMIT);\s*$', '', source, flags=re.MULTILINE)
                cursor.execute(statements)
            if progress(cursor)!=before:raise ValueError('Migration changed canonical progress or substrate counts')
            after=structures(cursor)
            if after['immutableRules']!=current['immutableRules'] or len(after['columns'])!=6 or any(not item['source'] for item in after['functions'].values()):
                raise ValueError('Canonical schema postcondition failed')
            receipt.update(manifestSha256=args.manifest_sha256,target=target,progressPreserved=before,postimage=after,migrations=manifest['migrations'])
        elif args.action=='rollback':
            applied=read_reviewed(args.apply_receipt,args.receipt_sha256)
            if (applied.get('ok') is not True or applied.get('committed') is not True or applied.get('action')!='apply'
                or applied.get('manifestSha256')!=args.manifest_sha256 or applied.get('target')!=target):
                raise ValueError('Verified apply receipt required')
            if current!=applied.get('postimage') or not unused_permissions(cursor):raise ValueError('Schema changed or a grant has been used; retain history and roll forward')
            for signature in reversed(SIGNATURES):
                original=manifest['preimage']['functions'][signature]['source']
                if original:cursor.execute(original)
                else:cursor.execute('DROP FUNCTION '+signature)
            original_columns={(row[0],row[1]) for row in manifest['preimage']['columns']}
            for table in reversed(TABLES):
                for column in COLUMNS:
                    if (table,column) not in original_columns:cursor.execute(f'ALTER TABLE public.{table} DROP COLUMN {column}')
            if structures(cursor)!=manifest['preimage'] or progress(cursor)!=before:raise ValueError('Rollback preservation check failed')
            receipt.update(manifestSha256=args.manifest_sha256,target=target,progressPreserved=before,originalSchemaRestored=True)
        connection.commit();receipt.update(committed=True,ok=True)
        write_new(args.output,receipt)
        return receipt
    except Exception as error:
        receipt.update(ok=False,error={'type':type(error).__name__,'sqlstate':getattr(error,'pgcode',None),
            'message':str(error) if isinstance(error,ValueError) else 'Canonical schema operation failed; inspect the reviewed receipt and target.'})
        return receipt
    finally:
        if connection is not None:connection.rollback();connection.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['prepare','apply','rollback'])
    parser.add_argument('--scope',choices=['context','stargate021'],default='context')
    parser.add_argument('--output',required=True)
    parser.add_argument('--manifest');parser.add_argument('--manifest-sha256')
    parser.add_argument('--apply-receipt');parser.add_argument('--receipt-sha256')
    args=parser.parse_args()
    if args.scope=='context':result=run(args)
    else:
        import importlib.util
        spec=importlib.util.spec_from_file_location('canonical_node_schema_activation',Path(__file__).with_name('canonical-node-schema-activation.py'))
        node_activation=importlib.util.module_from_spec(spec);spec.loader.exec_module(node_activation)
        result=node_activation.run(args,sys.modules[__name__])
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result.get('ok') else 1)
