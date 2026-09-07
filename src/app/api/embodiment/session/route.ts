// Authenticated web hydration uses the same canonical service as hosted MCP and local stdio.
import { requireOwner } from '@/lib/trading/auth';
import { gatewayForAuthenticatedOwner } from '@/lib/mastermind-context/gateway';
import { LocalServiceRequestBodyError, readBoundedJsonRequestBody } from '@/lib/memory/local-service-auth';
import { HOSTED_REQUEST_BYTES, callHostedTool, hostedToolEnvelope, hostedToolFailure } from '../../../../../services/mastermind-context-gateway/src/hosted-adapter.mjs';
import { ContextGatewayError } from '../../../../../services/mastermind-context-gateway/src/validation.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ ok: false, code: 'ORIGIN_DENIED' }, { status: 403, headers });
  }
  const owner = await requireOwner();
  if (!owner.ok) return Response.json({ ok: false, code: 'OWNER_REQUIRED' }, { status: owner.status, headers });
  try {
    const raw = await readBoundedJsonRequestBody(request, { maxBytes: HOSTED_REQUEST_BYTES });
    const input: unknown = JSON.parse(raw);
    const gateway = await gatewayForAuthenticatedOwner(owner.userId);
    const result = hostedToolEnvelope(await callHostedTool(gateway, 'mastermind_bootstrap', input));
    return Response.json(result.structuredContent, { headers });
  } catch (error) {
    const status = error instanceof ContextGatewayError || error instanceof LocalServiceRequestBodyError ? error.status : 400;
    return Response.json(hostedToolFailure(error).structuredContent, { status, headers });
  }
}
