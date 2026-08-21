import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveLocalControlPaths } from '../lib/local-control-paths.mjs';

const launcherUrl = new URL('../run-local-control.mjs', import.meta.url);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

test('local-control ownership and entrypoints follow the launcher bundle from any cwd', async (t) => {
  const unrelatedCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-unrelated-cwd-'));
  t.after(() => fs.rm(unrelatedCwd, { recursive: true, force: true }));
  const originalCwd = process.cwd();
  let resolved;

  try {
    process.chdir(unrelatedCwd);
    resolved = await resolveLocalControlPaths({ launcherUrl });
  } finally {
    process.chdir(originalCwd);
  }

  assert.equal(resolved.workspace, await fs.realpath(repositoryRoot));
  assert.equal(resolved.launcherEntrypoint, await fs.realpath(fileURLToPath(launcherUrl)));
  assert.equal(resolved.nextEntrypoint, createRequire(launcherUrl).resolve('next/dist/bin/next'));
  assert.ok(resolved.nextEntrypoint.startsWith(`${resolved.workspace}${path.sep}`));
  assert.equal(
    resolved.nodeLinkEntrypoint,
    path.join(resolved.workspace, 'services', 'mastermind-node-link', 'src', 'run-worker.mjs'),
  );
  assert.equal(
    resolved.agentEntrypoint,
    path.join(resolved.workspace, 'services', 'minecraft-control-plane', 'src', 'agent.mjs'),
  );
  assert.notEqual(resolved.workspace, unrelatedCwd);
});

test('launcher source cannot restore cwd-controlled ownership', async () => {
  const source = await fs.readFile(launcherUrl, 'utf8');
  assert.doesNotMatch(source, /process\.cwd\s*\(/);
  assert.match(source, /resolveLocalControlPaths\(\{ launcherUrl: new URL\(import\.meta\.url\) \}\)/u);
  assert.doesNotMatch(source, /resolveLocalControlPaths\(\{ launcherUrl: import\.meta\.url \}\)/u);
});

test('Next self-hosting output remains standalone without disturbing browser fallbacks', () => {
  const require = createRequire(import.meta.url);
  const nextConfig = require('../../next.config.js');
  assert.equal(nextConfig.output, 'standalone');

  const untouchedFallback = { crypto: 'existing-polyfill' };
  const config = { resolve: { fallback: untouchedFallback } };
  const transformed = nextConfig.webpack(config, { isServer: false });
  assert.deepEqual(transformed.resolve.fallback, {
    crypto: 'existing-polyfill',
    fs: false,
    net: false,
    tls: false,
  });

  const serverConfig = { resolve: { fallback: untouchedFallback } };
  assert.equal(nextConfig.webpack(serverConfig, { isServer: true }), serverConfig);
  assert.equal(serverConfig.resolve.fallback, untouchedFallback);
});
