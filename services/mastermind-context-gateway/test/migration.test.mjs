import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migration = path.resolve('memory-system/migrations/007_mastermind_context_gateway_v1.sql');

test('context migration is transactional, bounded, authorized, and contains no execution capability', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /verify_mastermind_memory_operator_v1/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /checkpoint_digest/);
  assert.doesNotMatch(sql, /shell|subprocess|minecraft.*action/i);
});

test('migration runner pins the reviewed migration digest', async () => {
  const [sql, runner] = await Promise.all([
    readFile(migration, 'utf8'),
    readFile(path.resolve('scripts/apply-memory-migrations.mjs'), 'utf8'),
  ]);
  const digest = crypto.createHash('sha256').update(sql).digest('hex');
  assert.match(runner, new RegExp(digest));
});

test('reserved central migrations exactly match the PostgreSQL-tested sources and preserve append-only checkpoints', async () => {
  for (const [local,central] of [['owner-replay-v1.sql','019_mastermind_context_owner_replay_v1.sql'],['task-permissions-v1.sql','020_mastermind_context_task_permissions_v1.sql']]) {
    const [source,copy]=await Promise.all([readFile(new URL(`../migrations/${local}`,import.meta.url),'utf8'),readFile(path.resolve('memory-system/migrations',central),'utf8')]);
    assert.equal(source,copy);assert.match(copy,/^BEGIN;/);assert.match(copy,/COMMIT;\s*$/);
  }
  const scope=await readFile(new URL('../migrations/task-permissions-v1.sql',import.meta.url),'utf8');
  assert.match(scope,/INSERT INTO public.mastermind_context_checkpoints_v1/);
  assert.doesNotMatch(scope,/UPDATE public.mastermind_context_checkpoints_v1|DROP RULE|DROP TABLE/);
});
