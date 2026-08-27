import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validateFamilyBridgeAction } from './protocol.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;
const READY_CAPABILITIES = Object.freeze([
  'action.cancel', 'direct.say', 'direct.lookAt', 'direct.moveFor', 'direct.jump',
  'direct.selectSlot', 'direct.selectItem', 'direct.use', 'direct.interactBlock',
  'direct.placeBlock', 'direct.placeNearbyBlock', 'direct.dropItem', 'direct.dropItemById',
  'direct.swingHand', 'direct.transferContainer', 'skill.navigateTo',
]);
const CONTROLLER_CAPABILITIES = new Set([
  'observe.snapshot', 'direct.say', 'direct.lookAt', 'direct.moveFor', 'direct.jump',
  'direct.selectSlot', 'direct.selectItem', 'direct.use', 'direct.interactBlock',
  'direct.placeBlock', 'direct.placeNearbyBlock', 'direct.dropItem', 'direct.dropItemById',
  'direct.swingHand', 'direct.transferContainer', 'skill.navigateTo', 'container.open',
  'inventory.transfer', 'container.close', 'action.cancel', 'controller.stop',
]);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const INHERITED_ENVIRONMENT_KEYS = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'WINDIR']);

export class HeadlessControllerError extends Error {
  constructor(statusCode, code, message, options) {
    super(message, options);
    this.name = 'HeadlessControllerError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function fail(statusCode, code, message, cause) {
  throw new HeadlessControllerError(statusCode, code, message, cause ? { cause } : undefined);
}

function canonicalUuid(value) {
  if (typeof value !== 'string') fail(503, 'CONTROLLER_ACCOUNT_INVALID', 'The companion account identity is invalid.');
  const compact = value.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(compact)) fail(503, 'CONTROLLER_ACCOUNT_INVALID', 'The companion account identity is invalid.');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function publicErrorCode(error, fallback = 'CONTROLLER_OPERATION_FAILED') {
  return typeof error?.code === 'string' && SAFE_CODE.test(error.code) ? error.code : fallback;
}

function managedEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => (
    INHERITED_ENVIRONMENT_KEYS.has(key.toUpperCase()) && typeof value === 'string'
  )));
}

function wait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function actionCommand(action, commandId) {
  if (READY_CAPABILITIES.includes(action.kind) && action.kind !== 'action.cancel') {
    return { schemaVersion: 1, commandId, kind: action.kind, args: action.args };
  }
  fail(409, 'CAPABILITY_UNAVAILABLE', `The headless controller does not advertise ${action.kind}.`);
}

function safeOutput(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > 64 * 1024) {
    fail(502, 'CONTROLLER_OUTPUT_INVALID', 'The headless controller emitted an invalid message.');
  }
  let value;
  try { value = JSON.parse(line); } catch {
    fail(502, 'CONTROLLER_OUTPUT_INVALID', 'The headless controller emitted an invalid message.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
    || !canonicalTimestamp(value.at) || !['controller.status', 'action.status', 'command.result'].includes(value.type)) {
    fail(502, 'CONTROLLER_OUTPUT_INVALID', 'The headless controller emitted an invalid message.');
  }
  if (/access.?token|refresh.?token|authorization|bearer/iu.test(JSON.stringify(value))) {
    fail(502, 'CONTROLLER_SECRET_OUTPUT', 'The headless controller violated its output boundary.');
  }
  return value;
}

export class MineflayerZenithControllerManager extends EventEmitter {
  constructor(options = {}) {
    super();
    for (const [key, label] of [['controllerMain', 'controller main'], ['controllerRoot', 'controller root'], ['executable', 'Node executable']]) {
      if (typeof options[key] !== 'string' || !path.isAbsolute(options[key]) || options[key].includes('\0')) {
        throw new TypeError(`${label} must be an absolute path`);
      }
    }
    if (typeof options.getSession !== 'function') throw new TypeError('getSession must be a function');
    if (typeof options.expectedProfileName !== 'string' || !/^[A-Za-z0-9_]{3,16}$/u.test(options.expectedProfileName)) {
      throw new TypeError('expectedProfileName is invalid');
    }
    const port = options.port ?? 25568;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError('port must be an integer from 1024 through 65535');
    this.controllerMain = path.resolve(options.controllerMain);
    this.controllerRoot = path.resolve(options.controllerRoot);
    this.executable = path.resolve(options.executable);
    this.getSession = options.getSession;
    this.expectedProfileName = options.expectedProfileName;
    this.expectedProfileUuid = canonicalUuid(options.expectedProfileUuid);
    this.port = port;
    this.protocolVersion = options.protocolVersion ?? '1.21.11';
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.baseEnvironment = options.baseEnvironment ?? process.env;
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
    this.startTimeoutMs = options.startTimeoutMs ?? 30_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 15_000;
    this.initialized = false;
    this.child = null;
    this.state = 'stopped';
    this.startedAt = null;
    this.stoppedAt = null;
    this.updatedAt = new Date().toISOString();
    this.lastExit = null;
    this.lastErrorCode = null;
    this.capabilities = [];
    this.activeAction = null;
    this.lastAction = null;
    this.latestSnapshot = null;
    this.pendingResults = new Map();
    this.outputBuffer = '';
    this.exitPromise = null;
    this.operation = Promise.resolve();
  }

