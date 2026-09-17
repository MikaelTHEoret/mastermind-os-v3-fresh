# Source packages and build planning over the existing worker

Two opt-in v2 capabilities use the existing job, lease, effect journal and receipt
protocol: `mastermind.native.review-artifacts` and
`mastermind.native.review-build-plan`. They accept saved identifiers only; no
source text, filesystem paths, Git arguments, authority permits or model settings
come from the remote request. Neither capability starts a coding worker.

Each network job has its own `operationId`, matching its job ID. The immutable
`artifactOperationId` identifies the existing local source package across prepare,
publish, reconcile, resume and recover jobs. Build planning additionally uses a
distinct `buildOperationId`. Reusing a local identifier cannot replace its binding;
the local registry's task/review/version checks remain authoritative.

The adapter calls only `/task_review_artifacts` or `/task_build_plan` on the fixed
loopback service. Expired or cancelled calls do not start. Lost, malformed or
unsuccessful replies preserve the journal's uncertain state. Redelivery calls
only `recover`, never publish, resume or prepare. A retained proposal/prepared
record cannot confirm a lost publication. Recovery must show published state,
or the original job remains held for explicit reconciliation.

Successful saved receipts require fresh task authority before outbox delivery and
replay. Their binding, state, hashes and holds must still match. Git verification
is separately dated by `gitVerifiedAt`; replay retains that original timestamp.
Historical recovery does not reverify Git. A fresh reconciliation is needed for
a new Git observation. Receipt limits remain 2048 bytes on the wire and 4096 on
disk; the compact payload is limited to1450 bytes (2900 formatted).

## Activation boundary

`MASTERMIND_NODE_DEVELOPMENT_WORK_ENABLED=true` requires the existing review,
review-reuse, specification and native-task switches. Without it, the six-capability
worker remains unchanged. The opt-in worker advertises eight capabilities and
version `0.8.0-development-work`; older workers cannot receive the new operations.

**Do not enable this against the current production ledger.** Hosted SQL capability
constraints, exact request/result validation, parent review provenance, owner read
filters, enqueue routes and the Wizard interface are the next integration unit.
The production database currently rejects these capability families. This change
does not migrate a database, install the Python hosts or activate the worker.
Live activation also needs independently pinned artifact publication authority
and coding-provider configuration; a saved review cannot manufacture either.

## Verification and rollback

`native-development-work.test.mjs` exercises the real file journal and worker
through negotiation, duplicate delivery, process reconstruction, lost replies,
changed source bindings, revoked access, invalid authority and cancellation.
`runtime-development-fixture.json` contains synthetic outputs produced by private
runtime revision `7eed235`, using its real review store/materializer/projector and
build planner with an in-memory Git fixture. It contains no operator data or
credentials. Tests preserve its exact source/test hashes through both languages.

Source predecessor is web `8c086923f8e67dd55f57c64ecb7cb4cdac0a5f51`. The current
production release is unchanged. After future activation, drain new operations
before disabling the switch. Retained incompatible receipts must be reconciled
with a compatible reader, never deleted to force an older worker to start.
