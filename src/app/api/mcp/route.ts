// Reconciled from PR #2; OAuth transport delegates to the same canonical context service as stdio.
import type { AuthInfo } from '@modelcontextprotocol/server';
import { auth } from '@clerk/nextjs/server';
import { verifyClerkToken } from '@clerk/mcp-tools/next';
import { gatewayForAuthenticatedOwner } from '@/lib/mastermind-context/gateway';
import { ownerGateConfigured } from '@/lib/trading/auth';
import { readBoundedJsonRequestBody } from '@/lib/memory/local-service-auth';
import { HOSTED_REQUEST_BYTES } from '../../../../services/mastermind-context-gateway/src/hosted-adapter.mjs';
import { createHostedMcpTransport } from '../../../../services/mastermind-context-gateway/src/hosted-mcp-transport.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const verifyToken = async (_request: Request, token?: string): Promise<AuthInfo | undefined> => {
  if (!ownerGateConfigured() || !token) return undefined;
  const clerkAuth = await auth({ acceptsToken: 'oauth_token' });
  const verified = verifyClerkToken(clerkAuth, token) as unknown as AuthInfo | undefined;
  const subject = verified?.extra?.userId;
  if (!verified || typeof subject !== 'string' || subject !== process.env.OWNER_CLERK_USER_ID) return undefined;
  return { ...verified, extra: { clerkUserId: subject, authMode: 'clerk-oauth' } };
};

const guardedHandler = createHostedMcpTransport({
  verifyToken, gatewayForSubject: gatewayForAuthenticatedOwner,
  readBody: (request: Request) => readBoundedJsonRequestBody(request, { maxBytes: HOSTED_REQUEST_BYTES }),
});
export { guardedHandler as GET, guardedHandler as POST };
