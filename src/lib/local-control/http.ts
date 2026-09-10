import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { LocalServiceAccessError } from './access';
import { LocalServiceClientError } from './service-client';

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
} as const;

export class LocalServiceRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'LocalServiceRequestError';
  }
}

export function localServiceJson(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, { status, headers: RESPONSE_HEADERS });
}

export function localServiceErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof LocalServiceAccessError
    || error instanceof LocalServiceClientError
    || error instanceof LocalServiceRequestError
  ) {
    return localServiceJson({ ok: false, code: error.code, message: error.message }, error.status);
  }
  return localServiceJson(
    { ok: false, code: 'SERVICE_CONTROL_BOUNDARY_ERROR', message: 'The local service-control boundary failed safely.' },
    500,
  );
}

export async function assertBodylessRequest(request: NextRequest, label: string): Promise<void> {
  const contentLength = request.headers.get('content-length');
  if (
    request.headers.has('transfer-encoding')
    || request.body !== null
    || (contentLength !== null && contentLength !== '0')
  ) {
    await request.body?.cancel('unexpected request body').catch(() => undefined);
    throw new LocalServiceRequestError(400, 'UNEXPECTED_BODY', `${label} does not accept a request body.`);
  }
}

function assertNoDuplicateJsonKeys(text: string, label: string): void {
  let index = 0;
  let nodes = 0;
  const maximumDepth = 16;
  const maximumNodes = 256;
  const whitespace = /\s/u;
  const skipWhitespace = () => {
    while (index < text.length && whitespace.test(text[index])) index += 1;
  };
  const parseString = (): string => {
    if (text[index] !== '"') throw new Error('expected JSON string');
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === '\\') {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        index += 1;
        const parsed: unknown = JSON.parse(text.slice(start, index));
        if (typeof parsed !== 'string') throw new Error('invalid JSON string');
        return parsed;
      }
      index += 1;
    }
    throw new Error('unterminated JSON string');
  };
  const parseValue = (depth = 0): void => {
    nodes += 1;
    if (depth > maximumDepth || nodes > maximumNodes) throw new Error('JSON structure limit exceeded');
    skipWhitespace();
    if (text[index] === '{') {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      while (index < text.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) {
          throw new LocalServiceRequestError(400, 'DUPLICATE_JSON_KEY', `${label} contains a duplicate JSON object key.`);
        }
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') throw new Error('expected JSON colon');
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return;
        }
        if (text[index] !== ',') throw new Error('expected JSON object separator');
        index += 1;
      }
      throw new Error('unterminated JSON object');
    }
    if (text[index] === '[') {
      index += 1;
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      while (index < text.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return;
        }
        if (text[index] !== ',') throw new Error('expected JSON array separator');
        index += 1;
      }
      throw new Error('unterminated JSON array');
    }
    if (text[index] === '"') {
      parseString();
      return;
    }
    const start = index;
    while (index < text.length && !/[\s,}\]]/u.test(text[index])) index += 1;
    if (start === index) throw new Error('expected JSON value');
  };
  parseValue();
  skipWhitespace();
  if (index !== text.length) throw new Error('unexpected trailing JSON content');
}

export async function readBoundedJsonBody(
  request: NextRequest,
  label: string,
  maximumBytes = 1024,
): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.trim() ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    await request.body?.cancel('unsupported content type').catch(() => undefined);
    throw new LocalServiceRequestError(415, 'UNSUPPORTED_CONTENT_TYPE', `${label} accepts only UTF-8 JSON.`);
  }
  const contentEncoding = request.headers.get('content-encoding');
  if (contentEncoding && contentEncoding.trim().toLowerCase() !== 'identity') {
    await request.body?.cancel('unsupported content encoding').catch(() => undefined);
    throw new LocalServiceRequestError(415, 'UNSUPPORTED_CONTENT_ENCODING', `${label} does not accept encoded bodies.`);
  }

  const contentLength = request.headers.get('content-length');
  let declaredBytes: number | null = null;
  if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(contentLength)) {
      await request.body?.cancel('invalid content length').catch(() => undefined);
      throw new LocalServiceRequestError(400, 'INVALID_CONTENT_LENGTH', `${label} has an invalid Content-Length.`);
    }
    declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximumBytes) {
      await request.body?.cancel('body too large').catch(() => undefined);
      throw new LocalServiceRequestError(413, 'BODY_TOO_LARGE', `${label} is too large.`);
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw new LocalServiceRequestError(400, 'INVALID_JSON', `${label} must contain one JSON object.`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let receivedBytes = 0;
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes || (declaredBytes !== null && receivedBytes > declaredBytes)) {
        await reader.cancel('request body exceeded its declared or allowed size').catch(() => undefined);
        throw new LocalServiceRequestError(
          receivedBytes > maximumBytes ? 413 : 400,
          receivedBytes > maximumBytes ? 'BODY_TOO_LARGE' : 'CONTENT_LENGTH_MISMATCH',
          receivedBytes > maximumBytes ? `${label} is too large.` : `${label} did not match its Content-Length.`,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (!finished) await reader.cancel('request body rejected').catch(() => undefined);
    if (error instanceof LocalServiceRequestError) throw error;
    throw new LocalServiceRequestError(400, 'INVALID_JSON', `${label} is not valid UTF-8 JSON.`);
  } finally {
    reader.releaseLock();
  }

  if (declaredBytes !== null && receivedBytes !== declaredBytes) {
    throw new LocalServiceRequestError(400, 'CONTENT_LENGTH_MISMATCH', `${label} did not match its Content-Length.`);
  }
  try {
    assertNoDuplicateJsonKeys(text, label);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof LocalServiceRequestError) throw error;
    throw new LocalServiceRequestError(400, 'INVALID_JSON', `${label} is not valid JSON.`);
  }
}
