'use client'

import { StackProvider } from '@stackframe/stack'
import { stackServerApp, isStackAuthEnabled } from '@/stack'

export default function StackAuthProvider({ children }: { children: React.ReactNode }) {
  // If Stack Auth is not configured, just return children without provider
  if (!isStackAuthEnabled || !stackServerApp) {
    return <>{children}</>
  }

  return (
    <StackProvider app={stackServerApp}>
      {children}
    </StackProvider>
  )
}