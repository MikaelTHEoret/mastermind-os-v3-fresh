import { NextRequest, NextResponse } from 'next/server';
import { getMemoryDb } from '@/lib/db';
import { INITIAL_FRONTIERS } from '@/lib/genealogy/frontiers';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(): Promise<NextResponse | null> {
  if (!ownerGateConfigured()) return null;
  const result = await requireOwner();
  return result.ok ? null : NextResponse.json({ ok:false, error:result.reason }, { status:result.status });
}

async function ensureSchema() {
  const sql = getMemoryDb();
  await sql`CREATE TABLE IF NOT EXISTS genealogy_crawl_jobs (
    id BIGSERIAL PRIMARY KEY, frontier_id TEXT, archive TEXT NOT NULL,
    source_url TEXT NOT NULL, register_id TEXT, page_hint INTEGER,
    status TEXT NOT NULL DEFAULT 'proposed', objective TEXT NOT NULL,
    target_names TEXT[] NOT NULL DEFAULT '{}', year_from INTEGER, year_to INTEGER,
    pages_discovered INTEGER NOT NULL DEFAULT 0, pages_downloaded INTEGER NOT NULL DEFAULT 0,
    pages_scanned INTEGER NOT NULL DEFAULT 0, last_error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_url, frontier_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS genealogy_crawl_jobs_status_idx ON genealogy_crawl_jobs(status, updated_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS genealogy_pages (
    id BIGSERIAL PRIMARY KEY, job_id BIGINT NOT NULL REFERENCES genealogy_crawl_jobs(id) ON DELETE CASCADE,
    page_number INTEGER, source_url TEXT NOT NULL, original_path TEXT, sha256 TEXT,
    width INTEGER, height INTEGER, status TEXT NOT NULL DEFAULT 'discovered',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(job_id, source_url)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS genealogy_page_variants (
    id BIGSERIAL PRIMARY KEY, page_id BIGINT NOT NULL REFERENCES genealogy_pages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT, width INTEGER, height INTEGER,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(page_id, kind, path)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS genealogy_scan_runs (
    id BIGSERIAL PRIMARY KEY, page_id BIGINT NOT NULL REFERENCES genealogy_pages(id) ON DELETE CASCADE,
    variant_id BIGINT REFERENCES genealogy_page_variants(id) ON DELETE SET NULL,
    engine TEXT NOT NULL, engine_version TEXT, status TEXT NOT NULL,
    raw_text TEXT, mean_confidence DOUBLE PRECISION, error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS genealogy_regions (
    id BIGSERIAL PRIMARY KEY, scan_run_id BIGINT NOT NULL REFERENCES genealogy_scan_runs(id) ON DELETE CASCADE,
    region_index INTEGER NOT NULL, region_type TEXT NOT NULL DEFAULT 'record',
    x INTEGER NOT NULL, y INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
    raw_text TEXT, confidence DOUBLE PRECISION, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE(scan_run_id, region_index)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS genealogy_transcription_alternatives (
    id BIGSERIAL PRIMARY KEY, region_id BIGINT NOT NULL REFERENCES genealogy_regions(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL, reading TEXT NOT NULL, confidence DOUBLE PRECISION,
    engine TEXT, is_selected BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS genealogy_observations (
    id BIGSERIAL PRIMARY KEY, page_id BIGINT NOT NULL REFERENCES genealogy_pages(id) ON DELETE CASCADE,
    region_id BIGINT REFERENCES genealogy_regions(id) ON DELETE SET NULL,
    frontier_id TEXT, event_type TEXT, event_date_text TEXT, place_text TEXT,
    names JSONB NOT NULL DEFAULT '[]'::jsonb, relationships JSONB NOT NULL DEFAULT '[]'::jsonb,
    excerpt TEXT, confidence DOUBLE PRECISION, review_status TEXT NOT NULL DEFAULT 'unreviewed',
    evidence_class TEXT NOT NULL DEFAULT 'lead', metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  return sql;
}

function nliIdentity(value:string) {
  const registerId = value.match(/vtls(\d{9})/i)?.[1] ?? null;
  const suffix = value.match(/vtls\d{9}_(\d{3,4})/i)?.[1];
  const hashPage = value.match(/#page\/(\d+)/i)?.[1];
  return { registerId, pageHint:Number(suffix ?? hashPage) || null };
}

const MORBIHAN_HOST = 'rechercher.patrimoines-archives.morbihan.fr';

function sourceIdentity(value:string) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error('Archive sources must use HTTPS.');
  if (parsed.hostname === 'registers.nli.ie') {
    const identity = nliIdentity(value);
    return { archive:'nli', adapter:'nli-divaserve-v1', ...identity, manifestUrl:null };
  }
  if (parsed.hostname === MORBIHAN_HOST) {
    const archiveId = parsed.pathname.match(/\/ark:\/15049\/(vta[a-z0-9]+)/i)?.[1] ?? null;
    if (!archiveId) throw new Error('This Morbihan URL does not contain an ARK archive identity.');
    const pathPage = parsed.pathname.match(/\/daogrp\/\d+\/(\d+)/i)?.[1];
    const canvasPage = parsed.searchParams.get('id')?.match(/\/canvas\/\d+\/(\d+)/i)?.[1];
    return {
      archive:'morbihan-iiif', adapter:'iiif-presentation-v2', registerId:archiveId,
      pageHint:Number(pathPage ?? canvasPage) || null,
      manifestUrl:`${parsed.origin}/ark:/15049/${archiveId}/manifest`,
    };
  }
  throw new Error('Supported sources are NLI registers and Morbihan IIIF archives.');
}

export async function GET() {
  const denied = await gate(); if (denied) return denied;
  try {
    const sql = await ensureSchema();
    const jobs = await sql`SELECT id, frontier_id, archive, source_url, register_id, page_hint, status,
      objective, target_names, year_from, year_to, pages_discovered, pages_downloaded, pages_scanned,
      last_error, created_at, updated_at FROM genealogy_crawl_jobs ORDER BY updated_at DESC LIMIT 100`;
    const summaryRows = await sql`SELECT
      (SELECT count(*)::int FROM genealogy_pages) pages,
      (SELECT count(*)::int FROM genealogy_page_variants) enhanced,
      (SELECT count(*)::int FROM genealogy_scan_runs) scan_runs,
      (SELECT count(*)::int FROM genealogy_pages WHERE index_status IN ('skimmed','candidate','date_indexed','date_uncertain','non_register','records_extracted')) indexed_pages,
      (SELECT count(*)::int FROM genealogy_observations) observations,
      (SELECT count(*)::int FROM genealogy_observations WHERE review_status='unreviewed') needs_review`;
    const pages = await sql`SELECT p.id, p.job_id, p.page_number, p.source_url, p.sha256, p.width, p.height, p.status,
      p.archive_label,p.index_status,p.index_year_from,p.index_year_to,p.index_names,p.index_terms,p.index_confidence,
      count(DISTINCT v.id)::int variant_count, count(DISTINCT s.id)::int scan_count,
      count(DISTINCT o.id)::int observation_count, p.created_at
      FROM genealogy_pages p LEFT JOIN genealogy_page_variants v ON v.page_id=p.id
      LEFT JOIN genealogy_scan_runs s ON s.page_id=p.id LEFT JOIN genealogy_observations o ON o.page_id=p.id
      GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 50`;
    return NextResponse.json({ ok:true, frontiers:INITIAL_FRONTIERS, jobs, summary:summaryRows[0], pages });
  } catch (error:unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok:false, frontiers:INITIAL_FRONTIERS, jobs:[], error:message }, { status:500 });
  }
}

export async function POST(request:NextRequest) {
  const denied = await gate(); if (denied) return denied;
  try {
    const body = await request.json();
    const action = String(body.action ?? 'create_job');
    const sql = await ensureSchema();
    if (action === 'catalogue_page') {
      const jobId = Number(body.jobId), pageUrl = String(body.sourceUrl ?? '').trim();
      if (!jobId || !pageUrl) return NextResponse.json({ ok:false, error:'jobId and sourceUrl are required' }, { status:400 });
      const rows = await sql`INSERT INTO genealogy_pages
        (job_id,page_number,source_url,original_path,sha256,width,height,status,metadata)
        VALUES (${jobId},${body.pageNumber ?? null},${pageUrl},${body.originalPath ?? null},${body.sha256 ?? null},
          ${body.width ?? null},${body.height ?? null},${body.status ?? 'downloaded'},${JSON.stringify(body.metadata ?? {})}::jsonb)
        ON CONFLICT(job_id,source_url) DO UPDATE SET original_path=EXCLUDED.original_path,sha256=EXCLUDED.sha256,
          width=EXCLUDED.width,height=EXCLUDED.height,status=EXCLUDED.status,metadata=EXCLUDED.metadata,updated_at=NOW()
        RETURNING *`;
      const page = rows[0];
      for (const variant of Array.isArray(body.variants) ? body.variants : []) {
        await sql`INSERT INTO genealogy_page_variants(page_id,kind,path,sha256,width,height,parameters)
          VALUES (${page.id},${String(variant.kind)},${String(variant.path)},${variant.sha256 ?? null},
            ${variant.width ?? null},${variant.height ?? null},${JSON.stringify(variant.parameters ?? {})}::jsonb)
          ON CONFLICT(page_id,kind,path) DO UPDATE SET sha256=EXCLUDED.sha256,parameters=EXCLUDED.parameters`;
      }
      await sql`UPDATE genealogy_crawl_jobs SET pages_downloaded=(SELECT count(*) FROM genealogy_pages WHERE job_id=${jobId}),updated_at=NOW() WHERE id=${jobId}`;
      return NextResponse.json({ ok:true, page }, { status:201 });
    }
    if (action === 'record_scan') {
      const pageId=Number(body.pageId); if(!pageId) return NextResponse.json({ok:false,error:'pageId is required'},{status:400});
      const runs=await sql`INSERT INTO genealogy_scan_runs(page_id,variant_id,engine,engine_version,status,raw_text,mean_confidence,error,metadata)
        VALUES (${pageId},${body.variantId ?? null},${String(body.engine ?? 'pending')},${body.engineVersion ?? null},
          ${String(body.status ?? 'pending_ocr')},${body.rawText ?? null},${body.meanConfidence ?? null},${body.error ?? null},
          ${JSON.stringify(body.metadata ?? {})}::jsonb) RETURNING *`;
      for(const region of Array.isArray(body.regions)?body.regions:[]){
        await sql`INSERT INTO genealogy_regions(scan_run_id,region_index,region_type,x,y,width,height,raw_text,confidence,metadata)
          VALUES (${runs[0].id},${Number(region.index)},${String(region.type ?? 'record')},${Number(region.x)},${Number(region.y)},
            ${Number(region.width)},${Number(region.height)},${region.rawText ?? null},${region.confidence ?? null},
            ${JSON.stringify(region.metadata ?? {})}::jsonb) ON CONFLICT(scan_run_id,region_index) DO NOTHING`;
      }
      await sql`UPDATE genealogy_pages SET status=${body.status === 'complete' ? 'scanned' : 'segmented'},updated_at=NOW() WHERE id=${pageId}`;
      await sql`UPDATE genealogy_crawl_jobs SET pages_scanned=(SELECT count(*) FROM genealogy_pages WHERE job_id=genealogy_crawl_jobs.id AND status='scanned'),updated_at=NOW()
        WHERE id=(SELECT job_id FROM genealogy_pages WHERE id=${pageId})`;
      return NextResponse.json({ok:true,scan:runs[0]},{status:201});
    }
    if (action === 'record_observation') {
      const pageId=Number(body.pageId); if(!pageId) return NextResponse.json({ok:false,error:'pageId is required'},{status:400});
      const rows=await sql`INSERT INTO genealogy_observations
        (page_id,region_id,frontier_id,event_type,event_date_text,place_text,names,relationships,excerpt,confidence,review_status,evidence_class,metadata)
        VALUES (${pageId},${body.regionId ?? null},${body.frontierId ?? null},${body.eventType ?? null},
          ${body.eventDateText ?? null},${body.placeText ?? null},${JSON.stringify(body.names ?? [])}::jsonb,
          ${JSON.stringify(body.relationships ?? [])}::jsonb,${body.excerpt ?? null},${body.confidence ?? null},
          ${body.reviewStatus ?? 'unreviewed'},${body.evidenceClass ?? 'lead'},${JSON.stringify(body.metadata ?? {})}::jsonb)
        RETURNING *`;
      if (body.regionId) for (const alternative of Array.isArray(body.alternatives)?body.alternatives:[]) {
        await sql`INSERT INTO genealogy_transcription_alternatives(region_id,field_name,reading,confidence,engine,is_selected)
          VALUES (${body.regionId},${String(alternative.fieldName)},${String(alternative.reading)},
            ${alternative.confidence ?? null},${alternative.engine ?? null},${Boolean(alternative.isSelected)})`;
      }
      return NextResponse.json({ok:true,observation:rows[0]},{status:201});
    }
    const sourceUrl = String(body.sourceUrl ?? '').trim();
    if (!sourceUrl) return NextResponse.json({ ok:false, error:'sourceUrl is required' }, { status:400 });
    const frontierId = body.frontierId ? String(body.frontierId) : null;
    const frontier = INITIAL_FRONTIERS.find((item)=>item.id===frontierId);
    const identity = sourceIdentity(sourceUrl);
    const objective = String(body.objective ?? frontier?.objective ?? 'Discover and catalogue this register range').trim();
    const targetNames = Array.isArray(body.targetNames) ? body.targetNames.map(String) : (frontier?.variants ?? []);
    const existing = await sql`SELECT id FROM genealogy_crawl_jobs
      WHERE archive=${identity.archive} AND lower(COALESCE(register_id,''))=lower(${identity.registerId ?? ''})
        AND frontier_id IS NOT DISTINCT FROM ${frontierId}
      ORDER BY updated_at DESC LIMIT 1`;
    if (existing[0]) {
      const rows = await sql`UPDATE genealogy_crawl_jobs SET source_url=${sourceUrl},page_hint=${identity.pageHint},
        objective=${objective},target_names=${targetNames},year_from=${body.yearFrom ?? frontier?.yearFrom ?? null},
        year_to=${body.yearTo ?? frontier?.yearTo ?? null},metadata=${JSON.stringify({ adapter:identity.adapter, manifestUrl:identity.manifestUrl })}::jsonb,
        updated_at=NOW() WHERE id=${existing[0].id} RETURNING *`;
      return NextResponse.json({ ok:true, job:rows[0], created:false }, { status:200 });
    }
    const rows = await sql`INSERT INTO genealogy_crawl_jobs
      (frontier_id, archive, source_url, register_id, page_hint, status, objective, target_names, year_from, year_to, metadata)
      VALUES (${frontierId}, ${identity.archive}, ${sourceUrl}, ${identity.registerId}, ${identity.pageHint}, 'proposed',
        ${objective}, ${targetNames}, ${body.yearFrom ?? frontier?.yearFrom ?? null},
        ${body.yearTo ?? frontier?.yearTo ?? null}, ${JSON.stringify({ adapter:identity.adapter, manifestUrl:identity.manifestUrl })}::jsonb)
      ON CONFLICT (source_url, frontier_id) DO UPDATE SET objective=EXCLUDED.objective,
        target_names=EXCLUDED.target_names, year_from=EXCLUDED.year_from, year_to=EXCLUDED.year_to, updated_at=NOW()
      RETURNING *`;
    return NextResponse.json({ ok:true, job:rows[0], created:true }, { status:201 });
  } catch (error:unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok:false, error:message }, { status:500 });
  }
}
