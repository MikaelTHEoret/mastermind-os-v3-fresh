import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24 }}>
      <h1 style={{ color: '#00ffff' }}>Sign in to Mastermind</h1>
      <p>Use your Mastermind account to access your connected systems.</p>
      {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
        <SignIn routing="hash" forceRedirectUrl="/#nodes" />
      ) : (
        <p role="status">Account sign-in is not configured on this deployment.</p>
      )}
      <Link href="/">Return to Mastermind</Link>
    </main>
  );
}
