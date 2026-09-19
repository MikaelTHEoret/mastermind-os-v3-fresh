# Task coding transport — prepared, not activated

The new `mastermind.native.review-build-dispatch` contract carries a saved review, source-package operation and build-plan identity to the existing Windows coding dispatcher. It supports preflight, explicit start, status and recovery. `NativeTaskClient.buildDispatch` calls only `http://127.0.0.1:8770/task_build_dispatch`, accepts bounded typed replies, and never retries a start automatically.

The hosted transport operation remains distinct from the source-package and coding operation. Recovery of an uncertain start sends `recover` with the same build operation and plan. Its receipt preserves the original requested action and separately records `observedAction` and `recoveryOnly`; it cannot misrepresent a recovery read as a fresh execution. A valid 409 permission/resource hold is a saved outcome, not an unstructured connection failure.

Python source baseline: private `mastermind-core-runtime` revision `5614e32382121f00d791f8e82e67cb923eb397df`. The fixture contains only synthetic runtime outputs produced by its real registry/planner plus a mocked coding worker; no production task text, private source, credentials or live model output. Eleven transport tests cover these outputs, identity substitution, forged results, fixed endpoint, abort/expiry and uncertainty. Existing task and review transport checks also pass.

This source does not advertise the capability, add a dashboard start button, change the hosted database, or grant coding permission. The existing eight-capability worker remains the accepted release. Do not enable this contract through a generic URL, action or tool proxy.

## Coupled integration still required

1. Extend the existing ledger's strict input/result validators and review-family authorization. Require a succeeded saved-plan job for the same owner, node, task, review, artifact operation, build operation and exact plan. Preserve all existing v1/v2 review readers and constraints. Freeze bindings across later job submissions and receipts.
2. Add explicit negotiated worker support and a default-off configuration switch; preserve one runtime owner. Lease/execution/outbox recovery must call this typed client and may never repeat uncertain starts.
3. Add the authenticated owner route and saved-state UI actions with independent network request IDs, held-state feedback and read-first reconnect behavior. Prepared source is not behavioral acceptance or activation.
4. Test the disposable SQL ledger, actual worker journal and UI together. Negative cases include wrong owners/nodes/parents/plans, stale scope, delayed replies and changed source. Check that existing capabilities and histories survive.
5. Publish only the separately approved source, deploy compatible readers with the switch off, then activate the pinned runtime/worker/ledger together. Use a newly scoped request for live coding; the earlier task186 preparation-only request must not be used to run a model.

Rollback before activation simply retains the current release. After any future dispatch rows exist, keep readers compatible with those rows and reconcile any in-flight coding effect before changing the runtime. Do not erase operation history or treat a missing reply as evidence that no work happened.
