import crypto from 'node:crypto';

const pin = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
const salt = crypto.randomBytes(16);
const digest = await new Promise((resolve, reject) => {
  crypto.scrypt(pin, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error);
    else resolve(key);
  });
});
const verifier = `v1$${salt.toString('base64url')}$${digest.toString('base64url')}`;
const dotenvVerifier = verifier.replaceAll('$', '\\$');

process.stdout.write([
  'Store this PIN somewhere only the adults can reach. It is shown once:',
  pin,
  '',
  'Add this server-only line to .env.local:',
  `MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT=${dotenvVerifier}`,
  '',
].join('\n'));
