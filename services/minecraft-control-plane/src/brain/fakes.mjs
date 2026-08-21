import { validateProfileClaim, validateReasoningRequest, validateReasoningResult, validateTaskPlan } from './contracts.mjs';

export class FakeIdentityResolver {
  constructor(principals = []) {
    this.principals = new Map(principals.map((principal) => [principal.minecraftUuid, principal]));
  }

  resolvePlayer(minecraftUuid) {
    const value = this.principals.get(minecraftUuid);
    return value ? { ok: true, principal: structuredClone(value) } : { ok: false, code: 'PLAYER_UNBOUND' };
  }
}
export class FakeReasoningModel {
  constructor(script = {}) { this.script = script; this.calls = []; }

  #reply(method, input, fallback) {
    this.calls.push({ method, input: structuredClone(input) });
    const response = Object.hasOwn(this.script, method) ? this.script[method] : fallback;
    return structuredClone(response);
  }

  classifyIntent(input) { return this.#reply('classifyIntent', input, { kind: 'conversation', confidence: 1 }); }
  converse(input) { return this.#reply('converse', input, { text: 'Hello from the deterministic test companion.' }); }
  planTask(input) { return validateTaskPlan(this.#reply('planTask', input, input)); }
  extractProfileMemories(input) { return this.#reply('extractProfileMemories', input, []).map(validateProfileClaim); }
  diagnose(input) { return this.#reply('diagnose', input, { diagnosis: 'fixture', actions: [] }); }
  inspectImage(input) { return this.#reply('inspectImage', input, { diagnosis: 'fixture', actions: [], maxDurationMs: 1_000 }); }
}

export class FakeModelBroker {
  constructor(handler) { this.handler = handler; this.requests = []; }

  async reason(value) {
    const request = validateReasoningRequest(value);
    this.requests.push(request);
    return validateReasoningResult(await this.handler(structuredClone(request)));
  }
}

export class InMemoryProfileRepository {
  constructor() { this.interactions = []; this.claims = new Map(); }
  appendInteraction(value) { this.interactions.push(structuredClone(value)); return { ok: true }; }
  queryContext(playerId) { return { ok: true, claims: [...this.claims.values()].filter((claim) => claim.playerId === playerId).map(structuredClone) }; }
  upsertClaim(value) { const claim = validateProfileClaim(value); this.claims.set(claim.claimId, claim); return { ok: true, claim: structuredClone(claim) }; }
  forget(claimId) { return { ok: true, forgotten: this.claims.delete(claimId) }; }
  rebuildProjection(playerId) { return this.queryContext(playerId); }
}
