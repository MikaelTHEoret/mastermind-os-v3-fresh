import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

async function gate():Promise<NextResponse|null>{
  if(!ownerGateConfigured()) return null;
  const result=await requireOwner();
  return result.ok?null:NextResponse.json({ok:false,error:result.reason},{status:result.status});
}

export async function GET(request:NextRequest) {
  const denied=await gate(); if(denied) return denied;
  try {
    const q=(request.nextUrl.searchParams.get('q')??'').trim().slice(0,160);
    if(q.length<2) return NextResponse.json({ok:true,results:[]});
    const like=`%${q}%`,sql=getMemoryDb();
    const rows=await sql`SELECT DISTINCT n.id,n.label,n.branch,n.proof_strength,n.review_status,n.metadata
      FROM genealogy_graph_imports i
      JOIN genealogy_graph_external_ids x ON x.import_id=i.id AND x.record_type='person'
      JOIN genealogy_graph_nodes n ON n.id=x.node_id
      WHERE i.id=(SELECT id FROM genealogy_graph_imports WHERE status='complete' ORDER BY id DESC LIMIT 1)
        AND (n.label ILIKE ${like} OR n.metadata->>'surname' ILIKE ${like} OR n.metadata->>'given' ILIKE ${like} OR n.metadata->'birth'->>'place' ILIKE ${like})
      ORDER BY n.proof_strength DESC,n.label LIMIT 40`;
    return NextResponse.json({ok:true,results:rows});
  } catch(error:unknown) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});
  }
}

