import { access } from 'node:fs/promises';
import path from 'node:path';

const server = path.resolve('services/mastermind-context-gateway/src/mcp-server.mjs');
await access(server);

console.log('Mastermind Context Gateway is ready to register.');
console.log('');
console.log('ChatGPT desktop: Settings -> MCP servers -> Add server -> STDIO');
console.log(`Command: node ${server}`);
console.log('Save, restart the desktop client, then use /mcp to verify the connection.');
console.log('');
console.log('Equivalent Codex CLI command:');
console.log(`codex mcp add mastermind-context -- node ${server}`);
console.log('');
console.log('The server loads .env.local itself. Do not copy database credentials into MCP configuration.');
