import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

import { getMemoryDb } from '@/lib/db';
import { readArchiveImage } from '@/lib/genealogy/archive-store.mjs';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (ownerGateConfigured()) { const result = await requireOwner(); if (!result.ok) return NextResponse.json({ ok:false,error:result.reason },{status:result.status}); }
  try {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ ok:false,error:'Invalid HTR line.' },{status:400});
    const sql = getMemoryDb();
    const [line] = await sql`SELECT line.bbox_x,line.bbox_y,line.bbox_width,line.bbox_height,asset.storage_key FROM genealogy_htr_lines line JOIN genealogy_page_assets pa ON pa.page_id=line.page_id AND pa.role='original' JOIN genealogy_archive_assets asset ON asset.sha256=pa.asset_sha256 WHERE line.id=${id} ORDER BY pa.captured_at DESC LIMIT 1`;
    if (!line) return NextResponse.json({ok:false,error:'HTR line not found.'},{status:404});
    const source = await readArchiveImage(line.storage_key);
    const metadata = await sharp(source).metadata();
    const left = Math.max(0, Math.min(Number(line.bbox_x)||0, Math.max(0,(metadata.width||1)-1)));
    const top = Math.max(0, Math.min(Number(line.bbox_y)||0, Math.max(0,(metadata.height||1)-1)));
    const width = Math.max(1, Math.min(Number(line.bbox_width)||1,(metadata.width||1)-left));
    const height = Math.max(1, Math.min(Number(line.bbox_height)||1,(metadata.height||1)-top));
    const image = await sharp(source).extract({left,top,width,height}).grayscale().normalize().jpeg({quality:92}).toBuffer();
    return new NextResponse(image,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=3600'}});
  } catch(error:unknown) { return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500}); }
}
