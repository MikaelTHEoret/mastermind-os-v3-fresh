import path from 'node:path';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import { resolveArchiveImagePath } from '@/lib/genealogy/archive-store.mjs';
import { getBrittanyHtrHealth, resolveBrittanyHtrPaths, runBrittanyHtr } from '@/lib/genealogy/htr-engine.mjs';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const LOCAL_HOSTS=new Set(['127.0.0.1','localhost']);

function launchArchiveWorker(jobId:number){
  const logRoot=path.join(process.env.LOCALAPPDATA??process.cwd(),'Mastermind','logs');
  mkdirSync(logRoot,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),base=`genealogy-htr-${stamp}`;
  const stdout=openSync(path.join(logRoot,`${base}.out.log`),'a'),stderr=openSync(path.join(logRoot,`${base}.err.log`),'a');
  try{const child=spawn(process.execPath,['scripts/run-genealogy-htr-conversion.mjs','--job',String(jobId)],{cwd:process.cwd(),detached:true,windowsHide:true,stdio:['ignore',stdout,stderr]});child.unref();return child.pid??null;}finally{closeSync(stdout);closeSync(stderr);}
}

function processAlive(value:unknown){const pid=Number(value);if(!Number.isInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch{return false;}}

async function gate(): Promise<NextResponse | null> {
  if (!ownerGateConfigured()) return null;
  const result = await requireOwner();
  return result.ok ? null : NextResponse.json({ ok: false, error: result.reason }, { status: result.status });
}

async function engineHealth() {
  try { return await getBrittanyHtrHealth({ timeoutMs: 60_000 }); }
  catch (error: unknown) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function GET(request: NextRequest) {
  const denied = await gate(); if (denied) return denied;
  const sql = getMemoryDb();
  try {
    const jobId = Math.max(1, Number(request.nextUrl.searchParams.get('jobId')) || 2);
    const [counts] = await sql`
      SELECT
        (SELECT count(*)::int FROM genealogy_pages WHERE job_id=${jobId}) total_pages,
        (SELECT count(DISTINCT run.page_id)::int FROM genealogy_htr_page_runs run JOIN genealogy_pages page ON page.id=run.page_id WHERE page.job_id=${jobId}) segmented_pages,
        (SELECT count(DISTINCT run.page_id)::int FROM genealogy_htr_page_runs run JOIN genealogy_pages page ON page.id=run.page_id WHERE page.job_id=${jobId} AND ((run.model_id IS NOT NULL AND run.status IN ('needs_review','complete')) OR (run.model_id IS NULL AND run.status IN ('needs_review','complete') AND run.line_count=0))) converted_pages,
        (SELECT count(*)::int FROM genealogy_htr_lines line JOIN genealogy_pages page ON page.id=line.page_id WHERE page.job_id=${jobId}) lines,
        (SELECT count(*)::int FROM genealogy_htr_lines line JOIN genealogy_htr_page_runs run ON run.id=line.page_run_id JOIN genealogy_pages page ON page.id=line.page_id WHERE page.job_id=${jobId} AND run.model_id IS NOT NULL AND run.status IN ('needs_review','complete')) recognized_lines,
        (SELECT count(*)::int FROM genealogy_htr_lines line JOIN genealogy_pages page ON page.id=line.page_id WHERE page.job_id=${jobId} AND line.review_status IN ('corrected','confirmed') AND line.corrected_text IS NOT NULL) corrected_lines,
        (SELECT count(*)::int FROM genealogy_htr_lines line JOIN genealogy_pages page ON page.id=line.page_id WHERE page.job_id=${jobId} AND line.training_split='train' AND line.review_status IN ('corrected','confirmed')) training_lines,
        (SELECT count(*)::int FROM genealogy_htr_lines line JOIN genealogy_pages page ON page.id=line.page_id WHERE page.job_id=${jobId} AND line.training_split='validation' AND line.review_status IN ('corrected','confirmed')) validation_lines`;
    const models = await sql`SELECT id,model_key,display_name,engine,architecture,status,training_line_count,validation_line_count,character_error_rate,word_error_rate,updated_at FROM genealogy_htr_models ORDER BY id`;
    const workerRows=await sql`SELECT * FROM genealogy_htr_archive_workers WHERE job_id=${jobId} LIMIT 1`;
    const worker=workerRows[0]??{job_id:jobId,status:'idle',stage:'idle',current_page:null,total_pages:Number(counts?.total_pages)||0,completed_pages:Number(counts?.converted_pages)||0,failed_pages:0,lines_detected:Number(counts?.recognized_lines)||0,stop_requested:false,last_message:null,last_error:null,heartbeat_at:null,started_at:null,finished_at:null};
    const active = await sql`SELECT run.id,run.status,run.line_count,run.started_at,page.id page_id,page.page_number FROM genealogy_htr_page_runs run JOIN genealogy_pages page ON page.id=run.page_id WHERE page.job_id=${jobId} AND run.status IN ('queued','segmenting','recognizing') ORDER BY run.started_at DESC LIMIT 4`;
    const recent=await sql`WITH preferred AS (SELECT DISTINCT ON (run.page_id) run.id,run.status,run.line_count,run.mean_confidence,run.error,run.finished_at,run.model_id,page.page_number FROM genealogy_htr_page_runs run JOIN genealogy_pages page ON page.id=run.page_id WHERE page.job_id=${jobId} AND run.status IN ('needs_review','complete','failed') ORDER BY run.page_id,(run.model_id IS NOT NULL) DESC,run.finished_at DESC NULLS LAST,run.id DESC) SELECT * FROM preferred ORDER BY finished_at DESC NULLS LAST,id DESC LIMIT 12`;
    const queue = await sql`
      SELECT line.id,line.page_id,line.line_index,line.predicted_text,line.corrected_text,line.confidence,line.priority_score,line.review_status,line.training_split,line.tags,
        line.metadata->'lexicon_second_pass' AS lexicon_second_pass,
        page.page_number,page.source_url
      FROM genealogy_htr_lines line JOIN genealogy_pages page ON page.id=line.page_id
      WHERE page.job_id=${jobId} AND line.review_status='unreviewed'
        AND line.page_run_id=(SELECT preferred.id FROM genealogy_htr_page_runs preferred WHERE preferred.page_id=line.page_id AND preferred.status IN ('needs_review','complete') ORDER BY (preferred.model_id IS NOT NULL) DESC,preferred.finished_at DESC NULLS LAST,preferred.id DESC LIMIT 1)
      ORDER BY (line.tags@>ARRAY['surname-candidate']::text[]) DESC,(line.predicted_text IS NULL),line.priority_score DESC,page.page_number,line.line_index LIMIT 12`;
    return NextResponse.json({ ok: true, engine: await engineHealth(), counts, models, worker, active, recent, queue },{headers:{'Cache-Control':'no-store'}});
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await gate(); if (denied) return denied;
  const sql = getMemoryDb();
  try {
    const body = await request.json();
    const action = String(body.action || '');
    const jobId=Math.max(1,Number(body.jobId)||2);
    if(action==='start_archive'){
      if(process.env.VERCEL||!LOCAL_HOSTS.has(request.nextUrl.hostname))return NextResponse.json({ok:false,error:'The archive converter can only run from the local Mastermind app.'},{status:403});
      const currentRows=await sql`SELECT status,heartbeat_at,process_id FROM genealogy_htr_archive_workers WHERE job_id=${jobId} LIMIT 1`,current=currentRows[0],fresh=['starting','running','pausing'].includes(String(current?.status))&&Date.now()-new Date(current?.heartbeat_at??0).getTime()<20*60*1000&&processAlive(current?.process_id);
      if(fresh)return NextResponse.json({ok:true,alreadyRunning:true,worker:current});
      const processId=launchArchiveWorker(jobId);
      const [worker]=await sql`INSERT INTO genealogy_htr_archive_workers(job_id,status,process_id,stage,total_pages,completed_pages,failed_pages,lines_detected,stop_requested,last_message,last_error,started_at,heartbeat_at,finished_at,updated_at) VALUES(${jobId},'starting',${processId},'selecting',(SELECT count(*)::int FROM genealogy_pages WHERE job_id=${jobId}),0,0,0,false,'Archive converter launched',NULL,now(),now(),NULL,now()) ON CONFLICT(job_id) DO UPDATE SET status='starting',process_id=EXCLUDED.process_id,stage='selecting',stop_requested=false,last_message='Archive converter launched',last_error=NULL,started_at=now(),heartbeat_at=now(),finished_at=NULL,updated_at=now() RETURNING *`;
      return NextResponse.json({ok:true,started:true,worker});
    }
    if(action==='pause_archive'){
      if(process.env.VERCEL||!LOCAL_HOSTS.has(request.nextUrl.hostname))return NextResponse.json({ok:false,error:'The archive converter can only be controlled from the local Mastermind app.'},{status:403});
      const [worker]=await sql`UPDATE genealogy_htr_archive_workers SET stop_requested=true,status=CASE WHEN status IN ('running','starting') THEN 'pausing' ELSE status END,last_message=CASE WHEN status IN ('running','starting') THEN 'Pause requested · finishing the current page safely' ELSE last_message END,updated_at=now() WHERE job_id=${jobId} RETURNING *`;
      return NextResponse.json({ok:true,worker:worker??null});
    }
    if (action === 'activate_base_model') {
      const health: any = await getBrittanyHtrHealth({ timeoutMs: 60_000 });
      const weightsPath = (health.models ?? []).find((candidate: unknown) => String(candidate).endsWith('ppocrv6-small-multilingual-base.safetensors'));
      if (!weightsPath) return NextResponse.json({ ok:false,error:'The local PP-OCRv6 base model has not been downloaded yet.' },{status:404});
      await sql`UPDATE genealogy_htr_models SET base_model='10.5281/zenodo.21788405',weights_path=${String(weightsPath)},status='ready',metadata=metadata||${JSON.stringify({phase:'base-model',fine_tuned:false})}::jsonb,updated_at=now() WHERE model_key='brittany-parish-v1'`;
      return NextResponse.json({ok:true,model:'brittany-parish-v1',weightsPath});
    }
    if (action === 'correct') {
      const lineId = Number(body.lineId);
      const correctedText = String(body.correctedText ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
      if (!Number.isInteger(lineId) || lineId < 1 || !correctedText) return NextResponse.json({ ok: false, error: 'A line and literal transcription are required.' }, { status: 400 });
      const [line] = await sql`SELECT id,page_id,COALESCE(corrected_text,predicted_text) prior_text FROM genealogy_htr_lines WHERE id=${lineId}`;
      if (!line) return NextResponse.json({ ok: false, error: 'The HTR line no longer exists.' }, { status: 404 });
      await sql`INSERT INTO genealogy_htr_corrections(line_id,prior_text,corrected_text,correction_kind) VALUES (${lineId},${line.prior_text},${correctedText},'human')`;
      const split = Number(line.page_id) % 20 === 0 ? 'test' : Number(line.page_id) % 10 === 0 ? 'validation' : 'train';
      await sql`UPDATE genealogy_htr_lines SET corrected_text=${correctedText},review_status='confirmed',training_split=${split},priority_score=0,updated_at=now() WHERE id=${lineId}`;
      return NextResponse.json({ ok: true, lineId, trainingSplit: split });
    }
    if (action !== 'segment' && action !== 'recognize') return NextResponse.json({ ok: false, error: 'Unknown HTR action.' }, { status: 400 });
    let pageId = Number(body.pageId);
    if (!Number.isInteger(pageId) || pageId < 1) {
      const [next] = await sql`SELECT page.id FROM genealogy_pages page JOIN genealogy_page_assets pa ON pa.page_id=page.id AND pa.role='original' WHERE page.job_id=${Math.max(1, Number(body.jobId)||2)} AND NOT EXISTS(SELECT 1 FROM genealogy_htr_page_runs run WHERE run.page_id=page.id AND run.status<>'failed') ORDER BY page.page_number NULLS LAST,page.id LIMIT 1`;
      pageId = Number(next?.id);
    }
    if (!Number.isInteger(pageId) || pageId < 1) return NextResponse.json({ ok: false, error: 'No unsegmented archive page is available.' }, { status: 404 });
    const [page] = await sql`SELECT page.id,page.page_number,asset.storage_key,asset.sha256 FROM genealogy_pages page JOIN genealogy_page_assets pa ON pa.page_id=page.id AND pa.role='original' JOIN genealogy_archive_assets asset ON asset.sha256=pa.asset_sha256 WHERE page.id=${pageId} ORDER BY pa.captured_at DESC LIMIT 1`;
    if (!page) return NextResponse.json({ ok: false, error: 'The page has no stored original image.' }, { status: 404 });
    const health: any = await getBrittanyHtrHealth({ timeoutMs: 60_000 });
    let model: any = null;
    if (action === 'recognize') {
      [model] = await sql`SELECT id,weights_path FROM genealogy_htr_models WHERE model_key='brittany-parish-v1' AND status='ready' AND weights_path IS NOT NULL`;
      if (!model) return NextResponse.json({ ok: false, error: 'The Brittany model is not trained yet. Segment and correct lines first.' }, { status: 409 });
    }
    const imagePath = await resolveArchiveImagePath(page.storage_key);
    const htrPaths = resolveBrittanyHtrPaths();
    const pageOutput = path.join(htrPaths.workspace, 'pages', `${page.sha256}.${action}.xml`);
    await mkdir(path.dirname(pageOutput), { recursive: true });
    const engineVersion = `kraken-${String(health.engineVersion || '7.1')}`;
    const segmentationVersion = 'kraken-stock-baseline-v1';
    const prior = await sql`SELECT id FROM genealogy_htr_page_runs WHERE page_id=${pageId} AND engine_version=${engineVersion} AND segmentation_version=${segmentationVersion} AND model_id IS NOT DISTINCT FROM ${model?.id ?? null} ORDER BY id DESC LIMIT 1`;
    const runId = prior[0]?.id ?? (await sql`INSERT INTO genealogy_htr_page_runs(page_id,model_id,engine_version,segmentation_version,status) VALUES (${pageId},${model?.id ?? null},${engineVersion},${segmentationVersion},${action==='recognize'?'recognizing':'segmenting'}) RETURNING id`)[0].id;
    await sql`UPDATE genealogy_htr_page_runs SET status=${action==='recognize'?'recognizing':'segmenting'},error=NULL,started_at=now(),finished_at=NULL WHERE id=${runId}`;
    let result: any;
    try {
      const args = ['page','--image',imagePath,'--output',pageOutput];
      if (model?.weights_path) {
        const [segmented] = await sql`SELECT page_xml_path FROM genealogy_htr_page_runs WHERE page_id=${pageId} AND model_id IS NULL AND status IN ('needs_review','complete') AND page_xml_path IS NOT NULL ORDER BY finished_at DESC NULLS LAST,id DESC LIMIT 1`;
        if (segmented?.page_xml_path) args.push('--segmentation',String(segmented.page_xml_path));
        args.push('--model',String(model.weights_path));
      }
      result = await runBrittanyHtr(args, { timeoutMs: 1_800_000 });
    } catch (error: unknown) {
      await sql`UPDATE genealogy_htr_page_runs SET status='failed',error=${error instanceof Error?error.message:String(error)},finished_at=now() WHERE id=${runId}`;
      throw error;
    }
    await sql`DELETE FROM genealogy_htr_lines WHERE page_run_id=${runId}`;
    const preparedLines=[];
    for (const item of result.lines ?? []) {
      const bbox = item.bbox;
      if (!bbox || bbox.width < 1 || bbox.height < 1) continue;
      const confidence = item.confidence == null ? null : Math.max(0, Math.min(1, Number(item.confidence)));
      const priority = confidence == null ? 1 : 1-confidence;
      preparedLines.push({line_index:Number(item.lineIndex)||0,bbox_x:Number(bbox.x)||0,bbox_y:Number(bbox.y)||0,bbox_width:Number(bbox.width)||1,bbox_height:Number(bbox.height)||1,baseline:{points:item.baseline??null},predicted_text:item.text??null,confidence,priority_score:priority,metadata:{line_id:item.lineId??null}});
    }
    if(preparedLines.length)await sql`INSERT INTO genealogy_htr_lines(page_run_id,page_id,line_index,bbox_x,bbox_y,bbox_width,bbox_height,baseline,predicted_text,confidence,priority_score,metadata)
      SELECT ${runId},${pageId},item.line_index,item.bbox_x,item.bbox_y,item.bbox_width,item.bbox_height,item.baseline,item.predicted_text,item.confidence,item.priority_score,item.metadata
      FROM jsonb_to_recordset(${JSON.stringify(preparedLines)}::jsonb) AS item(line_index integer,bbox_x integer,bbox_y integer,bbox_width integer,bbox_height integer,baseline jsonb,predicted_text text,confidence double precision,priority_score double precision,metadata jsonb)`;
    await sql`UPDATE genealogy_htr_page_runs SET status='needs_review',line_count=${Number(result.lineCount)||0},mean_confidence=${result.meanConfidence??null},literal_text=${result.literalText??null},page_xml_path=${pageOutput},finished_at=now() WHERE id=${runId}`;
    return NextResponse.json({ ok: true, pageId, pageNumber: page.page_number, runId, mode: action, lineCount: result.lineCount, meanConfidence: result.meanConfidence });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
