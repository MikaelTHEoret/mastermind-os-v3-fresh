// Migration: add layer + priority + project columns to harmonic_memories
// Non-destructive — existing 33 memories keep working, get classified
const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });

(async () => {
    const c = await pool.connect();
    try {
        // 1. Add columns
        await c.query(`ALTER TABLE harmonic_memories ADD COLUMN IF NOT EXISTS layer TEXT DEFAULT 'project'`);
        await c.query(`ALTER TABLE harmonic_memories ADD COLUMN IF NOT EXISTS project TEXT`);
        await c.query(`ALTER TABLE harmonic_memories ADD COLUMN IF NOT EXISTS priority INT DEFAULT 5`);
        await c.query(`ALTER TABLE harmonic_memories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
        console.log("Columns added: layer, project, priority, updated_at");

        // 2. Classify existing memories by their tags
        // Identity layer
        await c.query(`UPDATE harmonic_memories SET layer='identity', priority=9
                       WHERE 'identity' = ANY(tags)`);
        // Toolbox layer — infrastructure, tools, credentials
        await c.query(`UPDATE harmonic_memories SET layer='toolbox', priority=8
                       WHERE ('infrastructure'=ANY(tags) OR 'neon'=ANY(tags) OR 'credentials'=ANY(tags)
                              OR 'memory-system'=ANY(tags) OR 'vectors'=ANY(tags) OR 'session-logger'=ANY(tags))
                       AND layer != 'identity'`);
        // Project layer — mastermind/2b2t
        await c.query(`UPDATE harmonic_memories SET layer='project', project='mastermind'
                       WHERE ('mastermind'=ANY(tags) OR '2b2t'=ANY(tags) OR 'minecraft'=ANY(tags)
                              OR 'mastermind-client'=ANY(tags) OR 'backend-topology'=ANY(tags)
                              OR 'fabric'=ANY(tags) OR 'tps'=ANY(tags))
                       AND layer NOT IN ('identity','toolbox')`);
        // Codex project
        await c.query(`UPDATE harmonic_memories SET layer='project', project='codex'
                       WHERE 'codex'=ANY(tags) AND layer NOT IN ('identity','toolbox')`);
        console.log("Existing 33 memories classified into layers");

        // 3. Index for fast layer/project filtering
        await c.query(`CREATE INDEX IF NOT EXISTS idx_harmonic_layer ON harmonic_memories (layer)`);
        await c.query(`CREATE INDEX IF NOT EXISTS idx_harmonic_project ON harmonic_memories (project)`);
        console.log("Indexes created");

        // 4. Report distribution
        const dist = await c.query(`SELECT layer, COALESCE(project,'-') proj, COUNT(*) n
                                    FROM harmonic_memories GROUP BY layer, project ORDER BY layer`);
        console.log("\n=== Layer distribution ===");
        dist.rows.forEach(r => console.log(`  ${r.layer.padEnd(10)} ${r.proj.padEnd(12)} ${r.n}`));
        console.log("\nMIGRATION COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
