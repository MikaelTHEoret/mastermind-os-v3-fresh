'use client';

import Link from 'next/link';
import { UserButton, useUser } from '@clerk/nextjs';

function ConfiguredAccountAccess() {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return <span role="status">Checking sign-in…</span>;
  if (isSignedIn) return <UserButton />;
  return <Link href="/sign-in" style={{ color: '#00ffff', textDecoration: 'underline' }}>Sign in</Link>;
}

export default function AccountAccess() {
  // Keep local deployments without Clerk usable; hooks require the provider.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <span title="Account sign-in has not been configured on this deployment.">Sign-in unavailable</span>;
  }
  return <ConfiguredAccountAccess />;
}
