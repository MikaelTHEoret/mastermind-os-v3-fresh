const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });

async function embed(text) {
    const r = await fetch("http://localhost:11434/api/embed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: text })
    });
    return (await r.json()).embeddings[0];
}

// Seed entries: [content, layer, project, priority, tags]
const SEEDS = [
    // Operating agreement (identity layer, high priority)
    ["Claude does the work: implement, execute, debug, deploy directly — never hand back instructions. Assume 'do everything' unless told otherwise.", "identity", null, 10, ["operating-agreement","rules"]],
    ["Claude hydrates at session start and logs decisions/builds/facts as they happen using judgment, into the correct memory layer.", "identity", null, 10, ["operating-agreement","memory"]],
    ["Be honest about what is actually working vs just set up. Test before claiming success. This session proved every untested 'done' was often broken.", "identity", null, 9, ["operating-agreement","rules"]],
    ["Don't over-engineer infrastructure — every moving part is something that silently breaks.", "identity", null, 8, ["operating-agreement","rules"]],

    // Toolbox — environment
    ["Environment: Windows machine, Node 24 (global fetch available), Python 3.14. Ollama running locally with nomic-embed-text 768-dim at http://localhost:11434/api/embed.", "toolbox", null, 8, ["infrastructure","environment","ollama"]],
    ["MCPs available: session-logger (layered vector memory), memory (knowledge graph - currently empty), credential-vault, terminal, filesystem. Connectors: Vercel (build/runtime logs), GitHub (native Desktop), Claude-in-Chrome.", "toolbox", null, 8, ["infrastructure","mcp","connectors"]],

    // Toolbox — databases
    ["Neon DBs both on PAID Launch plan (usage-based ~cents/month). neon_primary (ep-steep-boat) = Minecraft data. neon_memory (ep-restless-bush) = vector memory + sessions.", "toolbox", null, 9, ["infrastructure","neon","database"]],
    ["All credentials live in credential-vault MCP. Never ask Mikael for them, never hardcode them in chat. Retrieve from vault.", "toolbox", null, 9, ["infrastructure","credentials","security"]],

    // Toolbox — memory system
    ["Memory system: session-logger MCP v2.0.0. Tools: hydrate(project?), log_memory(content,tags?,layer?,project?,priority?), recall(query,limit?,layer?,project?), update_memory(match,new_priority?,new_layer?). Layers: identity/toolbox/project/session. recall scores 70% semantic + 20% priority + 10% recency.", "toolbox", null, 9, ["infrastructure","memory-system","session-logger"]],
    ["Canonical project state lives in C:\\Users\\Mik\\Documents\\claude-system\\MASTERMIND-STATE.md — the source of truth, mirrored into vector memory. Update it when architecture/roadmap changes.", "toolbox", null, 9, ["infrastructure","memory-system","state-doc"]],

    // Toolbox — operational gotchas
    ["Gotcha: terminal MCP write_and_run cwd lacks pg/node-fetch — write DB scripts into mastermind-client\\ and run there, or use Node 24 global fetch. terminal often reports ETIMEDOUT even when script succeeded — verify by re-querying, don't assume failure.", "toolbox", null, 7, ["infrastructure","gotcha","terminal"]],
    ["Gotcha: str_replace can't edit files outside its sandbox — use filesystem:edit_file/write_file for mastermind-client and claude-system paths.", "toolbox", null, 7, ["infrastructure","gotcha","filesystem"]],
];

(async () => {
    const c = await pool.connect();
    try {
        let added = 0;
        for (const [content, layer, project, priority, tags] of SEEDS) {
            // Skip if a near-identical memory already exists
            const vec = await embed(content);
            const dup = await c.query(
                `SELECT 1 - (embedding <=> $1::vector) sim FROM harmonic_memories
                 WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 1`,
                [JSON.stringify(vec)]
            );
            if (dup.rows[0] && dup.rows[0].sim > 0.93) { continue; } // already have it
            await c.query(
                `INSERT INTO harmonic_memories (content, embedding, tags, source, layer, project, priority, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
                [content, JSON.stringify(vec), tags, "state-seed-2026-05-30", layer, project, priority]
            );
            added++;
        }
        const dist = await c.query(`SELECT layer, COUNT(*) n FROM harmonic_memories GROUP BY layer ORDER BY layer`);
        console.log(`Added ${added} new seed memories.`);
        console.log("Layer distribution now:");
        dist.rows.forEach(r => console.log(`  ${r.layer.padEnd(10)} ${r.n}`));
        console.log("SEED COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
