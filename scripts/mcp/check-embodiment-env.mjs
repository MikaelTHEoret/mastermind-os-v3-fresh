// scripts/mcp/check-embodiment-env.mjs — verify gateway configuration without printing any secret values.
const present = (name) => Boolean((process.env[name] || '').trim());
const lengthAtLeast = (name, minimum) => (process.env[name] || '').trim().length >= minimum;

const checks = {
  memoryDatabase: present('NEON_MEMORY_URL'),
  canonicalOwner: present('MASTERMIND_OWNER_ID') || present('OWNER_CLERK_USER_ID'),
  persistentTaskParent: present('MASTERMIND_PARENT_ID'),
  clerkOAuth: present('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY') && present('CLERK_SECRET_KEY') && present('OWNER_CLERK_USER_ID'),
  recoveryToken: lengthAtLeast('MASTERMIND_MCP_TOKEN', 32),
  matchingDenseEmbedder: present('OLLAMA_EMBED_URL'),
};
const failures = [];
if (!checks.memoryDatabase) failures.push('NEON_MEMORY_URL');
if (!checks.canonicalOwner) failures.push('MASTERMIND_OWNER_ID or OWNER_CLERK_USER_ID');
if (!checks.persistentTaskParent) failures.push('MASTERMIND_PARENT_ID');
if (!checks.clerkOAuth && !checks.recoveryToken) failures.push('Clerk OAuth configuration or a 32+ character MASTERMIND_MCP_TOKEN');

console.log(JSON.stringify({
  ok: failures.length === 0,
  checks,
  failures,
  notes: {
    denseRetrieval: checks.matchingDenseEmbedder ? 'configured' : 'lexical fallback only',
    authentication: checks.clerkOAuth ? 'Clerk OAuth available' : checks.recoveryToken ? 'recovery token only' : 'unconfigured',
  },
}, null, 2));
if (failures.length) process.exitCode = 1;
