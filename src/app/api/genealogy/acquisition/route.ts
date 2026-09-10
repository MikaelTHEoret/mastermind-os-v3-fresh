import { authenticateCaptureClient } from '@/lib/genealogy/capture-access';
import { captureLocal, captureRequestAllowed, sameOriginLocalRequest } from '@/lib/genealogy/capture-policy.mjs';
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import {
  archiveStoreContract,
  persistArchiveImage,
} from '@/lib/genealogy/archive-store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

function localOnly(request: NextRequest): NextResponse | null {
  if (!captureLocal(request,process.env)) {
    return NextResponse.json({ ok: false, error: 'Genealogy acquisition is available only on the private local Mastermind node.' }, { status: 403 });
  }
  return null;
}

function extensionOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin') ?? '';
  return EXTENSION_ORIGIN.test(origin) ? origin : null;
}

function withCors(response: NextResponse, origin: string | null): NextResponse {
  if (origin) response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Mastermind-Capture-Client, X-Mastermind-Capture-Secret');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Max-Age', '600');
  response.headers.append('Vary', 'Origin');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function json(body: object, status = 200, origin: string | null = null): NextResponse {
  return withCors(NextResponse.json(body, { status }), origin);
}

function isSameOriginAdmin(request: NextRequest): boolean {
  return request.headers.get('origin')===request.nextUrl.origin && sameOriginLocalRequest(request);
}

function safeUrl(input: unknown): string {
  const value = String(input ?? '').trim();
  if (value.length < 8 || value.length > 4096) throw new Error('A bounded source URL is required.');
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only HTTP(S) archive sources are accepted.');
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

function boundedMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 24 * 1024) throw new Error('Acquisition metadata is too large.');
  return JSON.parse(encoded) as Record<string, unknown>;
}

function registerIdentity(value: unknown): string | null {
  const identity = String(value ?? '').trim();
  return identity && /^[a-z0-9._:-]{1,120}$/i.test(identity) ? identity : null;
}

async function authenticateClient(request:NextRequest,_origin:string|null,approvedOnly=true){
  return authenticateCaptureClient(request,approvedOnly);
}

export async function OPTIONS(request: NextRequest) {
  const denied = localOnly(request); if (denied) return denied;
  const origin = extensionOrigin(request);
  return origin && captureRequestAllowed(request) ? withCors(new NextResponse(null, { status: 204 }), origin) : json({ ok: false, error: 'Extension origin required.' }, 403);
}

export async function GET(request: NextRequest) {
  const denied = localOnly(request); if (denied) return denied;
  const origin = extensionOrigin(request);
  const clientId = request.nextUrl.searchParams.get('clientId');
  const sql = getMemoryDb();
  if (origin || clientId) {
    if(!origin || !captureRequestAllowed(request))return json({ok:false,error:'Matching capture-client credentials required.'},401,origin);
    const authenticated=await authenticateClient(request,origin,false);
    if(!authenticated || authenticated.clientId!==clientId)return json({ok:false,error:'Matching capture-client credentials required.'},401,origin);
    const rows=await authenticated.sql`SELECT status,label,approved_at,updated_at FROM genealogy_capture_clients
      WHERE client_id=${authenticated.clientId}::uuid AND extension_origin=${origin} LIMIT 1`;
    const pairing=rows[0]??{status:'unregistered'};
    const jobs=pairing.status==='approved' ? await authenticated.sql`SELECT id,archive,source_url,register_id,status,objective,metadata
      FROM genealogy_crawl_jobs ORDER BY updated_at DESC LIMIT 100` : [];
    return json({ok:true,pairing,jobs},200,origin);
  }
  if (!sameOriginLocalRequest(request))return json({ok:false,error:'Same-origin Mastermind request required.'},403);
  const [clients, assets, recent] = await Promise.all([
    sql`SELECT client_id, label, extension_origin, status, approved_at, last_seen_at, created_at
      FROM genealogy_capture_clients ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC LIMIT 50`,
    sql`SELECT count(*)::int AS assets, COALESCE(sum(byte_size),0)::bigint AS bytes FROM genealogy_archive_assets`,
    sql`SELECT a.sha256, a.media_type, a.byte_size, a.width, a.height, a.first_source_url,
        p.id AS page_id, p.page_number, p.status, j.register_id, j.frontier_id, a.created_at
      FROM genealogy_archive_assets a
      JOIN genealogy_page_assets pa ON pa.asset_sha256=a.sha256 AND pa.role='original'
      JOIN genealogy_pages p ON p.id=pa.page_id JOIN genealogy_crawl_jobs j ON j.id=p.job_id
      ORDER BY a.created_at DESC LIMIT 100`,
  ]);
  return json({ ok: true, clients, summary: assets[0], assets: recent });
}

