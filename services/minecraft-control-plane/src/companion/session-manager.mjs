import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  FAMILY_BRIDGE_CAPABILITIES,
  FAMILY_BRIDGE_MAX_PAYLOAD_BYTES,
  FamilyBridgeProtocolError,
  createFamilyBridgeMessage,
  isTerminalActionStatus,
  parseFamilyBridgeMessage,
  validateFamilyBridgeAction,
} from './protocol.mjs';

const MAX_ACTION_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_ACTION_TIMEOUT_MS = 100;
const MAX_ACTION_HISTORY = 128;
// Minecraft 26.2 can pause the client tick/bridge loop for roughly 25 seconds
// while replacing the death screen with a fresh world. Keep this exceptional
// transition bounded while leaving ordinary heartbeat enforcement unchanged.
const RESPAWN_TRANSITION_GRACE_MS = 45_000;
const REQUIRED_CAPABILITIES = Object.freeze(['state.snapshot', 'action.cancel']);

export class CompanionSessionError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'CompanionSessionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sessionError(statusCode, code, message) {
  return new CompanionSessionError(statusCode, code, message);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function safeCloseReason(value) {
  const text = String(value ?? 'bridge-policy').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 96);
  return text || 'bridge-policy';
}

function defaultActionTimeout(action) {
  if (action.kind.startsWith('direct.')) {
    const duration = Number.isInteger(action.args?.durationMs) ? action.args.durationMs : 0;
    return Math.max(5_000, duration + 2_000);
  }
  return MAX_ACTION_TIMEOUT_MS;
}

function publicAction(record) {
  if (!record) return null;
  return clone({
    actionId: record.actionId,
    kind: record.kind,
    status: record.status,
    dispatchedAt: record.dispatchedAt,
    deadlineAt: record.deadlineAt,
    cancelRequestedAt: record.cancelRequestedAt ?? null,
    cancelReason: record.cancelReason ?? null,
    terminal: record.terminal ?? null,
  });
}

