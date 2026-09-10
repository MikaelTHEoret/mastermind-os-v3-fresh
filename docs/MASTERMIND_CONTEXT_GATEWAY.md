# Mastermind Context Gateway

The Context Gateway is the canonical local bridge between ChatGPT/Codex desktop and Mastermind memory. It keeps Neon as the owned source of truth, checks the configured parent operator before every retrieval, and exposes only bounded MCP tools.

## Safety boundary

- Authorization occurs before any memory or archive candidate query.
- The legacy harmonic/archive corpus is available only to the configured active parent operator.
- Results are redacted and size-bounded.
- No raw SQL, shell, arbitrary filesystem, or arbitrary URL tool exists.
- Minecraft is status-only. Live actions remain disabled until the world-management security checkpoint and bridge acceptance are green.
- Obsidian is a one-way generated projection. It is disabled by default and cannot import edits.
- Embeddings are optional, local, and derived. Lexical retrieval remains available if Ollama is offline.

## Tools

Read tools:

- `mastermind_bootstrap`
- `mastermind_context_pack`
- `mastermind_memory_search`
- `mastermind_archive_search`
- `mastermind_archive_fetch`
- `mastermind_project_state`
- `mastermind_minecraft_status`
- `mastermind_minecraft_memory_search`
- `mastermind_system_status`

Bounded write tools:

- `mastermind_task_checkpoint` appends a task checkpoint after migration 007. Replays are idempotent only when the caller retains both identifiers and the same payload, as described below.
- `mastermind_obsidian_export` writes only to `Generated/Mastermind` under the configured vault and requires `confirm=true`.

## Hydration and source descent

Call `mastermind_bootstrap` at the start of a session, then `mastermind_context_pack` with the actual current intent. Both accept a JSON character budget from 4,000 to 48,000 (default 24,000). The budget counts the final compact JSON, including its own budget and truncation metadata. The MCP result contains this same JSON as text and structured content; transport wrappers are additional bytes.

When the full result exceeds the budget, the packet reserves a representative excerpt from each available identity, toolbox, project, task, and intent-evidence layer before adding more rows. Context packs also reserve archive and Minecraft rollup evidence when available. Task summaries and item arrays are bounded as well. IDs, task/checkpoint IDs, archive addresses, and timestamps survive compaction. `contextBudget.sections` reports available and included rows, and `truncated` signals that excerpts or rows were reduced. If even the minimal references and request metadata cannot fit, the tool returns `CONTEXT_BUDGET_TOO_SMALL` so the caller can increase the budget.

Use these references to descend into evidence: `mastermind_project_state` reads the saved task/checkpoint details, `mastermind_archive_fetch` opens an exact archive address and neighboring chunks, and focused memory/archive searches recover more relevant detail. This is a layered entry point into the existing sources; it does not yet traverse the entire original project/component/subject graph automatically. The packet should not be treated as the complete history. Pinned ordering remains the existing priority ordering; old high-priority statements still require reconciliation with newer primary evidence.

Dates from the database are returned as ISO timestamps. Search first uses the original lexical query. If that yields no lexical candidates, plain-language queries with at least two useful terms receive a parameterized OR-term fallback within the same project/source filters. Quoted phrases, explicit exclusions, and uppercase `OR` expressions keep their original semantics. `retrievalDetails.lexical` identifies `strict` or `term-or-fallback`, includes fallback terms when used, and reports whether an embedding was available. Keyword fallback can match only part of the intent; inspect and cite the evidence. This fallback does not turn lexical search into semantic retrieval.

Non-context tool results that exceed 65,536 compact JSON characters return a structured `RESPONSE_TOO_LARGE` error. Reduce `limit` or `contextWindow`; the gateway never substitutes an invalid JSON fragment for structured content.

## Persistent tasks and safe retries

For a new durable task, generate and retain a `taskId` and `checkpointId` before submitting a checkpoint. Retry an uncertain result with those same IDs and the same complete payload. A changed payload under an existing checkpoint ID is a conflict. Subsequent checkpoints for the same task retain its task ID, project, and original intent, and use a new checkpoint ID. The database binds the task identity, including its intent.

