import { getMemoryDb } from '@/lib/db';
import { authorizeOwnerRequest, errorResponse, jsonResponse } from '@/lib/node-exchange/http';
import { listOwnerNodes } from '@/lib/node-exchange/store';
import { requireOwner } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PATH = '/api/nodes';

export async function GET(request: Request): Promise<Response> {
  try {
    authorizeOwnerRequest(request, PATH, false);
    const owner = await requireOwner();
    if (!owner.ok) return jsonResponse({ ok: false, error: { code: 'OWNER_REQUIRED', message: owner.reason } }, owner.status);
    return jsonResponse({ ok: true, nodes: await listOwnerNodes(getMemoryDb()) });
  } catch (error) {
    return errorResponse(error);
  }
}
