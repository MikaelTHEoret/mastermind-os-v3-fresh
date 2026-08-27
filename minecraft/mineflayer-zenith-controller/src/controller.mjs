import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseControllerCommand, parseLaunchEnvelope } from './contracts.mjs';

const { pathfinder, Movements, goals } = pathfinderPackage;
const { GoalNear } = goals;

function emit(value) {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), ...value })}\n`);
}

function emitFinal(value) {
  return new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), ...value })}\n`, resolve);
  });
}

function safeCode(error, fallback = 'CONTROLLER_OPERATION_FAILED') {
  const value = typeof error?.code === 'string' ? error.code : '';
  return /^[A-Z][A-Z0-9_]{2,63}$/u.test(value) ? value : fallback;
}

function customSessionAuth(launch) {
  return (client, options) => {
    const compactUuid = launch.profile.uuid.replaceAll('-', '').toLowerCase();
    const session = {
      accessToken: launch.accessToken,
      selectedProfile: { name: launch.profile.name, id: compactUuid },
      availableProfile: [{ name: launch.profile.name, id: compactUuid }],
    };
    options.haveCredentials = true;
    options.accessToken = launch.accessToken;
    client.session = session;
    client.username = launch.profile.name;
    client.uuid = launch.profile.uuid;
    client.emit('session', session);
    options.connect(client);
  };
}

function aggregateInventory(bot) {
  const counts = new Map();
  for (const item of bot.inventory.items()) {
    const itemId = item.name.includes(':') ? item.name : `minecraft:${item.name}`;
    counts.set(itemId, (counts.get(itemId) ?? 0) + item.count);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, count]) => ({ itemId, count }));
}

function registryId(name, fallback = 'minecraft:unknown') {
  if (typeof name !== 'string') return fallback;
  if (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(name)) return name;
  return /^[a-z0-9_./-]+$/u.test(name) ? `minecraft:${name}` : fallback;
}

function canonicalUuid(value) {
  if (typeof value !== 'string') return null;
  const compact = value.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(compact)) return null;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function degrees(radians, minimum, maximum) {
  if (!Number.isFinite(radians)) return 0;
  const value = radians * 180 / Math.PI;
  return Math.max(minimum, Math.min(maximum, value));
}

function hotbar(bot) {
  const start = Number.isInteger(bot.inventory?.hotbarStart) ? bot.inventory.hotbarStart : 36;
  const result = [];
  for (let slot = 0; slot < 9; slot += 1) {
    const item = bot.inventory?.slots?.[start + slot];
    if (item) result.push({ slot, itemId: registryId(item.name), count: item.count });
  }
  return result;
}

function localAwareness(bot, radius = 8) {
  const center = bot.entity?.position?.floored?.();
  if (!center) return { radius, blocks: [], players: [], entities: [], crosshairTarget: { kind: 'miss' } };
  const byBlock = new Map();
  for (let x = center.x - radius; x <= center.x + radius; x += 1) {
    for (let y = center.y - radius; y <= center.y + radius; y += 1) {
      for (let z = center.z - radius; z <= center.z + radius; z += 1) {
        const dx = x - center.x; const dy = y - center.y; const dz = z - center.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq > radius * radius) continue;
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block || ['air', 'cave_air', 'void_air'].includes(block.name)) continue;
        const blockId = registryId(block.name);
        const current = byBlock.get(blockId);
        if (!current) byBlock.set(blockId, { blockId, x, y, z, distanceSq, count: 1 });
        else {
          current.count += 1;
          if (distanceSq < current.distanceSq) Object.assign(current, { x, y, z, distanceSq });
        }
      }
    }
  }
  const blocks = [...byBlock.values()].sort((left, right) => left.distanceSq - right.distanceSq).slice(0, 64);
  const players = Object.values(bot.players ?? {}).flatMap((player) => {
    const entity = player?.entity;
    const minecraftUuid = canonicalUuid(player?.uuid);
    if (!entity?.position || !minecraftUuid || entity === bot.entity) return [];
    const distanceSq = entity.position.distanceSquared(bot.entity.position);
    if (distanceSq > radius * radius) return [];
    return [{
      minecraftUuid, displayName: String(player.username ?? 'player').slice(0, 64),
      x: entity.position.x, y: entity.position.y, z: entity.position.z, distanceSq,
      visible: true, heldItemId: entity.heldItem ? registryId(entity.heldItem.name) : null,
    }];
  }).sort((left, right) => left.distanceSq - right.distanceSq).slice(0, 16);
  const entities = Object.values(bot.entities ?? {}).flatMap((entity) => {
    const entityUuid = canonicalUuid(entity?.uuid);
    if (!entityUuid || !entity?.position || entity === bot.entity || entity.type === 'player') return [];
    const distanceSq = entity.position.distanceSquared(bot.entity.position);
    if (distanceSq > radius * radius) return [];
    const itemId = entity.getDroppedItem?.()?.name ? registryId(entity.getDroppedItem().name) : null;
    const category = itemId ? 'item' : entity.kind === 'Hostile mobs' ? 'hostile' : entity.kind === 'Passive mobs' ? 'passive' : 'other';
    return [{
      entityUuid, typeId: registryId(entity.name ?? entity.type), displayName: String(entity.displayName ?? entity.name ?? entity.type ?? 'entity').slice(0, 64),
      category, x: entity.position.x, y: entity.position.y, z: entity.position.z, distanceSq,
      visible: true, alive: entity.isValid !== false, itemId,
    }];
  }).sort((left, right) => left.distanceSq - right.distanceSq).slice(0, 32);
  let crosshairTarget = { kind: 'miss' };
  const target = bot.blockAtCursor?.(5);
  if (target) {
    const distanceSq = target.position.distanceSquared(bot.entity.position);
    crosshairTarget = {
      kind: 'block', blockId: registryId(target.name), x: target.position.x, y: target.position.y,
      z: target.position.z, distanceSq,
    };
  }
  return { radius, blocks, players, entities, crosshairTarget };
}

