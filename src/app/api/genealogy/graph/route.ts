import { createHash, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getMemoryDb } from '@/lib/db';
import { normalizeIdentity, parseGedcom, yearOf, type GedcomFamily, type GedcomPerson } from '@/lib/genealogy/gedcom';
import { ensureGenealogyResearchSchema } from '@/lib/genealogy/research-store';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_GEDCOM_BYTES = 12 * 1024 * 1024;

async function gate(): Promise<NextResponse | null> {
  if (!ownerGateConfigured()) return null;
  const result = await requireOwner();
  return result.ok ? null : NextResponse.json({ ok:false, error:result.reason }, { status:result.status });
}

async function ensureGraphSchema() {
  const sql = getMemoryDb();
  await sql`CREATE TABLE IF NOT EXISTS genealogy_graph_imports (
    id BIGSERIAL PRIMARY KEY, filename TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'processing', root_node_id TEXT,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb, raw_gedcom TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ
  )`;
  await sql`CREATE TABLE IF NOT EXISTS genealogy_graph_nodes (
    id TEXT PRIMARY KEY, node_type TEXT NOT NULL, label TEXT NOT NULL,
    branch TEXT, proof_strength DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    review_status TEXT NOT NULL DEFAULT 'imported', weight DOUBLE PRECISION NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS genealogy_graph_nodes_type_idx ON genealogy_graph_nodes(node_type)`;
  await sql`CREATE TABLE IF NOT EXISTS genealogy_graph_external_ids (
    import_id BIGINT NOT NULL REFERENCES genealogy_graph_imports(id) ON DELETE CASCADE,
    gedcom_id TEXT NOT NULL, node_id TEXT NOT NULL REFERENCES genealogy_graph_nodes(id) ON DELETE CASCADE,
    record_type TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY(import_id, gedcom_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS genealogy_graph_edges (
    id BIGSERIAL PRIMARY KEY, import_id BIGINT NOT NULL REFERENCES genealogy_graph_imports(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES genealogy_graph_nodes(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES genealogy_graph_nodes(id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL, confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    status TEXT NOT NULL DEFAULT 'imported', metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE(import_id, source_id, target_id, edge_type)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS genealogy_graph_assertions (
    id BIGSERIAL PRIMARY KEY, import_id BIGINT NOT NULL REFERENCES genealogy_graph_imports(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES genealogy_graph_nodes(id) ON DELETE CASCADE,
    predicate TEXT NOT NULL, value_text TEXT, place_text TEXT,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.35, status TEXT NOT NULL DEFAULT 'inherited_claim',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(import_id, subject_id, predicate, value_text, place_text)
  )`;
  return sql;
}

function canonicalBranch(surname: string): string {
  const key = normalizeIdentity(surname);
  if (key.includes('durocher') || key.includes('desrochers')) return 'durocher';
  if (key === 'power' || key === 'powers') return 'power';
  if (key.includes('theoret')) return 'theoret';
  if (key.includes('charette')) return 'charette';
  if (key === 'baril' || key === 'barry') return 'baril';
  return key || 'unresolved';
}

function identityKey(person: GedcomPerson): string {
  return [normalizeIdentity(person.name), yearOf(person.birth?.date) ?? '', yearOf(person.death?.date) ?? ''].join('|');
}

function chooseRoot(people: GedcomPerson[], families: GedcomFamily[]): GedcomPerson | null {
  const parentRefs=new Map<string,string[]>();
  for(const family of families) for(const child of family.children) parentRefs.set(child,[family.husband,family.wife].filter((value):value is string=>Boolean(value)));
  const ancestorCount=(id:string,seen=new Set<string>()):number=>{for(const parent of parentRefs.get(id)??[])if(!seen.has(parent)){seen.add(parent);ancestorCount(parent,seen);}return seen.size;};
  const central=people.filter((person)=>person.famc.length>0&&person.fams.length>0);
  return [...(central.length?central:people)].sort((a,b)=>ancestorCount(b.id)-ancestorCount(a.id)||((yearOf(b.birth?.date)??0)-(yearOf(a.birth?.date)??0)))[0]??null;
}

function batches<T>(values:T[],size=200):T[][] {
  const result:T[][]=[];
  for(let index=0;index<values.length;index+=size) result.push(values.slice(index,index+size));
  return result;
}

