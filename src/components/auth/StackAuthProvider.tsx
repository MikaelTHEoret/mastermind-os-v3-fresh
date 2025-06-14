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
    } else {
      console.log('StackAuthProvider: Stack Auth disabled - Environment variables not configured')
    }
  }, [])

  const loadStackAuth = async () => {
    try {
      // Import Stack Auth and create proper client app
      const [stackModule, { getStackServerApp }] = await Promise.all([
        import('@stackframe/stack'),
        import('@/stack')
      ])
      
      // Try to get the server app for SSR compatibility
      const stackServerApp = await getStackServerApp()
      
      if (stackServerApp) {
        // Use server app if available (for full-stack setup)
        setStackComponents({
          StackProvider: stackModule.StackProvider,
          StackTheme: stackModule.StackTheme,
          app: stackServerApp
        })
        console.log('StackAuthProvider: Using server app configuration')
      } else {
        // Create client app if server app not available
        const stackClientApp = stackModule.StackApp ? new stackModule.StackApp({
          projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID!,
          publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY!,
        }) : null
        
        if (stackClientApp) {
          setStackComponents({
            StackProvider: stackModule.StackProvider,
            StackTheme: stackModule.StackTheme,
            app: stackClientApp
          })
          console.log('StackAuthProvider: Using client app configuration')
        } else {
          // Fallback: Use StackProvider without app (if supported)
          setStackComponents({
            StackProvider: stackModule.StackProvider,
            StackTheme: stackModule.StackTheme,
            app: null
          })
          console.log('StackAuthProvider: Using provider-only configuration')
        }
      }
      
      setStackReady(true)
      
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

  // Stack Auth is ready - render with appropriate provider setup
  try {
    const { StackProvider, StackTheme, app } = stackComponents
    
    if (app) {
      // Use app-based provider (preferred)
      return (
        <StackProvider app={app}>
          <StackTheme>
            {children}
          </StackTheme>
        </StackProvider>
      )
    } else {
      // Use config-based provider (fallback)
      return (
        <StackProvider 
          projectId={process.env.NEXT_PUBLIC_STACK_PROJECT_ID!}
          publishableClientKey={process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY!}
        >
          <StackTheme>
            {children}
          </StackTheme>
        </StackProvider>
      )
    }
  } catch (error) {
    // If Stack Auth fails to render, gracefully fall back
    console.log('StackAuthProvider: Provider render failed (safe mode):', error)
    return <>{children}</>
  }
}