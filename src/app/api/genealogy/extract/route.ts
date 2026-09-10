import { authenticateCaptureClient as captureClient } from '@/lib/genealogy/capture-access';
import { captureLocal, sameOriginLocalRequest, captureOrigin, captureRequestAllowed, withCaptureCors } from '@/lib/genealogy/capture-policy.mjs';
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

import { getMemoryDb } from '@/lib/db';
import { archiveStoreContract, readArchiveImage } from '@/lib/genealogy/archive-store.mjs';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const MODEL=process.env.GENEALOGY_EXTRACTION_MODEL||'gpt-5.4';
const SEGMENTATION_MODEL=process.env.GENEALOGY_SEGMENTATION_MODEL||MODEL;
const PROMPT_VERSION='segmented-formula-surname-records-v9';
const LOCAL_HOSTS=new Set(['127.0.0.1','localhost']);

function outputText(response:unknown):string{
  if(!response||typeof response!=='object')throw new Error('Invalid extraction provider response');
  const raw=response as {output_text?:unknown;output?:unknown};if(typeof raw.output_text==='string')return raw.output_text;
  if(Array.isArray(raw.output))for(const item of raw.output){const content=item&&typeof item==='object'?(item as {content?:unknown}).content:null;if(Array.isArray(content))for(const part of content){const candidate=part as {type?:unknown;text?:unknown};if((candidate.type==='output_text'||candidate.type==='text')&&typeof candidate.text==='string')return candidate.text;}}
  throw new Error('Extraction provider returned no output text');
}

async function ownerGate():Promise<NextResponse|null>{if(!ownerGateConfigured())return null;const result=await requireOwner();return result.ok?null:NextResponse.json({ok:false,error:result.reason},{status:result.status});}


function genuineImage(bytes:Buffer,declared:string):string|null{if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&['image/jpeg','image/jpg'].includes(declared))return'image/jpeg';if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&declared==='image/png')return'image/png';return null;}
function normalizedName(value:unknown):string{return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function wildcardName(value:unknown):string{return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9?]+/g,'');}
function patternSupportsName(patternValue:unknown,nameValue:unknown):boolean{
  const pattern=wildcardName(patternValue),name=wildcardName(nameValue).replace(/\?/g,'');if(!pattern||!name)return false;
  if(!pattern.includes('?'))return pattern===name;
  const fixedLetters=pattern.replace(/\?/g,'');if(fixedLetters.length<3)return false;
  const startsFixed=!pattern.startsWith('?'),endsFixed=!pattern.endsWith('?'),chunks=pattern.split(/\?+/).filter(Boolean),gaps=pattern.match(/\?+/g)??[];
  let expression=startsFixed?'^':'^[a-z0-9]{0,4}';for(let index=0;index<chunks.length;index++){expression+=chunks[index];if(index<chunks.length-1){const uncertainty=Math.min(7,(gaps[index]?.length??1)*3);expression+=`[a-z0-9]{0,${uncertainty}}`;}}
  expression+=endsFixed?'$':'[a-z0-9]{0,4}$';return new RegExp(expression).test(name);
}
function nullableText(value:unknown,max=500):string|null{const text=String(value??'').trim().slice(0,max);return text||null;}
function safeRelationIndex(value:unknown,expectedName:unknown,people:Array<Record<string,unknown>>):number|null{
  const index=Number(value);if(!Number.isInteger(index)||index<0||index>=people.length)return null;
  const expected=normalizedName(expectedName),actual=normalizedName(people[index]?.reconstructed_name??people[index]?.name_raw);
  if(expected&&actual&&!expected.includes(actual)&&!actual.includes(expected))return null;
  return index;
}

async function visionContent(bytes:Buffer,mediaType:string,prompt:string){
  const overview={type:'input_image',image_url:`data:${mediaType};base64,${bytes.toString('base64')}`,detail:'low'};
  const metadata=await sharp(bytes).metadata(),width=metadata.width??0,height=metadata.height??0;
  if(width<400||height<800)return[{type:'input_text',text:prompt},overview];
  const columns=2,rows=3,overlapX=Math.max(24,Math.round(width*.02)),overlapY=Math.max(24,Math.round(height*.025)),baseWidth=Math.ceil(width/columns),baseHeight=Math.ceil(height/rows),content:Array<Record<string,unknown>>=[{type:'input_text',text:`${prompt} First use the full-page overview for layout, then read the six overlapping grid tiles closely. The source may be a two-page spread. Deduplicate entries repeated in tile overlaps and preserve their top-to-bottom order within the left page, then the right page.`},overview];
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const nominalLeft=column*baseWidth,nominalTop=row*baseHeight,left=Math.max(0,nominalLeft-(column?overlapX:0)),top=Math.max(0,nominalTop-(row?overlapY:0)),right=Math.min(width,(column+1)*baseWidth+(column<columns-1?overlapX:0)),bottom=Math.min(height,(row+1)*baseHeight+(row<rows-1?overlapY:0));
    const tile=await sharp(bytes).extract({left,top,width:right-left,height:bottom-top}).jpeg({quality:94,mozjpeg:true}).toBuffer();
    content.push({type:'input_text',text:`Grid tile row ${row+1}/${rows}, column ${column+1}/${columns}: pixels x=${left}–${right}, y=${top}–${bottom} of ${width}×${height}.`},{type:'input_image',image_url:`data:image/jpeg;base64,${tile.toString('base64')}`,detail:'high'});
  }
  return content;
}

