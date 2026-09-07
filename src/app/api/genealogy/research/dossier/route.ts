import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import { normalizeIdentity } from '@/lib/genealogy/gedcom';
import { ensureGenealogyResearchSchema } from '@/lib/genealogy/research-store';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(): Promise<NextResponse | null> {
  if (!ownerGateConfigured()) return null;
  const result = await requireOwner();
  return result.ok ? null : NextResponse.json({ ok:false, error:result.reason }, { status:result.status });
}

function researchSuggestions(node:Record<string,unknown>, parentCount:number, archiveMatches:number) {
  const metadata=(node.metadata??{}) as Record<string,unknown>;
  const suggestions:Array<{priority:'critical'|'high'|'normal';title:string;reason:string;query:string}> = [];
  const surname=String(metadata.surname??'').trim();
  const place=String((metadata.birth as {place?:string}|null)?.place??(metadata.baptism as {place?:string}|null)?.place??'').trim();
  const birthYear=Number(metadata.birth_year)||null;
  if(parentCount<2) suggestions.push({priority:'critical',title:`Find ${parentCount===0?'parents':'the missing parent'}`,reason:'This is an open direct-line boundary in the current graph.',query:[surname,birthYear?birthYear-30:'',place].filter(Boolean).join(' ')});
  if(Number(node.proof_strength)<0.7||String(node.review_status)==='imported') suggestions.push({priority:'high',title:'Replace inherited claims with original evidence',reason:'The GEDCOM relationship is a lead until an original image or archival citation is reviewed.',query:[String(node.label),birthYear??'',place].filter(Boolean).join(' ')});
  if(!metadata.birth&&!metadata.baptism) suggestions.push({priority:'high',title:'Resolve birth or baptism',reason:'A dated place anchors the correct household and the next register search.',query:[String(node.label),place,'baptism'].filter(Boolean).join(' ')});
  if(!metadata.death) suggestions.push({priority:'normal',title:'Resolve death and burial',reason:'Later records can confirm spouse, occupation, residence and surviving relatives.',query:[String(node.label),place,'burial'].filter(Boolean).join(' ')});
  if(archiveMatches>0) suggestions.unshift({priority:'high',title:`Review ${archiveMatches} possible archive match${archiveMatches===1?'':'es'}`,reason:'The archive translator has produced name-compatible records; connect or reject them before another broad crawl.',query:String(node.label)});
  if(!suggestions.length) suggestions.push({priority:'normal',title:'Extend the household network',reason:'Sponsors, witnesses, siblings and neighbours can distinguish same-name families.',query:[surname,place].filter(Boolean).join(' ')});
  return suggestions.slice(0,6);
}

export async function GET(request:NextRequest) {
  const denied=await gate(); if(denied) return denied;
  try {
    const nodeId=(request.nextUrl.searchParams.get('nodeId')??'').trim();
    if(!nodeId) return NextResponse.json({ok:false,error:'nodeId is required'},{status:400});
    const sql=await ensureGenealogyResearchSchema(getMemoryDb());
    const imports=await sql`SELECT id FROM genealogy_graph_imports WHERE status='complete' ORDER BY id DESC LIMIT 1`;
    const importId=imports[0]?.id??null;
    const nodes=await sql`SELECT n.id,n.label,n.branch,n.proof_strength,n.review_status,n.metadata,
        (SELECT count(*)::int FROM genealogy_graph_edges e WHERE e.import_id=${importId} AND e.edge_type='parent' AND e.status<>'research_scaffold' AND e.source_id=n.id) AS child_count,
        (SELECT count(*)::int FROM genealogy_graph_edges e WHERE e.import_id=${importId} AND e.edge_type='parent' AND e.status<>'research_scaffold' AND e.target_id=n.id) AS parent_count,
        (SELECT count(*)::int FROM genealogy_graph_edges e WHERE e.import_id=${importId} AND e.edge_type='parent' AND e.status='research_scaffold' AND (e.source_id=n.id OR e.target_id=n.id)) AS scaffold_link_count,
        (SELECT count(*)::int FROM genealogy_graph_edges e WHERE e.import_id=${importId} AND e.edge_type='spouse' AND (e.source_id=n.id OR e.target_id=n.id)) AS spouse_count
      FROM genealogy_graph_nodes n WHERE n.id=${nodeId} LIMIT 1`;
    if(!nodes[0]) return NextResponse.json({ok:false,error:'Person was not found'},{status:404});
    const node=nodes[0];
    const notes=await sql`SELECT id,kind,status,title,body,source_url,archive_page_id,confidence,tags,created_at,updated_at
      FROM genealogy_research_notes WHERE node_id=${nodeId} AND archived_at IS NULL ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END, updated_at DESC`;
    const assertions=importId?await sql`SELECT id,predicate,value_text,place_text,confidence,status,metadata,created_at
      FROM genealogy_graph_assertions WHERE import_id=${importId} AND subject_id=${nodeId} ORDER BY predicate,created_at`:[];
    let preservedMedia:unknown[]=[];
    try{preservedMedia=importId?await sql`SELECT item.id,item.media_index,item.title,item.media_format,item.remote_url,item.remote_expires_at,item.asset_sha256,item.preserved_at,asset.media_type,asset.byte_size
      FROM genealogy_gedcom_media_items item JOIN genealogy_archive_assets asset ON asset.sha256=item.asset_sha256
      WHERE item.import_id=${importId} AND item.node_id=${nodeId} AND item.status='preserved'
      ORDER BY item.media_index,item.id`:[];}catch{preservedMedia=[];}

    const metadata=(node.metadata??{}) as Record<string,unknown>;
    const surname=String(metadata.surname??'').trim();
    const given=String(metadata.given??'').trim().split(/\s+/)[0]??'';
    let archiveMatches:unknown[]=[];
    if(surname.length>=3) {
      try {
        const surnameLike=`%${surname}%`, givenLike=given.length>=3?`%${given}%`:'%';
        archiveMatches=await sql`SELECT r.id AS record_id,r.event_type,r.event_date_text,r.event_year,r.location_text,r.confidence,r.review_status,
            p.id AS page_id,p.page_number,p.source_url,j.archive,j.register_id,
            rp.role,rp.name_raw,rp.reconstructed_name,rp.surname_raw,rp.reconstructed_surname,rp.confidence AS person_confidence
          FROM genealogy_record_people rp
          JOIN genealogy_records r ON r.id=rp.record_id
          JOIN genealogy_pages p ON p.id=r.page_id
          JOIN genealogy_crawl_jobs j ON j.id=p.job_id
          WHERE (rp.surname_raw ILIKE ${surnameLike} OR rp.reconstructed_surname ILIKE ${surnameLike} OR rp.normalized_surname=${normalizeIdentity(surname)})
            AND (${given.length>=3}::boolean=FALSE OR rp.name_raw ILIKE ${givenLike} OR rp.reconstructed_name ILIKE ${givenLike})
          ORDER BY r.confidence DESC,p.page_number ASC LIMIT 24`;
      } catch { archiveMatches=[]; }
    }
    const suggestions=researchSuggestions(node,Number(node.parent_count)||0,archiveMatches.length);
    return NextResponse.json({ok:true,node,notes,assertions,archiveMatches,preservedMedia,suggestions});
  } catch(error:unknown) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});
  }
}

