// Reconciles PR #2's read-only embodiment transport with the canonical local gateway.
import { MastermindContextGateway } from './context-gateway.mjs';
import { TOOLS, HANDLERS } from './tool-catalog.mjs';
import { ContextGatewayError, sanitizeValue, requiredString, patterns, uuid } from './validation.mjs';

export const HOSTED_REQUEST_BYTES = 65_536;
export const HOSTED_PAYLOAD_BYTES = 24_000;
export const HOSTED_ENVELOPE_BYTES = 65_536;
const NAMES = new Set(['mastermind_bootstrap', 'mastermind_context_pack', 'mastermind_memory_search',
  'mastermind_archive_search', 'mastermind_archive_fetch', 'mastermind_project_state', 'mastermind_system_status']);

export const HOSTED_TOOLS = Object.freeze(TOOLS.filter((tool) => NAMES.has(tool.name)).map((tool) => {
  const copy = structuredClone(tool);
  if (copy.inputSchema.properties.budget) {
    copy.inputSchema.properties.budget.maximum = 12_000;
    copy.inputSchema.properties.budget.default = 6_000;
  }
  return Object.freeze(copy);
}));

export function canonicalHostedConfiguration(env) {
  const ownerSubject = requiredString(env.OWNER_CLERK_USER_ID, 'OWNER_CLERK_USER_ID', 128, /^user_[A-Za-z0-9_-]{1,123}$/);
  // Historical aliases must not silently turn one Clerk identity into another operator.
  if (env.MASTERMIND_OWNER_ID && env.MASTERMIND_OWNER_ID !== ownerSubject) {
    throw new ContextGatewayError('OWNER_CONFIGURATION_CONFLICT', 'The configured owner aliases disagree.', 503);
  }
  return Object.freeze({ ownerSubject, identity: Object.freeze({
    householdId: requiredString(env.MASTERMIND_MEMORY_HOUSEHOLD_ID, 'householdId', 128, patterns.SAFE_ID),
    actorPlayerId: uuid(env.MASTERMIND_MEMORY_OPERATOR_PLAYER_ID, 'actorPlayerId'),
  }) });
}

export async function createHostedGateway({ store, authenticatedSubject, configuration, embed }) {
  if (!authenticatedSubject || authenticatedSubject !== configuration.ownerSubject) {
    throw new ContextGatewayError('OWNER_REQUIRED', 'The authenticated canonical owner is required.', 403);
  }
  const identity = await store.resolveClerkOperator(authenticatedSubject, configuration.identity);
  return new MastermindContextGateway({ store, identity, embed,
    // Hosted services cannot infer workstation health or call workstation loopback.
    minecraftStatus: async () => ({ configured: false, observation: 'workstation-status-not-connected', actionsEnabled: false }),
  });
}

/** @param {any} gateway @param {string} name @param {unknown} [input] */
export async function callHostedTool(gateway, name, input = {}) {
  if (!NAMES.has(name)) throw new ContextGatewayError('TOOL_NOT_AVAILABLE', 'This hosted adapter exposes read-only context tools.', 403);
  let args = input;
  if (name === 'mastermind_bootstrap' || name === 'mastermind_context_pack') {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ContextGatewayError('INVALID_ARGUMENT', 'Arguments must be an object.');
    const budget = input.budget ?? 6_000;
    if (!Number.isSafeInteger(budget) || budget < 4_000 || budget > 12_000) {
      throw new ContextGatewayError('INVALID_ARGUMENT', 'Hosted budget must be from 4000 to 12000 JSON characters.');
    }
    args = { ...input, budget };
  }
  const result = await gateway[HANDLERS[name]](args);
  if (name === 'mastermind_system_status') {
    return { ...result, gateway: { ...result.gateway, transport: 'hosted-read-only', writeCapabilities: [], availableTools: [...NAMES] } };
  }
  return result;
}

export function hostedToolEnvelope(value, isError = false) {
  const payload = sanitizeValue(value);
  const text = JSON.stringify(payload);
  const envelope = { content: [{ type: /** @type {'text'} */ ('text'), text }], structuredContent: payload, isError };
  if (Buffer.byteLength(text, 'utf8') > HOSTED_PAYLOAD_BYTES
      || Buffer.byteLength(JSON.stringify(envelope), 'utf8') > HOSTED_ENVELOPE_BYTES) {
    throw new ContextGatewayError('RESPONSE_TOO_LARGE', 'Request a smaller limit, context window, or context budget; no partial evidence was returned.', 413);
  }
  return envelope;
}

export function hostedToolFailure(error) {
  return hostedToolEnvelope({ ok: false,
    code: error instanceof ContextGatewayError ? error.code : 'GATEWAY_UNAVAILABLE',
    message: error instanceof ContextGatewayError ? error.message : 'The authorized context service could not complete the request.',
  }, true);
}
