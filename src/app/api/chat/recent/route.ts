import { NextResponse } from 'next/server';
import { getPrimaryDb } from '@/lib/db';
import { chatAccessError } from '../_boundary';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const denied = await chatAccessError(req);
    if(denied) return denied;
    const sqlPrimary = getPrimaryDb();
    const { searchParams } = new URL(req.url);
    const minutes = parseInt(searchParams.get('minutes') ?? '30');
    const rows = await sqlPrimary`
        SELECT ts, username, message, is_bot_response, account_type, response_latency_ms
        FROM mc_chat_log
        WHERE ts > NOW() - (${minutes} || ' minutes')::interval
        ORDER BY ts DESC LIMIT 100
    `;
    return NextResponse.json({ ok: true, messages: rows });
}
