import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const sql = await fs.readFile(new URL('../../../../memory-system/migrations/021_mastermind_node_core_status_v2.sql', import.meta.url), 'utf8');
const engine = sql.match(/CREATE OR REPLACE FUNCTION public\.exchange_mastermind_node_negotiated_v2\([\s\S]*?\n\$\$;/)[0];

test('legacy entrypoint installs fixed family-only filtering before broadening the job constraint', () => {
  const legacy = sql.match(/CREATE OR REPLACE FUNCTION public\.exchange_mastermind_node_v1\([\s\S]*?\n\$\$;/)[0];
  assert.match(legacy, /exchange_mastermind_node_negotiated_v2/);
  assert.match(legacy, /"protocolVersion":1,"capabilities":\[\{"id":"family-ecosystem.ensure-running","version":1\}\]/);
  assert.doesNotMatch(legacy, /p_worker/);
  assert(sql.indexOf(legacy) < sql.indexOf('DROP CONSTRAINT mastermind_node_jobs_v1_capability_check'));
});

test('every authority-bearing job selection is filtered by negotiated capability and exact version', () => {
  const selections = engine.match(/SELECT \* INTO v_job[\s\S]*?FOR UPDATE(?: SKIP LOCKED)?;/g);
  assert.equal(selections.length, 4, 'replay, receipt, active renewal, queued lease');
  for (const query of selections) assert.match(query,
    /mastermind_node_worker_supports_v2\(p_worker, mastermind_node_jobs_v1\.capability, mastermind_node_jobs_v1\.capability_version\)/);
  assert.match(engine, /NOT COALESCE\(public\.mastermind_node_worker_valid_v2\(p_worker\), false\)/);
  assert.match(sql, /item -> 'version' IS DISTINCT FROM '1'::jsonb/);
});

test('core leases never extend queued expiry while existing family startup window is retained', () => {
  assert.match(engine, /WHEN capability = 'family-ecosystem.ensure-running' THEN GREATEST\(expires_at, created_at \+ interval '2 hours'\) ELSE expires_at END/);
  assert.equal((engine.match(/ELSE LEAST\(expires_at, v_now \+ interval '30 seconds'\) END/g) ?? []).length, 2);
  assert.match(engine, /lease_expires_at > v_now/);
  assert.match(engine, /state = 'queued' AND expires_at > v_now \+ interval '1 second'/);
  assert.match(engine, /RETURN QUERY SELECT 'duplicate'::text, v_exchange\.exchange_id, v_now/);
});

test('core enqueue reuses parent authority, existing job IDs/coalescing and immutable receipt outcomes', () => {
  const enqueue = sql.match(/CREATE OR REPLACE FUNCTION public\.enqueue_mastermind_core_status_job_v2\([\s\S]*?\n\$\$;/)[0];
  assert.match(enqueue, /mastermind_active_parent_profile_v1/);
  assert.match(enqueue, /node is not available to this parent/);
  assert.match(enqueue, /RETURN QUERY SELECT 'duplicate'::text/);
  assert.match(enqueue, /RETURN QUERY SELECT 'coalesced'::text/);
  assert.match(enqueue, /capability = 'mastermind.core.status'/);
  assert.match(engine, /node receipt sequence did not advance/);
  assert.match(engine, /First terminal outcome wins/);
  assert.match(engine, /receipt result does not match its typed capability/);
  assert.doesNotMatch(sql, /SECURITY DEFINER|CREATE TABLE|TRUNCATE|DROP TABLE/);
});

test('generated migration retains explicit required NULL guards for both inherited entrypoints', () => {
  for (const field of ['p_request_sha256','p_credential_sha256','p_sent_at','p_agent_version','p_status','p_receipts','p_receipt_sha256s']) {
    assert(engine.includes(field + ' IS NULL'));
  }
  assert.match(engine, /v_node\.credential_sha256 IS DISTINCT FROM p_credential_sha256/);
  assert.match(engine, /digest IS NULL OR digest !~/);
  for (const name of ['enqueue_mastermind_node_job_v1','enqueue_mastermind_core_status_job_v2']) {
    const enqueue = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.' + name));
    const body = enqueue.slice(0, enqueue.indexOf('\n$$;'));
    for (const field of ['p_job_id','p_node_id','p_command_sha256','p_household_id','p_parent_player_id','p_expires_at']) assert(body.includes(field + ' IS NULL'));
    assert.match(body, /AND v_existing\.capability = /);
  }
  assert.match(engine, /v_receipt ->> 'state' <> 'succeeded' AND NULLIF\(v_receipt -> 'result', 'null'::jsonb\) IS NOT NULL/);
});
