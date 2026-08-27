import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateInstanceId } from './config.mjs';

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ADMIN_PLAN_ID_PATTERN = /^admplan-[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const JAVA_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const BROADCAST_PATTERN = /^[\x20-\x7e]{1,256}$/;
const ISO_LIMIT = 64;
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const MAX_LEDGER_RECORDS = 20_000;
const PLAN_TTL_MS = 5 * 60 * 1000;
const AUDIT_SEGMENT_BYTES = 256 * 1024;
const AUDIT_SEGMENTS = 4;
const TARGET_KINDS = new Set(['whitelist.add', 'whitelist.remove', 'player.kick', 'player.ban', 'player.pardon', 'player.op', 'player.deop']);
const REFRESH_KINDS = new Set(['players.refresh', 'whitelist.refresh']);
const PROTECTED_KINDS = new Set(['whitelist.set', ...TARGET_KINDS]);
const ALL_KINDS = new Set([...REFRESH_KINDS, ...PROTECTED_KINDS, 'broadcast']);
const REASON_CODES = new Set(['operator-request', 'rule-violation', 'unsafe-behavior']);
const FIXED_REASONS = Object.freeze({
  'operator-request': 'Removed by a server operator',
  'rule-violation': 'Server rule violation',
  'unsafe-behavior': 'Unsafe behavior',
});
const CONFIRMATIONS = Object.freeze({
  'whitelist.set': 'CONFIRM WHITELIST CHANGE',
  'whitelist.add': 'CONFIRM WHITELIST CHANGE',
  'whitelist.remove': 'CONFIRM WHITELIST CHANGE',
  'player.kick': 'CONFIRM PLAYER DISCIPLINE',
  'player.ban': 'CONFIRM PLAYER DISCIPLINE',
  'player.pardon': 'CONFIRM PLAYER DISCIPLINE',
  'player.op': 'CONFIRM OPERATOR CHANGE',
  'player.deop': 'CONFIRM OPERATOR CHANGE',
});

function adminError(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function keyedDigest(key, value) {
  return crypto.createHmac('sha256', key).update(canonicalJson(value), 'utf8').digest('hex');
}

function hmacTarget(key, player) {
  return player ? crypto.createHmac('sha256', key).update(player.toLowerCase(), 'utf8').digest('hex') : undefined;
}

function normalizeRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) {
    throw adminError('ADMIN_INVALID_REQUEST', 400, 'requestId must be a valid UUID.');
  }
  return value.toLowerCase();
}

function normalizePlayer(value) {
  if (typeof value !== 'string' || !JAVA_USERNAME_PATTERN.test(value)) {
    throw adminError('ADMIN_INVALID_PLAYER', 400, 'player must be a Java account name containing 3-16 ASCII letters, numbers, or underscores.');
  }
  return value;
}

export function validateServerAdminAction(input) {
  if (!plain(input) || typeof input.kind !== 'string') {
    throw adminError('ADMIN_INVALID_REQUEST', 400, 'Server administration action must be a typed JSON object.');
  }
  const requestId = normalizeRequestId(input.requestId);
  const kind = input.kind;
  if (REFRESH_KINDS.has(kind)) {
    if (!exactKeys(input, ['requestId', 'kind'])) throw adminError('ADMIN_INVALID_REQUEST', 400, 'Refresh actions do not accept additional fields.');
    return { requestId, kind };
  }
  if (kind === 'broadcast') {
    if (!exactKeys(input, ['requestId', 'kind', 'message']) || typeof input.message !== 'string'
      || !BROADCAST_PATTERN.test(input.message) || input.message.trim() !== input.message) {
      throw adminError('ADMIN_INVALID_MESSAGE', 400, 'message must contain 1-256 printable ASCII characters with no leading or trailing whitespace.');
    }
    return { requestId, kind, message: input.message };
  }
  if (kind === 'whitelist.set') {
    if (!exactKeys(input, ['requestId', 'kind', 'enabled']) || typeof input.enabled !== 'boolean') {
      throw adminError('ADMIN_INVALID_REQUEST', 400, 'whitelist.set requires exactly one boolean enabled field.');
    }
    return { requestId, kind, enabled: input.enabled };
  }
  if (!TARGET_KINDS.has(kind)) throw adminError('ADMIN_ACTION_UNSUPPORTED', 400, 'The requested server administration action is not supported.');
  const reasonAllowed = kind === 'player.kick' || kind === 'player.ban';
  if (!exactKeys(input, ['requestId', 'kind', 'player'], reasonAllowed ? ['reasonCode'] : [])) {
    throw adminError('ADMIN_INVALID_REQUEST', 400, 'The server administration action contains unsupported fields.');
  }
  const player = normalizePlayer(input.player);
  if (input.reasonCode !== undefined && (!reasonAllowed || !REASON_CODES.has(input.reasonCode))) {
    throw adminError('ADMIN_INVALID_REASON', 400, 'reasonCode is not an approved fixed reason.');
  }
  return {
    requestId,
    kind,
    player,
    ...(reasonAllowed ? { reasonCode: input.reasonCode ?? 'operator-request' } : {}),
  };
}

