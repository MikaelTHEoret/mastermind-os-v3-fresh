import { NextRequest, NextResponse } from 'next/server';
import { getMemoryDb } from '@/lib/db';
import { readArchiveImage } from '@/lib/genealogy/archive-store.mjs';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = process.env.GENEALOGY_OCR_MODEL || 'gpt-5.4-mini';
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

function outputText(response: unknown): string {
  if (!response || typeof response !== 'object') throw new Error('Invalid transcription provider response');
  const raw = response as { output_text?: unknown; output?: unknown };
  if (typeof raw.output_text === 'string') return raw.output_text;
  if (Array.isArray(raw.output)) {
    for (const item of raw.output) {
      if (!item || typeof item !== 'object') continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const candidate = part as { type?: unknown; text?: unknown };
        if ((candidate.type === 'output_text' || candidate.type === 'text') && typeof candidate.text === 'string') return candidate.text;
      }
    }
  }
  throw new Error('Transcription provider returned no output text');
}

async function gate(): Promise<NextResponse | null> {
  if (!ownerGateConfigured()) return null;
  const result = await requireOwner();
  return result.ok ? null : NextResponse.json({ ok:false, error:result.reason }, { status:result.status });
}

function permittedImage(input: string): string | null {
  if (input.startsWith('data:image/png;base64,') || input.startsWith('data:image/jpeg;base64,')) {
    const encoded = input.slice(input.indexOf(',') + 1);
    return Buffer.byteLength(encoded, 'base64') <= MAX_IMAGE_BYTES ? input : null;
  }
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && url.hostname === 'registers.nli.ie' ? input : null;
  } catch { return null; }
}

const responseFormat = {
  type: 'json_schema', name: 'parish_register_transcription', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['transcription', 'language', 'confidence', 'records', 'uncertain_readings'],
    properties: {
      transcription: { type:'string' }, language: { type:'string' }, confidence: { type:'number', minimum:0, maximum:1 },
      records: { type:'array', items: { type:'object', additionalProperties:false,
        required:['event_type','event_date_text','place_text','names','relationships','excerpt','confidence','bbox'],
        properties:{ event_type:{type:'string'}, event_date_text:{type:'string'}, place_text:{type:'string'}, excerpt:{type:'string'}, confidence:{type:'number',minimum:0,maximum:1},
          names:{type:'array',items:{type:'object',additionalProperties:false,required:['role','reading','confidence'],properties:{role:{type:'string'},reading:{type:'string'},confidence:{type:'number',minimum:0,maximum:1}}}},
          relationships:{type:'array',items:{type:'object',additionalProperties:false,required:['kind','from','to','confidence'],properties:{kind:{type:'string'},from:{type:'string'},to:{type:'string'},confidence:{type:'number',minimum:0,maximum:1}}}},
          bbox:{type:'object',additionalProperties:false,required:['x','y','width','height'],properties:{x:{type:'integer'},y:{type:'integer'},width:{type:'integer'},height:{type:'integer'}}}
        }
      }},
      uncertain_readings:{type:'array',items:{type:'object',additionalProperties:false,required:['reading','alternatives','reason'],properties:{reading:{type:'string'},alternatives:{type:'array',items:{type:'string'}},reason:{type:'string'}}}}
    }
  }
} as const;

