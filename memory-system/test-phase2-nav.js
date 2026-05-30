const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 1 });
(async () => {
    const c = await pool.connect();
    try {
        // MODE 1: descend — top level
        console.log("=== DESCEND (top level) ===");
        let r = await c.query(
            `SELECT split_part(bloom_path,'/',1) child, COUNT(*) n FROM transcript_archive
             WHERE bloom_path IS NOT NULL AND split_part(bloom_path,'/',1)<>'' GROUP BY child ORDER BY n DESC LIMIT 6`);
        r.rows.forEach(x => console.log(`  ${x.child} (${x.n})`));

        // MODE 1: descend into mastermind
        console.log("\n=== DESCEND into 'mastermind' ===");
        r = await c.query(
            `SELECT split_part(bloom_path,'/',2) child, COUNT(*) n FROM transcript_archive
             WHERE bloom_path IS NOT NULL AND bloom_path LIKE $1 AND split_part(bloom_path,'/',2)<>'' GROUP BY child ORDER BY n DESC LIMIT 8`,
            ['mastermind/%']);
        r.rows.forEach(x => console.log(`  mastermind/${x.child} (${x.n})`));

        // MODE 2: time jump
        console.log("\n=== TIME JUMP (2026-05 only) ===");
        r = await c.query(
            `SELECT address, bloom_path, addr_time FROM transcript_archive
             WHERE addr_time >= $1::date AND addr_time <= $2::date ORDER BY addr_time DESC LIMIT 5`,
            ['2026-05-01','2026-05-31']);
        r.rows.forEach(x => console.log(`  ${x.addr_time.toISOString().slice(0,10)} ${x.bloom_path}`));
        if (!r.rows.length) console.log("  (none in that range)");

        // MODE 3: resolve by core_hash — grab one that has multiple chunks
        console.log("\n=== RESOLVE by core_hash ===");
        const pick = await c.query(`SELECT core_hash, COUNT(*) n FROM transcript_archive GROUP BY core_hash ORDER BY n DESC LIMIT 1`);
        const ch = pick.rows[0].core_hash;
        r = await c.query(`SELECT address, bloom_path FROM transcript_archive WHERE core_hash=$1 ORDER BY chunk_index LIMIT 4`, [ch]);
        console.log(`  core:${ch} resolves to ${pick.rows[0].n} chunks, e.g.:`);
        r.rows.forEach(x => console.log(`    ${x.address}`));

        console.log("\nNAV TEST COMPLETE");
    } finally { c.release(); pool.end(); }
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
