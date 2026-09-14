import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { ContributionStore } from '../../../src/lib/delegation/store.mjs';
import * as adapter from '../src/hosted-adapter.mjs';
import * as validation from '../src/validation.mjs';

test('production contribution factory uses the configured external binding and rechecks revocation before every query', async () => {
  const actor = '8619c07c-fd41-4914-b83c-21d75cae502f', calls = [];
  let bound = true;
  class Store {
    constructor() { this.sql = { query: async (query, args) => { calls.push(['query', args]); return query.includes('SELECT t.task_id::text') ? [{ taskId: args[0] }] : []; } }; }
    async resolveClerkOperator(subject, identity) {
      calls.push(['bind', subject, identity]);
      if (!bound) throw new validation.ContextGatewayError('OWNER_BINDING_REQUIRED', 'Revoked', 403);
      return identity;
    }
  }
  const module = { exports: {} };
  const source = fs.readFileSync(new URL('../../../src/lib/mastermind-context/gateway.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports = { 'server-only': {}, '../../../services/mastermind-context-gateway/src/neon-store.mjs': { NeonMemoryStore: Store },
    '../../../services/mastermind-context-gateway/src/hosted-adapter.mjs': adapter,
    '../../../services/mastermind-context-gateway/src/validation.mjs': validation, '@/lib/delegation/store.mjs': { ContributionStore } };
  vm.runInNewContext(code, { module, exports: module.exports, process: { env: { OWNER_CLERK_USER_ID: 'user_owner',
    MASTERMIND_MEMORY_HOUSEHOLD_ID: 'fixture', MASTERMIND_MEMORY_OPERATOR_PLAYER_ID: actor, NEON_MEMORY_URL: 'fixture-unused' } },
    require: name => { assert.ok(name in imports); return imports[name]; } });
  await assert.rejects(module.exports.contributionsForAuthenticatedOwner('user_foreign'), { code: 'OWNER_REQUIRED' });
  assert.equal(calls.length, 0);
  const store = await module.exports.contributionsForAuthenticatedOwner('user_owner');
  const ref = { taskId: '4196249c-dcbd-41cc-9e6f-8b87b7b2cdda', project: 'mastermind' };
  await store.list(ref);
  for (let i = 0; i < calls.length; i++) if (calls[i][0] === 'query') {
    assert.equal(calls[i - 1][0], 'bind'); assert.deepEqual(calls[i][1].slice(0, 4), [ref.taskId, ref.project, 'fixture', actor]);
  }
  const count = calls.filter(call => call[0] === 'query').length;
  bound = false;
  await assert.rejects(store.list(ref), { code: 'OWNER_BINDING_REQUIRED' });
  assert.equal(calls.filter(call => call[0] === 'query').length, count);
});
