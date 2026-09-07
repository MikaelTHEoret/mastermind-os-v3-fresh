import { parseMastermindNodePairingCredential } from '../../../protocol/mastermind-node-exchange/contract.mjs';

export const LOCAL_NODE_PAIRING_BODY_MAX_BYTES = 512;
export const LOCAL_NODE_PAIRING_DISPLAY_NAME = 'Family Node';

const LOCAL_AUTHORITIES = new Set(['127.0.0.1:3000', 'localhost:3000']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_DIAGNOSTIC_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;
const SAFE_DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{1,63}$/u;

export class LocalNodePairingError extends Error {
  constructor(status, code, message, options) {
    super(message, options);
    this.name = 'LocalNodePairingError';
    this.status = status;
    this.code = code;
  }
}

function localError(status, code, message, cause) {
  return new LocalNodePairingError(status, code, message, cause ? { cause } : undefined);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw localError(400, 'INVALID_PAIRING_REQUEST', `${label} must be one JSON object.`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw localError(400, 'INVALID_PAIRING_REQUEST', `${label} contains unsupported fields.`);
  }
  return value;
}

function assertNoDuplicateJsonKeys(text) {
  let index = 0;
  let nodes = 0;
  const keysAtDepth = [];
  const whitespace = /\s/u;
  const skipWhitespace = () => {
    while (index < text.length && whitespace.test(text[index])) index += 1;
  };
  const parseString = () => {
    if (text[index] !== '"') throw new Error('expected string');
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === '\\') {
        index += 2;
      } else if (text[index] === '"') {
        index += 1;
        const parsed = JSON.parse(text.slice(start, index));
        if (typeof parsed !== 'string') throw new Error('invalid string');
        return parsed;
      } else {
        index += 1;
      }
    }
    throw new Error('unterminated string');
  };
  const parseValue = (depth = 0) => {
    nodes += 1;
    if (depth > 8 || nodes > 32) throw new Error('JSON structure limit exceeded');
    skipWhitespace();
    if (text[index] === '{') {
      index += 1;
      skipWhitespace();
      keysAtDepth[depth] = new Set();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      while (index < text.length) {
        skipWhitespace();
        const key = parseString();
        if (keysAtDepth[depth].has(key)) {
          throw localError(400, 'DUPLICATE_JSON_KEY', 'The local pairing request contains a duplicate field.');
        }
        keysAtDepth[depth].add(key);
        skipWhitespace();
        if (text[index] !== ':') throw new Error('expected colon');
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return;
        }
        if (text[index] !== ',') throw new Error('expected separator');
        index += 1;
      }
      throw new Error('unterminated object');
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
        if (text[index] !== ',') throw new Error('expected separator');
        index += 1;
      }
      throw new Error('unterminated array');
    }
    if (text[index] === '"') {
      parseString();
      return;
    }
    const start = index;
    while (index < text.length && !/[\s,}\]]/u.test(text[index])) index += 1;
    if (start === index) throw new Error('expected value');
  };
  parseValue();
  skipWhitespace();
  if (index !== text.length) throw new Error('trailing JSON');
}

export function assertLocalNodePairingAccess(request, environment = process.env) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new TypeError('A process environment object is required');
  }
  if (hasOwn(environment, 'VERCEL')) {
    throw localError(
      503,
      'LOCAL_PAIRING_REQUIRED',
      'This pairing receiver is available only on the Family Node computer.',
    );
  }
  if (!request || typeof request !== 'object' || request.method !== 'POST' || !request.headers) {
    throw localError(405, 'METHOD_NOT_ALLOWED', 'The local pairing receiver accepts only POST requests.');
  }
  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    throw localError(403, 'LOCAL_REQUEST_REQUIRED', 'Pairing must come from this local command center.');
  }
  const requestAuthority = requestUrl.host.toLowerCase();
  const host = request.headers.get('host')?.toLowerCase() ?? '';
  if (
    requestUrl.protocol !== 'http:'
    || !LOCAL_AUTHORITIES.has(requestAuthority)
    || !LOCAL_AUTHORITIES.has(host)
    || requestUrl.pathname !== '/api/node/pair-local'
    || requestUrl.search !== ''
    || requestUrl.hash !== ''
    || requestUrl.username !== ''
    || requestUrl.password !== ''
  ) {
    throw localError(403, 'LOCAL_REQUEST_REQUIRED', 'Pairing must come from this local command center.');
  }
  if (
    request.headers.get('origin') !== `http://${host}`
    || request.headers.get('sec-fetch-site') !== 'same-origin'
  ) {
    throw localError(403, 'ORIGIN_REQUIRED', 'Pairing requires the local one-click page.');
  }
}

