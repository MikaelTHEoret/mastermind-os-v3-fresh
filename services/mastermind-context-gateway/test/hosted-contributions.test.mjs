import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ContributionStore, digest } from '../../../src/lib/delegation/store.mjs';
import { canonical } from '../../../src/lib/delegation/contract.mjs';
import { createHostedMcpTransport } from '../src/hosted-mcp-transport.mjs';
import { callContributionTool, attributedRecord, CONTRIBUTION_WRITE_SCOPE } from '../src/hosted-contributions.mjs';
import { hostedToolEnvelope } from '../src/hosted-adapter.mjs';
import { hostedOAuthPolicy, protectedHostedMetadata } from '../src/hosted-oauth-policy.mjs';
import { readBoundedJsonRequestBody } from '../../../src/lib/memory/local-service-auth.ts';

const ref = { taskId: '4196249c-dcbd-41cc-9e6f-8b87b7b2cdda', project: 'mastermind' };
const owner = { householdId: 'fixture', actorPlayerId: '8619c07c-fd41-4914-b83c-21d75cae502f' };
const assignment = () => ({ schemaVersion: 1, operationId: randomUUID(), kind: 'assignment', taskRef: ref,
  title: 'Two-computer review', request: 'Return a cited finding.', context: 'Selected source café 📚',
  sourceRefs: ['gpt/fixture#m0002-c00'], criteria: ['Distinguish evidence from inference.'], providers: ['other'], disclosure: 'selected-material' });
const response = parentId => ({ schemaVersion: 1, operationId: randomUUID(), kind: 'response', taskRef: ref, parentId,
  provider: 'other', model: 'Codex (reported)', conversationUrl: null, captureMode: 'manual', text: ' Original café 📚\n  code and trailing spaces  \n' });
const info = (scopes = ['fixture:read', CONTRIBUTION_WRITE_SCOPE], clientId = 'fixture-codex') => ({ token: 'fixture', clientId, scopes,
  extra: { clerkUserId: 'user_owner', authMode: 'clerk-oauth' } });
function fixture() {
  const records = new Map(); let allowed = true, active = true, writes = 0, accesses = 0;
  const query = async (sql, args) => {
    const owned = allowed && args[0] === ref.taskId && args[1] === ref.project && args[2] === owner.householdId && args[3] === owner.actorPlayerId;
    if (sql.includes('SELECT t.task_id::text')) return owned && (!args[4] || active) ? [{ taskId: ref.taskId }] : [];
    if (!owned) return [];
    if (sql.includes('INSERT INTO')) {
      if (!active) return [];
      const record = JSON.parse(args[8]), key = record.kind + ':' + record.operationId;
      if (records.has(key) || records.size >= 64) return [];
      const artifactId = digest(record); records.set(key, { artifactId, record, recordedAt: '2026-09-14T00:00:00.000Z' }); writes++;
      return [{ artifactId }];
    }
    if (sql.includes('a.kind=$5')) return [...records.values()].filter(row => row.record.kind === args[4] && row.record.operationId === args[5]);
    if (sql.includes('a.artifact_id=$5')) return [...records.values()].filter(row => row.artifactId === args[4]);
    return [...records.values()].reverse();
  };
  const store = () => new ContributionStore(query, owner);
  const transport = (authInfo = info(), writeEnabled = true) => createHostedMcpTransport({
    verifyToken: async (_request, token) => token === 'fixture' ? authInfo : undefined,
    gatewayForSubject: async () => ({ systemStatus: async () => ({ gateway: {} }) }),
    contributionsForSubject: async subject => { accesses++; assert.equal(subject, 'user_owner'); return store(); },
    contributionWritesEnabled: writeEnabled, requiredScopes: ['fixture:read'],
    readBody: request => readBoundedJsonRequestBody(request, { maxBytes: 65536 }),
  });
  return { records, store, transport, get writes() { return writes; }, get accesses() { return accesses; },
    revoke() { allowed = false; }, complete() { active = false; } };
}
async function rpc(handler, method, params, options = {}) {
  const request = new Request('https://mastermind.example/api/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer fixture', ...options.headers },
    body: options.raw ?? JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const response = await handler(request), raw = await response.text();
  const body = JSON.parse(response.headers.get('content-type')?.includes('text/event-stream') ? raw.split('\n').find(line => line.startsWith('data: ')).slice(6) : raw);
  return { status: response.status, ...body };
}
const call = (handler, name, args, options) => rpc(handler, 'tools/call', { name, arguments: args }, options);
const submit = (handler, record) => call(handler, 'mastermind_contribution_submit', { record });
const payload = result => { assert.equal(result.result?.isError, false, JSON.stringify(result)); return result.result.structuredContent; };

