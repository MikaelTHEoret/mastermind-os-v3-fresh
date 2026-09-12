# Hosted shared-room service

This source candidate adds saved, task-linked rooms to the existing authenticated web service. It uses `mirror_core_sessions.context.chat`, preserving other context and state keys. No table, execution queue or model credential store is added.

`GET /api/chat/rooms/{taskId}/{session}` returns the room, transcript, task state and explicit transport capabilities. `POST` to that route accepts one `mastermind-room-v1` command with `operationId` and `expectedRevision`. The project is `mastermind` in this first profile. Session IDs are opaque identifiers; they are not credentials. The same Clerk owner can recover a room from another authenticated client.

The route uses the existing owner gate, exact same-origin mutation checks and bounded JSON parser. The authenticated Clerk identity is resolved through the established operator mapping. Every SQL read and write checks that mapping again, the active operator and task ownership. Completed tasks remain readable but reject mutations. There is no caller-supplied owner or arbitrary project selection.

Creation never overwrites an existing session ID, including a legacy or foreign session. Updates compare the complete previously read document in the database statement, rather than trusting a browser revision alone. If another command wins, the caller must recover current state. An identical operation recovers its existing result; a reused identifier with changed input fails. A failed or uncertain network response never triggers an automatic retry. The caller must retain the exact command for reconciliation.

The hosted transition adapter matches the private Python reference format and semantics. It is the authoritative writer for hosted rooms; the legacy Python SessionStore refuses room reads/writes and excludes rooms from legacy recent-session context. Selected prompts, exact text, authorship and hashes remain compatible between adapters. The store adds an immutable owner/task binding to each new room.

The accepted source profile supports **manual transfer**: prepare an attributed prompt, record intended handoff, acknowledge it, and retain an owner-pasted complete or incomplete answer. Manual not-sent evidence is an owner attestation, not an independently verified provider receipt. Browser, local and subscription participants can be declared for future connections, but their sends are rejected. Owner HTTP requests cannot manufacture `adapter-complete` receipts. Responses advertise `automaticDispatch:false`, `manualTransfer:true`, `midTurnSteering:false` and `executionAuthorized:false`.

## Validation

- Pure state tests: uncertain sends, exact replay, pending steering, attribution, cancellation, incomplete capture and reserved recovery capacity.
- Hosted store tests: two independent clients racing, identical operations, a lost write response, fresh recovery, revoked identities and completed tasks.
- HTTP tests using the actual request boundary and body parser: unsigned reads, cross-origin writes, oversized bodies, resolved subjects and sanitized errors.
- Explicit PostgreSQL fixture: actual production query strings run against synthetic records in a disposable schema inside one rolled-back transaction. Verifies ownership, exact-document compare-and-swap, immutable bindings, duplicate creation, unrelated session fields and rollback. Concurrent client scheduling is covered by the store fixture; the SQL fixture verifies the stale-write predicate sequentially.
- Private/public conformance: seventeen identical commands produce matching full documents, prompts, hashes, results and failure states. This is separate recovery evidence, not a private-source dependency in public CI.

Run `node scripts/check-public-source.mjs` from a checkout without operator environment variables or local environment files, then `node node_modules/typescript/bin/tsc --noEmit`. The database fixture is an explicit operator action and is never invoked by the public source test runner.

## Activation and continuation

This endpoint is a source candidate, not a production room acceptance. It is disabled unless `MASTERMIND_SHARED_ROOMS_ENABLED=true`, including in automatic previews. Before enabling it, install and verify the matching core guard that excludes shared rooms from legacy chat access. Preserve the previous web/core release. Then connect the existing ChatConsole and accept an owner workflow against the hosted service. The production ChatConsole is unchanged by this source slice.

Next: task-linked room selection, participant controls, attributed transcript, recipient/context selection, and queue/steer in ChatConsole. Then accept one provider adapter and bounded delegation. Do not advertise automatic dispatch, standalone discussion creation, mid-generation interruption or full ChatGPT feature parity yet.

Rollback removes the room route/UI but preserves existing room documents and the legacy access guard. Do not remove that guard while hosted room documents remain in the shared store. Do not replay model requests or overwrite existing task history during rollback.
