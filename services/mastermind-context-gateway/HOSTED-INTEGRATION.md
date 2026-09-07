# Canonical context and hosted adapter

This source change reconciles the existing embodiment PR #2 (`9d00f66ab37653ad5877781ca768f7c8adf39fb1`) with the accepted local gateway. It does not deploy, change authentication configuration, bind an identity, or migrate a live database.

Local stdio and hosted Streamable HTTP share `tool-catalog.mjs`, `MastermindContextGateway`, `NeonMemoryStore`, context budgeting and exact source-time validation. Hosted `/api/mcp` projects seven read-only tools. `/api/embodiment/session` uses the same bootstrap service for an authenticated same-origin web request. The existing local chat and module boundaries remain in place.

## Authority and memory selection

The hosted request must first authenticate as `OWNER_CLERK_USER_ID` through Clerk OAuth (MCP) or the existing owner session (web). The exact subject must also be bound to `MASTERMIND_MEMORY_HOUSEHOLD_ID` and `MASTERMIND_MEMORY_OPERATOR_PLAYER_ID` in the existing `mastermind_player_external_identities_v1` table. The existing operator verifier must approve that player. Email, host labels, tool arguments and historical owner aliases cannot choose a different principal. An absent binding denies access; startup never creates one.

`COALESCE(memory_status,'active')='active'` now applies before lexical/vector ranking, pinned selection and Obsidian projection. Explicit `includeInactive:true` on memory search enables historical review and returns supersession provenance. Project task lists and exact reads are restricted to the same household and actor. The adapter reads `mastermind_context_tasks_v1` and `mastermind_context_checkpoints_v1`; PR #2's legacy task tables are reported by preflight, never silently merged or dual-written.

Hosted context defaults to 6,000 compact JSON characters and permits 4,000–12,000. The logical payload is capped at 24,000 UTF-8 bytes and its combined structured/text envelope at 65,536 bytes. Too-large responses fail explicitly with no partial preview. Shared local 6,000/24,000 context budgets, ISO timestamps and source references remain covered. Hosted embeddings are presently unavailable: retrieval reports its lexical mode instead of contacting workstation loopback or a paid provider.

## Native task publisher contract

`clientTaskState({taskId,project})` reads the exact owned task and returns its immutable intent, revision, latest checkpoint ID/summary/state/time, completedItems, openItems and blockers. Preserve unrelated progress when preparing a new full checkpoint. Task ownership by itself is not a permission grant for module promotion or other effects.

`checkpoint` retains an existing owned task's intent if omitted. For an uncertain result, retain the same taskId, checkpointId and complete payload. Without caller IDs, a call remains a new operation. Optional integer `expectedRevision` uses the prepared v2 compare-and-append wrapper. Missing v2 returns `CHECKPOINT_REVISION_UNAVAILABLE`; stale state returns `TASK_REVISION_CONFLICT`, requiring a fresh read and reconciliation. Never silently retry a stale checkpoint as an unconditional append.

`migrations/owner-replay-v1.sql` is PREPARED, NOT APPLIED and is outside automatic migration startup. It hardens the existing v1 receipt replay to check operator/project/intent before returning metadata, serializes checkpoint IDs, and adds a v2 wrapper with the same canonical tables. Exact successful retries replay before the revision comparison. Existing v1 callers remain compatible. Review the SQL, preflight the canonical target, test concurrent/stale/foreign-operator cases in a disposable PostgreSQL environment, and assign the migration in the existing release runner before any live apply. No legacy task import is implied.

## Verification and remaining activation

Run `node --test services/mastermind-context-gateway/test/*.test.mjs` from the web repository and run the application typecheck. Tests exercise the real MCP SDK transport with fixture authentication, active-memory query predicates, operator scope, native checkpoint compatibility, Unicode limits and denied writes. Fixture OAuth authentication is not proof of a real account login.

`scripts/read-parity-preflight.mjs [receipt-path]` is an explicit read-only fresh-process acceptance check. It uses the existing environment, disables embedding for the check, reports only schema/counts/task identifiers/context references, and never performs DDL or checkpoint writes.

