# Remote review reuse decisions

Migration030 extends the existing job ledger with the opt-in
`mastermind.native.review-reuse` capability. It adds no task system, tables or
grants. A successful saved review is the parent of an assessment; an assessment
with complete evidence is the parent of a saved reuse decision. Exact parent,
task, qualification, candidate and explicit difference decisions are enforced at
admission, lease, receipt and owner read. A saved decision grants no execution
authority and does not turn the historical review into an accepted proposal.

The local broker retains the full evidence. The hosted receipt contains only
identities, coverage counts, difference names and the existing decision pointer.
If a matching local decision exists, its original operation ID is recovered.
Lost replies use recovery only; current permissions and source are rechecked
before disclosing saved receipts.

## Activation order

1. Accept and install the private broker's compact-decision/discovery support.
2. Deploy this compatible web/worker source with both new flags disabled.
3. Test030 with `run-catalog-sql-fixture.mjs <output> --wizard --review
   --review-reuse`; the fixture uses synthetic identities and always rolls back.
4. Capture existing ledger/function evidence and apply030 in a bounded
   transaction. Retain029's review-specific lease limit.
5. Enable `MASTERMIND_NODE_REVIEW_REUSE_ENABLED=true` on the existing core-only
   worker, alongside the existing task, specification and review opt-ins.
6. Enable hosted `MASTERMIND_REVIEW_REUSE_ENABLED=true`; accept assessment,
   decision recovery, reconnect and fresh-client history through the website.

## Recovery and limits

Disable hosted admission first. Drain/reconcile every pending worker receipt
before disabling worker advertisement. Preserve the compatible reader and030
after new jobs exist; reverting to a five-capability reader would hide or reject
those records. Do not drop constraints/functions or erase jobs as a rollback.
Retain the earlier core source and exact live preimages separately. This source
and its fixtures do not constitute production or second-machine acceptance.

No code is executed by assessment or linking. Module calls continue to use the
existing accepted specification and current task permission checks. Changed
functional requirements, missing behavioral evidence, altered source, changed
qualification or revoked authority remain held.
