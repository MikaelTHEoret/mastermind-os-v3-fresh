import 'server-only';
import { NeonMemoryStore } from '../../../services/mastermind-context-gateway/src/neon-store.mjs';
import { canonicalHostedConfiguration, createHostedGateway } from '../../../services/mastermind-context-gateway/src/hosted-adapter.mjs';
import { ContributionStore } from '@/lib/delegation/store.mjs';
import { ContextGatewayError } from '../../../services/mastermind-context-gateway/src/validation.mjs';

// The authenticated Clerk subject is resolved through the existing canonical
// player binding. Tool arguments, email addresses and host hints cannot select an operator.
export async function gatewayForAuthenticatedOwner(subject: string) {
  const configuration = canonicalHostedConfiguration(process.env);
  const store = new NeonMemoryStore(process.env.NEON_MEMORY_URL);
  return createHostedGateway({ store, authenticatedSubject: subject, configuration, embed: undefined });
}

export async function contributionsForAuthenticatedOwner(subject: string) {
  const configuration = canonicalHostedConfiguration(process.env);
  if (subject !== configuration.ownerSubject) throw new ContextGatewayError('OWNER_REQUIRED', 'The configured owner is required.', 403);
  const store = new NeonMemoryStore(process.env.NEON_MEMORY_URL);
  const identity = await store.resolveClerkOperator(subject, configuration.identity);
  // Recheck the current external binding for each statement, including retry/readback.
  return new ContributionStore(async (query: string, params: unknown[]) => {
    await store.resolveClerkOperator(subject, configuration.identity);
    return store.sql.query(query, params);
  }, { ...identity, clerkSubject: subject });
}
