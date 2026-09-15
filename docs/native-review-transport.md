# Saved Wizard review transport and editor

A saved Wizard description can now continue into an advisory review on the same
Stargate ledger. The owner loads prepared review content, edits requirements and
schema-generated examples, checks quoted request coverage and saves one operation.
The original description and requirements remain readable after remote recovery.
The editor retains an unsent draft in that browser; submitted content and receipts
are retained in the existing hosted job and local specification records.

This first editor consumes a prepared review file. It does not yet generate a
complete structured review from prose, edit capability schemas, or automatically
approve a review. That composition stage remains work for the Wizard. The UI is
shown only when the selected worker explicitly advertises review support.

## Contract and ownership

`POST /api/nodes/{nodeId}/native-review` requires the existing same-origin owner
authentication and `MASTERMIND_NATIVE_REVIEW_ENABLED=true`. It accepts an operation
ID and the strict `mastermind.native.review` v1 input. This includes the canonical
task reference, saved specification ID, successful parent Wizard operation, exact
original request and existing eight-field review content. No caller path, grant,
executable, source pin or acceptance flag is accepted at the transport boundary.

Migration028 extends the existing jobs, receipts and negotiated exchange. No new
table, execution queue, account or credential is created. Parent task/owner/node,
specification and exact original text are checked before enqueue. Every lease,
outbox upload and owner result read checks current authorization. Other native
jobs share the same busy limit. Duplicates recover the exact operation; changing
its content conflicts. Old workers cannot lease a review.

The worker calls only the fixed loopback `/specification_review` endpoint. It
checks the original request and canonical content hashes against the full local
reply, then retains a compact receipt. Source paths, task permissions and artifact
permits remain on the host. A saved proposal is always `accepted=false` and
`executionAuthorized=false`. A held proposal is a recorded result, not a passed
acceptance test. Receipts describe the observation at save time; subsequent host
recovery rechecks current task and source state before disclosing them.

Lost replies remain uncertain. Restart/re-delivery invokes recovery only and never
silently prepares another review. A changed/revoked task or changed recovered
receipt stops cached outbox disclosure. Existing failed/uncertain records are not
discarded to make a retry look successful.

## Bounds

The first remote profile accepts at most16 KiB compact JSON,24 KiB formatted input,
safe integer numbers,20 JSON nesting levels and the existing bounded requirements,
contracts and cases. Larger inputs and noninteger numbers are rejected without
truncation or rounding. The local intake still supports its broader100 KiB bound.
The exchange response remains32 KiB and wire receipt remains2 KiB. Durable local
effect files allow32 KiB instead of8 KiB; receipt files retain their4 KiB bound.
This deliberately reuses ledger input storage rather than misclassifying a review
as an external-model contribution or adding a second artifact service.

## Activation and rollback

Source acceptance is not production activation. Migration028, the new worker and
the new private review host are not installed by this change.

1. Publish and deploy compatible readers with the hosted review flag off. Existing
   job/history reads do not resolve028-only functions until a review exists.
2. Apply028 with preservation evidence. Install the reviewed private source intake
   and its explicit, hash-pinned host configuration using the existing supervisor.
   The host configuration supplies fixed per-module source pins in the primary
   private checkout. Linked worktrees are intentionally unsupported by the existing
   Git object reader. A configured reader still verifies the source on every new
   review; configuration does not grant execution authority.
3. Accept the local source reader and intake before enabling
   `MASTERMIND_NODE_NATIVE_REVIEW_ENABLED=true`. This also requires the existing
   native-reuse and Wizard flags. Verify its five-capability advertisement.
4. Enable the hosted review flag and exercise one owner workflow, full reload and
   remote recovery using the same saved operation. Do not promote any candidate.

To pause the feature, disable new hosted review admission. Retain028, review-aware
readers and the32 KiB journal reader while review jobs/effects exist, and preserve
the review source host for pending recovery. Reverting to a pre-review worker can
make its journal unreadable; it is not an accepted rollback. Accept the compatible
feature-off release as a rollback target before live activation. Never delete a
pending effect, submitted review or parent Wizard request as rollback cleanup.

## Validation

Fixtures cover the actual file journal and restart, uncertain replies, revoked
outbox disclosure, large complete payloads, fixed local endpoint and altered
content. UI fixtures cover ordinary field editing, draft reload, source mismatch
and duplicate clicks. Owner route/store cases cover disabled admission,
authentication and current parent authorization. The extended existing SQL
fixture executes actual028 in an isolated temporary schema, then verifies rollback
and unchanged production functions. It also preserves the original021–027 checks.
