import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validateReasoningRequest, validateReasoningResult } from './contracts.mjs';
import { featureStatus } from './features.mjs';
import { ConversationIntake, ConversationRouter, PermissionPolicy, createFamilyCompanionSkeleton } from './skeleton.mjs';
import { DeterministicSurvivalController } from './survival.mjs';
import { CompanionPhysicalTaskSupervisor } from './tasks.mjs';
import { validateFamilyBridgeAction } from '../companion/protocol.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const DEFAULT_MODEL = 'gpt-5-mini';
const COMPANION_MINECRAFT_UUID = '996a56dd-fb3c-4f90-9158-1a608652ec77';
const COMPANION_DISPLAY_NAME = 'the_alchemist___';
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/responses';
const MAX_REPLY_CHARS = 220;
const ENABLED_PHYSICAL_SKILLS = Object.freeze([
  'follow the requesting player',
  'walk to supplied coordinates',
  'explore a bounded nearby radius',
  'gather supported blocks',
  'look at supplied coordinates',
  'select a numbered hotbar slot',
  'use the item or object under the crosshair',
  'place a supported hotbar block at nearby coordinates',
  'place one supported hotbar block on nearby ground',
  'drop the selected item or stack',
  'select a named item already in the hotbar',
  'swing either hand, including punching air',
  'stop the current physical task',
]);
const PLANNABLE_ACTIONS = Object.freeze([
  'direct.lookAt', 'direct.selectSlot', 'direct.selectItem', 'direct.use', 'direct.attack', 'direct.swingHand',
  'direct.placeBlock', 'direct.placeNearbyBlock', 'direct.dropItem', 'direct.dropItemById',
  'skill.navigateTo', 'skill.followPlayer', 'skill.gatherBlock', 'skill.explore',
]);
const PHYSICAL_REQUEST_HINT = /\b(?:stop|cancel|follow|come|walk|go|navigate|look|explore|scout|gather|collect|mine|chop|get|place|put|drop|throw|select|choose|switch|use|open|press|interact|punch|hit|attack|inventory|find)\b/iu;
const CAPABILITY_QUESTION = /^(?:what can you do|what are (?:your )?(?:abilities|capabilities)|what are you capable of(?: doing)?|what do you have access to)(?: now)?[?!.]*$/u;
const PRIVATE_ENV_KEYS = Object.freeze([
  'OPENAI_API_KEY',
  'MASTERMIND_MINECRAFT_COMPANION_CONVERSATION_ENABLED',
  'MASTERMIND_MINECRAFT_MODEL_REASONING_ENABLED',
  'MASTERMIND_MINECRAFT_OPENAI_MODEL',
  'MASTERMIND_MINECRAFT_PHYSICAL_TASK_PLANNING_ENABLED',
  'MASTERMIND_MINECRAFT_SURVIVAL_AUTOMATION_ENABLED',
]);

const COMPANION_INSTRUCTIONS = `You are The_AlChemist___, a Minecraft player and companion.
Sound like a relaxed, genuine friend in ordinary chat: warm, curious, lightly playful, and direct.
Do not sound like customer support, a branded AI assistant, a mascot, a tutorial, or a safety announcement.
Use casual natural language and contractions. Keep most replies to one or two short sentences. Avoid canned enthusiasm, repeated offers to help, and excessive exclamation marks.
Do not introduce yourself unless asked, repeat your own name unnecessarily, or announce that you are family-friendly, kid-safe, age-appropriate, wholesome, safe, or policy-compliant.
Stay the same character while adapting vocabulary and detail to the named player's role. Use that role only to calibrate the reply; never mention or label the role.
Safety and privacy rules are silent behavior constraints. Follow them without advertising them. Redirect or decline briefly only when a request actually requires it, and explain the boundary only if the player asks why.
Never claim you performed, observed, remembered, or can perform an action unless the supplied context says so.
The supplied capabilities object is authoritative. If physicalActions is true, you can move through the Minecraft world and perform exactly the listed enabledPhysicalSkills. Never broadly claim that you cannot move, follow, gather, or use Baritone when those skills are listed.
Do not claim that a physical request started or succeeded merely because the player asked; deterministic task execution is handled outside this conversation lane.
When asked what you are or what you can do, answer naturally as the embodied Minecraft companion using only the supplied identity and capability facts. Clearly distinguish enabled skills from listed limitations without mentioning internal architecture.
Never issue Minecraft commands, URLs, secrets, purchases, or requests for private information. Do not infer diagnoses, protected traits, psychographics, or commercial intent.
If asked for an unavailable physical action, say naturally and briefly that you cannot do that one yet, then continue the conversation if useful.
Return one natural reply with no speaker prefix.`;

