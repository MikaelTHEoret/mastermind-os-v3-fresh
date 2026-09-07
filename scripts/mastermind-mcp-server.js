#!/usr/bin/env node
// Compatibility entry point. The historical terminal/AutoGPT server exposed
// broad execution concepts; all callers now use the bounded Context Gateway.
import { startMcpServer } from '../services/mastermind-context-gateway/src/mcp-server.mjs';

startMcpServer()
  .catch((error) => {
    process.stderr.write(`[mastermind-context-gateway] compatibility startup failed: ${String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 240)}\n`);
    process.exitCode = 1;
  });
