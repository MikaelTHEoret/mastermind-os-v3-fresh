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

## Family-scoped extension

The Minecraft/family work reuses this database and pgvector capability without writing family data into the globally hydrated `harmonic_memories` authority.

Apply the additive migrations in order only after review:

1. `migrations/001_mastermind_domain_events_v1.sql` adds effect-once event receipts, structured companion session/action state, and rebuildable sanitized session-rollup projection jobs.
2. `migrations/002_mastermind_family_identity_v1.sql` adds households, internal player identities, canonical external bindings, purpose-specific consent, idempotent identity commands, and the default-deny pre-ranking read predicate.
3. `migrations/003_mastermind_memory_operator_v1.sql` adds parent-authorized search over sanitized projection rows, rebuild-stable soft-forget lifecycle state, short-lived digest-bound forget plans, and effect-once forget/restore receipts.
4. `migrations/004_mastermind_node_exchange_v1.sql` adds one-time portable-node pairing, hashed node credentials, redacted node inventory, typed expiring jobs, renewable leases, and effect-once progress/terminal receipts for the routine family-ecosystem start command.
5. `migrations/005_mastermind_node_exchange_lease_presence_v1.sql` replaces only the exchange function so lease dispatch tests row presence by the job primary key instead of PostgreSQL composite-null semantics.

Apply all five once with `npm run memory:migrate`; the runner pins the reviewed migration hashes and executes each file as one transaction. Portable nodes pair once, generate and retain their own credential, and thereafter exchange outbound HTTPS requests without recurring token or UUID entry. Memory-event synchronization is off by default and additionally requires a canonical internal player UUID whose active identity has `capture` and `session_summary` consent. An unbound control plane does not create companion outbox records; any legacy playerless files are preserved and fenced for explicit migration. The parent Memory console uses a separate same-origin, short-lived PIN unlock and never receives the control-plane bearer. This private-PC build includes the retained plan's parent identity and a salted scrypt verifier for family code `795200`, so no PIN verifier or operator player UUID needs to be copied into `.env.local`; explicit server-only overrides remain available for later rotation. Its current search is bounded text/recent search because embeddings are still pending; player-facing recall, embedding backfill, and Obsidian projection remain later layers and must not bypass the structured identity/consent authority.

## Provenance

The archive layer reuses the chunked-extraction + hierarchical-addressing design from
the prior `nexus-enhanced-unified` Journey Reconstruction System, with the decorative
"consciousness mathematics" layer removed — keeping the practical engineering.
