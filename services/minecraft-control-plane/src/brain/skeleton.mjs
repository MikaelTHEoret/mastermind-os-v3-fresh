import crypto from 'node:crypto';
import {
  BEHAVIOR_MODES,
  PLAYER_ROLES,
  validateAuthorizationDecision,
  validateBehaviorMode,
  validateConversationInput,
  validatePlayerPrincipal,
  validateProfileClaim,
  validateReasoningRequest,
  validateSkillDefinition,
  validateTaskPlan,
} from './contracts.mjs';
import { FAMILY_COMPANION_FEATURE_FLAGS, featureUnavailable, publicFeatureStatus } from './features.mjs';

const implementedSkillStates = new Set(['implemented', 'live-verified']);
const ROLE_CAPABILITIES = Object.freeze({
  parent: new Set([
    'conversation', 'public-information', 'play-assistance', 'physical-task', 'feature-request',
    'profile-admin', 'server-admin', 'approval', 'mod-request',
  ]),
  child: new Set(['conversation', 'public-information', 'play-assistance', 'physical-task', 'feature-request']),
  guest: new Set(['conversation', 'public-information']),
  service: new Set(['public-information']),
});
const PARENT_APPROVAL_REQUIRED = new Set([
  'mod-promotion', 'persistent-world-deletion', 'networking-change', 'authentication-change',
  'backup-policy-change', 'untrusted-source', 'generated-native-code',
]);

export class IdentityResolver {
  resolvePlayer() {
    return featureUnavailable('profileCapture');
  }
}

export class PermissionPolicy {
  authorize(value = {}) {
    const role = typeof value.role === 'string' && PLAYER_ROLES.includes(value.role) ? value.role : null;
    const capability = typeof value.capability === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.capability)
      ? value.capability
      : null;
    if (!role || !capability) {
      return validateAuthorizationDecision({
        allowed: false,
        code: 'INVALID_AUTHORIZATION_REQUEST',
        reason: 'The role or capability is invalid.',
        requiresApproval: false,
      });
    }
    if (PARENT_APPROVAL_REQUIRED.has(capability)) {
      return validateAuthorizationDecision({
        allowed: role === 'parent',
        code: role === 'parent' ? 'PARENT_APPROVAL_REQUIRED' : 'PARENT_AUTHORITY_REQUIRED',
        reason: role === 'parent'
          ? 'This operation may proceed only through a fresh digest-bound parent approval.'
          : 'This operation requires a parent to review and approve it.',
        requiresApproval: true,
      });
    }
    if (ROLE_CAPABILITIES[role].has(capability)) {
      return validateAuthorizationDecision({
        allowed: true,
        code: 'AUTHORIZED',
        reason: `The ${role} role may request this capability.`,
        requiresApproval: false,
      });
    }
    return validateAuthorizationDecision({
      allowed: false,
      code: 'ROLE_NOT_AUTHORIZED',
      reason: `The ${role} role may not request this capability.`,
      requiresApproval: false,
    });
  }
}

export class ConversationRouter {
  constructor(options = {}) {
    this.flags = { ...FAMILY_COMPANION_FEATURE_FLAGS, ...(options.flags ?? {}) };
    this.companionNames = new Set((options.companionNames ?? ['the_alchemist___', 'alchemist']).map((value) => value.toLowerCase()));
  }

  route(value) {
    const input = validateConversationInput(value);
    if (input.channel === 'computer-command' || input.directedAt === 'COMPUTER') {
      return this.flags.computerChat
        ? { ok: true, actor: 'COMPUTER', reason: 'explicit-computer-command', input }
        : featureUnavailable('computerChat');
    }
    const lower = input.text.toLowerCase();
    const named = [...this.companionNames].some((name) => lower.includes(name));
    if (input.directedAt === 'COMPANION' || named) {
      return this.flags.companionConversation
        ? { ok: true, actor: 'COMPANION', reason: input.directedAt === 'COMPANION' ? 'explicit-companion-target' : 'companion-name', input }
        : featureUnavailable('companionConversation');
    }
    return { ok: true, actor: null, reason: 'not-addressed', input };
  }
}

export class PersonaEngine {
  respond() {
    return featureUnavailable('companionConversation');
  }
}

export class DisabledReasoningModel {
  classifyIntent() { return featureUnavailable('modelReasoning'); }
  converse() { return featureUnavailable('modelReasoning'); }
  planTask() { return featureUnavailable('modelReasoning'); }
  extractProfileMemories() { return featureUnavailable('profileCapture'); }
  diagnose() { return featureUnavailable('modelReasoning'); }
  inspectImage() { return featureUnavailable('visionRecovery'); }
}

export class MastermindModelBroker {
  constructor(options = {}) {
    this.providers = new Map(Object.entries(options.providers ?? {}));
    this.routing = options.routing ?? 'mastermind-settings';
  }

  listProviders() {
    return [...this.providers.keys()];
  }

  async reason(value) {
    validateReasoningRequest(value);
    return featureUnavailable('modelReasoning');
  }
}

export class TaskSupervisor {
  enqueue() { return featureUnavailable('physicalTaskPlanning'); }
  pause() { return featureUnavailable('physicalTaskPlanning'); }
  resume() { return featureUnavailable('physicalTaskPlanning'); }
  cancel() { return featureUnavailable('physicalTaskPlanning'); }
  tick() { return featureUnavailable('physicalTaskPlanning'); }
}

export class ActionArbiter {
  acquire() { return featureUnavailable('physicalTaskPlanning'); }
  preempt() { return featureUnavailable('physicalTaskPlanning'); }
  release() { return featureUnavailable('physicalTaskPlanning'); }
}

