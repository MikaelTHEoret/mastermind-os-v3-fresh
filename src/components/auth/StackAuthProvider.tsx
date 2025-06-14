'use client'

import { StackProvider, StackTheme } from '@stackframe/stack'
import { stackServerApp, isStackAuthEnabled } from '@/stack'

export default function StackAuthProvider({ children }: { children: React.ReactNode }) {
  // If Stack Auth is not configured, just render children without provider
  if (!isStackAuthEnabled) {
    return <>{children}</>
  }

  return (
    <StackProvider app={stackServerApp}>
      <StackTheme>
        {children}
      </StackTheme>
    </StackProvider>
  )
}