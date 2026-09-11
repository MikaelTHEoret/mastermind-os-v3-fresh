# Task-bound native worker candidate

This candidate adds `mastermind.native.reuse` version 1 to the existing negotiated
Stargate protocol and job ledger. It executes an already accepted native module through
the fixed local ModuleCore broker. It does not enable coding agents, arbitrary commands,
caller-selected URLs, new credentials, or another task/execution store.

`POST /api/nodes/{nodeId}/native-tasks` requires the authenticated owner and exact same-origin
request. Its body is an exact native request: task/project, optional checkpoint, saved
specification, operation ID, capability, candidate, requirements hash, input hash, arguments.
The operation ID is also the job ID. Reusing it with changed input conflicts. A busy worker
returns an explicit conflict; it never substitutes another task's result. Existing job reads
recheck the native task's current ownership and permission before returning private results.

The SQL guard verifies the existing operator, active task, project, optional checkpoint,
module call scope and exact READ_ONLY LPAC execution policy. The local broker independently
checks current authority, accepted source, specification, candidate and receipt bindings.
Revocation withholds both active and replayed leases. A successful pending worker receipt
requires local result recovery under current task authority before upload. Revocation holds
that outbox intact and degrades the worker until it can be reconciled; it is not silently deleted.

Lost local replies leave the worker journal nonterminal. Subsequent delivery uses only
`recover` for that operation. A missing or interrupted native operation is held/rejected;
recovery cannot execute it. A successful terminal result is replayed without repeating the
module. HTTP cancellation stops the wait; it does not establish that the LPAC child stopped.

The worker is opt-in with `MASTERMIND_NODE_NATIVE_REUSE_ENABLED=true` in the existing
core-only supervisor composition. Missing or false preserves status-only behavior; malformed
values fail before credential access. This setting has not been enabled in the live supervisor.
Requests are limited to 4 KiB, result data to 768 bytes and the typed result to 1,500 bytes,
with additional formatted-size limits, within the existing 2 KiB wire/4 KiB disk receipt bounds. Journal writes also enforce their recovery read limits before publishing a record. Larger results need a separately
accepted artifact-reference path. Candidate execution remains under existing LPAC limits.

## Validation and current boundary

The worker, protocol, owner route/store, revocation, lost-reply and legacy regression tests
pass locally. Complete TypeScript checking passes. The full migration022 was exercised in
PostgreSQL with fake identities in an isolated schema, including the previous021 cases;
rollback and unchanged production function definitions were verified. The fixture saves
source hashes and bounded diagnostics; `run-native-sql-fixture.mjs` needs an existing configured
memory connection and never applies a production migration. It requires psycopg2 in the
configured Python runtime. No user jobs, model calls or worker actions occur in that fixture.

This is a prepared transport/API candidate. Migration022 is not installed in production;
the website action, live native advertisement and end-to-end hosted acceptance remain open.
No effectful MCP scope or second-machine enrollment is claimed. The existing local native
release-inventory comparison remains accepted independently.

## Promotion and recovery order

1. Record exact web, worker and migration hashes and current database function/constraint
   definitions before installing the additive migration in one guarded transaction.
2. Deploy a reviewed web build with the new owner route and compatible inventory reader.
3. Install matching worker protocol sources under the existing service owner, explicitly
   enable native reuse, and verify its fresh hosted advertisement.
4. Submit a new bounded comparison operation, observe the existing ledger's result and
   reload/recover it. Do not reuse old acceptance operation IDs.
5. Accept the user-facing task flow and native result history before claiming remote release.

Rollback first stops new native submissions and drains/reconciles outstanding native jobs
and receipts. Disable the native worker setting only once its outbox can use the narrower
status-only profile; incompatible receipts must never be deleted to force a restart. Verify
the hosted advertisement is status-only before restoring a web build that rejects native
advertisements. Keep additive database compatibility and native history. Restoring the old
capability constraint while native rows exist is not a safe downgrade. Restore exact prior
function definitions only after proving their compatibility with preserved history and jobs.
