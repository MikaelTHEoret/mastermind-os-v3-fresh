'use client'

import { useUser } from '@stackframe/stack'
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

  // If not mounted yet or Stack Auth disabled, just render children
  if (!mounted || !isStackAuthEnabled) {
    return <>{children}</>
  }

  // Only use Stack Auth hooks after mounting and when enabled
  return <AuthEnabledWrapper>{children}</AuthEnabledWrapper>
}

function AuthEnabledWrapper({ children }: { children: React.ReactNode }) {
  const user = useUser()
  return <>{children}</>
}