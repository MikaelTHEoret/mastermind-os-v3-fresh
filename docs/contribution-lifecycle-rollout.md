# Contribution lifecycle delivery

Status: implemented and tested locally; not deployed or enabled.

The Wizard can inspect a staged contribution, request its frozen behavioral tests,
activate a passing revision, restore its accepted predecessor and recover saved
progress. It uses the existing specification/module registry and Stargate ledger.
A delivery UUID is separate from the immutable lifecycle operation UUID. Lost
replies and worker restarts recover observations; they never dispatch that saved
effect again. Uncertain or interrupted work remains held for reconciliation.

## Coupled rollout

1. Pin reviewed web and private runtime revisions and collect clean CI evidence.
   Publication of new public source requires the owner's explicit approval.
2. Keep MASTERMIND_NATIVE_LIFECYCLE_ENABLED and
   MASTERMIND_NODE_LIFECYCLE_ENABLED disabled. Preserve the current production
   website, worker, runtime, policy, registry and service-owner preimages.
3. Verify and apply migration 036 after 035 using the existing guarded migration
   procedure. It extends the existing ledger and preserves its job/receipt history.
4. Build a complete runtime/worker source package and matching startup/host policy.
   Include module_task_contribution_lifecycle.py in the curated Python closure.
   Change the existing supervisor's installation only after exact dependency,
   policy and rollback verification; never start a competing runtime owner.
5. Enable the worker lifecycle flag with the existing contribution flag enabled.
   Verify exactly eleven negotiated capabilities, existing services and history.
6. Deploy the exact compatible website with its lifecycle flag initially off.
   Verify prior clients and owner authentication before enabling the new route.
7. Start with a read-only inspection of an existing staged candidate. Verify
   browser reload and another authorized client's recovery. Execute new tests or
   transitions only under fresh independent operation bindings. Existing accepted
   tests and transitions must not be repeated to demonstrate the interface.

## Recovery and rollback

Before any lifecycle ledger history exists, the supplied rollback restores 035
function definitions, privileges and constraints. Once lifecycle history exists,
the rollback intentionally refuses: retain 036 and compatible readers, turn off
new submissions, drain/reconcile in-flight work, then restore a compatible runtime
and website. Never delete history to force a schema downgrade. Effect recovery
uses the saved operation ID; an uncertain result is not permission to retry.
Owner/task or grant changes can hold an earlier operation until separately
reconciled. Candidate activation rollback uses its accepted predecessor and an
expected-active-revision check, independently of deployment rollback.

## Validation and limitations

Disposable PostgreSQL acceptance verifies exact owner/node/import binding,
negotiation, duplicate delivery, revocation, receipt validation, busy exclusion,
rollback before history and refusal after history. No production migration was
applied. Runtime tests use a temporary registry and synthetic providers; transport
and UI fixtures cover lost replies, duplicate clicks and fresh-client recovery.
Live owner browser acceptance is still required after the coupled rollout.

The local Next build compiled, type-checked and generated pages, but Windows
refused a standalone node_modules symlink from the shared dependency junction.
Do not treat that local standalone directory as a distributable artifact. A clean
CI/preview build with its own locked dependencies is a release prerequisite.
