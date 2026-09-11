# Native capability discovery and remote use

The native-enabled core worker advertises `mastermind.native.catalog` alongside
`mastermind.native.reuse` and core status. Discovery uses the existing Stargate jobs,
leases, receipts and journal. It never dispatches candidate code. Local catalog reads
remain fixed to `http://127.0.0.1:8770/task_catalog`.

Migration023 adds the catalog contract and extends the existing negotiated exchange.
Queue admission, lease/replay, result admission and owner reads require current owned
canonical task scope. Successful pending results are reauthorized on the worker before
upload and terminal replay. Metadata must match the current option set and entry; only
observation time can differ, and the original saved result is retained. Revoked or
changed metadata remains in the local outbox pending reconciliation. Read failures
produce failed jobs without partial catalog data, never a successful empty catalog.

The full receipt retains its2048-byte wire limit and4096-byte disk limit. Catalog result
metadata has its own1450-byte compact/2900-byte formatted allowance; the complete receipt
and journal envelope are still checked before publication. Oversized schemas fail
explicitly. Existing native reuse bounds are unchanged.

The hosted Forge panel offers owned tasks and paired computers, discovers an accepted
option and uses the existing schema-driven input component. It derives specification,
candidate, requirements and canonical input hashes from checked discovery. A saved
operation ID is written locally before submission. Reload reads the same owner-scoped
job; an explicit submission retry retains the original ID and body. Reconnect never
automatically submits another operation. Source and task authority are checked again
by the execution path. Input/output payloads remain bounded; this first flow targets
small supplied inventories and cannot accept arbitrary full archives.

The selector stores its latest operation pointer in this browser. On another browser,
Resume saved work reads the latest authorized catalog or execution job for the selected
task/computer from the existing ledger. The owner reader checks current task scope and
revalidates the saved job before returning its request binding. This does not create a
second task or memory store. Reconnect does not automatically enqueue an operation.
The component fixture exercises discovery/submission/reload/revocation; authenticated
browser preview acceptance remains required.

## Release order and recovery

1. Preserve the accepted production web6492c73 and status-only worker rollback targets.
2. Apply reviewed migration022, then023 and024, after exact production preimage verification.
   Both prepared migrations have passed isolated PostgreSQL tests with mandatory rollback.
3. Install matching reviewed local catalog kernel and Node worker sources. Keep native
   opt-in disabled until the source, supervisor ownership and idle state are verified.
4. Accept the preview with the production owner, then promote the matched web release.
5. Enable the existing native worker option and verify its hosted advertisement. Run a
   new bounded catalog/comparison operation and recover its same saved result.

Never rerun an earlier completed acceptance operation. Revoke/disable native work and
reconcile/drain its outbox before reverting worker code. Keep additive database
compatibility and native job history when rolling back web/worker sources; do not
restore old constraints over catalog/native rows. Restore the prior status-only
advertisement and verify it rather than assuming a process restart completed rollback.

Publishing source or building a preview does not perform database migrations, local
installation, worker opt-in or authenticated workflow acceptance. The live acceptance
record below identifies the separately completed checks.

## Native receipt capacity and live recovery

Migration024 is required with022/023. The original receipt table bounds result JSON
at1024 PostgreSQL bytes. A full accepted comparison input schema exceeded that limit:
the worker saved the correct catalog but its hosted upload returned503. The catalog
fixture now uses the full schema, proves the old constraint rejects it, then applies024
and verifies upload/replay. Typed catalog/reuse results allow at most2048 PostgreSQL
bytes; other results retain1024. The full wire receipt remains2048 and the local durable
receipt remains4096. Ownership, task authorization and typed result validation remain
required. Do not widen untyped results or discard a rejected outbox.

Worker process logs now report changes to sanitized state/error code only. They omit
credentials, request bodies and results, and diagnostics cannot alter execution.

Live acceptance on2026-09-11 verified authenticated website task/computer selection,
catalog discovery, a real accepted comparison, reload recovery and the shared-history
resume action. The stalled catalog delivered its original saved observation after024;
no replacement job was needed. Broader create/assimilate/upgrade acceptance and the
second Windows machine remain separate work. Web publication alone does not apply
migrations or update a worker.
