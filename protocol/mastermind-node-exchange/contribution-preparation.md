# Contribution transport preparation

This local-only branch prepares the typed contribution contract, fixed
NativeTaskClient broker and opt-in tenth-capability worker. It does not enable
that profile live, change the ledger, expose a web route or install the runtime. Public source
publication is not authorized for this branch or its e5dd153 base.

The host contract is private core e7b81c7 / PR12. The caller selects a saved
specification and host-prepared import UUID. The job operation UUID is independent.
Catalog returns one choice per receipt; its snapshot covers all exact original
record IDs, full packet identity and displayed choices. A changed snapshot or
missing cursor rejects continuation. Local catalogs retain their existing 8 KiB
bound while wire receipts retain 1450/2900 compact/pretty limits.

The broker uses only the fixed loopback task endpoint, with deadline, abort,
response-size and redirect checks. It never retries uncertain calls. Refreshing
a lost stage maps to recover. Catalog and preview remain read-only; a missing
saved import cannot turn recovery into staging. Receipts include immutable source
and original record IDs, but never code, private paths or permissions.

Receipt redisclosure is wired to current owner/source checks through the
existing worker journal. The comparison allows forward progress with
the same immutable source while retaining the original dated observation. It
does not grant permission to test or activate a candidate.

Disposable worker tests exercise actual journal restart, same-ID replay, lost or
altered replies, absent saved imports, revoked ownership/source, changed catalog
snapshots and preservation of pending receipts under a downgraded profile. The
profile requires `MASTERMIND_NODE_CONTRIBUTIONS_ENABLED=true` plus the prior
review-recovery chain. The default nine-capability profile remains unchanged.
Capability count grows to ten; receipt size and effect namespace do not change.

Remaining coupled implementation: compatible ledger migration/rollback,
owner history routes, packet-choice/preview/stage/recovery form and restart/reload
acceptance. These worker tests do not accept those hosted or live features.
