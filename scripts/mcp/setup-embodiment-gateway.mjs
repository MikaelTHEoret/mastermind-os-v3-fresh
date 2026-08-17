// scripts/mcp/setup-embodiment-gateway.mjs — print safe deployment and client setup without generating or exposing secrets.
console.log(`Mastermind Embodiment Gateway

Server endpoint
  https://mastermind-core.com/api/mcp

ChatGPT / desktop OAuth path
  1. Enable Dynamic client registration in Clerk's OAuth applications settings.
  2. Configure default scopes: openid, profile, email.
  3. Confirm NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, and OWNER_CLERK_USER_ID exist in Vercel.
  4. Add the remote MCP URL in ChatGPT developer mode and complete the Clerk owner sign-in.

Codex recovery-token path
  1. Configure MASTERMIND_MCP_TOKEN with at least 32 random bytes in Vercel and locally.
  2. Configure MASTERMIND_OWNER_ID and MASTERMIND_PARENT_ID.
  3. Add the server URL with bearer_token_env_var = \"MASTERMIND_MCP_TOKEN\".

Verification
  npm run mcp:validate
  npm run mcp:check-env
  npm run build
  npm run mcp:test -- https://mastermind-core.com/api/mcp

This release is read-only. It exposes no shell, raw SQL, arbitrary URL, filesystem, Minecraft action, or checkpoint-write tool.`);
