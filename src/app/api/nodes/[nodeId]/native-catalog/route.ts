import {getMemoryDb} from '@/lib/db';
import {authorizeOwnerRequest,errorResponse,jsonResponse,readNodeJson} from '@/lib/node-exchange/http';
import {enqueueOwnerNativeCatalogJob} from '@/lib/node-exchange/store';
import {requireOwner} from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = Readonly<{params: Promise<{nodeId: string}>}>;

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const {nodeId} = await context.params;
  try {
    authorizeOwnerRequest(request, `/api/nodes/${nodeId}/native-catalog`, true);
    const owner = await requireOwner();
    if (!owner.ok) return jsonResponse({ok:false,error:{code:'OWNER_REQUIRED',message:owner.reason}},owner.status);
    const input = await readNodeJson(request,4096);
    const result = await enqueueOwnerNativeCatalogJob(getMemoryDb(),nodeId,input);
    return jsonResponse({ok:true,...result},result.status === 'created' ? 201 : 200);
  } catch (error) { return errorResponse(error); }
}
