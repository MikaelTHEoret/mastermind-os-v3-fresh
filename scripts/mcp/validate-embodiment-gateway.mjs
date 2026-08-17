// scripts/mcp/validate-embodiment-gateway.mjs — dependency-free static safety and integration validation.
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const expectedTools = [
  'mastermind_system_status',
  'mastermind_bootstrap',
  'mastermind_context_pack',
  'mastermind_memory_search',
  'mastermind_archive_search',
  'mastermind_archive_fetch',
  'mastermind_project_state',
];
const requiredFiles = [
  'src/lib/mastermind-context/security.ts',
  'src/lib/mastermind-context/gateway.ts',
  'src/lib/mastermind-context/common.ts',
  'src/lib/mastermind-context/retrieval.ts',
  'src/lib/mastermind-context/state.ts',
  'src/lib/mastermind-context/context.ts',
  'src/app/api/mcp/route.ts',
  'src/app/api/embodiment/session/route.ts',
  'src/app/api/chat/route.ts',
  'src/app/.well-known/oauth-protected-resource/mcp/route.ts',
  'src/app/.well-known/oauth-authorization-server/route.ts',
  'docs/MASTERMIND_EMBODIMENT_GATEWAY.md',
  'scripts/mcp/check-embodiment-env.mjs',
];

const source = async (path) => readFile(resolve(root, path), 'utf8');
for (const path of requiredFiles) await stat(resolve(root, path));

const [mcp, gatewayFacade, common, retrieval, state, context, security, webRoute, chatRoute, packageText] = await Promise.all([
  source('src/app/api/mcp/route.ts'),
  source('src/lib/mastermind-context/gateway.ts'),
  source('src/lib/mastermind-context/common.ts'),
  source('src/lib/mastermind-context/retrieval.ts'),
  source('src/lib/mastermind-context/state.ts'),
  source('src/lib/mastermind-context/context.ts'),
  source('src/lib/mastermind-context/security.ts'),
  source('src/app/api/embodiment/session/route.ts'),
  source('src/app/api/chat/route.ts'),
  source('package.json'),
]);
const gateway = [gatewayFacade, common, retrieval, state, context].join('\n');
const pkg = JSON.parse(packageText);
const failures = [];
const assertions = [];
const check = (condition, name) => {
  assertions.push({ name, pass: Boolean(condition) });
  if (!condition) failures.push(name);
};

for (const tool of expectedTools) check(mcp.includes(`registerTool('${tool}'`), `tool:${tool}`);
check(mcp.includes('const READ_ONLY = {') && mcp.includes('readOnlyHint: true'), 'shared read-only annotation');
check(mcp.includes('destructiveHint: false'), 'shared non-destructive annotation');
check(mcp.includes('idempotentHint: true'), 'shared idempotent annotation');
check(mcp.includes('openWorldHint: false'), 'shared closed-world annotation');
check(mcp.includes("resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp'"), 'OAuth protected-resource discovery path');
check(mcp.includes('MAX_REQUEST_BYTES = 65_536'), '64 KiB request boundary');
check(mcp.includes('MAX_TOOL_PAYLOAD_BYTES = 24_000'), 'safe duplicated MCP tool payload boundary');
check(security.includes('MAX_RESPONSE_BYTES = 65_536'), '64 KiB generic response boundary');
check(security.includes('timingSafeEqual'), 'timing-safe recovery-token comparison');
check(gateway.includes('reciprocalRankFusion'), 'hybrid reciprocal-rank fusion');
check(gateway.includes('perDocument'), 'archive document diversity cap');
check(gateway.includes('Dense archive retrieval unavailable; lexical retrieval remained active.'), 'lexical fallback');
check(gateway.includes("requireScope(principal, 'memory')"), 'memory authorization inside shared service');
check(gateway.includes("requireScope(principal, 'archive')"), 'archive authorization inside shared service');
check(gateway.includes("scopes.includes('task') ? projectState"), 'requested-scope isolation for tasks');
check(gateway.includes("scopes.includes('memory') ? searchMemory"), 'requested-scope isolation for memory');
check(gateway.includes("scopes.includes('archive') ? searchArchive"), 'requested-scope isolation for archive');
check(webRoute.includes('createEmbodimentSession'), 'web session route uses shared embodiment service');
check(chatRoute.includes('buildContextPack'), 'web chat turn uses shared context packer');
check(chatRoute.includes("authority: 'canonical-gateway'"), 'web chat overrides client context with canonical context');
check(mcp.includes('createEmbodimentSession'), 'MCP route uses shared embodiment service');
check(pkg.dependencies['mcp-handler'] === '2.1.1', 'mcp-handler pinned');
check(pkg.dependencies['@modelcontextprotocol/server'] === '2.0.0', 'MCP server SDK pinned');
check(pkg.devDependencies['@modelcontextprotocol/client'] === '2.0.0', 'MCP client SDK pinned');
check(pkg.dependencies['@clerk/mcp-tools'] === '0.6.0', 'Clerk MCP OAuth pinned');
check(pkg.dependencies.zod === '4.4.3', 'Zod pinned');
check(pkg.scripts['mcp:check-env'] === 'node scripts/mcp/check-embodiment-env.mjs', 'safe environment check registered');

const inspected = [mcp, gateway, security, webRoute, chatRoute].join('\n');
const prohibited = [
  ['child_process', /(?:node:)?child_process/],
  ['shell execution', /\b(?:exec|execFile|spawn|fork)\s*\(/],
  ['dynamic code execution', /\b(?:eval|Function)\s*\(/],
  ['raw PostgreSQL credential', /postgres(?:ql)?:\/\/[^\s"'<>]+/i],
  ['private key', /BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY/],
];
for (const [name, pattern] of prohibited) check(!pattern.test(inspected), `prohibited:${name}`);
check(!/registerTool\([^\n]*(?:shell|sql|execute|filesystem|minecraft_action)/i.test(mcp), 'no broad or action tool registered');

const report = {
  ok: failures.length === 0,
  gatewayVersion: '0.1.0',
  expectedToolCount: expectedTools.length,
  assertionCount: assertions.length,
  failures,
  assertions,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
