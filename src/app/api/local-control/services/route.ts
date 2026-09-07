import type { NextRequest } from 'next/server';
import { requireLocalServiceAccess } from '@/lib/local-control/access';
import { getLocalServiceInventory } from '@/lib/local-control/service-client';
import {
  LocalServiceRequestError,
  assertBodylessRequest,
  localServiceErrorResponse,
  localServiceJson,
} from '@/lib/local-control/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireLocalServiceAccess(request);
    await assertBodylessRequest(request, 'Service inventory');
    if ([...request.nextUrl.searchParams.keys()].length > 0) {
      throw new LocalServiceRequestError(400, 'INVALID_SERVICE_QUERY', 'Service inventory does not accept query fields.');
    }
    return localServiceJson(await getLocalServiceInventory());
  } catch (error) {
    return localServiceErrorResponse(error);
  }
}
