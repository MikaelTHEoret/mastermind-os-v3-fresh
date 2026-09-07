import 'server-only';

import type { NextRequest } from 'next/server';
import { ownerGateConfigured, requireOwner } from '@/lib/trading/auth';

export class LocalServiceAccessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'LocalServiceAccessError';
  }
}

const LOCAL_UI_HOSTS = new Set(['127.0.0.1', 'localhost']);
const LOCAL_UI_AUTHORITY = /^(?:127\.0\.0\.1|localhost):3000$/i;

export async function requireLocalServiceAccess(request: NextRequest): Promise<void> {
  if (process.env.VERCEL) {
    throw new LocalServiceAccessError(
      503,
      'LOCAL_SERVICE_CONTROL_REQUIRED',
      'Service controls are available only from the command center running on this PC.',
    );
  }
  if (process.env.MASTERMIND_LOCAL_CONTROL_ENABLED !== 'true') {
    throw new LocalServiceAccessError(403, 'LOCAL_CONTROL_DISABLED', 'Local service control has not been explicitly enabled.');
  }

  const requestUrl = new URL(request.url);
  const host = request.headers.get('host');
  let hostUrl: URL;
  try {
    if (typeof host !== 'string' || !LOCAL_UI_AUTHORITY.test(host)) throw new Error('invalid local authority');
    hostUrl = new URL(`http://${host ?? ''}`);
  } catch {
    throw new LocalServiceAccessError(
      403,
      'LOCAL_REQUEST_REQUIRED',
      'Service controls accept requests only from the local command center.',
    );
  }
  if (
    requestUrl.protocol !== 'http:'
    || !LOCAL_UI_HOSTS.has(requestUrl.hostname)
    || requestUrl.port !== '3000'
    || requestUrl.username
    || requestUrl.password
    || !LOCAL_UI_HOSTS.has(hostUrl.hostname)
    || hostUrl.port !== requestUrl.port
    || hostUrl.username
    || hostUrl.password
    || hostUrl.pathname !== '/'
    || hostUrl.search
    || hostUrl.hash
  ) {
    throw new LocalServiceAccessError(
      403,
      'LOCAL_REQUEST_REQUIRED',
      'Service controls accept requests only from the local command center.',
    );
  }

  const expectedOrigin = `http://${hostUrl.host}`;
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (origin && origin !== expectedOrigin) {
    throw new LocalServiceAccessError(403, 'ORIGIN_REJECTED', 'Cross-origin service-control requests are not allowed.');
  }
  if (fetchSite && fetchSite !== 'same-origin') {
    throw new LocalServiceAccessError(403, 'ORIGIN_REJECTED', 'Cross-site service-control requests are not allowed.');
  }
  if (request.method !== 'GET' && (origin !== expectedOrigin || fetchSite !== 'same-origin')) {
    throw new LocalServiceAccessError(403, 'ORIGIN_REQUIRED', 'Service restarts require a same-origin browser request.');
  }

  if (ownerGateConfigured()) {
    const owner = await requireOwner();
    if (!owner.ok) {
      throw new LocalServiceAccessError(
        owner.status,
        owner.status === 401 ? 'SIGN_IN_REQUIRED' : 'OWNER_REQUIRED',
        owner.status === 401 ? 'Sign in as the command-center owner to use service controls.' : 'Only the command-center owner can use service controls.',
      );
    }
  }
}
