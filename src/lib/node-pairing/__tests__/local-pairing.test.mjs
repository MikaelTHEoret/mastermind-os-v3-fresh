import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  LocalNodePairingError,
  assertLocalNodePairingAccess,
  describeLocalNodePairingDiagnostic,
  describeLocalNodePairingError,
  processLocalNodePairingRequest,
  readLocalNodePairingJson,
  validateLocalNodePairingInput,
} from '../local-pairing.mjs';
import {
  LocalNodePairingClientError,
  parseLocalNodePairingFragment,
  parseLocalNodePairingResponse,
  readLocalNodePairingResponse,
  submitLocalNodePairing,
} from '../client.mjs';
import {
  MASTERMIND_NODE_CREDENTIAL_VAULT_FILE,
  resolveMastermindNodeCredentialVaultFile,
  resolveMastermindNodeDpapiScriptFile,
  resolveMastermindNodeStateRoot,
} from '../../../../services/mastermind-node-link/src/state-paths.mjs';

const PAIRING_ID = '123e4567-e89b-42d3-a456-426614174000';
const NODE_ID = '223e4567-e89b-42d3-a456-426614174000';
const PAIRING_CREDENTIAL = `mnp1.${PAIRING_ID}.${'B'.repeat(43)}`;

function localRequest(body, options = {}) {
  const authority = options.authority ?? '127.0.0.1:3000';
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(options.url ?? `http://${authority}/api/node/pair-local`, {
    method: options.method ?? 'POST',
    headers: {
      Host: options.host ?? authority,
      Origin: options.origin ?? `http://${authority}`,
      'Sec-Fetch-Site': options.fetchSite ?? 'same-origin',
      'Content-Type': options.contentType ?? 'application/json; charset=utf-8',
      ...(options.headers ?? {}),
    },
    body: text,
  });
}

function requestBody() {
  return {
    schemaVersion: 1,
    pairingCredential: PAIRING_CREDENTIAL,
    displayName: 'Family Node',
  };
}