const PHYSICAL_PLANNER_INSTRUCTIONS = `You are the constrained physical-action router for a Minecraft companion.
Classify the current player message using the supplied previous message, inventory totals, position, and authorized action kinds.
Return decision "action" only when a single authorized typed action safely represents the request. Return "cancel" for stopping current work, "clarify" when required information is missing or contradictory, and "conversation" when no physical action is requested.
Never narrate, promise, role-play, or claim an action. The executor speaks separately only after validated dispatch.
Use zero-based slots for direct.selectSlot: player-visible slot 1 is 0 and slot 9 is 8.
Use direct.selectItem for requests to find or select a named hotbar item. Prefer an exact item ID present in inventory. In this world, wooden plank means minecraft:oak_planks. Do not invent unavailable items.
Use direct.swingHand for punching or swinging at air. Use direct.attack only for an entity under the crosshair.
Use direct.dropItem for dropping the currently selected item. Set all true only when the player explicitly asks for the whole stack.
Use direct.dropItemById when the player names the item to throw or drop. Prefer an exact item ID present in inventory and set all true only for the whole stack.
Use direct.placeNearbyBlock when the player permits nearby, here, in front, on the floor/ground, or anywhere. Use direct.placeBlock only with explicit x/y/z.
For skill.followPlayer, argumentsJson must contain only distance; the trusted runtime binds the requesting player's UUID.
For navigation, preserve labeled axes. If Y is outside -64 through 320 or axes appear swapped, clarify.
argumentsJson must be a JSON object string containing exactly the fields required by the chosen action. message is used only for a short clarification and must otherwise be empty.`;

const PHYSICAL_PLAN_FORMAT = Object.freeze({
  type: 'json_schema',
  name: 'minecraft_physical_plan',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      decision: { enum: ['conversation', 'clarify', 'cancel', 'action'] },
      actionKind: { enum: ['none', ...PLANNABLE_ACTIONS] },
      argumentsJson: { type: 'string', minLength: 2, maxLength: 512 },
      message: { type: 'string', minLength: 0, maxLength: 180 },
    },
    required: ['decision', 'actionKind', 'argumentsJson', 'message'],
  },
});

function boundedReply(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('Model reply was not text'), { code: 'MODEL_OUTPUT_INVALID' });
  const text = value.trim();
  if (text.length < 1 || text.length > MAX_REPLY_CHARS || text.startsWith('/')
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text)) {
    throw Object.assign(new Error('Model reply violated the Minecraft chat boundary'), { code: 'MODEL_OUTPUT_INVALID' });
  }
  return text;
}

function isCapabilityQuestion(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return false;
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
    .replace(/^(?:hey\s+)?(?:the[_ ]?alchemist_+|alchemist)\s*[,!:;-]?\s*/u, '');
  return CAPABILITY_QUESTION.test(normalized);
}

function capabilityReply(flags) {
  if (flags.physicalTaskPlanning !== true) {
    return "I can chat with you, but my movement and task controls aren't enabled right now.";
  }
  const survival = flags.survivalAutomation === true ? ' and handle basic survival' : '';
  return `I can chat, follow you, navigate to coordinates, scout, gather, use targets, place nearby blocks, drop held items, and stop${survival}. I can't sleep, craft, use storage, build structures, or deliver yet.`;
}

export function isCompanionSelfMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const minecraftUuid = typeof value.minecraftUuid === 'string' ? value.minecraftUuid.toLowerCase() : '';
  const displayName = typeof value.displayName === 'string' ? value.displayName.toLowerCase() : '';
  return minecraftUuid === COMPANION_MINECRAFT_UUID || displayName === COMPANION_DISPLAY_NAME;
}

