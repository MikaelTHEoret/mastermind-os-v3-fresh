"""Run both accepted scope fixtures plus the new pin only in an empty local fixture DB."""
import argparse,hashlib,importlib.util,json,subprocess
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[1]
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/name)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--dsn',required=True)
    args=parser.parse_args()
    runner=load('verify-coding-permissions-sql.py');guards=load('coding_permission_schema_guards.py')
    extension=load('coding_permission_profile_extension.py');checks=load('coding_permission_profile_fixture.py')
    update=load('coding_permission_cli_update.py')
    env=runner.fixture_environment(args.dsn)
    fixture=json.loads((ROOT/'test/fixtures/coding-source-permissions-v2.json').read_text(encoding='utf-8-sig'))
    base=(ROOT/'migrations/task-permissions-v2.sql').read_bytes()
    prior=(ROOT/'migrations/task-permissions-v2-suppressed-profile.sql').read_bytes()
    updated=(ROOT/'migrations/task-permissions-v2-cli-0154.sql').read_bytes()
    sql=runner.compose_sql(fixture,(ROOT/'migrations/task-permissions-v1.sql').read_text(encoding='utf-8-sig'),base.decode('utf-8'))
    added=checks.compose(guards,extension,fixture,base,prior)
    added=update.insert_fixture(added,guards,extension,checks,fixture,base,prior,updated)
    sql=checks.insert_before_legacy_checks(sql,added)
    result=subprocess.run(['psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],input=sql.encode(),
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=60,check=False)
    record=runner.process_metadata(result.stdout,result.stderr,result.returncode,
        sensitive_values=(args.dsn,env['PGPASSWORD'],urlsplit(args.dsn).password or ''))
    record.update(sqlSha256=hashlib.sha256(sql.encode()).hexdigest(),updateSha256=update.UPDATE_SHA,
        newCliControls=checks.CONTROLS,scope='disposable-cli-compatibility-rollback-only')
    print(json.dumps(record));return 0 if record['state']=='passed' else 1

if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,OSError,subprocess.TimeoutExpired):
        print(json.dumps({'state':'held','reason':'DISPOSABLE_CLI_FIXTURE_UNAVAILABLE','canonicalDatabaseAccess':False}));raise SystemExit(1)
