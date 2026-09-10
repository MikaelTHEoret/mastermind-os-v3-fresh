import crypto from 'node:crypto';

import { LOCAL_FAMILY_OPERATOR_PROFILE } from './local-family-profile.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const PIN = /^[0-9]{6,12}$/;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const COOKIE_NAME = 'mastermind_memory_operator_v1';
const COOKIE_PATH = '/api/memory/operator';
const SESSION_SECONDS = 10 * 60;
const PIN_VERIFIER = /^v1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
const SESSION_HMAC_DOMAIN = 'mastermind-memory-operator-session-v1\0';
const SCRYPT_OPTIONS: crypto.ScryptOptions = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
// Server-only salted verifier for the private family-PC code. The raw code is
// deliberately not needed by the runtime configuration.
const LOCAL_FAMILY_OPERATOR_PIN_VERIFIER = 'v1$dswwkO3f4zhOeU6HcM5YaA$SLq32PM_WP4XY7xxWVQPZYefOPHXBUUQ5RgUzHTNfic';

export type MemoryOperatorEnvironment = Readonly<{
  MASTERMIND_LOCAL_CONTROL_ENABLED?: string;
  MASTERMIND_CONTROL_TOKEN?: string;
  MASTERMIND_LOCAL_SUPERVISOR_ID?: string;
  MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT?: string;
  MASTERMIND_MEMORY_OPERATOR_PLAYER_ID?: string;
  MASTERMIND_MEMORY_HOUSEHOLD_ID?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  OWNER_CLERK_USER_ID?: string;
  VERCEL?: string;
}>;

export type MemoryOperatorConfiguration = Readonly<{
  householdId: string;
  playerId: string;
  pinVerifier: string;
  signingKey: string;
  supervisorId: string;
  clerkRequired: boolean;
}>;

export type MemoryOperatorSession = Readonly<{
  householdId: string;
  playerId: string;
  issuedAt: number;
  expiresAt: number;
}>;

export class MemoryOperatorRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'MemoryOperatorRequestError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function reject(status: number, code: string, message: string, retryAfterSeconds?: number): never {
  throw new MemoryOperatorRequestError(status, code, message, retryAfterSeconds);
}

function exactObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readMemoryOperatorConfiguration(env: MemoryOperatorEnvironment): MemoryOperatorConfiguration {
  if (env.VERCEL) {
    reject(503, 'MEMORY_OPERATOR_LOCAL_ONLY', 'The memory operator is available only from the command center running on this PC.');
  }
  if (env.MASTERMIND_LOCAL_CONTROL_ENABLED !== 'true') {
    reject(503, 'MEMORY_OPERATOR_DISABLED', 'The local memory operator is disabled.');
  }
  const signingKey = env.MASTERMIND_CONTROL_TOKEN ?? '';
  const supervisorId = env.MASTERMIND_LOCAL_SUPERVISOR_ID ?? '';
  const pinVerifier = env.MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT
    || LOCAL_FAMILY_OPERATOR_PIN_VERIFIER;
  const playerId = env.MASTERMIND_MEMORY_OPERATOR_PLAYER_ID
    || LOCAL_FAMILY_OPERATOR_PROFILE.parentPlayerId;
  const householdId = env.MASTERMIND_MEMORY_HOUSEHOLD_ID
    || LOCAL_FAMILY_OPERATOR_PROFILE.householdId;
  const clerkValues = [
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    env.CLERK_SECRET_KEY,
    env.OWNER_CLERK_USER_ID,
  ];
  const clerkCount = clerkValues.filter(Boolean).length;
  if (
    signingKey.length < 32
    || signingKey.length > 512
    || !/^[a-f0-9]{32}$/.test(supervisorId)
    || !PIN_VERIFIER.test(pinVerifier)
    || !UUID.test(playerId)
    || !SAFE_ID.test(householdId)
    || (clerkCount !== 0 && clerkCount !== clerkValues.length)
  ) {
    reject(503, 'MEMORY_OPERATOR_CONFIGURATION_INVALID', 'The memory operator configuration is incomplete.');
  }
  return Object.freeze({
    householdId,
    playerId,
    pinVerifier,
    signingKey,
    supervisorId,
    clerkRequired: clerkCount === clerkValues.length,
  });
}