export async function POST(request: NextRequest) {
  const denied = await gate(); if (denied) return denied;
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ ok:false, error:'OPENAI_API_KEY is not configured' }, { status:503 });
  try {
    const body = await request.json();
    const pageId = Number(body.pageId);
    if (!pageId) return NextResponse.json({ ok:false, error:'pageId is required' }, { status:400 });
    const sql = getMemoryDb();
    const pageRows = await sql`SELECT p.id,p.sha256,p.original_path,p.source_url,p.page_number,
        j.frontier_id,j.objective,j.target_names,j.year_from,j.year_to,a.media_type,a.storage_key,a.byte_size
      FROM genealogy_pages p JOIN genealogy_crawl_jobs j ON j.id=p.job_id
      LEFT JOIN genealogy_archive_assets a ON a.sha256=p.sha256
      WHERE p.id=${pageId} LIMIT 1`;
    const page = pageRows[0];
    if (!page) return NextResponse.json({ ok:false, error:'Genealogy page not found' }, { status:404 });
    let imageUrl = permittedImage(String(body.imageUrl ?? ''));
    if (page.storage_key) {
      const bytes = await readArchiveImage(page.storage_key);
      if (bytes.length > MAX_IMAGE_BYTES) return NextResponse.json({ ok:false, error:'Stored archive image exceeds the OCR limit' }, { status:413 });
      imageUrl = `data:${page.media_type};base64,${bytes.toString('base64')}`;
    }
    if (!imageUrl) return NextResponse.json({ ok:false, error:'This page has no stored or permitted archive image' }, { status:409 });
    const target = Array.isArray(page.target_names) && page.target_names.length ? ` Research targets: ${page.target_names.join(', ')}; expected years ${page.year_from ?? '?'}–${page.year_to ?? '?'}.` : '';
    const prompt = `You transcribe difficult historical Catholic parish-register images. Preserve spelling exactly as written. Do not infer missing text. Use empty strings where unreadable and report alternatives in uncertain_readings. Extract each visible baptism, marriage, burial, transaction, or annotation as a separate record. Bounding boxes are approximate pixel coordinates in the submitted image. Every result is an unreviewed lead, never proof.${target}`;
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method:'POST', headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({ model:MODEL, input:[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:imageUrl,detail:'high'}]},], text:{format:responseFormat} })
    });
    const raw = await upstream.json();
    if (!upstream.ok) return NextResponse.json({ ok:false, error:raw?.error?.message || 'Transcription provider failed' }, { status:upstream.status });
    const parsed = JSON.parse(outputText(raw));
    const scans = await sql`INSERT INTO genealogy_scan_runs(page_id,engine,engine_version,status,raw_text,mean_confidence,metadata)
      VALUES (${pageId},'openai-responses',${MODEL},'complete',${parsed.transcription},${parsed.confidence},${JSON.stringify({language:parsed.language,uncertain_readings:parsed.uncertain_readings,asset_sha256:page.sha256,source_url:page.source_url})}::jsonb) RETURNING *`;
    const scan = scans[0]; const observations = [];
    for (let index=0; index<parsed.records.length; index++) {
      const record = parsed.records[index];
      const regions = await sql`INSERT INTO genealogy_regions(scan_run_id,region_index,region_type,x,y,width,height,raw_text,confidence,metadata)
        VALUES (${scan.id},${index},'record',${record.bbox.x},${record.bbox.y},${record.bbox.width},${record.bbox.height},${record.excerpt},${record.confidence},'{}'::jsonb) RETURNING *`;
      const region = regions[0];
      const inserted = await sql`INSERT INTO genealogy_observations(page_id,region_id,event_type,event_date_text,place_text,names,relationships,excerpt,confidence,review_status,evidence_class,metadata)
        VALUES (${pageId},${region.id},${record.event_type},${record.event_date_text},${record.place_text},${JSON.stringify(record.names)}::jsonb,${JSON.stringify(record.relationships)}::jsonb,${record.excerpt},${record.confidence},'unreviewed','lead',${JSON.stringify({engine:'openai-responses',model:MODEL,asset_sha256:page.sha256})}::jsonb) RETURNING *`;
      observations.push(inserted[0]);
    }
    await sql`UPDATE genealogy_pages SET status='scanned',updated_at=NOW() WHERE id=${pageId}`;
    await sql`UPDATE genealogy_crawl_jobs SET pages_scanned=(SELECT count(*) FROM genealogy_pages WHERE job_id=genealogy_crawl_jobs.id AND status='scanned'),updated_at=NOW() WHERE id=(SELECT job_id FROM genealogy_pages WHERE id=${pageId})`;
    return NextResponse.json({ ok:true, model:MODEL, scan, observations, uncertain_readings:parsed.uncertain_readings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok:false, error:message }, { status:500 });
  }
}
