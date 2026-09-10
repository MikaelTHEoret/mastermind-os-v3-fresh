import { NextRequest, NextResponse } from 'next/server';
import { getMemoryDb } from '@/lib/db';

// Codex navigator backend — a Neon-direct port of mastermind-client/codex_data.py.
// Serves the living knowledge navigator over transcript_archive (the research archive on
// NEON_MEMORY_URL). Browse ops are always-on (no query embed needed, neighbors uses the
// node's STORED embedding). `search` needs an embedder and is added in a later pass.
export const dynamic = 'force-dynamic';

// Web-export boilerplate that got ingested as content (noise attractors). Drop at query time.
const JUNK = [
  'To view keyboard shortcuts', 'https://x.com/i/grok/share',
  'Skip to content', 'You said:', 'ChatGPT said:',
];

type Row = {
  address: string; source_type: string | null; doc_id: string | null;
  title: string | null; topic_tags: string[] | null; evidence_class: string | null;
  subject: string | null; core_hash: string | null; char_count: number | null;
  content: string | null; sim?: number | string | null;
};

function node(r: Row, full = false): Record<string, unknown> {
  const content = r.content || '';
  const o: Record<string, unknown> = {
    address: r.address, source_type: r.source_type, doc_id: r.doc_id,
    title: r.title, tags: r.topic_tags, evidence_class: r.evidence_class,
    subject: r.subject, core_hash: r.core_hash, chars: r.char_count,
  };
  if (full) o.content = content; else o.snippet = content.slice(0, 280);
  if (r.sim != null) o.sim = Math.round(Number(r.sim) * 10000) / 10000;
  return o;
}

// Resonant-links cleaning: drop export boilerplate + dedup by content prefix (parity with codex_data).
function clean(rows: Row[], k: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const c = (r.content || '').trim();
    const ttl = r.title ? String(r.title) : '';
    if (JUNK.some((pfx) => c.startsWith(pfx) || ttl.startsWith(pfx))) continue;
    const h = c.slice(0, 400);
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(node(r));
    if (out.length >= k) break;
  }
  return out;
}

function ok(obj: unknown, code = 200): NextResponse {
  return NextResponse.json(obj, {
    status: code,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.length ? s : null;
}

function requireWriteAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.MASTERMIND_CODEX_WRITE_TOKEN || process.env.CODEX_WRITE_TOKEN || process.env.MASTERMIND_ADMIN_TOKEN;
  if (!expected) return ok({ error: 'codex write token is not configured' }, 503);
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const header = req.headers.get('x-codex-write-token')?.trim();
  if ((bearer || header) !== expected) return ok({ error: 'unauthorized codex write' }, 401);
  return null;
}

type PrimeCymaticInputRow = Record<string, unknown>;
type PrimeResidualInputRow = Record<string, unknown>;

function boolOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return null;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return null;
}

