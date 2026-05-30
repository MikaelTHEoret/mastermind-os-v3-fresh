const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { Pool } = require("pg");

// Node 18+ has global fetch; fall back to node-fetch only if absent
const _fetch = globalThis.fetch || require("node-fetch");

const NEON_CONN = "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const OLLAMA   = "http://localhost:11434/api/embed";
const MODEL    = "nomic-embed-text";

const VALID_LAYERS = ["identity", "toolbox", "project", "session"];

const pool = new Pool({
  connectionString: NEON_CONN,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});
pool.on("error", (err) => process.stderr.write(`Pool error (auto-recovering): ${err.message}\n`));

let SESSION_ID = null;

async function query(sql, params) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function embed(text) {
  try {
    const r = await _fetch(OLLAMA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: text })
    });
    const d = await r.json();
    return d.embeddings[0];
  } catch { return null; }
}

async function initSession() {
  try {
    SESSION_ID = `session_${Date.now()}`;
    await query(
      `INSERT INTO mirror_core_sessions (id, context, state, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [SESSION_ID,
       JSON.stringify({ started_at: new Date().toISOString(), platform: "claude-desktop", user: "Mikael" }),
       JSON.stringify({ status: "active", memories: [] })]
    );
    process.stderr.write(`Session started: ${SESSION_ID}\n`);
  } catch(e) {
    process.stderr.write(`Session init failed: ${e.message}\n`);
  }
}

const server = new McpServer({ name: "session-logger", version: "2.0.0" });

// ── hydrate: load foundational context at session start ──────────────────────
server.tool("hydrate",
  "Load foundational memory at the start of a session: identity + preferences (always), toolbox/infrastructure (always), and optionally a specific project's context. CALL THIS FIRST in any new session before doing project work.",
  { project: z.string().optional().describe("Optional project name to also load, e.g. 'mastermind'") },
  async ({ project }) => {
    try {
      // Always load identity + toolbox, ordered by priority
      const core = await query(
        `SELECT content, layer, tags, priority FROM harmonic_memories
         WHERE layer IN ('identity','toolbox')
         ORDER BY layer, priority DESC, updated_at DESC`
      );
      let out = { identity: [], toolbox: [], project: [] };
      for (const r of core.rows) {
        if (r.layer === 'identity') out.identity.push(r.content);
        else if (r.layer === 'toolbox') out.toolbox.push(r.content);
      }
      if (project) {
        const proj = await query(
          `SELECT content, priority FROM harmonic_memories
           WHERE layer='project' AND project=$1
           ORDER BY priority DESC, updated_at DESC LIMIT 40`,
          [project]
        );
        out.project = proj.rows.map(r => r.content);
      }
      const summary = `Hydrated: ${out.identity.length} identity, ${out.toolbox.length} toolbox` +
                      (project ? `, ${out.project.length} ${project} memories` : '');
      return { content: [{ type: "text", text: summary + "\n\n" + JSON.stringify(out, null, 2) }] };
    } catch(e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── log_memory: now layer + project + priority aware ─────────────────────────
server.tool("log_memory",
  "Store a fact/decision into long-term layered memory. Use layer='identity' for facts about Mikael (preferences, working style), layer='toolbox' for tools/infrastructure/credentials we have, layer='project' (with project name) for project-specific knowledge, layer='session' for ephemeral working notes. Set priority 1-10 (higher = more important, surfaces first).",
  {
    content: z.string(),
    tags: z.array(z.string()).optional(),
    layer: z.enum(["identity","toolbox","project","session"]).optional().describe("Memory layer. Default 'project'."),
    project: z.string().optional().describe("Project name when layer='project', e.g. 'mastermind'"),
    priority: z.number().min(1).max(10).optional().describe("1-10, higher surfaces first. Default 5.")
  },
  async ({ content, tags, layer, project, priority }) => {
    try {
      const lyr = layer || "project";
      const pri = priority || 5;
      const vec = await embed(content);
      if (vec) {
        await query(
          `INSERT INTO harmonic_memories (content, embedding, tags, source, session_id, layer, project, priority, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [content, JSON.stringify(vec), tags||[], "claude-session", SESSION_ID, lyr, project||null, pri]
        );
      } else {
        await query(
          `INSERT INTO harmonic_memories (content, tags, source, session_id, layer, project, priority, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
          [content, tags||[], "claude-session", SESSION_ID, lyr, project||null, pri]
        );
      }
      return { content: [{ type: "text", text: `Logged [${lyr}${project?'/'+project:''}, p${pri}]: ${content.substring(0,55)}...` }] };
    } catch(e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── recall: layer/project filtering + recency weighting ──────────────────────
server.tool("recall",
  "Search layered memory semantically. Optionally filter by layer and/or project to cut noise. Results blend semantic similarity with priority and recency.",
  {
    query: z.string(),
    limit: z.number().optional(),
    layer: z.enum(["identity","toolbox","project","session"]).optional(),
    project: z.string().optional()
  },
  async ({ query: q, limit, layer, project }) => {
    try {
      const vec = await embed(q);
      if (!vec) return { content: [{ type: "text", text: "Embedding unavailable (is Ollama running?)" }] };

      const filters = ["embedding IS NOT NULL"];
      const params = [JSON.stringify(vec)];
      if (layer)   { params.push(layer);   filters.push(`layer = $${params.length}`); }
      if (project) { params.push(project); filters.push(`project = $${params.length}`); }
      params.push(limit || 8);

      // Composite score: 70% semantic, 20% priority, 10% recency (last 30d)
      const r = await query(
        `SELECT content, layer, project, tags, priority,
                1 - (embedding <=> $1::vector) AS similarity,
                (0.7 * (1 - (embedding <=> $1::vector))
                 + 0.2 * (COALESCE(priority,5)/10.0)
                 + 0.1 * GREATEST(0, 1 - EXTRACT(EPOCH FROM (NOW()-updated_at))/2592000.0)
                ) AS score
         FROM harmonic_memories
         WHERE ${filters.join(" AND ")}
         ORDER BY score DESC
         LIMIT $${params.length}`,
        params
      );
      return { content: [{ type: "text", text: JSON.stringify(r.rows.map(x => ({
        content: x.content, layer: x.layer, project: x.project,
        priority: x.priority, similarity: Number(x.similarity).toFixed(3),
        score: Number(x.score).toFixed(3)
      })), null, 2) }] };
    } catch(e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── update_memory: edit/promote an existing memory by content match ──────────
server.tool("update_memory",
  "Update priority or layer of an existing memory found by a search phrase. Use to promote/demote facts as the project evolves.",
  {
    match: z.string().describe("Phrase to find the memory (semantic match, picks best)"),
    new_priority: z.number().min(1).max(10).optional(),
    new_layer: z.enum(["identity","toolbox","project","session"]).optional()
  },
  async ({ match, new_priority, new_layer }) => {
    try {
      const vec = await embed(match);
      if (!vec) return { content: [{ type: "text", text: "Embedding unavailable" }] };
      const found = await query(
        `SELECT id, content FROM harmonic_memories WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector LIMIT 1`, [JSON.stringify(vec)]
      );
      if (!found.rows.length) return { content: [{ type: "text", text: "No match found" }] };
      const id = found.rows[0].id;
      const sets = ["updated_at = NOW()"];
      const params = [];
      if (new_priority) { params.push(new_priority); sets.push(`priority = $${params.length}`); }
      if (new_layer)    { params.push(new_layer);    sets.push(`layer = $${params.length}`); }
      params.push(id);
      await query(`UPDATE harmonic_memories SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
      return { content: [{ type: "text", text: `Updated: ${found.rows[0].content.substring(0,55)}...` }] };
    } catch(e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── ARCHIVE LAYER: search/fetch the large flat transcript+document store ─────
// search_archive: semantic search across all indexed transcripts/documents
server.tool("search_archive",
  "Search the large transcript/document archive (full conversation logs and past work) for precise context. Returns matching chunks with their stable addresses. Use when you need exact details or more context than the curated memory holds. Optionally filter by topic tag or source_type (transcript/document/code/data).",
  {
    query: z.string(),
    limit: z.number().optional(),
    tag: z.string().optional().describe("Filter by topic tag, e.g. 'fractal-address', 'memory', 'mastermind'"),
    source_type: z.enum(["transcript","document","code","data"]).optional()
  },
  async ({ query: q, limit, tag, source_type }) => {
    try {
      const vec = await embed(q);
      if (!vec) return { content: [{ type: "text", text: "Embedding unavailable (is Ollama running?)" }] };
      const filters = ["embedding IS NOT NULL"];
      const params = [JSON.stringify(vec)];
      if (tag)         { params.push(tag);         filters.push(`$${params.length} = ANY(topic_tags)`); }
      if (source_type) { params.push(source_type); filters.push(`source_type = $${params.length}`); }
      params.push(limit || 6);
      const r = await query(
        `SELECT address, source_type, doc_id, title, topic_tags,
                LEFT(content, 300) AS preview,
                1 - (embedding <=> $1::vector) AS similarity
         FROM transcript_archive
         WHERE ${filters.join(" AND ")}
         ORDER BY embedding <=> $1::vector
         LIMIT $${params.length}`,
        params
      );
      return { content: [{ type: "text", text: JSON.stringify(r.rows.map(x => ({
        address: x.address, source_type: x.source_type, title: x.title,
        tags: x.topic_tags, similarity: Number(x.similarity).toFixed(3),
        preview: x.preview
      })), null, 2) }] };
    } catch(e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// fetch_archive: retrieve a specific chunk by address, plus neighbors for context
server.tool("fetch_archive",
  "Fetch the full text of a specific archive chunk by its address (from search_archive results), plus surrounding chunks for context. Use context_window to control how many neighbor chunks on each side.",
  {
    address: z.string().describe("Exact address from search_archive, e.g. 'path/file.txt#chunk-0042'"),
    context_window: z.number().optional().describe("Neighbor chunks each side. Default 1.")
  },
  async ({ address, context_window }) => {
    try {
      const win = context_window == null ? 1 : context_window;
      const m = address.match(/^(.*)#chunk-(\d+)$/);
      if (!m) return { content: [{ type: "text", text: "Invalid address format. Expected 'doc#chunk-NNNN'." }] };
      const docId = m[1];
      const idx = parseInt(m[2]);
      const r = await query(
        `SELECT address, chunk_index, title, source_path, content
         FROM transcript_archive
         WHERE doc_id = $1 AND chunk_index BETWEEN $2 AND $3
         ORDER BY chunk_index`,
        [docId, idx - win, idx + win]
      );
      if (!r.rows.length) return { content: [{ type: "text", text: "Address not found." }] };
      const head = `Source: ${r.rows[0].source_path}\nTitle: ${r.rows[0].title}\nChunks ${idx-win}..${idx+win}\n${"=".repeat(50)}\n`;
      const body = r.rows.map(x => `[chunk ${x.chunk_index}]\n${x.content}`).join("\n\n");
      return { content: [{ type: "text", text: head + body }] };
    } catch(e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// archive_browse: list what's indexed for a doc or by tag (navigate by address)
server.tool("archive_browse",
  "Browse the archive structure: list indexed documents, or list chunks within one document. Helps navigate by address rather than by semantic search.",
  {
    doc_id: z.string().optional().describe("If given, list that document's chunks; else list all documents."),
    tag: z.string().optional().describe("Filter documents by topic tag.")
  },
  async ({ doc_id, tag }) => {
    try {
      if (doc_id) {
        const r = await query(
          `SELECT address, chunk_index, topic_tags, LEFT(content,80) preview
           FROM transcript_archive WHERE doc_id=$1 ORDER BY chunk_index LIMIT 100`, [doc_id]);
        return { content: [{ type: "text", text: JSON.stringify(r.rows, null, 2) }] };
      }
      const params = [];
      let filter = "";
      if (tag) { params.push(tag); filter = `WHERE $1 = ANY(topic_tags)`; }
      const r = await query(
        `SELECT doc_id, source_type, COUNT(*) chunks, MAX(title) title
         FROM transcript_archive ${filter}
         GROUP BY doc_id, source_type ORDER BY chunks DESC LIMIT 80`, params);
      return { content: [{ type: "text", text: JSON.stringify(r.rows, null, 2) }] };
    } catch(e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── session tools (unchanged behavior) ───────────────────────────────────────
server.tool("session_update",
  "Update the current session with new context or summary",
  { summary: z.string(), topics: z.array(z.string()).optional() },
  async ({ summary, topics }) => {
    try {
      await query(
        `UPDATE mirror_core_sessions SET context = context || $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ last_summary: summary, topics: topics||[], updated: new Date().toISOString() }), SESSION_ID]
      );
      return { content: [{ type: "text", text: `Session ${SESSION_ID} updated.` }] };
    } catch(e) { return { content: [{ type: "text", text: `Error: ${e.message}` }] }; }
  }
);

server.tool("session_get", "Get current session ID and summary", {},
  async () => {
    try {
      const r = await query("SELECT id, context, state, created_at FROM mirror_core_sessions WHERE id = $1", [SESSION_ID]);
      return { content: [{ type: "text", text: JSON.stringify(r.rows[0], null, 2) }] };
    } catch(e) { return { content: [{ type: "text", text: `Error: ${e.message}` }] }; }
  }
);

server.tool("session_close", "Mark the current session as complete with a final summary",
  { summary: z.string() },
  async ({ summary }) => {
    try {
      await query(
        `UPDATE mirror_core_sessions SET state = state || $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ status: "closed", final_summary: summary, closed_at: new Date().toISOString() }), SESSION_ID]
      );
      return { content: [{ type: "text", text: `Session ${SESSION_ID} closed.` }] };
    } catch(e) { return { content: [{ type: "text", text: `Error: ${e.message}` }] }; }
  }
);

initSession().then(() => {
  const transport = new StdioServerTransport();
  server.connect(transport);
});
