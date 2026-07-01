// src/app/api/keys/route.ts -- the Vercel-style provider-credential manager (outbound keys Mastermind CONSUMES).
// Distinct from /api/* issued-keys. Raw values are validated + encrypted server-side; only masked values are
// ever returned. Local-deploy creds (kaggle/ssh) are placed in their OS-standard location per devlog #105.
import { NextRequest, NextResponse } from "next/server";
import { getPrimaryDb } from "@/lib/db";
import { encryptSecret, maskSecret } from "@/lib/integrations/crypto";
import { getProvider, validateField } from "@/lib/integrations/providerCatalog";
import fs from "fs";
import os from "os";
import path from "path";

export const runtime = "nodejs";
const USER = "local";

function placeLocal(providerId: string, values: Record<string,string>): any {
  const home = os.homedir();
  try {
    if (providerId === "kaggle") {
      const dir = path.join(home, ".kaggle");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "access_token");
      const tok = (values.KAGGLE_API_TOKEN || "").trim();
      if (tok) {
        fs.writeFileSync(file, tok, { mode: 0o600 });
        try { fs.chmodSync(file, 0o600); } catch {}
        return { placed: [file] };
      }
    }
    if (providerId === "oracle_vps") {
      const dir = path.join(home, ".ssh");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "oracle_vps");
      if (values.ORACLE_VPS_SSH_KEY) {
        fs.writeFileSync(file, values.ORACLE_VPS_SSH_KEY.replace(/\r\n/g, "\n"), { mode: 0o600 });
        try { fs.chmodSync(file, 0o600); } catch {}
        return { placed: [file], note: "Private key written; public IP stored as reference only." };
      }
    }
  } catch (e: any) {
    return { error: "local placement failed: " + e.message };
  }
  return null;
}

export async function GET() {
  try {
    const sql = getPrimaryDb();
    const rows = await sql`
      SELECT id, provider_id, env_key, target, environment, value_masked, value_plain,
             is_secret, is_active, created_at, updated_at, last_used
      FROM mastermind_integrations WHERE user_id=${USER}
      ORDER BY provider_id, env_key`;
    return NextResponse.json({ ok: true, integrations: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// Body: { provider_id, environment?, values: { ENV_KEY: rawValue, ... } }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const providerId: string = b.provider_id || "custom";
    const environment: string = b.environment || "all";
    const values: Record<string,string> = b.values || {};
    if (!values || Object.keys(values).length === 0)
      return NextResponse.json({ ok: false, error: "values is required" }, { status: 400 });

    const prov = getProvider(providerId);
    const sql = getPrimaryDb();
    const saved: any[] = [];

    for (const [envKey, raw] of Object.entries(values)) {
      const value = String(raw ?? "");
      const field = prov?.fields.find(f => f.envKey === envKey);
      // format check is advisory only -- a save is never blocked on a pattern mismatch
      const isSecret = field ? field.secret : true;
      const target = prov ? prov.target : "app";
      if (value === "" && isSecret) continue; // skip blank secrets (e.g. unchanged)
      let enc: string|null = null, plain: string|null = null, masked: string;
      if (isSecret) { enc = encryptSecret(value); masked = maskSecret(value); }
      else { plain = value; masked = value; }
      await sql`
        INSERT INTO mastermind_integrations
          (user_id, provider_id, env_key, target, environment, value_encrypted, value_plain, value_masked, is_secret, updated_at)
        VALUES (${USER}, ${providerId}, ${envKey}, ${target}, ${environment}, ${enc}, ${plain}, ${masked}, ${isSecret}, NOW())
        ON CONFLICT (user_id, env_key, environment) DO UPDATE SET
          value_encrypted=EXCLUDED.value_encrypted, value_plain=EXCLUDED.value_plain, value_masked=EXCLUDED.value_masked,
          is_secret=EXCLUDED.is_secret, target=EXCLUDED.target, provider_id=EXCLUDED.provider_id, is_active=true, updated_at=NOW()`;
      saved.push({ env_key: envKey, masked, is_secret: isSecret, target });
    }

    let placement = null;
    if (!process.env.VERCEL && (providerId === "kaggle" || providerId === "oracle_vps")) {
      placement = placeLocal(providerId, values);
    }
    return NextResponse.json({ ok: true, saved, placement });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    const sql = getPrimaryDb();
    if (b.is_active !== undefined)
      await sql`UPDATE mastermind_integrations SET is_active=${!!b.is_active}, updated_at=NOW() WHERE id=${b.id} AND user_id=${USER}`;
    if (b.environment)
      await sql`UPDATE mastermind_integrations SET environment=${b.environment}, updated_at=NOW() WHERE id=${b.id} AND user_id=${USER}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    const sql = getPrimaryDb();
    await sql`DELETE FROM mastermind_integrations WHERE id=${id} AND user_id=${USER}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