function featureSubset(row: PrimeCymaticInputRow): Record<string, unknown> {
  const keys = [
    'period', 'period_ratio', 'digit_entropy', 'transition_entropy',
    'spectral_entropy_source', 'bigram_coverage_source', 'forbidden_transitions_source',
    'dominant_fft_bin_v1', 'dominant_fft_fraction_v1', 'spectral_centroid_v1',
    'spectral_entropy_v1', 'transition_entropy_v1', 'bigram_coverage_v1',
    'forbidden_transition_count_v1', 'transition_asymmetry_v1', 'max_zero_run_v1',
    'mean_zero_run_v1', 'axial_symmetry_order_v1', 'axial_symmetry_strength_v1',
    'best_cymatic_m_v1', 'best_cymatic_n_v1', 'cymatic_distance_v1',
    'shuffle_dominant_fraction_z_v1',
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = numberOrNull(row[key]) ?? textOrNull(row[key]);
  out.cymatic_mode_key = textOrNull(row.cymatic_mode_key_v1);
  out.translator_acceptance = textOrNull(row.translator_acceptance_v1);
  out.relation_families = textOrNull(row.prism_relation_families_v1);
  out.midy_complement = textOrNull(row.midy_complement);
  out.full_reptend = textOrNull(row.full_reptend);
  out.p_mod3 = numberOrNull(row.p_mod3);
  out.p_mod4 = numberOrNull(row.p_mod4);
  out.gap = numberOrNull(row.gap);
  return out;
}

function profileConfidence(row: PrimeCymaticInputRow): number {
  const strength = numberOrNull(row.axial_symmetry_strength_v1) ?? 0;
  const z = numberOrNull(row.shuffle_dominant_fraction_z_v1) ?? 0;
  const accept = textOrNull(row.translator_acceptance_v1) ?? '';
  let base = 0.35;
  if (accept === 'STRONG_MODAL_CANDIDATE') base = 0.62;
  else if (accept === 'WEAK_MODAL_CANDIDATE') base = 0.50;
  else if (accept === 'BROAD_SPECTRUM_CANDIDATE') base = 0.42;
  else if (accept === 'LOW_INFORMATION_PERIODIC') base = 0.30;
  const score = base + Math.min(0.18, Math.max(0, strength) * 0.18) + Math.min(0.12, Math.max(0, z) * 0.015);
  return Math.round(Math.max(0.05, Math.min(0.92, score)) * 1_000_000) / 1_000_000;
}

function residualFeatureSubset(row: PrimeResidualInputRow): Record<string, unknown> {
  const keys = [
    'record_type', 'identity_key', 'denominator', 'base', 'source_prime_index',
    'v19_phase', 'v19_reuse_count', 'v19_reuse_density', 'v19_sqrt_boundary_delta',
    'preperiod', 'period', 'period_ratio', 'digit_entropy', 'max_zero_run',
    'mean_zero_run', 'factorization', 'is_prime', 'is_semiprime',
    'distinct_prime_factors', 'transition_entropy', 'bigram_coverage',
    'forbidden_transition_count', 'transition_asymmetry', 'dominant_fft_bin',
    'dominant_fft_fraction', 'spectral_centroid', 'spectral_entropy',
    'reported_mode_count', 'axial_symmetry_order', 'axial_symmetry_strength',
    'best_cymatic_m', 'best_cymatic_n', 'cymatic_mode_key',
    'translator_acceptance', 'expected_axial_ols', 'residual_axial_ols',
    'residual_axial_ols_z', 'denominator_bin', 'period_bin',
    'expected_axial_bucket', 'residual_axial_bucket', 'residual_axial_bucket_z',
    'residual_bucket_n', 'residual_class',
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const n = numberOrNull(row[key]);
    out[key] = n ?? boolOrNull(row[key]) ?? textOrNull(row[key]);
  }
  out.repetend_preview = textOrNull(row.repetend_preview);
  return out;
}

function residualConfidence(row: PrimeResidualInputRow): number {
  const residualZ = Math.abs(numberOrNull(row.residual_axial_ols_z) ?? 0);
  const bucketZ = Math.abs(numberOrNull(row.residual_axial_bucket_z) ?? 0);
  const residualClass = textOrNull(row.residual_class) ?? '';
  let base = 0.38;
  if (residualClass === 'RESIDUAL_HIGH_MODAL' || residualClass === 'RESIDUAL_LOW_MODAL') base = 0.68;
  else if (residualClass === 'SINGLE_MODEL_OUTLIER') base = 0.52;
  else if (residualClass === 'EXPLAINED_BY_MECHANICAL_CONTROLS') base = 0.42;
  const score = base + Math.min(0.18, residualZ * 0.018) + Math.min(0.08, bucketZ * 0.02);
  return Math.round(Math.max(0.05, Math.min(0.94, score)) * 1_000_000) / 1_000_000;
}

function residualObjectId(row: PrimeResidualInputRow): string {
  const denominator = numberOrNull(row.denominator);
  const base = numberOrNull(row.base) ?? 10;
  const identity = (textOrNull(row.identity_key) ?? `n:${denominator ?? 'unknown'}`).replace(/[^a-zA-Z0-9:_-]/g, '_');
  return `${identity}:reciprocal:base${base}:residual_v1`;
}

async function ensurePrimeCymaticSchema(sql: ReturnType<typeof getMemoryDb>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  await sql`
    CREATE TABLE IF NOT EXISTS prism_claim_statuses (
      status TEXT PRIMARY KEY,
      meaning TEXT NOT NULL
    )
  `;
  await sql`
    INSERT INTO prism_claim_statuses(status, meaning) VALUES
      ('VISION', 'Speculative or inspirational framing; not yet operationalized.'),
      ('SPECIFIED', 'Operational definition exists; not yet tested.'),
      ('CANDIDATE', 'Detected by a tool or heuristic; awaits validation.'),
      ('VALIDATED', 'Passed a preregistered test or independent check.'),
      ('PROVEN', 'Mathematically/certifiably established in the stated scope.'),
      ('RETRACTED', 'Previously asserted but withdrawn or falsified.'),
      ('CLOSED', 'Branch or mechanism bounded/settled for the stated purpose.')
    ON CONFLICT (status) DO UPDATE SET meaning = EXCLUDED.meaning
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS prism_relation_types (
      relation_type TEXT PRIMARY KEY,
      directed BOOLEAN NOT NULL DEFAULT TRUE,
      meaning TEXT NOT NULL
    )
  `;
  await sql`
    INSERT INTO prism_relation_types(relation_type, directed, meaning) VALUES
      ('cymatic_bridge', TRUE, 'Source connects to standing-wave, vibration, or form-language structure.'),
      ('evidence_for', TRUE, 'Source supplies evidence or measured support for a target claim, dataset, or aggregate.'),
      ('generation', TRUE, 'Source generated or materially produced the target artifact.'),
      ('question', TRUE, 'Source raises a research question or caveat against the target artifact.')
    ON CONFLICT (relation_type) DO UPDATE SET directed = EXCLUDED.directed, meaning = EXCLUDED.meaning
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS prism_signatures (
      signature_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      object_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      source_doc_id TEXT,
      source_address TEXT,
      domain TEXT NOT NULL,
      signature_version TEXT NOT NULL DEFAULT 'PRISM_SIG_V1',
      features JSONB NOT NULL DEFAULT '{}'::jsonb,
      transforms JSONB NOT NULL DEFAULT '{}'::jsonb,
      invariances JSONB NOT NULL DEFAULT '{}'::jsonb,
      null_model JSONB NOT NULL DEFAULT '{}'::jsonb,
      scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      evidence_class TEXT NOT NULL DEFAULT 'unspecified',
      claim_status TEXT NOT NULL DEFAULT 'CANDIDATE' REFERENCES prism_claim_statuses(status),
      confidence DOUBLE PRECISION CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
      created_by TEXT NOT NULL DEFAULT 'codex',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(object_id, domain, signature_version)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_prism_signatures_object ON prism_signatures(object_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prism_signatures_domain ON prism_signatures(domain)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prism_signatures_features ON prism_signatures USING GIN(features)`;
  await sql`
    CREATE TABLE IF NOT EXISTS mastermind_relations (
      relation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_object_id TEXT NOT NULL,
      target_object_id TEXT NOT NULL,
      source_signature_id UUID REFERENCES prism_signatures(signature_id) ON DELETE SET NULL,
      target_signature_id UUID REFERENCES prism_signatures(signature_id) ON DELETE SET NULL,
      relation_type TEXT NOT NULL REFERENCES prism_relation_types(relation_type),
      direction TEXT NOT NULL DEFAULT 'directed' CHECK (direction IN ('directed','undirected','bidirectional')),
      polarity TEXT NOT NULL DEFAULT 'neutral' CHECK (polarity IN ('positive','negative','neutral','mixed')),
      evidence_class TEXT NOT NULL DEFAULT 'heuristic',
      claim_status TEXT NOT NULL DEFAULT 'CANDIDATE' REFERENCES prism_claim_statuses(status),
      confidence DOUBLE PRECISION CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
      relation_score DOUBLE PRECISION,
      null_status TEXT NOT NULL DEFAULT 'untested' CHECK (null_status IN ('untested','beats_null','fails_null','not_applicable','unknown')),
      null_model JSONB NOT NULL DEFAULT '{}'::jsonb,
      support JSONB NOT NULL DEFAULT '[]'::jsonb,
      rationale TEXT,
      created_by TEXT NOT NULL DEFAULT 'codex',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (source_object_id <> target_object_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_mastermind_relations_source ON mastermind_relations(source_object_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_mastermind_relations_target ON mastermind_relations(target_object_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_mastermind_relations_type ON mastermind_relations(relation_type)`;
  await sql`
    CREATE TABLE IF NOT EXISTS public.prime_cymatic_profiles_v1 (
      prime_p BIGINT PRIMARY KEY,
      object_id TEXT NOT NULL UNIQUE,
      encoder_version TEXT NOT NULL,
      source_profile_version TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      row_signature_sha256 TEXT NOT NULL,
      base INTEGER NOT NULL,
      period INTEGER,
      period_ratio DOUBLE PRECISION,
      cymatic_mode_key TEXT,
      translator_acceptance TEXT,
      axial_symmetry_order INTEGER,
      axial_symmetry_strength DOUBLE PRECISION,
      shuffle_dominant_fraction_z DOUBLE PRECISION,
      claim_status TEXT NOT NULL DEFAULT 'CANDIDATE',
      features JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT NOT NULL DEFAULT 'codex',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_prime_cymatic_profiles_v1_mode ON public.prime_cymatic_profiles_v1(cymatic_mode_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prime_cymatic_profiles_v1_features ON public.prime_cymatic_profiles_v1 USING GIN(features)`;
  await sql`
    CREATE TABLE IF NOT EXISTS public.prime_residual_profiles_v1 (
      object_id TEXT PRIMARY KEY,
      identity_key TEXT NOT NULL,
      denominator BIGINT NOT NULL,
      base INTEGER NOT NULL,
      record_type TEXT NOT NULL,
      source_prime_index INTEGER,
      encoder_version TEXT NOT NULL,
      source_profile_version TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      row_signature_sha256 TEXT NOT NULL,
      v19_phase TEXT,
      v19_reuse_count INTEGER,
      v19_reuse_density DOUBLE PRECISION,
      v19_sqrt_boundary_delta DOUBLE PRECISION,
      preperiod INTEGER,
      period INTEGER,
      period_ratio DOUBLE PRECISION,
      cymatic_mode_key TEXT,
      translator_acceptance TEXT,
      axial_symmetry_order INTEGER,
      axial_symmetry_strength DOUBLE PRECISION,
      expected_axial_ols DOUBLE PRECISION,
      residual_axial_ols DOUBLE PRECISION,
      residual_axial_ols_z DOUBLE PRECISION,
      expected_axial_bucket DOUBLE PRECISION,
      residual_axial_bucket DOUBLE PRECISION,
      residual_axial_bucket_z DOUBLE PRECISION,
      residual_class TEXT,
      is_prime_bool BOOLEAN,
      features JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT NOT NULL DEFAULT 'codex',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(identity_key, base, record_type)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_prime_residual_profiles_v1_denominator ON public.prime_residual_profiles_v1(denominator)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prime_residual_profiles_v1_base ON public.prime_residual_profiles_v1(base)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prime_residual_profiles_v1_class ON public.prime_residual_profiles_v1(residual_class)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prime_residual_profiles_v1_features ON public.prime_residual_profiles_v1 USING GIN(features)`;
}

async function ingestPrimeResidualProfiles(
  sql: ReturnType<typeof getMemoryDb>,
  body: { schema?: string; rows?: PrimeResidualInputRow[]; source?: Record<string, unknown>; summary?: Record<string, unknown> },
  op: string,
): Promise<NextResponse> {
  if (body.schema !== 'PRIME_RESIDUAL_PROFILE_INGEST_V1') return ok({ error: 'schema must be PRIME_RESIDUAL_PROFILE_INGEST_V1' }, 400);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const limit = clampInt(rows.length, 0, 0, 250);
  if (!rows.length) return ok({ error: 'rows required' }, 400);
  if (rows.length > limit) return ok({ error: 'too many rows; max 250 per request', rows: rows.length, max: 250 }, 413);

  await ensurePrimeCymaticSchema(sql);

  const aggregateObjectId = textOrNull(body.source?.aggregate_object_id) ?? 'prime_identity_residual_profiles:v1';
  const profiles: Record<string, unknown>[] = [];
  const signatures: Record<string, unknown>[] = [{
    object_id: aggregateObjectId,
    object_type: 'dataset_profile',
    domain: 'prime_identity_residual',
    signature_version: 'PRIME_IDENTITY_RESIDUAL_AGGREGATE_V1',
    features: body.summary ?? {},
    transforms: {
      source: 'reciprocal profile table -> mechanical controls -> residual/anomaly profile layer',
      uploader: textOrNull(body.source?.uploader) ?? 'unknown',
    },
    invariances: {
      base_family: [2, 7, 10, 12, 16],
      interpretation: 'residual layer after basic reciprocal/cymatic mechanical controls',
    },
    null_model: {
      controls: 'ordinary least squares plus base/denominator/period bucket controls',
      note: 'Residual class is a candidate signal, not proof of physical causation.',
    },
    scores: {
      row_count: numberOrNull(body.summary?.row_count),
      residual_sd: numberOrNull((body.summary?.ols_model as Record<string, unknown> | undefined)?.residual_sd),
    },
    evidence_class: 'computed_dataset',
    claim_status: 'CANDIDATE',
    confidence: 0.72,
  }];
  const relations: Record<string, unknown>[] = [];

  for (const row of rows) {
    const denominator = numberOrNull(row.denominator);
    const base = numberOrNull(row.base) ?? 10;
    if (!denominator || !Number.isInteger(denominator) || denominator < 2) return ok({ error: 'invalid denominator', denominator: row.denominator }, 400);
    if (!Number.isInteger(base) || base < 2) return ok({ error: 'invalid base', base: row.base }, 400);

    const objectId = residualObjectId(row);
    const features = residualFeatureSubset(row);
    const conf = residualConfidence(row);
    const residualClass = textOrNull(row.residual_class) ?? 'UNKNOWN';
    const recordType = textOrNull(row.record_type) ?? 'unknown';
    const objectType = boolOrNull(row.is_prime_bool) === true ? 'prime_reciprocal_residual_profile' : 'composite_reciprocal_residual_control';

    profiles.push({
      object_id: objectId,
      identity_key: textOrNull(row.identity_key) ?? `n:${denominator}`,
      denominator,
      base,
      record_type: recordType,
      source_prime_index: numberOrNull(row.source_prime_index),
      encoder_version: textOrNull(row.encoder_version) ?? 'prime-identity-residual-profiles-v1/api-upload-v1',
      source_profile_version: textOrNull(row.source_profile_version) ?? 'prime_identity_residual_profiles_v1',
      source_sha256: textOrNull(row.source_sha256) ?? '',
      row_signature_sha256: textOrNull(row.row_signature_sha256) ?? '',
      v19_phase: textOrNull(row.v19_phase),
      v19_reuse_count: numberOrNull(row.v19_reuse_count),
      v19_reuse_density: numberOrNull(row.v19_reuse_density),
      v19_sqrt_boundary_delta: numberOrNull(row.v19_sqrt_boundary_delta),
      preperiod: numberOrNull(row.preperiod),
      period: numberOrNull(row.period),
      period_ratio: numberOrNull(row.period_ratio),
      cymatic_mode_key: textOrNull(row.cymatic_mode_key),
      translator_acceptance: textOrNull(row.translator_acceptance),
      axial_symmetry_order: numberOrNull(row.axial_symmetry_order),
      axial_symmetry_strength: numberOrNull(row.axial_symmetry_strength),
      expected_axial_ols: numberOrNull(row.expected_axial_ols),
      residual_axial_ols: numberOrNull(row.residual_axial_ols),
      residual_axial_ols_z: numberOrNull(row.residual_axial_ols_z),
      expected_axial_bucket: numberOrNull(row.expected_axial_bucket),
      residual_axial_bucket: numberOrNull(row.residual_axial_bucket),
      residual_axial_bucket_z: numberOrNull(row.residual_axial_bucket_z),
      residual_class: residualClass,
      is_prime_bool: boolOrNull(row.is_prime_bool),
      features,
      raw_row: row,
    });

    signatures.push({
      object_id: objectId,
      object_type: objectType,
      domain: 'prime_identity_residual',
      signature_version: 'PRIME_IDENTITY_RESIDUAL_SIG_V1',
      features,
      transforms: {
        source: '1/n reciprocal profile -> cymatic translator features -> residual against mechanical controls',
        encoder: textOrNull(row.encoder_version) ?? 'prime-identity-residual-profiles-v1/api-upload-v1',
      },
      invariances: {
        base,
        periodic_rotation: true,
        residual_against_controls: true,
      },
      null_model: {
        ols_residual_z: numberOrNull(row.residual_axial_ols_z),
        bucket_residual_z: numberOrNull(row.residual_axial_bucket_z),
        residual_bucket_n: numberOrNull(row.residual_bucket_n),
      },
      scores: {
        confidence_input: conf,
        axial_strength: numberOrNull(row.axial_symmetry_strength) ?? 0,
        residual_z: numberOrNull(row.residual_axial_ols_z) ?? 0,
        bucket_residual_z: numberOrNull(row.residual_axial_bucket_z) ?? 0,
      },
      evidence_class: residualClass === 'EXPLAINED_BY_MECHANICAL_CONTROLS' ? 'computed_control' : 'computed_candidate',
      claim_status: 'CANDIDATE',
      confidence: conf,
    });

    if (['RESIDUAL_HIGH_MODAL', 'RESIDUAL_LOW_MODAL', 'SINGLE_MODEL_OUTLIER'].includes(residualClass)) {
      relations.push({
        source_object_id: objectId,
        target_object_id: aggregateObjectId,
        relation_type: 'evidence_for',
        direction: 'directed',
        polarity: residualClass === 'RESIDUAL_LOW_MODAL' ? 'negative' : 'positive',
        evidence_class: 'residual_profile_signal',
        claim_status: 'CANDIDATE',
        confidence: conf,
        relation_score: Math.abs(numberOrNull(row.residual_axial_ols_z) ?? 0),
        null_model: {
          ols_residual_z: numberOrNull(row.residual_axial_ols_z),
          bucket_residual_z: numberOrNull(row.residual_axial_bucket_z),
          residual_class: residualClass,
        },
        support: [{ row_signature_sha256: textOrNull(row.row_signature_sha256), source: textOrNull(row.source_profile_version) }],
        rationale: 'Residual profile row materially departs from, or usefully controls, the mechanical reciprocal/cymatic baseline.',
      });
    }
  }

  const profilesJson = JSON.stringify(profiles);
  const signaturesJson = JSON.stringify(signatures);
  const relationsJson = JSON.stringify(relations);

  await sql`
    INSERT INTO public.prime_residual_profiles_v1
      (object_id, identity_key, denominator, base, record_type, source_prime_index,
       encoder_version, source_profile_version, source_sha256, row_signature_sha256,
       v19_phase, v19_reuse_count, v19_reuse_density, v19_sqrt_boundary_delta,
       preperiod, period, period_ratio, cymatic_mode_key, translator_acceptance,
       axial_symmetry_order, axial_symmetry_strength, expected_axial_ols,
       residual_axial_ols, residual_axial_ols_z, expected_axial_bucket,
       residual_axial_bucket, residual_axial_bucket_z, residual_class,
       is_prime_bool, features, raw_row)
    SELECT
      object_id, identity_key, denominator, base, record_type, source_prime_index,
      encoder_version, source_profile_version, source_sha256, row_signature_sha256,
      v19_phase, v19_reuse_count, v19_reuse_density, v19_sqrt_boundary_delta,
      preperiod, period, period_ratio, cymatic_mode_key, translator_acceptance,
      axial_symmetry_order, axial_symmetry_strength, expected_axial_ols,
      residual_axial_ols, residual_axial_ols_z, expected_axial_bucket,
      residual_axial_bucket, residual_axial_bucket_z, residual_class,
      is_prime_bool, features, raw_row
    FROM jsonb_to_recordset(${profilesJson}::jsonb) AS r(
      object_id TEXT, identity_key TEXT, denominator BIGINT, base INTEGER,
      record_type TEXT, source_prime_index INTEGER, encoder_version TEXT,
      source_profile_version TEXT, source_sha256 TEXT, row_signature_sha256 TEXT,
      v19_phase TEXT, v19_reuse_count INTEGER, v19_reuse_density DOUBLE PRECISION,
      v19_sqrt_boundary_delta DOUBLE PRECISION, preperiod INTEGER, period INTEGER,
      period_ratio DOUBLE PRECISION, cymatic_mode_key TEXT, translator_acceptance TEXT,
      axial_symmetry_order INTEGER, axial_symmetry_strength DOUBLE PRECISION,
      expected_axial_ols DOUBLE PRECISION, residual_axial_ols DOUBLE PRECISION,
      residual_axial_ols_z DOUBLE PRECISION, expected_axial_bucket DOUBLE PRECISION,
      residual_axial_bucket DOUBLE PRECISION, residual_axial_bucket_z DOUBLE PRECISION,
      residual_class TEXT, is_prime_bool BOOLEAN, features JSONB, raw_row JSONB
    )
    ON CONFLICT (object_id) DO UPDATE SET
      identity_key = EXCLUDED.identity_key,
      denominator = EXCLUDED.denominator,
      base = EXCLUDED.base,
      record_type = EXCLUDED.record_type,
      source_prime_index = EXCLUDED.source_prime_index,
      encoder_version = EXCLUDED.encoder_version,
      source_profile_version = EXCLUDED.source_profile_version,
      source_sha256 = EXCLUDED.source_sha256,
      row_signature_sha256 = EXCLUDED.row_signature_sha256,
      v19_phase = EXCLUDED.v19_phase,
      v19_reuse_count = EXCLUDED.v19_reuse_count,
      v19_reuse_density = EXCLUDED.v19_reuse_density,
      v19_sqrt_boundary_delta = EXCLUDED.v19_sqrt_boundary_delta,
      preperiod = EXCLUDED.preperiod,
      period = EXCLUDED.period,
      period_ratio = EXCLUDED.period_ratio,
      cymatic_mode_key = EXCLUDED.cymatic_mode_key,
      translator_acceptance = EXCLUDED.translator_acceptance,
      axial_symmetry_order = EXCLUDED.axial_symmetry_order,
      axial_symmetry_strength = EXCLUDED.axial_symmetry_strength,
      expected_axial_ols = EXCLUDED.expected_axial_ols,
      residual_axial_ols = EXCLUDED.residual_axial_ols,
      residual_axial_ols_z = EXCLUDED.residual_axial_ols_z,
      expected_axial_bucket = EXCLUDED.expected_axial_bucket,
      residual_axial_bucket = EXCLUDED.residual_axial_bucket,
      residual_axial_bucket_z = EXCLUDED.residual_axial_bucket_z,
      residual_class = EXCLUDED.residual_class,
      is_prime_bool = EXCLUDED.is_prime_bool,
      features = EXCLUDED.features,
      raw_row = EXCLUDED.raw_row,
      updated_at = now()
  `;

  await sql`
    INSERT INTO prism_signatures
      (object_id, object_type, domain, signature_version, features, transforms,
       invariances, null_model, scores, evidence_class, claim_status, confidence)
    SELECT
      object_id, object_type, domain, signature_version, features, transforms,
      invariances, null_model, scores, evidence_class, claim_status, confidence
    FROM jsonb_to_recordset(${JSON.stringify(signatures)}::jsonb) AS r(
      object_id TEXT, object_type TEXT, domain TEXT, signature_version TEXT,
      features JSONB, transforms JSONB, invariances JSONB, null_model JSONB,
      scores JSONB, evidence_class TEXT, claim_status TEXT, confidence DOUBLE PRECISION
    )
    ON CONFLICT (object_id, domain, signature_version) DO UPDATE SET
      object_type = EXCLUDED.object_type,
      features = EXCLUDED.features,
      transforms = EXCLUDED.transforms,
      invariances = EXCLUDED.invariances,
      null_model = EXCLUDED.null_model,
      scores = EXCLUDED.scores,
      evidence_class = EXCLUDED.evidence_class,
      claim_status = EXCLUDED.claim_status,
      confidence = EXCLUDED.confidence,
      updated_at = now()
  `;

  if (relations.length) {
    await sql`
      INSERT INTO mastermind_relations
        (source_object_id, target_object_id, relation_type, direction, polarity,
         evidence_class, claim_status, confidence, relation_score, null_model,
         support, rationale)
      SELECT
        source_object_id, target_object_id, relation_type, direction, polarity,
        evidence_class, claim_status, confidence, relation_score, null_model,
        support, rationale
      FROM jsonb_to_recordset(${relationsJson}::jsonb) AS r(
        source_object_id TEXT, target_object_id TEXT, relation_type TEXT,
        direction TEXT, polarity TEXT, evidence_class TEXT, claim_status TEXT,
        confidence DOUBLE PRECISION, relation_score DOUBLE PRECISION,
        null_model JSONB, support JSONB, rationale TEXT
      )
      WHERE NOT EXISTS (
        SELECT 1 FROM mastermind_relations existing
        WHERE existing.source_object_id = r.source_object_id
          AND existing.target_object_id = r.target_object_id
          AND existing.relation_type = r.relation_type
      )
    `;
  }

  const profileTotal = (await sql`SELECT count(*)::int AS n FROM public.prime_residual_profiles_v1`) as Array<{ n: number }>;
  const signatureTotal = (await sql`SELECT count(*)::int AS n FROM prism_signatures WHERE domain='prime_identity_residual' AND signature_version IN ('PRIME_IDENTITY_RESIDUAL_SIG_V1','PRIME_IDENTITY_RESIDUAL_AGGREGATE_V1')`) as Array<{ n: number }>;
  const relationTotal = (await sql`SELECT count(*)::int AS n FROM mastermind_relations WHERE relation_type='evidence_for' AND target_object_id=${aggregateObjectId}`) as Array<{ n: number }>;

  return ok({
    status: 'applied',
    op,
    rows_input: rows.length,
    relations_input: relations.length,
    profiles_total: profileTotal[0]?.n ?? null,
    signatures_total: signatureTotal[0]?.n ?? null,
    relations_total: relationTotal[0]?.n ?? null,
  });
}

export async function OPTIONS(): Promise<NextResponse> {
  return ok({ ok: true });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const sql = getMemoryDb();
  const p = new URL(req.url).searchParams;
  const op = p.get('op') || '';

  if (!['ingest_prime_cymatic_v1', 'ingest_prime_residual_profiles_v1'].includes(op)) {
    return ok({ error: 'unknown write op', op, ops: ['ingest_prime_cymatic_v1', 'ingest_prime_residual_profiles_v1'] }, 400);
  }

  const denied = requireWriteAuth(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as { schema?: string; rows?: PrimeCymaticInputRow[]; source?: Record<string, unknown>; summary?: Record<string, unknown> };
    if (op === 'ingest_prime_residual_profiles_v1') {
      return await ingestPrimeResidualProfiles(sql, body as { schema?: string; rows?: PrimeResidualInputRow[]; source?: Record<string, unknown>; summary?: Record<string, unknown> }, op);
    }
    if (body.schema !== 'PRIME_CYMATIC_INGEST_V1') return ok({ error: 'schema must be PRIME_CYMATIC_INGEST_V1' }, 400);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const limit = clampInt(rows.length, 0, 0, 250);
    if (!rows.length) return ok({ error: 'rows required' }, 400);
    if (rows.length > limit) return ok({ error: 'too many rows; max 250 per request', rows: rows.length, max: 250 }, 413);

    await ensurePrimeCymaticSchema(sql);

    const profiles: Record<string, unknown>[] = [];
    const signatures: Record<string, unknown>[] = [];
    const relations: Record<string, unknown>[] = [];

    for (const row of rows) {
      const prime = numberOrNull(row.prime_p);
      if (!prime || !Number.isInteger(prime) || prime < 2) return ok({ error: 'invalid prime_p', prime_p: row.prime_p }, 400);
      const objectId = `prime:${prime}:reciprocal:cymatic_v1`;
      const mode = textOrNull(row.cymatic_mode_key_v1) ?? 'unknown';
      const features = featureSubset(row);
      const conf = profileConfidence(row);
      profiles.push({
        prime_p: prime,
        object_id: objectId,
        encoder_version: textOrNull(row.encoder_version) ?? 'prime-cymatic-mass-transform-v1.0',
        source_profile_version: textOrNull(row.source_profile_version) ?? 'reciprocal_prime_profiles_first_2000',
        source_sha256: textOrNull(row.source_sha256) ?? '',
        row_signature_sha256: textOrNull(row.row_signature_sha256) ?? '',
        base: numberOrNull(row.base) ?? 10,
        period: numberOrNull(row.period),
        period_ratio: numberOrNull(row.period_ratio),
        cymatic_mode_key: mode,
        translator_acceptance: textOrNull(row.translator_acceptance_v1),
        axial_symmetry_order: numberOrNull(row.axial_symmetry_order_v1),
        axial_symmetry_strength: numberOrNull(row.axial_symmetry_strength_v1),
        shuffle_dominant_fraction_z: numberOrNull(row.shuffle_dominant_fraction_z_v1),
        features,
        raw_row: row,
      });
      signatures.push({
        object_id: objectId,
        object_type: 'prime_reciprocal_profile',
        domain: 'prime_cymatic',
        signature_version: 'PRIME_CYMATIC_SIG_V1',
        features,
        transforms: {
          source: '1/p decimal repetend -> circular digit signal -> Fourier/transition/cymatic projection',
          encoder: textOrNull(row.encoder_version) ?? 'prime-cymatic-mass-transform-v1.0',
        },
        invariances: {
          base: 10,
          periodic_rotation: true,
          claim: 'candidate bridge coordinate, not physical equivalence',
        },
        null_model: {
          digit_shuffle_rounds: numberOrNull(row.shuffle_rounds_v1) ?? 0,
          dominant_fraction_mean: numberOrNull(row.shuffle_dominant_fraction_mean_v1) ?? 0,
          dominant_fraction_sd: numberOrNull(row.shuffle_dominant_fraction_sd_v1) ?? 0,
        },
        scores: {
          confidence_input: conf,
          axial_strength: numberOrNull(row.axial_symmetry_strength_v1) ?? 0,
          shuffle_z: numberOrNull(row.shuffle_dominant_fraction_z_v1) ?? 0,
        },
        evidence_class: 'computed_candidate',
        claim_status: 'CANDIDATE',
        confidence: conf,
      });
      if (mode && !['terminating-or-empty', 'periodic-low-information', 'unknown'].includes(mode)) {
        relations.push({
          source_object_id: objectId,
          target_object_id: `cymatic_mode:${mode}`,
          relation_type: 'cymatic_bridge',
          direction: 'directed',
          polarity: 'positive',
          evidence_class: 'heuristic_projection',
          claim_status: 'CANDIDATE',
          confidence: conf,
          relation_score: numberOrNull(row.axial_symmetry_strength_v1) ?? 0,
          null_model: { null: 'digit_shuffle_dominant_fraction', z: numberOrNull(row.shuffle_dominant_fraction_z_v1) ?? 0 },
          support: [{ row_signature_sha256: textOrNull(row.row_signature_sha256), source: textOrNull(row.source_profile_version) }],
          rationale: 'Prime reciprocal repetend projected into circular/Fourier/cymatic feature space. Candidate relation only.',
        });
      }
    }

    const profilesJson = JSON.stringify(profiles);
    const signaturesJson = JSON.stringify(signatures);
    const relationsJson = JSON.stringify(relations);

    await sql`
      INSERT INTO public.prime_cymatic_profiles_v1
        (prime_p, object_id, encoder_version, source_profile_version, source_sha256,
         row_signature_sha256, base, period, period_ratio, cymatic_mode_key,
         translator_acceptance, axial_symmetry_order, axial_symmetry_strength,
         shuffle_dominant_fraction_z, features, raw_row)
      SELECT
        prime_p, object_id, encoder_version, source_profile_version, source_sha256,
        row_signature_sha256, base, period, period_ratio, cymatic_mode_key,
        translator_acceptance, axial_symmetry_order, axial_symmetry_strength,
        shuffle_dominant_fraction_z, features, raw_row
      FROM jsonb_to_recordset(${profilesJson}::jsonb) AS r(
        prime_p BIGINT, object_id TEXT, encoder_version TEXT, source_profile_version TEXT,
        source_sha256 TEXT, row_signature_sha256 TEXT, base INTEGER, period INTEGER,
        period_ratio DOUBLE PRECISION, cymatic_mode_key TEXT, translator_acceptance TEXT,
        axial_symmetry_order INTEGER, axial_symmetry_strength DOUBLE PRECISION,
        shuffle_dominant_fraction_z DOUBLE PRECISION, features JSONB, raw_row JSONB
      )
      ON CONFLICT (prime_p) DO UPDATE SET
        object_id = EXCLUDED.object_id,
        encoder_version = EXCLUDED.encoder_version,
        source_profile_version = EXCLUDED.source_profile_version,
        source_sha256 = EXCLUDED.source_sha256,
        row_signature_sha256 = EXCLUDED.row_signature_sha256,
        base = EXCLUDED.base,
        period = EXCLUDED.period,
        period_ratio = EXCLUDED.period_ratio,
        cymatic_mode_key = EXCLUDED.cymatic_mode_key,
        translator_acceptance = EXCLUDED.translator_acceptance,
        axial_symmetry_order = EXCLUDED.axial_symmetry_order,
        axial_symmetry_strength = EXCLUDED.axial_symmetry_strength,
        shuffle_dominant_fraction_z = EXCLUDED.shuffle_dominant_fraction_z,
        features = EXCLUDED.features,
        raw_row = EXCLUDED.raw_row,
        updated_at = now()
    `;

    await sql`
      INSERT INTO prism_signatures
        (object_id, object_type, domain, signature_version, features, transforms,
         invariances, null_model, scores, evidence_class, claim_status, confidence)
      SELECT
        object_id, object_type, domain, signature_version, features, transforms,
        invariances, null_model, scores, evidence_class, claim_status, confidence
      FROM jsonb_to_recordset(${signaturesJson}::jsonb) AS r(
        object_id TEXT, object_type TEXT, domain TEXT, signature_version TEXT,
        features JSONB, transforms JSONB, invariances JSONB, null_model JSONB,
        scores JSONB, evidence_class TEXT, claim_status TEXT, confidence DOUBLE PRECISION
      )
      ON CONFLICT (object_id, domain, signature_version) DO UPDATE SET
        object_type = EXCLUDED.object_type,
        features = EXCLUDED.features,
        transforms = EXCLUDED.transforms,
        invariances = EXCLUDED.invariances,
        null_model = EXCLUDED.null_model,
        scores = EXCLUDED.scores,
        evidence_class = EXCLUDED.evidence_class,
        claim_status = EXCLUDED.claim_status,
        confidence = EXCLUDED.confidence,
        updated_at = now()
    `;

    if (relations.length) {
      await sql`
        INSERT INTO mastermind_relations
          (source_object_id, target_object_id, relation_type, direction, polarity,
           evidence_class, claim_status, confidence, relation_score, null_model,
           support, rationale)
        SELECT
          source_object_id, target_object_id, relation_type, direction, polarity,
          evidence_class, claim_status, confidence, relation_score, null_model,
          support, rationale
        FROM jsonb_to_recordset(${relationsJson}::jsonb) AS r(
          source_object_id TEXT, target_object_id TEXT, relation_type TEXT,
          direction TEXT, polarity TEXT, evidence_class TEXT, claim_status TEXT,
          confidence DOUBLE PRECISION, relation_score DOUBLE PRECISION,
          null_model JSONB, support JSONB, rationale TEXT
        )
        WHERE NOT EXISTS (
          SELECT 1 FROM mastermind_relations existing
          WHERE existing.source_object_id = r.source_object_id
            AND existing.target_object_id = r.target_object_id
            AND existing.relation_type = r.relation_type
        )
      `;
    }

    const profileTotal = (await sql`SELECT count(*)::int AS n FROM public.prime_cymatic_profiles_v1`) as Array<{ n: number }>;
    const signatureTotal = (await sql`SELECT count(*)::int AS n FROM prism_signatures WHERE domain='prime_cymatic' AND signature_version='PRIME_CYMATIC_SIG_V1'`) as Array<{ n: number }>;
    const relationTotal = (await sql`SELECT count(*)::int AS n FROM mastermind_relations WHERE relation_type='cymatic_bridge' AND source_object_id LIKE 'prime:%:reciprocal:cymatic_v1'`) as Array<{ n: number }>;

    return ok({
      status: 'applied',
      op,
      rows_input: rows.length,
      relations_input: relations.length,
      profiles_total: profileTotal[0]?.n ?? null,
      signatures_total: signatureTotal[0]?.n ?? null,
      relations_total: relationTotal[0]?.n ?? null,
    });
  } catch (err: unknown) {
    return ok({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// Query embedding via the SAME model that produced the stored vectors (Ollama nomic-embed-text, 768d).
// A different model would land in a different space -> meaningless similarity. URL is env-configurable so a
// deployed instance can point at the box via the tunnel; defaults to localhost for dev.
const OLLAMA_EMBED = process.env.OLLAMA_EMBED_URL || 'http://localhost:11434/api/embed';

async function embedQuery(q: string): Promise<number[] | null> {
  // Optional auth for a tunneled embedder: Cloudflare Access service token, or a bearer token.
  // No-op until the matching env vars are set, so this is safe to ship ahead of the tunnel/lock.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const cfId = process.env.CF_ACCESS_CLIENT_ID, cfSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (cfId && cfSecret) { headers['CF-Access-Client-Id'] = cfId; headers['CF-Access-Client-Secret'] = cfSecret; }
  if (process.env.OLLAMA_EMBED_TOKEN) headers['Authorization'] = `Bearer ${process.env.OLLAMA_EMBED_TOKEN}`;
  try {
    const r = await fetch(OLLAMA_EMBED, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'nomic-embed-text', input: q.slice(0, 8000) }),
    });
    const j = await r.json();
    return j?.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sql = getMemoryDb();
  const p = new URL(req.url).searchParams;
  const op = p.get('op') || 'stats';
  const address = p.get('address') || '';
  const docId = p.get('doc_id') || '';
  const core = p.get('core_hash') || '';
  const k = Math.min(Math.max(parseInt(p.get('k') || '12', 10) || 12, 1), 50);

  try {
    if (op === 'stats') {
      const a = (await sql`SELECT count(*)::int AS chunks, count(embedding)::int AS embedded, count(DISTINCT doc_id)::int AS docs FROM transcript_archive`) as Array<{ chunks: number; embedded: number; docs: number }>;
      const s = (await sql`SELECT source_type, count(*)::int AS n FROM transcript_archive GROUP BY 1 ORDER BY 2 DESC`) as Array<{ source_type: string; n: number }>;
      const c = (await sql`SELECT count(*)::int AS n FROM transcript_archive WHERE core_hash IS NOT NULL`) as Array<{ n: number }>;
      const by_source_type: Record<string, number> = {};
      for (const r of s) by_source_type[r.source_type] = r.n;
      return ok({ ...a[0], by_source_type, addressed_core_hash: c[0].n });
    }

    if (op === 'search') {
      const q = p.get('q') || '';
      if (!q.trim()) return ok({ error: 'q required' }, 400);
      const src = p.get('source_type') || '';
      const ev = await embedQuery(q);
      if (!ev) return ok({ error: 'embed unavailable -- Ollama (nomic-embed-text) not reachable. Browse works; search needs the box up.', query: q }, 503);
      const vec = '[' + ev.join(',') + ']';
      const rows = src
        ? ((await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content, 1 - (embedding <=> ${vec}::vector) AS sim FROM transcript_archive WHERE source_type = ${src} ORDER BY embedding <=> ${vec}::vector LIMIT ${k * 5}`) as Row[])
        : ((await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content, 1 - (embedding <=> ${vec}::vector) AS sim FROM transcript_archive ORDER BY embedding <=> ${vec}::vector LIMIT ${k * 5}`) as Row[]);
      return ok({ query: q, results: clean(rows, k) });
    }

    if (op === 'node') {
      if (!address) return ok({ error: 'address required' }, 400);
      const r = (await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content FROM transcript_archive WHERE address = ${address}`) as Row[];
      return r[0] ? ok(node(r[0], true)) : ok({ error: 'not found', address }, 404);
    }

    if (op === 'neighbors') {
      if (!address) return ok({ error: 'address required' }, 400);
      const e = (await sql`SELECT embedding FROM transcript_archive WHERE address = ${address}`) as Array<{ embedding: string }>;
      if (!e[0]) return ok({ error: 'not found', address }, 404);
      const ev = e[0].embedding;
      const rows = (await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content, 1 - (embedding <=> ${ev}::vector) AS sim FROM transcript_archive WHERE address <> ${address} ORDER BY embedding <=> ${ev}::vector LIMIT ${k * 5}`) as Row[];
      return ok({ center: address, neighbors: clean(rows, k) });
    }

    if (op === 'doc') {
      if (!docId) return ok({ error: 'doc_id required' }, 400);
      const limit = Math.min(Math.max(parseInt(p.get('limit') || '500', 10) || 500, 1), 2000);
      const offset = Math.max(parseInt(p.get('offset') || '0', 10) || 0, 0);
      const total = (await sql`SELECT count(*)::int AS n FROM transcript_archive WHERE doc_id = ${docId}`) as Array<{ n: number }>;
      const rows = (await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content FROM transcript_archive WHERE doc_id = ${docId} ORDER BY chunk_index LIMIT ${limit} OFFSET ${offset}`) as Row[];
      const n = total[0]?.n ?? rows.length;
      return ok({ doc_id: docId, total: n, limit, offset, has_more: offset + rows.length < n, chunks: rows.map((r) => node(r)) });
    }

    if (op === 'concept') {
      if (!core) return ok({ error: 'core_hash required' }, 400);
      const rows = (await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content FROM transcript_archive WHERE core_hash = ${core}`) as Row[];
      return ok({ core_hash: core, chunks: rows.map((r) => node(r)) });
    }

    if (op === 'docs') {
      const src = p.get('source_type') || '';
      const limit = Math.min(Math.max(parseInt(p.get('limit') || '400', 10) || 400, 1), 1000);
      const offset = Math.max(parseInt(p.get('offset') || '0', 10) || 0, 0);
      const total = src
        ? ((await sql`SELECT count(*)::int AS n FROM (SELECT doc_id FROM transcript_archive WHERE source_type = ${src} GROUP BY doc_id) d`) as Array<{ n: number }>)
        : ((await sql`SELECT count(*)::int AS n FROM (SELECT doc_id FROM transcript_archive GROUP BY doc_id) d`) as Array<{ n: number }>);
      const rows = src
        ? ((await sql`SELECT doc_id, count(*)::int AS chunks, max(source_type) AS source_type FROM transcript_archive WHERE source_type = ${src} GROUP BY doc_id ORDER BY count(*) DESC, doc_id ASC LIMIT ${limit} OFFSET ${offset}`) as Array<{ doc_id: string; chunks: number; source_type: string }>)
        : ((await sql`SELECT doc_id, count(*)::int AS chunks, max(source_type) AS source_type FROM transcript_archive GROUP BY doc_id ORDER BY count(*) DESC, doc_id ASC LIMIT ${limit} OFFSET ${offset}`) as Array<{ doc_id: string; chunks: number; source_type: string }>);
      const n = total[0]?.n ?? rows.length;
      return ok({ count: rows.length, total: n, limit, offset, has_more: offset + rows.length < n, docs: rows });
    }

    if (op === 'prime_residual_stats') {
      const totals = (await sql`
        SELECT
          count(*)::int AS rows,
          count(*) FILTER (WHERE is_prime_bool IS TRUE)::int AS prime_rows,
          count(*) FILTER (WHERE is_prime_bool IS NOT TRUE)::int AS control_rows,
          count(DISTINCT denominator)::int AS denominators,
          count(DISTINCT base)::int AS bases,
          count(DISTINCT cymatic_mode_key)::int AS cymatic_modes
        FROM public.prime_residual_profiles_v1
      `) as Array<{ rows: number; prime_rows: number; control_rows: number; denominators: number; bases: number; cymatic_modes: number }>;
      const byClass = (await sql`
        SELECT residual_class, count(*)::int AS n
        FROM public.prime_residual_profiles_v1
        GROUP BY residual_class
        ORDER BY n DESC, residual_class ASC
      `) as Array<{ residual_class: string | null; n: number }>;
      const byBase = (await sql`
        SELECT base, count(*)::int AS n,
               count(*) FILTER (WHERE residual_class <> 'EXPLAINED_BY_MECHANICAL_CONTROLS')::int AS notable
        FROM public.prime_residual_profiles_v1
        GROUP BY base
        ORDER BY base ASC
      `) as Array<{ base: number; n: number; notable: number }>;
      const topModes = (await sql`
        SELECT cymatic_mode_key, count(*)::int AS n,
               count(*) FILTER (WHERE residual_class <> 'EXPLAINED_BY_MECHANICAL_CONTROLS')::int AS notable
        FROM public.prime_residual_profiles_v1
        WHERE cymatic_mode_key IS NOT NULL
        GROUP BY cymatic_mode_key
        ORDER BY notable DESC, n DESC, cymatic_mode_key ASC
        LIMIT 30
      `) as Array<{ cymatic_mode_key: string; n: number; notable: number }>;
      return ok({ schema: 'PRIME_RESIDUAL_STATS_V1', totals: totals[0] ?? null, by_class: byClass, by_base: byBase, top_modes: topModes });
    }

    if (op === 'prime_residual_profile') {
      const denominator = parseInt(p.get('denominator') || '', 10);
      if (!Number.isInteger(denominator)) return ok({ error: 'denominator required' }, 400);
      const baseRaw = p.get('base');
      const base = baseRaw == null ? null : parseInt(baseRaw, 10);
      const rows = base == null
        ? ((await sql`
            SELECT *
            FROM public.prime_residual_profiles_v1
            WHERE denominator = ${denominator}
            ORDER BY base ASC
          `) as Array<Record<string, unknown>>)
        : ((await sql`
            SELECT *
            FROM public.prime_residual_profiles_v1
            WHERE denominator = ${denominator} AND base = ${base}
            ORDER BY base ASC
          `) as Array<Record<string, unknown>>);
      return ok({ schema: 'PRIME_RESIDUAL_PROFILE_V1', denominator, base, count: rows.length, profiles: rows });
    }

    if (op === 'prime_residual_notables') {
      const residualClass = p.get('class') || '';
      const baseRaw = p.get('base');
      const base = baseRaw == null ? null : parseInt(baseRaw, 10);
      const limit = Math.min(Math.max(parseInt(p.get('limit') || '100', 10) || 100, 1), 500);
      const rows = residualClass && base != null
        ? ((await sql`
            SELECT object_id, identity_key, denominator, base, record_type, period, cymatic_mode_key,
                   axial_symmetry_order, axial_symmetry_strength, residual_axial_ols_z,
                   residual_axial_bucket_z, residual_class, features
            FROM public.prime_residual_profiles_v1
            WHERE residual_class = ${residualClass} AND base = ${base}
            ORDER BY GREATEST(abs(COALESCE(residual_axial_ols_z,0)), abs(COALESCE(residual_axial_bucket_z,0))) DESC,
                     denominator ASC
            LIMIT ${limit}
          `) as Array<Record<string, unknown>>)
        : residualClass
          ? ((await sql`
              SELECT object_id, identity_key, denominator, base, record_type, period, cymatic_mode_key,
                     axial_symmetry_order, axial_symmetry_strength, residual_axial_ols_z,
                     residual_axial_bucket_z, residual_class, features
              FROM public.prime_residual_profiles_v1
              WHERE residual_class = ${residualClass}
              ORDER BY GREATEST(abs(COALESCE(residual_axial_ols_z,0)), abs(COALESCE(residual_axial_bucket_z,0))) DESC,
                       denominator ASC
              LIMIT ${limit}
            `) as Array<Record<string, unknown>>)
          : base != null
            ? ((await sql`
                SELECT object_id, identity_key, denominator, base, record_type, period, cymatic_mode_key,
                       axial_symmetry_order, axial_symmetry_strength, residual_axial_ols_z,
                       residual_axial_bucket_z, residual_class, features
                FROM public.prime_residual_profiles_v1
                WHERE residual_class <> 'EXPLAINED_BY_MECHANICAL_CONTROLS' AND base = ${base}
                ORDER BY GREATEST(abs(COALESCE(residual_axial_ols_z,0)), abs(COALESCE(residual_axial_bucket_z,0))) DESC,
                         denominator ASC
                LIMIT ${limit}
              `) as Array<Record<string, unknown>>)
            : ((await sql`
                SELECT object_id, identity_key, denominator, base, record_type, period, cymatic_mode_key,
                       axial_symmetry_order, axial_symmetry_strength, residual_axial_ols_z,
                       residual_axial_bucket_z, residual_class, features
                FROM public.prime_residual_profiles_v1
                WHERE residual_class <> 'EXPLAINED_BY_MECHANICAL_CONTROLS'
                ORDER BY GREATEST(abs(COALESCE(residual_axial_ols_z,0)), abs(COALESCE(residual_axial_bucket_z,0))) DESC,
                         denominator ASC
                LIMIT ${limit}
              `) as Array<Record<string, unknown>>);
      return ok({ schema: 'PRIME_RESIDUAL_NOTABLES_V1', class: residualClass || null, base, limit, count: rows.length, profiles: rows });
    }

    if (op === 'prime_residual_modes') {
      const residualClass = p.get('class') || '';
      const limit = Math.min(Math.max(parseInt(p.get('limit') || '50', 10) || 50, 1), 200);
      const rows = residualClass
        ? ((await sql`
            SELECT cymatic_mode_key, count(*)::int AS n,
                   count(DISTINCT denominator)::int AS denominators,
                   avg(axial_symmetry_strength) AS avg_axial_strength,
                   avg(residual_axial_ols_z) AS avg_residual_z
            FROM public.prime_residual_profiles_v1
            WHERE residual_class = ${residualClass} AND cymatic_mode_key IS NOT NULL
            GROUP BY cymatic_mode_key
            ORDER BY n DESC, cymatic_mode_key ASC
            LIMIT ${limit}
          `) as Array<Record<string, unknown>>)
        : ((await sql`
            SELECT cymatic_mode_key, count(*)::int AS n,
                   count(DISTINCT denominator)::int AS denominators,
                   count(*) FILTER (WHERE residual_class <> 'EXPLAINED_BY_MECHANICAL_CONTROLS')::int AS notable,
                   avg(axial_symmetry_strength) AS avg_axial_strength,
                   avg(residual_axial_ols_z) AS avg_residual_z
            FROM public.prime_residual_profiles_v1
            WHERE cymatic_mode_key IS NOT NULL
            GROUP BY cymatic_mode_key
            ORDER BY notable DESC, n DESC, cymatic_mode_key ASC
            LIMIT ${limit}
          `) as Array<Record<string, unknown>>);
      return ok({ schema: 'PRIME_RESIDUAL_MODES_V1', class: residualClass || null, limit, modes: rows });
    }

    if (op === 'prime_residual_neighbors') {
      const denominator = parseInt(p.get('denominator') || '', 10);
      const base = parseInt(p.get('base') || '10', 10) || 10;
      if (!Number.isInteger(denominator)) return ok({ error: 'denominator required' }, 400);
      const center = (await sql`
        SELECT object_id, identity_key, denominator, base, residual_class, cymatic_mode_key,
               axial_symmetry_order, axial_symmetry_strength, residual_axial_ols_z,
               residual_axial_bucket_z, features
        FROM public.prime_residual_profiles_v1
        WHERE denominator = ${denominator} AND base = ${base}
        LIMIT 1
      `) as Array<Record<string, unknown>>;
      if (!center[0]) return ok({ error: 'not found', denominator, base }, 404);
      const c = center[0] as { residual_class?: string | null; cymatic_mode_key?: string | null; axial_symmetry_order?: number | null };
      const neighbors = (await sql`
        SELECT object_id, identity_key, denominator, base, residual_class, cymatic_mode_key,
               axial_symmetry_order, axial_symmetry_strength, residual_axial_ols_z,
               residual_axial_bucket_z, features,
               (CASE WHEN residual_class = ${c.residual_class ?? ''} THEN 2 ELSE 0 END)
               + (CASE WHEN cymatic_mode_key = ${c.cymatic_mode_key ?? ''} THEN 3 ELSE 0 END)
               + (CASE WHEN axial_symmetry_order = ${c.axial_symmetry_order ?? -1} THEN 1 ELSE 0 END)
               - (abs(ln(GREATEST(denominator,1)::double precision) - ln(GREATEST(${denominator},1)::double precision)) / 10.0) AS neighbor_score
        FROM public.prime_residual_profiles_v1
        WHERE NOT (denominator = ${denominator} AND base = ${base})
          AND (
            residual_class = ${c.residual_class ?? ''}
            OR cymatic_mode_key = ${c.cymatic_mode_key ?? ''}
            OR axial_symmetry_order = ${c.axial_symmetry_order ?? -1}
          )
        ORDER BY neighbor_score DESC, denominator ASC, base ASC
        LIMIT ${k}
      `) as Array<Record<string, unknown>>;
      return ok({ schema: 'PRIME_RESIDUAL_NEIGHBORS_V1', center: center[0], neighbors });
    }

    if (op === 'tree') {
      // The Golden Tree overview — the fractal_nodes clustering tree (ROOT -> 8 branches -> 227 leaves),
      // each node a "subject sun" carrying n_chunks + coherence. Always-on: structure only, no embedder, no box.
      const axis = p.get('axis') === 'source' ? 'source' : 'subject';
      const rows = (axis === 'source'
        ? await sql`SELECT path, name, parent_path, depth, is_leaf, n_chunks, coherence FROM source_nodes ORDER BY depth, path`
        : await sql`SELECT path, name, parent_path, depth, is_leaf, n_chunks, coherence FROM fractal_nodes ORDER BY depth, path`) as Array<{ path: string; name: string; parent_path: string | null; depth: number; is_leaf: boolean; n_chunks: number | null; coherence: number | null }>;
      const rootOf = (path: string, depth: number): string => (depth <= 0 ? 'ROOT' : path.split('/')[0]);
      const nodes = rows.map((r) => ({
        id: r.path, name: r.name, depth: r.depth, is_leaf: r.is_leaf,
        n_chunks: r.n_chunks || 0,
        coherence: r.coherence == null ? null : Math.round(r.coherence * 1000) / 1000,
        root: rootOf(r.path, r.depth),
      }));
      const present = new Set(rows.map((r) => r.path));
      const links: { source: string; target: string }[] = [];
      for (const r of rows) {
        if (r.parent_path && present.has(r.parent_path)) links.push({ source: r.parent_path, target: r.path });
        else if (r.depth === 1 && present.has('ROOT')) links.push({ source: 'ROOT', target: r.path });
      }
      const roots = Array.from(new Set(nodes.filter((n) => n.depth === 1).map((n) => n.root)));
      return ok({ nodes, links, roots, count: nodes.length, axis });
    }

    if (op === 'leaf') {
      // The chunks that live AT a leaf (or any) fractal node: transcript_archive.bloom_path == node.path.
      // This is what makes the orrery READ the archive — descend to a leaf, get its real content cards.
      const path = p.get('path') || '';
      if (!path) return ok({ error: 'path required' }, 400);
      const rows = (await sql`SELECT address, source_type, doc_id, title, topic_tags, evidence_class, subject, core_hash, char_count, content FROM transcript_archive WHERE bloom_path = ${path} ORDER BY char_count DESC NULLS LAST LIMIT ${k * 3}`) as Row[];
      const total = (await sql`SELECT count(*)::int AS n FROM transcript_archive WHERE bloom_path = ${path}`) as Array<{ n: number }>;
      return ok({ path, total: total[0]?.n ?? rows.length, chunks: clean(rows, k) });
    }

    if (op === 'srcleaf') {
      // The SOURCE leaf: the conversations/files that live at a source_nodes leaf (provenance axis).
      const path = p.get('path') || '';
      if (!path) return ok({ error: 'path required' }, 400);
      const rows = (await sql`SELECT doc_id, n_chunks, source_type FROM source_doc_map WHERE src_path = ${path} ORDER BY n_chunks DESC LIMIT ${k * 4}`) as Array<{ doc_id: string; n_chunks: number; source_type: string | null }>;
      const tot = (await sql`SELECT count(*)::int AS n, COALESCE(sum(n_chunks),0)::int AS chunks FROM source_doc_map WHERE src_path = ${path}`) as Array<{ n: number; chunks: number }>;
      return ok({ path, total: tot[0]?.n ?? rows.length, chunks_total: tot[0]?.chunks ?? 0, conversations: rows });
    }

    if (op === 'docsubjects') {
      // CROSS-LINK forward: the SUBJECT leaves a conversation feeds (its chunks' bloom_paths). doc_id -> subjects.
      if (!docId) return ok({ error: 'doc_id required' }, 400);
      const rows = (await sql`SELECT bloom_path, count(*)::int AS n FROM transcript_archive WHERE doc_id = ${docId} AND bloom_path IS NOT NULL GROUP BY bloom_path ORDER BY n DESC LIMIT ${k * 2}`) as Array<{ bloom_path: string; n: number }>;
      return ok({ doc_id: docId, subjects: rows });
    }

    if (op === 'subjsources') {
      // CROSS-LINK reverse: the SOURCES feeding a subject leaf. bloom_path -> source files (via source_doc_map).
      const path = p.get('path') || '';
      if (!path) return ok({ error: 'path required' }, 400);
      const rows = (await sql`SELECT sdm.src_path, count(*)::int AS n FROM transcript_archive ta JOIN source_doc_map sdm USING(doc_id) WHERE ta.bloom_path = ${path} GROUP BY sdm.src_path ORDER BY n DESC LIMIT ${k * 2}`) as Array<{ src_path: string; n: number }>;
      return ok({ path, sources: rows });
    }

    if (op === 'children') {
      // Direct children of a node — for incremental tree descent (agents shouldn't pull the whole tree).
      // depth-1 branches have parent_path NULL by convention, so children of ROOT = (parent_path IS NULL AND depth=1).
      const axis = p.get('axis') === 'source' ? 'source' : 'subject';
      const path = p.get('path') || 'ROOT';
      const rows = (path === 'ROOT'
        ? (axis === 'source'
            ? await sql`SELECT path, name, depth, is_leaf, n_chunks, coherence FROM source_nodes WHERE parent_path IS NULL AND depth = 1 ORDER BY n_chunks DESC`
            : await sql`SELECT path, name, depth, is_leaf, n_chunks, coherence FROM fractal_nodes WHERE parent_path IS NULL AND depth = 1 ORDER BY n_chunks DESC`)
        : (axis === 'source'
            ? await sql`SELECT path, name, depth, is_leaf, n_chunks, coherence FROM source_nodes WHERE parent_path = ${path} ORDER BY n_chunks DESC`
            : await sql`SELECT path, name, depth, is_leaf, n_chunks, coherence FROM fractal_nodes WHERE parent_path = ${path} ORDER BY n_chunks DESC`)) as Array<{ path: string; name: string; depth: number; is_leaf: boolean; n_chunks: number | null; coherence: number | null }>;
      return ok({ axis, path, count: rows.length, children: rows.map((r) => ({ id: r.path, name: r.name, depth: r.depth, is_leaf: r.is_leaf, n_chunks: r.n_chunks || 0, coherence: r.coherence == null ? null : Math.round(r.coherence * 1000) / 1000 })) });
    }

    return ok({ error: 'unknown op', op, ops: ['stats', 'docs', 'search', 'node', 'neighbors', 'doc', 'concept', 'tree', 'children', 'leaf', 'srcleaf', 'docsubjects', 'subjsources', 'prime_residual_stats', 'prime_residual_profile', 'prime_residual_notables', 'prime_residual_modes', 'prime_residual_neighbors'] }, 400);
  } catch (err: unknown) {
    return ok({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
