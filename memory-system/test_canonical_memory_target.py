import importlib.util
import pathlib
import unittest
from unittest.mock import patch
from urllib.parse import parse_qsl, urlsplit

from canonical_memory_target import MemoryTargetConfigurationError, resolve_memory_dsn


def sample(query=''):
    # Deliberately assembled synthetic fixture; no actual credentials or target.
    return 'postgresql' + '://' + 'fixture-user:p%40ss%3Aword@memory.invalid:5544/archive' + query


class CanonicalMemoryTargetTests(unittest.TestCase):
    def test_import_does_not_read_environment_or_open_connections(self):
        spec = importlib.util.spec_from_file_location('isolated_memory_target', pathlib.Path(__file__).with_name('canonical_memory_target.py'))
        module = importlib.util.module_from_spec(spec)
        with patch('os.environ', object()), patch('socket.socket', side_effect=AssertionError('network forbidden')):
            spec.loader.exec_module(module)
        self.assertTrue(callable(module.resolve_memory_dsn))

    def test_generic_database_url_is_not_a_fallback(self):
        with self.assertRaisesRegex(MemoryTargetConfigurationError, 'NEON_MEMORY_DSN_REQUIRED'):
            resolve_memory_dsn(environment={'DATABASE_URL': sample()})

    def test_preserves_target_credentials_and_unrelated_options(self):
        source = sample('?channel_binding=require&application_name=legacy+reader')
        result = resolve_memory_dsn({'sslmode': 'require'}, environment={'NEON_MEMORY_DSN': source})
        self.assertEqual(urlsplit(result).netloc, urlsplit(source).netloc)
        self.assertEqual(urlsplit(result).path, '/archive')
        self.assertEqual(dict(parse_qsl(urlsplit(result).query)), {'channel_binding': 'require', 'application_name': 'legacy reader', 'sslmode': 'require'})

    def test_adds_reviewed_timeout_and_tls_only_when_absent(self):
        result = resolve_memory_dsn({'sslmode': 'require', 'connect_timeout': '15'}, environment={'NEON_MEMORY_DSN': sample()})
        self.assertEqual(dict(parse_qsl(urlsplit(result).query)), {'sslmode': 'require', 'connect_timeout': '15'})

    def test_matching_options_are_retained(self):
        source = sample('?sslmode=require&connect_timeout=15')
        self.assertEqual(resolve_memory_dsn({'sslmode': 'require', 'connect_timeout': '15'}, environment={'NEON_MEMORY_DSN': source}), source)

    def test_conflicting_tls_or_timeout_is_held(self):
        for query, options in [('?sslmode=verify-full', {'sslmode': 'require'}), ('?sslmode=disable', {'sslmode': 'require'}), ('?connect_timeout=3', {'connect_timeout': '15'})]:
            with self.subTest(query=query), self.assertRaisesRegex(MemoryTargetConfigurationError, 'OPTION_CONFLICT'):
                resolve_memory_dsn(options, environment={'NEON_MEMORY_DSN': sample(query)})

    def test_duplicate_and_malformed_config_are_rejected(self):
        for source in [sample('?sslmode=require&sslmode=disable'), sample('?sslmode'), sample() + '#fragment', sample().replace('/archive', '/'), '\n' + sample(), sample().replace(':5544', ':invalid'), 'https://memory.invalid/archive']:
            with self.subTest(case=source[-12:]), self.assertRaises(MemoryTargetConfigurationError):
                resolve_memory_dsn(environment={'NEON_MEMORY_DSN': source})

    def test_unreviewed_or_invalid_options_are_rejected(self):
        for options in [{'options': '-c search_path=private'}, {'sslmode': 'disable'}, {'connect_timeout': '0'}, {'connect_timeout': '301'}, {'connect_timeout': 15}, []]:
            with self.subTest(options=options), self.assertRaises(MemoryTargetConfigurationError):
                resolve_memory_dsn(options, environment={'NEON_MEMORY_DSN': sample()})

    def test_errors_never_include_configured_value(self):
        source = sample('?sslmode=disable')
        with self.assertRaises(MemoryTargetConfigurationError) as raised:
            resolve_memory_dsn({'sslmode': 'require'}, environment={'NEON_MEMORY_DSN': source})
        self.assertNotIn(source, str(raised.exception))
        self.assertNotIn('fixture-user', str(raised.exception))

    def test_malformed_or_non_utf8_encoded_options_are_held(self):
        for query in ['?options=%FF', '?%FF=value', '?options=%', '?options=%2', '?options=%GG']:
            with self.subTest(query=query), self.assertRaises(MemoryTargetConfigurationError):
                resolve_memory_dsn({'sslmode': 'require'}, environment={'NEON_MEMORY_DSN': sample(query)})

    def test_valid_encoded_unicode_option_is_preserved(self):
        result = resolve_memory_dsn({'sslmode': 'require'}, environment={'NEON_MEMORY_DSN': sample('?application_name=%E2%98%83+reader')})
        self.assertEqual(dict(parse_qsl(urlsplit(result).query))['application_name'], '\u2603 reader')


if __name__ == '__main__':
    unittest.main()
