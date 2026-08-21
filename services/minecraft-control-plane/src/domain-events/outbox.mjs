import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  MASTERMIND_DOMAIN_EVENT_MAX_BYTES,
  canonicalMastermindDomainEvent,
  validateMastermindDomainEvent,
} from './contract.mjs';

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;
const TEMP_FILE = /^[0-9a-f-]{36}\.[0-9a-f-]{36}\.tmp$/;
const DEFAULT_MAX_PENDING = 4_096;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_TEMP_FILES = 256;

export class MastermindEventOutboxError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MastermindEventOutboxError';
    this.code = code;
  }
}

function outboxError(code, message, cause) {
  return new MastermindEventOutboxError(code, message, cause);
}

function exactEventId(value) {
  if (typeof value !== 'string' || !EVENT_ID.test(value)) {
    throw outboxError('EVENT_OUTBOX_INVALID_ID', 'The outbox event id is invalid.');
  }
  return value;
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not uniformly available on Windows. Event file
    // contents are still flushed before their atomic publication.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function canonicalBytes(event) {
  return `${canonicalMastermindDomainEvent(event)}\n`;
}

export class FileMastermindEventOutbox {
  #queue = Promise.resolve();
  #consumerQueue = Promise.resolve();
  #initialized = false;

  constructor(root, options = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('Outbox root must be an absolute path');
    this.root = path.resolve(root);
    this.pendingRoot = path.join(this.root, 'pending');
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1 || this.maxPending > DEFAULT_MAX_PENDING) {
      throw new TypeError(`maxPending must be an integer between 1 and ${DEFAULT_MAX_PENDING}`);
    }
    if (!Number.isSafeInteger(this.maxTotalBytes) || this.maxTotalBytes < MASTERMIND_DOMAIN_EVENT_MAX_BYTES
      || this.maxTotalBytes > DEFAULT_MAX_TOTAL_BYTES) {
      throw new TypeError(`maxTotalBytes must be between ${MASTERMIND_DOMAIN_EVENT_MAX_BYTES} and ${DEFAULT_MAX_TOTAL_BYTES}`);
    }
  }

  async initialize() {
    return this.#serialized(async () => {
      await fs.mkdir(this.pendingRoot, { recursive: true, mode: 0o700 });
      await this.#assertDirectory(this.root, 'outbox root');
      await this.#assertDirectory(this.pendingRoot, 'pending outbox directory');
      const inventory = await this.#scan({ removeTemps: true, includeEvents: false });
      this.#initialized = true;
      return { count: inventory.count, bytes: inventory.bytes };
    }, { requireInitialized: false });
  }

  async enqueue(value) {
    const event = validateMastermindDomainEvent(value);
    const bytes = canonicalBytes(event);
    return this.#serialized(async () => {
      const destination = path.join(this.pendingRoot, `${event.eventId}.json`);
      const existing = await this.#readEventFile(destination, event.eventId, { allowMissing: true });
      if (existing) {
        if (canonicalBytes(existing) !== bytes) {
          throw outboxError('EVENT_ID_CONFLICT', 'The event id already belongs to different durable content.');
        }
        return { inserted: false, event: existing };
      }
      const inventory = await this.#scan({ removeTemps: false, includeEvents: false });
      if (inventory.count >= this.maxPending || inventory.bytes + Buffer.byteLength(bytes) > this.maxTotalBytes) {
        throw outboxError('EVENT_OUTBOX_QUOTA_EXCEEDED', 'The durable event outbox has reached its configured quota.');
      }
      const nonce = exactEventId(this.randomUUID());
      const temporary = path.join(this.pendingRoot, `${event.eventId}.${nonce}.tmp`);
      let handle;
      try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(bytes, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.rename(temporary, destination);
        await syncDirectory(this.pendingRoot);
      } catch (error) {
        await handle?.close().catch(() => undefined);
        await fs.unlink(temporary).catch(() => undefined);
        throw outboxError('EVENT_OUTBOX_WRITE_FAILED', 'The event could not be durably published.', error);
      }
      const published = await this.#readEventFile(destination, event.eventId);
      if (canonicalBytes(published) !== bytes) {
        throw outboxError('EVENT_OUTBOX_INVALID', 'The published event does not match the requested event.');
      }
      return { inserted: true, event: published };
    });
  }

  async listPending(options = {}) {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new TypeError('limit must be an integer between 1 and 1000');
    return this.#serialized(async () => {
      const inventory = await this.#scan({ removeTemps: false, includeEvents: true });
      return inventory.events.slice(0, limit).map((event) => structuredClone(event));
    });
  }

  async assertNoUnboundCompanionEvents() {
    return this.#serialized(async () => {
      const inventory = await this.#scan({ removeTemps: false, includeEvents: true });
      let companionEvents = 0;
      for (const event of inventory.events) {
        if (event.domain !== 'companion') continue;
        companionEvents += 1;
        if (typeof event.playerId !== 'string') {
          throw outboxError(
            'EVENT_OUTBOX_IDENTITY_MIGRATION_REQUIRED',
            'The outbox contains a legacy companion event without a player identity.',
          );
        }
      }
      return { companionEvents };
    });
  }

  async acknowledge(value) {
    const expected = typeof value === 'string' ? null : validateMastermindDomainEvent(value);
    const eventId = exactEventId(typeof value === 'string' ? value : expected.eventId);
    return this.#serialized(async () => {
      const target = path.join(this.pendingRoot, `${eventId}.json`);
      const current = await this.#readEventFile(target, eventId, { allowMissing: true });
      if (!current) return false;
      if (expected && canonicalBytes(current) !== canonicalBytes(expected)) {
        throw outboxError('EVENT_ID_CONFLICT', 'The pending event changed before acknowledgement.');
      }
      await fs.unlink(target);
      await syncDirectory(this.pendingRoot);
      return true;
    });
  }

  async consume(handler, options = {}) {
    if (typeof handler !== 'function') throw new TypeError('Outbox consumer must be a function');
    const run = this.#consumerQueue.catch(() => undefined).then(async () => {
      const pending = await this.listPending({ limit: options.limit ?? 100 });
      let delivered = 0;
      for (const event of pending) {
        // The consumer must commit event.eventId under a UNIQUE constraint
        // before this promise resolves. A crash before acknowledgement replays
        // the event, giving at-least-once delivery with effect-once consumption.
        await handler(structuredClone(event));
        await this.acknowledge(event);
        delivered += 1;
      }
      return { delivered, remaining: (await this.stats()).count };
    });
    this.#consumerQueue = run;
    return run;
  }

  async stats() {
    return this.#serialized(async () => {
      const inventory = await this.#scan({ removeTemps: false, includeEvents: false });
      return { count: inventory.count, bytes: inventory.bytes };
    });
  }

  async #assertDirectory(directory, label) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw outboxError('EVENT_OUTBOX_INVALID', `The ${label} is not a regular directory.`);
    }
  }

  async #scan({ removeTemps, includeEvents }) {
    const result = { count: 0, bytes: 0, events: [] };
    let tempCount = 0;
    let directory;
    try {
      directory = await fs.opendir(this.pendingRoot);
      for await (const entry of directory) {
        const match = EVENT_FILE.exec(entry.name);
        if (match) {
          result.count += 1;
          if (result.count > this.maxPending) throw outboxError('EVENT_OUTBOX_QUOTA_EXCEEDED', 'The pending event count exceeds its quota.');
          const target = path.join(this.pendingRoot, entry.name);
          const stat = await fs.lstat(target);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 3 || stat.size > MASTERMIND_DOMAIN_EVENT_MAX_BYTES + 1) {
            throw outboxError('EVENT_OUTBOX_INVALID', 'A pending event file has unsafe metadata.');
          }
          result.bytes += stat.size;
          if (result.bytes > this.maxTotalBytes) throw outboxError('EVENT_OUTBOX_QUOTA_EXCEEDED', 'The pending event bytes exceed their quota.');
          const event = await this.#readEventFile(target, match[1]);
          if (includeEvents) result.events.push(event);
          continue;
        }
        if (TEMP_FILE.test(entry.name)) {
          tempCount += 1;
          if (tempCount > MAX_TEMP_FILES) throw outboxError('EVENT_OUTBOX_INVALID', 'The outbox contains too many unfinished temporary files.');
          if (removeTemps) await fs.unlink(path.join(this.pendingRoot, entry.name));
          continue;
        }
        throw outboxError('EVENT_OUTBOX_INVALID', 'The outbox contains an unsupported entry.');
      }
    } finally {
      await directory?.close().catch(() => undefined);
    }
    if (includeEvents) result.events.sort((left, right) => (
      left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId)
    ));
    return result;
  }

  async #readEventFile(file, expectedEventId, options = {}) {
    let bytes;
    try { bytes = await fs.readFile(file, 'utf8'); }
    catch (error) {
      if (options.allowMissing && error?.code === 'ENOENT') return null;
      throw outboxError('EVENT_OUTBOX_READ_FAILED', 'A pending event could not be read.', error);
    }
    if (Buffer.byteLength(bytes) > MASTERMIND_DOMAIN_EVENT_MAX_BYTES + 1 || !bytes.endsWith('\n')) {
      throw outboxError('EVENT_OUTBOX_INVALID', 'A pending event file is not canonical.');
    }
    let value;
    try { value = validateMastermindDomainEvent(JSON.parse(bytes)); }
    catch (error) { throw outboxError('EVENT_OUTBOX_INVALID', 'A pending event is invalid.', error); }
    if (value.eventId !== expectedEventId || bytes !== canonicalBytes(value)) {
      throw outboxError('EVENT_OUTBOX_INVALID', 'A pending event does not match its durable name.');
    }
    return value;
  }

  #serialized(operation, options = {}) {
    const run = this.#queue.catch(() => undefined).then(async () => {
      if (options.requireInitialized !== false && !this.#initialized) {
        throw outboxError('EVENT_OUTBOX_NOT_INITIALIZED', 'The durable event outbox is not initialized.');
      }
      return operation();
    });
    this.#queue = run;
    return run;
  }
}
