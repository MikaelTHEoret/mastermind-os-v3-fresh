import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const CLUSTER='register-wide-consensus-v1';
function csvCell(value:unknown){const text=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);return `"${text.replace(/"/g,'""')}"`;}

async function gate():Promise<NextResponse|null>{
  if(!ownerGateConfigured())return null;
  const result=await requireOwner();
  return result.ok?null:NextResponse.json({ok:false,error:result.reason},{status:result.status});
}

export async function GET(request:NextRequest){
  const denied=await gate();if(denied)return denied;
  try{
    const jobId=Number(request.nextUrl.searchParams.get('jobId'));
    const query=(request.nextUrl.searchParams.get('q')??'').trim().slice(0,200);
    const requestedPage=Number(request.nextUrl.searchParams.get('page'));
    const page=Number.isSafeInteger(requestedPage)&&requestedPage>0?requestedPage:null;
    const confidenceParameter=request.nextUrl.searchParams.get('minConfidence');
    const requestedConfidence=confidenceParameter===null?Number.NaN:Number(confidenceParameter);
    const minConfidence=Number.isFinite(requestedConfidence)?Math.min(1,Math.max(0,requestedConfidence)):0.28;
    const format=request.nextUrl.searchParams.get('format')==='csv'?'csv':'json';
    const limit=Math.min(format==='csv'?50000:500,Math.max(1,Number(request.nextUrl.searchParams.get('limit'))||(format==='csv'?50000:100)));
    if(!Number.isSafeInteger(jobId)||jobId<1)return NextResponse.json({ok:false,error:'jobId is required'},{status:400});

    const sql=getMemoryDb();
    const jobs=await sql`SELECT archive,register_id FROM genealogy_crawl_jobs WHERE id=${jobId} LIMIT 1`;
    const job=jobs[0];
    if(!job)return NextResponse.json({ok:false,error:'Genealogy job not found'},{status:404});

    const summaries=await sql`SELECT
        (SELECT count(*)::int FROM genealogy_pages WHERE job_id=${jobId}) total_pages,
        count(DISTINCT reading.page_id)::int calibrated_pages,
        count(reading.id)::int raw_readings,
        count(reading.id) FILTER (WHERE reading.confidence>=0.5)::int stronger_readings
      FROM genealogy_pages page
      LEFT JOIN genealogy_name_readings reading ON reading.page_id=page.id AND reading.review_status<>'rejected'
      WHERE page.job_id=${jobId}`;
    const lexiconStats=await sql`SELECT count(*)::int consensus_names
      FROM genealogy_name_lexicon
      WHERE archive=${job.archive} AND register_id=${job.register_id} AND handwriting_cluster=${CLUSTER}
        AND COALESCE((metadata->>'active')::boolean,false)`;

    const like=`%${query}%`;
    const rows=await sql`SELECT reading.id,reading.page_id,page.page_number,page.source_url,page.sha256,
        reading.tile_id,reading.line_order,reading.role_hint,reading.reading_type,reading.name_raw,
        reading.normalized_name,reading.alternatives,reading.context_excerpt,reading.letter_evidence,
        reading.confidence,reading.bbox_x,reading.bbox_y,reading.bbox_width,reading.bbox_height,
        reading.review_status,run.engine,run.engine_version,run.prompt_version,run.metadata->>'page_type' page_type,
        consensus.id consensus_id,consensus.canonical_reading consensus_name,consensus.variants consensus_variants,
        consensus.supporting_pages,consensus.support_count,consensus.confidence consensus_confidence,
        consensus.metadata consensus_metadata,
        CASE WHEN ${query}='' THEN reading.confidence
          ELSE GREATEST(word_similarity(${query}::text,reading.normalized_name),
            COALESCE(word_similarity(${query}::text,consensus.normalized_name),0)) END search_rank
      FROM genealogy_name_readings reading
      JOIN genealogy_name_calibration_runs run ON run.id=reading.calibration_run_id
      JOIN genealogy_pages page ON page.id=reading.page_id
      LEFT JOIN LATERAL (
        SELECT lexicon.* FROM genealogy_name_lexicon lexicon
        WHERE lexicon.archive=${job.archive} AND lexicon.register_id=${job.register_id}
          AND lexicon.handwriting_cluster=${CLUSTER} AND COALESCE((lexicon.metadata->>'active')::boolean,false)
          AND (lexicon.normalized_name=reading.normalized_name OR word_similarity(reading.normalized_name,lexicon.normalized_name)>=0.72)
        ORDER BY (lexicon.normalized_name=reading.normalized_name) DESC,
          word_similarity(reading.normalized_name,lexicon.normalized_name) DESC,lexicon.support_count DESC
        LIMIT 1
      ) consensus ON true
      WHERE page.job_id=${jobId} AND reading.review_status<>'rejected' AND reading.confidence>=${minConfidence}
        AND (${page}::integer IS NULL OR page.page_number=${page})
        AND (${query}='' OR reading.name_raw ILIKE ${like} OR reading.normalized_name ILIKE ${like}
          OR reading.alternatives::text ILIKE ${like} OR word_similarity(${query}::text,reading.normalized_name)>=0.38
          OR consensus.canonical_reading ILIKE ${like} OR word_similarity(${query}::text,consensus.normalized_name)>=0.38)
      ORDER BY search_rank DESC,consensus.support_count DESC NULLS LAST,reading.confidence DESC,page.page_number,reading.reading_index
      LIMIT ${limit}`;

    if(format==='csv'){
      const headings=['reading_id','page','page_type','visual_reading','normalized','reading_type','role_hint','alternatives','context','letter_evidence','visual_confidence','consensus_name','consensus_support','consensus_page_support','consensus_confidence','local_image_url','archive_url'];
      const lines=rows.map((row)=>[
        row.id,row.page_number,row.page_type,row.name_raw,row.normalized_name,row.reading_type,row.role_hint,row.alternatives,row.context_excerpt,row.letter_evidence,row.confidence,row.consensus_name,row.support_count,
        row.consensus_metadata&&typeof row.consensus_metadata==='object'?(row.consensus_metadata as {page_support?:unknown}).page_support:null,row.consensus_confidence,
        row.sha256?`/api/genealogy/assets/${row.sha256}`:'',row.source_url,
      ].map(csvCell).join(','));
      return new NextResponse(`\uFEFF${headings.map(csvCell).join(',')}\r\n${lines.join('\r\n')}`,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="genealogy-name-index-job-${jobId}.csv"`}});
    }

    return NextResponse.json({
      ok:true,jobId,query,page,minConfidence,count:rows.length,readings:rows,
      summary:{...summaries[0],consensus_names:Number(lexiconStats[0]?.consensus_names||0)},
      note:'Readings are provisional visual index entries. A consensus match means repeated archive-local spelling, not genealogical proof.',
    });
  }catch(error:unknown){
    const message=error instanceof Error?error.message:String(error);
    return NextResponse.json({ok:false,error:message},{status:500});
  }
}
