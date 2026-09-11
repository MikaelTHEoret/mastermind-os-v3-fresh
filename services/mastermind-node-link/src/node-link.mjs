import {NATIVE_REUSE_CAPABILITY} from '../../../protocol/mastermind-node-exchange/native-task.mjs';
import {NATIVE_CATALOG_CAPABILITY,sameNativeDisclosure} from '../../../protocol/mastermind-node-exchange/native-catalog.mjs';
import crypto from 'node:crypto';

import {
  validateMastermindNodeExchangeRequest,
  validateMastermindNodeExchangeResponse,
  validateMastermindNodePairRequest,
  validateMastermindNodePairResponse,
  validateMastermindNodeStatus,
  validateMastermindNodeWorker,
  MASTERMIND_CORE_STATUS_CAPABILITY,
} from '../../../protocol/mastermind-node-exchange/contract.mjs';
import {
  inspectMastermindNodeCredentialState,
  markMastermindNodePaired,
  retireMastermindNodePendingPairing,
} from './credential-store.mjs';
import { MastermindNodeExecutionError } from './executor.mjs';
import { MastermindNodeHttpsTransportError } from './fixed-https-transport.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const HEALTH_STATES = new Set(['starting', 'unpaired', 'pairing', 'online', 'degraded', 'stopped']);

export class MastermindNodeLinkError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'MastermindNodeLinkError';
    this.code = code;
  }
}

function linkError(code, message, cause) {
  return new MastermindNodeLinkError(code, message, cause ? { cause } : undefined);
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
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(), milliseconds);
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function sanitizedHealth(value) {
  if (!value || !HEALTH_STATES.has(value.state)) throw new Error('invalid node-link health state');
  return Object.freeze({
    state: value.state,
    paired: value.paired === true,
    lastExchangeAt: value.lastExchangeAt ?? null,
    lastErrorCode: value.lastErrorCode ?? null,
    attentionCode: value.state === 'unpaired'
      ? 'node-unpaired'
      : value.state === 'pairing'
        ? 'node-pairing-pending'
        : value.state === 'degraded' ? 'node-link-degraded' : null,
  });
}

/**
 * Durable node exchange coordinator.
 *
 * The destination-specific authenticated transport is intentionally injected.
 * It owns credential use; this coordinator sees only redacted enrollment state
 * and strict protocol messages.
 */
export class MastermindNodeLink {
  #initialized = false;
  #runTail = Promise.resolve();
  #loopPromise = null;
  #completionPromise = null;
  #controller = null;
  #health = sanitizedHealth({ state: 'stopped', paired: false });

