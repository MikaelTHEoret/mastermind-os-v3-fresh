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
      // Dynamic import Stack Auth components - use client-side app
      const stackModule = await import('@stackframe/stack')
      
      // Create client-side Stack App (no secret key required)
      const stackApp = new stackModule.StackApp({
        projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID!,
        publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY!,
      })
      
      setStackComponents({
        StackProvider: stackModule.StackProvider,
        StackTheme: stackModule.StackTheme,
        stackApp
      })
      setStackReady(true)
      console.log('StackAuthProvider: Client-side Stack Auth loaded successfully')
      
    } catch (error) {
      console.log('StackAuthProvider: Stack Auth loading failed (safe mode):', error)
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

  // Stack Auth is ready - render with client-side provider setup
  try {
    const { StackProvider, StackTheme, stackApp } = stackComponents
    
    return (
      <StackProvider app={stackApp}>
        <StackTheme>
          {children}
        </StackTheme>
      </StackProvider>
    )
  } catch (error) {
    // If Stack Auth fails to render, gracefully fall back
    console.log('StackAuthProvider: Provider render failed (safe mode):', error)
    return <>{children}</>
  }
}