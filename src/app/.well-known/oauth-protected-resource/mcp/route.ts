// Existing PR #2 OAuth discovery; actual subject/operator binding is enforced by the gateway.
import { protectedResourceHandlerClerk, metadataCorsOptionsRequestHandler } from '@clerk/mcp-tools/next';
const handler = protectedResourceHandlerClerk({
  scopes_supported: ['openid', 'profile', 'email'], resource_name: 'Mastermind Embodiment Gateway',
});
const corsHandler = metadataCorsOptionsRequestHandler();
export { handler as GET, corsHandler as OPTIONS };
