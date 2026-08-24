import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

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

function normalizedContainer(state) {
  if (!state.container) return null;
  const window = state.container.handle;
  return {
    open: true,
    type: state.container.kind,
    blockId: state.container.blockId,
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
    player: position ? {
      position: { x: position.x, y: position.y, z: position.z },
      health: bot.health,
      food: bot.food,
      oxygen: bot.oxygenLevel,
    } : null,
    inventory: { items: aggregateInventory(bot) },
    container: normalizedContainer(state),
  };
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
    await closeContainer(state);
    state.cancelled.add(command.args.actionId);
    return { cancelRequested: true };
  }
  if (command.kind === 'controller.stop') {
    state.stopping = true;
    bot.pathfinder.stop();
    await closeContainer(state);
    bot.quit('Mastermind enhanced controller stopping');
    return { stopping: true };
  }

  const actionId = command.commandId;
  state.activeAction = { actionId, kind: command.kind };
  emit({ type: 'action.status', actionId, kind: command.kind, status: 'started' });
  try {
    let evidence;
    if (command.kind === 'skill.navigateTo') {
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
      'observe.snapshot', 'direct.say', 'skill.navigateTo', 'container.open',
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

main().catch((error) => {
  void emitFinal({ type: 'controller.status', state: 'failed', code: safeCode(error, 'CONTROLLER_START_FAILED') })
    .finally(() => process.exit(1));
});
