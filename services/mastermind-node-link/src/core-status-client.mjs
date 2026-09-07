import crypto from 'node:crypto';
import { validateMastermindCoreStatus } from '../../../protocol/mastermind-node-exchange/contract.mjs';
import { CORE_STATUS_CAPABILITY, validateMastermindNodeLease } from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import { MastermindNodeExecutionError } from './executor.mjs';

// Fixed local read endpoints only: no caller URL, credentials, shell, tool proxy or model call.
export const CORE_STATUS_ENDPOINTS = Object.freeze({
  mcpHost: 'http://127.0.0.1:8772/health',
  memory: 'http://127.0.0.1:8765/health',
  modules: 'http://127.0.0.1:8770/health',
  catalog: 'http://127.0.0.1:8772/catalog',
});

async function readJson(response, maximum = 256 * 1024) {
  if (!response.ok || response.redirected) throw new Error('invalid');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('invalid');
  const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new Error('invalid'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  const value = JSON.parse(decoded);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  return value;
}

export class MastermindCoreStatusClient {
  constructor({ fetchImpl = fetch, now = Date.now, timeoutMs = 3000 } = {}) {
    if (typeof fetchImpl !== 'function' || typeof now !== 'function' || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 100 || timeoutMs > 5000) throw new TypeError('Invalid core status dependencies');
    this.fetchImpl = fetchImpl; this.now = now; this.timeoutMs = timeoutMs;
  }
  async observeStatus({ signal } = {}) {
    const records = await Promise.all(Object.entries(CORE_STATUS_ENDPOINTS).map(async ([key, url]) => {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const response = await this.fetchImpl(url, { method: 'GET', redirect: 'error', signal: combined,
          headers: { accept: 'application/json' } });
        let value;
        try { value = await readJson(response); }
        catch { return [key, { state: 'invalid', value: null }]; }
        return [key, { state: 'online', value }];
      } catch {
        if (signal?.aborted) throw signal.reason;
        return [key, { state: 'unreachable', value: null }];
      }
    }));
    const reads = Object.fromEntries(records);
    const services = Object.fromEntries(['mcpHost', 'memory', 'modules'].map((name) => [name, reads[name].state]));
    const host = reads.mcpHost.value;
    let activeTurns = null;
    if (host) {
      if (host.ok !== true || host.service !== 'mcp_host' || !Number.isSafeInteger(host.activeTurns)
        || host.activeTurns < 0 || host.activeTurns > 65535) services.mcpHost = 'invalid';
      else activeTurns = host.activeTurns;
    }
    const memory = reads.memory.value;
    if (memory) {
      if (memory.ok !== true || memory.retrieval_backend !== 'canonical_pgvector'
        || !memory.canonical || typeof memory.canonical.available !== 'boolean') services.memory = 'invalid';
      else if (!memory.canonical.available) services.memory = 'degraded';
    }
    const modules = reads.modules.value;
    if (modules && (modules.ok !== true || modules.service !== 'module_core')) services.modules = 'invalid';
    let capabilities = { count: null, sha256: null };
    const catalog = reads.catalog.value;
    if (catalog?.ok === true && Array.isArray(catalog.tools) && catalog.tools.length <= 512
      && catalog.tools.every((tool) => tool && typeof tool.name === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(tool.name)
        && typeof tool.server === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(tool.server))) {
      const names = catalog.tools.map((tool) => `${tool.server}:${tool.name}`).sort();
      if (new Set(names).size === names.length) capabilities = {
        count: names.length, sha256: crypto.createHash('sha256').update(JSON.stringify(names)).digest('hex'),
      };
    }
    return validateMastermindCoreStatus({ kind: CORE_STATUS_CAPABILITY, observedAt: new Date(this.now()).toISOString(),
      services, capabilities, activeTurns,
      complete: Object.values(services).every((state) => state === 'online') && capabilities.count !== null && activeTurns !== null });
  }
}

export class CoreStatusExecutor {
  constructor({ core, now = () => Math.floor(performance.now()) }) {
    if (!core?.observeStatus || typeof now !== 'function') throw new TypeError('Fixed core observer is required');
    this.core = core; this.now = now;
  }
  async execute(rawLease, options) {
    const lease = validateMastermindNodeLease(rawLease);
    if (lease.capability !== CORE_STATUS_CAPABILITY) throw new MastermindNodeExecutionError('local-response-invalid', 'This worker accepts only typed core status.', { retryable: false });
    const budget = () => {
      if (options.signal?.aborted) throw options.signal.reason;
      if (!Number.isFinite(options.deadlineMs) || this.now() >= options.deadlineMs) {
        throw new MastermindNodeExecutionError('lease-lost', 'The core status lease has expired.', { retryable: true });
      }
    };
    budget(); await options.emit('checking-local-state'); budget();
    const result = await this.core.observeStatus({ signal: options.signal });
    budget(); return validateMastermindCoreStatus(result);
  }
}

export class NegotiatedCoreExecutor extends CoreStatusExecutor {
  constructor({ family, ...options }) {
    super(options);
    if (!family?.execute) throw new TypeError('Fixed family executor is required');
    this.family = family;
  }
  async execute(rawLease, options) {
    const lease = validateMastermindNodeLease(rawLease);
    return lease.capability === CORE_STATUS_CAPABILITY ? super.execute(lease, options) : this.family.execute(lease, options);
  }
}
