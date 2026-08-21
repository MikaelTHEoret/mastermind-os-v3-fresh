import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';
import path from 'node:path';
import { verifyFamilyServerInstall } from './artifact-integrity.mjs';
import {
  createManagedProcessIdentity,
  inspectManagedProcessState,
  managedProcessIdentityMatches,
  processMatchesExpectedSpawn,
  sanitizedTcpOwner,
} from './process-identity.mjs';
import { compileServerAdminCommand } from './server-admin.mjs';

const CHILD_ENVIRONMENT_KEYS = new Set([
  'APPDATA',
  'COMSPEC',
  'HOME',
  'JAVA_HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOCALAPPDATA',
  'PATH',
  'PATHEXT',
  'PROGRAMDATA',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USERPROFILE',
  'WINDIR',
]);

function managedChildEnvironment(source = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(source)) {
    const canonicalKey = key.toUpperCase();
    if (CHILD_ENVIRONMENT_KEYS.has(canonicalKey) && typeof value === 'string') {
      environment[canonicalKey] = value;
    }
  }
  return environment;
}

function validPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function validPid(value) {
  return Number.isInteger(value) && value > 0 && value <= 0xffffffff;
}

const PERSISTED_ACTIVE_STATES = new Set(['starting', 'running', 'stopping']);
const DEFAULT_PORT_RELEASE_POLL_MS = 100;
const LEGACY_ADOPTION_START_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_STDIN_TIMEOUT_MS = 5_000;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function launchGeneration(identity) {
  if (!identity || typeof identity !== 'object') return null;
  return crypto.createHash('sha256').update(canonicalJson(identity), 'utf8').digest('hex');
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function preferredJavaExecutable(instance, fallback) {
  if (typeof instance.javaExecutable === 'string' && instance.javaExecutable.trim()) return instance.javaExecutable;
  if (typeof fallback === 'string' && fallback.trim()) return fallback;
  throw new Error('Instance is not ready: no validated Java executable is configured');
}

function normalizeLaunchCapability(value, instance) {
  if (!value || typeof value !== 'object' || !value.command || !value.lease) return null;
  const command = value.command;
  if (typeof command.executable !== 'string' || !path.isAbsolute(command.executable)
    || command.executable !== instance.javaExecutable || command.cwd !== instance.directory
    || !Array.isArray(command.args) || command.args.length < 1 || command.args.length > 512
    || command.args.some((argument) => typeof argument !== 'string' || argument.includes('\0') || argument.length > 30_000)
    || typeof value.lease.assertHeld !== 'function' || typeof value.lease.release !== 'function') {
    throw new Error('Install verifier returned an invalid launch capability');
  }
  return { command: { executable: command.executable, args: [...command.args], cwd: command.cwd }, lease: value.lease };
}

async function releaseLaunchLease(lease) {
  if (!lease) return;
  await lease.release();
}

function trustedJcmdExecutable(instance) {
  if (typeof instance?.javaExecutable !== 'string' || !path.isAbsolute(instance.javaExecutable)) return null;
  return path.join(path.dirname(instance.javaExecutable), process.platform === 'win32' ? 'jcmd.exe' : 'jcmd');
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function managedPortOwnerError(label, port, owner, reason = 'is not the exact persisted Mastermind process') {
  const safeOwner = sanitizedTcpOwner(owner);
  const description = safeOwner?.processName
    ? `${safeOwner.processName}${safeOwner.pid ? ` (PID ${safeOwner.pid})` : ''}`
    : safeOwner?.pid ? `PID ${safeOwner.pid}` : 'an unidentified process';
  return Object.assign(
    new Error(`${label} port ${port} is occupied by ${description}; it ${reason}, so nothing was terminated`),
    {
      code: label === 'Bedrock UDP' ? 'BEDROCK_PORT_OWNER_UNVERIFIED' : 'JAVA_PORT_OWNER_UNVERIFIED',
      statusCode: 409,
      ...(safeOwner ? { owner: safeOwner } : {}),
    },
  );
}

function portOwnerError(port, owner, reason) {
  return managedPortOwnerError('Java server', port, owner, reason);
}

function bedrockOwnerError(port, owner, reason) {
  return managedPortOwnerError('Bedrock UDP', port, owner, reason);
}

function safeStopRequiredError(instance, owner) {
  const safeOwner = sanitizedTcpOwner(owner) ?? (validPid(instance?.pid) ? { pid: instance.pid } : null);
  const description = safeOwner?.processName
    ? `${safeOwner.processName}${safeOwner.pid ? ` (PID ${safeOwner.pid})` : ''}`
    : safeOwner?.pid ? `PID ${safeOwner.pid}` : 'the verified managed process';
  return Object.assign(
    new Error(
      `${description} is a verified Mastermind Java process, but this agent does not own its authenticated Minecraft stdin control channel. `
      + 'A safe stop is required; no PID termination was attempted. Stop it through the agent or supervisor that launched it, or a separately configured authenticated Minecraft control channel.',
    ),
    {
      code: 'SAFE_STOP_REQUIRED',
      statusCode: 409,
      ...(safeOwner ? { owner: safeOwner } : {}),
    },
  );
}

async function tcpPortAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => {
      try { probe.close(); } catch { /* The server may not have reached the listening state. */ }
      resolve(false);
    });
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
  });
}

