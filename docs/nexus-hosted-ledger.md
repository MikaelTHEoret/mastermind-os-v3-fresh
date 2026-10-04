# Hosted Nexus owner composition

Source implementation only. Migration039, the new owner routes, twelfth worker
capability and local Nexus reader are not activated by importing these files.

The Forge surface can select an authenticated task and paired computer, page
through exact saved build plans, attach accepted advice and save an immutable
dependency proposal. Dependencies still mean source ready for review. No coding,
model call, behavioral test or activation is authorized by a proposal.

## Shared state and authority

The existing Stargate jobs/leases/receipts carry catalog and verification reads.
No additional task, queue, permission or artifact store is created. Migration039
adds strict canonical input/result validation and current owner, node, task,
permission/checkpoint and accepted-review binding. All native enqueue functions
participate in the same busy exclusion. Older workers never receive Nexus work.
Reapplying039 is idempotent; prehistory rollback restores previous function
definitions and ACLs without reverting037's receipt validators. Rollback refuses
once Nexus job/receipt history exists; retain compatible readers instead.

Every API authenticates the configured Clerk owner. The saved proposal writer
also checks the explicit Clerk-to-existing-owner mapping. Query parameters are
allowed only on the Nexus GET route and only for exact recovery selectors.
Mutations require same-origin browser metadata. New work is disabled unless
`MASTERMIND_NEXUS_ENABLED=1`; existing saved-proposal recovery remains readable.

## Recovery and freshness

The browser retains one catalog cursor and one verification operation per owner,
computer and task before sending. A reload never submits or polls. Explicit load
or save first reads the original job; an uncertain submission uses its original
ID. Catalog pages bind one snapshot and checkpoint/permission basis, with at most
32 plans. Another tab cannot silently overwrite changed local recovery state.

The server consumes verification only from its own authenticated ledger read,
matching exact input and proposal hashes, with the original observation no more
than60 seconds old. The final proposal transaction rechecks the current basis.
Browser-supplied receipts are rejected. A fresh verification is a separate
explicit action after the prior worker request is terminal; it preserves the
proposal identity. Saved-proposal recovery works with workers offline and new
creation disabled. Failed or unavailable reads clear displayed private choices.

## Acceptance and release boundary

Disposable PostgreSQL acceptance uses the private CI service with synthetic
identities and no canonical credentials or host port. It applies real migrations
021–039, validates exact rollback, permission revocation, receipt hashes,
old/new worker negotiation, same-ID retries, mutual native busy exclusion, and
two actually contending connection pairs. This is database-contract acceptance,
not a live owner workflow. Source-level owner/transport/form tests cover queued
work, lost verification/save replies, reload, fresh-check renewal and denial.

Before rollout: approve this unpublished public-source range, verify its clean
preview/build, preserve current jobs/outbox/registry and source preimages,
activate the compatible038/039 database and runtime/worker/startup-policy set
under exactly one owner, deploy with Nexus creation off, verify ordinary clients,
then enable the exact profile and accept one new read-only owner proposal flow.
Keep migration rollback history-aware and retain the preceding website/runtime.
Never replay prior provider, coding, candidate or lifecycle operations.
# Recovered native work: compatible connection

The opt-in catalog request schemaVersion2 adds `native-candidate-v1` choices alongside original coding-plan choices. A native choice pins the existing specification, import operation, candidate and current observation. It has no coding plan ID. The owner form keeps source verification, recorded tests, historical acceptance, current receipt verification and active status separate. Native observations have no dependency edges and cannot satisfy coding readiness.

`MASTERMIND_NEXUS_RECOVERY_ENABLED=1` selects the new catalog and permits new native verification/saves on the server. It defaults off. General `MASTERMIND_NEXUS_ENABLED` is still required. Old catalog requests remain schemaVersion1 and receive only supported plan rows. Retained requests continue with their original version and operation ID; no automatic retry with another version occurs. Existing completed saves can be recovered when creation is disabled.

Install migration040 and the exact compatible runtime/worker package before enabling the recovery flag. The existing proposal table, ownership, permission checks and ledger are reused; no new execution capability or data rewrite is introduced. Native observations are an explicitly versioned node variant within advisory proposal schemaVersion1. Old readers reject that variant rather than interpreting it as a coding plan. Once new history exists, rollback must keep compatible readers with creation disabled; migration040 rollback refuses to remove readers needed by retained jobs/proposals. Its prehistory rollback restores the exact previous three validator functions.

Acceptance requires the real owner catalog, verification, save and reload after coupled installation. Disposable tests and source publication alone are not live acceptance. Preserve accepted candidate tests and lifecycle history; never repeat them to populate this catalog.
