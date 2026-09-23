# Reviewed contribution import

Prepared source, not a deployed feature. The hosted Wizard can select a reviewed
contribution for a saved request, preview it, explicitly stage its candidate and
recover the original import. No source text, permission grant or internal IDs
need to be entered in the form. Behavioral tests and activation remain separate.

The existing native task ledger carries `mastermind.native.contribution` v1.
Migration035 adds strict request/result validation, current owner/task/node and
saved-specification authorization, and the same busy exclusions as other native
jobs. Local source/review authority is still checked by the pinned core adapter.
Catalog responses are dated metadata, not authorization. An import ID is bound
to its owner, computer, task and specification; successful source identity cannot
be replaced by a later delivery.

The form stores the original network request before submitting. Reload and
shared task recovery read that request without posting it again. An explicitly
requested recovery uses a new delivery ID and the original import ID. Recovery
can report a partial import without staging absent source; the owner can then
explicitly finish staging the same reviewed import. Duplicate clicks are guarded.
Catalog paging retains its snapshot; returning to the list obtains a new one.

## Coupled rollout

1. Review and publish the exact web source only with owner authorization.
2. Accept the private runtime reader, transaction, host and owner adapter from
   the private contribution branches. Retain all existing provider bindings.
3. Validate migration035 against the actual schema/ACL baseline; prepare its
   exact backup and rollback. It uses existing tables and changes no task IDs,
   grants or historical rows. The disposable PostgreSQL fixture is not a live
   migration receipt.
4. Deploy compatible readers before creating contribution history. Owner reads
   resolve the new authorization function only after encountering a contribution
   row, allowing deployment before035.
5. Enable the worker only through a reviewed coupled supervisor/host policy:
   `MASTERMIND_NODE_CONTRIBUTIONS_ENABLED=true`, with the existing review-recovery
   profile. It advertises ten core capabilities only with that explicit opt-in.
   Preserve one runtime owner and independently bound source import operations.
6. Set `MASTERMIND_NATIVE_CONTRIBUTIONS_ENABLED=true` on the compatible website
   only after the ledger and worker are ready. It defaults to unavailable.
7. Accept the authenticated owner workflow once with real prepared source and
   fresh independent authority. Record preview, stage, lost-reply recovery and
   reload evidence separately. Do not replay completed coding or candidate tests.

Disable new submissions first on rollback. Drain/reconcile actual leases and
retained worker outboxes before withdrawing support. The SQL rollback refuses
any contribution history, including terminal jobs; retain compatible readers
instead of deleting history. Neither UI deployment nor a passing fixture
authorizes runtime installation, source execution, tests or activation.

## Verification

The disposable SQL fixture applies035 twice, verifies exact function/ACL rollback
to034 before creating history, and tests old-worker exclusion, all eight prior
native families' busy exclusions, revoked access, malformed/forged results,
duplicate delivery and same-import recovery. Synthetic interface tests cover
preview/stage separation, duplicate clicks, lost replies, reload, shared history,
partial-import recovery and current authorization denial. Real owner/browser
acceptance remains required after the coupled rollout.
