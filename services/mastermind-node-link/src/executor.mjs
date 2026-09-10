import {
  MASTERMIND_NODE_CAPABILITY,
  validateMastermindNodeLease,
  validateMastermindNodeStatus,
} from '../../../protocol/mastermind-node-exchange/contract.mjs';
import { MastermindLocalAgentError } from './local-agent-client.mjs';

const LOCAL_FAILURE_CODES = new Map([
  ['BACKUP_MANUAL_RECOVERY_REQUIRED', ['recovery-manual-repair', false]],
  ['CONTROL_RECOVERY_REQUIRED', ['recovery-manual-repair', false]],
  ['MOD_MANUAL_RECOVERY_REQUIRED', ['recovery-manual-repair', false]],
  ['WORLD_RECOVERY_REQUIRED', ['recovery-manual-repair', false]],
  ['UPDATE_RECOVERY_REQUIRED', ['recovery-manual-repair', false]],
  ['UPDATE_APPROVAL_REQUIRED', ['minecraft-update-approval-required', false]],
  ['INSTANCE_NOT_FOUND', ['family-server-not-provisioned', false]],
  ['SAFE_STOP_REQUIRED', ['local-safe-stop-required', false]],
  ['COMPANION_NOT_INSTALLED', ['companion-not-installed', false]],
  ['COMPANION_ORPHANED', ['companion-orphaned', false]],
  ['COMPANION_LOCAL_KILL_SWITCH', ['companion-local-kill-switch', false]],
  ['MINECRAFT_AUTH_REQUIRED', ['companion-sign-in-required', false]],
  ['MINECRAFT_ACCOUNT_REQUIRED', ['companion-sign-in-required', false]],
  ['MINECRAFT_APP_REGISTRATION_REQUIRED', ['companion-sign-in-required', false]],
  ['CONTROL_AGENT_UNREACHABLE', ['control-agent-unreachable', true]],
  ['LOCAL_RESPONSE_INVALID', ['local-response-invalid', false]],
]);

export class MastermindNodeExecutionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'MastermindNodeExecutionError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.result = options.result ?? null;
  }
}

function executionError(code, message, options) {
  return new MastermindNodeExecutionError(code, message, options);
}

function terminalResult(status) {
  if (!status) return null;
  return {
    familyServer: status.familyServer,
    companion: status.companion,
    companionBridge: status.companionBridge,
  };
}

function assertServerPreconditions(status) {
  validateMastermindNodeStatus(status);
  if (status.controlAgent !== 'online') {
    throw executionError(
      status.attentionCodes.includes('local-response-invalid') ? 'local-response-invalid' : 'control-agent-unreachable',
      'The local control agent is unavailable.',
      { retryable: !status.attentionCodes.includes('local-response-invalid'), result: terminalResult(status) },
    );
  }
  if (status.recovery === 'manual-repair-required') {
    throw executionError('recovery-manual-repair', 'Managed recovery requires manual repair.', {
      retryable: false, result: terminalResult(status),
    });
  }
  if (status.familyServer === 'missing') {
    throw executionError('family-server-not-provisioned', 'The Family Server is not provisioned.', {
      retryable: false, result: terminalResult(status),
    });
  }
  return status;
}

function assertCompanionPreconditions(status) {
  assertServerPreconditions(status);
  if (status.attentionCodes.includes('local-response-invalid')) {
    throw executionError('local-response-invalid', 'The local companion status is incomplete or invalid.', {
      retryable: false, result: terminalResult(status),
    });
  }
  if (status.localKillSwitch === true) {
    throw executionError('companion-local-kill-switch', 'The local companion kill switch is engaged.', {
      retryable: false, result: terminalResult(status),
    });
  }
  if (status.companion === 'not-installed') {
    throw executionError('companion-not-installed', 'The Family AI companion is not installed.', {
      retryable: false, result: terminalResult(status),
    });
  }
  if (status.companion === 'sign-in-required') {
    throw executionError('companion-sign-in-required', 'The Family AI companion requires sign-in.', {
      retryable: false, result: terminalResult(status),
    });
  }
  if (status.companion === 'orphaned') {
    throw executionError('companion-orphaned', 'The Family AI companion is orphaned.', {
      retryable: false, result: terminalResult(status),
    });
  }
  return status;
}

function desiredState(status) {
  return status.familyServer === 'running'
    && status.companion === 'running'
    && status.companionBridge === 'ready';
}

function budgetError() {
  return executionError('lease-lost', 'The leased family ecosystem action no longer has a safe execution budget.', {
    retryable: true,
  });
}

