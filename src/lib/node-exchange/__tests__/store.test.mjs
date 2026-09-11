import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

import * as native from '../../../../protocol/mastermind-node-exchange/native-task.mjs';
import * as contract from '../../../../protocol/mastermind-node-exchange/contract.mjs';

const source = fs.readFileSync(new URL('../store.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'store.ts',
}).outputText;

function loadStore() {
  const commonJsModule = { exports: {} };
  const sandbox = {
    Buffer,
    Date,
    Error,
    JSON,
    Object,
    Set,
    URL,
    exports: commonJsModule.exports,
    module: commonJsModule,
    process: { env: {} },
    require(identifier) {
      if (identifier === 'server-only') return {};
      if (identifier === 'node:crypto') return awaitlessCrypto;
      if (identifier === '@/lib/db') return { getMemoryDb() { throw new Error('not called'); } };
      if (identifier === '@/lib/memory/local-family-profile.mjs') {
        return { LOCAL_FAMILY_OPERATOR_PROFILE: { householdId: 'family-local', parentPlayerId: PARENT_ID } };
      }
      if (identifier === '../../../protocol/mastermind-node-exchange/contract.mjs') return contract;
      if (identifier === '../../../protocol/mastermind-node-exchange/native-task.mjs') return native;
      throw new Error(`Unexpected test import: ${identifier}`);
    },
    structuredClone,
  };
  vm.runInNewContext(compiled, sandbox, { filename: 'store.cjs' });
  return commonJsModule.exports;
}

import crypto from 'node:crypto';
const awaitlessCrypto = crypto;

const PARENT_ID = 'ba0e9c2a-2f83-4833-8047-2ef3371f4fbd';
const NODE_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const ACTIVE_JOB_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_ID = '44444444-4444-4444-8444-444444444444';
const EXCHANGE_ID = '55555555-5555-4555-8555-555555555555';
const BOOT_ID = '66666666-6666-4666-8666-666666666666';
const OLD_BOOT_ID = '77777777-7777-4777-8777-777777777777';
const RECEIPT_ID = '88888888-8888-4888-8888-888888888888';

test('typed core enqueue retains queued/offline timestamps and reports its actual capability', async () => {
  const store = loadStore();
  const sql = scriptedSql([
    (query, values) => {
      assert.match(query, /enqueue_mastermind_core_status_job_v2/);
      assert.equal(values[0], JOB_ID);
      assert.equal(values[1], contract.digestMastermindNodeCommand({ jobId: JOB_ID, nodeId: NODE_ID,
        capability: 'mastermind.core.status', capabilityVersion: 1, policyClass: 'routine', input: {} }, { core: true }));
      return [{ status: 'duplicate', job_id: JOB_ID }];
    },
    (query) => {
      assert.match(query, /job\.capability/);
      return [{ ...jobRow(JOB_ID), capability: 'mastermind.core.status' }];
    },
  ]);
  const result = await store.enqueueCoreStatusJob(sql, NODE_ID, JOB_ID, store.OWNER_NODE_PROFILE,
    new Date('2026-08-15T12:00:00.000Z'));
  assert.equal(result.status, 'duplicate'); assert.equal(result.job.capability, 'mastermind.core.status');
  assert.equal(result.job.state, 'queued'); assert.equal(result.job.lease, null);
  assert.equal(result.job.createdAt, '2026-08-15T12:00:00.000Z');
  assert.equal(result.job.expiresAt, '2026-08-15T12:30:00.000Z');
});

test('v2 uses the negotiated database function; invalid advertisements never query the store', async () => {
  const store = loadStore();
  const worker = { protocolVersion: 2, capabilities: [{ id: 'mastermind.core.status', version: 1 }] };
  const request = { schemaVersion: 2, exchangeId: EXCHANGE_ID, nodeId: NODE_ID, bootId: BOOT_ID,
    sentAt: '2026-08-15T12:00:01.000Z', agentVersion: '0.2.0', worker, receipts: [],
    status: { observedAt: '2026-08-15T12:00:01.000Z', controlAgent: 'unreachable', recovery: 'unknown',
      familyServer: 'unknown', companion: 'unknown', companionBridge: 'unknown', localKillSwitch: null,
      attentionCodes: ['control-agent-unreachable'] } };
  const sql = scriptedSql([(query, values) => {
    assert.match(query, /exchange_mastermind_node_v2/); assert.deepEqual(JSON.parse(values[11]), worker);
    return [{ exchange_id: EXCHANGE_ID, server_time: '2026-08-15T12:00:02.000Z', acknowledged_receipt_ids: [], lease: null }];
  }]);
  const response = await store.exchangeNodeState(sql, `mn1.${NODE_ID}.${'C'.repeat(43)}`, request);
  assert.equal(response.schemaVersion, 2); assert.deepEqual(response.acceptedWorker, worker);
  await assert.rejects(store.exchangeNodeState(sql, `mn1.${NODE_ID}.${'C'.repeat(43)}`,
    { ...request, worker: { ...worker, capabilities: [{ id: 'shell.exec', version: 1 }] } }));
  assert.equal(sql.calls(), 1);
});

