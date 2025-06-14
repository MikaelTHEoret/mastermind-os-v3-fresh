'use client'

import { useEffect, useState } from 'react'
import { isStackAuthEnabled } from '@/stack'

export default function StackAuthProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [stackComponents, setStackComponents] = useState<any>(null)
  const [stackReady, setStackReady] = useState(false)
  
  useEffect(() => {
    setMounted(true)
    
    // Only try to load Stack Auth if it's enabled
    if (isStackAuthEnabled) {
      loadStackAuth()
    }
  }, [])

  const loadStackAuth = async () => {
    try {
      // Dynamic import to prevent build-time inclusion
      const [stackModule, { getStackServerApp }] = await Promise.all([
        import('@stackframe/stack'),
        import('@/stack')
      ])
      
      const stackServerApp = await getStackServerApp()
      
      if (stackServerApp) {
        setStackComponents({
          StackProvider: stackModule.StackProvider,
          StackTheme: stackModule.StackTheme,
          stackServerApp
        })
        setStackReady(true)
      }
    } catch (error) {
      console.log('Stack Auth loading failed (safe mode):', error)
    }
  }

  // During SSR or when not mounted, always render children without Stack Auth
  if (!mounted) {
    return <>{children}</>
  }

  // If Stack Auth is disabled, render children without auth
  if (!isStackAuthEnabled) {
    return <>{children}</>
  }

  // If Stack Auth is enabled but not ready yet, render children without auth (loading state)
  if (!stackReady || !stackComponents) {
    return <>{children}</>
  }

  // Stack Auth is ready - render with provider
  try {
    const { StackProvider, StackTheme, stackServerApp } = stackComponents
    
    return (
      <StackProvider app={stackServerApp}>
        <StackTheme>
          {children}
        </StackTheme>
      </StackProvider>
    )
  } catch (error) {
    // If Stack Auth fails to render, fall back to children without auth
    console.log('Stack Auth provider failed (safe mode):', error)
    return <>{children}</>
  }
}