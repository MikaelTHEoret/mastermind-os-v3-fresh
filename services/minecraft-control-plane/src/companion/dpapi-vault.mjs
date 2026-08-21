import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_SECRET_BYTES = 64 * 1024;
const MAX_PROTECTED_BYTES = 128 * 1024;
const MAX_VAULT_BYTES = 512 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 512 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const FIXED_SCRIPT = path.resolve(fileURLToPath(new URL('../../../../scripts/protect-minecraft-account.ps1', import.meta.url)));

export class DpapiVaultError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'DpapiVaultError';
    this.code = code;
  }
}

function vaultError(code, message, cause) {
  return new DpapiVaultError(code, message, cause ? { cause } : undefined);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', `${label} is invalid.`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', `${label} is invalid.`);
  }
  return value;
}

function canonicalBase64(value, maximumBytes, label) {
  if (typeof value !== 'string' || value.length < 4 || value.length > Math.ceil(maximumBytes / 3) * 4 || !BASE64.test(value)) {
    throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', `${label} is invalid.`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 1 || bytes.length > maximumBytes || bytes.toString('base64') !== value) {
    bytes.fill(0);
    throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', `${label} is invalid.`);
  }
  return bytes;
}

function powershellExecutable(windowsRoot = process.env.SystemRoot ?? process.env.WINDIR) {
  if (typeof windowsRoot !== 'string' || !path.win32.isAbsolute(windowsRoot) || windowsRoot.includes('\0')) {
    throw vaultError('DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection is unavailable.');
  }
  return path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

async function boundedRegularFile(file, maximumBytes) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumBytes) {
    throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', 'The encrypted Minecraft account vault is invalid.');
  }
  return fs.readFile(file, { encoding: 'utf8' });
}

