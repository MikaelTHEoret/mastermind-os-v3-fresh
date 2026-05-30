const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });
async function embed(text) {
    const r = await fetch("http://localhost:11434/api/embed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: text.slice(0,8000) })
    });
    return (await r.json()).embeddings[0];
}
// Mirror the MCP search_archive query exactly
async function searchArchive(c, q, {limit=5, tag=null, source_type=null}={}) {
    const vec = await embed(q);
    const filters = ["embedding IS NOT NULL"];
    const params = [JSON.stringify(vec)];
    if (tag)         { params.push(tag);         filters.push(`$${params.length} = ANY(topic_tags)`); }
    if (source_type) { params.push(source_type); filters.push(`source_type = $${params.length}`); }
    params.push(limit);
    const r = await c.query(
        `SELECT address, source_type, title, topic_tags,
                LEFT(content,140) preview, 1 - (embedding <=> $1::vector) similarity
         FROM transcript_archive WHERE ${filters.join(" AND ")}
         ORDER BY embedding <=> $1::vector LIMIT $${params.length}`, params);
    return r.rows;
}
(async () => {
    const c = await pool.connect();
    try {
        const queries = [
            ["fractal address system for memory indexing", {}],
            ["how the journey reconstruction engine extracts entities", {}],
            ["mirror core memory database", {tag:"memory"}],
        ];
        for (const [q, opts] of queries) {
            console.log(`\n=== search_archive("${q}")${opts.tag?` tag=${opts.tag}`:''} ===`);
            const rows = await searchArchive(c, q, {limit:4, ...opts});
            rows.forEach(r => console.log(`  [${r.similarity.toFixed(3)}] ${r.address}\n      ${r.preview.replace(/\n/g,' ')}`));
        }
        console.log("\nARCHIVE SEARCH TEST COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
