import path from 'node:path';

import { neon } from '@neondatabase/serverless';
import nextEnv from '@next/env';

import {
  commitMastermindIdentityCommand,
  prepareMastermindIdentityCommand,
} from '../src/lib/memory/identity.ts';
import { readFamilyIdentityBootstrapPlanFile } from './lib/family-identity-bootstrap.mjs';

const { loadEnvConfig } = nextEnv;

async function main() {
  const planFile = path.resolve(process.argv[2] ?? 'family-identity-bootstrap.json');
  loadEnvConfig(process.cwd(), true);
  const url = process.env.NEON_MEMORY_URL;
  if (typeof url !== 'string' || url.length === 0) {
    throw Object.assign(new Error('The memory database is not configured.'), {
      code: 'MEMORY_DB_NOT_CONFIGURED',
    });
  }

  const plan = await readFamilyIdentityBootstrapPlanFile(planFile);
  const sql = neon(url);
  for (const record of plan.commands) {
    const prepared = prepareMastermindIdentityCommand(record.body);
    const result = await commitMastermindIdentityCommand(sql, prepared);
    if (!['applied', 'duplicate'].includes(result.status) || result.commandId !== record.commandId) {
      throw Object.assign(new Error('The identity bootstrap receipt was invalid.'), {
        code: 'IDENTITY_BOOTSTRAP_RECEIPT_INVALID',
      });
    }
    console.log(`[identity:bootstrap] ${prepared.command.action}: ${result.status}`);
  }

  const rows = await sql`
    SELECT
      EXISTS (
        SELECT 1
        FROM public.mastermind_players_v1
        WHERE household_id = ${plan.householdId}
          AND player_id = ${plan.parentPlayerId}::uuid
          AND role = 'parent'
          AND archived_at IS NULL
      ) AS parent,
      EXISTS (
        SELECT 1
        FROM public.mastermind_players_v1
        WHERE household_id = ${plan.householdId}
          AND player_id = ${plan.servicePlayerId}::uuid
          AND role = 'service'
          AND archived_at IS NULL
      ) AS service,
      (
        SELECT count(*)::int
        FROM public.mastermind_player_consents_v1
        WHERE household_id = ${plan.householdId}
          AND player_id = ${plan.servicePlayerId}::uuid
          AND purpose IN ('capture', 'session_summary')
          AND decision = 'allow'
      ) AS consents
  `;
  const ready = rows[0]?.parent === true && rows[0]?.service === true && rows[0]?.consents === 2;
  console.log(`[identity:bootstrap] family ready: ${ready}`);
  if (!ready) process.exitCode = 2;
}

main().catch((error) => {
  const code = typeof error?.code === 'string' ? error.code : 'IDENTITY_BOOTSTRAP_FAILED';
  console.error(`[identity:bootstrap] failed: ${code}`);
  process.exitCode = 1;
});