export function authorizeMemoryOperatorBrowserRequest(
  request: Request,
  expectedPath: string,
  env: MemoryOperatorEnvironment,
): MemoryOperatorConfiguration {
  const config = readMemoryOperatorConfiguration(env);
  if (request.method !== 'POST') {
    reject(405, 'METHOD_NOT_ALLOWED', 'The memory operator accepts POST requests only.');
  }
  let requestUrl: URL;
  let hostUrl: URL;
  try {
    requestUrl = new URL(request.url);
    hostUrl = new URL(`http://${request.headers.get('host') ?? ''}`);
  } catch {
    reject(403, 'MEMORY_OPERATOR_LOCAL_REQUEST_REQUIRED', 'The memory operator accepts only local command-center requests.');
  }
  if (
    requestUrl.protocol !== 'http:'
    || !LOCAL_HOSTS.has(requestUrl.hostname)
    || !LOCAL_HOSTS.has(hostUrl.hostname)
    // Next may normalize Request.url between the two equivalent loopback names.
    // The Host header remains the browser-facing authority; only the internal
    // hostname alias is tolerated, and the socket port must still match exactly.
    || requestUrl.port !== hostUrl.port
    || requestUrl.pathname !== expectedPath
    || requestUrl.search
    || requestUrl.hash
    || requestUrl.username
    || requestUrl.password
    || hostUrl.pathname !== '/'
    || hostUrl.search
    || hostUrl.hash
    || hostUrl.username
    || hostUrl.password
  ) {
    reject(403, 'MEMORY_OPERATOR_LOCAL_REQUEST_REQUIRED', 'The memory operator accepts only local command-center requests.');
  }
  const expectedOrigin = `http://${hostUrl.host}`;
  if (
    request.headers.get('origin') !== expectedOrigin
    || request.headers.get('sec-fetch-site') !== 'same-origin'
  ) {
    reject(403, 'MEMORY_OPERATOR_ORIGIN_REQUIRED', 'The memory operator requires a same-origin browser request.');
  }
  return config;
}

export class MemoryOperatorUnlockLimiter {
  #failures = 0;
  #windowStartedAt = 0;
  #blockedUntil = 0;
  readonly maximumFailures: number;
  readonly windowMs: number;
  readonly blockMs: number;

  constructor(
    maximumFailures = 5,
    windowMs = 5 * 60_000,
    blockMs = 30_000,
  ) {
    if (!Number.isSafeInteger(maximumFailures) || maximumFailures < 1
      || !Number.isSafeInteger(windowMs) || windowMs < 1
      || !Number.isSafeInteger(blockMs) || blockMs < 1) {
      throw new TypeError('The unlock limiter configuration is invalid.');
    }
    this.maximumFailures = maximumFailures;
    this.windowMs = windowMs;
    this.blockMs = blockMs;
  }

