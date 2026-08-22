import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FamilyCoreIdentityRegistry } from '../src/family-core/identity-registry.mjs';

const KEY = Buffer.alloc(32, 0x71);
const PLAYER_ID = 'ba0e9c2a-2f83-4833-8047-2ef3371f4fbd';
const MINECRAFT_UUID = '1ace17da-0910-403b-9dd3-06fbb3baa249';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-family-core-identities-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = new FamilyCoreIdentityRegistry(root, {
    integrityKey: KEY,
    now: () => Date.parse('2026-08-22T16:00:00.000Z'),
  });
  await registry.initialize();
  return { root, registry, file: path.join(root, 'private', 'family-core-identities.v1.json') };
}

test('unknown Minecraft identities remain unbound guests', async (t) => {
  const { registry } = await fixture(t);
  assert.deepEqual(registry.resolvePlayer({
    minecraftUuid: '99999999-9999-4999-8999-999999999999',
    displayName: 'Visitor_1',
  }), {
    playerId: null,
    minecraftUuid: '99999999-9999-4999-8999-999999999999',
    displayName: 'Visitor_1',
    role: 'guest',
    identityBound: false,
  });
});

test('authenticated UUID binding resolves the parent without trusting the current name', async (t) => {
  const { root, registry } = await fixture(t);
  await registry.bind({
    playerId: PLAYER_ID,
    minecraftUuid: MINECRAFT_UUID,
    registeredDisplayName: 'MISS_LENKA',
    role: 'parent',
  });
  assert.equal((await registry.bind({
    playerId: PLAYER_ID,
    minecraftUuid: MINECRAFT_UUID,
    registeredDisplayName: 'MISS_LENKA',
    role: 'parent',
  })).created, false);
  assert.deepEqual(registry.resolvePlayer({ minecraftUuid: MINECRAFT_UUID, displayName: 'MISS_LENKA' }), {
    playerId: PLAYER_ID,
    minecraftUuid: MINECRAFT_UUID,
    displayName: 'MISS_LENKA',
    role: 'parent',
    identityBound: true,
  });

  const recovered = new FamilyCoreIdentityRegistry(root, { integrityKey: KEY });
  assert.deepEqual(await recovered.initialize(), {
    state: 'ready', bindingCount: 1, roles: { parent: 1, child: 0, service: 0 },
  });
  assert.equal(recovered.resolvePlayer({ minecraftUuid: MINECRAFT_UUID, displayName: 'RenamedPlayer' }).role, 'parent');
});

test('tampering with a private binding fails closed', async (t) => {
  const { root, registry, file } = await fixture(t);
  await registry.bind({
    playerId: PLAYER_ID,
    minecraftUuid: MINECRAFT_UUID,
    registeredDisplayName: 'MISS_LENKA',
    role: 'parent',
  });
  const text = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, text.replace('parent', 'service'));
  const recovered = new FamilyCoreIdentityRegistry(root, { integrityKey: KEY });
  await assert.rejects(recovered.initialize(), (error) => error?.code === 'FAMILY_CORE_IDENTITY_RECOVERY_REQUIRED');
});
