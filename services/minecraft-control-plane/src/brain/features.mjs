import { FEATURE_STATES } from './contracts.mjs';

export const FAMILY_COMPANION_FEATURE_FLAGS = Object.freeze({
  computerChat: false,
  companionConversation: false,
  modelReasoning: false,
  profileCapture: false,
  physicalTaskPlanning: false,
  survivalAutomation: false,
  modRequestExecution: false,
  inGameApprovals: false,
  visionRecovery: false,
  zenithBody: false,
  enhancedHeadlessController: false,
  hybridTelemetry: false,
});

export const FAMILY_COMPANION_FEATURE_STATES = Object.freeze({
  computerChat: 'stubbed',
  companionConversation: 'stubbed',
  modelReasoning: 'stubbed',
  profileCapture: 'stubbed',
  physicalTaskPlanning: 'stubbed',
  survivalAutomation: 'stubbed',
  modRequestExecution: 'stubbed',
  inGameApprovals: 'planned',
  visionRecovery: 'planned',
  zenithBody: 'stubbed',
  enhancedHeadlessController: 'stubbed',
  hybridTelemetry: 'stubbed',
});

for (const state of Object.values(FAMILY_COMPANION_FEATURE_STATES)) {
  if (!FEATURE_STATES.includes(state)) throw new Error(`Invalid family companion feature state '${state}'`);
}
export function featureUnavailable(feature, state = FAMILY_COMPANION_FEATURE_STATES[feature] ?? 'planned') {
  return Object.freeze({
    ok: false,
    code: state === 'planned' ? 'FEATURE_NOT_IMPLEMENTED' : 'FEATURE_DISABLED',
    feature,
    state,
    message: state === 'planned'
      ? `The '${feature}' capability has not been implemented.`
      : `The '${feature}' capability is present as a disabled foundation stub.`,
  });
}

export function publicFeatureStatus() {
  return featureStatus(FAMILY_COMPANION_FEATURE_FLAGS, FAMILY_COMPANION_FEATURE_STATES);
}

export function featureStatus(flags = FAMILY_COMPANION_FEATURE_FLAGS, states = FAMILY_COMPANION_FEATURE_STATES) {
  return {
    schemaVersion: 1,
    flags: { ...flags },
    states: { ...states },
  };
}
