# Remote Wizard intent candidate

This source connects the existing task-bound Python Wizard broker to the existing
Stargate ledger and Windows worker. It saves a specification request; it does not
run a coding model, test a candidate, activate a module or grant execution.

## Contract

`mastermind.native.specification` version 1 is an explicitly negotiated protocol-2
capability. Its command input is the existing `/task_specification` request with
`action: "prepare"`. The operation UUID must equal the ledger job UUID. Requests
retain the exact task, optional checkpoint, text and optional recipe selection.
The remote profile accepts at most 4,096 compact UTF-8 bytes and 3,072 bytes when
indented by two spaces, inside the existing journal limits. Oversized requests
are rejected without truncation. The local broker's larger allowance is unchanged.

The owner-only, same-origin POST `/api/nodes/{nodeId}/native-specification` accepts
`{operationId, input}`. Generic owner job lookup recovers its dated state/result.
Admission and disclosure require the same current owned active canonical task
and active permission scope; no execution grant is inferred from saving intent.
Unknown requests truthfully return `needs_specification`.

Receipts bind the original request hash, task, operation, saved specification,
stage and timestamp. `executionAuthorized` is always false. Successful pending
receipts are reauthorized against the local saved operation before upload; a
changed saved intent or revoked task withholds the outbox. A lost/invalid reply
leaves the effect nonterminal. Subsequent delivery uses `recover` only. Missing
recovery remains held and never silently creates a replacement specification.

## Activation and compatibility

This is an uninstalled candidate. Apply reviewed migration 026 only after 025,
deploy compatible hosted readers/route, then install a worker and Python broker
whose source and configuration were accepted together. Only then set both
`MASTERMIND_NODE_NATIVE_REUSE_ENABLED=true` and
`MASTERMIND_NODE_NATIVE_SPECIFICATION_ENABLED=true` in the existing supervisor's
reviewed child environment. Malformed flags fail before credential access.
Existing native workers keep their original three-capability advertisement.
The new profile advertises four. Old workers cannot lease Wizard requests.

Migration 026 extends the existing worker negotiation, job constraint, bounded
receipt constraint and exchange function. Native catalog, reuse and Wizard jobs
share the existing one-at-a-time admission limit. It creates no competing task,
memory, permission or execution ledger. Existing family/core behavior is retained.

## Evidence and rollback

The source suite includes real file-journal restart/recovery, missing recovery,
revoked/changed disclosure, Unicode bounds, fixed broker dispatch and owner-route
tests. `catalog-sql-fixture.py <receipt.json> --wizard` extends its existing
disposable PostgreSQL transaction with migration 026 and verifies rollback and
unchanged production functions. Never run that fixture with a production apply
script. The private `verify_wizard_stargate_contract.py` joins real isolated
ModuleCore persistence to these public validators without disclosing source.

Before any live activation, record web/core revisions, broker/worker hashes,
supervisor configuration preimage, migration acceptance and one retained test job.
To stop admission, disable the new submission surface first. Preserve the compatible
reader and worker until pending Wizard receipts have been reconciled; disabling
the flag while its outbox exists deliberately holds that outbox. Retain migration
026 and history on rollback. Do not delete jobs or restore an older decoder over
saved Wizard results. Restore the previous runtime only after pending effects
are drained or explicitly held with a recovery continuation.

Still required: a user-facing request/recovery form, recipe/specification review,
production installation and one real hosted-to-worker acceptance. No remote
release or whole-core completion is claimed by these source checks.
