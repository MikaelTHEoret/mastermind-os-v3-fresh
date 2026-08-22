import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME = /^[A-Za-z0-9_]{1,16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ROLES = new Set(['parent', 'child', 'service']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function registryError(message) {
  return Object.assign(new Error(message), { code: 'FAMILY_CORE_IDENTITY_RECOVERY_REQUIRED', statusCode: 409 });
}

function validateBinding(value) {
  let canonicalBoundAt = null;
  try { canonicalBoundAt = new Date(value?.boundAt).toISOString(); } catch { /* validated below */ }
  if (!exactKeys(value, ['playerId', 'minecraftUuid', 'registeredDisplayName', 'role', 'boundAt'])
    || !UUID.test(value.playerId ?? '') || !UUID.test(value.minecraftUuid ?? '')
    || !NAME.test(value.registeredDisplayName ?? '') || !ROLES.has(value.role)
    || typeof value.boundAt !== 'string' || canonicalBoundAt !== value.boundAt) {
    throw registryError('The Family Core identity registry contains an invalid binding.');
  }
  return { ...value };
}

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw registryError('The Family Core identity directory is unsafe.');
}

export class FamilyCoreIdentityRegistry {
  constructor(managedRoot, options = {}) {
    if (typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)) throw new TypeError('A managed root is required');
    if (!Buffer.isBuffer(options.integrityKey) || options.integrityKey.length !== 32) {
      throw new TypeError('Family Core identity integrity key must contain exactly 32 bytes');
    }
    this.file = path.join(path.resolve(managedRoot), 'private', 'family-core-identities.v1.json');
    this.integrityKey = Buffer.from(options.integrityKey);
    this.now = options.now ?? (() => Date.now());
    this.bindings = null;
  }

  async initialize() {
    await ensurePrivateDirectory(path.dirname(this.file));
    this.bindings = await this.#read({ allowMissing: true });
    return this.status();
  }

  async bind(binding) {
    this.#requireInitialized();
    const normalized = validateBinding({
      playerId: binding?.playerId?.toLowerCase(),
      minecraftUuid: binding?.minecraftUuid?.toLowerCase(),
      registeredDisplayName: binding?.registeredDisplayName,
      role: binding?.role,
      boundAt: binding?.boundAt ?? new Date(this.now()).toISOString(),
    });
    const existing = this.bindings.find((item) => item.minecraftUuid === normalized.minecraftUuid || item.playerId === normalized.playerId);
    if (existing) {
      if (existing.playerId === normalized.playerId && existing.minecraftUuid === normalized.minecraftUuid
        && existing.registeredDisplayName === normalized.registeredDisplayName && existing.role === normalized.role) {
        return { created: false, binding: { ...existing } };
      }
      throw registryError('That Family Core identity already has a different authenticated binding.');
    }
    if (this.bindings.length > 0) {
      throw registryError('Additional identity registration remains disabled until the profile authority is connected.');
    }
    const bindings = [...this.bindings, normalized].sort((left, right) => left.minecraftUuid.localeCompare(right.minecraftUuid, 'en'));
    const payload = { schemaVersion: 1, bindings };
    const wrapper = {
      payload,
      mac: crypto.createHmac('sha256', this.integrityKey)
        .update(`family-core-identities-v1\n${canonical(payload)}`).digest('hex'),
    };
    const handle = await fs.open(this.file, 'wx', 0o600).catch((error) => {
      if (error?.code === 'EEXIST') throw registryError('The identity registry changed while a binding was being created.');
      throw error;
    });
    try {
      await handle.writeFile(`${JSON.stringify(wrapper)}\n`, 'utf8');
      await handle.chmod(0o600);
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.bindings = bindings;
    return { created: true, binding: { ...normalized } };
  }

  resolvePlayer(player) {
    this.#requireInitialized();
    const minecraftUuid = typeof player?.minecraftUuid === 'string' ? player.minecraftUuid.toLowerCase() : '';
    const displayName = typeof player?.displayName === 'string' && NAME.test(player.displayName) ? player.displayName : null;
    if (!UUID.test(minecraftUuid) || displayName === null) throw new TypeError('A server-authoritative Minecraft identity is required');
    const binding = this.bindings.find((item) => item.minecraftUuid === minecraftUuid);
    return binding
      ? { playerId: binding.playerId, minecraftUuid, displayName, role: binding.role, identityBound: true }
      : { playerId: null, minecraftUuid, displayName, role: 'guest', identityBound: false };
  }

  status() {
    this.#requireInitialized();
    return {
      state: this.bindings.length === 0 ? 'empty' : 'ready',
      bindingCount: this.bindings.length,
      roles: Object.fromEntries(['parent', 'child', 'service'].map((role) => [role, this.bindings.filter((item) => item.role === role).length])),
    };
  }

  async #read({ allowMissing }) {
    let bytes;
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 2 || stat.size > 64 * 1024) {
        throw registryError('The Family Core identity registry is not a bounded regular file.');
      }
      bytes = await fs.readFile(this.file);
      if (bytes.length !== stat.size) throw registryError('The Family Core identity registry changed while being read.');
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return [];
      throw error;
    }
    let wrapper;
    try { wrapper = JSON.parse(bytes.toString('utf8')); }
    catch { throw registryError('The Family Core identity registry is invalid JSON.'); }
    if (!exactKeys(wrapper, ['payload', 'mac']) || !SHA256.test(wrapper.mac ?? '')
      || !exactKeys(wrapper.payload, ['schemaVersion', 'bindings']) || wrapper.payload.schemaVersion !== 1
      || !Array.isArray(wrapper.payload.bindings) || wrapper.payload.bindings.length > 128) {
      throw registryError('The Family Core identity registry is malformed.');
    }
    const bindings = wrapper.payload.bindings.map(validateBinding);
    const uuids = bindings.map((item) => item.minecraftUuid);
    const playerIds = bindings.map((item) => item.playerId);
    if (new Set(uuids).size !== uuids.length || new Set(playerIds).size !== playerIds.length
      || canonical(bindings) !== canonical([...bindings].sort((left, right) => left.minecraftUuid.localeCompare(right.minecraftUuid, 'en')))) {
      throw registryError('The Family Core identity registry contains duplicate or unsorted bindings.');
    }
    const expected = crypto.createHmac('sha256', this.integrityKey)
      .update(`family-core-identities-v1\n${canonical(wrapper.payload)}`).digest();
    const actual = Buffer.from(wrapper.mac, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw registryError('The Family Core identity registry failed authentication.');
    }
    return bindings;
  }

  #requireInitialized() {
    if (!Array.isArray(this.bindings)) throw new Error('Family Core identity registry is not initialized');
  }
}
