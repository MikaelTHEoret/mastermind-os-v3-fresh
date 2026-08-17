// scripts/mcp/test-embodiment-gateway.mjs — official SDK smoke test for the authenticated remote gateway.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = new URL(
  process.argv.slice(2).find((argument) => argument !== '--')
    || process.env.MASTERMIND_MCP_URL
    || 'http://localhost:3000/api/mcp',
);
const token = (process.env.MASTERMIND_MCP_TOKEN || '').trim();
if (token.length < 32) throw new Error('MASTERMIND_MCP_TOKEN must contain at least 32 characters.');

const expectedTools = [
  'mastermind_system_status',
  'mastermind_bootstrap',
  'mastermind_context_pack',
  'mastermind_memory_search',
  'mastermind_archive_search',
  'mastermind_archive_fetch',
  'mastermind_project_state',
];

const client = new Client(
  { name: 'mastermind-embodiment-smoke-test', version: '0.1.0' },
  { versionNegotiation: { mode: 'auto' } },
);
const transport = new StreamableHTTPClientTransport(endpoint, {
  authProvider: { token: async () => token },
  requestInit: { headers: { 'x-mastermind-host': 'codex' } },
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  const missing = expectedTools.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Missing tools: ${missing.join(', ')}`);
  if (listed.tools.some((tool) => tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false)) {
    throw new Error('One or more tools lack the expected read-only annotations.');
  }

  const status = await client.callTool({ name: 'mastermind_system_status', arguments: {} });
  if (status.isError) throw new Error('mastermind_system_status returned a tool error.');

  console.log(JSON.stringify({
    ok: true,
    endpoint: endpoint.toString(),
    serverVersion: client.getServerVersion(),
    capabilities: client.getServerCapabilities(),
    instructions: client.getInstructions(),
    toolCount: listed.tools.length,
    tools: names,
    gateway: status.structuredContent?.gateway,
    database: status.structuredContent?.database,
    corpus: status.structuredContent?.corpus,
  }, null, 2));
} finally {
  await transport.terminateSession().catch(() => undefined);
  await client.close().catch(() => undefined);
}