export async function isTcpPortOccupied(port) {
  if (!validPort(port)) return false;
  return !await tcpPortAvailable(port);
}

async function udpPortAvailable(port) {
  return new Promise((resolve) => {
    const probe = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    probe.unref();
    probe.once('error', () => {
      try { probe.close(); } catch { /* The socket may not have reached the bound state. */ }
      resolve(false);
    });
    probe.bind(port, '0.0.0.0', () => probe.close(() => resolve(true)));
  });
}

function lines(stream, handler) {
  let pending = '';
  stream?.setEncoding('utf8');
  stream?.on('data', (chunk) => {
    pending += chunk;
    const parts = pending.split(/\r?\n/);
    pending = parts.pop() ?? '';
    for (const line of parts) if (line) handler(line);
  });
  stream?.on('end', () => { if (pending) handler(pending); });
}

export class ProcessManager {
  constructor(store, logStore, javaExecutable, commandFactory, hooks = {}) {
    this.store = store;
    this.logStore = logStore;
    this.javaExecutable = javaExecutable;
    this.commandFactory = commandFactory ?? ((instance, executable) => ({
      executable,
      args: [`-Xms${Math.min(1024, instance.memoryMb)}M`, `-Xmx${instance.memoryMb}M`, '-jar', 'fabric-server-launch.jar', 'nogui'],
    }));
    this.onReady = typeof hooks.onReady === 'function' ? hooks.onReady : async () => {};
    this.usesDefaultInstallVerifier = typeof hooks.verifyInstall !== 'function';
    const defaultInstallVerifier = hooks.defaultInstallVerifier ?? verifyFamilyServerInstall;
    if (typeof defaultInstallVerifier !== 'function') throw new TypeError('defaultInstallVerifier must be a function');
    this.verifyInstall = this.usesDefaultInstallVerifier ? defaultInstallVerifier : hooks.verifyInstall;
    this.launchModBindingProvider = hooks.launchModBindingProvider ?? null;
    if (this.launchModBindingProvider !== null && typeof this.launchModBindingProvider !== 'function') {
      throw new TypeError('launchModBindingProvider must be a function');
    }
    this.inspectProcessState = typeof hooks.inspectProcessState === 'function' ? hooks.inspectProcessState : inspectManagedProcessState;
    this.portReleasePollMs = Number.isInteger(hooks.portReleasePollMs) && hooks.portReleasePollMs >= 5
      ? hooks.portReleasePollMs
      : DEFAULT_PORT_RELEASE_POLL_MS;
    this.adminStdinTimeoutMs = Number.isInteger(hooks.adminStdinTimeoutMs) && hooks.adminStdinTimeoutMs >= 5
      ? hooks.adminStdinTimeoutMs
      : ADMIN_STDIN_TIMEOUT_MS;
    this.now = typeof hooks.now === 'function' ? hooks.now : () => new Date().toISOString();
    this.readinessStabilityMs = Number.isInteger(hooks.readinessStabilityMs) && hooks.readinessStabilityMs >= 0
      ? hooks.readinessStabilityMs
      : 5_000;
    this.children = new Map();
    this.instanceLocks = new Map();
    this.draining = false;
  }

