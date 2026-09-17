"""Execute all accepted profile generations and the 0.155 pin in a disposable DB."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    path = ROOT / 'scripts' / name
    module_spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module


def compose():
    runner = load('verify-coding-permissions-sql.py')
    guards = load('coding_permission_schema_guards.py')
    extension = load('coding_permission_profile_extension.py')
    checks = load('coding_permission_profile_fixture.py')
    previous = load('coding_permission_cli_update.py')
    update = load('coding_permission_cli_0155_update.py')
    fixture = json.loads((ROOT / 'test/fixtures/coding-source-permissions-v2.json').read_text(encoding='utf-8-sig'))
    base, profile, prior, updated = [(ROOT / 'migrations' / name).read_bytes() for name in (
        'task-permissions-v2.sql', 'task-permissions-v2-suppressed-profile.sql',
        'task-permissions-v2-cli-0154.sql', 'task-permissions-v2-cli-0155.sql')]
    sql = runner.compose_sql(fixture, (ROOT / 'migrations/task-permissions-v1.sql').read_text(encoding='utf-8-sig'), base.decode('utf-8'))
    addition = checks.compose(guards, extension, fixture, base, profile)
    addition = previous.insert_fixture(addition, guards, extension, checks, fixture, base, profile, prior)
    addition = update.insert_fixture(addition, guards, extension, previous, checks, fixture, base, profile, prior, updated)
    return runner, checks.insert_before_legacy_checks(sql, addition), update.UPDATE_SHA, list(checks.CONTROLS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn', required=True)
    parser.add_argument('--psql', default='psql')
    args = parser.parse_args()
    runner, sql, digest, controls = compose()
    env = runner.fixture_environment(args.dsn)
    sensitive = (args.dsn, env['PGPASSWORD'], urlsplit(args.dsn).password or '')
    try:
        result = subprocess.run([args.psql, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
            input=sql.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=60, check=False)
        record = runner.process_metadata(result.stdout, result.stderr, result.returncode, sensitive_values=sensitive)
    except subprocess.TimeoutExpired as error:
        record = runner.process_metadata(error.stdout or b'', error.stderr or b'', None,
            sensitive_values=sensitive, timed_out=True)
    record.update(sqlSha256=hashlib.sha256(sql.encode()).hexdigest(), updateSha256=digest,
        cliGenerations=['original-suppressed', '0.154', '0.155'], controlsPerGeneration=controls,
        scope='disposable-cli-0155-compatibility-rollback-only')
    print(json.dumps(record))
    return 0 if record['state'] == 'passed' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError):
        print(json.dumps({'state': 'held', 'reason': 'DISPOSABLE_CLI_0155_FIXTURE_UNAVAILABLE', 'canonicalDatabaseAccess': False}))
        raise SystemExit(1)