export async function readLocalNodePairingJson(request, maximumBytes = LOCAL_NODE_PAIRING_BODY_MAX_BYTES) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 128 || maximumBytes > 4096) {
    throw new TypeError('maximumBytes must be an integer between 128 and 4096');
  }
  const contentType = request.headers.get('content-type')?.trim() ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    await request.body?.cancel('unsupported content type').catch(() => undefined);
    throw localError(415, 'UNSUPPORTED_CONTENT_TYPE', 'The local pairing receiver accepts only UTF-8 JSON.');
  }
  const contentEncoding = request.headers.get('content-encoding');
  if ((contentEncoding && contentEncoding.trim().toLowerCase() !== 'identity')
    || request.headers.has('transfer-encoding')) {
    await request.body?.cancel('unsupported body encoding').catch(() => undefined);
    throw localError(415, 'UNSUPPORTED_BODY_ENCODING', 'The local pairing request must be sent directly.');
  }

  const contentLength = request.headers.get('content-length');
  let declaredBytes = null;
  if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/u.test(contentLength)) {
      await request.body?.cancel('invalid content length').catch(() => undefined);
      throw localError(400, 'INVALID_CONTENT_LENGTH', 'The local pairing request length is invalid.');
    }
    declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximumBytes) {
      await request.body?.cancel('body too large').catch(() => undefined);
      throw localError(413, 'BODY_TOO_LARGE', 'The local pairing request is too large.');
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw localError(400, 'INVALID_JSON', 'The local pairing request must contain one JSON object.');
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
        await reader.cancel('body exceeded its limit').catch(() => undefined);
        throw localError(
          receivedBytes > maximumBytes ? 413 : 400,
          receivedBytes > maximumBytes ? 'BODY_TOO_LARGE' : 'CONTENT_LENGTH_MISMATCH',
          receivedBytes > maximumBytes
            ? 'The local pairing request is too large.'
            : 'The local pairing request length did not match its body.',
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (!finished) await reader.cancel('body rejected').catch(() => undefined);
    if (error instanceof LocalNodePairingError) throw error;
    throw localError(400, 'INVALID_JSON', 'The local pairing request is not valid UTF-8 JSON.', error);
  } finally {
    reader.releaseLock();
  }
  if (declaredBytes !== null && declaredBytes !== receivedBytes) {
    throw localError(400, 'CONTENT_LENGTH_MISMATCH', 'The local pairing request length did not match its body.');
  }
  try {
    assertNoDuplicateJsonKeys(text);
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof LocalNodePairingError) throw error;
    throw localError(400, 'INVALID_JSON', 'The local pairing request is not valid JSON.', error);
  }
}

export function validateLocalNodePairingInput(value) {
  const input = exactObject(
    value,
    ['schemaVersion', 'pairingCredential', 'displayName'],
    'The local pairing request',
  );
  if (input.schemaVersion !== 1 || input.displayName !== LOCAL_NODE_PAIRING_DISPLAY_NAME) {
    throw localError(400, 'INVALID_PAIRING_REQUEST', 'The local pairing request is unsupported.');
  }
  try {
    parseMastermindNodePairingCredential(input.pairingCredential);
  } catch (error) {
    throw localError(400, 'INVALID_PAIRING_LINK', 'The one-click pairing link is invalid or incomplete.', error);
  }
  return Object.freeze({
    schemaVersion: 1,
    pairingCredential: input.pairingCredential,
    displayName: LOCAL_NODE_PAIRING_DISPLAY_NAME,
  });
}

export async function processLocalNodePairingRequest(request, options = {}) {
  assertLocalNodePairingAccess(request, options.environment ?? process.env);
  const input = validateLocalNodePairingInput(await readLocalNodePairingJson(request));
  // The credential store may be machine-specific (Windows CurrentUser DPAPI).
  // Resolve it only after the local/Vercel/origin gate above has passed so the
  // hosted build never instantiates local credential authority.
  const credentialStore = options.credentialStore ?? await options.createCredentialStore?.();
  if (!credentialStore || typeof credentialStore.beginPairing !== 'function') {
    throw new TypeError('A local node credential store is required');
  }
  let stored;
  try {
    stored = await credentialStore.beginPairing(input.pairingCredential, input.displayName);
  } catch (error) {
    if (error?.code === 'NODE_PAIRING_STATE_CONFLICT') {
      throw localError(409, 'NODE_PAIRING_STATE_CONFLICT', 'This computer already has a different node identity.', error);
    }
    if (error?.code === 'NODE_PAIRING_CREDENTIAL_INVALID') {
      throw localError(400, 'INVALID_PAIRING_LINK', 'The one-click pairing link is invalid or incomplete.', error);
    }
    if (typeof error?.code === 'string' && (
      error.code.startsWith('NODE_CREDENTIAL_') || error.code === 'NODE_DPAPI_UNAVAILABLE'
    )) {
      throw localError(503, 'NODE_PAIRING_UNAVAILABLE', 'The protected local node vault is not ready.', error);
    }
    throw error;
  }
  if (!stored || stored.state !== 'pending' || typeof stored.nodeId !== 'string' || !UUID.test(stored.nodeId)) {
    throw localError(500, 'NODE_PAIRING_BOUNDARY_ERROR', 'The local node vault returned an invalid result.');
  }
  return Object.freeze({ ok: true, state: 'pending', nodeId: stored.nodeId });
}

export function describeLocalNodePairingError(error) {
  if (error instanceof LocalNodePairingError) {
    return Object.freeze({
      status: error.status,
      body: Object.freeze({ ok: false, code: error.code, message: error.message }),
    });
  }
  return Object.freeze({
    status: 500,
    body: Object.freeze({
      ok: false,
      code: 'NODE_PAIRING_BOUNDARY_ERROR',
      message: 'The local pairing receiver failed safely.',
    }),
  });
}

/** Return only bounded classification metadata suitable for local logs. */
export function describeLocalNodePairingDiagnostic(error) {
  let candidateName;
  let candidateCode;
  try {
    candidateName = error && typeof error === 'object' ? error.name : null;
    candidateCode = error && typeof error === 'object' ? error.code : null;
  } catch {
    // Hostile accessors and foreign errors collapse to fixed labels.
  }
  return Object.freeze({
    name: typeof candidateName === 'string' && SAFE_DIAGNOSTIC_NAME.test(candidateName)
      ? candidateName
      : 'UnknownError',
    code: typeof candidateCode === 'string' && SAFE_DIAGNOSTIC_CODE.test(candidateCode)
      ? candidateCode
      : null,
  });
}
