import { TextDecoder } from 'node:util';
import {
  MASTERMIND_DOMAIN_EVENT_MAX_BYTES,
  canonicalMastermindDomainEvent,
  validateMastermindDomainEvent,
} from './contract.mjs';

export const MASTERMIND_MEMORY_EVENT_ENDPOINT = 'http://127.0.0.1:3000/api/memory/events';

const DEFAULT_RESPONSE_MAX_BYTES = 4 * 1024;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_BATCH_LIMIT = 100;
const SUCCESS_KEYS = Object.freeze(['eventId', 'ok', 'status']);
const SUCCESS_STATUSES = new Set(['applied', 'duplicate']);

export class MastermindMemoryApiError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MastermindMemoryApiError';
    this.code = code;
  }
}

function memoryApiError(code, message, cause) {
  return new MastermindMemoryApiError(code, message, cause);
}

function safeErrorCode(error, fallback = 'MEMORY_EVENT_SYNC_FAILED') {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(error.code)
    ? error.code
    : fallback;
}

function exactInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

async function boundedResponseText(response, maximumBytes) {
  const lengthHeader = response?.headers?.get?.('content-length');
  if (lengthHeader !== null && lengthHeader !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(lengthHeader)) {
      throw memoryApiError('MEMORY_API_INVALID_RESPONSE', 'The memory API returned an invalid content length.');
    }
    if (Number(lengthHeader) > maximumBytes) {
      throw memoryApiError('MEMORY_API_RESPONSE_TOO_LARGE', 'The memory API response exceeded its byte limit.');
    }
  }

  if (!response?.body || typeof response.body.getReader !== 'function') {
    if (typeof response?.text !== 'function') {
      throw memoryApiError('MEMORY_API_INVALID_RESPONSE', 'The memory API response body is unavailable.');
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
      throw memoryApiError('MEMORY_API_RESPONSE_TOO_LARGE', 'The memory API response exceeded its byte limit.');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw memoryApiError('MEMORY_API_INVALID_RESPONSE', 'The memory API returned an invalid response stream.');
      }
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw memoryApiError('MEMORY_API_RESPONSE_TOO_LARGE', 'The memory API response exceeded its byte limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch (error) {
    if (error instanceof MastermindMemoryApiError) throw error;
    throw memoryApiError('MEMORY_API_INVALID_RESPONSE', 'The memory API response was not valid UTF-8.', error);
  }
}

function validateSuccessResponse(value, eventId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join('\0') !== SUCCESS_KEYS.join('\0')
    || value.ok !== true || !SUCCESS_STATUSES.has(value.status) || value.eventId !== eventId) {
    throw memoryApiError('MEMORY_API_INVALID_RESPONSE', 'The memory API did not return an exact event receipt.');
  }
  return Object.freeze({ ok: true, status: value.status, eventId });
}

export class MastermindMemoryApiConsumer {
  #closed = false;

  constructor(options = {}) {
    if (typeof options.token !== 'string' || options.token.length < 32) {
      throw new TypeError('The memory API consumer requires the shared control token');
    }
    if (typeof (options.fetcher ?? fetch) !== 'function') throw new TypeError('The memory API consumer requires fetch()');
    this.token = options.token;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = exactInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs', 100, 30_000);
    this.responseMaxBytes = exactInteger(
      options.responseMaxBytes ?? DEFAULT_RESPONSE_MAX_BYTES,
      'responseMaxBytes',
      128,
      64 * 1024,
    );
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    if (typeof this.setTimeoutFn !== 'function' || typeof this.clearTimeoutFn !== 'function') {
      throw new TypeError('The memory API consumer requires timer functions');
    }
  }

  async deliver(value) {
    if (this.#closed) throw memoryApiError('MEMORY_API_CLOSED', 'The memory API consumer is closed.');
    const event = validateMastermindDomainEvent(value);
    const body = canonicalMastermindDomainEvent(event);
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    if (bodyBytes > MASTERMIND_DOMAIN_EVENT_MAX_BYTES) {
      throw memoryApiError('MEMORY_API_REQUEST_TOO_LARGE', 'The memory event exceeded its byte limit.');
    }

    const abortController = new AbortController();
    const timeout = this.setTimeoutFn(() => abortController.abort(), this.timeoutMs);
    timeout?.unref?.();
    let responseReceived = false;
    try {
      const response = await this.fetcher(MASTERMIND_MEMORY_EVENT_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          'Content-Length': String(bodyBytes),
          'Content-Type': 'application/json',
        },
        body,
        signal: abortController.signal,
      });
      responseReceived = true;
      if (!response || response.status !== 200) {
        response?.body?.cancel?.().catch?.(() => undefined);
        throw memoryApiError('MEMORY_API_REJECTED', 'The memory API did not accept the event.');
      }
      const contentType = response.headers?.get?.('content-type') ?? '';
      if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
        response.body?.cancel?.().catch?.(() => undefined);
        throw memoryApiError('MEMORY_API_INVALID_RESPONSE', 'The memory API response was not JSON.');
      }
      const text = await boundedResponseText(response, this.responseMaxBytes);
      if (abortController.signal.aborted) {
        throw memoryApiError('MEMORY_API_TIMEOUT', 'The memory API request timed out.');
      }
      let result;
      try { result = JSON.parse(text); }
      catch (error) { throw memoryApiError('MEMORY_API_INVALID_RESPONSE', 'The memory API returned invalid JSON.', error); }
      return validateSuccessResponse(result, event.eventId);
    } catch (error) {
      if (error instanceof MastermindMemoryApiError) throw error;
      if (abortController.signal.aborted) {
        throw memoryApiError('MEMORY_API_TIMEOUT', 'The memory API request timed out.', error);
      }
      throw memoryApiError(
        responseReceived ? 'MEMORY_API_INVALID_RESPONSE' : 'MEMORY_API_UNAVAILABLE',
        responseReceived
          ? 'The memory API response could not be read.'
          : 'The memory API request could not be completed.',
        error,
      );
    } finally {
      this.clearTimeoutFn(timeout);
    }
  }

  async close() {
    this.#closed = true;
  }
}

