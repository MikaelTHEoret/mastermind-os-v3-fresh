import { NextResponse } from 'next/server';
import { getPrimaryDb } from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const sqlPrimary = getPrimaryDb();
    const sqlMemory = getMemoryDb();
    const { searchParams } = new URL(req.url);
    const minutes = parseInt(searchParams.get('minutes') ?? '60');
    const rows = await sqlPrimary`
        SELECT ts, event_type, chunk_x, chunk_z,
               chunk_x * 16 as world_x,
               chunk_z * 16 as world_z
        FROM mc_chunk_events
        WHERE ts > NOW() - (${minutes} || ' minutes')::interval
        ORDER BY ts DESC LIMIT 5000
    `;
    return NextResponse.json({ ok: true, events: rows });
}
