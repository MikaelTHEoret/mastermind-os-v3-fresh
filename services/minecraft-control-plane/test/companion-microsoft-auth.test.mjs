import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MICROSOFT_MINECRAFT_AUTH_POLICY,
  MicrosoftMinecraftAuth,
  MicrosoftMinecraftAuthError,
} from '../src/companion/microsoft-auth.mjs';

const CLIENT_ID = '11111111-2222-4333-8444-555555555555';
const FLOW_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PROFILE = { id: '0123456789abcdef0123456789abcdef', name: 'FamilyAgent' };
const ACCESS = 'microsoft-access-token-1234567890';
const REFRESH = 'microsoft-refresh-token-1234567890';
const ROTATED_REFRESH = 'microsoft-rotated-refresh-token-1234567890';
const MINECRAFT_ACCESS = 'minecraft-access-token-1234567890';
const XUID = '2533274790395904';

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function memoryVault(initial = null) {
  return {
    value: initial ? structuredClone(initial) : null,
    saves: [],
    clears: 0,
    async load() { return this.value ? structuredClone(this.value) : null; },
    async save(value) { this.value = structuredClone(value); this.saves.push(structuredClone(value)); return { saved: true }; },
    async clear() { this.value = null; this.clears += 1; return { removed: true }; },
  };
}

function fetchQueue(responses) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (responses.length === 0) throw new Error('Unexpected network request');
    const next = responses.shift();
    return typeof next === 'function' ? next(url, init) : next;
  };
  return { calls, fetcher };
}

function deviceResponse(overrides = {}) {
  return response(200, {
    device_code: 'private-device-code-1234567890',
    user_code: 'ABCD-EFGH',
    verification_uri: 'https://microsoft.com/devicelogin',
    expires_in: 900,
    interval: 5,
    ...overrides,
  });
}

function tokenResponse(refreshToken = REFRESH, overrides = {}) {
  return response(200, {
    token_type: 'Bearer',
    scope: 'XboxLive.signin XboxLive.offline_access',
    expires_in: 3600,
    access_token: ACCESS,
    refresh_token: refreshToken,
    ...overrides,
  });
}

function minecraftExchangeResponses() {
  return [
    response(200, {
      IssueInstant: '2026-08-13T00:00:00.000Z', NotAfter: '2026-08-13T01:00:00.000Z',
      Token: 'xbox-user-token-1234567890', DisplayClaims: { xui: [{ uhs: '123456789' }] },
    }),
    response(200, {
      IssueInstant: '2026-08-13T00:00:00.000Z', NotAfter: '2026-08-13T01:00:00.000Z',
      Token: 'xbox-services-xsts-token-1234567890', DisplayClaims: { xui: [{ uhs: '123456789', xid: XUID }] },
    }),
    response(200, {
      IssueInstant: '2026-08-13T00:00:00.000Z', NotAfter: '2026-08-13T01:00:00.000Z',
      Token: 'xsts-token-1234567890', DisplayClaims: { xui: [{ uhs: '123456789' }] },
    }),
    response(200, { username: 'ignored', roles: [], access_token: MINECRAFT_ACCESS, token_type: 'Bearer', expires_in: 3600 }),
    response(200, { items: [{ name: 'game_minecraft', signature: 'ignored' }], signature: 'ignored', keyId: 'ignored' }),
    response(200, { id: PROFILE.id, name: PROFILE.name, skins: [], capes: [] }),
  ];
}

function authFixture({ responses = [], initialVault = null, now = 1_800_000_000_000, config = { clientId: CLIENT_ID } } = {}) {
  let clock = now;
  const vault = memoryVault(initialVault);
  const network = fetchQueue([...responses]);
  const auth = new MicrosoftMinecraftAuth({
    config,
    vault,
    fetcher: network.fetcher,
    now: () => clock,
    randomUUID: () => FLOW_ID,
  });
  return { auth, vault, calls: network.calls, setNow(value) { clock = value; }, now: () => clock };
}

