import {LIFECYCLE} from './native-contribution-lifecycle.mjs';
import {CONTRIBUTION} from './native-contribution.mjs';
import {BUILD_DISPATCH} from './native-build-dispatch.mjs';
/** Explicit v2 views. The default v1 validators and frozen registry remain strict. */
import * as base from './contract.mjs';
import {DEVELOPMENT_CAPABILITIES} from './native-development-work.mjs';

export const CORE_STATUS_CAPABILITY = base.MASTERMIND_CORE_STATUS_CAPABILITY;
export const CORE_WORKER = Object.freeze({ protocolVersion: 2, capabilities: Object.freeze([
  Object.freeze({ id: base.MASTERMIND_NODE_CAPABILITY, version: 1 }),
  Object.freeze({ id: CORE_STATUS_CAPABILITY, version: 1 }),
]) });
export const CORE_ONLY_WORKER = Object.freeze({ protocolVersion: 2, capabilities: Object.freeze([
  Object.freeze({ id: CORE_STATUS_CAPABILITY, version: 1 }),
]) });
export const validateMastermindNodeCommand = (value) => base.validateMastermindNodeCommand(value, { core: true });
export const digestMastermindNodeCommand = (value) => base.digestMastermindNodeCommand(value, { core: true });
export const validateMastermindNodeLease = (value) => base.validateMastermindNodeLease(value, { core: true });
export const validateMastermindNodeReceipt = (value) => base.validateMastermindNodeReceipt(value, { core: true });
export const digestMastermindNodeReceipt = (value) => base.digestMastermindNodeReceipt(value, { core: true });

export const NATIVE_CORE_WORKER = Object.freeze({protocolVersion:2,capabilities:Object.freeze([Object.freeze({id:CORE_STATUS_CAPABILITY,version:1}),Object.freeze({id:'mastermind.native.catalog',version:1}),Object.freeze({id:'mastermind.native.reuse',version:1})])});
export const WIZARD_CORE_WORKER = Object.freeze({protocolVersion:2,capabilities:Object.freeze([
  ...NATIVE_CORE_WORKER.capabilities,Object.freeze({id:'mastermind.native.specification',version:1}),
])});

// Explicit opt-in only after the configured local review host passes acceptance.
export const REVIEW_CORE_WORKER=Object.freeze({protocolVersion:2,capabilities:Object.freeze([...WIZARD_CORE_WORKER.capabilities,Object.freeze({id:'mastermind.native.review',version:1})])});

export const REVIEW_REUSE_CORE_WORKER=Object.freeze({protocolVersion:2,capabilities:Object.freeze([...REVIEW_CORE_WORKER.capabilities,Object.freeze({id:'mastermind.native.review-reuse',version:1})])});

// Off by default; requires compatible hosted ledger and configured local hosts.
export const DEVELOPMENT_CORE_WORKER=Object.freeze({protocolVersion:2,capabilities:Object.freeze([
 ...REVIEW_REUSE_CORE_WORKER.capabilities,...DEVELOPMENT_CAPABILITIES.map(id=>Object.freeze({id,version:1})),
])});
// Review v2 explicitly retains legacy v1 recovery; no other version is implied.
export const LOSSLESS_DEVELOPMENT_CORE_WORKER=Object.freeze({protocolVersion:2,capabilities:Object.freeze(
 DEVELOPMENT_CORE_WORKER.capabilities.map(c=>Object.freeze({...c,version:c.id==='mastermind.native.review'?2:c.version})),
)});

// Explicit separate opt-in after matched runtime, ledger and UI acceptance.
export const CODING_CORE_WORKER=Object.freeze({protocolVersion:2,capabilities:Object.freeze([
 ...LOSSLESS_DEVELOPMENT_CORE_WORKER.capabilities,Object.freeze({id:BUILD_DISPATCH,version:1}),
])});
// Separate opt-in: v3 recovers a saved review through a fresh delivery identity.
export const REVIEW_RECOVERY_CORE_WORKER=Object.freeze({protocolVersion:2,capabilities:Object.freeze(
 CODING_CORE_WORKER.capabilities.map(c=>Object.freeze({...c,version:c.id==='mastermind.native.review'?3:c.version})),
)});

// Off by default; requires coupled local host, ledger and owner routes.
export const CONTRIBUTION_CORE_WORKER=Object.freeze({protocolVersion:2,capabilities:Object.freeze([
 ...REVIEW_RECOVERY_CORE_WORKER.capabilities,Object.freeze({id:CONTRIBUTION,version:1}),
])});

export const LIFECYCLE_CORE_WORKER=Object.freeze({protocolVersion:2,capabilities:Object.freeze([...CONTRIBUTION_CORE_WORKER.capabilities,Object.freeze({id:LIFECYCLE,version:1})])});