test('real SDK: two reconstructed clients exchange assignment, original result and separate review; lost reply retries once', async () => {
  const db = fixture(), first = db.transport(), a = assignment();
  const saved = payload(await submit(first, a));
  // Pretend the caller lost the first receipt and restarted.
  const fresh = db.transport(); const retried = payload(await submit(fresh, a));
  assert.equal(retried.status, 'duplicate'); assert.equal(retried.artifactId, saved.artifactId); assert.equal(db.writes, 1);
  assert.equal(saved.inputHash, digest(a)); assert.equal(saved.artifactId, digest(attributedRecord(a, saved.submission)));
  const second = db.transport(info(undefined, 'fixture-second'));
  const listed = payload(await call(second, 'mastermind_contribution_list', { taskRef: ref }));
  assert.equal(listed.records[0].artifactId, saved.artifactId);
  const part = payload(await call(second, 'mastermind_contribution_fetch', { taskRef: ref, artifactId: saved.artifactId }));
  assert.equal(JSON.parse(part.text).request, a.request);
  const original = response(saved.artifactId), received = payload(await submit(second, original));
  const review = { schemaVersion: 1, operationId: randomUUID(), kind: 'review', taskRef: ref, parentId: received.artifactId,
    decision: 'accepted-as-advice', assessment: 'One cited finding accepted.', evidenceRefs: ['test/fixture'] };
  const reviewed = payload(await submit(fresh, review)); assert.equal(reviewed.executionAuthorized, false);
  const stored = (await db.store().get(ref, received.artifactId)).record;
  assert.equal(stored.text, original.text); assert.equal(stored.captureMode, 'mcp'); assert.equal(stored.submission.clientId, 'fixture-second');
  assert.equal(db.writes, 3);
});

test('real SDK: changed content or another client cannot reuse the same operation; capacity remains bounded', async () => {
  const db = fixture(), a = assignment(), first = db.transport(); payload(await submit(first, a));
  for (const [handler, record] of [[first, { ...a, request: 'Altered' }], [db.transport(info(undefined, 'other-client')), a]]) {
    const result = await submit(handler, record); assert.equal(result.result.structuredContent.code, 'CONTRIBUTION_OPERATION_CONFLICT');
  }
  assert.equal(db.writes, 1);
  for (let i = 1; i < 64; i++) await db.store().save(assignment());
  const full = await submit(first, assignment()); assert.equal(full.result.structuredContent.code, 'CONTRIBUTION_NOT_SAVED_OR_CAPACITY_REACHED');
  assert.equal(payload(await submit(first, a)).status, 'duplicate'); assert.equal(db.writes, 64);
});

