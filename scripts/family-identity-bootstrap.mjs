import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFamilyIdentityBootstrapPlanFile } from './lib/family-identity-bootstrap.mjs';

function parseOutputPath(args) {
  if (args.length !== 2 || args[0] !== '--out' || args[1].startsWith('--')) {
    throw new Error('Usage: npm run memory:identity:plan -- --out <new-plan-file>');
  }
  return path.resolve(args[1]);
}

export async function main(args = process.argv.slice(2)) {
  const output = parseOutputPath(args);
  const plan = await createFamilyIdentityBootstrapPlanFile(output);
  console.log(`Created a non-mutating family identity bootstrap plan at ${output}`);
  console.log(`Service player UUID reserved by this plan: ${plan.servicePlayerId}`);
  console.log('Inspect the plan, apply migrations 001 and 002, then use the supervisor bootstrap command documented in .env.local.example.');
  return plan;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
