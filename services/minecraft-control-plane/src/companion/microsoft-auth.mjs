import crypto from 'node:crypto';

const CONSUMERS_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const DEVICE_CODE_ENDPOINT = `${CONSUMERS_AUTHORITY}/devicecode`;
const TOKEN_ENDPOINT = `${CONSUMERS_AUTHORITY}/token`;
const XBOX_USER_AUTH_ENDPOINT = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_ENDPOINT = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MINECRAFT_LOGIN_ENDPOINT = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MINECRAFT_ENTITLEMENTS_ENDPOINT = 'https://api.minecraftservices.com/entitlements/mcstore';
const MINECRAFT_PROFILE_ENDPOINT = 'https://api.minecraftservices.com/minecraft/profile';
const DEVICE_SCOPE = 'XboxLive.signin XboxLive.offline_access';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const XBOX_RELYING_PARTY = 'http://auth.xboxlive.com';
const XBOX_SERVICES_RELYING_PARTY = 'http://xboxlive.com';
const MINECRAFT_RELYING_PARTY = 'rp://api.minecraftservices.com/';
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TOKEN_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FLOW_ID = GUID;
const PROFILE_ID = /^[0-9a-f]{32}$/iu;
const PROFILE_NAME = /^[A-Za-z0-9_]{1,16}$/u;
const XBOX_XUID = /^[0-9]{1,20}$/u;
const OPAQUE_TOKEN = /^[\x21-\x7e]+$/u;
const SAFE_USER_CODE = /^[A-Za-z0-9-]{4,32}$/u;
const VERIFICATION_URIS = new Set([
  'https://microsoft.com/devicelogin',
  'https://www.microsoft.com/link',
]);
const ENTITLEMENT_NAMES = new Set(['game_minecraft', 'product_minecraft']);
const TERMINAL_FLOW_STATES = new Set(['complete', 'declined', 'expired', 'failed']);

export class MicrosoftMinecraftAuthError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'MicrosoftMinecraftAuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function authError(statusCode, code, message) {
  return new MicrosoftMinecraftAuthError(statusCode, code, message);
}

function exactObject(value, keys, label, errorCode = 'MINECRAFT_AUTH_RESPONSE_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw authError(502, errorCode, `${label} was invalid.`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw authError(502, errorCode, `${label} was invalid.`);
  }
  return value;
}

function validToken(value, label, { code = 'MINECRAFT_AUTH_RESPONSE_INVALID', statusCode = 502 } = {}) {
  if (typeof value !== 'string' || value.length < 16 || Buffer.byteLength(value) > MAX_TOKEN_BYTES || !OPAQUE_TOKEN.test(value)) {
    throw authError(statusCode, code, `${label} was invalid.`);
  }
  return value;
}

function positiveInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', `${label} was invalid.`);
  }
  return value;
}

function timestamp(value, label, { code = 'MINECRAFT_AUTH_RESPONSE_INVALID', statusCode = 502 } = {}) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw authError(statusCode, code, `${label} was invalid.`);
  }
  return new Date(value).toISOString();
}

function validateConfig(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Minecraft Microsoft auth config must be an object');
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'clientId')) {
    throw new TypeError('Minecraft Microsoft auth config accepts only a public-client clientId; client secrets are forbidden');
  }
  if (value.clientId === undefined || value.clientId === null || value.clientId === '') return null;
  if (typeof value.clientId !== 'string' || !GUID.test(value.clientId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/u.test(value.clientId)) {
    throw authError(503, 'MINECRAFT_APP_REGISTRATION_REQUIRED', 'A valid Microsoft public-client app registration is required for Minecraft sign-in.');
  }
  return Object.freeze({ clientId: value.clientId.toLowerCase() });
}

function publicFlow(flow) {
  return {
    flowId: flow.flowId,
    user_code: flow.userCode,
    verification_uri: flow.verificationUri,
    expiry: new Date(flow.expiresAtMs).toISOString(),
    status: flow.status,
  };
}

