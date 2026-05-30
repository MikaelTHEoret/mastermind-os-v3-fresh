const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });

async function embed(text) {
    const r = await fetch("http://localhost:11434/api/embed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: text })
    });
    return (await r.json()).embeddings[0];
}

// Replicate the v2.0.0 recall composite scoring
async function recall(c, q, project, limit=6) {
    const vec = await embed(q);
    const params = [JSON.stringify(vec)];
    let filter = "embedding IS NOT NULL";
    if (project) { params.push(project); filter += ` AND (project=$${params.length} OR layer IN ('identity','toolbox'))`; }
    params.push(limit);
    const r = await c.query(
        `SELECT LEFT(content,90) snippet, layer, project, priority,
                (0.7*(1-(embedding <=> $1::vector)) + 0.2*(COALESCE(priority,5)/10.0)
                 + 0.1*GREATEST(0,1-EXTRACT(EPOCH FROM (NOW()-updated_at))/2592000.0)) score
         FROM harmonic_memories WHERE ${filter} ORDER BY score DESC LIMIT $${params.length}`, params);
    return r.rows;
}

(async () => {
    const c = await pool.connect();
    try {
        // 1. HYDRATE simulation
        console.log("===== HYDRATE('mastermind') =====");
        const core = await c.query(
            `SELECT LEFT(content,75) s, layer, priority FROM harmonic_memories
             WHERE layer IN ('identity','toolbox') ORDER BY layer, priority DESC LIMIT 100`);
        const proj = await c.query(
            `SELECT LEFT(content,75) s, priority FROM harmonic_memories
             WHERE layer='project' AND project='mastermind' ORDER BY priority DESC LIMIT 40`);
        console.log(`Identity+Toolbox loaded: ${core.rows.length}, Mastermind project: ${proj.rows.length}`);

        // 2. Pickup-test queries a fresh session would ask
        const queries = [
            ["What is the current state of the mastermind project?", "mastermind"],
            ["What was the bridge bug we fixed?", "mastermind"],
            ["What are the next steps / roadmap?", "mastermind"],
            ["What database are we using and what plan?", "mastermind"],
            ["How does the memory system work?", null],
            ["Who is Mikael and how does he communicate?", null],
        ];
        for (const [q, proj] of queries) {
            console.log(`\n----- recall: "${q}" (${proj||'all'}) -----`);
            const rows = await recall(c, q, proj, 4);
            rows.forEach(r => console.log(`  [${r.score.toFixed(2)}|${r.layer}] ${r.snippet}`));
        }
        console.log("\nPICKUP TEST COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
