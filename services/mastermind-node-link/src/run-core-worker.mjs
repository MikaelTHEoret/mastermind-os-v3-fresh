import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultDataRoot } from '../../minecraft-control-plane/src/config.mjs';
import { resolveMastermindNodeCredentialVaultFile, resolveMastermindNodeDpapiScriptFile, resolveMastermindNodeStateRoot } from './state-paths.mjs';
import { WindowsDpapiMastermindNodeCredentialStore } from './windows-dpapi-credential-store.mjs';
import { MastermindCoreNodeFixedHttpsTransport } from './fixed-https-transport.mjs';
import { createMastermindCoreOnlyWorker } from './core-worker.mjs';
import { runMastermindNodeWorkerProcess } from './run-worker.mjs';
import { acquireMastermindNodeWorkerLifetime } from './worker-lifetime.mjs';

const BUNDLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function validateCoreWorkerEnvironment(environment) {
  if (!environment || environment.MASTERMIND_NODE_WORKER_PROFILE !== 'core-only'
    || environment.MASTERMIND_LOCAL_CHILD_ROLE !== 'mastermind-node-link-core') {
    throw Object.assign(new Error('Explicit core-only supervisor profile required'), { code: 'NODE_CORE_PROFILE_REQUIRED' });
  }
  for (const key of Object.keys(environment)) {
    if (['NODE_OPTIONS','NODE_DEBUG','NODE_DEBUG_NATIVE','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','SSLKEYLOGFILE'].includes(key.toUpperCase())) {
      throw Object.assign(new Error('Unsafe inherited Node setting'), { code: 'NODE_CORE_ENVIRONMENT_INVALID' });
    }
  }
  if (environment.MASTERMIND_NODE_NATIVE_REUSE_ENABLED !== undefined
    && !['true','false'].includes(environment.MASTERMIND_NODE_NATIVE_REUSE_ENABLED)) {
    throw Object.assign(new Error('Explicit native reuse setting required'), {code:'NODE_NATIVE_PROFILE_INVALID'});
  }
  resolveMastermindNodeStateRoot(environment);
  return environment;
}

/** Fixed production composition. Construction performs no I/O or pairing. */
export function createMastermindCoreWorkerFromEnvironment(options = {}) {
  const environment = validateCoreWorkerEnvironment(options.environment ?? process.env);
  const credentialStore = (options.credentialStoreFactory ?? ((args) => new WindowsDpapiMastermindNodeCredentialStore(args)))({
    vaultFile: resolveMastermindNodeCredentialVaultFile(resolveMastermindNodeStateRoot(environment)),
    dpapiScriptFile: resolveMastermindNodeDpapiScriptFile(BUNDLE_ROOT),
  });
  const exchangeTransport = (options.transportFactory ?? ((args) => new MastermindCoreNodeFixedHttpsTransport(args)))({ credentialStore });
  return (options.workerFactory ?? createMastermindCoreOnlyWorker)({
    journalRoot: path.join(defaultDataRoot(environment), 'state', 'node-exchange', 'v1'),
    credentialStore, exchangeTransport,
    enableNativeTasks: environment.MASTERMIND_NODE_NATIVE_REUSE_ENABLED === 'true',
  });
}

export async function runMastermindCoreWorkerProcess(options = {}) {
  const processObject = options.processObject ?? process;
  const diagnostic = options.writeDiagnostic ?? ((line) => processObject.stderr?.write?.(`${line}\n`));
  let lease;
  try {
    const args = options.args ?? processObject.argv.slice(2);
    if (!Array.isArray(args) || args.length) throw Object.assign(new Error('Arguments are not accepted'), { code: 'NODE_WORKER_ARGUMENTS_INVALID' });
    const environment = validateCoreWorkerEnvironment(options.environment ?? processObject.env);
    lease = await (options.lifetimeFactory ?? acquireMastermindNodeWorkerLifetime)(resolveMastermindNodeStateRoot(environment));
    const worker = createMastermindCoreWorkerFromEnvironment({ ...options, environment });
    return await runMastermindNodeWorkerProcess({ processObject, args: [], worker, writeDiagnostic: diagnostic });
  } catch (error) {
    diagnostic(`Mastermind core node-link stopped: ${typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code) ? error.code : 'NODE_CORE_WORKER_FAILED'}`);
    return 1;
  } finally { await lease?.release(); }
}

if (typeof process.argv[1] === 'string' && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runMastermindCoreWorkerProcess();
}
