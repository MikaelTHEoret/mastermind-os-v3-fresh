# Hosted review source and build planning

The Wizard can carry a saved create/extend review through source preparation,
explicit publication, publication reconciliation, and build-plan preparation.
This extends the existing native job ledger and shared task history. It does not
run a coding model, accept a candidate, or activate a module.

## Contracts and ownership

- `mastermind.native.review-artifacts`: prepare, recover, publish, reconcile, resume.
- `mastermind.native.review-build-plan`: prepare, recover.
- Every request retains the task, specification, review, original review job,
  local artifact operation, and (for plans) local build operation. Each explicit
  transition has a new network job ID; reconnects keep the saved network ID.
- A succeeded review must belong to the same owner, task and paired computer.
  Reuse/assimilation reviews cannot be redirected into source creation.
- SQL checks the requirements and test hashes against the saved review, fixes
  artifact binding/commit and plan identity across recovery, and verifies the
  canonical build request hash. Authorization is rechecked on enqueue, lease,
  receipt, replay and owner reads.
- Requests carry no credential, repository path, grant, executable command or
  coding configuration. The local host owns these independently installed settings.
- Responses distinguish a stored publication from dated Git verification.
  Neither publication nor a build plan counts as candidate acceptance.

## Interface and recovery

The owner routes are `/api/nodes/[nodeId]/review-artifacts` and
`/api/nodes/[nodeId]/review-build-plan`. Both require same-origin authenticated
owner access and `MASTERMIND_DEVELOPMENT_WORK_ENABLED=true`. The switch is off
by default. The UI offers actions only for advertised worker capabilities.

Use **Prepare source package**, **Publish source package**, **Check publication**,
then **Prepare build plan**. A prepared publication can be resumed explicitly only
after reconciliation reports the exact ref absent. Reconciliation verifies that
absence again before the host attempts publication. Builds remain held for a
separately authorized coding step.

**Refresh saved status** reads the existing hosted job. **Resume saved work**
recovers its request from shared history on another client. A lost POST response
does not allocate another operation; an explicit retry reuses the saved request.

An uncertain worker effect keeps its journal recovery requirement. A web refresh
does not clear that requirement, repeat publication, or bypass an active job's
busy guard. Live acceptance must exercise the trusted local reconciliation path
for an uncertain publication before claiming complete remote recovery.

## Activation prerequisites and rollback

1. Keep the hosted switch off. Back up current source, runtime owner configuration,
   worker configuration and the existing database function definitions.
2. Validate the private Python host release and its independent materialization
   permit against the exact source repository and bounded source branch. No public
   repository publication is implied by a Wizard button.
3. Apply reviewed migration 031 through the guarded migration procedure, with
   migrations through 030 already accepted. Do not replay 030 over 031.
4. Deploy the compatible web reader, then install the paired eight-capability
   worker and its prerequisite flags. `MASTERMIND_NODE_DEVELOPMENT_WORK_ENABLED`
   is the worker opt-in; it does not replace local publication permission.
5. Enable owner submissions and run one bounded end-to-end acceptance through
   the existing production identity. Verify same-operation recovery, source
   provenance, offline status and journal uncertainty before broader use.

To pause new work, turn off the hosted switch first. Drain/reconcile in-flight
development jobs before disabling the worker capability. Keep the compatible
reader and forward-compatible ledger so saved evidence remains readable. Do not
restore an older SQL capability constraint while development rows exist. Retain
the preceding runtime release and source branch; do not delete task history or
clear an uncertain effect to make rollback appear successful.

## Verification

`node scripts/check-public-source.mjs` runs synthetic protocol, worker, owner-route,
store, UI and reconnect checks without operator credentials. Type-check with
`node node_modules/typescript/bin/tsc --noEmit` and build the clean web source.

The existing isolated SQL fixture accepts `--wizard --review --development-work`.
It compiles actual migration 031 in a random synthetic schema, exercises real
enqueue/lease/receipt paths, rolls back, and verifies that production functions
remain unchanged. This is not evidence of production activation.