function outputText(response) {
  const parts = Array.isArray(response?.output) ? response.output : [];
  for (const item of parts) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw Object.assign(new Error('Model response omitted output text'), { code: 'MODEL_OUTPUT_MISSING' });
}

function publicFailure(error, fallback = 'MODEL_REQUEST_FAILED') {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)
    ? error.code
    : fallback;
  return { ok: false, code };
}

function validatedPhysicalPlan(output, authorizedTools, minecraftUuid) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw Object.assign(new Error('Physical plan was not an object'), { code: 'MODEL_OUTPUT_INVALID' });
  }
  const { decision, actionKind, argumentsJson, message } = output;
  if (!['conversation', 'clarify', 'cancel', 'action'].includes(decision)
    || typeof actionKind !== 'string' || typeof argumentsJson !== 'string' || typeof message !== 'string') {
    throw Object.assign(new Error('Physical plan fields are invalid'), { code: 'MODEL_OUTPUT_INVALID' });
  }
  if (decision === 'conversation') return Object.freeze({ decision, action: null, message: '' });
  if (decision === 'cancel') return Object.freeze({ decision, action: null, message: '' });
  if (decision === 'clarify') {
    const clarification = boundedReply(message);
    return Object.freeze({ decision, action: null, message: clarification });
  }
  if (actionKind === 'none' || !authorizedTools.includes(actionKind)) {
    throw Object.assign(new Error('Physical plan selected an unauthorized action'), { code: 'MODEL_ACTION_UNAUTHORIZED' });
  }
  let args;
  try {
    args = JSON.parse(argumentsJson);
  } catch {
    throw Object.assign(new Error('Physical action arguments were not JSON'), { code: 'MODEL_OUTPUT_INVALID' });
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw Object.assign(new Error('Physical action arguments were not an object'), { code: 'MODEL_OUTPUT_INVALID' });
  }
  if (actionKind === 'skill.followPlayer') {
    if (!UUID.test(minecraftUuid) || Object.keys(args).some((key) => key !== 'distance')) {
      throw Object.assign(new Error('Follow plan crossed the trusted identity boundary'), { code: 'MODEL_OUTPUT_INVALID' });
    }
    args = { ...args, playerUuid: minecraftUuid };
  }
  const action = validateFamilyBridgeAction({ kind: actionKind, args });
  return Object.freeze({ decision, action, message: '' });
}

