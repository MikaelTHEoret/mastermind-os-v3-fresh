import { authenticateCaptureClient as captureClient } from '@/lib/genealogy/capture-access';
import { captureLocal, sameOriginLocalRequest, captureOrigin, captureRequestAllowed, withCaptureCors } from '@/lib/genealogy/capture-policy.mjs';
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import { archiveStoreContract, readArchiveImage } from '@/lib/genealogy/archive-store.mjs';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = process.env.GENEALOGY_INDEX_MODEL || 'gpt-5.4-mini';
const PROMPT_VERSION = 'blind-page-name-date-skim-v2';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function outputText(response:unknown):string {
  if (!response || typeof response !== 'object') throw new Error('Invalid indexing provider response');
  const raw=response as {output_text?:unknown;output?:unknown};
  if (typeof raw.output_text === 'string') return raw.output_text;
  if (Array.isArray(raw.output)) for (const item of raw.output) {
    const content=item && typeof item==='object' ? (item as {content?:unknown}).content : null;
    if (Array.isArray(content)) for (const part of content) {
      const candidate=part as {type?:unknown;text?:unknown};
      if ((candidate.type==='output_text'||candidate.type==='text')&&typeof candidate.text==='string') return candidate.text;
    }
  }
  throw new Error('Indexing provider returned no output text');
}

async function ownerGate():Promise<NextResponse|null> {
  if (!ownerGateConfigured()) return null;
  const result=await requireOwner();
  return result.ok ? null : NextResponse.json({ok:false,error:result.reason},{status:result.status});
}


function genuineImage(bytes:Buffer, declared:string):string|null {
  if (bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&['image/jpeg','image/jpg'].includes(declared)) return 'image/jpeg';
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&declared==='image/png') return 'image/png';
  return null;
}

function normalizedName(value:unknown):string {
  return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
}

function editDistance(left:string,right:string):number {
  const row=Array.from({length:right.length+1},(_,index)=>index);
  for(let i=1;i<=left.length;i++){
    let previous=row[0];row[0]=i;
    for(let j=1;j<=right.length;j++){
      const saved=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(left[i-1]===right[j-1]?0:1));previous=saved;
    }
  }
  return row[right.length];
}

const responseFormat={
  type:'json_schema',name:'genealogy_page_skim',strict:true,
  schema:{type:'object',additionalProperties:false,
    required:['page_type','language','year_texts','year_from','year_to','names','terms','record_count_estimate','handwriting_signature','confidence','needs_deep_transcription'],
    properties:{
      page_type:{type:'string',enum:['register','index','title','film_marker','blank','other']}, language:{type:'string'},
      year_texts:{type:'array',items:{type:'string'}}, year_from:{type:['integer','null']}, year_to:{type:['integer','null']},
      names:{type:'array',items:{type:'object',additionalProperties:false,required:['reading','kind','confidence'],properties:{
        reading:{type:'string'},kind:{type:'string',enum:['given','surname','place','unknown']},confidence:{type:'number',minimum:0,maximum:1},
      }}},
      terms:{type:'array',items:{type:'string'}}, record_count_estimate:{type:'integer',minimum:0},
      handwriting_signature:{type:'string'}, confidence:{type:'number',minimum:0,maximum:1}, needs_deep_transcription:{type:'boolean'},
    },
  },
} as const;

async function postCapture(request:NextRequest) {
  if (process.env.VERCEL||!LOCAL_HOSTS.has(request.nextUrl.hostname)) return NextResponse.json({ok:false,error:'Page indexing is local-only.'},{status:403});
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ok:false,error:'OPENAI_API_KEY is not configured'},{status:503});
  try {
    const contentType=request.headers.get('content-type')??'';
    let sql=getMemoryDb(), pageId=0, bytes:Buffer, mediaType='', transient=false, sourceDigest:string|null=null, mode='names_dates';
    if (contentType.includes('multipart/form-data')) {
      const authenticated=await captureClient(request);
      if (!authenticated) return NextResponse.json({ok:false,error:'Approved archive extension required.'},{status:401});
      sql=authenticated.sql;
      const form=await request.formData(), image=form.get('image'), metadata=JSON.parse(String(form.get('metadata')??'{}'));
      if (!(image instanceof File)||image.size<12||image.size>archiveStoreContract.maxImageBytes) return NextResponse.json({ok:false,error:'A bounded JPEG or PNG is required.'},{status:400});
      const jobId=Number(metadata.jobId), pageNumber=Number(metadata.pageNumber), sourceUrl=String(metadata.sourceUrl??'');mode=metadata.mode==='date_only'?'date_only':'names_dates';
      const pages=await sql`SELECT id FROM genealogy_pages WHERE job_id=${jobId} AND (page_number=${pageNumber} OR source_url=${sourceUrl}) ORDER BY CASE WHEN source_url=${sourceUrl} THEN 0 ELSE 1 END LIMIT 1`;
      if (!pages[0]) return NextResponse.json({ok:false,error:'Index the manifest before submitting page imagery.'},{status:409});
      pageId=Number(pages[0].id); bytes=Buffer.from(await image.arrayBuffer()); mediaType=genuineImage(bytes,image.type)??''; transient=true;
      sourceDigest=crypto.createHash('sha256').update(bytes).digest('hex');
    } else {
      const denied=await ownerGate(); if (denied) return denied;
      const body=await request.json(); pageId=Number(body.pageId);mode=body.mode==='date_only'?'date_only':'names_dates';
      if (!pageId) return NextResponse.json({ok:false,error:'pageId is required'},{status:400});
      const pages=await sql`SELECT p.sha256,a.media_type,a.storage_key FROM genealogy_pages p LEFT JOIN genealogy_archive_assets a ON a.sha256=p.sha256 WHERE p.id=${pageId} LIMIT 1`;
      if (!pages[0]?.storage_key) return NextResponse.json({ok:false,error:'This page has no stored image; use the browser skim worker.'},{status:409});
      bytes=await readArchiveImage(pages[0].storage_key); mediaType=String(pages[0].media_type); sourceDigest=String(pages[0].sha256);
    }
    if (!mediaType) return NextResponse.json({ok:false,error:'The submitted bytes are not a genuine JPEG or PNG.'},{status:400});
    const pageRows=await sql`SELECT p.id,p.page_number,p.archive_label,p.source_url,j.archive,j.register_id,j.objective,j.target_names,j.year_from,j.year_to
      FROM genealogy_pages p JOIN genealogy_crawl_jobs j ON j.id=p.job_id WHERE p.id=${pageId} LIMIT 1`;
    const page=pageRows[0]; if (!page) return NextResponse.json({ok:false,error:'Genealogy page not found'},{status:404});
    const dateOnly=mode==='date_only',promptVersion=dateOnly?'blind-page-date-layout-v2':PROMPT_VERSION;
    const cachedRows=await sql`SELECT id,created_at,page_type,year_from,year_to,names,terms,confidence,metadata FROM genealogy_page_index_runs
      WHERE page_id=${pageId} AND prompt_version=${promptVersion} AND source_asset_sha256=${sourceDigest} AND status='complete' LIMIT 1`;
    const cached=cachedRows[0];if(cached){
      const cachedNeedsReview=Boolean(cached.metadata?.needs_deep_transcription),cachedStatus=dateOnly?(cached.page_type!=='register'?'non_register':cached.year_from?'date_indexed':'date_uncertain'):(cachedNeedsReview?'candidate':'skimmed');
      await sql`UPDATE genealogy_pages SET index_status=${cachedStatus},index_year_from=${cached.year_from}::integer,index_year_to=${cached.year_to}::integer,index_names=${cached.names??[]},index_terms=${cached.terms??[]},index_confidence=${cached.confidence},indexed_at=NOW(),updated_at=NOW() WHERE id=${pageId}`;
      return NextResponse.json({ok:true,pageId,model:MODEL,promptVersion,indexRun:{id:cached.id,created_at:cached.created_at},index:{page_type:cached.page_type,year_from:cached.year_from,year_to:cached.year_to,names:cached.names??[],terms:cached.terms??[],confidence:cached.confidence,needs_deep_transcription:cachedNeedsReview,handwriting_signature:cached.metadata?.handwriting_signature??''},cached:true,transientImageDiscarded:transient});
    }
    const prompt=dateOnly
      ? `Create a blind chronological and handwriting index for this historical parish-register image; do not transcribe personal names. Identify only clearly visible year text, the page type, approximate record count, language, and a short handwriting/layout signature useful for clustering pages written by the same scribe. The names and terms arrays must both be empty. For an actual register page, year_from and year_to must describe event years visible in the handwritten entries. For title cards, archival indexes, film markers, or other non-register pages, preserve visible numbers in year_texts but set year_from and year_to to null so catalogue or scanning years do not enter the event chronology. Do not infer a year from neighboring pages or the archive description. Set needs_deep_transcription only when an actual register page has an uncertain event date or structure.`
      : `Create a blind, fast search index for this historical parish-register image; do not fully transcribe it. Identify only clearly visible years, personal-name tokens, place tokens, page type, approximate record count, and a short handwriting description that may help cluster pages written by the same scribe. Preserve spellings exactly as they appear. Do not complete, modernize, infer, or guess names from context. Omit unreadable tokens. You are deliberately not given target families or expected dates so the index remains independent evidence. Set needs_deep_transcription only for image quality or structural reasons visible on the page.`;
    const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:MODEL,input:[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:`data:${mediaType};base64,${bytes.toString('base64')}`,detail:'high'}]}],text:{format:responseFormat}})});
    const raw=await upstream.json();
    if (!upstream.ok) return NextResponse.json({ok:false,error:raw?.error?.message||'Page indexing provider failed'},{status:upstream.status});
    const parsed=JSON.parse(outputText(raw));
    const names:string[]=dateOnly?[]:[...new Set<string>((parsed.names??[]).map((item:{reading?:unknown})=>String(item.reading??'').trim()).filter(Boolean))].slice(0,500);
    const terms:string[]=dateOnly?[]:[...new Set<string>((parsed.terms??[]).map((item:unknown)=>String(item).trim()).filter(Boolean))].slice(0,500);
    const yearFrom=dateOnly&&parsed.page_type!=='register'?null:parsed.year_from,yearTo=dateOnly&&parsed.page_type!=='register'?null:parsed.year_to;
    const targets=[...new Set((Array.isArray(page.target_names)?page.target_names:[]).flatMap((value:unknown)=>[String(value),...String(value).split(/\s+/)]).map(normalizedName).filter((value:string)=>value.length>=3))];
    const candidateMatches=dateOnly?[]:names.flatMap((reading:string)=>{
      const normalized=normalizedName(reading);if(normalized.length<3)return[];
      let best:{target:string;distance:number}|null=null;
      for(const target of targets){const distance=editDistance(normalized,target);if(!best||distance<best.distance)best={target,distance};}
      const threshold=normalized.length<=5?1:Math.max(1,Math.floor(normalized.length*.25));
      return best&&best.distance<=threshold?[{reading,target:best.target,distance:best.distance}]:[];
    });
    const needsDeepTranscription=dateOnly?Boolean(parsed.page_type==='register'&&parsed.needs_deep_transcription):Boolean(parsed.needs_deep_transcription||candidateMatches.length);
    const searchText=[page.archive_label,parsed.page_type,...parsed.year_texts,names.join(' '),terms.join(' ')].filter(Boolean).join(' ');
    const runs=await sql`INSERT INTO genealogy_page_index_runs(page_id,engine,engine_version,prompt_version,status,page_type,year_from,year_to,names,terms,confidence,source_asset_sha256,metadata)
      VALUES (${pageId},'openai-responses',${MODEL},${promptVersion},'complete',${parsed.page_type},${yearFrom}::integer,${yearTo}::integer,${names},${terms},${parsed.confidence},${sourceDigest},
        ${JSON.stringify({index_mode:mode,language:parsed.language,year_texts:parsed.year_texts,record_count_estimate:parsed.record_count_estimate,handwriting_signature:parsed.handwriting_signature,needs_deep_transcription:needsDeepTranscription,candidate_matches:candidateMatches,transient_image:transient,name_readings:dateOnly?[]:parsed.names})}::jsonb)
      ON CONFLICT(page_id,prompt_version,source_asset_sha256) DO UPDATE SET engine=EXCLUDED.engine,engine_version=EXCLUDED.engine_version,
        status=EXCLUDED.status,page_type=EXCLUDED.page_type,year_from=EXCLUDED.year_from,year_to=EXCLUDED.year_to,names=EXCLUDED.names,
        terms=EXCLUDED.terms,confidence=EXCLUDED.confidence,metadata=EXCLUDED.metadata,created_at=NOW() RETURNING id,created_at`;
    if(!dateOnly)await sql`UPDATE genealogy_page_index_runs SET status='needs_review',metadata=metadata||${JSON.stringify({superseded_by:PROMPT_VERSION,reason:'Target-aware skim is not independent evidence.'})}::jsonb
      WHERE page_id=${pageId} AND prompt_version<>${PROMPT_VERSION} AND prompt_version NOT LIKE 'blind-page-date-layout-%' AND status='complete'`;
    const indexStatus=dateOnly?(parsed.page_type!=='register'?'non_register':yearFrom?'date_indexed':'date_uncertain'):(needsDeepTranscription?'candidate':'skimmed');
    await sql`UPDATE genealogy_pages SET index_status=${indexStatus},index_year_from=${yearFrom}::integer,index_year_to=${yearTo}::integer,index_names=${names},index_terms=${terms},
      index_confidence=${parsed.confidence},search_text=${searchText},indexed_at=NOW(),updated_at=NOW() WHERE id=${pageId}`;
    return NextResponse.json({ok:true,pageId,model:MODEL,promptVersion,indexRun:runs[0],index:{...parsed,year_from:yearFrom,year_to:yearTo,names:dateOnly?[]:parsed.names,terms,needs_deep_transcription:needsDeepTranscription,candidate_matches:candidateMatches},transientImageDiscarded:transient});
  } catch(error:unknown) {
    const message=error instanceof Error?error.message:String(error);
    return NextResponse.json({ok:false,error:message},{status:500});
  }
}


export async function OPTIONS(request:NextRequest){
  if(!captureLocal(request,process.env) || !captureRequestAllowed(request))return NextResponse.json({ok:false,error:'Capture preflight is not authorized.'},{status:403});
  return withCaptureCors(new NextResponse(null,{status:204}),request);
}
export async function POST(request:NextRequest){
  if(!captureLocal(request,process.env))return NextResponse.json({ok:false,error:'This operation is local-only.'},{status:403});
  const origin=request.headers.get('origin');
  if(origin?.startsWith('chrome-extension:') && (!captureOrigin(request) || !captureRequestAllowed(request)))return NextResponse.json({ok:false,error:'Capture request is not authorized.'},{status:403});
  if(!captureOrigin(request) && !sameOriginLocalRequest(request))return NextResponse.json({ok:false,error:'Same-origin Mastermind request required.'},{status:403});
  return withCaptureCors(await postCapture(request),request);
}
