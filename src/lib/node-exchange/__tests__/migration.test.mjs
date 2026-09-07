import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../../../../memory-system/migrations/004_mastermind_node_exchange_v1.sql', import.meta.url);
const leasePresenceMigrationUrl = new URL(
  '../../../../memory-system/migrations/005_mastermind_node_exchange_lease_presence_v1.sql',
  import.meta.url,
);

function extractExchangeFunction(sql) {
  const normalized = sql.replace(/\r\n/g, '\n');
  const match = normalized.match(
    /CREATE OR REPLACE FUNCTION public\.exchange_mastermind_node_v1\([\s\S]*?\n\$\$;/,
  );
  assert.ok(match, 'exchange_mastermind_node_v1 definition is present');
  return match[0];
}

test('migration preserves profile authorization and active-parent lifecycle locking', async () => {
  const sql = await fs.readFile(migrationUrl, 'utf8');
  assert.match(sql, /mastermind_active_parent_profile_v1/);
  assert.doesNotMatch(sql, /active_parent_for_clerk/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_household_id, 0\)\)/);
  assert.match(sql, /node pairing parent is no longer active/);
});

test('migration coalesces active routine jobs and models running progress', async () => {
  const sql = await fs.readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX[^;]+one_active_capability_idx[\s\S]+WHERE state IN \('queued', 'leased', 'running'\)/);
  assert.match(sql, /RETURN QUERY SELECT 'coalesced'::text/);
  assert.match(sql, /state = 'expired'[\s\S]+expires_at <= v_now[\s\S]+state IN \('queued', 'leased', 'running'\)/);
  assert.match(sql, /state IN \('queued', 'leased', 'running', 'succeeded', 'failed', 'expired'\)/);
  assert.match(sql, /SET state = 'running'/);
  assert.match(sql, /FOREIGN KEY \(job_id, node_id\)[\s\S]+REFERENCES public\.mastermind_node_jobs_v1\(job_id, node_id\)/);
});

test('migration rejects stale authority while allowing durable prior-boot receipts', async () => {
  const sql = await fs.readFile(migrationUrl, 'utf8');
  assert.doesNotMatch(sql, /receipt boot mismatch/);
  assert.match(sql, /node receipt sequence did not advance/);
  assert.match(sql, /node receipt followed a terminal outcome/);
  assert.match(sql, /node receipt regressed job progress/);
  assert.equal((sql.match(/NULLIF\(v_receipt -> 'result', 'null'::jsonb\)/g) ?? []).length, 3);
  assert.match(sql, /SET state = 'queued', lease_id = NULL, leased_at = NULL, lease_expires_at = NULL/);
  assert.match(sql, /SET state = 'leased', lease_id = p_candidate_lease_id/);
  assert.equal((sql.match(/v_now \+ interval '15 minutes'/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /interval '60 seconds'/);
  assert.match(sql, /exchange replay repeats its acknowledgements, never its old authority/);
  assert.match(sql, /response_lease[\s\S]+lease_id = \(v_exchange\.response_lease ->> 'leaseId'\)::uuid[\s\S]+lease_expires_at > v_now/);
  assert.match(sql, /RETURN QUERY SELECT 'duplicate'::text, v_exchange\.exchange_id, v_now/);
  assert.doesNotMatch(sql, /RETURN QUERY SELECT 'duplicate'::text, v_exchange\.exchange_id, v_exchange\.received_at/);
});

test('migration makes pairing retry-safe and the first terminal outcome immutable', async () => {
  const sql = await fs.readFile(migrationUrl, 'utf8');
  assert.match(sql, /v_existing_node\.credential_sha256 = p_credential_sha256/);
  assert.match(sql, /v_existing_node\.display_name = p_display_name/);
  assert.match(sql, /node pairing claim conflicts with its first use/);
  assert.match(sql, /terminal_code IS DISTINCT FROM v_receipt ->> 'code'/);
  assert.match(sql, /terminal_result IS DISTINCT FROM NULLIF\(v_receipt -> 'result', 'null'::jsonb\)/);
  assert.match(sql, /First terminal outcome wins/);
});

test('reviewed migration digest is pinned by the migration runner', async () => {
  const sql = await fs.readFile(migrationUrl, 'utf8');
  const leasePresenceSql = await fs.readFile(leasePresenceMigrationUrl, 'utf8');
  const runner = await fs.readFile(new URL('../../../../scripts/apply-memory-migrations.mjs', import.meta.url), 'utf8');
  const digest = crypto.createHash('sha256').update(sql).digest('hex');
  const leasePresenceDigest = crypto.createHash('sha256').update(leasePresenceSql).digest('hex');
  assert.match(runner, new RegExp(`004_mastermind_node_exchange_v1\\.sql'[\\s\\S]{0,160}${digest}`));
  assert.match(
    runner,
    new RegExp(`005_mastermind_node_exchange_lease_presence_v1\\.sql'[\\s\\S]{0,160}${leasePresenceDigest}`),
  );
  assert.match(runner, /mastermind_nodes_v1/);
  assert.match(runner, /mastermind_node_jobs_v1/);
});

test('additive lease-presence migration changes only composite row existence predicates', async () => {
  const originalSql = await fs.readFile(migrationUrl, 'utf8');
  const repairSql = await fs.readFile(leasePresenceMigrationUrl, 'utf8');
  const originalFunction = extractExchangeFunction(originalSql);
  const repairFunction = extractExchangeFunction(repairSql);
  const expectedFunction = originalFunction
    .replace('IF v_job IS NULL THEN', 'IF v_job.job_id IS NULL THEN')
    .replace('IF v_job IS NOT NULL AND', 'IF v_job.job_id IS NOT NULL AND');

  assert.notEqual(expectedFunction, originalFunction, 'regression fixture contains the faulty predicates');
  assert.equal(repairFunction, expectedFunction);
  assert.match(repairFunction, /IF v_job\.job_id IS NULL THEN/);
  assert.match(repairFunction, /IF v_job\.job_id IS NOT NULL AND v_job\.state IN \('leased', 'running'\) THEN/);
  assert.doesNotMatch(repairFunction, /IF v_job IS (?:NOT )?NULL/);
  assert.equal((repairSql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 1);
  assert.doesNotMatch(repairSql, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE)\b/i);
  assert.match(repairSql.trim(), /^BEGIN;[\s\S]*COMMIT;$/);
});
