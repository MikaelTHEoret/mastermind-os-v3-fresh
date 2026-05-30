const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });
(async () => {
    const c = await pool.connect();
    try {
        const cnt = await c.query(`SELECT COUNT(*) n FROM transcript_archive`);
        const wEmb = await c.query(`SELECT COUNT(*) n FROM transcript_archive WHERE embedding IS NOT NULL`);
        const docs = await c.query(`SELECT COUNT(DISTINCT doc_id) n FROM transcript_archive`);
        const logd = await c.query(`SELECT status, COUNT(*) n FROM archive_index_log GROUP BY status`);
        console.log("Archive chunks:", cnt.rows[0].n, "| with embedding:", wEmb.rows[0].n, "| docs:", docs.rows[0].n);
        console.log("Index log:", JSON.stringify(logd.rows));
        const sample = await c.query(`SELECT address, source_type, topic_tags, char_count FROM transcript_archive ORDER BY created_at DESC LIMIT 5`);
        console.log("\nRecent chunks:");
        sample.rows.forEach(r => console.log(`  [${r.source_type}] ${r.address}  tags=${(r.topic_tags||[]).join(',')}  ${r.char_count}c`));
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
