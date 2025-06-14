'use client'

import { StackHandler, StackProvider, StackTheme } from '@stackframe/stack'
import { stackServerApp, isStackAuthEnabled } from '../../../stack'
import { useEffect, useState } from 'react'

export default function Handler(props: any) {
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])

  // During SSR, show loading
  if (!mounted) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-cyan-400 text-xl font-mono">Loading...</div>
      </div>
    )
  }

  // If Stack Auth is not configured, show a configuration message
  if (!isStackAuthEnabled) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="max-w-md mx-auto p-8 border border-cyan-500/30 rounded-lg bg-black/50">
          <h1 className="text-xl font-bold text-cyan-400 mb-4">Authentication Setup Required</h1>
          <p className="text-cyan-300 mb-4">
            Stack Auth is not configured. To enable authentication:
          </p>
          <ol className="text-cyan-200 text-sm space-y-2">
            <li>1. Create a project at Stack Auth Dashboard</li>
            <li>2. Add environment variables to your deployment platform</li>
            <li>3. Configure NEXT_PUBLIC_STACK_PROJECT_ID and STACK_SECRET_SERVER_KEY</li>
          </ol>
          <a 
            href="/"
            className="inline-block mt-4 px-4 py-2 bg-cyan-600 text-black rounded hover:bg-cyan-500 transition-colors"
          >
            Return to App
          </a>
        </div>
      </div>
    )
  }

  // Wrap StackHandler in its own StackProvider to ensure context is available
  try {
    return (
      <StackProvider app={stackServerApp}>
        <StackTheme>
          <StackHandler fullPage app={stackServerApp} {...props} />
        </StackTheme>
      </StackProvider>
    )
  } catch (error) {
    console.error('Stack Auth Handler Error:', error)
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="max-w-md mx-auto p-8 border border-red-500/30 rounded-lg bg-black/50">
          <h1 className="text-xl font-bold text-red-400 mb-4">Authentication Error</h1>
          <p className="text-red-300 mb-4">
            There was an error initializing the authentication system.
          </p>
          <div className="text-red-200 text-sm bg-red-900/20 p-3 rounded mb-4">
            {error instanceof Error ? error.message : 'Unknown error'}
          </div>
          <a 
            href="/"
            className="inline-block px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500 transition-colors"
          >
            Return to App
          </a>
        </div>
      </div>
    )
  }
}