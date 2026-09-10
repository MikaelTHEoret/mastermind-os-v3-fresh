import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';

async function initialize(entry, context) {
  const child = spawn(process.execPath, [path.resolve(entry)], {
    cwd: path.resolve('.'),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NEON_MEMORY_URL: 'postgresql://user:password@127.0.0.1/example',
      MASTERMIND_MEMORY_HOUSEHOLD_ID: 'family-local',
      MASTERMIND_MEMORY_OPERATOR_PLAYER_ID: '00000000-0000-8000-8000-000000000001',
    },
  });
  context.after(() => child.kill());
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const responses = [];
  lines.on('line', (line) => responses.push(JSON.parse(line)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  const deadline = Date.now() + 5_000;
  while (responses.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(responses.length, 2);
  assert.equal(responses[0].result.serverInfo.name, 'mastermind-context-gateway');
  const checkpoint = responses[1].result.tools.find((tool) => tool.name === 'mastermind_task_checkpoint');
  assert.equal(checkpoint.annotations.idempotentHint, false);
  assert.match(checkpoint.description, /same caller-supplied taskId, checkpointId, and payload/);
  assert.equal(responses[1].result.tools.find((tool) => tool.name === 'mastermind_bootstrap').inputSchema.properties.budget.maximum, 48000);
  return responses[1].result.tools.map((tool) => tool.name);
}

function assertBounded(names) {
  assert.ok(names.includes('mastermind_bootstrap'));
  assert.ok(names.includes('mastermind_task_checkpoint'));
  assert.ok(names.includes('mastermind_minecraft_status'));
  assert.ok(names.includes('mastermind_minecraft_memory_search'));
  assert.ok(!names.some((name) => /shell|execute|sql|minecraft_action/.test(name)));
}

test('stdio MCP server initializes and advertises only bounded tools', async (context) => {
  assertBounded(await initialize('services/mastermind-context-gateway/src/mcp-server.mjs', context));
});

test('every historical MCP entry point delegates to the bounded gateway', async (context) => {
  for (const entry of [
    'memory-system/session-logger-server.js',
    'scripts/mastermind-mcp-server.js',
    'scripts/mcp/mastermind-mcp-server.js',
  ]) assertBounded(await initialize(entry, context));
});
