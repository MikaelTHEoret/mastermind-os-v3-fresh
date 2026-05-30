# Memory System — Layered Vector Memory + Archive

The persistence backbone for long-running work. Four layers, two stores, one MCP.

## Architecture

```
session-logger MCP (server.js)
  ├─ harmonic_memories        curated, small, fast — what `recall`/`hydrate` search
  │    layers: identity | toolbox | project | session
  │    each row: content, embedding(768d), tags[], layer, project, priority, archive_ref
  │
  └─ transcript_archive        large, flat, addressed — full logs & past work
       each row: address(PK), source_type, doc_id, chunk_index,
                 topic_tags[], title, content, embedding(768d)
```

**The link:** a curated memory in `harmonic_memories` can carry an `archive_ref`
pointing at a precise `transcript_archive` address. Small memory on top for speed,
large archive underneath for precision. The vector layer stays fast; the archive
grows without slowing recall.

## Addressing

Every archive chunk has a **dual address**:
- **Structural** (the primary key): `relative/path/file.txt#chunk-0042` — stable, chronological/locational.
- **Semantic** (`topic_tags[]`): `memory`, `fractal-address`, `mastermind`, etc. — navigable by topic.

## MCP tools (session-logger v2.0.0)

| Tool | Purpose |
|------|---------|
| `hydrate(project?)` | Load identity + toolbox (always) + a project's memories. Call first each session. |
| `log_memory(content, tags?, layer?, project?, priority?)` | Write a curated memory to the right layer. |
| `recall(query, limit?, layer?, project?)` | Search curated memory. Score = 70% semantic + 20% priority + 10% recency. |
| `update_memory(match, new_priority?, new_layer?)` | Promote/demote/reclassify a memory. |
| `search_archive(query, tag?, source_type?)` | Semantic search across the full archive; returns addresses. |
| `fetch_archive(address, context_window?)` | Pull a chunk + neighbors by address. |
| `archive_browse(doc_id?, tag?)` | Navigate the archive by document or tag. |

## Scripts

- `session-logger-server.js` — the MCP server (mirror of `claude-system/session-logger-mcp/server.js`).
- `archive-schema.js` — creates `transcript_archive`, `archive_index_log`, adds `archive_ref`.
- `classify-archive.py` — selects which files to index (excludes cloned third-party repos).
- `archive-indexer.js` — chunks (1500c/200 overlap), tags, embeds via Ollama, writes archive. Idempotent/resumable.
- `migrate-memory.js` — adds layer/project/priority columns; classifies existing memories.
- `seed-layers.js` — seeds identity + toolbox foundation.
- `index-session.js` — indexes a session's decisions into curated memory.
- `check-archive.js`, `test-archive-search.js`, `test-pickup.js` — verification/test scripts.

## Dependencies

- **Neon** memory DB (`ep-restless-bush`) — connection string in scripts / `.env.local`.
- **Ollama** local with `nomic-embed-text` (768-dim) at `http://localhost:11434`.
- **pgvector** extension on the memory DB (`vector` column + ivfflat indexes).

## Session-start ritual

1. `hydrate("mastermind")` — load foundation.
2. `recall(...)` before assuming on referenced past work.
3. `search_archive(...)` when precise detail or more context is needed; `fetch_archive(address)` to expand.
4. `log_memory(...)` as decisions/builds/facts happen.
5. Keep `MASTERMIND-STATE.md` (the human-readable source of truth) in sync; mirror changes into memory.

## Provenance

The archive layer reuses the chunked-extraction + hierarchical-addressing design from
the prior `nexus-enhanced-unified` Journey Reconstruction System, with the decorative
"consciousness mathematics" layer removed — keeping the practical engineering.
