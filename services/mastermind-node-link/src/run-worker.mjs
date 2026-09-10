import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { defaultDataRoot } from '../../minecraft-control-plane/src/config.mjs';
import { MastermindCoreNodeFixedHttpsTransport } from './fixed-https-transport.mjs';
import {
  resolveMastermindNodeCredentialVaultFile,
  resolveMastermindNodeDpapiScriptFile,
  resolveMastermindNodeStateRoot,
} from './state-paths.mjs';
import { WindowsDpapiMastermindNodeCredentialStore } from './windows-dpapi-credential-store.mjs';
import { createMastermindNodeWorker } from './worker.mjs';
import { acquireMastermindNodeWorkerLifetime } from './worker-lifetime.mjs';

export const MASTERMIND_NODE_CHILD_ROLE = 'mastermind-node-link';

const CONTROL_TOKEN = /^[0-9a-f]{64}$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

function validateEnvironment(environment) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)
    || environment.MASTERMIND_LOCAL_CONTROL_ENABLED !== 'true'
    || environment.MASTERMIND_LOCAL_CHILD_ROLE !== MASTERMIND_NODE_CHILD_ROLE
    || environment.MASTERMIND_CONTROL_URL !== 'http://127.0.0.1:43100'
    || typeof environment.MASTERMIND_CONTROL_TOKEN !== 'string'
    || !CONTROL_TOKEN.test(environment.MASTERMIND_CONTROL_TOKEN)
    || ![undefined, 'false', 'true'].includes(environment.MASTERMIND_CORE_STATUS_ENABLED)) {
    throw Object.assign(new Error('The Mastermind node-link child environment is invalid.'), {
      code: 'NODE_WORKER_CONFIGURATION_INVALID',
    });
  }
  return environment;
}

/** Compose the production worker without accepting a hosted URL or bearer. */
export function createMastermindNodeWorkerFromEnvironment(options = {}) {
  const environment = validateEnvironment(options.environment ?? process.env);
  const credentialStoreFactory = options.credentialStoreFactory
    ?? ((storeOptions) => new WindowsDpapiMastermindNodeCredentialStore(storeOptions));
  const transportFactory = options.transportFactory
    ?? ((transportOptions) => new MastermindCoreNodeFixedHttpsTransport(transportOptions));
  const workerFactory = options.workerFactory ?? createMastermindNodeWorker;
  if (typeof credentialStoreFactory !== 'function' || typeof transportFactory !== 'function'
    || typeof workerFactory !== 'function') {
    throw new TypeError('Node worker factories must be functions');
  }

  const vaultFile = resolveMastermindNodeCredentialVaultFile(
    resolveMastermindNodeStateRoot(environment),
  );
  const dpapiScriptFile = resolveMastermindNodeDpapiScriptFile(
    options.bundleRoot ?? process.cwd(),
  );
  const journalRoot = path.join(defaultDataRoot(environment), 'state', 'node-exchange', 'v1');
  const credentialStore = credentialStoreFactory({ vaultFile, dpapiScriptFile });
  const exchangeTransport = transportFactory({ credentialStore });
  return workerFactory({
    journalRoot,
    environment,
    controlToken: environment.MASTERMIND_CONTROL_TOKEN,
    credentialStore,
    exchangeTransport,
    enableCoreStatus: environment.MASTERMIND_CORE_STATUS_ENABLED === 'true',
  });
}

/**
 * Long-lived hidden child process boundary. It accepts no command-line input;
 * all hosted authority comes from the CurrentUser-protected node vault.
 */
export async function runMastermindNodeWorkerProcess(options = {}) {
  const processObject = options.processObject ?? process;
  const args = options.args ?? processObject.argv?.slice(2) ?? [];
  const writeDiagnostic = options.writeDiagnostic
    ?? ((line) => processObject.stderr?.write?.(`${line}\n`));
  if (!Array.isArray(args) || args.length !== 0) {
    writeDiagnostic('Mastermind node-link stopped: NODE_WORKER_ARGUMENTS_INVALID');
    return 1;
  }

  let worker;
  try {
    worker = options.worker ?? createMastermindNodeWorkerFromEnvironment({
      environment: options.environment ?? processObject.env,
      credentialStoreFactory: options.credentialStoreFactory,
      transportFactory: options.transportFactory,
      workerFactory: options.workerFactory,
    });
  } catch (error) {
    const code = typeof error?.code === 'string' && SAFE_ERROR_CODE.test(error.code)
      ? error.code
      : 'NODE_WORKER_FAILED';
    writeDiagnostic(`Mastermind node-link stopped: ${code}`);
    return 1;
  }
  if (!worker || typeof worker.start !== 'function' || typeof worker.wait !== 'function'
    || typeof worker.stop !== 'function') {
    writeDiagnostic('Mastermind node-link stopped: NODE_WORKER_FAILED');
    return 1;
  }

  let started = false;
  let stopRequested = false;
  let stopPromise = null;
  const stop = () => {
    stopRequested = true;
    if (!started) return;
    stopPromise ??= Promise.resolve().then(() => worker.stop());
    stopPromise.catch(() => undefined);
  };
  processObject.on?.('SIGINT', stop);
  processObject.on?.('SIGTERM', stop);
  try {
    await worker.start();
    started = true;
    if (stopRequested) stop();
    await worker.wait();
    await stopPromise;
    return 0;
  } catch (error) {
    await stopPromise?.catch(() => undefined);
    const code = typeof error?.code === 'string' && SAFE_ERROR_CODE.test(error.code)
      ? error.code
      : 'NODE_WORKER_FAILED';
    writeDiagnostic(`Mastermind node-link stopped: ${code}`);
    return 1;
  } finally {
    processObject.removeListener?.('SIGINT', stop);
    processObject.removeListener?.('SIGTERM', stop);
  }
}

function isMainModule() {
  const entrypoint = process.argv[1];
  return typeof entrypoint === 'string'
    && pathToFileURL(path.resolve(entrypoint)).href === import.meta.url;
}

export async function runMastermindNodeWorkerEntrypoint(options = {}) {
  const processObject = options.processObject ?? process;
  const diagnostic = options.writeDiagnostic ?? ((line) => processObject.stderr?.write?.(`${line}\n`));
  let lease;
  try {
    const args = options.args ?? processObject.argv.slice(2);
    if (!Array.isArray(args) || args.length) throw Object.assign(new Error('Worker arguments are invalid'), { code: 'NODE_WORKER_ARGUMENTS_INVALID' });
    const environment = validateEnvironment(options.environment ?? processObject.env);
    lease = await (options.lifetimeFactory ?? acquireMastermindNodeWorkerLifetime)(resolveMastermindNodeStateRoot(environment));
    return await runMastermindNodeWorkerProcess({ ...options, processObject, environment });
  } catch (error) {
    diagnostic(`Mastermind node-link stopped: ${typeof error?.code === 'string' && SAFE_ERROR_CODE.test(error.code) ? error.code : 'NODE_WORKER_FAILED'}`);
    return 1;
  } finally { await lease?.release(); }
}

if (isMainModule()) {
  process.exitCode = await runMastermindNodeWorkerEntrypoint();
}
