import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  MINECRAFT_CONTROL_AGENT_ROLE,
  SERVICE_RESTART_CONFIRMATION,
  ServiceControlContractError,
  parseRestartReceipt,
  parseServiceInventory,
  parseServiceLogs,
} from '../../src/components/service-control-contract.mjs';

const NOW = '2026-08-15T04:05:06.000Z';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';

function service(role, port, overrides = {}) {
  return {
    role,
    state: 'running',
    generation: 4,
    port,
    lastExit: null,
    ...overrides,
  };
}

function inventory() {
  return {
    ok: true,
    supervisor: { mode: 'development', startedAt: NOW },
    services: [
      service('next-web', 3000),
      service('supervisor', null),
      service(MINECRAFT_CONTROL_AGENT_ROLE, 43100, {
        state: 'failed',
        lastExit: { at: NOW, kind: 'unexpected', code: 1, signal: null },
      }),
      service('mastermind-node-link', null, { state: 'failed' }),
    ],
  };
}

test('strict service inventory parser accepts and orders the four fixed public roles', () => {
  const parsed = parseServiceInventory(inventory());
  assert.deepEqual(parsed.services.map((entry) => entry.role), [
    'supervisor',
    MINECRAFT_CONTROL_AGENT_ROLE,
    'next-web',
    'mastermind-node-link',
  ]);
  assert.equal(parsed.services[1].state, 'failed');
  assert.deepEqual(parsed.services[1].lastExit, {
    at: NOW, kind: 'unexpected', code: 1, signal: null,
  });
});

test('service inventory rejects extra fields, missing or duplicate roles, and changed fixed ports', () => {
  const extra = inventory();
  extra.debug = true;
  assert.throws(() => parseServiceInventory(extra), ServiceControlContractError);

  const duplicate = inventory();
  duplicate.services[2] = service('next-web', 3000);
  assert.throws(() => parseServiceInventory(duplicate), /each fixed role exactly once/);

  const wrongPort = inventory();
  wrongPort.services[0].port = 3001;
  assert.throws(() => parseServiceInventory(wrongPort), /identity or state/);

  const zeroGeneration = inventory();
  zeroGeneration.services[0].generation = 0;
  assert.throws(() => parseServiceInventory(zeroGeneration), /identity or state/);

  const malformedExit = inventory();
  malformedExit.services[2].lastExit.signal = 'sigterm';
  assert.throws(() => parseServiceInventory(malformedExit), /last exit/);
});

test('strict log parser accepts at most 200 increasing bounded agent entries', () => {
  const parsed = parseServiceLogs({
    ok: true,
    role: MINECRAFT_CONTROL_AGENT_ROLE,
    entries: [
      { sequence: 8, at: NOW, role: MINECRAFT_CONTROL_AGENT_ROLE, stream: 'stderr', line: 'x'.repeat(2_048) },
      { sequence: 9, at: NOW, role: MINECRAFT_CONTROL_AGENT_ROLE, stream: 'system', line: 'restart requested' },
    ],
  });
  assert.equal(parsed.entries.length, 2);
  assert.equal(new TextEncoder().encode(parsed.entries[0].line).byteLength, 2_048);

  const tooMany = Array.from({ length: 201 }, (_, sequence) => ({
    sequence, at: NOW, role: MINECRAFT_CONTROL_AGENT_ROLE, stream: 'stdout', line: '',
  }));
  assert.throws(() => parseServiceLogs({ ok: true, role: MINECRAFT_CONTROL_AGENT_ROLE, entries: tooMany }), /logs are invalid/);
  assert.throws(() => parseServiceLogs({
    ok: true,
    role: MINECRAFT_CONTROL_AGENT_ROLE,
    entries: [
      { sequence: 1, at: NOW, role: MINECRAFT_CONTROL_AGENT_ROLE, stream: 'stdout', line: 'one' },
      { sequence: 1, at: NOW, role: MINECRAFT_CONTROL_AGENT_ROLE, stream: 'stderr', line: 'two' },
    ],
  }), /increase in sequence/);
  assert.throws(() => parseServiceLogs({
    ok: true,
    role: MINECRAFT_CONTROL_AGENT_ROLE,
    entries: [{ sequence: 1, at: NOW, role: 'supervisor', stream: 'system', line: 'wrong role' }],
  }), /match the requested role/);
  assert.throws(() => parseServiceLogs({
    ok: true,
    role: MINECRAFT_CONTROL_AGENT_ROLE,
    entries: [
      { sequence: 2, at: NOW, role: MINECRAFT_CONTROL_AGENT_ROLE, stream: 'stdout', line: 'two' },
      { sequence: 1, at: NOW, role: MINECRAFT_CONTROL_AGENT_ROLE, stream: 'stdout', line: 'one' },
    ],
  }), /increase in sequence/);
  assert.throws(() => parseServiceLogs({
    ok: true,
    role: MINECRAFT_CONTROL_AGENT_ROLE,
    entries: [{ sequence: 1, at: NOW, role: MINECRAFT_CONTROL_AGENT_ROLE, stream: 'stdout', line: 'x'.repeat(2_049) }],
  }), /log entry is invalid/);
  assert.throws(() => parseServiceLogs({
    ok: true,
    role: MINECRAFT_CONTROL_AGENT_ROLE,
    entries: [{ sequence: 0, at: NOW, role: MINECRAFT_CONTROL_AGENT_ROLE, stream: 'system', line: 'zero is not public' }],
  }), /log entry is invalid/);
});

test('restart receipt is bound to the client UUID and exact accepted operation shape', () => {
  assert.equal(SERVICE_RESTART_CONFIRMATION, 'RESTART MINECRAFT CONTROL AGENT');
  const receipt = parseRestartReceipt({
    ok: true,
    accepted: true,
    requestId: REQUEST_ID,
    generation: 5,
    operation: { state: 'accepted' },
  }, REQUEST_ID);
  assert.equal(receipt.generation, 5);

  assert.throws(() => parseRestartReceipt({ ...receipt, requestId: '123e4567-e89b-42d3-a456-426614174001' }, REQUEST_ID), /receipt is invalid/);
  assert.throws(() => parseRestartReceipt({ ...receipt, operation: { state: 'accepted', detail: 'extra' } }, REQUEST_ID), /unsupported or missing field/);
});

test('services UI keeps infrastructure roles read-only and uses pointer-hold agent restart', async () => {
  const [component, page] = await Promise.all([
    fs.readFile(new URL('../../src/components/ServiceControlConsole.tsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/app/page.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(component, /<HoldToConfirmButton[\s\S]*HOLD TO RESTART AGENT/);
  assert.match(component, /expectedGeneration,[\s\S]*confirmation: SERVICE_RESTART_CONFIRMATION/);
  assert.match(component, /window\.setTimeout\([\s\S]*POLL_DELAY_MS/);
  assert.match(component, /const MAX_LOG_BYTES = 128 \* 1024/);
  assert.match(component, /READ ONLY · NO RESTART CONTROL/);
  assert.match(component, /MASTERMIND NODE LINK/);
  assert.doesNotMatch(component, /\bpin\b/i);
  assert.match(page, /import ServiceControlConsole from '@\/components\/ServiceControlConsole'/);
  assert.match(page, /setTab\('services'\)[\s\S]*SERVICES/);
  assert.match(page, /tab==='services' \? <ServiceControlConsole\/>/);
});
