# Hosted read-only MCP authorization

The hosted endpoint exposes seven existing context reads. Clerk verifies the
OAuth access token; the application additionally binds it to the configured
owner, registered client, issuer, protected resource and required scopes. The
canonical player/operator lookup still runs before any private gateway read.
Tools cannot select another actor or grant themselves OAuth permissions. Hosted
checkpoint writes, workstation execution and filesystem exports remain absent.

## Required server policy

These are trusted deployment configuration names, with no fallback values:

| Name | Contract |
| --- | --- |
| `OWNER_CLERK_USER_ID` | Existing exact owner subject |
| `MASTERMIND_MCP_OAUTH_ISSUER` | Exact HTTPS issuer of the Clerk access token, including any path/trailing slash |
| `MASTERMIND_MCP_OAUTH_RESOURCE` | Exact canonical HTTPS MCP resource identifier; its origin must match the private request |
| `MASTERMIND_MCP_OAUTH_CLIENT_IDS` | JSON array of the actual manually registered client IDs, maximum eight |
| `MASTERMIND_MCP_OAUTH_REQUIRED_SCOPES` | Nonempty JSON array of necessary granted OAuth scopes, maximum sixteen, including an explicit service permission |

Existing Clerk keys and canonical memory/owner configuration remain required.
No client IDs, scope assignment, keys or tenant settings are created by source
installation. Empty/malformed policy produces an explicit 503 hold. Discovery
advertises the configured resource/issuer/scopes; it no longer derives a different
resource from each preview alias or claims a token endpoint is an introspection
endpoint. Only metadata responses allow public CORS. Private routes do not.

Use scopes actually assigned to the registered applications and appropriate for
the private context reads. `openid`, `profile` and `email` are identity scopes,
not automatic authorization to read the Mastermind archive. Clerk documents
custom-scope support, but support and assignment in this existing tenant must
be verified separately. Identity/profile/metadata-only configuration produces
`MCP_OAUTH_SERVICE_SCOPE_REQUIRED` (503). This source does not invent or create a
custom scope, or prove that a configured permission was assigned by the tenant.

## Exact verified-token boundary

Clerk backend 3.10.0's authenticated machine object returns the cryptographically
verified token from `getToken()`. The policy requires exact equality with the
presented Bearer before decoding any claims. It then matches the signed subject,
client ID and scopes with that Clerk result; checks exact issuer, expiry and any
not-before time; and requires the configured resource in signed `aud` or
`resource`. Audience arrays require exact membership. If both binding claims
exist, both must agree. Identifier trailing slashes and paths are not guessed.

The installed Clerk OAuth abstraction discards audience/resource information.
Opaque tokens therefore remain unsupported by this strict resource-binding
path: `TOKEN_RESOURCE_BINDING_UNAVAILABLE`. There is no inference from client ID
and no unverified JWT or alternate-auth fallback. A tenant that cannot issue an
OAuth access JWT with the required resource binding remains held; the existence
of this source is not proof that the current development tenant supports it.

## Client and deployment acceptance still required

The selected integration uses manually registered clients: the actual ChatGPT
client credentials and exact callback shown by its connection setup, and a public
PKCE Codex client with its configured OAuth client ID and exact displayed
loopback callback. Missing DCR/CIMD metadata alone does not invalidate this path.
Do not guess callback identifiers or copy one deployment's resource into another.
The resource may contain an exact path; the origin is used only to locate the
well-known metadata endpoint. Actual client registration and discovery must
confirm that this distinction is preserved by both clients and the issuer.

Before linking, verify the configured issuer's metadata, client registrations,
assigned scopes and token format/resource claims. Then demonstrate each client
can discover, authenticate and perform a bounded known read with exact citations;
wrong owner/client/resource/scope and expired tokens must yield no private read.
Revocation/refresh behavior needs its own real-provider acceptance. Synthetic
post-verification fixtures do not prove JWT signatures, tenant entitlement,
resource-parameter echo, browser linking, deployment or remote task persistence.

Sources: [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth),
[Codex MCP registration](https://learn.chatgpt.com/docs/extend/mcp),
[Clerk verification](https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens),
and [Clerk scopes and clients](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth).
