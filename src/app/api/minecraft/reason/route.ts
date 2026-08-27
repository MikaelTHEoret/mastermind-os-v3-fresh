import {
  LocalServiceRequestAuthError,
  LocalServiceRequestBodyError,
  authorizeLocalServiceRequest,
  readBoundedJsonRequestBody,
} from '@/lib/memory/local-service-auth';
import {
  FAMILY_REASONING_MAX_BYTES,
  FamilyReasoningContractError,
  validateFamilyReasoningRequest,
} from '@/lib/minecraft/reasoning-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
});

function errorResponse(status: number, code: string, message: string): Response {
  const headers = new Headers(HEADERS);
  if (status === 401) headers.set('WWW-Authenticate', 'Bearer');
  return Response.json({ ok: false, code, message }, { status, headers });
}

// This is intentionally POST-only and local-service-only. It is a compileable
// security boundary, not an active provider adapter. No Minecraft text reaches
// a model or the general MCP catalog while modelReasoning is disabled.
export async function POST(request: Request): Promise<Response> {
  try {
    authorizeLocalServiceRequest(request, {
      MASTERMIND_LOCAL_CONTROL_ENABLED: process.env.MASTERMIND_LOCAL_CONTROL_ENABLED,
      MASTERMIND_CONTROL_TOKEN: process.env.MASTERMIND_CONTROL_TOKEN,
      VERCEL: process.env.VERCEL,
    }, {
      method: 'POST',
      path: '/api/minecraft/reason',
      messages: {
        disabled: 'The local Minecraft reasoning lane is disabled.',
        loopbackRequired: 'The Minecraft reasoning lane accepts only direct loopback service requests.',
        unauthorized: 'A valid local control bearer token is required.',
      },
    });
    const raw = await readBoundedJsonRequestBody(request, { maxBytes: FAMILY_REASONING_MAX_BYTES });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return errorResponse(400, 'REASONING_REQUEST_INVALID', 'The reasoning request is not valid JSON.');
    }
    validateFamilyReasoningRequest(parsed);
    return errorResponse(503, 'FEATURE_DISABLED', 'Mastermind model reasoning is present as a disabled foundation stub.');
  } catch (error) {
    if (error instanceof LocalServiceRequestAuthError || error instanceof LocalServiceRequestBodyError) {
      return errorResponse(error.status, error.code, error.message);
    }
    if (error instanceof FamilyReasoningContractError) return errorResponse(400, error.code, error.message);
    return errorResponse(503, 'REASONING_BROKER_UNAVAILABLE', 'The local Minecraft reasoning boundary is unavailable.');
  }
}
