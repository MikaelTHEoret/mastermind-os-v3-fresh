import { NextResponse } from 'next/server';
import { getPrimaryDb } from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function GET() {
    const sqlPrimary = getPrimaryDb();
    const [corrections, kicks] = await Promise.all([
        sqlPrimary`
            SELECT ts, ac_response, delta_ms
            FROM mc_ac_responses
            WHERE trigger_type = 'position_correction'
            ORDER BY ts DESC LIMIT 50
        `,
        sqlPrimary`
            SELECT ts, ac_response
            FROM mc_ac_responses
            WHERE trigger_type = 'kick'
            ORDER BY ts DESC LIMIT 20
        `,
    ]);
    return NextResponse.json({ ok: true, corrections, kicks });
}
