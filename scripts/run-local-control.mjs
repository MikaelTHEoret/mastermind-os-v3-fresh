import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { defaultDataRoot } from '../services/minecraft-control-plane/src/config.mjs';
import { requestSupervisorManagedDrain } from './lib/local-control-drain.mjs';
import {
  createLocalControlChildEnvironment,
  createSharedLocalControlEnvironment,
} from './lib/local-control-environment.mjs';
import { acquireLocalControlLifetimeLease } from './lib/local-control-lifetime-lease.mjs';
import { resolveLocalControlPaths } from './lib/local-control-paths.mjs';
import {
  LOCAL_CONTROL_TAKEOVER_TIMEOUT_MS,
  LOCAL_NODE_LINK_STOP_TIMEOUT_MS,
  prepareLocalControlShutdown,
} from './lib/local-control-shutdown.mjs';
import {
  createMinecraftAgentRestarter,
  createMastermindNodeLinkRecoveryController,
  createLocalServiceControlServer,
  createLocalServiceLog,
  createLocalServiceRegistry,
  LOCAL_AGENT_STARTUP_HEALTH_TIMEOUT_MS,
  waitForLocalAgentHealth,
} from './lib/local-service-control.mjs';
import {
  applyFamilyIdentityBootstrapPlan,
  parseFamilyIdentityBootstrapLaunch,
  readFamilyIdentityBootstrapPlanFile,
  waitForFamilyIdentityService,
} from './lib/family-identity-bootstrap.mjs';
import {
  SupervisorStateStore,
  createInitialState,
  identityMatches,
  inspectProcess,
  isTcpPortFree,
  processIdentity,
  stopPreviousSupervisor,
} from './lib/local-control-supervisor.mjs';

const launchStartedAtMs = Date.now();
const {
  workspace,
  launcherEntrypoint,
  agentEntrypoint,
  nextEntrypoint,
  nodeLinkEntrypoint,
} = await resolveLocalControlPaths({ launcherUrl: new URL(import.meta.url) });
const launcherArgs = process.argv.slice(2);
const production = launcherArgs.includes('--production');
const mode = production ? 'production' : 'development';
const familyIdentityBootstrap = parseFamilyIdentityBootstrapLaunch({
  args: launcherArgs,
  environment: process.env,
});
const familyIdentityBootstrapPlan = familyIdentityBootstrap
  ? await readFamilyIdentityBootstrapPlanFile(familyIdentityBootstrap.planFile)
  : null;
const dataRoot = defaultDataRoot(process.env);
const store = new SupervisorStateStore(dataRoot);
await store.initialize();
const launchSupervisorId = crypto.randomBytes(16).toString('hex');

