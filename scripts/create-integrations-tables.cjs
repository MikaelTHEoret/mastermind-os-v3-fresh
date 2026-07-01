// scripts/create-integrations-tables.cjs
// Adds two tables, distinct from mastermind_api_keys (which is for keys Mastermind ISSUES).
//   mastermind_integrations -> provider credentials / env-vars Mastermind CONSUMES (Vercel-style manager)
//   mastermind_settings     -> all other configurable settings from the Settings tab
// DSN is read from .env.local (no second hardcoded copy of the secret).
const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

function dsn() {
  if (process.env.NEON_PRIMARY_URL) return process.env.NEON_PRIMARY_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, "..", ".env.local");
  const txt = fs.readFileSync(envPath, "utf8");
  const m = txt.match(/^\s*(?:NEON_PRIMARY_URL|DATABASE_URL|NEON_MEMORY_URL)\s*=\s*(.+)$/m);
  if (!m) throw new Error("No Neon DSN found in env or .env.local");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

(async () => {
  const sql = neon(dsn());
  console.log("Creating mastermind_integrations ...");
  await sql`
    CREATE TABLE IF NOT EXISTS mastermind_integrations (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      provider_id TEXT NOT NULL,
      env_key TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT 'app',
      environment TEXT NOT NULL DEFAULT 'all',
      value_encrypted TEXT,
      value_plain TEXT,
      value_masked TEXT,
      is_secret BOOLEAN NOT NULL DEFAULT true,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used TIMESTAMPTZ,
      CONSTRAINT uq_integration UNIQUE (user_id, env_key, environment)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_integrations_user ON mastermind_integrations(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_integrations_provider ON mastermind_integrations(provider_id)`;
  console.log("  ok");

  console.log("Creating mastermind_settings ...");
  await sql`
    CREATE TABLE IF NOT EXISTS mastermind_settings (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      section TEXT NOT NULL,
      key TEXT NOT NULL,
      value JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_setting UNIQUE (user_id, section, key)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_settings_section ON mastermind_settings(section)`;
  console.log("  ok");

  const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_name IN ('mastermind_integrations','mastermind_settings') ORDER BY table_name`;
  console.log("VERIFIED tables present:", t.map(r => r.table_name).join(", "));
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });

