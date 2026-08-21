import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BYTES = 4 * 1024;

export function validateMinecraftPublicClientId(value) {
  if (typeof value !== 'string' || !GUID.test(value) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/u.test(value)) {
    throw Object.assign(new Error('A valid Microsoft public-client app registration is required.'), {
      statusCode: 400,
      code: 'INVALID_MICROSOFT_CLIENT_ID',
    });
  }
  return value.toLowerCase();
}

export class MinecraftAccountRegistrationStore {
  constructor(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) {
      throw new TypeError('An absolute Minecraft account registration file is required');
    }
    this.file = path.resolve(file);
  }

  async load() {
    let stat;
    try { stat = await fs.lstat(this.file); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_BYTES) {
      throw new Error('The local Minecraft account registration is invalid.');
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new Error('The local Minecraft account registration permissions are invalid.');
    }
    let value;
    try { value = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch { throw new Error('The local Minecraft account registration is invalid.'); }
    if (
      !value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 2 || value.schemaVersion !== 1 || !Object.hasOwn(value, 'clientId')
    ) throw new Error('The local Minecraft account registration is invalid.');
    return Object.freeze({ clientId: validateMinecraftPublicClientId(value.clientId) });
  }

  async save(clientId) {
    const canonical = validateMinecraftPublicClientId(clientId);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, clientId: canonical }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, this.file);
      await fs.chmod(this.file, 0o600);
    } catch (error) {
      try { await fs.unlink(temporary); } catch { /* The exact staging file may not exist. */ }
      throw Object.assign(new Error('The local Minecraft account registration could not be saved.'), {
        statusCode: 500,
        code: 'MINECRAFT_REGISTRATION_WRITE_FAILED',
        cause: error,
      });
    }
    return Object.freeze({ configured: true });
  }
}

export const __test = Object.freeze({ validateClientId: validateMinecraftPublicClientId });
