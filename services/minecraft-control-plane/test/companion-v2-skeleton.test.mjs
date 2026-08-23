import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILY_BRIDGE_CAPABILITIES } from '../src/companion/protocol.mjs';
import {
  FAMILY_BRIDGE_V2_ACTIONS,
  FAMILY_BRIDGE_V2_OBSERVATIONS,
  companionV2SkeletonManifest,
  executeCompanionV2Action,
  validateCompanionV2Observation,
} from '../src/companion/v2-contract.mjs';

test('v2 skeleton lists all required observations and actions without advertising them', () => {
  assert.ok(FAMILY_BRIDGE_V2_OBSERVATIONS.includes('inventory.snapshot'));
  assert.ok(FAMILY_BRIDGE_V2_OBSERVATIONS.includes('homeZones.metadata'));
  assert.ok(FAMILY_BRIDGE_V2_ACTIONS.includes('inventory.move'));
  assert.ok(FAMILY_BRIDGE_V2_ACTIONS.includes('skill.buildBounded'));
  const manifest = companionV2SkeletonManifest(FAMILY_BRIDGE_CAPABILITIES);
  assert.deepEqual(manifest.supportedVersions, [1]);
  assert.equal(manifest.negotiatedVersion, 1);
  assert.equal(manifest.advertisedCapabilities.some((item) => FAMILY_BRIDGE_V2_ACTIONS.includes(item)), false);
});

test('v2 observations are bounded and v2 actions return an honest unavailable result', () => {
  const observation = validateCompanionV2Observation({
    kind: 'damage.recent',
    observedAt: '2026-08-21T12:00:00.000Z',
    data: { amount: 2, source: 'minecraft:zombie' },
  });
  assert.equal(observation.kind, 'damage.recent');
  const result = executeCompanionV2Action({ kind: 'inventory.move', arguments: { from: 1, to: 2 } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FEATURE_NOT_IMPLEMENTED');
});