export async function GET() {
  const denied=await gate(); if(denied) return denied;
  try {
    const sql=await ensureGraphSchema(); await ensureGenealogyResearchSchema(sql);
    const imports=await sql`SELECT id,filename,root_node_id,summary,created_at FROM genealogy_graph_imports WHERE status='complete' ORDER BY id DESC LIMIT 1`;
    if(!imports[0]) return NextResponse.json({ok:true,axis:'genealogy',nodes:[{id:'ROOT',name:'FAMILY',depth:0,is_leaf:true,n_chunks:0,coherence:1,root:'ROOT',node_type:'root'}],links:[],roots:[],count:1,empty:true});
    const imp=imports[0];
    const rows=await sql`SELECT n.id,n.label,n.branch,n.proof_strength,n.weight,n.review_status,n.metadata,x.gedcom_id
      FROM genealogy_graph_external_ids x JOIN genealogy_graph_nodes n ON n.id=x.node_id
      WHERE x.import_id=${imp.id} AND x.record_type='person'`;
    const edges=await sql`SELECT source_id,target_id,edge_type,confidence,status,metadata FROM genealogy_graph_edges WHERE import_id=${imp.id}`;
    const noteCounts=await sql`SELECT node_id,count(*)::int AS count FROM genealogy_research_notes WHERE archived_at IS NULL GROUP BY node_id`;
    const [mediaSummary]=await sql`SELECT count(*) FILTER(WHERE status='preserved')::int preserved_media,count(DISTINCT node_id) FILTER(WHERE status='preserved' AND node_id IS NOT NULL)::int people_with_media,count(DISTINCT asset_sha256) FILTER(WHERE status='preserved')::int unique_media_assets FROM genealogy_gedcom_media_items WHERE import_id=${imp.id}`;
    const notesByNode=new Map(noteCounts.map((row)=>[String(row.node_id),Number(row.count)]));
    const byId=new Map(rows.map((r)=>[String(r.id),r]));
    const isScaffold=(edge:Record<string,unknown>)=>String(edge.status)==='research_scaffold'||((edge.metadata??{}) as Record<string,unknown>).research_scaffold===true;
    const parents=new Map<string,string[]>(),proofParents=new Map<string,string[]>();
    for(const edge of edges) if(edge.edge_type==='parent') {
      const child=String(edge.target_id),parent=String(edge.source_id);
      parents.set(child,[...(parents.get(child)??[]),parent]);
      if(!isScaffold(edge)) proofParents.set(child,[...(proofParents.get(child)??[]),parent]);
    }
    const rootId=String(imp.root_node_id || rows[0]?.id || '');
    const depth=new Map<string,number>(); const branch=new Map<string,string>(); const queue:string[]=[];
    if(rootId && byId.has(rootId)){depth.set(rootId,1);branch.set(rootId,'ROOT');queue.push(rootId);}
    while(queue.length){const child=queue.shift()!; const nextDepth=(depth.get(child)??0)+1; for(const parent of parents.get(child)??[]){if(!byId.has(parent))continue; if(!depth.has(parent)){depth.set(parent,nextDepth); const row=byId.get(parent)!; branch.set(parent,nextDepth<=3?canonicalBranch(String(row.metadata?.surname??row.branch??'')):(branch.get(child)??String(row.branch??'unresolved'))); queue.push(parent);}}}
    const scaffoldPath=new Map<string,boolean>([[rootId,false]]);
    for(const [child] of [...depth.entries()].sort((left,right)=>left[1]-right[1])) for(const edge of edges) {
      if(edge.edge_type!=='parent'||String(edge.target_id)!==child||!depth.has(String(edge.source_id))) continue;
      const parent=String(edge.source_id),candidate=Boolean(scaffoldPath.get(child))||isScaffold(edge);
      if(!scaffoldPath.has(parent)||scaffoldPath.get(parent)===true&&candidate===false) scaffoldPath.set(parent,candidate);
    }
    const visible=rows.filter((r)=>depth.has(String(r.id)));
    const pathCounts=new Map<string,number>([[rootId,1]]);
    [...depth.entries()].sort((a,b)=>a[1]-b[1]).forEach(([child])=>{
      const count=pathCounts.get(child)??0;
      for(const parent of proofParents.get(child)??[]) if(depth.has(parent)) pathCounts.set(parent,(pathCounts.get(parent)??0)+count);
    });
    const branchCounts:Record<string,number>={};
    const nodes=[{id:'ROOT',name:'FAMILY',depth:0,is_leaf:false,n_chunks:visible.length,coherence:1,root:'ROOT',node_type:'root',review_status:'root',metadata:{tree_summary:imp.summary}},...visible.map((r)=>{
      const id=String(r.id); const parentCount=(proofParents.get(id)??[]).filter((p)=>depth.has(p)).length,scaffoldParentCount=(parents.get(id)??[]).filter((p)=>depth.has(p)&&!(proofParents.get(id)??[]).includes(p)).length;
      const proof=String(r.review_status)==='imported'?Math.min(0.55,Number(r.proof_strength)):Number(r.proof_strength);
      const root=branch.get(id)??String(r.branch??'unresolved'); branchCounts[root]=(branchCounts[root]??0)+1;
      return {id,name:String(r.label),depth:depth.get(id)!,is_leaf:parentCount===0,n_chunks:Math.max(1,Number(r.weight)||1),coherence:proof,root,node_type:'person',review_status:r.review_status,
        metadata:{...(r.metadata??{}),note_count:notesByNode.get(id)??0,pedigree_paths:pathCounts.get(id)??0,parent_count:parentCount,scaffold_parent_count:scaffoldParentCount,research_scaffold_path:Boolean(scaffoldPath.get(id))}};
    })];
    const parentLinks=edges.filter((e)=>e.edge_type==='parent'&&depth.has(String(e.source_id))&&depth.has(String(e.target_id)));
    const incoming=new Map<string,number>(); for(const edge of parentLinks){const target=String(edge.source_id);incoming.set(target,(incoming.get(target)??0)+1);}
    const links=[{source:'ROOT',target:rootId,type:'root',confidence:1,status:'root',convergent:false,scaffold:false},...parentLinks.map((e)=>({source:String(e.target_id),target:String(e.source_id),type:'parent',confidence:Number(e.confidence),status:e.status,scaffold:isScaffold(e),convergent:(pathCounts.get(String(e.source_id))??0)>1}))];
    const crossLinks=edges.filter((e)=>e.edge_type==='spouse'&&depth.has(String(e.source_id))&&depth.has(String(e.target_id))).map((e)=>({source:String(e.source_id),target:String(e.target_id),type:'spouse',confidence:Number(e.confidence),status:e.status}));
    const proofGaps=nodes.filter((node)=>node.node_type==='person'&&!Boolean((node.metadata as Record<string,unknown>)?.research_scaffold_path)&&((node.coherence??0)<0.7||node.review_status==='imported')).length;
    const convergentAncestors=nodes.filter((node)=>node.node_type==='person'&&Number((node.metadata as Record<string,unknown>)?.pedigree_paths??1)>1).length;
    return NextResponse.json({ok:true,axis:'genealogy',nodes,links,crossLinks,roots:[...new Set(nodes.filter((n)=>n.depth>=2&&n.depth<=3).map((n)=>n.root))],count:nodes.length,
      metrics:{generations:Math.max(0,...visible.map((row)=>depth.get(String(row.id))??0)),visible_people:visible.length,proof_gaps:proofGaps,convergent_ancestors:convergentAncestors,research_scaffolds:parentLinks.filter((edge)=>isScaffold(edge)).length,notes:noteCounts.reduce((sum,row)=>sum+Number(row.count),0),preserved_media:Number(mediaSummary?.preserved_media)||0,people_with_media:Number(mediaSummary?.people_with_media)||0,unique_media_assets:Number(mediaSummary?.unique_media_assets)||0,branches:branchCounts},
      import:{id:imp.id,filename:imp.filename,summary:imp.summary,created_at:imp.created_at}});
  } catch(error:unknown){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
}

export async function POST(request:NextRequest) {
  const denied=await gate(); if(denied) return denied;
  try {
    const form=await request.formData(); const file=form.get('file');
    if(!(file instanceof File)) return NextResponse.json({ok:false,error:'GEDCOM file is required'},{status:400});
    if(file.size<=0||file.size>MAX_GEDCOM_BYTES) return NextResponse.json({ok:false,error:'GEDCOM must be between 1 byte and 12 MB'},{status:400});
    const text=await file.text(); const hash=createHash('sha256').update(text).digest('hex'); const document=parseGedcom(text); const chosenRoot=chooseRoot(document.people,document.families);
    if(!document.people.length) return NextResponse.json({ok:false,error:'No individual records were found in this GEDCOM'},{status:400});
    const sql=await ensureGraphSchema(); const prior=await sql`SELECT id,status,summary FROM genealogy_graph_imports WHERE sha256=${hash} LIMIT 1`;
    if(prior[0]?.status==='complete') {
      const roots=chosenRoot?await sql`SELECT node_id FROM genealogy_graph_external_ids WHERE import_id=${prior[0].id} AND gedcom_id=${chosenRoot.id} LIMIT 1`:[];
      const summary={...(prior[0].summary??{}),root:chosenRoot?.name??prior[0].summary?.root??null};
      if(roots[0]) await sql`UPDATE genealogy_graph_imports SET root_node_id=${roots[0].node_id},summary=${JSON.stringify(summary)}::jsonb WHERE id=${prior[0].id}`;
      return NextResponse.json({ok:true,duplicate:true,importId:prior[0].id,summary});
    }
    if(prior[0]) await sql`DELETE FROM genealogy_graph_imports WHERE id=${prior[0].id}`;
    const inserted=await sql`INSERT INTO genealogy_graph_imports(filename,sha256,status,raw_gedcom) VALUES (${file.name},${hash},'processing',${text}) RETURNING id`;
    const importId=inserted[0].id;
    const existing=await sql`SELECT id,metadata FROM genealogy_graph_nodes WHERE node_type='person'`;
    const identities=new Map<string,string[]>();
    for(const row of existing){const key=String(row.metadata?.identity_key??''); if(key){const values=identities.get(key)??[];values.push(String(row.id));identities.set(key,values);}}
    const mapping=new Map<string,string>(); let reused=0;
    const nodeRows:Array<Record<string,unknown>>=[]; const externalRows:Array<Record<string,unknown>>=[]; const assertionRows:Array<Record<string,unknown>>=[];
    for(const person of document.people){
      const key=identityKey(person); const matches=identities.get(key)??[]; const nodeId=matches.length===1?matches[0]:`person:${randomUUID()}`; if(matches.length===1)reused++;
      mapping.set(person.id,nodeId); const birthYear=yearOf(person.birth?.date)??yearOf(person.baptism?.date); const deathYear=yearOf(person.death?.date);
      const proof=Math.min(0.92,0.3+Math.min(person.sourceRefs,5)*0.1+(birthYear?0.08:0)+(deathYear?0.05:0));
      const metadata={identity_key:key,gedcom_name:person.name,given:person.given,surname:person.surname,sex:person.sex??null,birth:person.birth??null,baptism:person.baptism??null,death:person.death??null,birth_year:birthYear,death_year:deathYear,source_refs:person.sourceRefs};
      nodeRows.push({id:nodeId,label:person.name,branch:canonicalBranch(person.surname),proof_strength:proof,weight:1+person.famc.length+person.fams.length+person.sourceRefs,metadata});
      externalRows.push({import_id:importId,gedcom_id:person.id,node_id:nodeId});
      for(const [predicate,fact] of [['birth',person.birth],['baptism',person.baptism],['death',person.death]] as const) if(fact?.date||fact?.place)
        assertionRows.push({import_id:importId,subject_id:nodeId,predicate,value_text:fact.date??null,place_text:fact.place??null,confidence:proof});
    }
    for(const batch of batches(nodeRows)) await sql`INSERT INTO genealogy_graph_nodes(id,node_type,label,branch,proof_strength,review_status,weight,metadata)
      SELECT r.id,'person',r.label,r.branch,r.proof_strength,'imported',r.weight,r.metadata
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(id text,label text,branch text,proof_strength double precision,weight double precision,metadata jsonb)
      ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,branch=EXCLUDED.branch,proof_strength=GREATEST(genealogy_graph_nodes.proof_strength,EXCLUDED.proof_strength),weight=GREATEST(genealogy_graph_nodes.weight,EXCLUDED.weight),metadata=genealogy_graph_nodes.metadata||EXCLUDED.metadata,updated_at=NOW()`;
    for(const batch of batches(externalRows)) await sql`INSERT INTO genealogy_graph_external_ids(import_id,gedcom_id,node_id,record_type,metadata)
      SELECT r.import_id,r.gedcom_id,r.node_id,'person','{}'::jsonb FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(import_id bigint,gedcom_id text,node_id text)`;
    for(const batch of batches(assertionRows)) await sql`INSERT INTO genealogy_graph_assertions(import_id,subject_id,predicate,value_text,place_text,confidence,status,metadata)
      SELECT r.import_id,r.subject_id,r.predicate,r.value_text,r.place_text,r.confidence,'inherited_claim','{}'::jsonb
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(import_id bigint,subject_id text,predicate text,value_text text,place_text text,confidence double precision) ON CONFLICT DO NOTHING`;
    const edgeRows:Array<Record<string,unknown>>=[]; let parentEdges=0,spouseEdges=0;
    for(const family of document.families){const father=family.husband?mapping.get(family.husband):undefined,mother=family.wife?mapping.get(family.wife):undefined;
      if(father&&mother){edgeRows.push({import_id:importId,source_id:father,target_id:mother,edge_type:'spouse',confidence:0.45,metadata:{family:family.id,marriage:family.marriage??null}});spouseEdges++;}
      for(const childRef of family.children){const child=mapping.get(childRef);if(!child)continue;for(const parent of [father,mother])if(parent){edgeRows.push({import_id:importId,source_id:parent,target_id:child,edge_type:'parent',confidence:0.45,metadata:{family:family.id}});parentEdges++;}}
    }
    for(const batch of batches(edgeRows)) await sql`INSERT INTO genealogy_graph_edges(import_id,source_id,target_id,edge_type,confidence,status,metadata)
      SELECT r.import_id,r.source_id,r.target_id,r.edge_type,r.confidence,'imported',r.metadata
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(import_id bigint,source_id text,target_id text,edge_type text,confidence double precision,metadata jsonb) ON CONFLICT DO NOTHING`;
    const root=chosenRoot; const rootId=root?mapping.get(root.id)??null:null; const summary={people:document.people.length,families:document.families.length,parent_edges:parentEdges,spouse_edges:spouseEdges,reused_nodes:reused,new_nodes:document.people.length-reused,root:root?.name??null};
    await sql`UPDATE genealogy_graph_imports SET status='complete',root_node_id=${rootId},summary=${JSON.stringify(summary)}::jsonb,completed_at=NOW() WHERE id=${importId}`;
    return NextResponse.json({ok:true,importId,summary},{status:201});
  } catch(error:unknown){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
}

export async function PATCH(request:NextRequest) {
  const denied=await gate(); if(denied) return denied;
  try {
    const body=await request.json(),nodeId=String(body.rootNodeId??'').trim();
    if(!nodeId) return NextResponse.json({ok:false,error:'rootNodeId is required'},{status:400});
    const sql=await ensureGraphSchema();
    const imports=await sql`SELECT id,summary FROM genealogy_graph_imports WHERE status='complete' ORDER BY id DESC LIMIT 1`;
    if(!imports[0]) return NextResponse.json({ok:false,error:'No completed GEDCOM import exists'},{status:409});
    const people=await sql`SELECT n.id,n.label FROM genealogy_graph_external_ids x JOIN genealogy_graph_nodes n ON n.id=x.node_id WHERE x.import_id=${imports[0].id} AND x.record_type='person' AND n.id=${nodeId} LIMIT 1`;
    if(!people[0]) return NextResponse.json({ok:false,error:'The selected person is not in the active GEDCOM'},{status:404});
    const summary={...(imports[0].summary??{}),root:people[0].label,root_selected_by:'operator'};
    await sql`UPDATE genealogy_graph_imports SET root_node_id=${nodeId},summary=${JSON.stringify(summary)}::jsonb WHERE id=${imports[0].id}`;
    return NextResponse.json({ok:true,root:{id:nodeId,label:people[0].label},summary});
  } catch(error:unknown) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});
  }
}
