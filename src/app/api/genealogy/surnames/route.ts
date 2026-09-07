import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

async function gate():Promise<NextResponse|null>{if(!ownerGateConfigured())return null;const result=await requireOwner();return result.ok?null:NextResponse.json({ok:false,error:result.reason},{status:result.status});}
function csvCell(value:unknown){const text=value==null?'':String(value);return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}

export async function GET(request:NextRequest){
  const denied=await gate();if(denied)return denied;
  try{
    const query=(request.nextUrl.searchParams.get('q')??'').trim().slice(0,200),like=`%${query}%`,jobValue=Number(request.nextUrl.searchParams.get('jobId')??2),jobId=Number.isSafeInteger(jobValue)&&jobValue>0?jobValue:2,format=request.nextUrl.searchParams.get('format'),limit=format==='csv'?50000:Math.min(1000,Math.max(1,Number(request.nextUrl.searchParams.get('limit'))||200)),sql=getMemoryDb();
    const rows=await sql`WITH evidence AS (
      SELECT person.id,person.role,person.surname_raw,person.surname_pattern,COALESCE(person.reconstructed_surname,person.surname) reconstructed_surname,person.normalized_surname,person.surname_state,person.surname_visual_confidence,person.surname_contextual_confidence,
        COALESCE(NULLIF(person.reconstructed_surname,''),NULLIF(person.surname_raw,''),NULLIF(person.surname_pattern,''),NULLIF(person.surname,'')) family_name,
        COALESCE(NULLIF(person.normalized_surname,''),lower(regexp_replace(COALESCE(person.reconstructed_surname,person.surname_raw,person.surname_pattern,person.surname,''),'[^a-zA-Z0-9]+',' ','g'))) family_key,
        page.page_number,page.source_url
      FROM genealogy_record_people person JOIN genealogy_records record ON record.id=person.record_id JOIN genealogy_pages page ON page.id=record.page_id
      WHERE page.job_id=${jobId} AND person.role<>'officiant' AND person.surname_state<>'absent' AND (person.surname_visual_confidence IS NOT NULL OR person.surname_contextual_confidence IS NOT NULL) AND COALESCE(person.reconstructed_surname,person.surname_raw,person.surname_pattern,person.surname) IS NOT NULL
        AND (${query}='' OR person.surname_raw ILIKE ${like} OR person.surname_pattern ILIKE ${like} OR person.reconstructed_surname ILIKE ${like} OR person.surname ILIKE ${like} OR word_similarity(${query}::text,person.normalized_surname)>=0.45)
    ) SELECT family_key,(array_agg(family_name ORDER BY surname_contextual_confidence DESC NULLS LAST,id))[1] display_name,array_agg(DISTINCT family_name ORDER BY family_name) variants,array_agg(DISTINCT role ORDER BY role) roles,array_agg(DISTINCT page_number ORDER BY page_number) pages,count(*)::int sightings,count(DISTINCT page_number)::int page_support,avg(COALESCE(surname_visual_confidence,0)) visual_confidence,avg(COALESCE(surname_contextual_confidence,0)) contextual_confidence,bool_or(surname_state='partial') has_partial,(array_agg(source_url ORDER BY surname_contextual_confidence DESC NULLS LAST,id))[1] source_url
      FROM evidence WHERE family_key<>'' GROUP BY family_key ORDER BY count(DISTINCT page_number) DESC,count(*) DESC,avg(COALESCE(surname_contextual_confidence,0)) DESC LIMIT ${limit}`;
    if(format==='csv'){const header=['surname','variants','roles','pages','sightings','page_support','visual_confidence','contextual_confidence','has_partial','source_url'],lines=[header.join(','),...rows.map((row)=>[row.display_name,(row.variants??[]).join(' | '),(row.roles??[]).join(' | '),(row.pages??[]).join(' | '),row.sightings,row.page_support,row.visual_confidence,row.contextual_confidence,row.has_partial,row.source_url].map(csvCell).join(','))];return new NextResponse(`\uFEFF${lines.join('\r\n')}`,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="genealogy-surname-catalogue.csv"'}});}
    return NextResponse.json({ok:true,jobId,query,count:rows.length,surnames:rows});
  }catch(error:unknown){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
}
