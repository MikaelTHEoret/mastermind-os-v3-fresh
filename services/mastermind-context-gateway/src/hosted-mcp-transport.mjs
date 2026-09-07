import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { HOSTED_TOOLS, callHostedTool, hostedToolEnvelope, hostedToolFailure } from './hosted-adapter.mjs';
import { ContextGatewayError } from './validation.mjs';

// Inject authentication and the bounded body reader; tests exercise this exact SDK transport.
export function createHostedMcpTransport({ verifyToken, gatewayForSubject, readBody, requiredScopes = undefined, resourceUrl = undefined }) {
  if ([verifyToken, gatewayForSubject, readBody].some((fn) => typeof fn !== 'function')) throw new TypeError('Verified auth, canonical gateway and bounded body reader are required.');
const handler = createMcpHandler((server) => {
  for (const tool of HOSTED_TOOLS) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: z.fromJSONSchema(tool.inputSchema),
      annotations: tool.annotations,
      securitySchemes: [{ type: 'oauth2', ...(requiredScopes ? { scopes: requiredScopes } : {}) }],
      _meta: { securitySchemes: [{ type: 'oauth2', ...(requiredScopes ? { scopes: requiredScopes } : {}) }] },
    }, async (input, context) => {
      try {
        const info = context.http?.authInfo;
        const subject = info?.extra?.clerkUserId;
        if (info?.extra?.authMode !== 'clerk-oauth' || typeof subject !== 'string') {
          throw new ContextGatewayError('OWNER_REQUIRED', 'An authenticated owner OAuth token is required.', 403);
        }
        const gateway = await gatewayForSubject(subject);
        return hostedToolEnvelope(await callHostedTool(gateway, tool.name, input));
      } catch (error) { return hostedToolFailure(error); }
    });
  }
}, {
  serverInfo: { name: 'mastermind-embodiment-gateway', version: '0.2.0' },
  instructions: 'Call mastermind_bootstrap first. Only active memory is selected by default. Cite memory IDs and exact archive addresses. Task state belongs to the authenticated canonical operator. Workstation execution, checkpoint writes and filesystem exports are not available on this read-only hosted adapter.',
  maxSubscriptions: 0,
});

const authenticatedHandler = withMcpAuth(handler, verifyToken, {
  required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
  requiredScopes, resourceUrl,
});

async function guardedHandler(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ ok: false, code: 'ORIGIN_DENIED' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  if (request.method !== 'POST') return authenticatedHandler(request);
  try {
    const raw = await readBody(request);
    return await authenticatedHandler(new Request(request.url, {
      method: 'POST', headers: request.headers, body: raw, signal: request.signal,
    }));
  } catch (error) {
    const status = Number.isInteger(error?.status) && [400, 413, 415].includes(error.status) ? error.status : 400;
    const code = status === 413 ? 'REQUEST_TOO_LARGE' : status === 415 ? 'UNSUPPORTED_CONTENT_TYPE' : 'INVALID_REQUEST';
    return Response.json({ ok: false, code }, { status, headers: { 'cache-control': 'no-store' } });
  }
}

return async (request) => {
  const response = await guardedHandler(request);
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.delete('access-control-allow-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
}
