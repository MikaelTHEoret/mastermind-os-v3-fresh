// src/app/api/settings/route.ts -- persistence for every non-credential Settings-tab knob.
import { NextRequest, NextResponse } from "next/server";
import { getPrimaryDb } from "@/lib/db";
export const runtime = "nodejs";
const USER = "local";

export async function GET() {
  try {
    const sql = getPrimaryDb();
    const rows = await sql`SELECT section, key, value FROM mastermind_settings WHERE user_id=${USER}`;
    const out: Record<string, Record<string, any>> = {};
    for (const r of rows as any[]) { (out[r.section] = out[r.section] || {})[r.key] = r.value; }
    return NextResponse.json({ ok: true, settings: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// Body: { section, key, value }  OR  { settings: [ {section,key,value}, ... ] }
export async function PUT(req: NextRequest) {
  try {
    const b = await req.json();
    const items = Array.isArray(b.settings) ? b.settings : [b];
    const sql = getPrimaryDb();
    for (const it of items) {
      await sql`
        INSERT INTO mastermind_settings (user_id, section, key, value, updated_at)
        VALUES (${USER}, ${it.section}, ${it.key}, ${JSON.stringify(it.value)}::jsonb, NOW())
        ON CONFLICT (user_id, section, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`;
    }
    return NextResponse.json({ ok: true, saved: items.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
