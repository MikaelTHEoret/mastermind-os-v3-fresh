import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MinecraftAccountRegistrationStore } from '../services/minecraft-control-plane/src/companion/account-registration.mjs';
import { DpapiMinecraftAccountVault } from '../services/minecraft-control-plane/src/companion/dpapi-vault.mjs';
import { MicrosoftMinecraftAuth } from '../services/minecraft-control-plane/src/companion/microsoft-auth.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTROLLER_ROOT = path.join(REPO_ROOT, 'minecraft', 'mineflayer-zenith-controller');
const CONTROLLER_MAIN = path.join(CONTROLLER_ROOT, 'src', 'controller.mjs');
const COMPANION_UUID = '996a56dd-fb3c-4f90-9158-1a608652ec77';
const PROXY_PORT = 25568;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function canonicalUuid(value) {
  const compact = value.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(compact)) fail('SPIKE_ACCOUNT_MISMATCH');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function command(kind, args) {
  return { schemaVersion: 1, commandId: crypto.randomUUID(), kind, args };
}

function safeOutputLine(line) {
  let value;
  try { value = JSON.parse(line); } catch { fail('SPIKE_CONTROLLER_OUTPUT_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
    || typeof value.type !== 'string' || typeof value.at !== 'string') fail('SPIKE_CONTROLLER_OUTPUT_INVALID');
  const serialized = JSON.stringify(value);
  if (/access.?token|refresh.?token|authorization|bearer/iu.test(serialized)) fail('SPIKE_CONTROLLER_SECRET_OUTPUT');
  return value;
}

async function main() {
  if (process.argv.length !== 2 || process.platform !== 'win32') fail('SPIKE_LAUNCH_FORBIDDEN');
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData !== 'string' || !path.win32.isAbsolute(localAppData)) fail('SPIKE_ROOT_INVALID');
  const controllerStat = await fs.lstat(CONTROLLER_MAIN);
  if (!controllerStat.isFile() || controllerStat.isSymbolicLink()) fail('SPIKE_CONTROLLER_INVALID');

  const familyRoot = path.resolve(localAppData, 'Mastermind', 'minecraft', 'projects', 'family-server');
  const registration = await new MinecraftAccountRegistrationStore(
    path.join(familyRoot, 'private', 'minecraft-account-registration.json'),
  ).load();
  const vault = new DpapiMinecraftAccountVault({
    vaultFile: path.join(familyRoot, 'private', 'minecraft-account.dpapi.json'),
  });
  const auth = new MicrosoftMinecraftAuth({ config: registration, vault });
  await auth.initialize();
  await auth.silentRefresh();
  const session = auth.minecraftSession();
  const profileUuid = canonicalUuid(session.uuid);
  if (session.username !== 'The_AlChemist___' || profileUuid !== COMPANION_UUID || !UUID.test(profileUuid)) {
    fail('SPIKE_ACCOUNT_MISMATCH');
  }

  const child = spawn(process.execPath, [CONTROLLER_MAIN], {
    cwd: CONTROLLER_ROOT,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => (
      ['PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'WINDIR'].includes(key.toUpperCase())
      && typeof value === 'string'
    ))),
  });
  child.stdin.on('error', () => {});
  const launch = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    host: '127.0.0.1',
    port: PROXY_PORT,
    protocolVersion: '1.21.11',
    profile: { name: session.username, uuid: profileUuid },
    accessToken: session.accessToken,
    holdMillis: 120_000,
  })}\n`, 'utf8');
  if (launch.length > 16 * 1024) fail('SPIKE_LAUNCH_ENVELOPE_INVALID');
  child.stdin.write(launch, () => launch.fill(0));

  const scenario = [
    command('observe.snapshot', {}),
    command('skill.navigateTo', { x: 147, y: 63, z: -644, tolerance: 2 }),
    command('container.open', { x: 147, y: 63, z: -644, expectedBlockId: 'minecraft:chest' }),
    command('observe.snapshot', {}),
    command('inventory.transfer', {
      direction: 'player-to-container', slotRole: 'storage', itemId: 'minecraft:coal', count: 1,
    }),
    command('observe.snapshot', {}),
    command('inventory.transfer', {
      direction: 'container-to-player', slotRole: 'storage', itemId: 'minecraft:coal', count: 1,
    }),
    command('observe.snapshot', {}),
    command('container.close', {}),
    command('skill.navigateTo', { x: 142, y: 63, z: -645, tolerance: 2 }),
    command('container.open', { x: 142, y: 63, z: -645, expectedBlockId: 'minecraft:furnace' }),
    command('observe.snapshot', {}),
    command('container.close', {}),
    command('controller.stop', {}),
  ];
  let buffered = '';
  let ready = false;
  let nextCommand = 0;
  let activeActionId = null;
  const observations = [];
  const failures = [];
  const trace = [];
  let successfulTransfers = 0;

  const sendNext = () => {
    if (!ready || activeActionId !== null || nextCommand >= scenario.length || child.stdin.destroyed) return;
    const next = scenario[nextCommand];
    nextCommand += 1;
    if (['skill.navigateTo', 'container.open', 'inventory.transfer', 'container.close'].includes(next.kind)) {
      activeActionId = next.commandId;
    }
    child.stdin.write(`${JSON.stringify(next)}\n`);
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    if (buffered.length > 256 * 1024) {
      child.kill();
      return;
    }
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      let value;
      try { value = safeOutputLine(line); }
      catch { child.kill(); return; }
      if (trace.length < 64 && ['controller.status', 'action.status', 'command.result'].includes(value.type)) {
        trace.push({
          type: value.type,
          ...(typeof value.state === 'string' ? { state: value.state } : {}),
          ...(typeof value.code === 'string' ? { code: value.code } : {}),
          ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
          ...(typeof value.status === 'string' ? { status: value.status } : {}),
          ...(typeof value.ok === 'boolean' ? { ok: value.ok } : {}),
        });
      }
      if (value.type === 'controller.status' && value.state === 'ready') ready = true;
      if (value.type === 'controller.status' && value.state === 'failed') failures.push({ kind: 'controller', code: value.code });
      if (value.type === 'command.result' && value.result?.observation) observations.push(value.result.observation);
      if (value.type === 'action.status' && ['succeeded', 'failed', 'cancelled'].includes(value.status)) {
        if (value.actionId === activeActionId) activeActionId = null;
        if (value.status === 'succeeded' && value.kind === 'inventory.transfer') successfulTransfers += 1;
        if (value.status !== 'succeeded') failures.push({ kind: value.kind, code: value.code ?? 'UNKNOWN' });
      }
      if (value.type === 'command.result' && value.ok === false) failures.push({ kind: value.kind, code: value.code });
      sendNext();
    }
  });

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error('SPIKE_TIMEOUT'), { code: 'SPIKE_TIMEOUT' }));
    }, 150_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  launch.fill(0);
  if (result.signal !== null || result.code !== 0 || !ready || nextCommand !== scenario.length || failures.length > 0) {
    const error = Object.assign(new Error('SPIKE_SCENARIO_FAILED'), { code: 'SPIKE_SCENARIO_FAILED' });
    error.diagnostics = { result, ready, nextCommand, failures, trace };
    throw error;
  }
  const openedChest = observations.some((value) => value.container?.open === true && value.container.blockId === 'minecraft:chest');
  const openedFurnace = observations.some((value) => value.container?.open === true && value.container.blockId === 'minecraft:furnace');
  const observedInventory = observations.some((value) => Array.isArray(value.inventory?.items));
  if (!openedChest || !openedFurnace || !observedInventory || successfulTransfers !== 2) fail('SPIKE_EVIDENCE_INCOMPLETE');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    controller: 'mineflayer-via-zenith',
    protocolVersion: '1.21.11',
    scenario: {
      authenticated: true,
      spawned: true,
      navigationVerified: true,
      chestOpenVerified: openedChest,
      furnaceOpenVerified: openedFurnace,
      inventoryObserved: observedInventory,
      inventoryRoundTripVerified: true,
      cleanStop: true,
    },
  })}\n`);
}

main().catch((error) => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/u.test(error.code)
    ? error.code : 'MINEFLAYER_ZENITH_SPIKE_FAILED';
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code,
    ...(error?.diagnostics ? { diagnostics: error.diagnostics } : {}),
  })}\n`);
  process.exitCode = 1;
});
