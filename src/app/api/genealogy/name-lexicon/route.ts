import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const CLUSTER='register-wide-consensus-v1';
async function gate():Promise<NextResponse|null>{if(!ownerGateConfigured())return null;const result=await requireOwner();return result.ok?null:NextResponse.json({ok:false,error:result.reason},{status:result.status});}

export async function POST(request:NextRequest){
  const denied=await gate();if(denied)return denied;
  try{
    const body=await request.json(),jobId=Number(body.jobId);if(!Number.isSafeInteger(jobId)||jobId<1)return NextResponse.json({ok:false,error:'jobId is required'},{status:400});
    const sql=getMemoryDb(),jobs=await sql`SELECT archive,register_id FROM genealogy_crawl_jobs WHERE id=${jobId} LIMIT 1`,job=jobs[0];if(!job)return NextResponse.json({ok:false,error:'Genealogy job not found'},{status:404});
    await sql`UPDATE genealogy_name_lexicon SET metadata=metadata||'{"active":false}'::jsonb,updated_at=NOW() WHERE archive=${job.archive} AND register_id=${job.register_id} AND handwriting_cluster=${CLUSTER}`;
    const upserted=await sql`WITH source_readings AS (
        SELECT reading.name_raw,reading.normalized_name,reading.reading_type,reading.confidence,page.page_number
        FROM genealogy_name_readings reading
        JOIN genealogy_name_calibration_runs run ON run.id=reading.calibration_run_id
        JOIN genealogy_pages page ON page.id=reading.page_id
        WHERE page.job_id=${jobId} AND run.prompt_version='blind-paleographic-name-spotter-v1' AND run.preprocess_version='two-leaf-six-tile-contrast-v1'
          AND COALESCE(run.metadata->>'page_type','register') NOT IN ('title','film_marker','blank')
          AND reading.review_status<>'rejected' AND reading.confidence>=0.28 AND char_length(reading.normalized_name)>=3
      ), eligible AS (
        SELECT name_raw,normalized_name,reading_type,confidence,page_number,'whole_reading'::text component_kind
        FROM source_readings
        WHERE normalized_name !~ '^(fils|filz|fille|femme|enfant|baptise|baptisee|parrain|marraine|pere|mere|jour|mois|son|noble|damoiselle|messire|maistre|sieur|recteur|prestre)$'
          AND name_raw !~* '\\m(fils|filz|fille|femme|enfant|baptis[ée]e?|parrain|marraine|noble|damoiselle|messire|maistre|sieur|recteur|prestre)\\M'
        UNION ALL
        SELECT initcap(token),token,'token',confidence,page_number,'name_token'
        FROM source_readings CROSS JOIN LATERAL regexp_split_to_table(normalized_name,'\\s+') token
        WHERE normalized_name LIKE '% %' AND char_length(token)>=3
          AND token !~ '^(fils|filz|fille|femme|enfant|baptise|baptisee|parrain|marraine|pere|mere|jour|mois|son|noble|damoiselle|messire|maistre|sieur|recteur|prestre|junior|ledit|ladite|avec|pour|dont|sous|dans|cette|audit|dudit|dite|monsieur|madame)$'
      ), grouped AS (
        SELECT normalized_name,(array_agg(name_raw ORDER BY confidence DESC))[1] canonical_reading,
          array_agg(DISTINCT name_raw ORDER BY name_raw) variants,array_agg(DISTINCT page_number ORDER BY page_number) supporting_pages,
          count(*)::int support_count,count(DISTINCT page_number)::int page_support,avg(confidence) mean_confidence,
          array_agg(DISTINCT reading_type ORDER BY reading_type) reading_types,array_agg(DISTINCT component_kind ORDER BY component_kind) component_kinds
        FROM eligible GROUP BY normalized_name HAVING count(*)>=2
      )
      INSERT INTO genealogy_name_lexicon(archive,register_id,handwriting_cluster,canonical_reading,normalized_name,variants,supporting_pages,support_count,confidence,review_status,metadata)
      SELECT ${job.archive},${job.register_id},${CLUSTER},canonical_reading,normalized_name,variants,supporting_pages,support_count,
        LEAST(0.99,mean_confidence+LEAST(0.25,ln(1+support_count)*0.04+ln(1+page_support)*0.08)),'candidate',jsonb_build_object('active',true,'page_support',page_support,'cross_page',page_support>=2,'reading_types',reading_types,'component_kinds',component_kinds,'mean_visual_confidence',mean_confidence)
      FROM grouped
      ON CONFLICT(archive,register_id,handwriting_cluster,normalized_name) DO UPDATE SET canonical_reading=EXCLUDED.canonical_reading,variants=EXCLUDED.variants,supporting_pages=EXCLUDED.supporting_pages,support_count=EXCLUDED.support_count,confidence=EXCLUDED.confidence,metadata=EXCLUDED.metadata,updated_at=NOW()
      RETURNING id,canonical_reading,normalized_name,variants,supporting_pages,support_count,confidence,review_status,metadata`;
    const stats=await sql`SELECT count(*)::int readings,count(DISTINCT reading.page_id)::int calibrated_pages FROM genealogy_name_readings reading JOIN genealogy_pages page ON page.id=reading.page_id WHERE page.job_id=${jobId}`;
    return NextResponse.json({ok:true,jobId,cluster:CLUSTER,readings:Number(stats[0]?.readings||0),calibratedPages:Number(stats[0]?.calibrated_pages||0),lexiconEntries:upserted.length,entries:upserted.slice(0,250)});
  }catch(error:unknown){const message=error instanceof Error?error.message:String(error);return NextResponse.json({ok:false,error:message},{status:500});}
}

export async function GET(request:NextRequest){
  const denied=await gate();if(denied)return denied;
  try{
    const jobId=Number(request.nextUrl.searchParams.get('jobId')),query=(request.nextUrl.searchParams.get('q')??'').trim().slice(0,200),limit=Math.min(500,Math.max(1,Number(request.nextUrl.searchParams.get('limit'))||100));if(!Number.isSafeInteger(jobId)||jobId<1)return NextResponse.json({ok:false,error:'jobId is required'},{status:400});
    const sql=getMemoryDb(),jobs=await sql`SELECT archive,register_id FROM genealogy_crawl_jobs WHERE id=${jobId} LIMIT 1`,job=jobs[0];if(!job)return NextResponse.json({ok:false,error:'Genealogy job not found'},{status:404});
    const rows=await sql`SELECT id,canonical_reading,normalized_name,variants,supporting_pages,support_count,confidence,review_status,metadata,
        CASE WHEN ${query}='' THEN 0 ELSE word_similarity(${query}::text,normalized_name) END rank
      FROM genealogy_name_lexicon WHERE archive=${job.archive} AND register_id=${job.register_id} AND handwriting_cluster=${CLUSTER} AND COALESCE((metadata->>'active')::boolean,false)
        AND (${query}='' OR canonical_reading ILIKE ${`%${query}%`} OR word_similarity(${query}::text,normalized_name)>=0.45)
      ORDER BY rank DESC,support_count DESC,confidence DESC LIMIT ${limit}`;
    return NextResponse.json({ok:true,jobId,query,count:rows.length,entries:rows});
  }catch(error:unknown){const message=error instanceof Error?error.message:String(error);return NextResponse.json({ok:false,error:message},{status:500});}
}