function validateVaultRecord(value) {
  exactObject(value, ['schemaVersion', 'provider', 'refreshToken', 'account', 'authenticatedAt'], 'The saved Minecraft account', 'MINECRAFT_ACCOUNT_VAULT_INVALID');
  if (value.schemaVersion !== 1 || value.provider !== 'microsoft') {
    throw authError(500, 'MINECRAFT_ACCOUNT_VAULT_INVALID', 'The saved Minecraft account is invalid.');
  }
  validToken(value.refreshToken, 'The saved Microsoft refresh token', { code: 'MINECRAFT_ACCOUNT_VAULT_INVALID', statusCode: 500 });
  exactObject(value.account, ['id', 'name'], 'The saved Minecraft profile', 'MINECRAFT_ACCOUNT_VAULT_INVALID');
  if (!PROFILE_ID.test(value.account.id) || !PROFILE_NAME.test(value.account.name)) {
    throw authError(500, 'MINECRAFT_ACCOUNT_VAULT_INVALID', 'The saved Minecraft profile is invalid.');
  }
  const authenticatedAt = timestamp(value.authenticatedAt, 'The saved authentication timestamp', { code: 'MINECRAFT_ACCOUNT_VAULT_INVALID', statusCode: 500 });
  return Object.freeze({
    schemaVersion: 1,
    provider: 'microsoft',
    refreshToken: value.refreshToken,
    account: Object.freeze({ id: value.account.id.toLowerCase(), name: value.account.name }),
    authenticatedAt,
  });
}

function publicAccount(account) {
  return account ? { name: account.name } : null;
}

function bearerHeaders(token) {
  return Object.freeze({ Authorization: `Bearer ${token}`, Accept: 'application/json' });
}

function noStoreRequest(init) {
  return {
    ...init,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

async function boundedJsonResponse(response, label) {
  if (!response || !Number.isInteger(response.status) || !response.body || typeof response.body.getReader !== 'function') {
    throw authError(502, 'MINECRAFT_AUTH_PROVIDER_UNAVAILABLE', `${label} was unavailable.`);
  }
  const declared = Number(response.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', `${label} returned too much data.`);
  }
  const chunks = [];
  let total = 0;
  let completed = false;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > MAX_RESPONSE_BYTES) {
        chunk.fill(0);
        void reader.cancel().catch(() => undefined);
        throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', `${label} returned too much data.`);
      }
      chunks.push(chunk);
    }
    completed = true;
  } finally {
    reader.releaseLock?.();
    if (!completed) for (const chunk of chunks) chunk.fill(0);
  }
  const bytes = Buffer.concat(chunks, total);
  for (const chunk of chunks) chunk.fill(0);
  try {
    if (bytes.length < 2 || bytes.length > MAX_RESPONSE_BYTES) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', `${label} returned invalid data.`);
    }
    let body;
    try { body = JSON.parse(bytes.toString('utf8')); }
    catch { throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', `${label} returned invalid data.`); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', `${label} returned invalid data.`);
    }
    return { status: response.status, ok: response.ok === true, body };
  } finally {
    bytes.fill(0);
  }
}

export class MicrosoftMinecraftAuth {
  #operationQueue = Promise.resolve();

  constructor({
    config = null,
    vault,
    fetcher = fetch,
    now = () => Date.now(),
    randomUUID = crypto.randomUUID,
  } = {}) {
    this.config = validateConfig(config);
    if (!vault || typeof vault.load !== 'function' || typeof vault.save !== 'function' || typeof vault.clear !== 'function') {
      throw new TypeError('A Minecraft account vault with load, save, and clear is required');
    }
    if (typeof fetcher !== 'function' || typeof now !== 'function' || typeof randomUUID !== 'function') {
      throw new TypeError('Minecraft auth fetcher, clock, and UUID generator must be functions');
    }
    this.vault = vault;
    this.fetcher = fetcher;
    this.now = now;
    this.randomUUID = randomUUID;
    this.initialized = false;
    this.account = null;
    this.session = null;
    this.reauthenticationRequired = false;
    this.flows = new Map();
  }

  async initialize() {
    if (this.initialized) return this.status();
    const saved = await this.vault.load();
    if (saved) {
      const record = validateVaultRecord(saved);
      this.account = record.account;
    }
    this.initialized = true;
    return this.status();
  }

  status() {
    return {
      provider: 'microsoft',
      configured: this.config !== null,
      signedIn: this.account !== null && !this.reauthenticationRequired,
      sessionReady: this.session !== null && this.session.expiresAtMs > this.now(),
      status: this.reauthenticationRequired ? 'reauthentication-required' : this.account ? 'signed-in' : 'signed-out',
      account: this.reauthenticationRequired ? null : publicAccount(this.account),
    };
  }

  startDeviceFlow() {
    return this.#serialize(() => this.#startDeviceFlow());
  }

