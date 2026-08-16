// src/app/.well-known/oauth-protected-resource/mcp/route.ts — Clerk OAuth resource discovery for the remote MCP endpoint.
import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from '@clerk/mcp-tools/next';

const handler = protectedResourceHandlerClerk({
  scopes_supported: ['openid', 'profile', 'email'],
  resource_name: 'Mastermind Embodiment Gateway',
});
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
