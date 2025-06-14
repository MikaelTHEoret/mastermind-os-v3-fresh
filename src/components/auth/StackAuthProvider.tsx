'use client';

import React, { ReactNode, useState, useEffect } from 'react';

interface StackAuthProviderProps {
  children: ReactNode;
}

interface StackAuthComponents {
  StackProvider: React.ComponentType<any>;
  StackTheme: React.ComponentType<any>;
}

export function StackAuthProvider({ children }: StackAuthProviderProps) {
  const [stackComponents, setStackComponents] = useState<StackAuthComponents | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasValidConfig, setHasValidConfig] = useState(false);
  const [initializationAttempted, setInitializationAttempted] = useState(false);

  useEffect(() => {
    async function initializeStackAuth() {
      if (initializationAttempted) return;
      setInitializationAttempted(true);

      try {
        // Check if we have the required environment variables
        const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
        const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;

        console.log('StackAuthProvider: Checking environment variables...');
        console.log('Project ID:', projectId ? 'SET' : 'NOT_SET');
        console.log('Publishable Key:', publishableKey ? 'SET' : 'NOT_SET');

        if (!projectId || !publishableKey) {
          console.log('StackAuthProvider: Environment variables not configured, using guest mode permanently');
          setHasValidConfig(false);
          setIsLoading(false);
          return;
        }

        // TEMPORARY DISABLE: Skip Stack Auth entirely to eliminate toClientJson errors
        console.log('StackAuthProvider: TEMPORARILY DISABLING Stack Auth to resolve toClientJson errors');
        console.log('StackAuthProvider: Using guest mode until Stack Auth internal errors are resolved');
        setHasValidConfig(false);
        setIsLoading(false);
        return;

        /* ORIGINAL CODE - RE-ENABLE AFTER Stack AUTH FIXES:
        
        // Try to dynamically import Stack Auth components
        console.log('StackAuthProvider: Loading Stack Auth components...');
        const { StackProvider, StackTheme } = await import('@stackframe/stack');

        // Use getStackAuthConfig() instead of getStackServerApp() - CLIENT-SAFE!
        const config = await import('@/stack').then(module => module.getStackAuthConfig());
        
        if (!config) {
          console.log('StackAuthProvider: Invalid config, falling back to guest mode');
          setHasValidConfig(false);
          setIsLoading(false);
          return;
        }

        console.log('StackAuthProvider: Stack Auth initialized successfully with config:', config);
        setStackComponents({ StackProvider, StackTheme });
        setHasValidConfig(true);
        
        */
        
      } catch (error) {
        console.log('StackAuthProvider: Error loading Stack Auth, falling back to guest mode:', error);
        setHasValidConfig(false);
      } finally {
        setIsLoading(false);
      }
    }

    initializeStackAuth();
  }, [initializationAttempted]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-cyan-300 text-lg">Initializing authentication...</div>
      </div>
    );
  }

  // TEMPORARY: Always use guest mode to eliminate toClientJson errors
  // TODO: Re-enable Stack Auth after internal errors are resolved
  console.log('StackAuthProvider: Running in guest mode (Stack Auth temporarily disabled)');
  return <>{children}</>;

  /* ORIGINAL CODE - RE-ENABLE AFTER STACK AUTH FIXES:
  
  // If Stack Auth is available and configured, use it
  if (hasValidConfig && stackComponents) {
    const { StackProvider, StackTheme } = stackComponents;
    
    return (
      <StackProvider
        app={{
          projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID!,
          publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY!,
        }}
      >
        <StackTheme>
          {children}
        </StackTheme>
      </StackProvider>
    );
  }

  // Fallback to guest mode without any Stack Auth components
  console.log('StackAuthProvider: Running in guest mode');
  return <>{children}</>;
  
  */
}