async function abortableDelay(milliseconds, signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(), milliseconds);
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export class FamilyEcosystemEnsureRunningExecutor {
  constructor(options = {}) {
    this.localAgent = options.localAgent;
    this.now = options.now ?? Date.now;
    this.delay = options.delay ?? abortableDelay;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    if (!this.localAgent || typeof this.localAgent.observeStatus !== 'function'
      || typeof this.localAgent.ensureFamilyServerRunning !== 'function'
      || typeof this.localAgent.startCompanion !== 'function') {
      throw new TypeError('localAgent must expose status and fixed ensure-running operations');
    }
    if (typeof this.now !== 'function' || typeof this.delay !== 'function') throw new TypeError('executor clock and delay must be functions');
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 100 || this.pollIntervalMs > 5_000) {
      throw new TypeError('executor poll interval must be between 100 and 5000 milliseconds');
    }
  }

  async execute(value, options = {}) {
    const lease = validateMastermindNodeLease(value);
    if (lease.capability !== MASTERMIND_NODE_CAPABILITY) {
      throw executionError('local-response-invalid', 'The leased capability is unsupported.', { retryable: false });
    }
    if (typeof options.emit !== 'function') throw new TypeError('executor emit callback is required');
    if (!Number.isSafeInteger(options.deadlineMs) || options.deadlineMs <= this.now()) throw budgetError();
    // deadlineMs is derived from hosted serverTime and request RTT by the node
    // link. Do not compare the host wall clock directly with lease timestamps.
    const deadline = options.deadlineMs;
    const deadlineSignal = AbortSignal.timeout(Math.max(1, Math.ceil(deadline - this.now())));
    const signal = options.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal;
    const assertBudget = () => {
      if (this.now() >= deadline || deadlineSignal.aborted) throw budgetError();
    };
    let lastStatus = null;
    try {
      await options.emit('checking-local-state');
      assertBudget();
      lastStatus = assertServerPreconditions(await this.localAgent.observeStatus({
        signal,
        includeClientStatus: false,
      }));
      assertBudget();

      if (lastStatus.familyServer === 'stopping') {
        await options.emit('waiting-family-server');
        assertBudget();
        lastStatus = await this.#waitFor(
          (status) => status.familyServer !== 'stopping', deadline, signal, assertServerPreconditions,
          false,
        );
      }
      if (lastStatus.familyServer !== 'running') {
        await options.emit('starting-family-server');
        assertBudget();
        try {
          await this.localAgent.ensureFamilyServerRunning({ signal });
          assertBudget();
        } catch (error) {
          if (deadlineSignal.aborted) throw budgetError();
          if (!(error instanceof MastermindLocalAgentError) || error.retryable !== true) throw error;
        }
        await options.emit('waiting-family-server');
        assertBudget();
        lastStatus = await this.#waitFor(
          (status) => status.familyServer === 'running', deadline, signal, assertServerPreconditions,
          false,
        );
      }

      // Companion readiness can block only the companion half of the effect.
      // A valid Family Server remains running when sign-in/install/kill-switch
      // attention is needed.
      assertBudget();
      lastStatus = assertCompanionPreconditions(await this.localAgent.observeStatus({ signal }));
      assertBudget();
      if (desiredState(lastStatus)) {
        assertBudget();
        return terminalResult(lastStatus);
      }
      if (lastStatus.companion === 'stopping') {
        await options.emit('waiting-companion');
        assertBudget();
        lastStatus = await this.#waitFor(
          (status) => status.companion !== 'stopping', deadline, signal, assertCompanionPreconditions,
        );
      }
      if (lastStatus.companion === 'starting') {
        await options.emit('waiting-companion');
        assertBudget();
        lastStatus = await this.#waitFor(desiredState, deadline, signal, assertCompanionPreconditions);
      } else if (lastStatus.companion !== 'running') {
        await options.emit('starting-companion');
        assertBudget();
        try {
          await this.localAgent.startCompanion({ signal });
          assertBudget();
        } catch (error) {
          if (deadlineSignal.aborted) throw budgetError();
          if (!(error instanceof MastermindLocalAgentError) || error.retryable !== true) throw error;
          // Lost mutation responses are reconciled by status GET below. Never
          // issue a second companion start POST under the same durable effect.
        }
      }
      if (!desiredState(lastStatus)) {
        await options.emit('waiting-companion');
        assertBudget();
        lastStatus = await this.#waitFor(desiredState, deadline, signal, assertCompanionPreconditions);
      }
      assertBudget();
      return terminalResult(lastStatus);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (deadlineSignal.aborted || this.now() >= deadline) throw budgetError();
      if (error instanceof MastermindNodeExecutionError) throw error;
      if (error instanceof MastermindLocalAgentError) {
        const [code, retryable] = LOCAL_FAILURE_CODES.get(error.code)
          ?? [error.code.startsWith('COMPANION_') ? 'companion-start-failed' : 'family-server-start-failed', error.retryable];
        throw executionError(code, 'The local family ecosystem action failed safely.', {
          retryable, result: terminalResult(lastStatus), cause: error,
        });
      }
      throw executionError('family-server-start-failed', 'The local family ecosystem action failed safely.', {
        retryable: false, result: terminalResult(lastStatus), cause: error,
      });
    }
  }

  async #waitFor(predicate, deadline, signal, precondition, includeClientStatus = true) {
    do {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      if (this.now() >= deadline) {
        throw executionError('execution-timeout', 'The leased family ecosystem action timed out.', { retryable: true });
      }
      await this.delay(Math.min(this.pollIntervalMs, Math.max(1, deadline - this.now())), signal);
      if (this.now() >= deadline || signal?.aborted) throw budgetError();
      const observed = await this.localAgent.observeStatus({ signal, includeClientStatus });
      if (this.now() >= deadline || signal?.aborted) throw budgetError();
      try {
        const status = precondition(observed);
        if (predicate(status)) return status;
      } catch (error) {
        if (!(error instanceof MastermindNodeExecutionError) || error.retryable !== true) throw error;
        // A transiently unreachable control agent is expected after an
        // ambiguous mutation response. Keep reconciling until the deadline.
      }
    } while (true);
  }
}