export class CompanionSessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.now = options.now ?? (() => Date.now());
    this.helloTimeoutMs = options.helloTimeoutMs ?? 5_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 2_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 6_000;
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? 1_000;
    this.cancelAckTimeoutMs = options.cancelAckTimeoutMs ?? 5_000;
    this.requiredCapabilities = Object.freeze([...(options.requiredCapabilities ?? REQUIRED_CAPABILITIES)]);
    if (typeof options.verifyHello !== 'function') {
      throw new TypeError('An explicit managed companion process/version verifier is required');
    }
    this.verifyHello = options.verifyHello;
    if (!Number.isInteger(this.helloTimeoutMs) || this.helloTimeoutMs < 1_000 || this.helloTimeoutMs > 30_000) {
      throw new TypeError('helloTimeoutMs must be an integer between 1000 and 30000');
    }
    if (!Number.isInteger(this.heartbeatIntervalMs) || this.heartbeatIntervalMs < 250 || this.heartbeatIntervalMs > 30_000) {
      throw new TypeError('heartbeatIntervalMs must be an integer between 250 and 30000');
    }
    if (!Number.isInteger(this.heartbeatTimeoutMs) || this.heartbeatTimeoutMs < this.heartbeatIntervalMs * 2 || this.heartbeatTimeoutMs > 120_000) {
      throw new TypeError('heartbeatTimeoutMs must be at least two heartbeat intervals and no more than 120000');
    }
    if (!Number.isInteger(this.snapshotIntervalMs) || this.snapshotIntervalMs < 250 || this.snapshotIntervalMs > 30_000) {
      throw new TypeError('snapshotIntervalMs must be an integer between 250 and 30000');
    }
    if (!Number.isInteger(this.cancelAckTimeoutMs) || this.cancelAckTimeoutMs < 250 || this.cancelAckTimeoutMs > 30_000) {
      throw new TypeError('cancelAckTimeoutMs must be an integer between 250 and 30000');
    }
    for (const capability of this.requiredCapabilities) {
      if (!FAMILY_BRIDGE_CAPABILITIES.includes(capability)) throw new TypeError(`Unknown required capability '${capability}'`);
    }
    this.connection = null;
    this.currentSessionId = null;
    this.latestSnapshot = null;
    this.lastDisconnect = null;
    this.actionHistory = new Map();
    this.activeAction = null;
    this.respawnTransitionUntilMs = null;
    this.pendingShutdown = null;
    this.receiveQueue = Promise.resolve();
  }

  hasActiveConnection() {
    return this.connection !== null;
  }

  attachConnection(socket, { sessionId, expectedPid = null } = {}) {
    if (!socket || typeof socket.send !== 'function' || typeof socket.close !== 'function') {
      throw new TypeError('A WebSocket-compatible connection is required');
    }
    if (this.connection) throw sessionError(409, 'COMPANION_SESSION_ACTIVE', 'A Family AI bridge session is already connected.');
    if (expectedPid !== null && (!Number.isInteger(expectedPid) || expectedPid < 1 || expectedPid > 0xffffffff)) {
      throw new TypeError('expectedPid must be a valid process id');
    }
    const now = this.now();
    if (this.currentSessionId !== sessionId) {
      this.currentSessionId = sessionId;
      this.latestSnapshot = null;
      this.actionHistory.clear();
      this.activeAction = null;
      this.respawnTransitionUntilMs = null;
      this.pendingShutdown = null;
    }
    this.connection = {
      socket,
      sessionId,
      expectedPid,
      phase: 'awaiting-hello',
      connectedAt: new Date(now).toISOString(),
      helloDeadlineMs: now + this.helloTimeoutMs,
      lastHeartbeatMs: null,
      lastSnapshotMs: null,
      lastHeartbeat: null,
      client: null,
      capabilities: new Set(),
      incomingSeq: 0,
      outgoingSeq: 0,
      incomingMessageIds: new Set(),
      killSwitch: false,
      hasHeartbeat: false,
      hasSnapshot: false,
    };
    this.receiveQueue = Promise.resolve();
    this.#send('control.hello', {
      supportedVersions: [1],
      helloTimeoutMs: this.helloTimeoutMs,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      heartbeatTimeoutMs: this.heartbeatTimeoutMs,
      maxPayloadBytes: FAMILY_BRIDGE_MAX_PAYLOAD_BYTES,
    });
    this.emit('connection', this.status());
    return this.status();
  }

  receive(value) {
    const operation = this.receiveQueue.then(() => this.#receive(value));
    this.receiveQueue = operation.catch(() => undefined);
    return operation;
  }

  async #receive(value) {
    const connection = this.connection;
    if (!connection) throw sessionError(409, 'COMPANION_DISCONNECTED', 'The Family AI bridge is not connected.');
    const message = parseFamilyBridgeMessage(value, {
      direction: 'client',
      expectedSessionId: connection.sessionId,
    });
    if (message.seq !== connection.incomingSeq + 1) {
      throw new FamilyBridgeProtocolError('SEQUENCE_VIOLATION', 'Client message sequence was not contiguous', 4400);
    }
    if (connection.incomingMessageIds.has(message.messageId)) {
      throw new FamilyBridgeProtocolError('DUPLICATE_MESSAGE', 'Client message id was already used', 4400);
    }
    connection.incomingSeq = message.seq;
    connection.incomingMessageIds.add(message.messageId);
    if (connection.incomingMessageIds.size > 1_024) {
      connection.incomingMessageIds.delete(connection.incomingMessageIds.values().next().value);
    }

    if (connection.phase === 'awaiting-hello') {
      if (message.type !== 'bridge.hello') {
        throw new FamilyBridgeProtocolError('HELLO_REQUIRED', 'bridge.hello must be the first client message', 4400);
      }
      if (connection.expectedPid !== null && message.payload.pid !== connection.expectedPid) {
        throw new FamilyBridgeProtocolError('PROCESS_IDENTITY_MISMATCH', 'Bridge process id did not match the authenticated launch session', 4409);
      }
      const capabilities = new Set(message.payload.capabilities);
      const missing = this.requiredCapabilities.filter((capability) => !capabilities.has(capability));
      if (missing.length) {
        throw new FamilyBridgeProtocolError('CAPABILITY_MISMATCH', `Bridge omitted required capability '${missing[0]}'`, 4406);
      }
      if (await this.verifyHello(clone(message.payload), {
        sessionId: connection.sessionId,
        expectedPid: connection.expectedPid,
      }) !== true) {
        throw new FamilyBridgeProtocolError('PROCESS_IDENTITY_MISMATCH', 'Bridge process identity was not accepted', 4409);
      }
      if (this.connection !== connection) throw sessionError(409, 'COMPANION_DISCONNECTED', 'The bridge disconnected during authentication.');
      connection.phase = 'ready';
      connection.client = clone(message.payload);
      connection.capabilities = capabilities;
      connection.lastHeartbeatMs = this.now();
      this.#send('control.ready', {
        heartbeatIntervalMs: this.heartbeatIntervalMs,
        snapshotIntervalMs: this.snapshotIntervalMs,
        acceptedCapabilities: [...message.payload.capabilities],
      });
      this.emit('ready', this.status());
      return { accepted: true, type: message.type };
    }

    if (message.type === 'bridge.hello') {
      throw new FamilyBridgeProtocolError('UNEXPECTED_HELLO', 'bridge.hello is valid only as the first message', 4400);
    }
    if (connection.phase !== 'ready') throw new FamilyBridgeProtocolError('SESSION_NOT_READY', 'Bridge session is not ready', 4400);

    switch (message.type) {
      case 'bridge.heartbeat':
        this.#acceptHeartbeat(message.payload);
        break;
      case 'state.snapshot':
        this.latestSnapshot = clone(message.payload);
        connection.hasSnapshot = true;
        connection.lastSnapshotMs = this.now();
        connection.killSwitch = message.payload.safety.killSwitch;
        if (this.#isSynchronized(connection, this.now())) this.respawnTransitionUntilMs = null;
        if (connection.killSwitch) this.closeConnection(4403, 'kill-switch-active');
        else if (this.activeAction && !this.#allowsRespawnTransition() && !this.#isSynchronized(connection, this.now())) {
          this.closeConnection(4408, 'family-state-lost');
        }
        this.emit('snapshot', clone(this.latestSnapshot));
        break;
      case 'action.status':
        this.#acceptActionStatus(message.payload);
        break;
      case 'client.shutdownAck':
        if (!this.pendingShutdown || this.pendingShutdown.shutdownId !== message.payload.shutdownId) {
          throw new FamilyBridgeProtocolError('UNKNOWN_SHUTDOWN', 'Shutdown acknowledgement did not match a pending request', 4400);
        }
        this.pendingShutdown = { ...this.pendingShutdown, acknowledgedAt: new Date(this.now()).toISOString() };
        this.emit('shutdownAcknowledged', clone(this.pendingShutdown));
        break;
      default:
        throw new FamilyBridgeProtocolError('UNSUPPORTED_MESSAGE', `Message '${message.type}' is not accepted in ready state`, 4400);
    }
    return { accepted: true, type: message.type };
  }

  #acceptHeartbeat(payload) {
    const connection = this.connection;
    if (payload.activeActionId !== null && payload.activeActionId !== this.activeAction?.actionId) {
      throw new FamilyBridgeProtocolError('ACTION_STATE_MISMATCH', 'Heartbeat referenced an unknown active action', 4400);
    }
    connection.lastHeartbeatMs = this.now();
    connection.lastHeartbeat = clone(payload);
    connection.hasHeartbeat = true;
    connection.killSwitch = payload.killSwitch;
    if (this.#isSynchronized(connection, this.now())) this.respawnTransitionUntilMs = null;
    if (payload.killSwitch) this.closeConnection(4403, 'kill-switch-active');
    else if (this.activeAction && !this.#allowsRespawnTransition() && !this.#isSynchronized(connection, this.now())) {
      this.closeConnection(4408, 'family-state-lost');
    }
    this.emit('heartbeat', clone(payload));
  }

  #acceptActionStatus(payload) {
    const record = this.actionHistory.get(payload.actionId);
    if (!record) throw new FamilyBridgeProtocolError('UNKNOWN_ACTION', 'Action status referenced an unknown action', 4400);
    if (isTerminalActionStatus(record.status)) {
      if (record.status === payload.status && JSON.stringify(record.terminal) === JSON.stringify(payload)) return;
      throw new FamilyBridgeProtocolError('ACTION_ALREADY_TERMINAL', 'A terminal action cannot transition again', 4400);
    }
    const next = payload.status;
    if (record.status === 'started' && next === 'started') return;
    if (record.status === 'dispatched' && next !== 'started') {
      throw new FamilyBridgeProtocolError('ACTION_TRANSITION_INVALID', 'An action must report started before progress or completion', 4400);
    }
    if (record.status === 'started' && !['progress', 'succeeded', 'failed', 'cancelled'].includes(next)) {
      throw new FamilyBridgeProtocolError('ACTION_TRANSITION_INVALID', 'Action status transition is invalid', 4400);
    }
    if (record.status === 'progress' && !['progress', 'succeeded', 'failed', 'cancelled'].includes(next)) {
      throw new FamilyBridgeProtocolError('ACTION_TRANSITION_INVALID', 'Action status transition is invalid', 4400);
    }
    const percent = payload.progress?.percent;
    if (typeof percent === 'number' && typeof record.progressPercent === 'number' && percent < record.progressPercent) {
      throw new FamilyBridgeProtocolError('ACTION_PROGRESS_REVERSED', 'Action progress percentage cannot move backwards', 4400);
    }
    record.status = next;
    record.lastStatusAt = new Date(this.now()).toISOString();
    if (typeof percent === 'number') record.progressPercent = percent;
    if (isTerminalActionStatus(next)) {
      record.terminal = clone(payload);
      record.finishedAt = record.lastStatusAt;
      if (this.activeAction?.actionId === record.actionId) this.activeAction = null;
      if (record.kind === 'direct.respawn' && next !== 'succeeded') this.respawnTransitionUntilMs = null;
      this.#trimActionHistory();
    }
    this.emit('actionStatus', clone(payload), publicAction(record));
  }

  waitForActionActivation(actionId, options = {}) {
    const timeoutMs = options.timeoutMs ?? 3_000;
    const settleMs = options.settleMs ?? 100;
    if (typeof actionId !== 'string' || !this.actionHistory.has(actionId)) {
      throw sessionError(404, 'ACTION_NOT_FOUND', 'The companion action was not found.');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000
      || !Number.isInteger(settleMs) || settleMs < 0 || settleMs > 1_000 || settleMs >= timeoutMs) {
      throw new TypeError('Action activation timing is invalid');
    }
    return new Promise((resolve, reject) => {
      let activationTimer = null;
      const timeout = setTimeout(() => finish(reject, sessionError(504, 'ACTION_START_TIMEOUT', 'The companion action did not confirm activation in time.')), timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        if (activationTimer !== null) clearTimeout(activationTimer);
        this.off('actionStatus', onStatus);
        this.off('disconnect', onDisconnect);
      };
      const finish = (settle, value) => {
        cleanup();
        settle(value);
      };
      const inspect = () => {
        const record = this.actionHistory.get(actionId);
        if (!record) return finish(reject, sessionError(404, 'ACTION_NOT_FOUND', 'The companion action was not found.'));
        if (isTerminalActionStatus(record.status)) {
          if (record.status === 'succeeded') return finish(resolve, publicAction(record));
          const detail = record.terminal?.error?.code ?? record.status;
          return finish(reject, sessionError(409, 'ACTION_START_FAILED', `The companion action failed to activate (${detail}).`));
        }
        if (record.status === 'started' || record.status === 'progress') {
          if (activationTimer !== null) clearTimeout(activationTimer);
          activationTimer = setTimeout(() => {
            activationTimer = null;
            inspect();
            const current = this.actionHistory.get(actionId);
            if (current && (current.status === 'started' || current.status === 'progress')) finish(resolve, publicAction(current));
          }, settleMs);
        }
      };
      const onStatus = (payload) => {
        if (payload.actionId === actionId) inspect();
      };
      const onDisconnect = () => finish(reject, sessionError(409, 'COMPANION_DISCONNECTED', 'The companion disconnected before the action activated.'));
      this.on('actionStatus', onStatus);
      this.on('disconnect', onDisconnect);
      inspect();
    });
  }

  dispatchAction(action, options = {}) {
    validateFamilyBridgeAction(action);
    const connection = this.#requireReady();
    if (this.pendingShutdown) throw sessionError(409, 'SHUTDOWN_PENDING', 'The Family AI client is shutting down.');
    if (connection.killSwitch) throw sessionError(409, 'KILL_SWITCH_ACTIVE', 'The Family AI client kill switch is active.');
    const now = this.now();
    const synchronized = this.#isSynchronized(connection, now);
    if (!synchronized) throw sessionError(409, 'COMPANION_NOT_SYNCHRONIZED', 'The Family AI client has not published a fresh in-world Family Server state.');
    const physical = action.kind !== 'direct.say';
    if (physical && this.activeAction) throw sessionError(409, 'COMPANION_BUSY', 'The Family AI client already has an active action.');
    if (!connection.capabilities.has(action.kind)) {
      throw sessionError(409, 'CAPABILITY_UNAVAILABLE', `The connected bridge does not support '${action.kind}'.`);
    }
    const timeoutMs = options.timeoutMs ?? defaultActionTimeout(action);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_ACTION_TIMEOUT_MS || timeoutMs > MAX_ACTION_TIMEOUT_MS) {
      throw new TypeError(`timeoutMs must be an integer between ${MIN_ACTION_TIMEOUT_MS} and ${MAX_ACTION_TIMEOUT_MS}`);
    }
    const record = {
      actionId: crypto.randomUUID(),
      kind: action.kind,
      action: clone(action),
      status: 'dispatched',
      dispatchedAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + timeoutMs).toISOString(),
    };
    this.actionHistory.set(record.actionId, record);
    if (physical) this.activeAction = record;
    try {
      this.#send('action.execute', {
        actionId: record.actionId,
        deadlineAt: record.deadlineAt,
        action: record.action,
      });
      if (action.kind === 'direct.respawn') this.respawnTransitionUntilMs = now + RESPAWN_TRANSITION_GRACE_MS;
    } catch (error) {
      this.actionHistory.delete(record.actionId);
      if (this.activeAction === record) this.activeAction = null;
      throw error;
    }
    this.emit('actionDispatched', publicAction(record));
    return publicAction(record);
  }

  cancelAction(actionId, reason = 'operator') {
    const connection = this.#requireReady();
    const record = this.actionHistory.get(actionId);
    if (!record) throw sessionError(404, 'ACTION_NOT_FOUND', 'The companion action was not found.');
    if (isTerminalActionStatus(record.status)) return { action: publicAction(record), alreadyTerminal: true, alreadyRequested: false };
    if (record.cancelRequestedAt) return { action: publicAction(record), alreadyTerminal: false, alreadyRequested: true };
    if (!connection.capabilities.has('action.cancel')) {
      throw sessionError(409, 'CAPABILITY_UNAVAILABLE', 'The connected bridge cannot cancel actions.');
    }
    this.#send('action.cancel', { actionId, reason });
    const now = this.now();
    record.cancelRequestedAt = new Date(now).toISOString();
    record.cancelDeadlineMs = now + this.cancelAckTimeoutMs;
    record.cancelReason = reason;
    this.emit('actionCancelRequested', publicAction(record));
    return { action: publicAction(record), alreadyTerminal: false, alreadyRequested: false };
  }

  requestShutdown(timeoutMs = 15_000) {
    const connection = this.#requireReady();
    if (!connection.capabilities.has('client.shutdown')) {
      throw sessionError(409, 'CAPABILITY_UNAVAILABLE', 'The connected bridge cannot perform a graceful client shutdown.');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
      throw new TypeError('shutdown timeout must be an integer between 1000 and 120000');
    }
    if (this.pendingShutdown) return clone(this.pendingShutdown);
    if (this.activeAction && !this.activeAction.cancelRequestedAt) this.cancelAction(this.activeAction.actionId, 'shutdown');
    const now = this.now();
    const pendingShutdown = {
      shutdownId: crypto.randomUUID(),
      requestedAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + timeoutMs).toISOString(),
    };
    this.#send('client.shutdown', {
      shutdownId: pendingShutdown.shutdownId,
      deadlineAt: pendingShutdown.deadlineAt,
    });
    this.pendingShutdown = pendingShutdown;
    return clone(this.pendingShutdown);
  }

  checkLiveness(at = this.now()) {
    const connection = this.connection;
    if (!connection) return this.status(at);
    if (connection.phase === 'awaiting-hello' && at >= connection.helloDeadlineMs) {
      this.closeConnection(4408, 'hello-timeout');
      return this.status(at);
    }
    if (connection.phase === 'ready') {
      if (connection.lastHeartbeatMs !== null
        && at - connection.lastHeartbeatMs >= this.heartbeatTimeoutMs
        && !this.#allowsRespawnTransition(at)) {
        this.closeConnection(4408, 'heartbeat-timeout');
        return this.status(at);
      }
      if (this.activeAction && at >= Date.parse(this.activeAction.deadlineAt) && !this.activeAction.cancelRequestedAt) {
        this.cancelAction(this.activeAction.actionId, 'deadline');
      }
      if (this.activeAction?.cancelRequestedAt && at >= this.activeAction.cancelDeadlineMs) {
        this.closeConnection(4408, 'action-cancel-timeout');
        return this.status(at);
      }
      if (this.pendingShutdown && at >= Date.parse(this.pendingShutdown.deadlineAt)) {
        this.closeConnection(4408, 'client-shutdown-timeout');
        return this.status(at);
      }
      if (this.activeAction && !this.#allowsRespawnTransition(at) && !this.#isSynchronized(connection, at)) {
        this.closeConnection(4408, 'family-state-lost');
        return this.status(at);
      }
    }
    return this.status(at);
  }

  closeConnection(code = 1001, reason = 'control-plane-closing') {
    const connection = this.connection;
    if (!connection) return false;
    try { connection.socket.close(code, safeCloseReason(reason)); }
    finally { this.disconnect(connection.socket, { code, reason }); }
    return true;
  }

  disconnect(socket, { code = 1006, reason = 'connection-lost' } = {}) {
    const connection = this.connection;
    if (!connection || (socket && socket !== connection.socket)) return false;
    const disconnectedAt = new Date(this.now()).toISOString();
    if (this.activeAction && !isTerminalActionStatus(this.activeAction.status)) {
      this.activeAction.status = 'cancelled';
      this.activeAction.finishedAt = disconnectedAt;
      this.activeAction.terminal = {
        actionId: this.activeAction.actionId,
        status: 'cancelled',
        cancellation: { reason: 'connection-lost' },
      };
      this.emit('actionStatus', clone(this.activeAction.terminal), publicAction(this.activeAction));
      this.#trimActionHistory();
      this.activeAction = null;
    }
    this.lastDisconnect = { at: disconnectedAt, code, reason: safeCloseReason(reason) };
    this.connection = null;
    this.respawnTransitionUntilMs = null;
    this.pendingShutdown = null;
    this.emit('disconnect', clone(this.lastDisconnect), this.status());
    return true;
  }

  status(at = this.now()) {
    const connection = this.connection;
    let state = 'disconnected';
    if (connection?.phase === 'awaiting-hello') state = 'handshaking';
    if (connection?.phase === 'ready') {
      const synchronized = this.#isSynchronized(connection, at);
      state = synchronized ? 'ready' : 'syncing';
    }
    return clone({
      state,
      sessionId: connection?.sessionId ?? this.currentSessionId,
      connectedAt: connection?.connectedAt ?? null,
      lastHeartbeatAt: connection?.lastHeartbeatMs == null ? null : new Date(connection.lastHeartbeatMs).toISOString(),
      lastSnapshotAt: connection?.lastSnapshotMs == null ? null : new Date(connection.lastSnapshotMs).toISOString(),
      client: connection?.client ?? null,
      killSwitch: connection?.killSwitch ?? false,
      activeAction: publicAction(this.activeAction),
      latestSnapshot: this.latestSnapshot,
      pendingShutdown: this.pendingShutdown,
      lastDisconnect: this.lastDisconnect,
    });
  }

  #requireReady() {
    if (!this.connection || this.connection.phase !== 'ready') {
      throw sessionError(409, 'COMPANION_NOT_READY', 'The Family AI bridge is not ready.');
    }
    return this.connection;
  }

  #isSynchronized(connection, at) {
    return connection?.hasHeartbeat === true
      && connection?.hasSnapshot === true
      && connection.lastHeartbeatMs !== null
      && connection.lastSnapshotMs !== null
      && at - connection.lastHeartbeatMs < this.heartbeatIntervalMs * 2
      && at - connection.lastSnapshotMs < this.snapshotIntervalMs * 3
      && connection.lastHeartbeat?.phase === 'in-world'
      && this.latestSnapshot?.phase === 'in-world'
      && this.latestSnapshot?.serverAlias === 'family-server'
      && this.latestSnapshot?.player !== null
      && this.latestSnapshot?.world !== null;
  }

  #allowsRespawnTransition(at = this.now()) {
    return Number.isFinite(this.respawnTransitionUntilMs) && at < this.respawnTransitionUntilMs;
  }

  #send(type, payload) {
    const connection = this.connection;
    if (!connection) throw sessionError(409, 'COMPANION_DISCONNECTED', 'The Family AI bridge is not connected.');
    const message = createFamilyBridgeMessage({
      sessionId: connection.sessionId,
      seq: connection.outgoingSeq + 1,
      source: 'control-plane',
      type,
      payload,
      sentAt: new Date(this.now()).toISOString(),
    });
    const serialized = JSON.stringify(message);
    if (Buffer.byteLength(serialized) > FAMILY_BRIDGE_MAX_PAYLOAD_BYTES) {
      throw new FamilyBridgeProtocolError('PAYLOAD_TOO_LARGE', 'Control message exceeds the bridge payload limit', 1009);
    }
    connection.socket.send(serialized);
    connection.outgoingSeq = message.seq;
    return message;
  }

  #trimActionHistory() {
    if (this.actionHistory.size <= MAX_ACTION_HISTORY) return;
    for (const [id, record] of this.actionHistory) {
      if (!isTerminalActionStatus(record.status)) continue;
      this.actionHistory.delete(id);
      if (this.actionHistory.size <= MAX_ACTION_HISTORY) break;
    }
  }
}