function scriptedSql(handlers) {
  let index = 0;
  const sql = async (strings, ...values) => {
    const handler = handlers[index++];
    assert.ok(handler, `unexpected SQL call ${index}`);
    return handler(strings.join('?'), values);
  };
  sql.calls = () => index;
  return sql;
}

function jobRow(jobId = ACTIVE_JOB_ID) {
  return {
    jobId,
    nodeId: NODE_ID,
    capability: 'family-ecosystem.ensure-running', capabilityVersion: 1, policyClass: 'routine',
    state: 'queued',
    createdAt: '2026-08-15T12:00:00.000Z',
    expiresAt: '2026-08-15T12:30:00.000Z',
    leaseId: null,
    leasedAt: null,
    leaseExpiresAt: null,
    terminalCode: null,
    terminalResult: null,
    finishedAt: null,
  };
}

test('pairing claim uses the node-owned ID and credential digest and never returns a secret', async () => {
  const store = loadStore();
  const digest = 'a'.repeat(64);
  const pairingId = '99999999-9999-4999-8999-999999999999';
  const token = `mnp1.${pairingId}.${'B'.repeat(43)}`;
  const sql = scriptedSql([(_query, values) => {
    assert.equal(values[0], pairingId);
    assert.equal(values[2], NODE_ID);
    assert.equal(values[3], digest);
    return [{ node_id: NODE_ID, paired_at: '2026-08-15T12:00:00.000Z' }];
  }]);
  const response = await store.claimNodePairing(sql, token, {
    schemaVersion: 1,
    pairingId,
    node: { nodeId: NODE_ID, credentialSha256: digest, displayName: 'Family Node', agentVersion: '1.0.0' },
  });
  assert.deepEqual(Object.keys(response).sort(), ['nextPollAfterMs', 'nodeId', 'pairedAt', 'schemaVersion']);
  assert.equal(response.nodeId, NODE_ID);
  assert.equal(sql.calls(), 1);
});

test('enqueue exposes coalescing instead of creating a duplicate active start job', async () => {
  const store = loadStore();
  const sql = scriptedSql([
    (query, values) => {
      assert.match(query, /enqueue_mastermind_node_job_v1/);
      assert.equal(values[0], JOB_ID);
      assert.equal(values[2], NODE_ID);
      return [{ status: 'coalesced', job_id: ACTIVE_JOB_ID }];
    },
    (query, values) => {
      assert.match(query, /mastermind_node_jobs_v1/);
      assert.equal(values[0], ACTIVE_JOB_ID);
      return [jobRow()];
    },
  ]);
  const result = await store.enqueueEnsureRunningJob(
    sql,
    NODE_ID,
    JOB_ID,
    store.OWNER_NODE_PROFILE,
    new Date('2026-08-15T12:00:00.000Z'),
  );
  assert.equal(result.status, 'coalesced');
  assert.equal(result.job.jobId, ACTIVE_JOB_ID);
  assert.equal(sql.calls(), 2);
});

test('exchange accepts a durable receipt from an earlier boot and binds acknowledgements', async () => {
  const store = loadStore();
  const nodeCredential = `mn1.${NODE_ID}.${'C'.repeat(43)}`;
  const commandDigest = contract.digestMastermindNodeCommand({
    jobId: JOB_ID,
    nodeId: NODE_ID,
    capability: contract.MASTERMIND_NODE_CAPABILITY,
    capabilityVersion: 1,
    policyClass: 'routine',
    input: {},
  });
  const receipt = {
    receiptId: RECEIPT_ID,
    jobId: JOB_ID,
    leaseId: LEASE_ID,
    bootId: OLD_BOOT_ID,
    commandDigest,
    sequence: 1,
    state: 'accepted',
    stage: 'journaled',
    observedAt: '2026-08-15T12:00:00.000Z',
    code: 'accepted',
    retryable: false,
    result: null,
  };
  const request = {
    schemaVersion: 1,
    exchangeId: EXCHANGE_ID,
    nodeId: NODE_ID,
    bootId: BOOT_ID,
    sentAt: '2026-08-15T12:00:01.000Z',
    agentVersion: '1.0.0',
    status: {
      observedAt: '2026-08-15T12:00:01.000Z',
      controlAgent: 'online',
      recovery: 'clear',
      familyServer: 'stopped',
      companion: 'stopped',
      companionBridge: 'disconnected',
      localKillSwitch: false,
      attentionCodes: [],
    },
    receipts: [receipt],
  };
  const sql = scriptedSql([(_query, values) => {
    assert.equal(values[2], NODE_ID);
    assert.equal(values[3], contract.digestMastermindNodeCredential(nodeCredential));
    assert.equal(JSON.parse(values[8])[0].bootId, OLD_BOOT_ID);
    return [{
      exchange_id: EXCHANGE_ID,
      server_time: '2026-08-15T12:00:02.000Z',
      acknowledged_receipt_ids: [RECEIPT_ID],
      lease: null,
    }];
  }]);
  const response = await store.exchangeNodeState(sql, nodeCredential, request);
  assert.deepEqual(response.acknowledgedReceiptIds, [RECEIPT_ID]);
});

