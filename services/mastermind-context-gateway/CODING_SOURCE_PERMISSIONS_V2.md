# Coding source permissions v2 — source candidate

This slice has **not been activated**. After a fresh resource review authorized
one serialized slot, 18 focused Python fixtures and 20 Node fixtures passed.
They used synthetic callbacks/stores; no real PostgreSQL, model, account/profile
or destination-host operation ran. Broader CI, actual SQL and host acceptance
remain separate from these focused checks and independent source review.

The existing task aggregate remains authoritative. Version 1 is unchanged:
its normalized four-key scope, full-scope digest, module policy, grant reference,
owner checks and stored history retain their existing meanings. Version 2 adds
`codingSources` to the complete retained module scope. It does not turn the pure
LPAC policy's `codingAgent:false` into permission to run a coding agent.

## Distinct effects and interfaces

An entry authorizes eligibility for one `coding.source-work` operation, against
an already committed source base. It binds the original request and accepted
review content, source manifest, one Python target, immutable requirements and
cases, exact task/checkpoint, CLI binary/profile, account-evidence/profile hashes,
isolated worktree/artifact roots and all resource limits. Defaults are at most
300 seconds and 2 GiB, with the other existing worker limits retained.

The effect is a private local branch, no push/deploy/activation. The existing
CLI profile is `codex-approve-for-me-workspace-write-v1`. Target enforcement is
explicitly **post-execution acceptance**. This scope does not assert LPAC
containment for the coding agent or prevention of every source effect. Newly
generated code still needs independently pinned LPAC tests and a separate
current module grant before promotion or invocation.

`clientCheckCodingSource` is an internal exact-owned-task eligibility read. The
bounded native stdin adapter adds only `checkCodingSource`; it cannot set grants.
The response has `scopeAuthorized:true`, `executionAuthorized:false`, exact entry
and binding hashes, and required host/profile/review/path proof flags. There is
no new HTTP, MCP or caller-controlled grant writer. Existing explicit owner
`clientSetTaskPermissions` selects the reviewed v1 or v2 SQL function by schema
version; unavailable v2 is a typed hold, never a v1 fallback.

`CanonicalCodingAuthorizer` in the retained Python client reopens the saved plan,
pinned review/source, current task and active revision before interpreting that
eligibility. Its separately configured trusted profile callback must prove the
exact account-evidence/profile/entry/binding hashes and actual resolved paths.
Both proof booleans must be literal `True`. A named account, caller/model boolean,
or metadata hash alone is not authority. It rereads task and plan after proof.
Missing host proof holds before task lookup. **No actual profile/account verifier
has been installed or accepted by this source slice.**

## Review and permission checkpoint ordering

Putting a digest of the entire task-bound plan into the scope would be circular:
the task snapshot contains that same scope. `review_content` therefore retains
all reviewed fields except the task-bound `reviewEvidenceSha256`. The independent
source manifest has its own digest. Each new entry binds the permission command's
resulting checkpoint and task revision (`expectedRevision + 1`).

The pure `propose_coding_entry` helper derives a full explicit replacement scope
from the saved request/review/source, retaining all earlier module/coding entries.
It cannot set it. After the explicit owner/CAS permission command succeeds,
`bind_installed_review` requires the exact resulting task, checkpoint, permission
revision and scope digest. It derives only the new task-bound review envelope and
ordinary existing plan; it cannot change reviewed content or write state.

Consequently a later task advance or changed permission scope holds execution.
Prepared permission/checkpoint payloads stay immutable on an uncertain response;
retry the same checkpoint, revisions and bytes. Historical operation IDs cannot
be rebound to another descriptor, even after removal from the current scope.
Unknown coding-worker operations still require the existing explicit effect
reconciliation and never rerun automatically.

The earlier creation of requirements/tests/review artifacts is a distinct host
materialization effect. This v2 entry starts with an existing `baseCommit` and
does not authorize that earlier write. The developing review producer should
derive those artifacts and this proposal from saved specification evidence and
a separately reviewed host permit, rather than permanently asking the user to
hand-author per-request JSON. No materialization permit is installed here.

## SQL ownership, compatibility and rollout

The sole authoritative new migration is
`services/mastermind-context-gateway/migrations/task-permissions-v2.sql`.
It depends on the existing v1/owner checkpoint migrations and adds functions
only: no table, column or competing grant store. Do not create an independent
copy under `memory-system`. The existing service v1 and central
`020_mastermind_context_task_permissions_v1.sql` remain byte-identical at SHA256
`93d2c39721ec164a3ef080a4655582f147eecdb98dd751ab9e3e31154a368626`.

V2 uses the existing checkpoint-then-task transaction advisory locks, operator
and owner checks, dual revision comparison, append-only checkpoint snapshot and
progress preservation. Its module metadata validator additionally matches the
strict existing JS/Python uniqueness and canonical path grammar. These metadata
checks cannot attest junctions, aliases or actual destination ownership.

