// Archive indexer — chunks files, tags, embeds, writes to transcript_archive
// Idempotent: skips files already in archive_index_log. Resumable.
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({ connectionString: "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", max: 2 });
const ROOT = "C:\\Users\\Mik\\Documents\\Claude-system\\Documents";
const CHUNK = 1500, OVERLAP = 200;

async function embed(text) {
    try {
        const r = await fetch("http://localhost:11434/api/embed", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "nomic-embed-text", input: text.slice(0, 8000) })
        });
        const d = await r.json();
        return d.embeddings && d.embeddings[0] ? d.embeddings[0] : null;
    } catch { return null; }
}

// crude but effective topic tagging from content keywords
const TAG_RX = [
    ['memory', /\b(memory|recall|embedding|vector|harmonic_memories|hydrate)\b/i],
    ['fractal-address', /\bfractal|address|glyph|ΞΨΞ|bloom\b/i],
    ['mastermind', /\bmastermind|2b2t|baritone|meteor|packet|fabric\b/i],
    ['mcp', /\bmcp|model context protocol|claude_desktop_config|server\.js\b/i],
    ['neon-db', /\bneon|postgres|database|sql|pgvector\b/i],
    ['nexus', /\bnexus|mirror.core|journey|reconstruction\b/i],
    ['codex', /\bcodex|harmonic|432|phi|psi|prime|resonance\b/i],
    ['scroll', /\bscroll|sovereign|glis|invocation|breath\b/i],
    ['architecture', /\barchitecture|design|protocol|pipeline|integration\b/i],
    ['session', /\bsession|checkpoint|context|conversation\b/i],
    ['code', /\b(function|const|import|def |class |async)\b/],
    ['trading', /\btrading|btcc|crypto|bitcoin|psi.trader\b/i],
];
function tagsFor(text) {
    const t = [];
    for (const [tag, rx] of TAG_RX) if (rx.test(text)) t.push(tag);
    return t.length ? t : ['general'];
}

function chunkText(text) {
    const chunks = [];
    for (let i = 0; i < text.length; i += (CHUNK - OVERLAP)) {
        const piece = text.slice(i, i + CHUNK).trim();
        if (piece.length > 40) chunks.push(piece);
    }
    return chunks;
}

function classify(fp) {
    const e = path.extname(fp).toLowerCase();
    if (['.py','.js','.ts','.tsx','.jsx'].includes(e)) return 'code';
    if (['.json','.csv'].includes(e)) return 'data';
    if (fp.includes('chat') || fp.includes('conversation') || /\.txt$/.test(fp)) return 'transcript';
    return 'document';
}

async function query(c, sql, params) { return await c.query(sql, params); }

(async () => {
    const fileList = JSON.parse(fs.readFileSync("C:\\Users\\Mik\\Documents\\mastermind-client\\data\\index-filelist.json","utf8"));
    const c = await pool.connect();
    let done = 0, chunksTotal = 0, errors = 0, skipped = 0;
    const startIdx = parseInt(process.argv[2] || "0");
    const endIdx = parseInt(process.argv[3] || String(fileList.length));

    for (let fi = startIdx; fi < endIdx && fi < fileList.length; fi++) {
        const fp = fileList[fi];
        try {
            // skip if already indexed
            const already = await query(c, `SELECT 1 FROM archive_index_log WHERE source_path=$1 AND status='done'`, [fp]);
            if (already.rows.length) { skipped++; continue; }

            const raw = fs.readFileSync(fp, "utf8");
            const rel = fp.replace(ROOT + "\\", "").replace(/\\/g, "/");
            const docId = rel;
            const stype = classify(fp);
            const stat = fs.statSync(fp);
            const mtime = stat.mtime.toISOString();
            const title = (raw.match(/^#\s+(.+)$/m) || raw.match(/^(.{10,80})/m) || ["",rel])[1].slice(0,120);

            const chunks = chunkText(raw);
            for (let ci = 0; ci < chunks.length; ci++) {
                const address = `${rel}#chunk-${String(ci).padStart(4,'0')}`;
                const content = chunks[ci];
                const vec = await embed(content);
                const tags = tagsFor(content);
                await query(c,
                    `INSERT INTO transcript_archive
                     (address, source_type, source_path, doc_id, chunk_index, topic_tags, title, content, embedding, char_count, doc_mtime)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                     ON CONFLICT (address) DO NOTHING`,
                    [address, stype, fp, docId, ci, tags, title, content,
                     vec ? JSON.stringify(vec) : null, content.length, mtime]
                );
                chunksTotal++;
            }
            await query(c, `INSERT INTO archive_index_log (source_path, doc_id, chunks, status)
                            VALUES ($1,$2,$3,'done')
                            ON CONFLICT (source_path) DO UPDATE SET chunks=$3, status='done', indexed_at=NOW()`,
                            [fp, docId, chunks.length]);
            done++;
            if (done % 25 === 0) {
                fs.writeFileSync("C:\\Users\\Mik\\Documents\\mastermind-client\\data\\index-progress.txt",
                    `Files done: ${done}, chunks: ${chunksTotal}, skipped: ${skipped}, errors: ${errors}, at index ${fi}/${endIdx}\n`);
            }
        } catch(e) {
            errors++;
            try { await query(c, `INSERT INTO archive_index_log (source_path, status, error) VALUES ($1,'error',$2)
                                  ON CONFLICT (source_path) DO UPDATE SET status='error', error=$2`, [fp, e.message.slice(0,200)]); } catch {}
        }
    }
    fs.writeFileSync("C:\\Users\\Mik\\Documents\\mastermind-client\\data\\index-progress.txt",
        `COMPLETE. Files done: ${done}, chunks: ${chunksTotal}, skipped: ${skipped}, errors: ${errors}\n`);
    c.release(); pool.end();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
