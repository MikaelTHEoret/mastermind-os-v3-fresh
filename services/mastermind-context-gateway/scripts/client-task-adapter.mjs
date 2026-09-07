import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGatewayFromEnvironment } from '../src/mcp-server.mjs';
import { ContextGatewayError, exactObject } from '../src/validation.mjs';

// Native host-controlled subprocess seam. No shell, module source execution,
// scope mutation, new task store, arbitrary method names or import-time DB work.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
try {
  let bytes = 0; const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 65536) throw new ContextGatewayError('REQUEST_TOO_LARGE', 'Native task metadata exceeds 64 KiB.');
    chunks.push(chunk);
  }
  const input = exactObject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), ['action', 'arguments']);
  const handlers = { readTask: 'clientTaskState', authorizeModule: 'clientAuthorizeModule', checkpoint: 'checkpoint' };
  if (!Object.hasOwn(handlers, input.action)) throw new ContextGatewayError('ACTION_NOT_ALLOWED', 'This native adapter action is not available.');
  const gateway = createGatewayFromEnvironment(root);
  const result = await gateway[handlers[input.action]](input.arguments);
  process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: error instanceof ContextGatewayError ? error.code : 'NATIVE_TASK_ADAPTER_UNAVAILABLE',
    message: error instanceof ContextGatewayError ? error.message : 'The native task adapter could not complete the request.' } }) + '\n');
  process.exitCode = 1;
}