  async start(id) {
    return this.withInstanceLock(id, () => this.#start(id), { priority: 'lifecycle' });
  }

  setLaunchModBindingProvider(provider) {
    if (typeof provider !== 'function') throw new TypeError('launchModBindingProvider must be a function');
    if (this.launchModBindingProvider && this.launchModBindingProvider !== provider) {
      throw new Error('The launch mod binding provider is already configured');
    }
    this.launchModBindingProvider = provider;
    return true;
  }

  async startWithinInstanceLock(id) {
    return this.#start(id);
  }

  ownsActiveChild(id, pid) {
    const entry = this.children.get(id);
    return Number.isInteger(pid) && pid > 0
      && entry?.child?.pid === pid
      && entry.child.exitCode === null
      && entry.child.signalCode === null;
  }

  async #start(id) {
    this.#assertNotDraining();
    let instance = await this.store.get(id);
    if (!instance) throw new Error(`Instance '${id}' was not found`);
    if (instance.projectId !== 'family-server' || instance.kind !== 'server' || instance.provisioningStatus !== 'ready') {
      throw new Error('Instance is not an isolated ready family server');
    }
    if (this.children.has(id)) {
      await this.#stop(id);
      instance = await this.store.get(id);
    }
    if (!validPort(instance.javaPort)) {
      throw new Error('Instance is not ready: javaPort must be an integer between 1 and 65535');
    }
    if (!validPort(instance.bedrockPort)) {
      throw new Error('Instance is not ready: bedrockPort must be an integer between 1 and 65535');
    }
    const javaPort = instance.javaPort;
    await this.#reconcileBeforeStart(instance);
    if (!await tcpPortAvailable(javaPort)) {
      const state = await this.#inspect(instance);
      throw portOwnerError(javaPort, state?.tcp?.owner);
    }
    if (!await udpPortAvailable(instance.bedrockPort)) {
      throw new Error(`Bedrock UDP port ${instance.bedrockPort} is already in use`);
    }
    let modLaunchBinding = null;
    let verification;
    try {
      if (this.usesDefaultInstallVerifier) {
        if (typeof this.launchModBindingProvider !== 'function') {
          throw Object.assign(new Error('The authenticated mod launch binding provider is unavailable'), {
            code: 'LAUNCH_TRUST_UNAVAILABLE', statusCode: 503,
          });
        }
        modLaunchBinding = await this.launchModBindingProvider(instance.id);
        verification = await this.verifyInstall(instance, {
          requireLaunchCapability: true,
          modLaunchBinding,
        });
      } else verification = await this.verifyInstall(instance);
    } catch (error) {
      await modLaunchBinding?.release?.().catch(() => undefined);
      throw error;
    }
    let capability;
    try { capability = normalizeLaunchCapability(verification, instance); }
    catch (error) {
      await releaseLaunchLease(verification?.lease).catch(() => undefined);
      await modLaunchBinding?.release?.().catch(() => undefined);
      throw error;
    }
    if (!capability && verification?.lease) {
      await releaseLaunchLease(verification.lease).catch(() => undefined);
      await modLaunchBinding?.release?.().catch(() => undefined);
      throw new Error('Install verifier returned an incomplete launch capability');
    }
    if (this.usesDefaultInstallVerifier && !capability) {
      await releaseLaunchLease(verification?.lease).catch(() => undefined);
      await modLaunchBinding?.release?.().catch(() => undefined);
      throw new Error('Complete launch verification did not return a one-shot capability');
    }

    const javaExecutable = capability ? null : preferredJavaExecutable(instance, this.javaExecutable);
    const lease = capability?.lease ?? null;
    let command;
    let child;
    try {
      this.#assertNotDraining();
      command = capability?.command ?? this.commandFactory(instance, javaExecutable);
      await this.store.update(id, { status: 'starting', lastError: null, pid: null, managedProcess: null });
      this.#assertNotDraining();
      await lease?.assertHeld();
      child = spawn(command.executable, command.args, {
        cwd: command.cwd ?? instance.directory,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // Minecraft must not receive the command-center console's Ctrl+C. The
        // agent owns its stdin and always requests a clean `stop` first.
        detached: process.platform === 'win32',
        env: managedChildEnvironment(),
      });
    } catch (error) {
      await releaseLaunchLease(lease).catch(() => undefined);
      await this.store.update(id, {
        status: 'failed', pid: null, managedProcess: null, lastError: error.message,
      }).catch(() => undefined);
      throw error;
    }
    const spawnResult = new Promise((resolve) => {
      child.once('spawn', () => resolve({ ok: true }));
      child.once('error', (error) => resolve({ ok: false, error }));
    });
    let finishExit;
    const handledExit = new Promise((resolve) => { finishExit = resolve; });
    const readiness = { java: false, geyser: false, reported: false };
    this.children.set(id, { child, handledExit, readiness, lease });
    lines(child.stdout, (line) => {
      this.logStore.append(id, 'stdout', line).catch(() => undefined);
      this.#observeReadiness(id, line, readiness);
    });
    lines(child.stderr, (line) => this.logStore.append(id, 'stderr', line).catch(() => undefined));

    child.once('exit', async (code, signal) => {
      this.children.delete(id);
      try {
        await this.logStore.append(id, 'system', `Process exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`);
        await this.store.update(id, {
          status: code === 0 || signal === 'SIGTERM' ? 'stopped' : 'failed',
          pid: null,
          managedProcess: null,
          lastError: code === 0 || signal === 'SIGTERM' ? null : `Process exited with code ${code ?? 'unknown'}`,
        });
      } finally {
        await releaseLaunchLease(lease).catch((error) => this.logStore.append(id, 'system', `Launch lease release failed: ${error.message}`).catch(() => undefined));
        finishExit();
      }
    });

    if (Number.isInteger(child.pid) && child.pid > 0) {
      // Persist the OS identity while the server is still starting so a manager
      // restart can reconcile it even before Minecraft has bound its TCP port.
      await this.store.update(id, { status: 'starting', pid: child.pid, managedProcess: null });
    }

    const started = await spawnResult;
    if (!started.ok) {
      this.children.delete(id);
      await releaseLaunchLease(lease).catch(() => undefined);
      await this.store.update(id, { status: 'failed', pid: null, managedProcess: null, lastError: started.error.message });
      throw started.error;
    }
    if (child.exitCode !== null) {
      await handledExit;
      return this.store.get(id);
    }
    let managedProcess;
    try {
      managedProcess = await this.#captureSpawnedIdentity(instance, command, child.pid);
    } catch (error) {
      await this.logStore.append(id, 'system', `Spawn identity verification failed; stopping the owned child: ${error.message}`);
      try {
        await this.#stop(id, 5_000);
      } catch (stopError) {
        await this.store.update(id, {
          status: 'running',
          pid: child.pid ?? null,
          managedProcess: null,
          lastError: `Spawn identity verification failed and the authenticated graceful stop did not complete: ${stopError.message}`,
        });
        throw Object.assign(
          new Error(`Spawn identity verification failed; the owned process was left running because no PID termination fallback is permitted: ${error.message}`),
          { code: 'SPAWN_IDENTITY_UNVERIFIED_PROCESS_RUNNING', statusCode: 409, cause: error },
        );
      }
      await this.store.update(id, { status: 'failed', pid: null, managedProcess: null, lastError: error.message });
      throw error;
    }
    await this.store.update(id, { status: 'running', pid: child.pid ?? null, managedProcess });
    const entry = this.children.get(id);
    if (entry?.child === child) entry.launchGeneration = launchGeneration(managedProcess);
    await this.logStore.append(id, 'system', `Spawned process ${child.pid ?? 'unknown'}; Minecraft and Geyser readiness have not yet been verified`);
    return this.store.get(id);
  }