test('local receiver accepts only the exact loopback same-origin endpoint', () => {
  assert.doesNotThrow(() => assertLocalNodePairingAccess(localRequest(requestBody()), {}));
  assert.doesNotThrow(() => assertLocalNodePairingAccess(localRequest(requestBody(), {
    authority: 'localhost:3000',
  }), {}));
  assert.doesNotThrow(() => assertLocalNodePairingAccess(localRequest(requestBody(), {
    url: 'http://localhost:3000/api/node/pair-local',
    host: '127.0.0.1:3000',
    origin: 'http://127.0.0.1:3000',
  }), {}));

  for (const request of [
    localRequest(requestBody(), { url: 'http://127.0.0.1:3000/api/node/pair-local?debug=1' }),
    localRequest(requestBody(), { url: 'http://127.0.0.1:3001/api/node/pair-local', host: '127.0.0.1:3001' }),
    localRequest(requestBody(), { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' }),
    localRequest(requestBody(), { url: 'https://127.0.0.1:3000/api/node/pair-local', origin: 'https://127.0.0.1:3000' }),
    localRequest(requestBody(), { origin: 'http://localhost:3000' }),
    localRequest(requestBody(), { fetchSite: 'cross-site' }),
  ]) {
    assert.throws(
      () => assertLocalNodePairingAccess(request, {}),
      (error) => error instanceof LocalNodePairingError && error.status === 403,
    );
  }
});

test('Vercel is denied before a local credential store can be created', async () => {
  let factoryCalls = 0;
  await assert.rejects(
    processLocalNodePairingRequest(localRequest(requestBody()), {
      environment: { VERCEL: '1' },
      createCredentialStore() {
        factoryCalls += 1;
        throw new Error('must not run');
      },
    }),
    (error) => error instanceof LocalNodePairingError
      && error.status === 503 && error.code === 'LOCAL_PAIRING_REQUIRED',
  );
  assert.equal(factoryCalls, 0);
});

test('receiver validates the bounded exact body then stores one pending identity', async () => {
  const calls = [];
  const result = await processLocalNodePairingRequest(localRequest(requestBody()), {
    environment: {},
    credentialStore: {
      async beginPairing(...args) {
        calls.push(args);
        return { state: 'pending', nodeId: NODE_ID, pairingId: PAIRING_ID };
      },
    },
  });
  assert.deepEqual(calls, [[PAIRING_CREDENTIAL, 'Family Node']]);
  assert.deepEqual(result, { ok: true, state: 'pending', nodeId: NODE_ID });
  assert.equal(JSON.stringify(result).includes(PAIRING_CREDENTIAL), false);
});

test('identical pending claims converge on the persisted node identity', async () => {
  const store = {
    nodeId: null,
    async beginPairing() {
      this.nodeId ??= NODE_ID;
      return { state: 'pending', nodeId: this.nodeId, pairingId: PAIRING_ID };
    },
  };
  const [first, second] = await Promise.all([
    processLocalNodePairingRequest(localRequest(requestBody()), { environment: {}, credentialStore: store }),
    processLocalNodePairingRequest(localRequest(requestBody()), { environment: {}, credentialStore: store }),
  ]);
  assert.equal(first.nodeId, NODE_ID);
  assert.equal(second.nodeId, first.nodeId);
});

test('different or already-paired local state maps to a redacted 409', async () => {
  const sensitive = `do-not-echo-${PAIRING_CREDENTIAL}`;
  let failure;
  try {
    await processLocalNodePairingRequest(localRequest(requestBody()), {
      environment: {},
      credentialStore: {
        async beginPairing() {
          const error = new Error(sensitive);
          error.code = 'NODE_PAIRING_STATE_CONFLICT';
          throw error;
        },
      },
    });
  } catch (error) {
    failure = describeLocalNodePairingError(error);
  }
  assert.equal(failure.status, 409);
  assert.deepEqual(failure.body, {
    ok: false,
    code: 'NODE_PAIRING_STATE_CONFLICT',
    message: 'This computer already has a different node identity.',
  });
  assert.equal(JSON.stringify(failure).includes(PAIRING_CREDENTIAL), false);
});

test('local pairing diagnostics expose only bounded error classification', () => {
  const secret = `do-not-log-${PAIRING_CREDENTIAL}`;
  const diagnostic = describeLocalNodePairingDiagnostic(Object.assign(new Error(secret), {
    code: 'ERR_INVALID_URL_SCHEME',
    path: secret,
  }));
  assert.deepEqual(diagnostic, { name: 'Error', code: 'ERR_INVALID_URL_SCHEME' });
  assert.equal(JSON.stringify(diagnostic).includes(secret), false);

  const hostile = {};
  Object.defineProperty(hostile, 'name', { get() { throw new Error(secret); } });
  assert.deepEqual(describeLocalNodePairingDiagnostic(hostile), {
    name: 'UnknownError', code: null,
  });
});

test('body parser rejects duplicate fields, unsupported content and oversized bodies', async () => {
  const duplicate = `{"schemaVersion":1,"schemaVersion":1,"pairingCredential":"${PAIRING_CREDENTIAL}","displayName":"Family Node"}`;
  await assert.rejects(
    readLocalNodePairingJson(localRequest(duplicate)),
    (error) => error.code === 'DUPLICATE_JSON_KEY',
  );
  await assert.rejects(
    readLocalNodePairingJson(localRequest(requestBody(), { contentType: 'text/plain' })),
    (error) => error.status === 415,
  );
  await assert.rejects(
    readLocalNodePairingJson(localRequest('x'.repeat(513), { contentType: 'application/json' })),
    (error) => error.status === 413,
  );
});

test('input validator accepts only the frozen three-field one-click request', () => {
  assert.deepEqual(validateLocalNodePairingInput(requestBody()), requestBody());
  assert.throws(
    () => validateLocalNodePairingInput({ ...requestBody(), pin: '795200' }),
    (error) => error.code === 'INVALID_PAIRING_REQUEST',
  );
  assert.throws(
    () => validateLocalNodePairingInput({ ...requestBody(), displayName: 'Another Node' }),
    (error) => error.code === 'INVALID_PAIRING_REQUEST',
  );
});

test('client consumes only one canonical pairing fragment', () => {
  assert.equal(parseLocalNodePairingFragment(`#pairing=${encodeURIComponent(PAIRING_CREDENTIAL)}`), PAIRING_CREDENTIAL);
  for (const fragment of [
    '',
    `#token=${PAIRING_CREDENTIAL}`,
    `#pairing=${PAIRING_CREDENTIAL}&debug=1`,
    `#pairing=${PAIRING_CREDENTIAL}%00`,
  ]) {
    assert.throws(
      () => parseLocalNodePairingFragment(fragment),
      (error) => error instanceof LocalNodePairingClientError && error.code === 'PAIRING_FRAGMENT_INVALID',
    );
  }
});

test('client sends the exact same-origin request and strictly parses the safe response', async () => {
  let captured;
  const result = await submitLocalNodePairing(PAIRING_CREDENTIAL, async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ ok: true, state: 'pending', nodeId: NODE_ID }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  assert.equal(captured.url, '/api/node/pair-local');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.credentials, 'same-origin');
  assert.equal(captured.init.redirect, 'error');
  assert.equal(captured.init.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(captured.init.body), requestBody());
  assert.deepEqual(result, { ok: true, state: 'pending', nodeId: NODE_ID });

  assert.throws(
    () => parseLocalNodePairingResponse(200, { ok: true, state: 'pending', nodeId: NODE_ID, token: 'leak' }),
    (error) => error.code === 'PAIRING_RESPONSE_INVALID',
  );
  await assert.rejects(
    readLocalNodePairingResponse(new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })),
    (error) => error.code === 'PAIRING_RESPONSE_INVALID',
  );
});

