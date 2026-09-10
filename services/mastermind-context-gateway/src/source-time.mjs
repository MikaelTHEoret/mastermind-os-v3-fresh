const CALENDAR = 'America/Toronto';
const CONTRACT = Object.freeze({
  pipeline: 'mastermind-source-document-time', pipeline_version: '1.0',
  source_kind: 'conversation', source_time_status: 'verified',
  time_basis: 'source_document_created', calendar: CALENDAR,
  message_time_status: 'not_reconstructed',
});

// Only these scalar fields cross the database boundary. Limits include one
// extra character so overlong values cannot be truncated into a valid value.
const FIELDS = Object.freeze({
  ...Object.fromEntries(Object.entries(CONTRACT).map(([key, value]) => [key, value.length + 1])),
  doc_id: 513, source_path: 4097, source_uuid: 37, manifest_sha256: 65,
  created_at_utc: 31, modified_at_utc: 31, created_day_toronto: 11,
});
const scalar = (expression, limit) => `CASE WHEN jsonb_typeof(${expression}) = 'string' THEN left(${expression} #>> '{}', ${limit}) ELSE NULL END`;
const projection = "metadata->'source_time_v1'";
export const SOURCE_TIME_QUERY = `SELECT metadata ? 'source_time_v1' AS present,
  jsonb_build_object(
    'schema_version', CASE WHEN ${projection}->'schema_version' = '1'::jsonb THEN 1 ELSE NULL END,
    ${Object.entries(FIELDS).map(([key, limit]) => `'${key}', ${scalar(`${projection}->'${key}'`, limit)}`).join(',\n    ')},
    'export_file_sha256', ${scalar(`${projection}->'source_export'->'export_file_sha256'`, 65)}
  ) AS projection
  FROM public.archive_index_log
  WHERE source_path = $1::text AND doc_id = $2::text
  LIMIT 2`;

export function unavailableSourceTime(status = 'unavailable') {
  return { status, label: 'Conversation created', basis: null, createdAt: null,
    modifiedAt: null, calendarDay: null, calendar: CALENDAR,
    messageTimeStatus: 'not_reconstructed', provenance: null };
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)
    || date.getUTCFullYear() < 1900 || date.getTime() > Date.now()
    || ['1970-01-01', '1980-01-01'].includes(value.slice(0, 10))) return null;
  return date;
}

function torontoDay(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: CALENDAR, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function archiveSourceTime(rows, { docId, sourcePath }) {
  if (rows.length > 1) return unavailableSourceTime('ambiguous');
  if (!rows.length || rows[0].present !== true) return unavailableSourceTime();
  const value = rows[0].projection;
  const invalid = () => unavailableSourceTime('unrecognized_projection');
  if (!value || value.schema_version !== 1 || Object.entries(CONTRACT).some(([key, expected]) => value[key] !== expected)) return invalid();
  if (typeof docId !== 'string' || typeof sourcePath !== 'string'
    || docId.length > 512 || sourcePath.length > 4096
    || value.doc_id !== docId || value.source_path !== sourcePath) return invalid();
  if (['source_uuid', 'manifest_sha256', 'export_file_sha256'].some((key) => typeof value[key] !== 'string')
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value.source_uuid)
    || !/^[0-9a-f]{64}$/.test(value.manifest_sha256 ?? '')
    || !/^[0-9a-f]{64}$/.test(value.export_file_sha256 ?? '')) return invalid();
  const created = timestamp(value.created_at_utc);
  const modified = timestamp(value.modified_at_utc);
  const preciseOrder = (text) => text.slice(0, 19) + '.' + (text.includes('.') ? text.slice(20, -1) : '').padEnd(9, '0');
  if (!created || !modified || modified < created
    || preciseOrder(value.modified_at_utc) < preciseOrder(value.created_at_utc)
    || torontoDay(created) !== value.created_day_toronto) return invalid();
  return { status: 'verified', label: 'Conversation created', basis: 'source_document_created',
    // Preserve the source's full fractional precision; Date is validation only.
    createdAt: value.created_at_utc, modifiedAt: value.modified_at_utc,
    calendarDay: value.created_day_toronto, calendar: CALENDAR, messageTimeStatus: 'not_reconstructed',
    provenance: { sourceUuid: value.source_uuid, manifestSha256: value.manifest_sha256,
      exportFileSha256: value.export_file_sha256 } };
}
