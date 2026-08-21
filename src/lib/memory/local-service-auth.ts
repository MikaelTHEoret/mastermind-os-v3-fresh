import crypto from 'node:crypto';

export type LocalServiceAuthEnvironment = Readonly<{
  MASTERMIND_LOCAL_CONTROL_ENABLED?: string;
  MASTERMIND_CONTROL_TOKEN?: string;
  VERCEL?: string;
}>;

export type LocalServiceAuthPolicy = Readonly<{
  method: 'POST';
  path: `/${string}`;
  messages: Readonly<{
    disabled: string;
    loopbackRequired: string;
    unauthorized: string;
  }>;
}>;

export class LocalServiceRequestAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'LocalServiceRequestAuthError';
    this.status = status;
    this.code = code;
  }
}

export class LocalServiceRequestBodyError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'LocalServiceRequestBodyError';
    this.status = status;
    this.code = code;
  }
}

function reject(status: number, code: string, message: string): never {
  throw new LocalServiceRequestAuthError(status, code, message);
}

function rejectBody(status: number, code: string, message: string): never {
  throw new LocalServiceRequestBodyError(status, code, message);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function validatePolicy(policy: LocalServiceAuthPolicy): void {
  if (!policy || policy.method !== 'POST' || typeof policy.path !== 'string'
    || !/^\/[A-Za-z0-9/_-]+$/.test(policy.path)
    || !policy.messages || typeof policy.messages !== 'object' || Array.isArray(policy.messages)
    || Object.keys(policy.messages).sort().join('\0') !== 'disabled\0loopbackRequired\0unauthorized'
    || Object.values(policy.messages).some((value) => (
      typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\r\n\0]/.test(value)
    ))) {
    throw new TypeError('The local service authorization policy is invalid.');
  }
}

export function authorizeLocalServiceRequest(
  request: Request,
  env: LocalServiceAuthEnvironment,
  policy: LocalServiceAuthPolicy,
): void {
  validatePolicy(policy);
  if (request.method !== policy.method) reject(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
  if (env.VERCEL || env.MASTERMIND_LOCAL_CONTROL_ENABLED !== 'true') {
    reject(403, 'LOCAL_CONTROL_DISABLED', policy.messages.disabled);
  }

  const expectedToken = env.MASTERMIND_CONTROL_TOKEN ?? '';
  if (expectedToken.length < 32 || expectedToken.length > 512) {
    reject(503, 'CONTROL_CONFIGURATION_INVALID', 'The local control token is not configured correctly.');
  }

  let requestUrl: URL;
  let hostUrl: URL;
  try {
    requestUrl = new URL(request.url);
    hostUrl = new URL(`http://${request.headers.get('host') ?? ''}`);
  } catch {
    reject(403, 'LOOPBACK_REQUEST_REQUIRED', policy.messages.loopbackRequired);
  }
  if (
    requestUrl.protocol !== 'http:'
    // Next may represent its internally constructed Request.url as localhost
    // even though the service connected to, and supplied, Host: 127.0.0.1.
    || (requestUrl.hostname !== '127.0.0.1' && requestUrl.hostname !== 'localhost')
    || requestUrl.pathname !== policy.path
    || requestUrl.search !== ''
    || requestUrl.hash !== ''
    || requestUrl.username !== ''
    || requestUrl.password !== ''
    || hostUrl.hostname !== '127.0.0.1'
    || hostUrl.port !== requestUrl.port
    || hostUrl.username !== ''
    || hostUrl.password !== ''
    || hostUrl.pathname !== '/'
    || hostUrl.search !== ''
    || hostUrl.hash !== ''
    || request.headers.has('origin')
    || request.headers.has('sec-fetch-site')
  ) {
    reject(403, 'LOOPBACK_REQUEST_REQUIRED', policy.messages.loopbackRequired);
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (!constantTimeEqual(authorization, `Bearer ${expectedToken}`)) {
    reject(401, 'UNAUTHORIZED', policy.messages.unauthorized);
  }
}

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

export async function readBoundedJsonRequestBody(
  request: Request,
  options: Readonly<{ maxBytes: number }>,
): Promise<string> {
  const maxBytes = options?.maxBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) {
    throw new TypeError('The JSON request-body byte limit is invalid.');
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    rejectBody(415, 'UNSUPPORTED_CONTENT_TYPE', 'The request accepts canonical JSON only.');
  }
  const encoding = request.headers.get('content-encoding');
  if (encoding !== null && encoding.toLowerCase() !== 'identity') {
    rejectBody(415, 'UNSUPPORTED_CONTENT_ENCODING', 'Encoded request bodies are not supported.');
  }

  const contentLength = request.headers.get('content-length');
  let declaredLength: number | null = null;
  if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(contentLength)) {
      rejectBody(400, 'INVALID_CONTENT_LENGTH', 'The request Content-Length is invalid.');
    }
    declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      rejectBody(413, 'BODY_TOO_LARGE', 'The request body exceeds its byte limit.');
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    if (declaredLength !== null && declaredLength !== 0) {
      rejectBody(400, 'CONTENT_LENGTH_MISMATCH', 'The request body does not match its Content-Length.');
    }
    return '';
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let rawJson = '';
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes || (declaredLength !== null && received > declaredLength)) {
        await reader.cancel('JSON request body limit exceeded').catch(() => undefined);
        rejectBody(
          received > maxBytes ? 413 : 400,
          received > maxBytes ? 'BODY_TOO_LARGE' : 'CONTENT_LENGTH_MISMATCH',
          received > maxBytes
            ? 'The request body exceeds its byte limit.'
            : 'The request body does not match its Content-Length.',
        );
      }
      rawJson += decoder.decode(value, { stream: true });
    }
    rawJson += decoder.decode();
  } catch (error) {
    if (error instanceof LocalServiceRequestBodyError) throw error;
    rejectBody(400, 'INVALID_UTF8', 'The request body is not valid UTF-8.');
  } finally {
    reader.releaseLock();
  }

  if (declaredLength !== null && received !== declaredLength) {
    rejectBody(400, 'CONTENT_LENGTH_MISMATCH', 'The request body does not match its Content-Length.');
  }
  return rawJson;
}
