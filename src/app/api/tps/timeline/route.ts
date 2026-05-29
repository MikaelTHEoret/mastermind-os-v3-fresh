import { NextResponse } from 'next/server';
import { sqlPrimary } from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function GET() {
    const rows = await sqlPrimary`
        SELECT ts, tps, game_time, wall_delta_ms
        FROM mc_tps_timeline
        ORDER BY ts DESC LIMIT 200
    `;
    return NextResponse.json({ ok: true, timeline: rows.reverse() });
}
