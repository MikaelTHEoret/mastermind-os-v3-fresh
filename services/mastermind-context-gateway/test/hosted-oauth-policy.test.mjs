import assert from 'node:assert/strict';
import test from 'node:test';
import { readBoundedJsonRequestBody } from '../../../src/lib/memory/local-service-auth.ts';
import { createHostedMcpTransport } from '../src/hosted-mcp-transport.mjs';
import { hostedOAuthPolicy, verifyHostedOAuthToken, createHostedOAuthHandler,
  protectedHostedMetadata, hostedOAuthFailure, HostedOAuthError } from '../src/hosted-oauth-policy.mjs';

// These fixtures inject Clerk's *post-verification* object. They do not verify
// signatures, possess credentials, contact Clerk, or establish tenant support.
const env = {
  OWNER_CLERK_USER_ID: 'user_owner',
  MASTERMIND_MCP_OAUTH_ISSUER: 'https://issuer.example',
  MASTERMIND_MCP_OAUTH_RESOURCE: 'https://mastermind.example',
  MASTERMIND_MCP_OAUTH_CLIENT_IDS: '["fixture-chat","fixture-codex"]',
  MASTERMIND_MCP_OAUTH_REQUIRED_SCOPES: '["fixture:context:read"]',
};
const policy = hostedOAuthPolicy(env);
const baseClaims = () => ({ iss: policy.issuer, sub: policy.ownerSubject, client_id: 'fixture-chat',
  scp: ['fixture:context:read'], aud: policy.resource, exp: Math.floor(Date.now() / 1000) + 60 });
const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (claims, header = { typ: 'at+jwt', alg: 'RS256' }) => `${encoded(header)}.${encoded(claims)}.${encoded('fixture-signature')}`;
function authFor(claims, token = jwt(claims), changes = {}) {
  return { isAuthenticated: true, tokenType: 'oauth_token', userId: claims.sub, clientId: claims.client_id,
    scopes: claims.scp ?? claims.scope.split(' '), getToken: async () => token, ...changes };
}
const errorCode = (code) => (error) => error instanceof HostedOAuthError && error.code === code;

test('policy has no implicit owner, issuer, resource, registered clients or scopes', () => {
  for (const key of Object.keys(env)) {
    const input = { ...env }; delete input[key];
    assert.throws(() => hostedOAuthPolicy(input), errorCode('MCP_OAUTH_CONFIGURATION_REQUIRED'));
  }
  for (const changes of [
    { MASTERMIND_MCP_OAUTH_CLIENT_IDS: '[]' }, { MASTERMIND_MCP_OAUTH_REQUIRED_SCOPES: '[]' },
    { MASTERMIND_MCP_OAUTH_CLIENT_IDS: '["fixture-chat","fixture-chat"]' },
    { MASTERMIND_MCP_OAUTH_REQUIRED_SCOPES: '["read write"]' },
    { MASTERMIND_MCP_OAUTH_RESOURCE: 'http://mastermind.example' },
    { MASTERMIND_MCP_OAUTH_ISSUER: 'https://issuer.example?alternate=1' },
  ]) assert.throws(() => hostedOAuthPolicy({ ...env, ...changes }), errorCode('MCP_OAUTH_CONFIGURATION_REQUIRED'));
});

test('exact verified owner token supports each configured registered client and required scope', async () => {
  for (const client_id of policy.clientIds) {
    const claims = { ...baseClaims(), client_id }; const token = jwt(claims);
    const result = await verifyHostedOAuthToken(authFor(claims, token), token, policy);
    assert.equal(result.token, token); assert.equal(result.clientId, client_id);
    assert.deepEqual(result.extra, { clerkUserId: 'user_owner', authMode: 'clerk-oauth' });
  }
});

test('configuration requires an explicit service permission beyond identity/profile grants', () => {
  for (const scopes of [['openid'], ['openid', 'profile', 'email', 'offline_access'],
    ['address', 'phone', 'public_metadata', 'private_metadata', 'user:org:read']]) {
    assert.throws(() => hostedOAuthPolicy({ ...env, MASTERMIND_MCP_OAUTH_REQUIRED_SCOPES: JSON.stringify(scopes) }),
      errorCode('MCP_OAUTH_SERVICE_SCOPE_REQUIRED'));
  }
  assert.deepEqual(hostedOAuthPolicy({ ...env,
    MASTERMIND_MCP_OAUTH_REQUIRED_SCOPES: '["openid","fixture:context:read"]' }).requiredScopes,
  ['openid', 'fixture:context:read']);
});

