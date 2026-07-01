// src/lib/trading/auth.ts — single-owner server gate for the trading module.
// FAIL-CLOSED: unless Clerk is fully configured (both keys + OWNER_CLERK_USER_ID)
// AND the request's session belongs to the owner, every check denies.
// On a public site, hiding UI is not security — every /api/trading/* route calls this.

export type OwnerCheck = { ok: true; userId: string } | { ok: false; status: number; reason: string };

export function ownerGateConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY &&
    process.env.OWNER_CLERK_USER_ID
  );
}

export async function requireOwner(): Promise<OwnerCheck> {
  if (!ownerGateConfigured()) {
    return { ok: false, status: 403, reason: 'owner gate not configured' };
  }
  try {
    // Imported lazily so an unconfigured deployment never touches Clerk at all.
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    if (!userId) return { ok: false, status: 401, reason: 'not signed in' };
    if (userId !== process.env.OWNER_CLERK_USER_ID) {
      return { ok: false, status: 403, reason: 'not the owner' };
    }
    return { ok: true, userId };
  } catch {
    // Any auth-layer failure denies — never fail open.
    return { ok: false, status: 403, reason: 'auth unavailable' };
  }
}
