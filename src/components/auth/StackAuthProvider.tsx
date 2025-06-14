'use client'

import { useEffect, useState } from 'react'

export default function StackAuthProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [stackComponents, setStackComponents] = useState<any>(null)
  const [stackReady, setStackReady] = useState(false)
  
  useEffect(() => {
    setMounted(true)
    
    // Check if Stack Auth is properly configured
    const isStackAuthEnabled = !!(
      process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
      process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
    )
    
    if (isStackAuthEnabled) {
      loadStackAuth()
    }
  }, [])

  const loadStackAuth = async () => {
    try {
      // Dynamic import Stack Auth components - following official docs pattern
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
      // Gracefully continue without Stack Auth
    }
  }

  // During SSR, always render children without Stack Auth for consistency
  if (!mounted) {
    return <>{children}</>
  }

  // Check if Stack Auth environment variables are configured
  const isStackAuthEnabled = !!(
    process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
    process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
  )

  // If Stack Auth is not configured, render children without auth
  if (!isStackAuthEnabled) {
    return <>{children}</>
  }

  // If Stack Auth is loading, render children without auth (will show loading.tsx)
  if (!stackReady || !stackComponents) {
    return <>{children}</>
  }

  // Stack Auth is ready - render with full provider setup per official docs
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
    // If Stack Auth fails to render, gracefully fall back
    console.log('Stack Auth provider render failed (safe mode):', error)
    return <>{children}</>
  }
}