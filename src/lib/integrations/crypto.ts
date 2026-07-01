// src/lib/integrations/crypto.ts -- SERVER-ONLY AES-256-GCM for provider credentials.
// Uses ENCRYPTION_KEY (base64, 32 bytes) already present in env. Never import in a client component.
import crypto from 'crypto';

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || '';
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be base64-encoded 32 bytes (AES-256-GCM)');
  return k;
}

// Returns base64( iv(12) | authTag(16) | ciphertext ). The raw secret never leaves the server.
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// Masked preview shown to the UI: only the last 4 chars are ever returned to the client.
export function maskSecret(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 4) return '****';
  return '****************' + plain.slice(-4);
}