function assertPublicFlow(value, status) {
  assert.deepEqual(Object.keys(value).sort(), ['expiry', 'flowId', 'status', 'user_code', 'verification_uri']);
  assert.equal(value.flowId, FLOW_ID);
  assert.equal(value.status, status);
  const text = JSON.stringify(value);
  assert.equal(text.includes('device-code'), false);
  assert.equal(text.includes('access-token'), false);
  assert.equal(text.includes('refresh-token'), false);
}

function savedAccount(refreshToken = REFRESH) {
  return {
    schemaVersion: 1,
    provider: 'microsoft',
    refreshToken,
    account: PROFILE,
    authenticatedAt: '2026-08-13T00:00:00.000Z',
  };
}

test('requires an operator-owned public-client GUID and rejects every client-secret shape', async () => {
  const missing = authFixture({ config: null });
  await missing.auth.initialize();
  assert.deepEqual(missing.auth.status(), {
    provider: 'microsoft', configured: false, signedIn: false, sessionReady: false, status: 'signed-out', account: null,
  });
  await assert.rejects(() => missing.auth.startDeviceFlow(), (error) => (
    error instanceof MicrosoftMinecraftAuthError && error.code === 'MINECRAFT_APP_REGISTRATION_REQUIRED'
  ));
  assert.throws(() => new MicrosoftMinecraftAuth({
    config: { clientId: CLIENT_ID, clientSecret: 'forbidden-secret' }, vault: memoryVault(), fetcher: async () => response(500, {}),
  }), /client secrets are forbidden/);
  assert.throws(() => new MicrosoftMinecraftAuth({
    config: { clientId: 'not-a-guid' }, vault: memoryVault(), fetcher: async () => response(500, {}),
  }), (error) => error.code === 'MINECRAFT_APP_REGISTRATION_REQUIRED');
  assert.equal(JSON.stringify(MICROSOFT_MINECRAFT_AUTH_POLICY).includes(CLIENT_ID), false);
});

