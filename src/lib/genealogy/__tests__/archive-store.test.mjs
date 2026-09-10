import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import test from 'node:test';

import {
  captureSecretMatches,
  detectArchiveImage,
  persistArchiveImage,
  readArchiveImage,
  resolveGenealogyArchiveRoot,
  sha256Hex,
} from '../archive-store.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

test('archive root defaults to the private LocalAppData Mastermind tree', () => {
  assert.equal(
    resolveGenealogyArchiveRoot({ LOCALAPPDATA: 'C:\\Users\\Family\\AppData\\Local' }),
    path.resolve('C:\\Users\\Family\\AppData\\Local', 'Mastermind', 'genealogy', 'archive-v1'),
  );
  assert.throws(() => resolveGenealogyArchiveRoot({}), /LOCALAPPDATA/u);
});

test('image detection trusts magic bytes rather than a filename', () => {
  assert.deepEqual(detectArchiveImage(JPEG, 'image/jpeg'), { mediaType: 'image/jpeg', extension: 'jpg' });
  assert.throws(() => detectArchiveImage(Buffer.from('not an image'), 'image/jpeg'), /JPEG and PNG/u);
  assert.throws(() => detectArchiveImage(JPEG, 'image/png'), /does not match/u);
});

test('content-addressed persistence is immutable and idempotent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mastermind-genealogy-'));
  try {
    const environment = { MASTERMIND_GENEALOGY_ARCHIVE_ROOT: root };
    const first = await persistArchiveImage({ bytes: JPEG, declaredType: 'image/jpeg', environment });
    const second = await persistArchiveImage({ bytes: JPEG, declaredType: 'image/jpeg', environment });
    assert.equal(first.sha256, sha256Hex(JPEG));
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.match(first.storageKey, /^objects\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.jpg$/u);
    assert.deepEqual(await readArchiveImage(first.storageKey, environment), JPEG);
    assert.deepEqual(await readFile(path.join(root, ...first.storageKey.split('/'))), JPEG);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('capture client secrets are compared through their digest', () => {
  const secret = crypto.randomBytes(32).toString('base64url');
  assert.equal(captureSecretMatches(secret, sha256Hex(secret)), true);
  assert.equal(captureSecretMatches(`${secret}x`, sha256Hex(secret)), false);
  assert.equal(captureSecretMatches('', sha256Hex(secret)), false);
});
