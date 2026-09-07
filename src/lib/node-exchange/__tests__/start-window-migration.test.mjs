import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';

const priorUrl = new URL(
  '../../../../memory-system/migrations/005_mastermind_node_exchange_lease_presence_v1.sql',
  import.meta.url,
);
const migrationUrl = new URL(
  '../../../../memory-system/migrations/006_mastermind_node_exchange_start_window_v1.sql',
  import.meta.url,
);

function exchangeFunction(sql) {
  const match = sql.replace(/\r\n/g, '\n').match(
    /CREATE OR REPLACE FUNCTION public\.exchange_mastermind_node_v1\([\s\S]*?\n\$\$;/,
  );
  assert.ok(match);
  return match[0];
}

test('start-window migration changes only the fixed routine job and lease window', async () => {
  const prior = await fs.readFile(priorUrl, 'utf8');
  const migration = await fs.readFile(migrationUrl, 'utf8');
  const expected = exchangeFunction(prior)
    .replace(
      "SET state = 'leased', lease_id = p_candidate_lease_id, leased_at = v_now,\n"
        + "          lease_expires_at = LEAST(expires_at, v_now + interval '15 minutes')",
      "SET state = 'leased', lease_id = p_candidate_lease_id, leased_at = v_now,\n"
        + "          expires_at = GREATEST(expires_at, created_at + interval '2 hours'),\n"
        + "          lease_expires_at = GREATEST(expires_at, created_at + interval '2 hours')",
    )
    .replace(
      "SET lease_expires_at = LEAST(expires_at, v_now + interval '15 minutes')",
      "SET expires_at = GREATEST(expires_at, created_at + interval '2 hours'),\n"
        + "        lease_expires_at = GREATEST(expires_at, created_at + interval '2 hours')",
    );

  assert.equal(exchangeFunction(migration), expected);
  assert.equal((migration.match(/interval '2 hours'/g) ?? []).length, 4);
  assert.doesNotMatch(migration, /interval '15 minutes'/);
  assert.equal((migration.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 1);
  assert.doesNotMatch(migration, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE)\b/i);
  assert.match(migration.trim(), /^BEGIN;[\s\S]*COMMIT;$/);
});

test('start-window migration digest is pinned by the migration runner', async () => {
  const migration = await fs.readFile(migrationUrl, 'utf8');
  const runner = await fs.readFile(
    new URL('../../../../scripts/apply-memory-migrations.mjs', import.meta.url),
    'utf8',
  );
  const digest = crypto.createHash('sha256').update(migration).digest('hex');
  assert.match(
    runner,
    new RegExp(`006_mastermind_node_exchange_start_window_v1\\.sql'[\\s\\S]{0,160}${digest}`),
  );
});
