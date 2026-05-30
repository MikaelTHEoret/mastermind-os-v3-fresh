// Provenance dimension — add source_authority + content_hash to transcript_archive
// so the system can rank code-derived > doc-stated > transcript-quoted, per the
// governing provenance principle. Also a documents-level provenance table.
const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });
(async () => {
    const c = await pool.connect();
    try {
        // provenance/confidence on each chunk
        await c.query(`ALTER TABLE transcript_archive ADD COLUMN IF NOT EXISTS source_authority TEXT`);
        // authority levels (highest->lowest): 'code' > 'datasheet' > 'document' > 'transcript-claim' > 'transcript-ai'
        await c.query(`ALTER TABLE transcript_archive ADD COLUMN IF NOT EXISTS authority_rank INT`);
        // flags for audit: is this a quoted value that may be AI drift?
        await c.query(`ALTER TABLE transcript_archive ADD COLUMN IF NOT EXISTS audit_flag TEXT`);
        await c.query(`CREATE INDEX IF NOT EXISTS idx_archive_authority ON transcript_archive (authority_rank)`);
        console.log("transcript_archive: source_authority, authority_rank, audit_flag added");

        // Backfill existing chunks with a default authority by source_type
        // code=10, data/datasheet=8, document=6, transcript=3 (transcripts are lowest — most drift-prone)
        await c.query(`UPDATE transcript_archive SET authority_rank = CASE source_type
            WHEN 'code' THEN 10 WHEN 'data' THEN 8 WHEN 'document' THEN 6 WHEN 'transcript' THEN 3 ELSE 4 END,
            source_authority = CASE source_type
            WHEN 'code' THEN 'code' WHEN 'data' THEN 'datasheet' WHEN 'document' THEN 'document'
            WHEN 'transcript' THEN 'transcript' ELSE 'unknown' END
            WHERE authority_rank IS NULL`);
        const r = await c.query(`SELECT source_authority, authority_rank, COUNT(*) n FROM transcript_archive GROUP BY 1,2 ORDER BY authority_rank DESC`);
        console.log("Authority distribution:");
        r.rows.forEach(x => console.log(`  ${x.source_authority} (rank ${x.authority_rank}): ${x.n}`));

        // Document-level provenance registry — tracks the authoritative source for a concept/constant
        await c.query(`
            CREATE TABLE IF NOT EXISTS provenance_registry (
                id          SERIAL PRIMARY KEY,
                concept     TEXT,            -- e.g. 'psi_0', 'genesis_equation', 'phi'
                claimed_value TEXT,          -- value as found
                authority   TEXT,            -- 'code'|'datasheet'|'document'|'transcript'
                authority_rank INT,
                source_address TEXT,         -- archive address where found
                is_computed BOOLEAN,         -- true if derived by code vs quoted
                note        TEXT,
                logged_at   TIMESTAMPTZ DEFAULT NOW()
            )`);
        console.log("provenance_registry table created");
        console.log("PROVENANCE SCHEMA COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
