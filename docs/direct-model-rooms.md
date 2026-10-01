# Direct model rooms (prepared, not activated)

This transport lets the existing owner-authenticated shared room request a text reply through an official provider API. It needs no browser extension. It shares the existing task ownership, session document, command receipts and browser recovery journal. Manual participants and existing browser records remain unchanged. No separate task system or transcript store is introduced.

The first increment is **one explicitly approved turn at a time**, followed by review/save and selection of the next participant. It does not implement automatic rounds, tool execution, downloads, streaming, provider chat capture or background generation. A provider reply is untrusted discussion data, not authority for runtime actions.

## Models and cost controls

The reviewed catalog (`2026-09-30-v1`) includes:

| Connection | Intended use | Activation requirement |
|---|---|---|
| `zai/glm-4.7-flash` | Free API text generation | Dedicated enrolled Z.ai credential |
| `gemini/gemini-2.5-flash-lite` | Free-tier API text generation | Dedicated enrolled Gemini credential with its free tier confirmed |
| `zai/glm-5.2` | Optional stronger paid model | Server `allowPaid: true` plus separate approval for each reply |

The default form shows only free-tier options. It never changes providers/models automatically when a provider is unavailable or rate limited. Existing chat subscriptions do not supply these API credentials. The Gemini free tier permits provider product improvement use; its notice is displayed before sharing. Account tier changes must invalidate enrollment. A model being listed as free does not prove the credential is on a free-tier account.

Paid estimates use the reviewed Z.ai input/output rates ($1.40/$4.40 per million tokens), approximate input tokens from bytes, and the full 1,024 output-token allowance. They are **estimates, not hard provider billing caps**. No tool calls are enabled. A provider-side spending cap is a separate account control. Nothing in this source change authorizes paid use, purchases or adding a billing account.

Official references reviewed on 2026-09-30: [Z.ai pricing](https://docs.z.ai/guides/overview/pricing), [Z.ai completion contract](https://docs.z.ai/api-reference/llm/chat-completion), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini generation contract](https://ai.google.dev/api/generate-content), [Gemini key handling](https://ai.google.dev/gemini-api/docs/api-key).

## Enrollment before any live acceptance

Keep `MASTERMIND_ROOM_API_ENABLED` absent/false until the source is reviewed, published with owner approval, deployed compatibly, and the intended credentials/tier verified. Credentials belong only in server-side secret settings:

- `MASTERMIND_ROOM_ZAI_API_KEY`
- `MASTERMIND_ROOM_GEMINI_API_KEY`
- `MASTERMIND_ROOM_API_POLICY` (nonsecret JSON binding)

This deliberately does not consume unrelated legacy `user_id=local` vault entries or generic provider environment variables. Enrollment must name the canonical task owner and authenticated Clerk subject, and bind each specific credential by SHA-256 of its exact UTF-8 bytes. Never paste keys into chat, logs, committed files or browser code. Compute fingerprints privately at enrollment.

Policy shape (placeholders, not usable authorization):

```json
{
  "householdId": "canonical-household",
  "actorPlayerId": "canonical-operator-uuid",
  "subject": "user_production_subject",
  "catalogVersion": "2026-09-30-v1",
  "reviewedAt": "review-time-ISO8601",
  "expiresAt": "expiry-time-ISO8601",
  "allowPaid": false,
  "providers": {
    "zai": {"enabled": true, "credentialSha256": "exact-credential-sha256"},
    "gemini": {"enabled": true, "credentialSha256": "exact-credential-sha256", "freeTierConfirmed": true}
  }
}
```

The initial acceptance enrollment lasts at most 24 hours. Review current provider availability/pricing and the account tier before renewing it; do not automatically renew old assertions. Only enabled providers need keys. No keys or their fingerprints appear in room responses.

For saved, unreadable Vercel secrets, the owner can use **Set up direct model connections → Prepare connection setup**. The dedicated same-origin POST route `/api/chat/connections/prepare` requires the existing owner session and canonical parent identity. It derives fingerprints inside the server and returns only a free-only policy proposal, bound to that identity and expiring after 24 hours. Gemini selection requires explicit free-tier confirmation. Raw keys never enter this form or its response. This preparation makes no provider request, configuration write, grant or activation. Technical details expose the nonsecret policy only to the authenticated owner so it can be installed through reviewed project configuration. Preparing again replaces only the visible proposal; it does not renew installed enrollment. Newly saved secrets must first be included in a compatible deployment. A longer-lived, owner-facing activation flow remains follow-up work after live acceptance.

## Send, recovery and review

1. The user prepares a turn from selected saved messages and reviews its immutable prompt. Only that prompt is sent; no filesystem, hidden history or provider tools are included.
2. `provider-send` binds the prompt hash, selected model, exact policy/estimate, sharing consent, paid consent where relevant, expected revision and operation ID. A database compare-and-swap reserves the send in the existing room document.
3. Only a confirmed reservation winner may proceed. A second owner-authorized compare-and-swap fences concurrent pause, steering and revocation before one fixed-endpoint request. A pause after that point cannot undo a send.
4. The provider call has no retries or redirect following. Limits: 48,000 prompt bytes, 1,024 output tokens, 20-second network deadline, 128 KiB response envelope and 48,000 visible response bytes. The owner route has a 60-second allowance; the browser waits up to 45 seconds for sends.
5. The visible reply and hash are saved as a draft. Usage/model/request metadata is retained; model reasoning is discarded. A separate `provider-review` binds the exact response hash. It saves the original text in the room once. Partial replies are labelled partial and pause the room.
6. Reload reads the original operation receipt. An uncertain send is never repeated. An expired/rejected pending browser request can be stopped with a newly journaled pause that fences its old revision. If the send already committed, its receipt is recovered instead.

The delivery guarantee is **at most one request attempt per reserved turn**, not exactly-once generation. A process or connection loss can leave `reserved`, `sending` or `unknown` indefinitely, including after a provider generated an answer. The UI shows the recorded time and offers a saved-result check. It must not invent delivery success or resend. If result persistence loses authorization, no private result is exposed or saved under a new owner. Provider-side reconciliation of these held outcomes is not implemented in this increment.

## Compatibility, tests and rollback

API participants add `transport: api` and a per-turn `provider` receipt to the current room format. Older clients that reject unknown transports cannot operate those new rooms. Before production enablement, accept matching web/runtime reader guards and the existing single-runtime-owner policy; legacy automation must not treat API participants as manual dispatch targets. The source-level manual dispatch guard rejects them. No live runtime compatibility claim is made by mocked tests.

Tests use an in-memory compare-and-swap database and mocked providers, including concurrency, lost acknowledgements at each write, revoked ownership, steering, expired/changed credentials, paid approvals, invalid responses, draft review and fresh-browser recovery. UI tests exercise the actual component's consent and review handlers and safe text rendering. These do not prove provider entitlement, real API availability, production database behavior or browser layout. Run `node --test src/lib/chat-room/*.test.mjs` and TypeScript before review.

Rollback first disables `MASTERMIND_ROOM_API_ENABLED` while keeping this compatible reader deployed. Reconcile any in-flight request without retry; preserve all room documents and receipts. This stops new direct sends while retaining draft review and recovery. Do not downgrade to an older reader for API rooms or delete receipts to clear a held request. Public source disclosure and live activation remain separate reviewed steps.
