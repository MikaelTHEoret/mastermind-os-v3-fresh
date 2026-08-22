const SUPPORTED_MODES = new Set(['disabled', 'stay_alive']);

function idle(reason) {
  return Object.freeze({ kind: 'none', reason, action: null });
}

function validSnapshot(value) {
  return value && typeof value === 'object'
    && value.phase === 'in-world'
    && value.serverAlias === 'family-server'
    && value.player && typeof value.player === 'object'
    && Number.isFinite(value.player.health)
    && Number.isFinite(value.player.maxHealth)
    && value.player.maxHealth > 0
    && Number.isInteger(value.player.hunger)
    && value.player.hunger >= 0
    && value.player.hunger <= 20;
}

export class DeterministicSurvivalController {
  constructor(options = {}) {
    this.mode = options.mode ?? 'disabled';
    this.dispatchAction = options.dispatchAction;
    this.cancelAction = options.cancelAction;
    this.sessionStatus = options.sessionStatus;
    this.now = options.now ?? Date.now;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    if (!SUPPORTED_MODES.has(this.mode) || typeof this.dispatchAction !== 'function' || typeof this.cancelAction !== 'function'
      || typeof this.sessionStatus !== 'function' || typeof this.now !== 'function'
      || !Number.isInteger(this.cooldownMs) || this.cooldownMs < 1_000 || this.cooldownMs > 300_000) {
      throw new TypeError('The deterministic survival controller configuration is invalid');
    }
    this.latest = null;
    this.previous = null;
    this.lastDispatchAt = null;
    this.dispatches = 0;
    this.failures = 0;
    this.preemptions = 0;
    this.ticking = false;
    this.last = null;
  }

  observe(snapshot) {
    if (!validSnapshot(snapshot)) {
      this.previous = this.latest;
      this.latest = null;
      return Object.freeze({ ok: false, code: 'SURVIVAL_OBSERVATION_UNAVAILABLE' });
    }
    this.previous = this.latest;
    this.latest = structuredClone(snapshot);
    return Object.freeze({ ok: true, code: 'SURVIVAL_OBSERVATION_ACCEPTED' });
  }

  selectIntent(snapshot = this.latest) {
    if (!validSnapshot(snapshot)) return idle('observation-unavailable');
    const { health, maxHealth, hunger } = snapshot.player;
    if (health <= 0) {
      return Object.freeze({ kind: 'recovery.respawn', reason: 'dead', action: { kind: 'direct.respawn', args: {} } });
    }
    const recentlyHurt = validSnapshot(this.previous) && this.previous.player.health - health >= 4;
    if (health / maxHealth <= 0.4 || recentlyHurt) {
      return Object.freeze({ kind: 'emergency.escape', reason: recentlyHurt ? 'recent-damage' : 'low-health', action: { kind: 'skill.escapeDanger', args: {} } });
    }
    if (hunger <= 6) {
      return Object.freeze({ kind: 'needs.food', reason: 'low-hunger', action: null });
    }
    return idle('stable');
  }

  async tick() {
    if (this.ticking) return Object.freeze({ ok: true, code: 'SURVIVAL_TICK_IN_PROGRESS' });
    this.ticking = true;
    try {
      return await this.#tick();
    } finally {
      this.ticking = false;
    }
  }

  async #tick() {
    if (this.mode === 'disabled') return Object.freeze({ ok: false, code: 'SURVIVAL_DISABLED' });
    const status = this.sessionStatus();
    if (status?.state !== 'ready' || status.killSwitch === true || !validSnapshot(status.latestSnapshot)) {
      return Object.freeze({ ok: false, code: 'SURVIVAL_NOT_READY' });
    }
    this.observe(status.latestSnapshot);
    const intent = this.selectIntent();
    if (intent.kind === 'none') return Object.freeze({ ok: true, code: 'SURVIVAL_STABLE' });
    if (!intent.action) {
      this.last = { kind: intent.kind, code: 'SURVIVAL_CAPABILITY_UNAVAILABLE' };
      return Object.freeze({ ok: false, code: 'SURVIVAL_CAPABILITY_UNAVAILABLE', intent: intent.kind });
    }
    if (status.activeAction) {
      if (intent.kind !== 'emergency.escape' && intent.kind !== 'recovery.respawn') {
        return Object.freeze({ ok: true, code: 'SURVIVAL_ACTION_DEFERRED' });
      }
      try {
        await this.cancelAction(status.activeAction.actionId, 'survival-emergency');
        this.preemptions += 1;
        this.last = { kind: intent.kind, code: 'SURVIVAL_PREEMPTION_REQUESTED', actionId: status.activeAction.actionId };
        return Object.freeze({ ok: true, code: 'SURVIVAL_PREEMPTION_REQUESTED', intent: intent.kind });
      } catch (error) {
        this.failures += 1;
        const code = typeof error?.code === 'string' ? error.code : 'SURVIVAL_PREEMPTION_FAILED';
        this.last = { kind: intent.kind, code };
        return Object.freeze({ ok: false, code, intent: intent.kind });
      }
    }
    const at = this.now();
    if (this.lastDispatchAt !== null && at - this.lastDispatchAt < this.cooldownMs) {
      return Object.freeze({ ok: true, code: 'SURVIVAL_ACTION_COOLDOWN', intent: intent.kind });
    }
    try {
      const action = await this.dispatchAction(intent.action, {
        timeoutMs: intent.kind === 'recovery.respawn' ? 15_000 : 60_000,
      });
      this.lastDispatchAt = at;
      this.dispatches += 1;
      this.last = { kind: intent.kind, code: 'SURVIVAL_ACTION_DISPATCHED', actionId: action.actionId };
      return Object.freeze({ ok: true, code: 'SURVIVAL_ACTION_DISPATCHED', intent: intent.kind, action });
    } catch (error) {
      this.failures += 1;
      const code = typeof error?.code === 'string' ? error.code : 'SURVIVAL_ACTION_FAILED';
      this.last = { kind: intent.kind, code };
      return Object.freeze({ ok: false, code, intent: intent.kind });
    }
  }

  status() {
    return Object.freeze({
      mode: this.mode,
      hasObservation: this.latest !== null,
      dispatches: this.dispatches,
      preemptions: this.preemptions,
      failures: this.failures,
      last: this.last ? { ...this.last } : null,
    });
  }
}
