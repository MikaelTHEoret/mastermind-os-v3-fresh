'use client'

import { useEffect, useState } from 'react'

interface OptionalAuthWrapperProps {
  children: React.ReactNode
}

export default function OptionalAuthWrapper({ children }: OptionalAuthWrapperProps) {
  const [mounted, setMounted] = useState(false)
  const [stackAuthStatus, setStackAuthStatus] = useState<'checking' | 'enabled' | 'disabled'>('checking')
  
  useEffect(() => {
    setMounted(true)
    
    const checkStackAuth = async () => {
      try {
        // Import and call the function properly
        const { isStackAuthEnabledClient } = await import('@/stack')
        
        if (isStackAuthEnabledClient()) {
          setStackAuthStatus('enabled')
          console.log('OptionalAuthWrapper: Stack Auth enabled')
        } else {
          setStackAuthStatus('disabled')
          console.log('OptionalAuthWrapper: Stack Auth disabled - environment variables not configured')
        }
      } catch (error) {
        console.log('OptionalAuthWrapper: Stack Auth check failed:', error)
        setStackAuthStatus('disabled')
      }
    }
    
    checkStackAuth()
  }, [])

  // During SSR or before mounting, just render children without any Stack Auth hooks
  if (!mounted || stackAuthStatus === 'checking') {
    return <>{children}</>
  }

  // After mounting, check if Stack Auth is enabled
  if (stackAuthStatus === 'disabled') {
    return <>{children}</>
  }

  // Only import and use Stack Auth components when actually enabled and mounted
  return <SafeStackAuthWrapper>{children}</SafeStackAuthWrapper>
}

// Separate component that safely handles Stack Auth when enabled
function SafeStackAuthWrapper({ children }: { children: React.ReactNode }) {
  const [stackReady, setStackReady] = useState(false)
  const [user, setUser] = useState<any>(null)
  
  useEffect(() => {
    let mounted = true
    
    const initializeStackAuth = async () => {
      try {
        // Dynamic import to prevent build-time inclusion
        const stackModule = await import('@stackframe/stack')
        
        if (!mounted) return
        
        // For now, just mark as ready - actual user state will be managed
        // by UserSystem component which has proper hook isolation
        setStackReady(true)
        console.log('SafeStackAuthWrapper: Stack Auth modules loaded successfully')
        
      } catch (error) {
        console.log('SafeStackAuthWrapper: Stack Auth initialization error:', error)
      }
    }
    
    initializeStackAuth()
    
    return () => {
      mounted = false
    }
  }, [])

  // Don't call any hooks until Stack Auth is confirmed ready
  // The actual user management is handled by UserSystem component
  return <>{children}</>
}