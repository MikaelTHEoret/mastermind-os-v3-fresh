import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  WINDOWS_NODE_PACKAGE_DIRECTORIES,
  WINDOWS_NODE_PACKAGE_FILES,
  WINDOWS_NODE_PACKAGE_PROFILE,
  computeWindowsNodePackageTree,
} from '../lib/windows-node-package-tree.mjs';

test('package-tree identity covers runtime code/assets while excluding caches and tests', async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-package-tree-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const workspace = await fs.realpath(fixture);
  let sequence = 0;
  for (const relative of WINDOWS_NODE_PACKAGE_FILES) {
    const target = path.join(workspace, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `root-${sequence += 1}\n`);
  }
  for (const relative of WINDOWS_NODE_PACKAGE_DIRECTORIES) {
    const directory = path.join(workspace, relative);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'covered.txt'), `directory-${sequence += 1}\n`);
  }
  await fs.mkdir(path.join(workspace, '.next', 'cache'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.next', 'cache', 'ignored.bin'), 'cache-a');
  await fs.writeFile(path.join(workspace, '.next', 'trace'), 'trace-a');
  await fs.mkdir(path.join(workspace, 'scripts', 'test'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'scripts', 'test', 'ignored.test.mjs'), 'test-a');

  const first = await computeWindowsNodePackageTree({ workspace });
  assert.equal(first.packageProfile, WINDOWS_NODE_PACKAGE_PROFILE);
  assert.equal(first.packageFileCount,
    WINDOWS_NODE_PACKAGE_FILES.length + WINDOWS_NODE_PACKAGE_DIRECTORIES.length);
  assert.match(first.packageDigestSha256, /^[a-f0-9]{64}$/u);

  await fs.writeFile(path.join(workspace, 'scripts', 'test', 'ignored.test.mjs'), 'test-b');
  await fs.writeFile(path.join(workspace, '.next', 'cache', 'ignored.bin'), 'cache-b');
  assert.deepEqual(await computeWindowsNodePackageTree({ workspace }), first);

  await fs.writeFile(path.join(workspace, 'scripts', 'covered.txt'), 'runtime-code-changed\n');
  const changed = await computeWindowsNodePackageTree({ workspace });
  assert.notEqual(changed.packageDigestSha256, first.packageDigestSha256);
  assert.notEqual(changed.packageBytes, first.packageBytes);
});
