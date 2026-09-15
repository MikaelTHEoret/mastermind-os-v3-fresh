# Wizard follow-ups and request revisions

The connected-computer form uses explicit dark text on white fields, including
Task, Computer and the Wizard description. Native light color scheme keeps the
open select menu consistent. A successful preparation says **Request saved**;
it does not imply that specification or implementation is complete.

The specification receipt accepts an optional `missing` array from the core's
retained specification identity. It must agree with `missingCount`, contain at
most eight single-line strings of 160 characters, and fit all existing receipt
byte limits. Old count-only receipts remain readable and are labelled explicitly;
the UI never fabricates their questions.

**Revise saved request** opens the saved description for edits. Unsent edits are
stored locally against the original operation; refresh restores them. Saving
creates a new operation with `revisionOf: {operationId, requestHash}`. This parent
binding participates in the canonical request hash. The hosted and local brokers
independently require the matching original operation on the same authorized task.
The original request and result are retained. Duplicate clicks or uncertain replies
continue to use the same new operation; no automatic resubmission is introduced.

Answers remain draft requirements: natural-language understanding, independent
test derivation and reviewed source selection remain separate native workflow work.
The existing **Find capabilities** action inspects accepted capability contracts.
Draft editing disables selection/discovery so it does not silently replace edits.

## Release order and recovery

This candidate requires compatible web/worker readers, additive migration027 and
the matching Python task-specification broker. Install readers before allowing new
revision inputs or emitting detailed receipts. A v1 worker advertisement alone does
not prove this additive feature is installed; acceptance must pin the paired source.
No public database records are rewritten by027.

Retain a compatible reader release as the rollback floor once a revised job or a
detailed receipt exists. Disable new revision submission before rolling back UI;
preserve027 and readers. A downgrade to strict026 readers would reject the new
shapes and is not a valid full rollback after new work is saved. Existing uncertain
jobs/outbox effects must be reconciled before replacing the worker broker.

## Validation

The synthetic React workflow covers exact parent binding, duplicate submission,
reload recovery, unsent edits, old summaries and denied/uncertain work. Python
fixtures prove that original and revised identities survive restart, foreign or
changed parents fail before persistence, and no candidate executes. The paired
Python/Node acceptance checks real persisted receipts and Unicode hashes.

The disposable PostgreSQL fixture runs026 followed by027 in an isolated schema and
always rolls back. It checks old-result access, question bounds, original-result
preservation, parent denial, revision hash parity and the actual shared-history
query. Run `catalog-sql-fixture.py <receipt> --wizard` only with its operator-owned
fixture connection; the ordinary public test suite never reads live credentials.