test('real SDK: optional write scope, feature switch, origin and verified auth gate every write before store access', async () => {
  const db = fixture(), a = assignment();
  const readOnly = db.transport(info(['fixture:read']));
  const denied = await submit(readOnly, a); assert.equal(denied.result.structuredContent.code, 'INSUFFICIENT_SCOPE');
  const disabled = await submit(db.transport(info(), false), a); assert.ok(disabled.error || disabled.result?.isError);
  const foreign = await call(db.transport(), 'mastermind_contribution_submit', { record: a }, { headers: { origin: 'https://foreign.example' } });
  assert.equal(foreign.status, 403);
  const auth = info(); auth.extra.authMode = 'browser-session';
  assert.equal((await submit(db.transport(auth), a)).result.structuredContent.code, 'OWNER_REQUIRED');
  assert.equal(db.accesses, 0); assert.equal(db.writes, 0);
  payload(await call(readOnly, 'mastermind_contribution_list', { taskRef: ref }));
});

test('real SDK: revoked owner, completed and foreign task, malformed parent and forged attribution cannot append', async () => {
  const db = fixture(), handler = db.transport(); const a = payload(await submit(handler, assignment()));
  const r = response(a.artifactId);
  for (const record of [{ ...r, taskRef: { ...ref, taskId: randomUUID() } }, { ...r, parentId: 'a'.repeat(64) },
    { ...r, provider: 'grok' }, { ...r, submission: { transport: 'oauth-mcp', subject: 'user_owner', clientId: 'fake' } }]) {
    const result = await submit(handler, record); assert.ok(result.error || result.result?.isError);
  }
  assert.equal(db.writes, 1); db.complete();
  assert.equal((await submit(handler, r)).result.structuredContent.code, 'CONTRIBUTION_TASK_ACCESS_DENIED');
  payload(await call(handler, 'mastermind_contribution_fetch', { taskRef: ref, artifactId: a.artifactId }));
  db.revoke();
  assert.equal((await call(handler, 'mastermind_contribution_list', { taskRef: ref })).result.structuredContent.code, 'CONTRIBUTION_TASK_ACCESS_DENIED');
  assert.equal((await call(handler, 'mastermind_contribution_fetch', { taskRef: ref, artifactId: a.artifactId })).result.structuredContent.code, 'CONTRIBUTION_UNAVAILABLE');
});

test('bounded pages and exact UTF-8 reconstruction retain a large existing report without truncation or redaction', async () => {
  const db = fixture(), store = db.store(), a = await store.save(assignment());
  const original = { ...response(a.artifact.artifactId), text: '📚 café\n'.repeat(5000) };
  const r = await store.save(original);
  for (let i = 0; i < 10; i++) await store.save(assignment());
  let after, ids = [];
  do {
    const page = await callContributionTool(store, 'mastermind_contribution_list', { taskRef: ref, ...(after ? { after } : {}) });
    hostedToolEnvelope(page); assert.ok(page.records.length <= 8); ids.push(...page.records.map(row => row.artifactId)); after = page.nextCursor;
  } while (after);
  assert.equal(new Set(ids).size, 12);
  let offset = 0, json = '';
  do {
    const part = await callContributionTool(store, 'mastermind_contribution_fetch', { taskRef: ref, artifactId: r.artifact.artifactId, offset });
    const wrapped = hostedToolEnvelope(part); assert.equal(wrapped.structuredContent.text, part.text);
    assert.equal(part.offset, offset); assert.ok(part.text.isWellFormed()); json += part.text; offset = part.nextOffset;
  } while (offset !== null);
  assert.equal(json, canonical(original)); assert.equal(digest(JSON.parse(json)), r.artifact.artifactId);
  await assert.rejects(callContributionTool(store, 'mastermind_contribution_list', { taskRef: ref, after: 'f'.repeat(64) }), { code: 'CONTRIBUTION_CURSOR_UNAVAILABLE' });
  await assert.rejects(callContributionTool(store, 'mastermind_contribution_fetch', { taskRef: ref, artifactId: r.artifact.artifactId, offset: 65536 }), { code: 'CONTRIBUTION_OFFSET_INVALID' });
});