export function compileServerAdminCommand(input) {
  const action = validateServerAdminAction(input);
  const commands = {
    'players.refresh': () => 'list',
    'whitelist.refresh': () => 'whitelist list',
    broadcast: () => `say ${action.message}`,
    'whitelist.set': () => `whitelist ${action.enabled ? 'on' : 'off'}`,
    'whitelist.add': () => `whitelist add ${action.player}`,
    'whitelist.remove': () => `whitelist remove ${action.player}`,
    'player.kick': () => `kick ${action.player} ${FIXED_REASONS[action.reasonCode]}`,
    'player.ban': () => `ban ${action.player} ${FIXED_REASONS[action.reasonCode]}`,
    'player.pardon': () => `pardon ${action.player}`,
    'player.op': () => `op ${action.player}`,
    'player.deop': () => `deop ${action.player}`,
  };
  return { action, command: commands[action.kind]() };
}

function validatePlanAction(input, requestId) {
  if (!plain(input) || Object.hasOwn(input, 'requestId') || Object.hasOwn(input, 'approval')) {
    throw adminError('ADMIN_INVALID_REQUEST', 400, 'Plan action must omit requestId and approval.');
  }
  const action = validateServerAdminAction({ requestId, ...input });
  if (!PROTECTED_KINDS.has(action.kind)) {
    throw adminError('ADMIN_PLAN_NOT_REQUIRED', 400, 'This administration action does not require a plan.');
  }
  return action;
}

function actionWithoutApproval(input) {
  if (!plain(input)) throw adminError('ADMIN_INVALID_REQUEST', 400, 'Server administration action must be a typed JSON object.');
  const { approval, ...candidate } = input;
  const action = validateServerAdminAction(candidate);
  if (PROTECTED_KINDS.has(action.kind)) {
    if (!plain(approval) || !exactKeys(approval, ['planId', 'confirmation'])
      || !ADMIN_PLAN_ID_PATTERN.test(approval.planId ?? '') || approval.confirmation !== CONFIRMATIONS[action.kind]) {
      throw adminError('ADMIN_APPROVAL_REQUIRED', 409, 'This action requires its exact current administration plan confirmation.');
    }
    return { action, approval: { planId: approval.planId, confirmation: approval.confirmation } };
  }
  if (approval !== undefined) throw adminError('ADMIN_INVALID_REQUEST', 400, 'This action does not accept an approval.');
  return { action, approval: null };
}

