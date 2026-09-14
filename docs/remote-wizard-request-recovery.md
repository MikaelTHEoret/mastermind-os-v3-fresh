# Remote Wizard request and recovery

The connected-computer panel now accepts a natural-language Wizard request for
an existing owned task. A compatible computer advertises
`mastermind.native.specification` version 1. Unsupported and offline computers
are labelled using the inventory's dated status.

The browser validates and saves the exact request and operation ID before
submission. A lost reply holds that operation for status recovery; reload does
not prepare another specification. A fresh client can select the same task and
computer and choose **Resume saved work** to recover the newest authorised
native job, including its original Wizard request.

Successful specification receipts are checked against the original task,
operation and SHA-256 request binding using Web Crypto. Shared schema validation
is browser-safe; the existing Node adapter retains the same hashing contract.
The four-capability worker inventory is supported. History selection uses the
existing catalog authority predicate and rechecks specification authority on
read, so querying history does not require migration026 to have been installed.

The summary reports saved, reuse-available and needs-specification states.
Detailed missing questions are not present in this bounded receipt and are not
invented. Saving a specification does not authorise code execution or activation.

## Verification

- Full public source suite: 549 tests passed.
- TypeScript: passed.
- Controlled React workflow: duplicate click, lost reply, local reload, fresh
  client history, altered receipt, unsupported worker, denied browser storage,
  oversized Unicode and dated offline queue all checked.
- Actual application history SQL tested in the existing disposable PostgreSQL
  fixture before and after026; foreign/revoked access denied; rollback verified.

Run the existing public source check and TypeScript/build scripts. The existing
`catalog-sql-fixture.py <receipt-path> --wizard` additionally runs the actual
history query using synthetic identities in a transaction that always rolls back.

## Activation and recovery

This is a source candidate. Hosted activation still needs a reviewed compatible
web/private-runtime release, migration026, the existing opt-in Wizard capability
and task permissions, and one retained website-to-Windows acceptance followed by
reload and fresh-client recovery. Preserve existing owner IDs and job history.

Before activation, pin both revisions and record the previous web/runtime versions.
If the candidate fails, restore those versions and disable the optional Wizard
capability while retaining queued jobs and stored receipts for reconciliation.
Do not delete jobs, replace operation IDs after an uncertain response, or replay
execution as a substitute for reading status. Existing contribution and shared-room
workflows remain covered by the public suite.
