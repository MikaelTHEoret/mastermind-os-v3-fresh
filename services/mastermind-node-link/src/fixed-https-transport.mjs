import https from 'node:https';
import { TextDecoder } from 'node:util';

import {
  MASTERMIND_NODE_EXCHANGE_MAX_BYTES,
  MASTERMIND_NODE_RESPONSE_MAX_BYTES,
  canonicalMastermindNodeExchangeRequest,
  canonicalMastermindNodePairRequest,
  digestMastermindNodeCredential,
  validateMastermindNodeExchangeRequest,
  validateMastermindNodeExchangeResponse,
  validateMastermindNodePairRequest,
  validateMastermindNodePairResponse,
} from '../../../protocol/mastermind-node-exchange/contract.mjs';
import { loadMastermindNodeCredentialRecord } from './credential-store.mjs';

export const MASTERMIND_CORE_NODE_ORIGIN = 'https://mastermind-core.com';
export const MASTERMIND_CORE_NODE_PAIR_PATH = '/api/node/v1/pair';
export const MASTERMIND_CORE_NODE_EXCHANGE_PATH = '/api/node/v1/exchange';

const PAIR_REQUEST_MAX_BYTES = 4 * 1024;
const PAIR_RESPONSE_MAX_BYTES = 4 * 1024;
const ERROR_RESPONSE_MAX_BYTES = 4 * 1024;
const SAFE_REMOTE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;

export const MASTERMIND_NODE_HTTPS_TRANSPORT_ERROR_CODES = Object.freeze({
  REQUEST_INVALID: 'NODE_TRANSPORT_REQUEST_INVALID',
  CREDENTIAL_UNAVAILABLE: 'NODE_CREDENTIAL_UNAVAILABLE',
  PAIRING_EXPIRED: 'NODE_PAIRING_EXPIRED',
  PAIRING_REJECTED: 'NODE_PAIRING_REJECTED',
  CREDENTIAL_REJECTED: 'NODE_CREDENTIAL_REJECTED',
  CREDENTIAL_REVOKED: 'NODE_CREDENTIAL_REVOKED',
  HOSTED_UNAVAILABLE: 'NODE_HOSTED_UNAVAILABLE',
  HOSTED_TIMEOUT: 'NODE_HOSTED_TIMEOUT',
  HOSTED_RESPONSE_INVALID: 'NODE_HOSTED_RESPONSE_INVALID',
});

const ERROR_MESSAGES = Object.freeze({
  NODE_TRANSPORT_REQUEST_INVALID: 'The local node request does not match its protected identity.',
  NODE_CREDENTIAL_UNAVAILABLE: 'The protected node credential is unavailable.',
  NODE_PAIRING_EXPIRED: 'The one-time node pairing claim expired.',
  NODE_PAIRING_REJECTED: 'The hosted service rejected the node pairing claim.',
  NODE_CREDENTIAL_REJECTED: 'The hosted service rejected the node credential.',
  NODE_CREDENTIAL_REVOKED: 'The hosted service revoked the node credential.',
  NODE_HOSTED_UNAVAILABLE: 'The hosted node service is temporarily unavailable.',
  NODE_HOSTED_TIMEOUT: 'The hosted node service did not respond in time.',
  NODE_HOSTED_RESPONSE_INVALID: 'The hosted node service returned an invalid response.',
});

export class MastermindNodeHttpsTransportError extends Error {
  constructor(code, retryable = false) {
    if (!Object.hasOwn(ERROR_MESSAGES, code)) throw new TypeError('Unsupported node transport error code');
    super(ERROR_MESSAGES[code]);
    this.name = 'MastermindNodeHttpsTransportError';
    this.code = code;
    this.retryable = retryable === true;
  }
}

function transportError(code, retryable = false) {
  return new MastermindNodeHttpsTransportError(code, retryable);
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function readSingleHeader(response, name) {
  const rawHeaders = Array.isArray(response.rawHeaders) ? response.rawHeaders : null;
  if (rawHeaders) {
    let occurrences = 0;
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (String(rawHeaders[index]).toLowerCase() === name) occurrences += 1;
    }
    if (occurrences > 1) throw transportError('NODE_HOSTED_RESPONSE_INVALID');
  }
  const value = response.headers?.[name];
  if (Array.isArray(value)) throw transportError('NODE_HOSTED_RESPONSE_INVALID');
  return value;
}

function validateResponseHeaders(response, maximumBytes) {
  const contentType = readSingleHeader(response, 'content-type');
  if (typeof contentType !== 'string'
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    throw transportError('NODE_HOSTED_RESPONSE_INVALID');
  }
  const contentLength = readSingleHeader(response, 'content-length');
  if (contentLength === undefined) return null;
  if (typeof contentLength !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) {
    throw transportError('NODE_HOSTED_RESPONSE_INVALID');
  }
  const parsed = Number(contentLength);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximumBytes) {
    throw transportError('NODE_HOSTED_RESPONSE_INVALID');
  }
  return parsed;
}

