import {NativeTaskExecutor} from './native-task-executor.mjs';
import {NATIVE_CORE_WORKER,WIZARD_CORE_WORKER,REVIEW_CORE_WORKER,REVIEW_REUSE_CORE_WORKER,DEVELOPMENT_CORE_WORKER,LOSSLESS_DEVELOPMENT_CORE_WORKER} from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
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
  if(options.enableLosslessReviews!==undefined&&typeof options.enableLosslessReviews!=='boolean'||options.enableLosslessReviews===true&&options.enableDevelopmentWork!==true)throw new TypeError('Lossless reviews require explicit development activation');
  if(options.enableDevelopmentWork!==undefined&&typeof options.enableDevelopmentWork!=='boolean'||options.enableDevelopmentWork===true&&options.enableReviewReuse!==true)throw new TypeError('Development work requires explicit review reuse activation');
  if(options.enableReviewReuse!==undefined&&typeof options.enableReviewReuse!=='boolean'||options.enableReviewReuse===true&&options.enableNativeReviews!==true)throw new TypeError('Reuse links require explicit review activation');
  if(options.enableNativeReviews!==undefined&&typeof options.enableNativeReviews!=='boolean'
    ||options.enableNativeReviews===true&&options.enableNativeSpecifications!==true)throw new TypeError('Review requires explicit Wizard activation');
  if(options.enableNativeSpecifications!==undefined&&typeof options.enableNativeSpecifications!=='boolean'
    ||options.enableNativeSpecifications===true&&options.enableNativeTasks!==true)throw new TypeError('Wizard requires explicit native task activation');
  if (typeof options.journalRoot !== 'string' || !path.isAbsolute(options.journalRoot) || options.journalRoot.includes('\0')) throw new TypeError('An absolute canonical journal root is required');
  const journal = options.journal ?? new FileMastermindNodeEffectJournal(path.resolve(options.journalRoot));
  const monotonicNow = options.monotonicNow ?? (() => Math.floor(performance.now()));
  const core = options.coreStatusClient ?? new MastermindCoreStatusClient();
  const link = new MastermindNodeLink({ credentialStore: options.credentialStore,
    exchangeTransport: options.exchangeTransport, journal,
    executor: options.enableNativeTasks === true ? new NativeTaskExecutor({core,now:monotonicNow,native:options.nativeTaskClient}) : new CoreStatusExecutor({ core, now: monotonicNow }),
    statusProvider: { observeStatus: async () => coreWorkerEnvelope(options.now) },
    agentVersion: options.enableLosslessReviews===true?'0.9.0-lossless-review':options.enableDevelopmentWork===true?'0.8.0-development-work':options.enableReviewReuse===true?'0.7.0-review-reuse':options.enableNativeReviews === true ? '0.6.0-native-review' : options.enableNativeSpecifications === true ? '0.5.0-native-wizard' : options.enableNativeTasks === true ? '0.4.0-native-catalog' : '0.2.0-core-status', bootId: options.bootId,
    now: options.now, monotonicNow, worker: options.enableLosslessReviews===true?LOSSLESS_DEVELOPMENT_CORE_WORKER:options.enableDevelopmentWork===true?DEVELOPMENT_CORE_WORKER:options.enableReviewReuse===true?REVIEW_REUSE_CORE_WORKER:options.enableNativeReviews === true ? REVIEW_CORE_WORKER : options.enableNativeSpecifications === true ? WIZARD_CORE_WORKER : options.enableNativeTasks === true ? NATIVE_CORE_WORKER : CORE_ONLY_WORKER,
    // Preserve incompatible pending receipts. They require source/ledger
    // reconciliation, never silent deletion or a family-capability fallback.
    requireExistingPairing: true,
  });
  return Object.freeze({ start: () => link.start(), wait: () => link.wait(), stop: () => link.stop(),
    runOnce: (args) => link.runOnce(args), health: () => link.health() });
}
