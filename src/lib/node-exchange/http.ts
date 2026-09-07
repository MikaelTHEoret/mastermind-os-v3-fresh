import {
  LocalServiceRequestBodyError,
  readBoundedJsonRequestBody,
} from '@/lib/memory/local-service-auth';
import { MASTERMIND_NODE_CAPABILITY, MASTERMIND_CORE_STATUS_CAPABILITY } from '../../../protocol/mastermind-node-exchange/contract.mjs';

import { NodeExchangeServiceError } from './store';

export const NODE_EXCHANGE_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class NodeExchangeHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'NodeExchangeHttpError';
    this.status = status;
    this.code = code;
  }
}

function reject(status: number, code: string, message: string): never {
  throw new NodeExchangeHttpError(status, code, message);
}

function exactPath(request: Request, expectedPath: string): URL {
  let url: URL;
  try { url = new URL(request.url); }
  catch { reject(400, 'NODE_REQUEST_INVALID', 'The request URL is invalid.'); }
  if (url.pathname !== expectedPath || url.search || url.hash || url.username || url.password) {
    reject(404, 'NODE_ROUTE_NOT_FOUND', 'The node exchange route was not found.');
  }
  return url;
}

export function authorizeMachineRequest(request: Request, expectedPath: string): string {
  exactPath(request, expectedPath);
  if (request.method !== 'POST') reject(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
  if (request.headers.has('origin') || request.headers.has('sec-fetch-site')) {
    reject(403, 'NODE_MACHINE_REQUEST_REQUIRED', 'Browser-originated machine requests are not accepted.');
  }
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9._-]{1,128})$/.exec(authorization);
  if (!match) reject(401, 'NODE_CREDENTIAL_REQUIRED', 'A node bearer credential is required.');
  return match[1];
}

export function authorizeOwnerRequest(request: Request, expectedPath: string, mutation: boolean): void {
  const url = exactPath(request, expectedPath);
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    reject(403, 'NODE_OWNER_ORIGIN_REQUIRED', 'The node control requires a same-origin request.');
  }
  if (mutation) {
    if (request.method !== 'POST') reject(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
    if (request.headers.get('origin') !== url.origin || fetchSite !== 'same-origin') {
      reject(403, 'NODE_OWNER_ORIGIN_REQUIRED', 'The node control requires a same-origin browser request.');
    }
  } else if (request.method !== 'GET') {
    reject(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
  }
}

async function rejectUnexpectedBody(request: Request): Promise<never> {
  await request.body?.cancel('request body not allowed').catch(() => undefined);
  reject(400, 'NODE_BODY_NOT_ALLOWED', 'This request does not accept a body.');
}

export async function requireEmptyRequestBody(request: Request): Promise<void> {
  if (
    request.headers.has('content-type')
    || request.headers.has('content-encoding')
    || request.headers.has('transfer-encoding')
  ) {
    await rejectUnexpectedBody(request);
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && contentLength !== '0') {
    await rejectUnexpectedBody(request);
  }

  if (request.body === null) return;

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    reader = request.body.getReader();
  } catch {
    // The stream is already locked or otherwise unreadable, so its emptiness
    // cannot be established at this boundary.
  }
  if (reader === null) return rejectUnexpectedBody(request);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value.byteLength !== 0) {
        await reader.cancel('request body not allowed').catch(() => undefined);
        reject(400, 'NODE_BODY_NOT_ALLOWED', 'This request does not accept a body.');
      }
    }
  } catch (error) {
    if (error instanceof NodeExchangeHttpError) throw error;
    await reader.cancel('request body not allowed').catch(() => undefined);
    reject(400, 'NODE_BODY_NOT_ALLOWED', 'This request does not accept a body.');
  } finally {
    reader.releaseLock();
  }
}

export async function readNodeJson(request: Request, maxBytes: number): Promise<unknown> {
  let raw: string;
  try {
    raw = await readBoundedJsonRequestBody(request, { maxBytes });
  } catch (error) {
    if (error instanceof LocalServiceRequestBodyError) {
      reject(error.status, error.code, error.message);
    }
    throw error;
  }
  if (raw.length === 0) reject(400, 'NODE_BODY_REQUIRED', 'A JSON request body is required.');
  try { return JSON.parse(raw); }
  catch { reject(400, 'NODE_JSON_INVALID', 'The request body is not valid JSON.'); }
}

export function readOwnerJobRequest(value: unknown): Readonly<{
  capability: typeof MASTERMIND_NODE_CAPABILITY | typeof MASTERMIND_CORE_STATUS_CAPABILITY;
  requestId: string;
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reject(400, 'NODE_REQUEST_INVALID', 'The job request must be an object.');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join('\0') !== 'capability\0requestId'
    || (body.capability !== MASTERMIND_NODE_CAPABILITY && body.capability !== MASTERMIND_CORE_STATUS_CAPABILITY)
    || typeof body.requestId !== 'string' || !UUID.test(body.requestId)) {
    reject(400, 'NODE_REQUEST_INVALID', 'The job request is invalid or unsupported.');
  }
  return Object.freeze({ capability: body.capability, requestId: body.requestId });
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: NODE_EXCHANGE_RESPONSE_HEADERS });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof NodeExchangeHttpError || error instanceof NodeExchangeServiceError) {
    return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, error.status);
  }
  const contractCode = typeof (error as { code?: unknown })?.code === 'string'
    && String((error as { code: string }).code).startsWith('NODE_')
    ? String((error as { code: string }).code)
    : null;
  if (contractCode) {
    return jsonResponse({ ok: false, error: { code: contractCode, message: 'The node protocol message is invalid.' } }, 400);
  }
  return jsonResponse({ ok: false, error: { code: 'NODE_INTERNAL_ERROR', message: 'The node request could not be completed.' } }, 500);
}
