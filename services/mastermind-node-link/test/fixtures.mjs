import { digestMastermindNodeCommand } from '../../../protocol/mastermind-node-exchange/contract.mjs';

export const NODE_ID = '11111111-1111-4111-8111-111111111111';
export const PAIRING_ID = '22222222-2222-4222-8222-222222222222';
export const JOB_ID = '33333333-3333-4333-8333-333333333333';
export const LEASE_ID = '44444444-4444-4444-8444-444444444444';
export const BOOT_ID = '55555555-5555-4555-8555-555555555555';
export const PRIOR_BOOT_ID = '66666666-6666-4666-8666-666666666666';
export const EXCHANGE_ID = '77777777-7777-4777-8777-777777777777';
export const NODE_CREDENTIAL = `mn1.${NODE_ID}.${'A'.repeat(43)}`;
export const PAIRING_CREDENTIAL = `mnp1.${PAIRING_ID}.${'B'.repeat(43)}`;
export const CREATED_AT = '2026-08-15T04:00:00.000Z';
export const EXPIRES_AT = '2026-08-15T04:30:00.000Z';
export const LEASED_AT = '2026-08-15T04:00:01.000Z';
export const LEASE_EXPIRES_AT = '2026-08-15T04:15:01.000Z';

export function command(overrides = {}) {
  return {
    jobId: JOB_ID,
    nodeId: NODE_ID,
    capability: 'family-ecosystem.ensure-running',
    capabilityVersion: 1,
    policyClass: 'routine',
    input: {},
    ...overrides,
  };
}

export function lease(overrides = {}) {
  const nextCommand = command(Object.fromEntries(Object.entries(overrides).filter(([key]) => (
    ['jobId', 'nodeId', 'capability', 'capabilityVersion', 'policyClass', 'input'].includes(key)
  ))));
  return {
    ...nextCommand,
    commandDigest: overrides.commandDigest ?? digestMastermindNodeCommand(nextCommand),
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    leaseId: LEASE_ID,
    leasedAt: LEASED_AT,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    ...overrides,
  };
}

export function status(overrides = {}) {
  return {
    observedAt: '2026-08-15T04:00:02.000Z',
    controlAgent: 'online',
    recovery: 'clear',
    familyServer: 'stopped',
    companion: 'stopped',
    companionBridge: 'disconnected',
    localKillSwitch: false,
    attentionCodes: [],
    ...overrides,
  };
}

export function uuidSequence(start = 1) {
  let sequence = start;
  return () => `00000000-0000-4000-8000-${(sequence++).toString(16).padStart(12, '0')}`;
}
