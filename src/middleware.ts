// Public pages and OAuth discovery stay public. APIs are private by default.
// Exact machine routes retain their own credential checks in their handlers.
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';
import { apiOwnerConfigured, inspectApiBoundary, authorizeApiBoundary, apiBoundaryDenial } from './lib/auth/api-boundary.mjs';

const configured = apiOwnerConfigured(process.env);
const withOwnerContext = clerkMiddleware(async (auth, request) => {
  const admission = await authorizeApiBoundary(request, process.env, async () => (await auth()).userId);
  return admission.kind === 'denied' ? apiBoundaryDenial(admission) : NextResponse.next();
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const admission = inspectApiBoundary(request, process.env);
  if (admission.kind === 'denied') return apiBoundaryDenial(admission);
  if (admission.kind === 'node-protocol' || admission.kind === 'local-capture-protocol') return NextResponse.next();
  // Local owner-gated handlers still need Clerk context when configured. MCP
  // selects OAuth token auth in its handler, not a browser session at this layer.
  if (configured) return withOwnerContext(request, event);
  return NextResponse.next();
}

export const config = { matcher: ['/api/:path*'] };