function validIso(value) {
  return typeof value === 'string' && value.length <= ISO_LIMIT && Number.isFinite(Date.parse(value));
}

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(normalizedPath(root), normalizedPath(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function publicOperation(record) {
  return {
    requestId: record.requestId,
    kind: record.kind,
    state: record.state,
    application: record.state === 'rejected-before-delivery' ? 'not-delivered' : 'unconfirmed',
    updatedAt: record.updatedAt,
    ...(REFRESH_KINDS.has(record.kind) && record.state === 'delivered-unconfirmed'
      ? { outputRequested: true }
      : {}),
  };
}

function validateLedger(value) {
  if (!plain(value) || !exactKeys(value, ['schemaVersion', 'operations', 'plans']) || value.schemaVersion !== 2
    || !Array.isArray(value.operations) || !Array.isArray(value.plans)
    || value.operations.length + value.plans.length > MAX_LEDGER_RECORDS) {
    throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration journal is unavailable.');
  }
  const ids = new Set();
  for (const operation of value.operations) {
    if (!plain(operation) || !exactKeys(operation, ['instanceId', 'requestId', 'actionDigest', 'kind', 'state', 'createdAt', 'updatedAt'], ['targetHmac', 'messageLength', 'reasonCode'])
      || !validateInstanceId(operation.instanceId)
      || !REQUEST_ID_PATTERN.test(operation.requestId) || operation.requestId !== operation.requestId.toLowerCase() || !SHA256_PATTERN.test(operation.actionDigest)
      || !['pending', 'delivered-unconfirmed', 'delivery-unknown', 'rejected-before-delivery'].includes(operation.state)
      || !ALL_KINDS.has(operation.kind) || !validIso(operation.createdAt) || !validIso(operation.updatedAt)
      || Date.parse(operation.updatedAt) < Date.parse(operation.createdAt)
      || (operation.targetHmac !== undefined && !SHA256_PATTERN.test(operation.targetHmac))
      || (operation.messageLength !== undefined && (!Number.isInteger(operation.messageLength) || operation.messageLength < 1 || operation.messageLength > 256))
      || (operation.reasonCode !== undefined && !REASON_CODES.has(operation.reasonCode))
      || ids.has(operation.requestId)) {
      throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration journal is unavailable.');
    }
    ids.add(operation.requestId);
  }
  const planIds = new Set();
  for (const plan of value.plans) {
    if (!plain(plan) || !exactKeys(plan, ['instanceId', 'planId', 'requestId', 'actionDigest', 'kind', 'launchGeneration', 'confirmation', 'state', 'createdAt', 'expiresAt'], ['usedAt'])
      || !validateInstanceId(plan.instanceId)
      || !ADMIN_PLAN_ID_PATTERN.test(plan.planId) || !REQUEST_ID_PATTERN.test(plan.requestId) || plan.requestId !== plan.requestId.toLowerCase()
      || !SHA256_PATTERN.test(plan.actionDigest) || !SHA256_PATTERN.test(plan.launchGeneration)
      || CONFIRMATIONS[plan.kind] !== plan.confirmation || !['active', 'used'].includes(plan.state)
      || !validIso(plan.createdAt) || !validIso(plan.expiresAt) || Date.parse(plan.expiresAt) <= Date.parse(plan.createdAt)
      || (plan.state === 'active' && plan.usedAt !== undefined)
      || (plan.state === 'used' && (!validIso(plan.usedAt) || Date.parse(plan.usedAt) < Date.parse(plan.createdAt)))
      || planIds.has(plan.planId) || ids.has(`plan:${plan.requestId}`)) {
      throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration journal is unavailable.');
    }
    planIds.add(plan.planId);
    ids.add(`plan:${plan.requestId}`);
  }
  return value;
}

export class FamilyServerAdminManager {
  #queue = Promise.resolve();

  constructor(managedRoot, store, processes, options = {}) {
    this.managedRoot = path.resolve(managedRoot);
    this.store = store;
    this.processes = processes;
    this.root = path.join(this.managedRoot, 'private', 'server-administration');
    this.auditRoot = path.join(this.root, 'audit');
    this.ledgerFile = path.join(this.root, 'ledger.json');
    this.keyFile = path.join(this.root, 'audit-hmac.key');
    this.now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
    this.planTtlMs = Number.isInteger(options.planTtlMs) && options.planTtlMs >= 1_000 ? options.planTtlMs : PLAN_TTL_MS;
    this.auditKey = null;
  }

  async initialize() {
    try {
      await this.#ensurePrivateRoots();
      await this.#assertAnchors();
      this.auditKey = await this.#loadOrCreateKey();
      const ledger = await this.#readLedger();
      let reconciled = false;
      const at = this.now();
      for (const operation of ledger.operations) {
        if (operation.state !== 'pending') continue;
        operation.state = 'delivery-unknown';
        operation.updatedAt = at;
        reconciled = true;
      }
      if (reconciled) await this.#writeLedger(ledger);
    } catch (error) {
      if (error?.code?.startsWith?.('ADMIN_')) throw error;
      throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration journal is unavailable.');
    }
  }

  async status(instanceId) {
    this.#validateInstanceId(instanceId);
    return this.processes.withInstanceLock(instanceId, async () => {
      const instance = await this.#familyInstance(instanceId);
      const availability = await this.#availability(instanceId, instance);
      return {
        available: availability.reason === 'ready',
        reason: availability.reason,
        running: availability.running,
        playerVisibility: 'unavailable',
        onlinePlayers: null,
        whitelist: { enabled: null, players: null },
        checkedAt: this.now(),
      };
    });
  }

  async createPlan(instanceId, input) {
    this.#validateInstanceId(instanceId);
    if (!plain(input) || !exactKeys(input, ['requestId', 'action'])) throw adminError('ADMIN_INVALID_REQUEST', 400, 'Plan request must contain exactly requestId and action.');
    const requestId = normalizeRequestId(input.requestId);
    const action = validatePlanAction(input.action, requestId);
    return this.#serialized(() => this.processes.withInstanceLock(instanceId, async () => {
      const instance = await this.#familyInstance(instanceId);
      const availability = await this.#availability(instanceId, instance);
      if (availability.reason !== 'ready') throw this.#availabilityError(availability.reason);
      const ledger = await this.#readLedger();
      const actionDigest = keyedDigest(this.auditKey, action);
      const existing = ledger.plans.find((plan) => plan.requestId === requestId);
      if (existing) {
        if (existing.instanceId !== instanceId || existing.actionDigest !== actionDigest) throw adminError('ADMIN_REQUEST_ID_CONFLICT', 409, 'requestId was already used for a different administration plan.');
        if (existing.state !== 'active' || Date.parse(existing.expiresAt) <= Date.parse(this.now())) throw adminError('ADMIN_PLAN_EXPIRED', 409, 'The administration plan is expired or already used.');
        if (existing.launchGeneration !== availability.launchGeneration) {
          throw adminError('ADMIN_PLAN_EXPIRED', 409, 'The administration plan belongs to a previous server launch.');
        }
        return this.#publicPlan(existing);
      }
      this.#assertLedgerCapacity(ledger);
      const createdAt = this.now();
      const record = {
        instanceId,
        planId: `admplan-${crypto.randomBytes(32).toString('hex')}`,
        requestId,
        actionDigest,
        kind: action.kind,
        launchGeneration: availability.launchGeneration,
        confirmation: CONFIRMATIONS[action.kind],
        state: 'active',
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + this.planTtlMs).toISOString(),
      };
      ledger.plans.push(record);
      await this.#writeLedger(ledger);
      await this.#appendAudit(instanceId, action, 'plan-created', createdAt);
      return this.#publicPlan(record);
    }));
  }

  async execute(instanceId, input) {
    this.#validateInstanceId(instanceId);
    const { action, approval } = actionWithoutApproval(input);
    return this.#serialized(() => this.processes.withInstanceLock(instanceId, () => this.#executeLocked(instanceId, action, approval)));
  }

  async operation(instanceId, requestId) {
    this.#validateInstanceId(instanceId);
    const normalized = normalizeRequestId(requestId);
    await this.#familyInstance(instanceId);
    return this.#serialized(async () => {
      const ledger = await this.#readLedger();
      const record = ledger.operations.find((item) => item.requestId === normalized && item.instanceId === instanceId);
      if (!record) throw adminError('ADMIN_OPERATION_NOT_FOUND', 404, 'The administration operation was not found.');
      if (record.state === 'pending') {
        record.state = 'delivery-unknown';
        record.updatedAt = this.now();
        await this.#writeLedger(ledger);
      }
      return publicOperation(record);
    });
  }

  async #executeLocked(instanceId, action, approval) {
    const ledger = await this.#readLedger();
    const actionDigest = keyedDigest(this.auditKey, action);
    const existing = ledger.operations.find((record) => record.requestId === action.requestId);
    if (existing) {
      if (existing.instanceId !== instanceId || existing.actionDigest !== actionDigest) throw adminError('ADMIN_REQUEST_ID_CONFLICT', 409, 'requestId was already used for a different administration action.');
      if (existing.state === 'pending') {
        existing.state = 'delivery-unknown';
        existing.updatedAt = this.now();
        await this.#writeLedger(ledger);
      }
      return publicOperation(existing);
    }
    const instance = await this.#familyInstance(instanceId);
    const availability = await this.#availability(instanceId, instance);
    if (availability.reason !== 'ready') throw this.#availabilityError(availability.reason);
    let plan = null;
    if (PROTECTED_KINDS.has(action.kind)) {
      plan = ledger.plans.find((item) => item.planId === approval.planId);
      if (!plan || plan.instanceId !== instanceId || plan.requestId !== action.requestId || plan.actionDigest !== actionDigest || plan.kind !== action.kind
        || plan.confirmation !== approval.confirmation || plan.launchGeneration !== availability.launchGeneration
        || plan.state !== 'active' || Date.parse(plan.expiresAt) <= Date.parse(this.now())) {
        throw adminError('ADMIN_APPROVAL_INVALID', 409, 'The administration approval is missing, expired, used, mismatched, or bound to another server launch.');
      }
    }
    this.#assertLedgerCapacity(ledger);
    const createdAt = this.now();
    const operation = {
      instanceId,
      requestId: action.requestId,
      actionDigest,
      kind: action.kind,
      state: 'pending',
      createdAt,
      updatedAt: createdAt,
      ...(action.player ? { targetHmac: hmacTarget(this.auditKey, action.player) } : {}),
      ...(action.message ? { messageLength: action.message.length } : {}),
      ...(action.reasonCode ? { reasonCode: action.reasonCode } : {}),
    };
    ledger.operations.push(operation);
    if (plan) { plan.state = 'used'; plan.usedAt = createdAt; }
    await this.#writeLedger(ledger);
    try {
      await this.#appendAudit(instanceId, action, 'requested', createdAt);
    } catch {
      operation.state = 'rejected-before-delivery';
      operation.updatedAt = this.now();
      try { await this.#writeLedger(ledger); } catch { /* Pending is already non-replayable. */ }
      throw adminError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The administration audit trail is unavailable; the action was not delivered.');
    }
    let deliveryReturned = false;
    try {
      const delivery = await this.processes.executeTypedAdminActionWithinInstanceLock(instanceId, action);
      deliveryReturned = true;
      operation.state = 'delivered-unconfirmed';
      operation.updatedAt = validIso(delivery?.acceptedAt) ? delivery.acceptedAt : this.now();
      await this.#writeLedger(ledger);
      try { await this.#appendAudit(instanceId, action, 'delivered-unconfirmed', operation.updatedAt); } catch { /* Durable delivery truth wins. */ }
      return publicOperation(operation);
    } catch (error) {
      operation.state = deliveryReturned || error?.code === 'ADMIN_COMPLETION_UNKNOWN'
        ? 'delivery-unknown'
        : 'rejected-before-delivery';
      operation.updatedAt = this.now();
      try {
        await this.#writeLedger(ledger);
      } catch {
        throw adminError('ADMIN_COMPLETION_UNKNOWN', 409, 'The administration request outcome is unknown; reconcile it by requestId and do not retry automatically.');
      }
      try { await this.#appendAudit(instanceId, action, operation.state, operation.updatedAt); } catch { /* The durable operation tombstone remains authoritative. */ }
      if (operation.state === 'delivery-unknown') return publicOperation(operation);
      throw error;
    }
  }

  #publicPlan(record) {
    return {
      planId: record.planId,
      requestId: record.requestId,
      actionDigest: record.actionDigest,
      launchGeneration: record.launchGeneration,
      confirmation: record.confirmation,
      expiresAt: record.expiresAt,
    };
  }

  async #availability(instanceId, instance) {
    if (typeof this.processes.inspectTypedAdminAvailabilityWithinInstanceLock !== 'function') {
      return { running: instance.status === 'running', reason: 'process-unavailable', launchGeneration: null };
    }
    const value = await this.processes.inspectTypedAdminAvailabilityWithinInstanceLock(instanceId);
    if (value?.reason === 'ready' && SHA256_PATTERN.test(value.launchGeneration ?? '')) return { running: true, reason: 'ready', launchGeneration: value.launchGeneration };
    if (value?.reason === 'instance-not-running') return { running: false, reason: 'instance-not-running', launchGeneration: null };
    return { running: instance.status === 'running', reason: 'process-unavailable', launchGeneration: null };
  }

  #availabilityError(reason) {
    return reason === 'instance-not-running'
      ? adminError('ADMIN_SERVER_NOT_RUNNING', 409, 'The Family Server must be running before administration actions are accepted.')
      : adminError('ADMIN_PROCESS_UNAVAILABLE', 409, 'The exact ready agent-owned Family Server control channel is unavailable.');
  }

  async #familyInstance(instanceId) {
    const instance = await this.store.get(instanceId);
    if (!instance) throw adminError('ADMIN_INSTANCE_NOT_FOUND', 404, 'The Family Server instance was not found.');
    if (instance.projectId !== 'family-server' || instance.kind !== 'server') throw adminError('ADMIN_INVALID_INSTANCE', 409, 'Only an isolated Family Server can use server administration.');
    return instance;
  }

  #validateInstanceId(instanceId) {
    if (!validateInstanceId(instanceId)) throw adminError('ADMIN_INVALID_INSTANCE_ID', 400, 'Invalid instance id.');
  }

  #assertLedgerCapacity(ledger) {
    if (ledger.operations.length + ledger.plans.length >= MAX_LEDGER_RECORDS) {
      throw adminError('ADMIN_JOURNAL_FULL', 507, 'The immutable administration journal reached its safe capacity.');
    }
  }

  #serialized(operation) {
    const current = this.#queue.catch(() => undefined).then(operation);
    this.#queue = current;
    return current;
  }

  async #assertAnchors() {
    const canonicalRoot = await fs.realpath(this.managedRoot);
    for (const directory of [this.managedRoot, path.join(this.managedRoot, 'private'), this.root, this.auditRoot]) {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration private state is unavailable.');
      const canonical = await fs.realpath(directory);
      if (!pathIsWithin(canonicalRoot, canonical)) throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration private state is unavailable.');
    }
  }

  async #ensurePrivateRoots() {
    let parent = this.managedRoot;
    let rootStat;
    try { rootStat = await fs.lstat(parent); }
    catch { throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration private state is unavailable.'); }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration private state is unavailable.');
    const canonicalRoot = await fs.realpath(parent);
    if (normalizedPath(canonicalRoot) !== normalizedPath(parent)) {
      throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration private state is unavailable.');
    }
    for (const name of ['private', 'server-administration', 'audit']) {
      const parentStat = await fs.lstat(parent);
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration private state is unavailable.');
      const child = path.join(parent, name);
      try { await fs.mkdir(child, { mode: 0o700 }); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
      const childStat = await fs.lstat(child);
      if (!childStat.isDirectory() || childStat.isSymbolicLink()) throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration private state is unavailable.');
      const canonicalChild = await fs.realpath(child);
      if (!pathIsWithin(canonicalRoot, canonicalChild)) throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration private state is unavailable.');
      parent = child;
    }
  }

  async #safeRegularFile(file, allowMissing = true) {
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('unsafe');
      return stat;
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return null;
      throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration private state is unavailable.');
    }
  }

  async #loadOrCreateKey() {
    const existing = await this.#safeRegularFile(this.keyFile);
    if (!existing) {
      const handle = await fs.open(this.keyFile, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(crypto.randomBytes(32)); await handle.sync(); } finally { await handle.close(); }
      await this.#syncDirectory(this.root);
    }
    let handle;
    try {
      handle = await fs.open(this.keyFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== 32) throw new Error('unsafe');
      return await handle.readFile();
    } catch {
      throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration private state is unavailable.');
    } finally { await handle?.close().catch(() => undefined); }
  }

  async #readLedger() {
    const stat = await this.#safeRegularFile(this.ledgerFile);
    if (!stat) return { schemaVersion: 2, operations: [], plans: [] };
    if (stat.size > MAX_LEDGER_BYTES) throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration journal is unavailable.');
    let handle;
    try {
      handle = await fs.open(this.ledgerFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.size > MAX_LEDGER_BYTES) throw new Error('unsafe');
      return validateLedger(JSON.parse(await handle.readFile('utf8')));
    } catch (error) {
      if (error?.code?.startsWith?.('ADMIN_')) throw error;
      throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration journal is unavailable.');
    } finally { await handle?.close().catch(() => undefined); }
  }

  async #writeLedger(ledger) {
    validateLedger(ledger);
    const text = `${JSON.stringify(ledger, null, 2)}\n`;
    if (Buffer.byteLength(text) > MAX_LEDGER_BYTES) throw adminError('ADMIN_JOURNAL_FULL', 507, 'The immutable administration journal reached its safe capacity.');
    const temporary = `${this.ledgerFile}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let handle;
    try {
      await this.#assertAnchors();
      await this.#safeRegularFile(this.ledgerFile);
      handle = await fs.open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
      await handle.writeFile(text, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, this.ledgerFile);
      await this.#syncDirectory(this.root);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temporary).catch(() => undefined);
      if (error?.code?.startsWith?.('ADMIN_')) throw error;
      throw adminError('ADMIN_JOURNAL_UNAVAILABLE', 503, 'The administration journal is unavailable.');
    }
  }

  async #appendAudit(instanceId, action, status, at) {
    const targetHmac = hmacTarget(this.auditKey, action.player);
    const line = `${JSON.stringify({
      schemaVersion: 1, at, instanceId, requestId: action.requestId, kind: action.kind, status,
      ...(targetHmac ? { targetHmac } : {}),
      ...(action.message ? { messageLength: action.message.length } : {}),
      ...(action.reasonCode ? { reasonCode: action.reasonCode } : {}),
    })}\n`;
    const current = path.join(this.auditRoot, 'audit.jsonl');
    try {
      await this.#assertAnchors();
      const currentStat = await this.#safeRegularFile(current);
      if (currentStat && currentStat.size + Buffer.byteLength(line) > AUDIT_SEGMENT_BYTES) await this.#rotateAudit(current);
      await this.#safeRegularFile(current);
      const handle = await fs.open(current, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW, 0o600);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('unsafe');
        await handle.writeFile(line, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      await this.#syncDirectory(this.auditRoot);
    } catch {
      throw adminError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The administration audit trail is unavailable.');
    }
  }

  async #rotateAudit(current) {
    const oldest = path.join(this.auditRoot, `audit.${AUDIT_SEGMENTS - 1}.jsonl`);
    await this.#safeRegularFile(oldest);
    await fs.unlink(oldest).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    for (let index = AUDIT_SEGMENTS - 2; index >= 1; index -= 1) {
      const source = path.join(this.auditRoot, `audit.${index}.jsonl`);
      const target = path.join(this.auditRoot, `audit.${index + 1}.jsonl`);
      const stat = await this.#safeRegularFile(source);
      if (stat) await fs.rename(source, target);
    }
    await this.#safeRegularFile(current, false);
    await fs.rename(current, path.join(this.auditRoot, 'audit.1.jsonl'));
    await this.#syncDirectory(this.auditRoot);
  }

  async #syncDirectory(directory) {
    let handle;
    try { handle = await fs.open(directory, 'r'); await handle.sync(); }
    catch (error) { if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error?.code)) throw error; }
    finally { await handle?.close().catch(() => undefined); }
  }
}
