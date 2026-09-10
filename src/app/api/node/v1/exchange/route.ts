import { getMemoryDb } from '@/lib/db';
import { authorizeMachineRequest, errorResponse, jsonResponse, readNodeJson } from '@/lib/node-exchange/http';
import { NODE_EXCHANGE_MAX_BODY_BYTES, exchangeNodeState } from '@/lib/node-exchange/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PATH = '/api/node/v1/exchange';

export async function POST(request: Request): Promise<Response> {
  try {
    const nodeCredential = authorizeMachineRequest(request, PATH);
    const body = await readNodeJson(request, NODE_EXCHANGE_MAX_BODY_BYTES);
    return jsonResponse(await exchangeNodeState(getMemoryDb(), nodeCredential, body));
  } catch (error) {
    return errorResponse(error);
  }
}
