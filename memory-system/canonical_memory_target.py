"""Import-safe connection-string resolution for legacy memory scripts.

Matches the runtime's explicit NEON_MEMORY_DSN handoff. No I/O or connections;
generic DATABASE_URL is deliberately not a memory target fallback.
"""
import os
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


class MemoryTargetConfigurationError(ValueError):
    pass


def resolve_memory_dsn(required_options=None, *, environment=None):
    env = os.environ if environment is None else environment
    value = env.get('NEON_MEMORY_DSN')
    if not isinstance(value, str) or not value.strip():
        raise MemoryTargetConfigurationError('NEON_MEMORY_DSN_REQUIRED_CANONICAL_MEMORY_HANDOFF')
    if any(ord(char) < 32 for char in value):
        raise MemoryTargetConfigurationError('INVALID_CANONICAL_MEMORY_DSN')
    value = value.strip()
    try:
        parsed = urlsplit(value)
        valid = parsed.scheme in ('postgres', 'postgresql') and parsed.hostname and parsed.path not in ('', '/') and not parsed.fragment
        parsed.port
        if re.search(r'%(?![0-9A-Fa-f]{2})', parsed.query):
            raise ValueError('INVALID_QUERY_ESCAPE')
        pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True, encoding='utf-8', errors='strict') if parsed.query else []
    except (ValueError, TypeError, UnicodeError):
        raise MemoryTargetConfigurationError('INVALID_CANONICAL_MEMORY_DSN') from None
    if not valid or len({key for key, _ in pairs}) != len(pairs):
        raise MemoryTargetConfigurationError('INVALID_OR_AMBIGUOUS_CANONICAL_MEMORY_DSN')
    options = required_options if required_options is not None else {}
    if not isinstance(options, dict) or set(options) - {'sslmode', 'connect_timeout'}:
        raise MemoryTargetConfigurationError('UNREVIEWED_MEMORY_CONNECTION_OPTION')
    current = dict(pairs)
    for key, expected in options.items():
        if (not isinstance(expected, str) or
                (key == 'sslmode' and expected not in ('require', 'verify-ca', 'verify-full')) or
                (key == 'connect_timeout' and (not expected.isascii() or not expected.isdecimal() or not 1 <= int(expected) <= 300))):
            raise MemoryTargetConfigurationError('INVALID_REQUIRED_MEMORY_CONNECTION_OPTION')
        if key in current and current[key] != expected:
            raise MemoryTargetConfigurationError('CANONICAL_MEMORY_CONNECTION_OPTION_CONFLICT')
        current[key] = expected
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(current), ''))
