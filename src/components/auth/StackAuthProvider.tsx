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
      // Import Stack Auth components
      const [stackModule, { getStackAuthConfig }] = await Promise.all([
        import('@stackframe/stack'),
        import('@/stack')
      ])
      
      // Get Stack Auth configuration
      const config = getStackAuthConfig()
      
      if (config) {
        // Use config-based Stack Auth setup
        setStackComponents({
          StackProvider: stackModule.StackProvider,
          StackTheme: stackModule.StackTheme,
          config: config
        })
        console.log('StackAuthProvider: Using config-based Stack Auth')
      } else {
        console.log('StackAuthProvider: Stack Auth configuration not available')
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

  // Stack Auth is ready - render with config-based provider
  try {
    const { StackProvider, StackTheme, config } = stackComponents
    
    if (config) {
      // Use config-based provider
      return (
        <StackProvider 
          projectId={config.projectId}
          publishableClientKey={config.publishableClientKey}
        >
          <StackTheme>
            {children}
          </StackTheme>
        </StackProvider>
      )
    } else {
      // Direct environment variable fallback
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