// Archive layer schema — flat transcript/document store with addresses + embeddings
// Plus archive_ref column on harmonic_memories so curated memories can point into the archive
const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });

(async () => {
    const c = await pool.connect();
    try {
        // Main archive table — one row per chunk of a document/transcript
        await c.query(`
            CREATE TABLE IF NOT EXISTS transcript_archive (
                address      TEXT PRIMARY KEY,            -- stable: source/relpath/chunk-NNNN
                source_type  TEXT,                        -- 'transcript' | 'document' | 'code' | 'data'
                source_path  TEXT,                        -- original file path
                doc_id       TEXT,                        -- groups chunks from same file
                chunk_index  INT,                         -- ordinal within the doc
                topic_tags   TEXT[],                      -- semantic tags (the "topical" address)
                title        TEXT,                        -- doc title / first heading
                content      TEXT,                        -- the raw chunk text
                embedding    VECTOR(768),                 -- nomic-embed-text
                char_count   INT,
                created_at   TIMESTAMPTZ DEFAULT NOW(),
                doc_mtime    TIMESTAMPTZ                  -- original file modified time
            )
        `);
        console.log("transcript_archive table created");

        // Indexes: address lookup is PK already; add doc grouping, tag GIN, vector
        await c.query(`CREATE INDEX IF NOT EXISTS idx_archive_doc ON transcript_archive (doc_id)`);
        await c.query(`CREATE INDEX IF NOT EXISTS idx_archive_tags ON transcript_archive USING GIN (topic_tags)`);
        await c.query(`CREATE INDEX IF NOT EXISTS idx_archive_type ON transcript_archive (source_type)`);
        // ivfflat vector index — lists tuned for expected scale
        await c.query(`CREATE INDEX IF NOT EXISTS idx_archive_embed ON transcript_archive
                       USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`).catch(e => console.log("vector idx note:", e.message));
        console.log("Indexes created");

        // Link column on harmonic_memories — a curated memory can cite an archive address
        await c.query(`ALTER TABLE harmonic_memories ADD COLUMN IF NOT EXISTS archive_ref TEXT`);
        console.log("harmonic_memories.archive_ref column added");

        // Tracking table so re-runs can skip already-indexed files (idempotent big job)
        await c.query(`
            CREATE TABLE IF NOT EXISTS archive_index_log (
                source_path TEXT PRIMARY KEY,
                doc_id      TEXT,
                chunks      INT,
                status      TEXT,                          -- 'done' | 'error' | 'skipped'
                error       TEXT,
                indexed_at  TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log("archive_index_log table created");

        console.log("SCHEMA COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
