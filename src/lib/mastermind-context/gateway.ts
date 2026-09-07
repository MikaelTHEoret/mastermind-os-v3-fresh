import 'server-only';
import { NeonMemoryStore } from '../../../services/mastermind-context-gateway/src/neon-store.mjs';
import { canonicalHostedConfiguration, createHostedGateway } from '../../../services/mastermind-context-gateway/src/hosted-adapter.mjs';

// The authenticated Clerk subject is resolved through the existing canonical
// player binding. Tool arguments, email addresses and host hints cannot select an operator.
export async function gatewayForAuthenticatedOwner(subject: string) {
  const configuration = canonicalHostedConfiguration(process.env);
  const store = new NeonMemoryStore(process.env.NEON_MEMORY_URL);
  return createHostedGateway({ store, authenticatedSubject: subject, configuration, embed: undefined });
}