Production deployment, production Clerk configuration, exact owner binding and real ChatGPT/Codex OAuth acceptance remain pending. Do not replace these gates with a static bearer token or weaken the local module gate. Current long-lived clients must reload normally to receive the updated local source. The private core release and public web release must preserve this shared contract through their reviewed artifact interface.

## Hosted API boundary

Every `/api/:path*` request now uses a default private-owner boundary, including navigator/archive data, memory, chat, dashboard, genealogy, provider keys, settings and future API routes. The only hosted protocol exceptions are exact `/api/node/v1/pair` and `/api/node/v1/exchange` (their existing paired credentials), and `/api/mcp` (its strict owner OAuth adapter). Public site pages and `.well-known` discovery remain outside the API gate. No signed external webhook/callback implementation was found in the current route inventory. Static write tokens do not replace owner authentication for private hosted knowledge.

The current local development UI is preserved only with `NODE_ENV=development`, no Vercel marker, a loopback URL and Host, and absent/same local Origin. Existing inner operation gates still run. Configured local owner-gated routes still receive Clerk request context. The exact local genealogy acquisition extension retains its existing approved-client credentials and pending-registration protocol. These header checks do not attest a network peer; the development listener must remain on loopback. Production-local deployments require the owner configuration. Private navigator/review content no longer emits wildcard CORS.

## Canonical native permission contract and activation

`clientTaskState` includes nullable `permissionScope`, decimal-string `permissionRevision` and `permissionScopeSha256`. Absence is a denial, not inferred authority. `clientAuthorizeModule` requires an exact current active task, matching revision-bound grant reference, exact module/capability set, configured repository root, entrypoint beneath its explicit candidate root, allowed operation and `windows-lpac-pure-json-v1`. Candidate execution is READ_ONLY with staged inputs only, no network, child processes or coding agent. The native host must independently verify real filesystem paths and isolation receipts. Multiple exact module entries can coexist; replacing a scope requires preserving the full intended list explicitly.

The native subprocess seam is `scripts/client-task-adapter.mjs`, accepting bounded JSON `{action,arguments}` on stdin. Actions are only `readTask`, `authorizeModule`, and `checkpoint`; there is no grant-setting or arbitrary-method action. Owner administration uses the separate `scripts/set-task-permission.mjs <reviewed-command-file> <SHA256>`. Both the native event publisher and owner command retain exact checkpoint IDs and payloads after uncertain delivery. Existing prepared payloads with control characters are held unchanged.

The reserved central files are `memory-system/migrations/019_mastermind_context_owner_replay_v1.sql` and `020_mastermind_context_task_permissions_v1.sql`. They exactly match the service migration copies. The latter adds permission fields on the existing tasks/checkpoints, inserting complete scope snapshots once at checkpoint creation; it preserves the original immutable checkpoint update/delete rules. The existing apply-all migration runner was not invoked or changed by this slice.

The targeted review helper is `services/mastermind-context-gateway/scripts/canonical-schema-activation.py`, launched with `scripts/run-canonical-schema.mjs`. Its prepare action is read-only and records the canonical resolver fingerprint, exact migration hashes, function/rule preimages, canonical progress hashes and substrate counts. Apply requires that reviewed file hash, locks the existing task/checkpoint aggregate, verifies all preimages, applies both migrations atomically and verifies preserved progress before commit. Rollback requires the reviewed apply receipt and no new progress or permission use; otherwise it holds for a deliberate revoke/roll-forward decision. A receipt-write failure after commit is uncertain and must be resolved by canonical readback, never a blind retry.

Real PostgreSQL acceptance used only fake records in an uncommitted isolated schema. It covered stale/foreign/replay checkpoints, permission CAS, immutable snapshots, progress preservation, revocation, historical replay and advisory-lock exclusion from a second connection; rollback and unchanged canonical function were verified. It did not exercise simultaneous committing publishers. Activation-driver fixtures separately cover reviewed-file mismatch, changed progress, postcondition rollback and refusal to roll back a used grant.
