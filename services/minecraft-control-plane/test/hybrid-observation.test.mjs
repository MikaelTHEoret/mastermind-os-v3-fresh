import assert from 'node:assert/strict';
import test from 'node:test';

import { createFamilyCoreMessage } from '../src/family-core/index.mjs';
import {
  HybridObservationError,
  HybridObservationReconciler,
  validateZenithBodyObservation,
} from '../src/companion/hybrid-observation.mjs';

const IDS = Object.freeze({
  companion: '11111111-1111-4111-8111-111111111111',
  envelopeSession: '22222222-2222-4222-8222-222222222222',
  serverObservation: '33333333-3333-4333-8333-333333333333',
  bodyObservation: '44444444-4444-4444-8444-444444444444',
  controller: '55555555-5555-4555-8555-555555555555',
  message: '66666666-6666-4666-8666-666666666666',
});

function serverTelemetry({ tick = 100, observedAt = '2026-08-21T12:00:00.000Z', companionUuid = IDS.companion } = {}) {
  return createFamilyCoreMessage({
    sessionId: IDS.envelopeSession,
    seq: tick,
    source: 'family-core',
    type: 'companion.telemetry',
    messageId: IDS.message,
    sentAt: observedAt,
    payload: {
      companionUuid,
      observationSessionId: IDS.serverObservation,
      serverTick: tick,
      observedAt,
      dimension: 'minecraft:overworld',
      position: { x: 10, y: 64, z: 20, yaw: 90, pitch: 0, onGround: true },
      vitals: { health: 18, maxHealth: 20, hunger: 16, air: 300, onFire: false, alive: true },
      nearbyThreats: [],
      homeZone: { zoneId: 'family-home', inside: true },
    },
  });
}

function zenithObservation(overrides = {}) {
  return {
    companionUuid: IDS.companion,
    bodySessionId: IDS.bodyObservation,
    seq: 1,
    observedAt: '2026-08-21T12:00:00.250Z',
    driver: 'MASTERMIND_CONTROLLER',
    upstreamConnected: true,
    controllerSocketPresent: true,
    controllerUuid: IDS.controller,
    botTicksActive: false,
    baritone: { state: 'idle', goalId: null },
    action: { actionId: null, state: 'none' },
    ...overrides,
  };
}

test('reconciles authoritative server facts with Zenith execution state', () => {
  const reconciler = new HybridObservationReconciler();
  reconciler.acceptServer(serverTelemetry());
  reconciler.acceptZenith(zenithObservation());
  const result = reconciler.reconcile(new Date('2026-08-21T12:00:01.000Z'));
  assert.equal(result.authoritative.vitals.health, 18);
  assert.equal(result.execution.driver, 'MASTERMIND_CONTROLLER');
  assert.equal(result.physicalActionsAllowed, true);
  assert.equal(result.manualTakeoverActive, false);
});

test('parent takeover remains observable but denies enhanced physical actions', () => {
  const reconciler = new HybridObservationReconciler();
  reconciler.acceptServer(serverTelemetry());
  reconciler.acceptZenith(zenithObservation({ driver: 'HUMAN_PARENT' }));
  const result = reconciler.reconcile(new Date('2026-08-21T12:00:01.000Z'));
  assert.equal(result.manualTakeoverActive, true);
  assert.equal(result.physicalActionsAllowed, false);
});

test('rejects concurrent native ticks and a controlling session', () => {
  assert.throws(
    () => validateZenithBodyObservation(zenithObservation({ botTicksActive: true })),
    (error) => error instanceof HybridObservationError && error.code === 'CONCURRENT_INPUT',
  );
});

test('represents a recovery hold without granting either automated driver', () => {
  const reconciler = new HybridObservationReconciler();
  reconciler.acceptServer(serverTelemetry());
  reconciler.acceptZenith(zenithObservation({
    driver: 'RECOVERY_HOLD',
    controllerSocketPresent: true,
    controllerUuid: null,
  }));
  const result = reconciler.reconcile(new Date('2026-08-21T12:00:01.000Z'));
  assert.equal(result.execution.driver, 'RECOVERY_HOLD');
  assert.equal(result.physicalActionsAllowed, false);
  assert.equal(result.manualTakeoverActive, false);
});

test('rejects stale, skewed, mismatched, and replayed observations', () => {
  const stale = new HybridObservationReconciler();
  stale.acceptServer(serverTelemetry());
  stale.acceptZenith(zenithObservation());
  assert.throws(
    () => stale.reconcile(new Date('2026-08-21T12:00:10.000Z')),
    (error) => error instanceof HybridObservationError && error.code === 'OBSERVATION_STALE',
  );

  const skewed = new HybridObservationReconciler();
  skewed.acceptServer(serverTelemetry());
  skewed.acceptZenith(zenithObservation({ observedAt: '2026-08-21T12:00:02.000Z' }));
  assert.throws(
    () => skewed.reconcile(new Date('2026-08-21T12:00:02.000Z')),
    (error) => error instanceof HybridObservationError && error.code === 'SOURCE_SKEW',
  );

  const mismatched = new HybridObservationReconciler();
  mismatched.acceptServer(serverTelemetry());
  mismatched.acceptZenith(zenithObservation({ companionUuid: '77777777-7777-4777-8777-777777777777' }));
  assert.throws(
    () => mismatched.reconcile(new Date('2026-08-21T12:00:01.000Z')),
    (error) => error instanceof HybridObservationError && error.code === 'IDENTITY_MISMATCH',
  );

  const replay = new HybridObservationReconciler();
  replay.acceptZenith(zenithObservation());
  assert.throws(
    () => replay.acceptZenith(zenithObservation()),
    (error) => error instanceof HybridObservationError && error.code === 'REPLAY_OR_REORDER',
  );
});

test('a new observation session may restart its sequence', () => {
  const reconciler = new HybridObservationReconciler();
  reconciler.acceptZenith(zenithObservation({ seq: 10 }));
  const next = reconciler.acceptZenith(zenithObservation({ bodySessionId: '88888888-8888-4888-8888-888888888888', seq: 1 }));
  assert.equal(next.seq, 1);
});
