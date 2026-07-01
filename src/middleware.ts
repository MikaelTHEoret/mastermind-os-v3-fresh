// src/middleware.ts — SCOPED to /api/trading/* only (see matcher). The public site
// never passes through here. Two modes:
//   unconfigured (no Clerk keys / no owner id) → hard 403 for all trading routes (fail closed)
//   configured → clerkMiddleware provides the session context that requireOwner() reads
// Route handlers still call requireOwner() themselves — this is the outer layer, not the only one.
import { NextResponse } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';

const configured = !!(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.CLERK_SECRET_KEY &&
  process.env.OWNER_CLERK_USER_ID
);

const deny = () =>
  NextResponse.json({ ok: false, error: 'owner gate not configured' }, { status: 403 });

export default configured ? clerkMiddleware() : deny;

export const config = {
  matcher: ['/api/trading/:path*'],
};
