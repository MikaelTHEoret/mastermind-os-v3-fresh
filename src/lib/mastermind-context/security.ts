// src/lib/mastermind-context/security.ts — bounded redaction and authentication for embodiment surfaces.
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/trading/auth';

const SECRET_PATTERNS = [
  /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/giu,
  /\b(?:sk|pk|rk|api)[-_][A-Za-z0-9][A-Za-z0-9_-]{12,}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/giu,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu,
  /\b(?:password|passwd|pwd|api[_-]?key|secret|token|client[_-]?secret)\s*[:=]\s*[^\s,;]+/giu,
];

const SENSITIVE_KEY = /(?:database.?url|connection.?string|password|passwd|pwd|api.?key|secret|token|private.?key|authorization|cookie)/iu;
const MAX_RESPONSE_BYTES = 65_536;
const INTERNAL_SCOPES = ['identity', 'toolbox', 'project', 'task', 'memory', 'archive', 'minecraft-status'] as const;

export type EmbodimentHost = 'web' | 'chatgpt-desktop' | 'codex' | 'nexus' | 'unknown';

export interface GatewayPrincipal {
  actorId: string;
  host: EmbodimentHost;
  authMode: 'bearer' | 'clerk-owner' | 'clerk-oauth';
  roles: string[];
  scopes: string[];
}

type Authorized = { ok: true; principal: GatewayPrincipal };
type Denied = { ok: false; response: NextResponse };
export type AuthorizationResult = Authorized | Denied;

export function safeHost(value: string | null | undefined): EmbodimentHost {
  switch ((value || '').toLowerCase()) {
    case 'web': return 'web';
    case 'chatgpt':
    case 'chatgpt-desktop': return 'chatgpt-desktop';
    case 'codex': return 'codex';
    case 'nexus': return 'nexus';
    default: return 'unknown';
  }
}

export function inferHostFromMetadata(host?: string | null, clientId?: string): EmbodimentHost {
  const explicit = safeHost(host);
  if (explicit !== 'unknown') return explicit;
  const normalized = (clientId || '').toLowerCase();
  if (normalized.includes('chatgpt') || normalized.includes('openai')) return 'chatgpt-desktop';
  if (normalized.includes('codex')) return 'codex';
  return 'unknown';
}

export function inferMcpHost(request: Request, clientId?: string): EmbodimentHost {
  return inferHostFromMetadata(request.headers.get('x-mastermind-host'), clientId);
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function canonicalOwnerId(): string | null {
  const value = (process.env.MASTERMIND_OWNER_ID || process.env.OWNER_CLERK_USER_ID || '').trim();
  return value || null;
}

export function canonicalClerkOwnerId(): string | null {
  const value = (process.env.OWNER_CLERK_USER_ID || process.env.MASTERMIND_OWNER_ID || '').trim();
  return value || null;
}

export function staticMcpTokenConfigured(): boolean {
  return (process.env.MASTERMIND_MCP_TOKEN || '').trim().length >= 32;
}

export function isValidStaticMcpToken(token?: string): boolean {
  const expected = (process.env.MASTERMIND_MCP_TOKEN || '').trim();
  const supplied = (token || '').trim();
  return expected.length >= 32 && supplied.length > 0 && constantTimeEqual(expected, supplied);
}

export function internalGatewayScopes(): string[] {
  return [...INTERNAL_SCOPES];
}

function tokenFromRequest(request: Request): string {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || '';
}

export function staticBearerPrincipal(request: Request): GatewayPrincipal | null {
  const ownerId = canonicalOwnerId();
  if (!ownerId || !isValidStaticMcpToken(tokenFromRequest(request))) return null;
  return {
    actorId: ownerId,
    host: inferMcpHost(request),
    authMode: 'bearer',
    roles: ['owner', 'operator'],
    scopes: internalGatewayScopes(),
  };
}

function authFailure(status: number, code: string, message: string): Denied {
  return {
    ok: false,
    response: NextResponse.json(
      { ok: false, error: { code, message } },
      { status, headers: { 'cache-control': 'no-store' } },
    ),
  };
}

export async function authorizeWebOrBearer(request: Request): Promise<AuthorizationResult> {
  const principal = staticBearerPrincipal(request);
  if (principal) return { ok: true, principal: { ...principal, host: principal.host === 'unknown' ? 'web' : principal.host } };

  const owner = await requireOwner();
  if (!owner.ok) return authFailure(owner.status, 'MASTERMIND_OWNER_REQUIRED', owner.reason);
  return {
    ok: true,
    principal: {
      actorId: canonicalOwnerId() || owner.userId,
      host: 'web',
      authMode: 'clerk-owner',
      roles: ['owner', 'operator'],
      scopes: internalGatewayScopes(),
    },
  };
}

export function redactText(value: unknown): string {
  let text = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, '[REDACTED]');
  }
  return text;
}

export function sanitizeDeep(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const output = value.map((item) => sanitizeDeep(item, seen));
    seen.delete(value);
    return output;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeDeep(item, seen);
    }
    seen.delete(value);
    return output;
  }
  return redactText(value);
}

function compact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    const limit = depth <= 1 ? 8_000 : depth === 2 ? 3_000 : 1_200;
    return value.length > limit ? `${value.slice(0, limit)}\n[…truncated…]` : value;
  }
  if (Array.isArray(value)) {
    const limit = depth <= 1 ? 30 : 15;
    const items: unknown[] = value.slice(0, limit).map((item) => compact(item, depth + 1));
    if (value.length > limit) items.push({ truncatedItems: value.length - limit });
    return items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item, depth + 1)]));
  }
  return value;
}

export function boundPayload(value: unknown, maxBytes = MAX_RESPONSE_BYTES): Record<string, unknown> {
  const sanitized = sanitizeDeep(value);
  const initial = JSON.stringify(sanitized);
  if (Buffer.byteLength(initial, 'utf8') <= maxBytes) return sanitized as Record<string, unknown>;

  const compacted = compact(sanitized) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(compacted), 'utf8') <= maxBytes) {
    return { ...compacted, transportTruncated: true };
  }
  return {
    ok: false,
    transportTruncated: true,
    byteLimit: maxBytes,
    error: { code: 'MASTERMIND_RESPONSE_TOO_LARGE', message: 'The result exceeded the embodiment transport boundary.' },
  };
}

export function safeError(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}
