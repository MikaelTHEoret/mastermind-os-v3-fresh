'use client'

import { StackProvider, StackTheme } from '@stackframe/stack'
import { stackServerApp, isStackAuthEnabled } from '@/stack'
import { useEffect, useState } from 'react'

export default function StackAuthProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])

  // During SSR, always render children without Stack Auth to prevent hydration mismatch
  if (!mounted) {
    return <>{children}</>
  }

  // After mounting, check if Stack Auth is properly configured
  if (!isStackAuthEnabled) {
    return <>{children}</>
  }

  // Only render StackProvider when Stack Auth is confirmed enabled and mounted
  try {
    return (
      <StackProvider app={stackServerApp}>
        <StackTheme>
          {children}
        </StackTheme>
      </StackProvider>
    )
  } catch (error) {
    // If Stack Auth fails to initialize, render children without auth
    console.warn('Stack Auth failed to initialize:', error)
    return <>{children}</>
  }
}