test('owner job reader retains typed core observations and rejects invalid or cross-lane stored results', async () => {
  const store = loadStore();
  const snapshot = { kind: 'mastermind.core.status', observedAt: '2026-08-15T12:01:00.000Z',
    services: { mcpHost: 'online', memory: 'online', modules: 'online' },
    capabilities: { count: 0, sha256: 'a'.repeat(64) }, activeTurns: 0, complete: true };
  const row = { ...jobRow(JOB_ID), capability: 'mastermind.core.status', state: 'succeeded',
    leaseId: LEASE_ID, leasedAt: '2026-08-15T12:00:50.000Z', leaseExpiresAt: '2026-08-15T12:01:20.000Z',
    terminalCode: 'desired-state-reached', terminalResult: snapshot, finishedAt: snapshot.observedAt };
  const sql = scriptedSql([(query, values) => {
    assert.match(query, /mastermind_active_parent_profile_v1/); assert.deepEqual(values.slice(0,2), [JOB_ID,NODE_ID]);
    return [row];
  }]);
  const result = await store.getOwnerJob(sql, NODE_ID, JOB_ID);
  assert.deepEqual(result.terminal.result, snapshot);
  for (const change of [
    { terminalResult: { ...snapshot, complete: false } },
    { state: 'failed', terminalResult: { familyServer: 'running', companion: 'running', companionBridge: 'ready' } },
  ]) await assert.rejects(store.getOwnerJob(scriptedSql([() => [{ ...row, ...change }]]), NODE_ID, JOB_ID), { code: 'NODE_STORE_INVALID' });
});


test('inventory exposes only the stored negotiated advertisement and stays readable before migration021', async () => {
  const store = loadStore(); const worker = { protocolVersion: 2, capabilities: [{ id: 'mastermind.core.status', version: 1 }] };
  const row = { nodeId: NODE_ID, displayName: 'Fixture', state: 'active', agentVersion: '0.1.0',
    pairedAt: '2026-08-15T12:00:00.000Z', lastExchangeAt: '2026-08-15T12:00:00.000Z', lastJobReceiptAt: null, status: null };
  for (const [stored, expected] of [[undefined, null], [{ protocolVersion: 1, capabilities: [{ id: 'family-ecosystem.ensure-running', version: 1 }] }, null], [worker, worker]]) {
    const nodes = await store.listOwnerNodes(scriptedSql([(query) => {
      assert.match(query, /to_jsonb\(node\) -> 'last_worker' AS worker/);
      assert.match(query, /mastermind_active_parent_profile_v1/); return [{ ...row, worker: stored }];
    }]), store.OWNER_NODE_PROFILE, new Date('2026-08-15T12:00:02.000Z'));
    assert.deepEqual(nodes[0].worker, expected);
  }
});

test('latest core status is an owner-scoped bounded read of the canonical ledger', async () => {
  const store = loadStore();
  const sql = scriptedSql([(query, values) => {
    assert.match(query, /FROM public.mastermind_node_jobs_v1/);
    assert.match(query, /job\.household_id = \?/);
    assert.match(query, /mastermind_active_parent_profile_v1/);
    assert.match(query, /job\.capability = 'mastermind.core.status' AND job\.capability_version = 1/);
    assert.match(query, /ORDER BY job\.created_at DESC, job\.job_id DESC\s+LIMIT 1/);
    assert.doesNotMatch(query, /INSERT|UPDATE|DELETE|SELECT\s+\*/i);
    assert.deepEqual(values, [NODE_ID, 'family-local', 'family-local', PARENT_ID]);
    return [{ ...jobRow(JOB_ID), capability: 'mastermind.core.status' }];
  }]);
  assert.equal((await store.getLatestOwnerCoreStatusJob(sql, NODE_ID)).jobId, JOB_ID);
  assert.equal(sql.calls(), 1);
  assert.equal(await store.getLatestOwnerCoreStatusJob(scriptedSql([() => []]), NODE_ID), null);
});

