import { hostedOAuthPolicy, hostedOAuthFailure, metadataCorsHeaders, protectedHostedMetadata } from '../../../../../services/mastermind-context-gateway/src/hosted-oauth-policy.mjs';
export const dynamic = 'force-dynamic';
export function GET() {
  try { return Response.json(protectedHostedMetadata(hostedOAuthPolicy(process.env)), { headers: metadataCorsHeaders }); }
  catch (error) { return hostedOAuthFailure(error, undefined, { metadata: true }); }
}
export function OPTIONS() { return new Response(null, { status: 204, headers: metadataCorsHeaders }); }
