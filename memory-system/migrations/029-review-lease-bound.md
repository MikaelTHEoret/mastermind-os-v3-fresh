# Review lease replay capacity

A valid review can exceed the original 4 KiB exchange replay constraint. Its
submission succeeds, but acquiring its lease then aborts the exchange transaction,
leaving the job queued and the worker returning HTTP 503.

Migration 029 retains the 4 KiB rule for existing envelopes. Larger envelopes
must identify the review capability, pass the existing 028 review input validator,
and fit within 32 KiB. Missing/null capabilities cannot pass through SQL's nullable
CHECK semantics. This migration does not change grants or task authorization.

Validated against the deployed schema in a rolled-back transaction: the real
queued review fails the old constraint and passes the new one. Eleven cases cover
that reproduction, null leases, ordinary small leases, oversized ordinary leases,
missing/null capability, invalid review input, oversized review, arrays and strings.
All 15 jobs, 53 receipts and 174177 exchange rows were preserved during validation.

Rollback: retain this reader capacity after a larger review lease is stored. An
older 4 KiB constraint cannot be restored without rejecting retained replay rows.
Stop new review admission using the compatible feature-off application if needed;
do not delete replay history or rewrite queued inputs. The change is additive and
existing non-review bounds remain unchanged.
