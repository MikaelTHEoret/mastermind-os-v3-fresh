import type { NextRequest } from 'next/server';
import { requireLocalServiceAccess } from '@/lib/local-control/access';
import { restartMinecraftControlAgent } from '@/lib/local-control/service-client';
import {
  LocalServiceRequestError,
  localServiceErrorResponse,
  localServiceJson,
  readBoundedJsonBody,
} from '@/lib/local-control/http';
import {
  LOCAL_SERVICE_ROLES,
  LocalServiceProtocolError,
  RESTARTABLE_LOCAL_SERVICE_ROLE,
  parseLocalServiceRestartBody,
} from '@/lib/local-control/protocol.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ role: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await requireLocalServiceAccess(request);
    const { role } = await context.params;
    if (role !== RESTARTABLE_LOCAL_SERVICE_ROLE) {
      if (LOCAL_SERVICE_ROLES.includes(role)) {
        throw new LocalServiceRequestError(
          403,
          'SERVICE_RESTART_NOT_ALLOWED',
          'The web interface cannot restart that command-center service.',
        );
      }
      throw new LocalServiceRequestError(404, 'SERVICE_NOT_FOUND', 'The requested local service does not exist.');
    }
    if ([...request.nextUrl.searchParams.keys()].length > 0) {
      throw new LocalServiceRequestError(400, 'INVALID_SERVICE_QUERY', 'Service restart does not accept query fields.');
    }

    const input = await readBoundedJsonBody(request, 'Service restart request');
    let restart: { requestId: string; expectedGeneration: number };
    try {
      const parsed = parseLocalServiceRestartBody(input) as { requestId: string; expectedGeneration: number };
      restart = { requestId: parsed.requestId, expectedGeneration: parsed.expectedGeneration };
    } catch (error) {
      if (error instanceof LocalServiceProtocolError) {
        throw new LocalServiceRequestError(400, 'INVALID_RESTART_REQUEST', 'The service restart request is invalid.');
      }
      throw error;
    }
    return localServiceJson(await restartMinecraftControlAgent(restart), 202);
  } catch (error) {
    return localServiceErrorResponse(error);
  }
}
