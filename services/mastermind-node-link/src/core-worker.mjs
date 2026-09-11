import {NativeTaskExecutor} from './native-task-executor.mjs';
import {NATIVE_CORE_WORKER} from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import path from 'node:path';
import { FileMastermindNodeEffectJournal } from './effect-journal.mjs';
import { MastermindNodeLink } from './node-link.mjs';
import { CoreStatusExecutor, MastermindCoreStatusClient } from './core-status-client.mjs';
import { CORE_ONLY_WORKER } from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import { validateMastermindNodeStatus } from '../../../protocol/mastermind-node-exchange/contract.mjs';

/** The legacy status envelope describes only services accessible to this
 * worker. This profile has no Minecraft credential/client, so those services
 * are unavailable to it and their domain state stays unknown. The separately
 * typed core result is the only core-health observation.
 */
export function coreWorkerEnvelope(now = Date.now) {
  return validateMastermindNodeStatus({ observedAt: new Date(now()).toISOString(),
    controlAgent: 'unreachable', recovery: 'unknown', familyServer: 'unknown',
    companion: 'unknown', companionBridge: 'unknown', localKillSwitch: null,
    attentionCodes: [] });
}

export function createMastermindCoreOnlyWorker(options = {}) {
  if (typeof options.journalRoot !== 'string' || !path.isAbsolute(options.journalRoot) || options.journalRoot.includes('\0')) throw new TypeError('An absolute canonical journal root is required');
  const journal = options.journal ?? new FileMastermindNodeEffectJournal(path.resolve(options.journalRoot));
  const monotonicNow = options.monotonicNow ?? (() => Math.floor(performance.now()));
  const core = options.coreStatusClient ?? new MastermindCoreStatusClient();
  const link = new MastermindNodeLink({ credentialStore: options.credentialStore,
    exchangeTransport: options.exchangeTransport, journal,
    executor: options.enableNativeTasks === true ? new NativeTaskExecutor({core,now:monotonicNow,native:options.nativeTaskClient}) : new CoreStatusExecutor({ core, now: monotonicNow }),
    statusProvider: { observeStatus: async () => coreWorkerEnvelope(options.now) },
    agentVersion: options.enableNativeTasks === true ? '0.4.0-native-catalog' : '0.2.0-core-status', bootId: options.bootId,
    now: options.now, monotonicNow, worker: options.enableNativeTasks === true ? NATIVE_CORE_WORKER : CORE_ONLY_WORKER,
    // Preserve incompatible pending receipts. They require source/ledger
    // reconciliation, never silent deletion or a family-capability fallback.
    requireExistingPairing: true,
  });
  return Object.freeze({ start: () => link.start(), wait: () => link.wait(), stop: () => link.stop(),
    runOnce: (args) => link.runOnce(args), health: () => link.health() });
}