Rollout order is: accept source fixtures and real disposable SQL; deploy all
version-aware readers without installing any scope; install the reviewed v2
function; prove actual host account/profile/path/resource admission; derive a
single reviewed proposal from the fresh task; explicitly set that exact scope;
then bind the resulting review and accept one bounded workflow. A missing step
holds. None of these rollout actions occurred in this slice.

Rollback uses the existing owner/CAS setter with a new checkpoint to restore the
exact prior complete v1 or v2 scope, retaining all historical permission snapshots.
Reconcile started or unknown source work first. Do not roll readers back to a
module-only parser while active v2 task scopes remain, or drop the function while
an uncertain v2 command needs exact replay. The guarded schema preparation below
also refuses function removal while any current v2 scope remains.

## Off-machine acceptance proposal

The ordinary gateway test discovery includes `test/coding-source-permissions.test.mjs`.
Run the retained `test_coding_task_authority` with the existing planner, saved-plan,
dispatch, projection and permission bridge suites in the private synthetic gate.
Mirror `fixtures/coding-source-permissions-v2.json` exactly between both source
trees; its normalized v1 literal is a cross-language digest regression fixture.

Real SQL acceptance is separate. `scripts/verify-coding-permissions-sql.py` is
import-safe and requires an explicit empty **loopback** database whose name starts
`mastermind_fixture_`; it reads no canonical DSN setting. It composes the actual
v1 and v2 sources inside one outer transaction, creates only synthetic owner/task/
checkpoint fixtures, tests apply/replay/conflict, dual CAS, wrong owner, malformed
module/source scopes, immutable progress/history, revoke and explicit v1 restore,
then rolls everything back and checks schema absence. It prints outcome and
source/output hashes, with a bounded sanitized failure excerpt when necessary;
connection and password values are redacted before truncation.

Use a separate GitHub Linux service job with an explicitly reviewed, immutable
PostgreSQL container image digest and test-only credentials; pass the same digest
for server and psql client if the client is run in that image. Check PostgreSQL and
psql versions in that job before execution. The existing isolated workflow pins
both to its reviewed PostgreSQL 17.11 image and records their identities. No local
PostgreSQL installation is required. The job must have no account
secrets or canonical database settings and must not deploy or upload runtime data.
Invoke the runner with the job's explicit loopback fixture DSN, then retain its
JSON result and source hashes. Do not label SQL compiled/accepted until this job
actually passes. Root owns the final image pin and CI integration review.

The prepared runner models the permission tables/append-only rules; it does not
claim broad migration equivalence for every unrelated production table. Real
destination activation remains a separately reviewed step after synthetic proof.

## Shared guarded migration rehearsal

`scripts/coding_permission_schema_guards.py` is the one pure renderer used by
both the versioned canonical preparation and the disposable SQL runner. It admits
only the exact reviewed two-function migration bytes. Canonical rendering embeds
the separately pinned read-only catalog preimage as literal JSON. Disposable
rendering instead captures the synthetic database's own catalog inside its outer
rollback transaction; it cannot import a canonical receipt or connection setting.

Both modes use the same owner/database/version checks, NOWAIT SHARE table locks,
transaction advisory lock, protected v1/table catalog comparison, exact new
function body/attribute/ACL checks, and finite statement/lock/idle limits. A
same-source apply is a verified no-op. Partial, altered, overloaded or unexpected
protected schema states hold. Rollback checks exact function identity, refuses
while any current task scope has schemaVersion 2 (even if both functions are
already absent), and drops only setter then
validator with RESTRICT. Existing v1 functions, task rows and checkpoint history
are preserved. The caller must separately resolve uncertain commands before
dispatch; these guards do not prove absence of a retained undelivered command.

The existing disposable job now rehearses first apply, replay, partial state,
changed function body/ACL, changed protected table, refusal of rollback during a
current v2 scope with installed or missing functions, explicit owner/CAS
restoration to v1, guarded rollback and
rollback replay. Its original permission/history/revocation tests and final
outer rollback remain. The same pinned PostgreSQL image/client, no host ports,
synthetic credentials and five-minute job bound are retained. Failure diagnostics
are bounded to 4096 sanitized characters after connection/password redaction,
with full output hashes and byte counts; successful output remains the exact
acceptance sentinel. The initial source-only guard fixtures do not establish that
the SQL has executed. A new passing disposable job is required for these guards.

The earlier canonical preparation files and receipts are immutable historical
evidence. The shared renderer produces separately versioned apply/rollback files
and records its own exact source hash alongside the same pinned canonical
preflight and authoritative migration. No migration or grant is applied by
rendering or by ordinary service startup.
