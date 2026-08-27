import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { materializeVerifiedMinecraftServerBundle } from '../src/minecraft-server-version.mjs';
import { minecraftServerJar, zipArchive } from './server-jar-fixture.mjs';

function sha(algorithm, bytes) {
  return crypto.createHash(algorithm).update(bytes).digest('hex');
}

function bundledServer(options = {}) {
  const game = zipArchive([{ name: 'net/minecraft/server/Main.class', bytes: Buffer.from('game') }]);
  const library = zipArchive([{ name: 'com/example/Library.class', bytes: Buffer.from('library') }]);
  const libraryPath = options.libraryPath ?? 'com/example/library/1.0/library-1.0.jar';
  const entries = [
    { name: 'version.json', bytes: Buffer.from(JSON.stringify({ id: '26.2', world_version: 4903 })) },
    { name: 'META-INF/libraries.list', bytes: Buffer.from(`${sha('sha256', library)}\tcom.example:library:1.0\t${libraryPath}\n`) },
    { name: 'META-INF/versions.list', bytes: Buffer.from(`${sha('sha256', game)}\t${options.versionId ?? '26.2'}\tserver-26.2.jar\n`) },
    { name: 'META-INF/libraries/com/example/library/1.0/library-1.0.jar', bytes: library },
    { name: 'META-INF/versions/server-26.2.jar', bytes: game },
    ...(options.extraLibrary ? [{ name: 'META-INF/libraries/unlisted.jar', bytes: library }] : []),
  ];
  return { bytes: zipArchive(entries), game, library };
}

test('extracts the Bundler game JAR and libraries without modifying the frozen official outer JAR', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-bundle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = bundledServer();
  const outer = path.join(root, 'versions', '26.2', 'server-26.2.jar');
  const destination = path.join(root, 'launch-assets-staging');
  await fs.mkdir(path.dirname(outer), { recursive: true });
  await fs.mkdir(destination);
  await fs.writeFile(outer, source.bytes);
  const expected = { minecraftVersion: '26.2', size: source.bytes.length,
    sha1: sha('sha1', source.bytes), sha256: sha('sha256', source.bytes) };
  const result = await materializeVerifiedMinecraftServerBundle(outer, expected, destination);
  assert.equal(result.bundled, true);
  assert.deepEqual(await fs.readFile(outer), source.bytes);
  assert.deepEqual(await fs.readFile(path.join(destination, ...result.gameJar.relativePath.split('/'))), source.game);
  assert.deepEqual(await fs.readFile(path.join(destination, ...result.libraries[0].relativePath.split('/'))), source.library);
  assert.notEqual(path.resolve(outer), path.resolve(destination, ...result.gameJar.relativePath.split('/')));
});

test('rejects traversal and unlisted executable entries in Mojang Bundler metadata', async (t) => {
  for (const source of [bundledServer({ libraryPath: '../../escape.jar' }), bundledServer({ extraLibrary: true })]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-bundle-reject-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const outer = path.join(root, 'server.jar'); const destination = path.join(root, 'out');
    await fs.writeFile(outer, source.bytes); await fs.mkdir(destination);
    const expected = { minecraftVersion: '26.2', size: source.bytes.length,
      sha1: sha('sha1', source.bytes), sha256: sha('sha256', source.bytes) };
    await assert.rejects(
      () => materializeVerifiedMinecraftServerBundle(outer, expected, destination),
      /unsafe|unlisted/i,
    );
  }
});

test('requires the Bundler launch version ID to exactly match the trusted release', async (t) => {
  for (const versionId of ['26.1', 'net.minecraft:server:26.2']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-bundle-version-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = bundledServer({ versionId });
    const outer = path.join(root, 'server.jar');
    const destination = path.join(root, 'out');
    await fs.writeFile(outer, source.bytes);
    await fs.mkdir(destination);
    await assert.rejects(
      () => materializeVerifiedMinecraftServerBundle(outer, {
        minecraftVersion: '26.2',
        size: source.bytes.length,
        sha1: sha('sha1', source.bytes),
        sha256: sha('sha256', source.bytes),
      }, destination),
      /version identity does not match/i,
    );
  }
});

test('copies an unbundled official server JAR to a distinct content-addressable launch path', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-unbundled-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = minecraftServerJar(); const outer = path.join(root, 'server.jar'); const destination = path.join(root, 'out');
  await fs.writeFile(outer, bytes); await fs.mkdir(destination);
  const result = await materializeVerifiedMinecraftServerBundle(outer, {
    minecraftVersion: '26.2', size: bytes.length, sha1: sha('sha1', bytes), sha256: sha('sha256', bytes),
  }, destination);
  assert.equal(result.bundled, false);
  assert.match(result.gameJar.relativePath, /^mojang\/versions\/[a-f0-9]{64}\/server\.jar$/);
  assert.deepEqual(await fs.readFile(path.join(destination, ...result.gameJar.relativePath.split('/'))), bytes);
  assert.deepEqual(await fs.readFile(outer), bytes);
});
