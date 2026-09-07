import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

import { getMemoryDb } from '@/lib/db';
import { readArchiveImage } from '@/lib/genealogy/archive-store.mjs';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const MODEL=process.env.GENEALOGY_NAME_MODEL||'gpt-5.4';
const PROMPT_VERSION='blind-paleographic-name-spotter-v1';
const PREPROCESS_VERSION='two-leaf-six-tile-contrast-v1';
const LOCAL_HOSTS=new Set(['127.0.0.1','localhost']);

async function gate():Promise<NextResponse|null>{if(!ownerGateConfigured())return null;const result=await requireOwner();return result.ok?null:NextResponse.json({ok:false,error:result.reason},{status:result.status});}
function outputText(response:unknown):string{if(!response||typeof response!=='object')throw new Error('Invalid name-calibration provider response');const raw=response as {output_text?:unknown;output?:unknown};if(typeof raw.output_text==='string')return raw.output_text;if(Array.isArray(raw.output))for(const item of raw.output){const content=item&&typeof item==='object'?(item as {content?:unknown}).content:null;if(Array.isArray(content))for(const part of content){const candidate=part as {type?:unknown;text?:unknown};if((candidate.type==='output_text'||candidate.type==='text')&&typeof candidate.text==='string')return candidate.text;}}throw new Error('Name-calibration provider returned no output text');}
function normalizedName(value:unknown){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function textOrNull(value:unknown,max=1000){const text=String(value??'').trim().slice(0,max);return text||null;}

const nullableString={type:['string','null']} as const;
const responseFormat={type:'json_schema',name:'paleographic_name_readings',strict:true,schema:{type:'object',additionalProperties:false,
  required:['page_type','language','handwriting_summary','page_confidence','readings'],properties:{
    page_type:{type:'string',enum:['register','index','title','film_marker','blank','other']},language:{type:'string'},handwriting_summary:{type:'string'},page_confidence:{type:'number',minimum:0,maximum:1},
    readings:{type:'array',items:{type:'object',additionalProperties:false,required:['tile_id','line_order','role_hint','reading_type','name_raw','alternatives','context_excerpt','letter_evidence','confidence','bbox'],properties:{
      tile_id:{type:'string'},line_order:{type:'integer'},role_hint:{type:'string'},reading_type:{type:'string',enum:['given','surname','full','place','unknown']},name_raw:{type:'string'},
      alternatives:{type:'array',items:{type:'object',additionalProperties:false,required:['text','confidence'],properties:{text:{type:'string'},confidence:{type:'number',minimum:0,maximum:1}}}},
      context_excerpt:nullableString,letter_evidence:{type:'string'},confidence:{type:'number',minimum:0,maximum:1},bbox:{type:'object',additionalProperties:false,required:['x','y','width','height'],properties:{x:{type:'integer',minimum:0,maximum:1000},y:{type:'integer',minimum:0,maximum:1000},width:{type:'integer',minimum:0,maximum:1000},height:{type:'integer',minimum:0,maximum:1000}}},
    }}},
  }}} as const;

async function visionContent(bytes:Buffer,mediaType:string){
  const metadata=await sharp(bytes).metadata(),width=metadata.width??0,height=metadata.height??0;if(width<800||height<800)throw new Error('Stored page image is too small for handwriting calibration.');
  const overview={type:'input_image',image_url:`data:${mediaType};base64,${bytes.toString('base64')}`,detail:'low'};
  const content:Array<Record<string,unknown>>=[{type:'input_text',text:`Act as a conservative paleographic name spotter for a damaged early-modern French parish register. This is a blind visual pass: you are not given target families, expected names, dates, or a dictionary. Use the overview only for layout, then inspect six enhanced tiles closely. Return each distinct visibly supported occurrence of a personal name or place name. A partial name is useful when its visible letters are preserved exactly. Never complete a name from a common baptism formula or from what would be historically likely. Exclude formula words such as fils, fille, baptisé, parrain, marraine, mois, jour, and clerical titles unless they are included only in context_excerpt. role_hint may use surrounding grammar, but name_raw must come from visible letterforms. Give up to three plausible alternatives when a letter is ambiguous, explain the distinguishing letter evidence, and keep confidence below 0.70 for uncertain readings. bbox coordinates are normalized 0–1000 within the named tile. Deduplicate occurrences repeated in overlapping tile edges.`},overview];
  const columns=2,rows=3,overlapX=Math.round(width*.025),overlapY=Math.round(height*.035),cellWidth=Math.ceil(width/columns),cellHeight=Math.ceil(height/rows);
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const left=Math.max(0,column*cellWidth-(column?overlapX:0)),top=Math.max(0,row*cellHeight-(row?overlapY:0)),right=Math.min(width,(column+1)*cellWidth+(column<columns-1?overlapX:0)),bottom=Math.min(height,(row+1)*cellHeight+(row<rows-1?overlapY:0)),tileId=`${column===0?'left':'right'}-${row+1}`;
    const enhanced=await sharp(bytes).extract({left,top,width:right-left,height:bottom-top}).grayscale().normalize({lower:1,upper:99}).sharpen({sigma:1.1,m1:1.2,m2:.7,x1:2,y2:10,y3:20}).jpeg({quality:95,mozjpeg:true}).toBuffer();
    content.push({type:'input_text',text:`Tile ${tileId}; ${column===0?'left':'right'} leaf, vertical section ${row+1} of ${rows}.`},{type:'input_image',image_url:`data:image/jpeg;base64,${enhanced.toString('base64')}`,detail:'high'});
  }
  return{content,tileCount:columns*rows,width,height};
}