Omitting identifiers remains supported for existing callers, but generates new identifiers on each call. Such calls are not safe to replay after an uncertain result; the tool therefore advertises `idempotentHint: false`. Returned identifiers must be retained for later use. These records survive a new gateway process because they live in the existing database, provided the client actually writes a checkpoint and later reads it.

MCP initialization advertises tools and usage instructions. It does not itself run bootstrap, capture every conversation turn, update the personal profile, or close a session. Those behaviors require client lifecycle integration. Connecting this gateway alone must not be described as fully automatic session persistence for Codex, Claude, or any other client. `requestedScopes` currently labels requested context in bootstrap; operator authorization is enforced independently and these labels are not a fine-grained access-control mechanism.

## Configuration

The server loads the repository `.env.local` without printing its values. Required variables already used by the Memory console are:

```text
NEON_MEMORY_URL
MASTERMIND_MEMORY_HOUSEHOLD_ID
MASTERMIND_MEMORY_OPERATOR_PLAYER_ID
```

Optional Obsidian settings:

```text
MASTERMIND_OBSIDIAN_EXPORT_ENABLED=true
MASTERMIND_OBSIDIAN_VAULT=C:\absolute\path\to\vault
```

Alternatively, use the git-ignored `config/mastermind-context.local.json` for machine-local vault settings. The current PC is configured to project into `C:\Users\Mik\Documents\Mastermind-Obsidian`.

## Database migration

Migration `007_mastermind_context_gateway_v1.sql` adds canonical task and immutable checkpoint tables plus an authorized, idempotent checkpoint function. Review and back up the live memory database before running:

```powershell
npm run memory:migrate
```

The gateway read tools work before migration 007; project state reports `migrationRequired: true`, and checkpoint writes fail closed.

## Desktop connection

The STDIO command is:

```powershell
node C:\Users\Mik\Documents\mastermind-command-center\services\mastermind-context-gateway\src\mcp-server.mjs
```

In the ChatGPT desktop app, open **Settings → MCP servers → Add server**, choose **STDIO**, use the command above, save, and restart. The desktop app, Codex CLI, and IDE extension share MCP configuration on the same Codex host. Use `/mcp` to verify that `mastermind-context-gateway` is connected.

The equivalent CLI registration is:

```powershell
codex mcp add mastermind-context -- node C:\Users\Mik\Documents\mastermind-command-center\services\mastermind-context-gateway\src\mcp-server.mjs
```

## Verification

### Source conversation dates

`mastermind_archive_fetch` adds `exact.sourceTime` to the original evidence row. A `verified` value means the existing `archive_index_log.metadata.source_time_v1` projection passed the known schema, pipeline, exact document/source coordinates, UUID, digest, UTC timestamp, and Toronto calendar checks. `createdAt` is labeled **Conversation created**; `modifiedAt` stays separate and `messageTimeStatus` remains `not_reconstructed`. Original fractional precision is preserved. The gateway does not reread the source export on each fetch or infer individual message dates.

The projection read is parameterized by both exact coordinates, returns at most two matches, and selects capped scalar fields only. Provenance contains the source UUID and manifest/export digests; local source paths, bundle contents, and address lists are not exposed. Missing projections or read failures return `unavailable`, invalid projections return `unrecognized_projection`, and multiple matching index records return `ambiguous`. These outcomes keep the original archive evidence accessible with null creation dates and no legacy/import date fallback. Neighbor chunks and context-pack selection are unchanged. Existing operator authorization and response budgets still apply.

The first approved projection batch covers 25 source conversations and 1,996 existing archive addresses. This is source-document dating, not complete archive chronology. Source fixes are loaded by newly started gateway processes. A long-lived Codex MCP connection can continue running older code (including the old `{}` Date serialization) until its normal client/server reload; a fresh-process acceptance does not imply that an existing connection has reloaded.

```powershell
npm run context:test
```

Then call, in order:

1. `mastermind_system_status`
2. `mastermind_bootstrap` with project `mastermind`
3. `mastermind_context_pack` with a known historical intent
4. `mastermind_archive_fetch` using an address returned by the context pack

Do not enable Minecraft action tools as part of this verification.