function requestGracefulTakeover(state) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection(state.pipeName);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), LOCAL_CONTROL_TAKEOVER_TIMEOUT_MS);
    let response = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({ action: 'takeover', supervisorId: state.supervisorId })}\n`);
    });
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.length > 1024) return finish(false);
      const newline = response.indexOf('\n');
      if (newline < 0) return;
      try {
        const message = JSON.parse(response.slice(0, newline));
        finish(message?.accepted === true && message.supervisorId === state.supervisorId);
      } catch {
        finish(false);
      }
    });
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

let recordedIncumbent = null;
try {
  recordedIncumbent = await store.read(workspace);
} catch {
  // stopPreviousSupervisor performs the authoritative state-error handling once
  // this process holds the exclusive lifetime lease.
}
const lifetimeLease = await acquireLocalControlLifetimeLease({
  workspace,
  ownerId: launchSupervisorId,
  contenderStartedAtMs: launchStartedAtMs,
  expectedIncumbentOwnerId: recordedIncumbent?.supervisorId ?? null,
  requestIncumbentRelease: recordedIncumbent ? async () => {
    const accepted = await requestGracefulTakeover(recordedIncumbent);
    if (!accepted) throw new Error('The prior supervisor did not confirm an authenticated graceful handoff');
  } : undefined,
});

const takeover = await stopPreviousSupervisor({
  store,
  workspace,
  requestGracefulTakeover: lifetimeLease.replacedOwnerId === null
    ? requestGracefulTakeover
    : async () => false,
});
if (takeover.action !== 'none') console.log(`Local command-center startup: ${takeover.action}.`);

async function captureIdentity(role, entrypoint, pid, port = undefined) {
  const deadline = Date.now() + 12_000;
  let lastInspectionError = null;
  do {
    try {
      const snapshot = await inspectProcess(pid);
      if (snapshot) return { ...processIdentity(role, entrypoint, snapshot), ...(port === undefined ? {} : { port }) };
    } catch (error) {
      lastInspectionError = error;
    }
    if (Date.now() >= deadline) {
      throw Object.assign(new Error(`The ${role} process identity could not be recorded`), {
        cause: lastInspectionError,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (true);
}

const supervisor = await captureIdentity('supervisor', launcherEntrypoint, process.pid);
const pipeSuffix = crypto.randomBytes(16).toString('hex');
const pipeName = process.platform === 'win32'
  ? `\\\\.\\pipe\\mastermind-local-control-${pipeSuffix}`
  : path.join(store.controlRoot, `mastermind-local-control-${pipeSuffix}.sock`);
let state = {
  ...createInitialState({ workspace, mode, supervisor, pipeName }),
  supervisorId: launchSupervisorId,
};

const controlToken = crypto.randomBytes(32).toString('hex');
const sharedEnvironment = createSharedLocalControlEnvironment({
  parentEnvironment: process.env,
  args: launcherArgs,
  controlToken,
  supervisorId: state.supervisorId,
});

const children = new Set();
const activeChildren = new Map();
const intentionalAgentExits = new WeakSet();
const intentionalStartupExits = new WeakSet();
let stateWriteTail = Promise.resolve();
let closing = false;
let exitCode = 0;
let controlServer;
const serviceLog = createLocalServiceLog({
  secrets: [
    controlToken,
    state.supervisorId,
    pipeName,
    workspace,
    workspace.replaceAll('\\', '/'),
    dataRoot,
    String(dataRoot).replaceAll('\\', '/'),
  ],
});
const restartMinecraftControlAgent = createMinecraftAgentRestarter({
  getActive: () => activeChildren.get('minecraft-control-agent') ?? null,
  getLastExit: () => serviceRegistry.snapshot().services
    .find((service) => service.role === 'minecraft-control-agent')?.lastExit ?? null,
  drain: () => requestSupervisorManagedDrain({ token: controlToken, supervisorId: state.supervisorId }),
  markIntentional: ({ child }) => intentionalAgentExits.add(child),
  unmarkIntentional: ({ child }) => intentionalAgentExits.delete(child),
  signal: ({ child }) => child.kill('SIGTERM'),
  waitForExit: waitForOwnedChildExit,
  waitForPortRelease: waitForAgentPortRelease,
  isExactAlive: isExactChildAlive,
  removeAndPersist: removeActiveChildAndPersist,
  recordCleanExit: ({ child }) => boundedExitRecord('clean', child.exitCode, child.signalCode),
  spawn: (generation) => spawnManaged('minecraft-control-agent', agentEntrypoint, [], 43100, generation),
  assertCanContinue: () => {
    if (closing) {
      const active = activeChildren.get('minecraft-control-agent');
      const serviceState = active?.child.exitCode === null && active.child.signalCode === null
        ? 'running'
        : 'failed';
      throw Object.assign(new Error('The local supervisor is shutting down'), { serviceState });
    }
  },
  isActive: ({ child }) => {
    const current = activeChildren.get('minecraft-control-agent');
    return current?.child === child && child.exitCode === null && child.signalCode === null;
  },
});
const serviceRegistry = createLocalServiceRegistry({
  supervisorId: state.supervisorId,
  mode,
  startedAt: state.createdAt,
  restartAgent: restartMinecraftControlAgent,
});
const nodeLinkRecovery = createMastermindNodeLinkRecoveryController({
  isClosing: () => closing,
  isPresent: () => {
    const active = activeChildren.get('mastermind-node-link');
    if (active?.child.exitCode === null && active.child.signalCode === null) return true;
    return [...children].some((child) => child.mastermindRole === 'mastermind-node-link'
      && child.exitCode === null && child.signalCode === null);
  },
  getGeneration: () => serviceRegistry.snapshot().services
    .find((service) => service.role === 'mastermind-node-link')?.generation ?? 1,
  spawn: (generation) => spawnManaged(
    'mastermind-node-link', nodeLinkEntrypoint, [], null, generation,
  ),
  isActive: (record) => {
    const active = activeChildren.get('mastermind-node-link');
    return active?.child === record?.child
      && record.child.exitCode === null && record.child.signalCode === null;
  },
  markRunning: (generation) => serviceRegistry.markRunning('mastermind-node-link', generation),
  reportFailure: (error) => {
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/u.test(error.code)
      ? error.code
      : 'START_FAILED';
    serviceLog.appendSystem(
      'mastermind-node-link',
      `Automatic node-link recovery failed (${code}); a bounded retry remains scheduled.`,
    );
  },
});

async function close(code = 0, { prepared = false } = {}) {
  if (!prepared) {
    if (closing) return;
    closing = true;
    nodeLinkRecovery.suspend();
    exitCode = code;
    try {
      await prepareLocalControlShutdown({
        stopNodeLink: stopNodeLinkBeforeMinecraftDrain,
        drainMinecraft: () => requestSupervisorManagedDrain({
          token: controlToken,
          supervisorId: state.supervisorId,
        }),
        minecraftAgentManaged: activeChildren.has('minecraft-control-agent'),
        alreadyDrained: false,
      });
    } catch (error) {
      const reason = error?.code === 'NODE_LINK_STOP_FAILED'
        ? 'the Mastermind node link could not be stopped exactly before Minecraft drain'
        : 'Minecraft could not be drained safely';
      console.error(`Local-control shutdown was cancelled because ${reason}: ${error?.cause?.message ?? error?.message ?? String(error)}`);
      closing = false;
      nodeLinkRecovery.resume();
      nodeLinkRecovery.ensureRunning({ immediate: true });
      return false;
    }
  } else {
    if (!closing) return false;
    nodeLinkRecovery.suspend();
    exitCode = code;
  }
  controlServer?.close();
  const shutdownOrder = [...children].sort((left, right) => (
    left.mastermindRole === 'minecraft-control-agent' ? -1 : right.mastermindRole === 'minecraft-control-agent' ? 1 : 0
  ));
  for (const child of shutdownOrder) {
    if (child.exitCode === null && child.signalCode === null) {
      if (child.mastermindRole === 'minecraft-control-agent') intentionalAgentExits.add(child);
      child.kill('SIGTERM');
    }
  }
  await Promise.race([
    Promise.all([...children].map((child) => child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve)))),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  await stateWriteTail.catch(() => undefined);
  await store.removeIfOwned(state.supervisorId, workspace);
  if (process.platform !== 'win32') await fs.rm(pipeName, { force: true });
  process.exit(exitCode);
}

lifetimeLease.onLost((error) => {
  console.error(error.message);
  void close(1);
});

// Keep safe-drain handlers installed when a shutdown is deliberately cancelled.
// A second Ctrl+C/SIGTERM must retry the same guarded path, never fall through
// to Node's default immediate termination while a family server may be live.
process.on('SIGINT', () => void close(0));
process.on('SIGTERM', () => void close(0));
process.once('uncaughtException', (error) => {
  console.error(error);
  void close(1);
});
process.once('unhandledRejection', (error) => {
  console.error(error);
  void close(1);
});

controlServer = createLocalServiceControlServer({
  supervisorId: state.supervisorId,
  token: controlToken,
  registry: serviceRegistry,
  logs: serviceLog,
  handleTakeover: async () => {
    if (closing) return false;
    closing = true;
    nodeLinkRecovery.suspend();
    try {
      await prepareLocalControlShutdown({
        stopNodeLink: stopNodeLinkBeforeMinecraftDrain,
        drainMinecraft: () => requestSupervisorManagedDrain({
          token: controlToken,
          supervisorId: state.supervisorId,
        }),
        minecraftAgentManaged: activeChildren.has('minecraft-control-agent'),
        alreadyDrained: false,
      });
    } catch (error) {
      const reason = error?.code === 'NODE_LINK_STOP_FAILED'
        ? 'node-link stop failed before Minecraft drain'
        : 'Minecraft drain failed after the node link stopped';
      console.error(`Supervisor takeover was cancelled because ${reason}: ${error?.cause?.message ?? error?.message ?? String(error)}`);
      closing = false;
      nodeLinkRecovery.resume();
      nodeLinkRecovery.ensureRunning({ immediate: true });
      return false;
    }
    return {
      accepted: true,
      afterResponse: () => setTimeout(() => void close(0, { prepared: true }), 25),
    };
  },
  onFatal: (error) => {
    console.error(`Local service-control channel failed: ${error.message}`);
    void close(1);
  },
});
await new Promise((resolve, reject) => {
  controlServer.once('error', reject);
  controlServer.listen(pipeName, resolve);
});
await store.write(state, workspace);

function boundedExitRecord(kind, code, signal) {
  return {
    at: new Date().toISOString(),
    kind,
    code: Number.isSafeInteger(code) && code >= 0 ? code : null,
    signal: typeof signal === 'string' && /^[A-Z][A-Z0-9]{0,31}$/.test(signal) ? signal : null,
  };
}

async function persistActiveChildren() {
  const childrenSnapshot = [...activeChildren.values()].map(({ identity }) => identity);
  const write = stateWriteTail.catch(() => undefined).then(async () => {
    state = { ...state, children: childrenSnapshot };
    await store.write(state, workspace);
  });
  stateWriteTail = write;
  await write;
}

async function isExactChildAlive(record) {
  const observed = await inspectProcess(record.identity.pid);
  return Boolean(observed && identityMatches(record.identity, observed));
}

async function assertExactActiveChild(record) {
  const deadline = Date.now() + 4_000;
  do {
    if (activeChildren.get(record.identity.role)?.child !== record.child
      || record.child.exitCode !== null || record.child.signalCode !== null) {
      throw new Error(`The exact ${record.identity.role} process exited before readiness publication`);
    }
    try {
      if (await isExactChildAlive(record)) return;
      throw new Error(`The exact ${record.identity.role} process exited before readiness publication`);
    } catch (error) {
      if (error?.message?.startsWith('The exact ')) throw error;
      if (Date.now() >= deadline) {
        throw Object.assign(new Error(`The exact ${record.identity.role} process identity could not be verified before readiness publication`), {
          cause: error,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } while (true);
}

async function removeActiveChildAndPersist(record) {
  if (activeChildren.get(record.identity.role)?.child === record.child) {
    activeChildren.delete(record.identity.role);
  }
  await persistActiveChildren();
}

async function stopNodeLinkBeforeMinecraftDrain() {
  const role = 'mastermind-node-link';
  const record = activeChildren.get(role) ?? null;
  if (!record) {
    const starting = [...children].some((child) => child.mastermindRole === role
      && child.exitCode === null && child.signalCode === null);
    if (starting) throw new Error('The Mastermind node link is still establishing exact ownership.');
    await persistActiveChildren();
    return;
  }

  const { child } = record;
  if (child.exitCode === null && child.signalCode === null) {
    if (!(await isExactChildAlive(record))) {
      throw new Error('The recorded Mastermind node-link process no longer has its exact owned identity.');
    }
    if (!child.kill('SIGTERM')) {
      throw new Error('The exact Mastermind node-link process did not accept its stop signal.');
    }
  }
  await waitForOwnedChildExit(record);
  const lastExit = boundedExitRecord('clean', child.exitCode, child.signalCode);
  await removeActiveChildAndPersist(record);
  serviceRegistry.markFailed(role, lastExit);
  serviceLog.appendSystem(role, 'Stopped before Minecraft safe drain; no new remote lease can begin.');
}

async function waitForOwnedChildExit(record, timeoutMs = LOCAL_NODE_LINK_STOP_TIMEOUT_MS) {
  const { child, identity } = record;
  const label = identity.role === 'minecraft-control-agent'
    ? 'Minecraft control agent after its safe drain'
    : identity.role === 'mastermind-node-link'
      ? 'Mastermind node link before Minecraft drain'
      : `${identity.role} managed child`;
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`The exact ${label} did not exit`)),
        timeoutMs,
      )),
    ]);
  }
  const observed = await inspectProcess(identity.pid);
  if (observed && identityMatches(identity, observed)) {
    throw new Error(`The exact ${label} remained alive`);
  }
}

async function waitForAgentPortRelease(timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await isTcpPortFree(43100)) return;
    if (Date.now() >= deadline) throw new Error('The Minecraft control port remains occupied after the exact agent exited');
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
}

async function spawnManaged(role, entrypoint, args, port, generation = 1) {
  if (closing) throw new Error(`The ${role} process cannot start while the supervisor is shutting down`);
  const child = spawn(process.execPath, [entrypoint, ...args], {
    cwd: workspace,
    env: createLocalControlChildEnvironment({ sharedEnvironment, role, pipeName }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Give managed children their own hidden console/process group so Ctrl+C
    // is handled by this supervisor first. Shutdown stops the node link,
    // confirms Minecraft drain, and only then signals the remaining handles.
    detached: process.platform === 'win32',
  });
  child.mastermindRole = role;
  children.add(child);
  child.stdout.on('data', (chunk) => serviceLog.write(role, 'stdout', chunk));
  child.stderr.on('data', (chunk) => serviceLog.write(role, 'stderr', chunk));
  child.on('error', (error) => {
    serviceLog.appendSystem(role, `Managed process error: ${error?.message ?? 'unknown error'}`);
    if (role === 'next-web' && !closing) void close(1);
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    serviceLog.flush(role, 'stdout');
    serviceLog.flush(role, 'stderr');
    const active = activeChildren.get(role);
    const wasActive = active?.child === child;
    if (wasActive) activeChildren.delete(role);
    if (intentionalStartupExits.has(child)) return;
    if (role === 'minecraft-control-agent') {
      if (!closing && !intentionalAgentExits.has(child)) {
        const lastExit = boundedExitRecord('unexpected', code, signal);
        serviceRegistry.markFailed(role, lastExit);
        serviceLog.appendSystem(role, `Exited unexpectedly (${signal ?? code ?? 'unknown'}); Next and the supervisor remain online.`);
        void persistActiveChildren().catch((error) => {
          serviceLog.appendSystem('supervisor', `Could not persist failed agent status: ${error?.message ?? 'unknown error'}`);
        });
      }
      return;
    }
    if (role === 'mastermind-node-link') {
      if (!closing && wasActive) {
        const lastExit = boundedExitRecord('unexpected', code, signal);
        serviceRegistry.markFailed(role, lastExit);
        serviceLog.appendSystem(role, `Exited unexpectedly (${signal ?? code ?? 'unknown'}); the dashboard and Minecraft backend remain online.`);
        nodeLinkRecovery.noteExit(active);
        void persistActiveChildren().catch((error) => {
          serviceLog.appendSystem('supervisor', `Could not persist failed node-link status: ${error?.message ?? 'unknown error'}`);
        });
      }
      return;
    }
    if (!closing) {
      serviceRegistry.markFailed(role, boundedExitRecord('unexpected', code, signal));
      console.error(`${role} exited unexpectedly (${signal ?? code ?? 'unknown'}).`);
      void close(code ?? 1);
    }
  });
  const spawnFailure = new Promise((_, reject) => child.once('error', reject));
  let record = null;
  try {
    const identity = await Promise.race([captureIdentity(role, entrypoint, child.pid, port), spawnFailure]);
    if (closing || child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${role} stopped during startup`);
    }
    record = { child, identity, generation };
    activeChildren.set(role, record);
    await persistActiveChildren();
    await assertExactActiveChild(record);
    if (role === 'minecraft-control-agent') {
      await waitForLocalAgentHealth({
        assertOwned: () => assertExactActiveChild(record),
        timeoutMs: LOCAL_AGENT_STARTUP_HEALTH_TIMEOUT_MS,
      });
    }
    await assertExactActiveChild(record);
    return record;
  } catch (error) {
    if (record && activeChildren.get(role)?.child === child) {
      let exactAlive = false;
      try { exactAlive = await isExactChildAlive(record); } catch {}
      if (exactAlive) {
        let safeToSignal = role !== 'minecraft-control-agent';
        if (role === 'minecraft-control-agent') {
          try {
            await requestSupervisorManagedDrain({ token: controlToken, supervisorId: state.supervisorId });
            safeToSignal = true;
          } catch {
            serviceLog.appendSystem(
              role,
              'The failed startup process remains exactly owned because it could not confirm a safe server drain.',
            );
          }
        }
        if (safeToSignal) {
          intentionalStartupExits.add(child);
          if (role === 'minecraft-control-agent') intentionalAgentExits.add(child);
          const signalled = child.kill('SIGTERM');
          if (signalled) {
            try { await waitForOwnedChildExit(record, 5_000); } catch {
              if (role === 'minecraft-control-agent') intentionalAgentExits.delete(child);
            }
          } else if (role === 'minecraft-control-agent') {
            intentionalAgentExits.delete(child);
          }
        }
      }
      let stillExact = false;
      try { stillExact = await isExactChildAlive(record); } catch {}
      if (!stillExact) {
        activeChildren.delete(role);
        try { await persistActiveChildren(); } catch (persistError) {
          throw Object.assign(error, { cause: persistError });
        }
      }
    }
    throw error;
  }
}