async function recordVisionContent(bytes:Buffer,mediaType:string,prompt:string,boundaries:Array<Record<string,unknown>>){
  const metadata=await sharp(bytes).metadata(),width=metadata.width??0,height=metadata.height??0;
  const content:Array<Record<string,unknown>>=[{type:'input_text',text:prompt},{type:'input_image',image_url:`data:${mediaType};base64,${bytes.toString('base64')}`,detail:'low'}];
  const columnCount=Math.max(1,...boundaries.map((boundary)=>Number(boundary.column_index)+1).filter(Number.isFinite));
  for(const boundary of boundaries.slice(0,60)){
    const bbox=(boundary.bbox??{}) as Record<string,unknown>,padX=Math.max(16,Math.round(width*.012)),padY=Math.max(24,Math.round(height*.035));
    const rawLeft=Math.round(Number(bbox.x||0)*width/1000),rawTop=Math.round(Number(bbox.y||0)*height/1000),rawWidth=Math.max(1,Math.round(Number(bbox.width||1)*width/1000)),rawHeight=Math.max(1,Math.round(Number(bbox.height||1)*height/1000));
    const columnIndex=Math.max(0,Math.min(columnCount-1,Number(boundary.column_index)||0)),columnLeft=Math.round(columnIndex*width/columnCount),columnRight=Math.round((columnIndex+1)*width/columnCount);
    const left=Math.max(0,Math.min(rawLeft-padX,columnLeft-padX)),top=Math.max(0,rawTop-padY),right=Math.min(width,Math.max(rawLeft+rawWidth+padX,columnRight+padX)),bottom=Math.min(height,rawTop+rawHeight+padY);
    if(right-left<20||bottom-top<20)continue;
    const extracted=sharp(bytes).extract({left,top,width:right-left,height:bottom-top}),rawPanel=await extracted.clone().grayscale().jpeg({quality:94,mozjpeg:true}).toBuffer(),enhancedPanel=await extracted.clone().grayscale().normalize({lower:1,upper:99}).sharpen({sigma:1,m1:1.1,m2:.6,x1:2,y2:10,y3:20}).jpeg({quality:95,mozjpeg:true}).toBuffer();
    const joined=await sharp({create:{width:(right-left)*2,height:bottom-top,channels:3,background:'#ffffff'}}).composite([{input:rawPanel,left:0,top:0},{input:enhancedPanel,left:right-left,top:0}]).jpeg({quality:94,mozjpeg:true}).toBuffer();
    content.push({type:'input_text',text:`Record segment ${Number(boundary.entry_order)+1}; column ${Number(boundary.column_index)+1}; proposed type ${String(boundary.event_type)}; anchor ${String(boundary.anchor_text??'')}; authoritative full-page bbox ${JSON.stringify(boundary.bbox)}. The image below contains the same generous full-column crop twice: untouched grayscale on the left and contrast-normalized/sharpened on the right. Use both; nearby text outside the authoritative vertical boundary is context only and must not become another row.`},{type:'input_image',image_url:`data:image/jpeg;base64,${joined.toString('base64')}`,detail:'high'});
  }
  return content;
}

async function structuredResponse(model:string,content:Array<Record<string,unknown>>,format:Record<string,unknown>){
  const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:[{role:'user',content}],text:{format}})});
  const raw=await upstream.json();
  if(!upstream.ok)throw new Error(raw?.error?.message||`Extraction provider failed with HTTP ${upstream.status}`);
  return JSON.parse(outputText(raw));
}

