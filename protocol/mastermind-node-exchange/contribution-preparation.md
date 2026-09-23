# Contribution transport preparation

This local-only branch prepares the typed contribution contract and the fixed
NativeTaskClient broker. It does not register a capability, advertise a worker,
change the ledger, expose a web route or install the runtime. Public source
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

Receipt redisclosure must be wired to current owner/source checks through the
existing worker journal. The prepared comparison allows forward progress with
the same immutable source while retaining the original dated observation. It
does not grant permission to test or activate a candidate.

Remaining coupled implementation: capability validators/registry, opt-in worker
profile, executor and receipt authorization, compatible ledger migration/rollback,
owner history routes, packet-choice/preview/stage/recovery form and restart/reload
acceptance. Tests of this contract and broker alone do not accept those features.
