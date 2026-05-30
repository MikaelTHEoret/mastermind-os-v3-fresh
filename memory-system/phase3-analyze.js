const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });
(async () => {
    const c = await pool.connect();
    try {
        // Document-level view: how many docs, chunk distribution
        const docs = await c.query(`
            SELECT doc_id, COUNT(*) chunks, MAX(source_type) stype,
                   (array_agg(DISTINCT t))[1:5] AS some_tags
            FROM transcript_archive, unnest(topic_tags) t
            GROUP BY doc_id ORDER BY chunks DESC`);
        console.log(`Total docs: ${docs.rows.length}`);
        console.log(`\nLargest 15 docs (these dominate and need sub-structure):`);
        docs.rows.slice(0,15).forEach(r =>
            console.log(`  ${String(r.chunks).padStart(4)}ch  ${r.doc_id.slice(0,70)}`));

        // Chunk count distribution
        const buckets = {big:0, med:0, small:0};
        docs.rows.forEach(r => {
            const n = +r.chunks;
            if (n >= 100) buckets.big++; else if (n >= 20) buckets.med++; else buckets.small++;
        });
        console.log(`\nDoc size distribution: ${buckets.big} big(>=100ch), ${buckets.med} med(20-99), ${buckets.small} small(<20)`);

        // The codex problem: how many docs carry codex as a tag
        const codex = await c.query(`
            SELECT COUNT(DISTINCT doc_id) docs, COUNT(*) chunks
            FROM transcript_archive WHERE 'codex' = ANY(topic_tags)`);
        console.log(`\n'codex' tag spans ${codex.rows[0].docs} docs / ${codex.rows[0].chunks} chunks — too broad, needs embedding sub-clustering`);

        // How many docs have embeddings (needed for centroid clustering)
        const emb = await c.query(`SELECT COUNT(DISTINCT doc_id) n FROM transcript_archive WHERE embedding IS NOT NULL`);
        console.log(`Docs with embeddings: ${emb.rows[0].n}`);
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
