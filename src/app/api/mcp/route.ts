// Reconciled from PR #2; OAuth transport delegates to the same canonical context service as stdio.
import { auth } from '@clerk/nextjs/server';
import { gatewayForAuthenticatedOwner } from '@/lib/mastermind-context/gateway';
import { readBoundedJsonRequestBody } from '@/lib/memory/local-service-auth';
import { HOSTED_REQUEST_BYTES } from '../../../../services/mastermind-context-gateway/src/hosted-adapter.mjs';
import { createHostedMcpTransport } from '../../../../services/mastermind-context-gateway/src/hosted-mcp-transport.mjs';
import { createHostedOAuthHandler, hostedOAuthPolicy } from '../../../../services/mastermind-context-gateway/src/hosted-oauth-policy.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const guardedHandler = createHostedOAuthHandler({
  readPolicy: () => hostedOAuthPolicy(process.env),
  readAuth: () => auth({ acceptsToken: 'oauth_token' }),
  createTransport: ({ policy, verifyToken }) => createHostedMcpTransport({
    verifyToken, gatewayForSubject: gatewayForAuthenticatedOwner,
    requiredScopes: policy.requiredScopes, resourceUrl: policy.resourceOrigin,
    readBody: (request: Request) => readBoundedJsonRequestBody(request, { maxBytes: HOSTED_REQUEST_BYTES }),
  }),
});
export { guardedHandler as GET, guardedHandler as POST };
