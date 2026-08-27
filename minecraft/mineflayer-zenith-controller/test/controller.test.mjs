import assert from 'node:assert/strict';
import test from 'node:test';

import { Vec3 } from 'vec3';

import { __test } from '../src/controller.mjs';

function block(name, position, boundingBox = 'block') {
  return { name, position, boundingBox };
}

function fixture() {
  const changed = new Map();
  changed.set('1,64,0', block('furnace', new Vec3(1, 64, 0)));
  const slots = Array(46).fill(null);
  slots[36] = { name: 'oak_planks', type: 12, metadata: null, count: 3 };
  const bot = {
    entity: {
      position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0,
      isInWater: false, onFire: false,
    },
    health: 18, food: 15, oxygenLevel: 300, quickBarSlot: 0,
    game: { dimension: 'minecraft:overworld' },
    inventory: { hotbarStart: 36, slots, items: () => slots.filter(Boolean) },
    players: {
      Friend: {
        username: 'Friend', uuid: '11111111111141118111111111111111',
        entity: { position: new Vec3(2, 64, 0), heldItem: null },
      },
    },
    entities: {}, currentWindow: null,
    blockAt(position) {
      const key = `${position.x},${position.y},${position.z}`;
      if (changed.has(key)) return changed.get(key);
      return position.y <= 63
        ? block('stone', position.clone())
        : block('air', position.clone(), 'empty');
    },
    blockAtCursor: () => changed.get('1,64,0'),
    async equip() {},
    async placeBlock(reference, face) {
      const target = reference.position.plus(face);
      changed.set(`${target.x},${target.y},${target.z}`, block('oak_planks', target));
    },
  };
  return { bot, changed };
}

test('snapshot exposes bounded game state, inventory, nearby blocks, and players', () => {
  const { bot } = fixture();
  const value = __test.snapshot(bot, { spawned: true, container: null });
  assert.equal(value.serverAlias, 'family-server');
  assert.equal(value.player.maxHealth, 20);
  assert.equal(value.player.hunger, 15);
  assert.deepEqual(value.inventory.hotbar, [{ slot: 0, itemId: 'minecraft:oak_planks', count: 3 }]);
  assert.equal(value.awareness.blocks.some((entry) => entry.blockId === 'minecraft:furnace'), true);
  assert.equal(value.awareness.players[0].displayName, 'Friend');
  assert.equal(value.awareness.crosshairTarget.blockId, 'minecraft:furnace');
});

test('placement requires a held inventory block and verifies the observed world result', async () => {
  const { bot, changed } = fixture();
  const result = await __test.placeAt(bot, 'minecraft:oak_planks', new Vec3(0, 64, 1));
  assert.deepEqual(result, { blockId: 'minecraft:oak_planks', x: 0, y: 64, z: 1 });
  assert.equal(changed.get('0,64,1').name, 'oak_planks');
  await assert.rejects(() => __test.placeAt(bot, 'minecraft:dirt', new Vec3(1, 64, 1)), { code: 'ITEM_UNAVAILABLE' });
});

test('container detection routes storage and furnace blocks through verified window APIs', () => {
  assert.equal(__test.isContainerBlock('furnace'), true);
  assert.equal(__test.isContainerBlock('chest'), true);
  assert.equal(__test.isContainerBlock('red_shulker_box'), true);
  assert.equal(__test.isContainerBlock('oak_door'), false);
});
