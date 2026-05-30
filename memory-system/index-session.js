const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });

async function embed(text) {
    const r = await fetch("http://localhost:11434/api/embed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: text })
    });
    return (await r.json()).embeddings[0];
}

// This session's development status — [content, layer, project, priority, tags]
const SESSION_MEMORIES = [
    // Current operational state — highest priority for pickup
    ["SESSION STATE 2026-05-30: Mastermind pipeline is LIVE end-to-end. Bridge v6 running (mod->packets.jsonl->bridge->Neon primary->Vercel dashboard). Dashboard live at mastermind-2b2t.vercel.app showing TPS, chunk radar, chat. Both Neon DBs on paid Launch plan. No localhost dependency.", "project", "mastermind", 10, ["session-state","status","pipeline","live"]],

    ["Bridge v6 KEY FIX this session: flushAll was one transaction for all data types; a chat ON CONFLICT needing a missing constraint threw and rolled back EVERYTHING, silently killing chunks/TPS/ping together. Rewrote into flushBatch(rows,insertFn,label) — each type flushes independently with per-row try/catch. This was the root cause of data freezing.", "project", "mastermind", 9, ["session-state","bridge","bugfix","flush"]],

    ["TPS calculation FIX this session: bridge used Date.now() for wall clock, but drain() batches multiple packets per 2s cycle, inflating wallDelta and showing 10 TPS at 20. Changed to use packet's own e.ts timestamp. NOTE: the 10 TPS reading at 3.7M/-3.6M coords turned out to be REAL backend behavior, not the bug.", "project", "mastermind", 8, ["session-state","tps","bugfix"]],

    ["Neon 512MB crisis RESOLVED this session: repeated free-tier write-blocking. Mikael upgraded BOTH Neon DBs to paid Launch plan via Vercel Integrations > Neon billing (usage-based $0.35/GB-month storage + $0.106/CU-hour, effectively cents/month). Vercel Pro was explicitly NOT bought — it does not include Neon storage. DB cleaned 483MB->17MB via table-swap (CREATE new, copy high-signal, DROP CASCADE, RENAME) since TRUNCATE/DROP don't free space without VACUUM headroom.", "project", "mastermind", 9, ["session-state","neon","billing","resolved"]],

    ["mc_packet_log id sequence was lost during the table-swap — fixed via CREATE SEQUENCE + ALTER COLUMN id SET DEFAULT nextval. Only mc_packet_log was affected; other tables kept their sequences.", "project", "mastermind", 6, ["session-state","neon","sequence","bugfix"]],

    ["Dashboard fixes this session: chat now oldest-top/newest-bottom with auto-scroll (useRef); ONLINE detection uses freshly-fetched chunk/TPS data not stale React state (was a race condition); full Neon mode, no localhost. Built a state-server.js (port 3001) during the brief local-only phase but it's no longer required after Launch upgrade.", "project", "mastermind", 7, ["session-state","dashboard","ux","bugfix"]],

    // Memory system work — this is the big infrastructure change
    ["MEMORY SYSTEM upgraded this session to LAYERED architecture. Added layer/project/priority/updated_at columns to harmonic_memories. 40 memories now sorted: 13 identity, 17 toolbox, 15 project (mastermind/codex). session-logger rewritten to v2.0.0 with hydrate(), layer-aware log_memory/recall, update_memory. NEEDS CLAUDE DESKTOP RESTART to load v2.0.0 (running process was still v1.0.0 when written).", "toolbox", null, 10, ["session-state","memory-system","upgrade","layered"]],

    ["Memory audit finding this session: the system was NOT broken as first feared. All 33 original memories had valid 768-dim embeddings, vector column + ivfflat index intact, Ollama working. The apparent recall failure was weak semantic ranking on a flat undifferentiated pool — old seed memories scored ~0.40-0.49 alongside everything. The layered system + composite scoring (70% semantic/20% priority/10% recency) fixes this.", "toolbox", null, 8, ["session-state","memory-system","audit"]],

    ["Knowledge graph (memory MCP) is still EMPTY — never written to. Pending: populate with structural relationships (Bridge->writes->Neon, '10 TPS'->property-of->'backend 3.7M', mods->provide->capabilities). Vector memory = fuzzy recall; graph = dependency/relationship queries. Different tools for different jobs.", "toolbox", null, 7, ["session-state","knowledge-graph","pending"]],

    ["User preference set this session for fully-automatic memory: at session start call hydrate(project), recall before assuming on referenced past work, log_memory with judgment using correct layer/project/priority. Bootstrap text given to Mikael to paste into Settings>Profile.", "identity", null, 9, ["session-state","operating-agreement","memory","automation"]],

    // Connectors
    ["Vercel connector CONFIRMED WORKING this session — get_deployment_build_logs, get_runtime_logs, list_deployments etc. Replaces painful browser-screenshot deploy debugging. Confirmed zero runtime errors in production. GitHub connector is a NATIVE Claude Desktop connector (not a regular MCP) — its tools don't surface via tool_search yet, likely needs Desktop restart to register.", "toolbox", null, 7, ["session-state","connectors","vercel","github"]],

    // Immediate next steps for pickup
    ["IMMEDIATE NEXT STEPS after restart: (1) verify session-logger v2.0.0 hydrate/recall work, (2) verify GitHub connector tools surfaced, (3) begin chunk block-palette extraction from ChunkDataS2CPacket — the groundwork for seed-cracking and old-chunk/stash detection. The mod already captures these packets; it's bridge-side extraction only.", "project", "mastermind", 9, ["session-state","next-steps","roadmap"]],

    ["SEED-CRACKING context: 2b2t uses a custom seed not yet publicly cracked. Vanilla worldgen is reversible — known structure coords constrain seed space (1 stronghold ~100 seeds, 3 = exact). Passive chunk block-palette capture could contribute structure detections. Knowing the seed = predict all terrain/structures/bases before loading chunks. Tied to pending chunk-palette extraction work. Mikael flagged this as a huge potential advantage.", "project", "mastermind", 8, ["session-state","seed-cracking","research","roadmap"]],
];

(async () => {
    const c = await pool.connect();
    try {
        let added = 0, skipped = 0;
        for (const [content, layer, project, priority, tags] of SESSION_MEMORIES) {
            const vec = await embed(content);
            const dup = await c.query(
                `SELECT 1 - (embedding <=> $1::vector) sim FROM harmonic_memories
                 WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 1`,
                [JSON.stringify(vec)]
            );
            if (dup.rows[0] && dup.rows[0].sim > 0.95) { skipped++; continue; }
            await c.query(
                `INSERT INTO harmonic_memories (content, embedding, tags, source, layer, project, priority, session_id, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
                [content, JSON.stringify(vec), tags, "session-2026-05-30", layer, project, priority, "session_1780108368755"]
            );
            added++;
        }
        console.log(`Added ${added} session memories, skipped ${skipped} dupes.`);
        const dist = await c.query(`SELECT layer, COUNT(*) n FROM harmonic_memories GROUP BY layer ORDER BY layer`);
        console.log("Final distribution:");
        dist.rows.forEach(r => console.log(`  ${r.layer.padEnd(10)} ${r.n}`));
        const tot = await c.query(`SELECT COUNT(*) n FROM harmonic_memories`);
        console.log(`TOTAL: ${tot.rows[0].n} memories`);
        console.log("INDEX COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
