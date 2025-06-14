'use client'

import { StackProvider } from '@stackframe/stack'

export default function StackAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <StackProvider
      appId="st_tcutrWqiStGLyVSB" // Demo project ID from original
      appUrl={process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}
      tokenStore="nextjs-cookie"
    >
      {children}
    </StackProvider>
  )
}