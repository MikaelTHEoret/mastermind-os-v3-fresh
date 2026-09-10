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
    const query=(request.nextUrl.searchParams.get('q')??'').trim().slice(0,200),like=`%${query}%`;
    const yearValue=Number(request.nextUrl.searchParams.get('year')),year=Number.isInteger(yearValue)&&yearValue>=100&&yearValue<=3000?yearValue:null;
    const jobValue=Number(request.nextUrl.searchParams.get('jobId')),jobId=Number.isSafeInteger(jobValue)&&jobValue>0?jobValue:null;
    const pageValue=Number(request.nextUrl.searchParams.get('pageId')),pageId=Number.isSafeInteger(pageValue)&&pageValue>0?pageValue:null;
    const format=request.nextUrl.searchParams.get('format'),limit=format==='csv'?50000:Math.min(1000,Math.max(1,Number(request.nextUrl.searchParams.get('limit'))||250));
    const sql=getMemoryDb();
    const rows=await sql`SELECT r.id,r.page_id,r.record_index,r.entry_order,r.column_index,r.event_type,r.event_date_text,r.event_year,r.date_visual_text,r.date_source,r.date_inferred,r.location_text,r.subject_text,r.formula_template,r.excerpt,r.confidence,r.visual_confidence,r.contextual_confidence,r.boundary_confidence,r.review_status,r.evidence_class,
        p.page_number,p.source_url,p.sha256,j.id AS job_id,j.archive,j.register_id,
        er.metadata->'page_structure' AS page_structure,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('person_index',rp.person_index,'role',rp.role,'name_raw',rp.name_raw,'name_pattern',rp.name_pattern,'reconstructed_name',rp.reconstructed_name,'reconstruction_basis',rp.reconstruction_basis,'given_names',rp.given_names,'surname',rp.surname,'surname_raw',rp.surname_raw,'surname_pattern',rp.surname_pattern,'reconstructed_surname',rp.reconstructed_surname,'surname_reconstruction_basis',rp.surname_reconstruction_basis,'surname_visual_confidence',rp.surname_visual_confidence,'surname_contextual_confidence',rp.surname_contextual_confidence,'surname_state',rp.surname_state,'gender',rp.gender,'residence',rp.residence,'occupation',rp.occupation,'confidence',rp.confidence,'visual_confidence',rp.visual_confidence,'contextual_confidence',rp.contextual_confidence) ORDER BY rp.person_index) FROM genealogy_record_people rp WHERE rp.record_id=r.id),'[]'::jsonb) AS people,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('relationship_index',rr.relationship_index,'type',rr.relationship_type,'from_person_index',rr.from_person_index,'to_person_index',rr.to_person_index,'from_name',rr.from_name,'to_name',rr.to_name,'confidence',rr.confidence) ORDER BY rr.relationship_index) FROM genealogy_record_relationships rr WHERE rr.record_id=r.id),'[]'::jsonb) AS relationships
      FROM genealogy_records r JOIN genealogy_record_extraction_runs er ON er.id=r.extraction_run_id JOIN genealogy_pages p ON p.id=r.page_id JOIN genealogy_crawl_jobs j ON j.id=p.job_id
      WHERE (${jobId}::bigint IS NULL OR j.id=${jobId}) AND (${pageId}::bigint IS NULL OR p.id=${pageId}) AND (${year}::integer IS NULL OR r.event_year=${year})
        AND (${query}='' OR r.subject_text ILIKE ${like} OR r.location_text ILIKE ${like} OR r.excerpt ILIKE ${like} OR EXISTS(SELECT 1 FROM genealogy_record_people person WHERE person.record_id=r.id AND (person.name_raw ILIKE ${like} OR person.surname_raw ILIKE ${like} OR person.surname_pattern ILIKE ${like} OR person.reconstructed_surname ILIKE ${like} OR word_similarity(${query}::text,person.normalized_name)>=0.45 OR word_similarity(${query}::text,person.normalized_surname)>=0.45)))
      ORDER BY p.page_number,r.record_index LIMIT ${limit}`;
    if(format==='csv'){
      const header=['archive','register_id','page','entry_order','event_type','date_visual','event_date','event_year','date_source','date_inferred','location','subject','formula_template','surnames','people_and_roles','relationships','visual_confidence','contextual_confidence','boundary_confidence','review_status','source_url'];
      const lines=[header.join(','),...rows.map((row:Record<string,unknown>)=>{
        const people=Array.isArray(row.people)?row.people as Array<Record<string,unknown>>:[];
        const relationships=Array.isArray(row.relationships)?row.relationships as Array<Record<string,unknown>>:[];
        return [row.archive,row.register_id,row.page_number,row.entry_order,row.event_type,row.date_visual_text,row.event_date_text,row.event_year,row.date_source,row.date_inferred,row.location_text,row.subject_text,row.formula_template,people.map((person)=>`${person.role}: ${person.reconstructed_surname||person.surname_raw||person.surname_pattern||'—'}${person.reconstructed_surname&&person.surname_pattern&&person.reconstructed_surname!==person.surname_pattern?` [visual: ${person.surname_pattern}]`:''}`).join(' | '),
          people.map((person)=>`${person.role}: ${person.reconstructed_name||person.name_raw}${person.reconstructed_name&&person.reconstructed_name!==person.name_raw?` [visual: ${person.name_pattern||person.name_raw}]`:''}`).join(' | '),relationships.map((relationship)=>`${relationship.type}: ${relationship.from_name} → ${relationship.to_name}`).join(' | '),
          row.visual_confidence,row.contextual_confidence,row.boundary_confidence,row.review_status,row.source_url].map(csvCell).join(',');
      })];
      return new NextResponse(`\uFEFF${lines.join('\r\n')}`,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="genealogy-records${pageId?`-page-${pageId}`:''}.csv"`}});
    }
    return NextResponse.json({ok:true,query,year,jobId,pageId,count:rows.length,records:rows});
  }catch(error:unknown){const message=error instanceof Error?error.message:String(error);return NextResponse.json({ok:false,error:message},{status:500});}
}
