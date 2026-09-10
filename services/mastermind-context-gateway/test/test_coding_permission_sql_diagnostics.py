"""Pure SQL-runner diagnostic fixtures; no subprocess, database or environment."""
import hashlib
import importlib.util
from pathlib import Path
import unittest


SPEC=importlib.util.spec_from_file_location('coding_permission_sql_fixture',
    Path(__file__).resolve().parents[1]/'scripts'/'verify-coding-permissions-sql.py')
runner=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class SqlFailureDiagnostics(unittest.TestCase):
    def test_failed_assertion_remains_readable_and_hashes_cover_all_bytes(self):
        raw=b'ERROR: Historical operation rebound\nCONTEXT: PL/pgSQL function inline_code_block line 91\n'
        value=runner.process_metadata(b'',raw,3)
        self.assertEqual(value['state'],'failed');self.assertEqual(value['returncode'],3)
        self.assertIn('Historical operation rebound',value['failureDiagnostic']['message'])
        self.assertEqual(value['stderrSha256'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(value['stderrBytes'],len(raw))

    def test_explicit_connection_and_password_are_redacted(self):
        secret='synthetic-sensitive-marker';dsn='postgresql://fixture:'+secret+'@127.0.0.1/fixture'
        raw=('ERROR: connection '+dsn+' password '+secret+' rejected').encode()
        value=runner.failure_diagnostic(raw,(dsn,secret))
        self.assertTrue(value['redacted']);self.assertNotIn(secret,value['message']);self.assertNotIn(dsn,value['message'])
        self.assertIn('ERROR:',value['message'])

    def test_unknown_connection_uri_is_redacted_without_echoing_config(self):
        raw=b'ERROR: postgresql://different:marker@example.invalid/data was refused\n'
        for protected in ((),('e',)):
            value=runner.failure_diagnostic(raw,protected)
            self.assertNotIn('different:marker',value['message']);self.assertNotIn('example.invalid',value['message'])
            self.assertNotIn('://',value['message']);self.assertTrue(value['redacted'])

    def test_redaction_precedes_truncation_when_secret_straddles_limit(self):
        secret='synthetic-secret-across-output-boundary'
        raw=('x'*4088+secret+'z'*100).encode()
        value=runner.failure_diagnostic(raw,(secret,))
        self.assertEqual(len(value['message']),4096);self.assertTrue(value['truncated'])
        self.assertNotIn('synthetic',value['message'])

    def test_unicode_and_escaped_secret_forms_do_not_leak(self):
        secret='synthétique-marker'
        value=runner.failure_diagnostic((secret+r' synth\u00e9tique-marker').encode(),(secret,))
        self.assertNotIn('synth',value['message']);self.assertTrue(value['redacted'])

    def test_control_bytes_and_invalid_utf8_are_bounded(self):
        value=runner.failure_diagnostic(b'ERROR:\x1b\x00\xff'+b'a'*5000)
        self.assertNotIn('\x1b',value['message']);self.assertNotIn('\x00',value['message'])
        self.assertEqual(len(value['message']),4096);self.assertTrue(value['truncated'])

    def test_success_receipt_does_not_publish_stderr(self):
        value=runner.process_metadata(b'CODING_PERMISSION_SQL_ROLLBACK_ACCEPTED\n',b'synthetic warning',0)
        self.assertEqual(value['state'],'passed');self.assertIsNone(value['failureDiagnostic'])
        self.assertEqual(value['stderrBytes'],17)

    def test_timeout_retains_partial_hashes_and_a_held_diagnostic(self):
        raw=b'ERROR: synthetic timeout marker'
        value=runner.process_metadata(b'partial',raw,None,timed_out=True)
        self.assertEqual(value['state'],'held');self.assertTrue(value['timedOut'])
        self.assertIsNone(value['returncode']);self.assertEqual(value['stderrSha256'],hashlib.sha256(raw).hexdigest())
        self.assertIn('synthetic timeout marker',value['failureDiagnostic']['message'])


if __name__=='__main__': unittest.main()
