# Recover a saved review after delivery failure

A review may exist on the Windows runtime even when its hosted delivery expires.
The original delivery remains failed or expired. A separate recovery delivery
reads the original native operation and records its result under a new transport
ID. It never prepares another review or starts coding.

## Contract and interface

Review input version 3 uses the lossless version 2 content encoding. It requires
`action: recover`, a new `operationId`, and `savedOperationId` naming a terminal
version 1 or 2 review delivery. The saved owner, household, computer, task,
specification, original request, content and specification parent must match.
Successful recovery requires the native result to report `replayed: true`.
Recovery chains and a changed review ID from a previously successful delivery
are rejected. Current owner and task permission checks remain in force.

The Wizard offers **Recover saved review** for a failed or expired original
delivery when the selected worker advertises review version 3. Duplicate clicks
are suppressed. The new delivery ID is saved before submission; an uncertain
response is resolved by refreshing that same ID. Reloading or resuming shared
work reads saved status. Review editing continues to use version 2 on a version
3 worker, preserving lossless test cases.

There is no new coding authority, attempt, artifact publication or module
activation in this operation. Missing native history remains unavailable.

## Coupled rollout

1. Accept migration 034 in isolation and record current function preimages.
2. Stage compatible website readers with `MASTERMIND_REVIEW_RECOVERY_ENABLED`
   unset. Existing review and lossless flags retain their existing meaning.
3. Apply the reviewed migration once with preservation/readback evidence.
4. Install the matching worker closure through the existing runtime owner and
   host-policy transition. Set `MASTERMIND_NODE_REVIEW_RECOVERY_ENABLED=true`
   only alongside the existing coding-dispatch profile. This remains a
   nine-capability worker: only the review version changes from 2 to 3.
5. Verify fresh worker negotiation and prior history before enabling
   `MASTERMIND_REVIEW_RECOVERY_ENABLED=true` on the website. The native review
   and lossless flags must also be true.
6. Recover one known saved review, verify the original failed delivery is
   unchanged, and resume its source-package/build-plan history without
   republishing artifacts or starting another coding attempt.

Prepared source is not evidence that these activation steps occurred.

## Rollback and evidence

Before any version 3 jobs exist, the 034 rollback restores all six replaced
functions exactly. It refuses once version 3 history exists. With retained
version 3 jobs or worker outbox receipts, disable new recovery submissions but
keep compatible website, SQL and worker readers until reconciliation. Never
delete receipts or change a failed job to successful to make rollback possible.

The worker refuses a downgrade that cannot deliver its retained receipts.
The isolated PostgreSQL fixture checks exact rollback, idempotence, owner and
content substitution denial, old-worker exclusion, duplicate results, revoked
permissions, source-package recovery parenting, and unchanged failed history.
Worker tests exercise forced native recovery and restart. Wizard tests exercise
duplicate clicks, lost replies, reload and lossless subsequent editing.

Run the existing rollback-only `catalog-sql-fixture.py` with `--wizard --review
--development-work --lossless-review --coding-dispatch --review-recovery` against
a disposable PostgreSQL database. The fixture creates synthetic identities in
an isolated schema and always rolls back; it does not activate production SQL.