export async function POST(request:NextRequest){
  if(process.env.VERCEL||!LOCAL_HOSTS.has(request.nextUrl.hostname))return NextResponse.json({ok:false,error:'Name calibration is local-only.'},{status:403});
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({ok:false,error:'OPENAI_API_KEY is not configured'},{status:503});
  const denied=await gate();if(denied)return denied;
  try{
    const body=await request.json(),pageId=Number(body.pageId),force=body.force===true;if(!Number.isSafeInteger(pageId)||pageId<1)return NextResponse.json({ok:false,error:'pageId is required'},{status:400});
    const sql=getMemoryDb(),pages=await sql`SELECT p.id,p.page_number,p.source_url,p.sha256,a.media_type,a.storage_key,j.archive,j.register_id FROM genealogy_pages p JOIN genealogy_crawl_jobs j ON j.id=p.job_id LEFT JOIN genealogy_archive_assets a ON a.sha256=p.sha256 WHERE p.id=${pageId} LIMIT 1`;
    const page=pages[0];if(!page)return NextResponse.json({ok:false,error:'Genealogy page not found'},{status:404});if(!page.storage_key||!page.sha256)return NextResponse.json({ok:false,error:'This page has no stored original.'},{status:409});
    if(!force){const cachedRuns=await sql`SELECT id,status,mean_confidence,metadata,created_at FROM genealogy_name_calibration_runs WHERE page_id=${pageId} AND prompt_version=${PROMPT_VERSION} AND preprocess_version=${PREPROCESS_VERSION} AND source_asset_sha256=${page.sha256} LIMIT 1`;const cached=cachedRuns[0];if(cached){const readings=await sql`SELECT reading_index,tile_id,line_order,role_hint,reading_type,name_raw,alternatives,context_excerpt,letter_evidence,confidence,bbox_x,bbox_y,bbox_width,bbox_height,review_status FROM genealogy_name_readings WHERE calibration_run_id=${cached.id} ORDER BY reading_index`;return NextResponse.json({ok:true,cached:true,pageId,pageNumber:page.page_number,model:MODEL,promptVersion:PROMPT_VERSION,preprocessVersion:PREPROCESS_VERSION,run:cached,readings});}}
    const bytes=await readArchiveImage(page.storage_key),mediaType=String(page.media_type||'image/jpeg'),vision=await visionContent(bytes,mediaType);
    const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,input:[{role:'user',content:vision.content}],text:{format:responseFormat}})});
    const raw=await upstream.json();if(!upstream.ok)return NextResponse.json({ok:false,error:raw?.error?.message||'Name-calibration provider failed',model:MODEL},{status:upstream.status});
    const parsed=JSON.parse(outputText(raw)),accepted=(parsed.readings??[]).filter((reading:Record<string,unknown>)=>{const name=String(reading.name_raw??'').trim();return name.length>=2&&!/^\[.*\]$/.test(name)&&normalizedName(name).length>=2;});
    const mean=accepted.length?accepted.reduce((sum:number,reading:Record<string,unknown>)=>sum+Number(reading.confidence||0),0)/accepted.length:0,status=accepted.length?'complete':'needs_review';
    const runRows=await sql`INSERT INTO genealogy_name_calibration_runs(page_id,engine,engine_version,prompt_version,preprocess_version,status,source_asset_sha256,tile_count,mean_confidence,metadata) VALUES(${pageId},'openai-responses',${MODEL},${PROMPT_VERSION},${PREPROCESS_VERSION},${status},${page.sha256},${vision.tileCount},${mean},${JSON.stringify({page_type:parsed.page_type,language:parsed.language,handwriting_summary:parsed.handwriting_summary,page_confidence:parsed.page_confidence,width:vision.width,height:vision.height,reading_count:accepted.length})}::jsonb) ON CONFLICT(page_id,prompt_version,preprocess_version,source_asset_sha256) DO UPDATE SET engine=EXCLUDED.engine,engine_version=EXCLUDED.engine_version,status=EXCLUDED.status,tile_count=EXCLUDED.tile_count,mean_confidence=EXCLUDED.mean_confidence,metadata=EXCLUDED.metadata,created_at=NOW() RETURNING id,status,mean_confidence,metadata,created_at`;
    const run=runRows[0];await sql`DELETE FROM genealogy_name_readings WHERE calibration_run_id=${run.id}`;
    for(let index=0;index<accepted.length;index++){const reading=accepted[index] as Record<string,unknown>,bbox=(reading.bbox??{}) as Record<string,unknown>;await sql`INSERT INTO genealogy_name_readings(calibration_run_id,page_id,reading_index,tile_id,line_order,role_hint,reading_type,name_raw,normalized_name,alternatives,context_excerpt,letter_evidence,confidence,bbox_x,bbox_y,bbox_width,bbox_height,metadata) VALUES(${run.id},${pageId},${index},${String(reading.tile_id??'unknown').slice(0,100)},${Number(reading.line_order)||0},${String(reading.role_hint??'unknown').slice(0,100)},${String(reading.reading_type??'unknown').slice(0,20)},${String(reading.name_raw).trim().slice(0,500)},${normalizedName(reading.name_raw)},${JSON.stringify(reading.alternatives??[])}::jsonb,${textOrNull(reading.context_excerpt)},${textOrNull(reading.letter_evidence)},${Number(reading.confidence)||0},${Number(bbox.x)||0},${Number(bbox.y)||0},${Number(bbox.width)||0},${Number(bbox.height)||0},${JSON.stringify({source_url:page.source_url})}::jsonb)`;}
    const readings=await sql`SELECT reading_index,tile_id,line_order,role_hint,reading_type,name_raw,alternatives,context_excerpt,letter_evidence,confidence,bbox_x,bbox_y,bbox_width,bbox_height,review_status FROM genealogy_name_readings WHERE calibration_run_id=${run.id} ORDER BY reading_index`;
    return NextResponse.json({ok:true,cached:false,pageId,pageNumber:page.page_number,model:MODEL,promptVersion:PROMPT_VERSION,preprocessVersion:PREPROCESS_VERSION,run,readings});
  }catch(error:unknown){const message=error instanceof Error?error.message:String(error);return NextResponse.json({ok:false,error:message},{status:500});}
}