  async initialize() {
    if (this.initialized) return this.status();
    const [main, root, executable] = await Promise.all([
      fs.lstat(this.controllerMain), fs.lstat(this.controllerRoot), fs.lstat(this.executable),
    ]);
    if (!main.isFile() || main.isSymbolicLink() || !root.isDirectory() || root.isSymbolicLink()
      || !executable.isFile() || executable.isSymbolicLink()) {
      throw new TypeError('The headless controller launch boundary is invalid');
    }
    this.initialized = true;
    return this.status();
  }

  isActive() {
    return this.child !== null || ['starting', 'running', 'stopping'].includes(this.state);
  }

  status() {
    const client = this.state === 'running' ? {
      clientId: 'mineflayer-via-zenith',
      bridgeVersion: 'controller-1',
      minecraftVersion: this.protocolVersion,
      loaderVersion: 'zenith-via',
      baritoneVersion: 'mineflayer-pathfinder-2.4.5',
      capabilities: [...this.capabilities],
    } : null;
    return Object.freeze({
      state: this.state === 'running' ? 'ready' : this.state === 'stopped' ? 'disconnected' : this.state,
      ready: this.state === 'running',
      versionManifest: {
        clientId: 'mineflayer-via-zenith', bridgeVersion: 'controller-1',
        minecraftVersion: this.protocolVersion, loaderVersion: 'zenith-via',
        baritoneVersion: 'mineflayer-pathfinder-2.4.5',
      },
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      updatedAt: this.updatedAt,
      lastExit: this.lastExit ? { ...this.lastExit } : null,
      lastError: this.lastErrorCode ? 'The managed headless companion requires attention.' : null,
      client,
      capabilities: [...this.capabilities],
      activeAction: this.activeAction ? structuredClone(this.activeAction) : null,
      lastAction: this.lastAction ? structuredClone(this.lastAction) : null,
      latestSnapshot: this.latestSnapshot ? structuredClone(this.latestSnapshot) : null,
      killSwitch: false,
    });
  }

  lifecycleStatus() {
    return Object.freeze({
      state: this.state,
      versionManifest: {
        clientId: 'mineflayer-via-zenith', bridgeVersion: 'controller-1',
        minecraftVersion: this.protocolVersion, loaderVersion: 'zenith-via',
        baritoneVersion: 'mineflayer-pathfinder-2.4.5',
      },
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      updatedAt: this.updatedAt,
      lastExit: this.lastExit ? { ...this.lastExit } : null,
      lastError: this.lastErrorCode ? 'The managed headless companion requires attention.' : null,
    });
  }

  start() {
    return this.#serialize(() => this.#start());
  }

