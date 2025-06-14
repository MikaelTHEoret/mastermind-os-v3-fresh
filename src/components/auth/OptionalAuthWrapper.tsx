'use client'

import { useUser } from '@stackframe/stack'

interface OptionalAuthWrapperProps {
  children: React.ReactNode
}

export default function OptionalAuthWrapper({ children }: OptionalAuthWrapperProps) {
  // Always call hooks in the same order - no conditional hooks
  const user = useUser()
  
  // Render children regardless of auth state
  // This allows the app to work in both authenticated and guest modes
  return <>{children}</>
}