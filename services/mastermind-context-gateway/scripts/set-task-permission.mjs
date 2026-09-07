import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGatewayFromEnvironment } from '../src/mcp-server.mjs';
import { ContextGatewayError } from '../src/validation.mjs';
// Explicit owner administration, never exposed by MCP or client-task-adapter.
try {
  const [file,expectedHash,...extra]=process.argv.slice(2);
  if(!file||!expectedHash||extra.length)throw new ContextGatewayError('REVIEWED_COMMAND_REQUIRED','Pass the reviewed command file and its exact SHA256.');
  const bytes=fs.readFileSync(file);
  if(bytes.length>65536||crypto.createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw new ContextGatewayError('REVIEWED_COMMAND_REQUIRED','The permission command differs from the reviewed file.');
  const command=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const gateway=createGatewayFromEnvironment(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'));
  process.stdout.write(JSON.stringify({ok:true,result:await gateway.clientSetTaskPermissions(command)})+'\n');
} catch(error) {
  process.stdout.write(JSON.stringify({ok:false,error:{code:error instanceof ContextGatewayError?error.code:'PERMISSION_COMMAND_UNAVAILABLE',
    message:error instanceof ContextGatewayError?error.message:'The reviewed task permission command could not complete.'}})+'\n');
  process.exitCode=1;
}