  async stop(id, timeoutMs = 15_000) {
    return this.withInstanceLock(id, () => this.#stop(id, timeoutMs), { priority: 'lifecycle' });
  }

  async stopWithinInstanceLock(id, timeoutMs = 15_000) {
    return this.#stop(id, timeoutMs);
  }

  async inspectTypedAdminAvailabilityWithinInstanceLock(id) {
    const instance = await this.store.get(id);
    if (!instance || instance.projectId !== 'family-server' || instance.kind !== 'server') {
      return { running: false, reason: 'process-unavailable', launchGeneration: null };
    }
    if (instance.status !== 'running') {
      return { running: false, reason: 'instance-not-running', launchGeneration: null };
    }
    const entry = this.children.get(id);
    const generation = launchGeneration(instance.managedProcess);
    const exactChild = Boolean(
      generation
      && entry?.launchGeneration === generation
      && entry?.child?.pid === instance.pid
      && entry.child.exitCode === null
      && entry.child.signalCode === null
      && entry.readiness?.java === true
      && entry.child.stdin
      && entry.child.stdin.destroyed !== true
      && entry.child.stdin.writable === true
    );
    return exactChild
      ? { running: true, reason: 'ready', launchGeneration: generation }
      : { running: true, reason: 'process-unavailable', launchGeneration: null };
  }

  async executeTypedAdminActionWithinInstanceLock(id, input) {
    const { action, command } = compileServerAdminCommand(input);
    const availability = await this.inspectTypedAdminAvailabilityWithinInstanceLock(id);
    if (availability.reason !== 'ready') {
      throw Object.assign(new Error('The exact ready agent-owned Family Server control channel is unavailable.'), {
        code: availability.reason === 'instance-not-running' ? 'ADMIN_SERVER_NOT_RUNNING' : 'ADMIN_PROCESS_UNAVAILABLE',
        statusCode: 409,
      });
    }
    const instance = await this.store.get(id);
    const entry = this.children.get(id);
    const child = entry?.child;
    const stdin = child?.stdin;
    const persistedGeneration = launchGeneration(instance?.managedProcess);
    if (
      !instance || instance.projectId !== 'family-server' || instance.kind !== 'server' || instance.status !== 'running'
      || instance.pid !== child?.pid || persistedGeneration !== availability.launchGeneration
      || entry?.launchGeneration !== availability.launchGeneration
      || child.exitCode !== null || child.signalCode !== null || entry.readiness?.java !== true
      || !stdin || stdin.destroyed || !stdin.writable
    ) {
      throw Object.assign(new Error('The exact ready agent-owned Family Server control channel is unavailable.'), {
        code: 'ADMIN_PROCESS_UNAVAILABLE', statusCode: 409,
      });
    }
    let invoked = false;
    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          stdin.off('error', onError);
          error ? reject(error) : resolve();
        };
        const onError = (error) => finish(error ?? new Error('stdin error'));
        const timer = setTimeout(() => finish(new Error('stdin callback timeout')), this.adminStdinTimeoutMs);
        timer.unref?.();
        stdin.once('error', onError);
        invoked = true;
        stdin.write(`${command}\n`, (error) => finish(error));
      });
    } catch (error) {
      throw Object.assign(new Error('The administration command delivery outcome is unknown; do not retry automatically.'), {
        code: invoked ? 'ADMIN_COMPLETION_UNKNOWN' : 'ADMIN_PROCESS_UNAVAILABLE',
        statusCode: 409,
        cause: error,
      });
    }
    return { requestId: action.requestId, acceptedAt: this.now(), launchGeneration: availability.launchGeneration };
  }

  async assertQuiescent(id) {
    return this.withInstanceLock(id, () => this.assertQuiescentWithinInstanceLock(id));
  }

  /**
   * Admission boundary for filesystem transactions such as backup and restore.
   * The caller must already hold this instance's lifecycle lock.  A persisted
   * "stopped" label is not sufficient: both protocol ports, every recorded
   * process identity, and the manager-owned child table must agree.
   */
  async assertQuiescentWithinInstanceLock(id) {
    const instance = await this.store.get(id);
    if (!instance) throw Object.assign(new Error(`Instance '${id}' was not found`), { code: 'INSTANCE_NOT_FOUND', statusCode: 404 });
    if (instance.projectId !== 'family-server' || instance.kind !== 'server') {
      throw backupQuiescenceError('Only an isolated Family Server can enter a backup transaction');
    }
    if (instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess != null || this.children.has(id)) {
      throw backupQuiescenceError('The Family Server must be fully stopped before backup or restore');
    }
    if (!validPort(instance.javaPort) || !validPort(instance.bedrockPort)) {
      throw backupQuiescenceError('The Family Server has an invalid managed port inventory');
    }
    const [javaAvailable, bedrockAvailable] = await Promise.all([
      tcpPortAvailable(instance.javaPort),
      udpPortAvailable(instance.bedrockPort),
    ]);
    if (!javaAvailable || !bedrockAvailable) {
      const state = await this.#inspect(instance);
      const owner = !javaAvailable ? sanitizedTcpOwner(state?.tcp?.owner) : sanitizedTcpOwner(state?.udp?.owner);
      const error = backupQuiescenceError(
        !javaAvailable
          ? `Java TCP port ${instance.javaPort} is still occupied; backup or restore was deferred`
          : `Bedrock UDP port ${instance.bedrockPort} is still occupied; backup or restore was deferred`,
      );
      if (owner) error.owner = owner;
      throw error;
    }
    return instance;
  }

  async #stop(id, timeoutMs = 15_000) {
    const instance = await this.store.get(id);
    if (!instance) throw new Error(`Instance '${id}' was not found`);
    const entry = this.children.get(id);
    if (!entry) {
      if (await this.isActive(id)) {
        throw new Error('Instance appears to be active but is not owned by this manager; stop the process externally before changing its state');
      }
      if (instance.status !== 'stopped' || instance.pid !== null) {
        await this.store.update(id, { status: 'stopped', pid: null, managedProcess: null });
      }
      return this.store.get(id);
    }
    const { child, handledExit } = entry;
    await this.store.update(id, { status: 'stopping' });
    await this.logStore.append(id, 'system', 'Graceful stop requested');
    const deadline = Date.now() + (Number.isInteger(timeoutMs) && timeoutMs >= 100 ? timeoutMs : 15_000);
    if (!await this.#writeOwnedMinecraftStop(child)) {
      if (child.exitCode !== null) {
        await handledExit;
      } else {
        const error = Object.assign(new Error('The agent-owned Minecraft stdin control channel is unavailable; no PID termination was attempted'), {
          code: 'SAFE_STOP_REQUIRED', statusCode: 409,
        });
        await this.store.update(id, { status: 'running', lastError: error.message });
        throw error;
      }
    } else if (await this.#waitForExit(handledExit, Math.max(0, deadline - Date.now())) === 'timeout' && child.exitCode === null) {
      const error = Object.assign(new Error('Minecraft did not complete its authenticated graceful stop before the timeout; it was left running because no PID termination fallback is permitted'), {
        code: 'MANAGED_GRACEFUL_STOP_TIMEOUT', statusCode: 409,
      });
      await this.logStore.append(id, 'system', error.message);
      await this.store.update(id, { status: 'running', lastError: error.message });
      throw error;
    }
    await this.#waitForPortRelease(instance, deadline);
    return this.store.get(id);
  }

  async #writeOwnedMinecraftStop(child) {
    const stdin = child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return false;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        stdin.off('error', onError);
        resolve(value);
      };
      const onError = () => finish(false);
      stdin.once('error', onError);
      try {
        stdin.write('stop\n', (error) => finish(!error));
      } catch {
        finish(false);
      }
    });
  }

  async #waitForExit(handledExit, timeoutMs) {
    if (timeoutMs <= 0) return 'timeout';
    let timer;
    try {
      return await Promise.race([
        handledExit.then(() => 'exited'),
        new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs, 'timeout'); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #waitForPortRelease(instance, deadline) {
    do {
      const [javaAvailable, bedrockAvailable] = await Promise.all([
        tcpPortAvailable(instance.javaPort),
        udpPortAvailable(instance.bedrockPort),
      ]);
      if (javaAvailable && bedrockAvailable) return;
      if (Date.now() >= deadline) {
        const error = Object.assign(
          new Error(`Minecraft exited but Java TCP ${instance.javaPort} and/or Bedrock UDP ${instance.bedrockPort} did not become available before the timeout; no new server was started`),
          { code: 'MANAGED_PORT_RELEASE_TIMEOUT', statusCode: 409 },
        );
        await this.logStore.append(instance.id, 'system', error.message);
        throw error;
      }
      await delay(Math.min(this.portReleasePollMs, Math.max(1, deadline - Date.now())));
    } while (true);
  }

  async shutdown(timeoutMs = 30_000) {
    const safeTimeoutMs = Number.isInteger(timeoutMs) && timeoutMs >= 30_000 ? timeoutMs : 30_000;
    this.draining = true;
    try {
      const instances = await this.store.list();
      const ids = [...new Set([
        ...instances
          .filter((instance) => instance?.projectId === 'family-server' && instance?.kind === 'server')
          .map((instance) => instance.id),
        ...this.children.keys(),
      ])];
      const failures = (await Promise.all(ids.map(async (id) => {
        try {
          await this.withInstanceLock(id, () => this.#stop(id, safeTimeoutMs), { priority: 'lifecycle' });
          return null;
        } catch (error) {
          return error;
        }
      }))).filter(Boolean);
      if (failures.length) throw new AggregateError(failures, 'One or more Minecraft servers did not complete a safe graceful shutdown');
    } catch (error) {
      this.draining = false;
      throw error;
    }
  }

  #assertNotDraining() {
    if (!this.draining) return;
    throw Object.assign(new Error('The local control plane is draining for supervisor handoff and will not start Minecraft'), {
      code: 'CONTROL_PLANE_DRAINING', statusCode: 503,
    });
  }

  async isActive(id) {
    if (this.children.has(id)) return true;
    const instance = await this.store.get(id);
    if (!instance) return false;
    if (isProcessAlive(instance.pid)) return true;
    return isTcpPortOccupied(instance.javaPort);
  }

  async #inspect(instance) {
    const identityPid = instance?.managedProcess?.pid;
    const pid = validPid(identityPid) ? identityPid : (validPid(instance?.pid) ? instance.pid : null);
    try {
      return await this.inspectProcessState({
        pid,
        port: validPort(instance?.javaPort) ? instance.javaPort : null,
        udpPort: validPort(instance?.bedrockPort) ? instance.bedrockPort : null,
        jcmdExecutable: trustedJcmdExecutable(instance),
      });
    } catch {
      return null;
    }
  }

  #isExactManagedProcess(instance, state) {
    const identity = instance?.managedProcess;
    return Boolean(
      identity && identity.instanceId === instance.id && identity.pid === instance.pid
      && managedProcessIdentityMatches(identity, state?.process),
    );
  }

  async #reconcileBeforeStart(instance) {
    const state = await this.#inspect(instance);
    const portOccupied = !await tcpPortAvailable(instance.javaPort);
    const bedrockOccupied = !await udpPortAvailable(instance.bedrockPort);
    let exactManagedProcess = this.#isExactManagedProcess(instance, state);
    if (!exactManagedProcess && portOccupied && bedrockOccupied) {
      const adopted = await this.#adoptPreIdentityProcess(instance, state);
      if (adopted) exactManagedProcess = true;
    }
    const owner = sanitizedTcpOwner(state?.tcp?.owner);
    const bedrockOwner = sanitizedTcpOwner(state?.udp?.owner);

    if (portOccupied) {
      if (!exactManagedProcess || owner?.pid !== instance.managedProcess.pid) {
        throw portOwnerError(instance.javaPort, owner);
      }
    }

    if (bedrockOccupied && (!exactManagedProcess || bedrockOwner?.pid !== instance.managedProcess.pid)) {
      throw bedrockOwnerError(instance.bedrockPort, bedrockOwner);
    }

    if (exactManagedProcess) {
      throw safeStopRequiredError(instance, owner ?? bedrockOwner ?? state?.process);
    }

    const recordedPidStillAlive = isProcessAlive(instance.pid);
    if (recordedPidStillAlive && PERSISTED_ACTIVE_STATES.has(instance.status)) {
      const processOwner = state?.process
        ? { pid: state.process.pid, processName: state.process.processName }
        : { pid: instance.pid };
      throw portOwnerError(instance.javaPort, processOwner, 'has an unverified persisted process identity');
    }

    if (instance.pid !== null || instance.managedProcess) {
      await this.store.update(instance.id, {
        status: 'stopped',
        pid: null,
        managedProcess: null,
        lastError: 'Discarded stale process identity after confirming that the Java port was free.',
      });
    }
  }

  async #captureSpawnedIdentity(instance, command, pid) {
    if (!validPid(pid)) throw new Error('Spawned process did not expose a valid PID');
    const deadline = Date.now() + 5_000;
    let state = null;
    do {
      try {
        state = await this.inspectProcessState({
          pid,
          port: instance.javaPort,
          udpPort: instance.bedrockPort,
          jcmdExecutable: trustedJcmdExecutable(instance),
        });
      }
      catch { state = null; }
      if (state?.process) break;
      await delay(50);
    } while (Date.now() < deadline);
    return createManagedProcessIdentity(state?.process, {
      instanceId: instance.id,
      executable: command.executable,
      args: command.args,
      cwd: instance.directory,
      capturedAt: this.now(),
    });
  }

  async #adoptPreIdentityProcess(instance, state) {
    if (
      instance.managedProcess !== undefined && instance.managedProcess !== null
      || !PERSISTED_ACTIVE_STATES.has(instance.status) || !validPid(instance.pid)
      || state?.process?.pid !== instance.pid
      || state?.tcp?.owner?.pid !== instance.pid
      || state?.udp?.owner?.pid !== instance.pid
    ) return null;
    const processCreatedAt = Date.parse(state.process.creationTime);
    const inventoryUpdatedAt = Date.parse(instance.updatedAt);
    const startToInventoryDelay = inventoryUpdatedAt - processCreatedAt;
    if (
      !Number.isFinite(processCreatedAt) || !Number.isFinite(inventoryUpdatedAt)
      || startToInventoryDelay < -5_000 || startToInventoryDelay > LEGACY_ADOPTION_START_WINDOW_MS
    ) return null;
    let executable;
    let command;
    try {
      executable = preferredJavaExecutable(instance, this.javaExecutable);
      command = this.commandFactory(instance, executable);
    } catch {
      return null;
    }
    if (!processMatchesExpectedSpawn(state.process, {
      executable: command.executable,
      args: command.args,
      cwd: instance.directory,
    })) return null;
    const identity = createManagedProcessIdentity(state.process, {
      instanceId: instance.id,
      executable: command.executable,
      args: command.args,
      cwd: instance.directory,
      capturedAt: this.now(),
    });
    await this.store.update(instance.id, { managedProcess: identity, pid: identity.pid, status: 'running' });
    instance.managedProcess = identity;
    instance.pid = identity.pid;
    instance.status = 'running';
    await this.logStore.append(instance.id, 'system', `Adopted exact pre-identity Mastermind Java process ${identity.pid} without interrupting it`);
    return identity;
  }

  async reconcilePersistedState() {
    const results = [];
    for (const instance of await this.store.list()) {
      if (!PERSISTED_ACTIVE_STATES.has(instance.status)) continue;
      const pidAlive = isProcessAlive(instance.pid);
      const portOccupied = await isTcpPortOccupied(instance.javaPort);
      const bedrockOccupied = !await udpPortAvailable(instance.bedrockPort);
      const state = await this.#inspect(instance);
      let exactManagedProcess = this.#isExactManagedProcess(instance, state);
      let adopted = false;
      if (!exactManagedProcess && pidAlive && portOccupied && bedrockOccupied) {
        adopted = Boolean(await this.#adoptPreIdentityProcess(instance, state));
        exactManagedProcess = adopted;
      }
      const owner = sanitizedTcpOwner(state?.tcp?.owner);
      if (pidAlive || portOccupied) {
        await this.store.update(instance.id, {
          status: 'running',
          lastError: exactManagedProcess
            ? 'The local manager restarted while this verified prior Mastermind process was active. Its authenticated stdin channel is unavailable, so a safe stop is required and PID termination is forbidden.'
            : 'The local manager restarted while a process or Java port remained live, but exact Mastermind ownership could not be verified.',
        });
        results.push({
          instanceId: instance.id,
          action: adopted ? 'adopted-pre-identity-process' : exactManagedProcess ? 'preserved-managed-orphan' : 'preserved-unmanaged-active',
          ownership: exactManagedProcess ? 'verified' : 'unverified',
          pidAlive,
          portOccupied,
          ...(owner ? { owner } : {}),
        });
        continue;
      }
      await this.store.update(instance.id, {
        status: 'stopped',
        pid: null,
        managedProcess: null,
        lastError: 'The local manager restarted while this instance was active; no live PID or Java-port listener was found.',
      });
      results.push({ instanceId: instance.id, action: 'reset-inactive', pidAlive: false, portOccupied: false });
    }
    return results;
  }

  #observeReadiness(id, line, readiness) {
    if (/\bDone \([^)]+\)! For help, type ["']help["']/i.test(line)) readiness.java = true;
    if (/\b(?:Started Geyser on|Geyser is now listening on|Geyser started on)\b/i.test(line)) readiness.geyser = true;
    if (!readiness.java || !readiness.geyser || readiness.reported) return;
    readiness.reported = true;
    const timer = setTimeout(() => {
      const entry = this.children.get(id);
      if (!entry || entry.readiness !== readiness || entry.child.exitCode !== null) return;
      const acknowledge = () => this.onReady(id, {
        javaReady: true, geyserReady: true, stableForMs: this.readinessStabilityMs,
      });
      Promise.resolve().then(() => (
        typeof entry.lease?.withHeldDirectoryGuards === 'function'
          ? entry.lease.withHeldDirectoryGuards(acknowledge)
          : acknowledge()
      ))
        .catch((error) => this.logStore.append(id, 'system', `Readiness acknowledgement failed: ${error?.message ?? String(error)}`).catch(() => undefined));
    }, this.readinessStabilityMs);
    timer.unref?.();
  }

  async withInstanceLock(id, operation, { priority = 'normal' } = {}) {
    if (typeof operation !== 'function') throw new TypeError('Instance lock operation must be a function');
    if (!['normal', 'lifecycle'].includes(priority)) {
      throw new TypeError("Instance lock priority must be 'normal' or 'lifecycle'");
    }
    let state = this.instanceLocks.get(id);
    if (!state) {
      state = { active: false, lifecycle: [], normal: [] };
      this.instanceLocks.set(id, state);
    }
    // Rare lifecycle mutations may pass queued dashboard/read work, but never
    // the active operation. Both lanes retain their own arrival order.
    const result = new Promise((resolve, reject) => {
      state[priority].push({ operation, resolve, reject });
    });
    this.#runNextInstanceLock(id, state);
    return result;
  }

  #runNextInstanceLock(id, state) {
    if (state.active) return;
    const next = state.lifecycle.shift() ?? state.normal.shift();
    if (!next) {
      if (this.instanceLocks.get(id) === state) this.instanceLocks.delete(id);
      return;
    }
    state.active = true;
    Promise.resolve()
      .then(next.operation)
      .then(next.resolve, next.reject)
      .finally(() => {
        state.active = false;
        this.#runNextInstanceLock(id, state);
      });
  }
}

function backupQuiescenceError(message) {
  return Object.assign(new Error(message), { code: 'BACKUP_SERVER_NOT_QUIESCENT', statusCode: 409 });
}
