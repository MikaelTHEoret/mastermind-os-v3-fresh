import { NextResponse } from 'next/server';
import { resolveProposal } from '@/lib/nexus';

export const dynamic = 'force-dynamic';

// The gate. The operator approves or dismisses a proposal; the nexus does not
// act on the machine autonomously. 'approve' records intent; the actual action
// for a given proposal kind attaches here in a later, deliberate step.
export async function POST(req: Request) {
    try {
        const { id, action } = await req.json();
        if (!id || (action !== 'approve' && action !== 'dismiss')) {
            return NextResponse.json({ ok: false, error: 'need {id, action: approve|dismiss}' }, { status: 400 });
        }
        const r = await resolveProposal(Number(id), action);
        return NextResponse.json({ ok: true, ...r });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