function selectedEnvValue(contents, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matches = [...contents.matchAll(new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*)$`, 'gmu'))];
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) throw new TypeError(`Duplicate private environment setting '${key}'`);
  let value = matches[0][1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    const comment = value.indexOf(' #');
    if (comment >= 0) value = value.slice(0, comment).trimEnd();
  }
  if (value.length > 8_192 || /[\r\n\0]/u.test(value) || value.includes('${')) {
    throw new TypeError(`Private environment setting '${key}' is invalid`);
  }
  return value;
}

export async function loadCompanionEnvironment(options = {}) {
  const baseEnvironment = options.baseEnvironment ?? process.env;
  const workspace = options.workspace ?? process.cwd();
  if (!baseEnvironment || typeof baseEnvironment !== 'object' || Array.isArray(baseEnvironment) || !path.isAbsolute(workspace)) {
    throw new TypeError('The companion environment boundary is invalid');
  }
  const selected = Object.fromEntries(PRIVATE_ENV_KEYS.flatMap((key) => (
    typeof baseEnvironment[key] === 'string' ? [[key, baseEnvironment[key]]] : []
  )));
  const envFile = path.join(workspace, '.env.local');
  try {
    const stat = await fs.lstat(envFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
      throw new TypeError('The local private environment file is invalid');
    }
    const contents = await fs.readFile(envFile, 'utf8');
    for (const key of PRIVATE_ENV_KEYS) {
      if (Object.hasOwn(selected, key)) continue;
      const value = selectedEnvValue(contents, key);
      if (value !== undefined) selected[key] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return selected;
}

export class OpenAIResponsesProvider {
  constructor(options = {}) {
    if (typeof options.apiKey !== 'string' || options.apiKey.length < 20 || /\s/u.test(options.apiKey)) {
      throw new TypeError('A valid OpenAI API key is required');
    }
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.model = options.model ?? DEFAULT_MODEL;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    if (!SAFE_MODEL.test(this.model) || this.endpoint !== DEFAULT_ENDPOINT) throw new TypeError('The OpenAI provider configuration is invalid');
  }

  async reason(value) {
    const request = validateReasoningRequest(value);
    const isConversation = request.kind === 'converse' && request.authorizedTools.length === 0;
    const isPhysicalPlan = request.kind === 'plan' && request.authorizedTools.length > 0
      && request.authorizedTools.every((kind) => PLANNABLE_ACTIONS.includes(kind));
    if ((!isConversation && !isPhysicalPlan) || request.actor !== 'COMPANION') {
      return validateReasoningResult({
        requestId: request.requestId,
        status: 'failed',
        output: { code: 'MODEL_OPERATION_UNAVAILABLE' },
        model: this.model,
        completedAt: new Date().toISOString(),
      });
    }
    const remainingMs = Date.parse(request.deadlineAt) - Date.now();
    if (remainingMs < 1) {
      return validateReasoningResult({
        requestId: request.requestId,
        status: 'cancelled',
        output: { code: 'MODEL_DEADLINE_EXPIRED' },
        model: this.model,
        completedAt: new Date().toISOString(),
      });
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), Math.min(remainingMs, 20_000));
    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          instructions: isPhysicalPlan ? PHYSICAL_PLANNER_INSTRUCTIONS : COMPANION_INSTRUCTIONS,
          input: [{
            role: 'user',
            content: [{ type: 'input_text', text: JSON.stringify(request.input) }],
          }],
          max_output_tokens: isPhysicalPlan ? 384 : 256,
          reasoning: { effort: 'minimal' },
          text: {
            verbosity: 'low',
            format: isPhysicalPlan ? PHYSICAL_PLAN_FORMAT : {
              type: 'json_schema', name: 'minecraft_companion_reply', strict: true,
              schema: {
                type: 'object', additionalProperties: false,
                properties: { text: { type: 'string', minLength: 1, maxLength: MAX_REPLY_CHARS } },
                required: ['text'],
              },
            },
          },
        }),
        signal: abort.signal,
      });
      if (!response?.ok) {
        const code = response?.status === 401 || response?.status === 403
          ? 'MODEL_CREDENTIAL_REJECTED'
          : response?.status === 429
            ? 'MODEL_RATE_LIMITED'
            : 'MODEL_PROVIDER_UNAVAILABLE';
        return validateReasoningResult({
          requestId: request.requestId,
          status: 'failed',
          output: { code },
          model: this.model,
          completedAt: new Date().toISOString(),
        });
      }
      const payload = await response.json();
      const parsed = JSON.parse(outputText(payload));
      const output = isPhysicalPlan ? parsed : { text: boundedReply(parsed?.text) };
      return validateReasoningResult({
        requestId: request.requestId,
        status: 'succeeded',
        output,
        model: this.model,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      const code = error?.name === 'AbortError' ? 'MODEL_DEADLINE_EXPIRED' : publicFailure(error).code;
      return validateReasoningResult({
        requestId: request.requestId,
        status: code === 'MODEL_DEADLINE_EXPIRED' ? 'cancelled' : 'failed',
        output: { code },
        model: this.model,
        completedAt: new Date().toISOString(),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export class ModelCallGovernor {
  constructor(options = {}) {
    this.maximum = options.maximum ?? 2;
    this.active = new Set();
    if (!Number.isInteger(this.maximum) || this.maximum < 1 || this.maximum > 2) {
      throw new TypeError('Model concurrency must be one or two');
    }
  }

  acquire() {
    if (this.active.size >= this.maximum) return null;
    const leaseId = crypto.randomUUID();
    this.active.add(leaseId);
    return leaseId;
  }

  release(leaseId) {
    return this.active.delete(leaseId);
  }

  status() {
    return { active: this.active.size, maximum: this.maximum };
  }
}

export class CompanionConversationCoordinator {
  constructor(options = {}) {
    this.flags = { ...options.flags };
    this.router = options.router ?? new ConversationRouter({ flags: this.flags });
    this.intake = options.intake ?? new ConversationIntake({
      router: this.router,
      permissionPolicy: options.permissionPolicy ?? new PermissionPolicy(),
      flags: this.flags,
    });
    this.provider = options.provider;
    this.sendChat = options.sendChat;
    this.canSendChat = options.canSendChat ?? (() => true);
    this.governor = options.governor ?? new ModelCallGovernor();
    this.taskSupervisor = options.taskSupervisor ?? null;
    this.sessionStatus = options.sessionStatus ?? (() => null);
    if (!this.provider || typeof this.provider.reason !== 'function' || typeof this.sendChat !== 'function'
      || typeof this.canSendChat !== 'function') throw new TypeError('The companion conversation dependencies are invalid');
    this.modelCalls = 0;
    this.replies = 0;
    this.failures = 0;
    this.lastModel = null;
    this.recentMessages = new Map();
  }

  async ingest(value) {
    if (isCompanionSelfMessage(value)) {
      return {
        ok: true,
        actor: null,
        reason: 'companion-self-message',
        authorization: null,
        execution: { ok: true, code: 'IGNORED_COMPANION_SELF_MESSAGE' },
      };
    }
    const intake = this.intake.ingest(value);
    if (intake.actor !== 'COMPANION' || intake.authorization?.allowed !== true) return intake;
    if (this.flags.physicalTaskPlanning && this.taskSupervisor) {
      const task = await this.taskSupervisor.handle(value);
      if (task.handled) {
        this.intake.markExecution(task.code, value.occurredAt);
        if (task.spoke === true) this.#markCompanionResponse(value);
        return { ...intake, execution: { ok: task.ok, code: task.code } };
      }
      const previous = this.recentMessages.get(value.minecraftUuid);
      const previousIsRecent = previous && Date.now() - previous.receivedAt < 90_000;
      const shouldPlan = this.flags.modelReasoning && (PHYSICAL_REQUEST_HINT.test(value.text)
        || (previousIsRecent && PHYSICAL_REQUEST_HINT.test(previous.text)));
      this.recentMessages.set(value.minecraftUuid, { text: value.text, receivedAt: Date.now() });
      if (this.recentMessages.size > 32) this.recentMessages.delete(this.recentMessages.keys().next().value);
      if (shouldPlan) {
        const planned = await this.#planPhysical(value, previousIsRecent ? previous.text : null);
        if (planned.handled) {
          this.intake.markExecution(planned.code, value.occurredAt);
          if (planned.spoke === true) this.#markCompanionResponse(value);
          return { ...intake, execution: { ok: planned.ok, code: planned.code } };
        }
      }
    }
    if (!this.flags.companionConversation || !this.flags.modelReasoning) return intake;
    if (!this.canSendChat()) {
      this.failures += 1;
      this.intake.markExecution('COMPANION_OUTPUT_UNAVAILABLE', value.occurredAt);
      return { ...intake, execution: { ok: false, code: 'COMPANION_OUTPUT_UNAVAILABLE' } };
    }
    if (isCapabilityQuestion(value.text)) {
      try {
        await this.sendChat(capabilityReply(this.flags));
        this.replies += 1;
        this.intake.markExecution('CAPABILITY_REPLY_DISPATCHED', value.occurredAt);
        this.#markCompanionResponse(value);
        return { ...intake, execution: { ok: true, code: 'CAPABILITY_REPLY_DISPATCHED' } };
      } catch (error) {
        this.failures += 1;
        const failure = publicFailure(error, 'COMPANION_OUTPUT_FAILED');
        this.intake.markExecution(failure.code, value.occurredAt);
        return { ...intake, execution: failure };
      }
    }
    const leaseId = this.governor.acquire();
    if (!leaseId) {
      this.failures += 1;
      this.intake.markExecution('MODEL_CONCURRENCY_LIMIT', value.occurredAt);
      return { ...intake, execution: { ok: false, code: 'MODEL_CONCURRENCY_LIMIT' } };
    }
    try {
      this.modelCalls += 1;
      const result = await this.provider.reason({
        requestId: crypto.randomUUID(),
        kind: 'converse',
        actor: 'COMPANION',
        playerId: typeof value.playerId === 'string' && UUID.test(value.playerId) ? value.playerId : null,
        input: {
          player: { displayName: value.displayName, role: value.role },
          message: value.text,
          channel: value.channel,
          identity: {
            character: 'The_AlChemist___',
            embodiment: 'Minecraft player account in the Family world',
          },
          capabilities: {
            conversation: true,
            physicalActions: this.flags.physicalTaskPlanning === true,
            enabledPhysicalSkills: this.flags.physicalTaskPlanning === true ? ENABLED_PHYSICAL_SKILLS : [],
            survivalAutomation: this.flags.survivalAutomation === true,
            persistentMemory: false,
            limitations: ['sleeping', 'container management', 'crafting', 'building', 'item delivery'],
          },
        },
        authorizedTools: [],
        deadlineAt: new Date(Date.now() + 20_000).toISOString(),
      });
      this.lastModel = result.model;
      if (result.status !== 'succeeded') {
        this.failures += 1;
        const code = typeof result.output?.code === 'string' ? result.output.code : 'MODEL_REQUEST_FAILED';
        this.intake.markExecution(code, value.occurredAt);
        return { ...intake, execution: { ok: false, code } };
      }
      const text = boundedReply(result.output?.text);
      await this.sendChat(text);
      this.replies += 1;
      this.intake.markExecution('REPLY_DISPATCHED', value.occurredAt);
      this.#markCompanionResponse(value);
      return { ...intake, execution: { ok: true, code: 'REPLY_DISPATCHED' } };
    } catch (error) {
      this.failures += 1;
      const failure = publicFailure(error, 'COMPANION_OUTPUT_FAILED');
      this.intake.markExecution(failure.code, value.occurredAt);
      return { ...intake, execution: failure };
    } finally {
      this.governor.release(leaseId);
    }
  }

  async #planPhysical(value, previousMessage) {
    if (!this.canSendChat()) return { handled: true, ok: false, code: 'COMPANION_OUTPUT_UNAVAILABLE' };
    const leaseId = this.governor.acquire();
    if (!leaseId) return { handled: true, ok: false, code: 'MODEL_CONCURRENCY_LIMIT' };
    try {
      this.modelCalls += 1;
      const snapshot = this.sessionStatus()?.latestSnapshot ?? null;
      const result = await this.provider.reason({
        requestId: crypto.randomUUID(), kind: 'plan', actor: 'COMPANION',
        playerId: typeof value.playerId === 'string' && UUID.test(value.playerId) ? value.playerId : null,
        input: {
          currentMessage: value.text,
          previousMessage,
          player: { displayName: value.displayName, role: value.role },
          companionState: {
            position: snapshot?.player?.position ?? null,
            inventory: snapshot?.inventory?.items ?? [],
            selectedHotbarSlot: snapshot?.player?.selectedHotbarSlot ?? null,
          },
        },
        authorizedTools: [...PLANNABLE_ACTIONS],
        deadlineAt: new Date(Date.now() + 20_000).toISOString(),
      });
      this.lastModel = result.model;
      if (result.status !== 'succeeded') {
        this.failures += 1;
        return { handled: true, ok: false, code: result.output?.code ?? 'MODEL_REQUEST_FAILED' };
      }
      const plan = validatedPhysicalPlan(result.output, PLANNABLE_ACTIONS, value.minecraftUuid);
      if (plan.decision === 'conversation') {
        const spoke = await this.#speakPlanningFailure("I couldn't map that to an action yet, so I didn't do anything.");
        return { handled: true, ok: false, code: 'PHYSICAL_REQUEST_NOT_UNDERSTOOD', spoke };
      }
      return this.taskSupervisor.handlePlanned(value, plan);
    } catch (error) {
      this.failures += 1;
      const spoke = await this.#speakPlanningFailure("I couldn't turn that into a safe action, so I didn't do anything.");
      return { handled: true, ok: false, code: publicFailure(error, 'PHYSICAL_PLAN_FAILED').code, spoke };
    } finally {
      this.governor.release(leaseId);
    }
  }

  async #speakPlanningFailure(text) {
    try {
      await this.sendChat(text);
      this.replies += 1;
      return true;
    } catch {
      return false;
    }
  }

  #markCompanionResponse(value) {
    this.router.markResponse({
      messageId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      minecraftUuid: value.minecraftUuid,
      actor: 'COMPANION',
    });
  }

  status() {
    return {
      ...this.intake.status(),
      modelCalls: this.modelCalls,
      replies: this.replies,
      failures: this.failures,
      activeModelCalls: this.governor.status().active,
      model: this.lastModel,
    };
  }
}

export function companionFlagsFromEnvironment(environment = process.env) {
  const requestedConversation = environment.MASTERMIND_MINECRAFT_COMPANION_CONVERSATION_ENABLED === 'true';
  const requestedReasoning = environment.MASTERMIND_MINECRAFT_MODEL_REASONING_ENABLED === 'true';
  const hasCredential = typeof environment.OPENAI_API_KEY === 'string' && environment.OPENAI_API_KEY.length >= 20;
  const requestedPhysicalTasks = environment.MASTERMIND_MINECRAFT_PHYSICAL_TASK_PLANNING_ENABLED === 'true';
  const requestedSurvival = environment.MASTERMIND_MINECRAFT_SURVIVAL_AUTOMATION_ENABLED === 'true';
  return {
    computerChat: false,
    companionConversation: requestedConversation && requestedReasoning && hasCredential,
    modelReasoning: requestedConversation && requestedReasoning && hasCredential,
    profileCapture: false,
    physicalTaskPlanning: requestedPhysicalTasks,
    survivalAutomation: requestedSurvival,
    modRequestExecution: false,
    inGameApprovals: false,
    visionRecovery: false,
    zenithBody: false,
    enhancedHeadlessController: false,
    hybridTelemetry: false,
  };
}

export function createFamilyCompanionBrain(options = {}) {
  const environment = options.environment ?? process.env;
  const flags = options.flags ?? companionFlagsFromEnvironment(environment);
  const conversationEnabled = flags.companionConversation === true && flags.modelReasoning === true;
  const deterministicEnabled = flags.physicalTaskPlanning === true || flags.survivalAutomation === true;
  if (!conversationEnabled && !deterministicEnabled) {
    return (options.disabledFactory ?? createFamilyCompanionSkeleton)();
  }
  const provider = options.provider ?? (conversationEnabled
    ? new OpenAIResponsesProvider({
      apiKey: environment.OPENAI_API_KEY,
      model: environment.MASTERMIND_MINECRAFT_OPENAI_MODEL || DEFAULT_MODEL,
      fetcher: options.fetcher,
    })
    : { async reason() { throw Object.assign(new Error('Model reasoning is disabled'), { code: 'MODEL_REASONING_DISABLED' }); } });
  const taskSupervisor = flags.physicalTaskPlanning
    ? (options.taskSupervisor ?? new CompanionPhysicalTaskSupervisor({
      dispatchAction: options.dispatchAction,
      cancelAction: options.cancelAction,
      waitForActionActivation: options.waitForActionActivation,
      sessionStatus: options.sessionStatus,
      sendChat: options.sendChat,
    }))
    : null;
  const survivalController = flags.survivalAutomation
    ? (options.survivalController ?? new DeterministicSurvivalController({
      mode: 'stay_alive',
      dispatchAction: options.dispatchAction,
      cancelAction: options.cancelAction,
      sessionStatus: options.sessionStatus,
    }))
    : null;
  const coordinator = new CompanionConversationCoordinator({
    flags,
    provider,
    sendChat: options.sendChat,
    canSendChat: options.canSendChat,
    taskSupervisor,
    sessionStatus: options.sessionStatus,
  });
  const states = {
    computerChat: 'stubbed', companionConversation: 'implemented', modelReasoning: 'implemented', profileCapture: 'stubbed',
    physicalTaskPlanning: 'implemented', survivalAutomation: 'implemented', modRequestExecution: 'stubbed', inGameApprovals: 'planned',
    visionRecovery: 'planned', zenithBody: 'stubbed', enhancedHeadlessController: 'stubbed', hybridTelemetry: 'stubbed',
  };
  return {
    ingestChat: (value) => coordinator.ingest(value),
    conversationStatus: () => coordinator.status(),
    status: () => featureStatus(flags, states),
    conversationCoordinator: coordinator,
    taskSupervisor,
    tickSurvival: () => survivalController?.tick() ?? Promise.resolve(Object.freeze({ ok: false, code: 'SURVIVAL_DISABLED' })),
    survivalStatus: () => survivalController?.status() ?? Object.freeze({ mode: 'disabled' }),
  };
}