function parseJson(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw transportError('NODE_HOSTED_RESPONSE_INVALID'); }
  try { return JSON.parse(text); }
  catch { throw transportError('NODE_HOSTED_RESPONSE_INVALID'); }
}

function parseRemoteError(value) {
  if (!exactKeys(value, ['ok', 'error']) || value.ok !== false
    || !exactKeys(value.error, ['code', 'message'])
    || typeof value.error.code !== 'string' || !SAFE_REMOTE_CODE.test(value.error.code)
    || typeof value.error.message !== 'string' || value.error.message.length < 1
    || value.error.message.length > 256 || CONTROL_CHARACTERS.test(value.error.message)) {
    throw transportError('NODE_HOSTED_RESPONSE_INVALID');
  }
  return value.error.code;
}

function mapRemoteError(kind, statusCode, remoteCode) {
  if (kind === 'pair') {
    if (statusCode === 410 && remoteCode === 'NODE_PAIRING_EXPIRED') {
      return transportError('NODE_PAIRING_EXPIRED');
    }
    if ([400, 401, 403, 404, 409, 422].includes(statusCode)) {
      return transportError('NODE_PAIRING_REJECTED');
    }
  } else {
    if (statusCode === 401) return transportError('NODE_CREDENTIAL_REJECTED');
    if ([403, 410].includes(statusCode)) return transportError('NODE_CREDENTIAL_REVOKED');
  }
  if (statusCode === 429 || statusCode >= 500) return transportError('NODE_HOSTED_UNAVAILABLE', true);
  return transportError('NODE_HOSTED_RESPONSE_INVALID');
}

function requestOptions(pathname, bearer, byteLength) {
  return {
    protocol: 'https:',
    hostname: 'mastermind-core.com',
    servername: 'mastermind-core.com',
    port: 443,
    path: pathname,
    method: 'POST',
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      'Content-Length': byteLength,
    },
  };
}

async function loadCredential(store) {
  try { return await loadMastermindNodeCredentialRecord(store); }
  catch { throw transportError('NODE_CREDENTIAL_UNAVAILABLE'); }
}

/**
 * Fixed, credential-owning HTTPS adapter for the hosted Mastermind node
 * rendezvous. The origin, paths, TLS policy, and headers cannot be overridden.
 */