  assertAllowed(now: number): void {
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('The current time is invalid.');
    if (now < this.#blockedUntil) {
      const seconds = Math.max(1, Math.ceil((this.#blockedUntil - now) / 1000));
      reject(429, 'MEMORY_OPERATOR_RATE_LIMITED', 'Too many unlock attempts. Wait briefly before trying again.', seconds);
    }
  }

  recordFailure(now: number): void {
    if (this.#windowStartedAt === 0 || now - this.#windowStartedAt > this.windowMs) {
      this.#windowStartedAt = now;
      this.#failures = 0;
    }
    this.#failures += 1;
    if (this.#failures >= this.maximumFailures) {
      this.#blockedUntil = now + this.blockMs;
      this.#failures = 0;
      this.#windowStartedAt = now;
    }
  }

  recordSuccess(): void {
    this.#failures = 0;
    this.#windowStartedAt = 0;
    this.#blockedUntil = 0;
  }
}

export type MemoryOperatorScrypt = (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const defaultScrypt: MemoryOperatorScrypt = (password, salt, keyLength, options) => new Promise((resolve, rejectPromise) => {
  crypto.scrypt(password, salt, keyLength, options, (error, derivedKey) => {
    if (error) rejectPromise(error);
    else resolve(derivedKey);
  });
});

export async function createMemoryOperatorPinVerifier(
  pin: string,
  options: Readonly<{
    randomBytes?: (size: number) => Buffer;
    scrypt?: MemoryOperatorScrypt;
  }> = {},
): Promise<string> {
  if (!PIN.test(pin)) throw new TypeError('The operator PIN must contain 6 to 12 digits.');
  const salt = (options.randomBytes ?? crypto.randomBytes)(16);
  if (!Buffer.isBuffer(salt) || salt.length !== 16) throw new Error('The PIN salt is invalid.');
  const digest = await (options.scrypt ?? defaultScrypt)(pin, salt, 32, SCRYPT_OPTIONS);
  if (!Buffer.isBuffer(digest) || digest.length !== 32) throw new Error('The PIN verifier is invalid.');
  return `v1$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

export async function verifyMemoryOperatorPin(
  candidate: unknown,
  config: MemoryOperatorConfiguration,
  scrypt: MemoryOperatorScrypt = defaultScrypt,
): Promise<boolean> {
  const match = PIN_VERIFIER.exec(config.pinVerifier);
  if (!match) throw new Error('The operator PIN verifier is invalid.');
  const suppliedIsValid = typeof candidate === 'string' && PIN.test(candidate);
  const salt = Buffer.from(match[1], 'base64url');
  const expected = Buffer.from(match[2], 'base64url');
  const actual = await scrypt(suppliedIsValid ? candidate as string : '000000', salt, 32, SCRYPT_OPTIONS);
  if (!Buffer.isBuffer(actual) || actual.length !== 32 || expected.length !== 32) {
    throw new Error('The operator PIN verifier is invalid.');
  }
  return suppliedIsValid && crypto.timingSafeEqual(expected, actual);
}

function signature(payload: string, key: string): string {
  return crypto.createHmac('sha256', key).update(SESSION_HMAC_DOMAIN, 'ascii').update(payload, 'ascii').digest('base64url');
}

export function createMemoryOperatorSession(
  config: MemoryOperatorConfiguration,
  options: Readonly<{ now?: number; randomBytes?: (size: number) => Buffer }> = {},
): Readonly<{ session: MemoryOperatorSession; token: string; setCookie: string }> {
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('The current time is invalid.');
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + SESSION_SECONDS;
  const randomBytes = options.randomBytes ?? crypto.randomBytes;
  const nonce = randomBytes(16).toString('hex');
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error('The session nonce is invalid.');
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    supervisorId: config.supervisorId,
    householdId: config.householdId,
    playerId: config.playerId,
    issuedAt,
    expiresAt,
    nonce,
  }), 'utf8').toString('base64url');
  const token = `${payload}.${signature(payload, config.signingKey)}`;
  return Object.freeze({
    session: Object.freeze({ householdId: config.householdId, playerId: config.playerId, issuedAt, expiresAt }),
    token,
    setCookie: `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=${SESSION_SECONDS}`,
  });
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  if (header.length > 4096) return null;
  const values = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (values.length !== 1) return null;
  return values[0].slice(COOKIE_NAME.length + 1);
}

export function readMemoryOperatorSession(
  request: Request,
  config: MemoryOperatorConfiguration,
  now = Date.now(),
): MemoryOperatorSession | null {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('The current time is invalid.');
  const token = cookieValue(request);
  if (!token || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = signature(parts[0], config.signingKey);
  const expectedBytes = Buffer.from(expected, 'ascii');
  const suppliedBytes = Buffer.from(parts[1], 'ascii');
  if (expectedBytes.length !== suppliedBytes.length || !crypto.timingSafeEqual(expectedBytes, suppliedBytes)) return null;
  let parsed: Record<string, unknown> | null;
  try {
    if (parts[0].length > 1024) return null;
    parsed = exactObject(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
  } catch {
    return null;
  }
  if (!parsed || Object.keys(parsed).sort().join('\0') !== 'expiresAt\0householdId\0issuedAt\0nonce\0playerId\0supervisorId\0v') return null;
  if (
    parsed.v !== 1
    || parsed.supervisorId !== config.supervisorId
    || parsed.householdId !== config.householdId
    || parsed.playerId !== config.playerId
    || typeof parsed.issuedAt !== 'number'
    || typeof parsed.expiresAt !== 'number'
    || !Number.isSafeInteger(parsed.issuedAt)
    || !Number.isSafeInteger(parsed.expiresAt)
    || parsed.expiresAt - parsed.issuedAt !== SESSION_SECONDS
    || typeof parsed.nonce !== 'string'
    || !/^[a-f0-9]{32}$/.test(parsed.nonce)
  ) return null;
  const nowSeconds = Math.floor(now / 1000);
  if (parsed.issuedAt > nowSeconds + 30 || parsed.expiresAt <= nowSeconds) return null;
  return Object.freeze({
    householdId: config.householdId,
    playerId: config.playerId,
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expiresAt,
  });
}

export function clearMemoryOperatorCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=0`;
}

export class MemoryOperatorSessionRegistry {
  #activeDigest: Buffer | null = null;

  activate(token: string): void {
    this.#activeDigest = crypto.createHash('sha256').update(token, 'ascii').digest();
  }

  isActive(token: string | null): boolean {
    if (!token || !this.#activeDigest) return false;
    const candidate = crypto.createHash('sha256').update(token, 'ascii').digest();
    return crypto.timingSafeEqual(this.#activeDigest, candidate);
  }

  clear(): void {
    this.#activeDigest = null;
  }
}

export class MemoryOperatorUnlockCoordinator {
  #tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function readMemoryOperatorSessionToken(request: Request): string | null {
  return cookieValue(request);
}

export const MEMORY_OPERATOR_AUTH_POLICY = Object.freeze({
  cookieName: COOKIE_NAME,
  cookiePath: COOKIE_PATH,
  sessionSeconds: SESSION_SECONDS,
  pinPattern: PIN,
  pinVerifierPattern: PIN_VERIFIER,
});
