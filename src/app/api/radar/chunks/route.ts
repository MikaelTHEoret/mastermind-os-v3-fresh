import { NextResponse } from 'next/server';
import { getPrimaryDb } from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const minutes = parseInt(searchParams.get('minutes') ?? '15');
        const sql = getPrimaryDb();
        const rows = await sql`
            SELECT ts, event_type,
                   chunk_x * 16 as world_x,
                   chunk_z * 16 as world_z
            FROM mc_chunk_events
            WHERE ts > NOW() - (${minutes} || ' minutes')::interval
            ORDER BY ts DESC LIMIT 5000
        `;
        return NextResponse.json({ ok: true, events: rows });
    } catch(e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
