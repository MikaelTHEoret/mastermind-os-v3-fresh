import { getMemoryDb } from '@/lib/db';
import { authorizeOwnerRequest, errorResponse, jsonResponse } from '@/lib/node-exchange/http';
import { getOwnerJob } from '@/lib/node-exchange/store';
import { requireOwner } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = Readonly<{ params: Promise<{ nodeId: string; jobId: string }> }>;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { nodeId, jobId } = await context.params;
  const path = `/api/nodes/${nodeId}/jobs/${jobId}`;
  try {
    authorizeOwnerRequest(request, path, false);
    const owner = await requireOwner();
    if (!owner.ok) return jsonResponse({ ok: false, error: { code: 'OWNER_REQUIRED', message: owner.reason } }, owner.status);
    return jsonResponse({ ok: true, job: await getOwnerJob(getMemoryDb(), nodeId, jobId) });
  } catch (error) {
    return errorResponse(error);
  }
}