test('resource paths remain exact while discovery uses the resource origin as its metadata base', async () => {
  const pathPolicy = hostedOAuthPolicy({ ...env, MASTERMIND_MCP_OAUTH_RESOURCE: `${env.MASTERMIND_MCP_OAUTH_RESOURCE}/api/mcp` });
  const claims = { ...baseClaims(), aud: pathPolicy.resource }; const token = jwt(claims);
  assert.equal((await verifyHostedOAuthToken(authFor(claims, token), token, pathPolicy)).clientId, claims.client_id);
  assert.equal(protectedHostedMetadata(pathPolicy).resource, pathPolicy.resource);
  const denied = { ...claims, aud: pathPolicy.resourceOrigin }; const other = jwt(denied);
  await assert.rejects(verifyHostedOAuthToken(authFor(denied, other), other, pathPolicy), errorCode('TOKEN_RESOURCE_MISMATCH'));
  const challenge = hostedOAuthFailure(new HostedOAuthError('OAUTH_TOKEN_REQUIRED'), pathPolicy).headers.get('www-authenticate');
  assert.ok(challenge.includes(`resource_metadata="${pathPolicy.resourceOrigin}/.well-known/oauth-protected-resource/mcp"`));
});

test('token substitution is rejected before trusting decoded claims', async () => {
  const claims = baseClaims(); const presented = jwt(claims);
  const verified = jwt({ ...claims, aud: 'https://different.example' });
  await assert.rejects(verifyHostedOAuthToken(authFor(claims, verified), presented, policy), errorCode('VERIFIED_TOKEN_MISMATCH'));
});

for (const [name, change, code] of [
  ['foreign owner', { sub: 'user_other' }, 'OWNER_REQUIRED'],
  ['same owner unrelated client', { client_id: 'fixture-unapproved-client' }, 'OAUTH_CLIENT_DENIED'],
  ['empty granted scope', { scp: [] }, 'INSUFFICIENT_SCOPE'],
  ['identity-only granted scope', { scp: ['openid', 'profile', 'email'] }, 'INSUFFICIENT_SCOPE'],
  ['wrong issuer', { iss: 'https://elsewhere.example' }, 'TOKEN_ISSUER_MISMATCH'],
  ['issuer trailing slash', { iss: `${policy.issuer}/` }, 'TOKEN_ISSUER_MISMATCH'],
  ['issuer path mismatch', { iss: `${policy.issuer}/other` }, 'TOKEN_ISSUER_MISMATCH'],
  ['wrong audience', { aud: 'https://other.example' }, 'TOKEN_RESOURCE_MISMATCH'],
  ['foreign audience array', { aud: ['https://other.example'] }, 'TOKEN_RESOURCE_MISMATCH'],
  ['empty audience array', { aud: [] }, 'TOKEN_RESOURCE_MISMATCH'],
  ['conflicting resource', { resource: 'https://other.example' }, 'TOKEN_RESOURCE_MISMATCH'],
  ['expired', { exp: 1 }, 'TOKEN_TIME_INVALID'],
  ['not yet valid', { nbf: 9999999999 }, 'TOKEN_TIME_INVALID'],
]) test(`denies ${name}`, async () => {
  const claims = { ...baseClaims(), ...change }; const token = jwt(claims);
  await assert.rejects(verifyHostedOAuthToken(authFor(claims, token), token, policy), errorCode(code));
});

test('audience arrays require exact membership; explicit resource may supply the binding', async () => {
  for (const binding of [{ aud: ['https://other.example', policy.resource] }, { resource: policy.resource }]) {
    const claims = baseClaims(); delete claims.aud; Object.assign(claims, binding); const token = jwt(claims);
    assert.equal((await verifyHostedOAuthToken(authFor(claims, token), token, policy)).clientId, claims.client_id);
  }
});

test('opaque access tokens and JWTs without resource evidence remain explicitly unsupported', async () => {
  const claims = baseClaims(); const opaque = 'oat_fixture_not_a_real_token';
  await assert.rejects(verifyHostedOAuthToken(authFor(claims, opaque), opaque, policy), errorCode('TOKEN_RESOURCE_BINDING_UNAVAILABLE'));
  delete claims.aud; const token = jwt(claims);
  await assert.rejects(verifyHostedOAuthToken(authFor(claims, token), token, policy), errorCode('TOKEN_RESOURCE_BINDING_UNAVAILABLE'));
});

