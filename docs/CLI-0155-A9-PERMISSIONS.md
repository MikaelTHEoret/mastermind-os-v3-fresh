# Exact Codex alpha.9 permission compatibility

Accept the observed Codex 0.155.0-alpha.9.2 executable as an additional exact pin for the existing suppressed source-work profile. Older pins, scope shape, ownership, task versions, limits and approvals remain unchanged. A scope naming this executable is still insufficient to execute: the private runtime must verify its independently pinned account/routing profile and reviewed plan.

The additive SQL proposal only extends the validator's exact executable set. Its renderer verifies all predecessor sources, guards the validator and protected schema, and refuses rollback while a current scope references the new pin. Neither applying the validator nor rolling it back changes task/grant rows. Never apply the raw migration outside the guarded operation.

Validation includes gateway permission tests, source/rollback guard tests and a disposable PostgreSQL fixture covering all four executable generations. Deployment must follow accepted private-runtime compatibility evidence; publishing this source does not grant or launch coding work.
