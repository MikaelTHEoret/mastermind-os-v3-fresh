import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { validateInstanceId } from './config.mjs';

const RETRIABLE_REPLACE_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM']);
const REPLACE_RETRY_DELAYS_MS = Object.freeze([25, 50, 100, 200, 400, 800, 1_000]);
const RETRIABLE_READ_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM']);
const READ_RETRY_DELAYS_MS = Object.freeze([10, 25, 50, 100, 200, 400]);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function replaceStateFile(source, destination, options = {}) {
  const filesystem = options.filesystem ?? fs;
  const wait = options.wait ?? delay;
  const retryDelays = options.retryDelays ?? REPLACE_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await filesystem.rename(source, destination);
      return;
    } catch (error) {
      if (!RETRIABLE_REPLACE_ERRORS.has(error?.code) || attempt >= retryDelays.length) throw error;
      await wait(retryDelays[attempt]);
    }
  }
}

export async function readStateFile(file, options = {}) {
  const filesystem = options.filesystem ?? fs;
  const wait = options.wait ?? delay;
  const retryDelays = options.retryDelays ?? READ_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await filesystem.readFile(file, 'utf8');
    } catch (error) {
      if (!RETRIABLE_READ_ERRORS.has(error?.code) || attempt >= retryDelays.length) throw error;
      await wait(retryDelays[attempt]);
    }
  }
}

export class InstanceStore {
  #queue = Promise.resolve();

  constructor(dataRoot) {
    this.dataRoot = path.resolve(dataRoot);
    this.legacyStateFile = path.join(this.dataRoot, 'state', 'instances.json');
    // Update recovery continuously guards the state directory while it mutates
    // authenticated evidence. Windows forbids replacing a direct child of that
    // held directory, so keep the atomically replaced inventory one level down.
    this.stateFile = path.join(this.dataRoot, 'state', 'instance-store', 'instances.json');
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    try {
      await fs.lstat(this.stateFile);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        const parsed = JSON.parse(await fs.readFile(this.legacyStateFile, 'utf8'));
        await this.#write(Array.isArray(parsed.instances) ? parsed.instances : []);
      } catch (legacyError) {
        if (legacyError?.code !== 'ENOENT') throw legacyError;
      }
    }
    // Process state is reconciled by ProcessManager after it can inspect both
    // the persisted PID and the configured TCP port. Resetting active records
    // here can make a still-running Java process look safe to update.
    await this.#read();
  }

  async list() {
    await this.#queue;
    return this.#read();
  }

  async get(id) {
    if (!validateInstanceId(id)) return null;
    await this.#queue;
    return (await this.#read()).find((item) => item.id === id) ?? null;
  }

  async create(record) {
    if (!validateInstanceId(record.id)) throw new TypeError('Invalid instance id');
    return this.#mutate((records) => {
      if (records.some((item) => item.id === record.id)) throw new Error(`Instance '${record.id}' already exists`);
      records.push(record);
      return record;
    });
  }

  async update(id, patch) {
    if (!validateInstanceId(id)) throw new TypeError('Invalid instance id');
    return this.#mutate((records) => {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) throw new Error(`Instance '${id}' was not found`);
      records[index] = { ...records[index], ...patch, id, updatedAt: new Date().toISOString() };
      return records[index];
    });
  }

  async #mutate(operation) {
    const run = this.#queue.then(async () => {
      const records = await this.#read();
      const result = operation(records);
      await this.#write(records);
      return result;
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #read() {
    try {
      const parsed = JSON.parse(await readStateFile(this.stateFile));
      return Array.isArray(parsed.instances) ? parsed.instances : [];
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async #write(instances) {
    const temporary = `${this.stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    let published = false;
    try {
      await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, instances }, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
      await replaceStateFile(temporary, this.stateFile);
      published = true;
    } finally {
      if (!published) await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
