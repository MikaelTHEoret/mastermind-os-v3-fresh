'use strict';

// The gateway's explicit memory URL is the owner. No dotenv load, I/O, connection
// or generic DATABASE_URL fallback occurs here.
class MemoryTargetConfigurationError extends Error {
  constructor(code) { super(code); this.name = 'MemoryTargetConfigurationError'; this.code = code; }
}
function fail(code) { throw new MemoryTargetConfigurationError(code); }

function resolveMemoryUrl(requiredOptions = {}, environment = process.env) {
  const value = environment.NEON_MEMORY_URL;
  if (typeof value !== 'string' || !value.trim()) fail('NEON_MEMORY_URL_REQUIRED_CANONICAL_MEMORY_TARGET');
  if (/[\u0000-\u001f]/u.test(value)) fail('INVALID_CANONICAL_MEMORY_URL');
  let parsed;
  try { parsed = new URL(value.trim()); }
  catch { fail('INVALID_CANONICAL_MEMORY_URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname
      || !parsed.pathname || parsed.pathname === '/' || parsed.hash) fail('INVALID_CANONICAL_MEMORY_URL');
  if (parsed.search && parsed.search.slice(1).split('&').some((item) => !item.includes('='))) {
    fail('INVALID_CANONICAL_MEMORY_OPTIONS');
  }
  // URLSearchParams otherwise replaces invalid encoded bytes with U+FFFD.
  // Validate each encoded component first so configuration is preserved or held.
  try {
    for (const item of parsed.search.slice(1).split('&').filter(Boolean)) {
      const equal = item.indexOf('=');
      for (const component of [item.slice(0, equal), item.slice(equal + 1)]) {
        decodeURIComponent(component.replace(/\+/gu, ' '));
      }
    }
  } catch { fail('INVALID_CANONICAL_MEMORY_OPTIONS'); }
  const pairs = [...parsed.searchParams];
  if (new Set(pairs.map(([key]) => key)).size !== pairs.length) fail('AMBIGUOUS_CANONICAL_MEMORY_OPTIONS');
  if (!requiredOptions || typeof requiredOptions !== 'object' || Array.isArray(requiredOptions)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(requiredOptions))
      || Object.keys(requiredOptions).some((key) => !['sslmode', 'connect_timeout'].includes(key))) {
    fail('UNREVIEWED_MEMORY_CONNECTION_OPTION');
  }
  for (const [key, expected] of Object.entries(requiredOptions)) {
    if (typeof expected !== 'string'
        || (key === 'sslmode' && !['require', 'verify-ca', 'verify-full'].includes(expected))
        || (key === 'connect_timeout' && (!/^[0-9]+$/u.test(expected) || Number(expected) < 1 || Number(expected) > 300))) {
      fail('INVALID_REQUIRED_MEMORY_CONNECTION_OPTION');
    }
    if (parsed.searchParams.has(key) && parsed.searchParams.get(key) !== expected) {
      fail('CANONICAL_MEMORY_CONNECTION_OPTION_CONFLICT');
    }
    parsed.searchParams.set(key, expected);
  }
  return parsed.toString();
}
module.exports = { MemoryTargetConfigurationError, resolveMemoryUrl };
