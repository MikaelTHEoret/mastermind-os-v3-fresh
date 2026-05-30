// Phase 2 — compound multi-dimensional addressing
// Adds semantic-coordinate columns to transcript_archive WITHOUT touching the
// physical address PK (file#chunk-NNNN). Three independently-queryable dimensions:
//   bloom_path  (text)   project/component/subject  -> tree descent
//   addr_time   (date)   temporal dimension          -> time jump/range
//   core_hash   (text)   stable concept identity     -> direct match / dedup
// The full compound address is reconstructable as:
//   path:<bloom_path> | t:<addr_time> | core:<core_hash>
const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });

(async () => {
    const c = await pool.connect();
    try {
        await c.query(`ALTER TABLE transcript_archive ADD COLUMN IF NOT EXISTS bloom_path TEXT`);
        await c.query(`ALTER TABLE transcript_archive ADD COLUMN IF NOT EXISTS addr_time DATE`);
        await c.query(`ALTER TABLE transcript_archive ADD COLUMN IF NOT EXISTS core_hash TEXT`);
        console.log("Columns added: bloom_path, addr_time, core_hash");

        // Indexes for each navigable dimension
        // bloom_path: text_pattern_ops so LIKE 'B/auth/%' prefix descent is fast
        await c.query(`CREATE INDEX IF NOT EXISTS idx_archive_bloom ON transcript_archive (bloom_path text_pattern_ops)`);
        await c.query(`CREATE INDEX IF NOT EXISTS idx_archive_time ON transcript_archive (addr_time)`);
        await c.query(`CREATE INDEX IF NOT EXISTS idx_archive_core ON transcript_archive (core_hash)`);
        console.log("Indexes created: bloom (prefix), time, core");

        // Same compound dimensions on the curated layer, so a memory's archive_ref
        // can itself be navigated, and curated memories get bloom paths too.
        await c.query(`ALTER TABLE harmonic_memories ADD COLUMN IF NOT EXISTS bloom_path TEXT`);
        await c.query(`ALTER TABLE harmonic_memories ADD COLUMN IF NOT EXISTS core_hash TEXT`);
        await c.query(`CREATE INDEX IF NOT EXISTS idx_mem_bloom ON harmonic_memories (bloom_path text_pattern_ops)`);
        console.log("harmonic_memories: bloom_path + core_hash added");

        console.log("PHASE2 SCHEMA COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
