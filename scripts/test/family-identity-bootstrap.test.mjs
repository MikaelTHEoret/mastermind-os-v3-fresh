import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyFamilyIdentityBootstrapPlan,
  applyFamilyIdentityBootstrapPlanFile,
  buildFamilyIdentityBootstrapPlan,
  createFamilyIdentityBootstrapPlanFile,
  parseFamilyIdentityBootstrapLaunch,
  readFamilyIdentityBootstrapPlanFile,
  validateFamilyIdentityBootstrapPlan,
  waitForFamilyIdentityService,
} from '../lib/family-identity-bootstrap.mjs';
import { LOCAL_FAMILY_OPERATOR_PROFILE } from '../../src/lib/memory/local-family-profile.mjs';

const TOKEN = 'not-printed-'.repeat(4);
const UUIDS = Object.freeze(Array.from({ length: 6 }, (_, index) => (
  `00000000-0000-8000-8000-${String(index + 1).padStart(12, '0')}`
)));

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deterministicPlan() {
  let index = 0;
  return buildFamilyIdentityBootstrapPlan({ randomUUID: () => UUIDS[index++] });
}

function jsonResponse(body, status = 200) {
  const bytes = JSON.stringify(body);
  return new Response(bytes, {
    status,
    headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bytes)) },
  });
}

function receipt(record, status = 'applied', revision = 1) {
  const command = JSON.parse(record.body);
  return {
    ok: true,
    status,
    commandId: record.commandId,
    householdRevision: revision,
    playerRevision: command.expectedRevision + 1,
    playerId: command.payload.playerId,
  };
}

async function temporaryPlan(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-family-identity-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const file = path.join(directory, 'bootstrap-plan.json');
  const plan = deterministicPlan();
  await createFamilyIdentityBootstrapPlanFile(file, {
    randomUUID: (() => {
      let index = 0;
      return () => UUIDS[index++];
    })(),
  });
  return { directory, file, plan };
}

test('builds only the fixed parent plus service bootstrap and two narrow consents', () => {
  const plan = deterministicPlan();
  assert.equal(plan.householdId, 'family-local');
  assert.equal(plan.parentPlayerId, LOCAL_FAMILY_OPERATOR_PROFILE.parentPlayerId);
  assert.equal(plan.servicePlayerId, UUIDS[0]);
  assert.deepEqual(plan.commands.map(({ commandId, body }) => {
    const parsed = JSON.parse(body);
    assert.equal(parsed.commandId, commandId);
    assert.equal(body, canonical(parsed));
    return {
      action: parsed.action,
      actor: parsed.actorPlayerId ?? null,
      expectedRevision: parsed.expectedRevision,
      playerId: parsed.payload.playerId,
      role: parsed.payload.role ?? null,
      purpose: parsed.payload.purpose ?? null,
      decision: parsed.payload.decision ?? null,
    };
  }), [
    { action: 'household.bootstrap', actor: null, expectedRevision: 0, playerId: LOCAL_FAMILY_OPERATOR_PROFILE.parentPlayerId, role: null, purpose: null, decision: null },
    { action: 'player.register', actor: LOCAL_FAMILY_OPERATOR_PROFILE.parentPlayerId, expectedRevision: 0, playerId: UUIDS[0], role: 'service', purpose: null, decision: null },
    { action: 'consent.set', actor: LOCAL_FAMILY_OPERATOR_PROFILE.parentPlayerId, expectedRevision: 1, playerId: UUIDS[0], role: null, purpose: 'capture', decision: 'allow' },
    { action: 'consent.set', actor: LOCAL_FAMILY_OPERATOR_PROFILE.parentPlayerId, expectedRevision: 2, playerId: UUIDS[0], role: null, purpose: 'session_summary', decision: 'allow' },
  ]);
  const serialized = JSON.stringify(plan);
  for (const forbidden of ['child', 'recall', 'preference_learning', 'family_share', 'obsidian_export', 'identity.bind', 'player.archive']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace('.', '\\.')));
  }
  assert.deepEqual(validateFamilyIdentityBootstrapPlan(structuredClone(plan)), plan);
});

test('writes one bounded canonical plan with wx and never overwrites it', async (t) => {
  const { file, plan } = await temporaryPlan(t);
  const before = await fs.readFile(file, 'utf8');
  assert.equal(before, `${canonical(JSON.parse(before))}\n`);
  assert.deepEqual(await readFamilyIdentityBootstrapPlanFile(file), plan);
  await assert.rejects(createFamilyIdentityBootstrapPlanFile(file), { code: 'BOOTSTRAP_PLAN_EXISTS' });
  assert.equal(await fs.readFile(file, 'utf8'), before);
});

test('rejects expanded consent scope, changed commands, and oversized plan files', async (t) => {
  const plan = structuredClone(deterministicPlan());
  const command = JSON.parse(plan.commands[3].body);
  command.payload.purpose = 'recall';
  plan.commands[3].body = JSON.stringify(command);
  assert.throws(() => validateFamilyIdentityBootstrapPlan(plan), { code: 'BOOTSTRAP_PLAN_SCOPE_VIOLATION' });

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-family-identity-large-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const file = path.join(directory, 'large.json');
  await fs.writeFile(file, 'x'.repeat(65 * 1024));
  await assert.rejects(readFamilyIdentityBootstrapPlanFile(file), { code: 'BOOTSTRAP_PLAN_BOUNDS' });
});

test('bootstrap launch is mutually exclusive with sync and every inherited player binding', () => {
  const file = path.resolve('bootstrap.json');
  assert.deepEqual(
    parseFamilyIdentityBootstrapLaunch({ args: ['--family-identity-bootstrap', file] }),
    { planFile: file },
  );
  assert.throws(() => parseFamilyIdentityBootstrapLaunch({
    args: ['--family-identity-bootstrap', file, '--memory-event-sync'],
  }), { code: 'BOOTSTRAP_SYNC_CONFLICT' });
  assert.throws(() => parseFamilyIdentityBootstrapLaunch({
    args: ['--family-identity-bootstrap', file],
    environment: { mastermind_memory_event_sync_enabled: 'true' },
  }), { code: 'BOOTSTRAP_SYNC_CONFLICT' });
  assert.throws(() => parseFamilyIdentityBootstrapLaunch({
    args: ['--family-identity-bootstrap', file],
    environment: { mastermind_memory_player_id: '' },
  }), { code: 'BOOTSTRAP_PLAYER_CONFLICT' });
  assert.throws(() => parseFamilyIdentityBootstrapLaunch({ args: ['--family-identity-bootstrap'] }), {
    code: 'BOOTSTRAP_ARGUMENT_INVALID',
  });
  assert.throws(() => parseFamilyIdentityBootstrapLaunch({
    args: ['--production', '--family-identity-bootstrap', file, 'unexpected'],
  }), { code: 'BOOTSTRAP_ARGUMENT_INVALID' });
  assert.deepEqual(parseFamilyIdentityBootstrapLaunch({
    args: ['--production', '--family-identity-bootstrap', file],
  }), { planFile: file });
});

test('waits for Next readiness without sending the bearer or a mutation', async () => {
  const calls = [];
  await waitForFamilyIdentityService({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) throw new Error('not listening');
      return jsonResponse({ status: 'healthy' });
    },
  });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'http://127.0.0.1:3000/api/health');
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(call.options.body, undefined);
  }
});

test('submits exact canonical commands and accepts only matching applied receipts', async () => {
  const plan = deterministicPlan();
  const calls = [];
  const result = await applyFamilyIdentityBootstrapPlan(plan, {
    token: TOKEN,
    fetchImpl: async (url, options) => {
      const record = plan.commands[calls.length];
      calls.push({ url, options });
      return jsonResponse(receipt(record, 'applied', calls.length));
    },
  });
  assert.equal(result.servicePlayerId, plan.servicePlayerId);
  assert.equal(result.receipts.length, 4);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.url, 'http://127.0.0.1:3000/api/memory/identity');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.body, plan.commands[index].body);
    assert.equal(call.options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.doesNotMatch(call.url + call.options.body, new RegExp(TOKEN));
  }
});

