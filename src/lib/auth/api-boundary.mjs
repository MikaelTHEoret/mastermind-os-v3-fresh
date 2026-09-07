import { captureRequestAllowed } from '../genealogy/capture-policy.mjs';
// Admission only. Handlers retain operation, resource and credential gates.
const MACHINE_PATHS = new Set(['/api/node/v1/pair', '/api/node/v1/exchange']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function apiOwnerConfigured(env) {
  return Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY
    && /^user_[A-Za-z0-9]+$/.test(env.OWNER_CLERK_USER_ID ?? ''));
}

function deny(status, code) { return { kind: 'denied', status, code }; }

function localDevelopment(request, env, url) {
  if (env.VERCEL || env.NODE_ENV !== 'development' || url.protocol !== 'http:') return null;
  let host;
  try { host = new URL(`http://${request.headers.get('host') ?? ''}`); }
  catch { return null; }
  if (!LOOPBACK_HOSTS.has(url.hostname) || !LOOPBACK_HOSTS.has(host.hostname)
    || host.port !== url.port || host.username || host.password || host.pathname !== '/'
    || host.search || host.hash || url.username || url.password) return null;
  // Forwarded headers cannot attest locality. The dev listener must bind loopback.
  return host;
}

export function inspectApiBoundary(request, env) {
  let url;
  try { url = new URL(request.url); } catch { return deny(400, 'API_REQUEST_INVALID'); }
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return { kind: 'public' };
  if (MACHINE_PATHS.has(url.pathname)) return { kind: 'node-protocol' };
  if (url.pathname === '/api/mcp') return { kind: 'mcp-oauth' };
  const local = localDevelopment(request, env, url);
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  // Existing capture handler verifies approved credentials and pending registration.
  if (local && captureRequestAllowed(request)) {
    return { kind: 'local-capture-protocol' };
  }
  const allowedOrigin = origin === null || origin === url.origin || (local && origin === local.origin);
  if (!allowedOrigin || (site && site !== 'same-origin' && site !== 'none')) return deny(403, 'API_ORIGIN_REQUIRED');
  if (local) return { kind: 'local-development' };
  if (!apiOwnerConfigured(env)) return deny(503, 'OWNER_GATE_NOT_CONFIGURED');
  return { kind: 'owner' };
}

export async function authorizeApiBoundary(request, env, readAuthenticatedSubject) {
  const admission = inspectApiBoundary(request, env);
  if (admission.kind !== 'owner') return admission;
  try {
    const subject = await readAuthenticatedSubject();
    if (!subject) return deny(401, 'OWNER_SESSION_REQUIRED');
    if (subject !== env.OWNER_CLERK_USER_ID) return deny(403, 'OWNER_REQUIRED');
    return { kind: 'owner', subject };
  } catch { return deny(403, 'OWNER_AUTH_UNAVAILABLE'); }
}

export function apiBoundaryDenial(admission) {
  return Response.json({ ok: false, error: { code: admission.code, message: 'This private API request is not authorized.' } }, {
    status: admission.status,
    headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' },
  });
}
