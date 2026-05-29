import { NextResponse } from 'next/server';
import { getPrimaryDb } from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function GET() {
    const sqlPrimary = getPrimaryDb();
    const sqlMemory = getMemoryDb();
    const rows = await sqlPrimary`
        SELECT ts, tps, game_time, wall_delta_ms
        FROM mc_tps_timeline
        ORDER BY ts DESC LIMIT 200
    `;
    return NextResponse.json({ ok: true, timeline: rows.reverse() });
}
