// src/app/.well-known/oauth-authorization-server/route.ts — compatibility discovery for older MCP OAuth clients.
import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from '@clerk/mcp-tools/next';

const handler = authServerMetadataHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
