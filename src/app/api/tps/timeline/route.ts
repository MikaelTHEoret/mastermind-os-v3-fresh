import { NextResponse } from 'next/server';
import { getPrimaryDb } from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const sql = getPrimaryDb();
        const rows = await sql`
            SELECT ts, tps FROM mc_tps_timeline
            ORDER BY ts DESC LIMIT 200
        `;
        return NextResponse.json({ ok: true, timeline: rows.reverse() });
    } catch(e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
