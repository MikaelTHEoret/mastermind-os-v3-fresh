'use client'

import { isStackAuthEnabled } from '@/stack'
import { useEffect, useState } from 'react'

interface OptionalAuthWrapperProps {
  children: React.ReactNode
}

export default function OptionalAuthWrapper({ children }: OptionalAuthWrapperProps) {
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])

  // During SSR or before mounting, just render children without any Stack Auth hooks
  if (!mounted) {
    return <>{children}</>
  }

  // After mounting, check if Stack Auth is enabled
  if (!isStackAuthEnabled) {
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
        
        // Create a safe user hook that handles errors
        const getUserSafely = () => {
          try {
            return stackModule.useUser?.()
          } catch (error) {
            console.log('Stack Auth useUser error (safe wrapper):', error)
            return null
          }
        }
        
        // For now, just mark as ready - actual user state will be managed
        // by UserSystem component which has proper hook isolation
        setStackReady(true)
        
      } catch (error) {
        console.log('Stack Auth initialization error (safe wrapper):', error)
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