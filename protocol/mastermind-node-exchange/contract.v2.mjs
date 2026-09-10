/** Explicit v2 views. The default v1 validators and frozen registry remain strict. */
import * as base from './contract.mjs';

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
