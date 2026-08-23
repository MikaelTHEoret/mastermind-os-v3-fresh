const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TERMINAL_ACTION_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const PHYSICAL_ROLES = new Set(['parent', 'child']);

const BLOCK_ALIASES = new Map([
  ['oak log', 'minecraft:oak_log'], ['oak logs', 'minecraft:oak_log'], ['wood', 'minecraft:oak_log'],
  ['birch log', 'minecraft:birch_log'], ['birch logs', 'minecraft:birch_log'],
  ['spruce log', 'minecraft:spruce_log'], ['spruce logs', 'minecraft:spruce_log'],
  ['jungle log', 'minecraft:jungle_log'], ['jungle logs', 'minecraft:jungle_log'],
  ['acacia log', 'minecraft:acacia_log'], ['acacia logs', 'minecraft:acacia_log'],
  ['dark oak log', 'minecraft:dark_oak_log'], ['dark oak logs', 'minecraft:dark_oak_log'],
  ['mangrove log', 'minecraft:mangrove_log'], ['mangrove logs', 'minecraft:mangrove_log'],
  ['cherry log', 'minecraft:cherry_log'], ['cherry logs', 'minecraft:cherry_log'],
  ['stone', 'minecraft:stone'], ['cobblestone', 'minecraft:cobblestone'],
  ['coal', 'minecraft:coal_ore'], ['coal ore', 'minecraft:coal_ore'],
  ['iron', 'minecraft:iron_ore'], ['iron ore', 'minecraft:iron_ore'],
]);

const PLACEABLE_BLOCK_ALIASES = new Map([
  ['oak plank', 'minecraft:oak_planks'], ['oak planks', 'minecraft:oak_planks'],
  ['cobblestone', 'minecraft:cobblestone'], ['stone', 'minecraft:stone'],
  ['dirt', 'minecraft:dirt'], ['torch', 'minecraft:torch'],
]);

function normalizeRequest(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return null;
  let request = value
    .normalize('NFKC')
    .trim()
    .replace(/^(?:hey\s+)?(?:the[_ ]?alchemist_+|alchemist)\s*[,!:;-]?\s*/iu, '')
    .replace(/\s+please[.!?]*$/iu, '')
    .trim()
    .toLocaleLowerCase('en-US');
  for (let index = 0; index < 3; index += 1) {
    const previous = request;
    request = request
      .replace(/^are you sure\b[\s,;:!?-]*/u, '')
      .replace(/^(?:okay|ok|alright|all right|well|then|actually|yes|yeah|yep|right)\b[\s,;:!?-]*/u, '')
      .replace(/^(?:can|could|would|will)\s+you\b[\s,;:!?-]*/u, '')
      .replace(/^please\b[\s,;:!?-]*/u, '')
      .trim();
    if (request === previous) break;
  }
  return request;
}

function task(intent, action, acknowledgement, timeoutMs, replaceCurrent = false) {
  return Object.freeze({ handled: true, intent, action, acknowledgement, timeoutMs, replaceCurrent });
}

