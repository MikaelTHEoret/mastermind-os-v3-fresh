// Existing PR #2 compatibility discovery; public metadata contains no memory or credentials.
import { authServerMetadataHandlerClerk, metadataCorsOptionsRequestHandler } from '@clerk/mcp-tools/next';
const handler = authServerMetadataHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();
export { handler as GET, corsHandler as OPTIONS };