const nullableString={type:['string','null']} as const,nullableInteger={type:['integer','null']} as const;
const confidenceSchema={type:'number',minimum:0,maximum:1} as const;
const bboxSchema={type:'object',additionalProperties:false,required:['x','y','width','height'],properties:{x:{type:'integer',minimum:0,maximum:1000},y:{type:'integer',minimum:0,maximum:1000},width:{type:'integer',minimum:1,maximum:1000},height:{type:'integer',minimum:1,maximum:1000}}} as const;
const eventTypeSchema={type:'string',enum:['baptism','marriage','burial','birth','death','annotation','unknown']} as const;
const formulaSchema={type:'object',additionalProperties:false,required:['formula_kind','text_raw','normalized_pattern','inferred_meaning','visual_confidence','contextual_confidence','bbox'],properties:{formula_kind:{type:'string',enum:['record_opening','baptism','marriage','burial','date_phrase','kinship','godparent','witness','residence','officiant_signature','section_heading','other']},text_raw:{type:'string'},normalized_pattern:{type:'string'},inferred_meaning:nullableString,visual_confidence:confidenceSchema,contextual_confidence:confidenceSchema,bbox:bboxSchema}} as const;
const structureSchema={type:'object',additionalProperties:false,required:['layout','section_type','reading_order','expected_record_count','segmentation_confidence','chronology_summary'],properties:{layout:{type:'string',enum:['single_page','two_leaf','columns','mixed','unknown']},section_type:{type:'string',enum:['baptism','marriage','burial','mixed','index','non_register','unknown']},reading_order:{type:'string'},expected_record_count:{type:'integer',minimum:0,maximum:200},segmentation_confidence:confidenceSchema,chronology_summary:{type:'string'}}} as const;
const boundarySchema={type:'object',additionalProperties:false,required:['entry_order','column_index','event_type','anchor_text','boundary_confidence','bbox'],properties:{entry_order:{type:'integer',minimum:0,maximum:10000},column_index:{type:'integer',minimum:0,maximum:20},event_type:eventTypeSchema,anchor_text:{type:'string'},boundary_confidence:confidenceSchema,bbox:bboxSchema}} as const;
const personSchema={type:'object',additionalProperties:false,required:['role','name_raw','name_pattern','reconstructed_name','reconstruction_basis','given_names','surname','surname_raw','surname_pattern','reconstructed_surname','surname_reconstruction_basis','surname_visual_confidence','surname_contextual_confidence','surname_state','gender','residence','occupation','visual_confidence','contextual_confidence'],properties:{role:{type:'string'},name_raw:{type:'string'},name_pattern:{type:'string'},reconstructed_name:nullableString,reconstruction_basis:nullableString,given_names:nullableString,surname:nullableString,surname_raw:nullableString,surname_pattern:nullableString,reconstructed_surname:nullableString,surname_reconstruction_basis:nullableString,surname_visual_confidence:confidenceSchema,surname_contextual_confidence:confidenceSchema,surname_state:{type:'string',enum:['visible','partial','reconstructed','absent','unknown']},gender:nullableString,residence:nullableString,occupation:nullableString,visual_confidence:confidenceSchema,contextual_confidence:confidenceSchema}} as const;
const relationshipSchema={type:'object',additionalProperties:false,required:['relationship_type','from_person_index','to_person_index','from_name','to_name','confidence'],properties:{relationship_type:{type:'string'},from_person_index:nullableInteger,to_person_index:nullableInteger,from_name:nullableString,to_name:nullableString,confidence:confidenceSchema}} as const;
const recordSchema={type:'object',additionalProperties:false,required:['entry_order','column_index','event_type','event_date_text','event_year','date_visual_text','date_source','date_inferred','location_text','subject_text','formula_template','people','relationships','excerpt','visual_confidence','contextual_confidence','boundary_confidence','bbox'],properties:{entry_order:{type:'integer',minimum:0,maximum:10000},column_index:{type:'integer',minimum:0,maximum:20},event_type:eventTypeSchema,event_date_text:{type:'string'},event_year:nullableInteger,date_visual_text:nullableString,date_source:{type:'string',enum:['explicit','page_heading','previous_record','next_record','adjacent_page','section_marker','unknown']},date_inferred:{type:'boolean'},location_text:nullableString,subject_text:nullableString,formula_template:nullableString,excerpt:{type:'string'},visual_confidence:confidenceSchema,contextual_confidence:confidenceSchema,boundary_confidence:confidenceSchema,people:{type:'array',items:personSchema},relationships:{type:'array',items:relationshipSchema},bbox:bboxSchema}} as const;
const segmentationFormat={type:'json_schema',name:'parish_page_segmentation',strict:true,schema:{type:'object',additionalProperties:false,required:['page_type','language','visible_years','visual_confidence','contextual_confidence','page_structure','formula_patterns','record_boundaries'],properties:{page_type:{type:'string',enum:['register','index','title','film_marker','blank','other']},language:{type:'string'},visible_years:{type:'array',items:{type:'integer'}},visual_confidence:confidenceSchema,contextual_confidence:confidenceSchema,page_structure:structureSchema,formula_patterns:{type:'array',items:formulaSchema},record_boundaries:{type:'array',items:boundarySchema}}}} as const;
const recordsFormat={type:'json_schema',name:'segmented_parish_record_rows',strict:true,schema:{type:'object',additionalProperties:false,required:['records'],properties:{records:{type:'array',items:recordSchema}}}} as const;