function playerItemCount(bot, itemId, activeContainer = null) {
  const window = activeContainer?.handle;
  if (window && Number.isInteger(window.inventoryStart) && Number.isInteger(window.inventoryEnd)) {
    let count = 0;
    for (let slot = window.inventoryStart; slot < window.inventoryEnd; slot += 1) {
      const item = window.slots[slot];
      if (!item) continue;
      const observedId = item.name.includes(':') ? item.name : `minecraft:${item.name}`;
      if (observedId === itemId) count += item.count;
    }
    return count;
  }
  return aggregateInventory(bot).find((item) => item.itemId === itemId)?.count ?? 0;
}

async function waitForObserved(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value !== null && value !== false) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function itemType(bot, itemId) {
  const key = itemId.startsWith('minecraft:') ? itemId.slice('minecraft:'.length) : itemId;
  const entry = bot.registry.itemsByName[key];
  if (!entry) throw Object.assign(new Error('Unknown item'), { code: 'ITEM_UNAVAILABLE' });
  return entry.id;
}

function normalizedContainer(bot, state) {
  const window = state.container?.handle ?? bot.currentWindow;
  if (!window) return null;
  return {
    open: true, type: state.container?.kind ?? String(window.type ?? 'container').slice(0, 64),
    blockId: state.container?.blockId ?? null,
    slots: window?.slots?.reduce((items, item, slot) => {
      if (item) items.push({ slot, itemId: item.name.includes(':') ? item.name : `minecraft:${item.name}`, count: item.count });
      return items;
    }, []) ?? [],
  };
}

function snapshot(bot, state) {
  const position = bot.entity?.position;
  return {
    phase: state.spawned ? 'in-world' : 'connecting',
    serverAlias: state.spawned ? 'family-server' : null,
    player: position ? {
      position: { x: position.x, y: position.y, z: position.z },
      velocity: { x: bot.entity.velocity?.x ?? 0, y: bot.entity.velocity?.y ?? 0, z: bot.entity.velocity?.z ?? 0 },
      yaw: degrees(bot.entity.yaw, -180, 180), pitch: degrees(bot.entity.pitch, -90, 90),
      health: bot.health, maxHealth: Math.max(20, Number(bot.health) || 20), hunger: bot.food,
      armor: 0, dimension: registryId(bot.game?.dimension ?? 'overworld'),
      air: Math.max(0, Math.min(300, Math.trunc(bot.oxygenLevel ?? 300))),
      inWater: bot.entity.isInWater === true, onFire: bot.entity.onFire === true,
    } : null,
    inventory: { items: aggregateInventory(bot), hotbar: hotbar(bot), selectedSlot: bot.quickBarSlot ?? 0 },
    awareness: state.spawned ? localAwareness(bot) : null,
    container: normalizedContainer(bot, state),
  };
}

