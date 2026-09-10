import { getMemoryDb } from '@/lib/db';
import { authorizeMachineRequest, errorResponse, jsonResponse, readNodeJson } from '@/lib/node-exchange/http';
import { claimNodePairing } from '@/lib/node-exchange/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PATH = '/api/node/v1/pair';

export async function POST(request: Request): Promise<Response> {
  try {
    const pairingCredential = authorizeMachineRequest(request, PATH);
    const body = await readNodeJson(request, 4 * 1024);
    return jsonResponse(await claimNodePairing(getMemoryDb(), pairingCredential, body));
  } catch (error) {
    return errorResponse(error);
  }
}
