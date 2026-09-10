import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const accessSource = fs.readFileSync(new URL('../access.ts', import.meta.url), 'utf8');
const compiledAccess = ts.transpileModule(accessSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'access.ts',
}).outputText;

function loadAccess(options = {}) {
  const commonJsModule = { exports: {} };
  const ownerGateConfigured = options.ownerGateConfigured ?? (() => false);
  const requireOwner = options.requireOwner ?? (async () => ({ ok: false, status: 403, reason: 'not owner' }));
  const sandbox = {
    Error,
    Set,
    URL,
    exports: commonJsModule.exports,
    module: commonJsModule,
    process: { env: { MASTERMIND_LOCAL_CONTROL_ENABLED: 'true', ...(options.environment ?? {}) } },
    require(identifier) {
      if (identifier === 'server-only') return {};
      if (identifier === '@/lib/trading/auth') return { ownerGateConfigured, requireOwner };
      throw new Error(`Unexpected test import: ${identifier}`);
    },
  };
  vm.runInNewContext(compiledAccess, sandbox, { filename: 'access.cjs' });
  return commonJsModule.exports;
}

function localRequest(options = {}) {
  const url = options.url ?? 'http://127.0.0.1:3000/api/local-control/services';
  const method = options.method ?? 'GET';
  const headers = new Headers({ host: options.host ?? '127.0.0.1:3000' });
  if (options.origin !== undefined) headers.set('origin', options.origin);
  if (options.fetchSite !== undefined) headers.set('sec-fetch-site', options.fetchSite);
  return { url, method, headers };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

test('local supervised GET is allowed without weakening the optional owner gate', async () => {
  const access = loadAccess();
  await assert.doesNotReject(() => access.requireLocalServiceAccess(localRequest()));

  const ownerAccess = loadAccess({
    ownerGateConfigured: () => true,
    requireOwner: async () => ({ ok: true, userId: 'owner' }),
  });
  await assert.doesNotReject(() => ownerAccess.requireLocalServiceAccess(localRequest()));

  const deniedAccess = loadAccess({
    ownerGateConfigured: () => true,
    requireOwner: async () => ({ ok: false, status: 403, reason: 'not owner' }),
  });
  await rejectsCode(deniedAccess.requireLocalServiceAccess(localRequest()), 'OWNER_REQUIRED');
});

test('service access rejects deployment, disabled control, remote hosts, and wrong ports', async () => {
  await rejectsCode(
    loadAccess({ environment: { VERCEL: '1' } }).requireLocalServiceAccess(localRequest()),
    'LOCAL_SERVICE_CONTROL_REQUIRED',
  );
  await rejectsCode(
    loadAccess({ environment: { MASTERMIND_LOCAL_CONTROL_ENABLED: 'false' } }).requireLocalServiceAccess(localRequest()),
    'LOCAL_CONTROL_DISABLED',
  );
  const access = loadAccess();
  await rejectsCode(
    access.requireLocalServiceAccess(localRequest({
      url: 'http://192.168.1.20:3000/api/local-control/services',
      host: '192.168.1.20:3000',
    })),
    'LOCAL_REQUEST_REQUIRED',
  );
  await rejectsCode(
    access.requireLocalServiceAccess(localRequest({
      url: 'http://127.0.0.1:3001/api/local-control/services',
      host: '127.0.0.1:3001',
    })),
    'LOCAL_REQUEST_REQUIRED',
  );
  await rejectsCode(
    access.requireLocalServiceAccess(localRequest({ host: '127.0.0.1:3001' })),
    'LOCAL_REQUEST_REQUIRED',
  );
  await rejectsCode(
    access.requireLocalServiceAccess(localRequest({ host: '2130706433:3000' })),
    'LOCAL_REQUEST_REQUIRED',
  );
});

test('GET rejects cross-site metadata and restart requires an exact same-origin browser request', async () => {
  const access = loadAccess();
  await rejectsCode(
    access.requireLocalServiceAccess(localRequest({ origin: 'http://evil.invalid', fetchSite: 'cross-site' })),
    'ORIGIN_REJECTED',
  );
  await rejectsCode(
    access.requireLocalServiceAccess(localRequest({ method: 'POST' })),
    'ORIGIN_REQUIRED',
  );
  await assert.doesNotReject(() => access.requireLocalServiceAccess(localRequest({
    method: 'POST',
    origin: 'http://127.0.0.1:3000',
    fetchSite: 'same-origin',
  })));
});
