import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

async function gate():Promise<NextResponse|null>{
  if(!ownerGateConfigured())return null;
  const result=await requireOwner();
  return result.ok?null:NextResponse.json({ok:false,error:result.reason},{status:result.status});
}

export async function GET(request:NextRequest){
  const denied=await gate();if(denied)return denied;
  try{
    const query=(request.nextUrl.searchParams.get('q')??'').trim().slice(0,200);
    const requestedYear=Number(request.nextUrl.searchParams.get('year'));
    const year=Number.isInteger(requestedYear)&&requestedYear>=100&&requestedYear<=3000?requestedYear:null;
    const requestedJob=Number(request.nextUrl.searchParams.get('jobId'));
    const jobId=Number.isSafeInteger(requestedJob)&&requestedJob>0?requestedJob:null;
    const requestedLimit=Number(request.nextUrl.searchParams.get('limit'));
    const limit=Math.min(200,Math.max(1,Number.isInteger(requestedLimit)?requestedLimit:50));
    if(!query&&!year)return NextResponse.json({ok:false,error:'Enter a name, term, or year.'},{status:400});
    const sql=getMemoryDb(), like=`%${query}%`;
    const rows=await sql`SELECT p.id,p.job_id,p.page_number,p.source_url,p.sha256,p.status,p.archive_label,p.index_status,
        p.index_year_from,p.index_year_to,p.index_names,p.index_terms,p.index_confidence,p.handwriting_cluster,
        j.archive,j.register_id,j.objective,
        CASE WHEN ${query}='' THEN 0 ELSE GREATEST(ts_rank(p.search_vector,websearch_to_tsquery('simple',${query})),word_similarity(${query}::text,p.search_text)) END AS rank
      FROM genealogy_pages p JOIN genealogy_crawl_jobs j ON j.id=p.job_id
      WHERE (${jobId}::bigint IS NULL OR p.job_id=${jobId})
        AND (${year}::integer IS NULL OR (p.index_year_from IS NOT NULL AND p.index_year_from<=${year} AND COALESCE(p.index_year_to,p.index_year_from)>=${year}))
        AND (${query}='' OR p.search_vector @@ websearch_to_tsquery('simple',${query}) OR p.search_text ILIKE ${like} OR word_similarity(${query}::text,p.search_text)>=0.45)
      ORDER BY rank DESC,p.index_confidence DESC NULLS LAST,p.page_number ASC
      LIMIT ${limit}`;
    return NextResponse.json({ok:true,query,year,jobId,count:rows.length,results:rows});
  }catch(error:unknown){
    const message=error instanceof Error?error.message:String(error);
    return NextResponse.json({ok:false,error:message},{status:500});
  }
}
