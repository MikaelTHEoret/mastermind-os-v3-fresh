const PAIRING_CREDENTIAL = /^mnp1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;
const MAX_RESPONSE_BYTES = 2048;

export class LocalNodePairingClientError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'LocalNodePairingClientError';
    this.code = code;
  }
}

function clientError(code, message, cause) {
  return new LocalNodePairingClientError(code, message, cause ? { cause } : undefined);
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

export function parseLocalNodePairingFragment(fragment) {
  if (typeof fragment !== 'string' || !fragment.startsWith('#pairing=') || fragment.length > 256) {
    throw clientError('PAIRING_FRAGMENT_INVALID', 'This pairing link is invalid or incomplete.');
  }
  const encoded = fragment.slice('#pairing='.length);
  let credential;
  try {
    credential = decodeURIComponent(encoded);
  } catch (error) {
    throw clientError('PAIRING_FRAGMENT_INVALID', 'This pairing link is invalid or incomplete.', error);
  }
  if (encodeURIComponent(credential) !== encoded || !PAIRING_CREDENTIAL.test(credential)) {
    throw clientError('PAIRING_FRAGMENT_INVALID', 'This pairing link is invalid or incomplete.');
  }
  return credential;
}

async function readBoundedResponseText(response) {
  const contentType = response.headers?.get('content-type')?.trim() ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    throw clientError('PAIRING_RESPONSE_INVALID', 'The local pairing receiver returned an invalid response.');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^(?:0|[1-9]\d*)$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw clientError('PAIRING_RESPONSE_INVALID', 'The local pairing receiver returned an invalid response.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw clientError('PAIRING_RESPONSE_INVALID', 'The local pairing receiver returned an empty response.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel('response too large').catch(() => undefined);
        throw clientError('PAIRING_RESPONSE_INVALID', 'The local pairing receiver returned too much data.');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof LocalNodePairingClientError) throw error;
    throw clientError('PAIRING_RESPONSE_INVALID', 'The local pairing receiver returned invalid UTF-8.', error);
  } finally {
    reader.releaseLock();
  }
  if (declared !== null && Number(declared) !== bytes) {
    throw clientError('PAIRING_RESPONSE_INVALID', 'The local pairing response length did not match its body.');
  }
  return text;
}

export function parseLocalNodePairingResponse(status, value) {
  if (status === 200 && exactKeys(value, ['ok', 'state', 'nodeId'])
    && value.ok === true && value.state === 'pending' && UUID.test(value.nodeId)) {
    return Object.freeze({ ok: true, state: 'pending', nodeId: value.nodeId });
  }
  if (status >= 400 && status <= 599 && exactKeys(value, ['ok', 'code', 'message'])
    && value.ok === false && typeof value.code === 'string' && ERROR_CODE.test(value.code)
    && typeof value.message === 'string' && value.message.length >= 1 && value.message.length <= 256) {
    return Object.freeze({ ok: false, status, code: value.code });
  }
  throw clientError('PAIRING_RESPONSE_INVALID', 'The local pairing receiver returned an invalid response.');
}

export async function readLocalNodePairingResponse(response) {
  if (!response || typeof response.status !== 'number') {
    throw clientError('PAIRING_RESPONSE_INVALID', 'The local pairing receiver returned an invalid response.');
  }
  let value;
  try {
    value = JSON.parse(await readBoundedResponseText(response));
  } catch (error) {
    if (error instanceof LocalNodePairingClientError) throw error;
    throw clientError('PAIRING_RESPONSE_INVALID', 'The local pairing receiver returned invalid JSON.', error);
  }
  return parseLocalNodePairingResponse(response.status, value);
}

export async function submitLocalNodePairing(pairingCredential, fetchImplementation = globalThis.fetch) {
  if (typeof pairingCredential !== 'string' || !PAIRING_CREDENTIAL.test(pairingCredential)) {
    throw clientError('PAIRING_FRAGMENT_INVALID', 'This pairing link is invalid or incomplete.');
  }
  if (typeof fetchImplementation !== 'function') throw new TypeError('A fetch implementation is required');
  const response = await fetchImplementation('/api/node/pair-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      schemaVersion: 1,
      pairingCredential,
      displayName: 'Family Node',
    }),
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  return readLocalNodePairingResponse(response);
}

