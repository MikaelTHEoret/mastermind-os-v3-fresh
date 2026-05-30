# MASTERMIND — System State & Memory Source of Truth

> Canonical project state. This file is the authoritative source; vector memory mirrors it.
> Last updated: 2026-05-30

---

## LAYER 1 — IDENTITY (Mikael)

- INFJ systems thinker, Ni-dominant — conclusions arrive before the words for them do.
- Communicates in compressed, high-trust bursts. Omits what he considers obvious. Parse for intent, not literal tokens.
- Native French, works exclusively in English for technical work.
- Fat-fingers frequently — typos are input artifacts, not imprecision. Read through them.
- Poor memory for specifics (passwords, paths, exact figures) — the SYSTEM must compensate. This is why persistent memory matters.
- Genuine aversion to authentication friction and repetitive multi-step setup. Minimize it everywhere.
- Long-arc thinker — projects get rebuilt and upgraded, never abandoned. Treat work as cumulative.
- Core mission: reduce the distance between idea and usable output to near zero. Minimum input → maximum output.
- Internal logic is stable — only new data changes his conclusions, not social pressure.

## OPERATING AGREEMENT (how Claude works with Mikael)

- Do the work. Implement, execute, debug, deploy — don't hand back instructions. Assume "do everything" unless told otherwise.
- Hydrate at session start. Log decisions/builds/facts as they happen, using judgment, into the right layer.
- Be honest about what's actually working vs. what was just set up. Test before claiming success.
- Don't over-engineer the infrastructure. Every moving part is a thing that silently breaks.

---

## LAYER 2 — TOOLBOX (what we have)

### Compute / environment
- Windows machine, Node 24 (global `fetch` available), Python 3.14.
- Ollama running locally with `nomic-embed-text` (768-dim embeddings) at `http://localhost:11434/api/embed`.
- Claude Desktop with MCPs: session-logger, memory (knowledge graph), credential-vault, terminal, filesystem.
- Connectors: Vercel (working — build/runtime logs), GitHub (native Desktop connector), Claude-in-Chrome.

### Databases (Neon, both on PAID Launch plan — usage-based, ~cents/month)
- **neon_primary** (ep-steep-boat): main Minecraft data. Tables: mc_packet_log, mc_chat_log, mc_ac_responses, mc_tps_timeline, mc_chunk_events, mc_ping_log, mc_packet_registry.
- **neon_memory** (ep-restless-bush): vector memory. Tables: harmonic_memories (layered), mirror_core_sessions.
- Credentials live in credential-vault MCP — never ask Mikael, never hardcode in chat.

### Memory system (this is the persistence backbone)
- session-logger MCP v2.0.0 at `C:\Users\Mik\Documents\claude-system\session-logger-mcp\server.js`
- Tools: `hydrate(project?)`, `log_memory(content, tags?, layer?, project?, priority?)`, `recall(query, limit?, layer?, project?)`, `update_memory(match, new_priority?, new_layer?)`, `session_update`, `session_get`, `session_close`.
- Store: harmonic_memories with layer (identity/toolbox/project/session), project, priority (1-10), embedding (vector), updated_at.
- recall scoring: 70% semantic + 20% priority + 10% recency (30-day decay).

### Recurring operational gotchas
- terminal MCP `write_and_run` cwd lacks `pg`/`node-fetch` — write DB scripts into `mastermind-client\` and run there, or use Node 24 global fetch.
- terminal MCP reports ETIMEDOUT even when a script completed — verify by re-querying / reading a log, don't assume failure.
- str_replace can't edit files outside its sandbox — use filesystem:edit_file / filesystem:write_file for mastermind-client and claude-system.
- pg sslmode=require prints a cosmetic verify-full warning — harmless.
- Python on Windows console chokes on some unicode — read logs with errors='replace'.

---

## LAYER 3 — PROJECT: MASTERMIND (2b2t intelligence platform)

### Goal
Passive 2b2t research/intelligence platform: capture packets → extract high-signal data → live dashboard + pattern analysis. Long-term aims include backend-topology fingerprinting and contributing to seed-cracking.

### Architecture (current, working)
```
Fabric mod (Mastermind 0.1.0, MC 1.21.4)
  └─ writes ALL events to data/packets.jsonl (local ground truth, never pruned, ~3.6GB+)
       └─ bridge-server.js v6 (reads tail every 2s, routes by packet name)
            └─ Neon primary (high-signal only: chunks, TPS, chat, AC, ping)
                 └─ Vercel dashboard (Next.js 15.5.18) — live from anywhere