export async function POST(request: NextRequest) {
  const denied = localOnly(request); if (denied) return denied;
  const origin = extensionOrigin(request);
  if(origin ? !captureRequestAllowed(request) : !sameOriginLocalRequest(request))return json({ok:false,error:'Capture request is not authorized.'},403);
  const contentType = request.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();
      const action = String(body.action ?? '');
      const sql = getMemoryDb();
      if (action === 'register_client') {
        if (!origin) return json({ ok: false, error: 'Chrome extension origin required.' }, 403);
        const clientId = String(body.clientId ?? ''), secretSha256 = String(body.secretSha256 ?? '').toLowerCase();
        const label = String(body.label ?? 'Mastermind Archive Capture').trim().slice(0, 120);
        if (!UUID.test(clientId) || !SHA256.test(secretSha256) || !label) return json({ ok: false, error: 'Invalid capture-client registration.' }, 400, origin);
        const existing = await sql`SELECT extension_origin, secret_sha256, status FROM genealogy_capture_clients WHERE client_id=${clientId}::uuid LIMIT 1`;
        if (existing[0] && (existing[0].extension_origin !== origin || existing[0].secret_sha256 !== secretSha256)) {
          return json({ ok: false, error: 'Capture-client identity conflict.' }, 409, origin);
        }
        const rows = await sql`INSERT INTO genealogy_capture_clients(client_id,label,extension_origin,secret_sha256,status)
          VALUES (${clientId}::uuid,${label},${origin},${secretSha256},'pending')
          ON CONFLICT(client_id) DO UPDATE SET label=EXCLUDED.label,updated_at=NOW() RETURNING status,label,created_at`;
        return json({ ok: true, pairing: rows[0] }, 202, origin);
      }
      if (action === 'approve_client' || action === 'revoke_client') {
        if (!isSameOriginAdmin(request)) return json({ ok: false, error: 'Same-origin Mastermind approval required.' }, 403);
        const clientId = String(body.clientId ?? '');
        if (!UUID.test(clientId)) return json({ ok: false, error: 'Invalid client ID.' }, 400);
        const status = action === 'approve_client' ? 'approved' : 'revoked';
        const rows = await sql`UPDATE genealogy_capture_clients SET status=${status},
          approved_at=CASE WHEN ${status}='approved' THEN NOW() ELSE approved_at END,updated_at=NOW()
          WHERE client_id=${clientId}::uuid RETURNING client_id,label,status,approved_at`;
        if (!rows[0]) return json({ ok: false, error: 'Capture client not found.' }, 404);
        return json({ ok: true, client: rows[0] });
      }
      if (action === 'ensure_job') {
        const authenticated = await authenticateClient(request, origin);
        if (!authenticated) return json({ ok:false, error:'Approved archive extension required.' }, 401, origin);
        const archive = String(body.archive ?? '').trim();
        const registerId = registerIdentity(body.registerId);
        const sourceUrl = safeUrl(body.sourceUrl ?? body.manifestUrl);
        const manifestUrl = body.manifestUrl ? safeUrl(body.manifestUrl) : null;
        if (!['nli', 'morbihan-iiif'].includes(archive) || !registerId) {
          return json({ ok:false, error:'A supported archive and register identity are required.' }, 400, origin);
        }
        const existing = await authenticated.sql`SELECT * FROM genealogy_crawl_jobs
          WHERE archive=${archive} AND lower(COALESCE(register_id,''))=lower(${registerId})
          ORDER BY updated_at DESC LIMIT 1`;
        if (existing[0]) return json({ ok:true, job:existing[0], created:false }, 200, origin);
        const metadata = JSON.stringify({
          adapter:archive === 'morbihan-iiif' ? 'iiif-presentation-v2' : 'nli-divaserve-v1',
          manifestUrl,
          createdBy:'mastermind-archive-capture',
        });
        const rows = await authenticated.sql`INSERT INTO genealogy_crawl_jobs
          (frontier_id,archive,source_url,register_id,status,objective,target_names,metadata)
          VALUES (NULL,${archive},${sourceUrl},${registerId},'proposed',
            ${String(body.objective ?? 'Capture and catalogue this register').trim().slice(0, 1000)},'{}',${metadata}::jsonb)
          RETURNING *`;
        return json({ ok:true, job:rows[0], created:true }, 201, origin);
      }
      if (action === 'index_manifest') {
        const authenticated = await authenticateClient(request, origin);
        const admin = isSameOriginAdmin(request);
        if (!authenticated && !admin) return json({ ok:false, error:'Approved archive extension or same-origin Mastermind session required.' }, 401, origin);
        const database = authenticated?.sql ?? sql;
        const jobId = Number(body.jobId), archiveId = registerIdentity(body.archiveId);
        const manifestUrl = safeUrl(body.manifestUrl), label = String(body.label ?? '').trim().slice(0, 500) || null;
        const rawPages = Array.isArray(body.pages) ? body.pages : [];
        if (!Number.isSafeInteger(jobId) || jobId < 1 || !archiveId || rawPages.length < 1 || rawPages.length > 5000) {
          return json({ ok:false, error:'A job, archive identity, and manifest of 1–5,000 pages are required.' }, 400, origin);
        }
        const jobs = await database`SELECT id,register_id FROM genealogy_crawl_jobs WHERE id=${jobId} LIMIT 1`;
        if (!jobs[0] || String(jobs[0].register_id ?? '').toLowerCase() !== archiveId.toLowerCase()) {
          return json({ ok:false, error:'The manifest does not match the selected crawl job.' }, 409, origin);
        }
        const pages = rawPages.map((page:Record<string,unknown>, index:number) => {
          const pageNumber = Number(page.pageNumber), sourceUrl = safeUrl(page.sourceUrl);
          const width = Number(page.width) || null, height = Number(page.height) || null;
          if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10_000_000) throw new Error(`Manifest page ${index + 1} has an invalid number.`);
          return {
            page_number:pageNumber, sequence_index:index, source_url:sourceUrl,
            width, height, archive_label:String(page.label ?? '').trim().slice(0, 500) || null,
            metadata:boundedMetadata(page.metadata),
          };
        });
        await database`INSERT INTO genealogy_archive_catalogues(job_id,archive_id,manifest_url,label,total_pages,metadata)
          VALUES (${jobId},${archiveId},${manifestUrl},${label},${pages.length},${JSON.stringify({adapter:'iiif-manifest-v1'})}::jsonb)
          ON CONFLICT(job_id) DO UPDATE SET archive_id=EXCLUDED.archive_id,manifest_url=EXCLUDED.manifest_url,
            label=EXCLUDED.label,total_pages=EXCLUDED.total_pages,metadata=genealogy_archive_catalogues.metadata||EXCLUDED.metadata,
            indexed_at=NOW(),updated_at=NOW()`;
        await database`INSERT INTO genealogy_pages
          (job_id,page_number,sequence_index,source_url,width,height,status,archive_label,search_text,indexed_at,metadata)
          SELECT ${jobId},x.page_number,x.sequence_index,x.source_url,x.width,x.height,'discovered',x.archive_label,
            COALESCE(x.archive_label,''),NOW(),x.metadata
          FROM jsonb_to_recordset(${JSON.stringify(pages)}::jsonb)
            AS x(page_number integer,sequence_index integer,source_url text,width integer,height integer,archive_label text,metadata jsonb)
          ON CONFLICT(job_id,source_url) DO UPDATE SET page_number=EXCLUDED.page_number,sequence_index=EXCLUDED.sequence_index,
            width=COALESCE(genealogy_pages.width,EXCLUDED.width),height=COALESCE(genealogy_pages.height,EXCLUDED.height),
            archive_label=COALESCE(EXCLUDED.archive_label,genealogy_pages.archive_label),
            search_text=trim(concat_ws(' ',genealogy_pages.search_text,EXCLUDED.archive_label)),
            indexed_at=NOW(),metadata=genealogy_pages.metadata||EXCLUDED.metadata,updated_at=NOW()`;
        await database`UPDATE genealogy_crawl_jobs SET status='catalogued',pages_discovered=(SELECT count(*) FROM genealogy_pages WHERE job_id=${jobId}),
          pages_downloaded=(SELECT count(*) FROM genealogy_pages WHERE job_id=${jobId} AND sha256 IS NOT NULL),last_error=NULL,updated_at=NOW() WHERE id=${jobId}`;
        return json({ok:true,jobId,indexed:pages.length,totalPages:pages.length},201,origin);
      }
      return json({ ok: false, error: 'Unknown acquisition action.' }, 400, origin);
    }

    if (!contentType.includes('multipart/form-data') || !origin) return json({ ok: false, error: 'Paired extension image upload required.' }, 415, origin);
    const authenticated = await authenticateClient(request, origin);
    if (!authenticated) return json({ ok: false, error: 'Archive extension is not paired or its credential is invalid.' }, 401, origin);
    const form = await request.formData();
    const image = form.get('image');
    if (!(image instanceof File) || image.size < 12 || image.size > archiveStoreContract.maxImageBytes) {
      return json({ ok: false, error: 'A JPEG or PNG image under 24 MB is required.' }, 400, origin);
    }
    const envelope = boundedMetadata(JSON.parse(String(form.get('metadata') ?? '{}')));
    const eventId = String(envelope.eventId ?? '');
    const jobId = Number(envelope.jobId);
    const pageNumber = envelope.pageNumber === null || envelope.pageNumber === undefined ? null : Number(envelope.pageNumber);
    const registerId = registerIdentity(envelope.registerId);
    const sourceUrl = safeUrl(envelope.sourceUrl);
    let imageUrl = sourceUrl;
    try { imageUrl = safeUrl(envelope.imageUrl ?? sourceUrl); } catch { imageUrl = sourceUrl; }
    const width = Number(envelope.width) || null, height = Number(envelope.height) || null;
    if (!UUID.test(eventId) || !Number.isSafeInteger(jobId) || jobId < 1) return json({ ok: false, error: 'eventId and jobId are required.' }, 400, origin);
    if (pageNumber !== null && (!Number.isSafeInteger(pageNumber) || pageNumber < 0 || pageNumber > 10_000_000)) return json({ ok: false, error: 'Invalid page number.' }, 400, origin);
    const jobs = await authenticated.sql`SELECT id,register_id,frontier_id FROM genealogy_crawl_jobs WHERE id=${jobId} LIMIT 1`;
    if (!jobs[0]) return json({ ok: false, error: 'The target genealogy crawl job does not exist.' }, 404, origin);
    if (registerId && jobs[0].register_id && String(jobs[0].register_id).toLowerCase() !== registerId.toLowerCase()) {
      return json({ ok: false, error: 'The captured register does not match the selected crawl job.' }, 409, origin);
    }
    const bytes = Buffer.from(await image.arrayBuffer());
    const stored = await persistArchiveImage({ bytes, declaredType: image.type, expectedSha256: typeof envelope.sha256 === 'string' ? envelope.sha256 : null });
    const metadata = boundedMetadata({ ...envelope, eventId: undefined, jobId: undefined, sha256: undefined, captureClient: authenticated.clientId });
    await authenticated.sql`INSERT INTO genealogy_archive_assets
      (sha256,media_type,byte_size,width,height,storage_key,first_source_url,metadata)
      VALUES (${stored.sha256},${stored.mediaType},${stored.byteSize},${width},${height},${stored.storageKey},${imageUrl},${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT(sha256) DO UPDATE SET width=COALESCE(genealogy_archive_assets.width,EXCLUDED.width),
        height=COALESCE(genealogy_archive_assets.height,EXCLUDED.height)`;
    const pages = await authenticated.sql`INSERT INTO genealogy_pages
      (job_id,page_number,source_url,original_path,sha256,width,height,status,metadata)
      VALUES (${jobId},${pageNumber},${sourceUrl},${stored.storageKey},${stored.sha256},${width},${height},'downloaded',${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT(job_id,source_url) DO UPDATE SET page_number=COALESCE(EXCLUDED.page_number,genealogy_pages.page_number),
        original_path=EXCLUDED.original_path,sha256=EXCLUDED.sha256,width=COALESCE(EXCLUDED.width,genealogy_pages.width),
        height=COALESCE(EXCLUDED.height,genealogy_pages.height),status=CASE WHEN genealogy_pages.status='scanned' THEN 'scanned' ELSE 'downloaded' END,
        metadata=genealogy_pages.metadata||EXCLUDED.metadata,updated_at=NOW() RETURNING *`;
    const page = pages[0];
    await authenticated.sql`INSERT INTO genealogy_page_assets(page_id,asset_sha256,role,source_url,metadata)
      VALUES (${page.id},${stored.sha256},'original',${imageUrl},${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT(page_id,asset_sha256,role) DO NOTHING`;
    const receipt = await authenticated.sql`INSERT INTO genealogy_acquisition_events
      (event_id,client_id,page_id,asset_sha256,source_url,register_id,page_number,metadata)
      VALUES (${eventId}::uuid,${authenticated.clientId}::uuid,${page.id},${stored.sha256},${sourceUrl},${registerId},${pageNumber},${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT(client_id,source_url,asset_sha256) DO UPDATE SET metadata=genealogy_acquisition_events.metadata
      RETURNING event_id,captured_at`;
    await Promise.all([
      authenticated.sql`UPDATE genealogy_capture_clients SET last_seen_at=NOW(),updated_at=NOW() WHERE client_id=${authenticated.clientId}::uuid`,
      authenticated.sql`UPDATE genealogy_crawl_jobs SET status=CASE WHEN status IN ('proposed','queued','awaiting_browser') THEN 'running' ELSE status END,
        pages_discovered=(SELECT count(*) FROM genealogy_pages WHERE job_id=${jobId}),
        pages_downloaded=(SELECT count(*) FROM genealogy_pages WHERE job_id=${jobId} AND sha256 IS NOT NULL),last_error=NULL,updated_at=NOW() WHERE id=${jobId}`,
    ]);
    return json({ ok: true, page: { id: page.id, pageNumber: page.page_number, status: page.status }, asset: { sha256: stored.sha256, byteSize: stored.byteSize, mediaType: stored.mediaType, created: stored.created }, receipt: receipt[0] }, 201, origin);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 500, origin);
  }
}
