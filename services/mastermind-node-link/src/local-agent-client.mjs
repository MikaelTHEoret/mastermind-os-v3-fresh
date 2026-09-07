import { validateMastermindNodeStatus } from '../../../protocol/mastermind-node-exchange/contract.mjs';

const MAX_LOCAL_RESPONSE_BYTES = 256 * 1024;
const LOCAL_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const FAMILY_STATES = new Set(['stopped', 'starting', 'running', 'stopping', 'failed']);
const COMPANION_STATES = new Set(['stopped', 'starting', 'running', 'stopping', 'failed', 'orphaned']);
const BRIDGE_STATES = new Set(['disconnected', 'handshaking', 'syncing', 'ready']);

export class MastermindLocalAgentError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'MastermindLocalAgentError';
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable === true;
  }
}

function localError(code, message, options) {
  return new MastermindLocalAgentError(code, message, options);
}

function exactLoopbackBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('agentBaseUrl must be a valid loopback URL'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.search || url.hash || !['/', ''].includes(url.pathname)) {
    throw new TypeError('agentBaseUrl must be an exact 127.0.0.1 HTTP origin');
  }
  const port = Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new TypeError('agentBaseUrl port is invalid');
  return `${url.protocol}//${url.hostname}:${url.port}`;
}

function canonicalTimestamp(now) {
  return new Date(now()).toISOString();
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw localError('LOCAL_RESPONSE_INVALID', `${label} was invalid.`, { retryable: false });
  }
  return value;
}

function boundedArray(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw localError('LOCAL_RESPONSE_INVALID', `${label} was invalid.`, { retryable: false });
  }
  return value;
}

async function readBoundedJson(response) {
  const declared = Number(response.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_LOCAL_RESPONSE_BYTES) {
    throw localError('LOCAL_RESPONSE_INVALID', 'The local response was too large.', { retryable: false });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_LOCAL_RESPONSE_BYTES) {
    throw localError('LOCAL_RESPONSE_INVALID', 'The local response was too large.', { retryable: false });
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw localError('LOCAL_RESPONSE_INVALID', 'The local response was invalid.', { retryable: false, cause: error });
  }
}

function recoveryState(overview) {
  const counts = [
    overview?.backupRecovery?.manualRecoveryRequired,
    overview?.backupRecovery?.globalRecoveryRequired,
    overview?.updateRecovery?.manualRecoveryRequired,
    overview?.worldRecovery?.manualRecoveryRequired,
  ];
  return counts.some((value) => Number.isSafeInteger(value) && value > 0)
    ? 'manual-repair-required'
    : 'clear';
}

function unavailableStatus(now, code) {
  return validateMastermindNodeStatus({
    observedAt: canonicalTimestamp(now),
    controlAgent: 'unreachable',
    recovery: 'unknown',
    familyServer: 'unknown',
    companion: 'unknown',
    companionBridge: 'unknown',
    localKillSwitch: null,
    attentionCodes: [code === 'LOCAL_RESPONSE_INVALID' ? 'local-response-invalid' : 'control-agent-unreachable'],
  });
}

export class MastermindLocalAgentClient {
  constructor(options = {}) {
    this.baseUrl = exactLoopbackBaseUrl(options.agentBaseUrl ?? 'http://127.0.0.1:43100');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    if (typeof this.token !== 'string' || this.token.length < 32 || this.token.length > 512
      || /[\u0000-\u0020\u007f]/u.test(this.token)) {
      throw new TypeError('local agent token is invalid');
    }
    if (typeof this.fetchImpl !== 'function' || typeof this.now !== 'function') {
      throw new TypeError('local agent fetch and clock must be functions');
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 120_000) {
      throw new TypeError('local agent timeout must be between 1000 and 120000 milliseconds');
    }
  }

