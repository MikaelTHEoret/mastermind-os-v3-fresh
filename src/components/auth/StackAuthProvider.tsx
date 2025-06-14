'use client'

import { useEffect, useState } from 'react'

export default function StackAuthProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])

  // During SSR, always render children without Stack Auth for consistency
  if (!mounted) {
    return <>{children}</>
  }

  // Check if Stack Auth environment variables are configured
  const isStackAuthEnabled = !!(
    process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
    process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
  )

  // SIMPLIFIED APPROACH: Skip Stack Auth entirely to avoid internal API issues
  // Just render children without any Stack Auth wrapper
  // The UserSystem component will handle authentication state
  console.log('StackAuthProvider: Simplified mode - Stack Auth handled by UserSystem only')
  return <>{children}</>
}