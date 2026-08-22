import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validateReasoningRequest, validateReasoningResult } from './contracts.mjs';
import { featureStatus } from './features.mjs';
import { ConversationIntake, ConversationRouter, PermissionPolicy, createFamilyCompanionSkeleton } from './skeleton.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const DEFAULT_MODEL = 'gpt-5-mini';
const COMPANION_MINECRAFT_UUID = '996a56dd-fb3c-4f90-9158-1a608652ec77';
const COMPANION_DISPLAY_NAME = 'the_alchemist___';
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/responses';
const MAX_REPLY_CHARS = 220;
const PRIVATE_ENV_KEYS = Object.freeze([
  'OPENAI_API_KEY',
  'MASTERMIND_MINECRAFT_COMPANION_CONVERSATION_ENABLED',
  'MASTERMIND_MINECRAFT_MODEL_REASONING_ENABLED',
  'MASTERMIND_MINECRAFT_OPENAI_MODEL',
]);

const COMPANION_INSTRUCTIONS = `You are The_AlChemist___, an embodied Minecraft family companion.
You are friendly, calm, slightly eager, and concise enough for Minecraft chat.
Stay the same character while adapting vocabulary and detail to the named player's role.
Never claim you performed, observed, remembered, or can perform an action unless the supplied context says so.
Never issue Minecraft commands, URLs, secrets, purchases, or requests for private information.
For children, keep conversation age-appropriate and do not infer diagnoses, protected traits, psychographics, or commercial intent.
If asked for an unavailable physical action, say briefly that your movement tools are not connected yet and keep helping conversationally.
Return one natural reply with no speaker prefix.`;

function boundedReply(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('Model reply was not text'), { code: 'MODEL_OUTPUT_INVALID' });
  const text = value.trim();
  if (text.length < 1 || text.length > MAX_REPLY_CHARS || text.startsWith('/')
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text)) {
    throw Object.assign(new Error('Model reply violated the Minecraft chat boundary'), { code: 'MODEL_OUTPUT_INVALID' });
  }
  return text;
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
    if (request.kind !== 'converse' || request.actor !== 'COMPANION' || request.authorizedTools.length !== 0) {
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
          instructions: COMPANION_INSTRUCTIONS,
          input: [{
            role: 'user',
            content: [{ type: 'input_text', text: JSON.stringify(request.input) }],
          }],
          max_output_tokens: 256,
          reasoning: { effort: 'minimal' },
          text: {
            verbosity: 'low',
            format: {
              type: 'json_schema',
              name: 'minecraft_companion_reply',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
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
      const text = boundedReply(parsed?.text);
      return validateReasoningResult({
        requestId: request.requestId,
        status: 'succeeded',
        output: { text },
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
    if (!this.provider || typeof this.provider.reason !== 'function' || typeof this.sendChat !== 'function'
      || typeof this.canSendChat !== 'function') throw new TypeError('The companion conversation dependencies are invalid');
    this.modelCalls = 0;
    this.replies = 0;
    this.failures = 0;
    this.lastModel = null;
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
    if (!this.flags.companionConversation || !this.flags.modelReasoning) return intake;
    if (!this.canSendChat()) {
      this.failures += 1;
      this.intake.markExecution('COMPANION_OUTPUT_UNAVAILABLE', value.occurredAt);
      return { ...intake, execution: { ok: false, code: 'COMPANION_OUTPUT_UNAVAILABLE' } };
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
          capabilities: { conversation: true, physicalActions: false, persistentMemory: false },
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
      this.router.markResponse({
        messageId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        minecraftUuid: value.minecraftUuid,
        actor: 'COMPANION',
      });
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
  return {
    computerChat: false,
    companionConversation: requestedConversation && requestedReasoning && hasCredential,
    modelReasoning: requestedConversation && requestedReasoning && hasCredential,
    profileCapture: false,
    physicalTaskPlanning: false,
    survivalAutomation: false,
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
  if (!flags.companionConversation || !flags.modelReasoning) {
    return (options.disabledFactory ?? createFamilyCompanionSkeleton)();
  }
  const provider = options.provider ?? new OpenAIResponsesProvider({
    apiKey: environment.OPENAI_API_KEY,
    model: environment.MASTERMIND_MINECRAFT_OPENAI_MODEL || DEFAULT_MODEL,
    fetcher: options.fetcher,
  });
  const coordinator = new CompanionConversationCoordinator({
    flags,
    provider,
    sendChat: options.sendChat,
    canSendChat: options.canSendChat,
  });
  const states = {
    computerChat: 'stubbed', companionConversation: 'implemented', modelReasoning: 'implemented', profileCapture: 'stubbed',
    physicalTaskPlanning: 'stubbed', survivalAutomation: 'stubbed', modRequestExecution: 'stubbed', inGameApprovals: 'planned',
    visionRecovery: 'planned', zenithBody: 'stubbed', enhancedHeadlessController: 'stubbed', hybridTelemetry: 'stubbed',
  };
  return {
    ingestChat: (value) => coordinator.ingest(value),
    conversationStatus: () => coordinator.status(),
    status: () => featureStatus(flags, states),
    conversationCoordinator: coordinator,
  };
}
