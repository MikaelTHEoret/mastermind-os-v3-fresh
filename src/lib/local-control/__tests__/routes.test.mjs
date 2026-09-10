import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as protocol from '../protocol.mjs';

const restartRouteSource = fs.readFileSync(
  new URL('../../../app/api/local-control/services/[role]/restart/route.ts', import.meta.url),
  'utf8',
);
const compiledRestartRoute = ts.transpileModule(restartRouteSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'restart-route.ts',
}).outputText;

class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function loadRestartRoute() {
  const restarts = [];
  const commonJsModule = { exports: {} };
  const sandbox = {
    Error,
    Promise,
    exports: commonJsModule.exports,
    module: commonJsModule,
    require(identifier) {
      if (identifier === '@/lib/local-control/access') {
        return { requireLocalServiceAccess: async () => undefined };
      }
      if (identifier === '@/lib/local-control/service-client') {
        return {
          restartMinecraftControlAgent: async (request) => {
            restarts.push(request);
            return {
              ok: true,
              accepted: true,
              requestId: request.requestId,
              generation: request.expectedGeneration + 1,
              operation: { state: 'accepted' },
            };
          },
        };
      }
      if (identifier === '@/lib/local-control/http') {
        return {
          LocalServiceRequestError: RequestError,
          localServiceJson: (body, status = 200) => ({ body, status }),
          localServiceErrorResponse: (error) => ({
            body: { ok: false, code: error.code ?? 'SERVICE_CONTROL_BOUNDARY_ERROR', message: error.message },
            status: error.status ?? 500,
          }),
          readBoundedJsonBody: async (request) => request.testBody,
        };
      }
      if (identifier === '@/lib/local-control/protocol.mjs') return protocol;
      throw new Error(`Unexpected test import: ${identifier}`);
    },
  };
  vm.runInNewContext(compiledRestartRoute, sandbox, { filename: 'restart-route.cjs' });
  return { route: commonJsModule.exports, restarts };
}

function request(testBody) {
  return {
    nextUrl: new URL('http://127.0.0.1:3000/api/local-control/services/minecraft-control-agent/restart'),
    testBody,
  };
}

const validBody = {
  requestId: '123e4567-e89b-42d3-a456-426614174000',
  expectedGeneration: 2,
  confirmation: protocol.LOCAL_SERVICE_RESTART_CONFIRMATION,
};

test('restart route returns 202 and removes the browser confirmation before IPC', async () => {
  const { route, restarts } = loadRestartRoute();
  const response = await route.POST(
    request(validBody),
    { params: Promise.resolve({ role: 'minecraft-control-agent' }) },
  );
  assert.equal(response.status, 202);
  assert.deepEqual(response.body, {
    ok: true,
    accepted: true,
    requestId: validBody.requestId,
    generation: 3,
    operation: { state: 'accepted' },
  });
  assert.equal(
    JSON.stringify(restarts),
    JSON.stringify([{ requestId: validBody.requestId, expectedGeneration: 2 }]),
  );
});

test('restart route rejects every fixed non-agent role with 403 before IPC', async () => {
  for (const role of ['supervisor', 'next-web', 'mastermind-node-link']) {
    const loaded = loadRestartRoute();
    const response = await loaded.route.POST(request(validBody), { params: Promise.resolve({ role }) });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'SERVICE_RESTART_NOT_ALLOWED');
    assert.deepEqual(loaded.restarts, []);
  }
});

test('restart route rejects arbitrary roles with 404 before IPC', async () => {
  const { route, restarts } = loadRestartRoute();
  const response = await route.POST(request(validBody), { params: Promise.resolve({ role: 'anything-else' }) });
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'SERVICE_NOT_FOUND');
  assert.deepEqual(restarts, []);
});