test('sensitive originals remain stored, but fail closed instead of returning a hash with redacted bytes', async () => {
  const db = fixture(), store = db.store(); const a = assignment(); a.context = 'password=fixture-sensitive';
  const row = await store.save(a);
  await assert.rejects(callContributionTool(store, 'mastermind_contribution_fetch', { taskRef: ref, artifactId: row.artifact.artifactId }), { code: 'CONTRIBUTION_SENSITIVE_CONTENT' });
  const denied = await submit(db.transport(), a); assert.equal(denied.result.structuredContent.code, 'CONTRIBUTION_SENSITIVE_CONTENT');
  assert.equal((await store.get(ref, row.artifact.artifactId)).record.context, a.context); assert.equal(db.writes, 1);
});

test('real SDK: oversized, unsupported and unknown authority arguments fail before writes; status and tool metadata report actual permissions', async () => {
  const db = fixture(), handler = db.transport();
  const huge = assignment(); huge.context = '📚'.repeat(7000);
  const oversized = await submit(handler, huge); assert.ok(oversized.error || oversized.result?.isError);
  const raw = await call(handler, 'mastermind_contribution_submit', {}, { raw: 'x'.repeat(65537) }); assert.equal(raw.status, 413);
  const injection = await call(handler, 'mastermind_contribution_list', { taskRef: ref, householdId: 'foreign' }); assert.ok(injection.error || injection.result?.isError);
  const checkpoint = await call(handler, 'mastermind_task_checkpoint', {}); assert.ok(checkpoint.error || checkpoint.result?.isError);
  const tools = (await rpc(handler, 'tools/list')).result.tools; assert.equal(tools.length, 10);
  const submitTool = tools.find(tool => tool.name === 'mastermind_contribution_submit');
  assert.equal(submitTool.annotations.readOnlyHint, false); assert.ok(submitTool._meta.securitySchemes[0].scopes.includes(CONTRIBUTION_WRITE_SCOPE));
  for (const scopes of [['fixture:read'], ['fixture:read', CONTRIBUTION_WRITE_SCOPE]]) {
    const status = payload(await call(db.transport(info(scopes)), 'mastermind_system_status', {}));
    assert.equal(status.gateway.writeCapabilities.length, scopes.length - 1);
  }
  assert.equal(db.writes, 0);
});

test('optional discovery does not turn write permission into a requirement for read clients', () => {
  const env = { OWNER_CLERK_USER_ID: 'user_owner', MASTERMIND_MCP_OAUTH_ISSUER: 'https://issuer.example', MASTERMIND_MCP_OAUTH_RESOURCE: 'https://mastermind.example',
    MASTERMIND_MCP_OAUTH_CLIENT_IDS: '["fixture"]', MASTERMIND_MCP_OAUTH_REQUIRED_SCOPES: '["fixture:read"]' };
  assert.deepEqual(protectedHostedMetadata(hostedOAuthPolicy(env)).scopes_supported, ['fixture:read']);
  const enabled = hostedOAuthPolicy({ ...env, MASTERMIND_MCP_CONTRIBUTIONS_ENABLED: 'true', MASTERMIND_MCP_CONTRIBUTION_WRITES_ENABLED: 'true' });
  assert.deepEqual(enabled.requiredScopes, ['fixture:read']); assert.deepEqual(protectedHostedMetadata(enabled).scopes_supported, ['fixture:read', CONTRIBUTION_WRITE_SCOPE]);
  for (const changes of [{ MASTERMIND_MCP_CONTRIBUTIONS_ENABLED: 'yes' }, { MASTERMIND_MCP_CONTRIBUTION_WRITES_ENABLED: 'true' },
    { MASTERMIND_MCP_OAUTH_REQUIRED_SCOPES: JSON.stringify(['fixture:read', CONTRIBUTION_WRITE_SCOPE]) }]) {
    assert.throws(() => hostedOAuthPolicy({ ...env, ...changes }), { code: 'MCP_OAUTH_CONFIGURATION_REQUIRED' });
  }
});
