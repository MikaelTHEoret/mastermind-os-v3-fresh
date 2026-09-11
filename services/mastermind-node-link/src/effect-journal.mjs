import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  digestMastermindNodeCommand,
  validateMastermindNodeCommand,
  validateMastermindNodeLease,
  validateMastermindNodeReceipt,
} from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const EFFECT_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;
const TEMP_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/;
const OWNER_TEMP_FILE = /^owner\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/;
const MAX_EFFECT_BYTES = 8 * 1024;
const MAX_RECEIPT_BYTES = 4 * 1024;
const MAX_OWNER_BYTES = 1024;
const MAX_EFFECTS = 4_096;
const MAX_RECEIPTS = 4_096;
const MAX_NODE_NAMESPACES = 64;
const EFFECT_STATES = new Set(['accepted', 'running', 'succeeded', 'failed']);

export class MastermindNodeJournalError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'MastermindNodeJournalError';
    this.code = code;
  }
}

function journalError(code, message, cause) {
  return new MastermindNodeJournalError(code, message, cause ? { cause } : undefined);
}

function canonicalTimestamp(now) {
  const value = new Date(now()).toISOString();
  if (value.length !== 24) throw journalError('NODE_JOURNAL_CLOCK_INVALID', 'The node journal clock is invalid.');
  return value;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw journalError('NODE_JOURNAL_INVALID', `${label} is invalid.`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw journalError('NODE_JOURNAL_INVALID', `${label} is invalid.`);
  }
  return value;
}

function validateTerminal(value) {
  if (value === null) return null;
  exactKeys(value, ['state', 'stage', 'code', 'retryable', 'result'], 'Terminal effect');
  if (!['succeeded', 'failed'].includes(value.state)) {
    throw journalError('NODE_JOURNAL_INVALID', 'Terminal effect state is invalid.');
  }
  return structuredClone(value);
}

function validateNodeOwner(value, expectedNodeId) {
  exactKeys(value, ['schemaVersion', 'nodeId', 'createdAt'], 'Node journal owner');
  if (value.schemaVersion !== 1 || !UUID.test(value.nodeId) || value.nodeId !== expectedNodeId
    || typeof value.createdAt !== 'string' || value.createdAt.length !== 24
    || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) {
    throw journalError('NODE_JOURNAL_OWNER_MISMATCH', 'The portable journal namespace belongs to another node identity.');
  }
  return structuredClone(value);
}

function validateEffect(value) {
  exactKeys(value, [
    'schemaVersion', 'jobId', 'nodeId', 'commandDigest', 'capability', 'capabilityVersion',
    'policyClass', 'input', 'state', 'lastSequence', 'terminal', 'updatedAt',
  ], 'Effect journal record');
  if (value.schemaVersion !== 1 || !UUID.test(value.jobId) || !UUID.test(value.nodeId)
    || !SHA256.test(value.commandDigest) || !EFFECT_STATES.has(value.state)
    || !Number.isSafeInteger(value.lastSequence) || value.lastSequence < 0 || value.lastSequence > 65_535
    || typeof value.updatedAt !== 'string' || value.updatedAt.length !== 24
    || !Number.isFinite(Date.parse(value.updatedAt)) || new Date(value.updatedAt).toISOString() !== value.updatedAt) {
    throw journalError('NODE_JOURNAL_INVALID', 'Effect journal record is invalid.');
  }
  const command = validateMastermindNodeCommand({
    jobId: value.jobId,
    nodeId: value.nodeId,
    capability: value.capability,
    capabilityVersion: value.capabilityVersion,
    policyClass: value.policyClass,
    input: value.input,
  });
  if (digestMastermindNodeCommand(command) !== value.commandDigest) {
    throw journalError('NODE_JOURNAL_INVALID', 'Effect command digest is invalid.');
  }
  const terminal = validateTerminal(value.terminal);
  if ((['succeeded', 'failed'].includes(value.state)) !== (terminal !== null)
    || (terminal && terminal.state !== value.state)) {
    throw journalError('NODE_JOURNAL_INVALID', 'Effect terminal state is inconsistent.');
  }
  return { ...structuredClone(value), terminal };
}

