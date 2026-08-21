import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultDataRoot } from '../services/minecraft-control-plane/src/config.mjs';
import { acquireLocalControlLifetimeLease } from './lib/local-control-lifetime-lease.mjs';
import {
  LEGACY_TRANSACTION_ID,
  adoptLegacyUpdateTerminalEvidence,
  assertLocalControlStopped,
} from './lib/legacy-update-terminal-adoption.mjs';

const dataRoot = defaultDataRoot(process.env);
const managedRoot = path.join(dataRoot, 'projects', 'family-server');
const auditRoot = path.join(dataRoot, 'recovery-audit', `legacy-update-terminal-${LEGACY_TRANSACTION_ID}`);

try {
  const workspace = await fs.realpath(process.cwd());
  const lifetimeLease = await acquireLocalControlLifetimeLease({
    workspace,
    ownerId: crypto.randomBytes(16).toString('hex'),
    contenderStartedAtMs: Date.now(),
    unref: true,
  });
  let leaseLost = null;
  lifetimeLease.onLost((error) => { leaseLost = error; });
  const assertRepairStopped = async () => {
    if (leaseLost) throw Object.assign(new Error('LOCAL_CONTROL_LEASE_LOST'), { cause: leaseLost });
    await assertLocalControlStopped();
    if (leaseLost) throw Object.assign(new Error('LOCAL_CONTROL_LEASE_LOST'), { cause: leaseLost });
  };
  const result = await adoptLegacyUpdateTerminalEvidence({
    managedRoot,
    auditRoot,
    assertStopped: assertRepairStopped,
  });
  console.log(`Legacy terminal update evidence ${result.status}.`);
  console.log('No server, world, save, or backup payload was changed.');
} catch (error) {
  const code = typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)
    ? error.message
    : 'LEGACY_UPDATE_ADOPTION_REFUSED';
  console.error(code);
  process.exitCode = 1;
}
