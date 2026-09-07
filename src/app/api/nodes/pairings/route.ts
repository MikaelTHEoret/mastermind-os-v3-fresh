import { getMemoryDb } from '@/lib/db';
import {
  authorizeOwnerRequest,
  errorResponse,
  jsonResponse,
  requireEmptyRequestBody,
} from '@/lib/node-exchange/http';
import { createOwnerPairing } from '@/lib/node-exchange/store';
import { requireOwner } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PATH = '/api/nodes/pairings';

export async function POST(request: Request): Promise<Response> {
  try {
    authorizeOwnerRequest(request, PATH, true);
    const owner = await requireOwner();
    if (!owner.ok) return jsonResponse({ ok: false, error: { code: 'OWNER_REQUIRED', message: owner.reason } }, owner.status);
    await requireEmptyRequestBody(request);
    const pairing = await createOwnerPairing(getMemoryDb());
    return jsonResponse({ ok: true, ...pairing }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
