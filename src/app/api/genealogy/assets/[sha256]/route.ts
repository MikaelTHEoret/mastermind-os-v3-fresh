import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import { readArchiveImage } from '@/lib/genealogy/archive-store.mjs';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHA256 = /^[a-f0-9]{64}$/;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export async function GET(request: NextRequest, context: { params: Promise<{ sha256: string }> }) {
  if (process.env.VERCEL || !LOCAL_HOSTS.has(request.nextUrl.hostname)) {
    return NextResponse.json({ ok: false, error: 'Private archive assets are served only by the local Mastermind node.' }, { status: 403 });
  }
  if (ownerGateConfigured()) {
    const owner = await requireOwner();
    if (!owner.ok) return NextResponse.json({ ok: false, error: owner.reason }, { status: owner.status });
  }
  const { sha256 } = await context.params;
  if (!SHA256.test(sha256)) return NextResponse.json({ ok: false, error: 'Invalid asset digest.' }, { status: 400 });
  try {
    const sql = getMemoryDb();
    const rows = await sql`SELECT storage_key,media_type,byte_size FROM genealogy_archive_assets WHERE sha256=${sha256} LIMIT 1`;
    const asset = rows[0];
    if (!asset) return NextResponse.json({ ok: false, error: 'Archive asset not found.' }, { status: 404 });
    const bytes = await readArchiveImage(asset.storage_key);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': asset.media_type,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="${sha256}.${asset.media_type === 'image/png' ? 'png' : 'jpg'}"`,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