  async observeStatus(options = {}) {
    const includeClientStatus = options.includeClientStatus !== false;
    let overview;
    let instances;
    try {
      const [overviewBody, instancesBody] = await Promise.all([
        this.#request('/v1/overview', { signal: options.signal }),
        this.#request('/v1/instances', { signal: options.signal }),
      ]);
      overview = record(overviewBody.overview ?? overviewBody, 'Local overview');
      if (overviewBody.ok !== true) throw localError('LOCAL_RESPONSE_INVALID', 'Local overview was invalid.');
      if (instancesBody.ok !== true) throw localError('LOCAL_RESPONSE_INVALID', 'Local instance inventory was invalid.');
      instances = boundedArray(instancesBody.instances, 4_096, 'Local instance inventory');
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const code = error instanceof MastermindLocalAgentError ? error.code : 'CONTROL_AGENT_UNREACHABLE';
      return unavailableStatus(this.now, code);
    }

    const family = instances.find((item) => item?.id === 'family-server') ?? null;
    const familyServer = family === null
      ? 'missing'
      : FAMILY_STATES.has(family.status) ? family.status : 'unknown';
    const recovery = recoveryState(overview);
    const attentionCodes = [];
    if (recovery === 'manual-repair-required') attentionCodes.push('recovery-manual-repair');
    if (familyServer === 'missing') attentionCodes.push('family-server-not-provisioned');
    if (familyServer === 'failed') attentionCodes.push('family-server-failed');

    const companionReads = await Promise.allSettled([
      this.#request('/v1/companion/status', { signal: options.signal }),
      this.#request('/v1/account', { signal: options.signal }),
      includeClientStatus
        ? this.#request('/v1/client/status', { signal: options.signal })
        : Promise.resolve(null),
    ]);
    if (options.signal?.aborted) {
      const rejected = companionReads.find((read) => read.status === 'rejected');
      throw rejected?.reason ?? options.signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    let companionState = 'unknown';
    let companionBridge = 'unknown';
    let localKillSwitch = null;
    if (companionReads.every((read) => read.status === 'fulfilled')) {
      try {
        const [companionBody, accountBody, clientBody] = companionReads.map((read) => read.value);
      const companion = record(companionBody.companion, 'Local companion status');
      const lifecycle = record(companion.lifecycle, 'Local companion lifecycle');
      const bridge = record(companion.bridge, 'Local companion bridge');
      const account = record(accountBody.account, 'Local account status');
      const client = includeClientStatus ? record(clientBody.client, 'Local client status') : null;
      if (companionBody.ok !== true || accountBody.ok !== true || (includeClientStatus && clientBody.ok !== true)) {
        throw localError('LOCAL_RESPONSE_INVALID', 'A local companion response was invalid.');
      }
      const lifecycleState = COMPANION_STATES.has(lifecycle.state) ? lifecycle.state : 'stopped';
        companionState = ['starting', 'running', 'stopping', 'failed', 'orphaned'].includes(lifecycleState)
        ? lifecycleState
        : includeClientStatus && client.installed !== true
          ? 'not-installed'
          : account.signedIn !== true
            ? 'sign-in-required'
            : 'stopped';
        companionBridge = BRIDGE_STATES.has(bridge.state) ? bridge.state : 'unknown';
        localKillSwitch = typeof bridge.killSwitch === 'boolean' ? bridge.killSwitch : null;
      if (companionState === 'not-installed') attentionCodes.push('companion-not-installed');
      if (companionState === 'sign-in-required') attentionCodes.push('companion-sign-in-required');
      if (companionState === 'failed') attentionCodes.push('companion-failed');
      if (companionState === 'orphaned') attentionCodes.push('companion-orphaned');
      if (localKillSwitch === true) attentionCodes.push('companion-local-kill-switch');
      } catch {
        companionState = 'unknown';
        companionBridge = 'unknown';
        localKillSwitch = null;
        attentionCodes.push('local-response-invalid');
      }
    } else {
      // Server inventory is authoritative and already succeeded. A failure in
      // any optional companion read must not erase that server state or turn
      // the whole control agent into an unreachable snapshot.
      attentionCodes.push('local-response-invalid');
    }
    return validateMastermindNodeStatus({
      observedAt: canonicalTimestamp(this.now),
      controlAgent: 'online',
      recovery,
      familyServer,
      companion: companionState,
      companionBridge,
      localKillSwitch,
      attentionCodes: [...new Set(attentionCodes)].sort(),
    });
  }

  async ensureFamilyServerRunning(options = {}) {
    const body = await this.#request('/v1/instances/family-server/ensure-running', {
      method: 'POST', signal: options.signal,
    });
    const instance = record(body.instance, 'Ensure-running instance');
    if (body.ok !== true || !['started', 'already-running'].includes(body.action)
      || instance.id !== 'family-server' || !FAMILY_STATES.has(instance.status)) {
      throw localError('LOCAL_RESPONSE_INVALID', 'The local ensure-running response was invalid.', { retryable: false });
    }
    return { action: body.action, status: instance.status };
  }

  async startCompanion(options = {}) {
    try {
      const body = await this.#request('/v1/companion/start', { method: 'POST', signal: options.signal });
      const companion = record(body.companion, 'Companion start response');
      const lifecycle = record(companion.lifecycle, 'Companion lifecycle');
      if (body.ok !== true || !COMPANION_STATES.has(lifecycle.state)) {
        throw localError('LOCAL_RESPONSE_INVALID', 'The local companion start response was invalid.', { retryable: false });
      }
      return { state: lifecycle.state };
    } catch (error) {
      if (error instanceof MastermindLocalAgentError && error.code === 'COMPANION_ALREADY_ACTIVE') {
        return { state: 'already-active' };
      }
      throw error;
    }
  }

  async #request(pathname, options = {}) {
    let response;
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method: options.method ?? 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.token}` },
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw localError('CONTROL_AGENT_UNREACHABLE', 'The local Minecraft control agent is unreachable.', {
        retryable: true, cause: error,
      });
    }
    const body = await readBoundedJson(response);
    if (!response.ok) {
      const code = typeof body?.code === 'string' && LOCAL_CODE.test(body.code) ? body.code : 'LOCAL_ACTION_FAILED';
      throw localError(code, 'The local Minecraft control action was rejected.', {
        status: response.status,
        retryable: response.status >= 500,
      });
    }
    return record(body, 'Local response');
  }
}
