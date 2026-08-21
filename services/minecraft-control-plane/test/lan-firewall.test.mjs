import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { GEYSER_BEDROCK_PORT, runLanFirewallAction } from '../src/lan-firewall.mjs';

const trustedScriptPath = path.resolve('scripts', 'configure-family-server-lan.ps1');
const instance = {
  id: 'family-server',
  projectId: 'family-server',
  javaPort: 25565,
  bedrockPort: GEYSER_BEDROCK_PORT,
  directory: 'C:\\private\\must-not-be-forwarded',
};

function respondingSpawn(output, exitCode = 0, capture = () => {}) {
  return (executable, args, options) => {
    capture({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      child.stdout.end(output);
      setImmediate(() => child.emit('close', exitCode));
    });
    return child;
  };
}

test('runs only the fixed PowerShell script shape and derives ports from the instance', async () => {
  let invocation;
  const states = [];
  const result = await runLanFirewallAction(instance, trustedScriptPath, 'Enable', {
    platform: 'win32',
    spawnImpl: respondingSpawn('MASTERMIND_LAN_RESULT:COMPLETED\r\n', 0, (value) => { invocation = value; }),
    onState: (state) => states.push(state),
  });

  assert.equal(invocation.executable.toLowerCase().endsWith('\\powershell.exe'), true);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.deepEqual(invocation.options.stdio, ['ignore', 'pipe', 'ignore']);
  assert.deepEqual(invocation.args.slice(-9), [
    '-File', trustedScriptPath, '-Action', 'Enable', '-JavaPort', '25565', '-BedrockPort', '19132', '-AllowElevation',
  ]);
  assert.equal(invocation.args.includes(instance.id), false);
  assert.equal(invocation.args.includes(instance.directory), false);
  assert.deepEqual(states.map((state) => state.status), ['requested', 'completed']);
  assert.deepEqual(result, {
    action: 'Enable', status: 'completed', javaPort: 25565, bedrockPort: 19132,
  });
});

test('keeps Status read-only by omitting the elevation switch', async () => {
  let invocation;
  const result = await runLanFirewallAction(instance, trustedScriptPath, 'Status', {
    platform: 'win32',
    spawnImpl: respondingSpawn('diagnostic text\nMASTERMIND_LAN_RESULT:COMPLETED\n', 0, (value) => { invocation = value; }),
  });
  assert.equal(invocation.args.includes('-AllowElevation'), false);
  assert.equal(result.status, 'completed');
});

test('reports a declined UAC prompt as cancelled', async () => {
  const result = await runLanFirewallAction(instance, trustedScriptPath, 'Disable', {
    platform: 'win32',
    spawnImpl: respondingSpawn('MASTERMIND_LAN_RESULT:CANCELLED\n'),
  });
  assert.deepEqual(result, {
    action: 'Disable', status: 'cancelled', javaPort: 25565, bedrockPort: 19132,
  });
});

test('reports mutation completion as unknown without killing a possibly elevated action', async () => {
  let killed = false;
  const states = [];
  const guard = setTimeout(() => {}, 250);
  try {
    const result = await runLanFirewallAction(instance, trustedScriptPath, 'Enable', {
      platform: 'win32',
      timeoutMs: 10,
      onState: (state) => states.push(state.status),
      spawnImpl() {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.kill = () => { killed = true; return true; };
        return child;
      },
    });
    assert.deepEqual(result, {
      action: 'Enable', status: 'pending', javaPort: 25565, bedrockPort: 19132, code: 'COMPLETION_UNKNOWN',
    });
    assert.deepEqual(states, ['requested', 'pending']);
    assert.equal(killed, false);
  } finally {
    clearTimeout(guard);
  }
});

test('may terminate a timed-out read-only Status action', async () => {
  let killed = false;
  const guard = setTimeout(() => {}, 250);
  try {
    const result = await runLanFirewallAction(instance, trustedScriptPath, 'Status', {
      platform: 'win32',
      timeoutMs: 10,
      spawnImpl() {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.kill = () => { killed = true; return true; };
        return child;
      },
    });
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'SCRIPT_TIMEOUT');
    assert.equal(killed, true);
  } finally {
    clearTimeout(guard);
  }
});

test('returns fixed errors without leaking executable, script, or stderr paths', async () => {
  const secret = 'C:\\Users\\Someone\\secret\\configure-family-server-lan.ps1';
  const result = await runLanFirewallAction(instance, trustedScriptPath, 'Enable', {
    platform: 'win32',
    spawnImpl() {
      throw new Error(`failed at ${secret}`);
    },
  });
  assert.deepEqual(result, {
    action: 'Enable', status: 'error', javaPort: 25565, bedrockPort: 19132, code: 'LAUNCH_FAILED',
  });
  assert.equal(JSON.stringify(result).includes('Users'), false);
  assert.equal(JSON.stringify(result).includes('powershell'), false);
});

test('rejects untrusted records, ports, paths, and actions before spawning', async () => {
  let spawned = false;
  const options = { platform: 'win32', spawnImpl: () => { spawned = true; } };
  await assert.rejects(
    () => runLanFirewallAction({ ...instance, projectId: '2b2t' }, trustedScriptPath, 'Enable', options),
    /valid managed family-server instance/,
  );
  await assert.rejects(
    () => runLanFirewallAction({ ...instance, javaPort: 0 }, trustedScriptPath, 'Enable', options),
    /valid Java port/,
  );
  await assert.rejects(
    () => runLanFirewallAction({ ...instance, bedrockPort: 19133 }, trustedScriptPath, 'Enable', options),
    /must be 19132/,
  );
  await assert.rejects(
    () => runLanFirewallAction(instance, path.resolve('scripts', 'anything.ps1'), 'Enable', options),
    /script path is invalid/,
  );
  await assert.rejects(
    () => runLanFirewallAction(instance, trustedScriptPath, 'RunCommand', options),
    /must be Enable, Status, or Disable/,
  );
  assert.equal(spawned, false);
});

test('does not attempt a firewall process on non-Windows hosts', async () => {
  let spawned = false;
  const result = await runLanFirewallAction(instance, trustedScriptPath, 'Enable', {
    platform: 'linux',
    spawnImpl: () => { spawned = true; },
  });
  assert.equal(spawned, false);
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'WINDOWS_REQUIRED');
});

test('the trusted script validates a replacement generation before removing the active one', async () => {
  const script = await readFile(trustedScriptPath, 'utf8');
  const createReplacement = script.indexOf('New-LanGeneration $targetGeneration');
  const validateReplacement = script.indexOf('Test-LanGeneration $targetGeneration', createReplacement);
  const cleanupOldGeneration = script.indexOf('foreach ($generation in $ruleGenerations)', validateReplacement);
  assert.notEqual(createReplacement, -1);
  assert.ok(validateReplacement > createReplacement);
  assert.ok(cleanupOldGeneration > validateReplacement);
  assert.match(script, /if \(-not \$targetReady\)[\s\S]*Remove-LanGeneration \$targetGeneration/);
  assert.match(script, /Profile\.ToString\(\) -ne 'Private'/);
  assert.match(script, /RemoteAddress LocalSubnet/);
  assert.match(script, /Test-ExactLanRule \$javaRules\[0\] 'TCP' \$JavaPort/);
});