export class MastermindMemoryEventSyncController {
  #active = null;
  #closed = false;
  #finalizing = false;
  #finalDrain = null;
  #started = false;
  #timer = null;

  constructor(options = {}) {
    if (!options.outbox || typeof options.outbox.consume !== 'function') {
      throw new TypeError('The memory event sync controller requires an outbox with consume()');
    }
    if (!options.consumer || typeof options.consumer.deliver !== 'function') {
      throw new TypeError('The memory event sync controller requires a consumer with deliver()');
    }
    this.outbox = options.outbox;
    this.consumer = options.consumer;
    this.intervalMs = exactInteger(options.intervalMs ?? DEFAULT_INTERVAL_MS, 'intervalMs', 250, 60 * 60 * 1000);
    this.batchLimit = exactInteger(options.batchLimit ?? DEFAULT_BATCH_LIMIT, 'batchLimit', 1, 1_000);
    this.onError = options.onError ?? (() => undefined);
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    if (typeof this.onError !== 'function' || typeof this.setIntervalFn !== 'function' || typeof this.clearIntervalFn !== 'function') {
      throw new TypeError('The memory event sync controller options are invalid');
    }
  }

  start() {
    if (this.#closed) return Promise.resolve({ ok: false, reason: 'startup', skipped: 'closed' });
    if (this.#started) return this.#active ?? Promise.resolve({ ok: true, reason: 'startup', skipped: 'started' });
    this.#started = true;
    this.#timer = this.setIntervalFn(() => { void this.drain('interval'); }, this.intervalMs);
    this.#timer?.unref?.();
    return this.drain('startup');
  }

  drain(reason = 'manual') {
    if (typeof reason !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(reason)) {
      throw new TypeError('The memory event drain reason is invalid');
    }
    if (this.#closed) return Promise.resolve({ ok: false, reason, skipped: 'closed' });
    if (this.#finalizing && reason !== 'shutdown') {
      return this.#active ?? Promise.resolve({ ok: false, reason, skipped: 'finalizing' });
    }
    if (this.#active) return this.#active;
    return this.#beginDrain(reason);
  }

  stopScheduling() {
    if (this.#timer !== null) this.clearIntervalFn(this.#timer);
    this.#timer = null;
  }

  finalDrain() {
    if (this.#finalDrain) return this.#finalDrain;
    if (this.#closed) return Promise.resolve({ ok: false, reason: 'shutdown', skipped: 'closed' });
    this.#finalizing = true;
    this.stopScheduling();
    const finalDrain = Promise.resolve(this.#active)
      .catch(() => undefined)
      .then(() => this.#beginDrain('shutdown'));
    this.#finalDrain = finalDrain;
    return finalDrain;
  }

  async close() {
    if (this.#closed) return;
    this.#finalizing = true;
    this.stopScheduling();
    this.#closed = true;
    await this.#active?.catch(() => undefined);
    try {
      await this.consumer.close?.();
    } catch (error) {
      this.#observeError(error, 'close');
    }
  }

  #beginDrain(reason) {
    if (this.#active) return this.#active;
    const run = Promise.resolve()
      .then(() => this.outbox.consume(
        (event) => this.consumer.deliver(validateMastermindDomainEvent(event)),
        { limit: this.batchLimit },
      ))
      .then((result) => ({ ok: true, reason, result }))
      .catch((error) => {
        this.#observeError(error, reason);
        return { ok: false, reason, code: safeErrorCode(error) };
      })
      .finally(() => {
        if (this.#active === run) this.#active = null;
      });
    this.#active = run;
    return run;
  }

  #observeError(error, reason) {
    try { this.onError(error, { reason, code: safeErrorCode(error) }); }
    catch { /* Observability cannot alter game or shutdown authority. */ }
  }
}
