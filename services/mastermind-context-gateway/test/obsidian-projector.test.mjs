import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createObsidianProjector } from '../src/obsidian-projector.mjs';

test('Obsidian projection is opt-in, generated-only, and redacts secrets', async () => {
  const disabled = createObsidianProjector({ enabled: false });
  assert.deepEqual(await disabled({ project: 'mastermind', memories: [], tasks: [] }), {
    enabled: false,
    written: 0,
    reason: 'OBSIDIAN_EXPORT_DISABLED',
  });

  const root = await mkdtemp(path.join(os.tmpdir(), 'mastermind-obsidian-'));
  const project = createObsidianProjector({ enabled: true, vaultRoot: root });
  const result = await project({
    project: 'mastermind',
    memories: [{ id: '7', content: 'Database postgresql://user:pass@example/db', tags: ['project'], updatedAt: '2026-08-16T00:00:00.000Z' }],
    tasks: [],
  });
  assert.equal(result.enabled, true);
  assert.ok(result.files.every((file) => file.startsWith('Generated/Mastermind/')));
  const memoryPath = path.join(root, 'Generated', 'Mastermind', 'Projects', 'mastermind', 'Memories', 'memory-7.md');
  const content = await readFile(memoryPath, 'utf8');
  assert.match(content, /REDACTED_DATABASE_URL/);
  assert.doesNotMatch(content, /user:pass/);
});

test('Obsidian projection refuses a filesystem root', async () => {
  const project = createObsidianProjector({ enabled: true, vaultRoot: path.parse(process.cwd()).root });
  await assert.rejects(project({ project: 'mastermind', memories: [], tasks: [] }), /cannot be a drive root/);
});