export class SkillCatalog {
  constructor(definitions = []) {
    this.skills = new Map();
    for (const input of definitions) {
      const definition = validateSkillDefinition(input);
      if (this.skills.has(definition.id)) throw new TypeError(`Duplicate skill '${definition.id}'`);
      this.skills.set(definition.id, Object.freeze(definition));
    }
  }

  list(options = {}) {
    const all = [...this.skills.values()];
    return options.includeUnavailable === true ? all : all.filter((skill) => implementedSkillStates.has(skill.availability));
  }

  execute(skillId) {
    const definition = this.skills.get(skillId);
    if (!definition || !implementedSkillStates.has(definition.availability)) return featureUnavailable(`skill:${skillId}`);
    return featureUnavailable(`skill:${skillId}`, 'stubbed');
  }

  cancel() {
    return featureUnavailable('physicalTaskPlanning');
  }
}

const MODE_DEFAULTS = Object.freeze({
  disabled: { allowedSkills: [], homeZoneId: null, resourceBudget: 0, combatPolicy: 'avoid', modelEscalationEnabled: false },
  stay_alive: { allowedSkills: [], homeZoneId: null, resourceBudget: 0, combatPolicy: 'avoid', modelEscalationEnabled: false },
  home_steward: { allowedSkills: [], homeZoneId: null, resourceBudget: 0, combatPolicy: 'avoid', modelEscalationEnabled: false },
  assist: { allowedSkills: [], homeZoneId: null, resourceBudget: 0, combatPolicy: 'defend', modelEscalationEnabled: false },
  follow_adventure: { allowedSkills: [], homeZoneId: null, resourceBudget: 0, combatPolicy: 'protect', modelEscalationEnabled: false },
  independent: { allowedSkills: [], homeZoneId: null, resourceBudget: 0, combatPolicy: 'defend', modelEscalationEnabled: false },
  custom: { allowedSkills: [], homeZoneId: null, resourceBudget: 0, combatPolicy: 'avoid', modelEscalationEnabled: false },
});

export class ModeRegistry {
  list() { return [...BEHAVIOR_MODES]; }

  resolve(mode) {
    if (!Object.hasOwn(MODE_DEFAULTS, mode)) throw new TypeError(`Unknown behavior mode '${mode}'`);
    return validateBehaviorMode({ mode, ...MODE_DEFAULTS[mode] });
  }
}

export class SurvivalController {
  observe() { return featureUnavailable('survivalAutomation'); }
  selectIntent() { return featureUnavailable('survivalAutomation'); }
  tick() { return featureUnavailable('survivalAutomation'); }
}

export class NarrationPolicy {
  constructor(options = {}) {
    this.cooldownMs = options.cooldownMs ?? 15_000;
    this.lastSpokenAt = 0;
    this.noteworthy = new Set(['task-started', 'task-completed', 'task-blocked', 'danger', 'major-discovery']);
  }

  shouldSpeak(event, now = Date.now()) {
    if (!this.noteworthy.has(event)) return false;
    if (!Number.isFinite(now) || now < this.lastSpokenAt || now - this.lastSpokenAt < this.cooldownMs) return false;
    this.lastSpokenAt = now;
    return true;
  }
}

export class ProfileRepository {
  appendInteraction() { return featureUnavailable('profileCapture'); }
  queryContext() { return featureUnavailable('profileCapture'); }
  upsertClaim(value) { validateProfileClaim(value); return featureUnavailable('profileCapture'); }
  forget() { return featureUnavailable('profileCapture'); }
  rebuildProjection() { return featureUnavailable('profileCapture'); }
}

export class ComputerToolRegistry extends SkillCatalog {
  plan() { return featureUnavailable('computerChat'); }
  authorize() { return featureUnavailable('computerChat'); }
}

export class ResourceGovernor {
  constructor(options = {}) {
    this.maxModelCalls = options.maxModelCalls ?? 2;
    this.activeModelCalls = 0;
  }

  allowModelCall() {
    if (!FAMILY_COMPANION_FEATURE_FLAGS.modelReasoning) return featureUnavailable('modelReasoning');
    if (this.activeModelCalls >= this.maxModelCalls) {
      return { ok: false, code: 'MODEL_CONCURRENCY_LIMIT', message: 'The model-call concurrency budget is exhausted.' };
    }
    return { ok: true, leaseId: crypto.randomUUID() };
  }
}

export function createFamilyCompanionSkeleton() {
  const skills = [
    'direct.use', 'direct.selectSlot', 'direct.dropItem', 'inventory.inspect', 'inventory.equip',
    'inventory.move', 'inventory.give', 'craft.recipe', 'container.transfer', 'skill.sleep',
    'skill.eat', 'skill.combat', 'skill.tendCrops', 'skill.deliverItem', 'skill.buildBounded',
  ].map((id) => ({ id, availability: 'stubbed', cancellable: true, physical: true, roles: ['parent', 'child'] }));
  return {
    identityResolver: new IdentityResolver(),
    permissionPolicy: new PermissionPolicy(),
    conversationRouter: new ConversationRouter(),
    personaEngine: new PersonaEngine(),
    reasoningModel: new DisabledReasoningModel(),
    modelBroker: new MastermindModelBroker(),
    taskSupervisor: new TaskSupervisor(),
    actionArbiter: new ActionArbiter(),
    skillCatalog: new SkillCatalog(skills),
    survivalController: new SurvivalController(),
    modeRegistry: new ModeRegistry(),
    narrationPolicy: new NarrationPolicy(),
    profileRepository: new ProfileRepository(),
    computerTools: new ComputerToolRegistry(),
    resourceGovernor: new ResourceGovernor(),
    status: publicFeatureStatus,
  };
}

export function validateSkeletonFixture({ principal, plan }) {
  return { principal: validatePlayerPrincipal(principal), plan: validateTaskPlan(plan), roles: [...PLAYER_ROLES] };
}
