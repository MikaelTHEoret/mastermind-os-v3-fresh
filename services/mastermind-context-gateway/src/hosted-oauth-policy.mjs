// Additional resource-server policy after Clerk's cryptographic OAuth verification.
// No token, client ID, scope or issuer is supplied by tool arguments.
export class HostedOAuthError extends Error {
  constructor(code, status = 401) { super(code); this.code = code; this.status = status; }
}
const reject = (code, status = 401) => { throw new HostedOAuthError(code, status); };
const scopePattern = /^[\x21\x23-\x5b\x5d-\x7e]{1,180}$/;
// Identity/profile grants do not authorize this service's private context reads.
// The operator must configure an actually assigned service permission; no scope
// name or tenant assignment is created or inferred here.
const identityScopes = new Set(['openid', 'profile', 'email', 'address', 'phone',
  'offline_access', 'public_metadata', 'private_metadata', 'user:org:read']);

function httpsIdentifier(value) {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) reject('MCP_OAUTH_CONFIGURATION_REQUIRED', 503);
  let url;
  try { url = new URL(value); } catch { reject('MCP_OAUTH_CONFIGURATION_REQUIRED', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || ![url.href, url.origin].includes(value)) reject('MCP_OAUTH_CONFIGURATION_REQUIRED', 503);
  return value;
}
function list(value, maximum, valid) {
  let values;
  try { values = JSON.parse(value); } catch { reject('MCP_OAUTH_CONFIGURATION_REQUIRED', 503); }
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum
      || values.some((item) => typeof item !== 'string' || !valid(item))
      || new Set(values).size !== values.length) reject('MCP_OAUTH_CONFIGURATION_REQUIRED', 503);
  return Object.freeze(values);
}
export function hostedOAuthPolicy(env) {
  const issuer = httpsIdentifier(env.MASTERMIND_MCP_OAUTH_ISSUER);
  const resource = httpsIdentifier(env.MASTERMIND_MCP_OAUTH_RESOURCE);
  const clientIds = list(env.MASTERMIND_MCP_OAUTH_CLIENT_IDS, 8, (item) => /^[\x21-\x7e]{1,512}$/.test(item));
  const requiredScopes = list(env.MASTERMIND_MCP_OAUTH_REQUIRED_SCOPES, 16, (item) => scopePattern.test(item));
  if (!requiredScopes.some((scope) => !identityScopes.has(scope))) reject('MCP_OAUTH_SERVICE_SCOPE_REQUIRED', 503);
  const ownerSubject = env.OWNER_CLERK_USER_ID;
  if (typeof ownerSubject !== 'string' || !/^user_[A-Za-z0-9]+$/.test(ownerSubject)) reject('MCP_OAUTH_CONFIGURATION_REQUIRED', 503);
  return Object.freeze({ issuer, resource, resourceOrigin: new URL(resource).origin, clientIds, requiredScopes, ownerSubject });
}
export function requireHostedOrigin(request, policy) {
  const url = new URL(request.url);
  if (url.origin !== policy.resourceOrigin) reject('MCP_RESOURCE_ORIGIN_DENIED', 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) reject('ORIGIN_DENIED', 403);
}
function jsonPart(encoded) {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 32768) reject('TOKEN_RESOURCE_BINDING_UNAVAILABLE');
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) reject('TOKEN_RESOURCE_BINDING_UNAVAILABLE');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) reject('TOKEN_RESOURCE_BINDING_UNAVAILABLE');
    return value;
  } catch { reject('TOKEN_RESOURCE_BINDING_UNAVAILABLE'); }
}
function strings(value) {
  return Array.isArray(value) && value.length <= 32 && value.every((x) => typeof x === 'string' && scopePattern.test(x))
    && new Set(value).size === value.length;
}
function audienceMatches(value, expected) {
  return typeof value === 'string' ? value === expected : Array.isArray(value) && value.length > 0 && value.length <= 8
    && value.every((item) => typeof item === 'string' && item.length <= 2048)
    && new Set(value).size === value.length && value.includes(expected);
}

