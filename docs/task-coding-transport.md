# Task coding transport — prepared, not activated

The new `mastermind.native.review-build-dispatch` contract carries a saved review, source-package operation and build-plan identity to the existing Windows coding dispatcher. It supports preflight, explicit start, status and recovery. `NativeTaskClient.buildDispatch` calls only `http://127.0.0.1:8770/task_build_dispatch`, accepts bounded typed replies, and never retries a start automatically.

The hosted transport operation remains distinct from the source-package and coding operation. Recovery of an uncertain start sends `recover` with the same build operation and plan. Its receipt preserves the original requested action and separately records `observedAction` and `recoveryOnly`; it cannot misrepresent a recovery read as a fresh execution. A valid 409 permission/resource hold is a saved outcome, not an unstructured connection failure.

Python source baseline: private `mastermind-core-runtime` revision `5614e32382121f00d791f8e82e67cb923eb397df`. The fixture contains only synthetic runtime outputs produced by its real registry/planner plus a mocked coding worker; no production task text, private source, credentials or live model output. Transport tests cover these outputs, identity substitution, forged results, fixed endpoint, abort/expiry and uncertainty. Worker-journal, hosted authorization and owner-interface tests cover the coupled path.

The source includes a ninth worker capability, the owner route, and Wizard readiness/start/status/recovery controls. They remain opt-in. The existing eight-capability worker is unchanged by default. Nothing in this source installs the private runtime, applies the database migration, grants model permission or activates a module. Do not enable this contract through a generic URL, action or tool proxy.

## Implemented integration

Migration033 extends the existing jobs/receipts and review-family functions. A succeeded saved-plan job must match the owner, computer, task, review, source package, build operation and exact plan. Later requests cannot rebind the same coding operation. Null, extra authority and mismatched results are rejected. The rollback-only SQL fixture exercises the real functions with synthetic records, preserving production functions and existing review/plan history.

The worker uses `MASTERMIND_NODE_BUILD_DISPATCH_ENABLED=true` only together with the existing lossless-review/development flags. Otherwise it continues advertising the accepted eight-capability profile. A coupled worker advertises version `0.10.0-coding-handoff`; older workers cannot lease coding jobs. The actual disk journal, receipt outbox and reconnect paths retain the original build operation and only recover uncertain starts. Saved scheduling receipts remain historical even if coding subsequently advances.

The owner endpoint `/api/nodes/[nodeId]/review-build-dispatch` requires both `MASTERMIND_BUILD_DISPATCH_ENABLED=true` and `MASTERMIND_DEVELOPMENT_WORK_ENABLED=true`, same-origin access and the authenticated owner. Reads recheck current task authority. The Wizard stores each network request before sending it, restores by reading on reconnect, and requires explicit successful readiness before offering Start coding. Source-ready means independent tests are still required. Operation IDs and raw JSON are not entered by the user.

Executable JS validators are authoritative for the native family; the older static v2 JSON schema describes the original core-observation subset and must not be used to admit these later capabilities.

## Release acceptance still required

1. Publish only separately approved source and obtain hosted CI/build acceptance. Keep the website coding switch off while installing compatible readers and migration033 with exact preimages and history checks.
2. Activate the pinned private runtime, worker source and host policy through the existing runtime owner. Verify idle/resource/source fences and nine-capability negotiation before enabling the owner route.
3. Use a new independently scoped request for live coding. The prior preparation-only request is not model permission. Preserve normal client approvals, independent test requirements and module promotion/rollback controls.
4. Verify one bounded real coding job, lost-client recovery and fresh owner history. Local synthetic acceptance is not evidence that this hosted deployment or a live model has run.

Rollback before activation simply retains the current release. After any future dispatch rows exist, keep readers compatible with those rows and reconcile any in-flight coding effect before changing the runtime. Do not erase operation history or treat a missing reply as evidence that no work happened.
