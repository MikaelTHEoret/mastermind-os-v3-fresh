import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireLaunchIntegrityKey } from '../integrity-key-continuity.mjs';

const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const CONFIG_NAME = 'mastermind-family-core.properties';
const ENDPOINT = 'ws://127.0.0.1:43100/v1/family-core/bridge';

function credentialError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

async function regularFileBytes(file, minimum, maximum) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || before.size < minimum || before.size > maximum) {
    throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'A Family Core credential file is not an exact bounded regular file.');
  }
  const bytes = await fs.readFile(file);
  const after = await fs.lstat(file);
  if (bytes.length !== before.size || !after.isFile() || after.isSymbolicLink() || after.nlink !== 1
    || after.size !== before.size
    || (before.ino && after.ino && (before.dev !== after.dev || before.ino !== after.ino))) {
    throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'A Family Core credential file changed during verification.');
  }
  return bytes;
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw credentialError('FAMILY_CORE_CREDENTIAL_UNAVAILABLE', 'A Family Core credential directory is unsafe.');
  }
}

async function writeExclusive(file, bytes) {
  const handle = await fs.open(file, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function configText({ sessionId, serverInstanceId, tokenFile, computerCommandEnabled, identityEventsEnabled, chatCaptureEnabled }) {
  const values = [
    ['serverBridge.enabled', 'true'],
    ['serverBridge.endpoint', ENDPOINT],
    ['serverBridge.sessionId', sessionId],
    ['serverBridge.instanceId', serverInstanceId],
    ['serverBridge.tokenFile', tokenFile],
    ['serverBridge.heartbeatTicks', '100'],
    ['computerCommand.enabled', computerCommandEnabled ? 'true' : 'false'],
    ['identityEvents.enabled', identityEventsEnabled ? 'true' : 'false'],
    ['chatCapture.enabled', chatCaptureEnabled ? 'true' : 'false'],
    ['companionTelemetry.enabled', 'false'],
  ];
  for (const [, value] of values) {
    if (/[^\x20-\x7e]/.test(value)) throw new TypeError('Family Core configuration contains unsafe text');
  }
  return `${values.map(([key, value]) => `${key}=${value.replaceAll('\\', '\\\\')}`).join('\n')}\n`;
}

export class FamilyCoreCredentialManager {
  constructor(managedRoot, options = {}) {
    if (typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)) throw new TypeError('A managed root is required');
    this.managedRoot = path.resolve(managedRoot);
    this.stateRoot = path.join(this.managedRoot, 'state', 'family-core-bridge');
    this.tokenFile = path.join(this.stateRoot, 'server.token');
    this.manifestFile = path.join(this.stateRoot, 'credential.v1.json');
    this.acquireIntegrityKey = options.acquireIntegrityKey ?? acquireLaunchIntegrityKey;
    if (options.integrityKey !== undefined && (!Buffer.isBuffer(options.integrityKey) || options.integrityKey.length !== 32)) {
      throw new TypeError('Family Core credential integrity key must contain exactly 32 bytes');
    }
    this.suppliedIntegrityKey = options.integrityKey === undefined ? null : Buffer.from(options.integrityKey);
    this.randomBytes = options.randomBytes ?? crypto.randomBytes;
    this.randomUUID = options.randomUUID ?? crypto.randomUUID;
    this.now = options.now ?? (() => Date.now());
    this.integrityKey = null;
    this.current = null;
  }

  async initialize() {
    await ensureDirectory(this.stateRoot);
    if (this.suppliedIntegrityKey !== null) {
      this.integrityKey = Buffer.from(this.suppliedIntegrityKey);
    } else {
      const lease = await this.acquireIntegrityKey(this.managedRoot, { createIfMissing: true });
      try {
        if (!Buffer.isBuffer(lease?.key) || lease.key.length !== 32) {
          throw credentialError('FAMILY_CORE_CREDENTIAL_UNAVAILABLE', 'The Family Core credential integrity key is unavailable.');
        }
        this.integrityKey = Buffer.from(lease.key);
      } finally {
        await lease?.release?.();
      }
    }
    this.current = await this.#readManifest({ allowMissing: true });
    if (this.current === null && await this.#exists(this.tokenFile)) {
      throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'An orphaned Family Core token requires verified cleanup.');
    }
    return this.status();
  }

  async reconcile(instance, { active }) {
    this.#requireInitialized();
    const configFile = this.#configFile(instance);
    if (this.current === null) {
      if (await this.#exists(configFile)) {
        throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'An unmanaged Family Core runtime configuration requires verified cleanup.');
      }
      return { action: 'clean' };
    }
    this.#assertManifestPaths(this.current, instance);
    await this.#verifyFiles(this.current);
    if (active === true) return { action: 'retained-active', generation: this.current.generation };
    await this.#cleanup(this.current);
    return { action: 'removed-stale' };
  }

  async prepareLaunch(instance, { computerCommandEnabled = false, identityEventsEnabled = false, chatCaptureEnabled = false } = {}) {
    this.#requireInitialized();
    if (typeof computerCommandEnabled !== 'boolean') throw new TypeError('computerCommandEnabled must be boolean');
    if (typeof identityEventsEnabled !== 'boolean') throw new TypeError('identityEventsEnabled must be boolean');
    if (typeof chatCaptureEnabled !== 'boolean') throw new TypeError('chatCaptureEnabled must be boolean');
    const configFile = this.#configFile(instance);
    if (this.current !== null || await this.#exists(this.tokenFile) || await this.#exists(configFile)) {
      throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'Family Core credentials already exist and were not replaced.');
    }
    const tokenBytes = this.randomBytes(48);
    if (!Buffer.isBuffer(tokenBytes) || tokenBytes.length !== 48) throw new TypeError('Family Core token generator returned invalid bytes');
    const token = tokenBytes.toString('base64url');
    if (!TOKEN.test(token)) throw new TypeError('Family Core token generator returned an invalid token');
    const sessionId = this.randomUUID().toLowerCase();
    const serverInstanceId = this.randomUUID().toLowerCase();
    if (!UUID.test(sessionId) || !UUID.test(serverInstanceId)) throw new TypeError('Family Core UUID generator returned an invalid UUID');
    const config = configText({
      sessionId,
      serverInstanceId,
      tokenFile: this.tokenFile,
      computerCommandEnabled,
      identityEventsEnabled,
      chatCaptureEnabled,
    });
    const base = {
      schemaVersion: 2,
      instanceId: instance.id,
      sessionId,
      serverInstanceId,
      tokenSha256: digest(token),
      tokenFile: this.tokenFile,
      configFile,
      configSha256: digest(config),
      computerCommandEnabled,
      identityEventsEnabled,
      chatCaptureEnabled,
      createdAt: new Date(this.now()).toISOString(),
    };
    const credential = Object.freeze({ ...base, generation: digest(canonical(base)) });
    const wrapper = {
      credential,
      mac: crypto.createHmac('sha256', this.integrityKey)
        .update(`family-core-credential-v${credential.schemaVersion}\n${canonical(credential)}`).digest('hex'),
    };
    await ensureDirectory(path.dirname(configFile));
    try {
      await writeExclusive(this.tokenFile, Buffer.from(`${token}\n`, 'ascii'));
      await writeExclusive(configFile, Buffer.from(config, 'utf8'));
      await writeExclusive(this.manifestFile, Buffer.from(`${JSON.stringify(wrapper)}\n`, 'utf8'));
      this.current = credential;
      await this.#verifyFiles(credential);
    } catch (error) {
      await this.#removeIfExists(this.manifestFile);
      await this.#removeIfExists(configFile);
      await this.#removeIfExists(this.tokenFile);
      this.current = null;
      throw error;
    }
    let released = false;
    const manager = this;
    return {
      generation: credential.generation,
      async assertHeld() {
        if (released) throw credentialError('FAMILY_CORE_CREDENTIAL_UNAVAILABLE', 'The Family Core credential lease was released.');
        await manager.#verifyFiles(credential);
        return true;
      },
      release: async () => {
        if (released) return;
        released = true;
        if (manager.current?.generation === credential.generation) await manager.#cleanup(credential);
      },
    };
  }

  async authenticate({ token } = {}) {
    this.#requireInitialized();
    const current = this.current;
    if (!current || typeof token !== 'string' || !TOKEN.test(token)) return null;
    const wanted = Buffer.from(current.tokenSha256, 'hex');
    const actual = crypto.createHash('sha256').update(token, 'utf8').digest();
    if (wanted.length !== actual.length || !crypto.timingSafeEqual(wanted, actual)) return null;
    return { sessionId: current.sessionId };
  }

  verifyHello(payload, { sessionId } = {}) {
    this.#requireInitialized();
    const current = this.current;
    return current !== null
      && typeof sessionId === 'string'
      && sessionId.toLowerCase() === current.sessionId
      && payload?.instanceId === current.serverInstanceId
      && payload?.commandEnabled === current.computerCommandEnabled
      && payload?.capabilities?.includes('identity.events') === current.identityEventsEnabled
      && payload?.capabilities?.includes('chat.capture') === (current.chatCaptureEnabled ?? false);
  }

  status() {
    return this.current
      ? {
        state: 'provisioned',
        generation: this.current.generation,
        createdAt: this.current.createdAt,
        computerCommandEnabled: this.current.computerCommandEnabled,
        identityEventsEnabled: this.current.identityEventsEnabled,
        chatCaptureEnabled: this.current.chatCaptureEnabled ?? false,
      }
      : { state: 'disabled', generation: null, createdAt: null, computerCommandEnabled: false, identityEventsEnabled: false, chatCaptureEnabled: false };
  }

  #configFile(instance) {
    if (!instance || instance.id !== 'family-server' || typeof instance.directory !== 'string' || !path.isAbsolute(instance.directory)) {
      throw new TypeError('Family Core credentials are restricted to the managed family-server');
    }
    const directory = path.resolve(instance.directory);
    const configFile = path.join(directory, 'config', CONFIG_NAME);
    if (path.dirname(path.dirname(configFile)) !== directory) throw new TypeError('Invalid Family Core configuration boundary');
    return configFile;
  }

  async #readManifest({ allowMissing }) {
    let bytes;
    try { bytes = await regularFileBytes(this.manifestFile, 2, 16 * 1024); }
    catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return null;
      throw error;
    }
    let wrapper;
    try { wrapper = JSON.parse(bytes.toString('utf8')); }
    catch { throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'The Family Core credential manifest is invalid.'); }
    if (!exactKeys(wrapper, ['credential', 'mac']) || !SHA256.test(wrapper.mac ?? '')) {
      throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'The Family Core credential manifest is malformed.');
    }
    const credential = this.#validateCredential(wrapper.credential);
    const expected = crypto.createHmac('sha256', this.integrityKey)
      .update(`family-core-credential-v${credential.schemaVersion}\n${canonical(credential)}`).digest();
    const actual = Buffer.from(wrapper.mac, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'The Family Core credential manifest failed authentication.');
    }
    return Object.freeze(credential);
  }

  #validateCredential(value) {
    const commonKeys = [
      'schemaVersion', 'instanceId', 'sessionId', 'serverInstanceId', 'tokenSha256', 'tokenFile',
      'configFile', 'configSha256', 'computerCommandEnabled', 'identityEventsEnabled', 'createdAt', 'generation',
    ];
    const keys = value?.schemaVersion === 1 ? commonKeys : [...commonKeys, 'chatCaptureEnabled'];
    if (!exactKeys(value, keys) || ![1, 2].includes(value.schemaVersion) || value.instanceId !== 'family-server'
      || !UUID.test(value.sessionId ?? '') || !UUID.test(value.serverInstanceId ?? '')
      || !SHA256.test(value.tokenSha256 ?? '') || !SHA256.test(value.configSha256 ?? '')
      || !SHA256.test(value.generation ?? '') || typeof value.computerCommandEnabled !== 'boolean'
      || typeof value.identityEventsEnabled !== 'boolean'
      || (value.schemaVersion === 2 && typeof value.chatCaptureEnabled !== 'boolean')
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
      || value.tokenFile !== this.tokenFile || typeof value.configFile !== 'string' || !path.isAbsolute(value.configFile)) {
      throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'The Family Core credential manifest contains invalid state.');
    }
    const base = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'generation'));
    if (digest(canonical(base)) !== value.generation) {
      throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'The Family Core credential generation is invalid.');
    }
    return structuredClone(value);
  }

  #assertManifestPaths(credential, instance) {
    if (credential.instanceId !== instance.id || credential.configFile !== this.#configFile(instance)) {
      throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'Family Core credentials belong to a different managed server path.');
    }
  }

  async #verifyFiles(credential) {
    const [token, config, manifest] = await Promise.all([
      regularFileBytes(credential.tokenFile, 33, 258),
      regularFileBytes(credential.configFile, 64, 16 * 1024),
      this.#readManifest({ allowMissing: false }),
    ]);
    const tokenText = token.toString('ascii').trim();
    if (!TOKEN.test(tokenText) || digest(tokenText) !== credential.tokenSha256
      || digest(config) !== credential.configSha256 || manifest.generation !== credential.generation) {
      throw credentialError('FAMILY_CORE_CREDENTIAL_RECOVERY_REQUIRED', 'Family Core credential files failed exact verification.');
    }
    return true;
  }

  async #cleanup(credential) {
    await this.#verifyFiles(credential);
    await this.#removeIfExists(this.manifestFile);
    await this.#removeIfExists(credential.configFile);
    await this.#removeIfExists(credential.tokenFile);
    if (this.current?.generation === credential.generation) this.current = null;
  }

  async #removeIfExists(file) {
    try { await fs.unlink(file); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }

  async #exists(file) {
    try { await fs.lstat(file); return true; }
    catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
  }

  #requireInitialized() {
    if (!Buffer.isBuffer(this.integrityKey) || this.integrityKey.length !== 32) {
      throw credentialError('FAMILY_CORE_CREDENTIAL_UNAVAILABLE', 'The Family Core credential manager is not initialized.');
    }
  }
}
