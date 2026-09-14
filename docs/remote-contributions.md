# Remote assignment and result exchange

This extends the existing `/api/mcp` OAuth surface and immutable
`mastermind_task_contributions_v1` records. A connected client can retrieve an
assignment, submit its original response, and retrieve a separate review. The
owner's existing Forge history displays the same records after refresh.

This is advisory collaboration. It creates no task scheduler, worker lease,
checkpoint overwrite, execution permission, provider dispatch or transcript
capture. Contributors may work independently on one assignment. Exclusive
claiming and automatic dispatch still require acceptance through the existing
job ledger; a response must never be treated as evidence that a worker ran code.

## Activation

Both feature switches default off. With both off, the existing seven-tool
read-only surface and required OAuth scopes remain unchanged.

1. Confirm migration 025 and the current canonical owner binding on the target.
   This release does not require a new migration or worker restart. Migration
   026 belongs to the separate Wizard candidate; do not activate it for this work.
2. Deploy compatible contribution readers, including the updated owner UI.
3. Set `MASTERMIND_MCP_CONTRIBUTIONS_ENABLED=true` to expose
   `mastermind_contribution_list` and `mastermind_contribution_fetch` under the
   existing context-read permission. There are then nine tools.
4. After approval of the new access, assign the exact optional OAuth scope
   `mastermind:contributions:write` to the intended existing client applications.
   Confirm the issuer actually grants that scope; discovery does not create it.
   Preserve the current owner, client allowlist, issuer, audience and callbacks.
5. Set `MASTERMIND_MCP_CONTRIBUTION_WRITES_ENABLED=true`. The tenth tool,
   `mastermind_contribution_submit`, advertises the additional scope. Existing
   read-only tokens still work and cannot submit. Reauthorize only clients that
   should submit. Do not add the write scope to the globally required scope list.
6. Refresh client tool discovery and run the two-client acceptance below.

Invalid switches and a write switch without contribution reads fail closed.
The application resolves the authenticated Clerk subject to the configured
canonical operator and rechecks that binding before each database statement.
Each store statement also checks the supplied Clerk binding in its own SQL
snapshot, alongside current task ownership and operator authority.
Only active Mastermind tasks accept submissions; completed tasks remain readable.
Browser imports cannot supply the server's verified submission attribution.

## Client workflow and recovery

- Recover the task with `mastermind_project_state`. List contribution references
  using its task ID and project. There are at most eight references per page.
  Continue with the exact `nextCursor`; restart from the first page to see newly
  appended work. This is a bounded current history, not a frozen snapshot.
- Fetch a chosen artifact from offset zero, then each exact `nextOffset`.
  Concatenate the canonical JSON text parts in order. Check SHA-256 of the
  reconstructed UTF-8 bytes against `artifactId` before using the record.
  Offsets count JavaScript UTF-16 characters; surrogate pairs are never split.
  A missing cursor, invalid offset or corrupted hash fails explicitly.
- Submit the typed assignment, response or review shown by the tool schema.
  Generate and retain the operation UUID and exact input before calling.
  Responses refer to the assignment hash; reviews refer to the response hash.
  Use provider `other` for a Codex contributor and record the reported model.
  The original input uses the existing manual record format. The server adds
  `submission: {transport: 'oauth-mcp', subject, clientId}`; remote responses
  use stored `captureMode: 'mcp'`. It preserves the response text exactly.
- Retain the receipt's `inputHash`, `artifactId`, operation ID and attribution.
  `inputHash` is SHA-256 of the canonical original input. `artifactId` is SHA-256
  of the canonical record including server attribution. The pure
  `attributedRecord` helper constructs that expected record for verification.
- After a timeout or lost reply, submit the same input using the same registered
  client. A committed submission returns `duplicate`; changed content or client
  attribution conflicts. Do not choose a new operation ID to resolve uncertainty.
  If the task has completed, reconcile by list/fetch instead of writing again.
  Separate clients sharing one registered client ID cannot be distinguished as
  machines; attribution is not machine identity or independently verified model
  provenance.
- A review accepts advice only. Testing and module promotion remain separate.

The remote input limit is 24,000 canonical UTF-8 bytes; the existing store retains
its 65,536-byte record limit and 64-record task capacity. Fetch can reconstruct
larger records already saved through the owner interface. No output silently
truncates an original. If the existing sensitive-text filter would change an
original, the remote adapter refuses it explicitly; prepare a separate shareable
record through the owner interface without altering its original. Listing titles
uses the usual context redaction and is not an exact record export.

## Verification and rollout acceptance

Source fixtures cover the real MCP SDK transport plus the existing store: two
clients, reconstructed sessions, lost replies, conflicting inputs/client IDs,
separate reviews, large Unicode reports, bounded pages and capacity, revoked
bindings, foreign/completed tasks, missing parents, unassigned providers, scope
and origin denials, attribution forgery, truthful status and owner UI readback.

Run the public source checks in a process without operator configuration, the
TypeScript check and production build. The SQL fixture uses a random schema,
executes the actual store queries, verifies attributed JSONB originals and
immutability, and rolls back. It must never be used as a production migration.

Live acceptance remains separate: save a bounded assignment from client A;
fetch its exact record from client B; submit a cited response; review it from A;
refresh the owner UI; reconstruct a client and recover all three original hashes.
Retry one exact submitted request and verify no duplicate row. Confirm that a
read-only token cannot submit and both clients can still bootstrap. No provider
message, worker enrollment or Minecraft access is necessary.

## Rollback

Before accepting attributed writes, save a compatible read-only deployment as
the rollback target. To stop writes, disable the write switch and revoke that
optional grant as appropriate; keep compatible readers to recover originals.
Disabling both switches restores seven MCP read tools on the same code revision.
Never erase contribution rows or downgrade to a reader that rejects the new
optional attribution fields after such records exist. Keep an accepted compatible
reader available. Rolling back an entire web release must also respect any
pending Wizard/native jobs from other features.

Source checks do not establish production OAuth scope assignment, publication,
deployment or actual two-computer acceptance.