test('Clerk state and signed claim identity/scope cannot diverge', async () => {
  const claims = baseClaims(); const token = jwt(claims);
  for (const changes of [{ clientId: 'fixture-codex' }, { scopes: ['fixture:context:read', 'extra:scope'] }]) {
    await assert.rejects(verifyHostedOAuthToken(authFor(claims, token, changes), token, policy), errorCode('VERIFIED_TOKEN_CLAIMS_MISMATCH'));
  }
  const conflicting = { ...claims, scope: 'unrelated:scope' }; const other = jwt(conflicting);
  await assert.rejects(verifyHostedOAuthToken(authFor(conflicting, other), other, policy), errorCode('VERIFIED_TOKEN_CLAIMS_MISMATCH'));
});

test('session tokens and unverified auth objects cannot become OAuth authority', async () => {
  const claims = baseClaims(); const token = jwt(claims);
  for (const changes of [{ isAuthenticated: false }, { tokenType: 'session_token' }, { getToken: undefined }]) {
    await assert.rejects(verifyHostedOAuthToken(authFor(claims, token, changes), token, policy), errorCode('OAUTH_TOKEN_REQUIRED'));
  }
});

function fixture({ claims = baseClaims(), configured = true, authChanges = {}, presented, origin } = {}) {
  const token = presented ?? jwt(claims); const calls = []; let authReads = 0;
  const handler = createHostedOAuthHandler({
    readPolicy: () => hostedOAuthPolicy(configured ? env : {}),
    readAuth: async () => { authReads++; return authFor(claims, token, authChanges); },
    createTransport: ({ policy, verifyToken }) => createHostedMcpTransport({ verifyToken,
      requiredScopes: policy.requiredScopes, resourceUrl: policy.resourceOrigin,
      readBody: (request) => readBoundedJsonRequestBody(request, { maxBytes: 65536 }),
      gatewayForSubject: async (subject) => { calls.push(subject); return { searchMemories: async () => ({ results: [] }) }; },
    }),
  });
  const request = (method = 'tools/call') => new Request('https://mastermind.example/api/mcp', { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(method === 'tools/call' ? { params: { name: 'mastermind_memory_search', arguments: { query: 'fixture' } } } : {}) }),
  });
  return { handler, request, calls, authReads: () => authReads };
}

test('actual SDK private-read boundary denies invalid policy/token before any gateway call', async () => {
  for (const options of [{ configured: false }, { claims: { ...baseClaims(), scp: [] } },
    { claims: { ...baseClaims(), client_id: 'fixture-foreign' } }, { claims: { ...baseClaims(), aud: 'https://other.example' } },
    { presented: 'oat_fixture_not_a_real_token' }, { origin: 'https://untrusted.example' }]) {
    const f = fixture(options); const response = await f.handler(f.request());
    assert.ok([401, 403, 503].includes(response.status)); assert.deepEqual(f.calls, []);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const result = await response.json(); assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string');
    if (options.configured === false || options.origin) assert.equal(f.authReads(), 0);
    if (result.error.code === 'INSUFFICIENT_SCOPE') assert.match(response.headers.get('www-authenticate'), /fixture:context:read/);
  }
});

test('actual SDK receives policy-verified token and preserves only seven read tools', async () => {
  const f = fixture(); const called = await f.handler(f.request()); assert.equal(called.status, 200);
  assert.deepEqual(f.calls, ['user_owner']);
  const response = await f.handler(f.request('tools/list')); const raw = await response.text();
  const result = raw.startsWith('event:') ? JSON.parse(raw.split('\n').find((line) => line.startsWith('data: ')).slice(6)) : JSON.parse(raw);
  assert.equal(result.result.tools.length, 7);
  assert.ok(result.result.tools.every((tool) => tool.annotations.readOnlyHint));
  assert.ok(result.result.tools.every((tool) => tool._meta.securitySchemes[0].type === 'oauth2'
    && tool._meta.securitySchemes[0].scopes[0] === 'fixture:context:read'));
});

test('metadata advertises only explicit resource/issuer/scopes and public CORS is limited to metadata', async () => {
  assert.deepEqual(protectedHostedMetadata(policy), { resource: policy.resource, authorization_servers: [policy.issuer],
    scopes_supported: policy.requiredScopes, bearer_methods_supported: ['header'], resource_name: 'Mastermind Embodiment Gateway' });
  const error = new HostedOAuthError('MCP_OAUTH_CONFIGURATION_REQUIRED', 503);
  const metadata = hostedOAuthFailure(error, undefined, { metadata: true });
  assert.equal(metadata.status, 503); assert.equal(metadata.headers.get('access-control-allow-origin'), '*');
  assert.equal(hostedOAuthFailure(error).headers.get('access-control-allow-origin'), null);
});