```

### Key components
- Mod project: `C:\Users\Mik\Documents\mastermind-client\` — build `gradlew.bat build`, Java 21, fabric-loom 1.10.1, yarn 1.21.4+build.8. Installed jar in ModrinthApp profile "Fabric 1.21.4".
- Bridge: `mastermind-client\bridge-server.js` — v6 with INDEPENDENT per-type flush (flushBatch helper; one bad row/type can't block others). PID in data/bridge.pid, log in data/bridge.log, offset in data/bridge_state.json.
- Dashboard repo: `MikaelTHEoret/mastermind-os-v3-fresh`, local `C:\Users\Mik\Documents\mastermind-command-center\`.
- Vercel project: `mastermind-2b2t` (prj_2fH4s5cY8ZtePpuw8NZGO7rYU5aP, team masterminds-projects-608763b5). Live: mastermind-2b2t.vercel.app. Next 15.5.18 pinned, install `npm install --legacy-peer-deps`.

### Confirmed findings
- 10 TPS at ~3.7M/-3.6M coords is REAL (WorldTimeUpdate packets arrive 2s apart = 20 ticks/2s = 10 TPS). That backend region runs at half tick-rate. This IS the backend-fingerprinting signal.
- The "jerk"/rubber-band when flying through ungenerated terrain is often TERRAIN reconciliation, NOT anti-cheat. Need to split AC_CORRECTION vs TERRAIN_CORRECTION (PlayerPositionLook within 2s of a chunk LOAD at same coords = terrain).
- Chunk loading signature: fast flight through generated terrain = full view-distance load (disk-bound); through ungenerated = ~1 chunk wide (CPU/generation-bound); stopping = fill-in to max range.
- Confirmed packet mappings: class_2708=PlayerPositionLook(AC), class_2672=ChunkData (chunkX=field_12236, chunkZ=field_12235), class_2761=WorldTimeUpdate, class_7439=GameMessage(chat), class_6373=CommonPing, class_2743=EntityVelocity (noise, filtered).

### Roadmap / pending (priority order)
1. Extract chunk block-palette from ChunkDataS2CPacket (currently discard it — only keep coords). Enables old-chunk detection, stash finding, and SEED-CRACKING contributions.
2. Split AC_CORRECTION vs TERRAIN_CORRECTION (2s/coord proximity to chunk LOAD).
3. Capture non-player entity spawns WITH type (item frames/armor stands/chests = stash signatures).
4. Track local player entity ID (separate own velocity from world velocity; classify travel method e.g. elytra vs e-bounce).
5. Seed-cracking pipeline — accumulate structure detections, feed to Cubiomes/reverse-lookup. 2b2t uses a custom seed not yet publicly cracked; knowing it = predict all terrain/structures before loading.
6. 1.21.11 Mastermind build (needs fabric-loom upgrade to 1.11+).
7. Bridge ping route not populating mc_ping_log — verify extraction (ping packets sparse at border).
8. Populate the knowledge graph (memory MCP) with structural relationships — currently EMPTY.

### Mod stack (research reference — informs what data to extract)
Meteor, BepHax, Baritone, ViaFabricPlus, PawHax, Xaero, Sodium, Iris + Mastermind. Tools whose techniques inform extraction: OldChunkNotifier (block-palette signatures), BetterStashFinder (entity density), TrailFollower (worn paths), ElytraFly++/e-bounce (velocity patterns), GrimAirPlace (AC bypass patterns).

---

## LAYER 3 — PROJECT: CODEX
- Mikael's primary knowledge base at `MikaelTHEoret/Codex` on GitHub. (Details to be expanded when we work on it.)

---

## SESSION-START RITUAL (for Claude)
1. Call `hydrate("mastermind")` (or relevant project) — loads identity + toolbox + project.
2. If Mikael references prior work, `recall(query, project=...)` before assuming.
3. As decisions/builds/facts happen, `log_memory(..., layer=..., project=..., priority=...)`.
4. Update this STATE.md when architecture or roadmap changes, then mirror the change into vector memory.