test('credential vault resolver is canonical and shared by the worker', async () => {
  const root = resolveMastermindNodeStateRoot({ LOCALAPPDATA: 'C:\\Users\\Mik\\AppData\\Local' });
  const vault = resolveMastermindNodeCredentialVaultFile(root);
  const dpapiScript = resolveMastermindNodeDpapiScriptFile('E:\\MastermindPortable');
  assert.equal(MASTERMIND_NODE_CREDENTIAL_VAULT_FILE, 'credential-v1.dpapi.json');
  assert.equal(root, 'C:\\Users\\Mik\\AppData\\Local\\Mastermind\\node-link');
  assert.equal(vault, `${root}\\credential-v1.dpapi.json`);
  assert.equal(dpapiScript, 'E:\\MastermindPortable\\scripts\\protect-minecraft-account.ps1');
  const workerSource = await fs.readFile(path.resolve('services/mastermind-node-link/src/worker.mjs'), 'utf8');
  const storeSource = await fs.readFile(
    path.resolve('services/mastermind-node-link/src/windows-dpapi-credential-store.mjs'),
    'utf8',
  );
  assert.match(workerSource, /resolveMastermindNodeCredentialVaultFile\(/u);
  assert.doesNotMatch(workerSource, /credential-v1\.dpapi\.json/u);
  assert.doesNotMatch(storeSource, /dpapi-vault|MINECRAFT_ACCOUNT_DPAPI_SCRIPT/u);
  assert.match(storeSource, /'-File', this\.dpapiScriptFile/u);
});

test('pairing page scrubs the fragment before starting and never renders credential material', async () => {
  const pageSource = await fs.readFile(path.resolve('src/app/node/pair/page.tsx'), 'utf8');
  const scrub = pageSource.indexOf('window.history.replaceState');
  const start = pageSource.indexOf('attempt.current = beginPairing');
  assert.ok(scrub >= 0 && start > scrub);
  assert.doesNotMatch(pageSource, /pairingCredential|mnp1\.|795200/u);
  assert.match(pageSource, /No manual code is needed\./u);
});
