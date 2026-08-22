import { EventEmitter } from 'node:events';
import {
  FAMILY_CORE_MAX_PAYLOAD_BYTES,
  FamilyCoreProtocolError,
  createFamilyCoreMessage,
  parseFamilyCoreMessage,
} from './protocol.mjs';

const MAX_MESSAGE_IDS = 1_024;

export class FamilyCoreSessionError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'FamilyCoreSessionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sessionError(statusCode, code, message) {
  return new FamilyCoreSessionError(statusCode, code, message);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class FamilyCoreSessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    if (typeof options.verifyHello !== 'function') {
      throw new TypeError('An explicit Family Core hello verifier is required');
    }
    this.verifyHello = options.verifyHello;
    this.onComputerRequest = options.onComputerRequest ?? null;
    if (this.onComputerRequest !== null && typeof this.onComputerRequest !== 'function') {
      throw new TypeError('onComputerRequest must be a function when provided');
    }
    this.now = options.now ?? (() => Date.now());
    this.helloTimeoutMs = options.helloTimeoutMs ?? 5_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 15_000;
    if (!Number.isInteger(this.helloTimeoutMs) || this.helloTimeoutMs < 1_000 || this.helloTimeoutMs > 30_000) {
      throw new TypeError('helloTimeoutMs must be an integer between 1000 and 30000');
    }
    if (!Number.isInteger(this.heartbeatTimeoutMs) || this.heartbeatTimeoutMs < 2_000 || this.heartbeatTimeoutMs > 120_000) {
      throw new TypeError('heartbeatTimeoutMs must be an integer between 2000 and 120000');
    }
    this.connection = null;
    this.currentSessionId = null;
    this.lastDisconnect = null;
    this.receiveQueue = Promise.resolve();
  }

  hasActiveConnection() {
    return this.connection !== null;
  }

  attachConnection(socket, { sessionId } = {}) {
    if (!socket || typeof socket.send !== 'function' || typeof socket.close !== 'function') {
      throw new TypeError('A WebSocket-compatible connection is required');
    }
    if (this.connection) throw sessionError(409, 'FAMILY_CORE_SESSION_ACTIVE', 'A Family Core server session is already connected.');
    const connectedAtMs = this.now();
    this.currentSessionId = sessionId;
    this.connection = {
      socket,
      sessionId,
      phase: 'awaiting-hello',
      connectedAtMs,
      helloDeadlineMs: connectedAtMs + this.helloTimeoutMs,
      lastHeartbeatMs: null,
      server: null,
      incomingSeq: 0,
      outgoingSeq: 0,
      incomingMessageIds: new Set(),
    };
    this.receiveQueue = Promise.resolve();
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
    if (!connection) throw sessionError(409, 'FAMILY_CORE_DISCONNECTED', 'Family Core is not connected.');
    const message = parseFamilyCoreMessage(value, {
      direction: 'server',
      expectedSessionId: connection.sessionId,
      maxBytes: FAMILY_CORE_MAX_PAYLOAD_BYTES,
    });
    if (message.seq !== connection.incomingSeq + 1) {
      throw new FamilyCoreProtocolError('SEQUENCE_VIOLATION', 'Family Core sequence must be contiguous', 4409);
    }
    if (connection.incomingMessageIds.has(message.messageId)) {
      throw new FamilyCoreProtocolError('DUPLICATE_MESSAGE', 'Family Core message id was already used', 4409);
    }
    connection.incomingSeq = message.seq;
    connection.incomingMessageIds.add(message.messageId);
    if (connection.incomingMessageIds.size > MAX_MESSAGE_IDS) {
      connection.incomingMessageIds.delete(connection.incomingMessageIds.values().next().value);
    }

    if (connection.phase === 'awaiting-hello') {
      if (message.type !== 'server.hello') {
        throw new FamilyCoreProtocolError('HELLO_REQUIRED', 'server.hello must be the first Family Core message', 4408);
      }
      if (await this.verifyHello(clone(message.payload), { sessionId: connection.sessionId }) !== true) {
        throw new FamilyCoreProtocolError('SERVER_IDENTITY_MISMATCH', 'Family Core server identity was not accepted', 4409);
      }
      if (this.connection !== connection) throw sessionError(409, 'FAMILY_CORE_DISCONNECTED', 'Family Core disconnected during authentication.');
      connection.phase = 'ready';
      connection.server = clone(message.payload);
      connection.lastHeartbeatMs = this.now();
      this.emit('ready', this.status());
      return { accepted: true, type: message.type };
    }

    if (message.type === 'server.hello') {
      throw new FamilyCoreProtocolError('UNEXPECTED_HELLO', 'server.hello is valid only as the first message', 4409);
    }
    if (connection.phase !== 'ready') throw new FamilyCoreProtocolError('SESSION_NOT_READY', 'Family Core session is not ready', 4409);

    if (message.type === 'server.heartbeat') {
      connection.lastHeartbeatMs = this.now();
      this.emit('heartbeat', clone(message.payload));
      return { accepted: true, type: message.type };
    }
    if (message.type === 'computer.requested') {
      await this.#handleComputerRequest(message);
      return { accepted: true, type: message.type };
    }
    this.emit('message', clone(message));
    return { accepted: true, type: message.type };
  }

  async #handleComputerRequest(message) {
    this.emit('computer-request', clone(message));
    if (this.onComputerRequest) {
      await this.onComputerRequest(clone(message), {
        send: (type, payload, correlationId = message.messageId) => this.send(type, payload, correlationId),
      });
      return;
    }
    this.send('computer.requestStatus', {
      requestId: message.messageId,
      status: 'rejected',
      message: 'Computer chat is disabled.',
    }, message.messageId);
    this.send('computer.private', {
      minecraftUuid: message.payload.player.minecraftUuid,
      text: '[Computer] Computer chat is not enabled yet.',
    }, message.messageId);
  }

  send(type, payload, correlationId = null) {
    const connection = this.#requireReady();
    const message = createFamilyCoreMessage({
      sessionId: connection.sessionId,
      seq: connection.outgoingSeq + 1,
      source: 'control-plane',
      type,
      payload,
      correlationId,
      sentAt: new Date(this.now()).toISOString(),
    });
    const serialized = JSON.stringify(message);
    if (Buffer.byteLength(serialized, 'utf8') > FAMILY_CORE_MAX_PAYLOAD_BYTES) {
      throw new FamilyCoreProtocolError('PAYLOAD_TOO_LARGE', 'Control message exceeds the Family Core payload limit', 1009);
    }
    connection.socket.send(serialized);
    connection.outgoingSeq = message.seq;
    return message;
  }

  checkLiveness() {
    const connection = this.connection;
    if (!connection) return this.status();
    const at = this.now();
    if (connection.phase === 'awaiting-hello' && at >= connection.helloDeadlineMs) {
      this.closeConnection(4408, 'hello-timeout');
    } else if (connection.phase === 'ready' && at - connection.lastHeartbeatMs >= this.heartbeatTimeoutMs) {
      this.closeConnection(4408, 'heartbeat-timeout');
    }
    return this.status();
  }

  disconnect(socket, { code = 1006, reason = 'connection-lost' } = {}) {
    if (!this.connection || this.connection.socket !== socket) return this.status();
    const previous = this.connection;
    this.connection = null;
    this.lastDisconnect = {
      at: new Date(this.now()).toISOString(),
      code,
      reason: String(reason).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 96) || 'connection-lost',
      sessionId: previous.sessionId,
    };
    this.emit('disconnect', clone(this.lastDisconnect));
    return this.status();
  }

  closeConnection(code = 1001, reason = 'family-core-closing') {
    const connection = this.connection;
    if (!connection) return this.status();
    try { connection.socket.close(code, String(reason).slice(0, 96)); }
    finally { this.disconnect(connection.socket, { code, reason }); }
    return this.status();
  }

  status() {
    const connection = this.connection;
    return clone({
      state: connection?.phase ?? 'disconnected',
      sessionId: connection?.sessionId ?? this.currentSessionId,
      connectedAt: connection ? new Date(connection.connectedAtMs).toISOString() : null,
      lastHeartbeatAt: connection?.lastHeartbeatMs == null ? null : new Date(connection.lastHeartbeatMs).toISOString(),
      server: connection?.server ?? null,
      lastDisconnect: this.lastDisconnect,
    });
  }

  #requireReady() {
    if (!this.connection || this.connection.phase !== 'ready') {
      throw sessionError(409, 'FAMILY_CORE_NOT_READY', 'Family Core is not ready.');
    }
    return this.connection;
  }
}