function inventoryItem(bot, itemId, hotbarOnly = false) {
  const key = itemId.startsWith('minecraft:') ? itemId.slice('minecraft:'.length) : itemId;
  const start = Number.isInteger(bot.inventory?.hotbarStart) ? bot.inventory.hotbarStart : 36;
  const entries = (bot.inventory?.slots ?? []).map((item, slot) => ({ item, slot })).filter(({ item, slot }) => (
    item?.name === key && (!hotbarOnly || (slot >= start && slot < start + 9))
  ));
  return entries[0] ?? null;
}

function requireReach(bot, position, maximum = 5.5) {
  const distance = bot.entity.position.distanceTo(position.offset(0.5, 0.5, 0.5));
  if (distance > maximum) throw Object.assign(new Error('Target is outside interaction reach'), { code: 'TARGET_OUT_OF_REACH' });
  return distance;
}

async function placeAt(bot, blockId, target) {
  const entry = inventoryItem(bot, blockId);
  if (!entry) throw Object.assign(new Error('Required block item is unavailable'), { code: 'ITEM_UNAVAILABLE' });
  const existing = bot.blockAt(target);
  if (existing && existing.boundingBox !== 'empty' && !['air', 'cave_air', 'void_air'].includes(existing.name)) {
    throw Object.assign(new Error('Placement target is occupied'), { code: 'TARGET_OCCUPIED' });
  }
  const directions = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(-1, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1)];
  let reference = null; let face = null;
  for (const direction of directions) {
    const candidate = bot.blockAt(target.plus(direction));
    if (candidate && candidate.boundingBox !== 'empty' && !['air', 'cave_air', 'void_air'].includes(candidate.name)) {
      reference = candidate; face = direction.scaled(-1); break;
    }
  }
  if (!reference) throw Object.assign(new Error('No supporting block is available'), { code: 'PLACEMENT_SUPPORT_UNAVAILABLE' });
  requireReach(bot, target);
  await bot.equip(entry.item, 'hand');
  await bot.placeBlock(reference, face);
  const observed = await waitForObserved(() => {
    const block = bot.blockAt(target);
    return block && registryId(block.name) === blockId ? block : null;
  });
  if (!observed) throw Object.assign(new Error('Placed block was not observed'), { code: 'PLACEMENT_UNVERIFIED' });
  return { blockId, x: target.x, y: target.y, z: target.z };
}

function resolveBlock(bot, args) {
  const block = bot.blockAt(new Vec3(Math.trunc(args.x), Math.trunc(args.y), Math.trunc(args.z)));
  if (!block) throw Object.assign(new Error('Block is not loaded'), { code: 'TARGET_UNAVAILABLE' });
  const blockId = block.name.includes(':') ? block.name : `minecraft:${block.name}`;
  if (args.expectedBlockId && args.expectedBlockId !== blockId) {
    throw Object.assign(new Error('Unexpected target block'), { code: 'TARGET_MISMATCH' });
  }
  return { block, blockId };
}

async function closeContainer(state) {
  if (!state.container) return;
  try { state.container.handle.close(); } finally { state.container = null; }
}

function rememberOpenedContainer(bot, state, blockId) {
  const handle = bot.currentWindow;
  if (!handle) return false;
  const name = blockId?.split(':').at(-1);
  const kind = ['furnace', 'blast_furnace', 'smoker'].includes(name) ? name : 'storage';
  state.container = { kind, blockId: blockId ?? null, handle };
  handle.once?.('close', () => { if (state.container?.handle === handle) state.container = null; });
  return true;
}

function isContainerBlock(name) {
  return [
    'chest', 'trapped_chest', 'barrel', 'shulker_box', 'furnace', 'blast_furnace', 'smoker',
    'hopper', 'dispenser', 'dropper', 'brewing_stand',
  ].includes(name) || name?.endsWith('_shulker_box');
}

async function openContainer(bot, state, args) {
  await closeContainer(state);
  const { block, blockId } = resolveBlock(bot, args);
  const workstationKind = ['furnace', 'blast_furnace', 'smoker'].includes(block.name) ? block.name : 'storage';
  const handle = workstationKind === 'storage' ? await bot.openContainer(block) : await bot.openFurnace(block);
  state.container = { kind: workstationKind, blockId, handle };
  handle.once('close', () => { if (state.container?.handle === handle) state.container = null; });
  if (bot.currentWindow !== handle || !Array.isArray(handle.slots)) {
    throw Object.assign(new Error('Container did not open'), { code: 'CONTAINER_OPEN_UNVERIFIED' });
  }
}

