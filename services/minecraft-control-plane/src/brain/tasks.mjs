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
  ['plank', 'minecraft:oak_planks'], ['planks', 'minecraft:oak_planks'],
  ['wood plank', 'minecraft:oak_planks'], ['wood planks', 'minecraft:oak_planks'],
  ['cobblestone', 'minecraft:cobblestone'], ['stone', 'minecraft:stone'],
  ['dirt', 'minecraft:dirt'], ['torch', 'minecraft:torch'],
]);

function normalizeRequest(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return null;
  let request = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+([.!?])/gu, '$1')
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

function unavailableTask(intent, acknowledgement) {
  return Object.freeze({
    handled: true,
    intent,
    action: null,
    acknowledgement,
    timeoutMs: null,
    replaceCurrent: false,
    unavailable: true,
  });
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

  if (/^(?:come|come here|come to me)[.!?]*$/u.test(request)) {
    return task('follow-player', { kind: 'skill.followPlayer', args: { playerUuid: null, distance: 3 } },
      "Okay, I'm coming to you.", 30 * 60_000, replaceCurrent);
  }

  if (/^(?:jump|jump once)[.!?]*$/u.test(request)) {
    return task('jump', { kind: 'direct.jump', args: {} }, "Okay.", 15_000, replaceCurrent);
  }

  const relativeMove = request.match(/^(?:move|walk)\s+(?:(\d+)\s+blocks?\s+)?(forward|forwards|back|backward|backwards|left|right)[.!?]*$/u);
  if (relativeMove) {
    const blocks = relativeMove[1] === undefined ? 2 : Number(relativeMove[1]);
    if (!Number.isInteger(blocks) || blocks < 1 || blocks > 12) return null;
    const direction = relativeMove[2];
    const forward = direction.startsWith('back') ? -1 : direction.startsWith('forward') ? 1 : 0;
    const strafe = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    return task('relative-move', {
      kind: 'direct.moveFor',
      args: { forward, strafe, durationMs: Math.min(5_000, blocks * 350), sprint: false, sneak: false },
    }, `Okay, moving ${direction.replace(/s$/u, '')}.`, 15_000, replaceCurrent);
  }

  if (/\b(?:sleep|go to bed|use (?:a|the|that)?\s*bed)\b/u.test(request)) {
    return unavailableTask('sleep-unavailable', "I can see beds now, but I can't reliably walk to one and sleep in it yet.");
  }
  const chickenSmelt = request.match(/^(?:(?:cook|smelt|bake|roast)(?:\s+me)?\s+(?:(\d+)\s+)?(?:some\s+|the\s+|my\s+)?(?:raw\s+)?chicken|put\s+(?:(\d+)\s+)?(?:some\s+|the\s+|my\s+)?(?:raw\s+)?chicken\s+(?:in|into)\s+(?:a|the|one of the)?\s*(?:furnaces?|ovens?|smokers?))(?:\s+.*)?[.!?]*$/u);
  if (chickenSmelt || /\b(?:any|either|nearest|closest|that|the|this|one)\s+furnace\b.*\b(?:will do|works?|is fine|doesn'?t matter)\b/u.test(request)) {
    const requested = chickenSmelt ? Number(chickenSmelt[1] ?? chickenSmelt[2] ?? 0) : 0;
    if (!Number.isInteger(requested) || requested < 0 || requested > 64) return null;
    return task('smelt-chicken', {
      kind: 'skill.smelt',
      args: {
        blockId: 'minecraft:furnace', inputItemId: 'minecraft:chicken', outputItemId: 'minecraft:cooked_chicken',
        fuelItemId: 'minecraft:coal', count: requested === 0 ? null : requested, maxDistance: 16,
      },
    }, "Okay, I'll cook the chicken in the nearest furnace.", 10 * 60_000, replaceCurrent);
  }
  if (/\b(?:cook|smelt|bake|roast)\b/u.test(request)
    || /\b(?:use|load|fill|start)\b.*\b(?:furnace|smoker|blast furnace|campfire)\b/u.test(request)
    || /\b(?:any|either|nearest|closest|that|the|this|one)\s+(?:furnace|smoker)\b.*\b(?:will do|works?|is fine|doesn'?t matter)\b/u.test(request)) {
    return unavailableTask('furnace-management-unavailable',
      "I can cook raw chicken with coal now, but other furnace recipes aren't enabled yet.");
  }
  if (/\b(?:what|which)\b.*\b(?:inside|in|contents?|items?)\b.*\b(?:chest|barrel|container)\b|\b(?:take|move|put|store|deposit)\b.*\b(?:chest|barrel|container)\b/u.test(request)) {
    return unavailableTask('container-management-unavailable', "I can open a nearby container, but I can't inspect or move its contents yet.");
  }
  if (/^(?:close|stop using)\b.*\b(?:chest|crafting table|furnace|container|screen)\b/u.test(request)) {
    return unavailableTask('screen-close-unavailable', "I can't close an open container screen through the bridge yet.");
  }

  const labeledNavigation = request.match(/^(?:go|walk|navigate|come)\s+to\s+(.+)$/u);
  if (labeledNavigation) {
    const entries = [...labeledNavigation[1].matchAll(/\b([xyz])\s*[:=]\s*(-?\d+)\b/gu)];
    const coordinates = new Map(entries.map((entry) => [entry[1], Number(entry[2])]));
    if (entries.length === 3 && coordinates.size === 3) {
      const x = coordinates.get('x');
      const y = coordinates.get('y');
      const z = coordinates.get('z');
      if (y < -64 || y > 320) {
        return task('clarify-coordinates', null,
          `Those coordinates look mixed up: Y is ${y} and Z is ${z}. Send them as x y z.`, 15_000, replaceCurrent);
      }
      if (Math.abs(x) <= 30_000_000 && Math.abs(z) <= 30_000_000) {
        return task('navigate', { kind: 'skill.navigateTo', args: { x, y, z, tolerance: 2 } }, "Okay, I'm on my way.", 10 * 60_000, replaceCurrent);
      }
    }
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


  const placeNearby = request.match(/^place\s+(?:(?:a\s+)?(?:one|single)\s+|a\s+)?(.+?)\s+(?:on\s+(?:the\s+)?(?:ground|floor)(?:\s+anywhere)?|nearby|right here|anywhere)\s*[.!?]*$/u);
  if (placeNearby) {
    const label = placeNearby[1].trim().replace(/\s+/gu, ' ');
    const blockId = PLACEABLE_BLOCK_ALIASES.get(label) ?? (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(label) ? label : null);
    if (!blockId) return null;
    return task('place-nearby-block', { kind: 'direct.placeNearbyBlock', args: { blockId } },
      `Okay, I'll place one ${label} nearby.`, 15_000, replaceCurrent);
  }

  const drop = request.match(/^(?:drop|throw)(?:\s+(?:the|a|one))?(?:\s+(?:item|steak|food|thing|stack))?(?:\s+(?:that(?:'?s| is)\s+)?(?:in|from)\s+(?:your\s+)?(?:hand|hotbar))?(?:\s+(?:on|onto)\s+(?:the\s+)?(?:ground|floor)|\s+(?:right here|right there))?\s*[.!?]*$/u);
  if (drop) {
    const all = /\bstack\b/u.test(request);
    return task('drop-held-item', { kind: 'direct.dropItem', args: { all } },
      all ? "Okay, I'll drop the held stack." : "Okay, I'll drop one held item.", 15_000, replaceCurrent);
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
    this.waitForPhysicalIdle = options.waitForPhysicalIdle ?? (async (actionId, waitOptions = {}) => {
      const deadline = Date.now() + (waitOptions.timeoutMs ?? 15_000);
      while (this.sessionStatus()?.activeAction) {
        if (Date.now() >= deadline) throw Object.assign(new Error('The prior action did not stop in time'), { code: 'ACTION_STOP_TIMEOUT' });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const last = this.sessionStatus()?.lastAction ?? null;
      if (last?.actionId === actionId && last.status !== 'succeeded'
        && !(waitOptions.allowCancelled === true && last.status === 'cancelled')) {
        throw Object.assign(new Error('The prior action did not succeed'), {
          code: 'ACTION_STEP_FAILED',
          actionErrorCode: last.terminal?.error?.code ?? last.terminal?.cancellation?.reason ?? null,
        });
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

  async #waitForVerifiedLook(action, beforeSnapshotId, timeoutMs = 2_000) {
    if (action.kind !== 'direct.lookAt') return;
    const deadline = Date.now() + timeoutMs;
    let observedFreshSnapshot = false;
    while (Date.now() < deadline) {
      const snapshot = this.sessionStatus()?.latestSnapshot ?? null;
      if (snapshot?.snapshotId && snapshot.snapshotId !== beforeSnapshotId) {
        observedFreshSnapshot = true;
        const target = snapshot.awareness?.crosshairTarget ?? null;
        if (target?.kind === 'block' && target.x === action.args.x && target.y === action.args.y && target.z === action.args.z) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Object.assign(new Error('The requested look target was not acquired'), {
      code: observedFreshSnapshot ? 'TARGET_NOT_ACQUIRED' : 'ACTION_OBSERVATION_TIMEOUT',
    });
  }

  #failureReply(code, error) {
    if (code === 'COMPANION_BUSY') return "I'm already doing something. Tell me to stop first if you want me to switch.";
    if (code === 'CAPABILITY_UNAVAILABLE') return "I can't do that one yet.";
    if (code === 'TARGET_NOT_ACQUIRED') return "I turned toward it, but it isn't actually under my crosshair yet.";
    if (code === 'ACTION_OBSERVATION_TIMEOUT') return "I moved, but I couldn't verify what I was looking at.";
    if (code === 'SMELT_INPUT_UNAVAILABLE') return "I don't have enough raw chicken for that.";
    if (code === 'SMELT_FUEL_UNAVAILABLE') return "I don't have enough coal to cook that chicken.";
    if (code === 'ACTION_STEP_FAILED') {
      if (error?.actionErrorCode === 'nothing-used') return "That target didn't accept the interaction, so I didn't claim it worked.";
      if (error?.actionErrorCode === 'target-out-of-reach') return "I can see it, but it's still out of reach.";
      if (error?.actionErrorCode === 'target-mismatch') return "The block or entity there wasn't the requested target, so I stopped.";
      if (error?.actionErrorCode === 'target-obscured') return "That target is nearby, but something is blocking it from me.";
      if (error?.actionErrorCode === 'target-unavailable') return "That target moved or disappeared before I could use it.";
      return "The action failed after it started, so I stopped there.";
    }
    return "I couldn't start that just now.";
  }

  async #preemptActiveForParent(value, reason = 'player-replacement-request') {
    const active = this.sessionStatus()?.activeAction ?? null;
    if (!active || TERMINAL_ACTION_STATUSES.has(active.status)) return;
    if (value?.role !== 'parent') {
      throw Object.assign(new Error('The companion is already busy'), { code: 'COMPANION_BUSY' });
    }
    await this.cancelAction(active.actionId, reason);
    await this.waitForPhysicalIdle(active.actionId, { timeoutMs: 3_000, allowCancelled: true });
    this.cancelled += 1;
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

      if (compiled.unavailable === true) {
        this.last = { intent: compiled.intent, code: 'PHYSICAL_SKILL_UNAVAILABLE' };
        const spoke = await this.#speak(compiled.acknowledgement);
        return Object.freeze({ handled: true, ok: false, code: 'PHYSICAL_SKILL_UNAVAILABLE', spoke });
      }

      if (compiled.action === null) {
        this.last = { intent: compiled.intent, code: 'PHYSICAL_TASK_CLARIFICATION' };
        const spoke = await this.#speak(compiled.acknowledgement);
        return Object.freeze({ handled: true, ok: false, code: 'PHYSICAL_TASK_CLARIFICATION', spoke });
      }

      let action = compiled.action.kind === 'skill.followPlayer'
        ? { ...compiled.action, args: { ...compiled.action.args, playerUuid: value.minecraftUuid } }
        : compiled.action;
      if (action.kind === 'skill.smelt') {
        const items = this.sessionStatus()?.latestSnapshot?.inventory?.items ?? [];
        const availableInput = items.find((item) => item.itemId === action.args.inputItemId)?.count ?? 0;
        const count = action.args.count ?? Math.min(64, availableInput);
        if (!Number.isInteger(count) || count < 1 || availableInput < count) {
          throw Object.assign(new Error('The requested smelting input is unavailable'), { code: 'SMELT_INPUT_UNAVAILABLE' });
        }
        const requiredFuel = Math.max(1, Math.ceil(count / 8));
        const availableFuel = items.find((item) => item.itemId === action.args.fuelItemId)?.count ?? 0;
        if (availableFuel < requiredFuel) {
          throw Object.assign(new Error('The requested smelting fuel is unavailable'), { code: 'SMELT_FUEL_UNAVAILABLE' });
        }
        action = { ...action, args: { ...action.args, count } };
      }
      if (compiled.replaceCurrent) {
        const active = this.sessionStatus()?.activeAction ?? null;
        if (active && typeof active.actionId === 'string' && !TERMINAL_ACTION_STATUSES.has(active.status)) {
          await this.cancelAction(active.actionId, 'player-replacement-request');
          await this.waitForPhysicalIdle(active.actionId, { timeoutMs: 3_000, allowCancelled: true });
          this.cancelled += 1;
        }
      } else if (this.sessionStatus()?.activeAction) {
        await this.#preemptActiveForParent(value);
      }
      const beforeSnapshotId = this.sessionStatus()?.latestSnapshot?.snapshotId ?? null;
      const dispatched = await this.dispatchAction(action, { timeoutMs: compiled.timeoutMs });
      await this.waitForActionActivation(dispatched.actionId, { timeoutMs: 3_000, settleMs: 100 });
      if (action.kind.startsWith('direct.')) {
        await this.waitForPhysicalIdle(dispatched.actionId, { timeoutMs: compiled.timeoutMs });
        await this.#waitForVerifiedLook(action, beforeSnapshotId);
      }
      this.accepted += 1;
      this.last = { intent: compiled.intent, code: 'PHYSICAL_TASK_DISPATCHED', actionId: dispatched.actionId };
      const spoke = await this.#speak(compiled.acknowledgement);
      return Object.freeze({ handled: true, ok: true, code: 'PHYSICAL_TASK_DISPATCHED', intent: compiled.intent, action: dispatched, spoke });
    } catch (error) {
      this.failures += 1;
      const code = publicFailureCode(error);
      this.last = { intent: compiled.intent, code };
      const reply = this.#failureReply(code, error);
      const spoke = await this.#speak(reply);
      return Object.freeze({ handled: true, ok: false, code, spoke });
    }
  }

  async handlePlanned(value, plan) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return Object.freeze({ handled: false });
    if (plan.decision === 'conversation') return Object.freeze({ handled: false });
    if (plan.decision === 'clarify') {
      const spoke = await this.#speak(plan.message);
      this.last = { intent: 'planned-clarification', code: 'PHYSICAL_TASK_CLARIFICATION' };
      return Object.freeze({ handled: true, ok: false, code: 'PHYSICAL_TASK_CLARIFICATION', spoke });
    }
    if (plan.decision === 'cancel') return this.handle({ ...value, text: 'stop' });
    if (plan.decision !== 'action' || !Array.isArray(plan.actions) || plan.actions.length < 1 || plan.actions.length > 3
      || plan.actions.some((action) => !action || typeof action.kind !== 'string')) {
      return Object.freeze({ handled: false });
    }
    if (!PHYSICAL_ROLES.has(value?.role) || typeof value?.minecraftUuid !== 'string' || !UUID.test(value.minecraftUuid)) {
      this.denied += 1;
      this.last = { intent: 'planned-action', code: 'PHYSICAL_TASK_NOT_AUTHORIZED' };
      const spoke = await this.#speak("I can chat, but I can't take gameplay commands from this account.");
      return Object.freeze({ handled: true, ok: false, code: 'PHYSICAL_TASK_NOT_AUTHORIZED', spoke });
    }
    try {
      await this.#preemptActiveForParent(value);
      const dispatchedActions = [];
      for (let index = 0; index < plan.actions.length; index += 1) {
        const action = plan.actions[index];
        const timeoutMs = action.kind === 'skill.followPlayer' ? 30 * 60_000
          : action.kind === 'skill.gatherBlock' ? 15 * 60_000
            : action.kind === 'skill.navigateTo' || action.kind === 'skill.explore' ? 10 * 60_000
              : 15_000;
        const beforeSnapshotId = this.sessionStatus()?.latestSnapshot?.snapshotId ?? null;
        const dispatched = await this.dispatchAction(action, { timeoutMs });
        await this.waitForActionActivation(dispatched.actionId, { timeoutMs: 3_000, settleMs: 100 });
        dispatchedActions.push(dispatched);
        if (index < plan.actions.length - 1 || action.kind.startsWith('direct.')) {
          await this.waitForPhysicalIdle(dispatched.actionId, { timeoutMs });
          await this.#waitForVerifiedLook(action, beforeSnapshotId);
        }
      }
      this.accepted += 1;
      const lastAction = dispatchedActions.at(-1);
      this.last = { intent: 'planned-action', code: 'PHYSICAL_TASK_DISPATCHED', actionId: lastAction.actionId };
      const spoke = await this.#speak(plan.acknowledgement || "Okay, I'm doing that now.");
      return Object.freeze({ handled: true, ok: true, code: 'PHYSICAL_TASK_DISPATCHED', actions: dispatchedActions, spoke });
    } catch (error) {
      this.failures += 1;
      const code = publicFailureCode(error);
      this.last = { intent: 'planned-action', code };
      const spoke = await this.#speak(this.#failureReply(code, error));
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
