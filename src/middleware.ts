// src/middleware.ts — SCOPED to /api/trading/* and /api/keys (see matcher). The public
// site's other routes never pass through here. Two modes:
//   unconfigured (no Clerk keys / no owner id): trading routes hard-403 (fail closed);
//     /api/keys passes through so LOCAL dev (trusted machine) can still manage credentials.
//   configured: clerkMiddleware provides the session context that requireOwner() reads.
// Route handlers still enforce requireOwner()/gate() themselves — this is the outer layer.
import { NextResponse, type NextRequest } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';

const configured = !!(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.CLERK_SECRET_KEY &&
  process.env.OWNER_CLERK_USER_ID
);

// Unconfigured: only trading is locked; /api/keys falls through to its own gate() (open locally).
const deny = (req: NextRequest) =>
  req.nextUrl.pathname.startsWith('/api/trading')
    ? NextResponse.json({ ok: false, error: 'owner gate not configured' }, { status: 403 })
    : NextResponse.next();

export default configured ? clerkMiddleware() : deny;

export const config = {
  matcher: ['/api/trading/:path*', '/api/keys', '/api/keys/:path*'],
};
