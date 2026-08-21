import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectJava, JavaRuntimeManager, safeRuntimeMetadata } from '../src/runtime-manager.mjs';

const runtimeIndexUrl = 'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const manifestUrl = `https://piston-meta.mojang.com/v1/packages/${'b'.repeat(40)}/manifest.json`;
const javaUrl = `https://piston-data.mojang.com/v1/objects/${'c'.repeat(40)}/java.exe`;
const dllUrl = `https://piston-data.mojang.com/v1/objects/${'d'.repeat(40)}/jvm.dll`;

function digest(bytes) {
  return crypto.createHash('sha1').update(bytes).digest('hex');
}

function runtimeFetcher(options = {}) {
  const javaBytes = Buffer.from('verified-fake-java-25');
  const dllBytes = Buffer.from('verified-fake-runtime-dll');
  const files = options.files ?? {
    bin: { type: 'directory' },
    'bin/server': { type: 'directory' },
    'bin/java.exe': {
      type: 'file',
      executable: true,
      downloads: { raw: { url: javaUrl, size: javaBytes.length, sha1: digest(javaBytes) } },
    },
    'bin/server/jvm.dll': {
      type: 'file',
      downloads: { raw: { url: dllUrl, size: dllBytes.length, sha1: digest(dllBytes) } },
    },
  };
  const manifestBytes = Buffer.from(JSON.stringify({ files }));
  const calls = [];
  const fetcher = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === runtimeIndexUrl) {
      return Response.json({
        'windows-x64': {
          'java-runtime-epsilon': [{
            availability: { progress: 100 },
            manifest: { url: manifestUrl, size: manifestBytes.length, sha1: digest(manifestBytes) },
            version: { name: '25.0.1', released: '2025-12-10T14:14:17+00:00' },
          }],
        },
      });
    }
    if (url === manifestUrl) return new Response(manifestBytes);
    if (url === javaUrl) return new Response(options.corruptJava ? Buffer.from('corrupt') : javaBytes);
    if (url === dllUrl) return new Response(dllBytes);
    return new Response('not found', { status: 404 });
  };
  return { calls, fetcher, javaBytes, dllBytes };
}

test('installs and reuses the exact Mojang Java component with verified files', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-runtime-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const { calls, fetcher, javaBytes } = runtimeFetcher();
  const inspected = [];
  const manager = new JavaRuntimeManager(dataRoot, fetcher, {
    platform: 'win32',
    arch: 'x64',
    inspectJava: async (executable) => {
      inspected.push(executable);
      assert.deepEqual(await fs.readFile(executable), javaBytes);
      return { major: 25, version: 'openjdk version "25.0.1"' };
    },
  });

  const first = await manager.ensure(25, 'java-runtime-epsilon');
  assert.equal(first.major, 25);
  assert.equal(first.component, 'java-runtime-epsilon');
  assert.equal(first.version, '25.0.1');
  assert.equal(first.managed, true);
  assert.ok(path.isAbsolute(first.executable));
  assert.deepEqual(await fs.readFile(first.executable), javaBytes);

  const second = await manager.ensure(25, 'java-runtime-epsilon');
  assert.equal(second.executable, first.executable);
  assert.equal(calls.filter(({ url }) => url === javaUrl).length, 1);
  assert.equal(inspected.length, 2);
  assert.ok(calls.every(({ init }) => init.redirect === 'error'));

  const safe = safeRuntimeMetadata(first);
  assert.equal(safe.version, '25.0.1');
  assert.equal(Object.hasOwn(safe, 'executable'), false);
  assert.equal(Object.hasOwn(safe, 'executableRelativePath'), false);
});

test('repairs an incomplete managed destination instead of leaving retries blocked', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-runtime-partial-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const destination = path.join(dataRoot, 'java-runtime-epsilon', '25.0.1', 'windows-x64');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'partial-download.tmp'), 'incomplete');
  const { fetcher, javaBytes } = runtimeFetcher();
  const manager = new JavaRuntimeManager(dataRoot, fetcher, {
    platform: 'win32', arch: 'x64',
    inspectJava: async () => ({ major: 25, version: 'openjdk version "25.0.1"' }),
  });

  const runtime = await manager.ensure(25, 'java-runtime-epsilon');
  assert.deepEqual(await fs.readFile(runtime.executable), javaBytes);
  await assert.rejects(() => fs.access(path.join(destination, 'partial-download.tmp')), /ENOENT/);
});

