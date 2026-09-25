# Preserve regression tests when growing native modules

The accepted module already has25 cases. An update cannot retain that suite and add coverage while every layer enforces a25-case ceiling. This change raises only the native suite count ceiling to64. The private planner/LPAC validator, shared website/worker readers, and migration037 agree on that ceiling. Reuse example and covered-example counts remain bounded at25.

All existing byte budgets, ownership checks, immutable operations, receipt binding, process isolation, per-case limits and one-test-at-a-time admission remain unchanged.64 is a ceiling, not a promise that any64 cases fit: the independent test specification must fit64KiB, an aggregate receipt32KiB, and each case reference4KiB. Inline review still has its existing20KiB content/24KiB request limits. Oversized material must remain held; use the existing pinned private-review path when appropriate, never truncate cases.

## Coupled reader-first release

1. Verify exact public/private source, focused tests and the disposable SQL fixture. Preserve predecessor revisions, source preimages and host pins.
2. Stop new larger-suite submissions during rollout. Existing advertisements do not negotiate maximum test count; capability version alone does not prove this update is installed.
3. Apply037 through the existing guarded migration procedure, then deploy compatible website/API readers. No old migration is edited. Three function definitions change; no new table, function identity, ownership grant or permission is introduced.
4. Update the worker's shared protocol files and private runtime files as one verified package, including the existing supervisor startup/host policy. Preserve prior providers, one owner, source revisions, accepted modules and rollback preimages. Restart through the existing owner transition and verify actual installed hashes.
5. Refresh browser clients before admitting suites above25. Use fresh independent request/source/review/test/transition bindings. Check the actual projected receipt envelope against its unchanged byte budget before expensive testing.
6. Start with the private37-case CRLF candidate, all25 earlier cases retained. Its requirements exceed inline-review bytes, so use the existing private pinned-review/contribution path. The original39-case draft is preserved; two unaccepted bulky CRLF requirement-boundary cases are deferred to fit the unchanged24000-byte packet limit. Retained acceptance-boundary cases exercise the shared text-length helper; do not claim direct CRLF requirement-boundary coverage. A preparation or successful reader check is not execution authority.

## Rollback and acceptance boundary

Before expanded history exists and once jobs are drained, the supplied037 rollback restores the previous three definitions and preserves ACLs. It refuses if relevant jobs are in flight, or retained review/reuse/lifecycle rows contain a suite above25. Never remove history to force downgrade.

Once a larger candidate, review, case receipt or ledger result is retained, keep expanded private and hosted readers even if the active module is rolled back. The SQL guard covers ledger records; also audit private registry/candidate/test history before any private-runtime downgrade. Disable new work and retain compatible readers when in doubt. Candidate rollback to an accepted predecessor is a distinct, separately bound operation and does not downgrade infrastructure.

Source-level and disposable tests are not live rollout acceptance. Record exact source/CI, installed hashes, schema readback/ACLs, hosted same-ID recovery, and actual module workflow outcomes before marking delivery complete.
