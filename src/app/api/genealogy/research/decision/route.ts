import { NextRequest,NextResponse } from 'next/server';
import { getMemoryDb } from '@/lib/db';
import { decideResearch,type ResearchPerson } from '@/lib/genealogy/research-decision';
import { requireOwner,ownerGateConfigured } from '@/lib/trading/auth';

export const runtime='nodejs'; export const dynamic='force-dynamic';
async function gate(){if(!ownerGateConfigured())return null;const result=await requireOwner();return result.ok?null:NextResponse.json({ok:false,error:result.reason},{status:result.status});}
async function ensureSchema(){const sql=getMemoryDb();await sql`CREATE TABLE IF NOT EXISTS genealogy_research_decisions (
  id BIGSERIAL PRIMARY KEY,import_id BIGINT NOT NULL REFERENCES genealogy_graph_imports(id) ON DELETE CASCADE,
  vantage JSONB NOT NULL,algorithm_version TEXT NOT NULL,selected_frontier_id TEXT NOT NULL,selected_node_id TEXT,
  score DOUBLE PRECISION NOT NULL,status TEXT NOT NULL DEFAULT 'proposed',candidates JSONB NOT NULL,mission JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),superseded_at TIMESTAMPTZ
)`;await sql`CREATE INDEX IF NOT EXISTS genealogy_research_decisions_import_idx ON genealogy_research_decisions(import_id,created_at DESC)`;return sql;}
async function latest(sql:ReturnType<typeof getMemoryDb>){const rows=await sql`SELECT * FROM genealogy_research_decisions WHERE import_id=(SELECT id FROM genealogy_graph_imports WHERE status='complete' ORDER BY id DESC LIMIT 1) AND superseded_at IS NULL ORDER BY id DESC LIMIT 1`;return rows[0]??null;}

export async function GET(){const denied=await gate();if(denied)return denied;try{const sql=await ensureSchema();return NextResponse.json({ok:true,decision:await latest(sql)});}catch(error:unknown){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}}

export async function POST(request:NextRequest){const denied=await gate();if(denied)return denied;try{
  const body=await request.json().catch(()=>({}));if(body.action&&body.action!=='decide')return NextResponse.json({ok:false,error:'Unsupported action'},{status:400});
  const sql=await ensureSchema();const imports=await sql`SELECT id,root_node_id FROM genealogy_graph_imports WHERE status='complete' ORDER BY id DESC LIMIT 1`;if(!imports[0])return NextResponse.json({ok:false,error:'Import a GEDCOM before asking CORE to choose a mission'},{status:409});
  const importId=imports[0].id,rootId=String(imports[0].root_node_id??'');
  const rows=await sql`SELECT n.id,n.label,n.branch,n.proof_strength,n.review_status,n.metadata FROM genealogy_graph_external_ids x JOIN genealogy_graph_nodes n ON n.id=x.node_id WHERE x.import_id=${importId} AND x.record_type='person'`;
  const edges=await sql`SELECT source_id,target_id FROM genealogy_graph_edges WHERE import_id=${importId} AND edge_type='parent' AND status<>'research_scaffold'`;
  const parents=new Map<string,string[]>();for(const edge of edges){const child=String(edge.target_id),values=parents.get(child)??[];values.push(String(edge.source_id));parents.set(child,values);}
  const depth=new Map<string,number>();const queue:string[]=[];if(rootId){depth.set(rootId,1);queue.push(rootId);}while(queue.length){const child=queue.shift()!;for(const parent of parents.get(child)??[])if(!depth.has(parent)){depth.set(parent,(depth.get(child)??0)+1);queue.push(parent);}}
  const people:ResearchPerson[]=rows.filter((row)=>depth.has(String(row.id))).map((row)=>({id:String(row.id),label:String(row.label),branch:String(row.branch??'unresolved'),proofStrength:Number(row.proof_strength),reviewStatus:String(row.review_status),depth:depth.get(String(row.id))??0,metadata:row.metadata??{}}));
  const result=decideResearch(people);await sql`UPDATE genealogy_research_decisions SET superseded_at=NOW() WHERE import_id=${importId} AND superseded_at IS NULL`;
  const inserted=await sql`INSERT INTO genealogy_research_decisions(import_id,vantage,algorithm_version,selected_frontier_id,selected_node_id,score,status,candidates,mission)
    VALUES (${importId},${JSON.stringify(result.vantage)}::jsonb,'goal-attraction-v1',${result.selected.frontierId},${result.selected.nodeId},${result.selected.score},'proposed',${JSON.stringify(result.candidates)}::jsonb,${JSON.stringify(result.mission)}::jsonb) RETURNING *`;
  return NextResponse.json({ok:true,decision:inserted[0]},{status:201});
}catch(error:unknown){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}}
