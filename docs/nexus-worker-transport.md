# Read-only Nexus worker transport

Source candidate only. The hosted ledger does not yet accept this capability.
Do not enable either flag or install the worker before the coupled ledger,
owner route, local host configuration and rollback are accepted.

`mastermind.native.nexus` v1 is an explicit twelfth capability of the existing
core worker. The eleven-capability lifecycle profile and older profiles remain
unchanged. `MASTERMIND_NODE_NEXUS_ENABLED=true` requires explicit lifecycle
activation. The existing local ModuleCore requires `--enable-nexus-transport`.
Neither setting creates a service, pairing, task store or permission grant.

The fixed loopback endpoint `/task_nexus` has two read-only actions:

- `catalog`: return one original-source-verified saved plan and current task basis.
  Later pages carry the complete catalog snapshot hash and last plan ID. A changed
  source, checkpoint or permission invalidates the snapshot. No plans are rebuilt.
- `verify`: verify one exact immutable Nexus proposal, returning its SHA256.
  The worker job ID must differ from the proposal's save operation ID. This proof
  grants no coding, testing, activation or dependency execution permission.

The transport request is at most 16 KiB of canonical UTF-8 JSON; it rejects a
larger otherwise valid graph rather than truncating it. The result is at most
3072 bytes; only this capability permits a full wire receipt up to 4096 bytes.
The existing 4 KiB journal receipt and 32 KiB effect read limits remain unchanged.
Ordinary receipts retain the 2 KiB wire limit. A single result contains at most
one plan label (480 UTF-8 bytes) and two source addresses, never source text.

Requests have schemaVersion, operationId, taskRef, action, proposal, snapshotId
and cursor. Catalog requests have null proposal. Verify requests have null
snapshotId/cursor. All objects reject extra fields. The owner and worker must
preserve the exact request through uncertain replies; the client does not retry.

The existing journal rechecks current private source and task permission before
returning an undelivered or completed result. It retains the original timestamp;
recovery never renews the proof. A server composing a new proposal save must read
the result through the authenticated ledger, bind the request and proposal hashes,
and require an observation no older than 60 seconds (5 seconds clock tolerance).
The helper is validation, not authentication; browser-supplied proof is insufficient.
Recovery of an already saved proposal must read the original store before asking
for another verification. Pending work retains its operation ID.

Current acceptance uses the real Python plan/source reader, disposable registry,
HTTP origin boundary, Node worker, actual disk journal and synthetic authenticated
exchange. It proves source-level recovery, not a live hosted round trip.

Still required: compatible migration039 over the existing job/lease/receipt
functions, server-derived owner authorization and exact queued proof consumption,
owner form composition, database races and offline/reconnect tests, coupled source
and startup-policy pins, approved public publication and live owner acceptance.
