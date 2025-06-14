'use client'

import { StackProvider, StackTheme } from '@stackframe/stack'
import { isStackAuthEnabled } from '@/stack'

export default function StackAuthProvider({ children }: { children: React.ReactNode }) {
  // If Stack Auth is not configured, just render children without provider
  if (!isStackAuthEnabled) {
    return <>{children}</>
  }

  return (
    <StackProvider
      app={{
        tokenStore: "nextjs-cookie",
        projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID!,
        publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY!,
        baseUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://mastermind-os-v3-fresh.vercel.app',
      }}
    >
      <StackTheme>
        {children}
      </StackTheme>
    </StackProvider>
  )
}