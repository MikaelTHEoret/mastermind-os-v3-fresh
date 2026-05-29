import { NextResponse } from 'next/server';
import { sqlPrimary, sqlMemory } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
    try {
        const [packets, acCount, chunkCount, chat, tps, ping, session] = await Promise.all([
            // Packet breakdown last 5 min with readable names
            sqlPrimary`
                SELECT COALESCE(r.readable_name, p.packet_type) as packet_type,
                       r.category, p.direction, COUNT(*)::int as n
                FROM mc_packet_log p
                LEFT JOIN mc_packet_registry r ON p.packet_type = r.obfuscated_name
                WHERE p.ts > NOW() - INTERVAL '5 minutes'
                GROUP BY 1,2,3 ORDER BY n DESC LIMIT 20
            `,
            // AC correction count
            sqlPrimary`
                SELECT COUNT(*)::int as n FROM mc_ac_responses
                WHERE ts > NOW() - INTERVAL '10 minutes'
            `,
            // Chunk events
            sqlPrimary`
                SELECT event_type, COUNT(*)::int as n FROM mc_chunk_events
                WHERE ts > NOW() - INTERVAL '5 minutes'
                GROUP BY event_type
            `,
            // Recent chat
            sqlPrimary`
                SELECT ts, username, message, is_bot_response, account_type
                FROM mc_chat_log ORDER BY ts DESC LIMIT 10
            `,
            // Latest TPS
            sqlPrimary`
                SELECT AVG(tps)::float as avg_tps, MIN(tps)::float as min_tps
                FROM mc_tps_timeline
                WHERE ts > NOW() - INTERVAL '2 minutes'
            `,
            // Latest ping
            sqlPrimary`
                SELECT AVG(ping_ms)::float as avg_ping
                FROM mc_ping_log
                WHERE ts > NOW() - INTERVAL '2 minutes'
            `,
            // Active session
            sqlMemory`
                SELECT id, context, state, created_at, updated_at
                FROM mirror_core_sessions
                ORDER BY created_at DESC LIMIT 1
            `,
        ]);

        return NextResponse.json({
            ok: true,
            ts: new Date().toISOString(),
            packets,
            ac_count: acCount[0]?.n ?? 0,
            chunk_counts: Object.fromEntries(chunkCount.map((r: any) => [r.event_type, r.n])),
            chat,
            tps: tps[0] ?? { avg_tps: null, min_tps: null },
            ping: ping[0]?.avg_ping ?? null,
            session: session[0] ?? null,
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
