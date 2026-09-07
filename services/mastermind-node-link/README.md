# Typed core-status exchange (prepared v2)

The worker defaults to the existing v1 family operation. Pairing, credentials,
fixed HTTPS paths and existing journal/receipt tables are retained.

Explicitly setting `MASTERMIND_CORE_STATUS_ENABLED=true` (or the composition
option `enableCoreStatus: true`) advertises exchange protocol 2 with exact version 1
support for `family-ecosystem.ensure-running` and `mastermind.core.status`.
The server echoes the accepted advertisement. Unknown capabilities, mismatched
versions and unadvertised leases fail closed.

`mastermind.core.status` accepts exactly `{}` and performs four fixed loopback
GETs: MCP host health and catalog on 8772, memory health on 8765, module health on 8770.
It returns a typed observation with timestamp, three service states, bounded tool
count/digest, active-turn count and completeness. It emits no raw catalog, paths,
credentials, URLs supplied by a caller, shell execution or model invocation.
Offline or malformed sources yield explicit incomplete observations. The read
budget is 3 seconds per parallel request, response bodies 256 KiB each, output 1 KiB.

The Nodes panel shows Check core status only after an explicit compatible stored
worker advertisement. Offline nodes offer Queue core status; stale inventory
disables the action. Reconciliation retains both the original UUID and capability.
The result shows observation time, service states, tool count and active turns;
incomplete observations are labeled separately from family readiness.

The existing owner route `POST /api/nodes/{nodeId}/jobs` accepts only the two
known capability names plus a UUID requestId. Clerk owner admission, exact
same-origin mutation checks and canonical parent/node authorization remain in
place. Queued jobs retain their original creation/expiry timestamps and do not
claim a worker is online. Only an explicitly capable v2 worker can lease core
work. Core leases last at most 30 seconds without extending the original expiry;
the existing family startup window remains unchanged.

Migration 021 must be installed through the scoped canonical activation owner
before a compatible hosted release and worker opt-in. It installs a family-only v1 wrapper
and filters replay, receipt ownership, renewal and queued dispatch before it
broadens the existing job constraint. It also explicitly rejects required SQL
NULL inputs in both exchange and enqueue entrypoints, and prevents terminal
results from crossing capability types. No new task store, arbitrary proxy or
service lifecycle owner is introduced.

A completed journal entry replays without repeating its observation. A process
interruption before a terminal receipt is durable can repeat this read-only
observation; this is not a claim of exactly-once execution across every crash.
Do not downgrade a worker with pending v2 receipts to v1: let the negotiated
worker deliver its journal first. This source change does not pair, enable or start a worker.

Review/apply order for the owner of the release: verify migration 021 and source
pins; apply through the canonical migration owner; deploy compatible hosted
exchange/owner route; opt in one already-authorized worker; test real authenticated
owner enqueue, offline queue, negotiated delivery and receipt replay. These last
hosted/worker acceptance steps remain pending. The current rollback-only SQL
fixture demonstrates the database logic, not a production migration or pairing.

Verification:

- `node --test scripts/test/mastermind-node-exchange-contract.test.mjs services/mastermind-node-link/test/*.test.mjs src/lib/node-exchange/__tests__/*.test.mjs`
- `node services/mastermind-node-link/test/run-core-sql-fixture.mjs <receipt-path>`
  uses the existing configured canonical target in a uniquely named fake schema,
  rewrites every public reference, strips transaction wrappers, rejects escape,
  always rolls back, and compares public function hashes afterward. It does not
  apply the migration to public tables or use real node credentials.
- `prepare-core-migration.py` reproduces 021 from preserved 004/006; an existing
  differing artifact is rejected unless `--reviewed-update` is explicitly used.

The v2 JSON schema was checked with the already installed AJV 6 using its shared
validation-keyword subset. Runtime validators enforce negotiation and derived
completeness rules beyond that check; no claim is made of an installed 2020-12
schema engine.

## Explicit core-only composition

`src/run-core-worker.mjs` is an alternative entrypoint for an already enrolled
CurrentUser node. It advertises **only** `mastermind.core.status` version 1 with
exchange protocol 2. It retains the protected vault, fixed HTTPS transport and
same effect journal; it neither pairs an unpaired node nor completes pending
enrollment. It does not construct a family controller client or start the
Minecraft controller, game, or web server. Family status fields explicitly remain
unavailable to this profile. Only the separate typed core observation reports
core service health.

The canonical local-core supervisor owns this entrypoint through explicit
`local-core-stargate` (existing eight services plus one worker) or
`local-core-refresh-stargate` (existing nine services plus one worker). The
existing `local-core` and `local-core-refresh` profiles are unchanged. The
supervisor checks the retained Node executable hash, uses a small child
environment allowlist, and sets the fixed core-only profile and child role.
No startup preference or scheduled task is changed by source preparation.

Both family and core entrypoints acquire the same OS-owned per-vault lifetime
endpoint before loading credentials, so they cannot concurrently consume the
same journal. It is a named pipe on Windows, not a TCP listener or PID lockfile.
Core-only exchange checks every pending receipt against its authoritative
journal effect and capability version before transport. An unsupported retained
receipt holds exchange; no old receipt/effect is dropped, acknowledged or
rewritten to switch profiles. Completed compatible observations replay from the
journal without another read.

The controlled restart helper pins worker sources for explicit opt-in and
rollback. If a newly launched opt-in supervisor definitively exits, the helper
can make one restoration attempt to the immediately preceding ordinary core
profile, after exact ownership/source/state/idle checks. A still-live slow owner
remains degraded under its existing owner; it is not automatically replaced.
Ambiguous tracking, changed descendants or busy core work holds restoration.
This is source/fixture acceptance only until the release owner runs a reviewed
activation and records the actual hosted delivery receipt.

The owner Nodes panel renders family controls only for nodes advertising them
(or legacy v1 family nodes). Read-first recovery of already issued operations
remains available after capability withdrawal; a missing job is not re-enqueued
without current matching authorization. In local-control mode the Nodes panel
hands off to the hosted owner dashboard; it does not create a second local owner
API or web process.
