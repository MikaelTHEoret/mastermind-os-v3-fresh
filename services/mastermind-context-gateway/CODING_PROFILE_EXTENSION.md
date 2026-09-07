# Configured coding profile compatibility

The configured Codex account can be observed with startup integrations disabled.
Using that observation with the previous worker profile would misdescribe the
worker's actual startup settings. This extension gives the suppressed worker a
distinct identity while preserving the existing profile and historical grants.

`codex-approve-for-me-workspace-write-suppressed-v2` is accepted only with executable
SHA256 `dacb96688b155e20dbbbc0bfd18bba7ce7920f1b239ab08a1627917f23b8d9cd`.
The worker binding remains schema 1 and the permission scope remains schema 2.
Sandbox, approval, limits, target checks and private branch delivery are unchanged.
The gateway preserves and compares the exact profile string; it cannot normalize
an old grant into the new profile. Scope eligibility still requires independent
account, host, source and reviewed-plan evidence before execution.

The historical `task-permissions-v2.sql` and its first-installation guards remain
unchanged. `task-permissions-v2-suppressed-profile.sql` changes only the existing
validator. Its guarded renderer in `coding_permission_profile_extension.py`
requires the exact predecessor or exact already-installed extension, protects
both setters and the task/history schema, checks ownership and function
attributes, and serializes against the existing schema operation lock.

The extension is prepared source. Nothing applies it at startup or invokes a
permission setter. Canonical dispatch requires a freshly reviewed read-only target
snapshot and the pinned source buffers. A lost reply must be reconciled by reading
the function state before deciding the next action.

Rollback restores the exact preceding validator, including its attributes. It
holds while any current task scope refers to the suppressed profile; those scopes
must first be restored or replaced through the existing owner and revision checks.
Historical checkpoints remain intact. Roll back this extension before using the
older first-installation schema rollback, whose exact function check intentionally
does not accept an extended validator.

The Node contract tests cover both profiles, wrong executable pins and mismatched
grants. The pure Python tests verify source boundaries and equivalent canonical
and fixture guards. The existing disposable PostgreSQL runner additionally tests
actual apply/replay, a synthetic suppressed-profile grant, forbidden historical
rebinding, refusal to roll back a profile still in use, and exact restoration.
All synthetic schema and task changes are rolled back in that fixture. These
checks do not establish a configured worker, a live grant or remote execution.
