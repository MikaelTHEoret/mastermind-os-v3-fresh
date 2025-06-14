'use client'

import { StackProvider } from '@stackframe/stack'
import { isStackAuthEnabled } from '@/stack'

export default function StackAuthProvider({ children }: { children: React.ReactNode }) {
  // If Stack Auth is not configured, just render children without provider
  if (!isStackAuthEnabled) {
    return <>{children}</>
  }

  return (
    <StackProvider
      appId={process.env.NEXT_PUBLIC_STACK_PROJECT_ID!}
      publishableClientKey={process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY!}
      appUrl={process.env.NEXT_PUBLIC_APP_URL || 'https://mastermind-os-v3-fresh.vercel.app'}
      tokenStore="nextjs-cookie"
    >
      {children}
    </StackProvider>
  )
}