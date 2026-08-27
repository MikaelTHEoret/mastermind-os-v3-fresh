import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  here,
  '../../../../memory-system/migrations/003_mastermind_memory_operator_v1.sql',
);

async function migration() {
  return fs.readFile(migrationPath, 'utf8');
}

function functionBlock(sql, name, nextName) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = nextName
    ? sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nextName}`, start + 1)
    : sql.indexOf('COMMIT;', start + 1);
  assert.ok(start >= 0, `${name} function is missing`);
  assert.ok(end > start, `${name} function block is incomplete`);
  return sql.slice(start, end);
}

test('memory operator v1 adds only rebuild-stable lifecycle, plans, and payload-free receipts', async () => {
  const sql = await migration();
  for (const table of [
    'mastermind_memory_lifecycle_v1',
    'mastermind_memory_forget_plans_v1',
    'mastermind_memory_action_receipts_v1',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.doesNotMatch(sql, /\bharmonic_memories\b/i);
  assert.doesNotMatch(sql, /\bvector\s*\(/i);
  assert.doesNotMatch(sql, /sanitized_payload|mastermind_domain_event_receipts_v1/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM|TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(sql, /FOREIGN KEY \(memory_key\)[\s\S]{0,120}mastermind_memory_projection_jobs_v1/i);
  assert.match(sql, /Missing row is active revision 1/);
  assert.match(sql, /revision bigint NOT NULL[\s\S]*revision >= 2/);
  assert.match(sql, /lifecycle_state IN \('active', 'forgotten'\)/);
});

test('operator authority is active-parent only and is not general recall consent', async () => {
  const sql = await migration();
  const block = functionBlock(
    sql,
    'verify_mastermind_memory_operator_v1',
    'search_mastermind_operator_memories_v1',
  );
  assert.match(block, /RETURNS boolean\s+LANGUAGE sql\s+STABLE/);
  assert.match(block, /operator_household\.state = 'active'/);
  assert.match(block, /operator_player\.role = 'parent'/);
  assert.match(block, /operator_player\.state = 'active'/);
  assert.match(block, /operator_player\.player_id = p_actor_player_id/);
  assert.doesNotMatch(block, /consent|recall|family_share|provider|alias/i);
});

test('search authorizes materialized sanitized candidates before bounded text ranking', async () => {
  const sql = await migration();
  const block = functionBlock(
    sql,
    'search_mastermind_operator_memories_v1',
    'create_mastermind_memory_forget_plan_v1',
  );
  assert.match(
    block,
    /search_mastermind_operator_memories_v1\(\s*p_household_id text,\s*p_actor_player_id uuid,\s*p_query text,\s*p_mode text,\s*p_limit integer\s*\)/,
  );
  for (const column of [
    'memory_key text', 'revision bigint', 'summary text', 'namespace text', 'visibility text',
    'player_id text', 'world_ref text', 'session_id uuid', 'occurred_at timestamptz',
    'lifecycle_state text',
  ]) assert.match(block, new RegExp(column.replaceAll('_', '\\_')));
  assert.match(block, /char_length\(p_query\) > 512/);
  assert.match(block, /p_mode NOT IN \('active', 'forgotten'\)/);
  assert.match(block, /p_limit NOT BETWEEN 1 AND 20/);
  assert.match(block, /pg_advisory_xact_lock\(hashtextextended\(p_household_id, 0\)\)/);
  assert.match(block, /WITH authorized_candidates AS MATERIALIZED/);
  assert.match(block, /verify_mastermind_memory_operator_v1\(\s*projection\.household_id,\s*p_actor_player_id/);
  assert.match(block, /COALESCE\(lifecycle\.revision, 1::bigint\)/);
  assert.match(block, /COALESCE\(lifecycle\.lifecycle_state, 'active'::text\) = p_mode/);
  assert.match(block, /p_query = ''[\s\S]*websearch_to_tsquery\('simple', p_query\)/);
  assert.ok(block.indexOf('authorized_candidates AS MATERIALIZED') < block.indexOf('ts_rank_cd('));
  assert.doesNotMatch(block, /embedding|metadata|receipt|sanitized_payload|harmonic_memories/i);
});

test('forget plans are digest-bound, revision-bound, delayed 1500ms, and expire after five minutes', async () => {
  const sql = await migration();
  const block = functionBlock(
    sql,
    'create_mastermind_memory_forget_plan_v1',
    'apply_mastermind_memory_forget_v1',
  );
  assert.match(
    block,
    /create_mastermind_memory_forget_plan_v1\(\s*p_plan_id uuid,\s*p_plan_digest text,\s*p_household_id text,\s*p_actor_player_id uuid,\s*p_memory_key text,\s*p_expected_revision bigint\s*\)/,
  );
  assert.match(block, /plan_digest text[\s\S]*not_before timestamptz[\s\S]*expires_at timestamptz/);
  assert.match(block, /pg_advisory_xact_lock\(hashtextextended\(p_plan_id::text, 30\)\)/);
  assert.ok(
    block.indexOf('hashtextextended(p_plan_id::text, 30)')
      < block.indexOf('hashtextextended(p_household_id, 0)'),
  );
  assert.match(block, /v_existing_digest = p_plan_digest[\s\S]*'duplicate'::text[\s\S]*ERRCODE = 'MM003'/);
  assert.match(block, /verify_mastermind_memory_operator_v1\(p_household_id, p_actor_player_id\)/);
  assert.match(block, /v_current_state <> 'active' OR v_current_revision <> p_expected_revision/);
  assert.equal((block.match(/interval '1500 milliseconds'/g) ?? []).length, 2);
  assert.equal((block.match(/interval '5 minutes'/g) ?? []).length, 2);
});

test('forget application binds the exact plan and is effect-once under the household lock', async () => {
  const sql = await migration();
  const block = functionBlock(
    sql,
    'apply_mastermind_memory_forget_v1',
    'apply_mastermind_memory_restore_v1',
  );
  assert.match(
    block,
    /apply_mastermind_memory_forget_v1\(\s*p_action_id uuid,\s*p_action_digest text,\s*p_household_id text,\s*p_actor_player_id uuid,\s*p_plan_id uuid,\s*p_plan_digest text\s*\)/,
  );
  assert.match(block, /RETURNS TABLE \(\s*status text,\s*action_id uuid,\s*memory_key text,\s*revision bigint,\s*lifecycle_state text\s*\)/);
  assert.match(block, /pg_advisory_xact_lock\(hashtextextended\(p_action_id::text, 31\)\)/);
  assert.ok(
    block.indexOf('hashtextextended(p_action_id::text, 31)')
      < block.indexOf('hashtextextended(p_household_id, 0)'),
  );
  assert.match(block, /v_receipt_digest = p_action_digest[\s\S]*'duplicate'::text[\s\S]*ERRCODE = 'MM003'/);
  assert.match(block, /stored_plan\.plan_digest = p_plan_digest/);
  assert.match(block, /FOR UPDATE;[\s\S]*consumed\.plan_id = p_plan_id/);
  assert.match(block, /v_now < v_plan_not_before[\s\S]*ERRCODE = 'MM001'/);
  assert.match(block, /v_now >= v_plan_expires_at[\s\S]*ERRCODE = 'MM002'/);
  assert.match(block, /v_current_state <> 'active' OR v_current_revision <> v_plan_expected_revision/);
  assert.match(block, /v_result_revision := v_current_revision \+ 1/);
  assert.match(block, /INSERT INTO public\.mastermind_memory_action_receipts_v1/);
  assert.doesNotMatch(block, /DELETE\s+FROM|UPDATE public\.mastermind_memory_projection_jobs_v1/i);
});

test('restore is a direct reversible CAS with the same effect-once receipt discipline', async () => {
  const sql = await migration();
  const block = functionBlock(sql, 'apply_mastermind_memory_restore_v1');
  assert.match(
    block,
    /apply_mastermind_memory_restore_v1\(\s*p_action_id uuid,\s*p_action_digest text,\s*p_household_id text,\s*p_actor_player_id uuid,\s*p_memory_key text,\s*p_expected_revision bigint\s*\)/,
  );
  assert.match(block, /RETURNS TABLE \(\s*status text,\s*action_id uuid,\s*memory_key text,\s*revision bigint,\s*lifecycle_state text\s*\)/);
  assert.match(block, /p_expected_revision NOT BETWEEN 2 AND 9223372036854775806/);
  assert.match(block, /v_receipt_digest = p_action_digest[\s\S]*v_receipt_action = 'restore'/);
  assert.match(block, /v_current_state <> 'forgotten'/);
  assert.match(block, /lifecycle_state = 'active'[\s\S]*forgotten_at = NULL/);
  assert.match(block, /v_result_revision := v_current_revision \+ 1/);
  assert.match(block, /'restore'[\s\S]*'active'/);
  assert.doesNotMatch(block, /DELETE\s+FROM|UPDATE public\.mastermind_memory_projection_jobs_v1/i);
});

test('custom SQLSTATEs distinguish timing, expiry, CAS, authorization, and target failures', async () => {
  const sql = await migration();
  const expected = new Map([
    ['MM001', 'not ready'],
    ['MM002', 'expired or consumed'],
    ['MM003', 'revision or state changed'],
    ['MM004', 'not authorized'],
    ['MM005', 'invalid'],
  ]);
  for (const [code, phrase] of expected) {
    assert.match(sql, new RegExp(`ERRCODE = '${code}'`));
    assert.match(sql, new RegExp(phrase));
  }
  assert.doesNotMatch(sql, /ERRCODE = '40001'/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS mastermind_memory_action_receipts_v1_forget_plan_idx/);
  assert.match(sql, /WHERE action = 'forget'/);
  assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.mastermind_memory_forget_plans_v1 FROM PUBLIC/);
  assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.mastermind_memory_action_receipts_v1 FROM PUBLIC/);
});
