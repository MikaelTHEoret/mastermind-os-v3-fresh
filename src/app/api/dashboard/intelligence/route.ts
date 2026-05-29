import { NextResponse } from 'next/server';
import { getPrimaryDb } from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const sql = getPrimaryDb();
        const [chat, ac, session] = await Promise.all([
            sql`SELECT ts, username, message, is_bot_response, account_type
                FROM mc_chat_log ORDER BY ts DESC LIMIT 20`,
            sql`SELECT COUNT(*)::int as n FROM mc_ac_responses
                WHERE ts > NOW() - INTERVAL '10 minutes'`,
            sql`SELECT id, created_at FROM mirror_core_sessions
                ORDER BY created_at DESC LIMIT 1`.catch(() => []),
        ]);
        return NextResponse.json({ ok: true, ts: new Date().toISOString(), chat, ac_count: ac[0]?.n ?? 0, session: session[0] ?? null });
    } catch(e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
