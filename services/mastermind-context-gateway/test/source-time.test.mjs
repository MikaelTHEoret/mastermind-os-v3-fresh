import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveSourceTime, SOURCE_TIME_QUERY } from '../src/source-time.mjs';
import { NeonMemoryStore } from '../src/neon-store.mjs';
import { MastermindContextGateway } from '../src/context-gateway.mjs';

const coordinates = { docId: 'claude/example-23dd10d9', sourcePath: 'Claude::claude/example-23dd10d9' };
function valid(overrides = {}) {
  return { schema_version: 1, pipeline: 'mastermind-source-document-time', pipeline_version: '1.0',
    source_kind: 'conversation', source_time_status: 'verified', time_basis: 'source_document_created',
    calendar: 'America/Toronto', message_time_status: 'not_reconstructed', doc_id: coordinates.docId,
    source_path: coordinates.sourcePath, source_uuid: '23dd10d9-b9d4-4fd4-9df7-1db03560a5fd',
    manifest_sha256: 'a'.repeat(64), export_file_sha256: 'b'.repeat(64),
    created_at_utc: '2025-04-09T02:13:15.690372Z', modified_at_utc: '2025-04-09T09:16:13.869478Z',
    created_day_toronto: '2025-04-08', ...overrides };
}
const view = (value) => archiveSourceTime([{ present: true, projection: value }], coordinates);

test('verified conversation creation preserves microsecond precision, Toronto day and bounded scalar provenance', () => {
  const result = view(valid({ unrelated: 'x'.repeat(100000), source_export: { export_file_path: 'private/path' } }));
  assert.equal(result.status, 'verified');
  assert.equal(result.createdAt, '2025-04-09T02:13:15.690372Z');
  assert.equal(result.modifiedAt, '2025-04-09T09:16:13.869478Z');
  assert.equal(result.calendarDay, '2025-04-08');
  assert.equal(result.label, 'Conversation created');
  assert.equal(result.messageTimeStatus, 'not_reconstructed');
  assert.deepEqual(Object.keys(result.provenance), ['sourceUuid', 'manifestSha256', 'exportFileSha256']);
  assert.ok(JSON.stringify(result).length < 650);
  assert.doesNotMatch(JSON.stringify(result), /private|sourcePath|unrelated/);
});

test('Toronto midnight and DST use the actual calendar without losing nanoseconds', () => {
  for (const [created, day] of [
    ['2025-03-09T04:59:59.123456789Z', '2025-03-08'],
    ['2025-03-09T05:00:00Z', '2025-03-09'],
    ['2025-11-02T03:59:59.999999999Z', '2025-11-01'],
    ['2025-11-02T04:00:00Z', '2025-11-02'],
  ]) {
    const result = view(valid({ created_at_utc: created, modified_at_utc: '2025-12-01T00:00:00Z', created_day_toronto: day }));
    assert.equal(result.status, 'verified');
    assert.equal(result.createdAt, created);
    assert.equal(result.calendarDay, day);
  }
});

test('missing projection never falls back to legacy modified, import or tag dates', () => {
  for (const rows of [[], [{ present: false, projection: valid(), doc_mtime: '2025-01-01', addr_time: '2025-01-01' }]]) {
    const result = archiveSourceTime(rows, coordinates);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.createdAt, null);
    assert.equal(result.basis, null);
  }
});

test('malformed contract, identifiers, timestamps, future/sentinel dates and calendar mismatch fail closed', () => {
  for (const patch of [
    { schema_version: '1' }, { pipeline_version: '2.0' }, { source_kind: 'message' },
    { time_basis: 'message_created' }, { source_time_status: 'pending' },
    { calendar: 'UTC' }, { message_time_status: 'verified' }, { source_uuid: '23dd10d9' },
    { source_uuid: ['23dd10d9-b9d4-4fd4-9df7-1db03560a5fd'] },
    { manifest_sha256: 'g'.repeat(64) }, { export_file_sha256: 'a'.repeat(65) },
    { created_at_utc: '2025-02-30T02:13:15Z' }, { created_at_utc: '2025-04-09T02:13:15' },
    { created_at_utc: '2099-04-09T02:13:15Z' }, { created_at_utc: '1970-01-01T02:13:15Z' },
    { created_at_utc: '2025-04-09T02:13:15+00:00' }, { created_day_toronto: '2025-04-09' },
    { modified_at_utc: '2025-04-09T02:13:15.690371Z' },
  ]) assert.equal(view(valid(patch)).status, 'unrecognized_projection', JSON.stringify(patch));
});

test('exact coordinate mismatch and duplicate matching index rows are explicit', () => {
  for (const patch of [{ doc_id: 'other' }, { source_path: 'other' }]) {
    assert.equal(view(valid(patch)).status, 'unrecognized_projection');
  }
  assert.equal(archiveSourceTime([{ present: true, projection: valid() }, { present: true, projection: valid() }], coordinates).status, 'ambiguous');
});

function storeFixture(projections) {
  const calls = [];
  const row = { address: `${coordinates.docId}#chunk-0000`, docId: coordinates.docId, chunkIndex: 0, content: 'Original evidence' };
  const replies = [[{ ...row, _sourcePath: coordinates.sourcePath }], [row], projections];
  const store = Object.create(NeonMemoryStore.prototype);
  store.sql = { async query(statement, parameters) {
    calls.push({ statement, parameters });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  } };
  return { store, calls, row };
}

test('store uses one bounded parameterized projection lookup and does not leak internal paths or duplicate source time on neighbors', async () => {
  const { store, calls, row } = storeFixture([{ present: true, projection: valid() }]);
  const result = await store.fetchArchive(row.address, 0);
  assert.equal(result.exact.sourceTime.status, 'verified');
  assert.equal(result.exact.content, row.content);
  assert.equal(result.exact._sourcePath, undefined);
  assert.equal(result.neighbors[0].sourceTime, undefined);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].statement, SOURCE_TIME_QUERY);
  assert.deepEqual(calls[2].parameters, [coordinates.sourcePath, coordinates.docId]);
  assert.match(SOURCE_TIME_QUERY, /WHERE source_path = \$1::text AND doc_id = \$2::text\s+LIMIT 2/);
  assert.doesNotMatch(SOURCE_TIME_QUERY, /SELECT\s+\*|export_file_path|bundle_path|covered_addresses/);
  assert.match(SOURCE_TIME_QUERY, /jsonb_typeof/);
});

test('optional metadata read failure preserves original archive evidence and reveals no raw error', async () => {
  const { store, row } = storeFixture(new Error('sensitive database diagnostic'));
  const result = await store.fetchArchive(row.address, 0);
  assert.equal(result.exact.content, row.content);
  assert.equal(result.exact.sourceTime.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /sensitive/);
});

test('archive authorization denies access before archive or projection reads', async () => {
  const calls = [];
  const gateway = new MastermindContextGateway({ store: {
    async authorizeOperator() { calls.push('authorize'); return false; },
    async fetchArchive() { calls.push('archive'); },
  }, identity: { householdId: 'family-local', actorPlayerId: '00000000-0000-8000-8000-000000000001' } });
  await assert.rejects(gateway.fetchArchive({ address: 'claude/example#chunk-0000' }), { code: 'MEMORY_ACCESS_DENIED' });
  assert.deepEqual(calls, ['authorize']);
});
