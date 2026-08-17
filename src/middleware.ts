// src/middleware.ts — owner session envelope for sensitive web routes.
// Remote MCP accepts Clerk OAuth or a timing-safe recovery token inside /api/mcp.
// Clerk middleware must still see the MCP route so auth({ acceptsToken: 'oauth_token' })
// can verify OAuth access tokens; metadata routes remain public and outside this matcher.
import { NextResponse, type NextRequest } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';

const configured = !!(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.CLERK_SECRET_KEY &&
  process.env.OWNER_CLERK_USER_ID
);

const deny = (req: NextRequest) =>
  req.nextUrl.pathname.startsWith('/api/trading') || req.nextUrl.pathname.startsWith('/api/embodiment')
    ? NextResponse.json({ ok: false, error: 'owner gate not configured' }, { status: 403 })
    : NextResponse.next();

export default configured ? clerkMiddleware() : deny;

export const config = {
  matcher: ['/api/trading/:path*', '/api/keys', '/api/keys/:path*', '/api/embodiment/:path*', '/api/chat/:path*', '/api/mcp/:path*'],
};
