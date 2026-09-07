const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const ADDRESS = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{0,511}$/;
const SOURCE_TYPE = /^[a-z][a-z0-9._-]{0,31}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export class ContextGatewayError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ContextGatewayError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 400) {
  throw new ContextGatewayError(code, message, status);
}

export function requiredString(value, name, maximum, pattern = null) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || CONTROL.test(value)
    || (pattern && !pattern.test(value))
  ) fail('INVALID_ARGUMENT', `${name} is invalid.`);
  return value;
}

export function optionalString(value, name, maximum, pattern = null) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, name, maximum, pattern);
}

export function uuid(value, name) {
  return requiredString(value, name, 36, UUID).toLowerCase();
}

export function projectId(value) {
  return requiredString(value, 'project', 128, SAFE_ID).toLowerCase();
}

export function archiveAddress(value) {
  return requiredString(value, 'address', 512, ADDRESS);
}

export function sourceType(value) {
  return optionalString(value, 'sourceType', 32, SOURCE_TYPE);
}

export function searchQuery(value) {
  return requiredString(value, 'query', 512);
}

export function boundedInteger(value, name, fallback, minimum, maximum) {
  const candidate = value === undefined || value === null ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    fail('INVALID_ARGUMENT', `${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return candidate;
}

export function stringArray(value, name, maximumItems = 32, maximumItemLength = 512) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximumItems) fail('INVALID_ARGUMENT', `${name} is invalid.`);
  return value.map((item, index) => requiredString(item, `${name}[${index}]`, maximumItemLength));
}

export function taskState(value) {
  const state = value ?? 'active';
  if (!['active', 'blocked', 'completed'].includes(state)) fail('INVALID_ARGUMENT', 'state is invalid.');
  return state;
}

export function exactObject(value, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_ARGUMENT', 'Arguments must be an object.');
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail('INVALID_ARGUMENT', `Unknown argument: ${unknown[0]}.`);
  return value;
}

export function redactText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bnpg_[A-Za-z0-9]{12,}\b/g, '[REDACTED_DATABASE_PASSWORD]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, '$1[REDACTED_TOKEN]')
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

export function sanitizeValue(value, depth = 0) {
  if (depth > 8) return '[TRUNCATED_DEPTH]';
  if (typeof value === 'string') return redactText(value);
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/password|passwd|secret|api.?key|access.?token|refresh.?token|connection.?string|authorization|cookie/i.test(key)) {
        result[key] = '[REDACTED]';
      } else result[key] = sanitizeValue(item, depth + 1);
    }
    return result;
  }
  return value;
}

export function boundedText(value, maximum) {
  const sanitized = redactText(String(value ?? ''));
  if (sanitized.length <= maximum) return sanitized;
  return `${sanitized.slice(0, Math.max(0, maximum - 22))}\n[CONTENT TRUNCATED]`;
}

export const patterns = Object.freeze({ UUID, SAFE_ID, ADDRESS, SOURCE_TYPE });