async function transfer(bot, state, args) {
  const active = state.container;
  if (!active?.handle || bot.currentWindow !== active.handle) {
    throw Object.assign(new Error('No open container'), { code: 'CONTAINER_NOT_OPEN' });
  }
  const type = itemType(bot, args.itemId);
  const before = playerItemCount(bot, args.itemId, active);
  const toContainer = args.direction === 'player-to-container';
  if (active.kind === 'storage') {
    if (args.slotRole !== 'storage') throw Object.assign(new Error('Storage has no workstation slot'), { code: 'SLOT_ROLE_UNAVAILABLE' });
    if (toContainer) await active.handle.deposit(type, null, args.count);
    else await active.handle.withdraw(type, null, args.count);
  } else if (args.slotRole === 'input') {
    if (toContainer) await active.handle.putInput(type, null, args.count);
    else await active.handle.takeInput();
  } else if (args.slotRole === 'fuel') {
    if (toContainer) await active.handle.putFuel(type, null, args.count);
    else await active.handle.takeFuel();
  } else if (args.slotRole === 'output' && !toContainer) {
    const output = active.handle.outputItem();
    if (!output || output.type !== type || output.count < args.count) {
      throw Object.assign(new Error('Requested output is unavailable'), { code: 'ITEM_UNAVAILABLE' });
    }
    await active.handle.takeOutput();
  } else {
    throw Object.assign(new Error('Transfer direction is unavailable'), { code: 'SLOT_ROLE_UNAVAILABLE' });
  }
  const observedDelta = await waitForObserved(() => {
    const after = playerItemCount(bot, args.itemId, active);
    const delta = toContainer ? before - after : after - before;
    return delta >= args.count ? delta : null;
  });
  if (observedDelta === null) throw Object.assign(new Error('Transfer was not observed'), { code: 'TRANSFER_UNVERIFIED' });
  return { observedDelta };
}