export async function POST(request:NextRequest) {
  const denied=await gate(); if(denied) return denied;
  try {
    const body=await request.json();
    const nodeId=String(body.nodeId??'').trim(),title=String(body.title??'').trim().slice(0,240),noteBody=String(body.body??'').trim().slice(0,12000);
    if(!nodeId||!title) return NextResponse.json({ok:false,error:'Person and title are required'},{status:400});
    const kind=String(body.kind??'clue'),status=String(body.status??'open');
    const kinds=new Set(['finding','clue','hypothesis','conflict','task','proof']),statuses=new Set(['open','investigating','supported','rejected','resolved']);
    if(!kinds.has(kind)||!statuses.has(status)) return NextResponse.json({ok:false,error:'Invalid note kind or status'},{status:400});
    const requestedConfidence=Number(body.confidence),confidence=Number.isFinite(requestedConfidence)?Math.max(0,Math.min(1,requestedConfidence)):0.5;
    const tags=Array.isArray(body.tags)?body.tags.map((tag:unknown)=>String(tag).trim()).filter(Boolean).slice(0,20):[];
    const sql=await ensureGenealogyResearchSchema(getMemoryDb());
    const imports=await sql`SELECT id FROM genealogy_graph_imports WHERE status='complete' ORDER BY id DESC LIMIT 1`;
    const rows=await sql`INSERT INTO genealogy_research_notes(node_id,import_id,kind,status,title,body,source_url,archive_page_id,confidence,tags)
      VALUES (${nodeId},${imports[0]?.id??null},${kind},${status},${title},${noteBody},${body.sourceUrl?String(body.sourceUrl).slice(0,2000):null},${Number(body.archivePageId)||null},${confidence},${tags}) RETURNING *`;
    return NextResponse.json({ok:true,note:rows[0]},{status:201});
  } catch(error:unknown) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});
  }
}

export async function PATCH(request:NextRequest) {
  const denied=await gate(); if(denied) return denied;
  try {
    const body=await request.json(),id=Number(body.id);
    if(!Number.isSafeInteger(id)||id<=0) return NextResponse.json({ok:false,error:'A valid note id is required'},{status:400});
    const status=String(body.status??'');
    if(!new Set(['open','investigating','supported','rejected','resolved']).has(status)) return NextResponse.json({ok:false,error:'Invalid status'},{status:400});
    const sql=await ensureGenealogyResearchSchema(getMemoryDb());
    const rows=await sql`UPDATE genealogy_research_notes SET status=${status},updated_at=NOW() WHERE id=${id} AND archived_at IS NULL RETURNING *`;
    return rows[0]?NextResponse.json({ok:true,note:rows[0]}):NextResponse.json({ok:false,error:'Note was not found'},{status:404});
  } catch(error:unknown) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});
  }
}
