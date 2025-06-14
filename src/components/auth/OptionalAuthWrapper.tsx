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
  return <StackAuthEnabledWrapper>{children}</StackAuthEnabledWrapper>
}

// Separate component that only loads when Stack Auth is confirmed enabled
function StackAuthEnabledWrapper({ children }: { children: React.ReactNode }) {
  // Dynamically import to avoid loading Stack Auth hooks when not needed
  const [StackComponents, setStackComponents] = useState<any>(null)
  
  useEffect(() => {
    if (isStackAuthEnabled) {
      import('@stackframe/stack').then((stackModule) => {
        setStackComponents(stackModule)
      })
    }
  }, [])

  // While Stack Auth is loading, render children without hooks
  if (!StackComponents) {
    return <>{children}</>
  }

  // Now safely use Stack Auth
  const { useUser } = StackComponents
  const user = useUser()
  
  return <>{children}</>
}