async function execute(bot, state, command) {
  const physical = !['observe.snapshot', 'direct.say', 'action.cancel', 'controller.stop'].includes(command.kind);
  if (physical && state.activeAction) throw Object.assign(new Error('A physical action is active'), { code: 'BODY_BUSY' });
  if (command.kind === 'observe.snapshot') return { observation: snapshot(bot, state) };
  if (command.kind === 'direct.say') {
    bot.chat(command.args.text);
    return { spoken: true };
  }
  if (command.kind === 'action.cancel') {
    if (state.activeAction?.actionId !== command.args.actionId) return { alreadyTerminal: true };
    bot.pathfinder.stop();
    bot.clearControlStates?.();
    await closeContainer(state);
    state.cancelled.add(command.args.actionId);
    return { cancelRequested: true };
  }
  if (command.kind === 'controller.stop') {
    state.stopping = true;
    bot.pathfinder.stop();
    bot.clearControlStates?.();
    await closeContainer(state);
    bot.quit('Mastermind enhanced controller stopping');
    return { stopping: true };
  }

  const actionId = command.commandId;
  state.activeAction = { actionId, kind: command.kind };
  emit({ type: 'action.status', actionId, kind: command.kind, status: 'started' });
  try {
    let evidence;
    if (command.kind === 'direct.lookAt') {
      await bot.lookAt(new Vec3(command.args.x, command.args.y, command.args.z), true);
      evidence = { kind: 'look.targeted', x: command.args.x, y: command.args.y, z: command.args.z };
    } else if (command.kind === 'direct.moveFor') {
      const before = bot.entity.position.clone();
      bot.setControlState('forward', command.args.forward > 0);
      bot.setControlState('back', command.args.forward < 0);
      bot.setControlState('left', command.args.strafe < 0);
      bot.setControlState('right', command.args.strafe > 0);
      bot.setControlState('sprint', command.args.sprint);
      bot.setControlState('sneak', command.args.sneak);
      try { await new Promise((resolve) => setTimeout(resolve, command.args.durationMs)); }
      finally { bot.clearControlStates(); }
      evidence = { kind: 'position.delta', observedDistance: before.distanceTo(bot.entity.position) };
    } else if (command.kind === 'direct.jump') {
      const beforeY = bot.entity.position.y;
      bot.setControlState('jump', true);
      await new Promise((resolve) => setTimeout(resolve, 250));
      bot.setControlState('jump', false);
      await new Promise((resolve) => setTimeout(resolve, 150));
      evidence = { kind: 'jump.requested', observedYDelta: bot.entity.position.y - beforeY };
    } else if (command.kind === 'direct.selectSlot') {
      bot.setQuickBarSlot(command.args.slot);
      const selected = await waitForObserved(() => bot.quickBarSlot === command.args.slot ? command.args.slot : null, 1_000);
      if (selected === null) throw Object.assign(new Error('Selected slot was not observed'), { code: 'SLOT_SELECTION_UNVERIFIED' });
      evidence = { kind: 'hotbar.selected', slot: selected };
    } else if (command.kind === 'direct.selectItem') {
      const entry = inventoryItem(bot, command.args.itemId, true);
      if (!entry) throw Object.assign(new Error('Requested hotbar item is unavailable'), { code: 'ITEM_UNAVAILABLE' });
      const start = Number.isInteger(bot.inventory?.hotbarStart) ? bot.inventory.hotbarStart : 36;
      const slot = entry.slot - start;
      bot.setQuickBarSlot(slot);
      const selected = await waitForObserved(() => bot.quickBarSlot === slot ? slot : null, 1_000);
      if (selected === null) throw Object.assign(new Error('Selected item was not observed'), { code: 'ITEM_SELECTION_UNVERIFIED' });
      evidence = { kind: 'item.selected', itemId: command.args.itemId, slot };
    } else if (command.kind === 'direct.use') {
      const target = bot.blockAtCursor?.(5);
      if (target) {
        requireReach(bot, target.position);
        const blockId = registryId(target.name);
        if (isContainerBlock(target.name)) {
          await openContainer(bot, state, { x: target.position.x, y: target.position.y, z: target.position.z, expectedBlockId: blockId });
          evidence = { kind: 'container.open', blockId, containerType: state.container.kind };
        } else {
          await bot.activateBlock(target);
          rememberOpenedContainer(bot, state, blockId);
          evidence = { kind: 'block.interacted', blockId, x: target.position.x, y: target.position.y, z: target.position.z };
        }
      } else {
        bot.activateItem(command.args.hand === 'off');
        evidence = { kind: 'item.used', hand: command.args.hand };
      }
    } else if (command.kind === 'direct.interactBlock') {
      const { block, blockId } = resolveBlock(bot, command.args);
      requireReach(bot, block.position);
      if (isContainerBlock(block.name)) {
        await openContainer(bot, state, { x: block.position.x, y: block.position.y, z: block.position.z, expectedBlockId: blockId });
        evidence = { kind: 'container.open', blockId, containerType: state.container.kind };
      } else {
        await bot.activateBlock(block);
        rememberOpenedContainer(bot, state, blockId);
        evidence = { kind: 'block.interacted', blockId, x: block.position.x, y: block.position.y, z: block.position.z };
      }
    } else if (command.kind === 'direct.placeBlock') {
      evidence = { kind: 'block.placed', ...await placeAt(bot, command.args.blockId, new Vec3(command.args.x, command.args.y, command.args.z)) };
    } else if (command.kind === 'direct.placeNearbyBlock') {
      const origin = bot.entity.position.floored();
      const offsets = [
        new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
        new Vec3(1, 0, 1), new Vec3(-1, 0, 1), new Vec3(1, 0, -1), new Vec3(-1, 0, -1),
      ];
      let target = null;
      for (const offset of offsets) {
        const candidate = origin.plus(offset);
        const at = bot.blockAt(candidate); const below = bot.blockAt(candidate.offset(0, -1, 0));
        if (at?.boundingBox === 'empty' && below?.boundingBox !== 'empty') { target = candidate; break; }
      }
      if (!target) throw Object.assign(new Error('No nearby placement target is available'), { code: 'PLACEMENT_TARGET_UNAVAILABLE' });
      evidence = { kind: 'block.placed', ...await placeAt(bot, command.args.blockId, target) };
    } else if (command.kind === 'direct.dropItem' || command.kind === 'direct.dropItemById') {
      const item = command.kind === 'direct.dropItemById' ? inventoryItem(bot, command.args.itemId)?.item : bot.heldItem;
      if (!item) throw Object.assign(new Error('Requested item is unavailable'), { code: 'ITEM_UNAVAILABLE' });
      const itemId = registryId(item.name); const before = playerItemCount(bot, itemId);
      if (command.args.all) await bot.tossStack(item);
      else await bot.toss(item.type, item.metadata, 1);
      const requested = command.args.all ? before : 1;
      const observedDelta = await waitForObserved(() => {
        const delta = before - playerItemCount(bot, itemId);
        return delta >= requested ? delta : null;
      });
      if (observedDelta === null) throw Object.assign(new Error('Dropped item was not observed'), { code: 'DROP_UNVERIFIED' });
      evidence = { kind: 'inventory.delta', itemId, observedDelta: -observedDelta };
    } else if (command.kind === 'direct.swingHand') {
      bot.swingArm(command.args.hand === 'off' ? 'left' : 'right');
      evidence = { kind: 'hand.swung', hand: command.args.hand };
    } else if (command.kind === 'skill.navigateTo') {
      const movements = new Movements(bot);
      bot.pathfinder.setMovements(movements);
      const goal = new GoalNear(command.args.x, command.args.y, command.args.z, command.args.tolerance);
      await bot.pathfinder.goto(goal);
      const distance = bot.entity.position.distanceTo(new Vec3(command.args.x, command.args.y, command.args.z));
      const observedBlockPosition = bot.entity.position.floored();
      if (!goal.isEnd(observedBlockPosition)) {
        throw Object.assign(new Error('Arrival was not observed'), { code: 'ARRIVAL_UNVERIFIED' });
      }
      evidence = {
        kind: 'position.within', observedDistance: distance, tolerance: command.args.tolerance,
        observedBlockPosition: {
          x: observedBlockPosition.x, y: observedBlockPosition.y, z: observedBlockPosition.z,
        },
      };
    } else if (command.kind === 'container.open') {
      await openContainer(bot, state, command.args);
      evidence = { kind: 'container.open', containerType: state.container.kind, blockId: state.container.blockId };
    } else if (command.kind === 'inventory.transfer') {
      const result = await transfer(bot, state, command.args);
      evidence = { kind: 'inventory.delta', itemId: command.args.itemId, observedDelta: result.observedDelta };
    } else if (command.kind === 'container.close') {
      await closeContainer(state);
      evidence = { kind: 'container.closed' };
    }
    if (state.cancelled.delete(actionId)) {
      emit({ type: 'action.status', actionId, kind: command.kind, status: 'cancelled', code: 'CANCELLED' });
      return { cancelled: true };
    }
    emit({ type: 'action.status', actionId, kind: command.kind, status: 'succeeded', evidence });
    return { evidence };
  } catch (error) {
    const cancelled = state.cancelled.delete(actionId);
    emit({
      type: 'action.status', actionId, kind: command.kind,
      status: cancelled ? 'cancelled' : 'failed', code: cancelled ? 'CANCELLED' : safeCode(error),
    });
    throw error;
  } finally {
    if (state.activeAction?.actionId === actionId) state.activeAction = null;
  }
}