test('rehashes and repairs a replaced Java executable before reuse', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-runtime-tamper-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const { calls, fetcher, javaBytes } = runtimeFetcher();
  const manager = new JavaRuntimeManager(dataRoot, fetcher, {
    platform: 'win32', arch: 'x64',
    inspectJava: async () => ({ major: 25, version: 'openjdk version "25.0.1"' }),
  });
  const first = await manager.ensure(25, 'java-runtime-epsilon');
  await fs.writeFile(first.executable, Buffer.alloc(javaBytes.length, 0x58));
  const repaired = await manager.ensure(25, 'java-runtime-epsilon');
  assert.deepEqual(await fs.readFile(repaired.executable), javaBytes);
  assert.equal(calls.filter(({ url }) => url === javaUrl).length, 2);
});

test('rehashes and repairs a replaced non-Java runtime DLL before reuse', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-runtime-dll-tamper-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const { calls, fetcher, dllBytes } = runtimeFetcher();
  const manager = new JavaRuntimeManager(dataRoot, fetcher, {
    platform: 'win32', arch: 'x64',
    inspectJava: async () => ({ major: 25, version: 'openjdk version "25.0.1"' }),
  });
  const first = await manager.ensure(25, 'java-runtime-epsilon');
  const dll = path.join(path.dirname(first.executable), 'server', 'jvm.dll');
  await fs.writeFile(dll, Buffer.alloc(dllBytes.length, 0x58));
  await manager.ensure(25, 'java-runtime-epsilon');
  assert.deepEqual(await fs.readFile(dll), dllBytes);
  assert.equal(calls.filter(({ url }) => url === dllUrl).length, 2);
});

test('rejects and repairs an unlisted executable input in the runtime tree', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-runtime-unlisted-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const { calls, fetcher } = runtimeFetcher();
  const manager = new JavaRuntimeManager(dataRoot, fetcher, {
    platform: 'win32', arch: 'x64',
    inspectJava: async () => ({ major: 25, version: 'openjdk version "25.0.1"' }),
  });
  const first = await manager.ensure(25, 'java-runtime-epsilon');
  const injected = path.join(path.dirname(first.executable), 'injected.jar');
  await fs.writeFile(injected, 'unlisted');
  await manager.ensure(25, 'java-runtime-epsilon');
  await assert.rejects(() => fs.access(injected), /ENOENT/);
  assert.equal(calls.filter(({ url }) => url === javaUrl).length, 2);
});

test('fails closed on a bad Mojang file digest and removes staging data', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-runtime-corrupt-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const { fetcher } = runtimeFetcher({ corruptJava: true });
  const manager = new JavaRuntimeManager(dataRoot, fetcher, {
    platform: 'win32', arch: 'x64',
    inspectJava: async () => ({ major: 25, version: 'openjdk version "25.0.1"' }),
  });

  await assert.rejects(() => manager.ensure(25, 'java-runtime-epsilon'), /size did not match|SHA-1 verification/);
  const versionRoot = path.join(dataRoot, 'java-runtime-epsilon', '25.0.1');
  const remaining = await fs.readdir(versionRoot).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  assert.deepEqual(remaining, []);
});

test('rejects paths that escape the managed runtime root', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-runtime-path-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const javaBytes = Buffer.from('bad-path');
  const { fetcher } = runtimeFetcher({
    files: {
      '../escape.exe': {
        type: 'file',
        downloads: { raw: { url: javaUrl, size: javaBytes.length, sha1: digest(javaBytes) } },
      },
    },
  });
  const manager = new JavaRuntimeManager(dataRoot, fetcher, {
    platform: 'win32', arch: 'x64',
    inspectJava: async () => ({ major: 25, version: 'openjdk version "25.0.1"' }),
  });

  await assert.rejects(() => manager.ensure(25, 'java-runtime-epsilon'), /unsafe path/);
  await assert.rejects(() => fs.access(path.join(path.dirname(dataRoot), 'escape.exe')), /ENOENT/);
});

test('Java inspection requires an absolute path and never exposes the executable path on spawn failure', async (t) => {
  await assert.rejects(() => inspectJava('java'), /absolute executable path/i);
  const secretRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-java-secret-'));
  t.after(() => fs.rm(secretRoot, { recursive: true, force: true }));
  const secretExecutable = path.join(secretRoot, 'private-runtime-name.exe');
  await assert.rejects(() => inspectJava(secretExecutable), (error) => {
    assert.equal(error.message.includes(secretExecutable), false);
    assert.match(error.message, /managed Java inspection/i);
    return true;
  });
});