try {
  let initialAgentFailure = null;
  try {
    await spawnManaged('minecraft-control-agent', agentEntrypoint, [], 43100);
    serviceRegistry.markRunning('minecraft-control-agent', 1);
  } catch (error) {
    initialAgentFailure = error;
    const existing = serviceRegistry.snapshot().services
      .find((service) => service.role === 'minecraft-control-agent');
    if (existing?.lastExit === null) {
      serviceRegistry.markFailed('minecraft-control-agent', boundedExitRecord('unexpected', null, null));
    }
    serviceLog.appendSystem(
      'minecraft-control-agent',
      `Initial backend startup failed; the dashboard remains available for recovery (${error?.code ?? 'START_FAILED'}).`,
    );
  }
  await spawnManaged('next-web', nextEntrypoint, [production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', '3000'], 3000);
  serviceRegistry.markRunning('next-web', 1);
  try {
    await spawnManaged('mastermind-node-link', nodeLinkEntrypoint, [], null);
    serviceRegistry.markRunning('mastermind-node-link', 1);
  } catch (error) {
    const existing = serviceRegistry.snapshot().services
      .find((service) => service.role === 'mastermind-node-link');
    if (existing?.lastExit === null) {
      serviceRegistry.markFailed('mastermind-node-link', boundedExitRecord('unexpected', null, null));
    }
    serviceLog.appendSystem(
      'mastermind-node-link',
      `Initial node-link startup failed; local Minecraft and the dashboard remain available (${error?.code ?? 'START_FAILED'}).`,
    );
    nodeLinkRecovery.noteExit();
  }
  if (familyIdentityBootstrap && familyIdentityBootstrapPlan) {
    if (initialAgentFailure) throw new Error('Family identity bootstrap cannot continue while the local backend is unavailable');
    await waitForFamilyIdentityService();
    const result = await applyFamilyIdentityBootstrapPlan(familyIdentityBootstrapPlan, { token: controlToken });
    console.log(`Family identity bootstrap completed. Service player UUID: ${result.servicePlayerId}`);
    console.log(`The unchanged retry plan remains at ${familyIdentityBootstrap.planFile}`);
    console.log('Restart local control with that UUID in MASTERMIND_MEMORY_PLAYER_ID and --memory-event-sync when you are ready to enable capture.');
    await close(0);
  }
  if (initialAgentFailure) {
    console.log('Mastermind dashboard owns http://127.0.0.1:3000; the Minecraft backend is offline and available for bounded recovery from Services.');
  } else {
    console.log('Mastermind local command center owns http://127.0.0.1:3000 and the private 127.0.0.1:43100 control plane.');
  }
} catch (error) {
  console.error(error.message);
  await close(1);
}