  async #start() {
    if (!this.initialized) throw new Error('initialize() must complete before start()');
    if (this.isActive()) fail(409, 'COMPANION_ALREADY_ACTIVE', 'The headless companion is already active.');
    const session = await this.getSession();
    if (!session || typeof session !== 'object' || Array.isArray(session)
      || typeof session.username !== 'string' || !/^[A-Za-z0-9_]{3,16}$/u.test(session.username)
      || typeof session.accessToken !== 'string' || session.accessToken.length < 16 || session.accessToken.length > 8192) {
      fail(503, 'CONTROLLER_ACCOUNT_INVALID', 'The companion account session is unavailable.');
    }
    const uuid = canonicalUuid(session.uuid);
    if (session.username !== this.expectedProfileName || uuid !== this.expectedProfileUuid) {
      fail(409, 'CONTROLLER_ACCOUNT_MISMATCH', 'The authenticated account is not the configured companion identity.');
    }
    this.state = 'starting';
    this.updatedAt = new Date().toISOString();
    this.stoppedAt = null;
    this.lastErrorCode = null;
    this.outputBuffer = '';
    const child = this.spawnProcess(this.executable, [this.controllerMain], {
      cwd: this.controllerRoot,
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: managedEnvironment(this.baseEnvironment),
    });
    if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function'
      || !child.stdin || !child.stdout) {
      this.state = 'failed';
      this.lastErrorCode = 'CONTROLLER_SPAWN_FAILED';
      fail(500, 'CONTROLLER_SPAWN_FAILED', 'The headless controller returned an invalid child handle.');
    }
    this.child = child;
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#acceptOutput(chunk));
    this.exitPromise = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        this.#commitExit(child, code, signal);
        resolve({ code, signal });
      });
    });
    const spawned = new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    try { await spawned; } catch (error) {
      this.child = null;
      this.state = 'failed';
      this.lastErrorCode = 'CONTROLLER_SPAWN_FAILED';
      fail(500, 'CONTROLLER_SPAWN_FAILED', 'The headless controller could not be spawned.', error);
    }
    const launchBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      host: '127.0.0.1',
      port: this.port,
      protocolVersion: this.protocolVersion,
      profile: { name: session.username, uuid },
      accessToken: session.accessToken,
      holdMillis: 86_400_000,
    })}\n`, 'utf8');
    if (launchBytes.length > 16 * 1024) {
      launchBytes.fill(0);
      await this.#terminateChild();
      fail(500, 'CONTROLLER_LAUNCH_ENVELOPE_INVALID', 'The headless controller launch envelope exceeded its bound.');
    }
    await new Promise((resolve, reject) => {
      child.stdin.write(launchBytes, (error) => {
        launchBytes.fill(0);
        if (error) reject(error); else resolve();
      });
    }).catch(async (error) => {
      await this.#terminateChild();
      fail(500, 'CONTROLLER_CREDENTIAL_PIPE_FAILED', 'The private controller launch channel failed.', error);
    });
    const deadline = Date.now() + this.startTimeoutMs;
    while (this.state === 'starting' && this.child === child && Date.now() < deadline) await wait(25);
    if (this.state !== 'running' || this.child !== child) {
      const code = this.lastErrorCode ?? 'CONTROLLER_START_TIMEOUT';
      await this.#terminateChild();
      fail(503, code, 'The headless controller did not become ready.');
    }
    this.startedAt = this.updatedAt;
    void this.#observe().catch(() => {});
    return this.status();
  }

  dispatchAction(action, options = {}) {
    validateFamilyBridgeAction(action);
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 30 * 60_000)) {
      throw new TypeError('timeoutMs is invalid');
    }
    if (this.state !== 'running' || !this.child) fail(409, 'COMPANION_DISCONNECTED', 'The headless companion is not ready.');
    if (!READY_CAPABILITIES.includes(action.kind) || !this.capabilities.includes(action.kind)) {
      fail(409, 'CAPABILITY_UNAVAILABLE', `The headless controller does not advertise ${action.kind}.`);
    }
    const actionId = this.randomUUID();
    if (!UUID.test(actionId)) throw new Error('Secure UUID generation failed');
    if (action.kind !== 'direct.say' && this.activeAction) fail(409, 'COMPANION_BUSY', 'A physical companion action is already active.');
    const command = actionCommand(action, actionId);
    if (action.kind === 'direct.say') {
      return this.#send(command, options.timeoutMs ?? 15_000)
        .then(() => Object.freeze({ actionId, kind: action.kind, status: 'succeeded' }));
    }
    this.#writeCommand(command);
    return Promise.resolve(Object.freeze({ actionId, kind: action.kind, status: 'queued' }));
  }

  async cancelAction(actionId) {
    if (typeof actionId !== 'string' || !UUID.test(actionId)) fail(404, 'ACTION_NOT_FOUND', 'The companion action was not found.');
    if (!this.activeAction || this.activeAction.actionId !== actionId) return Object.freeze({ actionId, alreadyTerminal: true });
    const commandId = this.randomUUID();
    await this.#send({ schemaVersion: 1, commandId, kind: 'action.cancel', args: { actionId } }, 5_000);
    return Object.freeze({ actionId, cancelRequested: true });
  }

  async waitForActionActivation(actionId, options = {}) {
    const timeoutMs = options.timeoutMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.activeAction?.actionId === actionId) return structuredClone(this.activeAction);
      if (this.lastAction?.actionId === actionId) {
        if (this.lastAction.status === 'failed') fail(409, 'ACTION_START_FAILED', 'The companion action failed before stable activation.');
        return structuredClone(this.lastAction);
      }
      if (!this.child || this.state !== 'running') fail(409, 'COMPANION_DISCONNECTED', 'The headless companion disconnected before action activation.');
      if (Date.now() >= deadline) fail(504, 'ACTION_START_TIMEOUT', 'The companion action did not confirm activation in time.');
      await wait(25);
    }
  }

  async waitForPhysicalIdle(actionId, options = {}) {
    const deadline = Date.now() + (options.timeoutMs ?? 15_000);
    while (this.activeAction?.actionId === actionId) {
      if (Date.now() >= deadline) fail(504, 'ACTION_TIMEOUT', 'The companion action did not finish in time.');
      await wait(25);
    }
    if (this.lastAction?.actionId === actionId && this.lastAction.status !== 'succeeded'
      && !(options.allowCancelled === true && this.lastAction.status === 'cancelled')) {
      const error = new HeadlessControllerError(409, 'ACTION_STEP_FAILED', 'The headless controller action did not succeed.');
      error.actionErrorCode = this.lastAction?.terminal?.error?.code ?? this.lastAction?.terminal?.cancellation?.reason ?? null;
      throw error;
    }
    return this.lastAction?.actionId === actionId ? structuredClone(this.lastAction) : null;
  }

  requestShutdown() {
    return this.stop();
  }

  stop(options = {}) {
    return this.#serialize(() => this.#stop(options));
  }

  async #stop(options) {
    if (!this.child) return this.status();
    const timeoutMs = options.gracefulTimeoutMs ?? this.stopTimeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new TypeError('gracefulTimeoutMs is invalid');
    this.state = 'stopping';
    this.updatedAt = new Date().toISOString();
    try {
      const commandId = this.randomUUID();
      await this.#send({ schemaVersion: 1, commandId, kind: 'controller.stop', args: {} }, Math.min(timeoutMs, 5_000));
    } catch { /* Exact child-handle termination remains the fallback. */ }
    const child = this.child;
    const exited = await Promise.race([this.exitPromise.then(() => true), wait(timeoutMs).then(() => false)]);
    if (!exited && this.child === child) await this.#terminateChild();
    return this.status();
  }

  async close() {
    return this.stop();
  }

  #send(command, timeoutMs) {
    this.#writeCommand(command, false);
    const child = this.child;
    if (!child || child.stdin.destroyed) fail(409, 'COMPANION_DISCONNECTED', 'The headless companion is not connected.');
    const line = `${JSON.stringify(command)}\n`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResults.delete(command.commandId);
        reject(new HeadlessControllerError(504, 'CONTROLLER_COMMAND_TIMEOUT', 'The headless controller command timed out.'));
      }, timeoutMs);
      timer.unref?.();
      this.pendingResults.set(command.commandId, { resolve, reject, timer, kind: command.kind });
      child.stdin.write(line, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pendingResults.delete(command.commandId);
        reject(new HeadlessControllerError(500, 'CONTROLLER_COMMAND_PIPE_FAILED', 'The headless controller command channel failed.', { cause: error }));
      });
    });
    return promise;
  }

  #writeCommand(command, write = true) {
    const child = this.child;
    if (!child || child.stdin.destroyed) fail(409, 'COMPANION_DISCONNECTED', 'The headless companion is not connected.');
    const line = `${JSON.stringify(command)}\n`;
    if (Buffer.byteLength(line, 'utf8') > 16 * 1024) throw new TypeError('Controller command exceeds its bound');
    if (write) child.stdin.write(line);
  }

  #acceptOutput(chunk) {
    try {
      this.outputBuffer += chunk;
      if (Buffer.byteLength(this.outputBuffer, 'utf8') > 128 * 1024) {
        fail(502, 'CONTROLLER_OUTPUT_LIMIT_EXCEEDED', 'The headless controller exceeded its output bound.');
      }
      for (;;) {
        const newline = this.outputBuffer.indexOf('\n');
        if (newline < 0) break;
        const line = this.outputBuffer.slice(0, newline).trim();
        this.outputBuffer = this.outputBuffer.slice(newline + 1);
        if (line) this.#acceptMessage(safeOutput(line));
      }
    } catch (error) {
      this.lastErrorCode = publicErrorCode(error, 'CONTROLLER_OUTPUT_INVALID');
      this.state = 'failed';
      this.updatedAt = new Date().toISOString();
      void this.#terminateChild();
    }
  }

  #acceptMessage(message) {
    if (message.type === 'controller.status') {
      if (message.state === 'ready') {
        if (!Array.isArray(message.capabilities) || message.capabilities.some((item) => !CONTROLLER_CAPABILITIES.has(item))) {
          fail(502, 'CONTROLLER_CAPABILITIES_INVALID', 'The headless controller advertised invalid capabilities.');
        }
        this.capabilities = READY_CAPABILITIES.filter((item) => message.capabilities.includes(item));
        this.state = 'running';
        this.updatedAt = message.at;
        this.emit('ready', this.status());
      } else if (message.state === 'failed') {
        this.lastErrorCode = SAFE_CODE.test(message.code ?? '') ? message.code : 'CONTROLLER_FAILED';
        this.state = 'failed';
        this.updatedAt = message.at;
        void this.#terminateChild();
      } else if (message.state === 'hold') {
        this.state = 'hold';
        this.capabilities = [];
        this.updatedAt = message.at;
      } else if (message.state === 'disconnected') {
        this.lastErrorCode = SAFE_CODE.test(message.code ?? '') ? message.code : 'CONTROLLER_DISCONNECTED';
        this.state = 'failed';
        this.updatedAt = message.at;
        void this.#terminateChild();
      }
      return;
    }
    if (message.type === 'action.status') {
      if (typeof message.actionId !== 'string' || !UUID.test(message.actionId)
        || !['started', 'succeeded', 'failed', 'cancelled'].includes(message.status)) {
        fail(502, 'CONTROLLER_OUTPUT_INVALID', 'The headless controller emitted an invalid action status.');
      }
      const record = {
        actionId: message.actionId,
        kind: message.kind,
        status: message.status,
        updatedAt: message.at,
        ...(TERMINAL.has(message.status) ? {
          terminal: message.status === 'failed'
            ? { error: { code: SAFE_CODE.test(message.code ?? '') ? message.code : 'CONTROLLER_ACTION_FAILED' } }
            : message.status === 'cancelled' ? { cancellation: { reason: 'player-request' } } : { evidence: message.evidence ?? null },
        } : {}),
      };
      if (message.status === 'started') this.activeAction = record;
      else {
        if (this.activeAction?.actionId === message.actionId) this.activeAction = null;
        this.lastAction = record;
        void this.#observe().catch(() => {});
      }
      this.emit('actionStatus', structuredClone(record));
      return;
    }
    const pending = this.pendingResults.get(message.commandId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingResults.delete(message.commandId);
    if (message.ok === true) {
      if (message.result?.observation) {
        this.latestSnapshot = structuredClone(message.result.observation);
        this.emit('snapshot', structuredClone(this.latestSnapshot));
      }
      pending.resolve(message.result ?? {});
    } else {
      pending.reject(new HeadlessControllerError(409,
        SAFE_CODE.test(message.code ?? '') ? message.code : 'CONTROLLER_COMMAND_FAILED',
        'The headless controller rejected the command.'));
    }
  }

  #observe() {
    if (this.state !== 'running' || !this.child) return Promise.resolve(null);
    const commandId = this.randomUUID();
    return this.#send({ schemaVersion: 1, commandId, kind: 'observe.snapshot', args: {} }, 5_000);
  }

  #commitExit(child, code, signal) {
    if (this.child !== child) return;
    this.child = null;
    const at = new Date().toISOString();
    const failed = this.state === 'failed' || (this.state !== 'stopping' && code !== 0);
    this.state = failed ? 'failed' : 'stopped';
    this.stoppedAt = at;
    this.updatedAt = at;
    this.lastExit = { code: Number.isInteger(code) ? code : null, signal: typeof signal === 'string' ? signal : null, at };
    if (failed && !this.lastErrorCode) this.lastErrorCode = 'CONTROLLER_EXITED';
    this.capabilities = [];
    this.activeAction = null;
    for (const pending of this.pendingResults.values()) {
      clearTimeout(pending.timer);
      pending.reject(new HeadlessControllerError(409, 'COMPANION_DISCONNECTED', 'The headless controller disconnected.'));
    }
    this.pendingResults.clear();
    this.emit('disconnect', { at, code: this.lastErrorCode, exit: { ...this.lastExit } });
  }

  async #terminateChild() {
    const child = this.child;
    if (!child) return;
    try { child.stdin.end(); } catch { /* Continue to exact child termination. */ }
    try { child.kill('SIGTERM'); } catch { /* Continue to bounded wait. */ }
    const exited = await Promise.race([this.exitPromise.then(() => true), wait(5_000).then(() => false)]);
    if (!exited && this.child === child) {
      try { child.kill('SIGKILL'); } catch { /* The postcondition below remains authoritative. */ }
      await Promise.race([this.exitPromise, wait(5_000)]);
    }
    if (this.child === child) fail(409, 'CONTROLLER_TERMINATION_FAILED', 'The exact headless controller child did not exit.');
  }

  #serialize(operation) {
    const current = this.operation.catch(() => undefined).then(operation);
    this.operation = current;
    return current;
  }
}

export const __test = Object.freeze({ actionCommand, safeOutput });