test('an ambiguous partial apply retries safely through the same stable command IDs', async () => {
  const plan = deterministicPlan();
  let firstCalls = 0;
  await assert.rejects(applyFamilyIdentityBootstrapPlan(plan, {
    token: TOKEN,
    fetchImpl: async () => {
      firstCalls += 1;
      if (firstCalls === 2) throw new Error(`transport included ${TOKEN}`);
      return jsonResponse(receipt(plan.commands[0]));
    },
  }), (error) => error?.code === 'BOOTSTRAP_TRANSPORT_AMBIGUOUS' && !error.message.includes(TOKEN));
  assert.equal(firstCalls, 2);

  let retryCalls = 0;
  const retried = await applyFamilyIdentityBootstrapPlan(plan, {
    token: TOKEN,
    fetchImpl: async () => {
      const record = plan.commands[retryCalls];
      const status = retryCalls === 0 ? 'duplicate' : 'applied';
      retryCalls += 1;
      return jsonResponse(receipt(record, status, retryCalls));
    },
  });
  assert.deepEqual(retried.receipts.map(({ status }) => status), ['duplicate', 'applied', 'applied', 'applied']);
});

test('store rejection halts, preserves the explicit plan, and never leaks the bearer', async (t) => {
  for (const [status, code] of [[503, 'IDENTITY_STORE_UNAVAILABLE'], [409, 'IDENTITY_REVISION_CONFLICT']]) {
    await t.test(code, async (subtest) => {
      const { file } = await temporaryPlan(subtest);
      const before = await fs.readFile(file, 'utf8');
      let calls = 0;
      await assert.rejects(applyFamilyIdentityBootstrapPlanFile(file, {
        token: TOKEN,
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ ok: false, code, message: `private ${TOKEN}` }, status);
        },
      }), (error) => (
        error?.code === 'BOOTSTRAP_COMMAND_REJECTED'
        && error.message.includes(code)
        && !error.message.includes(TOKEN)
      ));
      assert.equal(calls, 1);
      assert.equal(await fs.readFile(file, 'utf8'), before);
    });
  }
});

test('mismatched successful receipts halt before the next command', async () => {
  const plan = deterministicPlan();
  let calls = 0;
  await assert.rejects(applyFamilyIdentityBootstrapPlan(plan, {
    token: TOKEN,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ ...receipt(plan.commands[0]), commandId: UUIDS[5] });
    },
  }), { code: 'BOOTSTRAP_RESPONSE_INVALID' });
  assert.equal(calls, 1);
});

test('an undeclared oversized response body is cancelled at the streaming hard cap', async () => {
  const plan = deterministicPlan();
  let cancelled = false;
  await assert.rejects(applyFamilyIdentityBootstrapPlan(plan, {
    token: TOKEN,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array((64 * 1024) + 1));
      },
      cancel() { cancelled = true; },
    }), { status: 200 }),
  }), { code: 'BOOTSTRAP_RESPONSE_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('the per-command timeout remains active while a response body is stalled', async () => {
  const plan = deterministicPlan();
  await assert.rejects(applyFamilyIdentityBootstrapPlan(plan, {
    token: TOKEN,
    requestTimeoutMs: 20,
    fetchImpl: async (_url, options) => new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
      },
    }), { status: 200 }),
  }), (error) => error?.code === 'BOOTSTRAP_TRANSPORT_AMBIGUOUS' && !error.message.includes(TOKEN));
});

test('the supervisor source never interpolates or prints its in-memory control token', async () => {
  const source = await fs.readFile(new URL('../run-local-control.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*controlToken/);
  assert.match(source, /applyFamilyIdentityBootstrapPlan\(familyIdentityBootstrapPlan, \{ token: controlToken \}\)/);
});
