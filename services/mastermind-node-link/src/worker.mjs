import path from 'node:path';

import { FileMastermindNodeEffectJournal } from './effect-journal.mjs';
import { FamilyEcosystemEnsureRunningExecutor } from './executor.mjs';
import { MastermindLocalAgentClient } from './local-agent-client.mjs';
import { MastermindNodeLink } from './node-link.mjs';
import { MastermindCoreStatusClient, NegotiatedCoreExecutor } from './core-status-client.mjs';
import { CORE_WORKER } from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import {
  resolveMastermindNodeCredentialVaultFile,
  resolveMastermindNodeStateRoot,
} from './state-paths.mjs';
import { WindowsDpapiMastermindNodeCredentialStore } from './windows-dpapi-credential-store.mjs';

/**
 * Supervisor-facing composition root. It performs no process spawning and no
 * network operation during construction. The authenticated hosted transport is
 * an explicit dependency because its concrete egress adapter is not part of
 * this local slice.
 */
export function createMastermindNodeWorker(options = {}) {
  if (typeof options.journalRoot !== 'string' || !path.isAbsolute(options.journalRoot) || options.journalRoot.includes('\0')) {
    throw new TypeError('An absolute node-link journalRoot is required');
  }
  if (!options.exchangeTransport || typeof options.exchangeTransport.pair !== 'function'
    || typeof options.exchangeTransport.exchange !== 'function') {
    throw new TypeError('An authenticated pair/exchange transport is required');
  }
  const journalRoot = path.resolve(options.journalRoot);
  const credentialStore = options.credentialStore ?? new WindowsDpapiMastermindNodeCredentialStore({
    vaultFile: resolveMastermindNodeCredentialVaultFile(
      resolveMastermindNodeStateRoot(options.environment ?? process.env),
    ),
  });
  const journal = options.journal ?? new FileMastermindNodeEffectJournal(journalRoot);
  const localAgent = options.localAgent ?? new MastermindLocalAgentClient({
    agentBaseUrl: options.agentBaseUrl ?? 'http://127.0.0.1:43100',
    token: options.controlToken,
  });
  const monotonicNow = options.monotonicNow ?? (() => Math.floor(performance.now()));
  if (typeof monotonicNow !== 'function') throw new TypeError('monotonicNow must be a function');
  const family = new FamilyEcosystemEnsureRunningExecutor({ localAgent, now: monotonicNow });
  const executor = options.executor ?? (options.enableCoreStatus === true
    ? new NegotiatedCoreExecutor({ family, core: options.coreStatusClient ?? new MastermindCoreStatusClient(), now: monotonicNow })
    : family);
  const link = new MastermindNodeLink({
    credentialStore,
    exchangeTransport: options.exchangeTransport,
    journal,
    executor,
    statusProvider: options.statusProvider ?? localAgent,
    agentVersion: options.agentVersion ?? '0.1.0',
    bootId: options.bootId,
    monotonicNow,
    worker: options.enableCoreStatus === true ? CORE_WORKER : null,
  });
  return Object.freeze({
    start: () => link.start(),
    wait: () => link.wait(),
    stop: () => link.stop(),
    runOnce: (runOptions) => link.runOnce(runOptions),
    health: () => link.health(),
    beginPairing: (pairingCredential, displayName) => credentialStore.beginPairing(pairingCredential, displayName),
  });
}