test('starts only the fixed consumers device flow and returns the five-field public boundary', async () => {
  const value = authFixture({ responses: [deviceResponse()] });
  await value.auth.initialize();
  const flow = await value.auth.startDeviceFlow();
  assertPublicFlow(flow, 'pending');
  assert.equal(value.calls.length, 1);
  assert.equal(value.calls[0].url, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode');
  assert.equal(value.calls[0].init.redirect, 'error');
  assert.equal(value.calls[0].init.cache, 'no-store');
  const form = new URLSearchParams(value.calls[0].init.body);
  assert.deepEqual(Object.fromEntries(form), {
    client_id: CLIENT_ID,
    scope: 'XboxLive.signin XboxLive.offline_access',
  });
  assert.equal(JSON.stringify(value.calls[0].init).includes('client_secret'), false);
});

test('device polling handles pending, slow_down, declined, and local expiry without leaking the device code', async () => {
  const pending = response(400, { error: 'authorization_pending', error_description: 'private provider text' });
  const slow = response(400, { error: 'slow_down' });
  const declined = response(400, { error: 'authorization_declined' });
  const value = authFixture({ responses: [deviceResponse(), pending, slow, declined] });
  await value.auth.initialize();
  const started = await value.auth.startDeviceFlow();
  assertPublicFlow(await value.auth.pollDeviceFlow(started.flowId), 'pending');
  value.setNow(value.now() + 5_000);
  assertPublicFlow(await value.auth.pollDeviceFlow(started.flowId), 'slow_down');
  value.setNow(value.now() + 10_000);
  assertPublicFlow(await value.auth.pollDeviceFlow(started.flowId), 'declined');
  assert.equal(value.calls.length, 4);

  const expiring = authFixture({ responses: [deviceResponse({ expires_in: 60 })] });
  await expiring.auth.initialize();
  const expiryFlow = await expiring.auth.startDeviceFlow();
  expiring.setNow(expiring.now() + 60_000);
  assertPublicFlow(await expiring.auth.pollDeviceFlow(expiryFlow.flowId), 'expired');
  assert.equal(expiring.calls.length, 1, 'local expiry must not call the token endpoint');
});

test('completes strict Xbox, XSTS, Minecraft login, entitlement, and profile exchange while persisting only refresh/account data', async () => {
  const value = authFixture({ responses: [deviceResponse(), tokenResponse(), ...minecraftExchangeResponses()] });
  await value.auth.initialize();
  const started = await value.auth.startDeviceFlow();
  const finished = await value.auth.pollDeviceFlow(started.flowId);
  assertPublicFlow(finished, 'complete');
  assert.equal(value.calls.map((call) => call.url).join('\n'), [
    MICROSOFT_MINECRAFT_AUTH_POLICY.deviceCodeEndpoint,
    MICROSOFT_MINECRAFT_AUTH_POLICY.tokenEndpoint,
    MICROSOFT_MINECRAFT_AUTH_POLICY.xboxUserAuthEndpoint,
    MICROSOFT_MINECRAFT_AUTH_POLICY.xstsEndpoint,
    MICROSOFT_MINECRAFT_AUTH_POLICY.xstsEndpoint,
    MICROSOFT_MINECRAFT_AUTH_POLICY.minecraftLoginEndpoint,
    MICROSOFT_MINECRAFT_AUTH_POLICY.minecraftEntitlementsEndpoint,
    MICROSOFT_MINECRAFT_AUTH_POLICY.minecraftProfileEndpoint,
  ].join('\n'));
  const xboxBody = JSON.parse(value.calls[2].init.body);
  assert.deepEqual(xboxBody, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${ACCESS}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  const xboxServicesBody = JSON.parse(value.calls[3].init.body);
  assert.deepEqual(xboxServicesBody, {
    Properties: { SandboxId: 'RETAIL', UserTokens: ['xbox-user-token-1234567890'] },
    RelyingParty: 'http://xboxlive.com', TokenType: 'JWT',
  });
  const xstsBody = JSON.parse(value.calls[4].init.body);
  assert.deepEqual(xstsBody, {
    Properties: { SandboxId: 'RETAIL', UserTokens: ['xbox-user-token-1234567890'] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  });
  assert.equal(value.vault.saves.length, 1);
  assert.deepEqual(value.vault.saves[0], {
    ...savedAccount(),
    authenticatedAt: new Date(value.now()).toISOString(),
  });
  const persisted = JSON.stringify(value.vault.saves[0]);
  assert.equal(persisted.includes(ACCESS), false);
  assert.equal(persisted.includes(MINECRAFT_ACCESS), false);
  assert.deepEqual(value.auth.status(), {
    provider: 'microsoft', configured: true, signedIn: true, sessionReady: true,
    status: 'signed-in', account: { name: PROFILE.name },
  });
  assert.equal(JSON.stringify(value.auth.status()).includes(PROFILE.id), false);
  assert.deepEqual(value.auth.minecraftSession(), {
    username: PROFILE.name,
    uuid: PROFILE.id,
    accessToken: MINECRAFT_ACCESS,
    xuid: XUID,
    clientId: CLIENT_ID,
  });
  assert.notEqual(XUID, '123456789', 'Xbox XUID must never be substituted with the user hash');
});

test('silent refresh rotates the encrypted refresh token only after the complete identity chain succeeds', async () => {
  const value = authFixture({
    initialVault: savedAccount(),
    responses: [tokenResponse(ROTATED_REFRESH), ...minecraftExchangeResponses()],
  });
  await value.auth.initialize();
  assert.equal(value.auth.status().signedIn, true);
  assert.equal(value.auth.status().sessionReady, false);
  const status = await value.auth.silentRefresh();
  assert.equal(status.sessionReady, true);
  assert.equal(value.vault.saves.at(-1).refreshToken, ROTATED_REFRESH);
  assert.equal(JSON.stringify(status).includes(ROTATED_REFRESH), false);
  assert.equal(new URLSearchParams(value.calls[0].init.body).get('refresh_token'), REFRESH);
  assert.equal(value.calls[0].url, MICROSOFT_MINECRAFT_AUTH_POLICY.tokenEndpoint);
});

test('missing entitlement fails closed and never persists or exposes any provider token', async () => {
  const exchange = minecraftExchangeResponses();
  exchange[4] = response(200, { items: [], signature: 'ignored', keyId: 'ignored' });
  const value = authFixture({ responses: [deviceResponse(), tokenResponse(), ...exchange] });
  await value.auth.initialize();
  const flow = await value.auth.startDeviceFlow();
  await assert.rejects(() => value.auth.pollDeviceFlow(flow.flowId), (error) => (
    error.code === 'MINECRAFT_ENTITLEMENT_REQUIRED' && !error.message.includes(ACCESS) && !error.message.includes(MINECRAFT_ACCESS)
  ));
  assert.equal(value.vault.saves.length, 0);
  assertPublicFlow(await value.auth.pollDeviceFlow(flow.flowId), 'failed');
});

test('wrong scopes, oversized responses, foreign verification URLs, and mismatched Xbox identities are rejected', async () => {
  const wrongUrl = authFixture({ responses: [deviceResponse({ verification_uri: 'https://attacker.invalid/link' })] });
  await wrongUrl.auth.initialize();
  await assert.rejects(() => wrongUrl.auth.startDeviceFlow(), /verification address was invalid/);

  const oversized = authFixture({ responses: [response(200, {}, { 'Content-Length': String(300 * 1024) })] });
  await oversized.auth.initialize();
  await assert.rejects(() => oversized.auth.startDeviceFlow(), (error) => error.code === 'MINECRAFT_AUTH_RESPONSE_INVALID');

  const wrongScope = authFixture({ responses: [deviceResponse(), tokenResponse(REFRESH, { scope: 'XboxLive.signin' })] });
  await wrongScope.auth.initialize();
  const wrongScopeFlow = await wrongScope.auth.startDeviceFlow();
  await assert.rejects(() => wrongScope.auth.pollDeviceFlow(wrongScopeFlow.flowId), /omitted required Xbox scopes/);

  const mismatchResponses = minecraftExchangeResponses();
  mismatchResponses[2] = response(200, {
    NotAfter: '2026-08-13T01:00:00.000Z', Token: 'xsts-token-1234567890',
    DisplayClaims: { xui: [{ uhs: 'different-user' }] },
  });
  const mismatch = authFixture({ responses: [deviceResponse(), tokenResponse(), ...mismatchResponses] });
  await mismatch.auth.initialize();
  const mismatchFlow = await mismatch.auth.startDeviceFlow();
  await assert.rejects(() => mismatch.auth.pollDeviceFlow(mismatchFlow.flowId), /identity changed/);
  assert.equal(mismatch.vault.saves.length, 0);
});

test('missing, malformed, or user-hash-substituted Xbox XUID fails closed before Minecraft login', async () => {
  for (const claims of [
    { uhs: '123456789' },
    { uhs: '123456789', xid: 'not-numeric' },
    { uhs: '123456789', xid: '123456789' },
  ]) {
    const exchange = minecraftExchangeResponses();
    exchange[1] = response(200, {
      NotAfter: '2026-08-13T01:00:00.000Z', Token: 'xbox-services-xsts-token-1234567890',
      DisplayClaims: { xui: [claims] },
    });
    const value = authFixture({ responses: [deviceResponse(), tokenResponse(), ...exchange] });
    await value.auth.initialize();
    const flow = await value.auth.startDeviceFlow();
    await assert.rejects(() => value.auth.pollDeviceFlow(flow.flowId), (error) => (
      error.code === 'MINECRAFT_AUTH_RESPONSE_INVALID' && /XUID/u.test(error.message)
    ));
    assert.equal(value.vault.saves.length, 0);
    assert.equal(value.calls.some((call) => call.url === MICROSOFT_MINECRAFT_AUTH_POLICY.minecraftLoginEndpoint), false);
  }
});

test('sign-out delegates only exact vault removal and clears in-memory flows and sessions', async () => {
  const value = authFixture({ initialVault: savedAccount() });
  await value.auth.initialize();
  const status = await value.auth.signOut();
  assert.equal(value.vault.clears, 1);
  assert.deepEqual(status, {
    provider: 'microsoft', configured: true, signedIn: false, sessionReady: false, status: 'signed-out', account: null,
  });
});

test('corrupt saved refresh/account material is classified as a vault failure and never reaches the network', async () => {
  const value = authFixture({ initialVault: { ...savedAccount(), refreshToken: 'short' } });
  await assert.rejects(() => value.auth.initialize(), (error) => (
    error.code === 'MINECRAFT_ACCOUNT_VAULT_INVALID' && error.statusCode === 500
  ));
  assert.equal(value.calls.length, 0);
});

test('chunked provider responses are cancelled at the byte ceiling without unbounded buffering', async () => {
  let cancelled = false;
  let chunk = 0;
  const oversizedStream = new ReadableStream({
    pull(controller) {
      chunk += 1;
      controller.enqueue(new Uint8Array(chunk === 1 ? 200 * 1024 : 100 * 1024));
    },
    cancel() { cancelled = true; },
  });
  const value = authFixture({ responses: [new Response(oversizedStream, { status: 200 })] });
  await value.auth.initialize();
  await assert.rejects(() => value.auth.startDeviceFlow(), (error) => error.code === 'MINECRAFT_AUTH_RESPONSE_INVALID');
  assert.equal(cancelled, true);
});

test('provider and Minecraft invalid-app responses map to the explicit registration error without provider text', async () => {
  const cases = [
    {
      responses: [response(400, { error: 'invalid_client', error_description: 'private tenant details' })],
      run: async (value) => value.auth.startDeviceFlow(),
    },
    {
      responses: [deviceResponse(), response(400, { error: 'unauthorized_client', error_description: 'private tenant details' })],
      run: async (value) => {
        const flow = await value.auth.startDeviceFlow();
        return value.auth.pollDeviceFlow(flow.flowId);
      },
    },
    {
      responses: [
        deviceResponse(), tokenResponse(), ...minecraftExchangeResponses().slice(0, 3),
        response(403, { path: '/authentication/login_with_xbox', errorType: 'ForbiddenOperationException', errorMessage: 'Invalid app registration' }),
      ],
      run: async (value) => {
        const flow = await value.auth.startDeviceFlow();
        return value.auth.pollDeviceFlow(flow.flowId);
      },
    },
  ];
  for (const entry of cases) {
    const value = authFixture({ responses: entry.responses });
    await value.auth.initialize();
    await assert.rejects(() => entry.run(value), (error) => (
      error.code === 'MINECRAFT_APP_REGISTRATION_REQUIRED'
      && error.statusCode === 503
      && !error.message.includes('private tenant')
      && !error.message.includes('ForbiddenOperationException')
    ));
    assert.equal(value.vault.saves.length, 0);
  }
});

test('invalid_grant clears stale saved identity and exposes reauthentication-required instead of signed-in', async () => {
  const value = authFixture({
    initialVault: savedAccount(),
    responses: [response(400, { error: 'invalid_grant', error_description: 'private token details' })],
  });
  await value.auth.initialize();
  assert.equal(value.auth.status().signedIn, true);
  await assert.rejects(() => value.auth.silentRefresh(), (error) => (
    error.code === 'MINECRAFT_REAUTHENTICATION_REQUIRED' && !error.message.includes('private token')
  ));
  assert.equal(value.vault.clears, 1);
  assert.equal(value.vault.value, null);
  assert.deepEqual(value.auth.status(), {
    provider: 'microsoft', configured: true, signedIn: false, sessionReady: false,
    status: 'reauthentication-required', account: null,
  });
});