function effectForLease(lease, now) {
  return {
    schemaVersion: 1,
    jobId: lease.jobId,
    nodeId: lease.nodeId,
    commandDigest: lease.commandDigest,
    capability: lease.capability,
    capabilityVersion: lease.capabilityVersion,
    policyClass: lease.policyClass,
    input: structuredClone(lease.input),
    state: 'accepted',
    lastSequence: 0,
    terminal: null,
    updatedAt: canonicalTimestamp(now),
  };
}

function assertLeaseMatchesEffect(lease, effect) {
  if (lease.jobId !== effect.jobId || lease.nodeId !== effect.nodeId
    || lease.commandDigest !== effect.commandDigest || lease.capability !== effect.capability
    || lease.capabilityVersion !== effect.capabilityVersion || lease.policyClass !== effect.policyClass
    || JSON.stringify(lease.input) !== JSON.stringify(effect.input)) {
    throw journalError('NODE_EFFECT_ID_CONFLICT', 'The job ID is already bound to different durable command content.');
  }
}

function terminalForReceipt(receipt) {
  return ['succeeded', 'failed'].includes(receipt.state)
    ? {
      state: receipt.state,
      stage: receipt.stage,
      code: receipt.code,
      retryable: receipt.retryable,
      result: structuredClone(receipt.result),
    }
    : null;
}

function sameTerminal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyNextReceipt(effect, receipt) {
  if (receipt.jobId !== effect.jobId || receipt.commandDigest !== effect.commandDigest
    || receipt.sequence !== effect.lastSequence + 1) {
    throw journalError('NODE_JOURNAL_INVALID', 'A receipt does not continue its durable command effect.');
  }
  const terminal = terminalForReceipt(receipt);
  if (effect.terminal && (!terminal || !sameTerminal(effect.terminal, terminal))) {
    throw journalError('NODE_EFFECT_TERMINAL_CONFLICT', 'A terminal command effect cannot change.');
  }
  return validateEffect({
    ...effect,
    state: receipt.state,
    lastSequence: receipt.sequence,
    terminal: terminal ?? effect.terminal,
    updatedAt: receipt.observedAt,
  });
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not consistently supported on Windows. Each file is
    // still flushed before its atomic publication.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readBoundedJson(file, maximumBytes) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 3 || stat.size > maximumBytes) {
    throw journalError('NODE_JOURNAL_INVALID', 'A node journal file has unsafe metadata.');
  }
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw journalError('NODE_JOURNAL_INVALID', 'A node journal file is not valid JSON.', error);
  }
}