export async function verifyHostedOAuthToken(auth, presentedToken, policy, nowSeconds = Date.now() / 1000) {
  if (!auth?.isAuthenticated || auth.tokenType !== 'oauth_token' || typeof auth.getToken !== 'function') reject('OAUTH_TOKEN_REQUIRED');
  // Clerk's authenticatedMachineObject.getToken returns the exact token whose
  // verification produced this object. Never decode a separately supplied token.
  const verifiedToken = await auth.getToken();
  if (typeof presentedToken !== 'string' || presentedToken.length > 49152 || !presentedToken
      || verifiedToken !== presentedToken) reject('VERIFIED_TOKEN_MISMATCH');
  if (auth.userId !== policy.ownerSubject) reject('OWNER_REQUIRED', 403);
  if (!policy.clientIds.includes(auth.clientId)) reject('OAUTH_CLIENT_DENIED', 403);
  if (!strings(auth.scopes) || !policy.requiredScopes.every((scope) => auth.scopes.includes(scope))) reject('INSUFFICIENT_SCOPE', 403);
  const parts = verifiedToken.split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) reject('TOKEN_RESOURCE_BINDING_UNAVAILABLE');
  const header = jsonPart(parts[0]);
  const claims = jsonPart(parts[1]);
  if (!['at+jwt', 'application/at+jwt'].includes(header.typ)) reject('OAUTH_ACCESS_TOKEN_REQUIRED');
  if (claims.iss !== policy.issuer) reject('TOKEN_ISSUER_MISMATCH');
  if (claims.sub !== auth.userId || claims.client_id !== auth.clientId) reject('VERIFIED_TOKEN_CLAIMS_MISMATCH');
  const scopes = claims.scp ?? (typeof claims.scope === 'string' ? claims.scope.split(' ') : null);
  if (!strings(scopes) || scopes.length !== auth.scopes.length || scopes.some((scope) => !auth.scopes.includes(scope))) reject('VERIFIED_TOKEN_CLAIMS_MISMATCH');
  if (claims.scp !== undefined && claims.scope !== undefined) {
    const other = typeof claims.scope === 'string' ? claims.scope.split(' ') : null;
    if (!strings(other) || other.length !== scopes.length || other.some((scope) => !scopes.includes(scope))) reject('VERIFIED_TOKEN_CLAIMS_MISMATCH');
  }
  if (!Number.isFinite(nowSeconds) || !Number.isSafeInteger(claims.exp) || claims.exp <= nowSeconds
      || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > nowSeconds))) reject('TOKEN_TIME_INVALID');
  const bindings = ['aud', 'resource'].filter((key) => claims[key] !== undefined);
  if (!bindings.length) reject('TOKEN_RESOURCE_BINDING_UNAVAILABLE');
  if (bindings.some((key) => !audienceMatches(claims[key], policy.resource))) reject('TOKEN_RESOURCE_MISMATCH');
  return { token: verifiedToken, clientId: auth.clientId, scopes: [...auth.scopes], expiresAt: claims.exp,
    extra: { clerkUserId: auth.userId, authMode: 'clerk-oauth' } };
}

export function hostedOAuthFailure(error, policy, { metadata = false } = {}) {
  const known = error instanceof HostedOAuthError;
  const status = known ? error.status : 503;
  const code = known ? error.code : 'MCP_OAUTH_UNAVAILABLE';
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (policy && [401, 403].includes(status)) {
    const kind = code === 'INSUFFICIENT_SCOPE' ? 'insufficient_scope' : 'invalid_token';
    headers['www-authenticate'] = `Bearer error="${kind}", resource_metadata="${policy.resourceOrigin}/.well-known/oauth-protected-resource/mcp", scope="${policy.requiredScopes.join(' ')}"`;
  }
  if (metadata) Object.assign(headers, metadataCorsHeaders);
  return Response.json({ ok: false, error: { code } }, { status, headers });
}
export const metadataCorsHeaders = Object.freeze({ 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' });
export function protectedHostedMetadata(policy) {
  return { resource: policy.resource, authorization_servers: [policy.issuer], scopes_supported: [...policy.requiredScopes],
    bearer_methods_supported: ['header'], resource_name: 'Mastermind Embodiment Gateway' };
}

export function createHostedOAuthHandler({ readPolicy, readAuth, createTransport }) {
  return async (request) => {
    let policy;
    try {
      policy = readPolicy();
      requireHostedOrigin(request, policy);
      const match = /^Bearer ([^\s,]+)$/i.exec(request.headers.get('authorization') ?? '');
      if (!match) reject('OAUTH_TOKEN_REQUIRED');
      const info = await verifyHostedOAuthToken(await readAuth(request), match[1], policy);
      const transport = createTransport({ policy,
        verifyToken: async (_request, token) => token === info.token ? info : undefined });
      return await transport(request);
    } catch (error) { return hostedOAuthFailure(error, policy); }
  };
}
