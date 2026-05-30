// Phase 2 backfill — populate bloom_path, addr_time, core_hash for existing chunks.
// addr_time: from doc_mtime (file modified date)
// core_hash: stable 6-char sha of normalized concept key (doc_id + primary tag)
// bloom_path: FIRST-PASS heuristic from doc_id path + topic_tags.
//   project = top-ish dir or dominant project tag; component = subdir/secondary signal;
//   subject = doc basename. Phase 3 replaces this with the real curated tree.
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 2 });

function sha6(s) { return crypto.createHash("sha256").update(s).digest("hex").slice(0, 6); }

// Map a doc_id (relative path) + tags into a project/component/subject bloom path.
// Tag-driven project assignment takes priority over raw path, since the archive
// mixes many old project dirs.
const PROJECT_BY_TAG = [
    ["mastermind", "mastermind"],
    ["nexus", "nexus"],
    ["codex", "codex"],
    ["scroll", "scroll-protocol"],
    ["trading", "trading"],
    ["memory", "memory-system"],
    ["fractal-address", "memory-system"],
    ["neon-db", "infra"],
    ["mcp", "infra"],
];

function bloomPath(docId, tags) {
    const segs = docId.split("/");
    const base = path.basename(docId).replace(/\.[^.]+$/, "");
    // project: first matching tag, else top directory, else 'misc'
    let project = null;
    for (const [tag, proj] of PROJECT_BY_TAG) {
        if (tags.includes(tag)) { project = proj; break; }
    }
    if (!project) project = segs.length > 1 ? segs[0] : "misc";
    // component: second path segment if present, else a secondary tag, else 'general'
    let component = segs.length > 2 ? segs[1] : (tags.find(t => !["code","general"].includes(t)) || "general");
    // subject: file basename (the specific thing)
    let subject = base.slice(0, 48);
    // sanitize to path-safe tokens
    const clean = s => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "x";
    return `${clean(project)}/${clean(component)}/${clean(subject)}`;
}

(async () => {
    const c = await pool.connect();
    try {
        // Pull what we need to derive dimensions
        const rows = await c.query(`SELECT address, doc_id, topic_tags, doc_mtime FROM transcript_archive`);
        console.log(`Backfilling ${rows.rows.length} chunks (batched)...`);
        let done = 0;
        const BATCH = 500;
        for (let i = 0; i < rows.rows.length; i += BATCH) {
            const slice = rows.rows.slice(i, i + BATCH);
            // Build a single UPDATE ... FROM (VALUES ...) statement for the batch
            const vals = [];
            const params = [];
            slice.forEach((r, j) => {
                const tags = r.topic_tags || [];
                const bp = bloomPath(r.doc_id, tags);
                const core = sha6(r.doc_id + "|" + (tags[0] || ""));
                const t = r.doc_mtime ? new Date(r.doc_mtime) : null;
                const b = j * 4;
                params.push(r.address, bp, t, core);
                vals.push(`($${b+1}, $${b+2}, $${b+3}::date, $${b+4})`);
            });
            await c.query(
                `UPDATE transcript_archive AS ta
                 SET bloom_path = v.bp, addr_time = v.t, core_hash = v.core
                 FROM (VALUES ${vals.join(",")}) AS v(addr, bp, t, core)
                 WHERE ta.address = v.addr`,
                params
            );
            done += slice.length;
            require("fs").writeFileSync("C:\\Users\\Mik\\Documents\\mastermind-client\\data\\phase2-progress.txt", `${done}/${rows.rows.length}\n`);
        }
        console.log(`Backfilled ${done} chunks.`);

        // Report: distinct projects and a sample of bloom paths
        const projs = await c.query(`
            SELECT split_part(bloom_path,'/',1) project, COUNT(*) n
            FROM transcript_archive GROUP BY 1 ORDER BY n DESC LIMIT 15`);
        console.log("\nProjects (top of bloom path):");
        projs.rows.forEach(r => console.log(`  ${String(r.project).padEnd(18)} ${r.n}`));

        const sample = await c.query(`SELECT bloom_path, addr_time, core_hash FROM transcript_archive WHERE bloom_path LIKE 'memory-system/%' LIMIT 5`);
        console.log("\nSample memory-system addresses:");
        sample.rows.forEach(r => console.log(`  path:${r.bloom_path} | t:${r.addr_time ? r.addr_time.toISOString().slice(0,10) : '?'} | core:${r.core_hash}`));

        console.log("\nPHASE2 BACKFILL COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