export function compileDeterministicCompanionTask(text) {
  let request = normalizeRequest(text);
  if (!request) return null;
  if (/^(?:stop|stop that|cancel|cancel that|never mind|nevermind)[.!?]*$/u.test(request)) {
    return Object.freeze({ handled: true, intent: 'cancel-current', action: null, acknowledgement: null, timeoutMs: null });
  }
  const replacement = request.match(/^(?:stop|stop that|cancel|cancel that)\s+(?:and|then)\s+(.+)$/u);
  const replaceCurrent = replacement !== null;
  if (replacement) request = replacement[1].trim();

  const follow = request.match(/^follow me(?:\s+from\s+(\d+(?:\.\d+)?)\s+blocks?)?[.!?]*$/u);
  if (follow) {
    const distance = follow[1] === undefined ? 4 : Number(follow[1]);
    if (!Number.isFinite(distance) || distance < 2 || distance > 16) return null;
    return task('follow-player', { kind: 'skill.followPlayer', args: { playerUuid: null, distance } }, "Okay, I'll follow you.", 30 * 60_000, replaceCurrent);
  }

  const navigate = request.match(/^(?:go|walk|navigate|come)\s+to\s+(?:coordinates?\s+)?(?:x\s*=?\s*)?(-?\d+)\s*[, ]+\s*(?:y\s*=?\s*)?(-?\d+)\s*[, ]+\s*(?:z\s*=?\s*)?(-?\d+)[.!?]*$/u);
  if (navigate) {
    const [x, y, z] = navigate.slice(1).map(Number);
    if (Math.abs(x) > 30_000_000 || y < -2_048 || y > 2_048 || Math.abs(z) > 30_000_000) return null;
    return task('navigate', { kind: 'skill.navigateTo', args: { x, y, z, tolerance: 2 } }, "Okay, I'm on my way.", 10 * 60_000, replaceCurrent);
  }

  const lookAt = request.match(/^look\s+at\s+(?:coordinates?\s+)?(?:x\s*=?\s*)?(-?\d+)\s*[, ]+\s*(?:y\s*=?\s*)?(-?\d+)\s*[, ]+\s*(?:z\s*=?\s*)?(-?\d+)[.!?]*$/u);
  if (lookAt) {
    const [x, y, z] = lookAt.slice(1).map(Number);
    if (Math.abs(x) > 30_000_000 || y < -2_048 || y > 2_048 || Math.abs(z) > 30_000_000) return null;
    return task('look-at', { kind: 'direct.lookAt', args: { x, y, z, durationMs: 250 } }, "Okay, I'm looking there.", 15_000, replaceCurrent);
  }

  if (/^(?:use|use it|use that|use this|interact|interact with it|open it|open that|press it|press that)[.!?]*$/u.test(request)) {
    return task('use-crosshair', { kind: 'direct.use', args: { hand: 'main' } }, "Okay, I'll try it.", 15_000, replaceCurrent);
  }

  const selectSlot = request.match(/^(?:select|use|switch to)\s+(?:hotbar\s+)?slot\s+([1-9])[.!?]*$/u);
  if (selectSlot) {
    const visibleSlot = Number(selectSlot[1]);
    return task('select-slot', { kind: 'direct.selectSlot', args: { slot: visibleSlot - 1 } }, `Okay, slot ${visibleSlot}.`, 15_000, replaceCurrent);
  }

  const place = request.match(/^place\s+(?:a\s+)?([a-z0-9_: ]+?)\s+at\s+(?:coordinates?\s+)?(?:x\s*=?\s*)?(-?\d+)\s*[, ]+\s*(?:y\s*=?\s*)?(-?\d+)\s*[, ]+\s*(?:z\s*=?\s*)?(-?\d+)[.!?]*$/u);
  if (place) {
    const label = place[1].trim().replace(/\s+/gu, ' ');
    const blockId = PLACEABLE_BLOCK_ALIASES.get(label) ?? (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(label) ? label : null);
    const [x, y, z] = place.slice(2).map(Number);
    if (!blockId || Math.abs(x) > 30_000_000 || y < -2_048 || y > 2_048 || Math.abs(z) > 30_000_000) return null;
    return task('place-block', { kind: 'direct.placeBlock', args: { blockId, x, y, z } }, `Okay, I'll place ${label} there.`, 15_000, replaceCurrent);
  }

  const explore = request.match(/^(?:explore|look around|scout)(?:\s+(?:within\s+)?(\d+)\s+blocks?)?[.!?]*$/u);
  if (explore) {
    const radius = explore[1] === undefined ? 64 : Number(explore[1]);
    if (!Number.isInteger(radius) || radius < 16 || radius > 256) return null;
    return task('explore', { kind: 'skill.explore', args: { radius } }, "I'll scout around nearby.", 10 * 60_000, replaceCurrent);
  }

  const gather = request.match(/^(?:gather|collect|mine|chop|get)\s+(?:(\d+)\s+)?([a-z ]+?)[.!?]*$/u);
  if (gather) {
    const count = gather[1] === undefined ? 8 : Number(gather[1]);
    const label = gather[2].trim().replace(/\s+/gu, ' ');
    const blockId = BLOCK_ALIASES.get(label);
    if (!blockId || !Number.isInteger(count) || count < 1 || count > 64) return null;
    return task('gather-block', {
      kind: 'skill.gatherBlock', args: { blockId, count, maxDistance: 64 },
    }, `I'll look for ${count} ${label}.`, 15 * 60_000, replaceCurrent);
  }
  return null;
}

function publicFailureCode(error) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)
    ? error.code
    : 'TASK_DISPATCH_FAILED';
}

