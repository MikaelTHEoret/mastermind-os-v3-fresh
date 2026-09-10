// Existing PR #2 compatibility discovery; public metadata contains no memory or credentials.
import { authServerMetadataHandlerClerk, metadataCorsOptionsRequestHandler } from '@clerk/mcp-tools/next';
import { hostedOAuthPolicy, hostedOAuthFailure, HostedOAuthError, metadataCorsHeaders } from '../../../../services/mastermind-context-gateway/src/hosted-oauth-policy.mjs';
export const dynamic = 'force-dynamic';
const handler = authServerMetadataHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();
export async function GET() {
  try {
    const policy = hostedOAuthPolicy(process.env);
    const response = await handler();
    const metadata = await response.json();
    if (!response.ok || metadata?.issuer !== policy.issuer) throw new HostedOAuthError('OAUTH_METADATA_ISSUER_MISMATCH', 503);
    return Response.json(metadata, { headers: metadataCorsHeaders });
  } catch (error) { return hostedOAuthFailure(error, undefined, { metadata: true }); }
}
export { corsHandler as OPTIONS };
