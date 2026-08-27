import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MinecraftAccountRegistrationStore,
  validateMinecraftPublicClientId,
} from '../src/companion/account-registration.mjs';

const CLIENT_ID = '01234567-89ab-4def-8123-456789abcdef';

test('persists only a canonical public client id in an exact bounded local record', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-account-registration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'private', 'registration.json');
  const store = new MinecraftAccountRegistrationStore(file);
  assert.equal(await store.load(), null);
  assert.deepEqual(await store.save(CLIENT_ID.toUpperCase()), { configured: true });
  assert.deepEqual(await store.load(), { clientId: CLIENT_ID });
  const body = await fs.readFile(file, 'utf8');
  assert.deepEqual(JSON.parse(body), { schemaVersion: 1, clientId: CLIENT_ID });
  assert.equal(/secret|token|credential/iu.test(body), false);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o077, 0);
});

test('rejects malformed ids and fails closed for extra or symbolic-link records', async (t) => {
  for (const value of ['', 'not-guid', '00000000-0000-0000-0000-000000000000', `${CLIENT_ID}x`]) {
    assert.throws(() => validateMinecraftPublicClientId(value), (error) => error.code === 'INVALID_MICROSOFT_CLIENT_ID');
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-account-registration-invalid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'registration.json');
  const store = new MinecraftAccountRegistrationStore(file);
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, clientId: CLIENT_ID, clientSecret: 'forbidden' }));
  await assert.rejects(() => store.load(), /registration is invalid/);
  await fs.unlink(file);
  const target = path.join(root, 'target.json');
  await fs.writeFile(target, JSON.stringify({ schemaVersion: 1, clientId: CLIENT_ID }));
  try {
    await fs.symlink(target, file, 'file');
    await assert.rejects(() => store.load(), /registration is invalid/);
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error?.code)) throw error;
  }
});
