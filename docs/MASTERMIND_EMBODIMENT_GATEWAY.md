# Mastermind Embodiment Gateway

This slice makes the existing Mastermind/Neon corpus the persistent mind behind multiple bounded bodies. It does not create a second memory database or vector store.

## Shared embodiment service

- `POST /api/embodiment/session` — same-origin Clerk-owner or recovery-token web handshake.
- `GET|POST /api/mcp` — OAuth-first, stateless Streamable HTTP MCP endpoint for ChatGPT and Codex.
- `src/lib/mastermind-context/gateway.ts` — the canonical service used by both transports.
- `POST /api/chat` — owner-authorized web chat bridge that replaces client-supplied context with a server-built Mastermind context pack before forwarding the model turn.

The service reads the existing `harmonic_memories`, `transcript_archive`, `fractal_nodes`, `mastermind_tasks`, and `mastermind_task_checkpoints` substrate through `NEON_MEMORY_URL`.

## Authentication

### ChatGPT and other OAuth-capable MCP hosts

The MCP endpoint uses Clerk as the OAuth authorization server. It accepts only the configured canonical owner (`OWNER_CLERK_USER_ID` or `MASTERMIND_OWNER_ID`). The following public discovery endpoints are included:

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`

In Clerk Dashboard, enable **Dynamic client registration** for OAuth applications and set default scopes to `openid`, `profile`, and `email`. Existing Clerk environment variables remain the authority for OAuth verification.

### Codex recovery token

A fixed owner token remains available as a recovery and CLI path:

```dotenv
MASTERMIND_MCP_TOKEN=<at-least-32-random-characters>
```

Generate it locally and place it in Vercel and the local Codex environment without committing or pasting it into chat.

## Required environment

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<existing Clerk publishable key>
CLERK_SECRET_KEY=<existing Clerk secret key>
OWNER_CLERK_USER_ID=<canonical owner Clerk user ID>

MASTERMIND_OWNER_ID=<canonical owner ID; may equal OWNER_CLERK_USER_ID>
MASTERMIND_PARENT_ID=<persistent-task parent ID>
MASTERMIND_DEFAULT_PROJECT=mastermind
MASTERMIND_ALLOWED_PROJECTS=mastermind
MASTERMIND_MCP_TOKEN=<optional recovery token, minimum 32 characters>

OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_EMBED_URL=<existing authenticated matching embedder endpoint, optional>
```

When the matching embedding service is offline, retrieval degrades to PostgreSQL lexical search rather than failing the entire embodiment.

## Codex connection

```toml
[mcp_servers.mastermind]
url = "https://mastermind-core.com/api/mcp"
bearer_token_env_var = "MASTERMIND_MCP_TOKEN"
required = true
startup_timeout_sec = 20
tool_timeout_sec = 60
```

The client should call `mastermind_bootstrap` first. The response carries provider-independent identity, current project continuity, a bounded context pack, stable memory/archive references, and the capabilities available to the connected body.

## Current read-only faculties

- `mastermind_system_status`
- `mastermind_bootstrap`
- `mastermind_context_pack`
- `mastermind_memory_search`
- `mastermind_archive_search`
- `mastermind_archive_fetch`
- `mastermind_project_state`

Every tool is declared read-only, non-destructive, idempotent, and closed-world. Requested context scopes are enforced inside the shared service before their database queries run.

## Safety boundary

- Authentication and canonical-owner checks complete before any database or vector retrieval.
- Responses are recursively redacted. Logical tool payloads are capped at 24 KiB because MCP returns both structured and text-compatible copies, keeping the full response below the 64 KiB transport boundary.
- Query, project, scope, limit, and context-budget inputs are validated.
- No raw SQL, shell, arbitrary URL, arbitrary filesystem, generic execution, or Minecraft action tool exists.
- No checkpoint write is exposed yet.
- Dense retrieval uses only the embedding model matching the stored vectors.
- Canonical state remains in Neon; model output remains interpretation rather than authority.

The next gate is cross-host acceptance: bootstrap the same project from the web route and desktop MCP, verify the same task revision and source references, then enable append-only idempotent checkpoint writes.

## Validation commands

```powershell
npm run mcp:validate
npm run mcp:check-env
npm run build
$env:MASTERMIND_MCP_TOKEN = '<local recovery token>'
npm run mcp:test -- https://mastermind-core.com/api/mcp
```

`mcp:check-env` reports only booleans and missing variable names; it never prints values. The live MCP smoke test uses the official MCP client SDK and verifies tool discovery, read-only annotations, negotiation, and the system-status call.