  constructor(options = {}) {
    this.credentialStore = options.credentialStore;
    this.exchangeTransport = options.exchangeTransport;
    this.journal = options.journal;
    this.executor = options.executor;
    this.statusProvider = options.statusProvider;
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => Math.floor(performance.now()));
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
    this.delay = options.delay ?? abortableDelay;
    this.agentVersion = options.agentVersion ?? '0.1.0';
    this.requireExistingPairing = options.requireExistingPairing === true;
    this.worker = options.worker == null ? null : validateMastermindNodeWorker(options.worker);
    this.bootId = options.bootId ?? this.randomUUID();
    this.unpairedPollMs = options.unpairedPollMs ?? 5_000;
    if (!this.credentialStore || typeof this.credentialStore.load !== 'function') throw new TypeError('credentialStore is required');
    if (!this.exchangeTransport || typeof this.exchangeTransport.pair !== 'function'
      || typeof this.exchangeTransport.exchange !== 'function') {
      throw new TypeError('an exchangeTransport with pair() and exchange() is required');
    }
    if (!this.journal || typeof this.journal.initialize !== 'function' || typeof this.journal.begin !== 'function'
      || typeof this.journal.appendReceipt !== 'function' || typeof this.journal.listPendingReceipts !== 'function'
      || typeof this.journal.acknowledgeReceiptIds !== 'function' || typeof this.journal.replayTerminal !== 'function'
      || typeof this.journal.selectNode !== 'function' || typeof this.journal.acquireExecution !== 'function') {
      throw new TypeError('a durable node effect journal is required');
    }
    if (!this.executor || typeof this.executor.execute !== 'function') throw new TypeError('executor is required');
    if (!this.statusProvider || typeof this.statusProvider.observeStatus !== 'function') throw new TypeError('statusProvider is required');
    if (typeof this.now !== 'function' || typeof this.monotonicNow !== 'function'
      || typeof this.randomUUID !== 'function' || typeof this.delay !== 'function') {
      throw new TypeError('node-link runtime dependencies are invalid');
    }
    if (!UUID.test(this.bootId)) throw new TypeError('bootId must be a lowercase UUID');
    if (!Number.isSafeInteger(this.unpairedPollMs) || this.unpairedPollMs < 1_000 || this.unpairedPollMs > 30_000) {
      throw new TypeError('unpaired poll interval is invalid');
    }
  }

  async initialize() {
    if (this.#initialized) return this.health();
    this.#setHealth({ state: 'starting', paired: false });
    await this.journal.initialize();
    this.#initialized = true;
    try {
      const enrollment = await inspectMastermindNodeCredentialState(this.credentialStore);
      const paired = enrollment.state === 'paired';
      this.#setHealth({
        state: paired ? 'degraded' : enrollment.state === 'pending' ? 'pairing' : 'unpaired',
        paired,
        lastErrorCode: paired ? 'NODE_EXCHANGE_PENDING' : null,
      });
    } catch (error) {
      const code = typeof error?.code === 'string' && SAFE_ERROR_CODE.test(error.code)
        ? error.code
        : 'NODE_CREDENTIAL_UNAVAILABLE';
      this.#setHealth({ state: 'degraded', paired: false, lastErrorCode: code });
    }
    return this.health();
  }

  async start() {
    if (!this.#initialized) await this.initialize();
    if (this.#loopPromise) return this.health();
    this.#controller = new AbortController();
    this.#loopPromise = this.#runLoop(this.#controller.signal).finally(() => {
      this.#loopPromise = null;
      this.#controller = null;
      this.#setHealth({ state: 'stopped', paired: this.#health.paired });
    });
    this.#completionPromise = this.#loopPromise;
    // Keep the background rejection handled for embedding callers; a dedicated
    // worker entrypoint can still await wait() and exit nonzero on a fatal
    // journal-restart condition.
    this.#loopPromise.catch(() => undefined);
    return this.health();
  }

  wait() {
    return this.#completionPromise ?? Promise.resolve(this.health());
  }

  async stop() {
    this.#controller?.abort(new DOMException('Node link stopping', 'AbortError'));
    await this.#loopPromise?.catch(() => undefined);
    await this.#runTail.catch(() => undefined);
    this.#setHealth({ state: 'stopped', paired: this.#health.paired });
    return this.health();
  }

  runOnce(options = {}) {
    const run = this.#runTail.catch(() => undefined).then(async () => {
      if (!this.#initialized) await this.initialize();
      return this.#exchangeOnce(options.signal);
    });
    this.#runTail = run.catch(() => undefined);
    return run;
  }

  health() {
    return sanitizedHealth(this.#health);
  }

  async #exchangeOnce(signal) {
    const enrollment = await inspectMastermindNodeCredentialState(this.credentialStore);
    if (enrollment.state === 'unpaired') {
      this.#setHealth({ state: 'unpaired', paired: false });
      return { phase: 'unpaired', paired: false, nextPollAfterMs: this.unpairedPollMs, lease: null };
    }
    if (this.requireExistingPairing && enrollment.state !== 'paired') {
      throw linkError('NODE_CORE_EXISTING_PAIRING_REQUIRED', 'Core-only mode requires the retained paired identity; pairing is not automatic.');
    }
    if (enrollment.state === 'pending') {
      this.#setHealth({ state: 'pairing', paired: false });
      const pairRequest = validateMastermindNodePairRequest({
        schemaVersion: 1,
        pairingId: enrollment.pairingId,
        node: {
          nodeId: enrollment.nodeId,
          credentialSha256: enrollment.credentialSha256,
          displayName: enrollment.displayName,
          agentVersion: this.agentVersion,
        },
      });
      let rawPairResponse;
      try { rawPairResponse = await this.exchangeTransport.pair(structuredClone(pairRequest), { signal }); }
      catch (error) {
        if (signal?.aborted) throw error;
        if (error instanceof MastermindNodeHttpsTransportError) {
          if (error.code === 'NODE_PAIRING_EXPIRED') {
            const retirement = await retireMastermindNodePendingPairing(this.credentialStore, {
              expectedNodeId: enrollment.nodeId,
              expectedPairingId: enrollment.pairingId,
              expectedCredentialSha256: enrollment.credentialSha256,
            });
            const concurrentlyPaired = retirement.state === 'paired';
            const stillPending = retirement.state === 'pending';
            this.#setHealth({
              state: concurrentlyPaired ? 'degraded' : stillPending ? 'pairing' : 'unpaired',
              paired: concurrentlyPaired,
              lastErrorCode: error.code,
            });
            return {
              phase: concurrentlyPaired ? 'paired' : stillPending ? 'pairing' : 'unpaired',
              paired: concurrentlyPaired,
              nextPollAfterMs: this.unpairedPollMs,
              lease: null,
            };
          }
          throw linkError(error.code, 'The hosted node pairing failed safely.');
        }
        throw linkError('NODE_PAIR_UNREACHABLE', 'The hosted node pairing endpoint is unreachable.', error);
      }
      const pairResponse = validateMastermindNodePairResponse(rawPairResponse, { expectedNodeId: enrollment.nodeId });
      await markMastermindNodePaired(this.credentialStore, {
        expectedNodeId: enrollment.nodeId,
        expectedPairingId: enrollment.pairingId,
        pairedAt: pairResponse.pairedAt,
      });
      this.#setHealth({ state: 'degraded', paired: true, lastErrorCode: 'NODE_EXCHANGE_PENDING' });
      return {
        phase: 'paired', paired: true, nextPollAfterMs: pairResponse.nextPollAfterMs, lease: null,
      };
    }
    await this.journal.selectNode(enrollment.nodeId);
    const status = validateMastermindNodeStatus(await this.statusProvider.observeStatus({
      signal,
      includeClientStatus: false,
    }));
    const receipts = await this.journal.listPendingReceipts({ limit: 32,
      ...(this.requireExistingPairing ? { allowedCapabilities: this.worker.capabilities.map((item) => item.id) } : {}),
    });
    // A saved successful result is still private task data. Revalidate before
    // sending an outbox receipt, including after a worker restart/lost response.
    const recoveryDeadline = this.monotonicNow() + 30_000;
    for (const receipt of receipts) {
      if (receipt.state !== 'succeeded' || ![NATIVE_REUSE_CAPABILITY,NATIVE_CATALOG_CAPABILITY].includes(receipt.result?.kind)) continue;
      if (typeof this.journal.commandForReceipt !== 'function' || typeof this.executor.authorizeReceipt !== 'function') {
        throw linkError('NODE_NATIVE_REPLAY_AUTH_REQUIRED', 'Native outbox recovery requires current task authority.');
      }
      const command = await this.journal.commandForReceipt(receipt);
      const recovered = await this.executor.authorizeReceipt(command, {signal,deadlineMs:recoveryDeadline});
      if (!sameNativeDisclosure(recovered,receipt.result)) {
        throw linkError('NODE_NATIVE_REPLAY_CHANGED', 'Saved native result changed.');
      }
    }
    const request = validateMastermindNodeExchangeRequest({
      schemaVersion: this.worker ? 2 : 1,
      exchangeId: this.randomUUID(),
      nodeId: enrollment.nodeId,
      bootId: this.bootId,
      sentAt: new Date(this.now()).toISOString(),
      agentVersion: this.agentVersion,
      status,
      receipts,
      ...(this.worker ? { worker: this.worker } : {}),
    }, { core: this.worker !== null });
    const requestStartedAt = this.monotonicNow();
    let rawResponse;
    try {
      rawResponse = await this.exchangeTransport.exchange(structuredClone(request), { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof MastermindNodeHttpsTransportError) {
        throw linkError(error.code, 'The hosted node exchange failed safely.');
      }
      throw linkError('NODE_EXCHANGE_UNREACHABLE', 'The hosted node exchange is unreachable.', error);
    }
    const responseReceivedAt = this.monotonicNow();
    const requestElapsedMs = Math.max(0, responseReceivedAt - requestStartedAt);
    const response = validateMastermindNodeExchangeResponse(rawResponse, {
      expectedExchangeId: request.exchangeId,
      expectedNodeId: request.nodeId,
      expectedReceiptIds: receipts.map((receipt) => receipt.receiptId),
      core: this.worker !== null,
      expectedWorker: this.worker,
    });
    const executionDeadlineMs = response.lease === null
      ? null
      : Math.floor(responseReceivedAt + Math.min(
        Date.parse(response.lease.leaseExpiresAt),
        Date.parse(response.lease.expiresAt),
      ) - Date.parse(response.serverTime) - requestElapsedMs);
    await this.journal.acknowledgeReceiptIds(response.acknowledgedReceiptIds);
    let execution = null;
    if (response.lease !== null && !signal?.aborted) {
      if (executionDeadlineMs > this.monotonicNow()) {
        execution = await this.#executeLease(response.lease, executionDeadlineMs, signal);
      } else {
        execution = { skipped: true, code: 'lease-lost' };
      }
    }
    this.#setHealth({ state: 'online', paired: true, lastExchangeAt: new Date(this.now()).toISOString() });
    return { phase: 'exchange', paired: true, nextPollAfterMs: response.nextPollAfterMs, lease: response.lease, execution };
  }

  async #executeLease(lease, deadlineMs, signal) {
    // No durable effect is begun until a conservative server-time-derived
    // execution budget has been established by #exchangeOnce.
    if (deadlineMs <= this.monotonicNow()) return { skipped: true, code: 'lease-lost' };
    const releaseExecution = await this.journal.acquireExecution(lease.nodeId);
    try {
      if (deadlineMs <= this.monotonicNow()) return { skipped: true, code: 'lease-lost' };
      const begun = await this.journal.begin(lease);
      if (begun.effect.terminal) {
        if([NATIVE_REUSE_CAPABILITY,NATIVE_CATALOG_CAPABILITY].includes(lease.capability) && begun.effect.terminal.state==='succeeded') {
          if(typeof this.executor.authorizeReplay!=='function')throw linkError('NODE_NATIVE_REPLAY_AUTH_REQUIRED','Native result recovery requires current task authority.');
          const recovered=await this.executor.authorizeReplay(lease,{signal,deadlineMs});
          if(!sameNativeDisclosure(recovered,begun.effect.terminal.result))throw linkError('NODE_NATIVE_REPLAY_CHANGED','Saved native result changed.');
        }
        return { replayed: true, receipt: await this.journal.replayTerminal(lease, this.bootId) };
      }
      if (begun.effect.lastSequence === 0) {
        await this.journal.appendReceipt(lease, this.bootId, {
          state: 'accepted', stage: 'journaled', code: 'accepted', retryable: false, result: null,
        });
      }
      try {
        const result = await this.executor.execute(lease, {
          signal,
          deadlineMs,
          recoverOnly: lease.capability === NATIVE_REUSE_CAPABILITY && begun.effect.lastSequence > 0,
          emit: (stage) => this.journal.appendReceipt(lease, this.bootId, {
            state: 'running', stage, code: 'in-progress', retryable: false, result: null,
          }),
        });
        return {
          replayed: false,
          receipt: await this.journal.appendReceipt(lease, this.bootId, {
            state: 'succeeded', stage: 'desired-state-reached', code: 'desired-state-reached', retryable: false, result,
          }),
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        if (lease.capability === NATIVE_REUSE_CAPABILITY &&
          ['TASK_LOCAL_UNCERTAIN','TASK_RESULT_INVALID','TASK_LOCAL_REJECTED'].includes(error?.code)) {
          // Preserve nonterminal state. A later delivery may recover only this
          // operation; it must never infer that a lost reply means no effect.
          throw linkError('NODE_NATIVE_RECOVERY_REQUIRED', 'Native outcome requires saved-operation recovery.', error);
        }
        const execution = error instanceof MastermindNodeExecutionError
          ? error
          : new MastermindNodeExecutionError(lease.capability !== 'family-ecosystem.ensure-running' ? 'local-response-invalid' : 'family-server-start-failed', 'The typed node action failed safely.', {
            retryable: false, cause: error,
          });
        return {
          replayed: false,
          receipt: await this.journal.appendReceipt(lease, this.bootId, {
            state: 'failed', stage: 'terminal', code: execution.code, retryable: execution.retryable,
            result: lease.capability !== 'family-ecosystem.ensure-running' ? null : execution.result,
          }),
        };
      }
    } finally {
      await releaseExecution();
    }
  }

  async #runLoop(signal) {
    let backoffMs = 1_000;
    while (!signal.aborted) {
      try {
        const result = await this.runOnce({ signal });
        backoffMs = 1_000;
        await this.delay(result.nextPollAfterMs, signal);
      } catch (error) {
        if (signal.aborted) break;
        const code = typeof error?.code === 'string' && SAFE_ERROR_CODE.test(error.code)
          ? error.code
          : 'NODE_LINK_FAILED';
        this.#setHealth({ state: 'degraded', paired: this.#health.paired, lastErrorCode: code });
        if (code === 'NODE_JOURNAL_RESTART_REQUIRED') throw error;
        await this.delay(backoffMs, signal).catch(() => undefined);
        backoffMs = Math.min(30_000, backoffMs * 2);
      }
    }
  }

  #setHealth(next) {
    this.#health = sanitizedHealth({
      state: next.state,
      paired: next.paired,
      lastExchangeAt: next.lastExchangeAt ?? this.#health.lastExchangeAt,
      lastErrorCode: next.lastErrorCode ?? null,
    });
  }
}

export function createMastermindNodeLink(options) {
  return new MastermindNodeLink(options);
}