export class DpapiMinecraftAccountVault {
  constructor({
    vaultFile,
    spawnProcess = spawn,
    platform = process.platform,
    windowsRoot = process.env.SystemRoot ?? process.env.WINDIR,
    timeoutMs = 10_000,
  } = {}) {
    if (typeof vaultFile !== 'string' || !path.isAbsolute(vaultFile) || vaultFile.includes('\0')) {
      throw new TypeError('An absolute Minecraft account vaultFile is required');
    }
    if (typeof spawnProcess !== 'function') throw new TypeError('spawnProcess must be a function');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
      throw new TypeError('timeoutMs must be an integer between 1000 and 30000');
    }
    this.vaultFile = path.resolve(vaultFile);
    this.spawnProcess = spawnProcess;
    this.platform = platform;
    this.windowsRoot = windowsRoot;
    this.timeoutMs = timeoutMs;
  }

  async load() {
    let text;
    try { text = await boundedRegularFile(this.vaultFile, MAX_VAULT_BYTES); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error instanceof DpapiVaultError) throw error;
      throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', 'The encrypted Minecraft account vault could not be read.', error);
    }
    let envelope;
    try { envelope = JSON.parse(text); }
    catch (error) { throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', 'The encrypted Minecraft account vault is invalid.', error); }
    exactObject(envelope, ['schemaVersion', 'provider', 'protection', 'protectedPayload', 'updatedAt'], 'The encrypted Minecraft account vault');
    if (
      envelope.schemaVersion !== 1 || envelope.provider !== 'microsoft'
      || envelope.protection !== 'windows-dpapi-current-user'
      || typeof envelope.updatedAt !== 'string' || !Number.isFinite(Date.parse(envelope.updatedAt))
    ) throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', 'The encrypted Minecraft account vault is invalid.');
    const protectedBytes = canonicalBase64(envelope.protectedPayload, MAX_PROTECTED_BYTES, 'The protected Minecraft account payload');
    let plaintext;
    try {
      plaintext = await this.#transform('Unprotect', protectedBytes);
      const parsed = JSON.parse(plaintext.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Secret record was not an object');
      return parsed;
    } catch (error) {
      if (error instanceof DpapiVaultError) throw error;
      throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', 'The encrypted Minecraft account vault could not be decrypted.', error);
    } finally {
      protectedBytes.fill(0);
      plaintext?.fill(0);
    }
  }

  async save(secretRecord) {
    if (!secretRecord || typeof secretRecord !== 'object' || Array.isArray(secretRecord)) {
      throw new TypeError('Minecraft account secretRecord must be an object');
    }
    const plaintext = Buffer.from(JSON.stringify(secretRecord), 'utf8');
    if (plaintext.length < 2 || plaintext.length > MAX_SECRET_BYTES) {
      plaintext.fill(0);
      throw new TypeError('Minecraft account secretRecord is outside its size limit');
    }
    let protectedBytes;
    try {
      protectedBytes = await this.#transform('Protect', plaintext);
      const updatedAt = new Date().toISOString();
      const envelope = {
        schemaVersion: 1,
        provider: 'microsoft',
        protection: 'windows-dpapi-current-user',
        protectedPayload: protectedBytes.toString('base64'),
        updatedAt,
      };
      const body = `${JSON.stringify(envelope, null, 2)}\n`;
      if (Buffer.byteLength(body) > MAX_VAULT_BYTES) throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', 'The encrypted Minecraft account vault exceeded its size limit.');
      await fs.mkdir(path.dirname(this.vaultFile), { recursive: true });
      const temporary = `${this.vaultFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await fs.chmod(temporary, 0o600);
        await fs.rename(temporary, this.vaultFile);
        await fs.chmod(this.vaultFile, 0o600);
      } catch (error) {
        try { await fs.unlink(temporary); } catch { /* The exact temporary file may not exist. */ }
        throw vaultError('MINECRAFT_ACCOUNT_VAULT_WRITE_FAILED', 'The encrypted Minecraft account vault could not be saved.', error);
      }
      return { saved: true, updatedAt };
    } finally {
      plaintext.fill(0);
      protectedBytes?.fill(0);
    }
  }

  async clear() {
    try {
      const stat = await fs.lstat(this.vaultFile);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', 'The encrypted Minecraft account vault is not an exact regular file.');
      }
      await fs.unlink(this.vaultFile);
      return { removed: true };
    } catch (error) {
      if (error?.code === 'ENOENT') return { removed: false };
      if (error instanceof DpapiVaultError) throw error;
      throw vaultError('MINECRAFT_ACCOUNT_VAULT_WRITE_FAILED', 'The encrypted Minecraft account vault could not be removed.', error);
    }
  }

  async #transform(action, bytes) {
    if (this.platform !== 'win32') throw vaultError('DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection is unavailable.');
    if (!['Protect', 'Unprotect'].includes(action)) throw new TypeError('Unsupported DPAPI action');
    const input = Buffer.from(JSON.stringify({ schemaVersion: 1, payloadBase64: bytes.toString('base64') }), 'utf8');
    let child;
    try {
      child = this.spawnProcess(powershellExecutable(this.windowsRoot), [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', FIXED_SCRIPT, '-Action', action,
      ], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => (
          ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR'].includes(key.toUpperCase()) && typeof value === 'string'
        ))),
      });
    } catch (error) {
      input.fill(0);
      throw vaultError('DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection could not be started.', error);
    }
    if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function' || !child.stdin || !child.stdout) {
      input.fill(0);
      throw new TypeError('spawnProcess must return a piped ChildProcess-compatible handle');
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = Buffer.alloc(0);
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.fill(0);
        stdout.fill(0);
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* The helper may already have exited. */ }
        finish(vaultError('DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection timed out.'));
      }, this.timeoutMs);
      timer.unref?.();
      child.once('error', (error) => finish(vaultError('DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection failed.', error)));
      child.stdout.on('data', (chunk) => {
        if (settled) return;
        const next = Buffer.concat([stdout, Buffer.from(chunk)]);
        stdout.fill(0);
        stdout = next;
        if (stdout.length > MAX_PROCESS_OUTPUT_BYTES) {
          try { child.kill('SIGTERM'); } catch { /* The helper may already have exited. */ }
          finish(vaultError('DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection returned too much data.'));
        }
      });
      child.once('exit', (code) => {
        if (code !== 0) return finish(vaultError('DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection failed.'));
        try {
          const output = JSON.parse(stdout.toString('utf8'));
          exactObject(output, ['schemaVersion', 'payloadBase64'], 'The DPAPI response');
          if (output.schemaVersion !== 1) throw vaultError('MINECRAFT_ACCOUNT_VAULT_INVALID', 'The DPAPI response is invalid.');
          const result = canonicalBase64(
            output.payloadBase64,
            action === 'Protect' ? MAX_PROTECTED_BYTES : MAX_SECRET_BYTES,
            'The DPAPI response payload',
          );
          finish(null, result);
        } catch (error) {
          finish(error instanceof DpapiVaultError ? error : vaultError('DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection returned invalid data.', error));
        }
      });
      child.stdin.once?.('error', (error) => finish(vaultError('DPAPI_UNAVAILABLE', 'Windows CurrentUser data protection input failed.', error)));
      child.stdin.end(input);
    });
  }
}

export const MINECRAFT_ACCOUNT_DPAPI_SCRIPT = FIXED_SCRIPT;