async function postCapture(request:NextRequest){
  if(process.env.VERCEL||!LOCAL_HOSTS.has(request.nextUrl.hostname))return NextResponse.json({ok:false,error:'Record extraction is local-only.'},{status:403});
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({ok:false,error:'OPENAI_API_KEY is not configured'},{status:503});
  try{
    const contentType=request.headers.get('content-type')??'';let sql=getMemoryDb(),pageId=0,bytes=Buffer.alloc(0),mediaType='',transient=false,sourceDigest:string|null=null,force=false;
    if(contentType.includes('multipart/form-data')){
      const authenticated=await captureClient(request);if(!authenticated)return NextResponse.json({ok:false,error:'Approved archive extension required.'},{status:401});sql=authenticated.sql;
      const form=await request.formData(),image=form.get('image'),metadata=JSON.parse(String(form.get('metadata')??'{}'));
      if(!(image instanceof File)||image.size<12||image.size>archiveStoreContract.maxImageBytes)return NextResponse.json({ok:false,error:'A bounded JPEG or PNG is required.'},{status:400});
      const jobId=Number(metadata.jobId),pageNumber=Number(metadata.pageNumber),sourceUrl=String(metadata.sourceUrl??'');force=metadata.force===true;
      const pages=await sql`SELECT id FROM genealogy_pages WHERE job_id=${jobId} AND (page_number=${pageNumber} OR source_url=${sourceUrl}) ORDER BY CASE WHEN source_url=${sourceUrl} THEN 0 ELSE 1 END LIMIT 1`;
      if(!pages[0])return NextResponse.json({ok:false,error:'Index the manifest before extracting page records.'},{status:409});
      pageId=Number(pages[0].id);bytes=Buffer.from(await image.arrayBuffer());mediaType=genuineImage(bytes,image.type)??'';transient=true;sourceDigest=crypto.createHash('sha256').update(bytes).digest('hex');
    }else{
      const denied=await ownerGate();if(denied)return denied;const body=await request.json();pageId=Number(body.pageId);force=body.force===true;if(!pageId)return NextResponse.json({ok:false,error:'pageId is required'},{status:400});
      const pages=await sql`SELECT p.sha256,a.media_type,a.storage_key FROM genealogy_pages p LEFT JOIN genealogy_archive_assets a ON a.sha256=p.sha256 WHERE p.id=${pageId} LIMIT 1`;
      if(!pages[0]?.storage_key)return NextResponse.json({ok:false,error:'This page has no stored image; use the overnight browser worker.'},{status:409});
      bytes=await readArchiveImage(pages[0].storage_key);mediaType=String(pages[0].media_type);sourceDigest=String(pages[0].sha256);
    }
    if(!mediaType)return NextResponse.json({ok:false,error:'The submitted bytes are not a genuine JPEG or PNG.'},{status:400});
    const pageRows=await sql`SELECT p.id,p.page_number,p.archive_label,p.source_url,p.job_id,j.archive,j.register_id FROM genealogy_pages p JOIN genealogy_crawl_jobs j ON j.id=p.job_id WHERE p.id=${pageId} LIMIT 1`;
    const page=pageRows[0];if(!page)return NextResponse.json({ok:false,error:'Genealogy page not found'},{status:404});
    if(!force){
      const cachedRows=await sql`SELECT er.id,er.created_at,er.mean_confidence,er.visible_years,er.page_type,er.status,er.metadata,
          (SELECT count(*)::int FROM genealogy_records r WHERE r.extraction_run_id=er.id) AS records,
          (SELECT count(*)::int FROM genealogy_record_people person JOIN genealogy_records r ON r.id=person.record_id WHERE r.extraction_run_id=er.id) AS people,
          (SELECT count(*)::int FROM genealogy_record_relationships relation JOIN genealogy_records r ON r.id=relation.record_id WHERE r.extraction_run_id=er.id) AS relationships,
          EXISTS(SELECT 1 FROM genealogy_record_people person JOIN genealogy_records r ON r.id=person.record_id WHERE r.extraction_run_id=er.id AND person.name_raw !~* '\\[(illegible|unnamed)' AND char_length(person.normalized_name)>=3) AS has_legible_name
        FROM genealogy_record_extraction_runs er WHERE er.page_id=${pageId} AND er.prompt_version=${PROMPT_VERSION} AND er.source_asset_sha256=${sourceDigest} LIMIT 1`;
      const cached=cachedRows[0],cachedNonRegister=cached&&String(cached.page_type)!=='register';if(cached&&(Number(cached.records)>0||cachedNonRegister)){
        const cachedStatus=cachedNonRegister?'complete':Number(cached.mean_confidence)>=.65&&cached.has_legible_name===true?'complete':'needs_review';await sql`UPDATE genealogy_record_extraction_runs SET status=${cachedStatus},metadata=metadata||${JSON.stringify({has_legible_name:cached.has_legible_name===true})}::jsonb WHERE id=${cached.id}`;
        return NextResponse.json({ok:true,pageId,model:MODEL,promptVersion:PROMPT_VERSION,run:{id:cached.id,created_at:cached.created_at},summary:{records:Number(cached.records),people:Number(cached.people),relationships:Number(cached.relationships),visibleYears:cached.visible_years??[],confidence:cached.mean_confidence,status:cachedStatus,hasLegibleName:cached.has_legible_name===true},cached:true,transientImageDiscarded:transient,retrievalUrl:page.source_url});
      }
    }
    const [lexiconRows,pageReadingRows,previousRecordRows,formulaRows]=await Promise.all([
      sql`SELECT canonical_reading,variants,support_count,confidence,metadata->>'page_support' page_support,metadata->'reading_types' reading_types FROM genealogy_name_lexicon WHERE archive=${page.archive} AND register_id=${page.register_id} AND COALESCE((metadata->>'active')::boolean,false) ORDER BY COALESCE((metadata->>'page_support')::int,0) DESC,support_count DESC LIMIT 250`,
      sql`SELECT reading.name_raw,reading.alternatives,reading.reading_type,reading.confidence FROM genealogy_name_readings reading WHERE reading.page_id=${pageId} AND reading.review_status<>'rejected' ORDER BY reading.confidence DESC LIMIT 200`,
      sql`SELECT previous_page.page_number,record.event_type,record.event_date_text,record.event_year,record.date_source,record.date_inferred FROM genealogy_records record JOIN genealogy_pages previous_page ON previous_page.id=record.page_id WHERE previous_page.job_id=${page.job_id} AND previous_page.page_number<${page.page_number} ORDER BY previous_page.page_number DESC,record.record_index DESC LIMIT 12`,
      sql`SELECT observation.formula_kind,observation.normalized_pattern,(array_agg(observation.inferred_meaning ORDER BY observation.contextual_confidence DESC))[1] inferred_meaning,count(*)::int support,max(observation.contextual_confidence) confidence FROM genealogy_record_formula_observations observation JOIN genealogy_pages formula_page ON formula_page.id=observation.page_id WHERE formula_page.job_id=${page.job_id} GROUP BY observation.formula_kind,observation.normalized_pattern ORDER BY count(*) DESC,max(observation.contextual_confidence) DESC LIMIT 80`,
    ]);
    const contextualReference={
      archive_name_forms:lexiconRows.map((row)=>({name:row.canonical_reading,variants:row.variants,support:Number(row.support_count),pages:Number(row.page_support||0),confidence:Number(row.confidence)})),
      current_page_blind_readings:pageReadingRows,
      preceding_record_chronology:previousRecordRows,
      learned_procedural_formulas:formulaRows,
    };
    const segmentationPrompt=`Segment this historical parish-register image before attempting transcription. Identify every visually separate event block across both leaves or columns, including damaged blocks. Use recurring date phrases, baptism/marriage/burial formulas, indentation, blank spacing, capital openings, and priest signatures as boundary anchors. Do not merge neighboring entries because their text is faint. If a title slip, cover, target, annotation, or blank leaf shares the image with even one historical register entry, classify the image as register and segment every visible event on the manuscript portion; never discard one leaf merely because the other leaf is non-register material. bbox coordinates must be normalized 0-1000 against the full image. record_boundaries must be in reading order and expected_record_count must equal record_boundaries.length. Formula words and recurring signatures belong in formula_patterns, not in personal-name fields. Use chronology only to describe the page; do not invent boundaries from an expected count.

Read-only prior context for chronology and known procedural forms:
${JSON.stringify({preceding_record_chronology:previousRecordRows,learned_procedural_formulas:formulaRows})}`;
    const segmentationContent=await visionContent(bytes,mediaType,segmentationPrompt);
    let segmentation=await structuredResponse(SEGMENTATION_MODEL,segmentationContent,segmentationFormat as unknown as Record<string,unknown>),boundaries=(segmentation.record_boundaries??[]) as Array<Record<string,unknown>>;
    const chronologyText=String(segmentation.page_structure?.chronology_summary??''),registerSignal=pageReadingRows.length>=5&&/(bapti|marria|burial|sépultur|entry|entries|register|acte)/i.test(chronologyText);
    if(!boundaries.length&&registerSignal){const retryPrompt=`${segmentationPrompt}\n\nBOUNDARY RECOVERY: the first layout pass described historical register entries and the independent blind pass found ${pageReadingRows.length} name readings. Ignore any title slip or non-register leaf and return boundaries for every event visible on the manuscript portion. A mixed spread is a register page whenever either leaf contains an event.`;segmentation=await structuredResponse(SEGMENTATION_MODEL,await visionContent(bytes,mediaType,retryPrompt),segmentationFormat as unknown as Record<string,unknown>);boundaries=(segmentation.record_boundaries??[]) as Array<Record<string,unknown>>;}
    const recordPrompt=`The full page has already been segmented into ${boundaries.length} record blocks. Return exactly one spreadsheet row for every supplied record crop, in the same entry_order, without merging or omitting blocks. Preserve the supplied full-page normalized bbox, column_index, proposed event_type, and boundary_confidence for each row. Each crop spans its manuscript column and includes vertical padding, so transcribe only the event inside the authoritative bbox described beside it; the padding is context.

Work in two separate layers. name_raw and name_pattern preserve the visible letters; use ? for every uncertain letter and keep even one- or two-letter fragments. reconstructed_name may use repeated spellings, the supplied blind readings, archive-wide name forms, role grammar, and Breton naming habits. For example J???N may become Jehan and M??H?IN may become Mathurin when the visible pattern and archive vocabulary agree. visual_confidence scores only the pixels. contextual_confidence scores the reconstruction and may be high when pattern, position, and repeated archive forms strongly agree. Explain each reconstruction in reconstruction_basis. Never replace the raw pattern with the reconstruction.

When reconstructed_name differs from name_raw/name_pattern, contextual_confidence should normally be at least visual_confidence because it measures the combined visible and contextual evidence. A visibly incomplete spelling is still useful: emit J???N, M??H?IN, a one-letter initial, or another honest fragment instead of omitting that person. Do not guess a family name with no visible anchor.

SURNAME PRIORITY: family names are the most important searchable evidence. For every child, parent, spouse, godparent, and witness, inspect the expected family-name position independently even when the given name is easy. surname_raw contains only family-name letters actually visible; surname_pattern uses ? for uncertain letters; reconstructed_surname is a separate contextual hypothesis. Set surname_state=visible for a legible literal surname, partial for a useful damaged pattern, reconstructed when context supports a completion, absent only when the record formula genuinely supplies no family name, and unknown when damage prevents deciding. Never discard a fragment such as P?LL?R or L?FRON?T. Explain archive repetition, a same-family spelling, residence, or formula position in surname_reconstruction_basis. Score surname pixels and surname context separately. Do not copy a given name into the surname fields merely to avoid null.

Procedural words such as fils, fille, baptisé/baptême, parrain, marraine, written-out dates, and the recurring priest signature define fields; they are not people. Include the child, parents, spouses, godparents, witnesses, residences, occupations, and villages. Record an officiant as a person only when named in the prose of the act; keep a repeated terminal signature in formula_template/formula observations. Do not create a person named fils or fille.

date_visual_text contains only date words or characters actually visible inside the record. date_source=explicit is allowed only when every populated date component in event_date_text/event_year is visibly supported by date_visual_text. If the year, month, or day was supplied by chronology, set date_inferred=true and use previous_record, next_record, page_heading, adjacent_page, or section_marker. Carry an established year and, when justified, month forward until a new explicit value or section marker. Never invent a sequential day merely because this row follows another day. Person and relationship indexes are zero-based within each row.

Authoritative segmentation JSON:
${JSON.stringify({page_structure:segmentation.page_structure,record_boundaries:boundaries,visible_years:segmentation.visible_years})}

Read-only contextual evidence from earlier blind passes; it contains no target family and cannot override contradictory pixels:
${JSON.stringify(contextualReference)}`;
    let recordRows:{records:Array<Record<string,unknown>>}={records:[]};
    if(boundaries.length){const recordContent=await recordVisionContent(bytes,mediaType,recordPrompt,boundaries);recordRows=await structuredResponse(MODEL,recordContent,recordsFormat as unknown as Record<string,unknown>);}
    const returnedRows=recordRows.records??[],records=boundaries.map((boundary,index)=>{
      const entryOrder=Number(boundary.entry_order),candidate=returnedRows.find((row)=>Number(row.entry_order)===entryOrder)??returnedRows[index]??{};
      const dateVisualText=nullableText(candidate.date_visual_text),modelDateSource=String(candidate.date_source??'unknown'),dateSource=modelDateSource==='explicit'&&!dateVisualText?'unknown':modelDateSource;
      const people=((candidate.people??[]) as Array<Record<string,unknown>>).map((person)=>{
        const reconstructed=normalizedName(person.reconstructed_name),raw=normalizedName(person.name_pattern??person.name_raw),visual=Number(person.visual_confidence)||0,contextual=Number(person.contextual_confidence)||0,pattern=person.name_pattern??person.name_raw;
        const matches=lexiconRows.filter((row)=>patternSupportsName(pattern,row.canonical_reading)),lexicon=matches.find((row)=>normalizedName(row.canonical_reading)===reconstructed);let calibrated=Math.max(visual,contextual);let basis=nullableText(person.reconstruction_basis,1000);
        if(lexicon&&reconstructed){const support=Number(lexicon.support_count)||0,pageSupport=Number(lexicon.page_support)||0,boost=Math.min(.12,Math.log10(Math.max(1,support))*.02+Math.log10(Math.max(1,pageSupport))*.065),ceiling=matches.length<=1?.96:matches.length<=3?.88:.76;calibrated=Math.max(calibrated,Math.min(ceiling,(Number(lexicon.confidence)||0)+boost));basis=[basis,`Archive-local match on ${pageSupport} page${pageSupport===1?'':'s'} (${matches.length} pattern candidate${matches.length===1?'':'s'}).`].filter(Boolean).join(' ').slice(0,1000);}
        const surnameRaw=nullableText(person.surname_raw),surnamePattern=nullableText(person.surname_pattern)??surnameRaw,reconstructedSurname=nullableText(person.reconstructed_surname)??nullableText(person.surname),surnameKey=normalizedName(reconstructedSurname),surnameVisual=Number(person.surname_visual_confidence)||0;let surnameContext=Math.max(surnameVisual,Number(person.surname_contextual_confidence)||0),surnameBasis=nullableText(person.surname_reconstruction_basis,1000);
        const surnameMatches=surnamePattern?lexiconRows.filter((row)=>{const types=Array.isArray(row.reading_types)?row.reading_types.map(String):[];return(!types.length||types.includes('surname')||types.includes('full')||types.includes('token'))&&patternSupportsName(surnamePattern,row.canonical_reading);}):[],surnameLexicon=surnameMatches.find((row)=>normalizedName(row.canonical_reading)===surnameKey);
        if(surnameLexicon&&surnameKey){const support=Number(surnameLexicon.support_count)||0,pageSupport=Number(surnameLexicon.page_support)||0,boost=Math.min(.14,Math.log10(Math.max(1,support))*.025+Math.log10(Math.max(1,pageSupport))*.075),ceiling=surnameMatches.length<=1?.97:surnameMatches.length<=3?.9:.78;surnameContext=Math.max(surnameContext,Math.min(ceiling,(Number(surnameLexicon.confidence)||0)+boost));surnameBasis=[surnameBasis,`Archive surname match on ${pageSupport} page${pageSupport===1?'':'s'} (${surnameMatches.length} pattern candidate${surnameMatches.length===1?'':'s'}).`].filter(Boolean).join(' ').slice(0,1000);}
        return{...person,reconstruction_basis:basis,contextual_confidence:calibrated,surname:reconstructedSurname,surname_raw:surnameRaw,surname_pattern:surnamePattern,reconstructed_surname:reconstructedSurname,surname_reconstruction_basis:surnameBasis,surname_visual_confidence:surnameVisual,surname_contextual_confidence:surnameContext,surname_state:String(person.surname_state??(surnameRaw?'visible':reconstructedSurname?'reconstructed':'unknown'))};
      });
      return{entry_order:entryOrder,column_index:Number(boundary.column_index)||0,event_type:candidate.event_type??boundary.event_type??'unknown',event_date_text:candidate.event_date_text??'',event_year:candidate.event_year??null,date_visual_text:dateVisualText,date_source:dateSource,date_inferred:candidate.date_inferred===true||dateSource!=='explicit',location_text:candidate.location_text??null,subject_text:candidate.subject_text??null,formula_template:candidate.formula_template??null,people,relationships:candidate.relationships??[],excerpt:candidate.excerpt??String(boundary.anchor_text??''),visual_confidence:Number(candidate.visual_confidence)||0.05,contextual_confidence:Number(candidate.contextual_confidence)||0.05,boundary_confidence:Number(boundary.boundary_confidence)||0.05,bbox:boundary.bbox};
    });
    const parsed={...segmentation,page_structure:{...segmentation.page_structure,expected_record_count:boundaries.length},records};
    const years=[...new Set<number>((parsed.visible_years??[]).map(Number).filter((year:number)=>Number.isInteger(year)&&year>=100&&year<=3000))];
    const hasLegibleName=(parsed.records??[]).some((record:Record<string,unknown>)=>((record.people??[]) as Array<Record<string,unknown>>).some((person)=>{const name=String(person.name_raw??'').trim();return name&&!/\[(illegible|unnamed)/i.test(name)&&normalizedName(name).length>=3;}));
    const runStatus=String(parsed.page_type)!=='register'||Number(parsed.contextual_confidence)>=.65&&(parsed.records??[]).length>0?'complete':'needs_review';
    const runRows=await sql`INSERT INTO genealogy_record_extraction_runs(page_id,engine,engine_version,prompt_version,status,source_asset_sha256,source_url,image_discarded,page_type,language,visible_years,mean_confidence,metadata)
      VALUES (${pageId},'openai-responses',${MODEL},${PROMPT_VERSION},${runStatus},${sourceDigest},${page.source_url},${transient},${parsed.page_type},${nullableText(parsed.language,100)},${years},${parsed.contextual_confidence},${JSON.stringify({record_count:parsed.records?.length??0,has_legible_name:hasLegibleName,visual_confidence:parsed.visual_confidence,contextual_confidence:parsed.contextual_confidence,page_structure:parsed.page_structure,context_sources:{archive_name_forms:lexiconRows.length,current_page_blind_readings:pageReadingRows.length,preceding_records:previousRecordRows.length,learned_formulas:formulaRows.length}})}::jsonb)
      ON CONFLICT(page_id,prompt_version,source_asset_sha256) DO UPDATE SET engine=EXCLUDED.engine,engine_version=EXCLUDED.engine_version,status=EXCLUDED.status,source_url=EXCLUDED.source_url,image_discarded=EXCLUDED.image_discarded,page_type=EXCLUDED.page_type,language=EXCLUDED.language,visible_years=EXCLUDED.visible_years,mean_confidence=EXCLUDED.mean_confidence,metadata=EXCLUDED.metadata,created_at=NOW() RETURNING id,created_at`;
    const run=runRows[0];await sql`DELETE FROM genealogy_records WHERE page_id=${pageId}`;await sql`DELETE FROM genealogy_record_formula_observations WHERE extraction_run_id=${run.id}`;
    for(let formulaIndex=0;formulaIndex<(parsed.formula_patterns??[]).length;formulaIndex++){
      const formula=parsed.formula_patterns[formulaIndex],bbox=formula.bbox??{};
      await sql`INSERT INTO genealogy_record_formula_observations(extraction_run_id,page_id,formula_index,formula_kind,text_raw,normalized_pattern,inferred_meaning,visual_confidence,contextual_confidence,bbox_x,bbox_y,bbox_width,bbox_height,metadata)
        VALUES(${run.id},${pageId},${formulaIndex},${String(formula.formula_kind||'other').slice(0,100)},${String(formula.text_raw||'?').slice(0,1000)},${String(formula.normalized_pattern||formula.text_raw||'?').slice(0,1000)},${nullableText(formula.inferred_meaning,1000)},${Number(formula.visual_confidence)||0},${Number(formula.contextual_confidence)||0},${Number(bbox.x)||0},${Number(bbox.y)||0},${Number(bbox.width)||0},${Number(bbox.height)||0},'{}'::jsonb)`;
    }
    let peopleCount=0,relationshipCount=0;const searchParts:string[]=[String(page.archive_label??''),...years.map(String)];
    for(let recordIndex=0;recordIndex<(parsed.records??[]).length;recordIndex++){
      const record=parsed.records[recordIndex],bbox=record.bbox??{};
      const records=await sql`INSERT INTO genealogy_records(extraction_run_id,page_id,record_index,entry_order,column_index,event_type,event_date_text,event_year,date_visual_text,date_source,date_inferred,location_text,subject_text,formula_template,excerpt,confidence,visual_confidence,contextual_confidence,boundary_confidence,bbox_x,bbox_y,bbox_width,bbox_height,metadata)
        VALUES (${run.id},${pageId},${recordIndex},${Number(record.entry_order)||recordIndex},${Number(record.column_index)||0},${String(record.event_type||'unknown').slice(0,100)},${nullableText(record.event_date_text)},${record.event_year}::integer,${nullableText(record.date_visual_text)},${String(record.date_source||'unknown').slice(0,100)},${record.date_inferred===true},${nullableText(record.location_text)},${nullableText(record.subject_text)},${nullableText(record.formula_template,1000)},${nullableText(record.excerpt,4000)},${Number(record.contextual_confidence)||0},${Number(record.visual_confidence)||0},${Number(record.contextual_confidence)||0},${Number(record.boundary_confidence)||0},${Number(bbox.x)||0},${Number(bbox.y)||0},${Number(bbox.width)||0},${Number(bbox.height)||0},${JSON.stringify({date_basis:record.date_source})}::jsonb) RETURNING id`;
      const recordId=records[0].id,people=(record.people??[]) as Array<Record<string,unknown>>;searchParts.push(String(record.event_type??''),String(record.event_date_text??''),String(record.location_text??''),String(record.subject_text??''));
      for(let personIndex=0;personIndex<people.length;personIndex++){
        const person=people[personIndex],nameRaw=String(person.name_raw??'').trim().slice(0,500);if(!nameRaw)continue;const reconstructedName=nullableText(person.reconstructed_name);
        const surnameRaw=nullableText(person.surname_raw),surnamePattern=nullableText(person.surname_pattern),reconstructedSurname=nullableText(person.reconstructed_surname)??nullableText(person.surname);
        await sql`INSERT INTO genealogy_record_people(record_id,person_index,role,name_raw,name_pattern,reconstructed_name,reconstruction_basis,given_names,surname,surname_raw,surname_pattern,reconstructed_surname,normalized_surname,surname_reconstruction_basis,surname_visual_confidence,surname_contextual_confidence,surname_state,normalized_name,gender,residence,occupation,confidence,visual_confidence,contextual_confidence,metadata)
          VALUES (${recordId},${personIndex},${String(person.role||'mentioned').slice(0,100)},${nameRaw},${nullableText(person.name_pattern)},${reconstructedName},${nullableText(person.reconstruction_basis,1000)},${nullableText(person.given_names)},${reconstructedSurname},${surnameRaw},${surnamePattern},${reconstructedSurname},${normalizedName(reconstructedSurname)},${nullableText(person.surname_reconstruction_basis,1000)},${Number(person.surname_visual_confidence)||0},${Number(person.surname_contextual_confidence)||0},${String(person.surname_state||'unknown').slice(0,30)},${normalizedName(reconstructedName||nameRaw)},${nullableText(person.gender,50)},${nullableText(person.residence)},${nullableText(person.occupation)},${Number(person.contextual_confidence)||0},${Number(person.visual_confidence)||0},${Number(person.contextual_confidence)||0},${JSON.stringify({raw_normalized_name:normalizedName(nameRaw)})}::jsonb)`;
        peopleCount++;searchParts.push(nameRaw,String(reconstructedName??''),String(person.name_pattern??''),String(surnameRaw??''),String(surnamePattern??''),String(reconstructedSurname??''),String(person.residence??''),String(person.occupation??''));
      }
      for(let relationshipIndex=0;relationshipIndex<(record.relationships??[]).length;relationshipIndex++){
        const relation=record.relationships[relationshipIndex],fromIndex=safeRelationIndex(relation.from_person_index,relation.from_name,people),toIndex=safeRelationIndex(relation.to_person_index,relation.to_name,people);
        await sql`INSERT INTO genealogy_record_relationships(record_id,relationship_index,relationship_type,from_person_index,to_person_index,from_name,to_name,confidence,metadata)
          VALUES (${recordId},${relationshipIndex},${String(relation.relationship_type||'associated').slice(0,100)},${fromIndex}::integer,${toIndex}::integer,${nullableText(relation.from_name)},${nullableText(relation.to_name)},${relation.confidence},${JSON.stringify({model_from_person_index:relation.from_person_index,model_to_person_index:relation.to_person_index})}::jsonb)`;
        relationshipCount++;
      }
    }
    await sql`UPDATE genealogy_pages SET index_status='records_extracted',index_year_from=CASE WHEN cardinality(${years}::integer[])>0 THEN (SELECT min(value) FROM unnest(${years}::integer[]) value) ELSE index_year_from END,index_year_to=CASE WHEN cardinality(${years}::integer[])>0 THEN (SELECT max(value) FROM unnest(${years}::integer[]) value) ELSE index_year_to END,search_text=${searchParts.filter(Boolean).join(' ')},indexed_at=NOW(),updated_at=NOW() WHERE id=${pageId}`;
    return NextResponse.json({ok:true,pageId,model:MODEL,promptVersion:PROMPT_VERSION,run,summary:{records:parsed.records?.length??0,expectedRecords:parsed.page_structure?.expected_record_count??0,people:peopleCount,relationships:relationshipCount,formulaPatterns:parsed.formula_patterns?.length??0,visibleYears:years,visualConfidence:parsed.visual_confidence,contextualConfidence:parsed.contextual_confidence,status:runStatus,hasLegibleName,pageStructure:parsed.page_structure},transientImageDiscarded:transient,retrievalUrl:page.source_url});
  }catch(error:unknown){const message=error instanceof Error?error.message:String(error);return NextResponse.json({ok:false,error:message},{status:500});}
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
