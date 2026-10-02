# Versioned Nexus proposal storage

This source adds immutable `nexus-proposal` records to the existing task contribution aggregate. It does not create a scheduler, execution grant, new memory store, or task system. An edge means **source ready for review**, not tests passed or activation completed.

## Contract and recovery

Each record binds one operation, task, stable proposal series, predecessor, checkpoint/permission basis, exact specification/plan IDs, source references and accepted advisory reviews. A revision appends a new record. Root and successor uniqueness plus task-row serialization prevent competing accepted heads. Cyclic proposals remain valid data for the advisory assessor to explain as held; references to nodes outside the proposed graph fail validation.

`NexusProposalStore` defaults to creation disabled. It needs a trusted host `verifyReferences(record)` adapter that resolves every immutable specification/plan and source reference under current owner/task permissions and returns exactly `{verified:true, proposalSha256:digest(record)}`. It must not accept client-supplied snapshots or attestations. This adapter is a deployment prerequisite, not implemented by a boolean UI flag. The ordinary contribution store explicitly refuses to create proposals, including through existing owner and MCP write routes.

`recover(taskRef, operationId)` finds the original after a lost reply. A byte-equivalent save recovers it even if the task basis advanced, the task completed or creation was disabled; current owner authorization still applies. Reusing an operation with different content fails. A new revision requires an explicit new operation and current basis. Nothing silently refreshes the user's basis on reload.

The SQL function is an invoker-rights transaction with owner/external-identity checks and a task-row lock. It independently rechecks checkpoint and permission basis and review references before insert. The host remains responsible for references that live in the private module registry. It intentionally returns precise stale-head, stale-basis and capacity states. The existing 64-slot cap remains shared across all contribution kinds.

## Compatible rollout order

1. Review the private source and disposable SQL evidence. Install compatible validators/readers in every hosted gateway, private contribution-reader package, website and client that validates the aggregate. Ordinary readers validate/hash the new records; existing assignment views filter them out. Keep creation disabled. Inventory old pinned readers before any new-kind write.
2. Apply reviewed migration038 with the existing migration safeguards. No live migration is part of this source change.
3. Complete the trusted private plan/source-reference adapter, exact installed-source policy, owner form and existing worker handoff. UI save/readiness must use fresh owner-bound data and preserve the exact operation on reconnect. Saving never authorizes coding, tests, activation or dispatch.
4. Enable only after disposable acceptance, private integration and exact-source public publication approval. Run one separately bound owner save/reload acceptance with documented rollback.

The rollback SQL is allowed only before any proposal exists; it refuses to erase retained history. After the first proposal, disable creation and retain compatible readers. Do not roll back to an old three-kind parser or delete records to reclaim capacity.

## Verification scope

The Node suites exercise schema bounds, stale/denied results, original-content acknowledgement, creation-off reads, same-operation recovery and lost replies. The private fixture preserves byte hashes of the exact web candidate and tests real PostgreSQL migration/rollback, legacy records, ownership, permission/checkpoint changes, immutable history, capacity and concurrent root/successor/retry/permission transactions. These source checks are distinct from live owner UI or installed worker acceptance.