  async #startDeviceFlow() {
    this.#assertInitialized();
    const config = this.#requireRegistration();
    const response = await this.#form(DEVICE_CODE_ENDPOINT, {
      client_id: config.clientId,
      scope: DEVICE_SCOPE,
    }, 'Microsoft device authorization');
    if (!response.ok) {
      if (this.#isAppRegistrationError(response)) {
        throw authError(503, 'MINECRAFT_APP_REGISTRATION_REQUIRED', 'A valid Microsoft public-client app registration is required for Minecraft sign-in.');
      }
      throw authError(502, 'MINECRAFT_AUTH_PROVIDER_UNAVAILABLE', 'Microsoft device authorization was unavailable.');
    }
    const body = response.body;
    const deviceCode = validToken(body.device_code, 'The Microsoft device code');
    if (typeof body.user_code !== 'string' || !SAFE_USER_CODE.test(body.user_code)) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', 'The Microsoft user code was invalid.');
    }
    if (typeof body.verification_uri !== 'string' || !VERIFICATION_URIS.has(body.verification_uri)) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', 'The Microsoft verification address was invalid.');
    }
    const expiresIn = positiveInteger(body.expires_in, 60, 1_800, 'The Microsoft device-code lifetime');
    const interval = positiveInteger(body.interval, 1, 30, 'The Microsoft device-code polling interval');
    const flowId = this.randomUUID();
    if (typeof flowId !== 'string' || !FLOW_ID.test(flowId)) throw new Error('Secure flow UUID generation failed');
    const now = this.now();
    this.flows.clear();
    const flow = {
      flowId: flowId.toLowerCase(),
      deviceCode,
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      expiresAtMs: now + expiresIn * 1_000,
      intervalMs: interval * 1_000,
      nextPollAtMs: now,
      status: 'pending',
    };
    this.flows.set(flow.flowId, flow);
    return publicFlow(flow);
  }

  pollDeviceFlow(flowId) {
    return this.#serialize(() => this.#pollDeviceFlow(flowId));
  }

  async #pollDeviceFlow(flowId) {
    this.#assertInitialized();
    const config = this.#requireRegistration();
    if (typeof flowId !== 'string' || !FLOW_ID.test(flowId)) {
      throw authError(404, 'MINECRAFT_AUTH_FLOW_NOT_FOUND', 'The Minecraft sign-in flow was not found.');
    }
    const flow = this.flows.get(flowId.toLowerCase());
    if (!flow) throw authError(404, 'MINECRAFT_AUTH_FLOW_NOT_FOUND', 'The Minecraft sign-in flow was not found.');
    const now = this.now();
    if (now >= flow.expiresAtMs && !TERMINAL_FLOW_STATES.has(flow.status)) {
      flow.status = 'expired';
      flow.deviceCode = null;
    }
    if (TERMINAL_FLOW_STATES.has(flow.status)) return publicFlow(flow);
    if (now < flow.nextPollAtMs) return publicFlow(flow);

    const response = await this.#form(TOKEN_ENDPOINT, {
      grant_type: DEVICE_GRANT,
      client_id: config.clientId,
      device_code: flow.deviceCode,
    }, 'Microsoft device token exchange');
    if (!response.ok) {
      const error = response.body.error;
      if (this.#isAppRegistrationError(response)) {
        flow.status = 'failed';
        flow.deviceCode = null;
        throw authError(503, 'MINECRAFT_APP_REGISTRATION_REQUIRED', 'A valid Microsoft public-client app registration is required for Minecraft sign-in.');
      }
      if (error === 'authorization_pending') {
        flow.status = 'pending';
        flow.nextPollAtMs = now + flow.intervalMs;
        return publicFlow(flow);
      }
      if (error === 'slow_down') {
        flow.intervalMs = Math.min(60_000, flow.intervalMs + 5_000);
        flow.nextPollAtMs = now + flow.intervalMs;
        flow.status = 'slow_down';
        return publicFlow(flow);
      }
      if (error === 'authorization_declined') {
        flow.status = 'declined';
        flow.deviceCode = null;
        return publicFlow(flow);
      }
      if (error === 'expired_token' || error === 'bad_verification_code') {
        flow.status = 'expired';
        flow.deviceCode = null;
        return publicFlow(flow);
      }
      flow.status = 'failed';
      flow.deviceCode = null;
      throw authError(502, 'MINECRAFT_AUTH_PROVIDER_UNAVAILABLE', 'Microsoft device sign-in failed.');
    }

    try {
      const microsoft = this.#microsoftToken(response.body, true);
      const session = await this.#exchangeForMinecraft(microsoft.accessToken);
      const saved = validateVaultRecord({
        schemaVersion: 1,
        provider: 'microsoft',
        refreshToken: microsoft.refreshToken,
        account: session.account,
        authenticatedAt: new Date(now).toISOString(),
      });
      await this.vault.save(saved);
      this.account = saved.account;
      this.session = session;
      this.reauthenticationRequired = false;
      flow.status = 'complete';
      flow.deviceCode = null;
      return publicFlow(flow);
    } catch (error) {
      flow.status = 'failed';
      flow.deviceCode = null;
      throw error;
    }
  }

  silentRefresh() {
    return this.#serialize(() => this.#silentRefresh());
  }

  async #silentRefresh() {
    this.#assertInitialized();
    const config = this.#requireRegistration();
    const savedValue = await this.vault.load();
    if (!savedValue) throw authError(401, 'MINECRAFT_SIGN_IN_REQUIRED', 'Minecraft Microsoft sign-in is required.');
    const saved = validateVaultRecord(savedValue);
    const response = await this.#form(TOKEN_ENDPOINT, {
      grant_type: 'refresh_token',
      client_id: config.clientId,
      refresh_token: saved.refreshToken,
      scope: DEVICE_SCOPE,
    }, 'Microsoft token refresh');
    if (!response.ok) {
      if (this.#isAppRegistrationError(response)) {
        throw authError(503, 'MINECRAFT_APP_REGISTRATION_REQUIRED', 'A valid Microsoft public-client app registration is required for Minecraft sign-in.');
      }
      if (response.body.error === 'invalid_grant' || response.body.error === 'interaction_required') {
        await this.vault.clear();
        this.session = null;
        this.account = null;
        this.reauthenticationRequired = true;
        throw authError(401, 'MINECRAFT_REAUTHENTICATION_REQUIRED', 'Minecraft Microsoft sign-in must be completed again.');
      }
      throw authError(502, 'MINECRAFT_AUTH_PROVIDER_UNAVAILABLE', 'Microsoft token refresh was unavailable.');
    }
    const microsoft = this.#microsoftToken(response.body, true);
    const session = await this.#exchangeForMinecraft(microsoft.accessToken);
    const rotated = validateVaultRecord({
      schemaVersion: 1,
      provider: 'microsoft',
      refreshToken: microsoft.refreshToken,
      account: session.account,
      authenticatedAt: new Date(this.now()).toISOString(),
    });
    await this.vault.save(rotated);
    this.account = rotated.account;
    this.session = session;
    this.reauthenticationRequired = false;
    return this.status();
  }

  minecraftSession() {
    this.#assertInitialized();
    if (!this.session || this.session.expiresAtMs <= this.now()) {
      throw authError(401, 'MINECRAFT_SESSION_REFRESH_REQUIRED', 'The Minecraft session must be refreshed before launch.');
    }
    return {
      username: this.session.account.name,
      uuid: this.session.account.id,
      accessToken: this.session.accessToken,
      xuid: this.session.xuid,
      clientId: this.config.clientId,
    };
  }

  signOut() {
    return this.#serialize(async () => {
      this.#assertInitialized();
      await this.vault.clear();
      this.flows.clear();
      this.session = null;
      this.account = null;
      this.reauthenticationRequired = false;
      return this.status();
    });
  }

  #microsoftToken(body, requireRefreshToken) {
    if (body.token_type !== 'Bearer') throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', 'The Microsoft token response was invalid.');
    const accessToken = validToken(body.access_token, 'The Microsoft access token');
    const refreshToken = requireRefreshToken ? validToken(body.refresh_token, 'The Microsoft refresh token') : null;
    const expiresIn = positiveInteger(body.expires_in, 60, 86_400, 'The Microsoft access-token lifetime');
    if (typeof body.scope !== 'string' || body.scope.length > 512 || /[\u0000-\u001f\u007f]/u.test(body.scope)) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', 'The Microsoft token scope was invalid.');
    }
    const scopes = new Set(body.scope.split(/\s+/u).filter(Boolean));
    if (!scopes.has('XboxLive.signin') || !scopes.has('XboxLive.offline_access')) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', 'The Microsoft token omitted required Xbox scopes.');
    }
    return { accessToken, refreshToken, expiresIn };
  }

  async #exchangeForMinecraft(microsoftAccessToken) {
    const xbox = await this.#json(XBOX_USER_AUTH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
      body: JSON.stringify({
        Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${microsoftAccessToken}` },
        RelyingParty: XBOX_RELYING_PARTY,
        TokenType: 'JWT',
      }),
    }, 'Xbox user authentication');
    if (!xbox.ok) throw authError(401, 'XBOX_LIVE_AUTHENTICATION_FAILED', 'Xbox Live authentication failed.');
    const xboxToken = validToken(xbox.body.Token, 'The Xbox user token');
    const { userHash } = this.#xboxClaims(xbox.body, 'The Xbox user identity');
    timestamp(xbox.body.NotAfter, 'The Xbox user-token expiry');

    const xboxServices = await this.#json(XSTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
      body: JSON.stringify({
        Properties: { SandboxId: 'RETAIL', UserTokens: [xboxToken] },
        RelyingParty: XBOX_SERVICES_RELYING_PARTY,
        TokenType: 'JWT',
      }),
    }, 'Xbox services identity authorization');
    if (!xboxServices.ok) throw authError(403, 'XSTS_AUTHORIZATION_FAILED', 'The Microsoft account is not authorized for Xbox services.');
    validToken(xboxServices.body.Token, 'The Xbox services security token');
    timestamp(xboxServices.body.NotAfter, 'The Xbox services security-token expiry');
    const xboxServicesClaims = this.#xboxClaims(xboxServices.body, 'The Xbox services identity', { requireXuid: true });
    if (xboxServicesClaims.userHash !== userHash) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', 'The Xbox identity changed during authentication.');
    }

    const minecraftXsts = await this.#json(XSTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
      body: JSON.stringify({
        Properties: { SandboxId: 'RETAIL', UserTokens: [xboxToken] },
        RelyingParty: MINECRAFT_RELYING_PARTY,
        TokenType: 'JWT',
      }),
    }, 'Minecraft Xbox security-token authorization');
    if (!minecraftXsts.ok) throw authError(403, 'XSTS_AUTHORIZATION_FAILED', 'The Microsoft account is not authorized for Minecraft through Xbox Live.');
    const xstsToken = validToken(minecraftXsts.body.Token, 'The Minecraft Xbox security token');
    const minecraftClaims = this.#xboxClaims(minecraftXsts.body, 'The Minecraft Xbox security identity');
    if (minecraftClaims.userHash !== userHash || (minecraftClaims.xuid !== null && minecraftClaims.xuid !== xboxServicesClaims.xuid)) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', 'The Xbox identity changed during authentication.');
    }
    timestamp(minecraftXsts.body.NotAfter, 'The Minecraft Xbox security-token expiry');

    const login = await this.#json(MINECRAFT_LOGIN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsToken}` }),
    }, 'Minecraft services login');
    if (!login.ok) {
      if (this.#isAppRegistrationError(login, { minecraftServices: true })) {
        throw authError(503, 'MINECRAFT_APP_REGISTRATION_REQUIRED', 'A valid Microsoft public-client app registration is required for Minecraft sign-in.');
      }
      throw authError(401, 'MINECRAFT_SERVICES_LOGIN_FAILED', 'Minecraft services login failed.');
    }
    if (login.body.token_type !== 'Bearer') throw authError(401, 'MINECRAFT_SERVICES_LOGIN_FAILED', 'Minecraft services login failed.');
    const minecraftAccessToken = validToken(login.body.access_token, 'The Minecraft access token');
    const minecraftExpiresIn = positiveInteger(login.body.expires_in, 60, 86_400, 'The Minecraft access-token lifetime');

    const [entitlements, profile] = await Promise.all([
      this.#json(MINECRAFT_ENTITLEMENTS_ENDPOINT, { method: 'GET', headers: bearerHeaders(minecraftAccessToken) }, 'Minecraft entitlements'),
      this.#json(MINECRAFT_PROFILE_ENDPOINT, { method: 'GET', headers: bearerHeaders(minecraftAccessToken) }, 'Minecraft profile'),
    ]);
    if (!entitlements.ok || !Array.isArray(entitlements.body.items) || !entitlements.body.items.some((item) => (
      item && typeof item === 'object' && !Array.isArray(item) && ENTITLEMENT_NAMES.has(item.name)
    ))) throw authError(403, 'MINECRAFT_ENTITLEMENT_REQUIRED', 'This Microsoft account does not have a verified Minecraft entitlement.');
    if (!profile.ok || !PROFILE_ID.test(profile.body.id ?? '') || !PROFILE_NAME.test(profile.body.name ?? '')) {
      throw authError(403, 'MINECRAFT_PROFILE_REQUIRED', 'This Microsoft account does not have a valid Minecraft Java profile.');
    }
    return {
      accessToken: minecraftAccessToken,
      expiresAtMs: this.now() + minecraftExpiresIn * 1_000,
      xuid: xboxServicesClaims.xuid,
      account: { id: profile.body.id.toLowerCase(), name: profile.body.name },
    };
  }

  #xboxClaims(body, label, { requireXuid = false } = {}) {
    const xui = body?.DisplayClaims?.xui;
    const claims = Array.isArray(xui) && xui.length === 1 && xui[0] && typeof xui[0] === 'object' && !Array.isArray(xui[0])
      ? xui[0]
      : null;
    const userHash = claims?.uhs;
    if (typeof userHash !== 'string' || userHash.length < 1 || userHash.length > 128 || !/^[A-Za-z0-9._-]+$/u.test(userHash)) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', `${label} was invalid.`);
    }
    const rawXuid = claims?.xid;
    if (rawXuid !== undefined && (typeof rawXuid !== 'string' || !XBOX_XUID.test(rawXuid) || rawXuid === userHash)) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', `${label} contained an invalid Xbox XUID.`);
    }
    if (requireXuid && rawXuid === undefined) {
      throw authError(502, 'MINECRAFT_AUTH_RESPONSE_INVALID', `${label} omitted the Xbox XUID.`);
    }
    return { userHash, xuid: rawXuid ?? null };
  }

  async #form(url, fields, label) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return this.#json(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    }, label);
  }

  async #json(url, init, label) {
    let response;
    try { response = await this.fetcher(url, noStoreRequest(init)); }
    catch { throw authError(502, 'MINECRAFT_AUTH_PROVIDER_UNAVAILABLE', `${label} was unavailable.`); }
    try { return await boundedJsonResponse(response, label); }
    catch (error) {
      if (error instanceof MicrosoftMinecraftAuthError) throw error;
      throw authError(502, 'MINECRAFT_AUTH_PROVIDER_UNAVAILABLE', `${label} was unavailable.`);
    }
  }

  #requireRegistration() {
    if (!this.config) {
      throw authError(503, 'MINECRAFT_APP_REGISTRATION_REQUIRED', 'A Microsoft public-client app registration is required for Minecraft sign-in.');
    }
    return this.config;
  }

  #isAppRegistrationError(response, { minecraftServices = false } = {}) {
    if (!response || ![400, 401, 403].includes(response.status)) return false;
    if (['invalid_client', 'unauthorized_client'].includes(response.body?.error)) return true;
    if (!minecraftServices || response.status !== 403) return false;
    return response.body?.errorMessage === 'Invalid app registration'
      || response.body?.error === 'Invalid app registration';
  }

  #assertInitialized() {
    if (!this.initialized) throw new Error('MicrosoftMinecraftAuth.initialize() must complete first');
  }

  #serialize(operation) {
    const current = this.#operationQueue.catch(() => undefined).then(operation);
    this.#operationQueue = current;
    return current;
  }
}

export const MICROSOFT_MINECRAFT_AUTH_POLICY = Object.freeze({
  authority: CONSUMERS_AUTHORITY,
  deviceCodeEndpoint: DEVICE_CODE_ENDPOINT,
  tokenEndpoint: TOKEN_ENDPOINT,
  scope: DEVICE_SCOPE,
  xboxUserAuthEndpoint: XBOX_USER_AUTH_ENDPOINT,
  xstsEndpoint: XSTS_ENDPOINT,
  xboxServicesRelyingParty: XBOX_SERVICES_RELYING_PARTY,
  minecraftRelyingParty: MINECRAFT_RELYING_PARTY,
  minecraftLoginEndpoint: MINECRAFT_LOGIN_ENDPOINT,
  minecraftEntitlementsEndpoint: MINECRAFT_ENTITLEMENTS_ENDPOINT,
  minecraftProfileEndpoint: MINECRAFT_PROFILE_ENDPOINT,
  maxResponseBytes: MAX_RESPONSE_BYTES,
});
