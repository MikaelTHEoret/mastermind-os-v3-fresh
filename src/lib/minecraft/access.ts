import type { NextRequest } from 'next/server';
import { ownerGateConfigured, requireOwner } from '@/lib/trading/auth';

export class MinecraftAccessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'MinecraftAccessError';
  }
}

const LOCAL_UI_HOSTS = new Set(['127.0.0.1', 'localhost']);

export async function requireMinecraftAccess(request: NextRequest): Promise<void> {
  if (process.env.VERCEL) {
    throw new MinecraftAccessError(503, 'LOCAL_CONTROL_REQUIRED', 'Minecraft machine control is available only from the command center running on this PC.');
  }
  if (process.env.MASTERMIND_LOCAL_CONTROL_ENABLED !== 'true') {
    throw new MinecraftAccessError(403, 'LOCAL_CONTROL_DISABLED', 'Local Minecraft control has not been explicitly enabled.');
  }

  const requestUrl = new URL(request.url);
  const host = request.headers.get('host');
  let hostUrl: URL;
  try { hostUrl = new URL(`http://${host ?? ''}`); }
  catch { throw new MinecraftAccessError(403, 'LOCAL_REQUEST_REQUIRED', 'Minecraft control accepts requests only from the local command center.'); }
  if (
    !LOCAL_UI_HOSTS.has(requestUrl.hostname) ||
    !LOCAL_UI_HOSTS.has(hostUrl.hostname) ||
    hostUrl.username ||
    hostUrl.password ||
    hostUrl.pathname !== '/' ||
    hostUrl.search ||
    hostUrl.hash
  ) {
    throw new MinecraftAccessError(403, 'LOCAL_REQUEST_REQUIRED', 'Minecraft control accepts requests only from the local command center.');
  }
  const expectedOrigin = `http://${hostUrl.host}`;
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (origin && origin !== expectedOrigin) {
    throw new MinecraftAccessError(403, 'ORIGIN_REJECTED', 'Cross-origin Minecraft control requests are not allowed.');
  }
  if (fetchSite && fetchSite !== 'same-origin') {
    throw new MinecraftAccessError(403, 'ORIGIN_REJECTED', 'Cross-site Minecraft control requests are not allowed.');
  }
  if (request.method !== 'GET' && (origin !== expectedOrigin || fetchSite !== 'same-origin')) {
    throw new MinecraftAccessError(403, 'ORIGIN_REQUIRED', 'Lifecycle actions require a same-origin browser request.');
  }

  if (ownerGateConfigured()) {
    const owner = await requireOwner();
    if (!owner.ok) {
      throw new MinecraftAccessError(owner.status, owner.status === 401 ? 'SIGN_IN_REQUIRED' : 'OWNER_REQUIRED', owner.reason);
    }
  }
}

export function getControlPlaneConfiguration(): { baseUrl: URL; token: string } {
  const configured = process.env.MASTERMIND_CONTROL_URL || 'http://127.0.0.1:43100';
  let baseUrl: URL;
  try { baseUrl = new URL(configured); }
  catch { throw new MinecraftAccessError(503, 'CONTROL_CONFIGURATION_INVALID', 'The local control URL is invalid.'); }
  if (
    baseUrl.protocol !== 'http:' ||
    baseUrl.hostname !== '127.0.0.1' ||
    baseUrl.port !== '43100' ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== '/' ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new MinecraftAccessError(503, 'CONTROL_CONFIGURATION_INVALID', 'The local control URL must be exactly http://127.0.0.1:43100.');
  }
  const token = process.env.MASTERMIND_CONTROL_TOKEN || '';
  if (token.length < 32) {
    throw new MinecraftAccessError(503, 'CONTROL_CONFIGURATION_INVALID', 'The local control token is missing or too short.');
  }
  return { baseUrl, token };
}