export class CompanionPhysicalTaskSupervisor {
  constructor(options = {}) {
    this.dispatchAction = options.dispatchAction;
    this.cancelAction = options.cancelAction;
    this.waitForActionActivation = options.waitForActionActivation ?? (async (action) => action);
    this.waitForPhysicalIdle = options.waitForPhysicalIdle ?? (async () => {
      const deadline = Date.now() + 3_000;
      while (this.sessionStatus()?.activeAction) {
        if (Date.now() >= deadline) throw Object.assign(new Error('The prior action did not stop in time'), { code: 'ACTION_STOP_TIMEOUT' });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });
    this.sessionStatus = options.sessionStatus;
    this.sendChat = options.sendChat;
    if (typeof this.dispatchAction !== 'function' || typeof this.cancelAction !== 'function'
      || typeof this.waitForActionActivation !== 'function' || typeof this.waitForPhysicalIdle !== 'function'
      || typeof this.sessionStatus !== 'function' || typeof this.sendChat !== 'function') {
      throw new TypeError('The physical task supervisor dependencies are invalid');
    }
    this.accepted = 0;
    this.cancelled = 0;
    this.denied = 0;
    this.failures = 0;
    this.narrationFailures = 0;
    this.last = null;
  }

  async #speak(text) {
    try {
      await this.sendChat(text);
      return true;
    } catch {
      this.narrationFailures += 1;
      return false;
    }
  }

  async handle(value) {
    const compiled = compileDeterministicCompanionTask(value?.text);
    if (!compiled) return Object.freeze({ handled: false });
    if (!PHYSICAL_ROLES.has(value?.role) || typeof value?.minecraftUuid !== 'string' || !UUID.test(value.minecraftUuid)) {
      this.denied += 1;
      this.last = { intent: compiled.intent, code: 'PHYSICAL_TASK_NOT_AUTHORIZED' };
      const spoke = await this.#speak("I can chat, but I can't take gameplay commands from this account.");
      return Object.freeze({ handled: true, ok: false, code: 'PHYSICAL_TASK_NOT_AUTHORIZED', spoke });
    }
    try {
      if (compiled.intent === 'cancel-current') {
        const active = this.sessionStatus()?.activeAction ?? null;
        if (!active || typeof active.actionId !== 'string' || TERMINAL_ACTION_STATUSES.has(active.status)) {
          this.last = { intent: compiled.intent, code: 'NO_ACTIVE_PHYSICAL_TASK' };
          const spoke = await this.#speak("I'm not doing anything to stop right now.");
          return Object.freeze({ handled: true, ok: true, code: 'NO_ACTIVE_PHYSICAL_TASK', spoke });
        }
        const cancellation = await this.cancelAction(active.actionId, 'player-request');
        this.cancelled += 1;
        this.last = { intent: compiled.intent, code: 'PHYSICAL_TASK_CANCEL_REQUESTED', actionId: active.actionId };
        const spoke = await this.#speak('Okay, stopping.');
        return Object.freeze({ handled: true, ok: true, code: 'PHYSICAL_TASK_CANCEL_REQUESTED', cancellation, spoke });
      }

      const action = compiled.action.kind === 'skill.followPlayer'
        ? { ...compiled.action, args: { ...compiled.action.args, playerUuid: value.minecraftUuid } }
        : compiled.action;
      if (compiled.replaceCurrent) {
        const active = this.sessionStatus()?.activeAction ?? null;
        if (active && typeof active.actionId === 'string' && !TERMINAL_ACTION_STATUSES.has(active.status)) {
          await this.cancelAction(active.actionId, 'player-replacement-request');
          await this.waitForPhysicalIdle(active.actionId, { timeoutMs: 3_000 });
          this.cancelled += 1;
        }
      }
      const dispatched = await this.dispatchAction(action, { timeoutMs: compiled.timeoutMs });
      await this.waitForActionActivation(dispatched.actionId, { timeoutMs: 3_000, settleMs: 100 });
      this.accepted += 1;
      this.last = { intent: compiled.intent, code: 'PHYSICAL_TASK_DISPATCHED', actionId: dispatched.actionId };
      const spoke = await this.#speak(compiled.acknowledgement);
      return Object.freeze({ handled: true, ok: true, code: 'PHYSICAL_TASK_DISPATCHED', intent: compiled.intent, action: dispatched, spoke });
    } catch (error) {
      this.failures += 1;
      const code = publicFailureCode(error);
      this.last = { intent: compiled.intent, code };
      const reply = code === 'COMPANION_BUSY'
        ? "I'm already doing something. Tell me to stop first if you want me to switch."
        : code === 'CAPABILITY_UNAVAILABLE'
          ? "I can't do that one yet."
          : "I couldn't start that just now.";
      const spoke = await this.#speak(reply);
      return Object.freeze({ handled: true, ok: false, code, spoke });
    }
  }

  status() {
    return Object.freeze({
      accepted: this.accepted,
      cancelled: this.cancelled,
      denied: this.denied,
      failures: this.failures,
      narrationFailures: this.narrationFailures,
      last: this.last ? { ...this.last } : null,
    });
  }
}
