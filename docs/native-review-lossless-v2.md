# Lossless structured reviews (capability version 2)

A complete review may exceed the original 16 KiB request bound, and a negative
example may legitimately contain NUL in its input. PostgreSQL JSONB cannot store
that character as a decoded JSON string. Keep every original test and its hash:
review input schema 2 carries `content` as the canonical JSON **string**, while
schema 1 continues to carry the original object. The outer eight fields are
unchanged. The worker decodes only after validation and sends the original
content to the existing fixed local review endpoint. No local API, task authority,
source publication permit or coding approval is granted by this transport.

## Contract

Only `mastermind.native.review` advances to capability version 2. The exchange
protocol remains 2; the other seven development capabilities remain version 1.
A review-2 worker can recover review-1 jobs. A review-1 worker cannot lease a
review-2 job or disclose its retained outbox. Original content/requirements/test
hashes use decoded canonical content; command and journal hashes bind the exact
encoded request. Saved requests must retain their original version and identity.

Bounds: 20 KiB canonical decoded content, 24 KiB compact request and 28 KiB
formatted request. The existing 32 KiB exchange and journal limits remain.
Numbers must be safe integers: negative zero, floats and nonfinite values fail
before encoding. NUL is permitted only in test-case input/expected **values**;
keys and governing metadata remain restricted. Literal backslash-u0000 and a
real NUL remain distinct. PostgreSQL inspection uses a content-absent temporary
marker, restores the original escapes before hashing, and requires exact
canonical equality. The sanitized metadata helper is not a content export API.

The source fixture contains the full 18 release-inventory cases. Tests cover
save/edit/reload, source-package/build-plan recovery, canonical Unicode hashes,
NUL, literal escapes, invalid versions, owner and revocation denials, duplicate
requests, lost replies, journal restart and downgrade protection.

## Reader-first activation

1. Review exact source and acceptance evidence, obtain required publication
   authorization, and pin release/operation identities. Preserve current source,
   runtime configuration, database function definitions and deployment rollback.
2. Through the existing guarded procedure, apply **only migration 032** after
   verifying 031 and the expected preimages. Do not run the legacy bootstrap
   migration runner or replay earlier migrations. No task/history rewrite is
   needed. Verify old jobs, permissions and parent hashes are unchanged.
3. Deploy compatible hosted readers with `MASTERMIND_LOSSLESS_REVIEW_ENABLED`
   absent/false. Preserve this reader-capable feature-off build as rollback.
4. Install the matching worker sources under the existing supervisor. Enable
   `MASTERMIND_NODE_LOSSLESS_REVIEW_ENABLED=true` only with the previously accepted
   development prerequisites. The worker advertises `0.9.0-lossless-review` and
   exactly eight capabilities, with review version 2. Do not start another owner.
5. Verify the authenticated advertisement, old review recovery and absence of
   uncertain work. Enable `MASTERMIND_LOSSLESS_REVIEW_ENABLED=true` on the hosted
   service. Existing `MASTERMIND_NATIVE_REVIEW_ENABLED` and development controls
   still apply. Perform one real owner review with all 18 cases, then reload and
   recover the same job. Source publication/build planning require their own
   fresh bindings and local permissions. A saved review is not an accepted build.

## Pause and recovery

Disable new hosted lossless submissions first. Keep compatible web/SQL readers,
worker recovery support and the existing journal while any version-2 work exists.
Drain or reconcile uncertain operations without replay before changing the
worker advertisement. Do not restore a version-1-only database constraint,
reader or worker over version-2 jobs/receipts. Retain immutable requests and
receipts; never delete them to make a downgrade succeed. A compatible feature-off
release is the rollback target after the first version-2 write.

## Reproduce acceptance

Use the existing public synthetic source checks, TypeScript check and clean
production build. For actual PostgreSQL semantics, run the existing guarded,
rollback-only catalog fixture with `--wizard --review --development-work
--lossless-review` using an authorized connection. It creates a disposable
schema, exercises migrations through 032, always rolls back, and compares
production function definitions. This fixture does not activate production.