export class MastermindCoreNodeFixedHttpsTransport {
  constructor(options = {}) {
    const allowed = new Set(['credentialStore', 'requestImpl', 'timeoutMs']);
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => !allowed.has(key))) {
      throw new TypeError('Invalid fixed node transport options');
    }
    if (!options.credentialStore || typeof options.credentialStore.load !== 'function') {
      throw new TypeError('credentialStore is required');
    }
    this.credentialStore = options.credentialStore;
    this.requestImpl = options.requestImpl ?? https.request;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    if (typeof this.requestImpl !== 'function') throw new TypeError('requestImpl must be a function');
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000) {
      throw new TypeError('timeoutMs must be an integer between 100 and 120000');
    }
  }

  pair(value, options = {}) {
    return this.#withinDeadline(options.signal, async (signal) => {
      let request;
      try { request = validateMastermindNodePairRequest(value); }
      catch { throw transportError('NODE_TRANSPORT_REQUEST_INVALID'); }
      const record = await loadCredential(this.credentialStore);
      if (signal.aborted) throw signal.reason;
      if (!record || record.state !== 'pending'
        || record.pairingId !== request.pairingId
        || record.nodeId !== request.node.nodeId
        || record.displayName !== request.node.displayName
        || digestMastermindNodeCredential(record.nodeCredential) !== request.node.credentialSha256) {
        throw transportError('NODE_TRANSPORT_REQUEST_INVALID');
      }
      const body = Buffer.from(canonicalMastermindNodePairRequest(request), 'utf8');
      if (body.length < 1 || body.length > PAIR_REQUEST_MAX_BYTES) {
        throw transportError('NODE_TRANSPORT_REQUEST_INVALID');
      }
      return this.#post({
        kind: 'pair',
        pathname: MASTERMIND_CORE_NODE_PAIR_PATH,
        bearer: record.pairingCredential,
        body,
        maximumResponseBytes: PAIR_RESPONSE_MAX_BYTES,
        signal,
        validate: (response) => validateMastermindNodePairResponse(response, {
          expectedNodeId: request.node.nodeId,
        }),
      });
    });
  }

  exchange(value, options = {}) {
    return this.#withinDeadline(options.signal, async (signal) => {
      let request;
      const protocol = { core: value?.schemaVersion === 2 };
      try { request = validateMastermindNodeExchangeRequest(value, protocol); }
      catch { throw transportError('NODE_TRANSPORT_REQUEST_INVALID'); }
      const record = await loadCredential(this.credentialStore);
      if (signal.aborted) throw signal.reason;
      if (!record || record.state !== 'paired' || record.nodeId !== request.nodeId) {
        throw transportError('NODE_TRANSPORT_REQUEST_INVALID');
      }
      const body = Buffer.from(canonicalMastermindNodeExchangeRequest(request, protocol), 'utf8');
      if (body.length < 1 || body.length > MASTERMIND_NODE_EXCHANGE_MAX_BYTES) {
        throw transportError('NODE_TRANSPORT_REQUEST_INVALID');
      }
      return this.#post({
        kind: 'exchange',
        pathname: MASTERMIND_CORE_NODE_EXCHANGE_PATH,
        bearer: record.nodeCredential,
        body,
        maximumResponseBytes: MASTERMIND_NODE_RESPONSE_MAX_BYTES,
        signal,
        validate: (response) => validateMastermindNodeExchangeResponse(response, {
          expectedExchangeId: request.exchangeId,
          expectedNodeId: request.nodeId,
          expectedReceiptIds: request.receipts.map((receipt) => receipt.receiptId),
          ...protocol,
          expectedWorker: request.worker,
        }),
      });
    });
  }

  async #withinDeadline(externalSignal, operation) {
    if (externalSignal !== undefined && !(externalSignal instanceof AbortSignal)) {
      throw new TypeError('signal must be an AbortSignal');
    }
    if (externalSignal?.aborted) throw externalSignal.reason ?? new DOMException('Aborted', 'AbortError');
    const controller = new AbortController();
    const timeoutError = transportError('NODE_HOSTED_TIMEOUT', true);
    const timer = setTimeout(() => controller.abort(timeoutError), this.timeoutMs);
    timer.unref?.();
    const forwardAbort = () => controller.abort(
      externalSignal.reason ?? new DOMException('Aborted', 'AbortError'),
    );
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (externalSignal?.aborted) throw externalSignal.reason ?? new DOMException('Aborted', 'AbortError');
      if (error instanceof MastermindNodeHttpsTransportError) throw error;
      if (controller.signal.reason === timeoutError) throw timeoutError;
      throw transportError('NODE_HOSTED_UNAVAILABLE', true);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  #post({ kind, pathname, bearer, body, maximumResponseBytes, signal, validate }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let request = null;
      let response = null;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => {
        const reason = signal.reason ?? new DOMException('Aborted', 'AbortError');
        try { response?.destroy?.(reason); } catch { /* The response may already be closed. */ }
        try { request?.destroy?.(reason); } catch { /* The request may already be closed. */ }
        finish(reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      try {
        request = this.requestImpl(requestOptions(pathname, bearer, body.length), (incoming) => {
          response = incoming;
          let expectedLength;
          try { expectedLength = validateResponseHeaders(incoming, incoming.statusCode === 200
            ? maximumResponseBytes : ERROR_RESPONSE_MAX_BYTES); }
          catch (error) {
            incoming.destroy?.();
            finish(error);
            return;
          }
          const chunks = [];
          let total = 0;
          incoming.on('data', (chunk) => {
            if (settled) return;
            const bytes = Buffer.from(chunk);
            total += bytes.length;
            if (total > (incoming.statusCode === 200 ? maximumResponseBytes : ERROR_RESPONSE_MAX_BYTES)) {
              incoming.destroy?.();
              finish(transportError('NODE_HOSTED_RESPONSE_INVALID'));
              return;
            }
            chunks.push(bytes);
          });
          incoming.once('error', () => finish(transportError('NODE_HOSTED_UNAVAILABLE', true)));
          incoming.once('end', () => {
            if (settled) return;
            if (total < 1 || (expectedLength !== null && expectedLength !== total)) {
              finish(transportError('NODE_HOSTED_RESPONSE_INVALID'));
              return;
            }
            let parsed;
            try { parsed = parseJson(Buffer.concat(chunks, total)); }
            catch (error) { finish(error); return; }
            if (incoming.statusCode !== 200) {
              let remoteCode;
              try { remoteCode = parseRemoteError(parsed); }
              catch (error) { finish(error); return; }
              finish(mapRemoteError(kind, incoming.statusCode, remoteCode));
              return;
            }
            try { finish(null, validate(parsed)); }
            catch { finish(transportError('NODE_HOSTED_RESPONSE_INVALID')); }
          });
        });
      } catch {
        finish(transportError('NODE_HOSTED_UNAVAILABLE', true));
        return;
      }
      if (!request || typeof request.once !== 'function' || typeof request.end !== 'function'
        || typeof request.destroy !== 'function') {
        finish(transportError('NODE_HOSTED_UNAVAILABLE', true));
        return;
      }
      request.once('error', (error) => {
        if (signal.aborted) finish(signal.reason ?? error);
        else finish(transportError('NODE_HOSTED_UNAVAILABLE', true));
      });
      try { request.end(body); }
      catch { finish(transportError('NODE_HOSTED_UNAVAILABLE', true)); }
    });
  }
}

export function createMastermindCoreNodeFixedHttpsTransport(options) {
  return new MastermindCoreNodeFixedHttpsTransport(options);
}
