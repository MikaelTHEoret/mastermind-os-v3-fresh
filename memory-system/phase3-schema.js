// Phase 3 schema — the fractal node tree.
// fractal_nodes: the navigable tree. Each node holds a centroid (the "key" for
// descent), its path, level, chunk count, and leaf flag. Leaves are reachable
// targets; a chunk's bloom_path = its leaf node's path.
const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });
(async () => {
    const c = await pool.connect();
    try {
        // Drop any prior draft so rebuilds are clean
        await c.query(`DROP TABLE IF EXISTS fractal_nodes`);
        await c.query(`
            CREATE TABLE fractal_nodes (
                node_id     SERIAL PRIMARY KEY,
                path        TEXT UNIQUE NOT NULL,      -- full bloom path from root
                name        TEXT,                       -- last segment (curatable label)
                parent_path TEXT,                       -- path of parent (null for top level)
                depth       INT,
                is_leaf     BOOLEAN,
                n_chunks    INT,
                coherence   REAL,
                centroid    VECTOR(768),                -- the descent key
                label_override TEXT                     -- curated name, overrides auto label
            )`);
        await c.query(`CREATE INDEX idx_fn_parent ON fractal_nodes (parent_path)`);
        await c.query(`CREATE INDEX idx_fn_path ON fractal_nodes (path text_pattern_ops)`);
        await c.query(`CREATE INDEX idx_fn_centroid ON fractal_nodes USING ivfflat (centroid vector_cosine_ops) WITH (lists=20)`).catch(e=>console.log("centroid idx note:",e.message));
        await c.query(`CREATE INDEX idx_fn_leaf ON fractal_nodes (is_leaf)`);
        console.log("fractal_nodes table created");
        console.log("PHASE3 SCHEMA COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
