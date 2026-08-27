import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const script = path.resolve('scripts/memory-operator-pin.mjs');

test('operator PIN generator emits a copy-safe dotenv verifier without logging it from the test', async () => {
  const { stdout, stderr } = await execute(process.execPath, [script], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    maxBuffer: 4096,
    windowsHide: true,
  });
  assert.equal(stderr, '');
  const lines = stdout.trimEnd().split(/\r?\n/);
  assert.equal(lines.length, 5);
  assert.match(lines[1], /^\d{8}$/);
  assert.match(
    lines[4],
    /^MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT=v1\\\$[A-Za-z0-9_-]{22}\\\$[A-Za-z0-9_-]{43}$/,
  );
});