test('latest core status rejects invalid identity, excess rows, other capabilities and malformed state', async () => {
  const store = loadStore(); const unused = scriptedSql([]);
  await assert.rejects(store.getLatestOwnerCoreStatusJob(unused, 'invalid'), { code: 'NODE_REQUEST_INVALID' });
  assert.equal(unused.calls(), 0);
  const row = { ...jobRow(JOB_ID), capability: 'mastermind.core.status' };
  for (const rows of [[row,row], [jobRow()], [{ ...row, nodeId: JOB_ID }], [{ ...row, state: 'succeeded' }]]) {
    await assert.rejects(store.getLatestOwnerCoreStatusJob(scriptedSql([() => rows]), NODE_ID));
  }
});

const nativeInput = () => ({schemaVersion:1,action:'execute',taskRef:{taskId:ACTIVE_JOB_ID,project:'mastermind'},
  specificationId:'a'.repeat(64),operationId:JOB_ID,capability:'release-inventory.diff',candidateId:'b'.repeat(64),
  requirementsHash:'c'.repeat(64),inputSha256:'d'.repeat(64),arguments:{before:[],after:[]}});

test('native owner enqueue binds exact command; duplicate recovery reads with current task authority', async () => {
  const store=loadStore(), input=nativeInput();
  const sql=scriptedSql([(query,values)=>{
    assert.match(query,/enqueue_mastermind_native_task_job_v1/);
    assert.equal(values[0],JOB_ID);assert.deepEqual(JSON.parse(values[6]),input);
    assert.equal(values[1],contract.digestMastermindNodeCommand({jobId:JOB_ID,nodeId:NODE_ID,capability:native.NATIVE_REUSE_CAPABILITY,
      capabilityVersion:1,policyClass:'routine',input},{core:true}));
    return [{status:'duplicate',job_id:JOB_ID}];
  },query=>{
    assert.match(query,/mastermind_native_task_authorized_v1/);assert.match(query,/job.created_by_player_id/);
    return [{...jobRow(JOB_ID),capability:native.NATIVE_REUSE_CAPABILITY,commandInput:input}];
  }]);
  const result=await store.enqueueOwnerNativeTaskJob(sql,NODE_ID,input);
  assert.equal(result.status,'duplicate');assert.equal(result.job.jobId,JOB_ID);assert.equal(sql.calls(),2);
});

test('malformed native input never queries and busy/conflict never returns another operation',async()=>{
  const store=loadStore();let calls=0;const noSql=async()=>{calls++;};
  for(const change of [{grantRef:'caller'},{action:'generate'},{operationId:'not-uuid'}])
    await assert.rejects(store.enqueueOwnerNativeTaskJob(noSql,NODE_ID,{...nativeInput(),...change}),{code:'NODE_REQUEST_INVALID'});
  assert.equal(calls,0);
  for(const status of ['busy','conflict']) {
    const sql=scriptedSql([()=>[{status,job_id:ACTIVE_JOB_ID}]]);
    await assert.rejects(store.enqueueOwnerNativeTaskJob(sql,NODE_ID,nativeInput()),{code:status==='busy'?'NODE_NATIVE_BUSY':'NODE_JOB_CONFLICT'});
    assert.equal(sql.calls(),1);
  }
});

test('native read rejects result from a different task even when the node job ID matches',async()=>{
  const store=loadStore(),input=nativeInput();
  const result={kind:native.NATIVE_REUSE_CAPABILITY,operationId:JOB_ID,specificationId:input.specificationId,
    taskRef:{...input.taskRef,taskId:BOOT_ID},candidateId:input.candidateId,capability:input.capability,inputSha256:input.inputSha256,
    resultSha256:'f'.repeat(64),result:{added:[]},replayed:false};
  const sql=scriptedSql([()=>[{...jobRow(JOB_ID),capability:native.NATIVE_REUSE_CAPABILITY,commandInput:input,state:'succeeded',
    terminalCode:'desired-state-reached',terminalResult:result,finishedAt:'2026-08-15T12:01:00.000Z'}]]);
  await assert.rejects(store.getOwnerJob(sql,NODE_ID,JOB_ID),{code:'NODE_STORE_INVALID'});
});
