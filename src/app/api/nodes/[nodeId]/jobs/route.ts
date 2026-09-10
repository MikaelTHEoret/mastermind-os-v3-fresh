import { getMemoryDb } from '@/lib/db';
import {
  authorizeOwnerRequest,
  errorResponse,
  jsonResponse,
  readNodeJson,
  readOwnerJobRequest,
} from '@/lib/node-exchange/http';
import { enqueueCoreStatusJob, enqueueEnsureRunningJob } from '@/lib/node-exchange/store';
import { MASTERMIND_CORE_STATUS_CAPABILITY } from '../../../../../../protocol/mastermind-node-exchange/contract.mjs';
import { requireOwner } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = Readonly<{ params: Promise<{ nodeId: string }> }>;

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { nodeId } = await context.params;
  const path = `/api/nodes/${nodeId}/jobs`;
  try {
    authorizeOwnerRequest(request, path, true);
    const owner = await requireOwner();
    if (!owner.ok) return jsonResponse({ ok: false, error: { code: 'OWNER_REQUIRED', message: owner.reason } }, owner.status);
    const body = readOwnerJobRequest(await readNodeJson(request, 1024));
    const enqueue = body.capability === MASTERMIND_CORE_STATUS_CAPABILITY
      ? enqueueCoreStatusJob : enqueueEnsureRunningJob;
    const result = await enqueue(getMemoryDb(), nodeId, body.requestId);
    return jsonResponse({ ok: true, ...result }, result.status === 'created' ? 201 : 200);
  } catch (error) {
    return errorResponse(error);
  }
}
