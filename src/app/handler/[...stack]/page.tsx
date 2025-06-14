'use client'

import { useEffect, useState } from 'react'

export default function Handler(props: any) {
  const [mounted, setMounted] = useState(false)
  const [debugInfo, setDebugInfo] = useState<any>(null)
  const [stackReady, setStackReady] = useState(false)
  const [stackComponents, setStackComponents] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    setMounted(true)
    
    // Debug environment variables
    const debug = {
      projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID || 'NOT_SET',
      publishableKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY ? 'SET' : 'NOT_SET',
      secretKey: process.env.STACK_SECRET_SERVER_KEY ? 'SET' : 'NOT_SET',
      nodeEnv: process.env.NODE_ENV
    }
    setDebugInfo(debug)
    console.log('Stack Auth Handler Environment Debug:', debug)
    
    // Check if Stack Auth is configured
    const isStackAuthEnabled = !!(process.env.NEXT_PUBLIC_STACK_PROJECT_ID && process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY)
    
    if (isStackAuthEnabled) {
      loadStackAuth()
    }
  }, [])

  const loadStackAuth = async () => {
    try {
      // Dynamic import to prevent build-time inclusion
      const [stackModule, { getStackServerApp }] = await Promise.all([
        import('@stackframe/stack'),
        import('../../../stack')
      ])
      
      const stackServerApp = await getStackServerApp()
      
      if (stackServerApp) {
        setStackComponents({
          StackHandler: stackModule.StackHandler,
          StackProvider: stackModule.StackProvider,
          StackTheme: stackModule.StackTheme,
          stackServerApp
        })
        setStackReady(true)
      } else {
        setError('Stack Auth server app failed to initialize')
      }
    } catch (err) {
      console.error('Stack Auth loading error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error loading Stack Auth')
    }
  }

  // During SSR, show loading
  if (!mounted) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-cyan-400 text-xl font-mono">Loading...</div>
      </div>
    )
  }

  // Check if Stack Auth is configured (runtime check)
  const isStackAuthEnabled = !!(process.env.NEXT_PUBLIC_STACK_PROJECT_ID && process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY)
  
  // If Stack Auth is not configured, show a configuration message
  if (!isStackAuthEnabled) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="max-w-lg mx-auto p-8 border border-cyan-500/30 rounded-lg bg-black/50">
          <h1 className="text-xl font-bold text-cyan-400 mb-4">Authentication Setup Required</h1>
          <p className="text-cyan-300 mb-4">
            Stack Auth is not configured. Missing environment variables:
          </p>
          <div className="text-cyan-200 text-sm space-y-1 mb-4 bg-gray-900/50 p-3 rounded">
            <div>PROJECT_ID: {debugInfo?.projectId === 'NOT_SET' ? '❌ NOT_SET' : '✅ SET'}</div>
            <div>PUBLISHABLE_KEY: {debugInfo?.publishableKey === 'NOT_SET' ? '❌ NOT_SET' : '✅ SET'}</div>
            <div>SECRET_KEY: {debugInfo?.secretKey === 'NOT_SET' ? '❌ NOT_SET' : '✅ SET'}</div>
            <div>NODE_ENV: {debugInfo?.nodeEnv}</div>
          </div>
          <p className="text-cyan-300 mb-4 text-sm">
            Required Vercel environment variables:
          </p>
          <ol className="text-cyan-200 text-sm space-y-2 mb-4">
            <li>• NEXT_PUBLIC_STACK_PROJECT_ID</li>
            <li>• NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY</li>
            <li>• STACK_SECRET_SERVER_KEY</li>
          </ol>
          <a 
            href="/"
            className="inline-block px-4 py-2 bg-cyan-600 text-black rounded hover:bg-cyan-500 transition-colors"
          >
            Return to App
          </a>
        </div>
      </div>
    )
  }

  // If there was an error loading Stack Auth
  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="max-w-md mx-auto p-8 border border-red-500/30 rounded-lg bg-black/50">
          <h1 className="text-xl font-bold text-red-400 mb-4">Authentication Error</h1>
          <p className="text-red-300 mb-4">
            There was an error initializing the authentication system.
          </p>
          <div className="text-red-200 text-sm bg-red-900/20 p-3 rounded mb-4">
            {error}
          </div>
          <div className="text-gray-400 text-xs bg-gray-900/50 p-2 rounded mb-4">
            Debug: {JSON.stringify(debugInfo, null, 2)}
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

  // If Stack Auth is loading
  if (!stackReady || !stackComponents) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-cyan-400 text-xl font-mono animate-pulse">
          Loading Authentication...
        </div>
      </div>
    )
  }

  // Stack Auth is ready - render handler
  try {
    const { StackHandler, StackProvider, StackTheme, stackServerApp } = stackComponents
    
    return (
      <StackProvider app={stackServerApp}>
        <StackTheme>
          <StackHandler fullPage app={stackServerApp} {...props} />
        </StackTheme>
      </StackProvider>
    )
  } catch (handlerError) {
    console.error('Stack Auth Handler Runtime Error:', handlerError)
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="max-w-md mx-auto p-8 border border-red-500/30 rounded-lg bg-black/50">
          <h1 className="text-xl font-bold text-red-400 mb-4">Authentication Handler Error</h1>
          <p className="text-red-300 mb-4">
            The authentication handler encountered an error.
          </p>
          <div className="text-red-200 text-sm bg-red-900/20 p-3 rounded mb-4">
            {handlerError instanceof Error ? handlerError.message : 'Unknown handler error'}
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