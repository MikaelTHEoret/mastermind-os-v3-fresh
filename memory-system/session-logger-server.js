#!/usr/bin/env node
'use strict';

// Compatibility entry point for older desktop configurations.
// The former session logger contained its own database credential and a second
// memory protocol. All callers now converge on the bounded Context Gateway.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const serverPath = path.resolve(__dirname, '..', 'services', 'mastermind-context-gateway', 'src', 'mcp-server.mjs');

import(pathToFileURL(serverPath).href)
  .then(({ startMcpServer }) => startMcpServer())
  .catch((error) => {
    process.stderr.write(`[mastermind-context-gateway] compatibility startup failed: ${String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 240)}\n`);
    process.exitCode = 1;
  });