async function atomicWriteJson(directory, destination, value, randomUUID, maximumBytes = MAX_EFFECT_BYTES) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > maximumBytes) {
    throw journalError('NODE_JOURNAL_QUOTA_EXCEEDED', 'The durable record exceeds its recovery read limit.');
  }
  const temporary = path.join(directory, `${path.basename(destination, '.json')}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, destination);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temporary).catch(() => undefined);
    throw journalError('NODE_JOURNAL_WRITE_FAILED', 'The node journal could not publish a durable record.', error);
  }
}

export class FileMastermindNodeEffectJournal {
  #queue = Promise.resolve();
  #initialized = false;
  #poisoned = false;
  #selectedNodeId = null;
  #activeExecutions = 0;
  #effects = new Map();
  #receipts = new Map();

  constructor(root, options = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) {
      throw new TypeError('journal root must be an absolute path');
    }
    this.root = path.resolve(root);
    this.nodesRoot = path.join(this.root, 'nodes');
    this.nodeRoot = null;
    this.effectsRoot = null;
    this.receiptsRoot = null;
    this.now = options.now ?? Date.now;
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
    this.afterReceiptPublished = options.afterReceiptPublished ?? null;
    if (typeof this.now !== 'function' || typeof this.randomUUID !== 'function'
      || (this.afterReceiptPublished !== null && typeof this.afterReceiptPublished !== 'function')) {
      throw new TypeError('journal clock and UUID source must be functions');
    }
  }

  initialize() {
    return this.#serialized(async () => {
      if (this.#activeExecutions > 0) {
        throw journalError('NODE_JOURNAL_SWITCH_IN_FLIGHT', 'The node journal cannot reinitialize during a local effect.');
      }
      await fs.mkdir(this.nodesRoot, { recursive: true, mode: 0o700 });
      for (const directory of [this.root, this.nodesRoot]) {
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw journalError('NODE_JOURNAL_INVALID', 'The node journal directory is unsafe.');
        }
      }
      await this.#validateNamespaceInventory();
      this.#selectedNodeId = null;
      this.nodeRoot = null;
      this.effectsRoot = null;
      this.receiptsRoot = null;
      this.#effects = new Map();
      this.#receipts = new Map();
      this.#poisoned = false;
      this.#initialized = true;
      return { selectedNodeId: null, effects: 0, pendingReceipts: 0 };
    }, { requireInitialized: false });
  }

  selectNode(nodeId) {
    if (typeof nodeId !== 'string' || !UUID.test(nodeId)) throw new TypeError('nodeId must be a lowercase UUID');
    return this.#serialized(async () => {
      if (this.#selectedNodeId === nodeId) {
        return { selectedNodeId: nodeId, effects: this.#effects.size, pendingReceipts: this.#receipts.size };
      }
      if (this.#activeExecutions > 0) {
        throw journalError('NODE_JOURNAL_SWITCH_IN_FLIGHT', 'The node journal cannot switch identity during a local effect.');
      }
      const nodeRoot = path.join(this.nodesRoot, nodeId);
      const effectsRoot = path.join(nodeRoot, 'effects');
      const receiptsRoot = path.join(nodeRoot, 'receipts');
      const ownerFile = path.join(nodeRoot, 'owner.json');
      await fs.mkdir(effectsRoot, { recursive: true, mode: 0o700 });
      await fs.mkdir(receiptsRoot, { recursive: true, mode: 0o700 });
      for (const directory of [nodeRoot, effectsRoot, receiptsRoot]) {
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw journalError('NODE_JOURNAL_INVALID', 'A node journal namespace is unsafe.');
        }
      }
      let owner;
      try { owner = validateNodeOwner(await readBoundedJson(ownerFile, MAX_OWNER_BYTES), nodeId); }
      catch (error) {
        if (error?.cause?.code !== 'ENOENT' && error?.code !== 'ENOENT') throw error;
        owner = { schemaVersion: 1, nodeId, createdAt: canonicalTimestamp(this.now) };
        await atomicWriteJson(nodeRoot, ownerFile, owner, this.randomUUID, MAX_OWNER_BYTES);
      }
      validateNodeOwner(owner, nodeId);
      await this.#validateSelectedNamespaceRoot(nodeRoot);
      const effects = await this.#loadDirectory(
        effectsRoot, MAX_EFFECTS, MAX_EFFECT_BYTES, validateEffect, 'effect', nodeId,
      );
      const receipts = await this.#loadDirectory(
        receiptsRoot, MAX_RECEIPTS, MAX_RECEIPT_BYTES, validateMastermindNodeReceipt, 'receipt', nodeId,
      );
      await this.#reconcileReceiptWal(effects, receipts, effectsRoot);
      this.#selectedNodeId = nodeId;
      this.nodeRoot = nodeRoot;
      this.effectsRoot = effectsRoot;
      this.receiptsRoot = receiptsRoot;
      this.#effects = effects;
      this.#receipts = receipts;
      return { selectedNodeId: nodeId, effects: effects.size, pendingReceipts: receipts.size };
    });
  }

  acquireExecution(nodeId) {
    if (typeof nodeId !== 'string' || !UUID.test(nodeId)) throw new TypeError('nodeId must be a lowercase UUID');
    return this.#serialized(async () => {
      this.#assertSelectedNode(nodeId);
      this.#activeExecutions += 1;
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await this.#serialized(async () => {
          this.#activeExecutions = Math.max(0, this.#activeExecutions - 1);
        }, { allowPoison: true });
      };
    });
  }

  begin(value) {
    const lease = validateMastermindNodeLease(value);
    return this.#serialized(async () => {
      this.#assertSelectedNode(lease.nodeId);
      const existing = this.#effects.get(lease.jobId);
      if (existing) {
        assertLeaseMatchesEffect(lease, existing);
        return { created: false, effect: structuredClone(existing) };
      }
      if (this.#effects.size >= MAX_EFFECTS) {
        throw journalError('NODE_JOURNAL_QUOTA_EXCEEDED', 'The durable node effect journal is full.');
      }
      const effect = effectForLease(lease, this.now);
      await atomicWriteJson(this.effectsRoot, path.join(this.effectsRoot, `${lease.jobId}.json`), effect, this.randomUUID);
      this.#effects.set(lease.jobId, effect);
      return { created: true, effect: structuredClone(effect) };
    });
  }

  get(value) {
    const lease = validateMastermindNodeLease(value);
    return this.#serialized(async () => {
      this.#assertSelectedNode(lease.nodeId);
      const effect = this.#effects.get(lease.jobId) ?? null;
      if (effect) assertLeaseMatchesEffect(lease, effect);
      return effect ? structuredClone(effect) : null;
    });
  }

  appendReceipt(value, bootId, fields) {
    const lease = validateMastermindNodeLease(value);
    if (typeof bootId !== 'string' || !UUID.test(bootId)) throw new TypeError('bootId must be a lowercase UUID');
    return this.#serialized(async () => {
      this.#assertSelectedNode(lease.nodeId);
      if (this.#receipts.size >= MAX_RECEIPTS) {
        throw journalError('NODE_JOURNAL_QUOTA_EXCEEDED', 'The durable node receipt outbox is full.');
      }
      const current = this.#effects.get(lease.jobId);
      if (!current) throw journalError('NODE_EFFECT_NOT_JOURNALED', 'The command effect must be journaled before a receipt.');
      assertLeaseMatchesEffect(lease, current);
      if (current.lastSequence >= 65_535) {
        throw journalError('NODE_JOURNAL_QUOTA_EXCEEDED', 'The command receipt sequence is exhausted.');
      }
      const receipt = validateMastermindNodeReceipt({
        receiptId: this.randomUUID(),
        jobId: lease.jobId,
        leaseId: lease.leaseId,
        bootId,
        commandDigest: lease.commandDigest,
        sequence: current.lastSequence + 1,
        observedAt: canonicalTimestamp(this.now),
        ...fields,
      });
      const terminal = terminalForReceipt(receipt);
      if (current.terminal && (!terminal || !sameTerminal(current.terminal, terminal))) {
        throw journalError('NODE_EFFECT_TERMINAL_CONFLICT', 'A terminal command effect cannot change.');
      }
      const next = applyNextReceipt(current, receipt);
      // Receipt is the write-ahead record. If publication of the effect fails,
      // this process is poisoned and a restart reconciles the receipt into the
      // effect before any command can resume.
      await atomicWriteJson(this.receiptsRoot, path.join(this.receiptsRoot, `${receipt.receiptId}.json`), receipt, this.randomUUID, MAX_RECEIPT_BYTES);
      this.#receipts.set(receipt.receiptId, receipt);
      try {
        await this.afterReceiptPublished?.(structuredClone(receipt));
        await atomicWriteJson(this.effectsRoot, path.join(this.effectsRoot, `${lease.jobId}.json`), next, this.randomUUID);
        this.#effects.set(lease.jobId, next);
      } catch (error) {
        this.#poisoned = true;
        throw journalError(
          'NODE_JOURNAL_RESTART_REQUIRED',
          'The receipt was preserved, but the node journal must restart before more effects can run.',
          error,
        );
      }
      return structuredClone(receipt);
    });
  }

  replayTerminal(value, bootId) {
    const lease = validateMastermindNodeLease(value);
    return this.#serialized(async () => {
      this.#assertSelectedNode(lease.nodeId);
      const current = this.#effects.get(lease.jobId);
      if (!current) return null;
      assertLeaseMatchesEffect(lease, current);
      if (!current.terminal) return null;
      return this.#appendTerminalWithinQueue(lease, bootId, current.terminal);
    });
  }

  listPendingReceipts(options = {}) {
    const limit = options.limit ?? 32;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw new TypeError('receipt limit must be an integer from 1 through 32');
    }
    return this.#serialized(async () => {
      this.#assertSelectedNode();
      if (options.allowedCapabilities !== undefined) {
        if (!Array.isArray(options.allowedCapabilities) || options.allowedCapabilities.length < 1
          || options.allowedCapabilities.length > 3 || options.allowedCapabilities.some((item) =>
            !['family-ecosystem.ensure-running','mastermind.core.status','mastermind.native.reuse'].includes(item))) throw new TypeError('Explicit known receipt capabilities required');
        if ([...this.#receipts.values()].some((receipt) => {
          const effect = this.#effects.get(receipt.jobId);
          return !effect || effect.commandDigest !== receipt.commandDigest || effect.capabilityVersion !== 1
            || !options.allowedCapabilities.includes(effect.capability);
        })) {
          throw journalError('NODE_RECEIPT_CAPABILITY_RECONCILIATION_REQUIRED', 'Retained receipts need their original capability reconciliation; no receipt was removed.');
        }
      }
      return [...this.#receipts.values()]
        .sort((left, right) => left.jobId.localeCompare(right.jobId)
          || left.sequence - right.sequence || left.receiptId.localeCompare(right.receiptId))
        .slice(0, limit)
        .map((receipt) => structuredClone(receipt));
    });
  }

  commandForReceipt(value) {
    const receipt = validateMastermindNodeReceipt(value);
    return this.#serialized(async () => {
      this.#assertSelectedNode();
      const saved = this.#receipts.get(receipt.receiptId);
      const effect = this.#effects.get(receipt.jobId);
      if (!saved || JSON.stringify(saved) !== JSON.stringify(receipt) || !effect
        || effect.commandDigest !== receipt.commandDigest) {
        throw journalError('NODE_JOURNAL_INVALID', 'Receipt command binding is unavailable.');
      }
      return validateMastermindNodeCommand(Object.fromEntries(
        ['jobId','nodeId','capability','capabilityVersion','policyClass','input'].map(key => [key,effect[key]])));
    });
  }

  acknowledgeReceiptIds(receiptIds) {
    if (!Array.isArray(receiptIds) || receiptIds.length > 32 || receiptIds.some((id) => typeof id !== 'string' || !UUID.test(id))) {
      throw new TypeError('acknowledged receipt IDs must be a bounded UUID array');
    }
    if (new Set(receiptIds).size !== receiptIds.length) throw new TypeError('acknowledged receipt IDs must be unique');
    return this.#serialized(async () => {
      this.#assertSelectedNode();
      let removed = 0;
      for (const receiptId of receiptIds) {
        if (!this.#receipts.has(receiptId)) continue;
        await fs.unlink(path.join(this.receiptsRoot, `${receiptId}.json`));
        this.#receipts.delete(receiptId);
        removed += 1;
      }
      if (removed > 0) await syncDirectory(this.receiptsRoot);
      return { removed, remaining: this.#receipts.size };
    });
  }

  stats() {
    return this.#serialized(async () => {
      this.#assertSelectedNode();
      return {
        selectedNodeId: this.#selectedNodeId,
        effects: this.#effects.size,
        pendingReceipts: this.#receipts.size,
      };
    });
  }

  async #appendTerminalWithinQueue(lease, bootId, terminal) {
    if (typeof bootId !== 'string' || !UUID.test(bootId)) throw new TypeError('bootId must be a lowercase UUID');
    if (this.#receipts.size >= MAX_RECEIPTS) {
      throw journalError('NODE_JOURNAL_QUOTA_EXCEEDED', 'The durable node receipt outbox is full.');
    }
    const current = this.#effects.get(lease.jobId);
    if (!current || current.lastSequence >= 65_535) {
      throw journalError('NODE_JOURNAL_QUOTA_EXCEEDED', 'The command receipt sequence is exhausted.');
    }
    const receipt = validateMastermindNodeReceipt({
      receiptId: this.randomUUID(), jobId: lease.jobId, leaseId: lease.leaseId, bootId,
      commandDigest: lease.commandDigest, sequence: current.lastSequence + 1,
      observedAt: canonicalTimestamp(this.now), ...structuredClone(terminal),
    });
    const next = applyNextReceipt(current, receipt);
    await atomicWriteJson(this.receiptsRoot, path.join(this.receiptsRoot, `${receipt.receiptId}.json`), receipt, this.randomUUID, MAX_RECEIPT_BYTES);
    this.#receipts.set(receipt.receiptId, receipt);
    try {
      await this.afterReceiptPublished?.(structuredClone(receipt));
      await atomicWriteJson(this.effectsRoot, path.join(this.effectsRoot, `${lease.jobId}.json`), next, this.randomUUID);
      this.#effects.set(lease.jobId, next);
    } catch (error) {
      this.#poisoned = true;
      throw journalError(
        'NODE_JOURNAL_RESTART_REQUIRED',
        'The receipt was preserved, but the node journal must restart before more effects can run.',
        error,
      );
    }
    return structuredClone(receipt);
  }

  async #reconcileReceiptWal(effects, pendingReceipts, effectsRoot) {
    const receiptsByJob = new Map();
    for (const receipt of pendingReceipts.values()) {
      const effect = effects.get(receipt.jobId);
      if (!effect || receipt.commandDigest !== effect.commandDigest) {
        throw journalError('NODE_JOURNAL_INVALID', 'A pending receipt has no matching durable command effect.');
      }
      const group = receiptsByJob.get(receipt.jobId) ?? [];
      group.push(receipt);
      receiptsByJob.set(receipt.jobId, group);
    }
    for (const [jobId, receipts] of receiptsByJob) {
      receipts.sort((left, right) => left.sequence - right.sequence || left.receiptId.localeCompare(right.receiptId));
      for (let index = 1; index < receipts.length; index += 1) {
        if (receipts[index].sequence === receipts[index - 1].sequence) {
          throw journalError('NODE_JOURNAL_INVALID', 'A command has duplicate durable receipt sequences.');
        }
      }
      let effect = effects.get(jobId);
      let changed = false;
      for (const receipt of receipts) {
        if (receipt.sequence <= effect.lastSequence) {
          const historicalTerminal = terminalForReceipt(receipt);
          if (historicalTerminal && (!effect.terminal || !sameTerminal(effect.terminal, historicalTerminal))) {
            throw journalError('NODE_JOURNAL_INVALID', 'A historical terminal receipt conflicts with its durable effect.');
          }
          continue;
        }
        effect = applyNextReceipt(effect, receipt);
        changed = true;
      }
      if (changed) {
        await atomicWriteJson(effectsRoot, path.join(effectsRoot, `${jobId}.json`), effect, this.randomUUID);
        effects.set(jobId, effect);
      }
    }
  }

  async #loadDirectory(directory, maximumFiles, maximumBytes, validator, kind, expectedNodeId) {
    if (!['effect', 'receipt'].includes(kind)) throw new TypeError('journal record kind is invalid');
    const records = new Map();
    const handle = await fs.opendir(directory);
    for await (const entry of handle) {
      const match = EFFECT_FILE.exec(entry.name);
      if (match) {
        if (records.size >= maximumFiles) throw journalError('NODE_JOURNAL_QUOTA_EXCEEDED', 'The node journal exceeds its file quota.');
        const value = validator(await readBoundedJson(path.join(directory, entry.name), maximumBytes));
        if (kind === 'effect' && value.nodeId !== expectedNodeId) {
          throw journalError('NODE_JOURNAL_OWNER_MISMATCH', 'A durable effect belongs to another node identity.');
        }
        const identity = kind === 'effect' ? value.jobId : value.receiptId;
        if (identity !== match[1] || records.has(identity)) {
          throw journalError('NODE_JOURNAL_INVALID', 'A node journal filename does not match its record.');
        }
        records.set(identity, value);
        continue;
      }
      if (TEMP_FILE.test(entry.name)) {
        await fs.unlink(path.join(directory, entry.name));
        continue;
      }
      throw journalError('NODE_JOURNAL_INVALID', 'The node journal contains an unsupported entry.');
    }
    return records;
  }

  async #validateNamespaceInventory() {
    let namespaces = 0;
    const handle = await fs.opendir(this.nodesRoot);
    for await (const entry of handle) {
      if (!UUID.test(entry.name)) {
        throw journalError('NODE_JOURNAL_INVALID', 'The portable journal contains an unsupported node namespace.');
      }
      namespaces += 1;
      if (namespaces > MAX_NODE_NAMESPACES) {
        throw journalError('NODE_JOURNAL_QUOTA_EXCEEDED', 'The portable journal has too many preserved node namespaces.');
      }
      const stat = await fs.lstat(path.join(this.nodesRoot, entry.name));
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw journalError('NODE_JOURNAL_INVALID', 'A portable node namespace is unsafe.');
      }
    }
    return namespaces;
  }

  async #validateSelectedNamespaceRoot(nodeRoot) {
    const expected = new Set(['owner.json', 'effects', 'receipts']);
    const handle = await fs.opendir(nodeRoot);
    for await (const entry of handle) {
      if (OWNER_TEMP_FILE.test(entry.name)) {
        await fs.unlink(path.join(nodeRoot, entry.name));
        continue;
      }
      if (!expected.delete(entry.name)) {
        throw journalError('NODE_JOURNAL_INVALID', 'A portable node namespace contains an unsupported entry.');
      }
    }
    if (expected.size > 0) {
      throw journalError('NODE_JOURNAL_INVALID', 'A portable node namespace is incomplete.');
    }
  }

  #assertSelectedNode(expectedNodeId) {
    if (this.#selectedNodeId === null || this.effectsRoot === null || this.receiptsRoot === null) {
      throw journalError('NODE_JOURNAL_NODE_REQUIRED', 'The portable journal must select a node identity first.');
    }
    if (expectedNodeId !== undefined && expectedNodeId !== this.#selectedNodeId) {
      throw journalError('NODE_JOURNAL_OWNER_MISMATCH', 'The command belongs to another node journal namespace.');
    }
  }

  #serialized(operation, { requireInitialized = true, allowPoison = false } = {}) {
    const run = this.#queue.catch(() => undefined).then(async () => {
      if (requireInitialized && !this.#initialized) throw new Error('The node journal must be initialized first.');
      if (requireInitialized && this.#poisoned && !allowPoison) {
        throw journalError('NODE_JOURNAL_RESTART_REQUIRED', 'The node journal must restart before more effects can run.');
      }
      return operation();
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }
}
