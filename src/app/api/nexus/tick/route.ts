import { NextResponse } from 'next/server';
import { tick } from '@/lib/nexus';
import { chatAccessError } from '../../chat/_boundary';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// A heartbeat writes proposals and memory. Reading this URL never starts work.
async function beat() {
    try {
        const result = await tick();
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
export async function GET() {
    return NextResponse.json({ ok: false, code: 'POST_REQUIRED' }, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
    const denied = await chatAccessError(request); if (denied) return denied;
    return beat();
}
