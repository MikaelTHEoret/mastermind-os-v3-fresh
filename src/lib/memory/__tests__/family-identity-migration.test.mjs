import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  here,
  '../../../../memory-system/migrations/002_mastermind_family_identity_v1.sql',
);

async function migration() {
  return fs.readFile(migrationPath, 'utf8');
}

test('family identity v1 is additive, structured, revisioned, and contains no vector write path', async () => {
  const sql = await migration();
  for (const table of [
    'mastermind_households_v1',
    'mastermind_players_v1',
    'mastermind_player_external_identities_v1',
    'mastermind_player_consents_v1',
    'mastermind_identity_command_receipts_v1',
    'mastermind_identity_audit_v1',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.match(sql, /role IN \('parent', 'child', 'guest', 'service'\)/);
  assert.match(sql, /state IN \('active', 'archived'\)/);
  assert.match(sql, /provider IN \('minecraft-java', 'clerk', 'local'\)/);
  assert.match(sql, /provider = 'minecraft-java' AND provider_subject ~ '\^\[0-9a-f\]\{32\}\$'/);
  assert.match(sql, /provider = 'clerk' AND provider_subject ~ '\^user_\[A-Za-z0-9_-\]\{1,123\}\$'/);
  assert.match(sql, /provider = 'local' AND provider_subject ~ '\^\[a-z0-9\]/);
  assert.match(sql, /Non-authoritative display-only alias; never accepted by authorization or identity lookup/);
  assert.match(sql, /revision bigint NOT NULL DEFAULT 1/);
  assert.doesNotMatch(sql, /\bvector\s*\(/i);
  assert.doesNotMatch(sql, /harmonic_memories/i);
  assert.doesNotMatch(sql, /INSERT INTO public\.mastermind_memory_projection_jobs_v1/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
});

test('consent is purpose-keyed and absence remains deny', async () => {
  const sql = await migration();
  assert.match(
    sql,
    /purpose IN \('capture', 'recall', 'session_summary', 'preference_learning', 'family_share', 'obsidian_export'\)/,
  );
  assert.match(sql, /decision IN \('allow', 'deny'\)/);
  assert.match(sql, /A missing row is always deny/);
  assert.match(sql, /actor_recall\.purpose = 'recall'[\s\S]*actor_recall\.decision = 'allow'/);
  assert.match(sql, /subject_share\.purpose = 'family_share'[\s\S]*subject_share\.decision = 'allow'/);
  assert.match(sql, /session_share\.decision = 'allow'/);
});

test('capture and session-summary consent guard the existing ingest tables fail closed', async () => {
  const sql = await migration();
  const captureStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.enforce_mastermind_companion_capture_v1');
  const captureEnd = sql.indexOf('CREATE OR REPLACE TRIGGER mastermind_domain_event_receipts_v1_capture_guard');
  const captureGuard = sql.slice(captureStart, captureEnd);
  const summaryStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.enforce_mastermind_session_summary_v1');
  const summaryEnd = sql.indexOf('CREATE OR REPLACE TRIGGER mastermind_memory_projection_jobs_v1_summary_guard');
  const summaryGuard = sql.slice(summaryStart, summaryEnd);
  const householdLock = 'pg_advisory_xact_lock(hashtextextended(NEW.household_id, 0))';
  assert.ok(captureStart >= 0 && captureEnd > captureStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.match(sql, /enforce_mastermind_companion_capture_v1\(\)/);
  assert.match(
    sql,
    /mastermind_domain_event_receipts_v1_capture_guard\s+BEFORE INSERT ON public\.mastermind_domain_event_receipts_v1/,
  );
  assert.match(sql, /NEW\.domain = 'companion'/);
  assert.equal((captureGuard.match(/pg_advisory_xact_lock\(hashtextextended\(NEW\.household_id, 0\)\)/g) ?? []).length, 1);
  assert.ok(captureGuard.indexOf(householdLock) < captureGuard.indexOf('NOT EXISTS'));
  assert.match(sql, /capture_player\.player_id::text = NEW\.player_id/);
  assert.match(sql, /capture_consent\.purpose = 'capture'[\s\S]*capture_consent\.decision = 'allow'/);
  assert.match(sql, /enforce_mastermind_session_summary_v1\(\)/);
  assert.match(
    sql,
    /mastermind_memory_projection_jobs_v1_summary_guard\s+BEFORE INSERT OR UPDATE ON public\.mastermind_memory_projection_jobs_v1/,
  );
  assert.equal((summaryGuard.match(/pg_advisory_xact_lock\(hashtextextended\(NEW\.household_id, 0\)\)/g) ?? []).length, 1);
  assert.ok(summaryGuard.indexOf(householdLock) < summaryGuard.indexOf('NOT EXISTS'));
  assert.match(sql, /summary_consent\.purpose = 'session_summary'[\s\S]*summary_consent\.decision = 'allow'/);
  assert.match(sql, /summary_session\.session_id = NEW\.session_id/);
});

test('the command transaction has the exact adapter signature and effect-once CAS mechanics', async () => {
  const sql = await migration();
  assert.match(
    sql,
    /apply_mastermind_identity_command_v1\(\s*p_command_id uuid,\s*p_command_sha256 text,\s*p_action text,\s*p_household_id text,\s*p_actor_player_id uuid,\s*p_subject_player_id uuid,\s*p_expected_revision bigint,\s*p_household_display_name text,\s*p_player_display_name text,\s*p_role text,\s*p_provider text,\s*p_provider_subject text,\s*p_provider_alias text,\s*p_purpose text,\s*p_decision text\s*\)/,
  );
  assert.match(
    sql,
    /RETURNS TABLE \(\s*status text,\s*command_id uuid,\s*household_revision bigint,\s*player_revision bigint,\s*subject_player_id uuid\s*\)/,
  );
  for (const action of [
    'household.bootstrap',
    'player.register',
    'identity.bind',
    'consent.set',
    'player.archive',
  ]) {
    assert.match(sql, new RegExp(action.replace('.', '\\.')));
  }
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_command_id::text, 20\)\)/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_household_id, 0\)\)/);
  assert.doesNotMatch(sql, /hashtextextended\((?:p_household_id|NEW\.household_id), 21\)/);
  assert.match(sql, /ON CONFLICT ON CONSTRAINT mastermind_identity_command_receipts_v1_pkey DO NOTHING/);
  assert.match(sql, /v_existing_sha256 = p_command_sha256[\s\S]*'duplicate'::text[\s\S]*'conflict'::text/);
  assert.match(sql, /'conflict'::text,\s*p_command_id,\s*NULL::bigint,\s*NULL::bigint,\s*NULL::uuid/);
  assert.match(sql, /subject\.revision = p_expected_revision/);
  assert.match(sql, /ERRCODE = '40001', MESSAGE = 'identity revision conflict'/);
  assert.match(sql, /actor\.state = 'active'[\s\S]*v_actor_role <> 'parent'/);
  assert.match(sql, /the last active parent cannot be archived/);
});

test('audit is append-only and payload-free', async () => {
  const sql = await migration();
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.mastermind_identity_audit_v1');
  const end = sql.indexOf('CREATE OR REPLACE FUNCTION public.apply_mastermind_identity_command_v1');
  const auditBlock = sql.slice(start, end);
  const auditColumns = auditBlock.slice(0, auditBlock.indexOf('COMMENT ON TABLE'));
  assert.ok(start >= 0 && end > start);
  assert.match(auditBlock, /PRIMARY KEY \(command_id\)/);
  assert.match(auditBlock, /REVOKE UPDATE, DELETE, TRUNCATE/);
  assert.match(auditBlock, /ON UPDATE TO public\.mastermind_identity_audit_v1 DO INSTEAD NOTHING/);
  assert.match(auditBlock, /ON DELETE TO public\.mastermind_identity_audit_v1 DO INSTEAD NOTHING/);
  assert.doesNotMatch(auditColumns, /jsonb|payload|display_name|provider_subject|provider_alias/i);
  assert.equal((sql.match(/INSERT INTO public\.mastermind_identity_audit_v1/g) ?? []).length, 1);
});

test('read authorization is a stable SQL pre-ranking predicate with bounded namespace rules', async () => {
  const sql = await migration();
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.mastermind_can_read_memory_v1');
  const readBlock = sql.slice(start);
  assert.ok(start >= 0);
  assert.match(readBlock, /RETURNS boolean\s+LANGUAGE sql\s+STABLE/);
  assert.match(readBlock, /p_subject_player_id uuid/);
  assert.match(readBlock, /household\.state = 'active'/);
  assert.match(readBlock, /actor\.state = 'active'/);
  assert.match(readBlock, /p_namespace <> 'system\/technical'/);
  assert.match(readBlock, /'player\/' \|\| actor\.player_id::text \|\| '\/private'/);
  assert.match(readBlock, /p_subject_player_id = actor\.player_id/);
  assert.match(readBlock, /p_namespace = 'family\/shared'/);
  assert.match(readBlock, /\^world\/world-\[a-f0-9\]\{64\}\$/);
  assert.match(readBlock, /\^project\/\[a-z0-9\]/);
  assert.match(readBlock, /'player\/' \|\| shared_subject\.player_id::text \|\| '\/shared'/);
  assert.match(readBlock, /shared_subject\.player_id = p_subject_player_id/);
  assert.match(readBlock, /mastermind_companion_sessions_v1 AS companion_session/);
  assert.match(readBlock, /session_subject\.player_id = p_subject_player_id/);
  assert.doesNotMatch(readBlock, /mastermind_player_external_identities_v1|provider_alias/);
});
