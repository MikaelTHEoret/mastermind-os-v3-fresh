import { NextResponse } from 'next/server';
import { tick } from '@/lib/nexus';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// One heartbeat of the nexus. Driven by the GUI poll, a Vercel cron, or a
// local heartbeat loop — whichever is running. GET and POST both beat.
async function beat() {
    try {
        const result = await tick();
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
export async function GET() { return beat(); }
export async function POST() { return beat(); }