async function main() {
  if (process.argv.length !== 2) throw Object.assign(new Error('Arguments forbidden'), { code: 'COMMAND_LINE_ARGUMENTS_FORBIDDEN' });
  // stdin remains open for commands. Read the first complete line without draining the stream.
  const iterator = process.stdin[Symbol.asyncIterator]();
  let buffered = '';
  let launchLine = null;
  while (launchLine === null) {
    const { value, done } = await iterator.next();
    if (done) throw Object.assign(new Error('Launch envelope missing'), { code: 'INVALID_LAUNCH_ENVELOPE' });
    buffered += value.toString('utf8');
    if (Buffer.byteLength(buffered, 'utf8') > 16 * 1024) throw Object.assign(new Error('Launch envelope too large'), { code: 'INVALID_LAUNCH_ENVELOPE' });
    const newline = buffered.indexOf('\n');
    if (newline >= 0) {
      launchLine = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
    }
  }
  const launch = parseLaunchEnvelope(launchLine);
  const state = { spawned: false, container: null, activeAction: null, cancelled: new Set(), stopping: false };
  const bot = mineflayer.createBot({
    host: launch.host,
    port: launch.port,
    username: launch.profile.name,
    version: launch.protocolVersion,
    auth: customSessionAuth(launch),
    disableChatSigning: true,
    hideErrors: true,
    logErrors: false,
    profilesFolder: false,
  });
  bot.loadPlugin(pathfinder);
  launch.accessToken = null;

  const holdTimer = setTimeout(() => {
    state.stopping = true;
    bot.quit('Mastermind controller hold complete');
  }, launch.holdMillis);
  holdTimer.unref();
  bot.once('login', () => emit({ type: 'controller.status', state: 'authenticated', code: 'LOGIN_ACCEPTED' }));
  bot.once('spawn', () => {
    state.spawned = true;
    emit({ type: 'controller.status', state: 'ready', code: 'PLAY_READY', capabilities: [
      'observe.snapshot', 'direct.say', 'direct.lookAt', 'direct.moveFor', 'direct.jump',
      'direct.selectSlot', 'direct.selectItem', 'direct.use', 'direct.interactBlock',
      'direct.placeBlock', 'direct.placeNearbyBlock', 'direct.dropItem', 'direct.dropItemById',
      'direct.swingHand', 'skill.navigateTo', 'container.open',
      'inventory.transfer', 'container.close', 'action.cancel', 'controller.stop',
    ] });
  });
  bot.on('death', () => { state.spawned = false; emit({ type: 'controller.status', state: 'hold', code: 'PLAYER_DEAD' }); });
  bot.on('respawn', () => { state.spawned = true; emit({ type: 'controller.status', state: 'ready', code: 'RESPAWNED' }); });
  bot.on('kicked', () => emit({ type: 'controller.status', state: 'disconnected', code: 'REMOTE_KICK' }));
  bot.on('error', (error) => emit({ type: 'controller.status', state: 'failed', code: safeCode(error, 'NETWORK_FAILURE') }));

  let queue = Promise.resolve();
  const acceptLine = (line) => {
    let command;
    try {
      command = parseControllerCommand(line);
    } catch (error) {
      emit({ type: 'controller.status', state: 'failed', code: safeCode(error, 'INVALID_CONTROLLER_COMMAND') });
      return;
    }
    const operation = async () => {
      try {
        const result = await execute(bot, state, command);
        if (!command.kind.startsWith('skill.') && !['container.open', 'inventory.transfer', 'container.close'].includes(command.kind)) {
          emit({ type: 'command.result', commandId: command.commandId, kind: command.kind, ok: true, result });
        }
      } catch (error) {
        emit({ type: 'command.result', commandId: command.commandId, kind: command.kind, ok: false, code: safeCode(error) });
      }
    };
    if (['action.cancel', 'controller.stop', 'direct.say', 'observe.snapshot'].includes(command.kind)) {
      void operation().catch((error) => emit({ type: 'controller.status', state: 'failed', code: safeCode(error, 'COMMAND_LOOP_FAILED') }));
    } else {
      queue = queue.then(operation)
        .catch((error) => emit({ type: 'controller.status', state: 'failed', code: safeCode(error, 'COMMAND_LOOP_FAILED') }));
    }
  };
  const drainCompleteCommands = () => {
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line) acceptLine(line);
    }
  };
  drainCompleteCommands();
  (async () => {
    for (;;) {
      const { value, done } = await iterator.next();
      if (done) break;
      buffered += value.toString('utf8');
      if (Buffer.byteLength(buffered, 'utf8') > 16 * 1024) throw Object.assign(new Error('Command too large'), { code: 'INPUT_LIMIT_EXCEEDED' });
      drainCompleteCommands();
    }
    if (buffered.trim()) acceptLine(buffered.trim());
    state.stopping = true;
    bot.pathfinder.stop();
    await closeContainer(state);
    bot.quit('Mastermind controller input closed');
  })().catch((error) => emit({ type: 'controller.status', state: 'failed', code: safeCode(error, 'COMMAND_LOOP_FAILED') }));

  await new Promise((resolve) => bot.once('end', resolve));
  clearTimeout(holdTimer);
  await closeContainer(state);
  await emitFinal({ type: 'controller.status', state: 'stopped', code: state.stopping ? 'CLEAN_STOP' : 'CONNECTION_ENDED' });
  // Mineflayer's physics and plugin timers are not part of the controller contract and can
  // survive a closed protocol session. At this point the socket and container are closed and
  // the final status has drained, so terminate the staging controller without leaking helpers.
  process.exit(0);
}

const invokedDirectly = typeof process.argv[1] === 'string'
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    void emitFinal({ type: 'controller.status', state: 'failed', code: safeCode(error, 'CONTROLLER_START_FAILED') })
      .finally(() => process.exit(1));
  });
}

export const __test = Object.freeze({ registryId, localAwareness, snapshot, placeAt, isContainerBlock });
