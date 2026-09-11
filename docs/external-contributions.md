# External model contributions

This candidate adds owner-only assignment, response and review records to the existing Mastermind task. It is the first stage of browser model delegation; automated dispatch, extension capture, GPT Actions and model execution are not implemented here.

## Workflow

In Forge, select the shared task under **Work with external models**. Save a bounded assignment with selected source material, source references and acceptance criteria. Copy that assignment to ChatGPT, Grok, GLM / Z.ai or another contributor. Paste the original response back, optionally recording the displayed model and conversation URL. Add a separate review with evidence references. Existing records are immutable; a correction is another record.

Provider identity on a pasted response is a user-supplied attribution, not verified provider provenance. Accepting useful advice grants no execution permission and activates no module. Returned code still requires the established candidate testing and promotion process. No paid API or external account is configured by this change.

Assignments and imported responses reside in the hosted task store, not only browser storage. After a lost save reply, the browser retains the exact pending request. Explicit reconciliation sends the same operation ID; a changed body conflicts. A fresh browser can read the same shared history after signing in. An unsubmitted draft is not yet durable. Browser storage may contain selected task material while a submission is pending.

## Contract and limits

`/api/contributions/[taskId]` uses the existing owner session, strict same-origin mutation checks and current canonical operator/task verification. Completed tasks permit reads only. Unrelated owners and revoked operators are denied. There is no external-provider endpoint or executable payload handler.

A record has a schema version, operation UUID, canonical task reference and kind. Assignment records carry requirements, sources and intended providers. Responses refer to an assignment hash and preserve their original UTF-8 text. Reviews refer to a response hash and add an assessment and evidence. SHA-256 covers the entire canonical record. The browser verifies that digest and exact request binding before acknowledging a save.

The initial bounded profile supports at most 64 records per task, each at most 65,536 canonical UTF-8 bytes. Responses are streamed with a 4.4 MB client cap. The full history fails explicitly if the profile is exceeded; it never silently truncates. A database uniqueness constraint bounds capacity during concurrent requests. Concurrent distinct submissions can require explicit reconciliation when they contend for the same slot. A task reaching capacity needs a separately approved pagination/profile extension, not deletion of its originals.

## Installation and rollback

Migration `025_mastermind_task_contributions_v1.sql` is additive and must precede enabling this interface. Existing task, worker, checkpoint and execution tables are unchanged. Apply using the existing authenticated migration process after checking the target and migration hash. Do not run the isolated fixture as a production migration.

Rollback: restore the preceding web deployment. Keep the additive table and its records for future recovery; do not drop or truncate it. This candidate requires no worker restart, new capabilities, task permissions or runtime deployment. The underlying private Wizard source can remain uninstalled.

## Acceptance

Run `node scripts/check-public-source.mjs` and the complete TypeScript check in an environment without operator credentials. The contribution tests cover hash binding, duplicate submissions, original response preservation, authority boundaries, lost-reply/reload recovery and bounded browser transport. The isolated PostgreSQL fixture exercises the actual store SQL and migration in a random schema, then verifies rollback and unchanged public schema.

Local source/fixture success is not production acceptance. Deployment and a real two-model assignment, retained responses, comparison and useful integration remain required. The old ChatGPT conductor/userscript is historical evidence, not a verified active bridge.
