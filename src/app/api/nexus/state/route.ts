import { NextResponse } from 'next/server';
import { state } from '@/lib/nexus';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
    try {
        const s = await state();
        return NextResponse.json({ ok: true, ...s });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
