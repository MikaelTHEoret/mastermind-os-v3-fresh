import { getMemoryDb } from '@/lib/db';
import { authorizeOwnerRequest, errorResponse, jsonResponse } from '@/lib/node-exchange/http';
import { getLatestOwnerCoreStatusJob } from '@/lib/node-exchange/store';
import { requireOwner } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = Readonly<{ params: Promise<{ nodeId: string }> }>;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { nodeId } = await context.params;
  try {
    authorizeOwnerRequest(request, `/api/nodes/${nodeId}/core-status`, false);
    const owner = await requireOwner();
    if (!owner.ok) return jsonResponse({ ok: false, error: { code: 'OWNER_REQUIRED', message: owner.reason } }, owner.status);
    return jsonResponse({ ok: true, job: await getLatestOwnerCoreStatusJob(getMemoryDb(), nodeId) });
  } catch (error) { return errorResponse(error); }
}
